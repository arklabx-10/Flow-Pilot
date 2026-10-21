import {
  SPEECH_PATHS_V1,
  isApiErrorResponseV1,
  isCloudTextRefineResponseV1,
  isCloudTranscriptionResponseV1,
} from '@flowpilot/contracts';
import {
  DictationError,
  type DictationErrorCode,
  type DictationHistoryEntry,
  type ISpeechRecognitionProvider,
  type OutputMode,
  type RecordedAudioPayload,
  type TextRefinementOptions,
  type TextRefinementService,
  type TranscriptionOptions,
  type TranscriptionResult,
} from './types.js';

const DEFAULT_API_BASE_URL = 'http://localhost:5080';
const DEFAULT_TIMEOUT_MS = 30_000;

export interface CloudApiSpeechProviderOptions {
  apiBaseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Cloud speech recognition adapter that sends audio to FlowPilot.Api (/api/v1/speech/transcribe).
 * Never embeds privileged provider API keys in the desktop or browser bundle.
 */
export class CloudApiSpeechRecognitionProvider implements ISpeechRecognitionProvider {
  public readonly id = 'flowpilot-cloud-openai';
  public readonly displayName = 'FlowPilot Cloud Speech (Backend Proxy)';
  public readonly requiresOutboundAudioTransfer = true;

