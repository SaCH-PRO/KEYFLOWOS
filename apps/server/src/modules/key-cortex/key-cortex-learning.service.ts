/**
 * KEY Cortex Learning Service — Phase D.3 + D.4
 * Persistent Learning Loop + Metacognition / Confidence Calibration
 *
 * - Records every recommendation and its observed outcome in CognitionMemory.
 * - Accepts explicit user feedback (accepted / rejected / modified / no_action)
 *   and uses it to extract lessons learned.
 * - Persists outcomes to GenomeRecommendationOutcome and KeyEvolutionLog.
 * - Retrieves relevant past lessons before new queries.
 * - Calibrates stated confidence against historical acceptance rates.
 */

import {
  Injectable,
  Logger,
  Inject,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ModelGatewayService } from '../ai/model-gateway.service';

export type UserResponse = 'accepted' | 'rejected' | 'modified' | 'no_action';

export interface RecordObservationInput {
  sessionId: string;
  businessId: string;
  userId?: string;
  roleId?: string;
  functionId?: string;
  query: string;
  recommendation: string;
  confidence: number;
  metadata?: Record<string, unknown>;
}

export interface RecordFeedbackInput {
  sessionId: string;
  businessId: string;
  userId?: string;
  roleId?: string;
  functionId?: string;
  userResponse: UserResponse;
  actualOutcome?: string;
  dismissalReason?: string;
  recommendationId?: string;
  metadata?: Record<string, unknown>;
}

export interface AcceptanceRate {
  accepted: number;
  rejected: number;
  modified: number;
  total: number;
  rate: number; // 0..1 acceptance rate
}

