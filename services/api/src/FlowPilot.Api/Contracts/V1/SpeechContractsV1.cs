namespace FlowPilot.Api.Contracts.V1;

public sealed record CloudTranscriptionResponseV1(
    string Transcript,
    string ProviderId,
    string? Language,
    string ContractVersion);

public sealed record CloudTextRefineRequestV1(
    string OriginalTranscript,
    string OutputMode);

public sealed record CloudTextRefineResponseV1(
    string RefinedText,
    string OutputMode,
    string ProviderId,
    string ContractVersion);

public sealed record TranscriptSyncRequestV1(
    string Id,
    string OriginalTranscript,
    string RefinedTranscript,
    string EditedText,
    string OutputMode,
    string ProviderId,
    long DurationMs,
    string CreatedAtUtc);

public sealed record TranscriptSyncResponseV1(
    string SyncedId,
    string SyncedAtUtc,
    string ContractVersion);

public sealed record ApiErrorResponseV1(
    string Code,
    string Message,
    bool Recoverable);
