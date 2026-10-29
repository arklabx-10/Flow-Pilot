import { describe, expect, it, vi } from 'vitest';
import {
  ActiveWindowAutoPasteService,
  computeLocalProductivityMetrics,
  countDictatedWords,
} from '../telemetryAndAutoPaste.js';
import type { DictationHistoryEntry } from '../types.js';

describe('Phase 6 — Local Productivity Telemetry & Active-Window Auto-Paste', () => {
  it('calculates word counts, time saved, and favorite output mode from local history', () => {
    expect(countDictatedWords('   ')).toBe(0);
    expect(countDictatedWords('Ship Phase 6 telemetry dashboard now')).toBe(6);

    const emptyMetrics = computeLocalProductivityMetrics([]);
    expect(emptyMetrics.totalSessions).toBe(0);
    expect(emptyMetrics.favoriteOutputMode).toBe('none');

    const entries: DictationHistoryEntry[] = [
      {
        id: '1',
        originalTranscript: 'hello world one two three',
        refinedTranscript: 'Hello world one two three.',
        editedText: 'Hello world one two three.',
        outputMode: 'coding-prompt',
        providerId: 'local-whisper-cpp',
        durationMs: 2500,
        createdAtUtc: '2026-10-29T18:00:00Z',
      },
      {
        id: '2',
        originalTranscript: 'second session with five words',
        refinedTranscript: 'Second session with five words.',
        editedText: 'Second session with five words.',
        outputMode: 'coding-prompt',
        providerId: 'local-whisper-cpp',
        durationMs: 3000,
        createdAtUtc: '2026-10-29T18:05:00Z',
      },
      {
        id: '3',
        originalTranscript: 'quick note',
        refinedTranscript: '• Quick note',
        editedText: 'Quick note',
        outputMode: 'quick-note',
        providerId: 'local-whisper-cpp',
        durationMs: 1200,
        createdAtUtc: '2026-10-29T18:10:00Z',
      },
    ];

    const metrics = computeLocalProductivityMetrics(entries);
    expect(metrics.totalSessions).toBe(3);
    expect(metrics.totalDurationMs).toBe(6700);
    expect(metrics.totalWordsDictated).toBe(12);
    expect(metrics.estimatedTimeSavedMinutes).toBeGreaterThan(0);
    expect(metrics.favoriteOutputMode).toBe('coding-prompt');
  });

  it('copies to clipboard and invokes native active-window paste when enabled', async () => {
    const copyText = vi.fn(async () => undefined);
    const invokeMock = vi.fn(async () => true);

    const service = new ActiveWindowAutoPasteService({
      clipboardService: { copyText },
      invokeOverride: invokeMock as unknown as <T>(
        cmd: string,
        args?: Record<string, unknown>,
      ) => Promise<T>,
    });

    const pastedResult = await service.copyAndAutoPaste('Injected dictation text.', true);
    expect(copyText).toHaveBeenCalledWith('Injected dictation text.');
    expect(invokeMock).toHaveBeenCalledWith('simulate_active_window_paste', {
      textLength: 24,
    });
    expect(pastedResult.copiedToClipboard).toBe(true);
    expect(pastedResult.injectedIntoActiveWindow).toBe(true);

    // Fallback when running in standard browser without Tauri runtime
    const browserFallbackService = new ActiveWindowAutoPasteService({
      clipboardService: { copyText },
      invokeOverride: null,
    });
    const fallbackResult = await browserFallbackService.copyAndAutoPaste(
      'Browser clipboard text.',
      true,
    );
    expect(fallbackResult.copiedToClipboard).toBe(true);
    expect(fallbackResult.injectedIntoActiveWindow).toBe(false);
  });
});
