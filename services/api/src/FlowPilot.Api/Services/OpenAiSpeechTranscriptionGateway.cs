using System.Net.Http.Headers;
using System.Text.Json;
using FlowPilot.Api.Contracts.V1;

namespace FlowPilot.Api.Services;

public sealed class SpeechGatewayException(
    int statusCode,
    string code,
    string message,
    bool recoverable = true) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
    public string Code { get; } = code;
    public bool Recoverable { get; } = recoverable;
}

public interface ISpeechTranscriptionGateway
{
    Task<CloudTranscriptionResponseV1> TranscribeAsync(
        Stream audioStream,
        string fileName,
        string contentType,
        string? language,
        bool translateToEnglish,
        CancellationToken cancellationToken);
}

public sealed class OpenAiSpeechTranscriptionGateway(
    HttpClient httpClient,
    IConfiguration configuration) : ISpeechTranscriptionGateway
{
    public const string ProviderIdentifier = "flowpilot-cloud-openai";

    public async Task<CloudTranscriptionResponseV1> TranscribeAsync(
        Stream audioStream,
        string fileName,
        string contentType,
        string? language,
        bool translateToEnglish,
        CancellationToken cancellationToken)
    {
        var apiKey = configuration["SpeechProvider:OpenAi:ApiKey"]?.Trim();
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            throw new SpeechGatewayException(
                StatusCodes.Status503ServiceUnavailable,
                "CLOUD_PROVIDER_UNCONFIGURED",
                "Cloud speech provider credentials (SpeechProvider:OpenAi:ApiKey) are not configured on the backend server.");
        }

        var baseUrl = (configuration["SpeechProvider:OpenAi:BaseUrl"] ?? "https://api.openai.com/v1").TrimEnd('/');
        var model = configuration["SpeechProvider:OpenAi:Model"] ?? "whisper-1";
        var timeoutSeconds = configuration.GetValue<int?>("SpeechProvider:OpenAi:TimeoutSeconds") ?? 30;

        var endpointPath = translateToEnglish ? "audio/translations" : "audio/transcriptions";

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(TimeSpan.FromSeconds(Math.Max(1, timeoutSeconds)));

        using var form = new MultipartFormDataContent();
        using var streamContent = new StreamContent(audioStream);
        streamContent.Headers.ContentType = new MediaTypeHeaderValue(
            string.IsNullOrWhiteSpace(contentType) ? "audio/webm" : contentType);

        form.Add(streamContent, "file", string.IsNullOrWhiteSpace(fileName) ? "dictation.webm" : fileName);
        form.Add(new StringContent(model), "model");
        form.Add(new StringContent("json"), "response_format");

        if (!translateToEnglish && !string.IsNullOrWhiteSpace(language) && !string.Equals(language, "auto", StringComparison.OrdinalIgnoreCase))
        {
            form.Add(new StringContent(language), "language");
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/{endpointPath}")
        {
            Content = form,
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

        HttpResponseMessage response;
        try
        {
            response = await httpClient.SendAsync(request, timeoutCts.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new SpeechGatewayException(
                StatusCodes.Status504GatewayTimeout,
                "PROVIDER_TIMEOUT",
                "Upstream cloud speech provider timed out while processing audio.");
        }
        catch (HttpRequestException ex)
        {
            throw new SpeechGatewayException(
                StatusCodes.Status502BadGateway,
                "PROVIDER_NETWORK_ERROR",
                $"Failed to reach upstream cloud speech provider: {ex.Message}");
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                var status = (int)response.StatusCode;
                if (status is StatusCodes.Status401Unauthorized or StatusCodes.Status403Forbidden)
                {
                    throw new SpeechGatewayException(
                        StatusCodes.Status502BadGateway,
                        "PROVIDER_AUTH_FAILED",
                        "Backend cloud speech provider credentials were rejected by upstream service.");
                }

                if (status == StatusCodes.Status429TooManyRequests)
                {
                    throw new SpeechGatewayException(
                        StatusCodes.Status429TooManyRequests,
                        "PROVIDER_RATE_LIMITED",
                        "Cloud speech provider rate limit exceeded. Please wait or switch to Local Speech mode.");
                }

                throw new SpeechGatewayException(
                    StatusCodes.Status502BadGateway,
                    "PROVIDER_NETWORK_ERROR",
                    $"Upstream speech provider returned HTTP {status}.");
            }

            await using var responseStream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var document = await JsonDocument.ParseAsync(responseStream, cancellationToken: cancellationToken);

            var text = document.RootElement.TryGetProperty("text", out var textProp)
                ? textProp.GetString()?.Trim()
                : null;

            if (string.IsNullOrWhiteSpace(text))
            {
                throw new SpeechGatewayException(
                    StatusCodes.Status422UnprocessableEntity,
                    "PROVIDER_INVALID_RESPONSE",
                    "No speech was detected in the submitted audio recording.");
            }

            return new CloudTranscriptionResponseV1(
                Transcript: text,
                ProviderId: ProviderIdentifier,
                Language: language,
                ContractVersion: ContractVersions.V1);
        }
    }
}
