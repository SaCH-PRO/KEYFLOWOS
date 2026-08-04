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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KeyCortexSalienceService } from './key-cortex-salience.service';

type Ev = { eventType: string; createdAt: Date; subjectId: string };

/**
 * Stands in for the two raw SQL queries the service issues.
 *
 * It models the SEMANTICS deliberately, not the SQL: distinct subject_id for
 * the recent window, and the average of per-day distinct counts for the
 * baseline. Both were verified against a real PostgreSQL database — a fixture
 * of 12 invoices re-emitted every 15 minutes for 24h gives 1152 rows and 12
 * distinct subjects, and the same pattern over 13 days gives a per-day average
 * of exactly 12.00 rather than the 0.92 that naive distinct-over-window
 * produces.
 *
 * The previous stub returned a plain row count over a fixture that created ONE
 * row per notional invoice. That baked the false model into the test: the
 * service counted emissions, the fixture supplied one emission per entity, and
 * the numbers agreed. In production the watchers re-emit every 15 minutes, so a
 * business with 12 overdue invoices would have been told it had 1152.
 */
class PrismaStub {
  events: Ev[] = [];
  lastQuery: unknown = null;
  private queries: string[] = [];

  client = {
    $queryRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      this.queries.push(sql);
      this.lastQuery = { sql, values };

      // values: [businessId, eventType, since] or [businessId, eventType, from, to]
      const eventType = values[1] as string;
      const matching = this.events.filter((e) => e.eventType === eventType);

      if (sql.includes('date_trunc')) {
        const from = values[2] as Date;
        const to = values[3] as Date;
        const inWindow = matching.filter((e) => e.createdAt >= from && e.createdAt < to);
        const distinctPerDay = sql.includes('COUNT(DISTINCT subject_id)');
        const perDay = new Map<string, string[]>();
        for (const e of inWindow) {
          const day = e.createdAt.toISOString().slice(0, 10);
          if (!perDay.has(day)) perDay.set(day, []);
          perDay.get(day)!.push(e.subjectId);
        }
        if (perDay.size === 0) return Promise.resolve([{ avg: null }]);
        const total = [...perDay.values()].reduce(
          (n, ids) => n + (distinctPerDay ? new Set(ids).size : ids.length),
          0,
        );
        return Promise.resolve([{ avg: total / perDay.size }]);
      }

      const since = values[2] as Date;
      const inWindow = matching.filter((e) => e.createdAt >= since);

      // The stub HONOURS the SQL rather than assuming it. A stub that always
      // returned a distinct count would keep passing if the service reverted to
      // COUNT(*), which is precisely how the previous fixture hid this defect —
      // it modelled the behaviour the author intended instead of the query the
      // service actually sends.
      const c = sql.includes('COUNT(DISTINCT subject_id)')
        ? new Set(inWindow.map((e) => e.subjectId)).size
        : inWindow.length;
      return Promise.resolve([{ c }]);
    }),
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

/** n DISTINCT entities of `type` seen in the last `withinHours`. */
function recent(type: string, n: number, withinHours = 12): Ev[] {
  return Array.from({ length: n }, (_, i) => ({
    eventType: type,
    subjectId: `${type}_e${i}`,
    createdAt: new Date(Date.now() - ((i % withinHours) + 1) * HOUR),
  }));
}

/**
 * n distinct entities per day, every day of the baseline window.
 *
 * Per DAY, not across the window: the baseline is "a normal day", so a fixture
 * spreading n entities over 13 days would describe a business with n/13 per day.
 */
function historic(type: string, n: number): Ev[] {
  const out: Ev[] = [];
  for (let day = 2; day <= 13; day++) {
    for (let i = 0; i < n; i++) {
      out.push({
        eventType: type,
        subjectId: `${type}_h${i}`,
        createdAt: new Date(Date.now() - day * DAY),
      });
    }
  }
  return out;
}

/** The production pattern: one entity, re-emitted every 15 minutes for 24h. */
function reEmitted(type: string, entities: number, sweeps = 96): Ev[] {
  const out: Ev[] = [];
  for (let i = 0; i < entities; i++) {
    for (let s = 0; s < sweeps; s++) {
      out.push({
        eventType: type,
        subjectId: `${type}_e${i}`,
        createdAt: new Date(Date.now() - s * 15 * 60_000),
      });
    }
  }
  return out;
}

const OVERDUE = 'proactive.invoice_overdue';

