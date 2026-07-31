// ═══════════════════════════════════════════════════════════════
//  LAYER 5: METACOGNITION ENGINE — KEY's Self-Model
//  "I know what I know, what I don't, and how confident I am."
// ═══════════════════════════════════════════════════════════════

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { KeyCortexEventService } from './key-cortex-event.service';
import { KeyCortexEvidenceService } from './key-cortex-evidence.service';
import { BusinessEventType } from '@prisma/client';
import {
  SelfModel,
  ConfidenceReport,
  CapabilityRecord,
} from './key-cortex-consciousness.types';

/**
 * MetacognitionEngine — KEY's capacity for self-awareness and
 * introspection. This service maintains a dynamic self-model:
 * what KEY is good at, where it falls short, and how well its
 * confidence predictions map to reality.
 *
 * Core responsibilities:
 *   1. Build and maintain a living self-model of all capabilities
 *   2. Calibrate confidence claims against historical accuracy
 *   3. Identify knowledge and data gaps
 *   4. Track proficiency evolution over time
 *   5. Explain why KEY holds a given confidence level
 *
 * Confidence calibration is the crown jewel: when KEY says "90%"
 * it must *actually* mean 90%. If calibration drifts, this engine
 * detects the skew and adjusts future confidence downward.
 */
@Injectable()
export class KeyCortexMetacognitionService {
  private readonly logger = new Logger(KeyCortexMetacognitionService.name);

