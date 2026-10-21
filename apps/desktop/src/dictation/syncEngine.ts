import { invoke } from '@tauri-apps/api/core';
import {
  ACCOUNT_SYNC_PATHS_V1,
  isAuthSessionResponseV1,
  isPaginatedListResponseV1,
  isSyncConflictResponseV1,
  type AuthSessionResponseV1,
  type NoteRecordV1,
  type SyncItemState,
  type TranscriptRecordV1,
  type UpsertTranscriptRequestV1,
} from '@flowpilot/contracts';
import type { DictationHistoryEntry, DictationHistoryRepository, OutputMode } from './types.js';

const DEFAULT_API_BASE_URL = 'http://localhost:5080';
const DEFAULT_QUEUE_STORAGE_KEY = 'flowpilot_offline_sync_queue_v1';
const DEFAULT_VERSIONS_STORAGE_KEY = 'flowpilot_record_versions_v1';
const DEFAULT_NOTES_STORAGE_KEY = 'flowpilot_synced_notes_v1';
const DEFAULT_AUTH_STORAGE_KEY = 'flowpilot_desktop_auth_session_v1';

export function computeBoundedBackoffMs(
  attemptCount: number,
  baseDelayMs = 1_000,
  maxDelayMs = 30_000,
): number {
  const exponent = Math.max(0, attemptCount - 1);
  return Math.min(maxDelayMs, baseDelayMs * Math.pow(2, exponent));
}

