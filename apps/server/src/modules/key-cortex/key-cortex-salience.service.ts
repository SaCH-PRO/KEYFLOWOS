import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../core/prisma/prisma.service';
import { KeyCortexEndocrineService } from './key-cortex-endocrine.service';

/**
 * The amygdala — what, out of everything KEY noticed, actually matters.
 *
 * The watchers work. InvoiceOverdueWatcher, BookingNoShowWatcher and
 * SentimentWatcher all run on a live cron, publish onto the cortex bus, and
 * land in BusinessEvent. What was missing is the layer above them: nothing
 * ranked one signal against another, so forty observations were forty equally
 * loud observations. Detection without salience is noise.
 *
 * It also gives `cortisol` its first writer on a live path. That hormone is
 * defined as "sustained threat to the business" and, until now, was only ever
 * released inside processConsciously — behind the Deep-think button. The
 * business could be visibly on fire and KEY's disposition would not move,
 * because nothing connected threat detection to threat response.
 *
 * THE TWO MECHANISMS THAT MAKE IT AN AMYGDALA RATHER THAN A COUNTER
 *
 * An overactive amygdala produces constant crisis; an underactive one misses
 * real danger. The balance between them is not a threshold, it is a pair of
 * opposing adaptations:
 *
 *   HABITUATION    a signal repeating unchanged loses salience. Thirty overdue
 *                  invoices in a business that always runs thirty overdue
 *                  invoices is its normal state, not an emergency. Without
 *                  this, KEY's loudest signal is permanently whatever its
 *                  chattiest watcher emits.
 *
 *   SENSITISATION  a signal that is ESCALATING gains salience, even from a low
 *                  base. Three overdue invoices in a business that normally has
 *                  none is the more urgent fact, and a pure count would rank it
 *                  last.
 *
 * Together they make KEY react to CHANGE rather than to volume, which is what
 * the framework means by an amygdala that neither cries wolf nor sleeps.
 *
 * Like homeostasis and the cerebellum, this has no hands: it scores, and it
 * modulates disposition. It never acts on the business.
 */

/** The recent window a threat is judged in. */
const RECENT_HOURS = 24;

/** The baseline it is judged against — what "normal" looks like here. */
const BASELINE_DAYS = 14;

/** Below this, a signal is not worth KEY's attention or the user's. */
const SALIENCE_FLOOR = 0.25;

/** Past this, a cached appraisal is history rather than a current fact. */
const CONCERN_TTL_MS = 90 * 60 * 1000;

/** How many concerns are worth surfacing at once. */
const MAX_CONCERNS = 5;

/**
 * Event types the amygdala treats as threat signals, with their intrinsic
 * weight. A no-show costs one slot; sustained negative sentiment costs the
 * relationship.
 */
const THREAT_SIGNALS: Record<string, number> = {
  'proactive.invoice_overdue': 0.7,
  'proactive.negative_sentiment': 0.9,
  'proactive.booking_no_show': 0.5,
};

/**
 * Opportunity signals — the amygdala's second polarity.
 *
 * The first version of this service detected only threat, which made KEY a
 * sentinel rather than a partner: it could tell you the building was on fire
 * and never that you were having your best week. `dopamine` is defined in the
 * endocrine system as "sustained opportunity or momentum — widens exploration"
 * and had NO writer anywhere in the server. A hormone that decays, is excluded
 * from effortMultiplier, and is never released.
 *
 * These are ordinary business events rather than watcher output, because
 * momentum is not something a watcher fires on — it is the ordinary events
 * arriving faster than usual.
 *
 * Releasing dopamine is safe by construction: effortMultiplier deliberately
 * excludes it, so a good week can widen exploration but can never buy KEY less
 * thinking.
 */
const OPPORTUNITY_SIGNALS: Record<string, number> = {
  'invoice.paid': 0.6,
  'payment.received': 0.6,
  'booking.created': 0.5,
  'booking.completed': 0.5,
  'contact.created': 0.4,
};

export interface Concern {
  signal: string;
  /** Which way this cuts. Threat raises caution; opportunity widens exploration. */
  valence: 'threat' | 'opportunity';
  /** 0–1. Change-weighted, not volume-weighted. */
  salience: number;
  recentCount: number;
  /** Expected count for this window, from the business's own history. */
  baselineRate: number;
  escalating: boolean;
  summary: string;
}

