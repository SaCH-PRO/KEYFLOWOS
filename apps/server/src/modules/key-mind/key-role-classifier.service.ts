import { Injectable, Logger } from '@nestjs/common';
import {
  BusinessFunction, WorkerTier, RoleClassificationResult, KeyRoleBrain,
} from './key-mind.types';
import { KEY_ROLE_TAXONOMY, getRolesByFunctionAndTier } from './key-role-taxonomy';

/**
 * =============================================================================
 * Role Classifier — Detects Business Function + Worker Tier from User Query
 * =============================================================================
 * Analyses natural language queries to determine:
 *   • Which of the 12 business functions is involved
 *   • Which of the 7 worker tiers is appropriate
 *   • Which role archetypes should be activated
 *
 * Uses keyword matching, phrase detection, and confidence scoring.
 * =============================================================================
 */

@Injectable()
export class KeyRoleClassifier {
  private readonly logger = new Logger(KeyRoleClassifier.name);

  // All 12 business functions for iteration
  private readonly ALL_FUNCTIONS: BusinessFunction[] = [
    'strategy', 'operations', 'finance', 'sales', 'marketing',
    'customer_success', 'product', 'people', 'legal_risk',
    'analytics', 'technology', 'admin',
  ];

  // All 7 worker tiers in seniority order
  private readonly ALL_TIERS: WorkerTier[] = [
    'intern', 'assistant', 'specialist', 'manager',
    'director', 'executive', 'founder_partner',
  ];

  // Keywords that map to each business function
  private readonly FUNCTION_KEYWORDS: Record<BusinessFunction, string[]> = {
    strategy: ['strategy', 'vision', 'mission', 'growth plan', 'market position', 'competitive', 'business model', 'expansion', 'moat', 'long-term', 'direction'],
    operations: ['operations', 'process', 'workflow', 'SOP', 'efficiency', 'bottleneck', 'delivery', 'quality', 'capacity', 'logistics', 'supply chain'],
    finance: ['finance', 'cash flow', 'profit', 'revenue', 'budget', 'forecast', 'accounting', 'pricing', 'margin', 'ROI', 'runway', 'expense', 'tax', 'invoice'],
    sales: ['sales', 'lead', 'pipeline', 'conversion', 'deal', 'prospect', 'closing', 'quota', 'CRM', 'follow-up', 'objection', 'proposal', 'demo'],
    marketing: ['marketing', 'brand', 'campaign', 'ads', 'SEO', 'content', 'social media', 'conversion rate', 'funnel', 'audience', 'copy', 'growth', 'traffic'],
    customer_success: ['customer', 'support', 'retention', 'satisfaction', 'complaint', 'onboarding', 'churn', 'NPS', 'service', 'help desk', 'ticket'],
    product: ['product', 'feature', 'roadmap', 'MVP', 'UX', 'design', 'usability', 'release', 'feedback', 'iteration', 'prototype'],
    people: ['hiring', 'team', 'HR', 'performance', 'culture', 'training', 'recruit', 'employee', 'compensation', 'retention', 'talent', 'org chart'],
    legal_risk: ['legal', 'contract', 'compliance', 'risk', 'liability', 'policy', 'GDPR', 'terms', 'insurance', 'regulation', 'privacy'],
    analytics: ['analytics', 'KPI', 'dashboard', 'report', 'metric', 'data', 'trend', 'analysis', 'forecast', 'measurement', 'benchmark'],
    technology: ['tech', 'system', 'automation', 'integration', 'API', 'software', 'infrastructure', 'security', 'database', 'AI', 'platform'],
    admin: ['schedule', 'meeting', 'calendar', 'inbox', 'document', 'task', 'travel', 'expense report', 'reminder', 'coordination'],
  };

  // Phrases that indicate seniority/tier
  private readonly TIER_INDICATORS: Record<WorkerTier, string[]> = {
    intern: ['intern', 'trainee', 'apprentice', 'learning', 'shadow', 'entry level'],
    assistant: ['assistant', 'admin', 'coordinator', 'help me with', 'basic', 'routine'],
    specialist: ['specialist', 'analyst', 'operator', 'expert in', 'detailed', 'technical'],
    manager: ['manager', 'lead', 'supervisor', 'team lead', 'manage', 'oversee', 'department'],
    director: ['director', 'head of', ' VP', 'senior manager', 'strategic', 'initiative'],
    executive: ['executive', 'C-suite', 'CEO', 'CFO', 'CMO', 'CTO', 'chief', 'board', 'stakeholder'],
    founder_partner: ['founder', 'owner', 'partner', 'entrepreneur', 'vision', 'big picture', 'whole business', 'my business'],
  };

