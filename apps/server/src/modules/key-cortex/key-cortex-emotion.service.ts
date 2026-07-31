/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * KEY CORTEX — EMOTIONAL INTELLIGENCE ENGINE (Layer 1)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Detects, tracks, and responds to the user's emotional state.
 * KEY doesn't just parse text — it reads behavioural signals, compares
 * against the user's baseline, and cross-references business stress
 * indicators to build a holistic emotional picture.
 *
 * Responsibilities:
 *   • detectEmotion()       — multi-signal emotion detection
 *   • generateEmotionalResponse() — persona + tone adaptation
 *   • trackEmotionalTrend() — longitudinal emotional profiling
 *   • shouldIntervene()     — proactive outreach gating
 *   • getEmotionalBaseline() — per-user baseline computation
 *
 * @module key-cortex-emotion.service
 * @layer  1
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  EmotionalState,
  EmotionalProfile,
  EmotionSignals,
  KeyEmotionalResponse,
  ToneAdjustment,
  PrimaryEmotion,
  EmotionalTrend,
  CortexMessage,
  CortexPersona,
} from './key-cortex-consciousness.types';

/** Injected dependencies — resolved at module bootstrap. */
interface EmotionServiceDeps {
  prisma: { cortexMessage: { findMany: (args: unknown) => Promise<unknown[]> } };
  modelGateway: { complete: (prompt: string, opts?: unknown) => Promise<{ text: string; usage?: { totalTokens: number } }> };
  aiUsage: { record: (params: { userId: string; model: string; tokens: number; purpose: string; cost: number }) => Promise<void> };
  personalityService: { getActivePersona: (userId: string) => Promise<CortexPersona>; listPersonas: () => Promise<CortexPersona[]> };
}

/** Persona mapping for emotional adaptation — which persona serves which emotion. */
const EMOTION_PERSONA_MAP: Record<PrimaryEmotion, string> = {
  calm:        'nova',
  stressed:    'friday',
  excited:     'nova',
  frustrated:  'tactical',
  anxious:     'mentor',
  curious:     'nova',
  urgent:      'jarvis-dark',
  tired:       'ghost',
  confident:   'jarvis',
  confused:    'mentor',
};

/** Comfort messages tailored to each negative emotion. */
const COMFORT_MESSAGES: Partial<Record<PrimaryEmotion, string>> = {
  stressed:
    "I can see things feel intense right now. Take a breath — I'm here to help sort through it together.",
  anxious:
    "It sounds like there's a lot on your mind. Let's break things down step by step — no rush.",
  frustrated:
    "I hear your frustration, and I want to fix this. Let me find the clearest path forward for you.",
  tired:
    "You seem exhausted. I'll keep this brief and only surface what truly needs your attention right now.",
  urgent:
    "I'm on it — I'll prioritise the fastest path to resolution. Let me handle the details.",
  confused:
    "No worries at all — this stuff can be complex. I'll explain it in the simplest way possible.",
};

/** Linguistic keyword lexicons for heuristic emotion detection. */
const EMOTION_LEXICON: Record<string, PrimaryEmotion> = {
  // Stress indicators
  overwhelmed: 'stressed', deadline: 'stressed', panic: 'stressed', pressure: 'stressed',
  drowning: 'stressed', crisis: 'stressed', emergency: 'stressed', burning: 'stressed',
  // Frustration indicators
  annoyed: 'frustrated', angry: 'frustrated', furious: 'frustrated', ridiculous: 'frustrated',
  unacceptable: 'frustrated', broken: 'frustrated', 'not working': 'frustrated', useless: 'frustrated',
  waste: 'frustrated', 'sick of': 'frustrated', 'tired of': 'frustrated', 'fed up': 'frustrated',
  // Anxiety indicators
  worried: 'anxious', nervous: 'anxious', scared: 'anxious', unsure: 'anxious',
  'what if': 'anxious', 'dont know': 'anxious', "don't know": 'anxious', uncertain: 'anxious',
  // Excitement indicators
  amazing: 'excited', awesome: 'excited', fantastic: 'excited', brilliant: 'excited',
  love: 'excited', perfect: 'excited', incredible: 'excited', 'cant wait': 'excited',
  // Urgency indicators
  asap: 'urgent', urgently: 'urgent', immediately: 'urgent', now: 'urgent',
  hurry: 'urgent', rush: 'urgent', critical: 'urgent', 'right now': 'urgent',
  // Curiosity indicators
  curious: 'curious', wondering: 'curious', 'how does': 'curious', 'what is': 'curious',
  'tell me more': 'curious', explain: 'curious', interested: 'curious',
  // Confidence indicators
  confident: 'confident', sure: 'confident', 'got this': 'confident', ready: 'confident',
  'nailed it': 'confident', success: 'confident', easy: 'confident',
  // Tired indicators
  exhausted: 'tired', tired: 'tired', sleepy: 'tired', drained: 'tired',
  burnout: 'tired', 'need sleep': 'tired', 'too much': 'tired', done: 'tired',
  // Confusion indicators
  confused: 'confused', lost: 'confused', 'dont understand': 'confused', "don't understand": 'confused',
  help: 'confused', stuck: 'confused', 'how do i': 'confused', 'what do i': 'confused',
};

