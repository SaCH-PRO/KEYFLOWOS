import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../core/prisma/prisma.service';
import { KeyCortexEndocrineService, type EndocrineSignal } from './key-cortex-endocrine.service';
import { KeyCortexInteroceptionService } from './key-cortex-interoception.service';

/**
 * Homeostasis — the control loop KEY did not have.
 *
 * Everything else in this cortex is a reflex chain: stimulus, afferent,
 * integration, efferent, effector. That makes KEY reactive. What makes a
 * nervous system a CONTROL system is the last element — a variable with a
 * setpoint, a measured deviation from it, and a corrective response that
 * opposes the disturbance.
 *
 * Before this service, nothing in the server measured KEY's own condition over
 * time. Grepping for `drift`, `homeostasis` or `equilibrium` returned no
 * implementation at all. KEY could not notice that it was getting worse: not
 * that its tools had started failing, not that it had slowed down, not that its
 * own body was degrading. It had interoception (a snapshot) and no baseline to
 * compare that snapshot against.
 *
 * WHAT THIS IS, IN THE ATLAS'S TERMS
 *
 *   receptor            the bounded queries in measure*(), reading real
 *                       execution history rather than opinions
 *   integrating centre  compare(), which compares each reading to its setpoint
 *   efferent pathway    NEUROENDOCRINE — deviation is converted into hormone
 *                       release rather than into a direct action
 *   effector            the endocrine system, which raises effortMultiplier and
 *                       adds caveats to KEY's framing
 *   feedback            NEGATIVE. Deviation raises caution, caution raises
 *                       deliberation, better deliberation reduces deviation, and
 *                       hormones decay once the condition stops recurring.
 *
 * Deliberately neuroendocrine rather than direct: a control system that reacted
 * to a bad half hour by changing behaviour immediately would oscillate. Hormones
 * integrate the signal over time — they need repetition to accumulate
 * (MAX_SINGLE_PUSH caps one observation) and they decay on their own. That is
 * damping, and it is why the response goes through the slow pathway.
 *
 * This service never acts on the business. It only changes how carefully KEY
 * thinks about it.
 */

/** Direction in which a reading is bad news. */
type WorseWhen = 'below' | 'above';

export interface HomeostaticVariable {
  name: string;
  /** The value KEY should hold this at. */
  setpoint: number;
  worseWhen: WorseWhen;
  /** Deviation smaller than this is noise, not a signal. */
  tolerance: number;
  /** Which hormone a sustained deviation releases. */
  hormone: EndocrineSignal['hormone'];
  /** Human-readable units, for the reason string. */
  describe: (value: number) => string;
}

export interface HomeostaticReading {
  variable: string;
  /** null when the variable could not be measured — silence, not zero. */
  value: number | null;
  setpoint: number;
  /** 0 when inside tolerance; otherwise how far outside, normalised 0–1. */
  deviation: number;
  reason: string;
}

/**
 * The variables KEY holds within range.
 *
 * Each maps to something the atlas would recognise as a regulated physiological
 * variable: how well the effectors are working, how fast the system responds,
 * and whether the organs are intact.
 */
const VARIABLES: HomeostaticVariable[] = [
  {
    name: 'executionIntegrity',
    // KEY's actions succeeding. The equivalent of asking whether the muscles
    // still respond to the motor command.
    setpoint: 0.95,
    worseWhen: 'below',
    tolerance: 0.05,
    // humility, not cortisol: KEY's OWN actions are failing, which means its
    // predictions about what would work were wrong. That warrants hedging
    // rather than treating the business as under threat.
    hormone: 'humility',
    describe: (v) => `${Math.round(v * 100)}% of recent actions succeeded`,
  },
  {
    name: 'responseLatency',
    // Normalised against the ceiling below, so deviation stays comparable
    // across variables.
    setpoint: 0,
    worseWhen: 'above',
    tolerance: 0.25,
    hormone: 'malaise',
    describe: (v) => `responses running ${Math.round(v * 100)}% of the latency ceiling`,
  },
  {
    name: 'bodyIntegrity',
    setpoint: 1,
    worseWhen: 'below',
    tolerance: 0.1,
    hormone: 'malaise',
    describe: (v) => `${Math.round(v * 100)}% of organs healthy`,
  },
];

/** Latency at which KEY considers itself impaired rather than merely slow. */
const LATENCY_CEILING_MS = 15_000;

/** How far back a reading looks. Long enough to damp noise, short enough to notice. */
const WINDOW_HOURS = 6;

/**
 * Below this many executions the success rate is not a measurement, it is an
 * anecdote. One failure out of two is not a 50% integrity crisis.
 */
const MIN_SAMPLE = 8;

/** Bound on the rows any single measurement reads. */
const SAMPLE_LIMIT = 500;

@Injectable()
export class KeyCortexHomeostasisService {
  private readonly logger = new Logger(KeyCortexHomeostasisService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() private readonly endocrine?: KeyCortexEndocrineService,
    @Optional() private readonly interoception?: KeyCortexInteroceptionService,
  ) {}