  /**
   * Main entry: classify a user query into business function + tier.
   */
  async classify(query: string): Promise<RoleClassificationResult> {
    const lowerQuery = query.toLowerCase();

    // Step 1: Score each business function
    const functionScores = this.scoreFunctions(lowerQuery);
    const primaryFunction = this.selectTopFunction(functionScores);

    // Step 2: Score each worker tier
    const tierScores = this.scoreTiers(lowerQuery);
    const primaryTier = this.selectTopTier(tierScores);

    // Step 3: Get activated roles
    const activatedRoles = getRolesByFunctionAndTier(primaryFunction, primaryTier);

    // Step 4: Calculate confidence
    const topScore = functionScores[primaryFunction];
    const confidence = Math.min(topScore / 5, 1.0); // Normalise: 5+ matches = 100%

    // Step 5: Build reasoning
    const reasoning = this.buildReasoning(primaryFunction, primaryTier, functionScores, tierScores);

    this.logger.log(
      `[RoleClassifier] "${query.substring(0, 60)}..." -> ${primaryFunction}/${primaryTier} ` +
      `(${activatedRoles.length} roles, ${(confidence * 100).toFixed(0)}% confidence)`,
    );

    return {
      primaryFunction,
      primaryTier,
      activatedRoles,
      confidence,
      reasoning,
    };
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /**
   * Score each business function based on keyword matches in the query.
   * Multi-word phrase matches receive a higher weight (2x) than single-word matches.
   */
  private scoreFunctions(query: string): Record<BusinessFunction, number> {
    const scores = {} as Record<BusinessFunction, number>;

    for (const fn of this.ALL_FUNCTIONS) {
      let score = 0;
      const keywords = this.FUNCTION_KEYWORDS[fn];

      for (const keyword of keywords) {
        if (query.includes(keyword.toLowerCase())) {
          // Multi-word phrases get double weight
          const weight = keyword.includes(' ') ? 2 : 1;
          score += weight;
        }
      }

      scores[fn] = score;
    }

    return scores;
  }

  /**
   * Select the business function with the highest score.
   * Falls back to 'strategy' if no clear winner (all scores are zero).
   */
  private selectTopFunction(scores: Record<BusinessFunction, number>): BusinessFunction {
    let bestFn: BusinessFunction = 'strategy';
    let bestScore = -1;

    for (const fn of this.ALL_FUNCTIONS) {
      if (scores[fn] > bestScore) {
        bestScore = scores[fn];
        bestFn = fn;
      }
    }

    // If absolutely nothing matched, default to strategy
    if (bestScore === 0) {
      this.logger.debug('[RoleClassifier] No function keywords matched; defaulting to strategy');
      return 'strategy';
    }

    return bestFn;
  }

  /**
   * Score each worker tier based on tier indicator matches in the query.
   * Founder language receives a bonus weight (3x) because it is highly distinctive.
   */
  private scoreTiers(query: string): Record<WorkerTier, number> {
    const scores = {} as Record<WorkerTier, number>;

    for (const tier of this.ALL_TIERS) {
      let score = 0;
      const indicators = this.TIER_INDICATORS[tier];

      for (const indicator of indicators) {
        if (query.includes(indicator.toLowerCase())) {
          // Founder language is highly distinctive — give it extra weight
          const weight = tier === 'founder_partner' ? 3 : indicator.includes(' ') ? 2 : 1;
          score += weight;
        }
      }

      scores[tier] = score;
    }

    return scores;
  }

  /**
   * Select the worker tier with the highest score.
   * Falls back to 'manager' if no clear winner (all scores are zero).
   */
  private selectTopTier(scores: Record<WorkerTier, number>): WorkerTier {
    let bestTier: WorkerTier = 'manager';
    let bestScore = -1;

    for (const tier of this.ALL_TIERS) {
      if (scores[tier] > bestScore) {
        bestScore = scores[tier];
        bestTier = tier;
      }
    }

    // If no tier indicators matched, default to manager
    if (bestScore === 0) {
      this.logger.debug('[RoleClassifier] No tier indicators matched; defaulting to manager');
      return 'manager';
    }

    return bestTier;
  }

  /**
   * Build a human-readable explanation of why this function and tier were selected.
   * Includes the top-scoring functions for transparency.
   */
  private buildReasoning(
    fn: BusinessFunction,
    tier: WorkerTier,
    functionScores: Record<BusinessFunction, number>,
    tierScores: Record<WorkerTier, number>,
  ): string {
    // Get top-3 functions by score
    const sortedFns = [...this.ALL_FUNCTIONS]
      .sort((a, b) => functionScores[b] - functionScores[a])
      .slice(0, 3);

    const fnReasoning = sortedFns
      .map(f => `${f} (score: ${functionScores[f]})`)
      .join(', ');

    // Get top-3 tiers by score
    const sortedTiers = [...this.ALL_TIERS]
      .sort((a, b) => tierScores[b] - tierScores[a])
      .slice(0, 3);

    const tierReasoning = sortedTiers
      .map(t => `${t} (score: ${tierScores[t]})`)
      .join(', ');

    return (
      `Selected business function "${fn}" based on keyword analysis. ` +
      `Top function matches: ${fnReasoning}. ` +
      `Selected worker tier "${tier}" based on seniority indicators. ` +
      `Top tier matches: ${tierReasoning}.`
    );
  }
}
