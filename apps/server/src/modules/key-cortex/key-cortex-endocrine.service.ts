/**
 * KEY Cortex — Endocrine System (slow, diffuse modulation)
 *
 * The nervous system and the endocrine system solve different problems, and the
 * distinction is the whole reason this file exists separately from
 * interoception.
 *
 *   Neural  — fast, targeted, transient. "This invoice is overdue." It informs
 *             one answer and is gone.
 *   Hormonal— slow, diffuse, persistent. "Cash has been tightening for three
 *             weeks." It should not change one answer; it should change the
 *             disposition behind every answer, and keep doing so after the
 *             conversation that revealed it has ended.
 *
 * Without this layer, KEY re-derives its posture from scratch on every query and
 * is therefore incapable of sustained caution. A business in genuine trouble
 * gets a cheerfully optimistic answer whenever the current question happens not
 * to mention the trouble.
 *
 * Design constraints, in order of importance:
 *
 *  1. Hormones BIAS, they never DECIDE. A hormone adjusts how carefully KEY
 *     reasons and how it frames a recommendation. It must never fabricate a
 *     fact, suppress one, or veto an action. Ethics and evidence remain the
 *     authorities on what is true and what is permitted.
 *
 *  2. Every hormone is traceable to evidence. A level exists because specific
 *     observations raised it, and each carries the reason. An untraceable mood
 *     is superstition, and this system is required to be evidence-based.
 *
 *  3. They decay. A hormone that never falls is a permanent personality change
 *     caused by one bad week. Decay is what makes this homeostasis rather than
 *     drift.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * The modulators KEY runs on.
 *
 * Deliberately few. Each must earn its place by changing behaviour in a way the
 * others cannot, otherwise it is a synonym that dilutes the signal.
 */
export type HormoneName =
  /** Sustained threat to the business — tightens risk tolerance. */
  | 'cortisol'
  /** Sustained opportunity or momentum — widens exploration. */
  | 'dopamine'
  /** Repeated failure of KEY's own predictions — increases hedging. */
  | 'humility'
  /** Sustained degradation of KEY's own body (organs) — forces caveats. */
  | 'malaise';

export interface HormoneLevel {
  name: HormoneName;
  /** 0–1. Baseline is 0; a hormone at 0 has no effect. */
  level: number;
  /** Why it is where it is. Never empty when level > 0. */
  reasons: string[];
  updatedAt: Date;
}

/** A single observation that moves a hormone. */
export interface EndocrineSignal {
  hormone: HormoneName;
  /** How strongly this observation pushes, 0–1. */
  magnitude: number;
  /** Evidence for the push. Required — an unexplained nudge is not admissible. */
  reason: string;
}

/**
 * Fraction of current level retained per hour with no reinforcing signal.
 *
 * ~0.92/hour puts the half-life near 8 hours: a genuine problem sustains the
 * hormone across a working day, while a single bad reading fades overnight.
 */
const HOURLY_RETENTION = 0.92;

/** Below this a hormone is treated as absent, so trace amounts stop showing up. */
const NOISE_FLOOR = 0.05;

/** A single observation can never saturate the system on its own. */
const MAX_SINGLE_PUSH = 0.35;

/** KeyCortexMemory discriminators for persisted hormone state. */
const MEMORY_TYPE_HORMONES = 'endocrine_state';
const MEMORY_KEY_HORMONES = 'hormones';

@Injectable()
export class KeyCortexEndocrineService {
  private readonly logger = new Logger(KeyCortexEndocrineService.name);

  /** businessId → hormone → level. Working state; durability is below. */
  private readonly levels = new Map<string, Map<HormoneName, HormoneLevel>>();

