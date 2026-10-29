import {
  ACCOUNT_SYNC_PATHS_V1,
  type UpsertVocabularyEntryRequestV1,
  type VocabularyEntryRecordV1,
} from '@flowpilot/contracts';

const DEFAULT_API_BASE_URL = 'http://localhost:5080';
const SHORTCUT_STORAGE_KEY = 'flowpilot_shortcut_preferences_v1';
const VOCABULARY_STORAGE_KEY = 'flowpilot_custom_vocabulary_v1';

export interface ShortcutPreferences {
  toggleRecordingHotkey: string;
  pushToTalkHotkey: string;
  copyLastOutputHotkey: string;
  minimizeToTrayOnClose: boolean;
  trayNotificationsEnabled: boolean;
}

export const DEFAULT_SHORTCUT_PREFERENCES: Readonly<ShortcutPreferences> = {
  toggleRecordingHotkey: 'Ctrl+Shift+Space',
  pushToTalkHotkey: 'Alt+Space',
  copyLastOutputHotkey: 'Ctrl+Shift+C',
  minimizeToTrayOnClose: true,
  trayNotificationsEnabled: true,
};

export class ShortcutPreferencesRepository {
  private readonly storageKey: string;

  public constructor(storageKey = SHORTCUT_STORAGE_KEY) {
    this.storageKey = storageKey;
  }

  public loadPreferences(): ShortcutPreferences {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ...DEFAULT_SHORTCUT_PREFERENCES };
    }
    const raw = window.localStorage.getItem(this.storageKey);
    if (!raw) {
      return { ...DEFAULT_SHORTCUT_PREFERENCES };
    }
    try {
      const parsed = JSON.parse(raw) as Partial<ShortcutPreferences>;
      return {
        ...DEFAULT_SHORTCUT_PREFERENCES,
        ...parsed,
      };
    } catch {
      return { ...DEFAULT_SHORTCUT_PREFERENCES };
    }
  }

  public updatePreferences(partial: Partial<ShortcutPreferences>): ShortcutPreferences {
    const merged: ShortcutPreferences = {
      ...this.loadPreferences(),
      ...partial,
    };

    const normalizedToggle = merged.toggleRecordingHotkey.trim().toLowerCase();
    const normalizedPush = merged.pushToTalkHotkey.trim().toLowerCase();
    const normalizedCopy = merged.copyLastOutputHotkey.trim().toLowerCase();

    if (!normalizedToggle || !normalizedPush || !normalizedCopy) {
      throw new Error('Shortcut hotkeys cannot be empty.');
    }

    if (
      normalizedToggle === normalizedCopy ||
      normalizedToggle === normalizedPush ||
      normalizedPush === normalizedCopy
    ) {
      throw new Error('Shortcut hotkey conflict: each action must use a distinct key combination.');
    }

    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(this.storageKey, JSON.stringify(merged));
    }

    return merged;
  }
}

export function matchesHotkeyEvent(event: KeyboardEvent, hotkeyBinding: string): boolean {
  const parts = hotkeyBinding
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return false;
  }

  const expectsCtrl = parts.includes('ctrl') || parts.includes('control');
  const expectsShift = parts.includes('shift');
  const expectsAlt = parts.includes('alt');
  const mainKey = parts[parts.length - 1];

  if (
    event.ctrlKey !== expectsCtrl ||
    event.shiftKey !== expectsShift ||
    event.altKey !== expectsAlt
  ) {
    return false;
  }

  const normalizedEventKey =
    event.key === ' ' || event.code === 'Space' ? 'space' : event.key.toLowerCase();

  return normalizedEventKey === mainKey;
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function applyVocabularyReplacements(
  text: string,
  entries: ReadonlyArray<VocabularyEntryRecordV1>,
): string {
  if (!text || entries.length === 0) {
    return text;
  }

  // Sort longer spoken phrases first so multi-word phrases replace before single words
  const sorted = [...entries].sort((a, b) => b.spokenPhrase.length - a.spokenPhrase.length);
  let output = text;

  for (const entry of sorted) {
    const phrase = entry.spokenPhrase.trim();
    if (!phrase) {
      continue;
    }
    const pattern = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'gi');
    output = output.replace(pattern, entry.replacementTerm);
  }

  return output;
}

