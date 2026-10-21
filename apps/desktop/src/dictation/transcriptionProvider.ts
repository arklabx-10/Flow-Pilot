import {
  DictationError,
  type RecordedAudioPayload,
  type TranscriptionOptions,
  type TranscriptionProvider,
  type TranscriptionResult,
} from './types.js';

export interface OpenAiWhisperProviderOptions {
  getApiKey?: () => string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_WHISPER_MODEL = 'whisper-1';

/**
 * Production speech-to-text provider integrating with the OpenAI Audio Transcriptions API.
 * Never simulates or fakes transcription output; requires a valid API key.
 */
export class OpenAiWhisperTranscriptionProvider implements TranscriptionProvider {
  public readonly id = 'openai-whisper';
  public readonly displayName = 'OpenAI Whisper API (whisper-1)';

  private readonly getApiKeyImpl: () => string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options?: OpenAiWhisperProviderOptions) {
    this.getApiKeyImpl =
      options?.getApiKey ??
      (() => {
        const envKey = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;
        return envKey ? envKey.trim() : '';
      });
    this.baseUrl = (
      options?.baseUrl ??
      (import.meta.env.VITE_OPENAI_API_BASE_URL as string | undefined) ??
      DEFAULT_OPENAI_BASE_URL
    ).replace(/\/+$/, '');
    this.model = options?.model ?? DEFAULT_WHISPER_MODEL;
    this.fetchImpl = options?.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  public isConfigured(): boolean {
    return this.getApiKeyImpl().trim().length > 0;
  }

  public async transcribe(
    audio: RecordedAudioPayload,
    options?: TranscriptionOptions,
  ): Promise<TranscriptionResult> {
    if (options?.signal?.aborted) {
      throw new DictationError('CANCELLED', 'Transcription was cancelled before starting.');
    }

    if (!audio.bytes || audio.bytes.byteLength === 0) {
      throw new DictationError(
        'EMPTY_RECORDING',
        'Cannot transcribe an empty audio recording (0 bytes).',
      );
    }

    const apiKey = this.getApiKeyImpl().trim();
    if (!apiKey) {
      throw new DictationError(
        'PROVIDER_UNCONFIGURED',
        'OpenAI API key is not configured. Provide VITE_OPENAI_API_KEY or enter your API key in Provider Settings to perform live speech transcription.',
      );
    }

    const extension = resolveFileExtension(audio.mimeType);
    const audioBuffer = new ArrayBuffer(audio.bytes.byteLength);
    new Uint8Array(audioBuffer).set(audio.bytes);
    const audioBlob = new Blob([audioBuffer], { type: audio.mimeType || 'audio/webm' });

    const formData = new FormData();
    formData.append('file', audioBlob, `dictation.${extension}`);
    formData.append('model', this.model);
    formData.append('response_format', 'json');
    if (options?.language) {
      formData.append('language', options.language);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
        signal: options?.signal,
      });
    } catch (error) {
      if (isAbortError(error) || options?.signal?.aborted) {
        throw new DictationError('CANCELLED', 'Transcription request was cancelled.');
      }
      const detail = error instanceof Error ? error.message : 'Network request failed';
      throw new DictationError(
        'PROVIDER_NETWORK_ERROR',
        `Unable to reach OpenAI transcription endpoint: ${detail}`,
      );
    }

    if (!response.ok) {
      const errorMessage = await extractProviderErrorMessage(response);
      if (response.status === 401 || response.status === 403) {
        throw new DictationError(
          'PROVIDER_AUTH_FAILED',
          `Speech provider authentication failed (${response.status}): ${errorMessage}`,
        );
      }
      if (response.status === 429) {
        throw new DictationError(
          'PROVIDER_RATE_LIMITED',
          `Speech provider rate limit exceeded (429): ${errorMessage}`,
        );
      }
      throw new DictationError(
        'PROVIDER_NETWORK_ERROR',
        `Speech provider returned HTTP ${response.status}: ${errorMessage}`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new DictationError(
        'PROVIDER_INVALID_RESPONSE',
        'Speech provider returned malformed JSON.',
      );
    }

    const rawText =
      typeof payload === 'object' &&
      payload !== null &&
      'text' in payload &&
      typeof (payload as { text: unknown }).text === 'string'
        ? (payload as { text: string }).text.trim()
        : '';

    if (!rawText) {
      throw new DictationError(
        'PROVIDER_INVALID_RESPONSE',
        'No speech was detected in the recording by the transcription provider.',
      );
    }

    return {
      transcript: rawText,
      providerId: this.id,
      language: options?.language,
    };
  }
}

function resolveFileExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('mp4') || normalized.includes('m4a')) return 'm4a';
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('mp3') || normalized.includes('mpeg')) return 'mp3';
  return 'webm';
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: unknown }).name === 'AbortError'
  );
}

async function extractProviderErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof (body as { error: unknown }).error === 'object' &&
      (body as { error: Record<string, unknown> | null }).error !== null
    ) {
      const errObj = (body as { error: Record<string, unknown> }).error;
      if (typeof errObj.message === 'string' && errObj.message.trim().length > 0) {
        return errObj.message.trim();
      }
    }
  } catch {
    // Fallback to status text below
  }
  return response.statusText || 'Unexpected provider error';
}
