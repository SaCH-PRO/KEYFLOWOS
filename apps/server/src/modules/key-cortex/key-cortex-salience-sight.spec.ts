/**
 * MEM-SALIENCE-SIGHT (D-234, D-100; owner ruling D-257): the salience feed and the endocrine "Basis:" lines that
 * CognitiveTriageService.standingContext puts into every flow-chat system prompt drop the counts derived from money
 * events (overdue invoices, invoices paid, payments received) for a reader without revenue read, and every signal
 * whose module the reader may not read. The selection of what is shown happens after that filter, and the hormone
 * levels a reader is told about are derived only from signals that reader may see, so a withheld signal is not an
 * indirect one either: a non-revenue reader's standing context is byte-identical whether the business has 0 or 50
 * paid invoices. A reader with every module (an owner on role defaults) sees exactly what was shown before.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { KeyCortexSalienceService, salienceSignalTypes } from './key-cortex-salience.service';
import { KeyCortexEndocrineService } from './key-cortex-endocrine.service';
import { CognitiveTriageService } from './cognitive-triage.service';
import { AdaptiveRouterService } from './adaptive-router.service';
import { EVENT_MODULES, NO_MODULE_SIGHT, moduleSightOf } from './key-cortex-prompt-context.service';

beforeEach(() => {
  vi.stubEnv('ENABLE_SCHEDULERS_IN_TEST', '1');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

type Ev = { eventType: string; createdAt: Date; subjectId: string };

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const BIZ = 'biz_mem_salience_sight';

/** The two raw counts the service issues, by their semantics (as key-cortex-salience.spec.ts models them). */
function prismaWith(events: Ev[]) {
  return {
    client: {
      $queryRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('?');
        const matching = events.filter((e) => e.eventType === (values[1] as string));
        if (sql.includes('date_trunc')) {
          const from = values[2] as Date;
          const to = values[3] as Date;
          const perDay = new Map<string, Set<string>>();
          for (const e of matching.filter((x) => x.createdAt >= from && x.createdAt < to)) {
            const day = e.createdAt.toISOString().slice(0, 10);
            perDay.set(day, (perDay.get(day) ?? new Set()).add(e.subjectId));
          }
          if (perDay.size === 0) return Promise.resolve([{ avg: null }]);
          const total = [...perDay.values()].reduce((n, s) => n + s.size, 0);
          return Promise.resolve([{ avg: total / perDay.size }]);
        }
        const since = values[2] as Date;
        return Promise.resolve([{ c: new Set(matching.filter((e) => e.createdAt >= since).map((e) => e.subjectId)).size }]);
      }),
      keyCortexMemory: { upsert: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({ count: 0 })) },
      business: { findMany: vi.fn(async () => [{ id: BIZ }]) },
    },
  };
}

function recent(type: string, n: number): Ev[] {
  return Array.from({ length: n }, (_, i) => ({
    eventType: type,
    subjectId: `${type}_r${i}`,
    createdAt: new Date(Date.now() - ((i % 12) + 1) * HOUR),
  }));
}

function historic(type: string, perDay: number): Ev[] {
  const out: Ev[] = [];
  for (let d = 2; d <= 13; d += 1) {
    for (let i = 0; i < perDay; i += 1) {
      out.push({ eventType: type, subjectId: `${type}_d${d}_${i}`, createdAt: new Date(Date.now() - d * DAY) });
    }
  }
  return out;
}

/** Booking activity, identical in every world below: no-shows (a threat) and new bookings (momentum). */
const BOOKINGS: Ev[] = [
  ...recent('proactive.booking_no_show', 3),
  ...recent('booking.created', 6),
  ...historic('booking.created', 1),
];

/** Money activity: 50 paid invoices, 12 overdue, 20 payments received, all new against an empty fortnight. */
const MONEY: Ev[] = [
  ...recent('invoice.paid', 50),
  ...recent('proactive.invoice_overdue', 12),
  ...recent('payment.received', 20),
];

/** Readers. An owner on role defaults reads every module; this STAFF member's explicit map has no revenue. */
const FULL = moduleSightOf(EVENT_MODULES);
const NO_REVENUE = moduleSightOf(['bookings', 'crm', 'operations']);
const REVENUE_ONLY = moduleSightOf(['revenue']);