/** Urgency-specific keywords for linguistic signal extraction. */
const URGENCY_WORDS = ['now', 'asap', 'urgent', 'urgently', 'immediately', 'hurry', 'rush', 'critical', 'emergency', 'quickly'];

/** Hesitation-specific keywords. */
const HESITATION_WORDS = ['maybe', 'perhaps', 'not sure', 'i think', 'possibly', 'might', 'could be', 'unsure', 'uncertain'];

/** Frustration-specific keywords. */
const FRUSTRATION_WORDS = ['again', 'still', 'why', 'never', 'always', 'frustrating', 'annoying', 'broken', 'useless', 'waste', 'ridiculous'];

/** Excitement-specific keywords. */
const EXCITEMENT_WORDS = ['amazing', 'awesome', 'love', 'perfect', 'fantastic', 'brilliant', 'incredible', 'excited', 'thrilled', 'wonderful'];

@Injectable()
export class KeyCortexEmotionService {
  private readonly logger = new Logger(KeyCortexEmotionService.name);

  // In-memory emotional state cache for fast per-session lookups (userId → states)
  private readonly emotionalCache = new Map<string, EmotionalState[]>();

  // Cache TTL: 24 hours
  private readonly CACHE_TTL_MS = 86_400_000;
  private cacheTimestamps = new Map<string, number>();

  constructor(
    private readonly prisma: EmotionServiceDeps['prisma'],
    private readonly modelGateway: EmotionServiceDeps['modelGateway'],
    private readonly aiUsage: EmotionServiceDeps['aiUsage'],
    private readonly personalityService: EmotionServiceDeps['personalityService'],
  ) {}

  /* ═══════════════════════════════════════════════════════════════════════════
     PUBLIC API
     ═══════════════════════════════════════════════════════════════════════════ */

  /**
   * Detect the user's emotional state from text, behavioural signals,
   * business context, and their personal baseline.
   *
   * Pipeline:
   *   1. Linguistic analysis (keyword matching + AI)
   *   2. Behavioural signal extraction (session metadata)
   *   3. Baseline comparison (personal "normal")
   *   4. Business stress cross-reference (overdue invoices, revenue, failures)
   *   5. Weighted aggregation → EmotionalState
   */
  async detectEmotion(
    businessId: string,
    userId: string,
    text: string,
    sessionHistory: CortexMessage[],
  ): Promise<EmotionalState> {
    const startTime = Date.now();

    // ── 1. Linguistic signal extraction ──────────────────────────────────
    const linguisticSignals = this.extractLinguisticSignals(text);

    // ── 2. Behavioural signal extraction ─────────────────────────────────
    const behavioralSignals = this.extractBehavioralSignals(sessionHistory);

    // ── 3. Heuristic keyword-based emotion scoring ───────────────────────
    const keywordEmotion = this.scoreKeywords(text.toLowerCase());

    // ── 4. AI-powered emotion analysis (optional enrichment) ─────────────
    const aiEmotion = await this.analyzeWithAI(businessId, text, userId);

    // ── 5. Business stress indicators ────────────────────────────────────
    const businessStress = await this.assessBusinessStress(userId);

    // ── 6. Baseline comparison ───────────────────────────────────────────
    const baseline = await this.getEmotionalBaseline(userId);

    // ── 7. Weighted aggregation ──────────────────────────────────────────
    const aggregated = this.aggregateEmotions(
      keywordEmotion,
      aiEmotion,
      linguisticSignals,
      behavioralSignals,
      businessStress,
      baseline,
    );

    // ── 8. Persist and cache ─────────────────────────────────────────────
    this.cacheEmotionalState(userId, aggregated);
    this.logger.debug(
      `Emotion detected for ${userId}: ${aggregated.primary} (${(aggregated.intensity * 100).toFixed(0)}%) in ${Date.now() - startTime}ms`,
    );

    return aggregated;
  }

