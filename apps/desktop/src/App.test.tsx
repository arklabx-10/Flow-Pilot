import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import {
  DictationError,
  type AudioCaptureService,
  type ClipboardService,
  type TranscriptionProvider,
} from './dictation/types.js';
import { LocalDictationHistoryRepository } from './dictation/historyRepository.js';
import { DeterministicTextRefinementService } from './dictation/textRefinement.js';

function createTestServices(overrides?: {
  audioCapture?: Partial<AudioCaptureService>;
  provider?: Partial<TranscriptionProvider>;
  clipboard?: Partial<ClipboardService>;
}) {
  const audioCapture: AudioCaptureService = {
    startRecording: vi.fn().mockResolvedValue(undefined),
    stopRecording: vi.fn().mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3, 4]),
      mimeType: 'audio/webm',
      durationMs: 2200,
    }),
    abortRecording: vi.fn(),
    isRecording: vi.fn().mockReturnValue(false),
    ...overrides?.audioCapture,
  };

  const provider: TranscriptionProvider = {
    id: 'openai-whisper',
    displayName: 'OpenAI Whisper API (whisper-1)',
    isConfigured: vi.fn().mockReturnValue(true),
    transcribe: vi.fn().mockResolvedValue({
      transcript: 'um we should ship the dictation vertical slice today',
      providerId: 'openai-whisper',
    }),
    ...overrides?.provider,
  };

  const clipboard: ClipboardService = {
    copyText: vi.fn().mockResolvedValue(undefined),
    ...overrides?.clipboard,
  };

  const historyRepository = new LocalDictationHistoryRepository({
    storageKey: 'flowpilot_ui_test_history',
  });
  const textRefiner = new DeterministicTextRefinementService();

  return {
    audioCapture,
    provider,
    clipboard,
    historyRepository,
    textRefiner,
  };
}

