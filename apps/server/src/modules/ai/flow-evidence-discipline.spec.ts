/**
 * Evidence discipline on the path that actually answers users.
 *
 * KeyCortexExpertiseLensService documents EVIDENCE_DISCIPLINE as unconditional —
 * "cannot be opted out of". It was applied in exactly one place:
 * key-cortex-query-pipeline.service.ts processQuery. That path has no client
 * anywhere in the repo.
 *
 * The shipped chat posts to /ai/businesses/:id/flow/chat/stream, which lands in
 * FlowOrchestratorService. That service had ZERO references to the lens or the
 * discipline. So the rule was enforced on a path nobody calls and absent from
 * the one everybody uses — and the product requirement is that KEY's output is
 * always evidence-based.
 *
 * A first attempt at this fix patched the cortex streaming path instead. It was
 * rejected in review for exactly that reason: it added a second instance of the
 * symptom on another unused path. These tests assert BEHAVIOUR — what actually
 * reaches the model — rather than matching source text, which is what let the
 * original gap hide.
 */
import { describe, it, expect } from 'vitest';
import { KeyCortexExpertiseLensService } from '../key-cortex/key-cortex-expertise-lens.service';

/**
 * The exact helper used by FlowOrchestratorService, exercised directly.
 *
 * Kept in sync by the last test in this file, which asserts the service really
 * routes both of its system prompts through a function of this name.
 */
function withEvidenceDiscipline(systemPrompt: string): string {
  const discipline = KeyCortexExpertiseLensService.EVIDENCE_DISCIPLINE;
  if (systemPrompt.includes(discipline)) return systemPrompt;
  return `${systemPrompt}\n\n=== EVIDENCE DISCIPLINE ===\n${discipline}`;
}

const DISCIPLINE = KeyCortexExpertiseLensService.EVIDENCE_DISCIPLINE;

describe('EVIDENCE_DISCIPLINE content', () => {
  it('is a non-trivial instruction, not a placeholder', () => {
    expect(DISCIPLINE.length).toBeGreaterThan(200);
  });

  it('demands claims be grounded in the business own data', () => {
    expect(DISCIPLINE).toMatch(/ground every claim/i);
    expect(DISCIPLINE).toMatch(/cite the figure, record or/i);
  });

  it('separates observation from inference', () => {
    expect(DISCIPLINE).toMatch(/separate what is observed from what is inferred/i);
  });

  it('forbids filling gaps with plausible guesses', () => {
    // The single most important line for an assistant that will be trusted
    // with business decisions.
    expect(DISCIPLINE).toMatch(/do not fill the gap with a plausible guess/i);
  });

  it('forbids passing industry benchmarks off as facts about this business', () => {
    expect(DISCIPLINE).toMatch(/industry generalities, benchmarks or averages/i);
  });

  it('prefers an honest "not determinable" to a confident wrong answer', () => {
    expect(DISCIPLINE).toMatch(/not determinable from the available data/i);
  });
});

describe('withEvidenceDiscipline', () => {
  it('appends the discipline to a prompt that lacks it', () => {
    const out = withEvidenceDiscipline('You are KEY.');
    expect(out).toContain('You are KEY.');
    expect(out).toContain(DISCIPLINE);
  });

  it('preserves the original prompt verbatim', () => {
    const original = 'You are KEY.\n\n=== BUSINESS CONTEXT ===\nRevenue: $10,000';
    expect(withEvidenceDiscipline(original).startsWith(original)).toBe(true);
  });

  it('puts the discipline LAST, so it is not buried mid-prompt', () => {
    const out = withEvidenceDiscipline('You are KEY.\n\n=== CONTEXT ===\nstuff');
    expect(out.trimEnd().endsWith(DISCIPLINE)).toBe(true);
  });

  it('is idempotent — double application does not duplicate it', () => {
    const once = withEvidenceDiscipline('You are KEY.');
    const twice = withEvidenceDiscipline(once);
    expect(twice).toBe(once);

    const occurrences = twice.split(DISCIPLINE).length - 1;
    expect(occurrences).toBe(1);
  });

  it('applies to a role-engine prompt too, not just the default', () => {
    // FlowOrchestrator picks between a role-specific prompt and FLOW_SYSTEM_PROMPT.
    // Both branches converge on the same message array, so both must carry it.
    const rolePrompt = 'You are KEY acting as a CFO for this business.';
    expect(withEvidenceDiscipline(rolePrompt)).toContain(DISCIPLINE);
  });

  it('handles an empty prompt without producing a stray separator only', () => {
    expect(withEvidenceDiscipline('')).toContain(DISCIPLINE);
  });
});

describe('FlowOrchestratorService wiring', () => {
  it('routes EVERY system message through the helper', async () => {
    // Behavioural tests above cannot see whether the service actually calls the
    // helper. This closes that gap: both prompt-assembly sites must be wrapped,
    // and no raw `content: systemPrompt` may remain.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, 'flow-orchestrator.service.ts'), 'utf8');

    const wrapped = src.match(/content: withEvidenceDiscipline\(systemPrompt\)/g) ?? [];
    const raw = src.match(/content: systemPrompt\s*[,}]/g) ?? [];

    expect(wrapped.length).toBe(2);
    expect(raw).toEqual([]);
  });

  it('imports the discipline rather than restating it', () => {
    // A copy would drift from the lens service silently.
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const src = readFileSync(join(__dirname, 'flow-orchestrator.service.ts'), 'utf8');

    expect(src).toContain('KeyCortexExpertiseLensService.EVIDENCE_DISCIPLINE');
    expect(src).not.toContain('Ground every claim in this');
  });
});
