import { invoke } from '@tauri-apps/api/core';
import {
  DictationError,
  type DictationHistoryEntry,
  type DictationHistoryRepository,
  type NewDictationHistoryEntry,
} from './types.js';

const DEFAULT_STORAGE_KEY = 'flowpilot_dictation_history_v1';

export interface LocalDictationHistoryOptions {
  storageKey?: string;
  useTauriWhenAvailable?: boolean;
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Persists dictation history locally on the device (via Tauri SQLite in the native Windows app,
 * or localStorage in the browser/Vitest shell). Raw audio bytes are never stored.
 */
export class LocalDictationHistoryRepository implements DictationHistoryRepository {
  private readonly storageKey: string;
  private readonly useTauriWhenAvailable: boolean;

  constructor(options?: LocalDictationHistoryOptions) {
    this.storageKey = options?.storageKey ?? DEFAULT_STORAGE_KEY;
    this.useTauriWhenAvailable = options?.useTauriWhenAvailable ?? true;
  }

  public async saveEntry(entry: NewDictationHistoryEntry): Promise<DictationHistoryEntry> {
    if (!entry.originalTranscript.trim() || !entry.editedText.trim()) {
      throw new DictationError(
        'STORAGE_FAILED',
        'Cannot save an empty transcript entry to history.',
      );
    }

    const record: DictationHistoryEntry = {
      id: generateEntryId(),
      originalTranscript: entry.originalTranscript,
      refinedTranscript: entry.refinedTranscript,
      editedText: entry.editedText,
      outputMode: entry.outputMode,
      providerId: entry.providerId,
      durationMs: entry.durationMs,
      createdAtUtc: new Date().toISOString(),
    };

    if (this.useTauriWhenAvailable && isTauriRuntime()) {
      try {
        await invoke('save_dictation_entry', { entry: record });
        return record;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new DictationError(
          'STORAGE_FAILED',
          `Failed to save transcript in local SQLite database: ${detail}`,
        );
      }
    }

    try {
      const existing = this.readBrowserEntries();
      const updated = [record, ...existing];
      window.localStorage.setItem(this.storageKey, JSON.stringify(updated));
      return record;
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Storage quota exceeded';
      throw new DictationError('STORAGE_FAILED', `Failed to save history entry: ${detail}`);
    }
  }

  public async listHistory(searchQuery?: string): Promise<DictationHistoryEntry[]> {
    const normalizedQuery = (searchQuery ?? '').trim().toLowerCase();

    if (this.useTauriWhenAvailable && isTauriRuntime()) {
      try {
        const entries = await invoke<DictationHistoryEntry[]>('list_dictation_history', {
          searchQuery: normalizedQuery.length > 0 ? normalizedQuery : null,
        });
        return entries;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new DictationError(
          'STORAGE_FAILED',
          `Failed to load history from local SQLite database: ${detail}`,
        );
      }
    }

    const entries = this.readBrowserEntries();
    if (!normalizedQuery) {
      return entries;
    }

    return entries.filter((item) => {
      return (
        item.editedText.toLowerCase().includes(normalizedQuery) ||
        item.originalTranscript.toLowerCase().includes(normalizedQuery) ||
        item.refinedTranscript.toLowerCase().includes(normalizedQuery) ||
        item.outputMode.toLowerCase().includes(normalizedQuery)
      );
    });
  }

  public async deleteEntry(id: string): Promise<void> {
    if (this.useTauriWhenAvailable && isTauriRuntime()) {
      try {
        await invoke('delete_dictation_entry', { id });
        return;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new DictationError(
          'STORAGE_FAILED',
          `Failed to delete history entry from SQLite: ${detail}`,
        );
      }
    }

    const existing = this.readBrowserEntries();
    const filtered = existing.filter((item) => item.id !== id);
    window.localStorage.setItem(this.storageKey, JSON.stringify(filtered));
  }

  private readBrowserEntries(): DictationHistoryEntry[] {
    if (typeof window === 'undefined' || !window.localStorage) {
      return [];
    }
    const raw = window.localStorage.getItem(this.storageKey);
    if (!raw) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as DictationHistoryEntry[]) : [];
    } catch {
      return [];
    }
  }
}

let entryCounter = 0;

function generateEntryId(): string {
  entryCounter += 1;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `fp-${Date.now()}-${entryCounter}`;
}
