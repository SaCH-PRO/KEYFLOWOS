/**
 * KEY Cortex — Immune Centre
 *
 * An immune system is three things, and a business only has one of them today:
 *
 *   DETECTION — recognise that something is wrong.       EXISTS, twice.
 *   RESPONSE  — contain it before it finishes.           MISSING.
 *   MEMORY    — recognise it faster the second time.     MISSING.
 *
 * Detection exists twice and neither half knows about the other.
 * `BusinessEventAnomalyService` watches the event stream for mass deletion, mass
 * update and delete→create→delete cycles, and fires
 * `business_event.anomaly_detected`. `KeyCortexSalienceService` — the amygdala —
 * scores business signals hourly and doses cortisol. They share no vocabulary:
 * salience reads `BusinessEvent` rows, and anomalies are never written there, so
 * the amygdala is structurally blind to the one component that detects abuse.
 *
 * What happened to a detected anomaly before this service existed: it was
 * emitted, and the only listener was an SSE broadcast that begins
 *
 *     const set = this.streams.get(businessId);
 *     if (!set || set.size === 0) return;
 *
 * With no dashboard open — which is most of the time, and certainly at 3am — the
 * detection was discarded. Nothing persisted it, nothing scored it, nothing
 * remembered it. The detector's own windows are in-process `Map`s, so a restart
 * is total amnesia and N replicas each need the full threshold independently.
 *
 * This service is the missing two thirds.
 *
 * ─── What it deliberately does NOT do ────────────────────────────────────────
 *
 * It does not suspend accounts, revoke sessions, block actors or roll anything
 * back. That is not timidity, it is the same rule every other cortex service
 * follows — salience states it plainly: "this has no hands: it scores, and it
 * modulates disposition. It never acts on the business."
 *
 * Three concrete reasons, in order:
 *
 *  1. There is nowhere to record it. Across all 430 Prisma models there is no
 *     suspension, ban or quarantine field. Containment that cannot be persisted
 *     cannot be audited or lifted.
 *
 *  2. The one containment primitive that exists is a lie. `SafetyShellService`
 *     .rollback() logs "Would execute compensating action" and returns
 *     `success: true` without reverting anything. Building on it would inherit
 *     a false success.
 *
 *  3. Autonomous suspension is a product decision with a blast radius — a false
 *     positive locks a paying customer out of their own business. The threshold
 *     is 20 deletions in an hour, which a legitimate bulk cleanup clears easily.
 *
 * So the response here is everything short of force: make it durable, make it
 * escalate on recurrence, dose the endocrine system so KEY's disposition
 * actually changes, and put it where a human will see it. Containment with
 * teeth needs a schema and an owner's decision; this is the layer that makes
 * either possible and is useful on its own in the meantime.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { KeyCortexEndocrineService } from './key-cortex-endocrine.service';

/** Discriminators for the KeyCortexMemory rows this service owns. */
const MEMORY_TYPE_INCIDENT = 'immune_incident';

/**
 * How long a strain stays "known" to the immune system.
 *
 * Adaptive immunity fades. Without a TTL the first bad week would make a
 * business permanently jumpy, which is drift rather than memory. Thirty days is
 * long enough to span a monthly billing cycle, so a pattern that recurs with the
 * business's own rhythm is still recognised on its second appearance.
 */
const STRAIN_MEMORY_DAYS = 30;

/** Matches the endocrine clamp. A single dose can never saturate. */
const MAX_SINGLE_PUSH = 0.35;

/**
 * Severity of a first encounter, by anomaly type, 0–1 before scaling.
 *
 * Mass deletion outranks mass update because deletion is the one that may not be
 * recoverable. The delete→create→delete cycle scores highest of all: it is the
 * only one of the three that is hard to explain innocently, since it looks like
 * someone testing whether removal is noticed.
 */
const BASE_SEVERITY: Record<string, number> = {
  mass_deletion: 0.7,
  entity_cycle: 0.85,
  mass_update: 0.45,
};

/** Anything unrecognised still counts — an unknown strain is not a safe one. */
const UNKNOWN_SEVERITY = 0.5;

export interface ImmuneIncident {
  anomalyType: string;
  actorId: string;
  /** How many times this exact strain has been seen inside the memory window. */
  encounters: number;
  firstSeen: string;
  lastSeen: string;
  /** Severity actually applied on the most recent encounter, 0–1. */
  severity: number;
  details: Record<string, unknown>;
}

@Injectable()
export class KeyCortexImmuneService {
  private readonly logger = new Logger(KeyCortexImmuneService.name);

  /**
   * businessId → strainKey → incident. Working state; the database is the
   * durable copy.
   *
   * This exists so `describeForPrompt` can be SYNCHRONOUS. It is read from
   * `CognitiveTriageService.standingContext`, which runs on the request path for
   * every message and is sync — making it async would ripple through triage and
   * both orchestrator call sites to put a database round trip in front of every
   * reply. The endocrine service solves the same problem the same way, and
   * consistency here is worth more than novelty.
   */
  private readonly incidents = new Map<string, Map<string, ImmuneIncident>>();

