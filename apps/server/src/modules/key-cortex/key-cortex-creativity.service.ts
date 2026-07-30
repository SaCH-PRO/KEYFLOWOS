/**
 * ============================================================================
 * KEY Cortex — Layer 6: CREATIVE IDEATION ENGINE
 * ============================================================================
 *
 * KEY generates genuinely novel business strategies — not generic advice,
 * but creative, tailored ideas that emerge from the intersection of business
 * context, genome insights, and structured creativity techniques.
 *
 * Seven Creativity Techniques:
 *   1. COMBINATION       — What if we combined X + Y? (Uber = taxis + phones)
 *   2. INVERSION         — What if we did the OPPOSITE? (Netflix = no fees)
 *   3. ANALOGY           — What would Amazon/Apple/Tesla do?
 *   4. CONSTRAINT REMOVAL — What if money/time were unlimited?
 *   5. EXTREME USERS     — What would power user vs first-timer want?
 *   6. TREND RIDING      — What emerging trends can we exploit?
 *   7. PROBLEM FIRST     — What's the biggest unsolved customer problem?
 *
 * Philosophy: Creativity is not randomness — it is structured exploration
 * of a vast possibility space. KEY uses business-specific context to
 * constrain the search space to ideas that are actually relevant, then
 * applies creativity techniques to navigate that space efficiently.
 * ============================================================================
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ModelGatewayService } from '../ai/model-gateway.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { KeyCortexContextV2Service } from './key-cortex-context-v2.service';
import { KeyCortexInsightService } from './key-cortex-insight.service';
import { v4 as uuidv4 } from 'uuid';

/* ─────────────────────────── Type Definitions ─────────────────────────── */

export type CreativeCategory = 'product' | 'marketing' | 'operations' | 'pricing' | 'partnership' | 'automation' | 'strategy';
export type IdeaStatus = 'generated' | 'pending' | 'implemented' | 'rejected' | 'validated' | 'experimenting';
export type CreativityTechnique =
  | 'combination'
  | 'inversion'
  | 'analogy'
  | 'constraint_removal'
  | 'extreme_users'
  | 'trend_riding'
  | 'problem_first';

export interface CreativeIdea {
  id: string;
  title: string;
  description: string;
  category: CreativeCategory;
  novelty: number; // 0–1 how unique?
  feasibility: number; // 0–1 can we actually do this?
  estimatedImpact: number; // 0–1 potential business impact
  implementationSteps: string[];
  risks: string[];
  requiredResources: string[];
  inspiration: string; // what sparked this idea
  technique: CreativityTechnique;
  businessId: string;
  status: IdeaStatus;
  score: number; // novelty × feasibility × impact
  generatedAt: Date;
  implementedAt?: Date;
  feedback?: string;
  tags: string[];
}

export interface BrainstormResult {
  prompt: string;
  ideas: CreativeIdea[];
  themes: string[];
  wildcards: CreativeIdea[];
  favorites: CreativeIdea[];
  techniquesUsed: CreativityTechnique[];
  totalIdeasGenerated: number;
  sessionId: string;
  generatedAt: Date;
}

export interface LateralRefame {
  originalProblem: string;
  reframe: string;
  reframeDescription: string;
  solutions: CreativeIdea[];
}

export interface TrendOpportunity {
  trend: string;
  description: string;
  relevance: number;
  actionIdeas: string[];
  timeframe: string;
}

/* ─────────────────────────── Service ─────────────────────────── */

@Injectable()
export class KeyCortexCreativityService {
  private readonly logger = new Logger(KeyCortexCreativityService.name);

  /** In-memory creative history cache — also persisted to DB */
  private creativeHistory: Map<string, CreativeIdea[]> = new Map();

  /** Analogy reference companies for structured ideation */
  private readonly analogyCompanies = [
    { name: 'Amazon', principles: ['customer obsession', 'long-term thinking', 'operational excellence', 'willingness to invent'] },
    { name: 'Apple', principles: ['design-first', 'premium positioning', 'ecosystem lock-in', 'minimalism'] },
    { name: 'Tesla', principles: ['vertical integration', 'first-principles thinking', 'direct-to-consumer', 'software-first'] },
    { name: 'Netflix', principles: ['data-driven decisions', 'personalization', 'subscription model', 'content as product'] },
    { name: 'Airbnb', principles: ['two-sided marketplace', 'trust through reviews', 'asset-light', 'community-driven'] },
    { name: 'Stripe', principles: ['developer-first', 'API elegance', 'global by default', 'infrastructure play'] },
    { name: 'Nike', principles: ['brand over product', 'emotional marketing', 'athlete partnerships', 'direct-to-consumer'] },
    { name: 'Costco', principles: ['membership model', 'bulk efficiency', 'limited selection', 'employee-first'] },
  ];

  /** Emerging trends for trend-riding technique */
  private readonly emergingTrends = [
    { name: 'AI-powered personalization', description: 'Using AI to create hyper-personalized experiences at scale', timeframe: 'now' },
    { name: 'Subscription fatigue counter-trend', description: 'Pay-per-use and micro-subscription models emerging', timeframe: '1-2 years' },
    { name: 'Community-led growth', description: 'Building growth through user communities rather than ads', timeframe: 'now' },
    { name: 'No-code / Low-code automation', description: 'Empowering non-technical users to build workflows', timeframe: 'now' },
    { name: 'Sustainability as competitive advantage', description: 'Green practices becoming market differentiators', timeframe: '1-3 years' },
    { name: 'Remote-first operations', description: 'Building for distributed teams as default', timeframe: 'now' },
    { name: 'Privacy-first data strategies', description: 'Zero-party data and first-party relationships', timeframe: 'now' },
    { name: 'Generative AI integration', description: 'Embedding AI generation into core product workflows', timeframe: 'now' },
    { name: 'Micro-SaaS ecosystems', description: 'Small, focused tools that integrate into platforms', timeframe: '1-2 years' },
    { name: 'Outcome-based pricing', description: 'Charging based on results rather than seats/usage', timeframe: '2-3 years' },
  ];

  constructor(
    private readonly modelGateway: ModelGatewayService,
    private readonly aiUsage: AiUsageService,
    private readonly contextService: KeyCortexContextV2Service,
    private readonly insightService: KeyCortexInsightService,
  ) {}

  /* ═══════════════════════════════════════════════════════════════
     PUBLIC API — Brainstorming
     ═══════════════════════════════════════════════════════════════ */

