using System.Security.Claims;
using System.Text.Json;
using FlowPilot.Api.Contracts.V1;
using FlowPilot.Api.Data;
using FlowPilot.Api.Data.Entities;
using FlowPilot.Api.Security;
using Microsoft.EntityFrameworkCore;

namespace FlowPilot.Api.Endpoints;

public static class AccountAndSyncEndpoints
{
    public static void MapAccountAndSyncEndpoints(this RouteGroupBuilder v1)
    {
        // --- Authentication Endpoints ---
        v1.MapPost("/auth/register", async (
                RegisterRequestV1 request,
                FlowPilotDbContext db,
                FlowPilotTokenService tokenService,
                CancellationToken ct) =>
            {
                var email = request.Email?.Trim().ToLowerInvariant() ?? string.Empty;
                var password = request.Password ?? string.Empty;
                var displayName = request.DisplayName?.Trim() ?? string.Empty;

                if (string.IsNullOrWhiteSpace(email) || !email.Contains('@'))
                {
                    return Results.BadRequest(new ApiErrorResponseV1(
                        "VALIDATION_FAILED",
                        "A valid email address is required.",
                        true));
                }

                if (password.Length < 8)
                {
                    return Results.BadRequest(new ApiErrorResponseV1(
                        "VALIDATION_FAILED",
                        "Password must be at least 8 characters long.",
                        true));
                }

                if (string.IsNullOrWhiteSpace(displayName))
                {
                    displayName = email.Split('@')[0];
                }

                var exists = await db.Users.AnyAsync(u => u.Email == email, ct);
                if (exists)
                {
                    return Results.Conflict(new ApiErrorResponseV1(
                        "EMAIL_ALREADY_EXISTS",
                        "An account with this email address already exists.",
                        true));
                }

                var user = new UserEntity
                {
                    Id = Guid.NewGuid().ToString("N"),
                    Email = email,
                    DisplayName = displayName,
                    PasswordHash = string.Empty,
                    CreatedAtUtc = DateTimeOffset.UtcNow,
                };
                user.PasswordHash = tokenService.HashPassword(user, password);

                db.Users.Add(user);
                await db.SaveChangesAsync(ct);

                var (token, expiresAt) = tokenService.IssueToken(user);
                return Results.Ok(new AuthSessionResponseV1(
                    AccessToken: token,
                    ExpiresAtUtc: expiresAt.ToString("O"),
                    User: new UserProfileV1(user.Id, user.Email, user.DisplayName),
                    ContractVersion: ContractVersions.V1));
            })
            .WithTags("Auth");

        v1.MapPost("/auth/login", async (
                LoginRequestV1 request,
                FlowPilotDbContext db,
                FlowPilotTokenService tokenService,
                CancellationToken ct) =>
            {
                var email = request.Email?.Trim().ToLowerInvariant() ?? string.Empty;
                var password = request.Password ?? string.Empty;

                var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email, ct);
                if (user is null || !tokenService.VerifyPassword(user, user.PasswordHash, password))
                {
                    return Results.Json(
                        new ApiErrorResponseV1(
                            "AUTH_FAILED",
                            "Invalid email or password.",
                            true),
                        statusCode: StatusCodes.Status401Unauthorized);
                }

                var (token, expiresAt) = tokenService.IssueToken(user);
                return Results.Ok(new AuthSessionResponseV1(
                    AccessToken: token,
                    ExpiresAtUtc: expiresAt.ToString("O"),
                    User: new UserProfileV1(user.Id, user.Email, user.DisplayName),
                    ContractVersion: ContractVersions.V1));
            })
            .WithTags("Auth");

        v1.MapPost("/auth/logout", (
                ClaimsPrincipal principal,
                FlowPilotTokenService tokenService) =>
            {
                var rawToken = principal.FindFirstValue("raw_token");
                if (!string.IsNullOrWhiteSpace(rawToken))
                {
                    tokenService.RevokeToken(rawToken);
                }
                return Results.Ok(new { loggedOut = true });
            })
            .RequireAuthorization()
            .WithTags("Auth");

        v1.MapGet("/auth/me", (ClaimsPrincipal principal) =>
            {
                var userId = GetRequiredUserId(principal);
                var email = principal.FindFirstValue(ClaimTypes.Email) ?? string.Empty;
                var displayName = principal.FindFirstValue(ClaimTypes.Name) ?? string.Empty;
                return Results.Ok(new UserProfileV1(userId, email, displayName));
            })
            .RequireAuthorization()
            .WithTags("Auth");

