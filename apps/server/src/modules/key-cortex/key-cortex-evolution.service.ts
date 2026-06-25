import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import { ModelGatewayService } from '../ai/model-gateway.service';
import { AiUsageService } from '../ai/ai-usage.service';

// ── Genome Integration Layer v3 (optional — services may not exist yet) ──
import { KeyCortexGenomeBridgeService } from './key-cortex-genome-bridge.service';
import { KeyCortexEventService } from './key-cortex-event.service';

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

// ── v3 Types: Genome-Evolution Unified Report ──

export interface GenomeDnaChange {
  section: string;
  metric: string;
  previousValue: number;
  currentValue: number;
  changePercent: number;
  influencedBy: string;
  timestamp: Date;
}

export interface RecommendationOutcome {
  recommendationId: string;
  title: string;
  category: string;
  timesSuggested: number;
  timesAccepted: number;
  timesRejected: number;
  acceptanceRate: number;
  genomeCorrelation: number;
}

export interface UnifiedReport {
  businessId: string;
  generatedAt: Date;
  period: { start: Date; end: Date };
  keyPreferences: {
    responseLength: string;
    preferredTone: string;
    acceptanceRate: number;
    totalInteractions: number;
    activeRecommendationTypes: string[];
  };
  genomeDnaChanges: GenomeDnaChange[];
  recommendationOutcomes: RecommendationOutcome[];
  patternDetections: DetectedPattern[];
  keyHighlights: string[];
  narrative: string;
  syncStatus: {
    lastSyncAt: Date | null;
    genomeConnected: boolean;
    dnaSectionsSynced: number;
    signalsCreated: number;
  };
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
 * - Self-tune KEY's behaviour based on learned insights
 * - Generate weekly learning reports
 * - Explain individual recommendation decisions
 *
 * v3 GENOME-EVOLUTION MERGE:
 * - Sync KEY's learned preferences with genome DNA
 * - Report detected patterns to genome as signals
 * - Influence genome DNA based on KEY's observations
 * - Adapt KEY's behavior based on genome DNA scores
 * - Generate unified KEY+Genome learning reports
 * - Bidirectional learning loop between KEY and genome
 *
 * This is the "neuroplasticity" layer of KEY — it ensures the system
 * gets smarter, more personalised, and more accurate over time.
 * v3 makes it genome-aware, so KEY's learning feeds genome evolution
 * and genome evolution feeds KEY's adaptation.
 */
@Injectable()
export class KeyCortexEvolutionService {
  private readonly logger = new Logger(KeyCortexEvolutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly gateway: ModelGatewayService,
    private readonly aiUsage: AiUsageService,

    // ── v3 Genome Integration Layer (optional — graceful degradation) ──
    @Optional()
    @Inject(KeyCortexGenomeBridgeService)
    private readonly genomeBridgeService?: KeyCortexGenomeBridgeService,
    @Optional()
    @Inject(KeyCortexEventService)
    private readonly eventService?: KeyCortexEventService,
  ) {}

  // ========================================================================
  // 1. Interaction Tracking (preserved)
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
  // 2. Preference Learning (preserved)
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
  // 3. Pattern Detection (preserved)
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
  // 4. Self-Tuning (preserved)
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
  // 5. Learning Report Generation (preserved)
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
  // 6. Decision Explanation (preserved)
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
  // 7. v3 NEW METHODS — Genome-Evolution Integration
  // ========================================================================