let vocabCounter = 0;
function createVocabId(): string {
  vocabCounter += 1;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `voc-${crypto.randomUUID()}`;
  }
  return `voc-${Date.now()}-${vocabCounter}`;
}

export class CustomVocabularyService {
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly storageKey: string;

  public constructor(options?: {
    apiBaseUrl?: string;
    fetchImpl?: typeof fetch;
    storageKey?: string;
  }) {
    this.apiBaseUrl = (
      options?.apiBaseUrl ??
      (import.meta.env.VITE_DESKTOP_API_BASE_URL as string | undefined) ??
      DEFAULT_API_BASE_URL
    ).replace(/\/+$/, '');
    this.fetchImpl = options?.fetchImpl ?? ((input, init) => fetch(input, init));
    this.storageKey = options?.storageKey ?? VOCABULARY_STORAGE_KEY;
  }

  public listEntries(): VocabularyEntryRecordV1[] {
    if (typeof window === 'undefined' || !window.localStorage) {
      return [];
    }
    const raw = window.localStorage.getItem(this.storageKey);
    if (!raw) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as VocabularyEntryRecordV1[]) : [];
    } catch {
      return [];
    }
  }

  public upsertLocalEntry(
    input: UpsertVocabularyEntryRequestV1 & { id?: string },
  ): VocabularyEntryRecordV1 {
    const spokenPhrase = input.spokenPhrase.trim();
    const replacementTerm = input.replacementTerm.trim();
    const category = input.category.trim() || 'General';

    if (!spokenPhrase || !replacementTerm) {
      throw new Error('Both spoken phrase and replacement term are required.');
    }

    const existing = this.listEntries();
    const record: VocabularyEntryRecordV1 = {
      id: input.id ?? createVocabId(),
      spokenPhrase,
      replacementTerm,
      category,
      updatedAtUtc: new Date().toISOString(),
    };

    const filtered = existing.filter(
      (item) =>
        item.id !== record.id && item.spokenPhrase.toLowerCase() !== spokenPhrase.toLowerCase(),
    );
    const updated = [record, ...filtered];
    this.saveEntries(updated);
    return record;
  }

  public deleteLocalEntry(id: string): void {
    const filtered = this.listEntries().filter((item) => item.id !== id);
    this.saveEntries(filtered);
  }

  public async syncWithCloud(accessToken: string | null): Promise<VocabularyEntryRecordV1[]> {
    if (!accessToken) {
      return this.listEntries();
    }

    const localEntries = this.listEntries();
    for (const entry of localEntries) {
      await this.fetchImpl(
        `${this.apiBaseUrl}${ACCOUNT_SYNC_PATHS_V1.vocabulary}/${encodeURIComponent(entry.id)}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            spokenPhrase: entry.spokenPhrase,
            replacementTerm: entry.replacementTerm,
            category: entry.category,
          }),
        },
      );
    }

    const response = await this.fetchImpl(`${this.apiBaseUrl}${ACCOUNT_SYNC_PATHS_V1.vocabulary}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (response.ok) {
      const remoteEntries = (await response.json()) as VocabularyEntryRecordV1[];
      const byId = new Map<string, VocabularyEntryRecordV1>();
      for (const item of localEntries) {
        byId.set(item.id, item);
      }
      for (const remote of remoteEntries) {
        byId.set(remote.id, remote);
      }
      const merged = Array.from(byId.values());
      this.saveEntries(merged);
      return merged;
    }

    return localEntries;
  }

  private saveEntries(entries: VocabularyEntryRecordV1[]): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(this.storageKey, JSON.stringify(entries));
    }
  }
}
