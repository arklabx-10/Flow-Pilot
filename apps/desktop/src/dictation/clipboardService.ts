import { DictationError, type ClipboardService } from './types.js';

export interface SystemClipboardOptions {
  writeText?: (text: string) => Promise<void>;
}

export class SystemClipboardService implements ClipboardService {
  private readonly writeTextImpl: (text: string) => Promise<void>;

  constructor(options?: SystemClipboardOptions) {
    this.writeTextImpl =
      options?.writeText ??
      (async (text: string) => {
        if (
          typeof navigator === 'undefined' ||
          !navigator.clipboard ||
          typeof navigator.clipboard.writeText !== 'function'
        ) {
          throw new Error('System clipboard API is unavailable in this environment.');
        }
        await navigator.clipboard.writeText(text);
      });
  }

  public async copyText(text: string): Promise<void> {
    if (!text || text.trim().length === 0) {
      throw new DictationError('CLIPBOARD_FAILED', 'Cannot copy empty text to the clipboard.');
    }

    try {
      await this.writeTextImpl(text);
    } catch (error) {
      if (error instanceof DictationError) {
        throw error;
      }
      const detail = error instanceof Error ? error.message : 'Unknown clipboard error';
      throw new DictationError(
        'CLIPBOARD_FAILED',
        `Failed to copy text to Windows clipboard: ${detail}`,
      );
    }
  }
}
