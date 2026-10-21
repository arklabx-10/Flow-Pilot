import { invoke } from '@tauri-apps/api/core';
import {
  DictationError,
  type ISpeechRecognitionProvider,
  type LocalWhisperModelDescriptor,
  type LocalWhisperModelId,
  type LocalWhisperModelStatus,
  type RecordedAudioPayload,
  type TranscriptionOptions,
  type TranscriptionResult,
} from './types.js';

export const WHISPER_CPP_MODELS: readonly LocalWhisperModelDescriptor[] = [
  {
    id: 'tiny.en',
    displayName: 'Whisper Tiny (English-only, Fast)',
    fileName: 'ggml-tiny.en.bin',
    sizeMb: 75,
    estimatedRamMb: 270,
    multilingual: false,
    license: 'MIT',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
  },
  {
    id: 'tiny',
    displayName: 'Whisper Tiny (Multilingual)',
    fileName: 'ggml-tiny.bin',
    sizeMb: 75,
    estimatedRamMb: 270,
    multilingual: true,
    license: 'MIT',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
  },
  {
    id: 'base.en',
    displayName: 'Whisper Base (English-only, Balanced)',
    fileName: 'ggml-base.en.bin',
    sizeMb: 142,
    estimatedRamMb: 390,
    multilingual: false,
    license: 'MIT',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
  },
  {
    id: 'base',
    displayName: 'Whisper Base (Multilingual)',
    fileName: 'ggml-base.bin',
    sizeMb: 142,
    estimatedRamMb: 390,
    multilingual: true,
    license: 'MIT',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
  },
  {
    id: 'small.en',
    displayName: 'Whisper Small (English-only, High Accuracy)',
    fileName: 'ggml-small.en.bin',
    sizeMb: 466,
    estimatedRamMb: 850,
    multilingual: false,
    license: 'MIT',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
  },
] as const;

export type ModelDownloaderFn = (
  model: LocalWhisperModelDescriptor,
  onProgress: (downloadedBytes: number, totalBytes: number) => void,
  signal: AbortSignal,
) => Promise<void>;

export interface LocalWhisperModelManagerOptions {
  storageKey?: string;
  downloader?: ModelDownloaderFn;
}