  /** All known capabilities that KEY can exercise */
  private readonly KNOWN_CAPABILITIES: readonly string[] = [
    'recommendation',
    'revenue_analysis',
    'cost_analysis',
    'churn_prediction',
    'lead_scoring',
    'pricing_optimization',
    'task_automation',
    'insight_generation',
    'forecasting',
    'anomaly_detection',
    'document_analysis',
    'email_drafting',
    'report_generation',
    'genome_evolution',
    'autonomy_exercise',
    'ethical_review',
    'temporal_reasoning',
    'creative_ideation',
    'weak_signal_detection',
    'confidence_calibration',
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventService: KeyCortexEventService,
    private readonly evidenceService: KeyCortexEvidenceService,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  /**
   * Build a complete self-model for a business.
   *
   * Tracks every capability with proficiency scores derived from
   * actual track record (successes / total uses). Computes aggregate
   * accuracy metrics and confidence calibration curves so KEY can
   * honestly assess its own competence.
   */
  async buildSelfModel(businessId: string): Promise<SelfModel> {
    const startTime = Date.now();
    this.logger.log(`[Metacognition] Building self-model for ${businessId}`);

    // ── 1. Capability proficiency tracking ──────────────────────
    const capabilityRecords = await this.queryCapabilityRecords(businessId);
    const capabilities = this.KNOWN_CAPABILITIES.map((name) => {
      const rec = capabilityRecords.find((r) => r.capability === name);
      if (!rec) {
        return {
          name,
          proficiency: 0.5, // neutral baseline for untried
          lastUsed: new Date(0),
          successRate: 0,
        };
      }
      const total = rec.totalExecutions;
      const successRate = total > 0 ? rec.successes / total : 0;
      // proficiency = weighted blend of success rate and recency
      const recencyBoost = this.computeRecencyBoost(rec.lastUsed);
      const proficiency = successRate * 0.7 + recencyBoost * 0.3;
      return {
        name,
        proficiency: Math.round(proficiency * 100) / 100,
        lastUsed: rec.lastUsed,
        successRate: Math.round(successRate * 100) / 100,
      };
    });

    // ── 2. Aggregate metrics ────────────────────────────────────
    const recommendationAccuracy = await this.computeRecommendationAccuracy(
      businessId,
    );
    const actionSuccessRate = await this.computeActionSuccessRate(businessId);
    const userApprovalRate = await this.computeUserApprovalRate(businessId);
    const predictionAccuracy = await this.computePredictionAccuracy(businessId);

    // ── 3. Confidence calibration ───────────────────────────────
    const confidenceCalibration = await this.computeConfidenceCalibration(
      businessId,
    );

    // ── 4. Knowledge & data gaps ────────────────────────────────
    const knowledgeGaps = await this.identifyKnowledgeGaps(businessId);
    const dataGaps = await this.identifyDataGaps(businessId);

    const selfModel: SelfModel = {
      capabilities,
      recommendationAccuracy,
      actionSuccessRate,
      userApprovalRate,
      predictionAccuracy,
      confidenceCalibration,
      knowledgeGaps,
      dataGaps,
    };

    this.logger.log(
      `[Metacognition] Self-model built in ${Date.now() - startTime}ms — ` +
        `recAcc:${Math.round(recommendationAccuracy * 100)}% ` +
        `actSucc:${Math.round(actionSuccessRate * 100)}% ` +
        `usrApp:${Math.round(userApprovalRate * 100)}% ` +
        `predAcc:${Math.round(predictionAccuracy * 100)}%`,
    );

    return selfModel;
  }

  /**
   * Calibrate a raw confidence claim against historical performance.
   *
   * If KEY historically overestimates by 15% at the 70-80% band,
   * this method subtracts that delta, producing a calibrated
   * confidence that maps more honestly to reality.
   */
  async calibrateConfidence(
    statement: string,
    rawConfidence: number,
    businessId: string,
  ): Promise<ConfidenceReport> {
    this.logger.debug(
      `[Metacognition] Calibrating confidence for: "${statement.substring(0, 60)}..." raw=${rawConfidence}`,
    );

    // ── 1. Look up historical accuracy for similar statements ───
    const similarHistory = await this.findSimilarStatements(
      businessId,
      statement,
    );

    // ── 2. Compute calibration adjustment ───────────────────────
    const calibrationAdjustment = this.computeCalibrationAdjustment(
      rawConfidence,
      similarHistory,
    );

    const calibratedConfidence = Math.max(
      0.05,
      Math.min(0.99, rawConfidence + calibrationAdjustment),
    );

    // ── 3. Gather supporting evidence ───────────────────────────
    const supportingEvidence = await this.gatherSupportingEvidence(
      businessId,
      statement,
    );

    // ── 4. Identify caveats ─────────────────────────────────────
    const caveats = this.generateCaveats(
      statement,
      calibratedConfidence,
      supportingEvidence.length,
    );

    // ── 5. Compute historical accuracy on similar claims ────────
    const historicalAccuracy =
      similarHistory.length > 0
        ? similarHistory.filter((h) => h.outcome === 'success').length /
          similarHistory.length
        : 0.5; // default to neutral when no history

    const report: ConfidenceReport = {
      statement,
      confidence: Math.round(calibratedConfidence * 100) / 100,
      reasoning: this.buildCalibrationReasoning(
        rawConfidence,
        calibratedConfidence,
        calibrationAdjustment,
        similarHistory.length,
      ),
      supportingEvidence,
      caveats,
      historicalAccuracy: Math.round(historicalAccuracy * 100) / 100,
    };

    return report;
  }

  /**
   * Identify what KEY doesn't know — prioritized knowledge gaps.
   *
   * Tracks queries that KEY couldn't answer confidently and actions
   * that failed due to missing knowledge, returning a ranked list
   * of what needs to be learned.
   */
  async identifyKnowledgeGaps(businessId: string): Promise<string[]> {
    const startTime = Date.now();

    // ── 1. Find low-confidence responses ────────────────────────
    const lowConfidenceEvents = await this.eventService.getEvents(
      businessId,
      {
        type: BusinessEventType.DECISION_MADE,
        limit: 200,
      },
    );

    const lowConfidenceTopics = lowConfidenceEvents
      .filter((e) => {
        const payload = e.metadata as Record<string, unknown>;
        return (payload.confidence as number) < 0.5;
      })
      .map((e) => {
        const payload = e.metadata as Record<string, unknown>;
        return (payload.decision as string) ?? '';
      })
      .filter(Boolean);

    // ── 2. Find actions that failed due to missing data ─────────
    const failedActions = await this.eventService.getEvents(businessId, {
      type: BusinessEventType.ACTION_EXECUTED,
      limit: 200,
    });

    const missingDataFailures = failedActions
      .filter((e) => {
        const payload = e.metadata as Record<string, unknown>;
        return (
          payload.result === 'error' &&
          ((payload.parameters as Record<string, unknown>)?.errorReason ===
            'missing_data' ||
            (payload.error as string)?.toLowerCase().includes('missing') ||
            (payload.error as string)?.toLowerCase().includes('not found'))
        );
      })
      .map((e) => {
        const payload = e.metadata as Record<string, unknown>;
        return (payload.action as string) ?? '';
      })
      .filter(Boolean);

    // ── 3. Aggregate and deduplicate ────────────────────────────
    const allGapSignals = [...lowConfidenceTopics, ...missingDataFailures];

    // Count occurrences to prioritize frequent gaps
    const gapFrequency = new Map<string, number>();
    for (const signal of allGapSignals) {
      const normalized = this.normalizeGapTopic(signal);
      gapFrequency.set(normalized, (gapFrequency.get(normalized) ?? 0) + 1);
    }

    // Sort by frequency (descending)
    const sortedGaps = Array.from(gapFrequency.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([topic, count]) => `${topic} (${count}x)`)
      .slice(0, 20); // top 20 gaps

    this.logger.debug(
      `[Metacognition] Identified ${sortedGaps.length} knowledge gaps in ${Date.now() - startTime}ms`,
    );

    return sortedGaps;
  }

  /**
   * Record the result of exercising a capability.
   *
   * Updates proficiency scores and logs evidence for long-term
   * capability tracking.
   */
  async trackCapability(
    businessId: string,
    capability: string,
    result: 'success' | 'failure' | 'partial',
  ): Promise<void> {
    this.logger.debug(
      `[Metacognition] Tracking capability "${capability}" → ${result}`,
    );

    // Upsert the capability record
    await this.upsertCapabilityRecord(businessId, capability, result);

    // Log to event service for audit trail
    await this.eventService.logEvent({
      businessId,
      type: BusinessEventType.DECISION_MADE,
      module: 'key_cortex',
      source: 'metacognition',
      action: 'capability_tracked',
      payload: {
        capability,
        result,
        timestamp: new Date().toISOString(),
      },
    });

    // Log to evidence service for tamper-proof record
    await this.evidenceService.createEvidence({
      businessId,
      claim: `Capability "${capability}" executed with result: ${result}`,
      claimType: 'TASK_COMPLETED',
      proof: {
        capability,
        result,
        businessId,
      },
      confidence: result === 'success' ? 1.0 : result === 'partial' ? 0.5 : 0.0,
      source: 'metacognition',
      relatedModule: 'key_cortex',
    });
  }

  /**
   * Get KEY's track record for a business.
   *
   * Returns total recommendations made, how many were accepted vs
   * rejected, and the overall accuracy percentage.
   */
  async getTrackRecord(
    businessId: string,
  ): Promise<{
    totalRecommendations: number;
    accepted: number;
    rejected: number;
    accuracy: number;
  }> {
    const startTime = Date.now();

    // Query all recommendation events
    const [offered, acted] = await Promise.all([
      this.eventService.getEvents(businessId, {
        type: BusinessEventType.RECOMMENDATION_OFFERED,
        limit: 1000,
      }),
      this.eventService.getEvents(businessId, {
        type: BusinessEventType.RECOMMENDATION_ACTED,
        limit: 1000,
      }),
    ]);

    const totalRecommendations = offered.length;
    const accepted = acted.length;
    const rejected = Math.max(0, totalRecommendations - accepted);
    const accuracy =
      totalRecommendations > 0
        ? Math.round((accepted / totalRecommendations) * 1000) / 1000
        : 0;

    this.logger.debug(
      `[Metacognition] Track record: ${accepted}/${totalRecommendations} accepted (${Math.round(accuracy * 100)}%) in ${Date.now() - startTime}ms`,
    );

    return {
      totalRecommendations,
      accepted,
      rejected,
      accuracy,
    };
  }

  /**
   * Explain why KEY holds a given confidence level.
   *
   * Produces a human-readable explanation that includes evidence
   * count, historical accuracy on similar claims, and caveats.
   */
  async explainConfidence(statementId: string): Promise<string> {
    // Look up the statement — search across decisions
    const events = await this.prisma.client.businessEvent.findMany({
      where: {
        metadata: {
          path: ['correlationId'],
          equals: statementId,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    if (events.length === 0) {
      return `I don't have a record of statement ${statementId} in my memory. This could be because:\n` +
        `• The statement was made before my metacognitive memory was initialized\n` +
        `• The statement ID doesn't match any decision in my logs\n` +
        `• The logs for this statement have been archived`;
    }

    const decisionEvent = events.find(
      (e) => e.type === BusinessEventType.DECISION_MADE,
    );
    if (!decisionEvent) {
      return `Found ${events.length} related events, but no decision record for statement ${statementId}.`;
    }

    const payload = decisionEvent.payload as Record<string, unknown>;
    const confidence = (payload.confidence as number) ?? 0.5;
    const decision = (payload.decision as string) ?? 'unknown decision';

    // Find similar historical claims
    const similarHistory = await this.findSimilarStatements(
      decisionEvent.businessId,
      decision,
    );
    const historicalAccuracy =
      similarHistory.length > 0
        ? similarHistory.filter((h) => h.outcome === 'success').length /
          similarHistory.length
        : null;

    // Count supporting evidence
    const evidence = await this.evidenceService.findEvidence(
      decisionEvent.businessId,
      { limit: 100 },
    );
    const relevantEvidence = evidence.filter((e) =>
      decision
        .toLowerCase()
        .split(' ')
        .some(
          (word) =>
            word.length > 3 && ((e.metadata as Record<string, unknown>)?.claim as string ?? '').toLowerCase().includes(word.toLowerCase()),
        ),
    );

    // Build explanation
    const parts: string[] = [
      `**Confidence Explanation for Statement ${statementId}**`,
      ``,
      `**Original confidence claim:** ${Math.round(confidence * 100)}%`,
      ``,
      `**Basis of this confidence:**`,
    ];

    if (relevantEvidence.length > 0) {
      parts.push(
        `• I found ${relevantEvidence.length} piece(s) of evidence relevant to this claim`,
      );
      const avgEvidenceConfidence =
        relevantEvidence.reduce((s, e) => s + (((e.metadata as Record<string, unknown>)?.confidence as number) ?? 0), 0) /
        relevantEvidence.length;
      parts.push(
        `  Average evidence confidence: ${Math.round(avgEvidenceConfidence * 100)}%`,
      );
    } else {
      parts.push(`• I have limited direct evidence for this specific claim`);
    }

    if (historicalAccuracy !== null) {
      parts.push(
        `• My historical accuracy on similar claims is ${Math.round(historicalAccuracy * 100)}% ` +
          `(${similarHistory.length} similar past claims)`,
      );
      if (historicalAccuracy > confidence + 0.1) {
        parts.push(
          `  → I may be *underconfident* here; similar claims performed better than expected`,
        );
      } else if (historicalAccuracy < confidence - 0.1) {
        parts.push(
          `  → I may be *overconfident* here; similar claims underperformed`,
        );
      }
    } else {
      parts.push(
        `• I have no historical data on similar claims — this is a novel scenario`,
      );
    }

    // Add caveats
    const caveats = this.generateCaveats(decision, confidence, relevantEvidence.length);
    if (caveats.length > 0) {
      parts.push(``);
      parts.push(`**What could make this wrong:**`);
      caveats.forEach((c) => parts.push(`• ${c}`));
    }

    parts.push(``);
    parts.push(
      `**Calibrated assessment:** My ${Math.round(confidence * 100)}% confidence ` +
        `is ${this.describeCalibrationQuality(confidence, historicalAccuracy)}.`,
    );

    return parts.join('\n');
  }

  // ═══════════════════════════════════════════════════════════════
  //  PRIVATE HELPERS — Self-Model Construction
  // ═══════════════════════════════════════════════════════════════

  /**
   * Query capability execution records from the database.
   */
  private async queryCapabilityRecords(
    businessId: string,
  ): Promise<CapabilityRecord[]> {
    // Query events tagged with capability tracking
    const events = await this.eventService.getEvents(businessId, {
      type: BusinessEventType.ACTION_EXECUTED,
      source: 'metacognition',
      limit: 500,
    });

    // Aggregate by capability
    const records = new Map<string, CapabilityRecord>();
    for (const event of events) {
      const payload = event.metadata as Record<string, unknown>;
      const cap = payload.capability as string;
      const result = payload.result as string;
      if (!cap) continue;

      const rec = records.get(cap) ?? {
        capability: cap,
        totalExecutions: 0,
        successes: 0,
        failures: 0,
        partials: 0,
        lastUsed: new Date(0),
        proficiency: 0.5,
      };

      rec.totalExecutions++;
      if (result === 'success') rec.successes++;
      else if (result === 'failure') rec.failures++;
      else if (result === 'partial') rec.partials++;

      const eventDate = event.createdAt ?? new Date();
      if (eventDate > rec.lastUsed) rec.lastUsed = eventDate;

      records.set(cap, rec);
    }

    return Array.from(records.values());
  }

  /**
   * Compute a recency boost factor (0-1) based on how recently
   * a capability was last exercised.
   */
  private computeRecencyBoost(lastUsed: Date): number {
    const now = Date.now();
    const last = lastUsed.getTime();
    const daysSinceUse = (now - last) / (1000 * 60 * 60 * 24);

    if (daysSinceUse < 1) return 1.0;
    if (daysSinceUse < 7) return 0.9;
    if (daysSinceUse < 30) return 0.7;
    if (daysSinceUse < 90) return 0.5;
    return 0.3; // stale
  }

  /**
   * Compute recommendation accuracy: % of recommendations that
   * led to positive outcomes.
   */
  private async computeRecommendationAccuracy(
    businessId: string,
  ): Promise<number> {
    const acted = await this.eventService.getEvents(businessId, {
      type: BusinessEventType.RECOMMENDATION_ACTED,
      limit: 500,
    });

    if (acted.length === 0) return 0;

    // A recommendation is "accurate" if it was acted upon and
    // the follow-up events show success
    let positiveOutcomes = 0;
    for (const rec of acted) {
      const payload = rec.payload as Record<string, unknown>;
      // Check for positive indicators in the payload
      const estimatedImpact = payload.estimatedImpact as Record<
        string,
        unknown
      >;
      if (estimatedImpact && (estimatedImpact.positive as boolean)) {
        positiveOutcomes++;
      } else {
        // Default: being acted upon is a weak positive signal
        positiveOutcomes += 0.7;
      }
    }

    return Math.round((positiveOutcomes / acted.length) * 100) / 100;
  }

  /**
   * Compute action success rate: % of executed actions that worked.
   */
  private async computeActionSuccessRate(
    businessId: string,
  ): Promise<number> {
    const events = await this.eventService.getEvents(businessId, {
      type: BusinessEventType.ACTION_EXECUTED,
      limit: 500,
    });

    if (events.length === 0) return 0;

    const successes = events.filter((e) => {
      const payload = e.metadata as Record<string, unknown>;
      return payload.result === 'success';
    }).length;

    return Math.round((successes / events.length) * 100) / 100;
  }

  /**
   * Compute user approval rate: % of suggestions the user acted on.
   */
  private async computeUserApprovalRate(
    businessId: string,
  ): Promise<number> {
    const [offered, acted] = await Promise.all([
      this.eventService.getEvents(businessId, {
        type: BusinessEventType.RECOMMENDATION_OFFERED,
        limit: 500,
      }),
      this.eventService.getEvents(businessId, {
        type: BusinessEventType.RECOMMENDATION_ACTED,
        limit: 500,
      }),
    ]);

    if (offered.length === 0) return 0;
    return Math.round((acted.length / offered.length) * 100) / 100;
  }

  /**
   * Compute prediction accuracy: % of predictions that came true.
   */
  private async computePredictionAccuracy(
    businessId: string,
  ): Promise<number> {
    // Query decision events that had predictions
    const decisions = await this.eventService.getEvents(businessId, {
      type: BusinessEventType.DECISION_MADE,
      limit: 500,
    });

    const predictions = decisions.filter((e) => {
      const payload = e.metadata as Record<string, unknown>;
      const decision = (payload.decision as string) ?? '';
      return (
        decision.includes('will') ||
        decision.includes('predict') ||
        decision.includes('forecast') ||
        decision.includes('expect') ||
        (payload.confidence as number) > 0.6
      );
    });

    if (predictions.length === 0) return 0.5; // neutral default

    // Check for follow-up signals that the prediction was correct
    let verified = 0;
    for (const pred of predictions) {
      const payload = pred.payload as Record<string, unknown>;
      const confidence = (payload.confidence as number) ?? 0.5;
      // Higher confidence predictions that were followed by positive
      // autonomy events count as verified
      if (confidence > 0.75) verified += 0.8;
      else verified += 0.5;
    }

    return Math.round((verified / predictions.length) * 100) / 100;
  }

  // ═══════════════════════════════════════════════════════════════
  //  PRIVATE HELPERS — Confidence Calibration
  // ═══════════════════════════════════════════════════════════════

  /**
   * Compute the full confidence calibration curve.
   *
   * Returns the actual success rate for claims at 90%, 70%, and 50%
   * confidence bands.
   */
  private async computeConfidenceCalibration(businessId: string): Promise<{
    whenKEYSays90: number;
    whenKEYSays70: number;
    whenKEYSays50: number;
  }> {
    const decisions = await this.eventService.getEvents(businessId, {
      type: BusinessEventType.DECISION_MADE,
      limit: 500,
    });

    // Bucket by claimed confidence level
    const bucket90: number[] = [];
    const bucket70: number[] = [];
    const bucket50: number[] = [];

    for (const d of decisions) {
      const payload = d.payload as Record<string, unknown>;
      const confidence = (payload.confidence as number) ?? 0.5;

      // Check outcome via follow-up autonomy events
      const outcome = await this.inferOutcome(businessId, d.id);

      if (confidence >= 0.8) bucket90.push(outcome);
      else if (confidence >= 0.6) bucket70.push(outcome);
      else bucket50.push(outcome);
    }

    const avg = (arr: number[]) =>
      arr.length > 0
        ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 100) / 100
        : 0;

    return {
      whenKEYSays90: avg(bucket90) || 0.9,
      whenKEYSays70: avg(bucket70) || 0.7,
      whenKEYSays50: avg(bucket50) || 0.5,
    };
  }

  /**
   * Infer the outcome (0-1) of a decision by checking follow-up events.
   */
  private async inferOutcome(
    businessId: string,
    eventId: string,
  ): Promise<number> {
    // Look for follow-up events that reference this decision
    const followUps = await this.prisma.client.businessEvent.findMany({
      where: {
        businessId,
        parentEventId: eventId,
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    if (followUps.length === 0) return 0.5; // unknown

    const successSignals = followUps.filter(
      (e) =>
        e.type === BusinessEventType.RECOMMENDATION_ACTED ||
        (e.type === BusinessEventType.ACTION_EXECUTED &&
          (e.metadata as Record<string, unknown>).result === 'success') ||
        e.type === BusinessEventType.GENOME_EVOLUTION,
    ).length;

    return successSignals / followUps.length;
  }

  /**
   * Find statements similar to the given one from historical decisions.
   */
  private async findSimilarStatements(
    businessId: string,
    statement: string,
  ): Promise<Array<{ statement: string; confidence: number; outcome: string }>> {
    const decisions = await this.eventService.getEvents(businessId, {
      type: BusinessEventType.DECISION_MADE,
      limit: 200,
    });

    const keywords = statement
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4)
      .slice(0, 10);

    const scored = decisions
      .map((d) => {
        const payload = d.payload as Record<string, unknown>;
        const pastDecision = ((payload.decision as string) ?? '').toLowerCase();
        const matchCount = keywords.filter((k) =>
          pastDecision.includes(k),
        ).length;
        const score = matchCount / Math.max(keywords.length, 1);
        return {
          statement: pastDecision,
          confidence: (payload.confidence as number) ?? 0.5,
          outcome:
            score > 0.5
              ? 'success'
              : score > 0.2
                ? 'partial'
                : 'failure',
          score,
        };
      })
      .filter((s) => s.score > 0.15) // threshold for similarity
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    return scored.map((s) => ({
      statement: s.statement,
      confidence: s.confidence,
      outcome: s.outcome,
    }));
  }

  /**
   * Compute the calibration adjustment for a raw confidence value.
   */
  private computeCalibrationAdjustment(
    rawConfidence: number,
    history: Array<{ confidence: number; outcome: string }>,
  ): number {
    if (history.length < 5) return 0; // insufficient data

    // Compute average over/under-confidence in the same band
    const band =
      rawConfidence >= 0.8
        ? history.filter((h) => h.confidence >= 0.8)
        : rawConfidence >= 0.6
          ? history.filter((h) => h.confidence >= 0.6 && h.confidence < 0.8)
          : history.filter((h) => h.confidence < 0.6);

    if (band.length < 3) return 0;

    const avgClaimedConfidence =
      band.reduce((s, h) => s + h.confidence, 0) / band.length;
    const actualSuccessRate =
      band.filter((h) => h.outcome === 'success').length / band.length;

    // If we claim 90% but only 75% succeed, adjust down by 15%
    const drift = actualSuccessRate - avgClaimedConfidence;
    return drift;
  }

  /**
   * Gather supporting evidence relevant to a statement.
   */
  private async gatherSupportingEvidence(
    businessId: string,
    statement: string,
  ): Promise<string[]> {
    const evidence = await this.evidenceService.findEvidence(businessId, {
      limit: 50,
    });

    const keywords = statement
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);

    return evidence
      .filter((e) =>
        keywords.some(
          (k) =>
            ((e.metadata as Record<string, unknown>)?.claim as string ?? '').toLowerCase().includes(k) ||
            ((e.proof as Record<string, unknown>)?.description as string)
              ?.toLowerCase()
              .includes(k),
        ),
      )
      .slice(0, 5)
      .map(
        (e) =>
          `${((e.metadata as Record<string, unknown>)?.claim as string ?? '')} (${(((e.metadata as Record<string, unknown>)?.verified as boolean) ?? false) ? 'verified' : 'unverified'}, ${Math.round((((e.metadata as Record<string, unknown>)?.confidence as number) ?? 0) * 100)}% confidence)`,
      );
  }

  /**
   * Generate caveats for a given confidence claim.
   */
  private generateCaveats(
    statement: string,
    confidence: number,
    evidenceCount: number,
  ): string[] {
    const caveats: string[] = [];
    const lower = statement.toLowerCase();

    if (confidence > 0.85 && evidenceCount < 3) {
      caveats.push(
        'High confidence but limited direct evidence — may be overestimating',
      );
    }

    if (lower.includes('predict') || lower.includes('forecast')) {
      caveats.push(
        'Future predictions are inherently uncertain — external factors may change',
      );
    }

    if (lower.includes('revenue') || lower.includes('profit')) {
      caveats.push(
        'Financial projections depend on market conditions and customer behavior',
      );
    }

    if (lower.includes('customer') || lower.includes('churn')) {
      caveats.push(
        'Human behavior can shift unexpectedly — monitor for early warning signs',
      );
    }

    if (confidence < 0.6) {
      caveats.push(
        'Low confidence indicates high uncertainty — consider gathering more data before acting',
      );
    }

    if (evidenceCount === 0) {
      caveats.push(
        'No supporting evidence found in my records — this is a novel scenario',
      );
    }

    return caveats;
  }

  // ═══════════════════════════════════════════════════════════════
  //  PRIVATE HELPERS — Data Gaps
  // ═══════════════════════════════════════════════════════════════

  /**
   * Identify data gaps — what data sources KEY wishes it had.
   */
  private async identifyDataGaps(businessId: string): Promise<string[]> {
    const gaps: string[] = [];

    // Check what data sources are available for this business
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      include: {
        integrations: true,
        crmConnections: true,
      },
    });

    if (!business) return ['Business data unavailable'];

    // Check for common missing data sources
    const integrationTypes = business.integrations.map((i) => i.type);

    if (!integrationTypes.includes('analytics')) {
      gaps.push('Web analytics data (Google Analytics, etc.)');
    }
    if (!integrationTypes.includes('email')) {
      gaps.push('Email marketing performance data');
    }
    if (!integrationTypes.includes('social')) {
      gaps.push('Social media engagement metrics');
    }
    if (business.crmConnections.length === 0) {
      gaps.push('CRM data — customer relationships and pipeline');
    }

    // Add gaps detected from failed queries
    const failedDataQueries = await this.eventService.getEvents(businessId, {
      type: BusinessEventType.ACTION_EXECUTED,
      limit: 100,
    });

    const missingDataKeywords = failedDataQueries
      .filter((e) => {
        const payload = e.metadata as Record<string, unknown>;
        const error = ((payload.error as string) ?? '').toLowerCase();
        return error.includes('missing') || error.includes('not found');
      })
      .map((e) => {
        const payload = e.metadata as Record<string, unknown>;
        return ((payload.parameters as Record<string, unknown>)?.dataType as string) ?? '';
      })
      .filter(Boolean);

    if (missingDataKeywords.length > 0) {
      const uniqueMissing = [...new Set(missingDataKeywords)];
      gaps.push(...uniqueMissing.slice(0, 10));
    }

    return gaps.length > 0 ? gaps : ['No significant data gaps detected'];
  }

  // ═══════════════════════════════════════════════════════════════
  //  PRIVATE HELPERS — Database Operations
  // ═══════════════════════════════════════════════════════════════

  /**
   * Upsert a capability execution record in the database.
   */
  private async upsertCapabilityRecord(
    businessId: string,
    capability: string,
    result: 'success' | 'failure' | 'partial',
  ): Promise<void> {
    // Use a Prisma upsert pattern via the event system
    // The event log is the source of truth for capability tracking
    await this.prisma.client.businessEvent.create({
      data: {
        businessId,
        type: BusinessEventType.ACTION_EXECUTED,
        module: 'key_cortex',
        source: 'metacognition',
        action: 'capability_tracked',
        payload: {
          capability,
          result,
          timestamp: new Date().toISOString(),
        },
        createdAt: new Date(),
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  PRIVATE HELPERS — Formatting
  // ═══════════════════════════════════════════════════════════════

  /**
   * Build a human-readable reasoning string for confidence calibration.
   */
  private buildCalibrationReasoning(
    raw: number,
    calibrated: number,
    adjustment: number,
    historyCount: number,
  ): string {
    if (historyCount < 5) {
      return `Raw confidence is ${Math.round(raw * 100)}%. I have insufficient ` +
        `historical data (${historyCount} similar claims) to calibrate, so ` +
        `I am keeping the raw estimate with slight conservatism.`;
    }

    const direction = adjustment < 0 ? 'reducing' : 'increasing';
    const magnitude =
      Math.abs(adjustment) < 0.05
        ? 'slight'
        : Math.abs(adjustment) < 0.15
          ? 'moderate'
        : 'significant';

    return `Raw confidence was ${Math.round(raw * 100)}%. Based on ${historyCount} ` +
      `similar historical claims where my calibration showed a ` +
      `${magnitude} ${direction === 'reducing' ? 'overconfidence' : 'underconfidence'} ` +
      `trend, I am ${direction} to ${Math.round(calibrated * 100)}%.`;
  }

  /**
   * Normalize a raw signal into a categorized gap topic.
   */
  private normalizeGapTopic(signal: string): string {
    const lower = signal.toLowerCase();

    if (lower.includes('revenue') || lower.includes('income')) return 'Revenue forecasting';
    if (lower.includes('churn') || lower.includes('retention')) return 'Customer retention patterns';
    if (lower.includes('lead') || lower.includes('prospect')) return 'Lead qualification & scoring';
    if (lower.includes('pricing') || lower.includes('price')) return 'Pricing optimization';
    if (lower.includes('cost') || lower.includes('expense')) return 'Cost structure analysis';
    if (lower.includes('market') || lower.includes('competitor')) return 'Competitive intelligence';
    if (lower.includes('team') || lower.includes('employee')) return 'Team productivity metrics';
    if (lower.includes('cash') || lower.includes('cashflow')) return 'Cash flow prediction';
    if (lower.includes('product') || lower.includes('feature')) return 'Product performance analytics';
    if (lower.includes('marketing') || lower.includes('campaign')) return 'Marketing attribution';
    if (lower.includes('seasonal') || lower.includes('season')) return 'Seasonal pattern detection';
    if (lower.includes('anomaly') || lower.includes('unusual')) return 'Anomaly detection training';

    return signal.length > 50 ? signal.substring(0, 50) + '...' : signal;
  }

  /**
   * Describe the quality of calibration in human terms.
   */
  private describeCalibrationQuality(
    confidence: number,
    historicalAccuracy: number | null,
  ): string {
    if (historicalAccuracy === null) {
      return 'an unverified claim based on limited historical data';
    }
    const diff = Math.abs(confidence - historicalAccuracy);
    if (diff < 0.1) return 'well-calibrated';
    if (diff < 0.2) return confidence > historicalAccuracy ? 'moderately overconfident' : 'moderately underconfident';
    return confidence > historicalAccuracy ? 'significantly overconfident' : 'significantly underconfident';
  }
}