  /**
   * brainstorm — The primary creative ideation pipeline.
   *
   * Uses AI + 7 creativity techniques to generate diverse, novel ideas.
   * Each idea is scored on: novelty × feasibility × impact.
   *
   * Results are separated into:
   *   • favorites — best overall score (high novelty + feasible + impactful)
   *   • wildcards — high novelty, low feasibility (moonshots)
   *   • all ideas — complete ranked list
   */
  async brainstorm(
    prompt: string,
    businessId: string,
    options?: {
      category?: string;
      count?: number;
      wildcards?: boolean;
      techniques?: CreativityTechnique[];
    },
  ): Promise<BrainstormResult> {
    const sessionId = uuidv4();
    const startedAt = Date.now();
    const requestedCount = options?.count ?? 10;
    const enableWildcards = options?.wildcards ?? true;
    const techniquesToUse = options?.techniques ?? this.allTechniques();

    this.logger.log(`[Creativity:${sessionId}] 🎨 Brainstorming "${prompt.slice(0, 60)}..." for ${businessId}`);

    // 1. Get full business context
    const businessContext = await this.contextService.getBusinessContext(businessId);
    const genomeInsights = await this.getGenomeInsights(businessId);

    // 2. Run each creativity technique
    const allIdeas: CreativeIdea[] = [];
    const themes: string[] = [];

    for (const technique of techniquesToUse) {
      try {
        const techniqueIdeas = await this.runTechnique(technique, prompt, businessId, businessContext, genomeInsights, requestedCount);
        allIdeas.push(...techniqueIdeas);
        this.logger.debug(`[Creativity:${sessionId}] Technique "${technique}" generated ${techniqueIdeas.length} ideas`);
      } catch (error) {
        this.logger.warn(`[Creativity:${sessionId}] Technique "${technique}" failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 3. Score all ideas
    const scoredIdeas = this.scoreIdeas(allIdeas);

    // 4. Extract themes
    const extractedThemes = await this.extractThemes(scoredIdeas);
    themes.push(...extractedThemes);

    // 5. Separate into favorites and wildcards
    const favorites = scoredIdeas
      .filter((i) => i.score > 0.5 && i.feasibility > 0.4)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.ceil(requestedCount / 2));

    const wildcards = enableWildcards
      ? scoredIdeas
          .filter((i) => i.novelty > 0.7 && i.feasibility < 0.4)
          .sort((a, b) => b.novelty - a.novelty)
          .slice(0, Math.ceil(requestedCount / 3))
      : [];

    // 6. Filter by category if requested
    let filteredIdeas = scoredIdeas;
    if (options?.category) {
      filteredIdeas = scoredIdeas.filter((i) => i.category === (options.category as CreativeCategory));
    }

    const result: BrainstormResult = {
      prompt,
      ideas: filteredIdeas.sort((a, b) => b.score - a.score),
      themes,
      wildcards,
      favorites,
      techniquesUsed: techniquesToUse,
      totalIdeasGenerated: allIdeas.length,
      sessionId,
      generatedAt: new Date(),
    };

    // 7. Persist all ideas to history
    await this.persistIdeas(businessId, scoredIdeas);

    this.logger.log(
      `[Creativity:${sessionId}] ✅ Brainstorm complete in ${Date.now() - startedAt}ms — ` +
        `${allIdeas.length} ideas, ${favorites.length} favorites, ${wildcards.length} wildcards`,
    );

    return result;
  }

  /**
   * generateNovelStrategy — Generate business-specific strategies.
   *
   * Unlike generic brainstorming, this method gets deep context about
   * the business and generates strategies that are SPECIFIC to this
   * business's situation, DNA, and goals. Not generic advice.
   *
   * Returns the top 5 ideas with detailed implementation steps.
   */
  async generateNovelStrategy(businessId: string, goal: string): Promise<CreativeIdea[]> {
    const sessionId = uuidv4();
    this.logger.log(`[Creativity:${sessionId}] 🎯 Generating novel strategy for ${businessId}: ${goal}`);

    // 1. Get full business context
    const businessContext = await this.contextService.getBusinessContext(businessId);
    const genomeInsights = await this.getGenomeInsights(businessId);
    const recentInsights = await this.insightService.getRecentInsights(businessId, 7);

    // 2. Build a rich prompt from all available context
    const contextSummary = this.buildContextSummary(businessContext, genomeInsights, recentInsights);

    const prompt = `You are KEY's creative strategy engine. Generate 5 SPECIFIC, NOVEL business strategies for this company.

GOAL: ${goal}

BUSINESS CONTEXT:
${contextSummary}

REQUIREMENTS:
- Each strategy must be SPECIFIC to this business — no generic advice
- Each must use a different creativity technique
- Include concrete implementation steps (3-5 steps each)
- Assess novelty (0-1), feasibility (0-1), and impact (0-1)
- Identify risks and required resources

Return JSON:
[{
  "title": "...",
  "description": "...",
  "category": "product|marketing|operations|pricing|partnership|automation|strategy",
  "novelty": 0.0,
  "feasibility": 0.0,
  "estimatedImpact": 0.0,
  "implementationSteps": ["..."],
  "risks": ["..."],
  "requiredResources": ["..."],
  "inspiration": "which technique inspired this",
  "technique": "combination|inversion|analogy|constraint_removal|extreme_users|trend_riding|problem_first",
  "tags": ["..."]
}]`;

    // 3. Call AI
    const response = await this.aiUsage.trackAndComplete(
      businessId,
      undefined,
      'creativity-strategy',
      {
        messages: [{ role: 'user' as const, content: prompt }],
      temperature: 0.85, maxTokens: 4000
      },
    );

    // 4. Parse and enrich
    let ideas: CreativeIdea[] = [];
    try {
      const parsed = JSON.parse(response.content) as Array<{
        title: string;
        description: string;
        category: string;
        novelty: number;
        feasibility: number;
        estimatedImpact: number;
        implementationSteps: string[];
        risks: string[];
        requiredResources: string[];
        inspiration: string;
        technique: string;
        tags: string[];
      }>;

      ideas = parsed.map((p) => this.enrichIdea(p, businessId, sessionId));
    } catch {
      // Fallback: generate ideas using techniques
      ideas = await this.fallbackStrategyGeneration(businessId, goal, businessContext);
    }

    // 5. Score and rank
    const scored = this.scoreIdeas(ideas).sort((a, b) => b.score - a.score);

    // 6. Persist
    await this.persistIdeas(businessId, scored);

    this.logger.log(`[Creativity:${sessionId}] 🎯 Generated ${scored.length} novel strategies`);

    return scored.slice(0, 5);
  }

  /**
   * lateralThinking — Reframe a problem 3 different ways.
   *
   * KEY applies Edward de Bono's lateral thinking principles:
   * the same problem viewed from 3 different angles produces
   * qualitatively different (and often better) solutions.
   */
  async lateralThinking(problem: string, businessId: string): Promise<LateralRefame[]> {
    const sessionId = uuidv4();
    this.logger.log(`[Creativity:${sessionId}] 🤔 Lateral thinking on: ${problem.slice(0, 60)}...`);

    // Get business context
    const businessContext = await this.contextService.getBusinessContext(businessId);

    // 3 reframes
    const reframes: LateralRefame[] = [
      {
        originalProblem: problem,
        reframe: 'scale-up',
        reframeDescription: 'What if this problem were 100× bigger? What if it affected 1 million people?',
        solutions: [],
      },
      {
        originalProblem: problem,
        reframe: 'resource-flip',
        reframeDescription: 'What if you had unlimited money but zero time? Or unlimited time but zero money?',
        solutions: [],
      },
      {
        originalProblem: problem,
        reframe: 'benefit-flip',
        reframeDescription: "What if this 'problem' is actually an opportunity in disguise? What would make this desirable?",
        solutions: [],
      },
    ];

    // Generate solutions for each reframe
    for (const reframe of reframes) {
      try {
        const prompt = `Problem: ${problem}
Reframe: ${reframe.reframeDescription}
Business context: ${JSON.stringify(businessContext).slice(0, 500)}

Generate 2 creative solutions for this reframed problem.
Each solution must be specific, actionable, and novel.

Return JSON:
[{
  "title": "...",
  "description": "...",
  "category": "product|marketing|operations|pricing|partnership|automation|strategy",
  "novelty": 0.0,
  "feasibility": 0.0,
  "estimatedImpact": 0.0,
  "implementationSteps": ["..."],
  "risks": ["..."],
  "requiredResources": ["..."],
  "inspiration": "lateral-thinking-${reframe.reframe}"
}]`;

        const response = await this.aiUsage.trackAndComplete(
          businessId,
          undefined,
          'creativity-lateral',
          {
            messages: [{ role: 'user' as const, content: prompt }],
          temperature: 0.9, maxTokens: 2000
          },
        );

        const parsed = JSON.parse(response.content) as Array<{
          title: string;
          description: string;
          category: string;
          novelty: number;
          feasibility: number;
          estimatedImpact: number;
          implementationSteps: string[];
          risks: string[];
          requiredResources: string[];
          inspiration: string;
        }>;

        reframe.solutions = parsed.map((p) =>
          this.enrichIdea(
            { ...p, technique: 'problem_first', tags: ['lateral-thinking', reframe.reframe] },
            businessId,
            sessionId,
          ),
        );
      } catch (error) {
        this.logger.warn(`Lateral reframe "${reframe.reframe}" failed: ${error instanceof Error ? error.message : String(error)}`);
        reframe.solutions = this.fallbackLateralSolutions(problem, reframe.reframe, businessId, sessionId);
      }
    }

    // Persist
    for (const reframe of reframes) {
      await this.persistIdeas(businessId, reframe.solutions);
    }

    this.logger.log(`[Creativity:${sessionId}] 🤔 Lateral thinking complete — ${reframes.reduce((s, r) => s + r.solutions.length, 0)} solutions across 3 reframes`);

    return reframes;
  }

  /**
   * getCreativeHistory — Return all previously generated ideas.
   *
   * Includes status tracking: implemented / pending / rejected.
   * Enables KEY to learn from its own creative output.
   */
  async getCreativeHistory(businessId: string): Promise<CreativeIdea[]> {
    // Check in-memory cache
    const cached = this.creativeHistory.get(businessId) ?? [];

    // Query database
    const dbIdeas = await this.prisma.client.keyCortexCreativeIdea
      ?.findMany({
        where: { businessId },
        orderBy: { generatedAt: 'desc' },
        take: 200,
      })
      .catch(() => []);

    const allIdeas = [
      ...cached,
      ...((dbIdeas ?? []) as Array<Record<string, unknown>>).map((d) => this.deserializeIdea(d)),
    ];

    // Deduplicate by ID
    const seen = new Set<string>();
    const unique: CreativeIdea[] = [];
    for (const idea of allIdeas) {
      if (!seen.has(idea.id)) {
        seen.add(idea.id);
        unique.push(idea);
      }
    }

    return unique.sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());
  }

  /**
   * Update the status of a creative idea (implemented / rejected / etc.)
   */
  async updateIdeaStatus(businessId: string, ideaId: string, status: IdeaStatus, feedback?: string): Promise<CreativeIdea | null> {
    // Update in-memory cache
    const cached = this.creativeHistory.get(businessId) ?? [];
    const idea = cached.find((i) => i.id === ideaId);
    if (idea) {
      idea.status = status;
      idea.feedback = feedback;
      if (status === 'implemented') idea.implementedAt = new Date();
    }

    // Update database
    try {
      await this.prisma.client.keyCortexCreativeIdea?.update({
        where: { id: ideaId },
        data: { status, feedback, ...(status === 'implemented' ? { implementedAt: new Date() } : {}) },
      });
    } catch {
      // Table may not exist
    }

    return idea ?? null;
  }

  /* ═══════════════════════════════════════════════════════════════
     SCHEDULED — Periodic Creative Exploration
     ═══════════════════════════════════════════════════════════════ */

  /** Daily creative exploration — 5:00 AM */
  @Cron('0 5 * * *')
  async scheduledCreativeExploration(): Promise<void> {
    this.logger.log('[Creativity] 🌅 Starting daily creative exploration');

    const businesses = await this.findAllActiveBusinesses();
    for (const businessId of businesses) {
      try {
        // Get top insights to spark creative ideas
        const recentInsights = await this.insightService.getRecentInsights(businessId, 1);
        if (recentInsights.length === 0) continue;

        const topInsight = recentInsights[0];
        const prompt = `Based on this business insight: "${topInsight.description}"
Generate creative opportunities that this insight suggests.`;

        await this.brainstorm(prompt, businessId, { count: 3, wildcards: false });
      } catch (err) {
        this.logger.error(`Creative exploration failed for ${businessId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     PRIVATE — 7 CREATIVITY TECHNIQUES
     ═══════════════════════════════════════════════════════════════ */

  private allTechniques(): CreativityTechnique[] {
    return ['combination', 'inversion', 'analogy', 'constraint_removal', 'extreme_users', 'trend_riding', 'problem_first'];
  }

  private async runTechnique(
    technique: CreativityTechnique,
    prompt: string,
    businessId: string,
    businessContext: Record<string, unknown>,
    genomeInsights: string[],
    count: number,
  ): Promise<CreativeIdea[]> {
    switch (technique) {
      case 'combination':
        return this.techniqueCombination(prompt, businessId, businessContext, genomeInsights, count);
      case 'inversion':
        return this.techniqueInversion(prompt, businessId, businessContext, count);
      case 'analogy':
        return this.techniqueAnalogy(prompt, businessId, businessContext, count);
      case 'constraint_removal':
        return this.techniqueConstraintRemoval(prompt, businessId, businessContext, count);
      case 'extreme_users':
        return this.techniqueExtremeUsers(prompt, businessId, businessContext, count);
      case 'trend_riding':
        return this.techniqueTrendRiding(prompt, businessId, businessContext, count);
      case 'problem_first':
        return this.techniqueProblemFirst(prompt, businessId, businessContext, count);
      default:
        return [];
    }
  }

  /**
   * TECHNIQUE 1: COMBINATION
   * "What if we combined X + Y?"
   * Examples: Uber = taxis + smartphones, Netflix = movies + subscription
   */
  private async techniqueCombination(
    prompt: string,
    businessId: string,
    businessContext: Record<string, unknown>,
    genomeInsights: string[],
    count: number,
  ): Promise<CreativeIdea[]> {
    const businessElements = this.extractBusinessElements(businessContext);

    const aiPrompt = `You are using the COMBINATION creativity technique.

PROMPT: ${prompt}

Business elements available:
${businessElements.join(', ')}

Genome insights:
${genomeInsights.slice(0, 5).join('\n')}

Generate ${count} ideas that combine TWO or more of these elements in novel ways.
Think: What unlikely combinations could create something new?

Return JSON:
[{
  "title": "...",
  "description": "...",
  "category": "product|marketing|operations|pricing|partnership|automation|strategy",
  "novelty": 0.0-1.0,
  "feasibility": 0.0-1.0,
  "estimatedImpact": 0.0-1.0,
  "implementationSteps": ["..."],
  "risks": ["..."],
  "requiredResources": ["..."],
  "inspiration": "Combined X + Y"
}]`;

    try {
      const response = await this.aiUsage.trackAndComplete(
        businessId,
        undefined,
        'creativity-combination',
        {
          messages: [{ role: 'user' as const, content: aiPrompt }],
        temperature: 0.85, maxTokens: 2500
        },
      );

      const parsed = JSON.parse(response.content) as Array<{
        title: string;
        description: string;
        category: string;
        novelty: number;
        feasibility: number;
        estimatedImpact: number;
        implementationSteps: string[];
        risks: string[];
        requiredResources: string[];
        inspiration: string;
      }>;

      return parsed.map((p) =>
        this.enrichIdea({ ...p, technique: 'combination', tags: ['combination', 'creative'] }, businessId),
      );
    } catch {
      return this.fallbackCombinationIdeas(businessId, prompt, businessElements);
    }
  }

  /**
   * TECHNIQUE 2: INVERSION
   * "What if we did the OPPOSITE?"
   * Examples: Netflix = no late fees, Dollar Shave Club = no retail
   */
  private async techniqueInversion(
    prompt: string,
    businessId: string,
    businessContext: Record<string, unknown>,
    count: number,
  ): Promise<CreativeIdea[]> {
    const currentApproach = (businessContext?.currentApproach as string) ?? (businessContext?.businessModel as string) ?? 'current approach';

    const aiPrompt = `You are using the INVERSION creativity technique.

PROMPT: ${prompt}
Current approach: ${currentApproach}

Generate ${count} ideas by doing the EXACT OPPOSITE of what is normally done.
Think: What if we removed the most important feature? What if we charged the opposite way?
What if we targeted the opposite customer?

Return JSON:
[{
  "title": "...",
  "description": "...",
  "category": "product|marketing|operations|pricing|partnership|automation|strategy",
  "novelty": 0.0-1.0,
  "feasibility": 0.0-1.0,
  "estimatedImpact": 0.0-1.0,
  "implementationSteps": ["..."],
  "risks": ["..."],
  "requiredResources": ["..."],
  "inspiration": "Opposite of: ${currentApproach}"
}]`;

    try {
      const response = await this.aiUsage.trackAndComplete(
        businessId,
        undefined,
        'creativity-inversion',
        {
          messages: [{ role: 'user' as const, content: aiPrompt }],
        temperature: 0.9, maxTokens: 2500
        },
      );

      const parsed = JSON.parse(response.content) as Array<{
        title: string;
        description: string;
        category: string;
        novelty: number;
        feasibility: number;
        estimatedImpact: number;
        implementationSteps: string[];
        risks: string[];
        requiredResources: string[];
        inspiration: string;
      }>;

      return parsed.map((p) => this.enrichIdea({ ...p, technique: 'inversion', tags: ['inversion', 'opposite'] }, businessId));
    } catch {
      return this.fallbackInversionIdeas(businessId, prompt, currentApproach as string);
    }
  }

  /**
   * TECHNIQUE 3: ANALOGY
   * "What would Amazon/Apple/Tesla do?"
   * Transfer patterns from one domain to another.
   */
  private async techniqueAnalogy(
    prompt: string,
    businessId: string,
    businessContext: Record<string, unknown>,
    count: number,
  ): Promise<CreativeIdea[]> {
    // Pick 3 random analogy companies
    const shuffled = [...this.analogyCompanies].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, 3);

    const ideas: CreativeIdea[] = [];

    for (const company of selected) {
      const aiPrompt = `You are using the ANALOGY creativity technique.

PROMPT: ${prompt}

Apply ${company.name}'s principles to this problem:
${company.principles.map((p) => `- ${p}`).join('\n')}

What would ${company.name} do? Generate ${Math.ceil(count / 3)} ideas.

Return JSON:
[{
  "title": "...",
  "description": "...",
  "category": "product|marketing|operations|pricing|partnership|automation|strategy",
  "novelty": 0.0-1.0,
  "feasibility": 0.0-1.0,
  "estimatedImpact": 0.0-1.0,
  "implementationSteps": ["..."],
  "risks": ["..."],
  "requiredResources": ["..."],
  "inspiration": "What ${company.name} would do: ${company.principles.join(', ')}"
}]`;

      try {
        const response = await this.aiUsage.trackAndComplete(
          businessId,
          undefined,
          'creativity-analogy',
          {
            messages: [{ role: 'user' as const, content: aiPrompt }],
          temperature: 0.8, maxTokens: 2000
          },
        );

        const parsed = JSON.parse(response.content) as Array<{
          title: string;
          description: string;
          category: string;
          novelty: number;
          feasibility: number;
          estimatedImpact: number;
          implementationSteps: string[];
          risks: string[];
          requiredResources: string[];
          inspiration: string;
        }>;

        ideas.push(...parsed.map((p) => this.enrichIdea({ ...p, technique: 'analogy', tags: ['analogy', company.name] }, businessId)));
      } catch {
        ideas.push(this.fallbackAnalogyIdea(businessId, company.name, company.principles));
      }
    }

    return ideas;
  }

  /**
   * TECHNIQUE 4: CONSTRAINT REMOVAL
   * "What if money/time/technology were unlimited?"
   * Dream big, then scale back to reality.
   */
  private async techniqueConstraintRemoval(
    prompt: string,
    businessId: string,
    businessContext: Record<string, unknown>,
    count: number,
  ): Promise<CreativeIdea[]> {
    const constraints = ['money', 'time', 'technology', 'talent', 'market size', 'regulations'];

    const aiPrompt = `You are using the CONSTRAINT REMOVAL creativity technique.

PROMPT: ${prompt}

Imagine ALL these constraints were removed: ${constraints.join(', ')}.
You have unlimited resources. What would you build?

Generate ${count} unconstrained ideas, then note how each could be adapted
to work with realistic constraints.

Return JSON:
[{
  "title": "...",
  "description": "... (include unconstrained vision + realistic adaptation)",
  "category": "product|marketing|operations|pricing|partnership|automation|strategy",
  "novelty": 0.0-1.0,
  "feasibility": 0.0-1.0,
  "estimatedImpact": 0.0-1.0,
  "implementationSteps": ["..."],
  "risks": ["..."],
  "requiredResources": ["..."],
  "inspiration": "Unconstrained: unlimited ${constraints[Math.floor(Math.random() * constraints.length)]}"
}]`;

    try {
      const response = await this.aiUsage.trackAndComplete(
        businessId,
        undefined,
        'creativity-constraint-removal',
        {
          messages: [{ role: 'user' as const, content: aiPrompt }],
        temperature: 0.95, maxTokens: 2500
        },
      );

      const parsed = JSON.parse(response.content) as Array<{
        title: string;
        description: string;
        category: string;
        novelty: number;
        feasibility: number;
        estimatedImpact: number;
        implementationSteps: string[];
        risks: string[];
        requiredResources: string[];
        inspiration: string;
      }>;

      return parsed.map((p) => this.enrichIdea({ ...p, technique: 'constraint_removal', tags: ['unconstrained', 'blue-sky'] }, businessId));
    } catch {
      return this.fallbackConstraintRemovalIdeas(businessId, prompt, count);
    }
  }

  /**
   * TECHNIQUE 5: EXTREME USERS
   * "What would a power user want? A first-timer?"
   * Design for the extremes, cover the middle.
   */
  private async techniqueExtremeUsers(
    prompt: string,
    businessId: string,
    businessContext: Record<string, unknown>,
    count: number,
  ): Promise<CreativeIdea[]> {
    const userTypes = [
      { name: 'power_user', description: 'Uses your product 10× per day, knows every feature, has complex workflows' },
      { name: 'first_timer', description: 'Never used your product before, easily confused, needs hand-holding' },
      { name: 'enterprise_buyer', description: 'CTO evaluating your product for 10,000 employees, needs compliance, security, SLAs' },
      { name: 'price_sensitive', description: 'Will switch for $5 cheaper, uses only free features' },
    ];

    const ideas: CreativeIdea[] = [];
    const perUserType = Math.ceil(count / userTypes.length);

    for (const userType of userTypes) {
      const aiPrompt = `You are using the EXTREME USERS creativity technique.

PROMPT: ${prompt}

Design for this extreme user: ${userType.name}
Description: ${userType.description}

Generate ${perUserType} ideas that would DELIGHT this specific user type.
Don't average — go to the extreme.

Return JSON:
[{
  "title": "...",
  "description": "...",
  "category": "product|marketing|operations|pricing|partnership|automation|strategy",
  "novelty": 0.0-1.0,
  "feasibility": 0.0-1.0,
  "estimatedImpact": 0.0-1.0,
  "implementationSteps": ["..."],
  "risks": ["..."],
  "requiredResources": ["..."],
  "inspiration": "Designed for ${userType.name}: ${userType.description}"
}]`;

      try {
        const response = await this.aiUsage.trackAndComplete(
          businessId,
          undefined,
          'creativity-extreme-users',
          {
            messages: [{ role: 'user' as const, content: aiPrompt }],
          temperature: 0.85, maxTokens: 2000
          },
        );

        const parsed = JSON.parse(response.content) as Array<{
          title: string;
          description: string;
          category: string;
          novelty: number;
          feasibility: number;
          estimatedImpact: number;
          implementationSteps: string[];
          risks: string[];
          requiredResources: string[];
          inspiration: string;
        }>;

        ideas.push(...parsed.map((p) => this.enrichIdea({ ...p, technique: 'extreme_users', tags: ['extreme-user', userType.name] }, businessId)));
      } catch {
        ideas.push(this.fallbackExtremeUserIdea(businessId, userType.name, userType.description));
      }
    }

    return ideas;
  }

  /**
   * TECHNIQUE 6: TREND RIDING
   * "What emerging trends can we exploit?"
   * Ride the wave rather than swimming against it.
   */
  private async techniqueTrendRiding(
    prompt: string,
    businessId: string,
    businessContext: Record<string, unknown>,
    count: number,
  ): Promise<CreativeIdea[]> {
    // Select top 5 most relevant trends
    const industry = (businessContext?.industry as string) ?? 'general';
    const relevantTrends = this.selectRelevantTrends(industry, 5);

    const ideas: CreativeIdea[] = [];
    const perTrend = Math.ceil(count / relevantTrends.length);

    for (const trend of relevantTrends) {
      const aiPrompt = `You are using the TREND RIDING creativity technique.

PROMPT: ${prompt}

Ride this emerging trend: ${trend.name}
Description: ${trend.description}
Timeframe: ${trend.timeframe}

Generate ${perTrend} ideas for how this business can exploit this trend.
Be specific about HOW the trend creates opportunity.

Return JSON:
[{
  "title": "...",
  "description": "...",
  "category": "product|marketing|operations|pricing|partnership|automation|strategy",
  "novelty": 0.0-1.0,
  "feasibility": 0.0-1.0,
  "estimatedImpact": 0.0-1.0,
  "implementationSteps": ["..."],
  "risks": ["..."],
  "requiredResources": ["..."],
  "inspiration": "Riding trend: ${trend.name} (${trend.timeframe})"
}]`;

      try {
        const response = await this.aiUsage.trackAndComplete(
          businessId,
          undefined,
          'creativity-trend-riding',
          {
            messages: [{ role: 'user' as const, content: aiPrompt }],
          temperature: 0.8, maxTokens: 2000
          },
        );

        const parsed = JSON.parse(response.content) as Array<{
          title: string;
          description: string;
          category: string;
          novelty: number;
          feasibility: number;
          estimatedImpact: number;
          implementationSteps: string[];
          risks: string[];
          requiredResources: string[];
          inspiration: string;
        }>;

        ideas.push(...parsed.map((p) => this.enrichIdea({ ...p, technique: 'trend_riding', tags: ['trend', trend.name] }, businessId)));
      } catch {
        ideas.push(this.fallbackTrendIdea(businessId, trend));
      }
    }

    return ideas;
  }

  /**
   * TECHNIQUE 7: PROBLEM FIRST
   * "What's the biggest unsolved customer problem?"
   * Start from pain, work backwards to solution.
   */
  private async techniqueProblemFirst(
    prompt: string,
    businessId: string,
    businessContext: Record<string, unknown>,
    count: number,
  ): Promise<CreativeIdea[]> {
    const aiPrompt = `You are using the PROBLEM-FIRST creativity technique.

PROMPT: ${prompt}

Instead of brainstorming solutions, first identify the DEEPEST, most
PAINFUL unsolved problems your customers face. Then generate solutions
for each problem.

Follow this structure:
1. What are customers complaining about most?
2. What do they WISH your product could do?
3. What workaround are they using instead?
4. What would make them cry tears of joy if solved?

Generate ${count} ideas — each solving a different deep problem.

Return JSON:
[{
  "title": "...",
  "description": "Problem: ...\nSolution: ...",
  "category": "product|marketing|operations|pricing|partnership|automation|strategy",
  "novelty": 0.0-1.0,
  "feasibility": 0.0-1.0,
  "estimatedImpact": 0.0-1.0,
  "implementationSteps": ["..."],
  "risks": ["..."],
  "requiredResources": ["..."],
  "inspiration": "Solving: [the deep problem this addresses]"
}]`;

    try {
      const response = await this.aiUsage.trackAndComplete(
        businessId,
        undefined,
        'creativity-problem-first',
        {
          messages: [{ role: 'user' as const, content: aiPrompt }],
        temperature: 0.85, maxTokens: 2500
        },
      );

      const parsed = JSON.parse(response.content) as Array<{
        title: string;
        description: string;
        category: string;
        novelty: number;
        feasibility: number;
        estimatedImpact: number;
        implementationSteps: string[];
        risks: string[];
        requiredResources: string[];
        inspiration: string;
      }>;

      return parsed.map((p) => this.enrichIdea({ ...p, technique: 'problem_first', tags: ['problem-first', 'customer-pain'] }, businessId));
    } catch {
      return this.fallbackProblemFirstIdeas(businessId, prompt, count);
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     PRIVATE — SCORING & ENRICHMENT
     ═══════════════════════════════════════════════════════════════ */

  private scoreIdeas(ideas: CreativeIdea[]): CreativeIdea[] {
    return ideas.map((idea) => {
      // Composite score: novelty × feasibility × impact
      // With feasibility penalty for wildcards
      const rawScore = idea.novelty * idea.feasibility * idea.estimatedImpact;

      // Boost for balanced ideas (high on all three dimensions)
      const balanceBonus = 1 + (1 - Math.abs(idea.novelty - idea.feasibility)) * 0.1;

      // Feasibility floor: ideas below 0.1 feasibility are essentially impossible
      const feasibilityMultiplier = idea.feasibility < 0.1 ? 0.1 : 1;

      const score = rawScore * balanceBonus * feasibilityMultiplier;

      return { ...idea, score: Math.round(score * 1000) / 1000 };
    });
  }

  private enrichIdea(
    partial: {
      title: string;
      description: string;
      category?: string;
      novelty?: number;
      feasibility?: number;
      estimatedImpact?: number;
      implementationSteps?: string[];
      risks?: string[];
      requiredResources?: string[];
      inspiration?: string;
      technique: CreativityTechnique;
      tags?: string[];
    },
    businessId: string,
    sessionId?: string,
  ): CreativeIdea {
    return {
      id: uuidv4(),
      title: partial.title,
      description: partial.description,
      category: (partial.category as CreativeCategory) ?? 'strategy',
      novelty: Math.max(0, Math.min(1, partial.novelty ?? 0.5)),
      feasibility: Math.max(0, Math.min(1, partial.feasibility ?? 0.5)),
      estimatedImpact: Math.max(0, Math.min(1, partial.estimatedImpact ?? 0.5)),
      implementationSteps: partial.implementationSteps ?? [],
      risks: partial.risks ?? [],
      requiredResources: partial.requiredResources ?? [],
      inspiration: partial.inspiration ?? `Generated via ${partial.technique}`,
      technique: partial.technique,
      businessId,
      status: 'generated',
      score: 0, // Will be computed by scoreIdeas
      generatedAt: new Date(),
      tags: partial.tags ?? [partial.technique],
    };
  }

  private async extractThemes(ideas: CreativeIdea[]): Promise<string[]> {
    if (ideas.length === 0) return [];

    const combinedText = ideas.map((i) => `${i.title} ${i.description}`).join(' ');
    const words = combinedText
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 5);

    const frequency = new Map<string, number>();
    for (const word of words) {
      frequency.set(word, (frequency.get(word) ?? 0) + 1);
    }

    // Return top recurring themes
    return [...frequency.entries()]
      .filter(([, count]) => count > 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
  }

  /* ═══════════════════════════════════════════════════════════════
     PRIVATE — CONTEXT & GENOME
     ═══════════════════════════════════════════════════════════════ */

  private async getGenomeInsights(businessId: string): Promise<string[]> {
    try {
      const genome = await this.contextService.getBusinessGenome(businessId);
      return Object.entries(genome as Record<string, unknown>).map(([k, v]) => `${k}: ${JSON.stringify(v).slice(0, 200)}`);
    } catch {
      return [];
    }
  }

  private buildContextSummary(businessContext: Record<string, unknown>, genomeInsights: string[], recentInsights: Array<{ description: string; type: string }>): string {
    const parts: string[] = [];

    if (businessContext?.name) parts.push(`Business: ${businessContext.name}`);
    if (businessContext?.industry) parts.push(`Industry: ${businessContext.industry}`);
    if (businessContext?.size) parts.push(`Size: ${businessContext.size}`);
    if (businessContext?.stage) parts.push(`Stage: ${businessContext.stage}`);
    if (businessContext?.revenueModel) parts.push(`Revenue model: ${businessContext.revenueModel}`);
    if (businessContext?.primaryProduct) parts.push(`Primary product: ${businessContext.primaryProduct}`);
    if (businessContext?.targetMarket) parts.push(`Target market: ${businessContext.targetMarket}`);
    if (businessContext?.competitivePosition) parts.push(`Competitive position: ${businessContext.competitivePosition}`);

    if (genomeInsights.length > 0) {
      parts.push(`\nGenome Insights:\n${genomeInsights.slice(0, 5).join('\n')}`);
    }

    if (recentInsights.length > 0) {
      parts.push(`\nRecent Insights:\n${recentInsights.slice(0, 3).map((i) => `- [${i.type}] ${i.description}`).join('\n')}`);
    }

    return parts.join('\n') || 'No detailed business context available.';
  }

  private extractBusinessElements(context: Record<string, unknown>): string[] {
    const elements: string[] = [];

    if (context?.products) elements.push(...(context.products as string[]));
    if (context?.services) elements.push(...(context.services as string[]));
    if (context?.features) elements.push(...(context.features as string[]));
    if (context?.channels) elements.push(...(context.channels as string[]));
    if (context?.customerSegments) elements.push(...(context.customerSegments as string[]));
    if (context?.revenueStreams) elements.push(...(context.revenueStreams as string[]));
    if (context?.partnerships) elements.push(...(context.partnerships as string[]));

    // Add default elements if none found
    if (elements.length === 0) {
      elements.push('product', 'service', 'customers', 'pricing', 'marketing', 'support', 'operations', 'partnerships');
    }

    return [...new Set(elements)];
  }

  private selectRelevantTrends(industry: string, count: number): Array<{ name: string; description: string; timeframe: string }> {
    // Score each trend by relevance to industry
    const scored = this.emergingTrends.map((trend) => {
      let relevance = 0.5;

      // Industry-specific relevance boosts
      const industryKeywords: Record<string, string[]> = {
        saas: ['AI-powered personalization', 'subscription', 'no-code', 'generative AI', 'micro-SaaS'],
        ecommerce: ['AI-powered personalization', 'sustainability', 'community-led', 'subscription'],
        fintech: ['AI-powered personalization', 'privacy-first', 'outcome-based pricing', 'generative AI'],
        healthcare: ['AI-powered personalization', 'privacy-first', 'generative AI', 'community-led'],
        education: ['no-code', 'AI-powered personalization', 'community-led', 'generative AI'],
        marketing: ['AI-powered personalization', 'community-led', 'privacy-first', 'generative AI'],
      };

      const keywords = industryKeywords[industry.toLowerCase()] ?? [];
      if (keywords.some((k) => trend.name.toLowerCase().includes(k.toLowerCase()))) {
        relevance = 0.9;
      }

      return { ...trend, relevance };
    });

    // Sort by relevance and take top N
    return scored.sort((a, b) => b.relevance - a.relevance).slice(0, count);
  }

  /* ═══════════════════════════════════════════════════════════════
     PRIVATE — FALLBACK GENERATORS
     ═══════════════════════════════════════════════════════════════ */

  private fallbackCombinationIdeas(businessId: string, prompt: string, elements: string[]): CreativeIdea[] {
    if (elements.length < 2) return [];

    const ideas: CreativeIdea[] = [];
    for (let i = 0; i < Math.min(elements.length - 1, 3); i++) {
      const a = elements[i];
      const b = elements[i + 1];
      ideas.push(
        this.enrichIdea(
          {
            title: `Combine ${a} + ${b}`,
            description: `What if we integrated ${a} directly with ${b}? This combination could create a unique value proposition that neither element provides alone. Inspired by: ${prompt}`,
            category: 'product',
            novelty: 0.6,
            feasibility: 0.5,
            estimatedImpact: 0.6,
            implementationSteps: [`Map ${a} and ${b} integration points`, 'Build prototype integration', 'Test with 5 customers', 'Measure combined value metric', 'Scale if validated'],
            risks: ['Integration complexity', 'May cannibalize existing usage'],
            requiredResources: ['Engineering: 2-3 weeks', 'Design: 1 week'],
            inspiration: `Combination: ${a} + ${b}`,
            technique: 'combination',
            tags: ['combination', a, b],
          },
          businessId,
        ),
      );
    }
    return ideas;
  }

  private fallbackInversionIdeas(businessId: string, prompt: string, currentApproach: string): CreativeIdea[] {
    return [
      this.enrichIdea(
        {
          title: `The Opposite: No ${currentApproach}`,
          description: `What if we completely eliminated ${currentApproach} and did the opposite? Instead of pushing, we pull. Instead of charging, we give away. Inspired by: ${prompt}`,
          category: 'strategy',
          novelty: 0.75,
          feasibility: 0.25,
          estimatedImpact: 0.7,
          implementationSteps: ['Define the exact opposite approach', 'Identify 3 businesses that succeeded with this inversion', 'Model the unit economics', 'Run a 30-day experiment', 'Measure against current approach'],
          risks: ['Counter-intuitive to stakeholders', 'Short-term revenue impact'],
          requiredResources: ['Leadership buy-in', 'Experiment budget'],
          inspiration: `Inversion: opposite of ${currentApproach}`,
          technique: 'inversion',
          tags: ['inversion', 'opposite'],
        },
        businessId,
      ),
    ];
  }

  private fallbackAnalogyIdea(businessId: string, company: string, principles: string[]): CreativeIdea[] {
    return [
      this.enrichIdea(
        {
          title: `${company}-Style ${principles[0] ?? 'Approach'}`,
          description: `Apply ${company}'s principle of "${principles[0] ?? 'excellence'}" to our business. What would change if we truly embodied this principle?`,
          category: 'strategy',
          novelty: 0.5,
          feasibility: 0.6,
          estimatedImpact: 0.5,
          implementationSteps: [`Research how ${company} implements this principle`, 'Identify 3 applications in our business', 'Prioritize by impact', 'Implement top priority', 'Measure results'],
          risks: ['May not fit our context', 'Requires cultural shift'],
          requiredResources: ['Research: 3 days', 'Implementation: varies'],
          inspiration: `Analogy: ${company} (${principles.join(', ')})`,
          technique: 'analogy',
          tags: ['analogy', company],
        },
        businessId,
      ),
    ];
  }

  private fallbackConstraintRemovalIdeas(businessId: string, prompt: string, count: number): CreativeIdea[] {
    const ideas: CreativeIdea[] = [];
    const constraints = ['money', 'time', 'technology', 'talent'];

    for (let i = 0; i < Math.min(count, constraints.length); i++) {
      ideas.push(
        this.enrichIdea(
          {
            title: `Unlimited ${constraints[i]} Vision`,
            description: `If ${constraints[i]} were unlimited: ${prompt}. What would we build? Then scale back to a realistic MVP.`,
            category: 'strategy',
            novelty: 0.7,
            feasibility: 0.3,
            estimatedImpact: 0.7,
            implementationSteps: [`Dream: unlimited ${constraints[i]}`, 'Document the vision', 'Identify the core value', 'Build MVP with current resources', 'Validate and iterate'],
            risks: ['Reality check may demotivate', 'Scope creep risk'],
            requiredResources: ['Workshop: 2 hours', 'MVP: 2-4 weeks'],
            inspiration: `Unconstrained: unlimited ${constraints[i]}`,
            technique: 'constraint_removal',
            tags: ['unconstrained', 'blue-sky'],
          },
          businessId,
        ),
      );
    }
    return ideas;
  }

  private fallbackExtremeUserIdea(businessId: string, userType: string, description: string): CreativeIdea {
    return this.enrichIdea(
      {
        title: `Extreme ${userType} Feature`,
        description: `Design a feature specifically for the extreme ${userType}: ${description}. What would make them absolutely love us?`,
        category: 'product',
        novelty: 0.6,
        feasibility: 0.45,
        estimatedImpact: 0.55,
        implementationSteps: [`Interview 3 ${userType} users`, 'Identify top pain point', 'Design extreme solution', 'Build MVP', 'Test with extreme users'],
        risks: ['May not appeal to average user', 'Narrow market'],
        requiredResources: ['User research: 1 week', 'Engineering: 2-3 weeks'],
        inspiration: `Designed for ${userType}: ${description}`,
        technique: 'extreme_users',
        tags: ['extreme-user', userType],
      },
      businessId,
    );
  }

  private fallbackTrendIdea(businessId: string, trend: { name: string; description: string; timeframe: string }): CreativeIdea {
    return this.enrichIdea(
      {
        title: `Ride: ${trend.name}`,
        description: `Exploit the emerging trend of ${trend.name}: ${trend.description}. Timeframe: ${trend.timeframe}.`,
        category: 'strategy',
        novelty: 0.55,
        feasibility: 0.5,
        estimatedImpact: 0.6,
        implementationSteps: [`Research ${trend.name} in our industry`, 'Identify first-mover opportunity', 'Build quick prototype', 'Launch to early adopters', 'Iterate based on feedback'],
        risks: ['Trend may not materialize', 'Competition may move faster'],
        requiredResources: ['Research: 3 days', 'Prototype: 2-4 weeks'],
        inspiration: `Riding trend: ${trend.name} (${trend.timeframe})`,
        technique: 'trend_riding',
        tags: ['trend', trend.name],
      },
      businessId,
    );
  }

  private fallbackProblemFirstIdeas(businessId: string, prompt: string, count: number): CreativeIdea[] {
    const ideas: CreativeIdea[] = [];
    const problems = [
      'customers spending too much time on manual tasks',
      'customers not getting value fast enough',
      'customers struggling to justify cost to stakeholders',
      'customers unable to integrate with their existing tools',
    ];

    for (let i = 0; i < Math.min(count, problems.length); i++) {
      ideas.push(
        this.enrichIdea(
          {
            title: `Solve: ${problems[i].slice(0, 40)}`,
            description: `Deep problem: ${problems[i]}. ${prompt}. How can we make this problem disappear entirely?`,
            category: 'product',
            novelty: 0.5,
            feasibility: 0.55,
            estimatedImpact: 0.65,
            implementationSteps: [`Interview 5 customers about ${problems[i]}`, 'Quantify the pain', 'Design solution', 'Prototype and test', 'Ship and measure relief'],
            risks: ['Problem may be symptoms of larger issue', 'Solution may create new problems'],
            requiredResources: ['Customer interviews: 3 days', 'Engineering: 2-4 weeks'],
            inspiration: `Solving: ${problems[i]}`,
            technique: 'problem_first',
            tags: ['problem-first', 'customer-pain'],
          },
          businessId,
        ),
      );
    }
    return ideas;
  }

  private fallbackStrategyGeneration(
    businessId: string,
    goal: string,
    businessContext: Record<string, unknown>,
  ): Promise<CreativeIdea[]> {
    const ideas = [
      this.enrichIdea(
        {
          title: `AI-Powered ${goal.slice(0, 30)}`,
          description: `Leverage AI to accelerate ${goal}. Use automation and personalization to achieve goals faster and at scale. Context: ${businessContext?.name ?? 'business'} in ${businessContext?.industry ?? 'industry'}.`,
          category: 'automation',
          novelty: 0.6,
          feasibility: 0.5,
          estimatedImpact: 0.7,
          implementationSteps: ['Audit current manual processes', 'Identify AI automation opportunities', 'Implement top 3 automations', 'Measure time savings', 'Scale successful automations'],
          risks: ['AI quality may not meet standards', 'Requires training data'],
          requiredResources: ['AI platform access', 'Engineering: 3-4 weeks'],
          inspiration: 'AI automation trend + business context',
          technique: 'combination',
          tags: ['AI', 'automation', 'strategy'],
        },
        businessId,
      ),
      this.enrichIdea(
        {
          title: 'Community-Led Growth Loop',
          description: `Build a community of power users who help each other achieve ${goal}. Community members become advocates, reducing CAC and increasing retention.`,
          category: 'marketing',
          novelty: 0.65,
          feasibility: 0.55,
          estimatedImpact: 0.75,
          implementationSteps: ['Identify 10 power users', 'Create community platform', 'Seed with valuable content', 'Enable peer-to-peer support', 'Reward top contributors'],
          risks: ['Community may not engage', 'Requires ongoing moderation'],
          requiredResources: ['Community platform', 'Community manager: 0.5 FTE'],
          inspiration: 'Trend riding: community-led growth',
          technique: 'trend_riding',
          tags: ['community', 'growth', 'marketing'],
        },
        businessId,
      ),
      this.enrichIdea(
        {
          title: 'Reverse the Funnel',
          description: `Instead of chasing leads for ${goal}, make leads chase you. Create irresistible content/tools that attract inbound interest.`,
          category: 'marketing',
          novelty: 0.7,
          feasibility: 0.4,
          estimatedImpact: 0.8,
          implementationSteps: ['Identify biggest customer pain point', 'Create free tool solving it', 'Gate with email capture', 'Nurture captured leads', 'Convert to paid'],
          risks: ['Free tool may cannibalize paid product', 'Long payback period'],
          requiredResources: ['Engineering: 4-6 weeks', 'Content: 2 weeks'],
          inspiration: 'Inversion: make customers come to you',
          technique: 'inversion',
          tags: ['inbound', 'content', 'growth'],
        },
        businessId,
      ),
      this.enrichIdea(
        {
          title: 'Strategic Partnership Channel',
          description: `Partner with complementary businesses to co-sell or integrate. Leverage their customer base to accelerate ${goal}.`,
          category: 'partnership',
          novelty: 0.5,
          feasibility: 0.6,
          estimatedImpact: 0.7,
          implementationSteps: ['Map complementary businesses', 'Rank by customer overlap', 'Reach out to top 10', 'Negotiate pilot partnership', 'Scale successful partnerships'],
          risks: ['Partner dependency', 'Revenue sharing complexity'],
          requiredResources: ['BD lead: 0.5 FTE', 'Integration: 2-4 weeks'],
          inspiration: 'Analogy: Airbnb partnership model',
          technique: 'analogy',
          tags: ['partnership', 'growth', 'channel'],
        },
        businessId,
      ),
      this.enrichIdea(
        {
          title: 'Outcome-Based Pricing Pivot',
          description: `Switch from seat-based to outcome-based pricing. Charge only when customers achieve ${goal}. Aligns incentives and reduces buyer risk.`,
          category: 'pricing',
          novelty: 0.8,
          feasibility: 0.3,
          estimatedImpact: 0.85,
          implementationSteps: ['Define measurable outcome metric', 'Model unit economics', 'Build outcome tracking', 'Pilot with 3 customers', 'Iterate pricing model'],
          risks: ['Revenue unpredictability', 'Outcome attribution complexity'],
          requiredResources: ['Finance modeling: 1 week', 'Engineering: 3-4 weeks'],
          inspiration: 'Trend riding: outcome-based pricing',
          technique: 'trend_riding',
          tags: ['pricing', 'innovation', 'model'],
        },
        businessId,
      ),
    ];

    return Promise.resolve(ideas);
  }

  private fallbackLateralSolutions(problem: string, reframe: string, businessId: string, sessionId: string): CreativeIdea[] {
    const reframeDescriptions: Record<string, string> = {
      scale_up: 'At massive scale, this becomes a distribution/infrastructure problem.',
      resource_flip: 'With the constraint flipped, the bottleneck moves elsewhere.',
      benefit_flip: 'This problem signals unmet demand we can capture.',
    };

    return [
      this.enrichIdea(
        {
          title: `${reframe} Solution for ${problem.slice(0, 30)}`,
          description: `${reframeDescriptions[reframe] ?? 'Reframed solution'} Apply lateral thinking to transform this problem into an opportunity.`,
          category: 'strategy',
          novelty: 0.6,
          feasibility: 0.45,
          estimatedImpact: 0.6,
          implementationSteps: ['Validate reframe assumption', 'Design solution for reframed problem', 'Test with users', 'Iterate'],
          risks: ['Reframe may not hold', 'Solution may miss original problem'],
          requiredResources: ['Research: 2-3 days'],
          inspiration: `Lateral thinking: ${reframe} reframe`,
          technique: 'problem_first',
          tags: ['lateral-thinking', reframe],
        },
        businessId,
        sessionId,
      ),
    ];
  }

  /* ═══════════════════════════════════════════════════════════════
     PRIVATE — PERSISTENCE & HELPERS
     ═══════════════════════════════════════════════════════════════ */

  private async persistIdeas(businessId: string, ideas: CreativeIdea[]): Promise<void> {
    // Update in-memory cache
    const existing = this.creativeHistory.get(businessId) ?? [];
    this.creativeHistory.set(businessId, [...existing, ...ideas]);

    // Persist to database
    for (const idea of ideas) {
      await this.prisma.client.keyCortexCreativeIdea
        ?.upsert({
          where: { id: idea.id },
          update: {
            status: idea.status,
            score: idea.score,
            feedback: idea.feedback,
          },
          create: {
            id: idea.id,
            title: idea.title,
            description: idea.description,
            category: idea.category,
            novelty: idea.novelty,
            feasibility: idea.feasibility,
            estimatedImpact: idea.estimatedImpact,
            implementationSteps: idea.implementationSteps,
            risks: idea.risks,
            requiredResources: idea.requiredResources,
            inspiration: idea.inspiration,
            technique: idea.technique,
            businessId: idea.businessId,
            status: idea.status,
            score: idea.score,
            generatedAt: idea.generatedAt,
            tags: idea.tags,
          },
        })
        .catch(() => {
          /* table may not exist */
        });
    }
  }

  private deserializeIdea(dbRecord: Record<string, unknown>): CreativeIdea {
    return {
      id: (dbRecord.id as string) ?? uuidv4(),
      title: (dbRecord.title as string) ?? '',
      description: (dbRecord.description as string) ?? '',
      category: (dbRecord.category as CreativeCategory) ?? 'strategy',
      novelty: Number(dbRecord.novelty ?? 0.5),
      feasibility: Number(dbRecord.feasibility ?? 0.5),
      estimatedImpact: Number(dbRecord.estimatedImpact ?? 0.5),
      implementationSteps: (dbRecord.implementationSteps as string[]) ?? [],
      risks: (dbRecord.risks as string[]) ?? [],
      requiredResources: (dbRecord.requiredResources as string[]) ?? [],
      inspiration: (dbRecord.inspiration as string) ?? '',
      technique: (dbRecord.technique as CreativityTechnique) ?? 'problem_first',
      businessId: (dbRecord.businessId as string) ?? '',
      status: (dbRecord.status as IdeaStatus) ?? 'generated',
      score: Number(dbRecord.score ?? 0),
      generatedAt: new Date((dbRecord.generatedAt as string) ?? Date.now()),
      implementedAt: dbRecord.implementedAt ? new Date(dbRecord.implementedAt as string) : undefined,
      feedback: (dbRecord.feedback as string) ?? undefined,
      tags: (dbRecord.tags as string[]) ?? [],
    };
  }

  private async findAllActiveBusinesses(): Promise<string[]> {
    const businesses = await this.prisma.client.business
      .findMany({ where: { active: true }, select: { id: true } })
      .catch(() => []);

    return (businesses as Array<{ id: string }>).map((b) => b.id);
  }
}
