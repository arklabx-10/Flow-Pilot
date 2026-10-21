import { describe, expect, it, vi } from 'vitest';
import {
  LocalWhisperModelManager,
  LocalWhisperSpeechProvider,
  type LocalWhisperInferenceEngine,
} from '../localWhisperProvider.js';
import { DictationError } from '../types.js';

describe('LocalWhisperModelManager & LocalWhisperSpeechProvider', () => {
  const sampleAudio = {
    bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    mimeType: 'audio/webm',
    durationMs: 1600,
  };

  it('lists supported whisper.cpp GGML models and tracks download progress and cancellation', async () => {
    const progressEvents: number[] = [];
    const manager = new LocalWhisperModelManager({
      storageKey: 'flowpilot_test_models_1',
      downloader: async (_model, onProgress, signal) => {
        onProgress(25, 100);
        if (signal.aborted) {
          throw new DictationError('CANCELLED', 'Model download cancelled');
        }
        onProgress(100, 100);
      },
    });

    const initialModels = manager.listModels();
    expect(initialModels.map((m) => m.id)).toContain('tiny.en');
    expect(initialModels.map((m) => m.id)).toContain('base.en');
    expect(manager.getModelStatus('tiny.en').state).toBe('not-downloaded');

    await manager.downloadModel('tiny.en', (status) => {
      progressEvents.push(status.progressPercent);
    });

    expect(progressEvents).toContain(25);
    expect(progressEvents).toContain(100);
    expect(manager.getModelStatus('tiny.en').state).toBe('ready');
  });

  it('cancels an in-flight model download cleanly', async () => {
    const manager = new LocalWhisperModelManager({
      storageKey: 'flowpilot_test_models_cancel',
      downloader: (_model, onProgress, signal) => {
        onProgress(10, 100);
        return new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DictationError('CANCELLED', 'Cancelled by user'));
          });
        });
      },
    });

    const downloadPromise = manager.downloadModel('base.en');
    manager.cancelDownload('base.en');

    await expect(downloadPromise).rejects.toMatchObject({
      code: 'CANCELLED',
    });
    expect(manager.getModelStatus('base.en').state).toBe('not-downloaded');
  });

  it('fails with MODEL_NOT_DOWNLOADED when selected local model has not been downloaded', async () => {
    const manager = new LocalWhisperModelManager({
      storageKey: 'flowpilot_test_models_missing',
    });
    const engine: LocalWhisperInferenceEngine = {
      isAvailable: async () => true,
      transcribe: vi.fn(),
    };

    const provider = new LocalWhisperSpeechProvider({
      modelManager: manager,
      getSelectedModelId: () => 'tiny.en',
      engine,
    });

    expect(provider.requiresOutboundAudioTransfer).toBe(false);

    await expect(provider.transcribe(sampleAudio)).rejects.toMatchObject({
      code: 'MODEL_NOT_DOWNLOADED',
    });
  });

  it('fails honestly with LOCAL_ENGINE_UNAVAILABLE when native whisper.cpp runtime is not installed', async () => {
    const manager = new LocalWhisperModelManager({
      storageKey: 'flowpilot_test_models_no_engine',
      downloader: async (_model, onProgress) => {
        onProgress(100, 100);
      },
    });
    await manager.downloadModel('tiny.en');

    const unavailableEngine: LocalWhisperInferenceEngine = {
      isAvailable: async () => false,
      transcribe: vi.fn(),
    };

    const provider = new LocalWhisperSpeechProvider({
      modelManager: manager,
      getSelectedModelId: () => 'tiny.en',
      engine: unavailableEngine,
    });

    await expect(provider.transcribe(sampleAudio)).rejects.toMatchObject({
      code: 'LOCAL_ENGINE_UNAVAILABLE',
    });
  });

  it('executes local inference off-thread without network calls when model and engine are ready', async () => {
    const manager = new LocalWhisperModelManager({
      storageKey: 'flowpilot_test_models_ready',
      downloader: async (_model, onProgress) => {
        onProgress(100, 100);
      },
    });
    await manager.downloadModel('tiny.en');

    const engine: LocalWhisperInferenceEngine = {
      isAvailable: async () => true,
      transcribe: vi.fn().mockResolvedValue('Offline transcription from whisper.cpp tiny.en.'),
    };

    const provider = new LocalWhisperSpeechProvider({
      modelManager: manager,
      getSelectedModelId: () => 'tiny.en',
      engine,
    });

    const result = await provider.transcribe(sampleAudio, {
      language: 'en',
      translateToEnglish: false,
    });

    expect(result).toEqual({
      transcript: 'Offline transcription from whisper.cpp tiny.en.',
      providerId: 'local-whisper-cpp',
      language: 'en',
    });
    expect(engine.transcribe).toHaveBeenCalledTimes(1);
  });
});
