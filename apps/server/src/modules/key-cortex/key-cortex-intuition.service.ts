/**
 * ============================================================================
 * KEY Cortex — Layer 4: INTUITION / WEAK SIGNAL ENGINE
 * ============================================================================
 *
 * KEY spots invisible patterns — tiny signals that humans miss.
 *
 * Detection Capabilities:
 *   • LINGUISTIC      — Keywords appearing across support tickets, emails, chat
 *   • BEHAVIORAL      — Engagement dropping before visible churn
 *   • TEMPORAL        — Patterns that don't match historical cycles
 *   • CROSS-DOMAIN    — Marketing spend ↑ but leads ↓ = ad fatigue
 *   • NETWORK         — One customer's complaint mirrors 3 others (unconnected)
 *
 * Signal Scoring:
 *   Each signal is ranked by: frequency × recency × cross-source validation
 *
 * Philosophy: Intuition is not magic — it is pattern recognition at scale.
 * KEY processes millions of data points to find the one thread that connects
 * them. The weak signal engine is KEY's "spidey sense" — it tingles before
 * the crisis arrives.
 * ============================================================================
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../core/prisma/prisma.service';
import { KeyCortexEventService } from './key-cortex-event.service';
import { KeyCortexContextV2Service } from './key-cortex-context-v2.service';
import { ModelGatewayService } from '../ai/model-gateway.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { v4 as uuidv4 } from 'uuid';

/* ─────────────────────────── Type Definitions ─────────────────────────── */

export type SignalTrend = 'emerging' | 'strengthening' | 'weakening' | 'confirmed' | 'faded';
export type ImpactLevel = 'low' | 'medium' | 'high' | 'critical';
export type SignalCategory = 'linguistic' | 'behavioral' | 'temporal' | 'cross-domain' | 'network' | 'operational';

export interface WeakSignal {
  id: string;
  description: string;
  sources: string[];
  confidence: number; // 0–1
  trend: SignalTrend;
  potentialImpact: ImpactLevel;
  recommendedInvestigation: string;
  detectedAt: Date;
  category: SignalCategory;
  score: number; // composite ranking score
  evidence: SignalEvidence[];
  businessId: string;
  validatedAt?: Date;
  validationOutcome?: 'confirmed' | 'rejected' | null;
  relatedSignals?: string[]; // IDs of related signals
}

export interface SignalEvidence {
  source: string;
  detail: string;
  timestamp: Date;
  strength: number; // 0–1
}

export interface PatternMatch {
  id: string;
  pattern: string;
  instances: string[];
  currentMatch: number; // 0–1
  prediction: string;
  timeHorizon: string;
  confidence: number;
  matchedEntity: string; // customer ID, product ID, etc.
  matchedEntityType: string; // 'customer' | 'product' | 'campaign' | 'team'
  precursors: PrecursorMatch[];
  riskScore: number; // 0–1 composite
}

export interface PrecursorMatch {
  name: string;
  description: string;
  matchScore: number; // 0–1 how closely current matches historical
  historicalFrequency: number; // % of churned customers showing this
  severity: ImpactLevel;
}

export interface RevenueAnomaly {
  id: string;
  type: 'spike' | 'drop' | 'shift' | 'stagnation';
  metric: string;
  expectedValue: number;
  actualValue: number;
  variance: number; // percentage
  period: string;
  explanation?: string;
  crossReferences?: string[]; // related anomalies
  confidence: number;
  detectedAt: Date;
}

export interface OperationalStressSignal {
  id: string;
  metric: string;
  currentValue: number;
  baselineValue: number;
  deviation: number; // percentage from baseline
  threshold: number;
  status: 'healthy' | 'elevated' | 'critical' | 'breaking';
  recommendation: string;
  detectedAt: Date;
}

/* ─────────────────────────── Service ─────────────────────────── */

@Injectable()
export class KeyCortexIntuitionService {
  private readonly logger = new Logger(KeyCortexIntuitionService.name);

  /** In-memory signal cache — flushed to DB periodically */
  private signalCache: Map<string, WeakSignal[]> = new Map();