  /** Businesses whose state has been loaded from storage this process. */
  private readonly hydrated = new Set<string>();

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  /**
   * Register observations. Levels rise toward 1 but never reach it from any
   * finite number of pushes, so the system cannot be pinned at maximum.
   *
   * `now` is injectable for the same reason it is on read(): every meaningful
   * property of this service is time-dependent, and a service whose decay
   * behaviour cannot be tested is one whose decay behaviour is unverified.
   */
  release(businessId: string, signals: EndocrineSignal[], now: Date = new Date()): void {
    if (signals.length === 0) return;
    const forBusiness = this.levels.get(businessId) ?? new Map<HormoneName, HormoneLevel>();

    for (const signal of signals) {
      if (!signal.reason?.trim()) {
        // Enforced rather than assumed: a hormone whose reasons are empty is
        // indistinguishable from a mood, and cannot be defended to a user.
        this.logger.warn(
          `[endocrine] refused unexplained ${signal.hormone} signal for ${businessId}`,
        );
        continue;
      }

      const push = Math.min(Math.max(signal.magnitude, 0), MAX_SINGLE_PUSH);
      const current = forBusiness.get(signal.hormone);
      // Decay the stored anchor forward to now before adding. Storing the result
      // with updatedAt = now is what makes this the ONLY place the anchor moves.
      const base = current ? this.levelAt(current, now) : 0;

      // Approach 1 asymptotically: the closer to saturated, the less each new
      // observation adds. Prevents a burst of correlated signals from pinning it.
      const next = base + push * (1 - base);

      forBusiness.set(signal.hormone, {
        name: signal.hormone,
        level: next,
        reasons: [...new Set([signal.reason, ...(current?.reasons ?? [])])].slice(0, 5),
        updatedAt: now,
      });
    }

    this.levels.set(businessId, forBusiness);

    // Durability is fire-and-forget on purpose. release() is synchronous
    // because the thalamus calls it on the request path, and a hormone that
    // could not be written must never fail the message that observed it.
    void this.persist(businessId);
  }