  /**
   * The autonomic loop. Homeostasis is continuous and unattended — it is not
   * something a user asks for, which is precisely why it belongs on a schedule
   * rather than on the request path.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async scheduledHomeostasis(): Promise<void> {
    const businesses = await this.findAllActiveBusinesses();
    for (const businessId of businesses) {
      try {
        await this.regulate(businessId);
      } catch (err: unknown) {
        // One business's readings must never stop the loop for the rest.
        this.logger.warn(
          `[homeostasis] ${businessId} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Measure, compare, and convert deviation into hormone release.
   *
   * Returns the readings so this is observable and testable rather than a
   * silent background effect.
   */
  async regulate(businessId: string): Promise<HomeostaticReading[]> {
    const readings = await this.assess(businessId);

    const signals: EndocrineSignal[] = readings
      .filter((r) => r.deviation > 0)
      .map((r) => ({
        hormone: VARIABLES.find((v) => v.name === r.variable)!.hormone,
        magnitude: r.deviation,
        reason: r.reason,
      }));

    if (signals.length > 0 && this.endocrine) {
      this.endocrine.release(businessId, signals);
      this.logger.log(
        `[homeostasis] ${businessId} out of range: ${signals.map((s) => s.reason).join('; ')}`,
      );
    }

    return readings;
  }

  /** Measure every variable and compare each to its setpoint. Never throws. */
  async assess(businessId: string): Promise<HomeostaticReading[]> {
    const [integrity, latency, body] = await Promise.all([
      this.measureExecutionIntegrity(businessId),
      this.measureResponseLatency(businessId),
      this.measureBodyIntegrity(businessId),
    ]);

    const values: Record<string, number | null> = {
      executionIntegrity: integrity,
      responseLatency: latency,
      bodyIntegrity: body,
    };

    return VARIABLES.map((v) => this.compare(v, values[v.name]));
  }

  /**
   * The integrating centre. Deviation is normalised 0–1 so that variables in
   * different units contribute comparably to the endocrine response.
   */
  private compare(variable: HomeostaticVariable, value: number | null): HomeostaticReading {
    if (value === null) {
      // Unmeasurable is NOT the same as bad. Reporting an unmeasured variable
      // as a deviation would have KEY dosing itself with caution because a
      // table was empty.
      return {
        variable: variable.name,
        value: null,
        setpoint: variable.setpoint,
        deviation: 0,
        reason: `${variable.name} not measurable in this window`,
      };
    }

    const raw =
      variable.worseWhen === 'below' ? variable.setpoint - value : value - variable.setpoint;
    const beyond = raw - variable.tolerance;
    const deviation = beyond > 0 ? Math.min(beyond, 1) : 0;

    return {
      variable: variable.name,
      value,
      setpoint: variable.setpoint,
      deviation,
      reason: `${variable.name}: ${variable.describe(value)} (setpoint ${variable.setpoint})`,
    };
  }

  /** Receptor: how often KEY's own actions succeed. */
  private async measureExecutionIntegrity(businessId: string): Promise<number | null> {
    try {
      const rows = await this.prisma.client.aiExecutionLog.findMany({
        where: { businessId, createdAt: { gte: this.windowStart() } },
        select: { success: true },
        take: SAMPLE_LIMIT,
        orderBy: { createdAt: 'desc' },
      });

      if (rows.length < MIN_SAMPLE) return null;
      const ok = rows.filter((r: { success: boolean }) => r.success).length;
      return ok / rows.length;
    } catch {
      return null;
    }
  }

  /** Receptor: how long KEY is taking, as a fraction of the impairment ceiling. */
  private async measureResponseLatency(businessId: string): Promise<number | null> {
    try {
      const rows = await this.prisma.client.aiExecutionLog.findMany({
        where: {
          businessId,
          createdAt: { gte: this.windowStart() },
          durationMs: { not: null },
        },
        select: { durationMs: true },
        take: SAMPLE_LIMIT,
        orderBy: { createdAt: 'desc' },
      });

      if (rows.length < MIN_SAMPLE) return null;
      const total = rows.reduce(
        (sum: number, r: { durationMs: number | null }) => sum + (r.durationMs ?? 0),
        0,
      );
      return total / rows.length / LATENCY_CEILING_MS;
    } catch {
      return null;
    }
  }

  /**
   * Receptor: organ health.
   *
   * SENSES rather than peeks, and that distinction was a real defect.
   *
   * peekBody is cache-only. This loop runs on a 30-minute cron in a process
   * that has usually served no chat traffic for that business, so the cache was
   * always cold — bodyIntegrity was structurally null on every sweep. It never
   * contributed a reading, while still paying for the background organ fan-out
   * peekBody fires on a miss and then discards.
   *
   * senseBody is the right call here precisely because this is not the request
   * path: a 3-second-per-organ poll is unacceptable in front of a user and
   * completely acceptable in a background loop that runs twice an hour. It also
   * warms the cache that the request path then reads for free.
   */
  private async measureBodyIntegrity(businessId: string): Promise<number | null> {
    try {
      const body = await this.interoception?.senseBody(businessId);
      return body && body.totalCount > 0 ? body.integrity : null;
    } catch {
      return null;
    }
  }

  private windowStart(): Date {
    return new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);
  }

  private async findAllActiveBusinesses(): Promise<string[]> {
    const businesses = await this.prisma.client.business
      .findMany({ where: { deletedAt: null }, select: { id: true } })
      .catch(() => []);

    return (businesses as Array<{ id: string }>).map((b) => b.id);
  }
}
