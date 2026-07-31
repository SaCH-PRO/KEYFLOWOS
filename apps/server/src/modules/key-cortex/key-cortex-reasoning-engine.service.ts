/**
 * ============================================================================
 * KEY CORTEX — LAYER 2: MULTI-MODAL REASONING ENGINE
 * ============================================================================
 * KEY doesn't just think one way. It thinks in 7 distinct modes and synthesizes
 * the best answer from all of them:
 *
 *   1. ANALYTICAL  — Break down into components, systematic deduction
 *   2. CREATIVE    — Divergent thinking, novel combinations, what-if
 *   3. CRITICAL    — Challenge assumptions, find flaws, detect biases
 *   4. STRATEGIC   — Long-term thinking, positioning, game theory
 *   5. ANALOGICAL  — "This is like that" — pattern transfer across domains
 *   6. COUNTERFACTUAL — "What if we had done X instead of Y?"
 *   7. PROBABILISTIC — Bayesian reasoning, confidence intervals, risk
 *
 * The synthesis engine finds consensus across all modes, highlights
 * disagreements, and picks the best reasoning path.
 * ============================================================================
 */

import {
  Injectable,
  Logger,
  Inject,
} from '@nestjs/common';
import {
  ModelGatewayService,
  GatewayMessage,
} from '../ai/model-gateway.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { KeyCortexContextV2Service } from './key-cortex-context-v2.service';

/* ─────────────────────────── Type Definitions ─────────────────────────── */

export type ReasoningMode =
  | 'analytical'
  | 'creative'
  | 'critical'
  | 'strategic'
  | 'analogical'
  | 'counterfactual'
  | 'probabilistic';

export const ALL_REASONING_MODES: ReasoningMode[] = [
  'analytical',
  'creative',
  'critical',
  'strategic',
  'analogical',
  'counterfactual',
  'probabilistic',
];

export interface ReasoningStep {
  number: number;
  thought: string;
  evidence: string[];
  confidence: number;
  verification?: string;
}

export interface ReasoningChain {
  mode: ReasoningMode;
  steps: ReasoningStep[];
  confidence: number;
  conclusion: string;
  supportingEvidence: string[];
  counterArguments: string[];
  timeMs: number;
}

export interface MultiModalReasoningResult {
  chains: ReasoningChain[];
  bestChain: ReasoningChain;
  consensus: string;
  disagreements: string[];
  overallConfidence: number;
  reasoningTimeMs: number;
}

export interface SynthesisResult {
  consensus: string;
  disagreements: string[];
  bestChain: ReasoningChain;
  overallConfidence: number;
}

/* ─────────────────────────── AI Prompt Templates ─────────────────────────── */

