/**
 * The amygdala — what, out of everything KEY noticed, actually matters.
 *
 * The watchers already work: they run on a live cron, publish onto the cortex
 * bus, and land in BusinessEvent. What was missing is the layer above them.
 * Nothing ranked one signal against another, so forty observations were forty
 * equally loud observations — detection without salience is noise.
 *
 * It also gives `cortisol` its first live writer. That hormone is defined as
 * "sustained threat to the business" and was only ever released inside
 * processConsciously, behind the Deep-think button. The business could be
 * visibly on fire and KEY's disposition would not move.
 *
 * The tests that matter are the two opposing adaptations, because a threshold
 * alone gives you one failure mode or the other:
 *
 *   HABITUATION    a business that ALWAYS carries thirty overdue invoices is
 *                  not in crisis at thirty. Without this, KEY's loudest signal
 *                  is permanently whatever its chattiest watcher emits.
 *   SENSITISATION  three overdue invoices in a business that normally has none
 *                  IS the urgent fact, and a pure count ranks it last.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexSalienceService } from './key-cortex-salience.service';

type Ev = { eventType: string; createdAt: Date };

class PrismaStub {
  events: Ev[] = [];
  lastQuery: Record<string, unknown> | null = null;
  client = {
    businessEvent: {
      findMany: vi.fn((q: Record<string, unknown>) => {
        this.lastQuery = q;
        return Promise.resolve(this.events);
      }),
    },
    business: { findMany: vi.fn(() => Promise.resolve([{ id: 'biz_1' }])) },
  };
}

class EndocrineStub {
  released: Array<{ signals: Array<Record<string, unknown>> }> = [];
  release = vi.fn((_b: string, signals: Array<Record<string, unknown>>) => {
    this.released.push({ signals });
  });
}

function make() {
  const prisma = new PrismaStub();
  const endocrine = new EndocrineStub();
  return { svc: new KeyCortexSalienceService(prisma as never, endocrine as never), prisma, endocrine };
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** n events of `type`, spread across the last `withinHours`. */
function recent(type: string, n: number, withinHours = 12): Ev[] {
  return Array.from({ length: n }, (_, i) => ({
    eventType: type,
    createdAt: new Date(Date.now() - ((i % withinHours) + 1) * HOUR),
  }));
}

/** n events of `type` spread across the baseline window, older than 24h. */
function historic(type: string, n: number): Ev[] {
  return Array.from({ length: n }, (_, i) => ({
    eventType: type,
    createdAt: new Date(Date.now() - (2 + (i % 12)) * DAY),
  }));
}

const OVERDUE = 'proactive.invoice_overdue';

describe('habituation — volume alone is not an emergency', () => {
  let ctx: ReturnType<typeof make>;

  beforeEach(() => {
    ctx = make();
  });

  it('a business that ALWAYS has overdue invoices is not in crisis at its normal level', async () => {
    // ~2.5/day historically, and 3 today. Business as usual.
    ctx.prisma.events = [...recent(OVERDUE, 3), ...historic(OVERDUE, 30)];

    const concerns = await ctx.svc.rank('biz_1');
    const overdue = concerns.find((c) => c.signal === OVERDUE);

    expect(overdue?.escalating ?? false, 'flagged a normal day as escalating').toBe(false);
  });

  it('does not dose cortisol for a business at its own baseline', async () => {
    ctx.prisma.events = [...recent(OVERDUE, 3), ...historic(OVERDUE, 30)];

    await ctx.svc.appraise('biz_1');

    // Either no concern at all, or one well below crisis. What must NOT happen
    // is a business in its normal state accumulating standing caution.
    const dosed = ctx.endocrine.released[0]?.signals[0]?.magnitude as number | undefined;
    expect(dosed === undefined || dosed < 0.2).toBe(true);
  });

  it('the loudest watcher does not automatically win', async () => {
    // 20 overdue invoices, all normal for this business — versus 2 sentiment
    // signals where there has never been one. A pure count ranks overdue first
    // and gets the priority exactly backwards.
    ctx.prisma.events = [
      ...recent(OVERDUE, 20),
      ...historic(OVERDUE, 200),
      ...recent('proactive.negative_sentiment', 2),
    ];

    const concerns = await ctx.svc.rank('biz_1');
    expect(concerns[0].signal).toBe('proactive.negative_sentiment');
  });
});