const DEFAULT_MODEL_STORAGE_KEY = 'flowpilot_local_whisper_models_v1';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export class LocalWhisperModelManager {
  private readonly storageKey: string;
  private readonly downloader: ModelDownloaderFn;
  private readonly statuses = new Map<LocalWhisperModelId, LocalWhisperModelStatus>();
  private readonly activeDownloads = new Map<LocalWhisperModelId, AbortController>();

  constructor(options?: LocalWhisperModelManagerOptions) {
    this.storageKey = options?.storageKey ?? DEFAULT_MODEL_STORAGE_KEY;
    this.downloader = options?.downloader ?? defaultModelDownloader;
    this.initializeStatuses();
  }

  public listModels(): readonly LocalWhisperModelDescriptor[] {
    return WHISPER_CPP_MODELS;
  }

  public getModelDescriptor(modelId: LocalWhisperModelId): LocalWhisperModelDescriptor {
    const found = WHISPER_CPP_MODELS.find((m) => m.id === modelId);
    if (!found) {
      throw new DictationError('MODEL_LOAD_FAILED', `Unknown local model ID: ${modelId}`);
    }
    return found;
  }

  public getModelStatus(modelId: LocalWhisperModelId): LocalWhisperModelStatus {
    const status = this.statuses.get(modelId);
    if (!status) {
      const descriptor = this.getModelDescriptor(modelId);
      return {
        modelId,
        state: 'not-downloaded',
        progressPercent: 0,
        downloadedBytes: 0,
        totalBytes: descriptor.sizeMb * 1024 * 1024,
        errorMessage: null,
      };
    }
    return { ...status };
  }

  public async downloadModel(
    modelId: LocalWhisperModelId,
    onProgress?: (status: LocalWhisperModelStatus) => void,
  ): Promise<LocalWhisperModelStatus> {
    const descriptor = this.getModelDescriptor(modelId);
    this.cancelDownload(modelId);

    const abortController = new AbortController();
    this.activeDownloads.set(modelId, abortController);

    const totalBytes = descriptor.sizeMb * 1024 * 1024;
    this.setStatus(modelId, {
      modelId,
      state: 'downloading',
      progressPercent: 0,
      downloadedBytes: 0,
      totalBytes,
      errorMessage: null,
    });
    onProgress?.(this.getModelStatus(modelId));

    try {
      await this.downloader(
        descriptor,
        (downloaded, total) => {
          const safeTotal = total > 0 ? total : totalBytes;
          const percent = Math.min(100, Math.round((downloaded / safeTotal) * 100));
          this.setStatus(modelId, {
            modelId,
            state: 'downloading',
            progressPercent: percent,
            downloadedBytes: downloaded,
            totalBytes: safeTotal,
            errorMessage: null,
          });
          onProgress?.(this.getModelStatus(modelId));
        },
        abortController.signal,
      );

      if (abortController.signal.aborted) {
        throw new DictationError('CANCELLED', `Download of ${modelId} was cancelled.`);
      }

      const readyStatus: LocalWhisperModelStatus = {
        modelId,
        state: 'ready',
        progressPercent: 100,
        downloadedBytes: totalBytes,
        totalBytes,
        errorMessage: null,
      };
      this.setStatus(modelId, readyStatus);
      this.persistReadyModels();
      onProgress?.(this.getModelStatus(modelId));
      return this.getModelStatus(modelId);
    } catch (error) {
      if (
        abortController.signal.aborted ||
        (error instanceof DictationError && error.code === 'CANCELLED')
      ) {
        this.setStatus(modelId, {
          modelId,
          state: 'not-downloaded',
          progressPercent: 0,
          downloadedBytes: 0,
          totalBytes,
          errorMessage: null,
        });
        throw new DictationError('CANCELLED', `Download of model ${modelId} was cancelled.`);
      }

      const message =
        error instanceof Error ? error.message : 'Failed to download local speech model.';
      this.setStatus(modelId, {
        modelId,
        state: 'error',
        progressPercent: 0,
        downloadedBytes: 0,
        totalBytes,
        errorMessage: message,
      });
      throw new DictationError('MODEL_DOWNLOAD_FAILED', message);
    } finally {
      if (this.activeDownloads.get(modelId) === abortController) {
        this.activeDownloads.delete(modelId);
      }
    }
  }

  public cancelDownload(modelId: LocalWhisperModelId): void {
    const active = this.activeDownloads.get(modelId);
    if (active) {
      active.abort();
      this.activeDownloads.delete(modelId);
    }
  }

  private initializeStatuses(): void {
    const readySet = this.readPersistedReadyModels();
    for (const model of WHISPER_CPP_MODELS) {
      const totalBytes = model.sizeMb * 1024 * 1024;
      const isReady = readySet.has(model.id);
      this.statuses.set(model.id, {
        modelId: model.id,
        state: isReady ? 'ready' : 'not-downloaded',
        progressPercent: isReady ? 100 : 0,
        downloadedBytes: isReady ? totalBytes : 0,
        totalBytes,
        errorMessage: null,
      });
    }
  }

  private setStatus(modelId: LocalWhisperModelId, status: LocalWhisperModelStatus): void {
    this.statuses.set(modelId, status);
  }

  private readPersistedReadyModels(): Set<LocalWhisperModelId> {
    if (typeof window === 'undefined' || !window.localStorage) {
      return new Set();
    }
    const raw = window.localStorage.getItem(this.storageKey);
    if (!raw) {
      return new Set();
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? new Set(parsed as LocalWhisperModelId[]) : new Set();
    } catch {
      return new Set();
    }
  }

  private persistReadyModels(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    const readyIds: LocalWhisperModelId[] = [];
    for (const [id, status] of this.statuses.entries()) {
      if (status.state === 'ready') {
        readyIds.push(id);
      }
    }
    window.localStorage.setItem(this.storageKey, JSON.stringify(readyIds));
  }
}

async function defaultModelDownloader(
  model: LocalWhisperModelDescriptor,
  onProgress: (downloadedBytes: number, totalBytes: number) => void,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    throw new DictationError('CANCELLED', 'Model download cancelled.');
  }
  if (isTauriRuntime()) {
    await invoke('download_local_whisper_model', {
      modelId: model.id,
      fileName: model.fileName,
      downloadUrl: model.downloadUrl,
    });
    const total = model.sizeMb * 1024 * 1024;
    onProgress(total, total);
    return;
  }

  throw new DictationError(
    'LOCAL_ENGINE_UNAVAILABLE',
    `Local model download for ${model.fileName} requires the native Tauri Windows runtime so model files can be stored in AppLocalData/models outside the browser sandbox.`,
  );
}

export interface LocalWhisperInferenceEngine {
  isAvailable(): Promise<boolean>;
  transcribe(params: {
    model: LocalWhisperModelDescriptor;
    audio: RecordedAudioPayload;
    language?: string;
    translateToEnglish?: boolean;
    signal?: AbortSignal;
  }): Promise<string>;
}

