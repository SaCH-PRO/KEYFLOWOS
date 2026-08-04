/**
 * KEY Cortex — Incentive Signals
 *
 * Every hormone KEY has is addressed to KEY. Cortisol tightens its own risk
 * tolerance, dopamine widens its own exploration, humility increases its own
 * hedging, malaise adds its own caveats. All four modulate a prompt and a token
 * budget. None of them reaches a human, and the state is keyed per BUSINESS, so
 * there is no per-person axis at all.
 *
 * For a system meant to plug into "any role, tier and level of staff", that is a
 * conspicuous hole: KEY has a rich endocrine model of itself and no concept
 * whatsoever of the people doing the work. It cannot say who is carrying the
 * week, who has gone quiet, or who should be recognised — not because the data
 * is missing, but because nothing has ever read it that way.
 *
 * This service is the per-person axis. It measures contribution from the one
 * signal that is genuinely live and genuinely per-user, and makes it something
 * KEY can reason about.
 *
 * ─── Why TeamActivityLog and nothing else ────────────────────────────────────
 *
 * It is written by a global interceptor across roughly twenty routes plus the
 * oversight service, carries `userId`, and is indexed on
 * `[businessId, userId]` — so it is populated without anyone opting in, which is
 * exactly what makes it honest evidence rather than self-reported effort.
 *
 * ─── What is deliberately NOT here, and why ──────────────────────────────────
 *
 * No commission arithmetic, no accrual, no payout, no pay. That is the obvious
 * thing to want and it cannot be built correctly yet:
 *
 *  1. There is no earning to record. No model in the schema represents a
 *     commission earned, a period it belongs to, or whether it was paid. The
 *     rate exists — in a `Business.metaData` JSON blob — and is never multiplied
 *     by anything.
 *
 *  2. The identities do not join. `StaffMember` carries `hourlyRate` and the
 *     commission map key but has no `userId` and no `membershipId`, while
 *     `TeamActivityLog` and every permission check are keyed on the USER. There
 *     is no reliable way to say that this activity belongs to that pay rate.
 *
 *  3. Money owed to a person must be auditable, reversible and exact. Inferring
 *     it from an activity log would be none of those.
 *
 * So this measures contribution, which is real, and stops short of converting it
 * into money, which would be fiction. Wiring pay properly needs a StaffMember →
 * user join and an earnings model — both schema changes, and both belong with
 * the people/HR organ rather than smuggled in behind a cortex service.
 *
 * ─── Fairness constraints ────────────────────────────────────────────────────
 *
 * Contribution is a count of recorded actions. It is a measure of ACTIVITY, not
 * of value, and the prompt text says so. Ten thoughtful decisions can outweigh
 * two hundred logged clicks, and a system that quietly equated the two would
 * push a business toward rewarding noise. KEY is told the number and told what
 * it is not.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

/** Window over which contribution is measured. Two working weeks. */
const WINDOW_DAYS = 14;

/** Bound on rows read per business. Every cortex read is bounded. */
const SAMPLE_LIMIT = 2000;

/** Below this the team is too small or too quiet to compare anyone. */
const MIN_ACTIONS_FOR_COMPARISON = 20;

/** Share of team activity above which someone is carrying disproportionate load. */
const CARRYING_SHARE = 0.5;

/** Cached contribution is re-derived after this long. */
const CACHE_TTL_MS = 60 * 60 * 1000;

export interface Contributor {
  userId: string;
  actions: number;
  /** Fraction of all recorded team activity in the window, 0–1. */
  share: number;
  /** Distinct modules touched — breadth, as a counterweight to raw volume. */
  modules: number;
  lastActiveAt: Date;
}

export interface TeamContribution {
  contributors: Contributor[];
  totalActions: number;
  /** Someone doing more than half of everything recorded. */
  carrying: Contributor | null;
  /** Active earlier in the window, silent in its most recent third. */
  wentQuiet: Contributor[];
  computedAt: Date;
}

@Injectable()
export class KeyCortexIncentiveService {
  private readonly logger = new Logger(KeyCortexIncentiveService.name);

