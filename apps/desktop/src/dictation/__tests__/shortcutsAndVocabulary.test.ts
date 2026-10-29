import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VocabularyEntryRecordV1 } from '@flowpilot/contracts';
import {
  CustomVocabularyService,
  DEFAULT_SHORTCUT_PREFERENCES,
  ShortcutPreferencesRepository,
  applyVocabularyReplacements,
  matchesHotkeyEvent,
} from '../shortcutsAndVocabulary.js';

describe('ShortcutPreferencesRepository & CustomVocabularyService (Phase 5)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('loads default Windows global shortcut & system tray preferences and validates updates', () => {
    const repo = new ShortcutPreferencesRepository();
    const initial = repo.loadPreferences();

    expect(initial).toEqual(DEFAULT_SHORTCUT_PREFERENCES);
    expect(initial.toggleRecordingHotkey).toBe('Ctrl+Shift+Space');
    expect(initial.copyLastOutputHotkey).toBe('Ctrl+Shift+C');
    expect(initial.minimizeToTrayOnClose).toBe(true);

    const updated = repo.updatePreferences({
      toggleRecordingHotkey: 'Ctrl+Alt+D',
      minimizeToTrayOnClose: false,
    });
    expect(updated.toggleRecordingHotkey).toBe('Ctrl+Alt+D');
    expect(updated.minimizeToTrayOnClose).toBe(false);

    // Rejects duplicate conflicting hotkeys
    expect(() =>
      repo.updatePreferences({
        toggleRecordingHotkey: 'Ctrl+Shift+C',
        copyLastOutputHotkey: 'Ctrl+Shift+C',
      }),
    ).toThrow(/conflict/i);
  });

  it('matches KeyboardEvents against configured hotkey strings', () => {
    const toggleEvent = new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      ctrlKey: true,
      shiftKey: true,
    });
    expect(matchesHotkeyEvent(toggleEvent, 'Ctrl+Shift+Space')).toBe(true);
    expect(matchesHotkeyEvent(toggleEvent, 'Ctrl+Shift+C')).toBe(false);

    const copyEvent = new KeyboardEvent('keydown', {
      key: 'C',
      code: 'KeyC',
      ctrlKey: true,
      shiftKey: true,
    });
    expect(matchesHotkeyEvent(copyEvent, 'Ctrl+Shift+C')).toBe(true);
  });

  it('applies case-insensitive custom vocabulary replacements on word boundaries', () => {
    const entries: VocabularyEntryRecordV1[] = [
      {
        id: 'voc-1',
        spokenPhrase: 'flow pilot',
        replacementTerm: 'FlowPilot',
        category: 'Product',
        updatedAtUtc: '2026-10-29T18:00:00Z',
      },
      {
        id: 'voc-2',
        spokenPhrase: 'post gres',
        replacementTerm: 'PostgreSQL',
        category: 'Engineering',
        updatedAtUtc: '2026-10-29T18:00:00Z',
      },
    ];

    const input = 'We built flow pilot with a post gres backend for FLOW PILOT users.';
    const output = applyVocabularyReplacements(input, entries);

    expect(output).toBe('We built FlowPilot with a PostgreSQL backend for FlowPilot users.');
  });

  it('stores custom vocabulary locally and synchronizes with /api/v1/vocabulary when cloud sync is enabled', async () => {
    const serverVocab: VocabularyEntryRecordV1[] = [
      {
        id: 'voc-remote-1',
        spokenPhrase: 'tauri two',
        replacementTerm: 'Tauri 2',
        category: 'Framework',
        updatedAtUtc: '2026-10-29T18:00:00Z',
      },
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (method === 'PUT' && url.includes('/api/v1/vocabulary/')) {
        const id = url.split('/api/v1/vocabulary/')[1];
        const body = JSON.parse(String(init?.body)) as {
          spokenPhrase: string;
          replacementTerm: string;
          category: string;
        };
        const record: VocabularyEntryRecordV1 = {
          id,
          spokenPhrase: body.spokenPhrase,
          replacementTerm: body.replacementTerm,
          category: body.category,
          updatedAtUtc: '2026-10-29T18:05:00Z',
        };
        serverVocab.push(record);
        return new Response(JSON.stringify(record), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'GET' && url.includes('/api/v1/vocabulary')) {
        return new Response(JSON.stringify(serverVocab), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(null, { status: 404 });
    });

    const service = new CustomVocabularyService({
      apiBaseUrl: 'http://localhost:5080',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const added = service.upsertLocalEntry({
      spokenPhrase: 'whisper cpp',
      replacementTerm: 'whisper.cpp',
      category: 'Speech Engine',
    });
    expect(added.replacementTerm).toBe('whisper.cpp');
    expect(service.listEntries()).toHaveLength(1);

    await service.syncWithCloud('valid-token');
    const merged = service.listEntries();
    expect(merged).toHaveLength(2);
    expect(merged.map((m) => m.replacementTerm).sort()).toEqual(['Tauri 2', 'whisper.cpp']);
  });
});