/**
 * Default native Tauri bridge to whisper.cpp (`whisper-cli`).
 * Runs inference on a background thread via Tauri command without blocking the UI.
 */
export class TauriWhisperCppEngine implements LocalWhisperInferenceEngine {
  public async isAvailable(): Promise<boolean> {
    if (!isTauriRuntime()) {
      return false;
    }
    try {
      return await invoke<boolean>('check_local_whisper_engine');
    } catch {
      return false;
    }
  }

  public async transcribe(params: {
    model: LocalWhisperModelDescriptor;
    audio: RecordedAudioPayload;
    language?: string;
    translateToEnglish?: boolean;
    signal?: AbortSignal;
  }): Promise<string> {
    if (params.signal?.aborted) {
      throw new DictationError('CANCELLED', 'Local transcription was cancelled.');
    }

    const transcript = await invoke<string>('transcribe_local_whisper', {
      modelFileName: params.model.fileName,
      audioBytes: Array.from(params.audio.bytes),
      language: params.language ?? 'auto',
      translateToEnglish: Boolean(params.translateToEnglish),
    });

    if (params.signal?.aborted) {
      throw new DictationError('CANCELLED', 'Local transcription was cancelled.');
    }

    return transcript;
  }
}

export interface LocalWhisperSpeechProviderOptions {
  modelManager: LocalWhisperModelManager;
  getSelectedModelId: () => LocalWhisperModelId;
  engine?: LocalWhisperInferenceEngine;
}

/**
 * Local offline speech recognition provider backed by whisper.cpp GGML models.
 * Never transmits audio over the network and never fakes transcription output.
 */
export class LocalWhisperSpeechProvider implements ISpeechRecognitionProvider {
  public readonly id = 'local-whisper-cpp';
  public readonly displayName = 'Local whisper.cpp (On-Device Offline)';
  public readonly requiresOutboundAudioTransfer = false;

  private readonly modelManager: LocalWhisperModelManager;
  private readonly getSelectedModelId: () => LocalWhisperModelId;
  private readonly engine: LocalWhisperInferenceEngine;

  constructor(options: LocalWhisperSpeechProviderOptions) {
    this.modelManager = options.modelManager;
    this.getSelectedModelId = options.getSelectedModelId;
    this.engine = options.engine ?? new TauriWhisperCppEngine();
  }

  public isConfigured(): boolean {
    const modelId = this.getSelectedModelId();
    return this.modelManager.getModelStatus(modelId).state === 'ready';
  }

  public async transcribe(
    audio: RecordedAudioPayload,
    options?: TranscriptionOptions,
  ): Promise<TranscriptionResult> {
    if (options?.signal?.aborted) {
      throw new DictationError('CANCELLED', 'Local transcription was cancelled before starting.');
    }

    if (!audio.bytes || audio.bytes.byteLength === 0) {
      throw new DictationError(
        'EMPTY_RECORDING',
        'Cannot transcribe an empty audio recording (0 bytes).',
      );
    }

    const modelId = this.getSelectedModelId();
    const descriptor = this.modelManager.getModelDescriptor(modelId);
    const status = this.modelManager.getModelStatus(modelId);

    if (status.state !== 'ready') {
      throw new DictationError(
        'MODEL_NOT_DOWNLOADED',
        `Local Whisper model '${descriptor.displayName}' (${descriptor.fileName}) is not downloaded yet. Download the model in Settings or switch to Cloud Speech mode.`,
      );
    }

    const engineReady = await this.engine.isAvailable();
    if (!engineReady) {
      throw new DictationError(
        'LOCAL_ENGINE_UNAVAILABLE',
        'Local whisper.cpp engine (whisper-cli + native Tauri runtime) is not installed or active in this environment. See docs/local-speech-models.md for installation instructions.',
      );
    }

    try {
      const rawTranscript = await this.engine.transcribe({
        model: descriptor,
        audio,
        language: options?.language,
        translateToEnglish: options?.translateToEnglish,
        signal: options?.signal,
      });

      const trimmed = rawTranscript.trim();
      if (!trimmed) {
        throw new DictationError(
          'PROVIDER_INVALID_RESPONSE',
          'Local whisper.cpp engine detected no speech in the recording.',
        );
      }

      return {
        transcript: trimmed,
        providerId: this.id,
        language: options?.language,
      };
    } catch (error) {
      if (error instanceof DictationError) {
        throw error;
      }
      if (options?.signal?.aborted) {
        throw new DictationError('CANCELLED', 'Local transcription was cancelled.');
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new DictationError(
        'MODEL_LOAD_FAILED',
        `Local whisper.cpp inference failed: ${detail}`,
      );
    }
  }
}
