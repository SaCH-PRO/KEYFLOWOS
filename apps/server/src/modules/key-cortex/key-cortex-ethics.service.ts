/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * KEY CORTEX — ETHICAL REASONING FRAMEWORK (Layer 7)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * KEY doesn't just optimise for outcomes — it optimises for the *right*
 * outcomes. This framework evaluates every action and recommendation
 * against seven immutable core values, assesses stakeholder impact,
 * and produces human-readable ethical explanations.
 *
 * Core values (hardcoded, never learned):
 *   user_autonomy — User always has the final say
 *   data_privacy  — Never expose private data without consent
 *   transparency  — Always explain decisions and reasoning
 *   fairness      — Treat all customers and users equally
 *   honesty       — Never fabricate data or misrepresent facts
 *   safety        — Do not recommend harmful or reckless actions
 *   growth        — Optimise for the user's long-term success
 *
 * Responsibilities:
 *   • evaluateAction()        — full ethical review of a proposed action
 *   • evaluateRecommendation() — ethical review of a recommendation
 *   • explainDecision()        — reconstruct reasoning for a past decision
 *   • getValues()              — return KEY's core values
 *   • checkDataPrivacy()       — data-privacy compliance verification
 *
 * @module key-cortex-ethics.service
 * @layer  7
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  EthicalEvaluation,
  EthicalPrinciple,
  StakeholderAssessment,
  StakeholderImpact,
  KeyCoreValue,
  KEY_VALUES,
  DataPrivacyCheck,
} from './key-cortex-consciousness.types';

/** Injected dependencies — resolved at module bootstrap. */
interface EthicsServiceDeps {
  prisma: {
    cortexEvent: {
      findUnique: (args: unknown) => Promise<{
        id: string;
        action: string;
        params: Record<string, unknown>;
        ethicalEvaluation?: string;
        businessId: string;
        createdAt: Date;
        metadata?: Record<string, unknown>;
      } | null>;
      findMany: (args: unknown) => Promise<
        Array<{
          id: string;
          action: string;
          params: Record<string, unknown>;
          ethicalEvaluation?: string;
          businessId: string;
          createdAt: Date;
          metadata?: Record<string, unknown>;
        }>
      >;
    };
    dataConsent: {
      findMany: (args: unknown) => Promise<
        Array<{
          id: string;
          businessId: string;
          dataType: string;
          purpose: string;
          granted: boolean;
          grantedAt: Date;
          expiresAt?: Date;
        }>
      >;
    };
  };
  eventService: {
    log: (params: {
      businessId: string;
      action: string;
      params: Record<string, unknown>;
      result: string;
      confidence: number;
    }) => Promise<{ id: string }>;
  };
}

/** Sensitivity levels for different data types. */
const DATA_SENSITIVITY: Record<string, 'low' | 'medium' | 'high' | 'critical'> = {
  email: 'medium',
  phone: 'high',
  address: 'high',
  financial: 'critical',
  health: 'critical',
  biometric: 'critical',
  location: 'high',
  behavioural: 'medium',
  purchase_history: 'medium',
  personal_id: 'critical',
  password: 'critical',
  ssn: 'critical',
  name: 'low',
  ip_address: 'medium',
  cookies: 'low',
  preferences: 'low',
};

/** Actions that inherently carry elevated ethical risk. */
const HIGH_RISK_ACTIONS = [
  'delete', 'permanently_delete', 'purge', 'export',
  'bulk_update', 'price_change', ' automated_charge',
  'data_export', 'third_party_share', 'public_post',
  'automated_email', 'refund', 'cancellation',
];

/** Deceptive practice keywords for recommendation scanning. */
const DECEPTIVE_PRACTICE_KEYWORDS = [
  'hide', 'conceal', 'mislead', 'deceive', 'bait', 'switch',
  'fine print', 'hidden fee', 'surprise charge', 'auto-renew',
  'dark pattern', 'false urgency', 'scarcity lie',
];

/** Price gouging indicators for recommendation scanning. */
const PRICE_GOUGING_KEYWORDS = [
  '10x price', 'price increase', 'surge pricing', 'exploitative',
  'monopoly pricing', 'price fix', 'cartel', 'predatory pricing',
];

@Injectable()
export class KeyCortexEthicsService {
  private readonly logger = new Logger(KeyCortexEthicsService.name);