const MONEY_WORDS = /overdue invoices|invoices paid|payments received|invoice|payment/i;

async function world(events: Ev[]) {
  const endocrine = new KeyCortexEndocrineService();
  const salience = new KeyCortexSalienceService(prismaWith(events) as never, endocrine);
  await salience.appraise(BIZ);
  const triage = new CognitiveTriageService(
    new AdaptiveRouterService(),
    endocrine,
    undefined,
    undefined,
    undefined,
    undefined,
    salience,
  );
  return { endocrine, salience, triage };
}

describe('MEM-SALIENCE-SIGHT: the salience feed (describeForPrompt) by the reader\'s revenue and module sight', () => {
  it('a reader without revenue read sees no overdue-invoice, paid-invoice or payment count', async () => {
    const { salience } = await world([...BOOKINGS, ...MONEY]);
    const text = salience.describeForPrompt(BIZ, new Date(), NO_REVENUE) ?? '';
    expect(text).not.toMatch(MONEY_WORDS);
  });

  it('a reader with the bookings module still sees the booking signals', async () => {
    const { salience } = await world([...BOOKINGS, ...MONEY]);
    const text = salience.describeForPrompt(BIZ, new Date(), NO_REVENUE) ?? '';
    expect(text).toMatch(/booking no-shows/);
  });

  it('the momentum line is chosen after the filter: new bookings, not nothing, when paid invoices outrank them', async () => {
    const { salience } = await world([...BOOKINGS, ...MONEY]);
    expect(salience.describeForPrompt(BIZ, new Date(), FULL)).toMatch(/invoices paid/);
    expect(salience.describeForPrompt(BIZ, new Date(), NO_REVENUE)).toMatch(/new bookings/);
  });

  it('a memberless turn (no module) sees no signal at all', async () => {
    const { salience } = await world([...BOOKINGS, ...MONEY]);
    expect(salience.describeForPrompt(BIZ, new Date(), NO_MODULE_SIGHT)).toBeNull();
  });

  it('a revenue reader sees the money counts, and no booking signal without the bookings module', async () => {
    const { salience } = await world([...BOOKINGS, ...MONEY]);
    const text = salience.describeForPrompt(BIZ, new Date(), REVENUE_ONLY) ?? '';
    expect(text).toMatch(/overdue invoices/);
    expect(text).not.toMatch(/booking/);
  });

  it('a reader with every module sees what describeForPrompt showed before (unprojected)', async () => {
    const { salience } = await world([...BOOKINGS, ...MONEY]);
    const now = new Date();
    expect(salience.describeForPrompt(BIZ, now, FULL)).toBe(salience.describeForPrompt(BIZ, now));
    expect(salience.describeForPrompt(BIZ, now, FULL)).toMatch(/overdue invoices/);
  });
});

describe('MEM-SALIENCE-SIGHT: the endocrine Basis lines by the reader\'s sight', () => {
  it('a reader without revenue read is told no hormone basis derived from money signals', async () => {
    const { endocrine } = await world([...BOOKINGS, ...MONEY]);
    const text = endocrine.describeForPrompt(BIZ, new Date(), NO_REVENUE) ?? '';
    expect(text).not.toMatch(MONEY_WORDS);
  });

  it('booking-derived disposition still reaches a reader with the bookings module', async () => {
    const { endocrine } = await world([...BOOKINGS, ...MONEY]);
    const text = endocrine.describeForPrompt(BIZ, new Date(), NO_REVENUE) ?? '';
    expect(text).toMatch(/booking no-shows/);
  });

  it('a reader with every module is told exactly the unprojected disposition', async () => {
    const { endocrine } = await world([...BOOKINGS, ...MONEY]);
    const now = new Date();
    expect(endocrine.describeForPrompt(BIZ, now, FULL)).toBe(endocrine.describeForPrompt(BIZ, now));
    expect(endocrine.describeForPrompt(BIZ, now, FULL)).toMatch(/overdue invoices/);
    expect(endocrine.effortMultiplier(BIZ, now, FULL)).toBe(endocrine.effortMultiplier(BIZ, now));
  });

  it('business-wide evidence (no module named) reaches every reader, a memberless turn included', () => {
    const endocrine = new KeyCortexEndocrineService();
    endocrine.release(BIZ, [{ hormone: 'malaise', magnitude: 0.3, reason: 'two organs unreachable' }]);
    expect(endocrine.describeForPrompt(BIZ, new Date(), NO_MODULE_SIGHT)).toMatch(/two organs unreachable/);
    expect(endocrine.describeForPrompt(BIZ, new Date(), NO_REVENUE)).toMatch(/two organs unreachable/);
  });
});

