namespace FlowPilot.Api.Contracts.V1;

public sealed record RegisterRequestV1(
    string Email,
    string Password,
    string DisplayName);

public sealed record LoginRequestV1(
    string Email,
    string Password);

public sealed record UserProfileV1(
    string Id,
    string Email,
    string DisplayName);

public sealed record AuthSessionResponseV1(
    string AccessToken,
    string ExpiresAtUtc,
    UserProfileV1 User,
    string ContractVersion);

public sealed record RegisterDeviceRequestV1(
    string Id,
    string DeviceName,
    string Platform);

public sealed record DeviceRecordV1(
    string Id,
    string UserId,
    string DeviceName,
    string Platform,
    string LastSeenAtUtc);

public sealed record TranscriptRecordV1(
    string Id,
    string UserId,
    string DeviceId,
    string OriginalTranscript,
    string RefinedTranscript,
    string EditedText,
    string OutputMode,
    string ProviderId,
    long DurationMs,
    int Version,
    bool IsDeleted,
    string? DeletedAtUtc,
    string CreatedAtUtc,
    string UpdatedAtUtc);

public sealed record UpsertTranscriptRequestV1(
    string IdempotencyKey,
    int ExpectedVersion,
    string DeviceId,
    string OriginalTranscript,
    string RefinedTranscript,
    string EditedText,
    string OutputMode,
    string ProviderId,
    long DurationMs,
    string ClientUpdatedAtUtc);

public sealed record NoteRecordV1(
    string Id,
    string UserId,
    string DeviceId,
    string Title,
    string Content,
    string Folder,
    string[] Tags,
    string? SourceTranscriptId,
    int Version,
    bool IsDeleted,
    string? DeletedAtUtc,
    string CreatedAtUtc,
    string UpdatedAtUtc);

public sealed record UpsertNoteRequestV1(
    string IdempotencyKey,
    int ExpectedVersion,
    string DeviceId,
    string Title,
    string Content,
    string Folder,
    string[] Tags,
    string? SourceTranscriptId,
    string ClientUpdatedAtUtc);

public sealed record PromptTemplateRecordV1(
    string Id,
    string UserId,
    string Name,
    string SystemInstructions,
    string OutputMode,
    int Version,
    string UpdatedAtUtc);

public sealed record UpsertPromptTemplateRequestV1(
    string Name,
    string SystemInstructions,
    string OutputMode,
    int? ExpectedVersion = null);

public sealed record ProcessingPreferencesRecordV1(
    string UserId,
    string DefaultOutputMode,
    string DefaultLanguage,
    string PreferredSpeechMode,
    string PreferredRefinementMode,
    bool AutoCopyToClipboard,
    bool SyncEnabled,
    int Version,
    string UpdatedAtUtc);

public sealed record UpdateProcessingPreferencesRequestV1(
    string DefaultOutputMode,
    string DefaultLanguage,
    string PreferredSpeechMode,
    string PreferredRefinementMode,
    bool AutoCopyToClipboard,
    bool SyncEnabled,
    int? ExpectedVersion = null);

public sealed record PaginatedListResponseV1<T>(
    IReadOnlyList<T> Items,
    int Page,
    int PageSize,
    int TotalCount,
    string ContractVersion);

public sealed record SyncConflictResponseV1<T>(
    string Code,
    string Message,
    int ServerVersion,
    int ExpectedVersion,
    T ServerRecord);