describe('habituation — volume alone is not an emergency', () => {
  let ctx: ReturnType<typeof make>;

  beforeEach(() => {
    ctx = make();
  });

  it('a business that ALWAYS has overdue invoices is not in crisis at its normal level', async () => {
    // ~2.5/day historically, and 3 today. Business as usual.
    ctx.prisma.events = [...recent(OVERDUE, 3), ...historic(OVERDUE, 3)];

    const concerns = await ctx.svc.rank('biz_1');
    const overdue = concerns.find((c) => c.signal === OVERDUE);

    expect(overdue?.escalating ?? false, 'flagged a normal day as escalating').toBe(false);
  });

  it('does not dose cortisol for a business at its own baseline', async () => {
    ctx.prisma.events = [...recent(OVERDUE, 3), ...historic(OVERDUE, 3)];

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
      ...historic(OVERDUE, 15),
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
    ctx.prisma.events = [...recent(OVERDUE, 12), ...historic(OVERDUE, 1)];

    const [concern] = await ctx.svc.rank('biz_1');
    expect(concern.escalating).toBe(true);
    expect(concern.summary).toMatch(/escalating/);
  });

  it('states the change, not just the count', async () => {
    // "12 overdue invoices" is a number the owner already knows. The baseline
    // is what makes it a fact worth surfacing — and release() requires it as
    // evidence.
    ctx.prisma.events = [...recent(OVERDUE, 12), ...historic(OVERDUE, 1)];

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
    prisma.events = historic(OVERDUE, 3); // all older than the recent window

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
    prisma.events = [...recent('invoice.paid', 14), ...historic('invoice.paid', 1)];

    const [best] = await svc.rankOpportunities('biz_1');
    expect(best).toBeDefined();
    expect(best.valence).toBe('opportunity');
    expect(best.summary).toMatch(/above trend/);
  });

  it('a busy business at its normal level is not a windfall', async () => {
    // Habituation applies to good news too, or KEY congratulates a business
    // every single day for existing.
    const { svc, prisma } = make();
    prisma.events = [...recent('booking.created', 3), ...historic('booking.created', 3)];

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
    prisma.events = [...recent('invoice.paid', 14), ...historic('invoice.paid', 1)];

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

  it('reads windowed, tenant-scoped, and counts entities rather than rows', () => {
    // The service issues raw SQL now, because neither thing it needs is
    // expressible in the Prisma query API: `count` has no DISTINCT, and
    // `groupBy` cannot truncate a timestamp to a day.
    const src = readFileSync(join(__dirname, 'key-cortex-salience.service.ts'), 'utf8');
    const fn = src.slice(src.indexOf('private async countSignal('));
    const body = fn.slice(0, fn.indexOf('/** Rank threat signals'));

    expect(body).toMatch(/business_id = \$\{businessId\}/);
    expect(body).toMatch(/created_at >= \$\{recentSince\}/);

    // The whole point: entities, not sightings of entities.
    expect(body).toMatch(/COUNT\(DISTINCT subject_id\)/);
    expect(body).not.toMatch(/COUNT\(\*\)/);

    // And a per-day average, not distinct-over-the-window — which would read
    // every steady state as a 13x escalation.
    expect(body).toMatch(/date_trunc\('day', created_at\)/);
    expect(body).toMatch(/AVG\(c\)/);
  });

  it('survives a database failure', async () => {
    const { svc, prisma } = make();
    prisma.client.$queryRaw = vi.fn(() => Promise.reject(new Error('locked')));

    await expect(svc.rank('biz_1')).resolves.toEqual([]);
  });

  it('one business failing does not stop the sweep', async () => {
    const { svc, prisma } = make();
    prisma.client.business.findMany = vi.fn(() =>
      Promise.resolve([{ id: 'biz_1' }, { id: 'biz_2' }]),
    );
    prisma.client.$queryRaw = vi.fn(() => Promise.reject(new Error('locked')));

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

describe('the counted facts finally escape', () => {
  // appraise() builds up to ten ranked concerns with sentences like "12 overdue
  // invoices in 24h against a normal of 3/day — escalating", then discarded
  // eight and let two survive only as the `reason` on a hormone. The endocrine
  // block that carries them is labelled disposition and ends with "It must NOT
  // change what you report as fact" — so there was NO path on which KEY could
  // state the number. The system knew it exactly and could only imply it.

  it('says nothing before the first appraisal', () => {
    const { svc } = make();
    expect(svc.describeForPrompt('biz_1')).toBeNull();
  });

  it('states the summary as a fact once appraised', async () => {
    const { svc, prisma } = make();
    prisma.events = [...recent('proactive.invoice_overdue', 12), ...historic('proactive.invoice_overdue', 1)];
    await svc.appraise('biz_1');

    const text = svc.describeForPrompt('biz_1')!;
    expect(text).toMatch(/overdue/);
    expect(text).toMatch(/exact counts from its event log/);
    expect(text).toMatch(/may be stated plainly/);
  });

  it('contradicts nothing — it explicitly overrides the disposition framing', async () => {
    // The same sentence rides on the hormone as "Basis:", under an instruction
    // NOT to treat it as reportable fact. Without an explicit counter the model
    // gets two opposing directives about one number.
    const { svc, prisma } = make();
    prisma.events = [...recent('proactive.invoice_overdue', 12), ...historic('proactive.invoice_overdue', 1)];
    await svc.appraise('biz_1');

    expect(svc.describeForPrompt('biz_1')).toMatch(/not inference/);
  });

  it('goes quiet rather than asserting a stale count as current', async () => {
    const { svc, prisma } = make();
    prisma.events = [...recent('proactive.invoice_overdue', 12), ...historic('proactive.invoice_overdue', 1)];
    await svc.appraise('biz_1');

    const muchLater = new Date(Date.now() + 4 * 60 * 60 * 1000);
    expect(svc.describeForPrompt('biz_1', muchLater)).toBeNull();
  });

  it('is synchronous, because the chat path that reads it is', async () => {
    const { svc, prisma } = make();
    prisma.events = [...recent('proactive.invoice_overdue', 12), ...historic('proactive.invoice_overdue', 1)];
    await svc.appraise('biz_1');

    expect(svc.describeForPrompt('biz_1')).not.toBeInstanceOf(Promise);
  });

  it('never mixes one business into another', async () => {
    const { svc, prisma } = make();
    prisma.events = [...recent('proactive.invoice_overdue', 12), ...historic('proactive.invoice_overdue', 1)];
    await svc.appraise('biz_1');

    expect(svc.describeForPrompt('biz_other')).toBeNull();
  });
});

describe('it is wired to the chat, not merely written', () => {
  const triage = readFileSync(join(__dirname, 'cognitive-triage.service.ts'), 'utf8')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'))
    .join('\n');

  it('reaches the system prompt through standingContext', () => {
    const block = triage.slice(triage.indexOf('private standingContext('));
    const body = block.slice(0, block.indexOf('\n  private '));
    expect(body).toMatch(/this\.salience\?\.describeForPrompt\(businessId\)/);
  });

  it('outranks style and team distribution under the budget', () => {
    // withinBudget drops whole trailing sections. A counted fact should survive
    // a squeeze that a tone preference does not.
    const block = triage.slice(triage.indexOf('private standingContext('));
    const body = block.slice(0, block.indexOf('\n  private '));
    expect(body.indexOf('this.salience?')).toBeLessThan(body.indexOf('this.epigenetics?'));
    expect(body.indexOf('this.salience?')).toBeLessThan(body.indexOf('this.incentive?'));
  });

  it('did not shift the pre-existing constructor positions', () => {
    const ctor = triage.slice(triage.indexOf('constructor('), triage.indexOf(') {}'));
    const params = [...ctor.matchAll(/private readonly (\w+)\?/g)].map((m) => m[1]);
    expect(params.slice(0, 3)).toEqual(['router', 'endocrine', 'interoception']);
  });
});

describe('it counts things, not sightings of things', () => {
  // THE test that was missing. The watchers re-publish one event for every
  // still-matching entity on every sweep, and the sweep runs every 15 minutes
  // with no dedupe. Counting rows counted emissions: a business with 12 overdue
  // invoices would have been told, as a stated fact about its own books, that it
  // had 1152.
  //
  // The old fixture created exactly one row per notional invoice, so the false
  // model and the test agreed with each other and the suite stayed green.
  // reEmitted() models what production actually writes.

  it('reports 12 invoices as 12, not as 1152 emissions', async () => {
    const { svc, prisma } = make();
    prisma.events = [
      ...reEmitted(OVERDUE, 12),            // 12 invoices × 96 sweeps = 1152 rows
      ...historic(OVERDUE, 1),              // normally ~1/day
    ];

    const [concern] = await svc.rank('biz_1');

    expect(concern.recentCount).toBe(12);
    expect(concern.summary).toMatch(/\b12 overdue invoices\b/);
    expect(concern.summary).not.toMatch(/1152/);
  });

  it('does not read a steady state as an escalation', async () => {
    // The second trap, and the one that would have been introduced by fixing
    // only the first: 12 invoices overdue every day for a fortnight are 12
    // distinct subjects across 13 days. Distinct-over-the-window reads that as a
    // baseline of 0.9/day against 12 today — a 13x false escalation on a
    // business where nothing changed. Verified against real PostgreSQL: the
    // per-day average returns 12.00 and the ratio is 1.00.
    const { svc, prisma } = make();
    prisma.events = [...reEmitted(OVERDUE, 12), ...historic(OVERDUE, 12)];

    const [concern] = await svc.rank('biz_1');

    expect(concern?.escalating ?? false).toBe(false);
  });

  it('still catches a real escalation through the re-emission noise', async () => {
    const { svc, prisma } = make();
    prisma.events = [...reEmitted(OVERDUE, 12), ...historic(OVERDUE, 2)];

    const [concern] = await svc.rank('biz_1');

    expect(concern.escalating).toBe(true);
    expect(concern.recentCount).toBe(12);
  });

  it('never mixes units — opportunities arrive once per occurrence', async () => {
    // Opportunity signals come from the event bridge, one row per real event,
    // while threat signals come from re-emitting watchers. A row count would put
    // one true number and one 96x-inflated number in the same list of "facts".
    const { svc, prisma } = make();
    prisma.events = [
      ...reEmitted(OVERDUE, 5),
      ...recent('invoice.paid', 5),
      ...historic('invoice.paid', 1),
      ...historic(OVERDUE, 1),
    ];

    const threats = await svc.rank('biz_1');
    const opportunities = await svc.rankOpportunities('biz_1');

    expect(threats[0].recentCount).toBe(5);
    expect(opportunities[0].recentCount).toBe(5);
  });
});
