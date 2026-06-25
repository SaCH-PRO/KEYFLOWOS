import { Injectable, Logger } from '@nestjs/common';
import { KeyRoleBrain, KeyConsciousnessFrame, BusinessFunction, WorkerTier } from './key-mind.types';
import { KEY_ROLE_TAXONOMY, getRoleById, getRolesByFunction } from './key-role-taxonomy';

/**
 * =============================================================================
 * Expert Brain Loader — Loads the Right Expert Configuration for a Role
 * =============================================================================
 * Given a classified function+tier, loads the complete expert brain:
 *   • Role definition (mission, questions, frameworks)
 *   • Thinking style and communication style
 *   • Quality standards and risk checks
 *   • Success metrics
 * =============================================================================
 */

@Injectable()
export class KeyExpertBrain {
  private readonly logger = new Logger(KeyExpertBrain.name);

  /** Tier order used for proximity-based fallback searches. */
  private readonly TIER_ORDER: WorkerTier[] = [
    'intern', 'assistant', 'specialist', 'manager',
    'director', 'executive', 'founder_partner',
  ];

  /**
   * Load the best expert brain(s) for a given function and tier.
   * If exact match not found, finds nearest tier match (one tier above or below).
   * Falls back to the first two roles in the function if nothing matches.
   */
  async loadBrain(functionArea: BusinessFunction, tier: WorkerTier): Promise<KeyRoleBrain[]> {
    // Try exact match first
    let roles = getRolesByFunctionAndTier(functionArea, tier);

    // If no exact match, search nearby tiers (up/down one level)
    if (roles.length === 0) {
      const idx = this.TIER_ORDER.indexOf(tier);
      const nearbyTiers: WorkerTier[] = [];

      if (idx > 0) nearbyTiers.push(this.TIER_ORDER[idx - 1]);
      if (idx < this.TIER_ORDER.length - 1) nearbyTiers.push(this.TIER_ORDER[idx + 1]);

      for (const nearby of nearbyTiers) {
        roles = getRolesByFunctionAndTier(functionArea, nearby);
        if (roles.length > 0) {
          this.logger.debug(
            `[ExpertBrain] No exact match for ${functionArea}/${tier}; ` +
            `falling back to nearby tier ${nearby}`,
          );
          break;
        }
      }
    }

    // Fallback: any role in this function (up to 2)
    if (roles.length === 0) {
      roles = getRolesByFunction(functionArea).slice(0, 2);
      this.logger.debug(
        `[ExpertBrain] No nearby tier match for ${functionArea}/${tier}; ` +
        `falling back to first ${roles.length} role(s) in function`,
      );
    }

    // Ultimate fallback: strategy-manager if everything else fails
    if (roles.length === 0) {
      const ultimateFallback = getRoleById('strategy-manager');
      if (ultimateFallback) {
        roles = [ultimateFallback];
      }
    }

    this.logger.log(
      `[ExpertBrain] Loaded ${roles.length} brain(s) for ${functionArea}/${tier}: ` +
      `${roles.map(r => r.name).join(', ')}`,
    );

    return roles;
  }

  /**
   * Get thinking prompts for a role — these guide the AI's reasoning.
   * Returns an ordered array of prompts that establish role identity, thinking patterns,
   * and quality standards.
   */
  async getThinkingPrompts(role: KeyRoleBrain): Promise<string[]> {
    const prompts: string[] = [];

    // 1. Identity prompt — establishes who the AI is embodying
    prompts.push(
      `You are thinking as a ${role.name} (${role.tier} level) in ${role.functionArea}. ` +
      `Your mission: ${role.mission}`,
    );

    // 2. Core questions — the role's default analytical framework
    prompts.push(
      `As a ${role.name}, you must answer these questions:\n` +
      `${role.coreQuestions.map(q => `- ${q}`).join('\n')}`,
    );

    // 3. Framework guidance — which mental models to apply
    prompts.push(`Apply these frameworks: ${role.frameworks.join(', ')}`);

    // 4. Style guidance — thinking and communication norms
    prompts.push(
      `Your thinking style: ${role.thinkingStyle} ` +
      `Your communication style: ${role.communicationStyle}`,
    );

    // 5. Risk awareness — what to check before recommending
    prompts.push(`Before recommending anything, check: ${role.riskChecks.join(', ')}`);

    return prompts;
  }