  /**
   * Sync KEY's learned preferences and observations with the genome DNA system.
   *
   * Bidirectional sync:
   * 1. Push KEY's learned preferences to genome DNA (recommendation acceptance patterns)
   * 2. Pull genome DNA scores to influence KEY's recommendation weighting
   * 3. Create genome signals for significant patterns KEY detected
   * 4. Feed interaction outcomes to genome outcome learning
   *
   * @param businessId  The business ID to sync
   */
  async syncWithGenome(businessId: string): Promise<void> {
    if (!this.genomeBridgeService) {
      this.logger.warn(
        `[syncWithGenome] business=${businessId}: Genome bridge not available — skipping sync`,
      );
      return;
    }

    this.logger.log(`[syncWithGenome] Starting genome sync for business=${businessId}`);
    const syncStart = Date.now();

    try {
      // 1. Get KEY's latest preference profiles for all users
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

      // Compute aggregate acceptance rate by recommendation type
      const typeStats: Record<
        string,
        { accepted: number; rejected: number; ignored: number }
      > = {};
      for (const interaction of interactions) {
        const type = interaction.recommendationType;
        if (!typeStats[type]) {
          typeStats[type] = { accepted: 0, rejected: 0, ignored: 0 };
        }
        typeStats[type][
          interaction.userAction as 'accepted' | 'rejected' | 'ignored'
        ]++;
      }

      // Push to genome: update DNA scoring based on acceptance patterns
      for (const [recType, stats] of Object.entries(typeStats)) {
        const totalWithAction = stats.accepted + stats.rejected;
        if (totalWithAction > 5) {
          const acceptanceRate =
            totalWithAction > 0 ? stats.accepted / totalWithAction : 0;

          // Map recommendation types to DNA sections
          const dnaSection = this.mapRecommendationTypeToDnaSection(recType);

          // Update genome DNA via bridge
          await this.genomeBridgeService.updateDnaScore(
            businessId,
            dnaSection,
            recType,
            Math.round(acceptanceRate * 100),
            `KEY observed ${Math.round(acceptanceRate * 100)}% acceptance rate for ${recType} recommendations over ${totalWithAction} interactions`,
          );

          this.logger.debug(
            `[syncWithGenome] Updated genome DNA: section=${dnaSection}, metric=${recType}, score=${Math.round(acceptanceRate * 100)}`,
          );
        }
      }

      // 2. Pull genome DNA to update KEY's internal scoring weights
      const genomeIntelligence =
        await this.genomeBridgeService.getGenomeIntelligence(businessId);

      // Store genome DNA scores in Redis for the reasoning service to use
      await this.redis.setJson(
        `evolution:genome:dna:${businessId}`,
        {
          dnaScores: genomeIntelligence.dnaScores,
          genomeStage: genomeIntelligence.genomeStage,
          executiveReadiness: genomeIntelligence.executiveReadiness,
          syncedAt: new Date().toISOString(),
        },
        3600,
      );

      // 3. Create genome signals for significant patterns
      const patterns = await this.detectPatterns(businessId);
      const significantPatterns = patterns.filter(
        (p) => p.confidence > 0.75 && p.severity === 'high',
      );

      for (const pattern of significantPatterns) {
        await this.genomeBridgeService.createSignal(
          businessId,
          {
            type: pattern.type as 'urgent' | 'warning' | 'opportunity' | 'info',
            message: pattern.description,
            module: 'key_cortex',
            severity: pattern.severity ?? 'medium',
            source: 'pattern_detection',
            metadata: {
              patternId: pattern.id,
              confidence: pattern.confidence,
              dataPoints: pattern.dataPoints,
              recommendation: pattern.recommendation,
            },
          },
        );
      }

      // 4. Feed interaction outcomes to genome outcome learning
      const outcomes = interactions
        .filter((i) => i.outcome !== null && i.outcome !== undefined)
        .map((i) => ({
          actionId: i.recommendationType,
          status: i.userAction === 'accepted' ? 'success' : i.userAction === 'rejected' ? 'failure' : 'skipped',
          description: `Query: "${i.query.substring(0, 100)}" -> Recommendation: "${i.recommendation.substring(0, 100)}"`,
          result: {
            userAction: i.userAction,
            outcome: i.outcome,
            outcomeValue: i.outcomeValue,
          },
          timestamp: i.createdAt,
        }));

      for (const outcome of outcomes) {
        await this.genomeBridgeService.reportActionOutcome(
          businessId,
          outcome,
        );
      }

      const syncDuration = Date.now() - syncStart;

      // Log the sync event
      if (this.eventService) {
        await this.eventService.logEvent({
          correlationId: `sync_${Date.now()}`,
          step: 'GENOME_SYNC_COMPLETE',
          data: {
            businessId,
            dnaSectionsUpdated: Object.keys(typeStats).length,
            signalsCreated: significantPatterns.length,
            outcomesFed: outcomes.length,
            syncDurationMs: syncDuration,
          },
          timestamp: new Date(),
          service: 'KeyCortexEvolutionService',
        });
      }

      this.logger.log(
        `[syncWithGenome] Genome sync complete for business=${businessId}: ${Object.keys(typeStats).length} DNA sections updated, ${significantPatterns.length} signals created, ${outcomes.length} outcomes fed in ${syncDuration}ms`,
      );
    } catch (error) {
      this.logger.error(
        `[syncWithGenome] Failed for business=${businessId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Report a detected pattern to the genome as a signal.
   *
   * Creates a genome signal for the pattern. If the pattern is significant
   * (high confidence + high severity), also triggers a genome evolution
   * proposal. Creates evidence and logs the event.
   *
   * @param businessId  The business ID
   * @param pattern     The detected pattern to report
   */
  async reportPatternToGenome(
    businessId: string,
    pattern: DetectedPattern,
  ): Promise<void> {
    if (!this.genomeBridgeService) {
      this.logger.warn(
        `[reportPatternToGenome] Genome bridge not available — skipping pattern report`,
      );
      return;
    }

    this.logger.log(
      `[reportPatternToGenome] Reporting pattern ${pattern.id} (${pattern.type}) to genome for business=${businessId}`,
    );

    try {
      // 1. Create a genome signal for the pattern
      const signal = await this.genomeBridgeService.createSignal(
        businessId,
        {
          type: pattern.type as 'urgent' | 'warning' | 'opportunity' | 'info',
          message: pattern.description,
          module: 'key_cortex_patterns',
          severity: pattern.severity ?? 'medium',
          source: 'pattern_detection',
          metadata: {
            patternId: pattern.id,
            confidence: pattern.confidence,
            dataPoints: pattern.dataPoints,
            timeRange: pattern.timeRange,
            recommendation: pattern.recommendation,
          },
        },
      );

      this.logger.debug(
        `[reportPatternToGenome] Created genome signal: ${signal.id}`,
      );

      // 2. If pattern is significant, trigger evolution proposal
      if (pattern.confidence > 0.8 && pattern.severity === 'high') {
        const proposal = await this.genomeBridgeService.createEvolutionProposal(
          businessId,
          {
            title: `Pattern detected: ${pattern.description.substring(0, 80)}`,
            description: `KEY's pattern detection engine identified a significant ${pattern.type} pattern with ${Math.round(pattern.confidence * 100)}% confidence. ${pattern.dataPoints} data points support this finding. Recommendation: ${pattern.recommendation}`,
            source: 'key_cortex_pattern_detection',
            impact: pattern.type === 'revenue' ? 'high' : pattern.type === 'anomaly' ? 'high' : 'medium',
            evidenceIds: [signal.id],
            confidence: pattern.confidence,
          },
        );

        this.logger.log(
          `[reportPatternToGenome] Triggered evolution proposal: ${proposal.id} for pattern ${pattern.id}`,
        );
      }