        // --- Devices Endpoints ---
        v1.MapGet("/devices", async (
                ClaimsPrincipal principal,
                FlowPilotDbContext db,
                CancellationToken ct) =>
            {
                var userId = GetRequiredUserId(principal);
                var devices = await db.Devices
                    .Where(d => d.UserId == userId)
                    .OrderByDescending(d => d.LastSeenAtUtc)
                    .Select(d => new DeviceRecordV1(
                        d.Id,
                        d.UserId,
                        d.DeviceName,
                        d.Platform,
                        d.LastSeenAtUtc.ToString("O")))
                    .ToListAsync(ct);

                return Results.Ok(devices);
            })
            .RequireAuthorization()
            .WithTags("Devices");

        v1.MapPost("/devices", async (
                RegisterDeviceRequestV1 request,
                ClaimsPrincipal principal,
                FlowPilotDbContext db,
                CancellationToken ct) =>
            {
                var userId = GetRequiredUserId(principal);
                if (string.IsNullOrWhiteSpace(request.Id) || string.IsNullOrWhiteSpace(request.DeviceName))
                {
                    return Results.BadRequest(new ApiErrorResponseV1(
                        "VALIDATION_FAILED",
                        "Device Id and DeviceName are required.",
                        true));
                }

                var now = DateTimeOffset.UtcNow;
                var existing = await db.Devices.FirstOrDefaultAsync(
                    d => d.UserId == userId && d.Id == request.Id,
                    ct);

                if (existing is null)
                {
                    existing = new DeviceEntity
                    {
                        Id = request.Id.Trim(),
                        UserId = userId,
                        DeviceName = request.DeviceName.Trim(),
                        Platform = string.IsNullOrWhiteSpace(request.Platform) ? "unknown" : request.Platform.Trim(),
                        LastSeenAtUtc = now,
                    };
                    db.Devices.Add(existing);
                }
                else
                {
                    existing.DeviceName = request.DeviceName.Trim();
                    existing.Platform = string.IsNullOrWhiteSpace(request.Platform)
                        ? existing.Platform
                        : request.Platform.Trim();
                    existing.LastSeenAtUtc = now;
                }

                await db.SaveChangesAsync(ct);

                return Results.Ok(new DeviceRecordV1(
                    existing.Id,
                    existing.UserId,
                    existing.DeviceName,
                    existing.Platform,
                    existing.LastSeenAtUtc.ToString("O")));
            })
            .RequireAuthorization()
            .WithTags("Devices");

        // --- Transcripts Endpoints (Paginated, Searchable, Versioned, Deliberate Deletion) ---
        v1.MapGet("/transcripts", async (
                int? page,
                int? pageSize,
                string? search,
                bool? includeDeleted,
                ClaimsPrincipal principal,
                FlowPilotDbContext db,
                CancellationToken ct) =>
            {
                var userId = GetRequiredUserId(principal);
                var safePage = Math.Max(1, page ?? 1);
                var safePageSize = Math.Clamp(pageSize ?? 20, 1, 100);
                var showDeleted = includeDeleted ?? false;

                var query = db.Transcripts.Where(t => t.UserId == userId);
                if (!showDeleted)
                {
                    query = query.Where(t => !t.IsDeleted);
                }

                if (!string.IsNullOrWhiteSpace(search))
                {
                    var pattern = search.Trim().ToLowerInvariant();
                    query = query.Where(t =>
                        t.OriginalTranscript.ToLower().Contains(pattern) ||
                        t.RefinedTranscript.ToLower().Contains(pattern) ||
                        t.EditedText.ToLower().Contains(pattern) ||
                        t.OutputMode.ToLower().Contains(pattern));
                }

                var totalCount = await query.CountAsync(ct);
                var entities = await query
                    .OrderByDescending(t => t.UpdatedAtUtc)
                    .Skip((safePage - 1) * safePageSize)
                    .Take(safePageSize)
                    .ToListAsync(ct);

                var items = entities.Select(ToTranscriptContract).ToList();
                return Results.Ok(new PaginatedListResponseV1<TranscriptRecordV1>(
                    items,
                    safePage,
                    safePageSize,
                    totalCount,
                    ContractVersions.V1));
            })
            .RequireAuthorization()
            .WithTags("Transcripts");