const MODE_SYSTEM_PROMPTS: Record<ReasoningMode, string> = {
  analytical: `You are an analytical reasoning engine. Break problems into components, analyze each systematically, and build chains of logical deductions.

Rules:
- Decompose the problem into its fundamental components
- Apply formulas, ratios, or frameworks where relevant
- Each step must have supporting evidence and a confidence score
- End with a clear conclusion and overall confidence percentage

Output MUST be valid JSON in this exact format:
{
  "steps": [
    {
      "number": 1,
      "thought": "Step description",
      "evidence": ["evidence 1", "evidence 2"],
      "confidence": 0.85,
      "verification": "How to verify this step"
    }
  ],
  "conclusion": "Final conclusion",
  "supportingEvidence": ["evidence 1", "evidence 2"],
  "counterArguments": ["possible counter 1"],
  "confidence": 0.87
}`,

  creative: `You are a creative reasoning engine. Generate diverse, novel ideas using structured creativity techniques.

Techniques to apply:
1. COMBINATION: What if we combined X + Y?
2. INVERSION: What if we did the OPPOSITE of normal?
3. ANALOGY: What would Amazon/Apple/Tesla do here?
4. CONSTRAINT REMOVAL: What if money/time/technology were unlimited?
5. EXTREME USERS: What would a power user or first-timer want?

Generate 10+ diverse ideas, score each on novelty (0-1) and feasibility (0-1), then build the best creative path.

Output MUST be valid JSON in this exact format:
{
  "steps": [
    {
      "number": 1,
      "thought": "Creative exploration step",
      "evidence": ["supporting rationale"],
      "confidence": 0.72,
      "verification": "How to test this idea"
    }
  ],
  "conclusion": "Best creative direction",
  "supportingEvidence": ["why this works"],
  "counterArguments": ["risks and limitations"],
  "confidence": 0.72
}`,

  critical: `You are a critical reasoning engine. Your job is to find flaws, challenge assumptions, and detect cognitive biases.

Process:
1. List ALL assumptions underlying the problem/query
2. Challenge each assumption — is it actually true?
3. Check for cognitive biases: confirmation bias, sunk cost fallacy, anchoring, availability bias, groupthink
4. Identify logical fallacies in the reasoning
5. Evaluate the strength of the evidence
6. Provide a rigorous critical assessment

Output MUST be valid JSON in this exact format:
{
  "steps": [
    {
      "number": 1,
      "thought": "Critical evaluation step",
      "evidence": ["evidence of flaw or strength"],
      "confidence": 0.80,
      "verification": "How to verify this assessment"
    }
  ],
  "conclusion": "Critical assessment summary",
  "supportingEvidence": ["strong points identified"],
  "counterArguments": ["flaws found", "biases detected", "weaknesses"],
  "confidence": 0.80
}`,

  strategic: `You are a strategic reasoning engine. Think long-term, consider positioning, and analyze second-order effects.

Framework:
1. Consider implications at 6 months, 1 year, and 3 years
2. Evaluate positioning vs competitors and market dynamics
3. Analyze second-order and third-order effects (consequences of consequences)
4. Apply game theory where applicable (prisoner's dilemma, Nash equilibrium)
5. Consider resource allocation and strategic trade-offs
6. Identify moats, advantages, and vulnerabilities

Output MUST be valid JSON in this exact format:
{
  "steps": [
    {
      "number": 1,
      "thought": "Strategic analysis step",
      "evidence": ["market data", "competitive insight"],
      "confidence": 0.75,
      "verification": "How to validate this strategic insight"
    }
  ],
  "conclusion": "Strategic recommendation",
  "supportingEvidence": ["advantages"],
  "counterArguments": ["risks", "competitive threats"],
  "confidence": 0.75
}`,

  analogical: `You are an analogical reasoning engine. Find patterns from other industries, businesses, or domains and map them to the current situation.

Process:
1. Identify the core structure of the current problem
2. Find 3-5 analogous situations from other industries or well-known companies
3. Map the pattern: "Amazon did X in retail — what if we did X in our industry?"
4. Analyze what made those analogies succeed or fail
5. Extract transferable principles
6. Apply the best analogical insights to the current situation

Output MUST be valid JSON in this exact format:
{
  "steps": [
    {
      "number": 1,
      "thought": "Analogical insight step",
      "evidence": ["case study", "historical example"],
      "confidence": 0.70,
      "verification": "How to validate this analogy applies"
    }
  ],
  "conclusion": "Best analogical insight and application",
  "supportingEvidence": ["successful precedents"],
  "counterArguments": ["differences that limit applicability"],
  "confidence": 0.70
}`,

  counterfactual: `You are a counterfactual reasoning engine. Explore "What if we had done X instead of Y?" scenarios.

Process:
1. Identify the key decisions that led to the current situation
2. Generate 3-5 counterfactual scenarios (different choices at key moments)
3. For each scenario: model the likely outcome chain
4. Compare outcomes across all scenarios
5. Identify the highest-impact decision points
6. Extract actionable lessons for future decisions

Output MUST be valid JSON in this exact format:
{
  "steps": [
    {
      "number": 1,
      "thought": "Counterfactual scenario analysis",
      "evidence": ["data point", "historical parallel"],
      "confidence": 0.65,
      "verification": "How to test this counterfactual"
    }
  ],
  "conclusion": "Key counterfactual insights",
  "supportingEvidence": ["most likely alternative outcomes"],
  "counterArguments": ["uncertainties in counterfactual modeling"],
  "confidence": 0.65
}`,

  probabilistic: `You are a probabilistic reasoning engine. Think in distributions, not point estimates. Apply Bayesian reasoning.

Process:
1. Identify all uncertain variables in the problem
2. Estimate probability distributions for each variable (range + most likely)
3. Run mental Monte Carlo: what happens in best/worst/most-likely cases?
4. Calculate expected values and confidence intervals
5. Identify the variables with highest impact on outcomes (sensitivity analysis)
6. Provide confidence intervals, not single-point estimates

Output MUST be valid JSON in this exact format:
{
  "steps": [
    {
      "number": 1,
      "thought": "Probabilistic analysis step",
      "evidence": ["base rate", "historical data"],
      "confidence": 0.78,
      "verification": "How to validate these probabilities"
    }
  ],
  "conclusion": "Probabilistic assessment with confidence intervals",
  "supportingEvidence": ["data-backed probability estimates"],
  "counterArguments": ["unknown variables", "black swan risks"],
  "confidence": 0.78
}`,
};