      // 3. Create evidence
      await this.genomeBridgeService.createEvidence(
        businessId,
        {
          type: 'pattern_detection',
          description: `KEY detected ${pattern.type} pattern: ${pattern.description}`,
          source: 'key_cortex',
          metadata: {
            patternId: pattern.id,
            confidence: pattern.confidence,
            severity: pattern.severity,
            recommendation: pattern.recommendation,
          },
        },
      );

      // 4. Log event
      if (this.eventService) {
        await this.eventService.logEvent({
          correlationId: `pattern_${pattern.id}`,
          step: 'PATTERN_REPORTED_TO_GENOME',
          data: {
            businessId,
            patternId: pattern.id,
            patternType: pattern.type,
            confidence: pattern.confidence,
            severity: pattern.severity,
            signalId: signal.id,
          },
          timestamp: new Date(),
          service: 'KeyCortexEvolutionService',
        });
      }
    } catch (error) {
      this.logger.error(
        `[reportPatternToGenome] Failed for pattern ${pattern.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Generate a unified learning report that combines KEY's learning
   * with the genome's evolution report.
   *
   * Shows how KEY's learning influenced genome DNA and vice versa.
   *
   * @param businessId  The business ID
   * @returns           Unified KEY + Genome learning report
   */
  async getGenomeLearningReport(businessId: string): Promise<UnifiedReport> {
    if (!this.genomeBridgeService) {
      this.logger.warn(
        `[getGenomeLearningReport] Genome bridge not available — returning KEY-only report`,
      );

      // Return a minimal report without genome data
      const keyReport = await this.generateLearningReport(businessId);

      return {
        businessId,
        generatedAt: new Date(),
        period: { start: new Date(keyReport.weekOf), end: new Date() },
        keyPreferences: {
          responseLength: keyReport.stats.totalInteractions > 0 ? 'medium' : 'unknown',
          preferredTone: 'professional',
          acceptanceRate: keyReport.stats.recommendationAcceptanceRate,
          totalInteractions: keyReport.stats.totalInteractions,
          activeRecommendationTypes: [],
        },
        genomeDnaChanges: [],
        recommendationOutcomes: [],
        patternDetections: keyReport.patterns,
        keyHighlights: keyReport.highlights,
        narrative: `${keyReport.narrative}\n\n(Genome integration is not currently active — this report shows KEY's learning only.)`,
        syncStatus: {
          lastSyncAt: null,
          genomeConnected: false,
          dnaSectionsSynced: 0,
          signalsCreated: 0,
        },
      };
    }

    this.logger.log(
      `[getGenomeLearningReport] Generating unified report for business=${businessId}`,
    );

    try {
      // 1. Get KEY's learning report
      const keyReport = await this.generateLearningReport(businessId);

      // 2. Get genome intelligence
      const genomeIntelligence =
        await this.genomeBridgeService.getGenomeIntelligence(businessId);

      // 3. Get genome evolution history
      const genomeHistory =
        await this.genomeBridgeService.getEvolutionHistory(businessId);

      // 4. Build genome DNA changes list
      const dnaChanges: GenomeDnaChange[] = [];
      if (genomeHistory?.changes) {
        for (const change of genomeHistory.changes) {
          dnaChanges.push({
            section: change.section ?? 'unknown',
            metric: change.metric ?? 'unknown',
            previousValue: change.previousValue ?? 0,
            currentValue: change.currentValue ?? 0,
            changePercent: change.previousValue
              ? ((change.currentValue - change.previousValue) /
                  change.previousValue) *
                100
              : 0,
            influencedBy: change.source ?? 'unknown',
            timestamp: change.timestamp
              ? new Date(change.timestamp)
              : new Date(),
          });
        }
      }

      // 5. Build recommendation outcomes
      const since = new Date();
      since.setDate(since.getDate() - 30);

      const interactions = await this.prisma.client.keyEvolutionLog.findMany({
        where: {
          businessId,
          createdAt: { gte: since },
        },
      });

      const recTypeStats: Record<
        string,
        { suggested: number; accepted: number; rejected: number }
      > = {};
      for (const interaction of interactions) {
        const type = interaction.recommendationType;
        if (!recTypeStats[type]) {
          recTypeStats[type] = { suggested: 0, accepted: 0, rejected: 0 };
        }
        recTypeStats[type].suggested++;
        if (interaction.userAction === 'accepted') {
          recTypeStats[type].accepted++;
        } else if (interaction.userAction === 'rejected') {
          recTypeStats[type].rejected++;
        }
      }

      const recommendationOutcomes: RecommendationOutcome[] = Object.entries(
        recTypeStats,
      ).map(([type, stats]) => ({
        recommendationId: type,
        title: type,
        category: this.mapRecommendationTypeToDnaSection(type),
        timesSuggested: stats.suggested,
        timesAccepted: stats.accepted,
        timesRejected: stats.rejected,
        acceptanceRate:
          stats.suggested > 0 ? stats.accepted / stats.suggested : 0,
        genomeCorrelation: genomeIntelligence.dnaScores[
          this.mapRecommendationTypeToDnaSection(type)
        ] ?? 0,
      }));

      // 6. Get sync status
      const lastSync = await this.redis.getJson<{
        syncedAt: string;
        dnaSectionsUpdated: number;
        signalsCreated: number;
      }>(`evolution:genome:lastSync:${businessId}`);

      // 7. Build highlights
      const highlights: string[] = [...keyReport.highlights];

      if (dnaChanges.length > 0) {
        const recentChanges = dnaChanges.filter(
          (c) => c.timestamp > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        );
        if (recentChanges.length > 0) {
          highlights.push(
            `${recentChanges.length} genome DNA changes in the last 7 days`,
          );
        }
      }

      if (genomeIntelligence.signals?.length > 0) {
        highlights.push(
          `${genomeIntelligence.signals.length} active genome signals`,
        );
      }

      // 8. Generate unified narrative
      const narrativePrompt = `You are KEY, an AI business partner. Write a unified learning report that combines KEY's learning with genome evolution insights.

KEY's stats:
- ${keyReport.stats.totalInteractions} interactions this week
- ${Math.round(keyReport.stats.recommendationAcceptanceRate * 100)}% recommendation acceptance rate
- ${keyReport.patterns.length} patterns detected
- ${keyReport.stats.adjustmentsMade} self-tuning adjustments

Genome insights:
- Genome stage: ${genomeIntelligence.genomeStage ?? 'unknown'}
- Executive readiness: ${genomeIntelligence.executiveReadiness ?? 'N/A'}%
- DNA sections tracked: ${Object.keys(genomeIntelligence.dnaScores ?? {}).length}
- Active signals: ${genomeIntelligence.signals?.length ?? 0}
- Recent DNA changes: ${dnaChanges.filter((c) => c.timestamp > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).length}

Write 4-5 engaging paragraphs as KEY speaking directly to the business owner. Cover:
1. What KEY learned this week
2. How genome DNA evolved based on KEY's observations
3. What patterns were detected and shared with genome
4. Concrete improvements made
5. What to expect next

Be warm, specific, and insightful.`;

      const narrativeResponse = await this.gateway.complete({
        businessId,
        taskCategory: 'content-generation',
        messages: [
          {
            role: 'system',
            content:
              'You are KEY, an AI business partner. Write a warm, engaging unified learning report in first person. Be specific about how KEY and the genome learned together.',
          },
          { role: 'user', content: narrativePrompt },
        ],
        maxTokens: 1200,
        temperature: 0.7,
      });

      const narrative =
        narrativeResponse.content?.trim() ??
        `${keyReport.narrative}\n\nGenome DNA is being actively tracked with ${Object.keys(genomeIntelligence.dnaScores ?? {}).length} sections. ${dnaChanges.length} DNA changes recorded to date.`;

      const report: UnifiedReport = {
        businessId,
        generatedAt: new Date(),
        period: { start: new Date(keyReport.weekOf), end: new Date() },
        keyPreferences: {
          responseLength: 'medium',
          preferredTone: 'professional',
          acceptanceRate: keyReport.stats.recommendationAcceptanceRate,
          totalInteractions: keyReport.stats.totalInteractions,
          activeRecommendationTypes: Object.keys(recTypeStats).slice(0, 5),
        },
        genomeDnaChanges: dnaChanges,
        recommendationOutcomes,
        patternDetections: keyReport.patterns,
        keyHighlights: highlights,
        narrative,
        syncStatus: {
          lastSyncAt: lastSync ? new Date(lastSync.syncedAt) : null,
          genomeConnected: true,
          dnaSectionsSynced: Object.keys(recTypeStats).length,
          signalsCreated: genomeIntelligence.signals?.length ?? 0,
        },
      };

      this.logger.log(
        `[getGenomeLearningReport] Unified report generated for business=${businessId}: ${report.keyHighlights.length} highlights, ${report.genomeDnaChanges.length} DNA changes`,
      );

      return report;
    } catch (error) {
      this.logger.error(
        `[getGenomeLearningReport] Failed for business=${businessId}: ${error instanceof Error ? error.message : String(error)}`,
      );

      // Return a minimal fallback report
      const keyReport = await this.generateLearningReport(businessId);
      return {
        businessId,
        generatedAt: new Date(),
        period: { start: new Date(keyReport.weekOf), end: new Date() },
        keyPreferences: {
          responseLength: 'medium',
          preferredTone: 'professional',
          acceptanceRate: keyReport.stats.recommendationAcceptanceRate,
          totalInteractions: keyReport.stats.totalInteractions,
          activeRecommendationTypes: [],
        },
        genomeDnaChanges: [],
        recommendationOutcomes: [],
        patternDetections: keyReport.patterns,
        keyHighlights: keyReport.highlights,
        narrative: `${keyReport.narrative}\n\n(Genome data temporarily unavailable — showing KEY's learning only.)`,
        syncStatus: {
          lastSyncAt: null,
          genomeConnected: false,
          dnaSectionsSynced: 0,
          signalsCreated: 0,
        },
      };
    }
  }

