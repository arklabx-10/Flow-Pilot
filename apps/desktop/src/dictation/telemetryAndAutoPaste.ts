import type { ClipboardService, DictationHistoryEntry, OutputMode } from './types.js';

export interface LocalProductivityMetrics {
  totalSessions: number;
  totalDurationMs: number;
  totalWordsDictated: number;
  estimatedTimeSavedMinutes: number;
  favoriteOutputMode: OutputMode | 'none';
}

export interface AutoPasteResult {
  copiedToClipboard: boolean;
  injectedIntoActiveWindow: boolean;
  statusMessage: string;
}

type TauriInvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

function getTauriInvoke(): TauriInvokeFn | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const win = window as unknown as {
    __TAURI_INTERNALS__?: {
      invoke?: TauriInvokeFn;
    };
  };
  return typeof win.__TAURI_INTERNALS__?.invoke === 'function'
    ? win.__TAURI_INTERNALS__.invoke
    : null;
}

export function countDictatedWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).filter((token) => token.length > 0).length;
}

export function computeLocalProductivityMetrics(
  entries: ReadonlyArray<DictationHistoryEntry>,
): LocalProductivityMetrics {
  if (entries.length === 0) {
    return {
      totalSessions: 0,
      totalDurationMs: 0,
      totalWordsDictated: 0,
      estimatedTimeSavedMinutes: 0,
      favoriteOutputMode: 'none',
    };
  }

  let totalDurationMs = 0;
  let totalWordsDictated = 0;
  const modeCounts = new Map<OutputMode, number>();

  for (const entry of entries) {
    totalDurationMs += Math.max(0, entry.durationMs);
    totalWordsDictated += countDictatedWords(entry.editedText);
    modeCounts.set(entry.outputMode, (modeCounts.get(entry.outputMode) ?? 0) + 1);
  }

  let favoriteOutputMode: OutputMode | 'none' = 'none';
  let maxCount = 0;
  for (const [mode, count] of modeCounts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      favoriteOutputMode = mode;
    }
  }

  const estimatedTimeSavedMinutes = Math.round((totalWordsDictated / 40) * 0.65 * 10) / 10;

  return {
    totalSessions: entries.length,
    totalDurationMs,
    totalWordsDictated,
    estimatedTimeSavedMinutes,
    favoriteOutputMode,
  };
}

export class ActiveWindowAutoPasteService {
  private readonly clipboardService: ClipboardService;
  private readonly invokeOverride?: TauriInvokeFn | null;

  public constructor(options: {
    clipboardService: ClipboardService;
    invokeOverride?: TauriInvokeFn | null;
  }) {
    this.clipboardService = options.clipboardService;
    this.invokeOverride = options.invokeOverride;
  }

  public async copyAndAutoPaste(text: string, autoPasteEnabled: boolean): Promise<AutoPasteResult> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error('Cannot auto-paste empty text.');
    }

    await this.clipboardService.copyText(text);

    if (!autoPasteEnabled) {
      return {
        copiedToClipboard: true,
        injectedIntoActiveWindow: false,
        statusMessage: 'Copied to Windows clipboard.',
      };
    }

    const invoke = this.invokeOverride !== undefined ? this.invokeOverride : getTauriInvoke();

    if (!invoke) {
      return {
        copiedToClipboard: true,
        injectedIntoActiveWindow: false,
        statusMessage:
          'Copied to clipboard (launch native Tauri desktop runtime for active-window Ctrl+V simulation).',
      };
    }

    try {
      const injected = await invoke<boolean>('simulate_active_window_paste', {
        textLength: text.length,
      });
      return {
        copiedToClipboard: true,
        injectedIntoActiveWindow: Boolean(injected),
        statusMessage: injected
          ? 'Copied to clipboard and pasted into active Windows application.'
          : 'Copied to clipboard.',
      };
    } catch {
      return {
        copiedToClipboard: true,
        injectedIntoActiveWindow: false,
        statusMessage: 'Copied to clipboard (active-window paste fallback).',
      };
    }
  }
}