/* ─────────────────────────── Service ─────────────────────────── */

@Injectable()
export class KeyCortexReasoningEngineService {
  private readonly logger = new Logger(KeyCortexReasoningEngineService.name);

  /** Maximum time allowed for a single reasoning mode (ms) */
  private readonly MODE_TIMEOUT_MS = 25000;

  /** Maximum time allowed for the full multi-modal reasoning (ms) */
  private readonly TOTAL_TIMEOUT_MS = 45000;

  constructor(
    @Inject(ModelGatewayService)
    private readonly modelGateway: ModelGatewayService,
    @Inject(AiUsageService)
    private readonly aiUsage: AiUsageService,
    @Inject(KeyCortexContextV2Service)
    private readonly contextV2: KeyCortexContextV2Service,
  ) {}

  /* ─────────────────────────── Public API ─────────────────────────── */

  /**
   * Run ALL requested reasoning modes in parallel, synthesize results.
   *
   * This is KEY's core thinking capability. When faced with a complex query,
   * KEY doesn't just pick one approach — it thinks analytically, creatively,
   * critically, strategically, analogically, counterfactually, AND probabilistically
   * all at once. Then it synthesizes the best answer from all perspectives.
   *
   * @param query        The user's question or problem
   * @param context      Business context (will be enriched with FullBusinessContext)
   * @param availableModes Which modes to run (defaults to ALL 7)
   */
  async reasonMultiModal(
    query: string,
    context: Record<string, unknown>,
    availableModes?: ReasoningMode[],
  ): Promise<MultiModalReasoningResult> {
    const startTime = Date.now();
    const modes = availableModes ?? ALL_REASONING_MODES;

    this.logger.log(
      `[reasonMultiModal] Running ${modes.length} reasoning modes in parallel for: "${query.substring(0, 80)}..."`,
    );

    // Extract businessId from context if available for enrichment
    const businessId = (context.businessId as string) || 'unknown';

    // Enrich context with full business data when possible
    let enrichedContext = context;
    try {
      if (businessId !== 'unknown') {
        const fullContext = await this.contextV2.getFullContext(businessId);
        const contextPrompt = this.contextV2.formatContextForPrompt(fullContext);
        enrichedContext = {
          ...context,
          _businessContext: contextPrompt,
          _healthScore: fullContext.summary.healthScore,
          _alerts: fullContext.summary.alerts,
        };
      }
    } catch (err) {
      this.logger.warn(
        `[reasonMultiModal] Could not enrich context: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Run all requested modes in parallel with individual timeouts
    const modePromises = modes.map((mode) =>
      this.runModeWithTimeout(mode, query, enrichedContext),
    );

    const chainResults = await Promise.allSettled(modePromises);

    const chains: ReasoningChain[] = [];
    const failures: string[] = [];

    chainResults.forEach((result, index) => {
      const mode = modes[index];
      if (result.status === 'fulfilled' && result.value) {
        chains.push(result.value);
      } else {
        const reason =
          result.status === 'rejected'
            ? result.reason instanceof Error
              ? result.reason.message
              : String(result.reason)
            : 'Empty result';
        this.logger.warn(`[reasonMultiModal] Mode '${mode}' failed: ${reason}`);
        failures.push(`${mode}: ${reason}`);
        // Create a fallback chain for failed modes so synthesis still works
        chains.push(this.createFallbackChain(mode, query, reason));
      }
    });

    if (chains.length === 0) {
      throw new Error(
        `All ${modes.length} reasoning modes failed. Errors: ${failures.join('; ')}`,
      );
    }

    // Synthesize all chains into a unified result
    const synthesis = this.synthesize(chains);

    const reasoningTimeMs = Date.now() - startTime;

    this.logger.log(
      `[reasonMultiModal] Completed ${chains.length} modes in ${reasoningTimeMs}ms. ` +
        `Best mode: ${synthesis.bestChain.mode} (confidence: ${Math.round(synthesis.bestChain.confidence * 100)}%). ` +
        `Overall confidence: ${Math.round(synthesis.overallConfidence * 100)}%`,
    );

    return {
      chains,
      bestChain: synthesis.bestChain,
      consensus: synthesis.consensus,
      disagreements: synthesis.disagreements,
      overallConfidence: synthesis.overallConfidence,
      reasoningTimeMs,
    };
  }

  /**
   * ANALYTICAL: Break problem into components, analyze systematically.
   *
   * Example for "Why did revenue drop?":
   *   Step 1: Revenue = leads x conversion x avg deal
   *   Step 2: Leads changed from X to Y (-20%)
   *   Step 3: Conversion changed from A to B (-5%)
   *   Step 4: Root cause = lead drop from paused campaign
   *   Confidence: 87%
   */
  async reasonAnalytical(
    query: string,
    context: Record<string, unknown>,
  ): Promise<ReasoningChain> {
    return this.executeReasoningMode('analytical', query, context);
  }

  /**
   * CREATIVE: Generate 10+ diverse ideas using creativity techniques.
   *
   * Techniques: combination, inversion, analogy, constraint removal,
   * extreme users. Score each on novelty and feasibility. Return best path.
   */
  async reasonCreative(
    query: string,
    context: Record<string, unknown>,
  ): Promise<ReasoningChain> {
    return this.executeReasoningMode('creative', query, context);
  }

  /**
   * CRITICAL: List ALL assumptions, challenge each, detect biases.
   *
   * Looks for: confirmation bias, sunk cost fallacy, anchoring,
   * availability bias, groupthink. Returns chain of critical evaluations.
   */
  async reasonCritical(
    query: string,
    context: Record<string, unknown>,
  ): Promise<ReasoningChain> {
    return this.executeReasoningMode('critical', query, context);
  }

  /**
   * STRATEGIC: Long-term thinking (6mo, 1yr, 3yr), positioning, game theory.
   *
   * Considers second-order effects and competitive dynamics.
   */
  async reasonStrategic(
    query: string,
    context: Record<string, unknown>,
  ): Promise<ReasoningChain> {
    return this.executeReasoningMode('strategic', query, context);
  }

  /**
   * ANALOGICAL: Find analogous situations from other industries/businesses.
   *
   * "Amazon did X in retail — what if we did X in our industry?"
   */
  async reasonAnalogical(
    query: string,
    context: Record<string, unknown>,
  ): Promise<ReasoningChain> {
    return this.executeReasoningMode('analogical', query, context);
  }

  /**
   * COUNTERFACTUAL: Explore "What if we had done X instead of Y?"
   *
   * Generate 3-5 counterfactual scenarios, model outcomes for each.
   */
  async reasonCounterfactual(
    query: string,
    context: Record<string, unknown>,
  ): Promise<ReasoningChain> {
    return this.executeReasoningMode('counterfactual', query, context);
  }

  /**
   * PROBABILISTIC: Identify uncertain variables, estimate distributions,
   * Monte Carlo-style modeling. Returns confidence intervals, not point estimates.
   */
  async reasonProbabilistic(
    query: string,
    context: Record<string, unknown>,
  ): Promise<ReasoningChain> {
    return this.executeReasoningMode('probabilistic', query, context);
  }

  /**
   * SYNTHESIZE: Extract conclusions from all chains, find consensus,
   * highlight disagreements, pick the best chain.
   *
   * Best chain selection criteria:
   *   - Confidence score (higher is better)
   *   - Evidence quality (number and specificity of supporting evidence)
   *   - Diversity (unique perspective adds value)
   */
  synthesize(chains: ReasoningChain[]): SynthesisResult {
    if (chains.length === 0) {
      return {
        consensus: 'No reasoning chains available.',
        disagreements: [],
        bestChain: this.createEmptyChain(),
        overallConfidence: 0,
      };
    }

    if (chains.length === 1) {
      return {
        consensus: chains[0].conclusion,
        disagreements: [],
        bestChain: chains[0],
        overallConfidence: chains[0].confidence,
      };
    }

    // ── Extract all conclusions ──
    const conclusions = chains.map((c) => ({
      mode: c.mode,
      conclusion: c.conclusion,
      confidence: c.confidence,
      evidenceCount: c.supportingEvidence.length,
      stepCount: c.steps.length,
    }));

    // ── Find consensus (agreement across modes) ──
    const consensus = this.findConsensus(conclusions);

    // ── Find disagreements ──
    const disagreements = this.findDisagreements(conclusions);

    // ── Pick best chain ──
    const bestChain = this.selectBestChain(chains);

    // ── Calculate overall confidence ──
    // Weighted average of all chain confidences, with bonus for consensus
    const avgConfidence =
      chains.reduce((sum, c) => sum + c.confidence, 0) / chains.length;

    // Consensus bonus: if many modes agree, boost confidence
    const agreementRatio =
      conclusions.filter((c) =>
        this.conclusionSimilarity(c.conclusion, bestChain.conclusion) > 0.3,
      ).length / conclusions.length;

    // Diversity bonus: different perspectives increase robustness
    const diversityBonus = Math.min(0.1, (chains.length - 1) * 0.02);

    // Evidence quality bonus
    const avgEvidenceQuality =
      chains.reduce((sum, c) => sum + c.supportingEvidence.length, 0) /
      chains.length;
    const evidenceBonus = Math.min(0.1, avgEvidenceQuality * 0.02);

    const overallConfidence = Math.min(
      1,
      avgConfidence * (0.7 + agreementRatio * 0.3) + diversityBonus + evidenceBonus,
    );

    return {
      consensus,
      disagreements,
      bestChain,
      overallConfidence: Math.round(overallConfidence * 100) / 100,
    };
  }

  /* ─────────────────────────── Private Implementation ─────────────────────────── */

  /**
   * Execute a single reasoning mode via AI with a timeout.
   */
  private async runModeWithTimeout(
    mode: ReasoningMode,
    query: string,
    context: Record<string, unknown>,
  ): Promise<ReasoningChain> {
    return this.withTimeout(
      this.executeReasoningMode(mode, query, context),
      this.MODE_TIMEOUT_MS,
      `Reasoning mode '${mode}' timed out after ${this.MODE_TIMEOUT_MS}ms`,
    );
  }

  /**
   * Execute a single reasoning mode via AI.
   */
  private async executeReasoningMode(
    mode: ReasoningMode,
    query: string,
    context: Record<string, unknown>,
  ): Promise<ReasoningChain> {
    const startTime = Date.now();
    const systemPrompt = MODE_SYSTEM_PROMPTS[mode];

    // Build context section
    const contextStr = this.formatContextForPrompt(context);

    const messages: GatewayMessage[] = [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: `Query: "${query}"

=== CONTEXT ===
${contextStr}

Provide your reasoning as JSON in the exact format specified.`,
      },
    ];

    try {
      const response = await this.modelGateway.complete({
        businessId: (context.businessId as string) || 'unknown',
        taskCategory: 'reasoning',
        messages,
        maxTokens: 2500,
        temperature: mode === 'creative' ? 0.9 : 0.4,
      });

      const content = response.content ?? '';
      const chain = this.parseReasoningChain(content, mode, startTime);

      // Track usage
      try {
        await this.aiUsage.callAi({
          businessId: (context.businessId as string) || 'unknown',
          feature: 'reasoning_engine',
          // GatewayMessage.content is a union (string | content parts); callAi
          // wants plain text, so flatten rather than assume a string.
          messages: messages.map((m) => ({
            role: m.role as 'system' | 'user' | 'assistant',
            content: typeof m.content === 'string' ? m.content : '',
          })),
          maxTokens: 2500,
          temperature: mode === 'creative' ? 0.9 : 0.4,
          taskCategory: 'reasoning',
          responseMode: 'structured_json',
        });
      } catch {
        // Non-blocking: usage tracking failure should not fail reasoning
      }

      return chain;
    } catch (error) {
      this.logger.error(
        `[executeReasoningMode] Mode '${mode}' failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Parse AI response into a structured ReasoningChain.
   */
  private parseReasoningChain(
    content: string,
    mode: ReasoningMode,
    startTime: number,
  ): ReasoningChain {
    // Extract JSON from the response (it may be wrapped in markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // If no JSON found, create a heuristic chain from the text
      return this.createHeuristicChain(content, mode, startTime);
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);

      const steps: ReasoningStep[] = (parsed.steps || []).map(
        (step: Record<string, unknown>, idx: number) => ({
          number: typeof step.number === 'number' ? step.number : idx + 1,
          thought: String(step.thought || ''),
          evidence: Array.isArray(step.evidence)
            ? step.evidence.map(String)
            : [],
          confidence:
            typeof step.confidence === 'number'
              ? Math.min(1, Math.max(0, step.confidence))
              : 0.5,
          verification:
            step.verification !== undefined
              ? String(step.verification)
              : undefined,
        }),
      );

      // If no steps parsed, create one from the conclusion
      if (steps.length === 0 && parsed.conclusion) {
        steps.push({
          number: 1,
          thought: String(parsed.conclusion),
          evidence: Array.isArray(parsed.supportingEvidence)
            ? parsed.supportingEvidence.map(String)
            : [],
          confidence:
            typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        });
      }

      return {
        mode,
        steps,
        confidence:
          typeof parsed.confidence === 'number'
            ? Math.min(1, Math.max(0, parsed.confidence))
            : 0.5,
        conclusion: String(parsed.conclusion || 'No conclusion provided'),
        supportingEvidence: Array.isArray(parsed.supportingEvidence)
          ? parsed.supportingEvidence.map(String)
          : [],
        counterArguments: Array.isArray(parsed.counterArguments)
          ? parsed.counterArguments.map(String)
          : [],
        timeMs: Date.now() - startTime,
      };
    } catch {
      // JSON parse failed — fall back to heuristic extraction
      return this.createHeuristicChain(content, mode, startTime);
    }
  }

  /**
   * Create a heuristic ReasoningChain from free-text when JSON parsing fails.
   */
  private createHeuristicChain(
    content: string,
    mode: ReasoningMode,
    startTime: number,
  ): ReasoningChain {
    // Split content into lines and extract meaningful sentences
    const lines = content
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 10);

    const steps: ReasoningStep[] = [];
    const supportingEvidence: string[] = [];
    const counterArguments: string[] = [];

    // Look for numbered steps (e.g., "1.", "Step 1:", etc.)
    const stepRegex = /^(?:step\s*)?(\d+)[:.)]\s*(.+)/i;
    let stepNumber = 0;

