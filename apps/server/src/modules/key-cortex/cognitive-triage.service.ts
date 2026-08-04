import { Injectable, Logger, Optional } from '@nestjs/common';
import type { TaskCategory } from '../ai/model-gateway.service';
import { AdaptiveRouterService, type QueryDimensions } from './adaptive-router.service';
import { KeyCortexEndocrineService } from './key-cortex-endocrine.service';
import { KeyCortexImmuneService } from './key-cortex-immune.service';
import { KeyCortexInteroceptionService } from './key-cortex-interoception.service';

/**
 * The thalamus: how much cognition does this message deserve?
 *
 * Every message on the shipped chat path is currently treated identically —
 * `taskCategory: 'tool-calling'` from the FEATURE_TASK_MAP constant, temperature
 * 0.7, maxTokens 1000 — whether it says "thanks" or asks whether to sign a term
 * sheet. This service grades each message before the model is called, and it
 * does so with ZERO model calls and no I/O, which is what makes per-message
 * triage affordable at all.
 *
 * It composes three things that already existed and were not reachable from the
 * live chat:
 *   - AdaptiveRouterService.classifyDimensions — six pure regex classifiers
 *   - KeyCortexEndocrineService.effortMultiplier — written for exactly this,
 *     with no production caller until now
 *   - KeyCortexInteroceptionService.peekBody — cached body state, non-blocking
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not escalate to `processConsciously`. That pipeline injects the eight
 * cognition layers and nothing else — it has no executor, no tool registry, no
 * dispatcher. It can think but it has no hands. Routing an action-bearing
 * message there would produce good reasoning and silently perform no action,
 * so escalation needs an efferent path built first and is not part of this.
 *
 * It also ignores RouteDecision.layers. On the cortex path that field is
 * interpolated into a prompt as English ("Active reasoning layers: ...") while
 * the pipeline injects none of the layer services. Copying it here would move
 * theatre onto the live path rather than cognition.
 */

export type EffortTier = 'reflex' | 'standard' | 'deliberate';

export interface TriageVerdict {
  tier: EffortTier;
  /** Raw score before tiering — logged so the thresholds can be calibrated. */
  score: number;
  taskCategory: TaskCategory;
  temperature: number;
  maxTokens: number;
  /** Endocrine + interoception framing for the system prompt, or null. */
  standingContext: string | null;
  /** Endocrine effort multiplier actually applied. */
  arousal: number;
  /** Short human-readable justification, for the SSE chunk and logs. */
  reason: string;
  dimensions: QueryDimensions;
}

/**
 * Today's hardcoded values on the flow path (flow-orchestrator.service.ts).
 * Standard tier reproduces them exactly, so an unclassified message behaves
 * precisely as it does now.
 */
const STANDARD_TEMPERATURE = 0.7;
const STANDARD_MAX_TOKENS = 1000;

const TIER_PARAMS: Record<EffortTier, { temperature: number; maxTokens: number }> = {
  // A greeting does not need 1000 tokens or room to improvise.
  reflex: { temperature: 0.3, maxTokens: 400 },
  standard: { temperature: STANDARD_TEMPERATURE, maxTokens: STANDARD_MAX_TOKENS },
  // Deliberate buys length, not a second call. Still one completion.
  deliberate: { temperature: 0.5, maxTokens: 2400 },
};

@Injectable()
export class CognitiveTriageService {
  private readonly logger = new Logger(CognitiveTriageService.name);

  constructor(
    @Optional() private readonly router?: AdaptiveRouterService,
    @Optional() private readonly endocrine?: KeyCortexEndocrineService,
    @Optional() private readonly interoception?: KeyCortexInteroceptionService,
    // APPENDED, never inserted. The specs construct this service positionally
    // (`new CognitiveTriageService(router, endocrine, intero)`), so adding a
    // parameter in the middle silently feeds each stub into the wrong slot —
    // which is exactly what happened when this went in above interoception, and
    // the only symptom was peekBody never being called.
    @Optional() private readonly immune?: KeyCortexImmuneService,
  ) {}

  /**
   * Grade a message. Never throws — a triage failure must fall back to today's
   * behaviour, not break the chat.
   */
  triage(businessId: string, text: string, hasAttachments = false): TriageVerdict {
    try {
      return this.grade(businessId, text, hasAttachments);
    } catch (err: unknown) {
      this.logger.warn(
        `[triage] fell back to standard: ${err instanceof Error ? err.message : String(err)}`,
      );
      return this.fallback();
    }
  }

