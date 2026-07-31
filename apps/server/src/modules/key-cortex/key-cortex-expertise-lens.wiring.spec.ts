/**
 * The lens is only useful if its framing actually reaches the model. These
 * assert the wiring contract of key-cortex-query-pipeline.service.ts:
 *
 *   - the framing is appended to the system prompt
 *   - the chosen lens is recorded so the decision is observable
 *   - a lens failure degrades to the unmodified prompt, never an error
 *   - the pipeline still works when the lens is not provided at all
 *
 * The pipeline itself is large and DB-bound, so rather than construct it we
 * exercise the exact prompt-assembly contract it implements.
 */
import { describe, it, expect, vi } from 'vitest';
import { KeyCortexExpertiseLensService } from './key-cortex-expertise-lens.service';
import type { PrismaService } from '../../core/prisma/prisma.service';

function lensService() {
  const prisma = {
    client: { jobRole: { findMany: vi.fn().mockResolvedValue([]) } },
  } as unknown as PrismaService;
  return new KeyCortexExpertiseLensService(prisma);
}

/** Mirrors the append-and-record block in the pipeline. */
async function assemble(
  basePrompt: string,
  lens: KeyCortexExpertiseLensService | undefined,
  text: string,
  businessId?: string,
): Promise<{ prompt: string; lensLabel?: string }> {
  let prompt = basePrompt;
  let lensLabel: string | undefined;
  try {
    if (lens) {
      const selection = await lens.select(text, businessId);
      prompt += `\n\n${lens.buildPromptFraming(selection)}`;
      lensLabel = selection.lens.label;
    }
  } catch {
    /* non-fatal, exactly as the pipeline treats it */
  }
  return { prompt, lensLabel };
}

describe('expertise lens — pipeline wiring', () => {
  const BASE = 'You are KEY.';

  it('appends discipline framing to the system prompt', async () => {
    const { prompt } = await assemble(BASE, lensService(), 'reconcile the supplier ledger');
    expect(prompt).toContain(BASE);
    expect(prompt).toContain('finance professional');
    expect(prompt).toContain('Present the answer as:');
  });

  it('records which lens was chosen so the decision is observable', async () => {
    const { lensLabel } = await assemble(BASE, lensService(), 'build the shift roster');
    expect(lensLabel).toBe('Operations');
  });

  it('varies the framing by task — the same base prompt diverges', async () => {
    const svc = lensService();
    const a = await assemble(BASE, svc, 'reconcile the supplier ledger');
    const b = await assemble(BASE, svc, 'should we expand into a second location');
    expect(a.prompt).not.toBe(b.prompt);
    expect(a.prompt).toContain('table');
    expect(b.prompt).toContain('options');
  });

  it('leaves the prompt untouched when the lens is not provided', async () => {
    const { prompt, lensLabel } = await assemble(BASE, undefined, 'reconcile the ledger');
    expect(prompt).toBe(BASE);
    expect(lensLabel).toBeUndefined();
  });

  it('degrades to the unmodified prompt if lens selection throws', async () => {
    const broken = {
      select: vi.fn().mockRejectedValue(new Error('boom')),
      buildPromptFraming: vi.fn(),
    } as unknown as KeyCortexExpertiseLensService;
    const { prompt, lensLabel } = await assemble(BASE, broken, 'reconcile the ledger');
    expect(prompt).toBe(BASE);
    expect(lensLabel).toBeUndefined();
  });

  it('never injects access-widening language into the prompt', async () => {
    const svc = lensService();
    for (const task of [
      'reconcile the ledger',
      'run payroll for the team',
      'review the supplier contract',
      'why did the deploy fail',
    ]) {
      const { prompt } = await assemble(BASE, svc, task);
      const lower = prompt.toLowerCase();
      for (const forbidden of ['bypass', 'ignore permission', 'full access', 'as an admin', 'override']) {
        expect(lower).not.toContain(forbidden);
      }
    }
  });
});
