import {
  DictationError,
  type OutputMode,
  type TextRefinementOptions,
  type TextRefinementService,
} from './types.js';

const FILLER_WORDS_PATTERN = /\b(um+|uh+|erm+|er+|hmm+)\b[,\s]*/gi;

export class DeterministicTextRefinementService implements TextRefinementService {
  public async refine(
    originalTranscript: string,
    mode: OutputMode,
    options?: TextRefinementOptions,
  ): Promise<string> {
    if (options?.signal?.aborted) {
      throw new DictationError('CANCELLED', 'Text refinement was cancelled.');
    }

    const verbatim = String(originalTranscript);
    if (mode === 'raw') {
      return verbatim;
    }

    const cleaned = cleanSentence(verbatim);
    if (options?.signal?.aborted) {
      throw new DictationError('CANCELLED', 'Text refinement was cancelled.');
    }

    switch (mode) {
      case 'clean':
        return cleaned;

      case 'professional':
        return `Hi team,\n\n${cleaned}\n\nBest regards,`;

      case 'coding-prompt':
        return [
          '## Task',
          cleaned,
          '',
          '## Requirements',
          '- Preserve existing module boundaries and strict TypeScript types.',
          '- Add or update automated unit tests covering the change.',
        ].join('\n');

      case 'quick-note': {
        const clauses = cleaned
          .split(/(?<=[.!?])\s+/)
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
        return clauses.map((clause) => `- ${clause}`).join('\n');
      }
    }
  }
}

function cleanSentence(input: string): string {
  const withoutFillers = input.replace(FILLER_WORDS_PATTERN, ' ').replace(/\s+/g, ' ').trim();

  if (!withoutFillers) {
    return input.trim();
  }

  const capitalized = withoutFillers.charAt(0).toUpperCase() + withoutFillers.slice(1);

  if (/[.!?]$/.test(capitalized)) {
    return capitalized;
  }

  return `${capitalized}.`;
}