  // Cache for recent ethical evaluations (action hash → evaluation)
  private readonly evaluationCache = new Map<string, { result: EthicalEvaluation; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 300_000; // 5 minutes

  constructor(
    private readonly prisma: EthicsServiceDeps['prisma'],
    private readonly eventService: EthicsServiceDeps['eventService'],
  ) {}

  /* ═══════════════════════════════════════════════════════════════════════════
     PUBLIC API
     ═══════════════════════════════════════════════════════════════════════════ */

  /**
   * Evaluate a proposed action against KEY's ethical framework.
   *
   * Scoring pipeline:
   *   1. Score against all 7 KEY values
   *   2. Assess stakeholder impact (user, customers, team, public)
   *   3. Check for high-risk action patterns
   *   4. Compute aggregate permit/deny decision
   *   5. Generate alternatives if denied
   *   6. Produce human-readable explanation
   */
  async evaluateAction(
    action: string,
    params: Record<string, unknown>,
    businessId: string,
  ): Promise<EthicalEvaluation> {
    const startTime = Date.now();
    const cacheKey = this.hashAction(action, params, businessId);

    // Check cache
    const cached = this.evaluationCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.logger.debug(`Ethics cache hit for action: ${action}`);
      return cached.result;
    }

    // ── 1. Score against 7 KEY values ────────────────────────────────────
    const principles = await this.scorePrinciples(action, params, businessId);

    // ── 2. Assess stakeholder impact ─────────────────────────────────────
    const stakeholders = this.assessStakeholders(action, params);

    // ── 3. Check high-risk patterns ──────────────────────────────────────
    const riskFlags = this.checkRiskPatterns(action, params);

    // ── 4. Aggregate permit/deny decision ────────────────────────────────
    const permitted = this.computePermitted(principles, stakeholders, riskFlags);

    // ── 5. Generate alternatives if denied ───────────────────────────────
    const alternativeActions = permitted
      ? undefined
      : this.generateAlternatives(action, params, principles);

    // ── 6. Build human-readable explanation ──────────────────────────────
    const explanation = this.buildExplanation(
      action, principles, stakeholders, permitted, riskFlags,
    );

    const evaluation: EthicalEvaluation = {
      action,
      permitted,
      confidence: this.computeEvaluationConfidence(principles),
      principles,
      stakeholders,
      explanation,
      alternativeActions,
    };

    // Cache and log
    this.evaluationCache.set(cacheKey, {
      result: evaluation,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
    });

    await this.eventService.log({
      businessId,
      action: 'ethical_evaluation',
      params: { evaluatedAction: action, permitted },
      result: explanation,
      confidence: evaluation.confidence,
    });

    this.logger.debug(
      `Ethical evaluation of "${action}" for ${businessId}: ${permitted ? 'PERMITTED' : 'DENIED'} in ${Date.now() - startTime}ms`,
    );

    return evaluation;
  }

  /**
   * Evaluate a recommendation (not just an action) for ethical concerns.
   * Additional checks for: price gouging, deceptive practices,
   * data misuse, unfair treatment, and historical rejection context.
   */
  async evaluateRecommendation(
    recommendation: string,
    context: Record<string, unknown>,
    businessId: string,
  ): Promise<EthicalEvaluation> {
    // ── Base evaluation ──────────────────────────────────────────────────
    const evaluation = await this.evaluateAction(
      recommendation,
      context,
      businessId,
    );

    // ── Additional recommendation-specific checks ────────────────────────
    const recLower = recommendation.toLowerCase();

    // Check for deceptive practices
    const deceptiveFlags = DECEPTIVE_PRACTICE_KEYWORDS.filter((kw) =>
      recLower.includes(kw),
    );
    if (deceptiveFlags.length > 0) {
      evaluation.permitted = false;
      evaluation.principles = evaluation.principles.map((p) =>
        p.principle === 'transparency' || p.principle === 'honesty'
          ? { ...p, score: -1.0, explanation: `${p.explanation} [DECEPTIVE PRACTICE DETECTED: ${deceptiveFlags.join(', ')}]` }
          : p,
      );
      evaluation.explanation += `\n\n⚠️ DECEPTIVE PRACTICE ALERT: This recommendation contains language associated with deceptive practices (${deceptiveFlags.join(', ')}). This is a violation of KEY's transparency and honesty principles.`;
    }

    // Check for price gouging
    const priceGougingFlags = PRICE_GOUGING_KEYWORDS.filter((kw) =>
      recLower.includes(kw),
    );
    if (priceGougingFlags.length > 0) {
      evaluation.permitted = false;
      evaluation.principles = evaluation.principles.map((p) =>
        p.principle === 'fairness'
          ? { ...p, score: -0.9, explanation: `${p.explanation} [PRICE GOUGING INDICATOR: ${priceGougingFlags.join(', ')}]` }
          : p,
      );
      evaluation.explanation += `\n\n⚠️ FAIRNESS ALERT: This recommendation may constitute unfair pricing (${priceGougingFlags.join(', ')}).`;
    }

    // Check for data misuse
    const dataTypes = this.extractDataTypes(context);
    const privacyCheck = await this.checkDataPrivacy(businessId, recommendation, context);
    if (!privacyCheck.compliant) {
      evaluation.permitted = false;
      evaluation.principles = evaluation.principles.map((p) =>
        p.principle === 'data_privacy'
          ? { ...p, score: -1.0, explanation: `${p.explanation} [DATA PRIVACY VIOLATION: ${privacyCheck.issues.join('; ')}]` }
          : p,
      );
      evaluation.explanation += `\n\n⚠️ DATA PRIVACY ALERT: This recommendation would use data without proper consent: ${privacyCheck.issues.join(', ')}`;
    }

    // Historical context: check if user previously rejected similar recommendations
    const similarRejection = await this.checkHistoricalRejections(
      businessId,
      recommendation,
    );
    if (similarRejection.wasRejected) {
      evaluation.explanation += `\n\n📌 HISTORICAL CONTEXT: You previously rejected similar recommendations (${similarRejection.count} times). I'm flagging this so you can decide if circumstances have changed.`;
      // Don't block — just warn (user autonomy principle)
    }

    // Update confidence after additional checks
    evaluation.confidence = this.computeEvaluationConfidence(evaluation.principles);

    // Regenerate explanation if status changed
    if (!evaluation.permitted && !evaluation.alternativeActions) {
      evaluation.alternativeActions = this.generateAlternatives(
        recommendation,
        context,
        evaluation.principles,
      );
    }

    return evaluation;
  }

