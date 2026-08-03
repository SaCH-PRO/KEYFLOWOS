/**
 * The cerebellum — compare intended against actual, and correct the error.
 *
 * This was the last open loop in KEY's nervous system. Every tool failure on
 * the path users actually use was logged and then forgotten:
 *
 *   - the prompt-variant bandit is inert three ways (no writer, no seeder, and
 *     its reader sits on a pipeline the web never calls)
 *   - summarizePatterns reaches the prompt but produces USAGE telemetry —
 *     "most used tools", "peak activity hour" — never corrections
 *   - FeedbackLoopService is corrective but guarded on planId/planStepId, and
 *     chat tool calls pass planId: '', so it never sees them
 *
 * The failure modes worth pinning here are not "does it group rows". They are
 * the ways a learning system goes wrong:
 *
 *   SUPERSTITION   learning a lesson from a single incident
 *   FRAGMENTATION  failing to group failures that differ only by record id,
 *                  so the commonest recurring failure is never seen
 *   PERMANENCE     a fixed bug still shaping behaviour weeks later
 *   NOISE          flooding the prompt so no lesson carries weight
 *   DESCRIPTION    stating what happened instead of what to do differently
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexCerebellumService } from './key-cortex-cerebellum.service';

type Row = { toolName: string | null; success: boolean; errorMessage: string | null };

class PrismaStub {
  rows: Row[] = [];
  lastQuery: Record<string, unknown> | null = null;

  client = {
    aiExecutionLog: {
      findMany: vi.fn((q: Record<string, unknown>) => {
        this.lastQuery = q;
        return Promise.resolve(this.rows);
      }),
    },
    business: { findMany: vi.fn(() => Promise.resolve([{ id: 'biz_1' }])) },
  };
}

class MemoryStub {
  written: Array<Record<string, unknown>> = [];
  upsert = vi.fn((_b: string, input: Record<string, unknown>) => {
    this.written.push(input);
    return Promise.resolve({});
  });
}

function make() {
  const prisma = new PrismaStub();
  const memory = new MemoryStub();
  return { svc: new KeyCortexCerebellumService(prisma as never, memory as never), prisma, memory };
}

const fail = (toolName: string, errorMessage: string): Row => ({
  toolName,
  success: false,
  errorMessage,
});
const ok = (toolName: string): Row => ({ toolName, success: true, errorMessage: null });

describe('it learns from recurrence, not from incidents', () => {
  let ctx: ReturnType<typeof make>;

  beforeEach(() => {
    ctx = make();
  });

  it('ignores a single failure', async () => {
    // Once is an incident — a network blip, a row that genuinely did not exist.
    // Learning from it would accumulate superstitions.
    ctx.prisma.rows = [fail('crm_create_contact', 'Contact not found'), ok('crm_create_contact')];

    expect(await ctx.svc.detectLessons('biz_1')).toEqual([]);
  });

  it('learns once a failure repeats', async () => {
    ctx.prisma.rows = [
      fail('crm_create_contact', 'Contact not found'),
      fail('crm_create_contact', 'Contact not found'),
    ];

    const lessons = await ctx.svc.detectLessons('biz_1');
    expect(lessons).toHaveLength(1);
    expect(lessons[0].toolName).toBe('crm_create_contact');
  });

  it('groups failures that differ only by record id', async () => {
    // FRAGMENTATION is the subtle one. Without signature normalisation these
    // are three distinct one-offs, none reaches the threshold, and the most
    // common class of recurring failure stays invisible precisely BECAUSE each
    // instance names a different record.
    ctx.prisma.rows = [
      fail('commerce_send_invoice', 'Invoice cm3x9a2b0001 not found'),
      fail('commerce_send_invoice', 'Invoice cm7z1k4p0002 not found'),
      fail('commerce_send_invoice', 'Invoice cm9q8w7e0003 not found'),
    ];

    const lessons = await ctx.svc.detectLessons('biz_1');
    expect(lessons, 'ids were not normalised into one signature').toHaveLength(1);
    expect(lessons[0].occurrences).toBe(3);
  });

  it('keeps genuinely different failures apart', async () => {
    // Over-grouping is the opposite error: two unrelated problems collapsing
    // into one lesson would teach the wrong correction for one of them.
    ctx.prisma.rows = [
      fail('crm_create_contact', 'Contact not found'),
      fail('crm_create_contact', 'Contact not found'),
      fail('crm_create_contact', 'Permission denied'),
      fail('crm_create_contact', 'Permission denied'),
    ];

    expect(await ctx.svc.detectLessons('biz_1')).toHaveLength(2);
  });

  it('reports a rate, not a bare count', async () => {
    // "Failed twice" means nothing without "out of three".
    ctx.prisma.rows = [
      fail('bookings_create_booking', 'Slot unavailable'),
      fail('bookings_create_booking', 'Slot unavailable'),
      ok('bookings_create_booking'),
      ok('bookings_create_booking'),
    ];

    const [lesson] = await ctx.svc.detectLessons('biz_1');
    expect(lesson.failureRate).toBeCloseTo(0.5, 5);
    expect(lesson.lesson).toContain('2 of 4');
  });
});

describe('a lesson tells KEY what to DO', () => {
  // The distinction between this service and summarizePatterns is exactly the
  // distinction between describing behaviour and correcting it.
  const cases: Array<[string, RegExp]> = [
    ['Contact not found', /search for it first|confirm the record exists/i],
    ['Permission denied for this resource', /do not retry|access problem/i],
    ['Validation failed: email is required', /required argument|tool schema/i],
    ['ETIMEDOUT connecting to upstream', /unreliable|may not complete/i],
    ['Duplicate key value violates constraint', /existing record/i],
  ];

  for (const [message, expected] of cases) {
    it(`turns "${message.slice(0, 32)}..." into an instruction`, async () => {
      const { svc, prisma } = make();
      prisma.rows = [fail('some_tool', message), fail('some_tool', message)];

      const [lesson] = await svc.detectLessons('biz_1');
      expect(lesson.lesson).toMatch(expected);
    });
  }

  it('still says something useful for an unrecognised error', async () => {
    const { svc, prisma } = make();
    prisma.rows = [fail('odd_tool', 'kaboom'), fail('odd_tool', 'kaboom')];

    const [lesson] = await svc.detectLessons('biz_1');
    expect(lesson.lesson).toMatch(/confirm its arguments/i);
  });
});

describe('the loop actually closes', () => {
  it('writes to the category the prompt already renders', async () => {
    // learned_corrections is what FlowOrchestrator renders as "Lessons from
    // past failures". Writing anywhere else would be a reader with no writer —
    // the defect this repo keeps producing.
    const { svc, prisma, memory } = make();
    prisma.rows = [fail('crm_create_contact', 'Contact not found'), fail('crm_create_contact', 'Contact not found')];

    await svc.consolidate('biz_1');

    expect(memory.upsert).toHaveBeenCalledTimes(1);
    expect(memory.written[0].category).toBe('learned_corrections');
  });

  it('stores the shape the prompt reader parses', async () => {
    // buildContextBlock JSON.parses the value and surfaces learnedPattern.
    const { svc, prisma, memory } = make();
    prisma.rows = [fail('crm_create_contact', 'Contact not found'), fail('crm_create_contact', 'Contact not found')];

    await svc.consolidate('biz_1');

    const parsed = JSON.parse(memory.written[0].value as string);
    expect(parsed.learnedPattern).toMatch(/crm_create_contact/);
  });

  it('a recurrence REFRESHES one lesson rather than accumulating duplicates', async () => {
    const { svc, prisma, memory } = make();
    // Realistic cuids. `cm1`/`cm2` are below the 8-char id threshold, so they
    // stayed distinct signatures, each under the recurrence floor, and nothing
    // was written — the test failed against correct code.
    prisma.rows = [
      fail('crm_create_contact', 'Contact cm3x9a2b0001 not found'),
      fail('crm_create_contact', 'Contact cm7z1k4p0002 not found'),
    ];

    await svc.consolidate('biz_1');
    await svc.consolidate('biz_1');

    const keys = new Set(memory.written.map((w) => w.key));
    expect(keys.size, 'each pass created a new key').toBe(1);
  });
});

describe('lessons fade', () => {
  it('every lesson is written with an expiry', async () => {
    // PERMANENCE: a fixed bug must stop shaping behaviour. Motor learning that
    // cannot unlearn is pathology — the same decay principle the endocrine
    // system uses.
    const { svc, prisma, memory } = make();
    prisma.rows = [fail('t', 'boom'), fail('t', 'boom')];

    await svc.consolidate('biz_1');

    const expiresAt = memory.written[0].expiresAt as Date;
    expect(expiresAt, 'lesson never expires').toBeInstanceOf(Date);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('confidence rises with recurrence', async () => {
    const { svc, prisma, memory } = make();
    prisma.rows = Array.from({ length: 6 }, () => fail('t', 'boom'));

    await svc.consolidate('biz_1');
    expect(memory.written[0].confidence as number).toBeGreaterThan(0.5);
  });
});

describe('it cannot flood or stall', () => {
  it('caps how many lessons reach the prompt', async () => {
    // NOISE: twenty lessons is no lessons.
    const { svc, prisma } = make();
    prisma.rows = Array.from({ length: 20 }, (_, i) => [
      fail(`tool_${i}`, `error ${i}`),
      fail(`tool_${i}`, `error ${i}`),
    ]).flat();

    expect((await svc.detectLessons('biz_1')).length).toBeLessThanOrEqual(5);
  });

  it('ranks the most frequent failure first', async () => {
    const { svc, prisma } = make();
    prisma.rows = [
      fail('rare', 'x'),
      fail('rare', 'x'),
      ...Array.from({ length: 8 }, () => fail('common', 'y')),
    ];

    expect((await svc.detectLessons('biz_1'))[0].toolName).toBe('common');
  });

  it('reads bounded and tenant-scoped — this is a cron across every business', async () => {
    const { svc, prisma } = make();
    await svc.detectLessons('biz_1');

    const q = prisma.lastQuery as { take?: number; where?: Record<string, unknown> };
    expect(q.take).toBeGreaterThan(0);
    expect(q.where?.businessId).toBe('biz_1');
    expect(q.where?.createdAt, 'no time window').toBeDefined();
  });

  it('survives a database failure', async () => {
    const { svc, prisma } = make();
    prisma.client.aiExecutionLog.findMany = vi.fn(() => Promise.reject(new Error('locked')));

    await expect(svc.detectLessons('biz_1')).resolves.toEqual([]);
  });

  it('one business failing does not stop the sweep', async () => {
    const { svc, prisma } = make();
    prisma.client.business.findMany = vi.fn(() =>
      Promise.resolve([{ id: 'biz_1' }, { id: 'biz_2' }]),
    );
    prisma.client.aiExecutionLog.findMany = vi.fn(() => Promise.reject(new Error('locked')));

    await expect(svc.scheduledConsolidation()).resolves.toBeUndefined();
  });

  it('works with no memory service registered', async () => {
    const bare = new KeyCortexCerebellumService(new PrismaStub() as never);
    await expect(bare.consolidate('biz_1')).resolves.toEqual([]);
  });

  it('has no hands — it writes memory, never actions', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, 'key-cortex-cerebellum.service.ts'), 'utf8');

    expect(src).not.toMatch(/executeTool|toolRegistry|executeToolDirectly|dispatch\(/);
  });
});
