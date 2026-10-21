import { DEFAULT_DICTATION_SETTINGS, DictationSettingsRepository } from './settingsRepository.js';
import {
  DictationError,
  type AudioCaptureService,
  type ClipboardService,
  type DictationHistoryEntry,
  type DictationHistoryRepository,
  type DictationSettings,
  type DictationWorkflowState,
  type ISpeechRecognitionProvider,
  type OutputMode,
  type TextRefinementService,
} from './types.js';

export interface DictationControllerDependencies {
  audioCapture: AudioCaptureService;
  provider: ISpeechRecognitionProvider;
  localSpeechProvider?: ISpeechRecognitionProvider;
  cloudSpeechProvider?: ISpeechRecognitionProvider;
  textRefiner: TextRefinementService;
  localTextRefiner?: TextRefinementService;
  cloudTextRefiner?: TextRefinementService;
  clipboard: ClipboardService;
  historyRepository: DictationHistoryRepository;
  settingsRepository?: DictationSettingsRepository;
  syncTranscriptToCloud?: (entry: DictationHistoryEntry) => Promise<void>;
}

export interface DictationSnapshot {
  workflowState: DictationWorkflowState;
  outputMode: OutputMode;
  originalTranscript: string;
  refinedTranscript: string;
  editedText: string;
  lastDurationMs: number;
  error: DictationError | null;
  copiedToClipboard: boolean;
  settings: DictationSettings;
  retainedAudioBytes: number | null;
}

export type DictationListener = (snapshot: DictationSnapshot) => void;

export class DictationController {
  private readonly deps: DictationControllerDependencies;
  private readonly settingsRepo: DictationSettingsRepository;
  private readonly listeners = new Set<DictationListener>();
  private activeAbortController: AbortController | null = null;

  private snapshot: DictationSnapshot;

  constructor(deps: DictationControllerDependencies) {
    this.deps = deps;
    this.settingsRepo = deps.settingsRepository ?? new DictationSettingsRepository();
    this.snapshot = {
      workflowState: 'idle',
      outputMode: 'clean',
      originalTranscript: '',
      refinedTranscript: '',
      editedText: '',
      lastDurationMs: 0,
      error: null,
      copiedToClipboard: false,
      settings: this.settingsRepo
        ? this.settingsRepo.loadSettings()
        : { ...DEFAULT_DICTATION_SETTINGS },
      retainedAudioBytes: null,
    };
  }

  public getSnapshot(): DictationSnapshot {
    return {
      ...this.snapshot,
      settings: { ...this.snapshot.settings },
    };
  }

  public getActiveSpeechProvider(): ISpeechRecognitionProvider {
    if (this.snapshot.settings.speechProviderMode === 'cloud' && this.deps.cloudSpeechProvider) {
      return this.deps.cloudSpeechProvider;
    }
    if (this.snapshot.settings.speechProviderMode === 'local' && this.deps.localSpeechProvider) {
      return this.deps.localSpeechProvider;
    }
    return this.deps.provider;
  }

  public getActiveTextRefiner(): TextRefinementService {
    if (this.snapshot.settings.refinementProviderMode === 'cloud' && this.deps.cloudTextRefiner) {
      return this.deps.cloudTextRefiner;
    }
    if (this.snapshot.settings.refinementProviderMode === 'local' && this.deps.localTextRefiner) {
      return this.deps.localTextRefiner;
    }
    return this.deps.textRefiner;
  }

