import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  NoteRecordV1,
  PaginatedListResponseV1,
  SyncConflictResponseV1,
  TranscriptRecordV1,
} from '@flowpilot/contracts';
import { LocalDictationHistoryRepository } from '../historyRepository.js';
import {
  DesktopSyncEngine,
  computeBoundedBackoffMs,
  type OfflineSyncQueueItem,
} from '../syncEngine.js';

describe('DesktopSyncEngine — offline queue, retry, conflict detection, and bidirectional sync', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('computes bounded exponential backoff with a strict maximum cap', () => {
    expect(computeBoundedBackoffMs(1, 1000, 30000)).toBe(1000);
    expect(computeBoundedBackoffMs(2, 1000, 30000)).toBe(2000);
    expect(computeBoundedBackoffMs(3, 1000, 30000)).toBe(4000);
    expect(computeBoundedBackoffMs(4, 1000, 30000)).toBe(8000);
    expect(computeBoundedBackoffMs(10, 1000, 30000)).toBe(30000);
  });

  it('does not transmit data when opt-in cloud sync is disabled', async () => {
    const fetchMock = vi.fn();
    const historyRepo = new LocalDictationHistoryRepository({ useTauriWhenAvailable: false });
    const engine = new DesktopSyncEngine({
      historyRepository: historyRepo,
      fetchImpl: fetchMock as unknown as typeof fetch,
      useTauriWhenAvailable: false,
    });

    const entry = await historyRepo.saveEntry({
      originalTranscript: 'local private transcript',
      refinedTranscript: 'Local private transcript.',
      editedText: 'Local private transcript.',
      outputMode: 'clean',
      providerId: 'local-whisper-cpp',
      durationMs: 1400,
    });

    await engine.enqueueTranscriptUpsert(entry);
    const result = await engine.syncNow({ syncEnabled: false });

    expect(result.status).toBe('disabled');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await engine.listQueue()).toHaveLength(1);
  });

  it('queues offline edits, retries with bounded backoff on network loss, reuses idempotencyKey on duplicate delivery, and syncs on reconnection', async () => {
    let networkOnline = false;
    const seenIdempotencyKeys: string[] = [];
    const serverTranscripts: TranscriptRecordV1[] = [];
    const serverNotes: NoteRecordV1[] = [
      {
        id: 'note-web-1',
        title: 'Sprint Retrospective Note from Web',
        content: 'Created in the authenticated web companion.',
        folder: 'Work',
        tags: ['retro', 'web'],
        sourceTranscriptId: null,
        version: 1,
        isDeleted: false,
        createdAtUtc: '2026-10-21T19:00:00Z',
        updatedAtUtc: '2026-10-21T19:00:00Z',
      },
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!networkOnline) {
        throw new TypeError('Failed to fetch: network disconnected');
      }

      const url = String(input);
      const method = init?.method ?? 'GET';

      if (method === 'PUT' && url.includes('/api/v1/transcripts/')) {
        const body = JSON.parse(String(init?.body)) as {
          idempotencyKey: string;
          expectedVersion: number;
          deviceId: string;
          originalTranscript: string;
          refinedTranscript: string;
          editedText: string;
          outputMode: string;
          providerId: string;
          durationMs: number;
          clientUpdatedAtUtc: string;
        };
        seenIdempotencyKeys.push(body.idempotencyKey);
        const id = url.split('/api/v1/transcripts/')[1];
        const record: TranscriptRecordV1 = {
          id,
          deviceId: body.deviceId,
          originalTranscript: body.originalTranscript,
          refinedTranscript: body.refinedTranscript,
          editedText: body.editedText,
          outputMode: body.outputMode,
          providerId: body.providerId,
          durationMs: body.durationMs,
          version: body.expectedVersion + 1,
          isDeleted: false,
          createdAtUtc: body.clientUpdatedAtUtc,
          updatedAtUtc: body.clientUpdatedAtUtc,
        };
        const existingIdx = serverTranscripts.findIndex((t) => t.id === id);
        if (existingIdx >= 0) {
          serverTranscripts[existingIdx] = record;
        } else {
          serverTranscripts.push(record);
        }
        return new Response(JSON.stringify(record), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'GET' && url.includes('/api/v1/transcripts')) {
        const page: PaginatedListResponseV1<TranscriptRecordV1> = {
          items: serverTranscripts,
          page: 1,
          pageSize: 50,
          totalCount: serverTranscripts.length,
          contractVersion: 'v1',
        };
        return new Response(JSON.stringify(page), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'GET' && url.includes('/api/v1/notes')) {
        const page: PaginatedListResponseV1<NoteRecordV1> = {
          items: serverNotes,
          page: 1,
          pageSize: 50,
          totalCount: serverNotes.length,
          contractVersion: 'v1',
        };
        return new Response(JSON.stringify(page), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(null, { status: 404 });
    });

    const historyRepo = new LocalDictationHistoryRepository({ useTauriWhenAvailable: false });
    const engine = new DesktopSyncEngine({
      historyRepository: historyRepo,
      fetchImpl: fetchMock as unknown as typeof fetch,
      useTauriWhenAvailable: false,
      deviceId: 'desktop-win-test',
    });
    engine.setAccessToken('valid-bearer-token');

    const entry = await historyRepo.saveEntry({
      originalTranscript: 'um draft release notes offline',
      refinedTranscript: 'Draft release notes offline.',
      editedText: 'Draft FlowPilot v1.4 release notes while offline.',
      outputMode: 'clean',
      providerId: 'local-whisper-cpp',
      durationMs: 2300,
    });

    const queued: OfflineSyncQueueItem = await engine.enqueueTranscriptUpsert(entry);
    expect(queued.syncState).toBe('pending-sync');
    expect(queued.idempotencyKey).toBeTruthy();

    // Attempt 1 while offline -> transitions to offline-retry with attemptCount = 1
    const offlineAttempt = await engine.syncNow({ syncEnabled: true, forceIgnoreBackoff: true });
    expect(offlineAttempt.status).toBe('offline-retry');

    const queueAfterFail = await engine.listQueue();
    expect(queueAfterFail).toHaveLength(1);
    expect(queueAfterFail[0].attemptCount).toBe(1);
    expect(queueAfterFail[0].syncState).toBe('offline-retry');
    expect(queueAfterFail[0].nextRetryAtUtc).toBeTruthy();

    // Reconnect and sync -> reuses exact same idempotencyKey and pulls remote notes
    networkOnline = true;
    const onlineAttempt = await engine.syncNow({ syncEnabled: true, forceIgnoreBackoff: true });
    expect(onlineAttempt.status).toBe('synced');
    expect(seenIdempotencyKeys).toEqual([queued.idempotencyKey]);
    expect(await engine.listQueue()).toHaveLength(0);

    // Desktop transcript is now on the server
    expect(serverTranscripts).toHaveLength(1);
    expect(serverTranscripts[0].editedText).toBe(
      'Draft FlowPilot v1.4 release notes while offline.',
    );

    // Web note was pulled down to the desktop and is available locally
    const syncedNotes = engine.listSyncedNotes();
    expect(syncedNotes).toHaveLength(1);
    expect(syncedNotes[0].title).toBe('Sprint Retrospective Note from Web');
  });

  it('handles 401 expired authentication without losing queued offline records', async () => {
    let tokenValid = false;
    const fetchMock = vi.fn(async () => {
      if (!tokenValid) {
        return new Response(
          JSON.stringify({
            code: 'AUTH_UNAUTHORIZED',
            message: 'Bearer token expired.',
            recoverable: true,
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({
          items: [],
          page: 1,
          pageSize: 50,
          totalCount: 0,
          contractVersion: 'v1',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const historyRepo = new LocalDictationHistoryRepository({ useTauriWhenAvailable: false });
    const engine = new DesktopSyncEngine({
      historyRepository: historyRepo,
      fetchImpl: fetchMock as unknown as typeof fetch,
      useTauriWhenAvailable: false,
    });
    engine.setAccessToken('expired-token');

    const entry = await historyRepo.saveEntry({
      originalTranscript: 'important offline thought',
      refinedTranscript: 'Important offline thought.',
      editedText: 'Important offline thought.',
      outputMode: 'quick-note',
      providerId: 'local-whisper-cpp',
      durationMs: 1100,
    });
    await engine.enqueueTranscriptUpsert(entry);

    const expiredResult = await engine.syncNow({ syncEnabled: true, forceIgnoreBackoff: true });
    expect(expiredResult.status).toBe('auth-expired');
    expect(engine.getStatus().authExpired).toBe(true);
    // Queued item is preserved
    expect(await engine.listQueue()).toHaveLength(1);

    // Refresh token -> authExpired clears
    tokenValid = true;
    engine.setAccessToken('fresh-valid-token');
    expect(engine.getStatus().authExpired).toBe(false);
  });

  it('detects 409 version conflicts without silently overwriting user edits and supports keep-local or accept-server resolution', async () => {
    let serverRecord: TranscriptRecordV1 = {
      id: 'tr-conflict-1',
      deviceId: 'web-client',
      originalTranscript: 'initial transcript',
      refinedTranscript: 'Initial transcript.',
      editedText: 'Edited on Web Companion v2.',
      outputMode: 'clean',
      providerId: 'local-whisper-cpp',
      durationMs: 1800,
      version: 2,
      isDeleted: false,
      createdAtUtc: '2026-10-21T19:00:00Z',
      updatedAtUtc: '2026-10-21T19:10:00Z',
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (method === 'PUT' && url.includes('/api/v1/transcripts/tr-conflict-1')) {
        const body = JSON.parse(String(init?.body)) as {
          expectedVersion: number;
          editedText: string;
        };

        if (body.expectedVersion !== serverRecord.version) {
          const conflict: SyncConflictResponseV1<TranscriptRecordV1> = {
            code: 'VERSION_CONFLICT',
            message: 'Concurrent modification detected.',
            serverVersion: serverRecord.version,
            serverRecord,
            contractVersion: 'v1',
          };
          return new Response(JSON.stringify(conflict), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        serverRecord = {
          ...serverRecord,
          editedText: body.editedText,
          version: serverRecord.version + 1,
        };
        return new Response(JSON.stringify(serverRecord), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(
        JSON.stringify({
          items: [serverRecord],
          page: 1,
          pageSize: 50,
          totalCount: 1,
          contractVersion: 'v1',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const historyRepo = new LocalDictationHistoryRepository({ useTauriWhenAvailable: false });
    const engine = new DesktopSyncEngine({
      historyRepository: historyRepo,
      fetchImpl: fetchMock as unknown as typeof fetch,
      useTauriWhenAvailable: false,
    });
    engine.setAccessToken('valid-token');

    // Enqueue a stale local edit (expectedVersion = 1, while server is at version 2)
    await engine.enqueueTranscriptUpsert(
      {
        id: 'tr-conflict-1',
        originalTranscript: 'initial transcript',
        refinedTranscript: 'Initial transcript.',
        editedText: 'Edited offline on Desktop v1.',
        outputMode: 'clean',
        providerId: 'local-whisper-cpp',
        durationMs: 1800,
        createdAtUtc: '2026-10-21T19:00:00Z',
      },
      1,
    );

    const syncRes = await engine.syncNow({ syncEnabled: true, forceIgnoreBackoff: true });
    expect(syncRes.status).toBe('conflict');

    const conflicts = await engine.listConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].entityId).toBe('tr-conflict-1');
    expect(conflicts[0].localPayload.editedText).toBe('Edited offline on Desktop v1.');
    expect(conflicts[0].serverRecord.editedText).toBe('Edited on Web Companion v2.');

    // User chooses "Keep Local" -> rebases expectedVersion onto serverVersion (2) and syncs to v3
    await engine.resolveConflictKeepLocal('tr-conflict-1');
    const afterResolve = await engine.syncNow({ syncEnabled: true, forceIgnoreBackoff: true });
    expect(afterResolve.status).toBe('synced');
    expect(serverRecord.version).toBe(3);
    expect(serverRecord.editedText).toBe('Edited offline on Desktop v1.');
    expect(await engine.listConflicts()).toHaveLength(0);
  });
});
