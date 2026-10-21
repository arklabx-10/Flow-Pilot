export type DictationErrorCode =
  | 'MIC_PERMISSION_DENIED'
  | 'MIC_NOT_FOUND'
  | 'MIC_UNSUPPORTED'
  | 'CAPTURE_FAILED'
  | 'EMPTY_RECORDING'
  | 'CANCELLED'
  | 'PROVIDER_UNCONFIGURED'
  | 'PROVIDER_AUTH_FAILED'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_NETWORK_ERROR'
  | 'PROVIDER_INVALID_RESPONSE'
  | 'REFINEMENT_FAILED'
  | 'CLIPBOARD_FAILED'
  | 'STORAGE_FAILED';

export class DictationError extends Error {
  public readonly code: DictationErrorCode;
  public readonly recoverable: boolean;

  constructor(code: DictationErrorCode, message: string, recoverable = true) {
    super(message);
    this.name = 'DictationError';
    this.code = code;
    this.recoverable = recoverable;
  }
}

export type OutputMode = 'raw' | 'clean' | 'professional' | 'coding-prompt' | 'quick-note';

export const OUTPUT_MODES: readonly OutputMode[] = [
  'raw',
  'clean',
  'professional',
  'coding-prompt',
  'quick-note',
] as const;

export const OUTPUT_MODE_LABELS: Readonly<Record<OutputMode, string>> = {
  raw: 'Raw Transcription',
  clean: 'Clean Text',
  professional: 'Professional Message',
  'coding-prompt': 'Coding Prompt',
  'quick-note': 'Quick Note',
};

export type DictationWorkflowState =
  | 'idle'
  | 'requesting-permission'
  | 'permission-denied'
  | 'recording'
  | 'stopping'
  | 'processing'
  | 'cancelled'
  | 'success'
  | 'error';

export interface RecordedAudioPayload {
  bytes: Uint8Array;
  mimeType: string;
  durationMs: number;
}

export interface TranscriptionResult {
  transcript: string;
  providerId: string;
  language?: string;
}

export interface AudioCaptureService {
  startRecording(): Promise<void>;
  stopRecording(): Promise<RecordedAudioPayload>;
  abortRecording(): void;
  isRecording(): boolean;
}

export interface TranscriptionOptions {
  signal?: AbortSignal;
  language?: string;
}

export interface TranscriptionProvider {
  readonly id: string;
  readonly displayName: string;
  isConfigured(): boolean;
  transcribe(
    audio: RecordedAudioPayload,
    options?: TranscriptionOptions,
  ): Promise<TranscriptionResult>;
}

/**
 * Documented extension contract for future providers (e.g. local whisper.cpp,
 * Azure AI Speech, Deepgram) in subsequent phases.
 */
export interface TranscriptionProviderRegistry {
  getActiveProvider(): TranscriptionProvider;
  listAvailableProviders(): ReadonlyArray<{
    id: string;
    displayName: string;
    configured: boolean;
  }>;
}

export interface TextRefinementOptions {
  signal?: AbortSignal;
}

export interface TextRefinementService {
  refine(
    originalTranscript: string,
    mode: OutputMode,
    options?: TextRefinementOptions,
  ): Promise<string>;
}

export interface ClipboardService {
  copyText(text: string): Promise<void>;
}

export interface NewDictationHistoryEntry {
  originalTranscript: string;
  refinedTranscript: string;
  editedText: string;
  outputMode: OutputMode;
  providerId: string;
  durationMs: number;
}

export interface DictationHistoryEntry extends NewDictationHistoryEntry {
  id: string;
  createdAtUtc: string;
}

export interface DictationHistoryRepository {
  saveEntry(entry: NewDictationHistoryEntry): Promise<DictationHistoryEntry>;
  listHistory(searchQuery?: string): Promise<DictationHistoryEntry[]>;
  deleteEntry(id: string): Promise<void>;
}
