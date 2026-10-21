import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemClipboardService } from '../clipboardService.js';
import { LocalDictationHistoryRepository } from '../historyRepository.js';

describe('SystemClipboardService', () => {
  it('writes non-empty text to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const service = new SystemClipboardService({ writeText });

    await service.copyText('Refined transcript ready to paste');
    expect(writeText).toHaveBeenCalledWith('Refined transcript ready to paste');
  });

  it('throws CLIPBOARD_FAILED when text is empty or underlying clipboard rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard locked by OS'));
    const service = new SystemClipboardService({ writeText });

    await expect(service.copyText('   ')).rejects.toMatchObject({
      code: 'CLIPBOARD_FAILED',
    });

    await expect(service.copyText('Valid text')).rejects.toMatchObject({
      code: 'CLIPBOARD_FAILED',
    });
  });
});

describe('LocalDictationHistoryRepository', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('saves transcripts without raw audio, preserves original vs refined/edited text, and supports search', async () => {
    const repo = new LocalDictationHistoryRepository({ storageKey: 'flowpilot_test_history' });

    const first = await repo.saveEntry({
      originalTranscript: 'um schedule architecture review for tomorrow',
      refinedTranscript: 'Schedule architecture review for tomorrow.',
      editedText: 'Schedule architecture review for Thursday at 10 AM.',
      outputMode: 'clean',
      providerId: 'openai-whisper',
      durationMs: 2400,
    });

    const second = await repo.saveEntry({
      originalTranscript: 'fix sqlite wal mode locking in desktop crate',
      refinedTranscript: '## Task\nFix sqlite wal mode locking in desktop crate.',
      editedText: '## Task\nFix sqlite wal mode locking in desktop crate.',
      outputMode: 'coding-prompt',
      providerId: 'openai-whisper',
      durationMs: 3100,
    });

    expect(first.originalTranscript).toBe('um schedule architecture review for tomorrow');
    expect(first.refinedTranscript).toBe('Schedule architecture review for tomorrow.');
    expect(first.editedText).toBe('Schedule architecture review for Thursday at 10 AM.');
    expect('bytes' in (first as unknown as Record<string, unknown>)).toBe(false);

    const all = await repo.listHistory();
    expect(all).toHaveLength(2);
    expect(all[0]?.id).toBe(second.id);

    const filteredByEdited = await repo.listHistory('Thursday');
    expect(filteredByEdited).toHaveLength(1);
    expect(filteredByEdited[0]?.id).toBe(first.id);

    const filteredByOriginal = await repo.listHistory('sqlite wal mode');
    expect(filteredByOriginal).toHaveLength(1);
    expect(filteredByOriginal[0]?.id).toBe(second.id);

    await repo.deleteEntry(first.id);
    const remaining = await repo.listHistory();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(second.id);
  });
});