  /**
   * Generate KEY's emotional response to a detected user emotion.
   * Determines persona adaptation, tone adjustments, and whether
   * KEY should proactively offer help.
   */
  async generateEmotionalResponse(
    emotion: EmotionalState,
    currentPersona: CortexPersona,
  ): Promise<KeyEmotionalResponse> {
    const suggestedPersonaId = EMOTION_PERSONA_MAP[emotion.primary];
    const adaptPersona = suggestedPersonaId !== currentPersona.id;

    const toneAdjustment = this.computeToneAdjustment(emotion);
    const shouldProactivelyHelp = this.computeProactiveHelp(emotion);
    const comfortMessage = COMFORT_MESSAGES[emotion.primary];

    return {
      adaptPersona,
      suggestedPersona: suggestedPersonaId,
      toneAdjustment,
      shouldProactivelyHelp,
      comfortMessage,
    };
  }

  /**
   * Track the user's emotional trend over a given time period.
   * Queries historical emotional states and computes statistical profile.
   */
  async trackEmotionalTrend(
    userId: string,
    period: 'day' | 'week' | 'month',
  ): Promise<EmotionalProfile> {
    const states = await this.fetchHistoricalStates(userId, period);

    if (states.length === 0) {
      return this.buildDefaultProfile(userId, period);
    }

    const baseline = this.computeModeEmotion(states);
    const averageIntensity = this.mean(states.map((s) => s.intensity));
    const intensityVariance = this.variance(states.map((s) => s.intensity));
    const trendDirection = this.computeTrendDirection(states);

    return {
      userId,
      period,
      baseline,
      averageIntensity: Math.round(averageIntensity * 1000) / 1000,
      intensityVariance: Math.round(intensityVariance * 1000) / 1000,
      trendDirection,
      stateHistory: states,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Determine whether KEY should proactively reach out to the user.
   * Returns true if the user shows sustained negative emotion or
   * if business health is declining.
   */
  async shouldIntervene(userId: string): Promise<boolean> {
    const recentStates = this.getCachedStates(userId);

    // Check for sustained negative emotion (3+ consecutive stressed/frustrated/anxious)
    const negativeEmotions: PrimaryEmotion[] = ['stressed', 'frustrated', 'anxious', 'tired'];
    const recentNegativeCount = recentStates.filter((s) =>
      negativeEmotions.includes(s.primary),
    ).length;

    if (recentNegativeCount >= 3) {
      this.logger.log(
        `Proactive intervention triggered for ${userId}: ${recentNegativeCount} recent negative emotional states`,
      );
      return true;
    }

    // Check declining business health
    const businessStress = await this.assessBusinessStress(userId);
    if (businessStress > 0.7) {
      this.logger.log(
        `Proactive intervention triggered for ${userId}: business stress score ${(businessStress * 100).toFixed(0)}%`,
      );
      return true;
    }

    return false;
  }

  /**
   * Compute the user's typical emotional state from their interaction history.
   * This baseline is used to contextualise new emotional detections.
   */
  async getEmotionalBaseline(userId: string): Promise<EmotionalState> {
    const profile = await this.trackEmotionalTrend(userId, 'week');

    return {
      primary: profile.baseline,
      intensity: profile.averageIntensity,
      confidence: 0.85,
      triggers: ['historical_baseline_computation'],
      trend: profile.trendDirection,
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     LINGUISTIC ANALYSIS
     ═══════════════════════════════════════════════════════════════════════════ */

  /** Extract linguistic emotion signals from raw text. */
  private extractLinguisticSignals(text: string): EmotionSignals['linguistic'] {
    const lower = text.toLowerCase();
    const words = lower.split(/\s+/).filter((w) => w.length > 0);
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);

    const countOccurrences = (haystack: string, needles: string[]): number =>
      needles.reduce((sum, word) => {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        const matches = haystack.match(regex);
        return sum + (matches ? matches.length : 0);
      }, 0);

    const capsWords = text.split(/\s+/).filter((w) => w === w.toUpperCase() && w.length > 1);
    const capsRatio = words.length > 0 ? capsWords.length / words.length : 0;

    const intensePunct = (text.match(/[!?]{2,}/g) || []).length;
    const punctuationDensity = text.length > 0 ? intensePunct / text.length : 0;

    const sentenceLength = sentences.length > 0
      ? words.length / sentences.length
      : words.length;

    return {
      urgencyWords: countOccurrences(lower, URGENCY_WORDS),
      hesitationWords: countOccurrences(lower, HESITATION_WORDS),
      frustrationWords: countOccurrences(lower, FRUSTRATION_WORDS),
      excitementWords: countOccurrences(lower, EXCITEMENT_WORDS),
      capsRatio: Math.min(capsRatio, 1.0),
      punctuationDensity: Math.min(punctuationDensity, 1.0),
      sentenceLength,
    };
  }

  /** Extract behavioural signals from session message history. */
  private extractBehavioralSignals(
    sessionHistory: CortexMessage[],
  ): EmotionSignals['behavioral'] {
    if (sessionHistory.length < 2) {
      return {
        responseTime: 5000,
        correctionRate: 0,
        sessionLength: 0,
        repeatQueries: 0,
        approvalRate: 0.5,
      };
    }

    const userMessages = sessionHistory.filter((m) => m.role === 'user');
    const assistantMessages = sessionHistory.filter((m) => m.role === 'assistant');

    // Response time: average gap between user and assistant messages
    const responseTimes: number[] = [];
    for (let i = 1; i < sessionHistory.length; i++) {
      if (
        sessionHistory[i].role === 'assistant' &&
        sessionHistory[i - 1].role === 'user'
      ) {
        const userTime = new Date(sessionHistory[i - 1].timestamp).getTime();
        const assistantTime = new Date(sessionHistory[i].timestamp).getTime();
        const delta = assistantTime - userTime;
        if (delta > 0 && delta < 300_000) {
          // cap at 5 min
          responseTimes.push(delta);
        }
      }
    }
    const avgResponseTime = responseTimes.length > 0
      ? this.mean(responseTimes)
      : 5000;

    // Session length
    const firstTime = new Date(sessionHistory[0].timestamp).getTime();
    const lastTime = new Date(sessionHistory[sessionHistory.length - 1].timestamp).getTime();
    const sessionLength = lastTime - firstTime;

    // Correction rate: user messages containing corrections
    const correctionIndicators = ['no', 'wrong', 'incorrect', 'not right', 'fix', 'correction', 'actually', 'meant'];
    const corrections = userMessages.filter((m) =>
      correctionIndicators.some((indicator) =>
        m.content.toLowerCase().includes(indicator),
      ),
    ).length;
    const correctionRate = userMessages.length > 0
      ? corrections / userMessages.length
      : 0;

    // Repeat queries: similar content in recent user messages
    const repeatQueries = this.countRepeatQueries(userMessages);

    // Approval rate: count of positive acknowledgements
    const approvalIndicators = ['thanks', 'thank you', 'perfect', 'great', 'good', 'awesome', 'love', 'nice', 'helpful'];
    const approvals = userMessages.filter((m) =>
      approvalIndicators.some((indicator) =>
        m.content.toLowerCase().includes(indicator),
      ),
    ).length;
    const approvalRate = assistantMessages.length > 0
      ? approvals / assistantMessages.length
      : 0.5;

    return {
      responseTime: avgResponseTime,
      correctionRate: Math.min(correctionRate, 1.0),
      sessionLength,
      repeatQueries,
      approvalRate: Math.min(approvalRate, 1.0),
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     KEYWORD-BASED EMOTION SCORING
     ═══════════════════════════════════════════════════════════════════════════ */

  /** Score emotions based on keyword presence in the text. */
  private scoreKeywords(text: string): Map<PrimaryEmotion, number> {
    const scores = new Map<PrimaryEmotion, number>();
    const emotions = Object.keys(EMOTION_PERSONA_MAP) as PrimaryEmotion[];
    emotions.forEach((e) => scores.set(e, 0));

    for (const [keyword, emotion] of Object.entries(EMOTION_LEXICON)) {
      const regex = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'gi');
      const matches = text.match(regex);
      if (matches) {
        scores.set(emotion, (scores.get(emotion) || 0) + matches.length);
      }
    }

    return scores;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     AI-POWERED EMOTION ANALYSIS
     ═══════════════════════════════════════════════════════════════════════════ */

  /**
   * Use the model gateway for a more nuanced emotional analysis.
   * Falls back to neutral if the gateway is unavailable.
   */
  private async analyzeWithAI(
    businessId: string,
    text: string,
    userId: string,
  ): Promise<{ emotion: PrimaryEmotion; intensity: number; confidence: number }> {
    try {
      const prompt = this.buildEmotionPrompt(text);
      const response = await this.modelGateway.complete({
        businessId,
        taskCategory: 'reasoning',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        maxTokens: 128,
      });

      // Parse JSON from model response
      const parsed = this.parseAIEmotionResponse(response.content ?? '');


      return parsed;
    } catch (err) {
      this.logger.warn(`AI emotion analysis failed: ${(err as Error).message}`);
      return { emotion: 'calm', intensity: 0.3, confidence: 0.5 };
    }
  }

  private buildEmotionPrompt(text: string): string {
    return [
      'Analyze the emotional tone of the following message.',
      'Respond ONLY with a JSON object containing:',
      '{"emotion": "<calm|stressed|excited|frustrated|anxious|curious|urgent|tired|confident|confused>",',
      '"intensity": <0.0-1.0>, "confidence": <0.0-1.0>}',
      '',
      `Message: "${text.replace(/"/g, '\\"')}"`,
      '',
      'JSON:',
    ].join('\n');
  }

  private parseAIEmotionResponse(text: string): {
    emotion: PrimaryEmotion;
    intensity: number;
    confidence: number;
  } {
    try {
      // Extract JSON from potential markdown wrapping
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : text;
      const parsed = JSON.parse(jsonStr);

      const validEmotions: PrimaryEmotion[] = [
        'calm', 'stressed', 'excited', 'frustrated', 'anxious',
        'curious', 'urgent', 'tired', 'confident', 'confused',
      ];

      return {
        emotion: validEmotions.includes(parsed.emotion)
          ? parsed.emotion
          : 'calm',
        intensity: this.clamp(parsed.intensity, 0, 1),
        confidence: this.clamp(parsed.confidence, 0, 1),
      };
    } catch {
      return { emotion: 'calm', intensity: 0.3, confidence: 0.5 };
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     BUSINESS STRESS ASSESSMENT
     ═══════════════════════════════════════════════════════════════════════════ */

  /**
   * Cross-reference the user's business health indicators to infer
   * emotional stressors they may not explicitly state.
   */
  private async assessBusinessStress(userId: string): Promise<number> {
    try {
      // Query business health indicators from the database
      // This is a simplified heuristic — production would use proper aggregation
      const stressIndicators = await this.prisma.cortexMessage.findMany({
        where: {
          metadata: {
            path: ['stressIndicator'],
            equals: true,
          },
        },
        take: 50,
        orderBy: { timestamp: 'desc' },
      } as Record<string, unknown>);

      // Count recent stress indicator events
      const recentStressCount = stressIndicators.length;
      const stressScore = Math.min(recentStressCount / 10, 1.0);

      return stressScore;
    } catch {
      // If we can't assess, assume moderate stress
      return 0.3;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     EMOTION AGGREGATION
     ═══════════════════════════════════════════════════════════════════════════ */

  /**
   * Aggregate all signal sources into a single EmotionalState.
   * Weights: keyword (30%), AI (25%), linguistic (15%), behavioural (15%), business (10%), baseline deviation (5%)
   */
  private aggregateEmotions(
    keywordScores: Map<PrimaryEmotion, number>,
    aiResult: { emotion: PrimaryEmotion; intensity: number; confidence: number },
    linguistic: EmotionSignals['linguistic'],
    behavioral: EmotionSignals['behavioral'],
    businessStress: number,
    baseline: EmotionalState,
  ): EmotionalState {
    const finalScores = new Map<PrimaryEmotion, number>();
    const allEmotions = Object.keys(EMOTION_PERSONA_MAP) as PrimaryEmotion[];
    allEmotions.forEach((e) => finalScores.set(e, 0));

    // ── Keyword scores (30%) ─────────────────────────────────────────────
    const maxKeywordScore = Math.max(...keywordScores.values(), 1);
    keywordScores.forEach((score, emotion) => {
      const normalized = score / maxKeywordScore;
      finalScores.set(emotion, (finalScores.get(emotion) || 0) + normalized * 0.30);
    });

    // ── AI result (25%) ──────────────────────────────────────────────────
    finalScores.set(
      aiResult.emotion,
      (finalScores.get(aiResult.emotion) || 0) + aiResult.confidence * 0.25,
    );

    // ── Linguistic signals (15%) ─────────────────────────────────────────
    const linguisticEmotion = this.inferFromLinguistics(linguistic);
    finalScores.set(
      linguisticEmotion,
      (finalScores.get(linguisticEmotion) || 0) + 0.15,
    );

    // ── Behavioural signals (15%) ────────────────────────────────────────
    const behavioralEmotion = this.inferFromBehavior(behavioral);
    finalScores.set(
      behavioralEmotion,
      (finalScores.get(behavioralEmotion) || 0) + 0.15,
    );

    // ── Business stress (10%) ────────────────────────────────────────────
    if (businessStress > 0.5) {
      finalScores.set(
        'stressed',
        (finalScores.get('stressed') || 0) + businessStress * 0.10,
      );
      finalScores.set(
        'anxious',
        (finalScores.get('anxious') || 0) + businessStress * 0.05,
      );
    }

    // ── Baseline deviation (5%) ──────────────────────────────────────────
    finalScores.set(
      baseline.primary,
      (finalScores.get(baseline.primary) || 0) + 0.05,
    );

    // Determine winner
    let bestEmotion: PrimaryEmotion = 'calm';
    let bestScore = 0;
    finalScores.forEach((score, emotion) => {
      if (score > bestScore) {
        bestScore = score;
        bestEmotion = emotion;
      }
    });

    // Compute intensity
    const intensity = this.computeIntensity(linguistic, behavioral, businessStress);

    // Build triggers list
    const triggers = this.buildTriggers(linguistic, behavioral, businessStress, bestEmotion);

    // Compute trend
    const trend = this.computeEmotionTrend(bestEmotion, baseline);

    // Confidence based on agreement between sources
    const confidence = this.computeDetectionConfidence(
      keywordScores,
      aiResult,
      bestEmotion,
    );

    return {
      primary: bestEmotion,
      intensity,
      confidence,
      triggers,
      trend,
    };
  }

  /** Infer emotion from linguistic signal composition. */
  private inferFromLinguistics(
    linguistic: EmotionSignals['linguistic'],
  ): PrimaryEmotion {
    if (linguistic.frustrationWords > 2 || linguistic.capsRatio > 0.1) return 'frustrated';
    if (linguistic.urgencyWords > 2 || linguistic.punctuationDensity > 0.05) return 'urgent';
    if (linguistic.excitementWords > 1) return 'excited';
    if (linguistic.hesitationWords > 2) return 'anxious';
    if (linguistic.sentenceLength < 5) return 'stressed';
    if (linguistic.excitementWords > 0) return 'curious';
    return 'calm';
  }

  /** Infer emotion from behavioural signal composition. */
  private inferFromBehavior(
    behavioral: EmotionSignals['behavioral'],
  ): PrimaryEmotion {
    if (behavioral.correctionRate > 0.3) return 'frustrated';
    if (behavioral.repeatQueries > 2) return 'frustrated';
    if (behavioral.responseTime < 2000) return 'urgent';
    if (behavioral.approvalRate < 0.2) return 'stressed';
    if (behavioral.sessionLength > 600_000) return 'tired'; // 10+ min session
    return 'calm';
  }

  /** Compute overall emotion intensity from all signals. */
  private computeIntensity(
    linguistic: EmotionSignals['linguistic'],
    behavioral: EmotionSignals['behavioral'],
    businessStress: number,
  ): number {
    const linguisticIntensity = Math.min(
      (linguistic.urgencyWords + linguistic.frustrationWords + linguistic.capsRatio * 10) / 5,
      1.0,
    );
    const behavioralIntensity = Math.min(
      (behavioral.correctionRate + (behavioral.repeatQueries > 0 ? 0.3 : 0)) / 1.3,
      1.0,
    );
    const rawIntensity = (linguisticIntensity * 0.4 + behavioralIntensity * 0.3 + businessStress * 0.3);
    return Math.round(this.clamp(rawIntensity, 0, 1) * 1000) / 1000;
  }

  /** Build the triggers list from contributing signals. */
  private buildTriggers(
    linguistic: EmotionSignals['linguistic'],
    behavioral: EmotionSignals['behavioral'],
    businessStress: number,
    dominantEmotion: PrimaryEmotion,
  ): string[] {
    const triggers: string[] = [];

    if (linguistic.urgencyWords > 0) triggers.push(`${linguistic.urgencyWords} urgency words`);
    if (linguistic.frustrationWords > 0) triggers.push(`${linguistic.frustrationWords} frustration words`);
    if (linguistic.excitementWords > 0) triggers.push(`${linguistic.excitementWords} excitement words`);
    if (linguistic.hesitationWords > 0) triggers.push(`${linguistic.hesitationWords} hesitation words`);
    if (linguistic.capsRatio > 0.05) triggers.push('elevated caps usage');
    if (linguistic.punctuationDensity > 0.02) triggers.push('intense punctuation');
    if (behavioral.correctionRate > 0.2) triggers.push('high correction rate');
    if (behavioral.repeatQueries > 0) triggers.push(`${behavioral.repeatQueries} repeated queries`);
    if (businessStress > 0.5) triggers.push('business stress indicators');
    triggers.push(`dominant_emotion:${dominantEmotion}`);

    return triggers;
  }

  /** Compare detected emotion to baseline to determine trend direction. */
  private computeEmotionTrend(
    detected: PrimaryEmotion,
    baseline: EmotionalState,
  ): EmotionalTrend {
    const negativeEmotions: PrimaryEmotion[] = ['stressed', 'frustrated', 'anxious', 'tired', 'confused'];
    const positiveEmotions: PrimaryEmotion[] = ['calm', 'excited', 'curious', 'confident'];

    const detectedNegative = negativeEmotions.includes(detected);
    const detectedPositive = positiveEmotions.includes(detected);
    const baselineNegative = negativeEmotions.includes(baseline.primary);
    const baselinePositive = positiveEmotions.includes(baseline.primary);

    if (detectedNegative && baselinePositive) return 'declining';
    if (detectedPositive && baselineNegative) return 'improving';
    return 'stable';
  }

  /** Compute detection confidence based on source agreement. */
  private computeDetectionConfidence(
    keywordScores: Map<PrimaryEmotion, number>,
    aiResult: { emotion: PrimaryEmotion; confidence: number },
    bestEmotion: PrimaryEmotion,
  ): number {
    // Check if keyword and AI agree
    const keywordWinner = [...keywordScores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const agreementBoost = keywordWinner === aiResult.emotion ? 0.2 : 0;
    const baseConfidence = aiResult.confidence * 0.6 + 0.3;
    return Math.min(baseConfidence + agreementBoost, 1.0);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     TONE & PROACTIVE HELP COMPUTATION
     ═══════════════════════════════════════════════════════════════════════════ */

  /** Compute tone adjustment parameters for the detected emotion. */
  private computeToneAdjustment(emotion: EmotionalState): ToneAdjustment {
    const toneMap: Record<PrimaryEmotion, ToneAdjustment> = {
      calm:       { speed: 'normal',  detail: 'normal',  empathy: 0.3, urgency: 0.1 },
      stressed:   { speed: 'slower',  detail: 'brief',   empathy: 0.9, urgency: 0.3 },
      excited:    { speed: 'normal',  detail: 'normal',  empathy: 0.5, urgency: 0.2 },
      frustrated: { speed: 'faster',  detail: 'brief',   empathy: 0.6, urgency: 0.7 },
      anxious:    { speed: 'slower',  detail: 'thorough', empathy: 0.9, urgency: 0.1 },
      curious:    { speed: 'normal',  detail: 'thorough', empathy: 0.3, urgency: 0.1 },
      urgent:     { speed: 'faster',  detail: 'brief',   empathy: 0.2, urgency: 0.9 },
      tired:      { speed: 'slower',  detail: 'brief',   empathy: 0.7, urgency: 0.1 },
      confident:  { speed: 'normal',  detail: 'normal',  empathy: 0.2, urgency: 0.2 },
      confused:   { speed: 'slower',  detail: 'thorough', empathy: 0.7, urgency: 0.1 },
    };

    const base = toneMap[emotion.primary];

    // Scale empathy and urgency by intensity
    return {
      speed: base.speed,
      detail: base.detail,
      empathy: this.clamp(base.empathy * (0.5 + emotion.intensity * 0.5), 0, 1),
      urgency: this.clamp(base.urgency * (0.5 + emotion.intensity * 0.5), 0, 1),
    };
  }

  /** Determine whether KEY should proactively offer help. */
  private computeProactiveHelp(emotion: EmotionalState): boolean {
    const proactiveTriggers: PrimaryEmotion[] = ['stressed', 'frustrated', 'anxious', 'tired', 'confused'];
    return (
      proactiveTriggers.includes(emotion.primary) && emotion.intensity > 0.4
    );
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     CACHING & HISTORY
     ═══════════════════════════════════════════════════════════════════════════ */

  /** Store an emotional state in the in-memory cache. */
  private cacheEmotionalState(userId: string, state: EmotionalState): void {
    const existing = this.emotionalCache.get(userId) || [];
    existing.push(state);
    // Keep last 20 states per user
    if (existing.length > 20) existing.shift();
    this.emotionalCache.set(userId, existing);
    this.cacheTimestamps.set(userId, Date.now());
  }

  /** Get cached emotional states for a user (with TTL check). */
  private getCachedStates(userId: string): EmotionalState[] {
    const timestamp = this.cacheTimestamps.get(userId);
    if (timestamp && Date.now() - timestamp > this.CACHE_TTL_MS) {
      this.emotionalCache.delete(userId);
      this.cacheTimestamps.delete(userId);
      return [];
    }
    return this.emotionalCache.get(userId) || [];
  }

  /** Fetch historical emotional states from persistent storage. */
  private async fetchHistoricalStates(
    userId: string,
    period: 'day' | 'week' | 'month',
  ): Promise<EmotionalState[]> {
    // First check the in-memory cache for recent states
    const cached = this.getCachedStates(userId);
    if (cached.length > 0) return cached;

    // In production, this queries the database for stored emotional states
    // For now, return an empty array which triggers the default profile
    try {
      const messages = await this.prisma.cortexMessage.findMany({
        where: { userId },
        take: 100,
        orderBy: { timestamp: 'desc' },
      } as Record<string, unknown>) as Array<{ metadata?: { emotion?: EmotionalState } }>;

      const states: EmotionalState[] = [];
      for (const msg of messages) {
        const meta = msg.metadata as { emotion?: EmotionalState } | undefined;
        if (meta?.emotion) states.push(meta.emotion);
      }
      return states;
    } catch {
      return [];
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     STATISTICAL UTILITIES
     ═══════════════════════════════════════════════════════════════════════════ */

  private buildDefaultProfile(
    userId: string,
    period: 'day' | 'week' | 'month',
  ): EmotionalProfile {
    return {
      userId,
      period,
      baseline: 'calm',
      averageIntensity: 0.3,
      intensityVariance: 0.1,
      trendDirection: 'stable',
      stateHistory: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  private computeModeEmotion(states: EmotionalState[]): PrimaryEmotion {
    const counts = new Map<PrimaryEmotion, number>();
    for (const state of states) {
      counts.set(state.primary, (counts.get(state.primary) || 0) + 1);
    }
    let mode: PrimaryEmotion = 'calm';
    let maxCount = 0;
    counts.forEach((count, emotion) => {
      if (count > maxCount) {
        maxCount = count;
        mode = emotion;
      }
    });
    return mode;
  }

  private computeTrendDirection(states: EmotionalState[]): EmotionalTrend {
    if (states.length < 3) return 'stable';
    const negativeEmotions: PrimaryEmotion[] = ['stressed', 'frustrated', 'anxious', 'tired', 'confused'];
    const recent = states.slice(-5);
    const recentNegative = recent.filter((s) => negativeEmotions.includes(s.primary)).length;
    const older = states.slice(0, Math.max(states.length - 5, 5));
    const olderNegative = older.filter((s) => negativeEmotions.includes(s.primary)).length;

    if (recentNegative > olderNegative) return 'declining';
    if (recentNegative < olderNegative) return 'improving';
    return 'stable';
  }

  private countRepeatQueries(messages: CortexMessage[]): number {
    const userMessages = messages.filter((m) => m.role === 'user');
    if (userMessages.length < 2) return 0;

    const seen = new Set<string>();
    let repeats = 0;
    for (const msg of userMessages) {
      const normalised = msg.content.toLowerCase().trim().slice(0, 80);
      if (seen.has(normalised)) {
        repeats++;
      } else {
        seen.add(normalised);
      }
    }
    return repeats;
  }

  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private variance(values: number[]): number {
    if (values.length < 2) return 0;
    const m = this.mean(values);
    const squaredDiffs = values.map((v) => (v - m) ** 2);
    return this.mean(squaredDiffs);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }
}