export interface OfflineSyncQueueItem {
  id: string;
  entityType: 'transcript';
  entityId: string;
  operationType: 'upsert' | 'delete';
  idempotencyKey: string;
  expectedVersion: number;
  payloadJson: string;
  syncState: SyncItemState;
  attemptCount: number;
  nextRetryAtUtc: string | null;
  lastError: string | null;
  conflictServerJson: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface TranscriptConflictItem {
  queueItemId: string;
  entityId: string;
  localPayload: DictationHistoryEntry;
  serverRecord: TranscriptRecordV1;
  serverVersion: number;
}

export interface DesktopSyncStatus {
  state: 'disabled' | 'idle' | 'syncing' | 'synced' | 'offline-retry' | 'auth-expired' | 'conflict';
  authExpired: boolean;
  authenticatedEmail: string | null;
  pendingCount: number;
  conflictCount: number;
  lastSyncedAtUtc: string | null;
  lastErrorMessage: string | null;
}

export interface DesktopSyncEngineOptions {
  historyRepository: DictationHistoryRepository;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  useTauriWhenAvailable?: boolean;
  deviceId?: string;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

let queueIdCounter = 0;
function createUniqueKey(prefix: string): string {
  queueIdCounter += 1;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${queueIdCounter}`;
}

export class DesktopSyncEngine {
  private readonly historyRepository: DictationHistoryRepository;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly useTauriWhenAvailable: boolean;
  private readonly deviceId: string;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;

  private accessToken: string | null = null;
  private authenticatedEmail: string | null = null;
  private status: DesktopSyncStatus = {
    state: 'idle',
    authExpired: false,
    authenticatedEmail: null,
    pendingCount: 0,
    conflictCount: 0,
    lastSyncedAtUtc: null,
    lastErrorMessage: null,
  };

  public constructor(options: DesktopSyncEngineOptions) {
    this.historyRepository = options.historyRepository;
    this.apiBaseUrl = (
      options.apiBaseUrl ??
      (import.meta.env.VITE_DESKTOP_API_BASE_URL as string | undefined) ??
      DEFAULT_API_BASE_URL
    ).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.useTauriWhenAvailable = options.useTauriWhenAvailable ?? true;
    this.deviceId = options.deviceId ?? 'flowpilot-windows-desktop';
    this.baseBackoffMs = options.baseBackoffMs ?? 1_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000;

    this.restoreSavedSession();
  }

  public getStatus(): DesktopSyncStatus {
    return { ...this.status };
  }

  public setAccessToken(token: string | null, email?: string | null): void {
    this.accessToken = token;
    if (email !== undefined) {
      this.authenticatedEmail = email;
    }
    this.status = {
      ...this.status,
      authExpired: false,
      authenticatedEmail: this.authenticatedEmail,
      state: token ? 'idle' : 'disabled',
      lastErrorMessage: null,
    };
    this.persistSession();
  }

  public async signIn(email: string, password: string): Promise<AuthSessionResponseV1> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}${ACCOUNT_SYNC_PATHS_V1.authLogin}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      throw new Error(`Sign-in failed (HTTP ${response.status}).`);
    }

    const body: unknown = await response.json();
    if (!isAuthSessionResponseV1(body)) {
      throw new Error('Invalid authentication response payload.');
    }

    this.setAccessToken(body.accessToken, body.user.email);
    return body;
  }

  public async registerAccount(
    email: string,
    password: string,
    displayName: string,
  ): Promise<AuthSessionResponseV1> {
    const response = await this.fetchImpl(
      `${this.apiBaseUrl}${ACCOUNT_SYNC_PATHS_V1.authRegister}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, displayName }),
      },
    );

    if (!response.ok) {
      throw new Error(`Registration failed (HTTP ${response.status}).`);
    }

    const body: unknown = await response.json();
    if (!isAuthSessionResponseV1(body)) {
      throw new Error('Invalid registration response payload.');
    }

    this.setAccessToken(body.accessToken, body.user.email);
    return body;
  }

  public async signOut(): Promise<void> {
    if (this.accessToken) {
      try {
        await this.fetchImpl(`${this.apiBaseUrl}${ACCOUNT_SYNC_PATHS_V1.authLogout}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.accessToken}` },
        });
      } catch {
        // Ignore network errors during sign-out
      }
    }
    this.setAccessToken(null, null);
  }

  public getRecordVersion(recordId: string): number {
    const map = this.readVersionsMap();
    return map[recordId] ?? 0;
  }

  public setRecordVersion(recordId: string, version: number): void {
    const map = this.readVersionsMap();
    map[recordId] = version;
    this.writeVersionsMap(map);
  }

  /**
   * Queues a transcript record for synchronization in SQLite/local storage.
   * Strictly serializes text & metadata only — raw audio bytes are never queued or synced.
   */
  public async enqueueTranscriptUpsert(
    entry: DictationHistoryEntry,
    expectedVersionOverride?: number,
  ): Promise<OfflineSyncQueueItem> {
    const sanitizedEntry: DictationHistoryEntry = {
      id: entry.id,
      originalTranscript: entry.originalTranscript,
      refinedTranscript: entry.refinedTranscript,
      editedText: entry.editedText,
      outputMode: entry.outputMode,
      providerId: entry.providerId,
      durationMs: entry.durationMs,
      createdAtUtc: entry.createdAtUtc,
    };

    const existingQueue = await this.listQueue();
    const existingForEntity = existingQueue.find((q) => q.entityId === entry.id);
    const nowIso = new Date().toISOString();

    const item: OfflineSyncQueueItem = {
      id: existingForEntity?.id ?? createUniqueKey('syncq'),
      entityType: 'transcript',
      entityId: entry.id,
      operationType: 'upsert',
      idempotencyKey: createUniqueKey('idem'),
      expectedVersion: expectedVersionOverride ?? this.getRecordVersion(entry.id),
      payloadJson: JSON.stringify(sanitizedEntry),
      syncState: 'pending-sync',
      attemptCount: 0,
      nextRetryAtUtc: null,
      lastError: null,
      conflictServerJson: null,
      createdAtUtc: existingForEntity?.createdAtUtc ?? nowIso,
      updatedAtUtc: nowIso,
    };

    await this.saveQueueItem(item);
    await this.refreshCounts();
    return item;
  }

  public async listQueue(): Promise<OfflineSyncQueueItem[]> {
    if (this.useTauriWhenAvailable && isTauriRuntime()) {
      try {
        return await invoke<OfflineSyncQueueItem[]>('list_offline_sync_queue_items');
      } catch {
        // Fall through to browser storage if Tauri command fails
      }
    }

    if (typeof window === 'undefined' || !window.localStorage) {
      return [];
    }
    const raw = window.localStorage.getItem(DEFAULT_QUEUE_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as OfflineSyncQueueItem[]) : [];
    } catch {
      return [];
    }
  }

  public async listConflicts(): Promise<TranscriptConflictItem[]> {
    const queue = await this.listQueue();
    const conflicts: TranscriptConflictItem[] = [];

    for (const item of queue) {
      if (item.syncState === 'conflict' && item.conflictServerJson) {
        try {
          const localPayload = JSON.parse(item.payloadJson) as DictationHistoryEntry;
          const serverRecord = JSON.parse(item.conflictServerJson) as TranscriptRecordV1;
          conflicts.push({
            queueItemId: item.id,
            entityId: item.entityId,
            localPayload,
            serverRecord,
            serverVersion: serverRecord.version,
          });
        } catch {
          // Ignore malformed conflict entries
        }
      }
    }

    return conflicts;
  }

  public async resolveConflictKeepLocal(entityId: string): Promise<void> {
    const queue = await this.listQueue();
    const conflictItem = queue.find(
      (item) => item.entityId === entityId && item.syncState === 'conflict',
    );
    if (!conflictItem || !conflictItem.conflictServerJson) {
      return;
    }

    const serverRecord = JSON.parse(conflictItem.conflictServerJson) as TranscriptRecordV1;
    this.setRecordVersion(entityId, serverRecord.version);

    const updatedItem: OfflineSyncQueueItem = {
      ...conflictItem,
      idempotencyKey: createUniqueKey('idem'),
      expectedVersion: serverRecord.version,
      syncState: 'pending-sync',
      attemptCount: 0,
      nextRetryAtUtc: null,
      lastError: null,
      conflictServerJson: null,
      updatedAtUtc: new Date().toISOString(),
    };

    await this.saveQueueItem(updatedItem);
    await this.refreshCounts();
  }

  public async resolveConflictAcceptServer(entityId: string): Promise<void> {
    const queue = await this.listQueue();
    const conflictItem = queue.find(
      (item) => item.entityId === entityId && item.syncState === 'conflict',
    );
    if (!conflictItem || !conflictItem.conflictServerJson) {
      return;
    }

    const serverRecord = JSON.parse(conflictItem.conflictServerJson) as TranscriptRecordV1;
    this.setRecordVersion(entityId, serverRecord.version);

    await this.historyRepository.deleteEntry(entityId);
    await this.upsertLocalHistoryFromRemote(serverRecord);
    await this.removeQueueItem(conflictItem.id);
    await this.refreshCounts();
  }

  public listSyncedNotes(): NoteRecordV1[] {
    if (typeof window === 'undefined' || !window.localStorage) {
      return [];
    }
    const raw = window.localStorage.getItem(DEFAULT_NOTES_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as NoteRecordV1[]) : [];
    } catch {
      return [];
    }
  }

  public async syncNow(options: {
    syncEnabled: boolean;
    forceIgnoreBackoff?: boolean;
  }): Promise<{ status: DesktopSyncStatus['state'] }> {
    if (!options.syncEnabled) {
      this.status = {
        ...this.status,
        state: 'disabled',
      };
      return { status: 'disabled' };
    }

    if (!this.accessToken) {
      this.status = {
        ...this.status,
        state: 'disabled',
      };
      return { status: 'disabled' };
    }

    this.status = {
      ...this.status,
      state: 'syncing',
      lastErrorMessage: null,
    };

    const queue = await this.listQueue();
    const nowMs = Date.now();
    let encounteredConflict = false;

    for (const item of queue) {
      if (item.syncState === 'conflict') {
        encounteredConflict = true;
        continue;
      }

      if (
        !options.forceIgnoreBackoff &&
        item.nextRetryAtUtc &&
        Date.parse(item.nextRetryAtUtc) > nowMs
      ) {
        continue;
      }

      const localPayload = JSON.parse(item.payloadJson) as DictationHistoryEntry;
      const requestBody: UpsertTranscriptRequestV1 = {
        idempotencyKey: item.idempotencyKey,
        expectedVersion: item.expectedVersion,
        deviceId: this.deviceId,
        originalTranscript: localPayload.originalTranscript,
        refinedTranscript: localPayload.refinedTranscript,
        editedText: localPayload.editedText,
        outputMode: localPayload.outputMode,
        providerId: localPayload.providerId,
        durationMs: localPayload.durationMs,
        clientUpdatedAtUtc: new Date().toISOString(),
      };

      let response: Response;
      try {
        response = await this.fetchImpl(
          `${this.apiBaseUrl}${ACCOUNT_SYNC_PATHS_V1.transcripts}/${encodeURIComponent(item.entityId)}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.accessToken}`,
            },
            body: JSON.stringify(requestBody),
          },
        );
      } catch (error) {
        const nextAttempt = item.attemptCount + 1;
        const backoffMs = computeBoundedBackoffMs(
          nextAttempt,
          this.baseBackoffMs,
          this.maxBackoffMs,
        );
        const retryAtUtc = new Date(Date.now() + backoffMs).toISOString();
        const detail = error instanceof Error ? error.message : 'Network unavailable';

        await this.saveQueueItem({
          ...item,
          syncState: 'offline-retry',
          attemptCount: nextAttempt,
          nextRetryAtUtc: retryAtUtc,
          lastError: detail,
          updatedAtUtc: new Date().toISOString(),
        });

        await this.refreshCounts();
        this.status = {
          ...this.status,
          state: 'offline-retry',
          lastErrorMessage: `Network unavailable — queued for automatic retry (${detail}).`,
        };
        return { status: 'offline-retry' };
      }

      if (response.status === 401) {
        await this.saveQueueItem({
          ...item,
          syncState: 'auth-expired',
          lastError: 'Authentication session expired.',
          updatedAtUtc: new Date().toISOString(),
        });
        await this.refreshCounts();
        this.status = {
          ...this.status,
          state: 'auth-expired',
          authExpired: true,
          lastErrorMessage:
            'Authentication session expired. Sign in again to resume cloud synchronization.',
        };
        return { status: 'auth-expired' };
      }

      if (response.status === 409) {
        const conflictJson: unknown = await response.json();
        if (isSyncConflictResponseV1<TranscriptRecordV1>(conflictJson)) {
          encounteredConflict = true;
          await this.saveQueueItem({
            ...item,
            syncState: 'conflict',
            lastError: conflictJson.message,
            conflictServerJson: JSON.stringify(conflictJson.serverRecord),
            updatedAtUtc: new Date().toISOString(),
          });
          continue;
        }
      }

      if (!response.ok) {
        const nextAttempt = item.attemptCount + 1;
        const backoffMs = computeBoundedBackoffMs(
          nextAttempt,
          this.baseBackoffMs,
          this.maxBackoffMs,
        );
        await this.saveQueueItem({
          ...item,
          syncState: 'offline-retry',
          attemptCount: nextAttempt,
          nextRetryAtUtc: new Date(Date.now() + backoffMs).toISOString(),
          lastError: `Server returned HTTP ${response.status}`,
          updatedAtUtc: new Date().toISOString(),
        });
        await this.refreshCounts();
        this.status = {
          ...this.status,
          state: 'offline-retry',
          lastErrorMessage: `Sync failed with HTTP ${response.status}; scheduled for retry.`,
        };
        return { status: 'offline-retry' };
      }

      const syncedRecord = (await response.json()) as TranscriptRecordV1;
      this.setRecordVersion(item.entityId, syncedRecord.version);
      await this.removeQueueItem(item.id);
    }

    // Pull remote notes & transcripts so Web notes and remote transcripts appear on Desktop
    try {
      await this.pullRemoteNotesAndTranscripts();
    } catch {
      // Non-fatal if pull fails after queue push
    }

    await this.refreshCounts();
    const finalState: DesktopSyncStatus['state'] = encounteredConflict ? 'conflict' : 'synced';
    this.status = {
      ...this.status,
      state: finalState,
      authExpired: false,
      lastSyncedAtUtc: new Date().toISOString(),
      lastErrorMessage: encounteredConflict
        ? 'One or more transcripts have concurrent edits requiring your resolution.'
        : null,
    };
    return { status: finalState };
  }

  private async pullRemoteNotesAndTranscripts(): Promise<void> {
    if (!this.accessToken) {
      return;
    }

    const notesResponse = await this.fetchImpl(
      `${this.apiBaseUrl}${ACCOUNT_SYNC_PATHS_V1.notes}?page=1&pageSize=50`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      },
    );

    if (notesResponse.ok) {
      const notesPayload: unknown = await notesResponse.json();
      if (isPaginatedListResponseV1<NoteRecordV1>(notesPayload)) {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(
            DEFAULT_NOTES_STORAGE_KEY,
            JSON.stringify(notesPayload.items.filter((n) => !n.isDeleted)),
          );
        }
      }
    }

    const transcriptsResponse = await this.fetchImpl(
      `${this.apiBaseUrl}${ACCOUNT_SYNC_PATHS_V1.transcripts}?page=1&pageSize=50`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      },
    );

    if (transcriptsResponse.ok) {
      const transcriptsPayload: unknown = await transcriptsResponse.json();
      if (isPaginatedListResponseV1<TranscriptRecordV1>(transcriptsPayload)) {
        const localEntries = await this.historyRepository.listHistory('');
        const localIds = new Set(localEntries.map((item) => item.id));
        const pendingQueue = await this.listQueue();
        const pendingIds = new Set(pendingQueue.map((q) => q.entityId));

        for (const remote of transcriptsPayload.items) {
          if (remote.isDeleted || pendingIds.has(remote.id)) {
            continue;
          }
          this.setRecordVersion(remote.id, remote.version);
          if (!localIds.has(remote.id)) {
            await this.upsertLocalHistoryFromRemote(remote);
          }
        }
      }
    }
  }

  private async upsertLocalHistoryFromRemote(remote: TranscriptRecordV1): Promise<void> {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    const raw = window.localStorage.getItem('flowpilot_dictation_history_v1');
    const existing: DictationHistoryEntry[] = raw
      ? (JSON.parse(raw) as DictationHistoryEntry[])
      : [];
    const filtered = existing.filter((e) => e.id !== remote.id);
    const merged: DictationHistoryEntry = {
      id: remote.id,
      originalTranscript: remote.originalTranscript,
      refinedTranscript: remote.refinedTranscript,
      editedText: remote.editedText,
      outputMode: (remote.outputMode as OutputMode) || 'clean',
      providerId: remote.providerId,
      durationMs: remote.durationMs,
      createdAtUtc: remote.createdAtUtc,
    };
    window.localStorage.setItem(
      'flowpilot_dictation_history_v1',
      JSON.stringify([merged, ...filtered]),
    );
  }

  private async saveQueueItem(item: OfflineSyncQueueItem): Promise<void> {
    if (this.useTauriWhenAvailable && isTauriRuntime()) {
      try {
        await invoke('upsert_offline_sync_queue_item', { item });
        return;
      } catch {
        // Fall through to localStorage fallback
      }
    }

    if (typeof window !== 'undefined' && window.localStorage) {
      const existing = await this.listQueue();
      const idx = existing.findIndex((q) => q.id === item.id);
      if (idx >= 0) {
        existing[idx] = item;
      } else {
        existing.push(item);
      }
      window.localStorage.setItem(DEFAULT_QUEUE_STORAGE_KEY, JSON.stringify(existing));
    }
  }

  private async removeQueueItem(id: string): Promise<void> {
    if (this.useTauriWhenAvailable && isTauriRuntime()) {
      try {
        await invoke('remove_offline_sync_queue_item', { id });
        return;
      } catch {
        // Fall through to localStorage fallback
      }
    }

    if (typeof window !== 'undefined' && window.localStorage) {
      const existing = await this.listQueue();
      const filtered = existing.filter((q) => q.id !== id);
      window.localStorage.setItem(DEFAULT_QUEUE_STORAGE_KEY, JSON.stringify(filtered));
    }
  }

  private async refreshCounts(): Promise<void> {
    const queue = await this.listQueue();
    const conflictCount = queue.filter((q) => q.syncState === 'conflict').length;
    const pendingCount = queue.length - conflictCount;
    this.status = {
      ...this.status,
      pendingCount,
      conflictCount,
    };
  }

  private readVersionsMap(): Record<string, number> {
    if (typeof window === 'undefined' || !window.localStorage) {
      return {};
    }
    const raw = window.localStorage.getItem(DEFAULT_VERSIONS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    try {
      return JSON.parse(raw) as Record<string, number>;
    } catch {
      return {};
    }
  }

  private writeVersionsMap(map: Record<string, number>): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(DEFAULT_VERSIONS_STORAGE_KEY, JSON.stringify(map));
    }
  }

  private restoreSavedSession(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    const raw = window.localStorage.getItem(DEFAULT_AUTH_STORAGE_KEY);
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as { accessToken?: string; email?: string };
      if (parsed.accessToken) {
        this.accessToken = parsed.accessToken;
        this.authenticatedEmail = parsed.email ?? null;
        this.status.authenticatedEmail = this.authenticatedEmail;
      }
    } catch {
      // Ignore invalid stored session
    }
  }

  private persistSession(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    if (!this.accessToken) {
      window.localStorage.removeItem(DEFAULT_AUTH_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      DEFAULT_AUTH_STORAGE_KEY,
      JSON.stringify({ accessToken: this.accessToken, email: this.authenticatedEmail }),
    );
  }
}
