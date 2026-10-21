import type { DictationSettings } from './types.js';

const DEFAULT_SETTINGS_STORAGE_KEY = 'flowpilot_dictation_settings_v1';

export const DEFAULT_DICTATION_SETTINGS: Readonly<DictationSettings> = {
  speechProviderMode: 'local',
  selectedLocalModelId: 'tiny.en',
  selectedCloudProviderId: 'flowpilot-cloud-openai',
  language: 'auto',
  translateToEnglish: false,
  refinementProviderMode: 'local',
  syncTranscriptsToCloud: false,
  retainRecordings: false,
};

export interface DictationSettingsRepositoryOptions {
  storageKey?: string;
}

export class DictationSettingsRepository {
  private readonly storageKey: string;

  constructor(options?: DictationSettingsRepositoryOptions) {
    this.storageKey = options?.storageKey ?? DEFAULT_SETTINGS_STORAGE_KEY;
  }

  public loadSettings(): DictationSettings {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ...DEFAULT_DICTATION_SETTINGS };
    }

    const raw = window.localStorage.getItem(this.storageKey);
    if (!raw) {
      return { ...DEFAULT_DICTATION_SETTINGS };
    }

    try {
      const parsed = JSON.parse(raw) as Partial<DictationSettings>;
      return {
        ...DEFAULT_DICTATION_SETTINGS,
        ...parsed,
      };
    } catch {
      return { ...DEFAULT_DICTATION_SETTINGS };
    }
  }

  public updateSettings(partial: Partial<DictationSettings>): DictationSettings {
    const merged: DictationSettings = {
      ...this.loadSettings(),
      ...partial,
    };

    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(this.storageKey, JSON.stringify(merged));
    }

    return merged;
  }
}
