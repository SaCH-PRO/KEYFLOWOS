import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import { ModelGatewayService } from '../ai/model-gateway.service';
import { AiUsageService } from '../ai/ai-usage.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InteractionPayload {
  query: string;
  recommendation: string;
  recommendationType: string;
  userAction: 'accepted' | 'rejected' | 'ignored';
  outcome?: string;
  outcomeValue?: number;
  metadata?: Record<string, unknown>;
}

export interface UserPreferenceProfile {
  userId: string;
  businessId: string;
  responseLength: 'short' | 'medium' | 'long';
  preferredTone: string;
  activeRecommendationTypes: string[];
  ignoredRecommendationTypes: string[];
  peakActivityHours: number[];
  preferredCommunicationStyle: string;
  acceptanceRate: number;
  totalInteractions: number;
  lastUpdated: Date;
}

export interface DetectedPattern {
  id: string;
  type: 'revenue' | 'conversion' | 'support' | 'engagement' | 'anomaly';
  description: string;
  confidence: number;
  dataPoints: number;
  timeRange: { start: Date; end: Date };
  recommendation?: string;
  severity?: 'low' | 'medium' | 'high';
}

export interface TuningReport {
  businessId: string;
  tunedAt: Date;
  adjustments: Array<{
    parameter: string;
    oldValue: unknown;
    newValue: unknown;
    reason: string;
  }>;
  summary: string;
}

export interface LearningReport {
  businessId: string;
  weekOf: string;
  narrative: string;
  stats: {
    newThingsLearned: number;
    recommendationAcceptanceRate: number;
    previousAcceptanceRate: number;
    newPatternsDetected: number;
    adjustmentsMade: number;
    totalInteractions: number;
  };
  patterns: DetectedPattern[];
  highlights: string[];
}

export interface DecisionExplanation {
  decisionId: string;
  timestamp: Date;
  recommendation: string;
  reasoning: string;
  dataUsed: Array<{ source: string; value: string }>;
  patternsConsidered: string[];
  confidence: number;
  alternativeRecommendations: string[];
}

// ---------------------------------------------------------------------------
// KeyCortexEvolutionService
// ---------------------------------------------------------------------------

/**
 * KeyCortexEvolutionService — KEY's self-evolution and learning engine.
 *
 * Responsibilities:
 * - Track every KEY interaction (queries, recommendations, outcomes)
 * - Learn user preferences from interaction history
 * - Detect business patterns using AI-driven time-series analysis
 * - Self-tune KEY's behavior based on learned insights
 * - Generate weekly learning reports
 * - Explain individual recommendation decisions
 *
 * This is the "neuroplasticity" layer of KEY — it ensures the system
 * gets smarter, more personalised, and more accurate over time.
 */
@Injectable()
export class KeyCortexEvolutionService {
  private readonly logger = new Logger(KeyCortexEvolutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly gateway: ModelGatewayService,
    private readonly aiUsage: AiUsageService,
  ) {}

  // ========================================================================
  // 1. Interaction Tracking
  // ========================================================================

  /**
   * Track every KEY interaction in the evolution log.
   * Records what was asked, what KEY recommended, whether the user
   * acted on it, and what the outcome was.
   *
   * @param interaction  The interaction payload
   * @param businessId   Tenant-scoped business identifier
   * @param userId       The user who interacted with KEY
   * @returns            The created evolution log entry
   */
  async trackInteraction(
    interaction: InteractionPayload,
    businessId: string,
    userId: string,
  ): Promise<{
    id: string;
    query: string;
    recommendation: string;
    userAction: string;
    outcome: string | null;
    createdAt: Date;
  }> {
    this.logger.debug(
      `Tracking interaction: user=${userId}, action=${interaction.userAction}, type=${interaction.recommendationType}`,
    );

    const entry = await this.prisma.client.keyEvolutionLog.create({
      data: {
        businessId,
        userId,
        query: interaction.query,
        recommendation: interaction.recommendation,
        recommendationType: interaction.recommendationType,
        userAction: interaction.userAction,
        outcome: interaction.outcome ?? null,
        outcomeValue: interaction.outcomeValue ?? null,
        metadata: interaction.metadata ? JSON.stringify(interaction.metadata) : null,
      },
    });

    // Update real-time interaction counters in Redis
    const redisKey = `evolution:interactions:${businessId}:${userId}`;
    const existing = await this.redis.getJson<{ count: number; lastAction: string }>(redisKey);
    await this.redis.setJson(
      redisKey,
      {
        count: (existing?.count ?? 0) + 1,
        lastAction: interaction.userAction,
        lastRecommendationType: interaction.recommendationType,
        updatedAt: new Date().toISOString(),
      },
      86400, // TTL: 24 hours
    );

    // Invalidate cached preference profile so it will be recomputed
    await this.redis.del(`evolution:preferences:${businessId}:${userId}`);

    this.logger.debug(
      `Interaction logged: id=${entry.id}, userAction=${entry.userAction}`,
    );

    return {
      id: entry.id,
      query: entry.query,
      recommendation: entry.recommendation,
      userAction: entry.userAction,
      outcome: entry.outcome,
      createdAt: entry.createdAt,
    };
  }

