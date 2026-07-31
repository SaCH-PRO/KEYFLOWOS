/**
 * KEY's output must be real-world, evidence-based and honest about uncertainty.
 *
 * These assert that the evidence discipline is unconditional — present for every
 * lens and every output format, with no route around it. A discipline that only
 * applied to some paths would be one a caller could avoid by rephrasing.
 */
import { describe, it, expect, vi } from 'vitest';
import { KeyCortexExpertiseLensService } from './key-cortex-expertise-lens.service';
import type { PrismaService } from '../../core/prisma/prisma.service';

function service() {
  const prisma = {
    client: { jobRole: { findMany: vi.fn().mockResolvedValue([]) } },
  } as unknown as PrismaService;
  return new KeyCortexExpertiseLensService(prisma);
}

/** One task per lens, so every discipline is exercised. */
const TASKS = [
  'reconcile the supplier ledger for March',
  'which deals in the pipeline are stalled',
  'the newsletter campaign open rate dropped',
  'build the shift roster around the stock delivery',
  'run payroll and clear the leave request backlog',
  'what are our GDPR consent obligations',
  'a customer complaint escalated past the SLA',
  'should we expand into a second location',
  'the connector integration throws an API error',
  'tell me something about the business',
];

describe('evidence discipline', () => {
  const svc = service();

  it('is present in every lens framing, without exception', async () => {
    for (const task of TASKS) {
      const framing = svc.buildPromptFraming(await svc.select(task));
      expect(framing, `missing for: ${task}`).toContain('Evidence:');
    }
  });

  it('requires claims to be grounded in this business\'s own data', async () => {
    const framing = svc.buildPromptFraming(await svc.select(TASKS[0]));
    expect(framing).toMatch(/ground every claim in this business's actual data/i);
    expect(framing).toMatch(/cite the figure, record or\s+time period/i);
  });

  it('requires observed and inferred to be separated', async () => {
    const framing = svc.buildPromptFraming(await svc.select(TASKS[3]));
    expect(framing).toMatch(/separate what is observed from what is inferred/i);
  });

  it('forbids filling gaps with plausible guesses', async () => {
    const framing = svc.buildPromptFraming(await svc.select(TASKS[7]));
    expect(framing).toMatch(/do not fill the gap with a plausible guess/i);
    expect(framing).toMatch(/say what is missing/i);
  });

  it('forbids passing industry generalities off as facts about this business', async () => {
    const framing = svc.buildPromptFraming(await svc.select(TASKS[1]));
    expect(framing).toMatch(/industry generalities, benchmarks or averages/i);
    expect(framing).toMatch(/unless they come from its own records/i);
  });

  it('prefers an honest non-answer over a confident wrong one', async () => {
    const framing = svc.buildPromptFraming(await svc.select(TASKS[8]));
    expect(framing).toMatch(/wrong confident\s+answer is worse/i);
    expect(framing).toMatch(/not determinable from the available data/i);
  });

  it('requires estimates to declare themselves and show their basis', async () => {
    const framing = svc.buildPromptFraming(await svc.select(TASKS[0]));
    expect(framing).toMatch(/estimated or extrapolated, say so and give the basis/i);
  });

  describe('per output format', () => {
    // Each presentation carries its own evidence obligation, so the discipline
    // survives however the answer is shaped.
    const cases: Array<[string, RegExp]> = [
      ['reconcile the ledger line by line', /traceable to its source record and\s+period/i],
      ['should we expand or consolidate', /evidence supporting it/i],
      ['how do i onboard a new staff member', /rests on an\s+assumption rather than on known data/i],
      ['why did the deploy fail', /whether it is observed or\s+inferred/i],
      ['tell me about the business', /citing the data behind any factual claim/i],
    ];

    for (const [task, expected] of cases) {
      it(`"${task.slice(0, 34)}..." carries its format's evidence obligation`, async () => {
        const framing = svc.buildPromptFraming(await svc.select(task));
        expect(framing).toMatch(expected);
      });
    }
  });

  it('cannot be routed around by phrasing — even an unmatched task gets it', async () => {
    for (const vague of ['hello', 'hi there', '?', 'do the thing']) {
      const sel = await svc.select(vague);
      expect(sel.lens.key).toBe('generalist');
      expect(svc.buildPromptFraming(sel)).toContain('Evidence:');
    }
  });

  it('the discipline text itself never licenses speculation', async () => {
    const text = KeyCortexExpertiseLensService.EVIDENCE_DISCIPLINE.toLowerCase();
    for (const forbidden of ['feel free to', 'you may assume', 'if unsure, guess', 'make up']) {
      expect(text).not.toContain(forbidden);
    }
  });
});
