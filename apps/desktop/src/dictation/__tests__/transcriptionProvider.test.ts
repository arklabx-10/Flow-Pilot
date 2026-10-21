import { describe, expect, it, vi } from 'vitest';
import { OpenAiWhisperTranscriptionProvider } from '../transcriptionProvider.js';
import { DictationError } from '../types.js';

describe('OpenAiWhisperTranscriptionProvider', () => {
  const sampleAudio = {
    bytes: new Uint8Array([10, 20, 30, 40]),
    mimeType: 'audio/webm',
    durationMs: 1500,
  };

  it('fails with PROVIDER_UNCONFIGURED when API key is missing and never fakes transcription', async () => {
    const provider = new OpenAiWhisperTranscriptionProvider({
      getApiKey: () => '',
    });

    expect(provider.isConfigured()).toBe(false);

    await expect(provider.transcribe(sampleAudio)).rejects.toSatisfy((error: unknown) => {
      return error instanceof DictationError && error.code === 'PROVIDER_UNCONFIGURED';
    });
  });

  it('rejects empty audio payloads with EMPTY_RECORDING before calling the network', async () => {
    const fetchSpy = vi.fn();
    const provider = new OpenAiWhisperTranscriptionProvider({
      getApiKey: () => 'sk-test-valid-placeholder',
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });

    await expect(
      provider.transcribe({ bytes: new Uint8Array(0), mimeType: 'audio/webm', durationMs: 0 }),
    ).rejects.toMatchObject({
      code: 'EMPTY_RECORDING',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends multipart audio request to OpenAI Whisper endpoint and returns real transcript', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ text: '  Ship the Phase 2 dictation vertical slice today.  ' }),
    });

    const provider = new OpenAiWhisperTranscriptionProvider({
      getApiKey: () => 'sk-test-key',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await provider.transcribe(sampleAudio, { language: 'en' });

    expect(result).toEqual({
      transcript: 'Ship the Phase 2 dictation vertical slice today.',
      providerId: 'openai-whisper',
      language: 'en',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-key');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('maps HTTP 401 and 429 provider responses to explicit DictationError codes', async () => {
    const authProvider = new OpenAiWhisperTranscriptionProvider({
      getApiKey: () => 'sk-invalid',
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Incorrect API key provided' } }),
      }) as unknown as typeof fetch,
    });

    await expect(authProvider.transcribe(sampleAudio)).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_FAILED',
    });

    const rateLimitProvider = new OpenAiWhisperTranscriptionProvider({
      getApiKey: () => 'sk-valid',
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: 'Rate limit exceeded' } }),
      }) as unknown as typeof fetch,
    });

    await expect(rateLimitProvider.transcribe(sampleAudio)).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMITED',
    });
  });

  it('propagates AbortSignal cancellation as DictationError with code CANCELLED', async () => {
    const abortController = new AbortController();

    const provider = new OpenAiWhisperTranscriptionProvider({
      getApiKey: () => 'sk-valid',
      fetchImpl: vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
          });
        });
      }) as unknown as typeof fetch,
    });

    const promise = provider.transcribe(sampleAudio, { signal: abortController.signal });
    abortController.abort();

    await expect(promise).rejects.toMatchObject({
      code: 'CANCELLED',
    });
  });
});