  /** Businesses whose incidents have been loaded from storage this process. */
  private readonly hydrated = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly endocrine?: KeyCortexEndocrineService,
  ) {}

  /**
   * The listener that was missing.
   *
   * Async and self-contained: EventEmitter2 does not await handlers, so an
   * unhandled rejection here would be an unhandled rejection in the process. All
   * failure is caught and logged.
   */
  @OnEvent('business_event.anomaly_detected')
  async onAnomalyDetected(payload: {
    businessId: string;
    actorId: string;
    anomalyType: string;
    details?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.record(
        payload.businessId,
        payload.actorId,
        payload.anomalyType,
        payload.details ?? {},
      );
    } catch (err) {
      this.logger.error(
        `[immune] failed to record ${payload?.anomalyType} for ${payload?.businessId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Detection → memory → response, in that order.
   *
   * Public and taking an explicit businessId so it is callable from a test and,
   * later, from a controller — the repo's standing complaint about the other
   * cortex services is that a @Cron or an @OnEvent is their only entry point,
   * making them unverifiable for a given tenant without waiting.
   *
   * `now` is injectable because every property worth testing here is
   * time-dependent.
   */
  async record(
    businessId: string,
    actorId: string,
    anomalyType: string,
    details: Record<string, unknown>,
    now: Date = new Date(),
  ): Promise<ImmuneIncident> {
    const prior = await this.recall(businessId, anomalyType, actorId, now);

    const encounters = (prior?.encounters ?? 0) + 1;
    const base = BASE_SEVERITY[anomalyType] ?? UNKNOWN_SEVERITY;

    // Adaptive immunity: a strain already met provokes a stronger response than
    // a novel one. Sub-linear on purpose — the point is a faster reaction, not
    // an ever-escalating one, and it is bounded by the clamp regardless.
    const severity = Math.min(1, base * (1 + Math.log2(encounters)));

    const incident: ImmuneIncident = {
      anomalyType,
      actorId,
      encounters,
      firstSeen: prior?.firstSeen ?? now.toISOString(),
      lastSeen: now.toISOString(),
      severity,
      details,
    };

    const forBusiness = this.incidents.get(businessId) ?? new Map<string, ImmuneIncident>();
    forBusiness.set(this.strainKey(anomalyType, actorId), incident);
    this.incidents.set(businessId, forBusiness);

    await this.persist(businessId, incident, now);

    // RESPONSE. Cortisol rather than a bespoke channel, so this reaches KEY's
    // disposition through the one route already proven to work:
    // endocrine → CognitiveTriageService.standingContext → system prompt.
    //
    // Magnitude is pre-scaled into the 0.35 clamp. Passing raw 0–1 severity
    // would flatten everything above 0.35 to the same dose and destroy the
    // ordering this service exists to express.
    this.endocrine?.release(
      businessId,
      [
        {
          hormone: 'cortisol',
          magnitude: severity * MAX_SINGLE_PUSH,
          reason:
            encounters > 1
              ? `${anomalyType} by the same actor, ${encounters} times in ${STRAIN_MEMORY_DAYS} days`
              : `${anomalyType} detected in the audit stream`,
        },
      ],
      now,
    );

    this.logger.warn(
      `[immune] ${anomalyType} by ${actorId} in ${businessId} — encounter ${encounters}, severity ${severity.toFixed(2)}`,
    );

    return incident;
  }

  /**
   * Load this business's remembered strains into working state.
   *
   * Bounded and tenant-scoped, like every other cortex read.
   */
  async hydrate(businessId: string): Promise<void> {
    if (this.hydrated.has(businessId)) return;
    this.hydrated.add(businessId);

    const rows = await this.prisma.client.keyCortexMemory
      .findMany({
        where: { businessId, type: MEMORY_TYPE_INCIDENT },
        orderBy: { lastAccessedAt: 'desc' },
        take: 50,
      })
      .catch(() => [] as any[]);

    const forBusiness = this.incidents.get(businessId) ?? new Map<string, ImmuneIncident>();
    for (const row of rows) {
      const parsed = this.parse((row as any).value);
      // Merge, never overwrite: a concurrent record() may already have written a
      // fresher encounter into working state while this read was in flight.
      if (parsed && !forBusiness.has(this.strainKey(parsed.anomalyType, parsed.actorId))) {
        forBusiness.set(this.strainKey(parsed.anomalyType, parsed.actorId), parsed);
      }
    }
    this.incidents.set(businessId, forBusiness);
  }

  /**
   * What this business's immune system currently remembers.
   *
   * Expired strains are filtered rather than deleted, so a row outliving its
   * window costs a comparison rather than a wrong answer.
   */
  async activeIncidents(businessId: string, now: Date = new Date()): Promise<ImmuneIncident[]> {
    await this.hydrate(businessId);
    return this.activeFromMemory(businessId, now);
  }

  /**
   * The prompt line, or null when the business is healthy.
   *
   * Synchronous, because triage's standingContext is — see the note on
   * `incidents`. Hydration is kicked off but not awaited, exactly as the
   * endocrine service does: the failure direction is toward saying nothing,
   * which is the safe way to be wrong about a security signal on the first
   * message after a restart.
   *
   * Deliberately states the count and the window rather than a verdict. KEY is
   * not entitled to tell a user someone is attacking them — a bulk import clears
   * the 20-deletion threshold easily. It IS entitled to say what was observed
   * and let the reasoning above it weigh that.
   */
  describeForPrompt(businessId: string, now: Date = new Date()): string | null {
    if (!this.hydrated.has(businessId)) void this.hydrate(businessId);

    const active = this.activeFromMemory(businessId, now);
    if (active.length === 0) return null;

    const lines = active
      .slice(0, 3)
      .map(
        (i) =>
          `- ${i.anomalyType.replace(/_/g, ' ')} by actor ${i.actorId}` +
          (i.encounters > 1 ? ` (${i.encounters} times)` : '') +
          ` — last seen ${new Date(i.lastSeen).toISOString().slice(0, 10)}`,
      );

    return [
      'UNUSUAL ACTIVITY IN THE AUDIT TRAIL — detected by your own watchers, not reported by anyone:',
      ...lines,
      'These are volume thresholds, not proof of intent: a legitimate bulk import trips them too.',
      'Mention this only if it bears on what was asked, and describe it as something to check rather than an accusation.',
    ].join('\n');
  }

  /** Unexpired strains from working state, strongest first. */
  private activeFromMemory(businessId: string, now: Date): ImmuneIncident[] {
    const cutoff = new Date(now.getTime() - STRAIN_MEMORY_DAYS * 24 * 60 * 60 * 1000);
    return [...(this.incidents.get(businessId)?.values() ?? [])]
      .filter((i) => new Date(i.lastSeen) >= cutoff)
      .sort((a, b) => b.severity - a.severity);
  }

  /** Prior encounter with this exact strain, if it is still in the window. */
  private async recall(
    businessId: string,
    anomalyType: string,
    actorId: string,
    now: Date,
  ): Promise<ImmuneIncident | null> {
    await this.hydrate(businessId);
    const parsed = this.incidents.get(businessId)?.get(this.strainKey(anomalyType, actorId)) ?? null;
    if (!parsed) return null;

    const cutoff = new Date(now.getTime() - STRAIN_MEMORY_DAYS * 24 * 60 * 60 * 1000);
    // Outside the window it is not a recurrence, it is a new first encounter.
    return new Date(parsed.lastSeen) >= cutoff ? parsed : null;
  }

  private async persist(businessId: string, incident: ImmuneIncident, now: Date): Promise<void> {
    const key = this.strainKey(incident.anomalyType, incident.actorId);
    const value = JSON.stringify(incident);

    // findFirst-then-update, not upsert: KeyCortexMemory has no unique
    // constraint on (businessId, type, key), so upsert has nothing to match on.
    // Keyed by strain rather than by occurrence so recurrence REFRESHES one row
    // instead of accumulating thousands — the encounter count is the memory.
    const existing = await this.prisma.client.keyCortexMemory
      .findFirst({ where: { businessId, type: MEMORY_TYPE_INCIDENT, key } })
      .catch(() => null);

    if (existing) {
      await this.prisma.client.keyCortexMemory.update({
        where: { id: (existing as any).id },
        data: { value, confidence: incident.severity, lastAccessedAt: now },
      });
      return;
    }

    await this.prisma.client.keyCortexMemory.create({
      data: {
        businessId,
        // No userId. An incident belongs to the business, not to whoever happens
        // to be in the chat — scoping it to a person would hide it from everyone
        // else, which for a security signal is the wrong failure direction.
        type: MEMORY_TYPE_INCIDENT,
        key,
        value,
        source: 'immune_response',
        confidence: incident.severity,
        lastAccessedAt: now,
      },
    });
  }

  private strainKey(anomalyType: string, actorId: string): string {
    return `${anomalyType}:${actorId}`;
  }

  /** Never trusts the column: a hand-edited or half-written row must not throw. */
  private parse(value: unknown): ImmuneIncident | null {
    if (typeof value !== 'string') return null;
    try {
      const raw = JSON.parse(value);
      if (!raw || typeof raw !== 'object') return null;
      const { anomalyType, actorId, encounters, firstSeen, lastSeen, severity } = raw as any;
      if (typeof anomalyType !== 'string' || typeof actorId !== 'string') return null;
      if (!Number.isFinite(encounters) || encounters < 1) return null;
      if (!Number.isFinite(severity)) return null;
      if (Number.isNaN(new Date(lastSeen).getTime())) return null;
      return {
        anomalyType,
        actorId,
        encounters,
        firstSeen: typeof firstSeen === 'string' ? firstSeen : lastSeen,
        lastSeen,
        severity: Math.min(Math.max(severity, 0), 1),
        details: (raw as any).details && typeof (raw as any).details === 'object' ? (raw as any).details : {},
      };
    } catch {
      return null;
    }
  }
}