@Injectable()
export class KeyCortexLearningService {
  private readonly logger = new Logger(KeyCortexLearningService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(ModelGatewayService)
    private readonly modelGateway?: ModelGatewayService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  // D.3 — Observation recording (during query processing)
  // ═══════════════════════════════════════════════════════════

  async recordObservation(input: RecordObservationInput): Promise<void> {
    try {
      await (this.prisma.client as any).cognitionMemory.create({
        data: {
          businessId: input.businessId,
          userId: input.userId ?? null,
          roleId: input.roleId ?? null,
          functionId: input.functionId ?? null,
          sessionId: input.sessionId,
          query: input.query,
          recommendation: input.recommendation,
          userResponse: 'no_action',
          confidence: input.confidence,
          confidenceDelta: 0,
          lessonsLearned: [],
          metadata: input.metadata ?? {},
        },
      });

      this.logger.debug(
        `[recordObservation] Created cognition memory for session ${input.sessionId}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[recordObservation] Failed: ${msg}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // D.3 — Explicit feedback recording
  // ═══════════════════════════════════════════════════════════

  async recordFeedback(input: RecordFeedbackInput): Promise<void> {
    try {
      const existing = await (this.prisma.client as any).cognitionMemory.findFirst({
        where: { sessionId: input.sessionId },
        orderBy: { createdAt: 'desc' },
      });

      const lessons = await this.extractLessons(
        existing?.query ?? '',
        existing?.recommendation ?? '',
        input.userResponse,
        input.actualOutcome,
      );

      const confidenceDelta = this.computeConfidenceDelta(
        existing?.confidence ?? 0.7,
        input.userResponse,
      );

      if (existing) {
        await (this.prisma.client as any).cognitionMemory.update({
          where: { id: existing.id },
          data: {
            userResponse: input.userResponse,
            actualOutcome: input.actualOutcome ?? null,
            lessonsLearned: lessons,
            confidenceDelta,
            metadata: {
              ...(existing.metadata as Record<string, unknown>),
              ...(input.metadata ?? {}),
              feedbackAt: new Date().toISOString(),
            },
          },
        });
      } else {
        await (this.prisma.client as any).cognitionMemory.create({
          data: {
            businessId: input.businessId,
            userId: input.userId ?? null,
            sessionId: input.sessionId,
            query: '',
            recommendation: '',
            userResponse: input.userResponse,
            actualOutcome: input.actualOutcome ?? null,
            confidence: 0.7,
            confidenceDelta,
            lessonsLearned: lessons,
            metadata: input.metadata ?? {},
          },
        });
      }

      await this.persistOutcomeLogs(input, lessons, confidenceDelta);

      this.logger.debug(
        `[recordFeedback] Recorded ${input.userResponse} feedback for session ${input.sessionId}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[recordFeedback] Failed: ${msg}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // D.3 — Retrieve relevant past lessons
  // ═══════════════════════════════════════════════════════════

  async retrieveLessons(
    businessId: string,
    query: string,
    options: { roleId?: string; functionId?: string; limit?: number } = {},
  ): Promise<string[]> {
    try {
      const limit = options.limit ?? 5;

      const memories = await (this.prisma.client as any).cognitionMemory.findMany({
        where: {
          businessId,
          ...(options.roleId ? { roleId: options.roleId } : {}),
          ...(options.functionId ? { functionId: options.functionId } : {}),
          lessonsLearned: { isEmpty: false },
        },
        orderBy: { createdAt: 'desc' },
        take: limit * 3,
      });

      // Simple keyword relevance: prefer memories whose query/recommendation shares words with current query
      const queryWords = new Set(
        query.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
      );

      const scored = memories
        .map((m: any) => {
          const text = `${m.query} ${m.recommendation}`.toLowerCase();
          const matches = Array.from(queryWords).filter((w) => text.includes(w)).length;
          return { memory: m, score: matches };
        })
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, limit);

      return scored.flatMap((item: any) =>
        (item.memory.lessonsLearned as string[]).map(
          (lesson: string) => `[${item.memory.userResponse}] ${lesson}`,
        ),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[retrieveLessons] Failed: ${msg}`);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════
  // D.4 — Acceptance rate per role / function
  // ═══════════════════════════════════════════════════════════

  async getAcceptanceRate(
    businessId: string,
    options: { roleId?: string; functionId?: string } = {},
  ): Promise<AcceptanceRate> {
    try {
      const where = {
        businessId,
        ...(options.roleId ? { roleId: options.roleId } : {}),
        ...(options.functionId ? { functionId: options.functionId } : {}),
        userResponse: { not: 'no_action' },
      };

      const [accepted, rejected, modified, total] = await Promise.all([
        (this.prisma.client as any).cognitionMemory.count({
          where: { ...where, userResponse: 'accepted' },
        }),
        (this.prisma.client as any).cognitionMemory.count({
          where: { ...where, userResponse: 'rejected' },
        }),
        (this.prisma.client as any).cognitionMemory.count({
          where: { ...where, userResponse: 'modified' },
        }),
        (this.prisma.client as any).cognitionMemory.count({ where }),
      ]);

      const rate = total > 0 ? accepted / total : 0;
      return { accepted, rejected, modified, total, rate };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[getAcceptanceRate] Failed: ${msg}`);
      return { accepted: 0, rejected: 0, modified: 0, total: 0, rate: 0 };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // D.4 — Confidence calibration
  // ═══════════════════════════════════════════════════════════

  async calibrateConfidence(
    statedConfidence: number,
    businessId: string,
    options: { roleId?: string; functionId?: string; minSamples?: number } = {},
  ): Promise<{ calibrated: number; gap: number; reliable: boolean; knowledgeGap?: string }> {
    const minSamples = options.minSamples ?? 5;
    const rate = await this.getAcceptanceRate(businessId, options);

    if (rate.total < minSamples) {
      return {
        calibrated: statedConfidence,
        gap: 0,
        reliable: false,
        knowledgeGap: 'Insufficient historical feedback to calibrate confidence.',
      };
    }

    // Calibrated confidence = weighted average of stated confidence and historical acceptance rate
    // Weight shifts toward historical data as sample size grows
    const historicalWeight = Math.min(0.7, rate.total / (rate.total + 10));
    const calibrated =
      statedConfidence * (1 - historicalWeight) + rate.rate * historicalWeight;

    const gap = statedConfidence - calibrated;
    const reliable = rate.total >= minSamples;

    let knowledgeGap: string | undefined;
    if (gap > 0.2) {
      knowledgeGap = `Stated confidence (${Math.round(statedConfidence * 100)}%) is higher than observed acceptance rate (${Math.round(rate.rate * 100)}%). Consider a human expert.`;
    } else if (rate.rate < 0.4) {
      knowledgeGap = `Historical acceptance rate is low (${Math.round(rate.rate * 100)}%). I may be misaligned with your preferences.`;
    }

    return {
      calibrated: Math.max(0, Math.min(1, calibrated)),
      gap,
      reliable,
      knowledgeGap,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Private helpers
  // ═══════════════════════════════════════════════════════════

  private async extractLessons(
    query: string,
    recommendation: string,
    userResponse: UserResponse,
    actualOutcome?: string,
  ): Promise<string[]> {
    // Attempt LLM-based lesson extraction if gateway is available
    if (this.modelGateway) {
      try {
        const prompt = this.buildLessonPrompt(query, recommendation, userResponse, actualOutcome);
        const result = await (this.modelGateway as any).complete(prompt, {
          model: 'gpt-4o-mini',
          maxTokens: 300,
          temperature: 0.3,
        });
        const text = (result as any).text ?? '';
        const lessons = text
          .split('\n')
          .map((line: string) => line.replace(/^[-\d.\s]+/, '').trim())
          .filter((line: string) => line.length > 10 && line.length < 300);
        if (lessons.length > 0) return lessons.slice(0, 3);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[extractLessons] LLM extraction failed: ${msg}`);
      }
    }

    // Rule-based fallback
    const lessons: string[] = [];
    if (userResponse === 'rejected') {
      lessons.push(`Recommendation was rejected. Re-evaluate approach for similar queries.`);
    } else if (userResponse === 'modified') {
      lessons.push(`User modified the recommendation. Capture preferences for future alignment.`);
    } else if (userResponse === 'accepted') {
      lessons.push(`Recommendation accepted. Reinforce similar reasoning for comparable queries.`);
    }

    if (actualOutcome && actualOutcome.toLowerCase().includes('failed')) {
      lessons.push(`Outcome did not match expectation: ${actualOutcome}`);
    }

    return lessons.slice(0, 3);
  }

  private buildLessonPrompt(
    query: string,
    recommendation: string,
    userResponse: UserResponse,
    actualOutcome?: string,
  ): string {
    return `You are a learning assistant for an AI business advisor. Given a user query, the AI's recommendation, the user's response, and the actual outcome, extract 1-3 concise lessons learned that will improve future recommendations.

Query: ${query}
Recommendation: ${recommendation}
User response: ${userResponse}
Actual outcome: ${actualOutcome ?? 'unknown'}

Return only the lessons, one per line, no numbering, no preamble.`;
  }

  private computeConfidenceDelta(
    originalConfidence: number,
    userResponse: UserResponse,
  ): number {
    switch (userResponse) {
      case 'accepted':
        return Math.max(0, 1 - originalConfidence);
      case 'rejected':
        return -originalConfidence;
      case 'modified':
        return -0.2;
      case 'no_action':
      default:
        return 0;
    }
  }

  private async persistOutcomeLogs(
    input: RecordFeedbackInput,
    lessons: string[],
    confidenceDelta: number,
  ): Promise<void> {
    // GenomeRecommendationOutcome
    try {
      await (this.prisma.client as any).genomeRecommendationOutcome.create({
        data: {
          businessId: input.businessId,
          recommendationId: input.recommendationId ?? input.sessionId,
          domain: input.functionId ?? 'general',
          actionType: 'key_cortex_recommendation',
          decision: input.userResponse.toUpperCase() as any,
          decidedBy: input.userId ?? null,
          dismissalReason: input.dismissalReason ?? null,
          preConfidence: 0.7,
          impactScore: this.impactScoreFromResponse(input.userResponse),
          impactEvidence: lessons,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[persistOutcomeLogs] GenomeRecommendationOutcome failed: ${msg}`);
    }

    // KeyEvolutionLog
    try {
      await (this.prisma.client as any).keyEvolutionLog.create({
        data: {
          businessId: input.businessId,
          userId: input.userId ?? 'system',
          query: '',
          recommendation: '',
          recommendationType: input.functionId ?? 'general',
          userAction: input.userResponse,
          outcome: input.actualOutcome ?? null,
          outcomeValue: confidenceDelta,
          metadata: input.metadata ?? {},
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[persistOutcomeLogs] KeyEvolutionLog failed: ${msg}`);
    }
  }

  private impactScoreFromResponse(response: UserResponse): number {
    switch (response) {
      case 'accepted':
        return 1;
      case 'modified':
        return 0.5;
      case 'rejected':
        return -0.5;
      case 'no_action':
      default:
        return 0;
    }
  }
}