        v1.MapPut("/transcripts/{id}", async (
                string id,
                UpsertTranscriptRequestV1 request,
                ClaimsPrincipal principal,
                FlowPilotDbContext db,
                CancellationToken ct) =>
            {
                var userId = GetRequiredUserId(principal);
                if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(request.EditedText))
                {
                    return Results.BadRequest(new ApiErrorResponseV1(
                        "VALIDATION_FAILED",
                        "Transcript Id and EditedText are required.",
                        true));
                }

                var existing = await db.Transcripts.FirstOrDefaultAsync(t => t.Id == id, ct);
                if (existing is not null && existing.UserId != userId)
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }

                // Idempotent replay check
                if (existing is not null &&
                    !string.IsNullOrWhiteSpace(request.IdempotencyKey) &&
                    existing.LastIdempotencyKey == request.IdempotencyKey)
                {
                    return Results.Ok(ToTranscriptContract(existing));
                }

                // Optimistic concurrency check: never silently overwrite conflicting edits
                var currentVersion = existing?.Version ?? 0;
                if (request.ExpectedVersion != currentVersion)
                {
                    if (existing is not null)
                    {
                        return Results.Conflict(new SyncConflictResponseV1<TranscriptRecordV1>(
                            Code: "VERSION_CONFLICT",
                            Message: "Transcript was modified on another device. Resolve the conflict before syncing.",
                            ServerVersion: existing.Version,
                            ExpectedVersion: request.ExpectedVersion,
                            ServerRecord: ToTranscriptContract(existing)));
                    }
                }

                var now = DateTimeOffset.UtcNow;
                if (existing is null)
                {
                    existing = new TranscriptEntity
                    {
                        Id = id,
                        UserId = userId,
                        DeviceId = string.IsNullOrWhiteSpace(request.DeviceId) ? "unknown" : request.DeviceId,
                        OriginalTranscript = request.OriginalTranscript ?? string.Empty,
                        RefinedTranscript = request.RefinedTranscript ?? string.Empty,
                        EditedText = request.EditedText,
                        OutputMode = string.IsNullOrWhiteSpace(request.OutputMode) ? "clean" : request.OutputMode,
                        ProviderId = string.IsNullOrWhiteSpace(request.ProviderId) ? "unknown" : request.ProviderId,
                        DurationMs = Math.Max(0, request.DurationMs),
                        Version = 1,
                        LastIdempotencyKey = request.IdempotencyKey ?? Guid.NewGuid().ToString("N"),
                        IsDeleted = false,
                        DeletedAtUtc = null,
                        CreatedAtUtc = now,
                        UpdatedAtUtc = now,
                    };
                    db.Transcripts.Add(existing);
                }
                else
                {
                    existing.DeviceId = string.IsNullOrWhiteSpace(request.DeviceId)
                        ? existing.DeviceId
                        : request.DeviceId;
                    existing.OriginalTranscript = request.OriginalTranscript ?? existing.OriginalTranscript;
                    existing.RefinedTranscript = request.RefinedTranscript ?? existing.RefinedTranscript;
                    existing.EditedText = request.EditedText;
                    existing.OutputMode = string.IsNullOrWhiteSpace(request.OutputMode)
                        ? existing.OutputMode
                        : request.OutputMode;
                    existing.ProviderId = string.IsNullOrWhiteSpace(request.ProviderId)
                        ? existing.ProviderId
                        : request.ProviderId;
                    existing.DurationMs = Math.Max(0, request.DurationMs);
                    existing.Version += 1;
                    existing.LastIdempotencyKey = request.IdempotencyKey ?? Guid.NewGuid().ToString("N");
                    existing.IsDeleted = false;
                    existing.DeletedAtUtc = null;
                    existing.UpdatedAtUtc = now;
                }