    for (const line of lines) {
      const match = stepRegex.exec(line);
      if (match) {
        stepNumber++;
        steps.push({
          number: stepNumber,
          thought: match[2],
          evidence: ['Extracted from AI response'],
          confidence: 0.5 + stepNumber * 0.05, // Slight confidence increase per step
        });
      } else if (
        line.toLowerCase().includes('conclusion') ||
        line.toLowerCase().includes('therefore') ||
        line.toLowerCase().includes('in summary')
      ) {
        // This is likely the conclusion
        supportingEvidence.push(line);
      } else if (
        line.toLowerCase().includes('however') ||
        line.toLowerCase().includes('but') ||
        line.toLowerCase().includes('risk') ||
        line.toLowerCase().includes('caution')
      ) {
        counterArguments.push(line);
      } else if (line.length > 20 && steps.length === 0) {
        // Fallback: treat as a single-step chain
        steps.push({
          number: 1,
          thought: line,
          evidence: ['Extracted from AI response'],
          confidence: 0.5,
        });
      }
    }

    // Extract conclusion from the last substantial line
    const conclusion =
      lines.filter((l) => l.length > 15).pop() || 'Analysis complete';

    // Estimate confidence from content signals
    let confidence: number;
    const lower = content.toLowerCase();
    if (lower.includes('high confidence')) confidence = 0.85;
    else if (lower.includes('moderate confidence')) confidence = 0.65;
    else if (lower.includes('low confidence')) confidence = 0.35;
    else if (lower.includes('uncertain')) confidence = 0.3;
    else confidence = Math.min(0.8, 0.4 + steps.length * 0.05);

