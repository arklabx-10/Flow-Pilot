import {
  DictationError,
  type AudioCaptureService,
  type ClipboardService,
  type DictationHistoryEntry,
  type DictationHistoryRepository,
  type DictationWorkflowState,
  type OutputMode,
  type TextRefinementService,
  type TranscriptionProvider,
} from './types.js';

export interface DictationControllerDependencies {
  audioCapture: AudioCaptureService;
  provider: TranscriptionProvider;
  textRefiner: TextRefinementService;
  clipboard: ClipboardService;
  historyRepository: DictationHistoryRepository;
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
}

export type DictationListener = (snapshot: DictationSnapshot) => void;

export class DictationController {
  private readonly deps: DictationControllerDependencies;
  private readonly listeners = new Set<DictationListener>();
  private activeAbortController: AbortController | null = null;

  private snapshot: DictationSnapshot = {
    workflowState: 'idle',
    outputMode: 'clean',
    originalTranscript: '',
    refinedTranscript: '',
    editedText: '',
    lastDurationMs: 0,
    error: null,
    copiedToClipboard: false,
  };

  constructor(deps: DictationControllerDependencies) {
    this.deps = deps;
  }

  public getSnapshot(): DictationSnapshot {
    return { ...this.snapshot };
  }

  public subscribe(listener: DictationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
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
        this.updateSnapshot({ workflowState: 'cancelled', error: null });
        return;
      }

      this.updateSnapshot({
        workflowState: 'processing',
        lastDurationMs: audioPayload.durationMs,
      });

      const transcription = await this.deps.provider.transcribe(audioPayload, {
        signal: abortController.signal,
      });

      if (abortController.signal.aborted) {
        this.updateSnapshot({ workflowState: 'cancelled', error: null });
        return;
      }

      const refined = await this.deps.textRefiner.refine(transcription.transcript, mode, {
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

    const refined = await this.deps.textRefiner.refine(this.snapshot.originalTranscript, mode);
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
      const saved = await this.deps.historyRepository.saveEntry({
        originalTranscript: this.snapshot.originalTranscript,
        refinedTranscript: this.snapshot.refinedTranscript,
        editedText: this.snapshot.editedText,
        outputMode: this.snapshot.outputMode,
        providerId: this.deps.provider.id,
        durationMs: this.snapshot.lastDurationMs,
      });
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