  /**
   * businessId → contribution. Working state, so `describeForPrompt` can be
   * synchronous — it is read from `CognitiveTriageService.standingContext` on
   * the request path for every message. Same pattern as endocrine, immune and
   * epigenetics.
   */
  private readonly contribution = new Map<string, TeamContribution>();
  private readonly inFlight = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Measure who did what, over the window ending at `now`.
   *
   * `now` is injectable because the window, the quiet-detection and the cache
   * all depend on it.
   */
  async measure(businessId: string, now: Date = new Date()): Promise<TeamContribution> {
    const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const rows = await this.prisma.client.teamActivityLog
      .findMany({
        where: { businessId, createdAt: { gte: since } },
        select: { userId: true, module: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: SAMPLE_LIMIT,
      })
      .catch((err: any) => {
        this.logger.warn(
          `[incentive] activity read failed for ${businessId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return [] as any[];
      });

    const result = this.summarise(rows, now);
    this.contribution.set(businessId, result);
    return result;
  }

  /** Pure, so the whole summary can be tested without a database. */
  summarise(
    rows: { userId: string; module?: string | null; createdAt: Date }[],
    now: Date,
  ): TeamContribution {
    const byUser = new Map<string, { actions: number; modules: Set<string>; last: Date }>();

    for (const row of rows) {
      if (!row?.userId) continue;
      const entry = byUser.get(row.userId) ?? { actions: 0, modules: new Set<string>(), last: new Date(0) };
      entry.actions += 1;
      if (row.module) entry.modules.add(row.module);
      const at = new Date(row.createdAt);
      if (at > entry.last) entry.last = at;
      byUser.set(row.userId, entry);
    }

    const totalActions = [...byUser.values()].reduce((sum, e) => sum + e.actions, 0);

    const contributors: Contributor[] = [...byUser.entries()]
      .map(([userId, e]) => ({
        userId,
        actions: e.actions,
        share: totalActions > 0 ? e.actions / totalActions : 0,
        modules: e.modules.size,
        lastActiveAt: e.last,
      }))
      .sort((a, b) => b.actions - a.actions);

    // Comparison needs enough volume AND more than one person. Calling someone
    // "carrying the team" when they are the only member recorded is not an
    // insight, and on a two-action sample it is not evidence either.
    const comparable = totalActions >= MIN_ACTIONS_FOR_COMPARISON && contributors.length > 1;

    const carrying =
      comparable && contributors[0].share > CARRYING_SHARE ? contributors[0] : null;

    // "Went quiet" means active earlier in the window and silent through its
    // most recent third — a real change in behaviour, not merely a low total.
    const quietCutoff = new Date(now.getTime() - (WINDOW_DAYS / 3) * 24 * 60 * 60 * 1000);
    const wentQuiet = comparable
      ? contributors.filter((c) => c.actions >= 3 && c.lastActiveAt < quietCutoff)
      : [];

    return { contributors, totalActions, carrying, wentQuiet, computedAt: now };
  }

  /**
   * The prompt section, or null when there is nothing worth saying.
   *
   * Synchronous; derivation is kicked off but not awaited. Failure direction is
   * toward saying nothing about the team, which is the right way to be wrong.
   */
  describeForPrompt(businessId: string, now: Date = new Date()): string | null {
    const cached = this.contribution.get(businessId);
    const stale = !cached || now.getTime() - cached.computedAt.getTime() > CACHE_TTL_MS;

    if (stale && !this.inFlight.has(businessId)) {
      this.inFlight.add(businessId);
      void this.measure(businessId, now)
        .catch(() => undefined)
        .finally(() => this.inFlight.delete(businessId));
    }

    return cached ? this.render(cached) : null;
  }

  /** Rendered separately so wording is testable without a database. */
  render(c: TeamContribution): string | null {
    const lines: string[] = [];

    if (c.carrying) {
      lines.push(
        `- ${c.carrying.userId} recorded ${Math.round(c.carrying.share * 100)}% of all team activity ` +
          `in the last ${WINDOW_DAYS} days (${c.carrying.actions} of ${c.totalActions} actions).`,
      );
    }

    for (const q of c.wentQuiet.slice(0, 3)) {
      lines.push(
        `- ${q.userId} was active earlier in the period and has recorded nothing since ` +
          `${q.lastActiveAt.toISOString().slice(0, 10)}.`,
      );
    }

    if (lines.length === 0) return null;

    return [
      `TEAM CONTRIBUTION — recorded activity over ${WINDOW_DAYS} days, per person:`,
      ...lines,
      'This counts recorded ACTIONS, which is a measure of activity and not of value or effort:',
      'ten considered decisions can be worth more than two hundred logged clicks, and someone',
      'may be quiet because they are on leave. Raise it as something to look at, never as a verdict',
      'on a person, and never suggest pay or standing on this basis alone.',
    ].join('\n');
  }
}
