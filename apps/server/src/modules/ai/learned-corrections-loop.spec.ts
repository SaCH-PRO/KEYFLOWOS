/**
 * The feedback loop's learning half was one word from working.
 *
 * FeedbackLoopService.analyze writes every execution failure to AiMemory under
 * category `learned_corrections`. AiMemoryService.buildContextBlock — the
 * function that turns memory into prompt text — had a `case 'corrections'` and
 * NO case for `learned_corrections`. So the lesson was written on every failed
 * tool call and read on none of them.
 *
 * The two categories are deliberately kept apart rather than merged:
 *   - `corrections`        = what the USER rejected. A preference. Rendered as
 *                            "User corrections (respect these)".
 *   - `learned_corrections`= what KEY learned when a tool actually failed. An
 *                            operational lesson, and stored as JSON.
 * Blending them would let a stale execution failure read to the model as a
 * standing instruction from the owner.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AiMemoryService } from './ai-memory.service';

const CORRECTION = JSON.stringify({
  category: 'execution_failure',
  reason: 'Contact not found',
  learnedPattern: 'Tool crm_create_invoice failed; search for the contact first',
});

class PrismaStub {
  rows: Array<Record<string, unknown>> = [];
  client = {
    aiMemory: {
      findMany: vi.fn(() => Promise.resolve(this.rows)),
    },
  };
}

function makeService(prisma: PrismaStub) {
  const blueprint = { getBlueprint: vi.fn(() => Promise.reject(new Error('none'))) };
  const executionLog = new Proxy({}, { get: () => vi.fn() });
  return new AiMemoryService(prisma as never, executionLog as never, blueprint as never);
}

describe('learned corrections reach the prompt', () => {
  let prisma: PrismaStub;
  let svc: AiMemoryService;

  beforeEach(() => {
    prisma = new PrismaStub();
    svc = makeService(prisma);
  });

  it('reads the category the feedback loop actually writes', async () => {
    prisma.rows = [{ category: 'learned_corrections', key: 'k', value: CORRECTION }];

    const block = await svc.buildContextBlock('biz_1');
    expect(block.learnedCorrections).toHaveLength(1);
  });

  it('surfaces the lesson, not the raw JSON blob', async () => {
    prisma.rows = [{ category: 'learned_corrections', key: 'k', value: CORRECTION }];

    const block = await svc.buildContextBlock('biz_1');
    expect(block.learnedCorrections[0]).toBe(
      'Tool crm_create_invoice failed; search for the contact first',
    );
    expect(block.learnedCorrections[0]).not.toContain('{');
  });

  it('renders into the prompt section', async () => {
    // The whole point. Written-but-never-read was the defect.
    prisma.rows = [{ category: 'learned_corrections', key: 'k', value: CORRECTION }];

    const section = svc.buildPromptSection(await svc.buildContextBlock('biz_1'));
    expect(section).toContain('Lessons from past failures');
    expect(section).toContain('search for the contact first');
  });

  it('keeps user corrections separate from learned ones', async () => {
    // A failed tool call must not read as an instruction from the owner.
    prisma.rows = [
      { category: 'corrections', key: 'a', value: 'never text clients after 6pm' },
      { category: 'learned_corrections', key: 'b', value: CORRECTION },
    ];

    const block = await svc.buildContextBlock('biz_1');
    expect(block.corrections).toEqual(['never text clients after 6pm']);
    expect(block.learnedCorrections).toHaveLength(1);

    const section = svc.buildPromptSection(block);
    expect(section).toContain('User corrections (respect these): never text clients after 6pm');
    expect(section).toContain('Lessons from past failures:');
  });

  it('falls back to the raw value when the row is not JSON', async () => {
    // Pre-JSON rows exist; dropping them loses real context.
    prisma.rows = [
      { category: 'learned_corrections', key: 'k', value: 'plain text lesson' },
    ];

    const block = await svc.buildContextBlock('biz_1');
    expect(block.learnedCorrections).toEqual(['plain text lesson']);
  });

  it('deduplicates repeated lessons', async () => {
    // The same tool failing twice must not double the prompt.
    prisma.rows = [
      { category: 'learned_corrections', key: 'a', value: CORRECTION },
      { category: 'learned_corrections', key: 'b', value: CORRECTION },
    ];

    const block = await svc.buildContextBlock('biz_1');
    expect(block.learnedCorrections).toHaveLength(1);
  });

  it('says nothing when there is nothing learned', async () => {
    prisma.rows = [];
    const section = svc.buildPromptSection(await svc.buildContextBlock('biz_1'));
    expect(section).not.toContain('Lessons from past failures');
  });
});