  public subscribe(listener: DictationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public updateSettings(partial: Partial<DictationSettings>): DictationSettings {
    const updated = this.settingsRepo.updateSettings(partial);
    this.updateSnapshot({
      settings: updated,
      retainedAudioBytes: updated.retainRecordings ? this.snapshot.retainedAudioBytes : null,
    });
    return updated;
  }

  public async startRecording(): Promise<void> {
    this.activeAbortController?.abort();
    this.activeAbortController = null;

    this.updateSnapshot({
      workflowState: 'requesting-permission',
      error: null,
      copiedToClipboard: false,
    });

    try {
      await this.deps.audioCapture.startRecording();
      this.updateSnapshot({
        workflowState: 'recording',
        error: null,
      });
    } catch (error) {
      const dictationErr = toDictationError(error, 'CAPTURE_FAILED');
      this.updateSnapshot({
        workflowState:
          dictationErr.code === 'MIC_PERMISSION_DENIED' ? 'permission-denied' : 'error',
        error: dictationErr,
      });
    }
  }

  public async stopRecording(preferredMode?: OutputMode): Promise<void> {
    const mode = preferredMode ?? this.snapshot.outputMode;
    const abortController = new AbortController();
    this.activeAbortController = abortController;

    this.updateSnapshot({
      workflowState: 'stopping',
      outputMode: mode,
      error: null,
      copiedToClipboard: false,
    });

    try {
      const audioPayload = await this.deps.audioCapture.stopRecording();
      if (abortController.signal.aborted) {
        audioPayload.bytes.fill(0);
        this.updateSnapshot({ workflowState: 'cancelled', error: null });
        return;
      }

      const capturedByteLength = audioPayload.bytes.byteLength;
      this.updateSnapshot({
        workflowState: 'processing',
        lastDurationMs: audioPayload.durationMs,
      });

      const activeSpeechProvider = this.getActiveSpeechProvider();
      const activeRefiner = this.getActiveTextRefiner();

      let transcription;
      try {
        transcription = await activeSpeechProvider.transcribe(audioPayload, {
          signal: abortController.signal,
          language: this.snapshot.settings.language,
          translateToEnglish: this.snapshot.settings.translateToEnglish,
        });
      } finally {
        if (!this.snapshot.settings.retainRecordings) {
          audioPayload.bytes.fill(0);
        }
      }

      if (abortController.signal.aborted) {
        this.updateSnapshot({ workflowState: 'cancelled', error: null });
        return;
      }

      const refined = await activeRefiner.refine(transcription.transcript, mode, {
        signal: abortController.signal,
      });

      if (abortController.signal.aborted) {
        this.updateSnapshot({ workflowState: 'cancelled', error: null });
        return;
      }

      this.updateSnapshot({
        workflowState: 'success',
        outputMode: mode,
        originalTranscript: transcription.transcript,
        refinedTranscript: refined,
        editedText: refined,
        retainedAudioBytes: this.snapshot.settings.retainRecordings ? capturedByteLength : null,
        error: null,
      });
    } catch (error) {
      const dictationErr = toDictationError(error, 'PROVIDER_NETWORK_ERROR');
      if (dictationErr.code === 'CANCELLED' || abortController.signal.aborted) {
        this.updateSnapshot({
          workflowState: 'cancelled',
          error: null,
        });
        return;
      }

      this.updateSnapshot({
        workflowState:
          dictationErr.code === 'MIC_PERMISSION_DENIED' ? 'permission-denied' : 'error',
        error: dictationErr,
      });
    } finally {
      if (this.activeAbortController === abortController) {
        this.activeAbortController = null;
      }
    }
  }

  public cancel(): void {
    const state = this.snapshot.workflowState;
    if (
      state !== 'recording' &&
      state !== 'requesting-permission' &&
      state !== 'stopping' &&
      state !== 'processing'
    ) {
      return;
    }

    this.deps.audioCapture.abortRecording();
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }

    this.updateSnapshot({
      workflowState: 'cancelled',
      error: null,
    });
  }

  public async setOutputMode(mode: OutputMode): Promise<void> {
    this.updateSnapshot({
      outputMode: mode,
      copiedToClipboard: false,
    });

    if (!this.snapshot.originalTranscript) {
      return;
    }

    const activeRefiner = this.getActiveTextRefiner();
    const refined = await activeRefiner.refine(this.snapshot.originalTranscript, mode);
    this.updateSnapshot({
      outputMode: mode,
      refinedTranscript: refined,
      editedText: refined,
      copiedToClipboard: false,
    });
  }

  public updateEditedText(nextText: string): void {
    this.updateSnapshot({
      editedText: nextText,
      copiedToClipboard: false,
    });
  }

  public resetEditedToOriginal(): void {
    if (!this.snapshot.originalTranscript) {
      return;
    }
    this.updateSnapshot({
      editedText: this.snapshot.originalTranscript,
      copiedToClipboard: false,
    });
  }

  public async copyEditedText(): Promise<void> {
    try {
      await this.deps.clipboard.copyText(this.snapshot.editedText);
      this.updateSnapshot({
        copiedToClipboard: true,
        error: null,
      });
    } catch (error) {
      const dictationErr = toDictationError(error, 'CLIPBOARD_FAILED');
      this.updateSnapshot({
        copiedToClipboard: false,
        error: dictationErr,
      });
      throw dictationErr;
    }
  }

  public async saveCurrentSession(): Promise<DictationHistoryEntry> {
    try {
      const activeProvider = this.getActiveSpeechProvider();
      const saved = await this.deps.historyRepository.saveEntry({
        originalTranscript: this.snapshot.originalTranscript,
        refinedTranscript: this.snapshot.refinedTranscript,
        editedText: this.snapshot.editedText,
        outputMode: this.snapshot.outputMode,
        providerId: activeProvider.id,
        durationMs: this.snapshot.lastDurationMs,
      });

      if (this.snapshot.settings.syncTranscriptsToCloud && this.deps.syncTranscriptToCloud) {
        await this.deps.syncTranscriptToCloud(saved);
      }

      this.updateSnapshot({ error: null });
      return saved;
    } catch (error) {
      const dictationErr = toDictationError(error, 'STORAGE_FAILED');
      this.updateSnapshot({ error: dictationErr });
      throw dictationErr;
    }
  }

  private updateSnapshot(partial: Partial<DictationSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...partial,
    };
    const current = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(current);
    }
  }
}

function toDictationError(error: unknown, fallbackCode: DictationError['code']): DictationError {
  if (error instanceof DictationError) {
    return error;
  }
  const message = error instanceof Error ? error.message : 'Unexpected dictation error';
  return new DictationError(fallbackCode, message);
}