                await db.SaveChangesAsync(ct);
                return Results.Ok(ToTranscriptContract(existing));
            })
            .RequireAuthorization()
            .WithTags("Transcripts");

        v1.MapDelete("/transcripts/{id}", async (
                string id,
                bool? permanent,
                ClaimsPrincipal principal,
                FlowPilotDbContext db,
                CancellationToken ct) =>
            {
                var userId = GetRequiredUserId(principal);
                var existing = await db.Transcripts.FirstOrDefaultAsync(
                    t => t.Id == id && t.UserId == userId,
                    ct);

                if (existing is null)
                {
                    return Results.NotFound(new ApiErrorResponseV1(
                        "NOT_FOUND",
                        "Transcript not found.",
                        false));
                }

                if (permanent == true)
                {
                    db.Transcripts.Remove(existing);
                }
                else
                {
                    existing.IsDeleted = true;
                    existing.DeletedAtUtc = DateTimeOffset.UtcNow;
                    existing.UpdatedAtUtc = DateTimeOffset.UtcNow;
                    existing.Version += 1;
                }

                await db.SaveChangesAsync(ct);
                return Results.Ok(new { id, deleted = true, permanent = permanent == true });
            })
            .RequireAuthorization()
            .WithTags("Transcripts");

        // --- Notes Endpoints (Paginated, Searchable, Versioned, Deliberate Deletion) ---
        v1.MapGet("/notes", async (
                int? page,
                int? pageSize,
                string? search,
                string? folder,
                bool? includeDeleted,
                ClaimsPrincipal principal,
                FlowPilotDbContext db,
                CancellationToken ct) =>
            {
                var userId = GetRequiredUserId(principal);
                var safePage = Math.Max(1, page ?? 1);
                var safePageSize = Math.Clamp(pageSize ?? 20, 1, 100);
                var showDeleted = includeDeleted ?? false;

                var query = db.Notes.Where(n => n.UserId == userId);
                if (!showDeleted)
                {
                    query = query.Where(n => !n.IsDeleted);
                }

                if (!string.IsNullOrWhiteSpace(folder))
                {
                    var folderNorm = folder.Trim().ToLowerInvariant();
                    query = query.Where(n => n.Folder.ToLower() == folderNorm);
                }

                if (!string.IsNullOrWhiteSpace(search))
                {
                    var pattern = search.Trim().ToLowerInvariant();
                    query = query.Where(n =>
                        n.Title.ToLower().Contains(pattern) ||
                        n.Content.ToLower().Contains(pattern) ||
                        n.Folder.ToLower().Contains(pattern));
                }

                var totalCount = await query.CountAsync(ct);
                var entities = await query
                    .OrderByDescending(n => n.UpdatedAtUtc)
                    .Skip((safePage - 1) * safePageSize)
                    .Take(safePageSize)
                    .ToListAsync(ct);

                var items = entities.Select(ToNoteContract).ToList();
                return Results.Ok(new PaginatedListResponseV1<NoteRecordV1>(
                    items,
                    safePage,
                    safePageSize,
                    totalCount,
                    ContractVersions.V1));
            })
            .RequireAuthorization()
            .WithTags("Notes");

        v1.MapPut("/notes/{id}", async (
                string id,
                UpsertNoteRequestV1 request,
                ClaimsPrincipal principal,
                FlowPilotDbContext db,
                CancellationToken ct) =>
            {
                var userId = GetRequiredUserId(principal);
                if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(request.Title))
                {
                    return Results.BadRequest(new ApiErrorResponseV1(
                        "VALIDATION_FAILED",
                        "Note Id and Title are required.",
                        true));
                }

                var existing = await db.Notes.FirstOrDefaultAsync(n => n.Id == id, ct);
                if (existing is not null && existing.UserId != userId)
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }

                if (existing is not null &&
                    !string.IsNullOrWhiteSpace(request.IdempotencyKey) &&
                    existing.LastIdempotencyKey == request.IdempotencyKey)
                {
                    return Results.Ok(ToNoteContract(existing));
                }

                var currentVersion = existing?.Version ?? 0;
                if (request.ExpectedVersion != currentVersion && existing is not null)
                {
                    return Results.Conflict(new SyncConflictResponseV1<NoteRecordV1>(
                        Code: "VERSION_CONFLICT",
                        Message: "Note was modified on another device. Resolve the conflict before syncing.",
                        ServerVersion: existing.Version,
                        ExpectedVersion: request.ExpectedVersion,
                        ServerRecord: ToNoteContract(existing)));
                }

                var now = DateTimeOffset.UtcNow;
                var serializedTags = JsonSerializer.Serialize(request.Tags ?? []);

                if (existing is null)
                {
                    existing = new NoteEntity
                    {
                        Id = id,
                        UserId = userId,
                        DeviceId = string.IsNullOrWhiteSpace(request.DeviceId) ? "web" : request.DeviceId,
                        Title = request.Title.Trim(),
                        Content = request.Content ?? string.Empty,
                        Folder = string.IsNullOrWhiteSpace(request.Folder) ? "General" : request.Folder.Trim(),
                        TagsJson = serializedTags,
                        SourceTranscriptId = request.SourceTranscriptId,
                        Version = 1,
                        LastIdempotencyKey = request.IdempotencyKey ?? Guid.NewGuid().ToString("N"),
                        IsDeleted = false,
                        DeletedAtUtc = null,
                        CreatedAtUtc = now,
                        UpdatedAtUtc = now,
                    };
                    db.Notes.Add(existing);
                }
                else
                {
                    existing.DeviceId = string.IsNullOrWhiteSpace(request.DeviceId)
                        ? existing.DeviceId
                        : request.DeviceId;
                    existing.Title = request.Title.Trim();
                    existing.Content = request.Content ?? string.Empty;
                    existing.Folder = string.IsNullOrWhiteSpace(request.Folder)
                        ? existing.Folder
                        : request.Folder.Trim();
                    existing.TagsJson = serializedTags;
                    existing.SourceTranscriptId = request.SourceTranscriptId ?? existing.SourceTranscriptId;
                    existing.Version += 1;
                    existing.LastIdempotencyKey = request.IdempotencyKey ?? Guid.NewGuid().ToString("N");
                    existing.IsDeleted = false;
                    existing.DeletedAtUtc = null;
                    existing.UpdatedAtUtc = now;
                }

                await db.SaveChangesAsync(ct);
                return Results.Ok(ToNoteContract(existing));
            })
            .RequireAuthorization()
            .WithTags("Notes");

        v1.MapDelete("/notes/{id}", async (
                string id,
                bool? permanent,
                ClaimsPrincipal principal,
                FlowPilotDbContext db,
                CancellationToken ct) =>
            {
                var userId = GetRequiredUserId(principal);
                var existing = await db.Notes.FirstOrDefaultAsync(
                    n => n.Id == id && n.UserId == userId,
                    ct);

                if (existing is null)
                {
                    return Results.NotFound(new ApiErrorResponseV1(
                        "NOT_FOUND",
                        "Note not found.",
                        false));
                }

                if (permanent == true)
                {
                    db.Notes.Remove(existing);
                }
                else
                {
                    existing.IsDeleted = true;
                    existing.DeletedAtUtc = DateTimeOffset.UtcNow;
                    existing.UpdatedAtUtc = DateTimeOffset.UtcNow;
                    existing.Version += 1;
                }

                await db.SaveChangesAsync(ct);
                return Results.Ok(new { id, deleted = true, permanent = permanent == true });
            })
            .RequireAuthorization()
            .WithTags("Notes");

        // --- Prompt Templates Endpoints ---
        v1.MapGet("/prompt-templates", async (
                ClaimsPrincipal principal,
                FlowPilotDbContext db,
                CancellationToken ct) =>
            {
                var userId = GetRequiredUserId(principal);
                var templates = await db.PromptTemplates
                    .Where(t => t.UserId == userId)
                    .OrderBy(t => t.Name)
                    .Select(t => new PromptTemplateRecordV1(
                        t.Id,
                        t.UserId,
                        t.Name,
                        t.SystemInstructions,
                        t.OutputMode,
                        t.Version,
                        t.UpdatedAtUtc.ToString("O")))
                    .ToListAsync(ct);

                return Results.Ok(templates);
            })
            .RequireAuthorization()
            .WithTags("Templates");

        v1.MapPut("/prompt-templates/{id}", async (
                string id,
                UpsertPromptTemplateRequestV1 request,
                ClaimsPrincipal principal,
                FlowPilotDbContext db,
                CancellationToken ct) =>
            {
                var userId = GetRequiredUserId(principal);
                if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(request.Name))
                {
                    return Results.BadRequest(new ApiErrorResponseV1(
                        "VALIDATION_FAILED",
                        "Template Id and Name are required.",
                        true));
                }

                var now = DateTimeOffset.UtcNow;
                var existing = await db.PromptTemplates.FirstOrDefaultAsync(
                    t => t.UserId == userId && t.Id == id,
                    ct);

                if (existing is null)
                {
                    existing = new PromptTemplateEntity
                    {
                        Id = id,
                        UserId = userId,
                        Name = request.Name.Trim(),
                        SystemInstructions = request.SystemInstructions ?? string.Empty,
                        OutputMode = string.IsNullOrWhiteSpace(request.OutputMode) ? "clean" : request.OutputMode,
                        Version = 1,
                        UpdatedAtUtc = now,
                    };
                    db.PromptTemplates.Add(existing);
                }
                else
                {
                    existing.Name = request.Name.Trim();
                    existing.SystemInstructions = request.SystemInstructions ?? string.Empty;
                    existing.OutputMode = string.IsNullOrWhiteSpace(request.OutputMode)
                        ? existing.OutputMode
                        : request.OutputMode;
                    existing.Version += 1;
                    existing.UpdatedAtUtc = now;
                }

                await db.SaveChangesAsync(ct);
                return Results.Ok(new PromptTemplateRecordV1(
                    existing.Id,
                    existing.UserId,
                    existing.Name,
                    existing.SystemInstructions,
                    existing.OutputMode,
                    existing.Version,
                    existing.UpdatedAtUtc.ToString("O")));
            })
            .RequireAuthorization()
            .WithTags("Templates");

        v1.MapDelete("/prompt-templates/{id}", async (
                string id,
                ClaimsPrincipal principal,
                FlowPilotDbContext db,
                CancellationToken ct) =>
            {
                var userId = GetRequiredUserId(principal);
                var existing = await db.PromptTemplates.FirstOrDefaultAsync(
                    t => t.UserId == userId && t.Id == id,
                    ct);

                if (existing is null)
                {
                    return Results.NotFound();
                }

                db.PromptTemplates.Remove(existing);
                await db.SaveChangesAsync(ct);
                return Results.Ok(new { id, deleted = true });
            })
            .RequireAuthorization()
            .WithTags("Templates");

        // --- Processing Preferences Endpoints ---
        v1.MapGet("/preferences", async (
                ClaimsPrincipal principal,
                FlowPilotDbContext db,
                CancellationToken ct) =>
            {
                var userId = GetRequiredUserId(principal);
                var prefs = await db.ProcessingPreferences.FirstOrDefaultAsync(
                    p => p.UserId == userId,
                    ct);

                if (prefs is null)
                {
                    prefs = new ProcessingPreferenceEntity
                    {
                        UserId = userId,
                        DefaultOutputMode = "clean",
                        DefaultLanguage = "auto",
                        PreferredSpeechMode = "local",
                        PreferredRefinementMode = "local",
                        AutoCopyToClipboard = false,
                        SyncEnabled = false,
                        Version = 1,
                        UpdatedAtUtc = DateTimeOffset.UtcNow,
                    };
                    db.ProcessingPreferences.Add(prefs);
                    await db.SaveChangesAsync(ct);
                }

                return Results.Ok(ToPreferencesContract(prefs));
            })
            .RequireAuthorization()
            .WithTags("Preferences");

        v1.MapPut("/preferences", async (
                UpdateProcessingPreferencesRequestV1 request,
                ClaimsPrincipal principal,
                FlowPilotDbContext db,
                CancellationToken ct) =>
            {
                var userId = GetRequiredUserId(principal);
                var prefs = await db.ProcessingPreferences.FirstOrDefaultAsync(
                    p => p.UserId == userId,
                    ct);

                var now = DateTimeOffset.UtcNow;
                if (prefs is null)
                {
                    prefs = new ProcessingPreferenceEntity
                    {
                        UserId = userId,
                        DefaultOutputMode = string.IsNullOrWhiteSpace(request.DefaultOutputMode)
                            ? "clean"
                            : request.DefaultOutputMode,
                        DefaultLanguage = string.IsNullOrWhiteSpace(request.DefaultLanguage)
                            ? "auto"
                            : request.DefaultLanguage,
                        PreferredSpeechMode = string.IsNullOrWhiteSpace(request.PreferredSpeechMode)
                            ? "local"
                            : request.PreferredSpeechMode,
                        PreferredRefinementMode = string.IsNullOrWhiteSpace(request.PreferredRefinementMode)
                            ? "local"
                            : request.PreferredRefinementMode,
                        AutoCopyToClipboard = request.AutoCopyToClipboard,
                        SyncEnabled = request.SyncEnabled,
                        Version = 1,
                        UpdatedAtUtc = now,
                    };
                    db.ProcessingPreferences.Add(prefs);
                }
                else
                {
                    prefs.DefaultOutputMode = string.IsNullOrWhiteSpace(request.DefaultOutputMode)
                        ? prefs.DefaultOutputMode
                        : request.DefaultOutputMode;
                    prefs.DefaultLanguage = string.IsNullOrWhiteSpace(request.DefaultLanguage)
                        ? prefs.DefaultLanguage
                        : request.DefaultLanguage;
                    prefs.PreferredSpeechMode = string.IsNullOrWhiteSpace(request.PreferredSpeechMode)
                        ? prefs.PreferredSpeechMode
                        : request.PreferredSpeechMode;
                    prefs.PreferredRefinementMode = string.IsNullOrWhiteSpace(request.PreferredRefinementMode)
                        ? prefs.PreferredRefinementMode
                        : request.PreferredRefinementMode;
                    prefs.AutoCopyToClipboard = request.AutoCopyToClipboard;
                    prefs.SyncEnabled = request.SyncEnabled;
                    prefs.Version += 1;
                    prefs.UpdatedAtUtc = now;
                }

                await db.SaveChangesAsync(ct);
                return Results.Ok(ToPreferencesContract(prefs));
            })
            .RequireAuthorization()
            .WithTags("Preferences");
    }

    private static string GetRequiredUserId(ClaimsPrincipal principal)
    {
        return principal.FindFirstValue(ClaimTypes.NameIdentifier)
               ?? throw new InvalidOperationException("Authenticated principal is missing NameIdentifier claim.");
    }

    private static TranscriptRecordV1 ToTranscriptContract(TranscriptEntity entity)
    {
        return new TranscriptRecordV1(
            Id: entity.Id,
            UserId: entity.UserId,
            DeviceId: entity.DeviceId,
            OriginalTranscript: entity.OriginalTranscript,
            RefinedTranscript: entity.RefinedTranscript,
            EditedText: entity.EditedText,
            OutputMode: entity.OutputMode,
            ProviderId: entity.ProviderId,
            DurationMs: entity.DurationMs,
            Version: entity.Version,
            IsDeleted: entity.IsDeleted,
            DeletedAtUtc: entity.DeletedAtUtc?.ToString("O"),
            CreatedAtUtc: entity.CreatedAtUtc.ToString("O"),
            UpdatedAtUtc: entity.UpdatedAtUtc.ToString("O"));
    }

    private static NoteRecordV1 ToNoteContract(NoteEntity entity)
    {
        string[] tags;
        try
        {
            tags = JsonSerializer.Deserialize<string[]>(entity.TagsJson) ?? [];
        }
        catch
        {
            tags = [];
        }

        return new NoteRecordV1(
            Id: entity.Id,
            UserId: entity.UserId,
            DeviceId: entity.DeviceId,
            Title: entity.Title,
            Content: entity.Content,
            Folder: entity.Folder,
            Tags: tags,
            SourceTranscriptId: entity.SourceTranscriptId,
            Version: entity.Version,
            IsDeleted: entity.IsDeleted,
            DeletedAtUtc: entity.DeletedAtUtc?.ToString("O"),
            CreatedAtUtc: entity.CreatedAtUtc.ToString("O"),
            UpdatedAtUtc: entity.UpdatedAtUtc.ToString("O"));
    }

    private static ProcessingPreferencesRecordV1 ToPreferencesContract(ProcessingPreferenceEntity entity)
    {
        return new ProcessingPreferencesRecordV1(
            UserId: entity.UserId,
            DefaultOutputMode: entity.DefaultOutputMode,
            DefaultLanguage: entity.DefaultLanguage,
            PreferredSpeechMode: entity.PreferredSpeechMode,
            PreferredRefinementMode: entity.PreferredRefinementMode,
            AutoCopyToClipboard: entity.AutoCopyToClipboard,
            SyncEnabled: entity.SyncEnabled,
            Version: entity.Version,
            UpdatedAtUtc: entity.UpdatedAtUtc.ToString("O"));
    }
}
