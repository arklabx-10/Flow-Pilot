using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FlowPilot.Api.Contracts.V1;
using FlowPilot.Api.Services;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Xunit;

namespace FlowPilot.Api.Tests;

public sealed class SpeechAndRefinementEndpointsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task TranscribeSpeech_WhenBackendKeyUnconfigured_Returns503CloudProviderUnconfigured()
    {
        await using var customFactory = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["SpeechProvider:OpenAi:ApiKey"] = "",
                });
            });
        });

        using var client = customFactory.CreateClient();
        using var form = new MultipartFormDataContent();
        var audioContent = new ByteArrayContent([1, 2, 3, 4]);
        audioContent.Headers.ContentType = new MediaTypeHeaderValue("audio/webm");
        form.Add(audioContent, "file", "dictation.webm");

        var response = await client.PostAsync("/api/v1/speech/transcribe", form);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var error = await response.Content.ReadFromJsonAsync<ApiErrorResponseV1>();
        Assert.NotNull(error);
        Assert.Equal("CLOUD_PROVIDER_UNCONFIGURED", error.Code);
    }

    [Fact]
    public async Task TranscribeSpeech_WhenPayloadExceedsUsageLimit_Returns413UsageLimitExceeded()
    {
        await using var customFactory = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["SpeechProvider:MaxAudioBytes"] = "16",
                });
            });
        });

        using var client = customFactory.CreateClient();
        using var form = new MultipartFormDataContent();
        var oversizedAudio = new ByteArrayContent(new byte[64]);
        oversizedAudio.Headers.ContentType = new MediaTypeHeaderValue("audio/webm");
        form.Add(oversizedAudio, "file", "oversized.webm");

        var response = await client.PostAsync("/api/v1/speech/transcribe", form);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        var error = await response.Content.ReadFromJsonAsync<ApiErrorResponseV1>();
        Assert.NotNull(error);
        Assert.Equal("USAGE_LIMIT_EXCEEDED", error.Code);
    }

    [Fact]
    public async Task TranscribeSpeech_WithConfiguredGateway_ReturnsTranscriptWithoutClientCredentials()
    {
        await using var customFactory = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<ISpeechTranscriptionGateway>();
                services.AddSingleton<ISpeechTranscriptionGateway>(
                    new FakeSpeechTranscriptionGateway("Transcribed via cloud proxy gateway."));
            });
        });

        using var client = customFactory.CreateClient();
        using var form = new MultipartFormDataContent();
        var audioContent = new ByteArrayContent([10, 20, 30, 40]);
        audioContent.Headers.ContentType = new MediaTypeHeaderValue("audio/webm");
        form.Add(audioContent, "file", "dictation.webm");
        form.Add(new StringContent("en"), "language");
        form.Add(new StringContent("false"), "translateToEnglish");

        var response = await client.PostAsync("/api/v1/speech/transcribe", form);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var payload = await response.Content.ReadFromJsonAsync<CloudTranscriptionResponseV1>();
        Assert.NotNull(payload);
        Assert.Equal("Transcribed via cloud proxy gateway.", payload.Transcript);
        Assert.Equal("flowpilot-cloud-openai", payload.ProviderId);
        Assert.Equal("en", payload.Language);
        Assert.Equal(ContractVersions.V1, payload.ContractVersion);
    }

    [Fact]
    public async Task RefineText_ReturnsFormattedTextForRequestedOutputMode()
    {
        using var client = factory.CreateClient();
        var request = new CloudTextRefineRequestV1(
            OriginalTranscript: "um please review the pull request before noon",
            OutputMode: "professional");

        var response = await client.PostAsJsonAsync("/api/v1/text/refine", request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var payload = await response.Content.ReadFromJsonAsync<CloudTextRefineResponseV1>();
        Assert.NotNull(payload);
        Assert.Contains("Hi team,", payload.RefinedText);
        Assert.Contains("Please review the pull request before noon.", payload.RefinedText);
        Assert.Equal("professional", payload.OutputMode);
        Assert.Equal(ContractVersions.V1, payload.ContractVersion);
    }

    [Fact]
    public async Task SyncTranscript_AcceptsAuthorizedTranscriptMetadata()
    {
        using var client = factory.CreateClient();
        var request = new TranscriptSyncRequestV1(
            Id: "entry-sync-1",
            OriginalTranscript: "raw text",
            RefinedTranscript: "Raw text.",
            EditedText: "Edited text.",
            OutputMode: "clean",
            ProviderId: "local-whisper-cpp",
            DurationMs: 1400,
            CreatedAtUtc: "2026-10-21T18:30:00Z");

        var response = await client.PostAsJsonAsync("/api/v1/transcripts/sync", request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var payload = await response.Content.ReadFromJsonAsync<TranscriptSyncResponseV1>();
        Assert.NotNull(payload);
        Assert.Equal("entry-sync-1", payload.SyncedId);
        Assert.Equal(ContractVersions.V1, payload.ContractVersion);
    }

    private sealed class FakeSpeechTranscriptionGateway(string cannedTranscript)
        : ISpeechTranscriptionGateway
    {
        public Task<CloudTranscriptionResponseV1> TranscribeAsync(
            Stream audioStream,
            string fileName,
            string contentType,
            string? language,
            bool translateToEnglish,
            CancellationToken cancellationToken)
        {
            return Task.FromResult(new CloudTranscriptionResponseV1(
                Transcript: cannedTranscript,
                ProviderId: "flowpilot-cloud-openai",
                Language: language,
                ContractVersion: ContractVersions.V1));
        }
    }
}
