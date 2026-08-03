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

describe('the second polarity — KEY notices good weeks too', () => {
  // The first version detected only threat, which made KEY a sentinel rather
  // than a partner: it could tell you the building was on fire and never that
  // you were having your best month.
  //
  // `dopamine` is defined in the endocrine system as "sustained opportunity or
  // momentum" and had NO writer anywhere in the server — a hormone that decays,
  // is excluded from effortMultiplier, and was never once released.
  it('detects momentum against the business’s own normal', async () => {
    const { svc, prisma } = make();
    prisma.events = [...recent('invoice.paid', 14), ...historic('invoice.paid', 14)];

    const [best] = await svc.rankOpportunities('biz_1');
    expect(best).toBeDefined();
    expect(best.valence).toBe('opportunity');
    expect(best.summary).toMatch(/above trend/);
  });

  it('a busy business at its normal level is not a windfall', async () => {
    // Habituation applies to good news too, or KEY congratulates a business
    // every single day for existing.
    const { svc, prisma } = make();
    prisma.events = [...recent('booking.created', 3), ...historic('booking.created', 30)];

    const opportunities = await svc.rankOpportunities('biz_1');
    expect(opportunities.every((o) => !o.escalating)).toBe(true);
  });

  it('releases DOPAMINE, giving that hormone its first writer', async () => {
    const { svc, prisma, endocrine } = make();
    prisma.events = recent('invoice.paid', 10);

    await svc.appraise('biz_1');

    const hormones = endocrine.released[0].signals.map((s) => s.hormone);
    expect(hormones).toContain('dopamine');
  });

  it('holds BOTH at once — a business can be winning and losing in the same week', async () => {
    // Not a contradiction. Cortisol tightens risk tolerance while dopamine
    // widens exploration, and they describe different facts.
    const { svc, prisma, endocrine } = make();
    prisma.events = [
      ...recent('proactive.negative_sentiment', 6),
      ...recent('invoice.paid', 12),
    ];

    const all = await svc.appraise('biz_1');

    const hormones = endocrine.released[0].signals.map((s) => s.hormone).sort();
    expect(hormones).toEqual(['cortisol', 'dopamine']);
    expect(all.some((c) => c.valence === 'threat')).toBe(true);
    expect(all.some((c) => c.valence === 'opportunity')).toBe(true);
  });

  it('still doses only ONCE per valence', async () => {
    // Five opportunity signals must not mean five doses.
    const { svc, prisma, endocrine } = make();
    prisma.events = [
      ...recent('invoice.paid', 8),
      ...recent('booking.created', 8),
      ...recent('contact.created', 8),
    ];

    await svc.appraise('biz_1');

    const dopamine = endocrine.released[0].signals.filter((s) => s.hormone === 'dopamine');
    expect(dopamine).toHaveLength(1);
  });

  it('good news can never buy KEY less thinking', async () => {
    // The safety property. effortMultiplier excludes dopamine by design, so a
    // great month cannot make KEY lazier about a hard question. Asserted here
    // because this service is what makes dopamine reachable at all.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const endocrineSrc = readFileSync(
      join(__dirname, 'key-cortex-endocrine.service.ts'),
      'utf8',
    );
    const fn = endocrineSrc.slice(endocrineSrc.indexOf('effortMultiplier('));

    expect(fn.slice(0, fn.indexOf('\n  }'))).toMatch(/!== 'dopamine'/);
  });

  it('never describes a good week as "escalating"', async () => {
    // The phrasing is not cosmetic: this string is the evidence stored on the
    // hormone and the sentence the owner eventually reads. "14 invoices paid,
    // escalating" reads as an alarm about getting paid.
    const { svc, prisma } = make();
    prisma.events = [...recent('invoice.paid', 14), ...historic('invoice.paid', 14)];

    const opportunities = await svc.rankOpportunities('biz_1');
    expect(opportunities.length).toBeGreaterThan(0);
    for (const o of opportunities) {
      expect(o.summary, `"${o.summary}" uses threat vocabulary`).not.toMatch(/escalating/);
    }
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