  /**
   * Durability.
   *
   * These levels are the only thing in KEY that carries a disposition across
   * time, and they lived in a process-local Map — so KEY's accumulated caution
   * died on every restart and differed between instances. A business that had
   * been in trouble for three weeks got a fresh, cheerful KEY after a deploy,
   * which is the exact failure this service was written to prevent.
   *
   * Stored in KeyCortexMemory rather than a new table: it is the established
   * migration-free store in this module, and hormone state is small, per
   * business, and already shaped like a memory record.
   *
   * Decay makes this safe across a gap in time. Levels are anchored to
   * `updatedAt`, and `levelAt` decays from that anchor — so state written before
   * a week of downtime is read back correctly aged, not resurrected at full
   * strength.
   */
  private async persist(businessId: string): Promise<void> {
    if (!this.prisma) return;

    try {
      const stored = this.levels.get(businessId);
      const value = JSON.stringify([...(stored?.values() ?? [])]);

      const existing = await this.prisma.client.keyCortexMemory.findFirst({
        where: { businessId, type: MEMORY_TYPE_HORMONES, key: MEMORY_KEY_HORMONES },
        select: { id: true },
      });

      if (existing) {
        await this.prisma.client.keyCortexMemory.update({
          where: { id: existing.id },
          data: { value, lastAccessedAt: new Date() },
        });
      } else {
        await this.prisma.client.keyCortexMemory.create({
          data: {
            businessId,
            type: MEMORY_TYPE_HORMONES,
            key: MEMORY_KEY_HORMONES,
            value,
            source: 'endocrine',
          },
        });
      }
    } catch (err: unknown) {
      // Never propagate: losing durability must not lose the observation.
      this.logger.warn(
        `[endocrine] could not persist ${businessId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Load stored levels for a business.
   *
   * Async, while `read` and `effortMultiplier` are synchronous because the
   * thalamus calls them on the request path. So this warms in the background
   * exactly as interoception's peekBody does: the first message after a restart
   * sees an unmodulated KEY, every later one sees the real disposition. The
   * failure direction is toward neutral — cheaper and calmer — never toward
   * runaway caution.
   *
   * In-memory state always wins. A hydrate that clobbered a live level would
   * undo an observation made while the read was in flight.
   */
  async hydrate(businessId: string): Promise<void> {
    if (!this.prisma || this.hydrated.has(businessId)) return;
    this.hydrated.add(businessId);

    try {
      const row = await this.prisma.client.keyCortexMemory.findFirst({
        where: { businessId, type: MEMORY_TYPE_HORMONES, key: MEMORY_KEY_HORMONES },
        select: { value: true },
      });
      if (!row?.value) return;

      const parsed = JSON.parse(row.value) as Array<
        Omit<HormoneLevel, 'updatedAt'> & { updatedAt: string }
      >;

      const forBusiness = this.levels.get(businessId) ?? new Map<HormoneName, HormoneLevel>();
      for (const h of parsed) {
        if (forBusiness.has(h.name)) continue;
        forBusiness.set(h.name, { ...h, updatedAt: new Date(h.updatedAt) });
      }
      this.levels.set(businessId, forBusiness);
    } catch (err: unknown) {
      this.logger.warn(
        `[endocrine] could not hydrate ${businessId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Current levels, decayed to now. Only hormones above the noise floor. */
  read(businessId: string, now: Date = new Date()): HormoneLevel[] {
    // Warm from storage for next time. Cannot be awaited — see hydrate().
    if (!this.hydrated.has(businessId)) void this.hydrate(businessId);

    const stored = this.levels.get(businessId);
    if (!stored) return [];

    const live: HormoneLevel[] = [];
    for (const [name, hormone] of stored) {
      const level = this.levelAt(hormone, now);
      if (level < NOISE_FLOOR) {
        // Safe to drop: it can only be resurrected by a new signal, which would
        // write a fresh anchor anyway.
        stored.delete(name);
        continue;
      }
      live.push({ ...hormone, level });
    }

    if (stored.size === 0) this.levels.delete(businessId);
    return live.sort((a, b) => b.level - a.level);
  }

  /**
   * Translate hormone levels into prompt framing.
   *
   * Returns null when nothing is elevated — an unmodulated KEY should read
   * exactly as it does today, with no residue from this system.
   *
   * The framing states the evidence alongside the disposition on purpose. A
   * model told only "be cautious" becomes vaguely hedgy about everything; a
   * model told why becomes specifically careful about the right thing.
   */
  describeForPrompt(businessId: string, now: Date = new Date()): string | null {
    const active = this.read(businessId, now);
    if (active.length === 0) return null;

    const lines = active.map((h) => {
      const strength = h.level >= 0.6 ? 'strong' : h.level >= 0.3 ? 'moderate' : 'mild';
      return `- ${DISPOSITIONS[h.name](strength)} Basis: ${h.reasons.join('; ')}.`;
    });

    return (
      `STANDING CONTEXT — conditions observed over time, not from this message:\n` +
      `${lines.join('\n')}\n` +
      `Let this shape how carefully you reason and how you frame recommendations. ` +
      `It must NOT change what you report as fact: do not soften, omit, or ` +
      `overstate evidence to match the disposition above.`
    );
  }

  /**
   * Reasoning-effort multiplier, 1.0–1.5.
   *
   * Elevated cortisol, humility or malaise all mean the same operationally:
   * think harder before answering. Dopamine deliberately does NOT reduce it —
   * optimism is not a reason to think less.
   */
  effortMultiplier(businessId: string, now: Date = new Date()): number {
    const caution = this.read(businessId, now)
      .filter((h) => h.name !== 'dopamine')
      .reduce((max, h) => Math.max(max, h.level), 0);
    return 1 + Math.min(caution, 1) * 0.5;
  }

  /** Clear all hormones for a business. */
  reset(businessId: string): void {
    this.levels.delete(businessId);
  }

  /**
   * A hormone's level at a given moment, decayed from its stored anchor.
   *
   * PURE — it must not write back. The stored pair (level, updatedAt) is an
   * anchor: the level as of the last reinforcing observation. Only release()
   * moves it.
   *
   * Writing the decayed value back while leaving updatedAt at the anchor
   * compounds decay on every read, so a frequently-polled business loses its
   * hormones far faster than a quiet one — the amount of decay would depend on
   * how often someone looked. Advancing updatedAt instead has the opposite
   * failure: the clock restarts on every read and the hormone never decays at
   * all. Keeping this pure avoids both.
   *
   * Decay is computed on read rather than on a timer because a timer would have
   * to fire per business and would keep dead tenants resident in memory.
   */
  private levelAt(hormone: HormoneLevel, now: Date): number {
    const hours = (now.getTime() - hormone.updatedAt.getTime()) / 3_600_000;
    if (hours <= 0) return hormone.level;
    return hormone.level * Math.pow(HOURLY_RETENTION, hours);
  }
}

/**
 * What each hormone actually changes about KEY's behaviour.
 *
 * Written as instructions to a reasoning system, not as feelings. "You are
 * anxious" is not actionable and invites performance; "prefer reversible
 * options" is.
 */
const DISPOSITIONS: Record<HormoneName, (strength: string) => string> = {
  cortisol: (s) =>
    `Sustained risk to the business (${s}). Prefer reversible, low-commitment ` +
    `options; state downside explicitly; require firmer evidence before ` +
    `recommending anything that consumes cash or capacity.`,
  dopamine: (s) =>
    `Sustained momentum (${s}). Surface opportunities to compound it and ` +
    `consider more ambitious options than usual — without lowering the ` +
    `evidence bar that applies to any recommendation.`,
  humility: (s) =>
    `Recent predictions have underperformed (${s}). Widen stated uncertainty, ` +
    `offer alternatives rather than a single confident answer, and be explicit ` +
    `about what would change your mind.`,
  malaise: (s) =>
    `Parts of the system are impaired (${s}). Say plainly which data may be ` +
    `incomplete and avoid conclusions that depend on the affected subsystems.`,
};