  private readonly apiBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options?: CloudApiSpeechProviderOptions) {
    this.apiBaseUrl = (
      options?.apiBaseUrl ??
      (import.meta.env.VITE_DESKTOP_API_BASE_URL as string | undefined) ??
      DEFAULT_API_BASE_URL
    ).replace(/\/+$/, '');
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options?.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  public isConfigured(): boolean {
    return this.apiBaseUrl.length > 0;
  }

  public async transcribe(
    audio: RecordedAudioPayload,
    options?: TranscriptionOptions,
  ): Promise<TranscriptionResult> {
    if (options?.signal?.aborted) {
      throw new DictationError('CANCELLED', 'Cloud transcription was cancelled before starting.');
    }

    if (!audio.bytes || audio.bytes.byteLength === 0) {
      throw new DictationError(
        'EMPTY_RECORDING',
        'Cannot transcribe an empty audio recording (0 bytes).',
      );
    }

    const audioBuffer = new ArrayBuffer(audio.bytes.byteLength);
    new Uint8Array(audioBuffer).set(audio.bytes);
    const audioBlob = new Blob([audioBuffer], { type: audio.mimeType || 'audio/webm' });

    const formData = new FormData();
    formData.append('file', audioBlob, 'dictation.webm');
    if (options?.language) {
      formData.append('language', options.language);
    }
    if (options?.translateToEnglish !== undefined) {
      formData.append('translateToEnglish', String(options.translateToEnglish));
    }

    const timeoutController = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, this.timeoutMs);

    const onCallerAbort = () => {
      timeoutController.abort();
    };
    options?.signal?.addEventListener('abort', onCallerAbort, { once: true });

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiBaseUrl}${SPEECH_PATHS_V1.transcribe}`, {
        method: 'POST',
        body: formData,
        signal: timeoutController.signal,
      });
    } catch (error) {
      if (options?.signal?.aborted) {
        throw new DictationError('CANCELLED', 'Cloud transcription was cancelled.');
      }
      if (timedOut) {
        throw new DictationError(
          'PROVIDER_TIMEOUT',
          `Cloud transcription timed out after ${this.timeoutMs} ms.`,
        );
      }
      const detail = error instanceof Error ? error.message : 'Network error';
      throw new DictationError(
        'PROVIDER_NETWORK_ERROR',
        `Unable to reach FlowPilot Cloud Speech API: ${detail}`,
      );
    } finally {
      clearTimeout(timer);
      options?.signal?.removeEventListener('abort', onCallerAbort);
    }

    if (!response.ok) {
      const apiErr = await parseBackendError(response);
      if (
        response.status === 413 ||
        response.status === 402 ||
        apiErr.code === 'USAGE_LIMIT_EXCEEDED'
      ) {
        throw new DictationError('USAGE_LIMIT_EXCEEDED', apiErr.message);
      }
      if (response.status === 429 || apiErr.code === 'PROVIDER_RATE_LIMITED') {
        throw new DictationError('PROVIDER_RATE_LIMITED', apiErr.message);
      }
      if (
        response.status === 408 ||
        response.status === 504 ||
        apiErr.code === 'PROVIDER_TIMEOUT'
      ) {
        throw new DictationError('PROVIDER_TIMEOUT', apiErr.message);
      }
      if (response.status === 503 || apiErr.code === 'CLOUD_PROVIDER_UNCONFIGURED') {
        throw new DictationError('PROVIDER_UNCONFIGURED', apiErr.message);
      }
      if (
        response.status === 401 ||
        response.status === 403 ||
        apiErr.code === 'PROVIDER_AUTH_FAILED'
      ) {
        throw new DictationError('PROVIDER_AUTH_FAILED', apiErr.message);
      }
      throw new DictationError(
        (apiErr.code as DictationErrorCode) || 'PROVIDER_NETWORK_ERROR',
        apiErr.message,
      );
    }

    const payload: unknown = await response.json();
    if (!isCloudTranscriptionResponseV1(payload)) {
      throw new DictationError(
        'PROVIDER_INVALID_RESPONSE',
        'Cloud speech API returned an invalid response payload.',
      );
    }

    return {
      transcript: payload.transcript.trim(),
      providerId: payload.providerId,
      language: payload.language ?? options?.language,
    };
  }
}

export class CloudTextRefinementService implements TextRefinementService {
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options?: { apiBaseUrl?: string; fetchImpl?: typeof fetch }) {
    this.apiBaseUrl = (
      options?.apiBaseUrl ??
      (import.meta.env.VITE_DESKTOP_API_BASE_URL as string | undefined) ??
      DEFAULT_API_BASE_URL
    ).replace(/\/+$/, '');
    this.fetchImpl = options?.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  public async refine(
    originalTranscript: string,
    mode: OutputMode,
    options?: TextRefinementOptions,
  ): Promise<string> {
    if (options?.signal?.aborted) {
      throw new DictationError('CANCELLED', 'Cloud text refinement was cancelled.');
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiBaseUrl}${SPEECH_PATHS_V1.refine}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          originalTranscript,
          outputMode: mode,
        }),
        signal: options?.signal,
      });
    } catch (error) {
      if (options?.signal?.aborted) {
        throw new DictationError('CANCELLED', 'Cloud text refinement was cancelled.');
      }
      const detail = error instanceof Error ? error.message : 'Network error';
      throw new DictationError(
        'REFINEMENT_FAILED',
        `Cloud text refinement request failed: ${detail}`,
      );
    }

    if (!response.ok) {
      throw new DictationError(
        'REFINEMENT_FAILED',
        `Cloud text refinement failed with HTTP ${response.status}.`,
      );
    }

    const payload: unknown = await response.json();
    if (!isCloudTextRefineResponseV1(payload)) {
      throw new DictationError(
        'REFINEMENT_FAILED',
        'Cloud text refinement returned an invalid contract payload.',
      );
    }

    return payload.refinedText;
  }
}

export async function syncTranscriptEntryToCloud(
  entry: DictationHistoryEntry,
  options?: { apiBaseUrl?: string; fetchImpl?: typeof fetch },
): Promise<void> {
  const apiBaseUrl = (
    options?.apiBaseUrl ??
    (import.meta.env.VITE_DESKTOP_API_BASE_URL as string | undefined) ??
    DEFAULT_API_BASE_URL
  ).replace(/\/+$/, '');
  const fetchImpl = options?.fetchImpl ?? ((input, init) => fetch(input, init));

  const response = await fetchImpl(`${apiBaseUrl}${SPEECH_PATHS_V1.syncTranscript}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(entry),
  });

  if (!response.ok) {
    throw new DictationError(
      'STORAGE_FAILED',
      `Failed to synchronize transcript to cloud (HTTP ${response.status}).`,
    );
  }
}

async function parseBackendError(response: Response): Promise<{
  code: string;
  message: string;
}> {
  try {
    const body: unknown = await response.json();
    if (isApiErrorResponseV1(body)) {
      return {
        code: body.code || 'PROVIDER_NETWORK_ERROR',
        message: body.message,
      };
    }
  } catch {
    // Ignore JSON parse errors and fall back to status text
  }

  return {
    code: 'PROVIDER_NETWORK_ERROR',
    message: `Cloud speech request failed with HTTP ${response.status}.`,
  };
}