@Injectable()
export class KeyCortexSalienceService {
  private readonly logger = new Logger(KeyCortexSalienceService.name);

  /**
   * Last appraisal per business, so `describeForPrompt` can be SYNCHRONOUS —
   * it is read from CognitiveTriageService.standingContext on the request path
   * for every message. Same reasoning as the endocrine and immune services.
   *
   * In-memory only, deliberately. A restart means KEY says nothing about
   * concerns until the hourly cron runs again, and that is the right failure
   * direction: silence rather than a stale count asserted as current fact.
   */
  private readonly current = new Map<string, { concerns: Concern[]; appraisedAt: Date }>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() private readonly endocrine?: KeyCortexEndocrineService,
  ) {}

  /**
   * Hourly rather than per-message: a threat assessment is a standing judgement
   * about the business, not a property of whatever someone just typed.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async scheduledAppraisal(): Promise<void> {
    const businesses = await this.findAllActiveBusinesses();
    for (const businessId of businesses) {
      try {
        await this.appraise(businessId);
      } catch (err: unknown) {
        this.logger.warn(
          `[salience] ${businessId} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Score current threats and convert sustained ones into cortisol.
   *
   * Returns the concerns so this is observable rather than a silent effect.
   */
  async appraise(businessId: string): Promise<Concern[]> {
    const [threats, opportunities] = await Promise.all([
      this.rank(businessId),
      this.rankOpportunities(businessId),
    ]);

    const all = [...threats, ...opportunities];
    this.current.set(businessId, { concerns: all, appraisedAt: new Date() });
    if (all.length === 0 || !this.endocrine) return all;

    // ONE dose per valence, from the strongest of each. Dosing per concern
    // would let a busy day in three areas saturate the hormone, which is the
    // overactive-amygdala failure this service exists to avoid.
    //
    // Both may fire in the same pass, and that is correct rather than
    // contradictory: a business can be winning new work and losing old clients
    // in the same week, and KEY should hold both. Cortisol tightens risk
    // tolerance while dopamine widens exploration, and effortMultiplier
    // deliberately reads only the caution side — so optimism can never buy less
    // thinking, no matter how good the week.
    const signals = [];
    const worstThreat = threats[0];
    const bestOpportunity = opportunities[0];

    if (worstThreat) {
      signals.push({
        hormone: 'cortisol' as const,
        magnitude: worstThreat.salience * 0.35,
        reason: worstThreat.summary,
      });
    }
    if (bestOpportunity) {
      signals.push({
        hormone: 'dopamine' as const,
        magnitude: bestOpportunity.salience * 0.35,
        reason: bestOpportunity.summary,
      });
    }

    this.endocrine.release(businessId, signals);

    this.logger.log(
      `[salience] ${businessId}: ${threats.length} threat(s), ${opportunities.length} opportunity(s)` +
        `${worstThreat ? ` — worst: ${worstThreat.summary}` : ''}` +
        `${bestOpportunity ? ` — best: ${bestOpportunity.summary}` : ''}`,
    );
    return all;
  }


  /**
   * The counted facts, or null.
   *
   * This is the half of salience that never escaped. `appraise()` builds up to
   * ten ranked concerns with sentences like "12 overdue invoices in 24h against
   * a normal of 3/day — escalating", and then eight of them are discarded and
   * the other two survive only as the `reason` riding on a hormone. The
   * endocrine block that carries them is explicitly labelled disposition, and
   * ends with "It must NOT change what you report as fact" — so there was no
   * path on which KEY could state the number at all. A user could only ever get
   * a vaguer, mood-shaped version of a fact the system already knew exactly.
   *
   * Synchronous, like every other standing-context source. Returns null rather
   * than a stale reading: a count from six hours ago asserted in the present
   * tense is worse than saying nothing.
   */
  describeForPrompt(businessId: string, now: Date = new Date()): string | null {
    const entry = this.current.get(businessId);
    if (!entry) return null;
    if (now.getTime() - entry.appraisedAt.getTime() > CONCERN_TTL_MS) return null;

    const threats = entry.concerns.filter((c) => c.valence === 'threat').slice(0, 3);
    const momentum = entry.concerns.filter((c) => c.valence === 'opportunity').slice(0, 1);
    const shown = [...threats, ...momentum];
    if (shown.length === 0) return null;

    return [
      "WHAT THIS BUSINESS'S OWN RECORDS SHOW — exact counts from its event log, not inference:",
      ...shown.map((c) => `- ${c.summary}`),
      `Counted ${Math.round((now.getTime() - entry.appraisedAt.getTime()) / 60000)} minutes ago.`,
      // Load-bearing. The endocrine block already in this prompt carries these
      // same sentences as "Basis:" under an instruction NOT to treat them as
      // reportable fact. Without this line the model receives two contradictory
      // directives about one set of numbers.
      'These are facts and may be stated plainly if they bear on what was asked.',
    ].join('\n');
  }


  /**
   * Distinct ENTITIES, not event rows — and a per-day baseline.
   *
   * Two mistakes live here, both of which produce a confidently wrong sentence
   * now that these numbers are stated to the owner as fact.
   *
   * FIRST: counting rows counts watcher emissions. The proactive watchers
   * re-publish one event for every still-matching entity on every sweep, and the
   * sweep runs every 15 minutes with no dedupe — so a business with 12 overdue
   * invoices accumulates ~1150 `proactive.invoice_overdue` rows in 24 hours, and
   * KEY would have said "1152 overdue invoices in 24h". The event bus sets
   * `subjectId` to the entity id, so counting DISTINCT subjectId counts invoices
   * rather than sightings of invoices. Opportunity signals arrive once per real
   * occurrence, so a row count would also have mixed one true number with one
   * inflated by ~96x in the same list.
   *
   * SECOND, and easy to miss while fixing the first: distinct-over-the-baseline-
   * window is not a rate. Twelve invoices overdue for a fortnight are 12 distinct
   * subjects across 13 days, which reads as a baseline of ~0.9/day against a
   * present count of 12 — so every steady state would look like a 13x escalation.
   * The baseline is therefore the AVERAGE of the per-day distinct counts, which
   * is the quantity "a normal day for this business" actually means.
   *
   * Raw SQL because neither is expressible in the Prisma query API: `count` has
   * no DISTINCT, and `groupBy` cannot truncate a timestamp to a day. Written for
   * PostgreSQL against the real column names — note that the existing raw-SQL in
   * this codebase (key-cortex-intuition.service.ts) is MySQL syntax against a
   * Postgres database and does not run.
   */
  private async countSignal(
    businessId: string,
    signal: string,
    recentSince: Date,
    baselineSince: Date,
  ): Promise<{ signal: string; recent: number; baselinePerDay: number }> {
    const recentRows = await this.prisma.client.$queryRaw<Array<{ c: bigint | number }>>`
      SELECT COUNT(DISTINCT subject_id) AS c
      FROM business_events
      WHERE business_id = ${businessId}
        AND event_type = ${signal}
        AND created_at >= ${recentSince}
    `;

    // The baseline window deliberately EXCLUDES the recent one: including it
    // would let today's spike inflate the normal it is measured against and
    // hide itself.
    const baselineRows = await this.prisma.client.$queryRaw<Array<{ avg: number | null }>>`
      SELECT AVG(c) AS avg FROM (
        SELECT date_trunc('day', created_at) AS d, COUNT(DISTINCT subject_id) AS c
        FROM business_events
        WHERE business_id = ${businessId}
          AND event_type = ${signal}
          AND created_at >= ${baselineSince}
          AND created_at < ${recentSince}
        GROUP BY 1
      ) per_day
    `;

    return {
      signal,
      recent: Number(recentRows?.[0]?.c ?? 0),
      baselinePerDay: Number(baselineRows?.[0]?.avg ?? 0),
    };
  }

  /** Rank threat signals. Never throws. */
  async rank(businessId: string): Promise<Concern[]> {
    return this.scoreSignals(businessId, THREAT_SIGNALS, 'threat');
  }

  /**
   * Rank opportunity signals — the same change-weighted maths, opposite sign.
   *
   * Deliberately the SAME scorer: momentum is noticed the way threat is, by
   * comparing against this business's own normal. A business that always takes
   * twenty bookings a day is not having a good week at twenty.
   */
  async rankOpportunities(businessId: string): Promise<Concern[]> {
    return this.scoreSignals(businessId, OPPORTUNITY_SIGNALS, 'opportunity');
  }

  private async scoreSignals(
    businessId: string,
    signalWeights: Record<string, number>,
    valence: 'threat' | 'opportunity',
  ): Promise<Concern[]> {
    const now = Date.now();
    const recentSince = new Date(now - RECENT_HOURS * 3600_000);
    const baselineSince = new Date(now - BASELINE_DAYS * 24 * 3600_000);

    // COUNTED, not sampled.
    //
    // This used to fetch rows with `take: SAMPLE_LIMIT` ordered newest-first,
    // then derive `older = all.length - recent`. For any business with more
    // events than the limit in the baseline window, the OLDER bucket is the one
    // that gets truncated — so baselineRate came out too low, every ratio too
    // high, and every signal read as escalating. A business that genuinely
    // averages 30 overdue invoices a day would be told its normal was 3.
    //
    // As a hormone nudge that was merely too jumpy. These summaries are now
    // stated to the user as fact, so an approximation is not good enough: a
    // wrong baseline is KEY asserting something false about the owner's own
    // books, in a confident voice. `count` is exact and unbounded, and two
    // counts per signal are cheaper than the rows they replace.
    let counts: Array<{ signal: string; recent: number; baselinePerDay: number }>;
    try {
      counts = await Promise.all(
        Object.keys(signalWeights).map((signal) => this.countSignal(businessId, signal, recentSince, baselineSince)),
      );
    } catch {
      return [];
    }

    const concerns: Concern[] = [];

    for (const [signal, weight] of Object.entries(signalWeights)) {
      const counted = counts.find((c) => c.signal === signal);
      if (!counted) continue;

      const recent = counted.recent;
      if (recent === 0) continue;
      const baselineRate = counted.baselinePerDay;


      // HABITUATION. Ratio against the business's own normal, not an absolute
      // count. A business that always carries thirty overdue invoices is not in
      // crisis at thirty; one that never has any is, at three.
      const ratio = baselineRate > 0 ? recent / baselineRate : recent > 0 ? 2 : 0;

      // SENSITISATION. Meaningfully above normal is what earns attention.
      const escalating = ratio >= 1.5;

      // Novelty: a signal with no history at all is inherently salient.
      const novelty = baselineRate === 0 ? 0.35 : 0;

      const salience = Math.min(
        weight * Math.min(ratio / 3, 1) + novelty + (escalating ? 0.15 : 0),
        1,
      );
      if (salience < SALIENCE_FLOOR) continue;

      concerns.push({
        signal,
        valence,
        salience,
        recentCount: recent,
        baselineRate: Math.round(baselineRate * 100) / 100,
        escalating,
        summary: this.describe(signal, recent, baselineRate, escalating, valence),
      });
    }

    return concerns.sort((a, b) => b.salience - a.salience).slice(0, MAX_CONCERNS);
  }

  /**
   * State the change, not the count.
   *
   * "12 overdue invoices" is a number the owner already knows. "12 overdue
   * invoices against a normal of 3" is the fact that warrants attention, and it
   * is also the evidence the endocrine system requires — release() refuses an
   * unexplained signal.
   */
  private describe(
    signal: string,
    recent: number,
    baseline: number,
    escalating: boolean,
    valence: 'threat' | 'opportunity',
  ): string {
    const label =
      {
        'proactive.invoice_overdue': 'overdue invoices',
        'proactive.negative_sentiment': 'negative-sentiment signals',
        'proactive.booking_no_show': 'booking no-shows',
        'invoice.paid': 'invoices paid',
        'payment.received': 'payments received',
        'booking.created': 'new bookings',
        'booking.completed': 'bookings delivered',
        'contact.created': 'new contacts',
      }[signal] ?? signal;

    if (baseline === 0) {
      return valence === 'threat'
        ? `${recent} ${label} in 24h, with none in the preceding fortnight — this is new`
        : `${recent} ${label} in 24h, with none in the preceding fortnight — this is new momentum`;
    }

    const normal = Math.round(baseline * 10) / 10;
    if (!escalating) return `${recent} ${label} in 24h (normal is ${normal}/day)`;

    // "Escalating" is the wrong word for a good week, and the phrasing is not
    // cosmetic — this string is the evidence stored on the hormone and the
    // sentence the owner eventually reads.
    return valence === 'threat'
      ? `${recent} ${label} in 24h against a normal of ${normal}/day — escalating`
      : `${recent} ${label} in 24h against a normal of ${normal}/day — well above trend`;
  }

  private async findAllActiveBusinesses(): Promise<string[]> {
    const businesses = await this.prisma.client.business
      .findMany({ where: { deletedAt: null }, select: { id: true } })
      .catch(() => []);

    return (businesses as Array<{ id: string }>).map((b) => b.id);
  }
}