  /**
   * Influence genome DNA by creating an evolution proposal based on
   * KEY's observations and reasoning.
   *
   * KEY's track record determines the confidence of the proposal:
   * - High acceptance rate → higher confidence
   * - Many interactions → higher confidence
   * - Recent patterns detected → contextual confidence
   *
   * @param businessId  The business ID
   * @param section     The DNA section to influence (e.g., 'sales', 'operations', 'risk')
   * @param adjustment  The proposed adjustment to the DNA scores
   */
  async influenceGenomeDna(
    businessId: string,
    section: string,
    adjustment: Record<string, unknown>,
  ): Promise<string> {
    if (!this.genomeBridgeService) {
      throw new Error(
        'Genome bridge service is not available — cannot influence DNA',
      );
    }

    this.logger.log(
      `[influenceGenomeDna] Creating DNA influence proposal: business=${businessId}, section=${section}`,
    );

    try {
      // Determine confidence based on KEY's track record
      const since = new Date();
      since.setDate(since.getDate() - 30);

      const interactions = await this.prisma.client.keyEvolutionLog.findMany({
        where: {
          businessId,
          createdAt: { gte: since },
        },
      });

      const acceptedCount = interactions.filter(
        (i) => i.userAction === 'accepted',
      ).length;
      const totalWithAction = interactions.filter(
        (i) => i.userAction !== 'ignored',
      ).length;
      const acceptanceRate =
        totalWithAction > 0 ? acceptedCount / totalWithAction : 0;

      // Build confidence calculation
      let confidence = 0.5;
      if (acceptanceRate > 0.7) confidence += 0.2;
      else if (acceptanceRate > 0.5) confidence += 0.1;

      if (interactions.length > 100) confidence += 0.15;
      else if (interactions.length > 50) confidence += 0.1;
      else if (interactions.length > 20) confidence += 0.05;

      confidence = Math.min(0.95, confidence);

      // Build KEY's reasoning
      const reasoning = `KEY observed ${interactions.length} interactions with ${Math.round(acceptanceRate * 100)}% acceptance rate over the last 30 days. Based on pattern detection and preference learning, KEY recommends adjusting ${section} DNA: ${JSON.stringify(adjustment)}. KEY's track record confidence: ${Math.round(confidence * 100)}%.`;

      // Create genome evolution proposal
      const proposal = await this.genomeBridgeService.createEvolutionProposal(
        businessId,
        {
          title: `KEY recommends ${section} DNA adjustment`,
          description: reasoning,
          source: 'key_cortex_dna_influence',
          impact: section === 'risk' ? 'high' : 'medium',
          evidenceIds: [],
          confidence,
          metadata: {
            proposedAdjustment: adjustment,
            keyAcceptanceRate: acceptanceRate,
            keyInteractionCount: interactions.length,
            section,
          },
        },
      );

      // Create evidence for the proposal
      await this.genomeBridgeService.createEvidence(
        businessId,
        {
          type: 'dna_influence_proposal',
          description: reasoning,
          source: 'key_cortex',
          metadata: {
            proposalId: proposal.id,
            section,
            confidence,
            adjustment,
          },
        },
      );

      // Log event
      if (this.eventService) {
        await this.eventService.logEvent({
          correlationId: `dna_${proposal.id}`,
          step: 'GENOME_DNA_INFLUENCE_PROPOSED',
          data: {
            businessId,
            section,
            proposalId: proposal.id,
            confidence,
            acceptanceRate,
            interactionCount: interactions.length,
          },
          timestamp: new Date(),
          service: 'KeyCortexEvolutionService',
        });
      }

      this.logger.log(
        `[influenceGenomeDna] Created DNA influence proposal: ${proposal.id} (confidence: ${Math.round(confidence * 100)}%)`,
      );

      return proposal.id;
    } catch (error) {
      this.logger.error(
        `[influenceGenomeDna] Failed for business=${businessId}, section=${section}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Adapt KEY's behavior based on genome DNA scores.
   *
   * Reads genome DNA and adjusts KEY's recommendations:
   * - If sales DNA is low → be more aggressive with sales suggestions
   * - If operations DNA is high → focus on optimization
   * - If risk DNA is high → be more cautious
   * - If marketing DNA is low → suggest marketing improvements
   * - If finance DNA is high → focus on financial efficiency
   *
   * @param businessId  The business ID to adapt for
   */
  async adaptFromGenome(businessId: string): Promise<void> {
    if (!this.genomeBridgeService) {
      this.logger.warn(
        `[adaptFromGenome] Genome bridge not available — skipping adaptation`,
      );
      return;
    }

    this.logger.log(`[adaptFromGenome] Adapting KEY behavior for business=${businessId}`);

    try {
      // Get genome DNA scores
      const genomeIntelligence =
        await this.genomeBridgeService.getGenomeIntelligence(businessId);

      const dnaScores = genomeIntelligence.dnaScores ?? {};
      const adaptations: string[] = [];

      // Define adaptation rules based on DNA thresholds
      const adaptationsMade: Array<{
        dnaSection: string;
        score: number;
        action: string;
        reason: string;
      }> = [];

      // Sales DNA
      if (dnaScores['sales'] !== undefined && dnaScores['sales'] < 40) {
        const action = 'Increase sales suggestion frequency and urgency';
        adaptations.push(action);
        adaptationsMade.push({
          dnaSection: 'sales',
          score: dnaScores['sales'],
          action,
          reason: `Sales DNA is low (${dnaScores['sales']}%) — business needs more aggressive sales focus`,
        });

        // Store adaptation in Redis for reasoning service to pick up
        await this.redis.setJson(
          `evolution:adaptation:${businessId}:sales`,
          {
            active: true,
            strategy: 'aggressive_sales',
            priority: 'high',
            dnaScore: dnaScores['sales'],
            adaptedAt: new Date().toISOString(),
          },
          86400,
        );
      } else if (dnaScores['sales'] !== undefined && dnaScores['sales'] > 75) {
        const action = 'Focus on sales optimization and automation';
        adaptations.push(action);
        adaptationsMade.push({
          dnaSection: 'sales',
          score: dnaScores['sales'],
          action,
          reason: `Sales DNA is high (${dnaScores['sales']}%) — business has strong sales, suggest optimizations`,
        });

        await this.redis.setJson(
          `evolution:adaptation:${businessId}:sales`,
          {
            active: true,
            strategy: 'optimization',
            priority: 'medium',
            dnaScore: dnaScores['sales'],
            adaptedAt: new Date().toISOString(),
          },
          86400,
        );
      }

      // Operations DNA
      if (dnaScores['operations'] !== undefined && dnaScores['operations'] > 70) {
        const action = 'Focus on operational efficiency and process optimization';
        adaptations.push(action);
        adaptationsMade.push({
          dnaSection: 'operations',
          score: dnaScores['operations'],
          action,
          reason: `Operations DNA is high (${dnaScores['operations']}%) — suggest operational improvements`,
        });

        await this.redis.setJson(
          `evolution:adaptation:${businessId}:operations`,
          {
            active: true,
            strategy: 'optimization',
            priority: 'high',
            dnaScore: dnaScores['operations'],
            adaptedAt: new Date().toISOString(),
          },
          86400,
        );
      }

      // Risk DNA
      if (dnaScores['risk'] !== undefined && dnaScores['risk'] > 60) {
        const action = 'Be more cautious with recommendations; emphasize risk mitigation';
        adaptations.push(action);
        adaptationsMade.push({
          dnaSection: 'risk',
          score: dnaScores['risk'],
          action,
          reason: `Risk DNA is high (${dnaScores['risk']}%) — business environment is risky, be cautious`,
        });

        await this.redis.setJson(
          `evolution:adaptation:${businessId}:risk`,
          {
            active: true,
            strategy: 'cautious',
            priority: 'high',
            dnaScore: dnaScores['risk'],
            adaptedAt: new Date().toISOString(),
          },
          86400,
        );
      }

      // Marketing DNA
      if (dnaScores['marketing'] !== undefined && dnaScores['marketing'] < 35) {
        const action = 'Suggest marketing improvements and lead generation tactics';
        adaptations.push(action);
        adaptationsMade.push({
          dnaSection: 'marketing',
          score: dnaScores['marketing'],
          action,
          reason: `Marketing DNA is low (${dnaScores['marketing']}%) — business needs marketing focus`,
        });

        await this.redis.setJson(
          `evolution:adaptation:${businessId}:marketing`,
          {
            active: true,
            strategy: 'aggressive_marketing',
            priority: 'high',
            dnaScore: dnaScores['marketing'],
            adaptedAt: new Date().toISOString(),
          },
          86400,
        );
      }

      // Finance DNA
      if (dnaScores['finance'] !== undefined && dnaScores['finance'] > 70) {
        const action = 'Focus on financial efficiency and cost optimization';
        adaptations.push(action);
        adaptationsMade.push({
          dnaSection: 'finance',
          score: dnaScores['finance'],
          action,
          reason: `Finance DNA is high (${dnaScores['finance']}%) — suggest financial optimizations`,
        });

        await this.redis.setJson(
          `evolution:adaptation:${businessId}:finance`,
          {
            active: true,
            strategy: 'financial_optimization',
            priority: 'medium',
            dnaScore: dnaScores['finance'],
            adaptedAt: new Date().toISOString(),
          },
          86400,
        );
      }

      // Log adaptations
      for (const adaptation of adaptationsMade) {
        this.logger.log(
          `[adaptFromGenome] Adaptation: ${adaptation.dnaSection} (score=${adaptation.score}) → ${adaptation.action}`,
        );
      }

      // Persist adaptations to Prisma
      if (adaptationsMade.length > 0) {
        await this.prisma.client.keyTuningLog.create({
          data: {
            businessId,
            adjustments: JSON.stringify(
              adaptationsMade.map((a) => ({
                parameter: `genome_adaptation_${a.dnaSection}`,
                oldValue: 'none',
                newValue: a.strategy,
                reason: a.reason,
              })),
            ),
            summary: `Genome-aware adaptations: ${adaptationsMade.map((a) => a.dnaSection).join(', ')}`,
          },
        });
      }

      // Log event
      if (this.eventService) {
        await this.eventService.logEvent({
          correlationId: `adapt_${Date.now()}`,
          step: 'GENOME_ADAPTATION_COMPLETE',
          data: {
            businessId,
            adaptationsMade: adaptationsMade.length,
            dnaSections: adaptationsMade.map((a) => a.dnaSection),
          },
          timestamp: new Date(),
          service: 'KeyCortexEvolutionService',
        });
      }

      this.logger.log(
        `[adaptFromGenome] KEY behavior adapted for business=${businessId}: ${adaptationsMade.length} adaptations based on genome DNA`,
      );
    } catch (error) {
      this.logger.error(
        `[adaptFromGenome] Failed for business=${businessId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ========================================================================
  // Private Helpers (preserved)
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
   * Map a recommendation type to a genome DNA section.
   */
  private mapRecommendationTypeToDnaSection(recommendationType: string): string {
    const mapping: Record<string, string> = {
      sales: 'sales',
      revenue: 'sales',
      marketing: 'marketing',
      lead: 'marketing',
      operational: 'operations',
      operational_efficiency: 'operations',
      financial: 'finance',
      cost: 'finance',
      risk: 'risk',
      compliance: 'risk',
      customer: 'customer_success',
      support: 'customer_success',
      product: 'product',
      innovation: 'product',
      talent: 'talent',
      hiring: 'talent',
      strategy: 'strategy',
      growth: 'strategy',
    };

    // Try direct match first
    const directMatch = mapping[recommendationType.toLowerCase()];
    if (directMatch) return directMatch;

    // Try partial match
    for (const [key, value] of Object.entries(mapping)) {
      if (recommendationType.toLowerCase().includes(key)) {
        return value;
      }
    }

    return 'general';
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