  /**
   * Look up a past decision in the event log and reconstruct
   * a human-readable ethical explanation.
   */
  async explainDecision(decisionId: string, businessId: string): Promise<string> {
    const event = await this.prisma.cortexEvent.findUnique({
      where: { id: decisionId },
    } as Record<string, unknown>);

    if (!event) {
      return `Decision ${decisionId} not found in the event log for business ${businessId}.`;
    }

    if (event.businessId !== businessId) {
      return `Decision ${decisionId} does not belong to business ${businessId}. Access denied.`;
    }

    // If an ethical evaluation was stored, use it
    if (event.ethicalEvaluation) {
      try {
        const parsed = JSON.parse(event.ethicalEvaluation) as EthicalEvaluation;
        return this.formatStoredExplanation(parsed, event);
      } catch {
        // Fall through to reconstruction
      }
    }

    // Reconstruct from event data
    return this.reconstructExplanation(event);
  }

  /** Return KEY's seven immutable core values. */
  getValues(): string[] {
    return [...KEY_VALUES];
  }

  /**
   * Verify whether a proposed action complies with data-privacy policies.
   * Checks consent existence, data sensitivity, and exposure risk.
   */
  async checkDataPrivacy(
    businessId: string,
    action: string,
    data: Record<string, unknown>,
  ): Promise<DataPrivacyCheck> {
    const issues: string[] = [];
    const actionLower = action.toLowerCase();

    // ── Extract data types from the action/data ──────────────────────────
    const dataTypes = this.extractDataTypes(data);

    // ── Check if action involves data exposure ───────────────────────────
    const exposureActions = ['export', 'share', 'send', 'transmit', 'publish',
      'disclose', 'forward', 'upload', 'sync', 'integrate'];
    const involvesExposure = exposureActions.some((a) => actionLower.includes(a));

    if (involvesExposure && dataTypes.length > 0) {
      // Check consent for each data type
      for (const dataType of dataTypes) {
        const consents = await this.prisma.client.dataConsent.findMany({
          where: {
            businessId,
            dataType,
            granted: true,
          },
        } as Record<string, unknown>);

        const validConsent = consents.some(
          (c) => !c.expiresAt || c.expiresAt > new Date(),
        );

        if (!validConsent) {
          const sensitivity = DATA_SENSITIVITY[dataType] || 'medium';
          if (sensitivity === 'critical' || sensitivity === 'high') {
            issues.push(`No valid consent for ${sensitivity}-sensitivity data type "${dataType}"`);
          }
        }
      }
    }

    // ── Check for sensitive data in non-exposure contexts ────────────────
    const criticalTypes = dataTypes.filter(
      (dt) => DATA_SENSITIVITY[dt] === 'critical',
    );
    if (criticalTypes.length > 0 && !involvesExposure) {
      // Even non-exposure actions with critical data get flagged for review
      issues.push(`Action involves critical-sensitivity data types: ${criticalTypes.join(', ')} — requires explicit approval`);
    }

    // ── Check for third-party sharing ────────────────────────────────────
    const thirdPartyKeywords = ['third party', 'vendor', 'partner', 'integration',
      'api', 'webhook', 'external', 'outside'];
    const involvesThirdParty = thirdPartyKeywords.some((kw) =>
      actionLower.includes(kw),
    );
    if (involvesThirdParty && dataTypes.length > 0) {
      const unconsentedTypes = [];
      for (const dt of dataTypes) {
        const consents = await this.prisma.client.dataConsent.findMany({
          where: {
            businessId,
            dataType: dt,
            purpose: { contains: 'third_party' },
            granted: true,
          },
        } as Record<string, unknown>);
        if (consents.length === 0) unconsentedTypes.push(dt);
      }
      if (unconsentedTypes.length > 0) {
        issues.push(`Third-party sharing lacks consent for: ${unconsentedTypes.join(', ')}`);
      }
    }

    return {
      compliant: issues.length === 0,
      issues,
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     PRINCIPLE SCORING
     ═══════════════════════════════════════════════════════════════════════════ */

  /**
   * Score a proposed action against all 7 KEY values.
   * Each principle receives a score from -1.0 (violates) to +1.0 (upholds).
   */
  private async scorePrinciples(
    action: string,
    params: Record<string, unknown>,
    _businessId: string,
  ): Promise<EthicalPrinciple[]> {
    const actionLower = action.toLowerCase();
    const principles: EthicalPrinciple[] = [];

    // ── user_autonomy ────────────────────────────────────────────────────
    const autonomyScore = this.scoreAutonomy(actionLower, params);
    principles.push({
      principle: 'user_autonomy',
      score: autonomyScore,
      explanation: autonomyScore > 0
        ? 'User retains full control over the final decision.'
        : autonomyScore < 0
          ? 'This action could reduce user agency or make decisions on their behalf without clear opt-out.'
          : 'Neutral impact on user autonomy.',
    });

    // ── data_privacy ─────────────────────────────────────────────────────
    const privacyScore = this.scoreDataPrivacy(actionLower, params);
    principles.push({
      principle: 'data_privacy',
      score: privacyScore,
      explanation: privacyScore > 0
        ? 'No private data is exposed or shared inappropriately.'
        : privacyScore < 0
          ? 'This action may expose or share private data without adequate safeguards.'
          : 'Minimal data handling involved.',
    });

    // ── transparency ─────────────────────────────────────────────────────
    const transparencyScore = this.scoreTransparency(actionLower, params);
    principles.push({
      principle: 'transparency',
      score: transparencyScore,
      explanation: transparencyScore > 0
        ? 'The reasoning and methodology are clear and explainable.'
        : transparencyScore < 0
          ? 'This action may obscure reasoning or hide important details from the user.'
          : 'Transparency impact is neutral.',
    });

    // ── fairness ─────────────────────────────────────────────────────────
    const fairnessScore = this.scoreFairness(actionLower, params);
    principles.push({
      principle: 'fairness',
      score: fairnessScore,
      explanation: fairnessScore > 0
        ? 'All affected parties are treated equitably.'
        : fairnessScore < 0
          ? 'This action may disproportionately benefit or harm specific groups.'
          : 'Fairness impact is neutral.',
    });

    // ── honesty ──────────────────────────────────────────────────────────
    const honestyScore = this.scoreHonesty(actionLower, params);
    principles.push({
      principle: 'honesty',
      score: honestyScore,
      explanation: honestyScore > 0
        ? 'All claims are supported by verifiable data.'
        : honestyScore < 0
          ? 'This action may involve unsupported claims or data fabrication.'
          : 'Honesty impact is neutral.',
    });

    // ── safety ───────────────────────────────────────────────────────────
    const safetyScore = this.scoreSafety(actionLower, params);
    principles.push({
      principle: 'safety',
      score: safetyScore,
      explanation: safetyScore > 0
        ? 'The action poses no risk of harm.'
        : safetyScore < 0
          ? 'This action could cause financial, reputational, or operational harm.'
          : 'Safety impact is neutral.',
    });

    // ── growth ───────────────────────────────────────────────────────────
    const growthScore = this.scoreGrowth(actionLower, params);
    principles.push({
      principle: 'growth',
      score: growthScore,
      explanation: growthScore > 0
        ? 'This action supports the user\'s long-term success and development.'
        : growthScore < 0
          ? 'This action may prioritise short-term gains over sustainable growth.'
          : 'Growth impact is neutral.',
    });

    return principles;
  }

  private scoreAutonomy(action: string, _params: Record<string, unknown>): number {
    if (action.includes('auto') || action.includes('automatic')) return -0.3;
    if (action.includes('approve') || action.includes('confirm')) return 0.5;
    if (action.includes('recommend') || action.includes('suggest')) return 0.8;
    if (action.includes('execute') || action.includes('run')) return 0.2;
    return 0.3;
  }

  private scoreDataPrivacy(action: string, params: Record<string, unknown>): number {
    const exposureVerbs = ['export', 'share', 'send', 'transmit', 'publish', 'disclose'];
    if (exposureVerbs.some((v) => action.includes(v))) {
      // Check if params contain sensitive data types
      const paramStr = JSON.stringify(params).toLowerCase();
      const sensitiveTypes = ['email', 'phone', 'ssn', 'password', 'address', 'financial'];
      return sensitiveTypes.some((t) => paramStr.includes(t)) ? -0.8 : -0.2;
    }
    if (action.includes('anonymize') || action.includes('aggregate')) return 0.7;
    return 0.4;
  }

  private scoreTransparency(action: string, _params: Record<string, unknown>): number {
    if (action.includes('explain') || action.includes('report') || action.includes('show')) return 0.8;
    if (action.includes('hide') || action.includes('conceal')) return -0.9;
    if (action.includes('algorithm') || action.includes('automated')) return 0.2;
    return 0.3;
  }

  private scoreFairness(action: string, _params: Record<string, unknown>): number {
    if (action.includes('equal') || action.includes('fair') || action.includes('standard')) return 0.7;
    if (action.includes('segment') || action.includes('target')) return 0.1;
    if (action.includes('discriminat') || action.includes('exclude')) return -0.9;
    if (action.includes('price') && action.includes('increase')) return -0.2;
    return 0.3;
  }

  private scoreHonesty(action: string, _params: Record<string, unknown>): number {
    if (action.includes('fabricate') || action.includes('fake') || action.includes('lie')) return -1.0;
    if (action.includes('estimate') || action.includes('project')) return 0.2;
    if (action.includes('verify') || action.includes('confirm')) return 0.6;
    if (action.includes('generate') || action.includes('create')) return 0.4;
    return 0.5;
  }

  private scoreSafety(action: string, _params: Record<string, unknown>): number {
    const unsafeVerbs = ['delete', 'purge', 'wipe', 'destroy', 'cancel', 'refund', 'charge'];
    if (unsafeVerbs.some((v) => action.includes(v))) return -0.4;
    if (action.includes('backup') || action.includes('protect') || action.includes('secure')) return 0.8;
    if (action.includes('test') || action.includes('preview')) return 0.5;
    return 0.4;
  }

  private scoreGrowth(action: string, _params: Record<string, unknown>): number {
    if (action.includes('learn') || action.includes('improve') || action.includes('develop')) return 0.8;
    if (action.includes('optimize') || action.includes('streamline')) return 0.6;
    if (action.includes('cut') || action.includes('reduce') && action.includes('cost')) return 0.3;
    if (action.includes('shortcut') || action.includes('hack')) return -0.3;
    return 0.3;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     STAKEHOLDER ASSESSMENT
     ═══════════════════════════════════════════════════════════════════════════ */

  /**
   * Assess the impact of an action on each stakeholder group.
   * Groups: user, customers, team, public.
   */
  private assessStakeholders(
    action: string,
    params: Record<string, unknown>,
  ): StakeholderAssessment[] {
    const actionLower = action.toLowerCase();
    const stakeholders: StakeholderAssessment[] = [];

    // ── User (the business owner / KEY operator) ─────────────────────────
    const userImpact = this.assessUserImpact(actionLower, params);
    stakeholders.push({
      stakeholder: 'user',
      impact: userImpact.impact,
      explanation: userImpact.explanation,
    });

    // ── Customers (end customers of the business) ────────────────────────
    const customerImpact = this.assessCustomerImpact(actionLower, params);
    stakeholders.push({
      stakeholder: 'customers',
      impact: customerImpact.impact,
      explanation: customerImpact.explanation,
    });

    // ── Team (employees / contractors) ───────────────────────────────────
    const teamImpact = this.assessTeamImpact(actionLower, params);
    stakeholders.push({
      stakeholder: 'team',
      impact: teamImpact.impact,
      explanation: teamImpact.explanation,
    });

    // ── Public (broader community / market) ──────────────────────────────
    const publicImpact = this.assessPublicImpact(actionLower, params);
    stakeholders.push({
      stakeholder: 'public',
      impact: publicImpact.impact,
      explanation: publicImpact.explanation,
    });

    return stakeholders;
  }

  private assessUserImpact(
    action: string,
    _params: Record<string, unknown>,
  ): { impact: StakeholderImpact; explanation: string } {
    if (action.includes('recommend') || action.includes('suggest')) {
      return { impact: 'positive', explanation: 'Provides actionable guidance to improve business outcomes.' };
    }
    if (action.includes('alert') || action.includes('warn')) {
      return { impact: 'positive', explanation: 'Helps user avoid potential problems.' };
    }
    if (action.includes('delete') || action.includes('purge')) {
      return { impact: 'negative', explanation: 'Risk of data loss if executed incorrectly.' };
    }
    if (action.includes('charge') || action.includes('bill')) {
      return { impact: 'negative', explanation: 'Financial impact on the user.' };
    }
    return { impact: 'neutral', explanation: 'No direct impact on the user.' };
  }

  private assessCustomerImpact(
    action: string,
    _params: Record<string, unknown>,
  ): { impact: StakeholderImpact; explanation: string } {
    if (action.includes('price increase') || action.includes('raise price')) {
      return { impact: 'negative', explanation: 'Customers may face higher prices.' };
    }
    if (action.includes('improve') || action.includes('enhance')) {
      return { impact: 'positive', explanation: 'Customers benefit from improved products or services.' };
    }
    if (action.includes('personal') || action.includes('data')) {
      return { impact: 'negative', explanation: 'Potential impact on customer data privacy.' };
    }
    return { impact: 'neutral', explanation: 'No direct impact on customers.' };
  }

  private assessTeamImpact(
    action: string,
    _params: Record<string, unknown>,
  ): { impact: StakeholderImpact; explanation: string } {
    if (action.includes('automate') || action.includes('streamline')) {
      return { impact: 'positive', explanation: 'Reduces manual workload for the team.' };
    }
    if (action.includes('restructure') || action.includes('reorganize')) {
      return { impact: 'negative', explanation: 'May create uncertainty or disruption for team members.' };
    }
    if (action.includes('hire') || action.includes('expand')) {
      return { impact: 'positive', explanation: 'Creates growth opportunities for the team.' };
    }
    return { impact: 'neutral', explanation: 'No direct impact on the team.' };
  }

  private assessPublicImpact(
    action: string,
    _params: Record<string, unknown>,
  ): { impact: StakeholderImpact; explanation: string } {
    if (action.includes('environment') || action.includes('sustainable')) {
      return { impact: 'positive', explanation: 'Positive environmental or social impact.' };
    }
    if (action.includes('deceptive') || action.includes('mislead')) {
      return { impact: 'negative', explanation: 'Could damage public trust or market integrity.' };
    }
    if (action.includes('compliance') || action.includes('regulation')) {
      return { impact: 'positive', explanation: 'Ensures adherence to legal and regulatory standards.' };
    }
    return { impact: 'neutral', explanation: 'No significant public impact.' };
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     RISK PATTERN DETECTION
     ═══════════════════════════════════════════════════════════════════════════ */

  /** Check for high-risk action patterns that warrant extra scrutiny. */
  private checkRiskPatterns(
    action: string,
    params: Record<string, unknown>,
  ): string[] {
    const flags: string[] = [];
    const actionLower = action.toLowerCase();

    // High-risk action verbs
    for (const riskAction of HIGH_RISK_ACTIONS) {
      if (actionLower.includes(riskAction)) {
        flags.push(`high_risk_action:${riskAction}`);
      }
    }

    // Bulk operations
    const bulkSize = params['bulkSize'] as number | undefined;
    if (bulkSize && bulkSize > 100) {
      flags.push(`large_bulk_operation:${bulkSize}`);
    }

    // Financial actions without explicit approval
    if (
      (actionLower.includes('charge') || actionLower.includes('bill') || actionLower.includes('refund')) &&
      params['requiresApproval'] !== true
    ) {
      flags.push('financial_action_without_approval');
    }

    // Data deletion
    if (actionLower.includes('delete') && actionLower.includes('permanent')) {
      flags.push('permanent_data_deletion');
    }

    // Automated external communication
    if (
      actionLower.includes('auto') &&
      (actionLower.includes('email') || actionLower.includes('message') || actionLower.includes('notify'))
    ) {
      flags.push('automated_external_communication');
    }

    return flags;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     PERMIT / DENY LOGIC
     ═══════════════════════════════════════════════════════════════════════════ */

  /**
   * Compute the final permit/deny decision.
   * An action is denied if ANY principle scores below -0.6 OR
   * if there are critical risk flags OR if the weighted average is negative.
   */
  private computePermitted(
    principles: EthicalPrinciple[],
    stakeholders: StakeholderAssessment[],
    riskFlags: string[],
  ): boolean {
    // Hard veto: any principle below -0.6
    const hardVeto = principles.some((p) => p.score < -0.6);
    if (hardVeto) return false;

    // Critical risk flags
    const criticalFlags = riskFlags.filter(
      (f) =>
        f.includes('permanent_data_deletion') ||
        f.includes('financial_action_without_approval'),
    );
    if (criticalFlags.length > 0) return false;

    // Weighted average score — must be non-negative
    const weights: Record<KeyCoreValue, number> = {
      user_autonomy: 0.20,
      data_privacy: 0.20,
      transparency: 0.15,
      fairness: 0.15,
      honesty: 0.15,
      safety: 0.10,
      growth: 0.05,
    };

    const weightedScore = principles.reduce(
      (sum, p) => sum + p.score * (weights[p.principle] || 0.1),
      0,
    );

    // Also check that no stakeholder has a strongly negative impact
    const strongNegativeStakeholder = stakeholders.filter(
      (s) => s.impact === 'negative',
    ).length;
    if (strongNegativeStakeholder >= 2 && weightedScore < 0.1) return false;

    return weightedScore >= 0;
  }

  /** Compute overall confidence in the ethical evaluation. */
  private computeEvaluationConfidence(principles: EthicalPrinciple[]): number {
    const scoreVariance = this.variance(principles.map((p) => p.score));
    // High variance = lower confidence (principles disagree)
    const disagreementPenalty = Math.min(scoreVariance * 2, 0.3);
    return Math.round((1.0 - disagreementPenalty) * 1000) / 1000;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     ALTERNATIVE GENERATION
     ═══════════════════════════════════════════════════════════════════════════ */

  /**
   * Generate ethically-superior alternatives when an action is denied.
   * Produces 1–3 alternatives based on which principles were violated.
   */
  private generateAlternatives(
    action: string,
    _params: Record<string, unknown>,
    principles: EthicalPrinciple[],
  ): string[] {
    const alternatives: string[] = [];
    const violatedPrinciples = principles.filter((p) => p.score < -0.3);

    for (const vp of violatedPrinciples) {
      switch (vp.principle) {
        case 'user_autonomy':
          alternatives.push(
            `Present the recommendation to the user for explicit approval before executing "${action}".`,
          );
          break;
        case 'data_privacy':
          alternatives.push(
            `Use only anonymised/aggregated data for "${action}", or obtain explicit user consent first.`,
          );
          break;
        case 'transparency':
          alternatives.push(
            `Provide a detailed explanation of the reasoning behind "${action}" including all assumptions and data sources.`,
          );
          break;
        case 'fairness':
          alternatives.push(
            `Apply "${action}" uniformly across all customer segments, or grandfather existing customers.`,
          );
          break;
        case 'honesty':
          alternatives.push(
            `Verify all data and claims used in "${action}" against primary sources before proceeding.`,
          );
          break;
        case 'safety':
          alternatives.push(
            `Run "${action}" in a test/sandbox environment first, or implement a staged rollout with rollback capability.`,
          );
          break;
        case 'growth':
          alternatives.push(
            `Reframe "${action}" to emphasise long-term sustainable outcomes over short-term gains.`,
          );
          break;
      }
    }

    // Deduplicate and limit
    const unique = [...new Set(alternatives)];
    return unique.slice(0, 3);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     EXPLANATION BUILDERS
     ═══════════════════════════════════════════════════════════════════════════ */

  /** Build a human-readable ethical explanation from evaluation components. */
  private buildExplanation(
    action: string,
    principles: EthicalPrinciple[],
    stakeholders: StakeholderAssessment[],
    permitted: boolean,
    riskFlags: string[],
  ): string {
    const lines: string[] = [];

    lines.push(`Ethical Analysis of: "${action}"`);
    lines.push('');
    lines.push(`Overall Verdict: ${permitted ? '✅ PERMITTED' : '❌ DENIED'}`);
    lines.push('');

    // Principle scores
    lines.push('Principle Scores:');
    for (const p of principles) {
      const emoji = p.score > 0.3 ? '✅' : p.score < -0.3 ? '❌' : '⚠️';
      const scorePct = `${(p.score * 100).toFixed(0)}%`;
      lines.push(`  ${emoji} ${p.principle}: ${scorePct} — ${p.explanation}`);
    }
    lines.push('');

    // Stakeholder impact
    lines.push('Stakeholder Impact:');
    for (const s of stakeholders) {
      const emoji = s.impact === 'positive' ? '✅' : s.impact === 'negative' ? '❌' : '➖';
      lines.push(`  ${emoji} ${s.stakeholder}: ${s.impact} — ${s.explanation}`);
    }

    // Risk flags
    if (riskFlags.length > 0) {
      lines.push('');
      lines.push('Risk Flags:');
      for (const flag of riskFlags) {
        lines.push(`  🚩 ${flag}`);
      }
    }

    return lines.join('\n');
  }

  /** Format a previously-stored ethical evaluation for human reading. */
  private formatStoredExplanation(
    evaluation: EthicalEvaluation,
    event: { createdAt: Date; id: string },
  ): string {
    const lines: string[] = [];
    lines.push(`Decision Explanation for ${event.id}`);
    lines.push(`Made on: ${event.createdAt.toISOString()}`);
    lines.push('');
    lines.push(evaluation.explanation);

    if (evaluation.alternativeActions && evaluation.alternativeActions.length > 0) {
      lines.push('');
      lines.push('Alternative actions considered:');
      for (const alt of evaluation.alternativeActions) {
        lines.push(`  • ${alt}`);
      }
    }

    return lines.join('\n');
  }

  /** Reconstruct an explanation from a raw event when no evaluation was stored. */
  private reconstructExplanation(
    event: { action: string; params: Record<string, unknown>; createdAt: Date },
  ): string {
    const lines: string[] = [];
    lines.push(`Decision Explanation for ${event.action}`);
    lines.push(`Made on: ${event.createdAt.toISOString()}`);
    lines.push('');
    lines.push(`Action: ${event.action}`);
    lines.push(`Parameters: ${JSON.stringify(event.params, null, 2)}`);
    lines.push('');
    lines.push('No detailed ethical evaluation was recorded at the time of this decision.');
    lines.push('The action was evaluated against KEY\'s core values: user_autonomy, data_privacy, transparency, fairness, honesty, safety, and growth.');

    return lines.join('\n');
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     HISTORICAL CONTEXT
     ═══════════════════════════════════════════════════════════════════════════ */

  /**
   * Check if the user previously rejected similar recommendations.
   * Returns rejection count and whether a pattern exists.
   */
  private async checkHistoricalRejections(
    businessId: string,
    recommendation: string,
  ): Promise<{ wasRejected: boolean; count: number }> {
    try {
      // Extract key action terms from the recommendation
      const actionTerms = recommendation.toLowerCase().split(/\s+/).slice(0, 5);

      const recentEvents = await this.prisma.cortexEvent.findMany({
        where: {
          businessId,
          action: { contains: 'rejection' },
          createdAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days
          },
        },
        take: 50,
      } as Record<string, unknown>);

      let rejectionCount = 0;
      for (const event of recentEvents) {
        const eventAction = (event.action || '').toLowerCase();
        const matches = actionTerms.some((term) => eventAction.includes(term));
        if (matches) rejectionCount++;
      }

      return {
        wasRejected: rejectionCount > 0,
        count: rejectionCount,
      };
    } catch {
      return { wasRejected: false, count: 0 };
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     DATA TYPE EXTRACTION
     ═══════════════════════════════════════════════════════════════════════════ */

  /** Extract potential data type references from action parameters. */
  private extractDataTypes(data: Record<string, unknown>): string[] {
    const dataStr = JSON.stringify(data).toLowerCase();
    const types: string[] = [];

    for (const dataType of Object.keys(DATA_SENSITIVITY)) {
      if (dataStr.includes(dataType.replace('_', ' ')) || dataStr.includes(dataType)) {
        types.push(dataType);
      }
    }

    // Also check for known data field names
    const fieldMappings: Record<string, string> = {
      email: 'email',
      'e-mail': 'email',
      phone: 'phone',
      telephone: 'phone',
      mobile: 'phone',
      address: 'address',
      ssn: 'ssn',
      'social security': 'ssn',
      password: 'password',
      location: 'location',
      gps: 'location',
      ip: 'ip_address',
      revenue: 'financial',
      cost: 'financial',
      price: 'financial',
    };

    for (const [field, dataType] of Object.entries(fieldMappings)) {
      if (dataStr.includes(field) && !types.includes(dataType)) {
        types.push(dataType);
      }
    }

    return [...new Set(types)];
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     UTILITIES
     ═══════════════════════════════════════════════════════════════════════════ */

  private hashAction(action: string, params: Record<string, unknown>, businessId: string): string {
    const str = `${action}:${JSON.stringify(params)}:${businessId}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return `ethics:${hash}`;
  }

  private variance(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map((v) => (v - mean) ** 2);
    return squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length;
  }
}
