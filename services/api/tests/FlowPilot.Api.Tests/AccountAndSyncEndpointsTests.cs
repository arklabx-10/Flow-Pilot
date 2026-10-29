using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FlowPilot.Api.Contracts.V1;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace FlowPilot.Api.Tests;

public sealed class AccountAndSyncEndpointsTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private WebApplicationFactory<Program> CreateIsolatedFactory(string dbName)
    {
        return factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Database:UseInMemory"] = "true",
                    ["Database:InMemoryName"] = dbName,
                });
            });
        });
    }

    [Fact]
    public async Task ProtectedEndpoints_WithoutBearerToken_Return401Unauthorized()
    {
        await using var appFactory = CreateIsolatedFactory(Guid.NewGuid().ToString());
        using var client = appFactory.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/transcripts")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/notes")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/devices")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/prompt-templates")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/preferences")).StatusCode);
    }

    [Fact]
    public async Task AuthFlow_RegisterLoginMeAndLogout_RevokesSessionToken()
    {
        await using var appFactory = CreateIsolatedFactory(Guid.NewGuid().ToString());
        using var client = appFactory.CreateClient();

        var registerResponse = await client.PostAsJsonAsync(
            "/api/v1/auth/register",
            new RegisterRequestV1("alice@example.com", "StrongPass!123", "Alice Pilot"));

        Assert.Equal(HttpStatusCode.OK, registerResponse.StatusCode);
        var session = await registerResponse.Content.ReadFromJsonAsync<AuthSessionResponseV1>();
        Assert.NotNull(session);
        Assert.Equal("alice@example.com", session.User.Email);

        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", session.AccessToken);

        var meResponse = await client.GetAsync("/api/v1/auth/me");
        Assert.Equal(HttpStatusCode.OK, meResponse.StatusCode);

        var logoutResponse = await client.PostAsync("/api/v1/auth/logout", null);
        Assert.Equal(HttpStatusCode.OK, logoutResponse.StatusCode);

        // Token is revoked after logout
        var afterLogoutResponse = await client.GetAsync("/api/v1/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, afterLogoutResponse.StatusCode);

        // Login issues a fresh valid token
        var loginResponse = await client.PostAsJsonAsync(
            "/api/v1/auth/login",
            new LoginRequestV1("alice@example.com", "StrongPass!123"));
        Assert.Equal(HttpStatusCode.OK, loginResponse.StatusCode);
    }

    [Fact]
    public async Task CrossUserIsolation_PreventsAccessingOrMutatingAnotherUsersRecords()
    {
        await using var appFactory = CreateIsolatedFactory(Guid.NewGuid().ToString());
        using var clientA = appFactory.CreateClient();
        using var clientB = appFactory.CreateClient();

        var sessionA = await (await clientA.PostAsJsonAsync(
                "/api/v1/auth/register",
                new RegisterRequestV1("usera@example.com", "PasswordA!123", "User A")))
            .Content.ReadFromJsonAsync<AuthSessionResponseV1>();

        var sessionB = await (await clientB.PostAsJsonAsync(
                "/api/v1/auth/register",
                new RegisterRequestV1("userb@example.com", "PasswordB!123", "User B")))
            .Content.ReadFromJsonAsync<AuthSessionResponseV1>();

        clientA.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", sessionA!.AccessToken);
        clientB.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", sessionB!.AccessToken);

        // User A creates a transcript and a note
        var createTranscriptResp = await clientA.PutAsJsonAsync(
            "/api/v1/transcripts/tr-shared-id",
            new UpsertTranscriptRequestV1(
                IdempotencyKey: "idem-a1",
                ExpectedVersion: 0,
                DeviceId: "desktop-a",
                OriginalTranscript: "user A private transcript",
                RefinedTranscript: "User A private transcript.",
                EditedText: "User A private transcript.",
                OutputMode: "clean",
                ProviderId: "local-whisper-cpp",
                DurationMs: 1500,
                ClientUpdatedAtUtc: "2026-10-21T19:00:00Z"));
        Assert.Equal(HttpStatusCode.OK, createTranscriptResp.StatusCode);

        var createNoteResp = await clientA.PutAsJsonAsync(
            "/api/v1/notes/note-shared-id",
            new UpsertNoteRequestV1(
                IdempotencyKey: "idem-note-a1",
                ExpectedVersion: 0,
                DeviceId: "web-a",
                Title: "User A Secret Note",
                Content: "Confidential architecture notes",
                Folder: "Architecture",
                Tags: ["secret"],
                SourceTranscriptId: "tr-shared-id",
                ClientUpdatedAtUtc: "2026-10-21T19:05:00Z"));
        Assert.Equal(HttpStatusCode.OK, createNoteResp.StatusCode);

        // User B cannot see User A's transcripts or notes
        var listBTranscripts = await clientB.GetFromJsonAsync<PaginatedListResponseV1<TranscriptRecordV1>>(
            "/api/v1/transcripts");
        Assert.NotNull(listBTranscripts);
        Assert.Empty(listBTranscripts.Items);

        var listBNotes = await clientB.GetFromJsonAsync<PaginatedListResponseV1<NoteRecordV1>>(
            "/api/v1/notes");
        Assert.NotNull(listBNotes);
        Assert.Empty(listBNotes.Items);

        // User B cannot overwrite or delete User A's records
        var hijackAttempt = await clientB.PutAsJsonAsync(
            "/api/v1/transcripts/tr-shared-id",
            new UpsertTranscriptRequestV1(
                IdempotencyKey: "idem-b1",
                ExpectedVersion: 1,
                DeviceId: "desktop-b",
                OriginalTranscript: "hijacked",
                RefinedTranscript: "Hijacked.",
                EditedText: "Hijacked.",
                OutputMode: "clean",
                ProviderId: "local-whisper-cpp",
                DurationMs: 1000,
                ClientUpdatedAtUtc: "2026-10-21T19:10:00Z"));
        Assert.Equal(HttpStatusCode.Forbidden, hijackAttempt.StatusCode);

        var deleteAttempt = await clientB.DeleteAsync("/api/v1/transcripts/tr-shared-id");
        Assert.Equal(HttpStatusCode.NotFound, deleteAttempt.StatusCode);
    }

    [Fact]
    public async Task TranscriptsAndNotes_SupportIdempotencyConflictDetectionPaginationSearchAndDeliberateDeletion()
    {
        await using var appFactory = CreateIsolatedFactory(Guid.NewGuid().ToString());
        using var client = appFactory.CreateClient();

        var session = await (await client.PostAsJsonAsync(
                "/api/v1/auth/register",
                new RegisterRequestV1("sync@example.com", "SyncPass!123", "Sync Pilot")))
            .Content.ReadFromJsonAsync<AuthSessionResponseV1>();

        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", session!.AccessToken);

        // 1. Create transcript (version 1)
        var upsertReq1 = new UpsertTranscriptRequestV1(
            IdempotencyKey: "idem-tx-1",
            ExpectedVersion: 0,
            DeviceId: "desktop-win",
            OriginalTranscript: "um deploy database migrations tonight",
            RefinedTranscript: "Deploy database migrations tonight.",
            EditedText: "Deploy PostgreSQL migrations tonight.",
            OutputMode: "clean",
            ProviderId: "local-whisper-cpp",
            DurationMs: 2100,
            ClientUpdatedAtUtc: "2026-10-21T19:00:00Z");

        var createResp = await client.PutAsJsonAsync("/api/v1/transcripts/tr-101", upsertReq1);
        Assert.Equal(HttpStatusCode.OK, createResp.StatusCode);
        var created = await createResp.Content.ReadFromJsonAsync<TranscriptRecordV1>();
        Assert.Equal(1, created!.Version);

        // 2. Duplicate delivery with same idempotencyKey returns version 1 without error
        var retryResp = await client.PutAsJsonAsync("/api/v1/transcripts/tr-101", upsertReq1);
        Assert.Equal(HttpStatusCode.OK, retryResp.StatusCode);
        var retried = await retryResp.Content.ReadFromJsonAsync<TranscriptRecordV1>();
        Assert.Equal(1, retried!.Version);

        // 3. Valid update with expectedVersion = 1 increments to version 2
        var updateResp = await client.PutAsJsonAsync(
            "/api/v1/transcripts/tr-101",
            upsertReq1 with
            {
                IdempotencyKey = "idem-tx-2",
                ExpectedVersion = 1,
                EditedText = "Deploy PostgreSQL migrations at 22:00 UTC.",
            });
        Assert.Equal(HttpStatusCode.OK, updateResp.StatusCode);
        var updated = await updateResp.Content.ReadFromJsonAsync<TranscriptRecordV1>();
        Assert.Equal(2, updated!.Version);

        // 4. Stale concurrent edit (expectedVersion = 1 when server is at version 2) returns 409 Conflict
        var conflictResp = await client.PutAsJsonAsync(
            "/api/v1/transcripts/tr-101",
            upsertReq1 with
            {
                IdempotencyKey = "idem-tx-stale",
                ExpectedVersion = 1,
                EditedText = "Conflicting offline edit from another device.",
            });
        Assert.Equal(HttpStatusCode.Conflict, conflictResp.StatusCode);
        var conflictBody = await conflictResp.Content.ReadFromJsonAsync<SyncConflictResponseV1<TranscriptRecordV1>>();
        Assert.NotNull(conflictBody);
        Assert.Equal("VERSION_CONFLICT", conflictBody.Code);
        Assert.Equal(2, conflictBody.ServerVersion);
        Assert.Equal("Deploy PostgreSQL migrations at 22:00 UTC.", conflictBody.ServerRecord.EditedText);

        // 5. Add second transcript and verify pagination + search
        await client.PutAsJsonAsync(
            "/api/v1/transcripts/tr-102",
            upsertReq1 with
            {
                IdempotencyKey = "idem-tx-3",
                ExpectedVersion = 0,
                OriginalTranscript = "prepare sprint demo slides",
                RefinedTranscript = "Prepare sprint demo slides.",
                EditedText = "Prepare sprint demo slides for Friday.",
            });

        var page1 = await client.GetFromJsonAsync<PaginatedListResponseV1<TranscriptRecordV1>>(
            "/api/v1/transcripts?page=1&pageSize=1");
        Assert.Equal(2, page1!.TotalCount);
        Assert.Single(page1.Items);

        var searchPage = await client.GetFromJsonAsync<PaginatedListResponseV1<TranscriptRecordV1>>(
            "/api/v1/transcripts?search=sprint%20demo");
        Assert.Equal(1, searchPage!.TotalCount);
        Assert.Equal("tr-102", searchPage.Items[0].Id);

        // 6. Soft delete vs permanent purge
        var softDelResp = await client.DeleteAsync("/api/v1/transcripts/tr-102?permanent=false");
        Assert.Equal(HttpStatusCode.OK, softDelResp.StatusCode);

        var activeList = await client.GetFromJsonAsync<PaginatedListResponseV1<TranscriptRecordV1>>(
            "/api/v1/transcripts");
        Assert.Equal(1, activeList!.TotalCount);

        var tombstoneList = await client.GetFromJsonAsync<PaginatedListResponseV1<TranscriptRecordV1>>(
            "/api/v1/transcripts?includeDeleted=true");
        Assert.Equal(2, tombstoneList!.TotalCount);
        Assert.Contains(tombstoneList.Items, item => item.Id == "tr-102" && item.IsDeleted);

        var permDelResp = await client.DeleteAsync("/api/v1/transcripts/tr-102?permanent=true");
        Assert.Equal(HttpStatusCode.OK, permDelResp.StatusCode);

        var afterPurgeList = await client.GetFromJsonAsync<PaginatedListResponseV1<TranscriptRecordV1>>(
            "/api/v1/transcripts?includeDeleted=true");
        Assert.Equal(1, afterPurgeList!.TotalCount);
    }

    [Fact]
    public async Task DevicesTemplatesAndPreferences_PersistAndEnforceUserScope()
    {
        await using var appFactory = CreateIsolatedFactory(Guid.NewGuid().ToString());
        using var client = appFactory.CreateClient();

        var session = await (await client.PostAsJsonAsync(
                "/api/v1/auth/register",
                new RegisterRequestV1("prefs@example.com", "PrefsPass!123", "Prefs Pilot")))
            .Content.ReadFromJsonAsync<AuthSessionResponseV1>();

        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", session!.AccessToken);

        // Devices
        var devResp = await client.PostAsJsonAsync(
            "/api/v1/devices",
            new RegisterDeviceRequestV1("dev-win-1", "Surface Laptop Studio", "windows-desktop"));
        Assert.Equal(HttpStatusCode.OK, devResp.StatusCode);

        var devices = await client.GetFromJsonAsync<List<DeviceRecordV1>>("/api/v1/devices");
        Assert.Single(devices!);
        Assert.Equal("Surface Laptop Studio", devices![0].DeviceName);

        // Prompt Templates
        var tplResp = await client.PutAsJsonAsync(
            "/api/v1/prompt-templates/tpl-pr-review",
            new UpsertPromptTemplateRequestV1(
                Name: "PR Review Summary",
                SystemInstructions: "Format as concise PR review bullets.",
                OutputMode: "coding-prompt"));
        Assert.Equal(HttpStatusCode.OK, tplResp.StatusCode);

        var templates = await client.GetFromJsonAsync<List<PromptTemplateRecordV1>>("/api/v1/prompt-templates");
        Assert.Single(templates!);
        Assert.Equal("PR Review Summary", templates![0].Name);

        // Processing Preferences
        var prefsUpdateResp = await client.PutAsJsonAsync(
            "/api/v1/preferences",
            new UpdateProcessingPreferencesRequestV1(
                DefaultOutputMode: "coding-prompt",
                DefaultLanguage: "en",
                PreferredSpeechMode: "local",
                PreferredRefinementMode: "local",
                AutoCopyToClipboard: true,
                SyncEnabled: true));
        Assert.Equal(HttpStatusCode.OK, prefsUpdateResp.StatusCode);

        var prefs = await client.GetFromJsonAsync<ProcessingPreferencesRecordV1>("/api/v1/preferences");
        Assert.NotNull(prefs);
        Assert.Equal("coding-prompt", prefs.DefaultOutputMode);
        Assert.True(prefs.AutoCopyToClipboard);
        Assert.True(prefs.SyncEnabled);

        // Custom Vocabulary
        var vocabResp = await client.PutAsJsonAsync(
            "/api/v1/vocabulary/voc-flowpilot",
            new UpsertVocabularyEntryRequestV1(
                SpokenPhrase: "flow pilot",
                ReplacementTerm: "FlowPilot",
                Category: "Product"));
        Assert.Equal(HttpStatusCode.OK, vocabResp.StatusCode);

        var vocabList = await client.GetFromJsonAsync<List<VocabularyEntryRecordV1>>("/api/v1/vocabulary");
        Assert.Single(vocabList!);
        Assert.Equal("FlowPilot", vocabList![0].ReplacementTerm);

        var delVocabResp = await client.DeleteAsync("/api/v1/vocabulary/voc-flowpilot");
        Assert.Equal(HttpStatusCode.OK, delVocabResp.StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<List<VocabularyEntryRecordV1>>("/api/v1/vocabulary"))!);
    }

    [Fact]
    public async Task Validation_InvalidPayloads_Return400BadRequestWithConsistentErrorShape()
    {
        await using var appFactory = CreateIsolatedFactory(Guid.NewGuid().ToString());
        using var client = appFactory.CreateClient();

        var invalidRegister = await client.PostAsJsonAsync(
            "/api/v1/auth/register",
            new RegisterRequestV1("invalid-email", "short", ""));
        Assert.Equal(HttpStatusCode.BadRequest, invalidRegister.StatusCode);
        var registerError = await invalidRegister.Content.ReadFromJsonAsync<ApiErrorResponseV1>();
        Assert.NotNull(registerError);
        Assert.Equal("VALIDATION_FAILED", registerError.Code);

        var session = await (await client.PostAsJsonAsync(
                "/api/v1/auth/register",
                new RegisterRequestV1("valid@example.com", "ValidPass!123", "Valid Pilot")))
            .Content.ReadFromJsonAsync<AuthSessionResponseV1>();

        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", session!.AccessToken);

        var invalidTranscript = await client.PutAsJsonAsync(
            "/api/v1/transcripts/tr-invalid",
            new UpsertTranscriptRequestV1(
                IdempotencyKey: "",
                ExpectedVersion: 0,
                DeviceId: "dev-1",
                OriginalTranscript: "",
                RefinedTranscript: "",
                EditedText: "",
                OutputMode: "clean",
                ProviderId: "local",
                DurationMs: -1,
                ClientUpdatedAtUtc: ""));
        Assert.Equal(HttpStatusCode.BadRequest, invalidTranscript.StatusCode);

        var invalidNote = await client.PutAsJsonAsync(
            "/api/v1/notes/note-invalid",
            new UpsertNoteRequestV1(
                IdempotencyKey: "idem-1",
                ExpectedVersion: 0,
                DeviceId: "dev-1",
                Title: "",
                Content: "",
                Folder: "General",
                Tags: [],
                SourceTranscriptId: null,
                ClientUpdatedAtUtc: ""));
        Assert.Equal(HttpStatusCode.BadRequest, invalidNote.StatusCode);
    }

    [Fact]
    public async Task TelemetrySummary_AccountDataExport_AndAccountDeletion_WorkAndEnforceIsolation()
    {
        await using var appFactory = CreateIsolatedFactory(Guid.NewGuid().ToString());
        using var client = appFactory.CreateClient();

        var session = await (await client.PostAsJsonAsync(
                "/api/v1/auth/register",
                new RegisterRequestV1("export@example.com", "ExportPass!123", "Export Pilot")))
            .Content.ReadFromJsonAsync<AuthSessionResponseV1>();

        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", session!.AccessToken);

        await client.PutAsJsonAsync(
            "/api/v1/transcripts/tr-exp-1",
            new UpsertTranscriptRequestV1(
                IdempotencyKey: "idem-exp-1",
                ExpectedVersion: 0,
                DeviceId: "win-desktop",
                OriginalTranscript: "one two three four five six",
                RefinedTranscript: "One two three four five six.",
                EditedText: "One two three four five six.",
                OutputMode: "clean",
                ProviderId: "local-whisper-cpp",
                DurationMs: 3200,
                ClientUpdatedAtUtc: DateTimeOffset.UtcNow.ToString("O")));

        await client.PutAsJsonAsync(
            "/api/v1/notes/note-exp-1",
            new UpsertNoteRequestV1(
                IdempotencyKey: "idem-note-exp-1",
                ExpectedVersion: 0,
                DeviceId: "web",
                Title: "Compliance Note",
                Content: "Exportable note body",
                Folder: "Security",
                Tags: ["gdpr", "export"],
                SourceTranscriptId: "tr-exp-1",
                ClientUpdatedAtUtc: DateTimeOffset.UtcNow.ToString("O")));

        var telemetry = await client.GetFromJsonAsync<UsageTelemetrySummaryResponseV1>("/api/v1/telemetry/summary");
        Assert.NotNull(telemetry);
        Assert.Equal(1, telemetry.TotalTranscripts);
        Assert.Equal(1, telemetry.TotalSavedNotes);
        Assert.Equal(3200, telemetry.TotalDurationMs);
        Assert.Equal(6, telemetry.EstimatedWordsDictated);
        Assert.Equal(1, telemetry.ModeBreakdown["clean"]);

        var exported = await client.GetFromJsonAsync<AccountDataExportResponseV1>("/api/v1/account/export");
        Assert.NotNull(exported);
        Assert.Equal("export@example.com", exported.User.Email);
        Assert.Single(exported.Transcripts);
        Assert.Single(exported.Notes);

        var deleteAccountResp = await client.DeleteAsync("/api/v1/account");
        Assert.Equal(HttpStatusCode.OK, deleteAccountResp.StatusCode);

        var postDeleteExportResp = await client.GetAsync("/api/v1/account/export");
        Assert.Equal(HttpStatusCode.NotFound, postDeleteExportResp.StatusCode);
    }
}
