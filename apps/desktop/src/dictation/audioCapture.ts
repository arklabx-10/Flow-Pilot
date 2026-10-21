import { DictationError, type AudioCaptureService, type RecordedAudioPayload } from './types.js';

export interface BrowserMediaAudioCaptureOptions {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createMediaRecorder?: (stream: MediaStream) => MediaRecorder;
  now?: () => number;
}

export class BrowserMediaAudioCaptureService implements AudioCaptureService {
  private readonly getUserMediaImpl: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  private readonly createMediaRecorderImpl: (stream: MediaStream) => MediaRecorder;
  private readonly nowImpl: () => number;

  private activeStream: MediaStream | null = null;
  private activeRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAtMs = 0;

  constructor(options?: BrowserMediaAudioCaptureOptions) {
    this.getUserMediaImpl =
      options?.getUserMedia ??
      ((constraints) => {
        if (
          typeof navigator === 'undefined' ||
          !navigator.mediaDevices ||
          typeof navigator.mediaDevices.getUserMedia !== 'function'
        ) {
          return Promise.reject(
            new DictationError(
              'MIC_UNSUPPORTED',
              'Microphone capture API (navigator.mediaDevices.getUserMedia) is not supported in this runtime.',
              false,
            ),
          );
        }
        return navigator.mediaDevices.getUserMedia(constraints);
      });

    this.createMediaRecorderImpl =
      options?.createMediaRecorder ??
      ((stream) => {
        if (typeof MediaRecorder === 'undefined') {
          throw new DictationError(
            'MIC_UNSUPPORTED',
            'MediaRecorder API is not available in this runtime.',
            false,
          );
        }
        const preferredTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4'];
        const supported = preferredTypes.find((type) =>
          typeof MediaRecorder.isTypeSupported === 'function'
            ? MediaRecorder.isTypeSupported(type)
            : false,
        );
        return supported
          ? new MediaRecorder(stream, { mimeType: supported })
          : new MediaRecorder(stream);
      });

    this.nowImpl = options?.now ?? (() => Date.now());
  }

  public isRecording(): boolean {
    return this.activeRecorder !== null && this.activeRecorder.state === 'recording';
  }

  public async startRecording(): Promise<void> {
    if (this.isRecording()) {
      return;
    }

    this.cleanupResources();

    try {
      const stream = await this.getUserMediaImpl({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.activeStream = stream;
      const recorder = this.createMediaRecorderImpl(stream);
      this.chunks = [];

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          this.chunks.push(event.data);
        }
      };

      this.activeRecorder = recorder;
      this.startedAtMs = this.nowImpl();
      recorder.start();
    } catch (error) {
      this.cleanupResources();
      throw mapMediaError(error);
    }
  }

  public async stopRecording(): Promise<RecordedAudioPayload> {
    const recorder = this.activeRecorder;
    if (!recorder || recorder.state !== 'recording') {
      this.cleanupResources();
      throw new DictationError('CAPTURE_FAILED', 'No active recording session to stop.');
    }

    const durationMs = Math.max(0, this.nowImpl() - this.startedAtMs);

    return new Promise<RecordedAudioPayload>((resolve, reject) => {
      recorder.onerror = () => {
        this.cleanupResources();
        reject(new DictationError('CAPTURE_FAILED', 'Audio recorder encountered an error.'));
      };

      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const capturedChunks = this.chunks.slice();
        // Immediately release microphone hardware and clear internal chunk buffer so raw audio is never retained
        this.cleanupResources();

        const combinedBlob = new Blob(capturedChunks, { type: mimeType });
        if (combinedBlob.size === 0) {
          reject(
            new DictationError(
              'EMPTY_RECORDING',
              'No audio was captured. Please speak into the microphone and try again.',
            ),
          );
          return;
        }

        void readBlobAsUint8Array(combinedBlob)
          .then((bytes) => {
            if (bytes.byteLength === 0) {
              reject(
                new DictationError('EMPTY_RECORDING', 'Captured recording was empty (0 bytes).'),
              );
              return;
            }
            resolve({
              bytes,
              mimeType,
              durationMs,
            });
          })
          .catch(() => {
            reject(new DictationError('CAPTURE_FAILED', 'Failed to read captured audio buffer.'));
          });
      };

      try {
        recorder.stop();
      } catch (err) {
        this.cleanupResources();
        reject(mapMediaError(err));
      }
    });
  }

  public abortRecording(): void {
    if (this.activeRecorder && this.activeRecorder.state === 'recording') {
      this.activeRecorder.ondataavailable = null;
      this.activeRecorder.onstop = null;
      this.activeRecorder.onerror = null;
      try {
        this.activeRecorder.stop();
      } catch {
        // Ignore recorder stop errors during abort
      }
    }
    this.cleanupResources();
  }

  private cleanupResources(): void {
    if (this.activeStream) {
      for (const track of this.activeStream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignore track stop errors
        }
      }
    }
    this.activeStream = null;
    this.activeRecorder = null;
    this.chunks = [];
  }
}

function readBlobAsUint8Array(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer().then((buf) => new Uint8Array(buf));
  }

  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result));
      } else {
        reject(new Error('FileReader did not return an ArrayBuffer'));
      }
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('FileReader failed'));
    };
    reader.readAsArrayBuffer(blob);
  });
}

function mapMediaError(error: unknown): DictationError {
  if (error instanceof DictationError) {
    return error;
  }

  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';
  const message = error instanceof Error ? error.message : 'Unable to access microphone hardware.';

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return new DictationError(
      'MIC_PERMISSION_DENIED',
      'Microphone permission was denied. Enable microphone access in Windows Privacy Settings and try again.',
    );
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return new DictationError(
      'MIC_NOT_FOUND',
      'No microphone device was detected on this machine.',
    );
  }

  return new DictationError('CAPTURE_FAILED', message);
}