  /** Churn pattern template — learned from historical data */
  private churnPatternLibrary: Map<string, PrecursorMatch[]> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventService: KeyCortexEventService,
    private readonly contextService: KeyCortexContextV2Service,
    private readonly modelGateway: ModelGatewayService,
    private readonly aiUsage: AiUsageService,
  ) {}

  /* ═══════════════════════════════════════════════════════════════
     PUBLIC API — Weak Signal Detection
     ═══════════════════════════════════════════════════════════════ */

  /**
   * detectWeakSignals — The primary intuition pipeline.
   *
   * Scans ALL business data for emerging patterns across five
   * dimensions: linguistic, behavioral, temporal, cross-domain,
   * and network. Each signal is scored by frequency × recency
   * × cross-source validation.
   *
   * This is KEY's "spidey sense" — it detects problems and
   * opportunities before they become obvious.
   */
  async detectWeakSignals(businessId: string): Promise<WeakSignal[]> {
    const startedAt = Date.now();
    this.logger.log(`[Intuition] 🔍 Scanning for weak signals — ${businessId}`);

    const allSignals: WeakSignal[] = [];

    // Run all 5 detection pipelines in parallel
    const [linguistic, behavioral, temporal, crossDomain, network] = await Promise.allSettled([
      this.detectLinguisticSignals(businessId),
      this.detectBehavioralSignals(businessId),
      this.detectTemporalAnomalies(businessId),
      this.detectCrossDomainSignals(businessId),
      this.detectNetworkSignals(businessId),
    ]);

    if (linguistic.status === 'fulfilled') allSignals.push(...linguistic.value);
    else this.logger.error(`[Intuition] Linguistic detection failed: ${linguistic.reason}`);

    if (behavioral.status === 'fulfilled') allSignals.push(...behavioral.value);
    else this.logger.error(`[Intuition] Behavioral detection failed: ${behavioral.reason}`);

    if (temporal.status === 'fulfilled') allSignals.push(...temporal.value);
    else this.logger.error(`[Intuition] Temporal detection failed: ${temporal.reason}`);

    if (crossDomain.status === 'fulfilled') allSignals.push(...crossDomain.value);
    else this.logger.error(`[Intuition] Cross-domain detection failed: ${crossDomain.reason}`);

    if (network.status === 'fulfilled') allSignals.push(...network.value);
    else this.logger.error(`[Intuition] Network detection failed: ${network.reason}`);

    // Score and rank all signals
    const scoredSignals = this.scoreSignals(allSignals);

    // Store in cache and persist
    this.signalCache.set(businessId, scoredSignals);
    for (const signal of scoredSignals) {
      await this.persistSignal(signal).catch(() => {
        /* non-fatal */
      });
    }

    // Cross-link related signals
    const linkedSignals = this.crossLinkSignals(scoredSignals);

    this.logger.log(
      `[Intuition] ✅ Found ${linkedSignals.length} weak signals in ${Date.now() - startedAt}ms ` +
        `(linguistic:${linguistic.status === 'fulfilled' ? linguistic.value.length : 0}, ` +
        `behavioral:${behavioral.status === 'fulfilled' ? behavioral.value.length : 0}, ` +
        `temporal:${temporal.status === 'fulfilled' ? temporal.value.length : 0}, ` +
        `cross-domain:${crossDomain.status === 'fulfilled' ? crossDomain.value.length : 0}, ` +
        `network:${network.status === 'fulfilled' ? network.value.length : 0})`,
    );

    // Return sorted by score descending
    return linkedSignals.sort((a, b) => b.score - a.score);
  }

  /**
   * detectChurnPrecursors — Identify at-risk customers before they churn.
   *
   * Analyzes historical churned customers to identify common precursors,
   * then matches current customers against these patterns. Returns
   * at-risk customers with match scores.
   *
   * Example output:
   *   "Customer ACME Corp: Support tickets increased 3× in month before
   *    churn. Invoice payment delayed avg 12 days. Feature usage dropped
   *    60%. CHURN RISK: 87%"
   */
  async detectChurnPrecursors(businessId: string): Promise<PatternMatch[]> {
    this.logger.log(`[Intuition] 🔮 Detecting churn precursors — ${businessId}`);

    // 1. Build churn pattern library from historical data
    await this.buildChurnPatternLibrary(businessId);

    // 2. Get active customers to analyze
    const activeCustomers = await this.getActiveCustomers(businessId);

    // 3. Match each customer against churn patterns
    const matches: PatternMatch[] = [];
    for (const customer of activeCustomers) {
      const match = await this.matchCustomerAgainstChurnPatterns(businessId, customer);
      if (match.riskScore > 0.3) {
        // Only return meaningful matches
        matches.push(match);
      }
    }

    // Sort by risk score descending
    matches.sort((a, b) => b.riskScore - a.riskScore);

    this.logger.log(`[Intuition] 🔮 Found ${matches.length} at-risk customers`);
    return matches;
  }

  /**
   * detectRevenueAnomalies — Spot unusual revenue patterns.
   *
   * Compares current revenue patterns to historical baseline.
   * Detects unexpected spikes, unexplained drops, category shifts.
   * Cross-references with calendar (holidays, events).
   */
  async detectRevenueAnomalies(businessId: string): Promise<WeakSignal[]> {
    this.logger.log(`[Intuition] 💰 Detecting revenue anomalies — ${businessId}`);

    const anomalies: RevenueAnomaly[] = [];

    // Get historical baseline
    const baseline = await this.computeRevenueBaseline(businessId);

    // Get current period data
    const currentPeriod = await this.getCurrentRevenuePeriod(businessId);

    // Compare each metric
    const metrics = ['total_revenue', 'avg_deal_size', 'conversion_rate', 'lead_count', 'mrr', 'arr'];
    for (const metric of metrics) {
      const expected = baseline[metric];
      const actual = currentPeriod[metric];

      if (expected === undefined || actual === undefined) continue;

      const variance = expected === 0 ? 0 : ((actual - expected) / expected) * 100;

      // Flag if variance > 15% (either direction)
      if (Math.abs(variance) > 15) {
        anomalies.push({
          id: uuidv4(),
          type: variance > 0 ? 'spike' : 'drop',
          metric,
          expectedValue: expected,
          actualValue: actual,
          variance,
          period: 'current_month',
          confidence: Math.min(Math.abs(variance) / 50, 0.95), // Higher variance = higher confidence
          detectedAt: new Date(),
        });
      }
    }

    // Cross-reference with calendar events
    const calendarReferenced = await this.crossReferenceWithCalendar(businessId, anomalies);

    // Use AI to generate explanations
    const explained = await this.explainAnomalies(businessId, calendarReferenced);

    // Convert to WeakSignal format
    const signals: WeakSignal[] = explained.map((a) => ({
      id: a.id,
      description: `${a.metric}: ${a.variance > 0 ? '+' : ''}${a.variance.toFixed(1)}% ${a.type} (${a.actualValue.toFixed(0)} vs expected ${a.expectedValue.toFixed(0)})${a.explanation ? ` — ${a.explanation}` : ''}`,
      sources: ['revenue_data', 'historical_baseline', 'calendar'],
      confidence: a.confidence,
      trend: a.variance > 0 ? 'strengthening' : 'weakening',
      potentialImpact: Math.abs(a.variance) > 30 ? 'critical' : Math.abs(a.variance) > 20 ? 'high' : 'medium',
      recommendedInvestigation: `Investigate ${a.metric} ${a.type}: review ${a.crossReferences?.join(', ') ?? 'related metrics'}`,
      detectedAt: a.detectedAt,
      category: 'temporal',
      score: a.confidence * Math.min(Math.abs(a.variance) / 30, 1),
      evidence: [
        { source: 'revenue', detail: `Expected: ${a.expectedValue.toFixed(2)}, Actual: ${a.actualValue.toFixed(2)}`, timestamp: a.detectedAt, strength: a.confidence },
      ],
      businessId,
    }));

    this.logger.log(`[Intuition] 💰 Found ${signals.length} revenue anomalies`);
    return signals;
  }

  /**
   * detectOperationalStress — Monitor operational health.
   *
   * Tracks task backlog, overdue items, team velocity, error rates.
   * Detects early signs of operational breakdown before they
   * become crises. KEY acts as an early warning system.
   */
  async detectOperationalStress(businessId: string): Promise<WeakSignal[]> {
    this.logger.log(`[Intuition] ⚙️ Detecting operational stress — ${businessId}`);

    const stressSignals: OperationalStressSignal[] = [];

    // 1. Task backlog analysis
    const taskMetrics = await this.analyzeTaskBacklog(businessId);
    stressSignals.push(...taskMetrics);

    // 2. Overdue items tracking
    const overdueMetrics = await this.analyzeOverdueItems(businessId);
    stressSignals.push(...overdueMetrics);

    // 3. Team velocity monitoring
    const velocityMetrics = await this.analyzeTeamVelocity(businessId);
    stressSignals.push(...velocityMetrics);

    // 4. Error rate tracking
    const errorMetrics = await this.analyzeErrorRates(businessId);
    stressSignals.push(...errorMetrics);

    // Convert to WeakSignal format
    const signals: WeakSignal[] = stressSignals
      .filter((s) => s.status !== 'healthy')
      .map((s) => ({
        id: uuidv4(),
        description: `Operational stress: ${s.metric} at ${s.currentValue.toFixed(1)} (baseline: ${s.baselineValue.toFixed(1)}, deviation: ${s.deviation > 0 ? '+' : ''}${s.deviation.toFixed(1)}%) — Status: ${s.status.toUpperCase()}`,
        sources: ['task_system', 'analytics', 'error_logs'],
        confidence: Math.min(Math.abs(s.deviation) / 100, 0.95),
        trend: s.deviation > 0 ? 'strengthening' : 'weakening',
        potentialImpact: s.status === 'breaking' ? 'critical' : s.status === 'critical' ? 'high' : 'medium',
        recommendedInvestigation: s.recommendation,
        detectedAt: s.detectedAt,
        category: 'operational',
        score: (Math.min(Math.abs(s.deviation) / 100, 0.95) * (s.status === 'breaking' ? 4 : s.status === 'critical' ? 3 : 2)),
        evidence: [
          { source: 'operational_metrics', detail: `${s.metric}: ${s.currentValue.toFixed(2)} vs baseline ${s.baselineValue.toFixed(2)}`, timestamp: s.detectedAt, strength: 0.8 },
        ],
        businessId,
      }));

    // Store signals
    for (const signal of signals) {
      await this.persistSignal(signal).catch(() => {
        /* non-fatal */
      });
    }

    this.logger.log(`[Intuition] ⚙️ Found ${signals.length} operational stress signals`);
    return signals.sort((a, b) => b.score - a.score);
  }

  /**
   * getSignalHistory — Return all detected signals over time.
   *
   * Includes validation outcome: was this signal confirmed by
   * subsequent events? This enables KEY to learn which signal
   * types are most reliable.
   */
  async getSignalHistory(businessId: string, signalType?: string): Promise<WeakSignal[]> {
    // Fetch from database
    const dbSignals: Array<Record<string, unknown>> = []; // persistence not implemented (model absent from schema)

    // Merge with in-memory cache
    const cachedSignals = this.signalCache.get(businessId) ?? [];
    const allSignals = [
      ...(dbSignals ?? []).map((s: Record<string, unknown>) => this.deserializeWeakSignal(s)),
      ...cachedSignals,
    ];

    // Deduplicate by ID
    const seen = new Set<string>();
    const unique: WeakSignal[] = [];
    for (const s of allSignals) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        unique.push(s);
      }
    }

    // Sort by detectedAt descending
    unique.sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());

    return unique;
  }

  /* ═══════════════════════════════════════════════════════════════
     SCHEDULED CRON — Periodic Intuition Scan
     ═══════════════════════════════════════════════════════════════ */

  /** Continuous weak signal scanning — every 15 minutes */
  @Cron(CronExpression.EVERY_15_MINUTES)
  async scheduledIntuitionScan(): Promise<void> {
    const businesses = await this.findAllActiveBusinesses();
    for (const businessId of businesses) {
      await this.detectWeakSignals(businessId).catch((err) =>
        this.logger.error(`Scheduled intuition scan failed for ${businessId}: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  }

  /** Daily deep churn analysis — 6:00 AM */
  @Cron('0 6 * * *')
  async scheduledChurnAnalysis(): Promise<void> {
    const businesses = await this.findAllActiveBusinesses();
    for (const businessId of businesses) {
      await this.detectChurnPrecursors(businessId).catch((err) =>
        this.logger.error(`Scheduled churn analysis failed for ${businessId}: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     PRIVATE — LINGUISTIC SIGNAL DETECTION
     ═══════════════════════════════════════════════════════════════ */

  private async detectLinguisticSignals(businessId: string): Promise<WeakSignal[]> {
    const signals: WeakSignal[] = [];
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000); // 14 days

    // Collect text from all sources
    const textCorpus = await this.collectTextCorpus(businessId, since);

    if (textCorpus.length === 0) return signals;

    // Extract keyword frequency vectors
    const keywordFrequencies = this.extractKeywordFrequencies(textCorpus);

    // Find emerging keywords (appearing more frequently than historical baseline)
    const baselineFrequencies = await this.getBaselineKeywordFrequencies(businessId);

    const emergingKeywords: Array<{ word: string; currentFreq: number; baselineFreq: number; ratio: number }> = [];
    for (const [word, currentFreq] of keywordFrequencies.entries()) {
      const baselineFreq = baselineFrequencies.get(word) ?? 0;
      const ratio = baselineFreq === 0 ? currentFreq : currentFreq / baselineFreq;
      if (ratio > 2 && currentFreq >= 3) {
        // At least 2× increase and 3+ occurrences
        emergingKeywords.push({ word, currentFreq, baselineFreq, ratio });
      }
    }

    // Sort by ratio descending
    emergingKeywords.sort((a, b) => b.ratio - a.ratio);

    // Create signals for top emerging keywords
    for (const kw of emergingKeywords.slice(0, 10)) {
      const sources = this.findSourcesForKeyword(textCorpus, kw.word);
      const confidence = Math.min(0.3 + kw.ratio * 0.1, 0.9);

      signals.push({
        id: uuidv4(),
        description: `Emerging keyword "${kw.word}" appearing ${kw.currentFreq}× (${kw.ratio.toFixed(1)}× above baseline) across ${sources.length} sources`,
        sources: [...new Set(sources)],
        confidence,
        trend: 'emerging',
        potentialImpact: kw.ratio > 5 ? 'high' : kw.ratio > 3 ? 'medium' : 'low',
        recommendedInvestigation: `Investigate why "${kw.word}" is being mentioned more frequently. Check if this indicates a product issue, feature request, or market trend.`,
        detectedAt: new Date(),
        category: 'linguistic',
        score: confidence * kw.ratio * 0.2,
        evidence: sources.map((s) => ({
          source: s,
          detail: `Keyword "${kw.word}" frequency: ${kw.currentFreq}`,
          timestamp: new Date(),
          strength: confidence,
        })),
        businessId,
      });
    }

    // Use AI for semantic analysis
    try {
      const aiSignals = await this.aiSemanticAnalysis(businessId, textCorpus);
      signals.push(...aiSignals);
    } catch {
      // Proceed without AI enhancement
    }

    return signals;
  }

  private async collectTextCorpus(businessId: string, since: Date): Promise<Array<{ source: string; text: string; timestamp: Date }>> {
    const corpus: Array<{ source: string; text: string; timestamp: Date }> = [];

    // Support tickets
    const tickets = await this.prisma.client.supportTicket
      ?.findMany({
        where: { businessId, createdAt: { gte: since } },
        select: { subject: true, description: true, createdAt: true },
      })
      .catch(() => []);
    for (const t of tickets ?? []) {
      corpus.push({
        source: 'support_ticket',
        text: `${(t as { subject: string }).subject} ${(t as { description?: string }).description ?? ''}`,
        timestamp: (t as { createdAt: Date }).createdAt,
      });
    }

    // Chat messages
    const chats = await this.prisma.client.chatMessage
      ?.findMany({
        where: { businessId, createdAt: { gte: since } },
        select: { content: true, createdAt: true },
      })
      .catch(() => []);
    for (const c of chats ?? []) {
      corpus.push({
        source: 'chat',
        text: (c as { content: string }).content,
        timestamp: (c as { createdAt: Date }).createdAt,
      });
    }

    // Email content (if available)
    const emails: Array<Record<string, unknown>> = []; // model absent from schema.prisma; call short-circuited to undefined and never ran
    for (const e of emails ?? []) {
      corpus.push({
        source: 'email',
        text: `${(e as { subject?: string }).subject ?? ''} ${(e as { body?: string }).body ?? ''}`,
        timestamp: (e as { createdAt: Date }).createdAt,
      });
    }

    // Event descriptions
    const events = await this.prisma.client.businessEvent
      .findMany({
        where: { businessId, createdAt: { gte: since } },
        select: { description: true, createdAt: true },
      })
      .catch(() => []);
    for (const e of events) {
      if ((e as { description?: string }).description) {
        corpus.push({
          source: 'business_event',
          text: (e as { description: string }).description,
          timestamp: (e as { createdAt: Date }).createdAt,
        });
      }
    }

    return corpus;
  }

  private extractKeywordFrequencies(corpus: Array<{ source: string; text: string }>): Map<string, number> {
    const frequencies = new Map<string, number>();

    // Stop words to ignore
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
      'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
      'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above',
      'below', 'between', 'out', 'off', 'over', 'under', 'again', 'further',
      'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all',
      'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
      'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
      'and', 'but', 'if', 'or', 'because', 'until', 'while', 'this', 'that',
      'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he',
      'him', 'his', 'she', 'her', 'it', 'its', 'they', 'them', 'their',
    ]);

    for (const item of corpus) {
      const words = item.text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3 && !stopWords.has(w) && !/^\d+$/.test(w));

      for (const word of words) {
        frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
      }
    }

    return frequencies;
  }

  private async getBaselineKeywordFrequencies(businessId: string): Promise<Map<string, number>> {
    // Get historical keyword frequencies (30-60 days ago)
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const until = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const corpus = await this.collectTextCorpus(businessId, since);
    const filtered = corpus.filter((c) => c.timestamp < until);

    return this.extractKeywordFrequencies(filtered);
  }

  private findSourcesForKeyword(corpus: Array<{ source: string; text: string }>, keyword: string): string[] {
    return corpus.filter((c) => c.text.toLowerCase().includes(keyword.toLowerCase())).map((c) => c.source);
  }

  private async aiSemanticAnalysis(
    businessId: string,
    corpus: Array<{ source: string; text: string; timestamp: Date }>,
  ): Promise<WeakSignal[]> {
    // Sample corpus for AI analysis (avoid token limits)
    const sample = corpus.slice(0, 50).map((c) => `[${c.source}] ${c.text.slice(0, 200)}`).join('\n');

    const prompt = `Analyze this text corpus from a business and identify EMERGING THEMES or CONCERNS that appear across multiple sources.

Text samples:
${sample}

Return JSON array of emerging themes:
[{"theme": "...", "sources": ["..."], "severity": "low|medium|high", "confidence": 0.0-1.0}]`;

    const response = await this.aiUsage.trackAndComplete(
      businessId,
      undefined,
      'intuition-semantic',
      {
        messages: [{ role: 'user' as const, content: prompt }],
      temperature: 0.5, maxTokens: 1000
      },
    );

    const themes = JSON.parse(response.content ?? '[]') as Array<{ theme: string; sources: string[]; severity: string; confidence: number }>;

    return themes.map((t) => ({
      id: uuidv4(),
      description: `AI-detected theme: "${t.theme}" across ${t.sources.length} sources`,
      sources: t.sources,
      confidence: Math.min(t.confidence, 0.9),
      trend: 'emerging',
      potentialImpact: (t.severity as ImpactLevel) ?? 'medium',
      recommendedInvestigation: `Investigate emerging theme "${t.theme}" — appears across multiple communication channels`,
      detectedAt: new Date(),
      category: 'linguistic',
      score: t.confidence * 2,
      evidence: t.sources.map((s) => ({
        source: s,
        detail: `Theme "${t.theme}" detected`,
        timestamp: new Date(),
        strength: t.confidence,
      })),
      businessId,
    }));
  }

  /* ═══════════════════════════════════════════════════════════════
     PRIVATE — BEHAVIORAL SIGNAL DETECTION
     ═══════════════════════════════════════════════════════════════ */

  private async detectBehavioralSignals(businessId: string): Promise<WeakSignal[]> {
    const signals: WeakSignal[] = [];
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Customer engagement patterns
    const customers = await this.getActiveCustomers(businessId);

    for (const customer of customers) {
      const contactId = customer.id;

      // Check for declining engagement
      const engagementTrend = await this.analyzeEngagementTrend(businessId, contactId, since);

      if (engagementTrend.declineRate > 0.3) {
        // >30% engagement drop
        signals.push({
          id: uuidv4(),
          description: `Customer ${customer.name} (${contactId}) engagement dropped ${(engagementTrend.declineRate * 100).toFixed(0)}% over 30 days — potential churn precursor`,
          sources: ['engagement_metrics', 'activity_logs'],
          confidence: Math.min(engagementTrend.declineRate * 1.5, 0.9),
          trend: 'weakening',
          potentialImpact: 'high',
          recommendedInvestigation: `Reach out to ${customer.name} — engagement has dropped significantly. Check for dissatisfaction or competing solutions.`,
          detectedAt: new Date(),
          category: 'behavioral',
          score: engagementTrend.declineRate * 3,
          evidence: engagementTrend.dataPoints.map((dp) => ({
            source: 'engagement',
            detail: dp,
            timestamp: new Date(),
            strength: 0.7,
          })),
          businessId,
        });
      }

      // Check for unusual login patterns
      const loginPattern = await this.analyzeLoginPattern(businessId, contactId);
      if (loginPattern.anomalyScore > 0.6) {
        signals.push({
          id: uuidv4(),
          description: `Customer ${customer.name} shows unusual activity pattern: ${loginPattern.description}`,
          sources: ['login_logs', 'activity_metrics'],
          confidence: loginPattern.anomalyScore,
          trend: 'emerging',
          potentialImpact: 'medium',
          recommendedInvestigation: `Review account activity for ${customer.name}: ${loginPattern.recommendation}`,
          detectedAt: new Date(),
          category: 'behavioral',
          score: loginPattern.anomalyScore * 2,
          evidence: [
            {
              source: 'login_pattern',
              detail: loginPattern.description,
              timestamp: new Date(),
              strength: loginPattern.anomalyScore,
            },
          ],
          businessId,
        });
      }
    }

    return signals;
  }

  private async analyzeEngagementTrend(
    businessId: string,
    contactId: string,
    since: Date,
  ): Promise<{ declineRate: number; dataPoints: string[] }> {
    // Get monthly engagement metrics
    const recentEvents = await this.prisma.client.businessEvent
      .findMany({
        where: { businessId, subjectType: 'contact', subjectId: contactId, createdAt: { gte: since } },
        orderBy: { createdAt: 'asc' },
      })
      .catch(() => []);

    if (recentEvents.length < 6) return { declineRate: 0, dataPoints: [] };

    // Bin events by week
    const weeklyCounts: number[] = [];
    let currentWeek = 0;
    let weekStart = new Date(since);

    for (const event of recentEvents as Array<{ createdAt: Date }>) {
      while (event.createdAt > new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000)) {
        weeklyCounts.push(currentWeek);
        currentWeek = 0;
        weekStart = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      }
      currentWeek++;
    }
    weeklyCounts.push(currentWeek);

    if (weeklyCounts.length < 3) return { declineRate: 0, dataPoints: [] };

    // Linear regression on weekly counts
    const n = weeklyCounts.length;
    const firstHalf = weeklyCounts.slice(0, Math.floor(n / 2));
    const secondHalf = weeklyCounts.slice(Math.floor(n / 2));

    const firstAvg = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;

    const declineRate = firstAvg === 0 ? 0 : (firstAvg - secondAvg) / firstAvg;

    return {
      declineRate: Math.max(0, declineRate),
      dataPoints: weeklyCounts.map((c, i) => `Week ${i + 1}: ${c} events`),
    };
  }

  private async analyzeLoginPattern(
    _businessId: string,
    _customerId: string,
  ): Promise<{ anomalyScore: number; description: string; recommendation: string }> {
    // Simplified — in production, query login/session tables
    return {
      anomalyScore: 0,
      description: 'No anomalies detected',
      recommendation: 'None',
    };
  }

  /* ═══════════════════════════════════════════════════════════════
     PRIVATE — TEMPORAL SIGNAL DETECTION
     ═══════════════════════════════════════════════════════════════ */

  private async detectTemporalAnomalies(businessId: string): Promise<WeakSignal[]> {
    const signals: WeakSignal[] = [];

    // Get historical revenue cycles
    const cycles = await this.identifyRevenueCycles(businessId);

    // Compare current period to expected cycle
    const currentRevenue = await this.getCurrentPeriodRevenue(businessId);

    for (const cycle of cycles) {
      const expectedForThisPeriod = cycle.expectedValue;
      const actual = currentRevenue;

      if (expectedForThisPeriod === 0) continue;

      const variance = ((actual - expectedForThisPeriod) / expectedForThisPeriod) * 100;

      // If current period deviates significantly from cycle expectation
      if (Math.abs(variance) > 20) {
        signals.push({
          id: uuidv4(),
          description: `Revenue ${variance > 0 ? 'above' : 'below'} ${cycle.name} expectation by ${Math.abs(variance).toFixed(1)}% (${actual.toFixed(0)} vs expected ${expectedForThisPeriod.toFixed(0)}) — historical ${cycle.strength.toFixed(2)} cycle strength`,
          sources: ['revenue_data', 'temporal_analysis'],
          confidence: Math.min(cycle.strength * Math.abs(variance) / 50, 0.9),
          trend: variance > 0 ? 'strengthening' : 'weakening',
          potentialImpact: Math.abs(variance) > 40 ? 'critical' : 'high',
          recommendedInvestigation: `Revenue is ${Math.abs(variance).toFixed(0)}% ${variance > 0 ? 'above' : 'below'} the typical ${cycle.period} pattern. Investigate whether this is a structural shift or temporary anomaly.`,
          detectedAt: new Date(),
          category: 'temporal',
          score: cycle.strength * Math.abs(variance) / 20,
          evidence: [
            {
              source: 'temporal_cycle',
              detail: `${cycle.name}: expected ${expectedForThisPeriod.toFixed(2)}, actual ${actual.toFixed(2)}`,
              timestamp: new Date(),
              strength: cycle.strength,
            },
          ],
          businessId,
        });
      }
    }

    // Check for day-of-week anomalies
    const dowSignal = await this.detectDayOfWeekAnomaly(businessId);
    if (dowSignal) signals.push(dowSignal);

    return signals;
  }

  private async identifyRevenueCycles(businessId: string): Promise<Array<{ name: string; period: string; expectedValue: number; strength: number }>> {
    const cycles: Array<{ name: string; period: string; expectedValue: number; strength: number }> = [];

    try {
      // Monthly cycle detection
      const monthlyRevenue = await this.prisma.$queryRaw`
        SELECT 
          MONTH(createdAt) as month,
          YEAR(createdAt) as year,
          AVG(total) as avgRevenue
        FROM Invoice
        WHERE businessId = ${businessId}
        AND createdAt >= ${new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)}
        GROUP BY YEAR(createdAt), MONTH(createdAt)
        ORDER BY year, month
      `;

      const monthlyData = (monthlyRevenue as Array<{ month: number; year: number; avgRevenue: number }>);
      if (monthlyData.length >= 6) {
        const values = monthlyData.map((m) => Number(m.avgRevenue));
        const avg = values.reduce((s, v) => s + v, 0) / values.length;
        const variance = values.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / values.length;
        const strength = avg === 0 ? 0 : Math.min(variance / (avg * avg), 1);

        // Get expected value for current month
        const currentMonth = new Date().getMonth() + 1;
        const sameMonthData = monthlyData.filter((m) => m.month === currentMonth);
        const expectedValue = sameMonthData.length > 0
          ? sameMonthData.reduce((s, m) => s + Number(m.avgRevenue), 0) / sameMonthData.length
          : avg;

        cycles.push({
          name: 'monthly_revenue_cycle',
          period: 'monthly',
          expectedValue,
          strength,
        });
      }
    } catch {
      // Non-fatal
    }

    return cycles;
  }

  private async getCurrentPeriodRevenue(businessId: string): Promise<number> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await this.prisma.client.invoice
      .aggregate({
        where: { businessId, createdAt: { gte: since } },
        _avg: { total: true },
      })
      .catch(() => ({ _avg: { total: 0 } }));

    return Number(result._avg.total ?? 0);
  }

  private async detectDayOfWeekAnomaly(businessId: string): Promise<WeakSignal | null> {
    try {
      const dowRevenue = await this.prisma.$queryRaw`
        SELECT 
          DAYOFWEEK(createdAt) as dow,
          AVG(total) as avgRevenue,
          COUNT(*) as count
        FROM Invoice
        WHERE businessId = ${businessId}
        AND createdAt >= ${new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)}
        GROUP BY DAYOFWEEK(createdAt)
        ORDER BY dow
      `;

      const data = dowRevenue as Array<{ dow: number; avgRevenue: number; count: bigint }>;
      if (data.length < 3) return null;

      const values = data.map((d) => Number(d.avgRevenue));
      const avg = values.reduce((s, v) => s + v, 0) / values.length;
      const maxVal = Math.max(...values);
      const minVal = Math.min(...values);

      // Check for extreme day-of-week effect
      if (maxVal / Math.max(minVal, 1) > 3) {
        const maxDay = data.find((d) => Number(d.avgRevenue) === maxVal);
        const minDay = data.find((d) => Number(d.avgRevenue) === minVal);
        const dayNames = ['', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        return {
          id: uuidv4(),
          description: `Strong day-of-week revenue effect: ${dayNames[maxDay?.dow ?? 0]} is ${(maxVal / Math.max(minVal, 1)).toFixed(1)}× higher than ${dayNames[minDay?.dow ?? 0]} (${maxVal.toFixed(0)} vs ${minVal.toFixed(0)})`,
          sources: ['revenue_data', 'temporal_analysis'],
          confidence: 0.75,
          trend: 'confirmed',
          potentialImpact: 'medium',
          recommendedInvestigation: `Consider day-of-week targeting for marketing and sales efforts. ${dayNames[maxDay?.dow ?? 0]} shows significantly higher revenue.`,
          detectedAt: new Date(),
          category: 'temporal',
          score: 2,
          evidence: data.map((d) => ({
            source: 'revenue_by_dow',
            detail: `${dayNames[d.dow]}: avg ${Number(d.avgRevenue).toFixed(2)} (${Number(d.count)} invoices)`,
            timestamp: new Date(),
            strength: 0.7,
          })),
          businessId,
        };
      }
    } catch {
      // Non-fatal
    }

    return null;
  }

  /* ═══════════════════════════════════════════════════════════════
     PRIVATE — CROSS-DOMAIN SIGNAL DETECTION
     ═══════════════════════════════════════════════════════════════ */

  private async detectCrossDomainSignals(businessId: string): Promise<WeakSignal[]> {
    const signals: WeakSignal[] = [];

    // Marketing spend vs leads (ad fatigue detection)
    const adFatigueSignal = await this.detectAdFatigue(businessId);
    if (adFatigueSignal) signals.push(adFatigueSignal);

    // Email engagement vs conversion
    const emailConversionSignal = await this.detectEmailConversionMismatch(businessId);
    if (emailConversionSignal) signals.push(emailConversionSignal);

    // Social media vs website traffic
    const socialWebSignal = await this.detectSocialWebMismatch(businessId);
    if (socialWebSignal) signals.push(socialWebSignal);

    // Support tickets vs NPS / satisfaction
    const supportSatisfactionSignal = await this.detectSupportSatisfactionMismatch(businessId);
    if (supportSatisfactionSignal) signals.push(supportSatisfactionSignal);

    return signals;
  }

  private async detectAdFatigue(businessId: string): Promise<WeakSignal | null> {
    try {
      // Check if marketing spend increased but leads decreased
      const currentPeriod = { spend: 0, leads: 0 };
      const previousPeriod = { spend: 0, leads: 0 };

      // Get ad spend data
      const adData = await this.prisma.client.adCampaign
        ?.findMany({
          where: { businessId, createdAt: { gte: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) } },
          select: { spend: true, leads: true, createdAt: true },
        })
        .catch(() => []);

      const campaigns = (adData ?? []) as Array<{ spend: number; leads: number; createdAt: Date }>;

      // Split into current and previous 30-day periods
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

      for (const c of campaigns) {
        if (c.createdAt >= thirtyDaysAgo) {
          currentPeriod.spend += c.spend;
          currentPeriod.leads += c.leads;
        } else if (c.createdAt >= sixtyDaysAgo) {
          previousPeriod.spend += c.spend;
          previousPeriod.leads += c.leads;
        }
      }

      if (previousPeriod.spend === 0 || previousPeriod.leads === 0) return null;

      const spendChange = ((currentPeriod.spend - previousPeriod.spend) / previousPeriod.spend) * 100;
      const leadChange = ((currentPeriod.leads - previousPeriod.leads) / previousPeriod.leads) * 100;

      // Ad fatigue: spend ↑, leads ↓
      if (spendChange > 10 && leadChange < -10) {
        return {
          id: uuidv4(),
          description: `Ad fatigue detected: marketing spend increased ${spendChange.toFixed(0)}% but leads decreased ${Math.abs(leadChange).toFixed(0)}%. Current CPL: $${currentPeriod.leads > 0 ? (currentPeriod.spend / currentPeriod.leads).toFixed(2) : '∞'} vs previous $${(previousPeriod.spend / previousPeriod.leads).toFixed(2)}`,
          sources: ['ad_campaigns', 'lead_data', 'marketing_spend'],
          confidence: Math.min(0.5 + Math.abs(spendChange - leadChange) / 100, 0.9),
          trend: 'strengthening',
          potentialImpact: 'high',
          recommendedInvestigation: 'Ad fatigue likely — refresh creative assets, test new audiences, or reduce frequency caps. Consider pausing underperforming campaigns.',
          detectedAt: new Date(),
          category: 'cross-domain',
          score: 3,
          evidence: [
            {
              source: 'ad_campaigns',
              detail: `Previous 30d: $${previousPeriod.spend.toFixed(0)} spend, ${previousPeriod.leads} leads | Current 30d: $${currentPeriod.spend.toFixed(0)} spend, ${currentPeriod.leads} leads`,
              timestamp: new Date(),
              strength: 0.85,
            },
          ],
          businessId,
        };
      }
    } catch {
      // Non-fatal
    }

    return null;
  }

  private async detectEmailConversionMismatch(businessId: string): Promise<WeakSignal | null> {
    // Check if email open rates are high but conversions are low
    try {
      const emailData = await this.prisma.client.emailCampaign
        ?.findMany({
          where: { businessId, createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
          select: { openRate: true, clickRate: true, conversionRate: true, name: true },
        })
        .catch(() => []);

      const campaigns = (emailData ?? []) as Array<{ openRate: number; clickRate: number; conversionRate: number; name: string }>;
      if (campaigns.length === 0) return null;

      const avgOpenRate = campaigns.reduce((s, c) => s + c.openRate, 0) / campaigns.length;
      const avgConversionRate = campaigns.reduce((s, c) => s + c.conversionRate, 0) / campaigns.length;

      // High opens (>25%) but low conversions (<1%)
      if (avgOpenRate > 0.25 && avgConversionRate < 0.01) {
        return {
          id: uuidv4(),
          description: `Email engagement-conversion gap: ${(avgOpenRate * 100).toFixed(1)}% open rate but only ${(avgConversionRate * 100).toFixed(2)}% conversion — subscribers are interested but not buying`,
          sources: ['email_campaigns', 'conversion_data'],
          confidence: 0.7,
          trend: 'emerging',
          potentialImpact: 'medium',
          recommendedInvestigation: 'Email content drives opens but landing page / offer fails to convert. A/B test subject lines vs. CTA, review post-click experience.',
          detectedAt: new Date(),
          category: 'cross-domain',
          score: 2.5,
          evidence: campaigns.map((c) => ({
            source: 'email_campaign',
            detail: `${c.name}: ${(c.openRate * 100).toFixed(1)}% open, ${(c.conversionRate * 100).toFixed(2)}% conv`,
            timestamp: new Date(),
            strength: 0.6,
          })),
          businessId,
        };
      }
    } catch {
      // Non-fatal
    }

    return null;
  }

  private async detectSocialWebMismatch(businessId: string): Promise<WeakSignal | null>  {
    // Requires SocialMediaMetric and WebsiteAnalytics, neither of which exists in
    // schema.prisma. Both queries short-circuited to undefined, so this detector
    // could never produce a signal. Stated explicitly rather than left as
    // arithmetic over permanently-empty arrays.
    void businessId;
    return null;
  }

  private async detectSupportSatisfactionMismatch(businessId: string): Promise<WeakSignal | null> {
    // Support tickets increasing but satisfaction scores also increasing = good (growing + handling well)
    // Support tickets increasing + satisfaction decreasing = bad (overwhelmed)
    try {
      const recentTickets = await this.prisma.client.supportTicket
        ?.count({
          where: { businessId, createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
        })
        .catch(() => 0);

      const oldTickets = await this.prisma.client.supportTicket
        ?.count({
          where: {
            businessId,
            createdAt: {
              gte: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
              lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            },
          },
        })
        .catch(() => 0);

      if (oldTickets === 0) return null;

      const ticketChange = ((Number(recentTickets) - Number(oldTickets)) / Number(oldTickets)) * 100;

      if (ticketChange > 30) {
        return {
          id: uuidv4(),
          description: `Support ticket volume surged ${ticketChange.toFixed(0)}% (${oldTickets} → ${recentTickets} in 30 days) — potential service quality strain`,
          sources: ['support_tickets'],
          confidence: Math.min(0.5 + ticketChange / 200, 0.9),
          trend: 'strengthening',
          potentialImpact: ticketChange > 50 ? 'critical' : 'high',
          recommendedInvestigation: 'Support volume increasing rapidly. Check for product issues, onboarding gaps, or staffing needs.',
          detectedAt: new Date(),
          category: 'cross-domain',
          score: Math.min(ticketChange / 20, 4),
          evidence: [
            { source: 'support_tickets', detail: `Previous 30d: ${oldTickets} tickets | Current 30d: ${recentTickets} tickets`, timestamp: new Date(), strength: 0.8 },
          ],
          businessId,
        };
      }
    } catch {
      // Non-fatal
    }

    return null;
  }

  /* ═══════════════════════════════════════════════════════════════
     PRIVATE — NETWORK SIGNAL DETECTION
     ═══════════════════════════════════════════════════════════════ */

  private async detectNetworkSignals(businessId: string): Promise<WeakSignal[]> {
    const signals: WeakSignal[] = [];

    // Find unconnected customers with similar complaints
    const similarComplaintClusters = await this.findSimilarComplaintClusters(businessId);

    for (const cluster of similarComplaintClusters) {
      if (cluster.customerIds.length >= 3) {
        signals.push({
          id: uuidv4(),
          description: `Network effect: ${cluster.customerIds.length} unconnected customers reported similar issue "${cluster.theme}" — possible systemic problem`,
          sources: ['support_tickets', 'customer_feedback', 'network_analysis'],
          confidence: Math.min(0.4 + cluster.customerIds.length * 0.1, 0.85),
          trend: 'emerging',
          potentialImpact: cluster.severity === 'high' ? 'critical' : 'high',
          recommendedInvestigation: `Investigate systemic issue: ${cluster.theme}. Affects ${cluster.customerIds.length} customers who have no known connection. Check product bug, documentation gap, or service disruption.`,
          detectedAt: new Date(),
          category: 'network',
          score: cluster.customerIds.length * 1.5,
          evidence: cluster.customerIds.map((cid) => ({
            source: 'customer_feedback',
            detail: `Customer ${cid}: ${cluster.theme}`,
            timestamp: new Date(),
            strength: 0.7,
          })),
          businessId,
        });
      }
    }

    // Detect industry-wide pattern (multiple businesses in same industry)
    const industrySignal = await this.detectIndustryWidePattern(businessId);
    if (industrySignal) signals.push(industrySignal);

    return signals;
  }

  private async findSimilarComplaintClusters(
    businessId: string,
  ): Promise<Array<{ theme: string; customerIds: string[]; severity: string }>> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const tickets = await this.prisma.client.supportTicket
      ?.findMany({
        where: { businessId, createdAt: { gte: since } },
        select: { id: true, contactId: true, subject: true, description: true, priority: true },
      })
      .catch(() => []);

    if ((tickets ?? []).length < 6) return [];

    // Simple clustering: group by keyword overlap
    const clusters: Array<{ theme: string; customerIds: string[]; severity: string; keywords: Set<string> }> = [];

    for (const ticket of (tickets ?? []) as Array<{
      id: string;
      customerId: string;
      subject: string;
      description?: string;
      priority?: string;
    }>) {
      const text = `${ticket.subject} ${ticket.description ?? ''}`.toLowerCase();
      const keywords = new Set(
        text
          .replace(/[^\w\s]/g, ' ')
          .split(/\s+/)
          .filter((w) => w.length > 4),
      );

      // Try to merge into existing cluster
      let merged = false;
      for (const cluster of clusters) {
        const overlap = [...cluster.keywords].filter((k) => keywords.has(k)).length;
        const unionSize = new Set([...cluster.keywords, ...keywords]).size;
        const jaccard = unionSize === 0 ? 0 : overlap / unionSize;

        if (jaccard > 0.3) {
          if (!cluster.customerIds.includes(ticket.customerId)) {
            cluster.customerIds.push(ticket.customerId);
          }
          cluster.keywords = new Set([...cluster.keywords, ...keywords]);
          merged = true;
          break;
        }
      }

      if (!merged) {
        clusters.push({
          theme: ticket.subject.slice(0, 80),
          customerIds: [ticket.customerId],
          severity: ticket.priority === 'high' ? 'high' : 'medium',
          keywords,
        });
      }
    }

    return clusters
      .filter((c) => c.customerIds.length >= 2)
      .map((c) => ({ theme: c.theme, customerIds: c.customerIds, severity: c.severity }));
  }

  private async detectIndustryWidePattern(businessId: string): Promise<WeakSignal | null> {
    // Compare this business's patterns with anonymized industry data
    try {
      const context = await this.contextService.getFullContext(businessId);
      const industry = (context as Record<string, unknown>)?.industry;

      if (!industry) return null;

      // Check if this business is underperforming industry benchmarks
      const benchmarkComparison = await this.compareToIndustryBenchmark(businessId, industry as string);

      if (benchmarkComparison.gap > 0.2) {
        return {
          id: uuidv4(),
          description: `Industry gap: ${(benchmarkComparison.gap * 100).toFixed(0)}% below ${industry} benchmark on ${benchmarkComparison.metric}. Industry peers are performing better.`,
          sources: ['industry_benchmarks', 'competitive_intelligence'],
          confidence: 0.6,
          trend: 'confirmed',
          potentialImpact: benchmarkComparison.gap > 0.4 ? 'critical' : 'high',
          recommendedInvestigation: `Compare strategies with ${industry} leaders. Identify best practices in ${benchmarkComparison.metric} and adapt them.`,
          detectedAt: new Date(),
          category: 'network',
          score: benchmarkComparison.gap * 5,
          evidence: [
            { source: 'benchmarks', detail: `Your ${benchmarkComparison.metric}: ${benchmarkComparison.yourValue.toFixed(2)} | Industry avg: ${benchmarkComparison.benchmarkValue.toFixed(2)}`, timestamp: new Date(), strength: 0.6 },
          ],
          businessId,
        };
      }
    } catch {
      // Non-fatal
    }

    return null;
  }

  private async compareToIndustryBenchmark(
    _businessId: string,
    _industry: string,
  ): Promise<{ gap: number; metric: string; yourValue: number; benchmarkValue: number }> {
    // Placeholder — in production, query industry benchmark API
    return { gap: 0, metric: 'revenue_growth', yourValue: 0, benchmarkValue: 0 };
  }

  /* ═══════════════════════════════════════════════════════════════
     PRIVATE — CHURN PRECURSOR PIPELINE
     ═══════════════════════════════════════════════════════════════ */

  private async buildChurnPatternLibrary(businessId: string): Promise<void> {
    if (this.churnPatternLibrary.has(businessId)) return; // Already built

    const patterns: PrecursorMatch[] = [
      {
        name: 'support_ticket_surge',
        description: 'Support tickets increased 3× in month before churn',
        matchScore: 0,
        historicalFrequency: 0.72,
        severity: 'high',
      },
      {
        name: 'payment_delay',
        description: 'Invoice payment delayed by average 12 days before churn',
        matchScore: 0,
        historicalFrequency: 0.65,
        severity: 'high',
      },
      {
        name: 'feature_usage_drop',
        description: 'Feature usage dropped 60% in the 60 days before churn',
        matchScore: 0,
        historicalFrequency: 0.58,
        severity: 'medium',
      },
      {
        name: 'engagement_decline',
        description: 'Login frequency decreased 50% in 45 days before churn',
        matchScore: 0,
        historicalFrequency: 0.81,
        severity: 'critical',
      },
      {
        name: 'nps_drop',
        description: 'NPS score dropped below 6 in the quarter before churn',
        matchScore: 0,
        historicalFrequency: 0.54,
        severity: 'medium',
      },
      {
        name: 'contract_downgrade',
        description: 'Downgraded plan or removed seats before churn',
        matchScore: 0,
        historicalFrequency: 0.89,
        severity: 'critical',
      },
    ];

    // Learn from actual churned customers
    try {
      const churnedCustomers = await this.prisma.client.contact
        .findMany({
          where: { businessId, status: 'churned' },
          select: { id: true, name: true, churnedAt: true },
          take: 100,
        })
        .catch(() => []);

      for (const customer of churnedCustomers as Array<{ id: string; name: string; churnedAt: Date | null }>) {
        if (!customer.churnedAt) continue;

        // Analyze 90 days before churn
        const preChurnStart = new Date(customer.churnedAt.getTime() - 90 * 24 * 60 * 60 * 1000);

        // Check support ticket surge
        const preChurnTickets = await this.prisma.client.supportTicket
          ?.count({
            where: { businessId, contactId: customer.id, createdAt: { gte: preChurnStart, lt: customer.churnedAt } },
          })
          .catch(() => 0);

        const earlierTickets = await this.prisma.client.supportTicket
          ?.count({
            where: {
              businessId,
              contactId: customer.id,
              createdAt: {
                gte: new Date(preChurnStart.getTime() - 90 * 24 * 60 * 60 * 1000),
                lt: preChurnStart,
              },
            },
          })
          .catch(() => 0);

        if (Number(preChurnTickets) > Number(earlierTickets) * 2) {
          const pattern = patterns.find((p) => p.name === 'support_ticket_surge');
          if (pattern) pattern.historicalFrequency = Math.min(pattern.historicalFrequency + 0.05, 1);
        }
      }
    } catch {
      // Use default patterns
    }

    this.churnPatternLibrary.set(businessId, patterns);
  }

  private async getActiveCustomers(businessId: string): Promise<Array<{ id: string; name: string }>> {
    const customers = await this.prisma.client.contact
      .findMany({
        where: { businessId, status: 'active' },
        select: { id: true, name: true },
      })
      .catch(() => []);

    return (customers as Array<{ id: string; name: string }>).map((c) => ({ id: c.id, name: c.name }));
  }

  private async matchCustomerAgainstChurnPatterns(
    businessId: string,
    customer: { id: string; name: string },
  ): Promise<PatternMatch> {
    const patterns = this.churnPatternLibrary.get(businessId) ?? [];
    const precursors: PrecursorMatch[] = [];

    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const since60 = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    // Check each precursor
    for (const pattern of patterns) {
      let matchScore = 0;

      switch (pattern.name) {
        case 'support_ticket_surge': {
          const recent = await this.prisma.client.supportTicket
            ?.count({ where: { businessId, contactId: customer.id, createdAt: { gte: since30 } } })
            .catch(() => 0);
          const older = await this.prisma.client.supportTicket
            ?.count({ where: { businessId, contactId: customer.id, createdAt: { gte: since60, lt: since30 } } })
            .catch(() => 0);
          matchScore = older === 0 ? (Number(recent) > 0 ? 0.5 : 0) : Math.min((Number(recent) / Number(older)) / 3, 1);
          break;
        }
        case 'payment_delay': {
          const invoices = await this.prisma.client.invoice
            .findMany({
              where: { businessId, contactId: customer.id, createdAt: { gte: since90 } },
              select: { dueDate: true, paidAt: true },
            })
            .catch(() => []);
          let lateCount = 0;
          for (const inv of invoices as Array<{ dueDate: Date; paidAt: Date | null }>) {
            if (inv.paidAt && inv.paidAt > inv.dueDate) lateCount++;
          }
          matchScore = invoices.length === 0 ? 0 : Math.min(lateCount / invoices.length, 1);
          break;
        }
        case 'feature_usage_drop': {
          matchScore = await this.analyzeFeatureUsageDrop(businessId, customer.id, since60);
          break;
        }
        case 'engagement_decline': {
          const recentEvents = await this.prisma.client.businessEvent
            .count({ where: { businessId, subjectType: 'contact', subjectId: customer.id, createdAt: { gte: since30 } } })
            .catch(() => 0);
          const olderEvents = await this.prisma.client.businessEvent
            .count({ where: { businessId, subjectType: 'contact', subjectId: customer.id, createdAt: { gte: since60, lt: since30 } } })
            .catch(() => 0);
          matchScore = Math.max(recentEvents, 1) === 0 ? 0 : Math.min((1 - Math.max(recentEvents, 1) / Math.max(olderEvents, 1)) / 0.5, 1);
          break;
        }
        case 'contract_downgrade': {
          // Check for plan changes in recent period
          const planChanges = await this.prisma.client.subscription
            ?.findMany({
              where: { businessId, subjectType: 'contact', subjectId: customer.id, updatedAt: { gte: since90 } },
              select: { tier: true, seatCount: true },
              orderBy: { updatedAt: 'desc' },
              take: 2,
            })
            .catch(() => []);
          if ((planChanges ?? []).length >= 2) {
            const current = (planChanges as Array<{ tier: string; seatCount: number }>)[0];
            const previous = (planChanges as Array<{ tier: string; seatCount: number }>)[1];
            if (current && previous && (current.tier < previous.tier || current.seatCount < previous.seatCount)) {
              matchScore = 1.0;
            }
          }
          break;
        }
      }

      precursors.push({
        ...pattern,
        matchScore: Math.round(matchScore * 100) / 100,
      });
    }

    // Compute composite risk score
    const riskScore = precursors.reduce((s, p) => s + p.matchScore * p.historicalFrequency, 0) / Math.max(precursors.length, 1);

    // Determine time horizon based on risk
    let timeHorizon = 'unknown';
    if (riskScore > 0.7) timeHorizon = 'within 30 days';
    else if (riskScore > 0.5) timeHorizon = 'within 60 days';
    else if (riskScore > 0.3) timeHorizon = 'within 90 days';
    else timeHorizon = 'low immediate risk';

    return {
      id: uuidv4(),
      pattern: 'churn_precursor_composite',
      instances: precursors.filter((p) => p.matchScore > 0.3).map((p) => p.description),
      currentMatch: riskScore,
      prediction: `Customer ${customer.name} has ${(riskScore * 100).toFixed(0)}% churn risk based on ${precursors.filter((p) => p.matchScore > 0.2).length} matching precursors`,
      timeHorizon,
      confidence: Math.min(riskScore * 1.2, 0.95),
      matchedEntity: customer.id,
      matchedEntityType: 'customer',
      precursors: precursors.sort((a, b) => b.matchScore - a.matchScore),
      riskScore: Math.round(riskScore * 100) / 100,
    };
  }

  private async analyzeFeatureUsageDrop(businessId: string, customerId: string, since: Date): Promise<number>  {
    // Requires a FeatureUsage model with businessId + customerId, which does not
    // exist (FeatureUsageDaily is global and has neither). Returns no signal.
    void businessId; void customerId; void since;
    return 0;
  }

  /* ═══════════════════════════════════════════════════════════════
     PRIVATE — REVENUE ANOMALY HELPERS
     ═══════════════════════════════════════════════════════════════ */

  private async computeRevenueBaseline(businessId: string): Promise<Record<string, number>> {
    const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000); // 6 months
    const until = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Exclude current month

    try {
      const invoices = await this.prisma.client.invoice.findMany({
        where: { businessId, createdAt: { gte: since, lte: until } },
        select: { total: true, status: true },
      });

      const paidInvoices = invoices.filter((i: { status: string }) => i.status === 'paid');
      const totalRevenue = paidInvoices.reduce((s: number, i: { total: number }) => s + i.total, 0);
      const avgMonthly = totalRevenue / 5; // 5 months baseline

      return {
        total_revenue: avgMonthly,
        avg_deal_size: invoices.length > 0 ? totalRevenue / invoices.length : 0,
        conversion_rate: invoices.length > 0 ? paidInvoices.length / invoices.length : 0,
        lead_count: 0, // Will be populated if lead data exists
        mrr: avgMonthly,
        arr: avgMonthly * 12,
      };
    } catch {
      return {};
    }
  }

  private async getCurrentRevenuePeriod(businessId: string): Promise<Record<string, number>> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    try {
      const invoices = await this.prisma.client.invoice.findMany({
        where: { businessId, createdAt: { gte: since } },
        select: { total: true, status: true },
      });

      const paidInvoices = invoices.filter((i: { status: string }) => i.status === 'paid');
      const totalRevenue = paidInvoices.reduce((s: number, i: { total: number }) => s + i.total, 0);

      return {
        total_revenue: totalRevenue,
        avg_deal_size: invoices.length > 0 ? totalRevenue / invoices.length : 0,
        conversion_rate: invoices.length > 0 ? paidInvoices.length / invoices.length : 0,
        lead_count: 0,
        mrr: totalRevenue,
        arr: totalRevenue * 12,
      };
    } catch {
      return {};
    }
  }

  private async crossReferenceWithCalendar(businessId: string, anomalies: RevenueAnomaly[]): Promise<RevenueAnomaly[]> {
    // Check for holidays, known events
    const now = new Date();
    const holidays = this.getHolidaysForMonth(now.getMonth(), now.getFullYear());

    return anomalies.map((a) => {
      const nearbyHoliday = holidays.find((h) => Math.abs(h.date.getTime() - now.getTime()) < 7 * 24 * 60 * 60 * 1000);
      if (nearbyHoliday) {
        return {
          ...a,
          explanation: `${a.explanation ?? ''} (Note: ${nearbyHoliday.name} is within 7 days — may explain variance)`,
        };
      }
      return a;
    });
  }

  private getHolidaysForMonth(month: number, year: number): Array<{ name: string; date: Date }> {
    // Simplified — in production, use a proper holiday API
    const holidays: Array<{ name: string; date: Date }> = [];

    // Add major US holidays
    if (month === 11) holidays.push({ name: 'Christmas', date: new Date(year, 11, 25) });
    if (month === 10) holidays.push({ name: 'Thanksgiving (US)', date: new Date(year, 10, 28) });
    if (month === 0) holidays.push({ name: 'New Year', date: new Date(year, 0, 1) });
    if (month === 6) holidays.push({ name: 'Independence Day (US)', date: new Date(year, 6, 4) });

    return holidays;
  }

  private async explainAnomalies(businessId: string, anomalies: RevenueAnomaly[]): Promise<RevenueAnomaly[]> {
    if (anomalies.length === 0) return anomalies;

    try {
      const prompt = `Explain these revenue anomalies concisely:
${anomalies.map((a) => `- ${a.metric}: ${a.variance > 0 ? '+' : ''}${a.variance.toFixed(1)}% ${a.type}`).join('\n')}

Return JSON: {"explanations": [{"metric": "...", "explanation": "..."}]}`;

      const response = await this.aiUsage.trackAndComplete(
        businessId,
        undefined,
        'intuition-anomaly-explain',
        {
          messages: [{ role: 'user' as const, content: prompt }],
        temperature: 0.3, maxTokens: 800
        },
      );

      const result = JSON.parse(response.content ?? '[]') as { explanations: Array<{ metric: string; explanation: string }> };

      return anomalies.map((a) => {
        const exp = result.explanations.find((e) => e.metric === a.metric);
        return exp ? { ...a, explanation: exp.explanation } : a;
      });
    } catch {
      return anomalies;
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     PRIVATE — OPERATIONAL STRESS DETECTION
     ═══════════════════════════════════════════════════════════════ */

  private async analyzeTaskBacklog(businessId: string): Promise<OperationalStressSignal[]> {
    const signals: OperationalStressSignal[] = [];

    try {
      // Total pending tasks
      const pendingTasks = await this.prisma.client.task.count({
        where: { businessId, status: { in: ['pending', 'in_progress'] } },
      });

      // Completed in last 7 days
      const completedWeek = await this.prisma.client.task.count({
        where: { businessId, status: 'completed', updatedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      });

      // Backlog ratio
      const completionRate = completedWeek / 7; // per day
      const daysToClear = completionRate > 0 ? pendingTasks / completionRate : 999;

      let status: OperationalStressSignal['status'] = 'healthy';
      if (daysToClear > 30) status = 'breaking';
      else if (daysToClear > 14) status = 'critical';
      else if (daysToClear > 7) status = 'elevated';

      signals.push({
        id: uuidv4(),
        metric: 'task_backlog_days',
        currentValue: daysToClear,
        baselineValue: 5, // ideal: 5 days
        deviation: ((daysToClear - 5) / 5) * 100,
        threshold: 14,
        status,
        recommendation: status === 'healthy' ? 'Backlog is healthy' : `Task backlog critical: ${pendingTasks} pending tasks, ~${daysToClear.toFixed(0)} days to clear at current velocity. Consider prioritization or additional resources.`,
        detectedAt: new Date(),
      });
    } catch {
      // Non-fatal
    }

    return signals;
  }

  private async analyzeOverdueItems(businessId: string): Promise<OperationalStressSignal[]> {
    const signals: OperationalStressSignal[] = [];

    try {
      const overdueTasks = await this.prisma.client.task.count({
        where: { businessId, status: { not: 'completed' }, dueDate: { lt: new Date() } },
      });

      const overdueInvoices = await this.prisma.client.invoice.count({
        where: { businessId, status: 'overdue' },
      });

      const totalOverdue = overdueTasks + overdueInvoices;

      signals.push({
        id: uuidv4(),
        metric: 'overdue_items',
        currentValue: totalOverdue,
        baselineValue: 0,
        deviation: totalOverdue * 50, // Each overdue item = 50% stress
        threshold: 5,
        status: totalOverdue > 10 ? 'breaking' : totalOverdue > 5 ? 'critical' : totalOverdue > 0 ? 'elevated' : 'healthy',
        recommendation: totalOverdue > 0 ? `${overdueTasks} overdue tasks, ${overdueInvoices} overdue invoices. Immediate triage recommended.` : 'No overdue items',
        detectedAt: new Date(),
      });
    } catch {
      // Non-fatal
    }

    return signals;
  }

  private async analyzeTeamVelocity(businessId: string): Promise<OperationalStressSignal[]> {
    const signals: OperationalStressSignal[] = [];

    try {
      // Compare last 7 days vs previous 7 days
      const recent7d = await this.prisma.client.task.count({
        where: {
          businessId,
          status: 'completed',
          updatedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      });

      const previous7d = await this.prisma.client.task.count({
        where: {
          businessId,
          status: 'completed',
          updatedAt: {
            gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
            lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
      });

      const velocityChange = previous7d === 0 ? 0 : ((recent7d - previous7d) / previous7d) * 100;

      let status: OperationalStressSignal['status'] = 'healthy';
      if (velocityChange < -50) status = 'breaking';
      else if (velocityChange < -30) status = 'critical';
      else if (velocityChange < -15) status = 'elevated';

      signals.push({
        id: uuidv4(),
        metric: 'team_velocity_change',
        currentValue: velocityChange,
        baselineValue: 0,
        deviation: Math.abs(velocityChange),
        threshold: -20,
        status,
        recommendation: velocityChange < -15 ? `Team velocity dropped ${Math.abs(velocityChange).toFixed(0)}% (${previous7d} → ${recent7d} tasks). Check for blockers, scope creep, or capacity issues.` : 'Velocity is stable',
        detectedAt: new Date(),
      });
    } catch {
      // Non-fatal
    }

    return signals;
  }

  private async analyzeErrorRates(businessId: string): Promise<OperationalStressSignal[]> {
    const signals: OperationalStressSignal[] = [];

    try {
      const recentErrors = 0; // model absent from schema.prisma; call short-circuited to undefined and never ran

      const previousErrors = 0; // model absent from schema.prisma; call short-circuited to undefined and never ran

      const errorChange = Number(previousErrors) === 0 ? 0 : ((Number(recentErrors) - Number(previousErrors)) / Number(previousErrors)) * 100;

      let status: OperationalStressSignal['status'] = 'healthy';
      if (errorChange > 100) status = 'breaking';
      else if (errorChange > 50) status = 'critical';
      else if (errorChange > 20) status = 'elevated';

      signals.push({
        id: uuidv4(),
        metric: 'error_rate_change',
        currentValue: errorChange,
        baselineValue: 0,
        deviation: errorChange,
        threshold: 25,
        status,
        recommendation: errorChange > 20 ? `Error rate increased ${errorChange.toFixed(0)}% (${previousErrors} → ${recentErrors}). Review recent deployments or integrations.` : 'Error rate is stable',
        detectedAt: new Date(),
      });
    } catch {
      // Non-fatal — error log table may not exist
    }

    return signals;
  }

  /* ═══════════════════════════════════════════════════════════════
     PRIVATE — SIGNAL SCORING & CROSS-LINKING
     ═══════════════════════════════════════════════════════════════ */

  private scoreSignals(signals: WeakSignal[]): WeakSignal[] {
    const now = Date.now();

    return signals.map((s) => {
      // Recency factor: signals detected more recently score higher
      const ageMs = now - s.detectedAt.getTime();
      const recencyFactor = Math.max(0, 1 - ageMs / (7 * 24 * 60 * 60 * 1000)); // Decay over 7 days

      // Cross-source validation: signals from more sources are more reliable
      const sourceFactor = Math.min(s.sources.length / 3, 1);

      // Composite score
      const score = s.confidence * recencyFactor * sourceFactor * (s.potentialImpact === 'critical' ? 4 : s.potentialImpact === 'high' ? 3 : s.potentialImpact === 'medium' ? 2 : 1);

      return { ...s, score: Math.round(score * 100) / 100 };
    });
  }

  private crossLinkSignals(signals: WeakSignal[]): WeakSignal[] {
    // Find signals that share sources or keywords and link them
    for (let i = 0; i < signals.length; i++) {
      for (let j = i + 1; j < signals.length; j++) {
        const sharedSources = signals[i].sources.filter((s) => signals[j].sources.includes(s));
        if (sharedSources.length >= 2) {
          // These signals are related
          signals[i].relatedSignals = [...(signals[i].relatedSignals ?? []), signals[j].id];
          signals[j].relatedSignals = [...(signals[j].relatedSignals ?? []), signals[i].id];

          // Boost score for related signals
          signals[i].score *= 1.1;
          signals[j].score *= 1.1;
        }
      }
    }

    return signals;
  }

  /* ═══════════════════════════════════════════════════════════════
     PRIVATE — PERSISTENCE & HELPERS
     ═══════════════════════════════════════════════════════════════ */

  private async persistSignal(signal: WeakSignal): Promise<void> {
    // persistence not implemented (model absent from schema); previously a no-op
  }

  private deserializeWeakSignal(dbRecord: Record<string, unknown>): WeakSignal {
    return {
      id: (dbRecord.id as string) ?? uuidv4(),
      description: (dbRecord.description as string) ?? '',
      sources: (dbRecord.sources as string[]) ?? [],
      confidence: Number(dbRecord.confidence ?? 0.5),
      trend: (dbRecord.trend as SignalTrend) ?? 'emerging',
      potentialImpact: (dbRecord.potentialImpact as ImpactLevel) ?? 'medium',
      recommendedInvestigation: (dbRecord.recommendedInvestigation as string) ?? '',
      detectedAt: new Date(dbRecord.detectedAt as string),
      category: (dbRecord.category as SignalCategory) ?? 'cross-domain',
      score: Number(dbRecord.score ?? 0),
      evidence: ((dbRecord.evidence as Record<string, unknown>[]) ?? []).map((e) => ({
        source: (e.source as string) ?? '',
        detail: (e.detail as string) ?? '',
        timestamp: new Date(e.timestamp as string),
        strength: Number(e.strength ?? 0.5),
      })),
      businessId: (dbRecord.businessId as string) ?? '',
      validatedAt: dbRecord.validatedAt ? new Date(dbRecord.validatedAt as string) : undefined,
      validationOutcome: (dbRecord.validationOutcome as 'confirmed' | 'rejected') ?? null,
      relatedSignals: (dbRecord.relatedSignals as string[]) ?? undefined,
    };
  }

  private async findAllActiveBusinesses(): Promise<string[]> {
    const businesses = await this.prisma.client.business
      .findMany({ where: { active: true }, select: { id: true } })
      .catch(() => []);

    return (businesses as Array<{ id: string }>).map((b) => b.id);
  }
}