describe('MEM-SALIENCE-SIGHT: no indirect signal in the standing context of a reader without revenue read', () => {
  it('identical standing context, tier and arousal whether the business has 0 or 50 paid invoices', async () => {
    const without = await world([...BOOKINGS]);
    const withMoney = await world([...BOOKINGS, ...MONEY]);
    const message = 'how is the week going?';

    const a = without.triage.triage(BIZ, message, false, NO_REVENUE);
    const b = withMoney.triage.triage(BIZ, message, false, NO_REVENUE);

    expect(b.standingContext).not.toBeNull();
    expect(b.standingContext).not.toMatch(MONEY_WORDS);
    expect(b.standingContext).toBe(a.standingContext);
    expect(b.arousal).toBe(a.arousal);
    expect(b.tier).toBe(a.tier);
    expect(b.maxTokens).toBe(a.maxTokens);
    expect(b.reason).toBe(a.reason);
  });

  it('control: an owner reading every module is told the money counts', async () => {
    const { triage } = await world([...BOOKINGS, ...MONEY]);
    expect(triage.triage(BIZ, 'how is the week going?', false, FULL).standingContext).toMatch(/overdue invoices/);
  });

  it('a triage call that names no reader fails closed: no money count, no module signal', async () => {
    const { triage } = await world([...BOOKINGS, ...MONEY]);
    const text = triage.triage(BIZ, 'how is the week going?').standingContext ?? '';
    expect(text).not.toMatch(MONEY_WORDS);
    expect(text).not.toMatch(/booking/);
  });
});

describe('MEM-SALIENCE-SIGHT review CR F1: a reader with partial sight is told no more than the unprojected view', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('over six hourly appraisals, a reader who sees every signal group but not every module gets no higher cortisol or effort than the owner', async () => {
    vi.useFakeTimers();
    const start = new Date('2026-11-22T00:00:00Z');
    vi.setSystemTime(start);
    const events: Ev[] = [
      ...recent('proactive.invoice_overdue', 12),
      ...recent('proactive.negative_sentiment', 4),
      ...recent('proactive.booking_no_show', 3),
    ];
    const endocrine = new KeyCortexEndocrineService();
    const salience = new KeyCortexSalienceService(prismaWith(events) as never, endocrine);
    for (let h = 0; h < 6; h += 1) {
      vi.setSystemTime(new Date(start.getTime() + h * HOUR));
      await salience.appraise(BIZ);
    }
    const now = new Date(start.getTime() + 5 * HOUR);
    const allButTeam = moduleSightOf(EVENT_MODULES.filter((m) => m !== 'team'));
    const owner = endocrine.read(BIZ, now).find((h) => h.name === 'cortisol')!.level;
    const partial = endocrine.readFor(BIZ, allButTeam, now).find((h) => h.name === 'cortisol')!.level;
    expect(partial).toBeLessThanOrEqual(owner + 1e-9);
    expect(endocrine.effortMultiplier(BIZ, now, allButTeam)).toBeLessThanOrEqual(endocrine.effortMultiplier(BIZ, now) + 1e-9);
  });
});

describe('MEM-SALIENCE-SIGHT review SEC-MSS-1: no signal is cut before the reader filter', () => {
  it('no valence has more signal types than the concerns kept per appraisal', () => {
    const { threat, opportunity, maxConcerns } = salienceSignalTypes();
    expect(threat.length).toBeLessThanOrEqual(maxConcerns);
    expect(opportunity.length).toBeLessThanOrEqual(maxConcerns);
  });
});