  private grade(businessId: string, text: string, hasAttachments: boolean): TriageVerdict {
    if (!this.router) return this.fallback();

    const dimensions = this.router.classifyDimensions(text.toLowerCase());

    // Scoring uses complexity, dataRequirement and timeHorizon as the load-
    // bearing signals. urgency and emotionalWeight contribute only as bonuses,
    // because measurement showed they almost never fire on real business
    // phrasing: classifyEmotionalWeight matches first-person feeling words
    // (frustrated, anxious, upset), and users describe situations instead —
    // "our biggest client just threatened to leave" scores emotion `low`. That
    // classifier is detecting the user's stated MOOD, which is a real thing and
    // useful for tone, but it is not a measure of what is at stake. Scoring
    // heavily on it would make the tier depend on how the user happens to
    // phrase their feelings rather than on the difficulty of the question.
    let score = 0;
    if (dimensions.complexity === 'complex') score += 3;
    else if (dimensions.complexity === 'moderate') score += 1;

    if (dimensions.dataRequirement === 'predictive') score += 2;
    else if (dimensions.dataRequirement === 'analytical') score += 1;

    if (dimensions.timeHorizon === 'strategic') score += 2;

    if (dimensions.urgency === 'critical') score += 1;
    if (dimensions.emotionalWeight === 'high') score += 1;

    // An attachment is unclassifiable by regex and is rarely sent for a
    // trivial reason, so it floors the message out of reflex.
    if (hasAttachments) score += 1;

    const arousal = this.arousalFor(businessId);
    score = score * arousal;

    const tier = this.tierFor(score, dimensions, hasAttachments, text);

    return {
      tier,
      score: Math.round(score * 100) / 100,
      taskCategory: this.categoryFor(),
      ...TIER_PARAMS[tier],
      standingContext: this.standingContext(businessId),
      arousal: Math.round(arousal * 100) / 100,
      reason: this.reasonFor(tier, dimensions, arousal),
      dimensions,
    };
  }

