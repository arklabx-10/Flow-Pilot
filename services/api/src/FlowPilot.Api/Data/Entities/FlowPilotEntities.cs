namespace FlowPilot.Api.Data.Entities;

public sealed class UserEntity
{
    public required string Id { get; set; }
    public required string Email { get; set; }
    public required string DisplayName { get; set; }
    public required string PasswordHash { get; set; }
    public required DateTimeOffset CreatedAtUtc { get; set; }
}

public sealed class DeviceEntity
{
    public required string Id { get; set; }
    public required string UserId { get; set; }
    public required string DeviceName { get; set; }
    public required string Platform { get; set; }
    public required DateTimeOffset LastSeenAtUtc { get; set; }
}

public sealed class TranscriptEntity
{
    public required string Id { get; set; }
    public required string UserId { get; set; }
    public required string DeviceId { get; set; }
    public required string OriginalTranscript { get; set; }
    public required string RefinedTranscript { get; set; }
    public required string EditedText { get; set; }
    public required string OutputMode { get; set; }
    public required string ProviderId { get; set; }
    public required long DurationMs { get; set; }
    public required int Version { get; set; }
    public required string LastIdempotencyKey { get; set; }
    public required bool IsDeleted { get; set; }
    public DateTimeOffset? DeletedAtUtc { get; set; }
    public required DateTimeOffset CreatedAtUtc { get; set; }
    public required DateTimeOffset UpdatedAtUtc { get; set; }
}

public sealed class NoteEntity
{
    public required string Id { get; set; }
    public required string UserId { get; set; }
    public required string DeviceId { get; set; }
    public required string Title { get; set; }
    public required string Content { get; set; }
    public required string Folder { get; set; }
    public required string TagsJson { get; set; }
    public string? SourceTranscriptId { get; set; }
    public required int Version { get; set; }
    public required string LastIdempotencyKey { get; set; }
    public required bool IsDeleted { get; set; }
    public DateTimeOffset? DeletedAtUtc { get; set; }
    public required DateTimeOffset CreatedAtUtc { get; set; }
    public required DateTimeOffset UpdatedAtUtc { get; set; }
}

public sealed class PromptTemplateEntity
{
    public required string Id { get; set; }
    public required string UserId { get; set; }
    public required string Name { get; set; }
    public required string SystemInstructions { get; set; }
    public required string OutputMode { get; set; }
    public required int Version { get; set; }
    public required DateTimeOffset UpdatedAtUtc { get; set; }
}

public sealed class ProcessingPreferenceEntity
{
    public required string UserId { get; set; }
    public required string DefaultOutputMode { get; set; }
    public required string DefaultLanguage { get; set; }
    public required string PreferredSpeechMode { get; set; }
    public required string PreferredRefinementMode { get; set; }
    public required bool AutoCopyToClipboard { get; set; }
    public required bool SyncEnabled { get; set; }
    public required int Version { get; set; }
    public required DateTimeOffset UpdatedAtUtc { get; set; }
}

public sealed class VocabularyEntryEntity
{
    public required string Id { get; set; }
    public required string UserId { get; set; }
    public required string SpokenPhrase { get; set; }
    public required string ReplacementTerm { get; set; }
    public required string Category { get; set; }
    public required DateTimeOffset UpdatedAtUtc { get; set; }
}
