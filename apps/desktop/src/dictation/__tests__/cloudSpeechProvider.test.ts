import { describe, expect, it, vi } from 'vitest';
import {
  CloudApiSpeechRecognitionProvider,
  CloudTextRefinementService,
} from '../cloudSpeechProvider.js';

describe('CloudApiSpeechRecognitionProvider & CloudTextRefinementService', () => {
  const sampleAudio = {
    bytes: new Uint8Array([10, 20, 30, 40]),
    mimeType: 'audio/webm',
    durationMs: 1400,
  };

  it('marks outbound audio transfer explicit and calls backend proxy without client API keys', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        transcript: 'Transcribed by FlowPilot Cloud API.',
        providerId: 'flowpilot-cloud-openai',
        language: 'en',
        contractVersion: 'v1',
      }),
    });

    const provider = new CloudApiSpeechRecognitionProvider({
      apiBaseUrl: 'http://localhost:5080',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(provider.requiresOutboundAudioTransfer).toBe(true);
    expect(provider.isConfigured()).toBe(true);

    const result = await provider.transcribe(sampleAudio, {
      language: 'en',
      translateToEnglish: true,
    });

    expect(result).toEqual({
      transcript: 'Transcribed by FlowPilot Cloud API.',
      providerId: 'flowpilot-cloud-openai',
      language: 'en',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:5080/api/v1/speech/transcribe');
    expect(init.headers).toBeUndefined();
  });

  it('maps usage limits (413), rate limits (429), and timeouts (504 / AbortTimeout) explicitly', async () => {
    const usageLimitProvider = new CloudApiSpeechRecognitionProvider({
      apiBaseUrl: 'http://localhost:5080',
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        status: 413,
        json: async () => ({
          code: 'USAGE_LIMIT_EXCEEDED',
          message: 'Audio exceeds 25 MB limit.',
          recoverable: true,
        }),
      }) as unknown as typeof fetch,
    });

    await expect(usageLimitProvider.transcribe(sampleAudio)).rejects.toMatchObject({
      code: 'USAGE_LIMIT_EXCEEDED',
    });

    const rateLimitProvider = new CloudApiSpeechRecognitionProvider({
      apiBaseUrl: 'http://localhost:5080',
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({
          code: 'PROVIDER_RATE_LIMITED',
          message: 'Rate limit exceeded.',
          recoverable: true,
        }),
      }) as unknown as typeof fetch,
    });

    await expect(rateLimitProvider.transcribe(sampleAudio)).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMITED',
    });

    const timeoutProvider = new CloudApiSpeechRecognitionProvider({
      apiBaseUrl: 'http://localhost:5080',
      timeoutMs: 15,
      fetchImpl: vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('Timed out'), { name: 'AbortError' }));
          });
        });
      }) as unknown as typeof fetch,
    });

    await expect(timeoutProvider.transcribe(sampleAudio)).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
    });
  });

  it('refines text via CloudTextRefinementService', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        refinedText: 'Hi team,\n\nWe shipped Phase 3.\n\nBest regards,',
        outputMode: 'professional',
        providerId: 'flowpilot-cloud-refiner',
        contractVersion: 'v1',
      }),
    });

    const refiner = new CloudTextRefinementService({
      apiBaseUrl: 'http://localhost:5080',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const output = await refiner.refine('um we shipped phase 3', 'professional');
    expect(output).toContain('Hi team,');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
