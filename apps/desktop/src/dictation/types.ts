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
  | 'PROVIDER_TIMEOUT'
  | 'USAGE_LIMIT_EXCEEDED'
  | 'PROVIDER_NETWORK_ERROR'
  | 'PROVIDER_INVALID_RESPONSE'
  | 'MODEL_NOT_DOWNLOADED'
  | 'MODEL_DOWNLOAD_FAILED'
  | 'MODEL_LOAD_FAILED'
  | 'LOCAL_ENGINE_UNAVAILABLE'
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

export type SpeechProviderMode = 'local' | 'cloud';
export type RefinementProviderMode = 'local' | 'cloud';

export type LocalWhisperModelId = 'tiny.en' | 'tiny' | 'base.en' | 'base' | 'small.en';

export type LocalModelState = 'not-downloaded' | 'downloading' | 'ready' | 'loading' | 'error';

export interface LocalWhisperModelDescriptor {
  id: LocalWhisperModelId;
  displayName: string;
  fileName: string;
  sizeMb: number;
  estimatedRamMb: number;
  multilingual: boolean;
  license: 'MIT';
  downloadUrl: string;
}

export interface LocalWhisperModelStatus {
  modelId: LocalWhisperModelId;
  state: LocalModelState;
  progressPercent: number;
  downloadedBytes: number;
  totalBytes: number;
  errorMessage: string | null;
}

export type TranscriptionLanguage = 'auto' | 'en' | 'es' | 'fr' | 'de' | 'ur' | 'ja';

export const SUPPORTED_LANGUAGES: ReadonlyArray<{
  code: TranscriptionLanguage;
  label: string;
}> = [
  { code: 'auto', label: 'Auto-Detect' },
  { code: 'en', label: 'English (en)' },
  { code: 'es', label: 'Spanish (es)' },
  { code: 'fr', label: 'French (fr)' },
  { code: 'de', label: 'German (de)' },
  { code: 'ur', label: 'Urdu (ur)' },
  { code: 'ja', label: 'Japanese (ja)' },
];

export interface DictationSettings {
  speechProviderMode: SpeechProviderMode;
  selectedLocalModelId: LocalWhisperModelId;
  selectedCloudProviderId: string;
  language: TranscriptionLanguage;
  translateToEnglish: boolean;
  refinementProviderMode: RefinementProviderMode;
  syncTranscriptsToCloud: boolean;
  retainRecordings: boolean;
}

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
  translateToEnglish?: boolean;
}

export interface ISpeechRecognitionProvider {
  readonly id: string;
  readonly displayName: string;
  readonly requiresOutboundAudioTransfer?: boolean;
  isConfigured(): boolean;
  transcribe(
    audio: RecordedAudioPayload,
    options?: TranscriptionOptions,
  ): Promise<TranscriptionResult>;
}

export type TranscriptionProvider = ISpeechRecognitionProvider;

export interface TranscriptionProviderRegistry {
  getActiveProvider(): ISpeechRecognitionProvider;
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