describe('MEM-SALIENCE-SIGHT review CR F1b: business-wide and module evidence together are no louder for a partial reader', () => {
  it('interleaved business-wide and booking cortisol: partial level and effort never exceed the owner at any decay gap', () => {
    const endocrine = new KeyCortexEndocrineService();
    const start = new Date('2026-11-22T00:00:00Z').getTime();
    for (let h = 0; h < 6; h += 1) {
      const at = new Date(start + h * HOUR);
      endocrine.release(BIZ, [{ hormone: 'cortisol', magnitude: 0.35, reason: 'bulk_delete detected in the audit stream' }], at);
      endocrine.release(
        BIZ,
        [{ hormone: 'cortisol', magnitude: 0.35, reason: '3 booking no-shows in 24h', modules: ['bookings'] }],
        at,
        [{ hormone: 'cortisol', magnitude: 0.35, reason: '3 booking no-shows in 24h', modules: ['bookings'] }],
      );
    }
    const allButTeam = moduleSightOf(EVENT_MODULES.filter((m) => m !== 'team'));
    for (const gap of [0, 1, 3, 10, 20]) {
      const now = new Date(start + (5 + gap) * HOUR);
      const owner = endocrine.read(BIZ, now).find((h) => h.name === 'cortisol')?.level ?? 0;
      const partial = endocrine.readFor(BIZ, allButTeam, now).find((h) => h.name === 'cortisol')?.level ?? 0;
      expect(partial, `gap ${gap}h`).toBeLessThanOrEqual(owner + 1e-9);
      expect(endocrine.effortMultiplier(BIZ, now, allButTeam), `gap ${gap}h`).toBeLessThanOrEqual(endocrine.effortMultiplier(BIZ, now) + 1e-9);
    }
    // Both kinds of evidence still reach the partial reader.
    const text = endocrine.describeForPrompt(BIZ, new Date(start + 5 * HOUR), allButTeam) ?? '';
    expect(text).toMatch(/booking no-shows/);
    expect(text).toMatch(/bulk_delete/);
  });
});

describe('MEM-SALIENCE-SIGHT review CR F3: a strand residue below the noise floor is not carried into the next dose', () => {
  it('after the owner level decays out, one fresh dose leaves a partial reader no louder than the owner', () => {
    const endocrine = new KeyCortexEndocrineService();
    const t0 = new Date('2026-11-22T00:00:00Z').getTime();
    endocrine.release(BIZ, [{ hormone: 'cortisol', magnitude: 0.35, reason: 'bulk_delete detected in the audit stream' }], new Date(t0));
    const later = new Date(t0 + 31 * HOUR);
    expect(endocrine.read(BIZ, later)).toEqual([]);
    endocrine.release(BIZ, [{ hormone: 'cortisol', magnitude: 0.35, reason: 'bulk_delete detected in the audit stream' }], later);
    const owner = endocrine.read(BIZ, later).find((h) => h.name === 'cortisol')!.level;
    const partial = endocrine.readFor(BIZ, NO_MODULE_SIGHT, later).find((h) => h.name === 'cortisol')!.level;
    expect(partial).toBeLessThanOrEqual(owner + 1e-9);
  });
});

describe('MEM-SALIENCE-SIGHT review SEC-MSS-4: a strand residue below the noise floor carries no stale reason', () => {
  it('after the owner level decays out, a partial reader is told only the fresh reason, as the owner is', () => {
    const endocrine = new KeyCortexEndocrineService();
    const t0 = new Date('2026-11-22T00:00:00Z').getTime();
    endocrine.release(BIZ, [{ hormone: 'cortisol', magnitude: 0.35, reason: 'an old anomaly' }], new Date(t0));
    const later = new Date(t0 + 31 * HOUR);
    expect(endocrine.read(BIZ, later)).toEqual([]);
    endocrine.release(BIZ, [{ hormone: 'cortisol', magnitude: 0.35, reason: 'a fresh anomaly' }], later);
    const owner = endocrine.read(BIZ, later).find((h) => h.name === 'cortisol')!.reasons;
    const partial = endocrine.readFor(BIZ, NO_MODULE_SIGHT, later).find((h) => h.name === 'cortisol')!.reasons;
    expect(owner).toEqual(['a fresh anomaly']);
    expect(partial).toEqual(owner);
  });
});