describe('FlowPilot Desktop Dictation Vertical Slice UI', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('completes the full dictation workflow: record, transcribe, switch output modes, edit, copy, save, and search history', async () => {
    const services = createTestServices();
    render(<App services={services} />);

    // 1. Initial empty states
    expect(screen.getByRole('heading', { name: 'FlowPilot Desktop' })).toBeDefined();
    expect(screen.getByTestId('empty-transcript-state')).toBeDefined();
    await waitFor(() => {
      expect(screen.getByTestId('empty-history-state')).toBeDefined();
    });

    // 2. Start recording
    const recordBtn = screen.getByRole('button', { name: /start recording/i });
    fireEvent.click(recordBtn);

    await waitFor(() => {
      expect(screen.getByTestId('workflow-state-badge').textContent).toContain('recording');
    });

    // 3. Stop & Transcribe (defaults to Clean Text mode)
    const stopBtn = screen.getByRole('button', { name: /stop & transcribe/i });
    fireEvent.click(stopBtn);

    await waitFor(() => {
      expect(screen.getByTestId('workflow-state-badge').textContent).toContain('success');
    });

    // Original transcript is preserved separately from refined/edited output
    expect(screen.getByTestId('original-transcript-display').textContent).toBe(
      'um we should ship the dictation vertical slice today',
    );
    const editor = screen.getByLabelText(/editable output text/i) as HTMLTextAreaElement;
    expect(editor.value).toBe('We should ship the dictation vertical slice today.');

    // 4. Switch output mode to Coding Prompt and verify original transcript stays untouched
    const modeSelect = screen.getByLabelText(/output mode/i);
    fireEvent.change(modeSelect, { target: { value: 'coding-prompt' } });

    await waitFor(() => {
      expect(editor.value).toContain('## Task');
    });
    expect(screen.getByTestId('original-transcript-display').textContent).toBe(
      'um we should ship the dictation vertical slice today',
    );

    // 5. Edit text before copying and saving
    fireEvent.change(editor, {
      target: { value: 'Ship the dictation vertical slice with full unit tests.' },
    });

    const copyBtn = screen.getByRole('button', { name: /copy to clipboard/i });
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(services.clipboard.copyText).toHaveBeenCalledWith(
        'Ship the dictation vertical slice with full unit tests.',
      );
    });

    // 6. Save to local history and search
    const saveBtn = screen.getByRole('button', { name: /save to history/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByTestId('history-list').textContent).toContain(
        'Ship the dictation vertical slice with full unit tests.',
      );
    });

    const searchInput = screen.getByLabelText(/search history/i);
    fireEvent.change(searchInput, { target: { value: 'nonexistent-search-term-xyz' } });

    await waitFor(() => {
      expect(screen.getByTestId('empty-history-search-state')).toBeDefined();
    });

    fireEvent.change(searchInput, { target: { value: 'vertical slice' } });
    await waitFor(() => {
      expect(screen.getByTestId('history-list').textContent).toContain(
        'Ship the dictation vertical slice with full unit tests.',
      );
    });
  });

  it('displays the permission-denied UI state when microphone access is blocked', async () => {
    const services = createTestServices({
      audioCapture: {
        startRecording: vi
          .fn()
          .mockRejectedValue(
            new DictationError(
              'MIC_PERMISSION_DENIED',
              'Microphone permission was denied by Windows or the browser.',
            ),
          ),
      },
    });

    render(<App services={services} />);
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }));

    await waitFor(() => {
      expect(screen.getByTestId('permission-denied-banner')).toBeDefined();
    });
    expect(screen.getByRole('alert').textContent).toContain('Microphone permission');
  });

  it('supports keyboard Escape cancellation during recording and displays error states on provider failure', async () => {
    const services = createTestServices({
      provider: {
        transcribe: vi
          .fn()
          .mockRejectedValue(
            new DictationError('PROVIDER_AUTH_FAILED', 'Invalid OpenAI API key provided.'),
          ),
      },
    });

    render(<App services={services} />);
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }));

    await waitFor(() => {
      expect(screen.getByTestId('workflow-state-badge').textContent).toContain('recording');
    });

    // Press Escape to cancel active recording via keyboard
    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.getByTestId('workflow-state-badge').textContent).toContain('cancelled');
    });
    expect(services.audioCapture.abortRecording).toHaveBeenCalledTimes(1);

    // Record again and let provider fail
    fireEvent.click(screen.getByRole('button', { name: /start recording/i }));
    await waitFor(() => {
      expect(screen.getByTestId('workflow-state-badge').textContent).toContain('recording');
    });

    fireEvent.click(screen.getByRole('button', { name: /stop & transcribe/i }));
    await waitFor(() => {
      expect(screen.getByTestId('error-state-banner')).toBeDefined();
    });
    expect(screen.getByRole('alert').textContent).toContain('Invalid OpenAI API key provided.');
  });

  it('provides Phase 3 local vs cloud speech settings, explicit outbound audio notice, and local model management', async () => {
    const services = createTestServices();
    render(<App services={services} />);

    // Default speech provider is Local (no outbound audio notice)
    expect(screen.queryByTestId('outbound-audio-notice')).toBeNull();

    // Switch speech provider to Cloud and verify explicit outbound audio transfer notice appears
    const speechProviderSelect = screen.getByLabelText(/speech provider/i);
    fireEvent.change(speechProviderSelect, { target: { value: 'cloud' } });

    await waitFor(() => {
      expect(screen.getByTestId('outbound-audio-notice')).toBeDefined();
    });
    expect(screen.getByTestId('outbound-audio-notice').textContent).toContain(
      'Outbound Audio Notice',
    );

    // Independently configure Text-Refinement Provider, Language, Cloud Sync, and Recording Retention
    const refinementSelect = screen.getByLabelText(/text-refinement provider/i);
    fireEvent.change(refinementSelect, { target: { value: 'cloud' } });
    expect((refinementSelect as HTMLSelectElement).value).toBe('cloud');

    const languageSelect = screen.getByLabelText(/transcription language/i);
    fireEvent.change(languageSelect, { target: { value: 'es' } });
    expect((languageSelect as HTMLSelectElement).value).toBe('es');

    const syncToggle = screen.getByLabelText(
      /sync saved transcripts to cloud/i,
    ) as HTMLInputElement;
    expect(syncToggle.checked).toBe(false);
    fireEvent.click(syncToggle);
    expect(syncToggle.checked).toBe(true);

    const retainToggle = screen.getByLabelText(
      /retain audio recording in session/i,
    ) as HTMLInputElement;
    expect(retainToggle.checked).toBe(false);
    fireEvent.click(retainToggle);
    expect(retainToggle.checked).toBe(true);
  });
});
