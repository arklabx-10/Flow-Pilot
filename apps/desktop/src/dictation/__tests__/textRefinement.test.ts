import { describe, expect, it } from 'vitest';
import { DeterministicTextRefinementService } from '../textRefinement.js';

describe('DeterministicTextRefinementService', () => {
  const service = new DeterministicTextRefinementService();

  it('supports all five output modes while preserving the original transcript unmodified', async () => {
    const original =
      'um we need to refactor the auth middleware and add unit tests for token expiry';

    const raw = await service.refine(original, 'raw');
    expect(raw).toBe(original);

    const clean = await service.refine(original, 'clean');
    expect(clean).toBe(
      'We need to refactor the auth middleware and add unit tests for token expiry.',
    );
    expect(original).toBe(
      'um we need to refactor the auth middleware and add unit tests for token expiry',
    );

    const professional = await service.refine(original, 'professional');
    expect(professional).toContain('Hi team,');
    expect(professional).toContain(
      'We need to refactor the auth middleware and add unit tests for token expiry.',
    );
    expect(professional).toContain('Best regards');

    const codingPrompt = await service.refine(original, 'coding-prompt');
    expect(codingPrompt).toContain('## Task');
    expect(codingPrompt).toContain(
      'We need to refactor the auth middleware and add unit tests for token expiry.',
    );
    expect(codingPrompt).toContain('## Requirements');

    const quickNote = await service.refine(original, 'quick-note');
    expect(quickNote).toContain('- We need to refactor the auth middleware');
  });

  it('propagates AbortSignal cancellation', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      service.refine('test transcript', 'clean', { signal: controller.signal }),
    ).rejects.toMatchObject({
      code: 'CANCELLED',
    });
  });
});