  /**
   * Is the WHOLE message a greeting or acknowledgement?
   *
   * Anchored deliberately. The router's simpleMarkers regex matches anywhere,
   * which meant "ok delete that contact" graded simple — so the cheap tier was
   * reachable by any destructive request that happened to start with "ok".
   *
   * A trailing "please"/"thanks" is tolerated because "ok thanks" is still a
   * bare acknowledgement, but anything carrying a verb or an object is not.
   */
  private isBareAcknowledgement(text: string): boolean {
    const cleaned = text
      .toLowerCase()
      .replace(/[!.,?—–-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleaned.length === 0 || cleaned.length > 24) return false;

    return /^(hi|hello|hey|yo|thanks|thank you|ty|ok|okay|k|yes|yep|no|nope|bye|goodbye|cheers|got it|perfect|great|nice)( (thanks|thank you|please))?$/.test(
      cleaned,
    );
  }

  /**
   * Standing arousal from the endocrine system — a body under sustained stress
   * recruits more cognition. Bounded 1.0–1.5 by effortMultiplier, and it
   * deliberately excludes dopamine, so optimism never buys less thinking.
   *
   * Note this state is an in-process Map with no persistence, so it resets on
   * restart and differs per instance. That makes triage non-deterministic
   * across instances — acceptable here because the failure direction is toward
   * the strict threshold (cheaper), never toward runaway spend.
   */
  private arousalFor(businessId: string): number {
    if (!this.endocrine) return 1;
    try {
      return this.endocrine.effortMultiplier(businessId);
    } catch {
      return 1;
    }
  }

  private tierFor(
    score: number,
    dimensions: QueryDimensions,
    hasAttachments: boolean,
    text: string,
  ): EffortTier {
    // Reflex is a WHITELIST, not a low score. A misclassified real question
    // answered in 400 tokens reads as broken in a way a slow answer never
    // does, so a message only reflexes when every cheap signal agrees it is
    // trivial — a low score alone is not sufficient.
    //
    // `complexity === 'simple'` is NOT sufficient on its own, and believing it
    // was is how this shipped wrong. classifyComplexity's simpleMarkers regex
    // matches ANYWHERE in the message, so every one of these graded simple and
    // reflexed at 400 tokens:
    //
    //   "ok delete that contact"      "ok cancel the booking"
    //   "hi can you refund them"      "no, remove that task"
    //
    // Destructive requests, answered on the cheapest tier, because they happen
    // to contain the word "ok". isBareAcknowledgement requires the WHOLE
    // message to be a greeting or acknowledgement, which is what the whitelist
    // claim always meant.
    const isReflex =
      !hasAttachments &&
      this.isBareAcknowledgement(text) &&
      dimensions.complexity === 'simple' &&
      dimensions.dataRequirement === 'none' &&
      dimensions.emotionalWeight === 'low' &&
      dimensions.urgency !== 'critical' &&
      dimensions.urgency !== 'high';

    if (isReflex) return 'reflex';
    // 3 is exactly the weight of `complexity: 'complex'`, so a message the
    // router grades complex deliberates on that alone. Set at 4 it took
    // complexity PLUS a second signal, which left "should we take the series a
    // term sheet" — the archetypal case — on the standard tier.
    //
    // Being generous here is cheap: the tier buys maxTokens, and maxTokens is
    // a CAP rather than a charge. A deliberate message that turns out to be
    // answerable in 200 tokens costs exactly what it would have anyway.
    if (score >= 3) return 'deliberate';
    return 'standard';
  }

  /**
   * Every tier keeps 'tool-calling'. This is deliberate, and it is the opposite
   * of what an earlier draft did.
   *
   * ai-usage.service.ts:200 is `if (explicit) return explicit`, so triage COULD
   * override the model tier per message. Reading the routing table shows it
   * should not:
   *
   *   tool-calling     -> openai/gpt-4o          (today)
   *   general          -> openai/gpt-4o          identical model, identical price
   *   analysis         -> openai/gpt-4o-mini     a DOWNGRADE
   *   emotion-analysis -> anthropic/claude-3.5   and streamAnthropic never
   *                                              forwards request.tools
   *
   * So routing a greeting to 'general' saves nothing, routing analytical and
   * finance questions to 'analysis' would quietly downgrade the most valuable
   * traffic to a mini model, and anything reaching 'emotion-analysis' would
   * lose tool calling entirely — the model would answer warmly and perform no
   * action. The category stays fixed until the routing table itself is the
   * thing being changed.
   */
  private categoryFor(): TaskCategory {
    return 'tool-calling';
  }

  /**
   * Endocrine disposition plus body integrity, as prompt text.
   *
   * Both accessors are synchronous and pure; peekBody is cache-only, so this
   * adds no latency. Returns null when there is nothing to say — telling the
   * model "all systems normal" on every message spends tokens to say nothing
   * and trains it to skim the section.
   */
  private standingContext(businessId: string): string | null {
    const parts: string[] = [];

    // READ ONLY. Triage does not release hormones.
    //
    // It used to call releaseFromBody here, and that was wrong twice over:
    //
    //  1. The push accumulated per CHAT MESSAGE rather than per observation.
    //     peekBody serves one cached reading for 15 seconds, so a busy minute
    //     dosed malaise from the same reading dozens of times, saturating it on
    //     traffic volume instead of on how long the organs had been degraded.
    //     A hormone that responds to chattiness is not measuring the body.
    //
    //  2. It put an endocrine WRITE on the request path, which meant a database
    //     persist per message.
    //
    // Body-driven malaise now belongs to KeyCortexHomeostasisService, which
    // samples on a fixed 30-minute cadence — so one push means one half hour of
    // degradation, which is what the level is supposed to represent.
    let body = null;
    try {
      body = this.interoception?.peekBody(businessId) ?? null;
    } catch {
      /* body state is framing, never required */
    }

    try {
      const hormones = this.endocrine?.describeForPrompt(businessId);
      if (hormones) parts.push(hormones);
    } catch {
      /* disposition is framing, never required */
    }

    try {
      const described = body ? this.interoception?.describeForPrompt(body) : null;
      if (described) parts.push(described);
    } catch {
      /* body state is framing, never required */
    }

    try {
      // Immune memory. Sync by design — see the note on KeyCortexImmuneService's
      // `incidents` map. Before this, a detected anomaly reached exactly one
      // listener: an SSE broadcast that returns early when no dashboard is open,
      // so at 3am the detection was simply discarded.
      const threats = this.immune?.describeForPrompt(businessId) ?? null;
      if (threats) parts.push(threats);
    } catch {
      /* immune state is framing, never required */
    }

    return parts.length > 0 ? parts.join('\n\n') : null;
  }


  private reasonFor(tier: EffortTier, d: QueryDimensions, arousal: number): string {
    const base = `${d.complexity}/${d.dataRequirement}/${d.timeHorizon} in ${d.domain}`;
    const stress = arousal > 1.05 ? `, arousal ${arousal.toFixed(2)}` : '';
    return `${tier}: ${base}${stress}`;
  }

  /** Today's behaviour, exactly. */
  private fallback(): TriageVerdict {
    return {
      tier: 'standard',
      score: 0,
      taskCategory: 'tool-calling',
      temperature: STANDARD_TEMPERATURE,
      maxTokens: STANDARD_MAX_TOKENS,
      standingContext: null,
      arousal: 1,
      reason: 'standard: triage unavailable',
      dimensions: {
        complexity: 'moderate',
        domain: 'general',
        urgency: 'low',
        emotionalWeight: 'low',
        timeHorizon: 'tactical',
        dataRequirement: 'none',
      },
    };
  }
}