describe('sensitisation — change is what matters', () => {
  let ctx: ReturnType<typeof make>;

  beforeEach(() => {
    ctx = make();
  });

  it('a small absolute number against a zero baseline is salient', async () => {
    ctx.prisma.events = recent(OVERDUE, 3);

    const [concern] = await ctx.svc.rank('biz_1');
    expect(concern).toBeDefined();
    expect(concern.salience).toBeGreaterThan(0.25);
    expect(concern.summary).toMatch(/this is new/);
  });

  it('flags a genuine escalation above the business’s own normal', async () => {
    // ~0.9/day historically, 12 today.
    ctx.prisma.events = [...recent(OVERDUE, 12), ...historic(OVERDUE, 12)];

    const [concern] = await ctx.svc.rank('biz_1');
    expect(concern.escalating).toBe(true);
    expect(concern.summary).toMatch(/escalating/);
  });

  it('states the change, not just the count', async () => {
    // "12 overdue invoices" is a number the owner already knows. The baseline
    // is what makes it a fact worth surfacing — and release() requires it as
    // evidence.
    ctx.prisma.events = [...recent(OVERDUE, 12), ...historic(OVERDUE, 12)];

    const [concern] = await ctx.svc.rank('biz_1');
    expect(concern.summary).toMatch(/normal of/);
  });

  it('today’s spike does not inflate the baseline it is measured against', async () => {
    // The subtle one. If the baseline included the recent window, a spike would
    // partly hide itself — the larger it got, the more normal it would look.
    ctx.prisma.events = recent(OVERDUE, 40);

    const [concern] = await ctx.svc.rank('biz_1');
    expect(concern.baselineRate, 'recent events leaked into the baseline').toBe(0);
  });
});

describe('it gives cortisol its first live writer', () => {
  it('releases cortisol for a real escalation', async () => {
    // Until now the only release() caller was inside processConsciously, so a
    // business could be visibly on fire and KEY's disposition never moved.
    const { svc, prisma, endocrine } = make();
    prisma.events = [...recent('proactive.negative_sentiment', 8)];

    await svc.appraise('biz_1');

    expect(endocrine.release).toHaveBeenCalledTimes(1);
    expect(endocrine.released[0].signals[0].hormone).toBe('cortisol');
  });

  it('doses ONCE, from the worst concern only', async () => {
    // Dosing per concern would let a bad day in three areas saturate the
    // hormone — the overactive-amygdala failure this service exists to avoid.
    const { svc, prisma, endocrine } = make();
    prisma.events = [
      ...recent(OVERDUE, 10),
      ...recent('proactive.negative_sentiment', 10),
      ...recent('proactive.booking_no_show', 10),
    ];

    await svc.appraise('biz_1');

    expect(endocrine.release).toHaveBeenCalledTimes(1);
    expect(endocrine.released[0].signals).toHaveLength(1);
  });

  it('carries evidence — release() refuses an unexplained signal', async () => {
    const { svc, prisma, endocrine } = make();
    prisma.events = recent('proactive.negative_sentiment', 6);

    await svc.appraise('biz_1');
    expect(String(endocrine.released[0].signals[0].reason).length).toBeGreaterThan(20);
  });

  it('stays silent when there is nothing recent', async () => {
    const { svc, prisma, endocrine } = make();
    prisma.events = historic(OVERDUE, 40); // all older than the recent window

    expect(await svc.rank('biz_1')).toEqual([]);
    await svc.appraise('biz_1');
    expect(endocrine.release).not.toHaveBeenCalled();
  });
});

describe('it cannot flood, stall or act', () => {
  it('caps the number of concerns', async () => {
    const { svc, prisma } = make();
    prisma.events = [
      ...recent(OVERDUE, 5),
      ...recent('proactive.negative_sentiment', 5),
      ...recent('proactive.booking_no_show', 5),
    ];

    expect((await svc.rank('biz_1')).length).toBeLessThanOrEqual(5);
  });

  it('reads bounded, windowed and tenant-scoped', async () => {
    const { svc, prisma } = make();
    await svc.rank('biz_1');

    const q = prisma.lastQuery as { take?: number; where?: Record<string, unknown> };
    expect(q.take).toBeGreaterThan(0);
    expect(q.where?.businessId).toBe('biz_1');
    expect(q.where?.createdAt, 'no time window').toBeDefined();
  });

  it('survives a database failure', async () => {
    const { svc, prisma } = make();
    prisma.client.businessEvent.findMany = vi.fn(() => Promise.reject(new Error('locked')));

    await expect(svc.rank('biz_1')).resolves.toEqual([]);
  });

  it('one business failing does not stop the sweep', async () => {
    const { svc, prisma } = make();
    prisma.client.business.findMany = vi.fn(() =>
      Promise.resolve([{ id: 'biz_1' }, { id: 'biz_2' }]),
    );
    prisma.client.businessEvent.findMany = vi.fn(() => Promise.reject(new Error('locked')));

    await expect(svc.scheduledAppraisal()).resolves.toBeUndefined();
  });

  it('works with no endocrine system registered', async () => {
    const bare = new KeyCortexSalienceService(new PrismaStub() as never);
    await expect(bare.appraise('biz_1')).resolves.toEqual([]);
  });

  it('has no hands — it scores and modulates, never acts', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, 'key-cortex-salience.service.ts'), 'utf8');

    expect(src).not.toMatch(/executeTool|toolRegistry|executeToolDirectly|dispatch\(/);
  });
});
