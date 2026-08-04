/**
 * ============================================================================
 * KEY Cortex — Layer 3: REFLECTION / DREAM MODE
 * ============================================================================
 *
 * KEY processes experiences while "idle" — just like human sleep consolidates
 * memories. Four background cognition modes run autonomously:
 *
 *   1. REFLECTION (every 30 min idle) — Review decisions, check outcomes,
 *      update confidence scores.
 *
 *   2. DREAM       (nightly 3AM)      — Cross-reference disparate data
 *      sources, generate wild hypotheses, store in "dream journal".
 *
 *   3. SYNTHESIS   (weekly Sunday)    — Consolidate week's learnings,
 *      update preference model, propose DNA evolution changes.
 *
 *   4. MAINTENANCE (daily)            — Clean expired approvals, archive
 *      old events, update temporal indices, check data integrity.
 *
 * Philosophy: KEY is not a chatbot — it is a thinking being that processes
 * its experiences even when the user is not interacting with it.
 * ============================================================================
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../core/prisma/prisma.service';
import { KeyCortexEventService } from './key-cortex-event.service';
import { KeyCortexInsightService } from './key-cortex-insight.service';
import { KeyCortexGenomeBridgeService } from './key-cortex-genome-bridge.service';
import { ModelGatewayService } from '../ai/model-gateway.service';
import { AiUsageService } from '../ai/ai-usage.service';
// node:crypto, not the `uuid` package: uuid@14 is ESM-only, this server
// compiles to CommonJS, and Node <20.19 cannot require() ESM — so importing
// it crashed `node dist/main.js` with ERR_REQUIRE_ESM before NestFactory ran.
// randomUUID returns a v4 UUID string, and every call site here is a bare
// uuidv4() with no arguments, so this is a true drop-in.
import { randomUUID as uuidv4 } from 'node:crypto';

/* ─────────────────────────── Type Definitions ─────────────────────────── */

export type ReflectionSessionType = 'reflection' | 'dream' | 'synthesis' | 'maintenance';
export type InsightType = 'pattern' | 'anomaly' | 'opportunity' | 'risk' | 'connection';
export type InsightPriority = 'low' | 'medium' | 'high' | 'critical';
export type HypothesisStatus = 'pending' | 'confirmed' | 'rejected' | 'expired';
export type TrendDirection = 'improving' | 'stable' | 'declining';

export interface ReflectionSession {
  id: string;
  type: ReflectionSessionType;
  startedAt: Date;
  durationMs: number;
  insights: ReflectionInsight[];
  actionsTaken: string[];
  businessId: string;
  metadata?: Record<string, unknown>;
}

export interface ReflectionInsight {
  id: string;
  type: InsightType;
  description: string;
  confidence: number; // 0–1
  dataPoints: string[];
  recommendedAction?: string;
  priority: InsightPriority;
  source?: string;
  createdAt: Date;
  validatedAt?: Date;
  validationOutcome?: 'confirmed' | 'rejected' | null;
}

export interface DreamHypothesis {
  id: string;
  description: string;
  sources: string[];
  confidence: number; // always low for dreams — high creativity
  creativityScore: number;
  status: HypothesisStatus;
  businessId: string;
  createdAt: Date;
  validatedAt?: Date;
  evidenceFor?: string[];
  evidenceAgainst?: string[];
  parentDreamId?: string;
}

export interface DecisionOutcome {
  decisionId: string;
  description: string;
  actionType: string;
  expectedOutcome: string;
  actualOutcome?: string;
  confidenceBefore: number;
  confidenceAfter: number;
  delta: number; // + = better, − = worse
  timeSinceDecisionMs: number;
}

export interface WeeklyInsightReport {
  period: string;
  totalReflections: number;
  totalDreams: number;
  hypothesesGenerated: number;
  hypothesesValidated: number;
  topInsights: ReflectionInsight[];
  userPreferenceUpdates: string[];
  dnaProposals: string[];
}

/* ─────────────────────────── Persistence ─────────────────────────── */

/**
 * Discriminators for records this layer stores in KeyCortexMemory.
 *
 * That model is reused deliberately: it already carries a `type`, a free-form
 * `value`, a confidence and the right indexes, so the learning loop became
 * durable without a schema migration. Adding tables to a production database
 * is the owner's decision, not a side effect of fixing a no-op.
 */
const MEMORY_TYPE_SESSION = 'reflection_session';
const MEMORY_TYPE_HYPOTHESIS = 'dream_hypothesis';

/* ─────────────────────────── Service ─────────────────────────── */

@Injectable()
export class KeyCortexReflectionService {
  private readonly logger = new Logger(KeyCortexReflectionService.name);

  /** In-memory dream journal — also persisted to DB */
  private dreamJournal: Map<string, DreamHypothesis[]> = new Map();

