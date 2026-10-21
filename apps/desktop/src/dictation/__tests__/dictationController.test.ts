import { describe, expect, it, vi } from 'vitest';
import { DictationController } from '../dictationController.js';
import { LocalDictationHistoryRepository } from '../historyRepository.js';
import { DeterministicTextRefinementService } from '../textRefinement.js';
import {
  DictationError,
  type AudioCaptureService,
  type ClipboardService,
  type RecordedAudioPayload,
  type TranscriptionProvider,
} from '../types.js';

function createMockDependencies(overrides?: {
  audioCapture?: Partial<AudioCaptureService>;
  provider?: Partial<TranscriptionProvider>;
  clipboard?: Partial<ClipboardService>;
}) {
  const sampleAudio: RecordedAudioPayload = {
    bytes: new Uint8Array([1, 2, 3, 4]),
    mimeType: 'audio/webm',
    durationMs: 1800,
  };

  const audioCapture: AudioCaptureService = {
    startRecording: vi.fn().mockResolvedValue(undefined),
    stopRecording: vi.fn().mockResolvedValue(sampleAudio),
    abortRecording: vi.fn(),
    isRecording: vi.fn().mockReturnValue(false),
    ...overrides?.audioCapture,
  };

  const provider: TranscriptionProvider = {
    id: 'openai-whisper',
    displayName: 'OpenAI Whisper API (whisper-1)',
    isConfigured: vi.fn().mockReturnValue(true),
    transcribe: vi.fn().mockResolvedValue({
      transcript: 'um please deploy the new health check endpoint',
      providerId: 'openai-whisper',
    }),
    ...overrides?.provider,
  };

  const clipboard: ClipboardService = {
    copyText: vi.fn().mockResolvedValue(undefined),
    ...overrides?.clipboard,
  };

  window.localStorage.clear();
  const historyRepository = new LocalDictationHistoryRepository({
    storageKey: 'flowpilot_controller_test',
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

describe('DictationController', () => {
  it('transitions through recording, stopping, processing, and success while separating original and refined text', async () => {
    const deps = createMockDependencies();
    const observedStates: string[] = [];

    const controller = new DictationController(deps);
    controller.subscribe((snapshot) => {
      if (observedStates[observedStates.length - 1] !== snapshot.workflowState) {
        observedStates.push(snapshot.workflowState);
      }
    });

    await controller.startRecording();
    expect(controller.getSnapshot().workflowState).toBe('recording');

    await controller.stopRecording('clean');
    const finalSnapshot = controller.getSnapshot();

    expect(observedStates).toEqual([
      'requesting-permission',
      'recording',
      'stopping',
      'processing',
      'success',
    ]);
    expect(finalSnapshot.originalTranscript).toBe('um please deploy the new health check endpoint');
    expect(finalSnapshot.refinedTranscript).toBe('Please deploy the new health check endpoint.');
    expect(finalSnapshot.editedText).toBe('Please deploy the new health check endpoint.');

    // Switching output mode updates refinedTranscript & editedText while keeping originalTranscript intact
    await controller.setOutputMode('coding-prompt');
    const afterModeSwitch = controller.getSnapshot();
    expect(afterModeSwitch.originalTranscript).toBe(
      'um please deploy the new health check endpoint',
    );
    expect(afterModeSwitch.refinedTranscript).toContain('## Task');

    // Editing text before copying and saving
    controller.updateEditedText('Custom edited text before saving.');
    await controller.copyEditedText();
    expect(deps.clipboard.copyText).toHaveBeenCalledWith('Custom edited text before saving.');

    const saved = await controller.saveCurrentSession();
    expect(saved.originalTranscript).toBe('um please deploy the new health check endpoint');
    expect(saved.editedText).toBe('Custom edited text before saving.');
  });

  it('transitions to permission-denied when microphone permission is rejected', async () => {
    const deps = createMockDependencies({
      audioCapture: {
        startRecording: vi
          .fn()
          .mockRejectedValue(
            new DictationError('MIC_PERMISSION_DENIED', 'Microphone permission denied'),
          ),
      },
    });

    const controller = new DictationController(deps);
    await controller.startRecording();

    expect(controller.getSnapshot().workflowState).toBe('permission-denied');
    expect(controller.getSnapshot().error?.code).toBe('MIC_PERMISSION_DENIED');
  });

  it('cancels active recording and transitions to cancelled', async () => {
    const deps = createMockDependencies();
    const controller = new DictationController(deps);

    await controller.startRecording();
    controller.cancel();

    expect(deps.audioCapture.abortRecording).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().workflowState).toBe('cancelled');
  });

  it('propagates cancellation through async transcription processing', async () => {
    let capturedSignal: AbortSignal | undefined;
    const deps = createMockDependencies({
      provider: {
        transcribe: vi.fn().mockImplementation((_audio, options?: { signal?: AbortSignal }) => {
          capturedSignal = options?.signal;
          return new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => {
              reject(new DictationError('CANCELLED', 'Transcription cancelled by user'));
            });
          });
        }),
      },
    });

    const controller = new DictationController(deps);
    await controller.startRecording();

    const stopPromise = controller.stopRecording('raw');
    // Wait a microtask for stopRecording to enter processing
    await Promise.resolve();
    controller.cancel();
    await stopPromise;

    expect(capturedSignal?.aborted).toBe(true);
    expect(controller.getSnapshot().workflowState).toBe('cancelled');
  });

  it('handles provider failures, empty recordings, and clipboard failures explicitly', async () => {
    const emptyDeps = createMockDependencies({
      audioCapture: {
        stopRecording: vi
          .fn()
          .mockRejectedValue(new DictationError('EMPTY_RECORDING', 'No audio captured')),
      },
    });

    const emptyController = new DictationController(emptyDeps);
    await emptyController.startRecording();
    await emptyController.stopRecording();
    expect(emptyController.getSnapshot().workflowState).toBe('error');
    expect(emptyController.getSnapshot().error?.code).toBe('EMPTY_RECORDING');

    const failClipboardDeps = createMockDependencies({
      clipboard: {
        copyText: vi
          .fn()
          .mockRejectedValue(new DictationError('CLIPBOARD_FAILED', 'Clipboard unavailable')),
      },
    });

    const clipController = new DictationController(failClipboardDeps);
    await clipController.startRecording();
    await clipController.stopRecording('clean');
    await expect(clipController.copyEditedText()).rejects.toMatchObject({
      code: 'CLIPBOARD_FAILED',
    });
    expect(clipController.getSnapshot().error?.code).toBe('CLIPBOARD_FAILED');
    // Preserves transcript even if clipboard fails
    expect(clipController.getSnapshot().originalTranscript).toBe(
      'um please deploy the new health check endpoint',
    );
  });
});
