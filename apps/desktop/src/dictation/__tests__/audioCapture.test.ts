import { describe, expect, it, vi } from 'vitest';
import { BrowserMediaAudioCaptureService } from '../audioCapture.js';
import { DictationError } from '../types.js';

class FakeMediaRecorder {
  public state: 'inactive' | 'recording' = 'inactive';
  public mimeType = 'audio/webm';
  public ondataavailable: ((event: { data: Blob }) => void) | null = null;
  public onstop: (() => void) | null = null;
  public onerror: ((event: { error?: Error }) => void) | null = null;

  private readonly chunksToEmit: Uint8Array[];

  constructor(_stream: MediaStream, chunksToEmit: Uint8Array[]) {
    this.chunksToEmit = chunksToEmit;
  }

  start(): void {
    this.state = 'recording';
  }

  stop(): void {
    this.state = 'inactive';
    for (const chunk of this.chunksToEmit) {
      const buffer = new ArrayBuffer(chunk.byteLength);
      new Uint8Array(buffer).set(chunk);
      this.ondataavailable?.({ data: new Blob([buffer], { type: this.mimeType }) });
    }
    this.onstop?.();
  }
}

function createFakeStream(onTrackStop: () => void): MediaStream {
  const track = {
    stop: onTrackStop,
  } as unknown as MediaStreamTrack;

  return {
    getTracks: () => [track],
  } as unknown as MediaStream;
}

describe('BrowserMediaAudioCaptureService', () => {
  it('requests microphone permission, captures audio bytes, and stops tracks on stopRecording', async () => {
    let trackStopped = false;
    const sampleBytes = new Uint8Array([1, 2, 3, 4, 5, 6]);

    const service = new BrowserMediaAudioCaptureService({
      getUserMedia: vi.fn().mockResolvedValue(
        createFakeStream(() => {
          trackStopped = true;
        }),
      ),
      createMediaRecorder: (stream) =>
        new FakeMediaRecorder(stream, [sampleBytes]) as unknown as MediaRecorder,
      now: (() => {
        let current = 1000;
        return () => {
          current += 1250;
          return current;
        };
      })(),
    });

    await service.startRecording();
    expect(service.isRecording()).toBe(true);

    const payload = await service.stopRecording();
    expect(service.isRecording()).toBe(false);
    expect(trackStopped).toBe(true);
    expect(payload.mimeType).toBe('audio/webm');
    expect(Array.from(payload.bytes)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(payload.durationMs).toBe(1250);
  });

  it('maps NotAllowedError to MIC_PERMISSION_DENIED', async () => {
    const permissionError = Object.assign(new Error('Permission denied by system'), {
      name: 'NotAllowedError',
    });

    const service = new BrowserMediaAudioCaptureService({
      getUserMedia: vi.fn().mockRejectedValue(permissionError),
    });

    await expect(service.startRecording()).rejects.toMatchObject({
      code: 'MIC_PERMISSION_DENIED',
    });
  });

  it('rejects with EMPTY_RECORDING when captured audio has zero bytes', async () => {
    let trackStopped = false;
    const service = new BrowserMediaAudioCaptureService({
      getUserMedia: vi.fn().mockResolvedValue(
        createFakeStream(() => {
          trackStopped = true;
        }),
      ),
      createMediaRecorder: (stream) =>
        new FakeMediaRecorder(stream, [new Uint8Array(0)]) as unknown as MediaRecorder,
    });

    await service.startRecording();

    await expect(service.stopRecording()).rejects.toSatisfy((err: unknown) => {
      return err instanceof DictationError && err.code === 'EMPTY_RECORDING';
    });
    expect(trackStopped).toBe(true);
  });

  it('releases tracks and discards chunks when abortRecording is called', async () => {
    let trackStopped = false;
    const service = new BrowserMediaAudioCaptureService({
      getUserMedia: vi.fn().mockResolvedValue(
        createFakeStream(() => {
          trackStopped = true;
        }),
      ),
      createMediaRecorder: (stream) =>
        new FakeMediaRecorder(stream, [new Uint8Array([9, 9, 9])]) as unknown as MediaRecorder,
    });

    await service.startRecording();
    expect(service.isRecording()).toBe(true);

    service.abortRecording();
    expect(service.isRecording()).toBe(false);
    expect(trackStopped).toBe(true);
  });
});
