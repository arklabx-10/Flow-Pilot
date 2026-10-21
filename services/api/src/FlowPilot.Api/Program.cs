using FlowPilot.Api.Contracts.V1;
using FlowPilot.Api.Data;
using FlowPilot.Api.Endpoints;
using FlowPilot.Api.Security;
using FlowPilot.Api.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi("v1");
builder.Services.AddHealthChecks();
builder.Services.AddHttpClient<ISpeechTranscriptionGateway, OpenAiSpeechTranscriptionGateway>();

builder.Services.AddSingleton<FlowPilotTokenService>();
builder.Services
    .AddAuthentication(FlowPilotTokenService.SchemeName)
    .AddScheme<AuthenticationSchemeOptions, FlowPilotBearerAuthenticationHandler>(
        FlowPilotTokenService.SchemeName,
        _ => { });
builder.Services.AddAuthorization();

builder.Services.AddDbContext<FlowPilotDbContext>((serviceProvider, options) =>
{
    var configuration = serviceProvider.GetRequiredService<IConfiguration>();
    var useInMemoryDb = configuration.GetValue<bool?>("Database:UseInMemory") ?? false;
    var inMemoryName = configuration["Database:InMemoryName"] ?? "FlowPilotLocalDevDb";
    var postgresConnectionString = configuration.GetConnectionString("SharedPostgres");

    if (useInMemoryDb || string.IsNullOrWhiteSpace(postgresConnectionString))
    {
        options.UseInMemoryDatabase(inMemoryName);
    }
    else
    {
        options.UseNpgsql(postgresConnectionString);
    }
});

var allowedOrigins = builder.Configuration
    .GetSection("Cors:AllowedOrigins")
    .Get<string[]>() ?? ["http://localhost:5173", "http://localhost:1420", "tauri://localhost"];

builder.Services.AddCors(options =>
{
    options.AddPolicy("FlowPilotClients", policy =>
    {
        policy.WithOrigins(allowedOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var app = builder.Build();

app.UseCors("FlowPilotClients");
app.UseAuthentication();
app.UseAuthorization();
app.MapOpenApi("/openapi/{documentName}.json");

static HealthStatusResponseV1 CreateHealthResponse(IHostEnvironment environment, IConfiguration configuration)
{
    var hasPostgresConfig = !string.IsNullOrWhiteSpace(configuration.GetConnectionString("SharedPostgres"));
    return new HealthStatusResponseV1(
        Status: "Healthy",
        Service: "flowpilot-api",
        ContractVersion: ContractVersions.V1,
        Environment: environment.EnvironmentName,
        TimestampUtc: DateTimeOffset.UtcNow.ToString("O"),
        PostgresMode: hasPostgresConfig ? "Configured" : "Unconfigured");
}

app.MapGet("/health", (IHostEnvironment env, IConfiguration config) =>
        Results.Ok(CreateHealthResponse(env, config)))
    .WithName("GetHealthProbe")
    .WithSummary("Infrastructure health probe")
    .WithTags("Health");

var v1 = app.MapGroup("/api/v1");

v1.MapGet("/health", (IHostEnvironment env, IConfiguration config) =>
        Results.Ok(CreateHealthResponse(env, config)))
    .WithName("GetHealthV1")
    .WithSummary("Versioned v1 health and storage readiness status")
    .WithTags("Health");

v1.MapAccountAndSyncEndpoints();

v1.MapPost("/speech/transcribe", async (
        HttpRequest request,
        IConfiguration configuration,
        ISpeechTranscriptionGateway gateway,
        CancellationToken cancellationToken) =>
    {
        if (!request.HasFormContentType)
        {
            return Results.BadRequest(new ApiErrorResponseV1(
                Code: "EMPTY_RECORDING",
                Message: "Expected multipart/form-data request containing an audio file.",
                Recoverable: true));
        }

        var form = await request.ReadFormAsync(cancellationToken);
        var file = form.Files.GetFile("file");
        if (file is null || file.Length == 0)
        {
            return Results.BadRequest(new ApiErrorResponseV1(
                Code: "EMPTY_RECORDING",
                Message: "Submitted audio file was missing or empty (0 bytes).",
                Recoverable: true));
        }

        var maxAudioBytes = configuration.GetValue<long?>("SpeechProvider:MaxAudioBytes") ?? 25L * 1024L * 1024L;
        if (file.Length > maxAudioBytes)
        {
            return Results.Json(
                new ApiErrorResponseV1(
                    Code: "USAGE_LIMIT_EXCEEDED",
                    Message: $"Audio file size ({file.Length} bytes) exceeds the maximum allowed limit ({maxAudioBytes} bytes).",
                    Recoverable: true),
                statusCode: StatusCodes.Status413PayloadTooLarge);
        }

        var language = form["language"].FirstOrDefault();
        var translateToEnglish = bool.TryParse(form["translateToEnglish"].FirstOrDefault(), out var flag) && flag;

        try
        {
            await using var stream = file.OpenReadStream();
            var result = await gateway.TranscribeAsync(
                stream,
                file.FileName,
                file.ContentType,
                language,
                translateToEnglish,
                cancellationToken);

            return Results.Ok(result);
        }
        catch (SpeechGatewayException ex)
        {
            return Results.Json(
                new ApiErrorResponseV1(ex.Code, ex.Message, ex.Recoverable),
                statusCode: ex.StatusCode);
        }
    })
    .WithName("TranscribeSpeechV1")
    .WithSummary("Transcribe captured audio via configured cloud speech provider")
    .WithTags("Speech");

v1.MapPost("/text/refine", (CloudTextRefineRequestV1 request) =>
    {
        if (string.IsNullOrWhiteSpace(request.OriginalTranscript))
        {
            return Results.BadRequest(new ApiErrorResponseV1(
                Code: "REFINEMENT_FAILED",
                Message: "OriginalTranscript is required for cloud text refinement.",
                Recoverable: true));
        }

        var mode = string.IsNullOrWhiteSpace(request.OutputMode) ? "clean" : request.OutputMode;
        var refined = CloudTextRefiner.Refine(request.OriginalTranscript, mode);

        return Results.Ok(new CloudTextRefineResponseV1(
            RefinedText: refined,
            OutputMode: mode,
            ProviderId: CloudTextRefiner.ProviderIdentifier,
            ContractVersion: ContractVersions.V1));
    })
    .WithName("RefineTextV1")
    .WithSummary("Refine raw transcript using cloud text refinement")
    .WithTags("Speech");

v1.MapPost("/transcripts/sync", (TranscriptSyncRequestV1 request) =>
    {
        if (string.IsNullOrWhiteSpace(request.Id))
        {
            return Results.BadRequest(new ApiErrorResponseV1(
                Code: "STORAGE_FAILED",
                Message: "Transcript Id is required for cloud synchronization.",
                Recoverable: true));
        }

        return Results.Ok(new TranscriptSyncResponseV1(
            SyncedId: request.Id,
            SyncedAtUtc: DateTimeOffset.UtcNow.ToString("O"),
            ContractVersion: ContractVersions.V1));
    })
    .WithName("SyncTranscriptV1")
    .WithSummary("Synchronize a user-approved transcript entry to the cloud")
    .WithTags("Sync");

app.Run();

public partial class Program;