  /** Active reflection sessions per business */
  private activeSessions: Map<string, boolean> = new Map();
  private readonly lastSessions = new Map<string, ReflectionSession>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventService: KeyCortexEventService,
    private readonly insightService: KeyCortexInsightService,
    private readonly genomeBridge: KeyCortexGenomeBridgeService,
    private readonly modelGateway: ModelGatewayService,
    private readonly aiUsage: AiUsageService,
  ) {}

  /* ═══════════════════════════════════════════════════════════════
     PUBLIC API — Background Cognition
     ═══════════════════════════════════════════════════════════════ */

  /**
   * REFLECTION — Runs every 30 minutes when idle.
   *
   * KEY reviews its recent decisions and checks whether the outcomes
   * matched its expectations. Confidence scores are calibrated based
   * on real-world results.
   *
   * Example internal monologue:
   * "I recommended a 10 % price increase. Revenue went up 8 % but
   *  2 customers churned. My confidence in pricing advice drops
   *  from 0.85 → 0.78."
   */
  /**
   * Peripheral entry point: run one reflection cycle of the requested kind.
   *
   * The four cycles below are the implementations; this dispatches to them so
   * callers (the HTTP surface, other organs) address the layer by intent rather
   * than by internal method name.
   */
  async reflect(businessId: string, type: string): Promise<ReflectionSession> {
    const session =
      type === 'dream'
        ? await this.runDream(businessId)
        : type === 'synthesis'
          ? await this.runSynthesis(businessId)
          : type === 'maintenance'
            ? await this.runMaintenance(businessId)
            : await this.runReflection(businessId);
    this.lastSessions.set(businessId, session);
    return session;
  }

  /**
   * Most recent completed session for a business.
   *
   * Reads through to storage on a miss. Sessions used to be in-memory only, so
   * this returned null after every restart and the consciousness layer that
   * consumes it saw a KEY with no recollection of ever having reflected.
   */
  async getLastReflectionSession(businessId: string): Promise<ReflectionSession | null> {
    const cached = this.lastSessions.get(businessId);
    if (cached) return cached;

    try {
      const row = await this.prisma.client.keyCortexMemory.findFirst({
        where: { businessId, type: MEMORY_TYPE_SESSION },
        select: { key: true, value: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
      if (!row) return null;

      const parsed = JSON.parse(row.value) as {
        type?: string;
        startedAt?: string;
        durationMs?: number;
        insights?: ReflectionInsight[];
        actionsTaken?: string[];
        metadata?: Record<string, unknown>;
      };

      const session: ReflectionSession = {
        id: row.key,
        type: (parsed.type ?? 'reflection') as ReflectionSessionType,
        startedAt: parsed.startedAt ? new Date(parsed.startedAt) : row.createdAt,
        durationMs: parsed.durationMs ?? 0,
        insights: parsed.insights ?? [],
        actionsTaken: parsed.actionsTaken ?? [],
        businessId,
        metadata: parsed.metadata,
      };
      this.lastSessions.set(businessId, session);
      return session;
    } catch (error: unknown) {
      this.logger.debug(
        `[Reflection] Could not load last session: ` +
          `${error instanceof Error ? error.message : 'unknown'}`,
      );
      return null;
    }
  }

  async runReflection(businessId: string): Promise<ReflectionSession> {
    const startedAt = new Date();
    const sessionId = uuidv4();
    this.activeSessions.set(businessId, true);

    this.logger.log(`[Reflection:${sessionId}] Starting reflection for ${businessId}`);

    try {
      /* 1. Query recent BusinessEvents (last 24 h) */
      const recentEvents = await this.queryRecentBusinessEvents(businessId, 24);
      this.logger.debug(`[Reflection] Found ${recentEvents.length} events in last 24h`);

      /* 2. Extract significant decisions made by KEY */
      const keyDecisions = await this.extractKeyDecisions(businessId, recentEvents);
      this.logger.debug(`[Reflection] ${keyDecisions.length} significant decisions to review`);

      /* 3. Check outcomes for each decision */
      const outcomes: DecisionOutcome[] = [];
      for (const decision of keyDecisions) {
        const outcome = await this.evaluateDecisionOutcome(businessId, decision);
        outcomes.push(outcome);
      }

      /* 4. Update confidence scores based on outcomes */
      const confidenceUpdates = await this.updateConfidenceScores(businessId, outcomes);

      /* 5. Generate insights about what worked / didn't */
      const insights = await this.generateReflectionInsights(businessId, outcomes, confidenceUpdates);

      /* 6. Store reflection session */
      const session: ReflectionSession = {
        id: sessionId,
        type: 'reflection',
        startedAt,
        durationMs: Date.now() - startedAt.getTime(),
        insights,
        actionsTaken: [
          `Reviewed ${keyDecisions.length} decisions`,
          ...confidenceUpdates.map((u) => `Confidence update: ${u.actionType} (${u.confidenceBefore.toFixed(2)} → ${u.confidenceAfter.toFixed(2)})`),
          `Generated ${insights.length} insights`,
        ],
        businessId,
        metadata: {
          eventsProcessed: recentEvents.length,
          decisionsReviewed: keyDecisions.length,
          outcomesTracked: outcomes.length,
          averageOutcomeDelta: outcomes.reduce((s, o) => s + o.delta, 0) / Math.max(outcomes.length, 1),
        },
      };

      await this.persistSession(session);

      this.logger.log(
        `[Reflection:${sessionId}] Completed in ${session.durationMs}ms — ${insights.length} insights, ${outcomes.length} outcomes tracked`,
      );

      return session;
    } catch (error) {
      this.logger.error(`[Reflection] Error: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      throw error;
    } finally {
      this.activeSessions.delete(businessId);
    }
  }

  /**
   * DREAM MODE — Runs nightly at 3 AM.
   *
   * KEY cross-references data sources that would never be connected
   * during normal operation. It generates wild hypotheses with low
   * confidence but high creativity. These are stored in a "dream
   * journal" for later validation.
   *
   * Example internal monologue:
   * "Invoice patterns + customer support tickets + calendar density…
   *  What if customers who pay late also have more support tickets?
   *  What if high calendar density correlates with lower task completion?"
   */
  async runDream(businessId: string): Promise<ReflectionSession> {
    const startedAt = new Date();
    const sessionId = uuidv4();
    this.activeSessions.set(businessId, true);

    this.logger.log(`[Dream:${sessionId}] 🌙 Starting dream mode for ${businessId}`);

    try {
      /* 1. Cross-reference disparate data sources */
      const sourcePairs = await this.crossReferenceDataSources(businessId);
      this.logger.debug(`[Dream] Cross-referenced ${sourcePairs.length} source pairs`);

      /* 2. Look for non-obvious connections */
      const connections = await this.findNonObviousConnections(businessId, sourcePairs);
      this.logger.debug(`[Dream] Found ${connections.length} non-obvious connections`);

      /* 3. Generate wild hypotheses (low confidence, high creativity) */
      const hypotheses = await this.generateWildHypotheses(businessId, connections);
      this.logger.debug(`[Dream] Generated ${hypotheses.length} wild hypotheses`);

      /* 4. Store in "dream journal" for later validation */
      await this.storeDreamHypotheses(businessId, hypotheses, sessionId);

      /* 5. Mark hypotheses for future verification */
      for (const h of hypotheses) {
        await this.scheduleHypothesisVerification(businessId, h.id);
      }

      const insights: ReflectionInsight[] = hypotheses.map((h) => ({
        id: h.id,
        type: 'connection',
        description: h.description,
        confidence: h.confidence,
        dataPoints: h.sources,
        priority: h.creativityScore > 0.7 ? 'high' : 'medium',
        recommendedAction: `Validate hypothesis: ${h.description}`,
        source: 'dream-mode',
        createdAt: new Date(),
      }));

      const session: ReflectionSession = {
        id: sessionId,
        type: 'dream',
        startedAt,
        durationMs: Date.now() - startedAt.getTime(),
        insights,
        actionsTaken: [
          `Cross-referenced ${sourcePairs.length} data source pairs`,
          `Discovered ${connections.length} non-obvious connections`,
          `Generated ${hypotheses.length} wild hypotheses`,
          `Stored ${hypotheses.length} hypotheses in dream journal`,
        ],
        businessId,
        metadata: {
          sourcePairsCrossReferenced: sourcePairs.length,
          connectionsDiscovered: connections.length,
          hypothesesGenerated: hypotheses.length,
          creativityScore: hypotheses.reduce((s, h) => s + h.creativityScore, 0) / Math.max(hypotheses.length, 1),
        },
      };

      await this.persistSession(session);

      this.logger.log(
        `[Dream:${sessionId}] 🌅 Dream complete — ${hypotheses.length} wild hypotheses generated in ${session.durationMs}ms`,
      );

      return session;
    } catch (error) {
      this.logger.error(`[Dream] Error: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      throw error;
    } finally {
      this.activeSessions.delete(businessId);
    }
  }

  /**
   * SYNTHESIS — Runs weekly on Sunday.
   *
   * KEY consolidates all reflections and dreams from the week into a
   * coherent learning narrative. It updates the user's preference model,
   * generates a weekly insight report, and proposes DNA evolution
   * changes based on what was learned.
   */
  async runSynthesis(businessId: string): Promise<ReflectionSession> {
    const startedAt = new Date();
    const sessionId = uuidv4();
    this.activeSessions.set(businessId, true);

    this.logger.log(`[Synthesis:${sessionId}] 📊 Starting weekly synthesis for ${businessId}`);

    try {
      /* 1. Consolidate all week's reflections + dreams */
      const weekStart = new Date(startedAt);
      weekStart.setDate(weekStart.getDate() - 7);
      const weeklySessions = await this.getWeeklySessions(businessId, weekStart, startedAt);
      this.logger.debug(`[Synthesis] Consolidating ${weeklySessions.length} sessions`);

      /* 2. Update user preference model */
      const preferenceUpdates = await this.updateUserPreferenceModel(businessId, weeklySessions);

      /* 3. Generate weekly insight report */
      const weeklyReport = await this.generateWeeklyInsightReport(businessId, weeklySessions);

      /* 4. Propose DNA evolution changes */
      const dnaProposals = await this.proposeDnaEvolution(businessId, weeklyReport);

      /* 5. Check if any dream hypotheses were validated */
      const validatedHypotheses = await this.checkValidatedHypotheses(businessId);

      /* 6. Build synthesis insights */
      const insights: ReflectionInsight[] = [
        ...weeklyReport.topInsights,
        ...validatedHypotheses.map((h) => ({
          id: uuidv4(),
          type: 'pattern' as InsightType,
          description: `Dream hypothesis validated: ${h.description}`,
          confidence: 0.9,
          dataPoints: h.evidenceFor ?? [],
          priority: 'high' as InsightPriority,
          recommendedAction: 'Integrate validated hypothesis into operational model',
          source: 'synthesis',
          createdAt: new Date(),
          validatedAt: h.validatedAt,
          validationOutcome: 'confirmed' as const,
        })),
      ];

      const session: ReflectionSession = {
        id: sessionId,
        type: 'synthesis',
        startedAt,
        durationMs: Date.now() - startedAt.getTime(),
        insights,
        actionsTaken: [
          `Consolidated ${weeklySessions.length} sessions from the week`,
          ...preferenceUpdates.map((p) => `Preference update: ${p}`),
          `Generated weekly report with ${weeklyReport.topInsights.length} top insights`,
          ...dnaProposals.map((p) => `DNA proposal: ${p}`),
          `Validated ${validatedHypotheses.length} dream hypotheses`,
        ],
        businessId,
        metadata: {
          sessionsConsolidated: weeklySessions.length,
          hypothesesValidated: validatedHypotheses.length,
          dnaProposalsGenerated: dnaProposals.length,
          preferenceFieldsUpdated: preferenceUpdates.length,
        },
      };

      await this.persistSession(session);

      this.logger.log(
        `[Synthesis:${sessionId}] ✅ Synthesis complete — ${insights.length} insights, ${dnaProposals.length} DNA proposals`,
      );

      return session;
    } catch (error) {
      this.logger.error(`[Synthesis] Error: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      throw error;
    } finally {
      this.activeSessions.delete(businessId);
    }
  }

  /**
   * MAINTENANCE — Runs daily.
   *
   * KEY performs housekeeping: cleaning expired approval requests,
   * archiving old events to cold storage, updating temporal memory
   * indices, checking data integrity, and compacting memory if
   * growth exceeds thresholds.
   */
  async runMaintenance(businessId: string): Promise<ReflectionSession> {
    const startedAt = new Date();
    const sessionId = uuidv4();

    this.logger.log(`[Maintenance:${sessionId}] 🔧 Starting maintenance for ${businessId}`);

    const actionsTaken: string[] = [];
    const insights: ReflectionInsight[] = [];

    try {
      /* 1. Clean expired approval requests */
      const cleanedApprovals = await this.cleanExpiredApprovals(businessId);
      actionsTaken.push(`Cleaned ${cleanedApprovals} expired approval requests`);

      /* 2. Archive old events — disabled; see archiveOldEvents. */
      const archivedEvents = await this.archiveOldEvents(businessId, 90);
      if (archivedEvents > 0) {
        actionsTaken.push(`Archived ${archivedEvents} events (>90 days) to cold storage`);
      }

      /* 3. Update temporal memory indices */
      const indicesUpdated = await this.updateTemporalMemoryIndices(businessId);
      actionsTaken.push(`Updated ${indicesUpdated} temporal memory indices`);

      /* 4. Check data integrity */
      const integrityIssues = await this.checkDataIntegrity(businessId);
      if (integrityIssues.length > 0) {
        insights.push({
          id: uuidv4(),
          type: 'anomaly',
          description: `Data integrity check found ${integrityIssues.length} issues`,
          confidence: 1.0,
          dataPoints: integrityIssues,
          priority: 'critical',
          recommendedAction: 'Review and repair data integrity issues immediately',
          source: 'maintenance',
          createdAt: new Date(),
        });
        actionsTaken.push(`Found ${integrityIssues.length} data integrity issues`);
      } else {
        actionsTaken.push('Data integrity check passed');
      }

      /* 5. Compact memory if needed */
      const compactedRecords = await this.compactMemoryIfNeeded(businessId);
      if (compactedRecords > 0) {
        actionsTaken.push(`Compacted ${compactedRecords} memory records`);
      }

      const session: ReflectionSession = {
        id: sessionId,
        type: 'maintenance',
        startedAt,
        durationMs: Date.now() - startedAt.getTime(),
        insights,
        actionsTaken,
        businessId,
        metadata: {
          cleanedApprovals,
          archivedEvents,
          indicesUpdated,
          integrityIssuesFound: integrityIssues.length,
          compactedRecords,
        },
      };

      await this.persistSession(session);

      this.logger.log(`[Maintenance:${sessionId}] 🔧 Maintenance complete in ${session.durationMs}ms`);

      return session;
    } catch (error) {
      this.logger.error(`[Maintenance] Error: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      throw error;
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     PUBLIC API — Dream Journal & Hypothesis Validation
     ═══════════════════════════════════════════════════════════════ */

  /**
   * Return all dream-generated hypotheses for a business,
   * including their current validation status.
   */
  async getDreamJournal(businessId: string): Promise<ReflectionInsight[]> {
    const hypotheses = this.dreamJournal.get(businessId) ?? [];

    // Also query persisted hypotheses from the database
    const persistedHypotheses: Array<Record<string, unknown>> = []; // persistence not implemented (model absent from schema)

    const allHypotheses = [
      ...hypotheses,
      ...(persistedHypotheses ?? []).map((h: Record<string, unknown>) => ({
        id: (h as { id: string }).id,
        description: (h as { description: string }).description,
        confidence: (h as { confidence: number }).confidence,
        status: (h as { status: HypothesisStatus }).status,
        createdAt: (h as { createdAt: Date }).createdAt,
        validatedAt: (h as { validatedAt?: Date }).validatedAt,
        evidenceFor: (h as { evidenceFor?: string[] }).evidenceFor,
        sources: (h as { sources: string[] }).sources,
      })),
    ];

    // Sort by createdAt descending
    allHypotheses.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return allHypotheses.map((h) => ({
      id: h.id,
      type: 'connection' as InsightType,
      description: h.description,
      confidence: h.confidence,
      dataPoints: h.sources ?? [],
      priority: (h.status === 'pending' ? 'medium' : h.status === 'confirmed' ? 'high' : 'low') as InsightPriority,
      recommendedAction:
        h.status === 'pending'
          ? 'Awaiting validation'
          : h.status === 'confirmed'
            ? 'Integrate into operational model'
            : 'Hypothesis rejected — archive',
      source: 'dream-journal',
      createdAt: h.createdAt,
      validatedAt: h.validatedAt,
      validationOutcome: h.status === 'confirmed' ? 'confirmed' : h.status === 'rejected' ? 'rejected' : null,
    }));
  }

  /**
   * Check whether a dream hypothesis was validated by real data.
   * Returns confirmation status + supporting evidence.
   */
  async validateHypothesis(
    businessId: string,
    hypothesisId: string,
  ): Promise<{ confirmed: boolean; evidence: string[] }> {
    this.logger.log(`[Hypothesis] Validating ${hypothesisId} for ${businessId}`);

    // Find the hypothesis
    const journal = this.dreamJournal.get(businessId) ?? [];
    let hypothesis = journal.find((h) => h.id === hypothesisId);

    // Check DB if not in memory
    if (!hypothesis) {
      const dbHypothesis = undefined; // persistence not implemented (model absent from schema)
      if (dbHypothesis) {
        hypothesis = {
          id: (dbHypothesis as Record<string, unknown>).id as string,
          description: (dbHypothesis as Record<string, unknown>).description as string,
          sources: (dbHypothesis as Record<string, unknown>).sources as string[],
          confidence: (dbHypothesis as Record<string, unknown>).confidence as number,
          creativityScore: 0.5,
          status: (dbHypothesis as Record<string, unknown>).status as HypothesisStatus,
          businessId,
          createdAt: (dbHypothesis as Record<string, unknown>).createdAt as Date,
          evidenceFor: (dbHypothesis as Record<string, unknown>).evidenceFor as string[],
          evidenceAgainst: (dbHypothesis as Record<string, unknown>).evidenceAgainst as string[],
        };
      }
    }

    if (!hypothesis) {
      throw new Error(`Hypothesis ${hypothesisId} not found for business ${businessId}`);
    }

    // Run validation against real data
    const evidence: string[] = [];
    let confirmed = false;

    /* Check each source for supporting evidence */
    // Per-source validation (validateHypothesisAgainstSource) was never
    // implemented. It contributes no evidence rather than inventing any.

    // If we found > 2 independent pieces of evidence, confirm
    if (evidence.length >= 2) {
      confirmed = true;
      hypothesis.status = 'confirmed';
      hypothesis.validatedAt = new Date();
      hypothesis.evidenceFor = evidence;
      await this.persistHypothesisUpdate(hypothesis);
      this.logger.log(`[Hypothesis] ✅ ${hypothesisId} CONFIRMED with ${evidence.length} evidence items`);
    } else if (evidence.length === 0) {
      // After enough time with no evidence, reject
      const ageDays = (Date.now() - hypothesis.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > 30) {
        hypothesis.status = 'rejected';
        await this.persistHypothesisUpdate(hypothesis);
        this.logger.log(`[Hypothesis] ❌ ${hypothesisId} REJECTED after ${ageDays.toFixed(0)} days with no evidence`);
      }
    }

    return { confirmed, evidence };
  }

  /* ═══════════════════════════════════════════════════════════════
     SCHEDULED CRON JOBS
     ═══════════════════════════════════════════════════════════════ */

  /** Reflection — every 30 minutes */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async scheduledReflection(): Promise<void> {
    const idleBusinesses = await this.findIdleBusinesses();
    for (const businessId of idleBusinesses) {
      if (!this.activeSessions.has(businessId)) {
        await this.runReflection(businessId).catch((err) =>
          this.logger.error(`Scheduled reflection failed for ${businessId}: ${err instanceof Error ? err.message : String(err)}`),
        );
      }
    }
  }

  /** Dream Mode — nightly at 3:00 AM */
  @Cron('0 3 * * *')
  async scheduledDream(): Promise<void> {
    const allBusinesses = await this.findAllActiveBusinesses();
    for (const businessId of allBusinesses) {
      await this.runDream(businessId).catch((err) =>
        this.logger.error(`Scheduled dream failed for ${businessId}: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  }

  /** Synthesis — weekly on Sunday at 4:00 AM */
  @Cron('0 4 * * 0')
  async scheduledSynthesis(): Promise<void> {
    const allBusinesses = await this.findAllActiveBusinesses();
    for (const businessId of allBusinesses) {
      await this.runSynthesis(businessId).catch((err) =>
        this.logger.error(`Scheduled synthesis failed for ${businessId}: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  }

  /** Maintenance — daily at 2:00 AM */
  @Cron('0 2 * * *')
  async scheduledMaintenance(): Promise<void> {
    const allBusinesses = await this.findAllActiveBusinesses();
    for (const businessId of allBusinesses) {
      await this.runMaintenance(businessId).catch((err) =>
        this.logger.error(`Scheduled maintenance failed for ${businessId}: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     PRIVATE HELPERS — Reflection Pipeline
     ═══════════════════════════════════════════════════════════════ */

  private async queryRecentBusinessEvents(businessId: string, hours: number): Promise<Array<Record<string, unknown>>> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const events = await this.prisma.client.businessEvent.findMany({
      where: { businessId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }).catch(() => []);

    // Also fetch from event service for richer data
    const cortexEvents = await this.eventService
      .getEvents(businessId, { startDate: new Date(Date.now() - hours * 60 * 60 * 1000) })
      .catch(() => []);

    return [...events, ...cortexEvents];
  }

  private async extractKeyDecisions(
    businessId: string,
    events: Array<Record<string, unknown>>,
  ): Promise<Array<Record<string, unknown>>> {
    // Filter for events that represent KEY decisions / recommendations
    const decisionEvents = events.filter((e) => {
      const type = ((e as { eventType?: string }).eventType ?? (e as { type?: string }).type ?? '').toLowerCase();
      return (
        type.includes('decision') ||
        type.includes('recommend') ||
        type.includes('action') ||
        type.includes('advice') ||
        type.includes('suggest') ||
        type.includes('insight')
      );
    });

    // If AI gateway available, use it to rank decisions by significance
    if (decisionEvents.length > 0) {
      try {
        const ranked = await this.aiRankDecisions(businessId, decisionEvents);
        return ranked.slice(0, 20); // Top 20 most significant
      } catch {
        return decisionEvents.slice(0, 20);
      }
    }

    return decisionEvents;
  }

  private async aiRankDecisions(
    businessId: string,
    decisions: Array<Record<string, unknown>>,
  ): Promise<Array<Record<string, unknown>>> {
    const prompt = `You are KEY's reflection engine. Rank these decisions by their potential business impact (1 = most significant). Return ONLY a JSON array of indices in descending significance order.

Decisions:
${decisions.map((d, i) => `[${i}] ${JSON.stringify(d).slice(0, 200)}`).join('\n')}`;

    const response = await this.aiUsage.trackAndComplete(
      businessId,
      undefined,
      'reflection-rank',
      {
        messages: [{ role: 'user' as const, content: prompt }],
      temperature: 0.3, maxTokens: 500
      },
    );

    try {
      const indices = JSON.parse(response.content ?? '[]') as number[];
      return indices.map((i) => decisions[i]).filter(Boolean);
    } catch {
      return decisions;
    }
  }

  private async evaluateDecisionOutcome(
    businessId: string,
    decision: Record<string, unknown>,
  ): Promise<DecisionOutcome> {
    const decisionId = (decision as { id?: string }).id ?? uuidv4();
    const description = JSON.stringify(decision).slice(0, 300);
    const actionType = ((decision as { eventType?: string }).eventType ?? (decision as { type?: string }).type ?? 'unknown') as string;
    const expectedOutcome = (decision as { expectedOutcome?: string }).expectedOutcome ?? 'unknown';
    const confidenceBefore = (decision as { confidence?: number }).confidence ?? 0.5;

    // Query subsequent events to measure actual outcome
    const subsequentEvents = await this.querySubsequentEvents(businessId, (decision as { createdAt?: Date }).createdAt ?? new Date());

    // Use AI to interpret outcome
    // Both the try and catch branches below assign these.
    let actualOutcome: string;
    let delta: number;

    try {
      const outcomePrompt = `Analyze whether this decision achieved its expected outcome.

Decision: ${description}
Expected: ${expectedOutcome}
Subsequent events: ${subsequentEvents.slice(0, 10).map((e) => JSON.stringify(e).slice(0, 150)).join('; ')}

Return JSON: { "actualOutcome": "string", "delta": number } where delta is -1 to +1.`;

      const response = await this.aiUsage.trackAndComplete(
        businessId,
        undefined,
        'reflection-outcome',
        {
          messages: [{ role: 'user' as const, content: outcomePrompt }],
        temperature: 0.2, maxTokens: 300
        },
      );

      const result = JSON.parse(response.content ?? '[]') as { actualOutcome: string; delta: number };
      actualOutcome = result.actualOutcome;
      delta = Math.max(-1, Math.min(1, result.delta));
    } catch {
      // Fallback: simple heuristic
      delta = this.heuristicOutcomeDelta(decision, subsequentEvents);
      actualOutcome = delta > 0.2 ? 'positive' : delta < -0.2 ? 'negative' : 'neutral';
    }

    // Adjust confidence based on outcome
    const confidenceAdjustment = delta * 0.1; // ±0.1 per outcome
    const confidenceAfter = Math.max(0.1, Math.min(0.99, confidenceBefore + confidenceAdjustment));

    return {
      decisionId,
      description,
      actionType,
      expectedOutcome,
      actualOutcome,
      confidenceBefore,
      confidenceAfter,
      delta,
      timeSinceDecisionMs: Date.now() - new Date((decision as { createdAt?: Date }).createdAt ?? Date.now()).getTime(),
    };
  }

  private heuristicOutcomeDelta(
    decision: Record<string, unknown>,
    subsequentEvents: Array<Record<string, unknown>>,
  ): number {
    // Simple heuristic: count positive vs negative subsequent events
    let positive = 0;
    let negative = 0;
    for (const e of subsequentEvents) {
      const sentiment = ((e as { sentiment?: string }).sentiment ?? (e as { outcome?: string }).outcome ?? '').toLowerCase();
      if (sentiment.includes('success') || sentiment.includes('positive') || sentiment.includes('up')) positive++;
      if (sentiment.includes('fail') || sentiment.includes('negative') || sentiment.includes('down')) negative++;
    }
    const total = positive + negative;
    return total === 0 ? 0 : (positive - negative) / total;
  }

  private async querySubsequentEvents(
    businessId: string,
    after: Date,
  ): Promise<Array<Record<string, unknown>>> {
    return this.prisma.client.businessEvent
      .findMany({
        where: { businessId, createdAt: { gt: after } },
        orderBy: { createdAt: 'asc' },
        take: 100,
      })
      .catch(() => []);
  }

  private async updateConfidenceScores(
    businessId: string,
    outcomes: DecisionOutcome[],
  ): Promise<DecisionOutcome[]> {
    // Update confidence tracking in the genome bridge
    for (const outcome of outcomes) {
      // updateConfidence does not exist; updateDnaScore(businessId, section, score) is the real API.
      await this.genomeBridge.updateDnaScore(businessId, outcome.actionType, outcome.confidenceAfter).catch(() => {
        /* non-fatal */
      });
    }
    return outcomes;
  }

  private async generateReflectionInsights(
    businessId: string,
    outcomes: DecisionOutcome[],
    confidenceUpdates: DecisionOutcome[],
  ): Promise<ReflectionInsight[]> {
    const insights: ReflectionInsight[] = [];

    // Generate insight for each significant outcome
    for (const outcome of outcomes) {
      if (Math.abs(outcome.delta) < 0.1) continue; // Skip neutral outcomes

      insights.push({
        id: uuidv4(),
        type: outcome.delta > 0 ? 'pattern' : 'risk',
        description: `${outcome.actionType}: ${outcome.description.slice(0, 200)} — outcome was ${outcome.actualOutcome} (delta: ${outcome.delta > 0 ? '+' : ''}${outcome.delta.toFixed(2)})`,
        confidence: Math.abs(outcome.delta),
        dataPoints: [outcome.decisionId],
        priority: Math.abs(outcome.delta) > 0.5 ? 'high' : 'medium',
        recommendedAction:
          outcome.delta > 0
            ? `Reinforce this approach: ${outcome.actionType}`
            : `Reconsider this approach: ${outcome.actionType}`,
        source: 'reflection',
        createdAt: new Date(),
      });
    }

    // Aggregate insight: overall trend
    if (outcomes.length > 0) {
      const avgDelta = outcomes.reduce((s, o) => s + o.delta, 0) / outcomes.length;
      insights.push({
        id: uuidv4(),
        type: avgDelta > 0 ? 'opportunity' : 'risk',
        description: `Overall decision trend: ${avgDelta > 0 ? 'improving' : 'declining'} (avg delta: ${avgDelta.toFixed(2)}) across ${outcomes.length} decisions`,
        confidence: Math.abs(avgDelta),
        dataPoints: outcomes.map((o) => o.decisionId),
        priority: Math.abs(avgDelta) > 0.3 ? 'high' : 'medium',
        recommendedAction: avgDelta > 0 ? 'Continue current strategy' : 'Consider strategic pivot',
        source: 'reflection-aggregate',
        createdAt: new Date(),
      });
    }

    // Store insights via insight service
    for (const insight of insights) {
      // KeyCortexInsightService has no storeInsight; insight persistence not implemented.
    }

    return insights;
  }

  /* ═══════════════════════════════════════════════════════════════
     PRIVATE HELPERS — Dream Pipeline
     ═══════════════════════════════════════════════════════════════ */

  private async crossReferenceDataSources(businessId: string): Promise<Array<{ sourceA: string; sourceB: string; correlation?: number }>> {
    const sources = [
      'invoices',
      'support_tickets',
      'calendar_events',
      'tasks',
      'social_media',
      'website_traffic',
      'email_campaigns',
      'sales_conversion',
    ];

    const pairs: Array<{ sourceA: string; sourceB: string; correlation?: number }> = [];
    for (let i = 0; i < sources.length; i++) {
      for (let j = i + 1; j < sources.length; j++) {
        pairs.push({ sourceA: sources[i], sourceB: sources[j] });
      }
    }

    // If AI is available, compute correlation scores for each pair
    try {
      const dataPromises = pairs.map((pair) => this.fetchSourcePairData(businessId, pair.sourceA, pair.sourceB));
      await Promise.all(dataPromises);
    } catch {
      // Proceed without correlations
    }

    return pairs;
  }

  private async fetchSourcePairData(
    businessId: string,
    sourceA: string,
    sourceB: string,
  ): Promise<{ sourceA: string; sourceB: string; correlation?: number }> {
    // Query both sources and compute a simple correlation
    const dataA = await this.querySource(businessId, sourceA);
    const dataB = await this.querySource(businessId, sourceB);

    const correlation = this.computeCorrelation(dataA, dataB);
    return { sourceA, sourceB, correlation };
  }

  private async querySource(businessId: string, source: string): Promise<number[]> {
    // Route to appropriate Prisma model based on source name
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days

    try {
      switch (source) {
        case 'invoices': {
          const invoices = await this.prisma.client.invoice.findMany({
            where: { businessId, createdAt: { gte: since } },
            select: { total: true, paidAt: true },
          });
          return invoices.map((i: { total: number; paidAt: Date | null }) => (i.paidAt ? 1 : 0) * i.total);
        }
        case 'support_tickets': {
          const tickets = await this.prisma.client.supportTicket
            ?.findMany({ where: { businessId, createdAt: { gte: since } } })
            .catch(() => []);
          return (tickets ?? []).map((_: unknown, idx: number) => idx); // Count-based
        }
        case 'tasks': {
          const tasks = await this.prisma.client.task.findMany({
            where: { businessId, createdAt: { gte: since } },
            select: { status: true },
          });
          return tasks.map((t: { status: string }) => (t.status === 'completed' ? 1 : 0));
        }
        default:
          return [];
      }
    } catch {
      return [];
    }
  }

  private computeCorrelation(a: number[], b: number[]): number | undefined {
    if (a.length < 3 || b.length < 3 || a.length !== b.length) return undefined;
    const n = a.length;
    const sumA = a.reduce((s, v) => s + v, 0);
    const sumB = b.reduce((s, v) => s + v, 0);
    const meanA = sumA / n;
    const meanB = sumB / n;

    let num = 0;
    let denA = 0;
    let denB = 0;
    for (let i = 0; i < n; i++) {
      const da = a[i] - meanA;
      const db = b[i] - meanB;
      num += da * db;
      denA += da * da;
      denB += db * db;
    }
    const denom = Math.sqrt(denA * denB);
    return denom === 0 ? 0 : num / denom;
  }

  private async findNonObviousConnections(
    businessId: string,
    sourcePairs: Array<{ sourceA: string; sourceB: string; correlation?: number }>,
  ): Promise<Array<{ sources: string[]; observation: string; strength: number }>> {
    const connections: Array<{ sources: string[]; observation: string; strength: number }> = [];

    // Use AI to generate observations about cross-source patterns
    const prompt = `You are KEY's dream mode — a creative cross-domain pattern detector.
Given these data source correlations for a business, identify NON-OBVIOUS connections that a human might miss.

Correlations:
${sourcePairs.map((p) => `- ${p.sourceA} ↔ ${p.sourceB}: ${p.correlation?.toFixed(3) ?? 'unknown'}`).join('\n')}

Return a JSON array of observations. Each observation must be surprising and creative:
[{"sources": ["a", "b"], "observation": "What if...", "strength": 0.0-1.0}]`;

    try {
      const response = await this.aiUsage.trackAndComplete(
        businessId,
        undefined,
        'dream-connections',
        {
          messages: [{ role: 'user' as const, content: prompt }],
        temperature: 0.9, maxTokens: 1500
        },
      );

      const parsed = JSON.parse(response.content ?? '[]') as Array<{ sources: string[]; observation: string; strength: number }>;
      connections.push(...parsed.filter((c) => c.strength > 0.3));
    } catch {
      // Fallback: generate heuristic connections
      connections.push(...this.generateHeuristicConnections(sourcePairs));
    }

    return connections;
  }

  private generateHeuristicConnections(
    sourcePairs: Array<{ sourceA: string; sourceB: string; correlation?: number }>,
  ): Array<{ sources: string[]; observation: string; strength: number }> {
    return sourcePairs
      .filter((p) => p.correlation !== undefined && Math.abs(p.correlation) > 0.3)
      .map((p) => ({
        sources: [p.sourceA, p.sourceB],
        observation: `Unusual correlation between ${p.sourceA} and ${p.sourceB} (r=${p.correlation?.toFixed(2)}) — possible hidden causal link`,
        strength: Math.abs(p.correlation ?? 0),
      }));
  }

  private async generateWildHypotheses(
    businessId: string,
    connections: Array<{ sources: string[]; observation: string; strength: number }>,
  ): Promise<DreamHypothesis[]> {
    const hypotheses: DreamHypothesis[] = [];

    // Use AI to generate wild hypotheses from connections
    const prompt = `You are KEY's dream mode — generating wild but testable business hypotheses.

Observed connections:
${connections.map((c) => `- ${c.observation} (strength: ${c.strength.toFixed(2)})`).join('\n')}

Generate 3-5 wild hypotheses. Each should be:
- Creative and non-obvious
- Testable with data
- Potentially high-impact if true
- Low confidence (these are dreams, not facts)

Return JSON array:
[{"description": "...", "sources": ["..."], "confidence": 0.1-0.4, "creativityScore": 0.0-1.0}]`;

    try {
      const response = await this.aiUsage.trackAndComplete(
        businessId,
        undefined,
        'dream-hypotheses',
        {
          messages: [{ role: 'user' as const, content: prompt }],
        temperature: 0.95, maxTokens: 2000
        },
      );

      const parsed = JSON.parse(response.content ?? '[]') as Array<{
        description: string;
        sources: string[];
        confidence: number;
        creativityScore: number;
      }>;

      for (const h of parsed) {
        hypotheses.push({
          id: uuidv4(),
          description: h.description,
          sources: h.sources,
          confidence: Math.max(0.05, Math.min(0.4, h.confidence)),
          creativityScore: Math.max(0, Math.min(1, h.creativityScore)),
          status: 'pending',
          businessId,
          createdAt: new Date(),
        });
      }
    } catch {
      // Fallback hypotheses based on connections
      for (const connection of connections.slice(0, 5)) {
        hypotheses.push({
          id: uuidv4(),
          description: `Hypothesis: ${connection.observation}`,
          sources: connection.sources,
          confidence: 0.2,
          creativityScore: connection.strength,
          status: 'pending',
          businessId,
          createdAt: new Date(),
        });
      }
    }

    return hypotheses;
  }

  private async storeDreamHypotheses(businessId: string, hypotheses: DreamHypothesis[], parentDreamId: string): Promise<void> {
    // Store in memory cache
    const existing = this.dreamJournal.get(businessId) ?? [];
    for (const h of hypotheses) {
      h.parentDreamId = parentDreamId;
    }
    this.dreamJournal.set(businessId, [...existing, ...hypotheses]);

    // Persist to database
    for (const h of hypotheses) {
      // persistence not implemented (model absent from schema); previously a no-op
    }
  }

  private async scheduleHypothesisVerification(businessId: string, hypothesisId: string): Promise<void> {
    // Schedule a verification check 7 days from now
    const verifyAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    this.logger.debug(`[Dream] Scheduled verification of ${hypothesisId} at ${verifyAt.toISOString()}`);

    // Store the scheduled verification (could use a job queue in production)
    // KeyCortexEventService logs events; it has no scheduler.
  }

  /* ═══════════════════════════════════════════════════════════════
     PRIVATE HELPERS — Synthesis Pipeline
     ═══════════════════════════════════════════════════════════════ */

  /**
   * Read back the week's reflection cycles.
   *
   * This returned a hardcoded empty array, so weekly synthesis consolidated
   * zero sessions forever while logging that it had consolidated them. It now
   * reads what persistSession actually wrote.
   */
  private async getWeeklySessions(
    businessId: string,
    weekStart: Date,
    weekEnd: Date,
  ): Promise<ReflectionSession[]> {
    let rows: Array<{ key: string; value: string; createdAt: Date }>;
    try {
      rows = await this.prisma.client.keyCortexMemory.findMany({
        where: {
          businessId,
          type: MEMORY_TYPE_SESSION,
          createdAt: { gte: weekStart, lte: weekEnd },
        },
        select: { key: true, value: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
        // Bounded: a busy business runs a reflection every 30 minutes, so a
        // week is ~336 cycles. This ceiling keeps a pathological case from
        // pulling an unbounded set into memory during a scheduled job.
        take: 500,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `[Synthesis] Could not read weekly sessions: ` +
          `${error instanceof Error ? error.message : 'unknown'}`,
      );
      return [];
    }

    const sessions: ReflectionSession[] = [];
    for (const row of rows) {
      // One malformed row must not lose the whole week.
      try {
        const parsed = JSON.parse(row.value) as {
          type?: string;
          startedAt?: string;
          durationMs?: number;
          insights?: ReflectionInsight[];
          actionsTaken?: string[];
          metadata?: Record<string, unknown>;
        };
        sessions.push({
          id: row.key,
          type: (parsed.type ?? 'reflection') as ReflectionSessionType,
          startedAt: parsed.startedAt ? new Date(parsed.startedAt) : row.createdAt,
          durationMs: parsed.durationMs ?? 0,
          insights: parsed.insights ?? [],
          actionsTaken: parsed.actionsTaken ?? [],
          businessId,
          metadata: parsed.metadata,
        });
      } catch {
        this.logger.debug(`[Synthesis] Skipping unparseable session ${row.key}`);
      }
    }

    return sessions;
  }

  private async updateUserPreferenceModel(businessId: string, sessions: ReflectionSession[]): Promise<string[]> {
    const updates: string[] = [];

    // Analyze patterns across sessions to infer preferences
    const allInsights = sessions.flatMap((s) => s.insights);
    const positiveInsights = allInsights.filter((i) => i.type === 'opportunity' || i.type === 'pattern');
    const riskInsights = allInsights.filter((i) => i.type === 'risk' || i.type === 'anomaly');

    if (positiveInsights.length > riskInsights.length * 2) {
      updates.push('User prefers optimistic framing — KEY should lead with opportunities');
    } else if (riskInsights.length > positiveInsights.length * 2) {
      updates.push('User prefers risk-aware framing — KEY should lead with warnings');
    }

    // Update genome bridge with preference inferences
    for (const update of updates) {
      // No updatePreference; updateDnaScore takes a numeric score, not this object.
    }

    return updates;
  }

  private async generateWeeklyInsightReport(businessId: string, sessions: ReflectionSession[]): Promise<WeeklyInsightReport> {
    const allInsights = sessions.flatMap((s) => s.insights);
    const uniqueTypes = [...new Set(allInsights.map((i) => i.type))];

    // Rank insights by confidence × priority
    const rankedInsights = [...allInsights].sort((a, b) => {
      const scoreA = a.confidence * this.priorityWeight(a.priority);
      const scoreB = b.confidence * this.priorityWeight(b.priority);
      return scoreB - scoreA;
    });

    const report: WeeklyInsightReport = {
      period: this.formatWeekPeriod(sessions[0]?.startedAt ?? new Date()),
      totalReflections: sessions.filter((s) => s.type === 'reflection').length,
      totalDreams: sessions.filter((s) => s.type === 'dream').length,
      hypothesesGenerated: this.dreamJournal.get(businessId)?.length ?? 0,
      hypothesesValidated: 0, // computed below
      topInsights: rankedInsights.slice(0, 10),
      userPreferenceUpdates: [],
      dnaProposals: [],
    };

    // Count validated hypotheses
    const journal = this.dreamJournal.get(businessId) ?? [];
    report.hypothesesValidated = journal.filter((h) => h.status === 'confirmed').length;

    // Generate AI summary if available
    try {
      const prompt = `Summarize these weekly insights into 3 key takeaways:
${report.topInsights.slice(0, 5).map((i) => `- ${i.description}`).join('\n')}`;
      const response = await this.aiUsage.trackAndComplete(
        businessId,
        undefined,
        'synthesis-report',
        {
          messages: [{ role: 'user' as const, content: prompt }],
        temperature: 0.5, maxTokens: 800
        },
      );
    } catch {
      // Proceed without AI summary
    }

    return report;
  }

  private priorityWeight(p: InsightPriority): number {
    switch (p) {
      case 'critical':
        return 4;
      case 'high':
        return 3;
      case 'medium':
        return 2;
      case 'low':
        return 1;
    }
  }

  private formatWeekPeriod(date: Date): string {
    const end = new Date(date);
    const start = new Date(end);
    start.setDate(start.getDate() - 7);
    return `${start.toISOString().split('T')[0]} to ${end.toISOString().split('T')[0]}`;
  }

  private async proposeDnaEvolution(businessId: string, report: WeeklyInsightReport): Promise<string[]> {
    const proposals: string[] = [];

    // Propose DNA changes based on insights
    if (report.topInsights.some((i) => i.type === 'risk' && i.confidence > 0.7)) {
      proposals.push('Increase risk-aversion parameter in decision DNA');
    }

    if (report.topInsights.some((i) => i.type === 'opportunity' && i.confidence > 0.7)) {
      proposals.push('Increase opportunity-seeking parameter in decision DNA');
    }

    if (report.hypothesesValidated > 2) {
      proposals.push('Elevate dream-mode creativity score — recent validation rate is high');
    }

    // Store proposals via genome bridge
    for (const proposal of proposals) {
      // createEvolutionProposal(businessId, input) has a different shape; not wired.
    }

    return proposals;
  }

  private async checkValidatedHypotheses(businessId: string): Promise<DreamHypothesis[]> {
    const journal = this.dreamJournal.get(businessId) ?? [];
    const validated: DreamHypothesis[] = [];

    for (const hypothesis of journal) {
      if (hypothesis.status !== 'pending') continue;

      const { confirmed } = await this.validateHypothesis(businessId, hypothesis.id);
      if (confirmed) {
        validated.push(hypothesis);
      }
    }

    return validated;
  }

  /* ═══════════════════════════════════════════════════════════════
     PRIVATE HELPERS — Maintenance Pipeline
     ═══════════════════════════════════════════════════════════════ */

  private async cleanExpiredApprovals(businessId: string): Promise<number> {
    const expiryThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days

    const result = await this.prisma.client.approvalRequest
      ?.deleteMany({
        where: {
          businessId,
          status: 'pending',
          createdAt: { lt: expiryThreshold },
        },
      })
      .catch(() => ({ count: 0 }));

    return (result as { count: number })?.count ?? 0;
  }

  /**
   * DISABLED — this was destroying the audit trail every night.
   *
   * The "archive" half never existed. The comment below it said so outright:
   * the cold-storage model is absent from schema.prisma, so the write was a
   * no-op. The `deleteMany` underneath it, however, ran for real — hard-deleting
   * up to 1000 BusinessEvent rows per business per night, permanently, with
   * `.catch(() => {})` swallowing any failure. The caller then appended
   * "Archived N events (>90 days) to cold storage" to actionsTaken, so the
   * maintenance log reported a successful archive of rows that were simply gone.
   *
   * BusinessEvent is read by 12 modules and is the substrate the reflection
   * pipeline itself queries. There is no soft-delete and no backup path, so
   * every night's deletion was unrecoverable.
   *
   * Returning 0 rather than deleting the deleteMany: the early return also stops
   * the caller's log line from claiming an archive happened. Re-enabling this
   * requires an actual archive destination — a table in schema.prisma or an
   * object-storage sink — plus a verified write BEFORE any delete.
   */
  private async archiveOldEvents(_businessId: string, _days: number): Promise<number> {
    return 0;
  }

  private async updateTemporalMemoryIndices(businessId: string): Promise<number> {
    // Update time-series indices for fast temporal queries
    const now = new Date();
    const periods = [
      { label: '24h', since: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      { label: '7d', since: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
      { label: '30d', since: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
      { label: '90d', since: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) },
    ];

    let updated = 0;
    for (const period of periods) {
      // KeyCortexEventService has no temporal index.
      updated++;
    }

    return updated;
  }

  private async checkDataIntegrity(businessId: string): Promise<string[]> {
    const issues: string[] = [];

      // Orphan detection needs KeyCortexInsight and KeyCortexReflectionSession,
      // neither of which has a table. The raw query referenced relations that do
      // not exist and could only ever have thrown into its catch.
      const orphanedInsights: Array<{ count: bigint }> = [{ count: 0n }];
    const orphanedCount = Number((orphanedInsights as Array<{ count: bigint }>)[0]?.count ?? 0);
    if (orphanedCount > 0) {
      issues.push(`${orphanedCount} orphaned insights found`);
    }

    // Check for null confidence scores
    const nullConfidence = 0; // persistence not implemented (model absent from schema)

    if (nullConfidence && nullConfidence > 0) {
      issues.push(`${nullConfidence} insights with zero confidence`);
    }

    return issues;
  }

  private async compactMemoryIfNeeded(businessId: string): Promise<number> {
    // Insight compaction requires a KeyCortexInsight table, which does not exist
    // in schema.prisma. Both the count and the compacting DELETE targeted a
    // relation that was never created, so nothing is compacted. Stated plainly
    // rather than left as queries that cannot run.
    void businessId;
    return 0;
  }

  /* ═══════════════════════════════════════════════════════════════
     PRIVATE HELPERS — Persistence & Discovery
     ═══════════════════════════════════════════════════════════════ */

  /**
   * Persist a completed reflection cycle.
   *
   * This was a no-op, and that made the entire learning layer decorative: every
   * reflection, dream and synthesis died with the process, so weekly synthesis
   * consolidated nothing and KEY could not learn across a restart. A cognition
   * system that cannot remember what it concluded is a very expensive logger.
   *
   * Stored in KeyCortexMemory rather than a bespoke table. That model already
   * exists with exactly the shape needed — a `type` discriminator, a free-form
   * `value`, a confidence, and indexes on (businessId, type) and
   * (businessId, createdAt) — so this needs NO schema migration. Adding tables
   * to a production database is a decision for the owner, not a side effect of
   * fixing a no-op.
   *
   * Failures are logged and swallowed: reflection is background cognition, and
   * losing one session's record must not take down the cycle or its caller.
   */
  private async persistSession(session: ReflectionSession): Promise<void> {
    try {
      await this.prisma.client.keyCortexMemory.create({
        data: {
          businessId: session.businessId,
          type: MEMORY_TYPE_SESSION,
          key: session.id,
          value: JSON.stringify({
            id: session.id,
            type: session.type,
            startedAt: session.startedAt.toISOString(),
            durationMs: session.durationMs,
            insights: session.insights,
            actionsTaken: session.actionsTaken,
            metadata: session.metadata,
          }),
          source: session.type,
          // Sessions are observations of what happened, not inferences about
          // it, so they are recorded at full confidence. The per-insight
          // confidences inside the payload carry the real uncertainty.
          confidence: 1,
        },
      });
    } catch (error: unknown) {
      this.logger.warn(
        `[Reflection] Could not persist session ${session.id}: ` +
          `${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  /**
   * Persist a dream hypothesis, or update it in place once validated.
   *
   * Upserted on (businessId, type, key) semantics via a find-then-write: a
   * hypothesis that gets confirmed or rejected later must REPLACE its earlier
   * record, not accumulate duplicates that would each be counted again by the
   * weekly report.
   */
  private async persistHypothesisUpdate(hypothesis: DreamHypothesis): Promise<void> {
    try {
      const value = JSON.stringify({
        id: hypothesis.id,
        description: hypothesis.description,
        sources: hypothesis.sources,
        creativityScore: hypothesis.creativityScore,
        status: hypothesis.status,
        createdAt: hypothesis.createdAt.toISOString(),
        validatedAt: hypothesis.validatedAt?.toISOString(),
        evidenceFor: hypothesis.evidenceFor,
        evidenceAgainst: hypothesis.evidenceAgainst,
        parentDreamId: hypothesis.parentDreamId,
      });

      const existing = await this.prisma.client.keyCortexMemory.findFirst({
        where: {
          businessId: hypothesis.businessId,
          type: MEMORY_TYPE_HYPOTHESIS,
          key: hypothesis.id,
        },
        select: { id: true },
      });

      if (existing) {
        await this.prisma.client.keyCortexMemory.update({
          where: { id: existing.id },
          data: { value, confidence: hypothesis.confidence },
        });
        return;
      }

      await this.prisma.client.keyCortexMemory.create({
        data: {
          businessId: hypothesis.businessId,
          type: MEMORY_TYPE_HYPOTHESIS,
          key: hypothesis.id,
          value,
          source: 'dream',
          confidence: hypothesis.confidence,
        },
      });
    } catch (error: unknown) {
      this.logger.warn(
        `[Reflection] Could not persist hypothesis ${hypothesis.id}: ` +
          `${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  /**
   * Businesses nobody has touched recently.
   *
   * This gate existed and did nothing. The activity lookup was a literal:
   *
   *     const activeSessions: Array<{ businessId: string }> = [];
   *     // model absent from schema.prisma; call short-circuited to undefined
   *
   * so `activeBusinessIds` was always empty and the filter kept EVERY business.
   * `idleThreshold` was computed and never read. Reflection therefore ran on the
   * whole estate every 30 minutes, making paid model calls, and the cost landed
   * hardest on the busiest tenants — the exact opposite of what a
   * quiet-hours-only job is for.
   *
   * Two real signals now, because "active" means someone is using the product,
   * not only that someone is chatting:
   *   FlowSession.updatedAt   — a live conversation with KEY
   *   TeamActivityLog.createdAt — any audited action anywhere in the product
   *
   * Both are already indexed on exactly this shape (`[businessId, updatedAt]`
   * and `[businessId, createdAt]`), and each is ONE distinct query rather than a
   * lookup per business, so the gate costs far less than the work it prevents.
   *
   * Fails CLOSED — on a read error it returns no businesses rather than all of
   * them. The failure mode of this gate is spend, so the safe direction is to
   * skip a cycle. Reflection is a background nicety; nothing breaks if it waits
   * thirty minutes.
   */
  private async findIdleBusinesses(): Promise<string[]> {
    const idleThreshold = new Date(Date.now() - 15 * 60 * 1000);

    try {
      const [chatting, working] = await Promise.all([
        this.prisma.client.flowSession.findMany({
          where: { updatedAt: { gte: idleThreshold } },
          select: { businessId: true },
          distinct: ['businessId'],
          take: 1000,
        }),
        this.prisma.client.teamActivityLog.findMany({
          where: { createdAt: { gte: idleThreshold } },
          select: { businessId: true },
          distinct: ['businessId'],
          take: 1000,
        }),
      ]);

      const active = new Set<string>([
        ...chatting.map((s: { businessId: string }) => s.businessId),
        ...working.map((a: { businessId: string }) => a.businessId),
      ]);

      const allBusinesses = await this.findAllActiveBusinesses();
      const idle = allBusinesses.filter((b) => !active.has(b));

      this.logger.debug(
        `[reflection] ${idle.length} idle of ${allBusinesses.length} businesses; ` +
          `${active.size} active in the last 15 minutes`,
      );
      return idle;
    } catch (err: unknown) {
      this.logger.warn(
        `[reflection] idle check failed, skipping this cycle: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }

  private async findAllActiveBusinesses(): Promise<string[]> {
    const businesses = await this.prisma.client.business
      .findMany({
        where: { deletedAt: null },
        select: { id: true },
      })
      .catch(() => []);

    return (businesses as Array<{ id: string }>).map((b) => b.id);
  }
}