  // ========================================================================
  // 2. Preference Learning
  // ========================================================================

  /**
   * Analyse a user's interaction history and extract their preference profile.
   * Detects response-length preference, recommendation-type affinities,
   * peak activity times, and communication style.
   *
   * Results are cached in Redis and persisted in Prisma.
   *
   * @param businessId  Tenant-scoped business identifier
   * @param userId      The user to learn preferences for
   * @returns           The computed preference profile
   */
  async learnPreferences(
    businessId: string,
    userId: string,
  ): Promise<UserPreferenceProfile> {
    // Check Redis cache first
    const cacheKey = `evolution:preferences:${businessId}:${userId}`;
    const cached = await this.redis.getJson<UserPreferenceProfile>(cacheKey);
    if (cached) {
      this.logger.debug(`Preference profile cache hit for user=${userId}`);
      return cached;
    }

    this.logger.debug(`Learning preferences for user=${userId}, business=${businessId}`);

    // Pull the last 90 days of interactions for this user
    const since = new Date();
    since.setDate(since.getDate() - 90);

    const interactions = await this.prisma.client.keyEvolutionLog.findMany({
      where: {
        businessId,
        userId,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    if (interactions.length === 0) {
      this.logger.debug(`No interactions found for user=${userId}, returning defaults`);
      const defaultProfile: UserPreferenceProfile = {
        userId,
        businessId,
        responseLength: 'medium',
        preferredTone: 'professional',
        activeRecommendationTypes: [],
        ignoredRecommendationTypes: [],
        peakActivityHours: [9, 10, 11, 14, 15, 16],
        preferredCommunicationStyle: 'concise',
        acceptanceRate: 0,
        totalInteractions: 0,
        lastUpdated: new Date(),
      };
      await this.persistPreferenceProfile(defaultProfile);
      await this.redis.setJson(cacheKey, defaultProfile, 3600);
      return defaultProfile;
    }

    // Use AI to analyse interaction patterns and extract preferences
    const analysisPrompt = this.buildPreferenceAnalysisPrompt(interactions);

    const response = await this.gateway.complete({
      businessId,
      taskCategory: 'analysis',
      messages: [
        {
          role: 'system',
          content:
            'You are a user-preference analyst. Analyse the interaction history and extract a structured preference profile. Respond ONLY with valid JSON.',
        },
        { role: 'user', content: analysisPrompt },
      ],
      maxTokens: 800,
      temperature: 0.3,
    });

    const aiProfile = this.safeParseJson<{
      responseLength?: 'short' | 'medium' | 'long';
      preferredTone?: string;
      activeRecommendationTypes?: string[];
      ignoredRecommendationTypes?: string[];
      peakActivityHours?: number[];
      preferredCommunicationStyle?: string;
    }>(response.content ?? '{}');

    // Compute acceptance rate from raw data
    const acceptedCount = interactions.filter((i) => i.userAction === 'accepted').length;
    const totalWithAction = interactions.filter((i) => i.userAction !== 'ignored').length;
    const acceptanceRate = totalWithAction > 0 ? acceptedCount / totalWithAction : 0;

    // Derive peak activity hours from interaction timestamps
    const hourCounts = new Array(24).fill(0);
    for (const interaction of interactions) {
      const hour = new Date(interaction.createdAt).getHours();
      hourCounts[hour]++;
    }
    const peakHours = hourCounts
      .map((count, hour) => ({ count, hour }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
      .map((h) => h.hour)
      .sort((a, b) => a - b);

    // Derive recommendation-type affinities
    const typeStats: Record<string, { accepted: number; rejected: number; ignored: number }> = {};
    for (const interaction of interactions) {
      const type = interaction.recommendationType;
      if (!typeStats[type]) {
        typeStats[type] = { accepted: 0, rejected: 0, ignored: 0 };
      }
      typeStats[type][interaction.userAction as 'accepted' | 'rejected' | 'ignored']++;
    }

    const activeTypes = Object.entries(typeStats)
      .filter(([, stats]) => stats.accepted > stats.rejected)
      .map(([type]) => type);

    const ignoredTypes = Object.entries(typeStats)
      .filter(([, stats]) => stats.ignored > stats.accepted + stats.rejected)
      .map(([type]) => type);

    const profile: UserPreferenceProfile = {
      userId,
      businessId,
      responseLength: aiProfile.responseLength ?? 'medium',
      preferredTone: aiProfile.preferredTone ?? 'professional',
      activeRecommendationTypes: activeTypes.length > 0 ? activeTypes : Object.keys(typeStats),
      ignoredRecommendationTypes: ignoredTypes,
      peakActivityHours: peakHours.length > 0 ? peakHours : [9, 10, 11, 14, 15, 16],
      preferredCommunicationStyle: aiProfile.preferredCommunicationStyle ?? 'concise',
      acceptanceRate: Math.round(acceptanceRate * 100) / 100,
      totalInteractions: interactions.length,
      lastUpdated: new Date(),
    };

    // Persist to Prisma and cache in Redis
    await this.persistPreferenceProfile(profile);
    await this.redis.setJson(cacheKey, profile, 3600);

    this.logger.log(
      `Preference profile learned for user=${userId}: ${profile.totalInteractions} interactions, ${Math.round(profile.acceptanceRate * 100)}% acceptance`,
    );

    return profile;
  }

  // ========================================================================
  // 3. Pattern Detection
  // ========================================================================

  /**
   * Scan business activity over time and detect patterns using AI.
   * Detects revenue peaks, conversion drops, support ticket spikes,
   * and other business-relevant patterns.
   *
   * @param businessId  Tenant-scoped business identifier
   * @returns           Array of detected patterns with confidence scores
   */
  async detectPatterns(businessId: string): Promise<DetectedPattern[]> {
    this.logger.debug(`Detecting patterns for business=${businessId}`);

    // Gather the last 90 days of evolution logs
    const since = new Date();
    since.setDate(since.getDate() - 90);

    const interactions = await this.prisma.client.keyEvolutionLog.findMany({
      where: {
        businessId,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'asc' },
      take: 1000,
    });

    // Gather business activity data from related tables
    const [
      invoiceTrends,
      contactTrends,
      supportTrends,
    ] = await Promise.all([
      this.getInvoiceTrends(businessId, since),
      this.getContactTrends(businessId, since),
      this.getSupportTrends(businessId, since),
    ]);

    // Build the pattern-detection prompt with time-series data
    const timeSeriesData = this.buildTimeSeriesPayload(
      interactions,
      invoiceTrends,
      contactTrends,
      supportTrends,
    );

    const response = await this.gateway.complete({
      businessId,
      taskCategory: 'analysis',
      messages: [
        {
          role: 'system',
          content: `You are a business-pattern detection engine. Analyse the provided time-series data and detect meaningful business patterns.

Respond ONLY with a JSON array of patterns in this exact shape:
[
  {
    "type": "revenue" | "conversion" | "support" | "engagement" | "anomaly",
    "description": "Human-readable pattern description (e.g., 'Revenue peaks on Thursdays')",
    "confidence": 0.0-1.0,
    "dataPoints": number,
    "recommendation": "What KEY should do about this pattern",
    "severity": "low" | "medium" | "high"
  }
]`,
        },
        { role: 'user', content: timeSeriesData },
      ],
      maxTokens: 1500,
      temperature: 0.4,
    });

    const rawPatterns = this.safeParseJson<DetectedPattern[]>(response.content ?? '[]');

    // Assign stable IDs and validate
    const patterns: DetectedPattern[] = rawPatterns.map((p, idx) => ({
      ...p,
      id: `pattern-${businessId}-${Date.now()}-${idx}`,
      timeRange: { start: since, end: new Date() },
      confidence: Math.max(0, Math.min(1, p.confidence ?? 0.5)),
      dataPoints: p.dataPoints ?? interactions.length,
    }));

    // Cache detected patterns in Redis
    await this.redis.setJson(
      `evolution:patterns:${businessId}`,
      patterns,
      86400,
    );

    this.logger.log(
      `Detected ${patterns.length} patterns for business=${businessId}`,
    );

    return patterns;
  }

  // ========================================================================
  // 4. Self-Tuning
  // ========================================================================

  /**
   * Based on learned preferences and detected patterns, adjust KEY's
   * behaviour for a specific business. Modifies personality, response
   * length, recommendation types, and proactive notification frequency.
   *
   * All tuning decisions are logged.
   *
   * @param businessId  Tenant-scoped business identifier
   * @returns           A report of all adjustments made
   */
  async selfTune(businessId: string): Promise<TuningReport> {
    this.logger.log(`Starting self-tuning for business=${businessId}`);

    // Gather inputs
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const interactions = await this.prisma.client.keyEvolutionLog.findMany({
      where: {
        businessId,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const patterns = await this.detectPatterns(businessId);

    // Pull current AI preferences
    const currentPreferences = await this.gateway.getPreferences(businessId);

    // Use AI to decide what tuning adjustments to make
    const tuningPrompt = this.buildTuningPrompt(interactions, patterns, currentPreferences);

    const response = await this.gateway.complete({
      businessId,
      taskCategory: 'analysis',
      messages: [
        {
          role: 'system',
          content: `You are KEY's self-tuning engine. Based on interaction history, detected patterns, and current preferences, decide what adjustments to make to KEY's behaviour.

Respond ONLY with a JSON object in this exact shape:
{
  "adjustments": [
    {
      "parameter": "personality_tone | response_length | recommendation_types | proactive_frequency | ai_mode | writing_style",
      "oldValue": "current value",
      "newValue": "recommended value",
      "reason": "Why this change is recommended"
    }
  ],
  "summary": "Brief summary of all tuning decisions"
}`,
        },
        { role: 'user', content: tuningPrompt },
      ],
      maxTokens: 1200,
      temperature: 0.3,
    });

    const tuningResult = this.safeParseJson<{
      adjustments: Array<{
        parameter: string;
        oldValue: unknown;
        newValue: unknown;
        reason: string;
      }>;
      summary: string;
    }>(response.content ?? '{"adjustments":[],"summary":"No adjustments needed"}');

    // Apply the adjustments
    const adjustments = tuningResult.adjustments ?? [];

    for (const adj of adjustments) {
      try {
        await this.applyTuningAdjustment(businessId, adj);
      } catch (err) {
        this.logger.warn(
          `Failed to apply tuning adjustment ${adj.parameter}: ${(err as Error).message}`,
        );
      }
    }

    // Persist the tuning report
    const report: TuningReport = {
      businessId,
      tunedAt: new Date(),
      adjustments: adjustments.map((adj) => ({
        parameter: adj.parameter,
        oldValue: adj.oldValue ?? 'unknown',
        newValue: adj.newValue ?? 'unknown',
        reason: adj.reason ?? 'No reason provided',
      })),
      summary: tuningResult.summary ?? 'Tuning completed with no significant changes.',
    };

    await this.prisma.client.keyTuningLog.create({
      data: {
        businessId,
        adjustments: JSON.stringify(report.adjustments),
        summary: report.summary,
      },
    });

    // Cache the latest tuning report
    await this.redis.setJson(
      `evolution:tuning:${businessId}`,
      report,
      86400,
    );

    this.logger.log(
      `Self-tuning complete for business=${businessId}: ${report.adjustments.length} adjustments made`,
    );

    return report;
  }

  // ========================================================================
  // 5. Learning Report Generation
  // ========================================================================

  /**
   * Generate a weekly learning report for a business.
   * Creates a narrative like "I learned 12 new things about your
   * business this week" with stats, patterns, and highlights.
   *
   * @param businessId  Tenant-scoped business identifier
   * @returns           Structured weekly learning report
   */
  async generateLearningReport(businessId: string): Promise<LearningReport> {
    this.logger.debug(`Generating learning report for business=${businessId}`);

    // Define the current week range (Monday to Sunday)
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - daysSinceMonday);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const weekOf = weekStart.toISOString().split('T')[0];

    // Check cache
    const cacheKey = `evolution:report:${businessId}:${weekOf}`;
    const cached = await this.redis.getJson<LearningReport>(cacheKey);
    if (cached) {
      return cached;
    }

    // Gather this week's interactions
    const thisWeekInteractions = await this.prisma.client.keyEvolutionLog.findMany({
      where: {
        businessId,
        createdAt: { gte: weekStart, lte: weekEnd },
      },
    });

    // Gather last week's interactions for comparison
    const lastWeekStart = new Date(weekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const lastWeekEnd = new Date(weekEnd);
    lastWeekEnd.setDate(lastWeekEnd.getDate() - 7);

    const lastWeekInteractions = await this.prisma.client.keyEvolutionLog.findMany({
      where: {
        businessId,
        createdAt: { gte: lastWeekStart, lte: lastWeekEnd },
      },
    });

    // Compute stats
    const thisWeekAccepted = thisWeekInteractions.filter((i) => i.userAction === 'accepted').length;
    const thisWeekTotal = thisWeekInteractions.filter((i) => i.userAction !== 'ignored').length;
    const thisWeekRate = thisWeekTotal > 0 ? thisWeekAccepted / thisWeekTotal : 0;

    const lastWeekAccepted = lastWeekInteractions.filter((i) => i.userAction === 'accepted').length;
    const lastWeekTotal = lastWeekInteractions.filter((i) => i.userAction !== 'ignored').length;
    const lastWeekRate = lastWeekTotal > 0 ? lastWeekAccepted / lastWeekTotal : 0;

    const newPatterns = await this.detectPatterns(businessId);
    const recentPatterns = newPatterns.filter(
      (p) => p.confidence > 0.7 && p.severity !== 'low',
    );

    // Pull tuning history for the week
    const tuningLogs = await this.prisma.client.keyTuningLog.findMany({
      where: {
        businessId,
        createdAt: { gte: weekStart, lte: weekEnd },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const totalAdjustments = tuningLogs.reduce(
      (sum, log) => {
        try {
          const adj = JSON.parse(log.adjustments);
          return sum + (Array.isArray(adj) ? adj.length : 0);
        } catch {
          return sum;
        }
      },
      0,
    );

    // Use AI to generate a narrative
    const narrativePrompt = `Generate a friendly, first-person weekly learning report for an AI assistant named KEY.

Week of ${weekOf}

Stats:
- Total interactions this week: ${thisWeekInteractions.length}
- Recommendation acceptance rate this week: ${Math.round(thisWeekRate * 100)}%
- Acceptance rate last week: ${Math.round(lastWeekRate * 100)}%
- New patterns detected: ${recentPatterns.length}
- Behaviour adjustments made: ${totalAdjustments}

Patterns detected:
${recentPatterns.map((p) => `- ${p.description} (confidence: ${Math.round(p.confidence * 100)}%)`).join('\n')}

Write 3-4 engaging paragraphs as if KEY is speaking directly to the business owner. Be warm, insightful, and specific. Mention concrete improvements.`;

    const narrativeResponse = await this.gateway.complete({
      businessId,
      taskCategory: 'content-generation',
      messages: [
        {
          role: 'system',
          content:
            'You are KEY, an AI business partner. Write a warm, engaging weekly learning report in first person. Be specific, insightful, and concise.',
        },
        { role: 'user', content: narrativePrompt },
      ],
      maxTokens: 800,
      temperature: 0.7,
    });

    const narrative =
      narrativeResponse.content?.trim() ??
      `This week I processed ${thisWeekInteractions.length} interactions. Your recommendation acceptance rate is ${Math.round(thisWeekRate * 100)}%. I detected ${recentPatterns.length} new patterns and made ${totalAdjustments} adjustments to improve my recommendations.`;

    // Build highlights
    const highlights: string[] = [];
    if (thisWeekRate > lastWeekRate) {
      highlights.push(
        `Recommendation acceptance rate improved from ${Math.round(lastWeekRate * 100)}% to ${Math.round(thisWeekRate * 100)}%`,
      );
    }
    if (recentPatterns.length > 0) {
      highlights.push(`Detected ${recentPatterns.length} new business patterns`);
    }
    if (totalAdjustments > 0) {
      highlights.push(`Made ${totalAdjustments} self-tuning adjustments`);
    }
    if (thisWeekInteractions.length > 0) {
      highlights.push(`Processed ${thisWeekInteractions.length} interactions this week`);
    }

    const report: LearningReport = {
      businessId,
      weekOf,
      narrative,
      stats: {
        newThingsLearned: thisWeekInteractions.length,
        recommendationAcceptanceRate: Math.round(thisWeekRate * 100) / 100,
        previousAcceptanceRate: Math.round(lastWeekRate * 100) / 100,
        newPatternsDetected: recentPatterns.length,
        adjustmentsMade: totalAdjustments,
        totalInteractions: thisWeekInteractions.length,
      },
      patterns: recentPatterns,
      highlights,
    };

    // Cache the report
    await this.redis.setJson(cacheKey, report, 604800); // TTL: 7 days

    this.logger.log(`Learning report generated for business=${businessId}, weekOf=${weekOf}`);

    return report;
  }

  // ========================================================================
  // 6. Decision Explanation
  // ========================================================================

  /**
   * Given a decision ID (evolution log entry), explain why KEY made
   * that recommendation. Shows the data, patterns, and reasoning
   * that led to the decision.
   *
   * @param decisionId  The keyEvolutionLog entry ID
   * @returns           Human-readable explanation of the decision
   */
  async explainDecision(decisionId: string): Promise<DecisionExplanation> {
    this.logger.debug(`Explaining decision: ${decisionId}`);

    // Fetch the decision record
    const decision = await this.prisma.client.keyEvolutionLog.findUnique({
      where: { id: decisionId },
    });

    if (!decision) {
      throw new Error(`Decision not found: ${decisionId}`);
    }

    // Gather related context
    const relatedDecisions = await this.prisma.client.keyEvolutionLog.findMany({
      where: {
        businessId: decision.businessId,
        userId: decision.userId,
        recommendationType: decision.recommendationType,
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Fetch detected patterns for this business
    const patterns = await this.redis.getJson<DetectedPattern[]>(
      `evolution:patterns:${decision.businessId}`,
    );

    const relevantPatterns =
      patterns?.filter((p) =>
        decision.recommendation.toLowerCase().includes(p.type),
      ) ?? [];

    // Use AI to generate a human-readable explanation
    const explanationResponse = await this.gateway.complete({
      businessId: decision.businessId,
      taskCategory: 'reasoning',
      messages: [
        {
          role: 'system',
          content: `You are KEY's decision-explanation engine. Given a recommendation, explain clearly and concisely why it was made. Be transparent about the data and reasoning. Respond ONLY with valid JSON in this exact shape:
{
  "reasoning": "Clear 2-3 sentence explanation of why this recommendation was made",
  "dataUsed": [
    { "source": "source name", "value": "relevant data point" }
  ],
  "patternsConsidered": ["pattern descriptions"],
  "confidence": 0.0-1.0,
  "alternativeRecommendations": ["what else could have been recommended"]
}`,
        },
        {
          role: 'user',
          content: `Decision to explain:
- User query: "${decision.query}"
- Recommendation: "${decision.recommendation}"
- Recommendation type: ${decision.recommendationType}
- User action: ${decision.userAction}
- Outcome: ${decision.outcome ?? 'N/A'}

Related context (${relatedDecisions.length} similar decisions in last 30 days):
${relatedDecisions.map((d) => `- ${d.query} -> ${d.userAction}`).join('\n')}

Relevant patterns:
${relevantPatterns.map((p) => `- ${p.description} (${p.type}, confidence: ${Math.round(p.confidence * 100)}%)`).join('\n') || 'None cached'}`,
        },
      ],
      maxTokens: 800,
      temperature: 0.4,
    });

    const explanation = this.safeParseJson<{
      reasoning: string;
      dataUsed: Array<{ source: string; value: string }>;
      patternsConsidered: string[];
      confidence: number;
      alternativeRecommendations: string[];
    }>(explanationResponse.content ?? '{}');

    const result: DecisionExplanation = {
      decisionId,
      timestamp: decision.createdAt,
      recommendation: decision.recommendation,
      reasoning:
        explanation.reasoning ??
        `KEY recommended "${decision.recommendation}" in response to "${decision.query}" based on historical patterns for ${decision.recommendationType} recommendations.`,
      dataUsed: explanation.dataUsed ?? [
        { source: 'interaction_history', value: `${relatedDecisions.length} similar decisions` },
      ],
      patternsConsidered: explanation.patternsConsidered ??
        relevantPatterns.map((p) => p.description),
      confidence: Math.max(0, Math.min(1, explanation.confidence ?? 0.7)),
      alternativeRecommendations: explanation.alternativeRecommendations ?? [],
    };

    this.logger.debug(`Decision explanation generated for ${decisionId}`);

    return result;
  }

  // ========================================================================
  // Private Helpers
  // ========================================================================

  /**
   * Persist a preference profile to Prisma.
   */
  private async persistPreferenceProfile(
    profile: UserPreferenceProfile,
  ): Promise<void> {
    await this.prisma.client.keyUserPreferences.upsert({
      where: {
        businessId_userId: {
          businessId: profile.businessId,
          userId: profile.userId,
        },
      },
      create: {
        businessId: profile.businessId,
        userId: profile.userId,
        responseLength: profile.responseLength,
        preferredTone: profile.preferredTone,
        activeRecommendationTypes: JSON.stringify(profile.activeRecommendationTypes),
        ignoredRecommendationTypes: JSON.stringify(profile.ignoredRecommendationTypes),
        peakActivityHours: JSON.stringify(profile.peakActivityHours),
        preferredCommunicationStyle: profile.preferredCommunicationStyle,
        acceptanceRate: profile.acceptanceRate,
        totalInteractions: profile.totalInteractions,
      },
      update: {
        responseLength: profile.responseLength,
        preferredTone: profile.preferredTone,
        activeRecommendationTypes: JSON.stringify(profile.activeRecommendationTypes),
        ignoredRecommendationTypes: JSON.stringify(profile.ignoredRecommendationTypes),
        peakActivityHours: JSON.stringify(profile.peakActivityHours),
        preferredCommunicationStyle: profile.preferredCommunicationStyle,
        acceptanceRate: profile.acceptanceRate,
        totalInteractions: profile.totalInteractions,
        lastUpdated: new Date(),
      },
    });
  }

  /**
   * Apply a single tuning adjustment to KEY's behaviour.
   */
  private async applyTuningAdjustment(
    businessId: string,
    adj: { parameter: string; newValue: unknown },
  ): Promise<void> {
    switch (adj.parameter) {
      case 'ai_mode': {
        const validModes = ['balanced', 'premium', 'fast'];
        const mode = String(adj.newValue);
        if (validModes.includes(mode)) {
          const prefs = await this.gateway.getPreferences(businessId);
          await this.gateway.updatePreferences(businessId, {
            ...prefs,
            aiMode: mode as 'balanced' | 'premium' | 'fast',
          });
          this.logger.log(`Tuned ai_mode to "${mode}" for business=${businessId}`);
        }
        break;
      }

      case 'writing_style': {
        const style = String(adj.newValue);
        const prefs = await this.gateway.getPreferences(businessId);
        await this.gateway.updatePreferences(businessId, {
          ...prefs,
          preferredWritingStyle: style,
        });
        this.logger.log(`Tuned writing_style to "${style}" for business=${businessId}`);
        break;
      }

      case 'personality_tone':
      case 'response_length':
      case 'recommendation_types':
      case 'proactive_frequency': {
        // Store these in aiMemory as tuning-specific settings
        await this.prisma.client.aiMemory.upsert({
          where: {
            businessId_category_key: {
              businessId,
              category: 'evolution_tuning',
              key: adj.parameter,
            },
          },
          create: {
            businessId,
            category: 'evolution_tuning',
            key: adj.parameter,
            value: JSON.stringify(adj.newValue),
            source: 'key_self_tuning',
          },
          update: {
            value: JSON.stringify(adj.newValue),
            source: 'key_self_tuning',
          },
        });
        this.logger.log(
          `Tuned ${adj.parameter} to ${JSON.stringify(adj.newValue)} for business=${businessId}`,
        );
        break;
      }

      default: {
        this.logger.warn(`Unknown tuning parameter: ${adj.parameter}`);
      }
    }
  }

  /**
   * Build the AI prompt for preference analysis.
   */
  private buildPreferenceAnalysisPrompt(
    interactions: Array<{
      query: string;
      recommendation: string;
      recommendationType: string;
      userAction: string;
      createdAt: Date;
    }>,
  ): string {
    const summary = interactions
      .slice(0, 50)
      .map(
        (i) =>
          `- [${i.userAction}] ${i.recommendationType}: "${i.query.substring(0, 100)}" -> "${i.recommendation.substring(0, 100)}"`,
      )
      .join('\n');

    return `Analyse the following interaction history and extract the user's preference profile.

Interactions (most recent first):
${summary}

Based on these interactions, what is the user's preferred:
1. Response length (short / medium / long)
2. Communication tone (professional, casual, enthusiastic, direct, etc.)
3. Communication style (concise, detailed, bullet points, narrative, etc.)

Respond with ONLY a JSON object containing these fields.`;
  }

  /**
   * Build time-series data payload for pattern detection.
   */
  private buildTimeSeriesPayload(
    interactions: Array<{ userAction: string; recommendationType: string; createdAt: Date; outcomeValue: number | null }>,
    invoiceTrends: Array<{ date: string; count: number; total: number }>,
    contactTrends: Array<{ date: string; count: number }>,
    supportTrends: Array<{ date: string; count: number }>,
  ): string {
    // Aggregate interactions by day
    const dailyInteractions: Record<string, { accepted: number; rejected: number; ignored: number }> = {};
    for (const i of interactions) {
      const date = i.createdAt.toISOString().split('T')[0];
      if (!dailyInteractions[date]) {
        dailyInteractions[date] = { accepted: 0, rejected: 0, ignored: 0 };
      }
      dailyInteractions[date][i.userAction as 'accepted' | 'rejected' | 'ignored']++;
    }

    return `Business Activity Data (last 90 days):

## Daily Interaction Summary
${Object.entries(dailyInteractions)
      .map(([date, stats]) => `- ${date}: ${stats.accepted} accepted, ${stats.rejected} rejected, ${stats.ignored} ignored`)
      .join('\n')}

## Invoice Trends (by day)
${invoiceTrends.map((t) => `- ${t.date}: ${t.count} invoices, $${t.total} total`).join('\n')}

## Contact/Lead Trends (by day)
${contactTrends.map((t) => `- ${t.date}: ${t.count} new contacts`).join('\n')}

## Support Ticket Trends (by day)
${supportTrends.map((t) => `- ${t.date}: ${t.count} tickets`).join('\n')}

Analyse this data and detect all meaningful business patterns.`;
  }

  /**
   * Build the AI prompt for self-tuning decisions.
   */
  private buildTuningPrompt(
    interactions: Array<{ userAction: string; recommendationType: string; query: string }>,
    patterns: DetectedPattern[],
    currentPreferences: { aiMode?: string; preferredWritingStyle?: string },
  ): string {
    const actionSummary = {
      accepted: interactions.filter((i) => i.userAction === 'accepted').length,
      rejected: interactions.filter((i) => i.userAction === 'rejected').length,
      ignored: interactions.filter((i) => i.userAction === 'ignored').length,
    };

    const typeBreakdown: Record<string, { accepted: number; total: number }> = {};
    for (const i of interactions) {
      if (!typeBreakdown[i.recommendationType]) {
        typeBreakdown[i.recommendationType] = { accepted: 0, total: 0 };
      }
      typeBreakdown[i.recommendationType].total++;
      if (i.userAction === 'accepted') {
        typeBreakdown[i.recommendationType].accepted++;
      }
    }

    return `Current AI Preferences:
- AI Mode: ${currentPreferences.aiMode ?? 'balanced'}
- Writing Style: ${currentPreferences.preferredWritingStyle ?? 'default'}

Last 30 Days Activity:
- Total interactions: ${interactions.length}
- Accepted: ${actionSummary.accepted}, Rejected: ${actionSummary.rejected}, Ignored: ${actionSummary.ignored}

Recommendation Type Performance:
${Object.entries(typeBreakdown)
      .map(([type, stats]) => `- ${type}: ${Math.round((stats.accepted / stats.total) * 100)}% acceptance (${stats.accepted}/${stats.total})`)
      .join('\n')}

Detected Patterns:
${patterns.map((p) => `- [${p.severity ?? 'medium'}] ${p.description} (${Math.round(p.confidence * 100)}% confidence)`).join('\n')}

Based on this data, what adjustments should be made to KEY's behaviour?`;
  }

  /**
   * Get invoice creation trends by day.
   */
  private async getInvoiceTrends(
    businessId: string,
    since: Date,
  ): Promise<Array<{ date: string; count: number; total: number }>> {
    const invoices = await this.prisma.client.invoice.findMany({
      where: {
        businessId,
        createdAt: { gte: since },
      },
      select: {
        createdAt: true,
        total: true,
      },
    });

    const byDay: Record<string, { count: number; total: number }> = {};
    for (const inv of invoices) {
      const date = inv.createdAt.toISOString().split('T')[0];
      if (!byDay[date]) {
        byDay[date] = { count: 0, total: 0 };
      }
      byDay[date].count++;
      byDay[date].total += Number(inv.total) || 0;
    }

    return Object.entries(byDay)
      .map(([date, stats]) => ({ date, ...stats }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Get contact/lead creation trends by day.
   */
  private async getContactTrends(
    businessId: string,
    since: Date,
  ): Promise<Array<{ date: string; count: number }>> {
    const contacts = await this.prisma.client.contact.findMany({
      where: {
        businessId,
        createdAt: { gte: since },
      },
      select: { createdAt: true },
    });

    const byDay: Record<string, number> = {};
    for (const c of contacts) {
      const date = c.createdAt.toISOString().split('T')[0];
      byDay[date] = (byDay[date] ?? 0) + 1;
    }

    return Object.entries(byDay)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Get support ticket creation trends by day.
   */
  private async getSupportTrends(
    businessId: string,
    since: Date,
  ): Promise<Array<{ date: string; count: number }>> {
    try {
      const tickets = await this.prisma.client.helpdeskTicket.findMany({
        where: {
          businessId,
          createdAt: { gte: since },
        },
        select: { createdAt: true },
      });

      const byDay: Record<string, number> = {};
      for (const t of tickets) {
        const date = t.createdAt.toISOString().split('T')[0];
        byDay[date] = (byDay[date] ?? 0) + 1;
      }

      return Object.entries(byDay)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));
    } catch {
      // helpdeskTicket table may not exist in all deployments
      return [];
    }
  }

  /**
   * Safely parse JSON with a fallback value.
   */
  private safeParseJson<T>(json: string): T {
    try {
      return JSON.parse(json) as T;
    } catch {
      return {} as T;
    }
  }
}