  /**
   * Get the prompt that defines how this role should structure its responses.
   * Use this to configure output formatting and quality expectations.
   */
  async getOutputGuidance(role: KeyRoleBrain): Promise<string> {
    return (
      `As a ${role.name}, structure your response with these characteristics:\n` +
      `- Evidence standard: ${role.evidenceStandards.join(', ')}\n` +
      `- Output format: ${role.outputFormats.join(', ')}\n` +
      `- Success metrics to consider: ${role.successMetrics.join(', ')}\n` +
      `- Decision horizon: ${role.decisionHorizon}\n` +
      `- Communication style: ${role.communicationStyle}`
    );
  }

  /**
   * Load multiple brains for a cross-functional problem.
   * Each function gets its own brain set; results are flattened and deduplicated.
   */
  async loadCrossFunctionalBrains(
    functions: BusinessFunction[],
    tier: WorkerTier,
  ): Promise<KeyRoleBrain[]> {
    const allRoles: KeyRoleBrain[] = [];
    const seenIds = new Set<string>();

    for (const fn of functions) {
      const brains = await this.loadBrain(fn, tier);
      for (const brain of brains) {
        if (!seenIds.has(brain.id)) {
          seenIds.add(brain.id);
          allRoles.push(brain);
        }
      }
    }

    this.logger.log(
      `[ExpertBrain] Loaded ${allRoles.length} unique brain(s) ` +
      `for cross-functional problem [${functions.join(', ')}]/${tier}`,
    );

    return allRoles;
  }

  /**
   * Convenience: load a single primary brain for a function + tier.
   * Returns the first (best-matched) brain or undefined if none found.
   */
  async loadPrimaryBrain(
    functionArea: BusinessFunction,
    tier: WorkerTier,
  ): Promise<KeyRoleBrain | undefined> {
    const brains = await this.loadBrain(functionArea, tier);
    return brains[0];
  }

  /**
   * Get a system-level prompt that combines all loaded brains for a session.
   * Used to initialise the AI's consciousness frame with multiple expert perspectives.
   */
  async getSystemPromptForBrains(brains: KeyRoleBrain[]): Promise<string> {
    if (brains.length === 0) {
      return 'You are a general business advisor. Provide thoughtful, practical advice.';
    }

    if (brains.length === 1) {
      const role = brains[0];
      const thinkingPrompts = await this.getThinkingPrompts(role);
      const outputGuidance = await this.getOutputGuidance(role);
      return thinkingPrompts.join('\n\n') + '\n\n' + outputGuidance;
    }

    // Multi-brain mode: synthesise a cross-functional system prompt
    const sections: string[] = [];
    sections.push(
      `You are synthesising perspectives from ${brains.length} expert roles ` +
      `to solve a cross-functional business problem.`,
    );

    for (let i = 0; i < brains.length; i++) {
      const role = brains[i];
      sections.push(
        `\n--- Perspective ${i + 1}: ${role.name} (${role.functionArea}, ${role.tier}) ---\n` +
        `Mission: ${role.mission}\n` +
        `Key questions: ${role.coreQuestions.join('; ')}\n` +
        `Frameworks: ${role.frameworks.join(', ')}\n` +
        `Thinking style: ${role.thinkingStyle}\n` +
        `Risk checks: ${role.riskChecks.join(', ')}`,
      );
    }

    sections.push(
      `\n--- Synthesis Instructions ---\n` +
      `Analyse the problem from each perspective above, then synthesise a unified recommendation. ` +
      `Flag any tensions or trade-offs between different functional priorities. ` +
      `Provide clear, actionable next steps with owners and timelines.`,
    );

    return sections.join('\n');
  }
}