    return {
      mode,
      steps,
      confidence: Math.round(confidence * 100) / 100,
      conclusion,
      supportingEvidence: supportingEvidence.length > 0 ? supportingEvidence : [content.substring(0, 200)],
      counterArguments: counterArguments.length > 0 ? counterArguments : ['Heuristic extraction — verify independently'],
      timeMs: Date.now() - startTime,
    };
  }

  /**
   * Create a fallback chain when a mode fails entirely.
   */
  private createFallbackChain(
    mode: ReasoningMode,
    query: string,
    errorReason: string,
  ): ReasoningChain {
    return {
      mode,
      steps: [
        {
          number: 1,
          thought: `${mode} reasoning could not be executed due to: ${errorReason}`,
          evidence: ['System fallback'],
          confidence: 0.1,
        },
      ],
      confidence: 0.05,
      conclusion: `Unable to apply ${mode} reasoning to: "${query.substring(0, 60)}..."`,
      supportingEvidence: [],
      counterArguments: [`${mode} mode unavailable: ${errorReason}`],
      timeMs: 0,
    };
  }

  private createEmptyChain(): ReasoningChain {
    return {
      mode: 'analytical',
      steps: [],
      confidence: 0,
      conclusion: 'No reasoning performed',
      supportingEvidence: [],
      counterArguments: [],
      timeMs: 0,
    };
  }

  /**
   * Format context object into a string for AI prompts.
   */
  private formatContextForPrompt(context: Record<string, unknown>): string {
    if (context._businessContext && typeof context._businessContext === 'string') {
      return context._businessContext as string;
    }

    const entries = Object.entries(context)
      .filter(([key]) => !key.startsWith('_'))
      .map(([key, value]) => {
        if (typeof value === 'object' && value !== null) {
          return `${key}: ${JSON.stringify(value).substring(0, 500)}`;
        }
        return `${key}: ${String(value).substring(0, 200)}`;
      });

    return entries.join('\n') || 'No additional context provided.';
  }

  /* ─────────────────────────── Synthesis Helpers ─────────────────────────── */

  /**
   * Find areas of agreement across all reasoning chains.
   */
  private findConsensus(
    conclusions: Array<{
      mode: ReasoningMode;
      conclusion: string;
      confidence: number;
    }>,
  ): string {
    if (conclusions.length === 0) return 'No conclusions to synthesize.';
    if (conclusions.length === 1) return conclusions[0].conclusion;

    // Find the conclusion that has the most "similar" counterparts
    let bestConsensus = conclusions[0].conclusion;
    let bestConsensusScore = 0;

    for (const candidate of conclusions) {
      const supporters = conclusions.filter(
        (other) =>
          this.conclusionSimilarity(candidate.conclusion, other.conclusion) >
          0.4,
      );
      const score = supporters.reduce((s, c) => s + c.confidence, 0);
      if (score > bestConsensusScore) {
        bestConsensusScore = score;
        bestConsensus = candidate.conclusion;
      }
    }

    // If there's a clear winner with multiple supporters, that's consensus
    const supporterCount = conclusions.filter(
      (c) => this.conclusionSimilarity(bestConsensus, c.conclusion) > 0.4,
    ).length;

    if (supporterCount >= 2) {
      return `${bestConsensus} (agreed by ${supporterCount} of ${conclusions.length} reasoning modes)`;
    }

    // No strong consensus — summarize what modes agree on directionally
    const themes = this.extractCommonThemes(conclusions.map((c) => c.conclusion));
    if (themes.length > 0) {
      return `Partial consensus: ${themes.join(', ')}. Best-supported view: ${bestConsensus}`;
    }

    return `No clear consensus across modes. Best-supported individual conclusion: ${bestConsensus}`;
  }

  /**
   * Find areas of disagreement across reasoning chains.
   */
  private findDisagreements(
    conclusions: Array<{
      mode: ReasoningMode;
      conclusion: string;
      confidence: number;
    }>,
  ): string[] {
    if (conclusions.length <= 1) return [];

    const disagreements: string[] = [];

    // Check for opposing directions (growth vs decline, do vs don't)
    const positiveSignals = conclusions.filter(
      (c) =>
        /\b(grow|increase|up|positive|opportunity|do\b|should|recommend)/i.test(
          c.conclusion,
        ),
    );
    const negativeSignals = conclusions.filter(
      (c) =>
        /\b(drop|decrease|down|negative|risk|don't|avoid|caution)/i.test(
          c.conclusion,
        ),
    );

    if (positiveSignals.length > 0 && negativeSignals.length > 0) {
      disagreements.push(
        `Directional conflict: ${positiveSignals.length} mode(s) suggest positive action while ${negativeSignals.length} mode(s) urge caution`,
      );
    }

    // Check for confidence divergence
    const confidences = conclusions.map((c) => c.confidence);
    const maxConf = Math.max(...confidences);
    const minConf = Math.min(...confidences);
    if (maxConf - minConf > 0.4) {
      const highConf = conclusions.find((c) => c.confidence === maxConf);
      const lowConf = conclusions.find((c) => c.confidence === minConf);
      disagreements.push(
        `Confidence divergence: ${highConf?.mode} is ${Math.round(maxConf * 100)}% confident but ${lowConf?.mode} is only ${Math.round(minConf * 100)}% confident`,
      );
    }

    // Find pairs with very different conclusions
    for (let i = 0; i < conclusions.length; i++) {
      for (let j = i + 1; j < conclusions.length; j++) {
        const sim = this.conclusionSimilarity(
          conclusions[i].conclusion,
          conclusions[j].conclusion,
        );
        if (sim < 0.2) {
          disagreements.push(
            `${conclusions[i].mode} vs ${conclusions[j].mode}: fundamentally different conclusions`,
          );
        }
      }
    }

    // Deduplicate
    return [...new Set(disagreements)];
  }

  /**
   * Select the best reasoning chain using weighted scoring.
   */
  private selectBestChain(chains: ReasoningChain[]): ReasoningChain {
    if (chains.length === 0) return this.createEmptyChain();
    if (chains.length === 1) return chains[0];

    const scored = chains.map((chain) => {
      let score = 0;

      // Confidence weight (40%)
      score += chain.confidence * 0.4;

      // Evidence quality (25%)
      const evidenceScore = Math.min(chain.supportingEvidence.length / 5, 1);
      score += evidenceScore * 0.25;

      // Step depth / thoroughness (15%)
      const depthScore = Math.min(chain.steps.length / 4, 1);
      score += depthScore * 0.15;

      // Counter-argument awareness shows intellectual honesty (10%)
      const counterScore = Math.min(chain.counterArguments.length / 2, 1);
      score += counterScore * 0.1;

      // Speed bonus — faster reasoning with similar quality is better (10%)
      const avgTime =
        chains.reduce((s, c) => s + c.timeMs, 0) / chains.length;
      const speedScore =
        avgTime > 0 ? Math.min(avgTime / Math.max(chain.timeMs, 1), 1) : 0.5;
      score += speedScore * 0.1;

      // Diversity bonus for unique modes (small)
      const modeBonus =
        chain.mode === 'creative' || chain.mode === 'analogical' ? 0.02 : 0;
      score += modeBonus;

      return { chain, score: Math.round(score * 1000) / 1000 };
    });

    scored.sort((a, b) => b.score - a.score);

    this.logger.debug(
      `[selectBestChain] Winner: ${scored[0].chain.mode} (score: ${scored[0].score})`,
    );

    return scored[0].chain;
  }

  /**
   * Calculate a simple similarity score between two conclusion strings.
   * Returns 0-1 where 1 means very similar.
   */
  private conclusionSimilarity(a: string, b: string): number {
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 3);

    const wordsA = new Set(normalize(a));
    const wordsB = new Set(normalize(b));

    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);

    return intersection.size / union.size;
  }

  /**
   * Extract common themes from a set of conclusion strings.
   */
  private extractCommonThemes(conclusions: string[]): string[] {
    const themeKeywords: Record<string, string[]> = {
      'revenue growth': ['revenue', 'grow', 'increase', 'sales', 'income'],
      'cost reduction': ['cost', 'reduce', 'cut', 'save', 'expense'],
      'customer focus': ['customer', 'client', 'user', 'experience', 'service'],
      'marketing': ['marketing', 'campaign', 'advertising', 'promotion', 'reach'],
      'product': ['product', 'feature', 'offering', 'solution', 'build'],
      'team': ['team', 'hire', 'talent', 'people', 'staff'],
      'automation': ['automate', 'efficiency', 'process', 'workflow', 'system'],
      risk: ['risk', 'danger', 'threat', 'problem', 'issue'],
      opportunity: ['opportunity', 'chance', 'potential', 'advantage'],
    };

    const themes: string[] = [];
    const allText = conclusions.join(' ').toLowerCase();

    for (const [theme, keywords] of Object.entries(themeKeywords)) {
      const matches = keywords.filter((kw) => allText.includes(kw));
      if (matches.length >= 2) {
        themes.push(theme);
      }
    }

    return themes;
  }

  /**
   * Wrap a promise with a timeout.
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    errorMessage: string,
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(errorMessage)), timeoutMs),
      ),
    ]);
  }
}
