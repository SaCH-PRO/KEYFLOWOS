import { Injectable, Logger } from '@nestjs/common';
import { AiOversightService } from '../ai/ai-oversight.service';
import { GenomeAutonomyGateService } from '../business-genome/key-genome/genome-autonomy-gate.service';
import { KeyActionPolicyService } from './key-action-policy.service';
import { KeyActionGenomePolicyService } from './key-action-genome-policy.service';
import { AutonomyLevelService } from './autonomy-level.service';
import { ConstitutionValuesService } from './constitution-values.service';
import { AuthorityGrantRuleService } from './authority-grant-rule.service';
import { AutonomyRuleDbService } from './autonomy-rule-db.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import type {
  AutonomyActionContext,
  AutonomyRuleTrace,
  AutonomyTier,
  AutonomyVerdict,
} from './autonomy-orchestrator.types';
import type { GenomeAutonomyGateDecision } from '../business-genome/key-genome/key-genome.types';
import type { KeyExecutableActionType } from './key-action-proposal.types';

/**
 * Single source of truth for whether KEY may execute an action.
 *
 * Aggregates inputs from:
 *  - AutonomyLevelService (canonical level/mode)
 *  - AutonomyRuleDbService (explicit per-business rules)
 *  - AiOversightService (tool risk, blocked tools/modules)
 *  - GenomeAutonomyGateService (cross-domain risk, readiness, confidence)
 *  - KeyActionGenomePolicyService (per-module Genome readiness)
 *  - ConstitutionValuesService (blueprint values / constitution)
 *  - AuthorityGrantRuleService (L4 authority grants)
 *  - KeyActionPolicyService (static action metadata)
 *
 * Emits one canonical AutonomyVerdict that every caller must respect.
 */
@Injectable()
export class AutonomyOrchestratorService {
  private readonly logger = new Logger(AutonomyOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiOversight: AiOversightService,
    private readonly genomeGate: GenomeAutonomyGateService,
    private readonly actionPolicy: KeyActionPolicyService,
    private readonly genomePolicy: KeyActionGenomePolicyService,
    private readonly levelService: AutonomyLevelService,
    private readonly constitutionValues: ConstitutionValuesService,
    private readonly authorityGrantRule: AuthorityGrantRuleService,
    private readonly ruleDb: AutonomyRuleDbService,
  ) {}

  /**
   * Evaluate whether an action is allowed, and under what conditions.
   *
   * The verdict is the result of a conservative AND across rule providers:
   * any provider may block; providers that require approval promote the tier
   * to 'supervised'. The final verdict is persisted for audit.
   */
  async evaluate(context: AutonomyActionContext): Promise<AutonomyVerdict> {
    const trace: AutonomyRuleTrace[] = [];
    const now = new Date();

    let allowed = true;
    let requiresApproval = false;
    let tier: AutonomyTier = 'full';
    let confidence = 1.0;
    const reasons: string[] = [];

    // 0. Canonical autonomy level
    try {
      const level = await this.levelService.resolve(context.businessId);
      trace.push({
        source: 'AutonomyLevelService',
        rule: `level-${level.level}`,
        result: level.level <= 0 ? 'block' : level.level <= 2 ? 'supervised' : 'allow',
        reason: `Canonical autonomy level: ${level.level} (${level.mode}) from ${level.label}`,
        metadata: { level, maxAutoRiskTier: level.maxAutoRiskTier },
      });

      if (level.level <= 0) {
        allowed = false;
        reasons.push('Autonomy level is advisory/manual');
      } else if (level.level <= 2) {
        requiresApproval = true;
        tier = 'supervised';
      }
    } catch (err: any) {
      this.logger.warn(
        `[evaluate][${context.businessId}] Level resolution failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      trace.push({
        source: 'AutonomyLevelService',
        rule: 'error-fallback',
        result: 'block',
        reason: 'Level resolution failed — defaulting to manual',
      });
      allowed = false;
      reasons.push('Autonomy level resolution failed');
    }

    // 1. Explicit DB rules (highest priority business-specific overrides).
    if (allowed) {
      try {
        const dbRules = await this.ruleDb.findMatchingRules(
          context.businessId,
          context.actionKey,
        );
        for (const rule of dbRules) {
          trace.push({
            source: 'AutonomyRuleDbService',
            rule: rule.ruleKey,
            result: rule.decision,
            reason: rule.reason,
            metadata: { priority: rule.priority, source: rule.source },
          });

          if (rule.decision === 'block') {
            allowed = false;
            reasons.push(rule.reason);
            break;
          }
          if (rule.decision === 'supervised') {
            requiresApproval = true;
            tier = 'supervised';
            reasons.push(rule.reason);
          }
        }
      } catch (err: any) {
        this.logger.warn(
          `[evaluate][${context.businessId}] DB rule lookup failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 2. AI oversight: tool/module risk, blocked lists, autopilot mode.
    if (allowed) {
      try {
        const oversight = await this.aiOversight.evaluate(
          context.businessId,
          context.actionKey,
          undefined,
          context.role as any,
        );

        trace.push({
          source: 'AiOversightService',
          rule: `tool-risk-${oversight.tier}`,
          result: oversight.allowed
            ? oversight.requiresFormalApproval || oversight.requiresAdminApproval
              ? 'supervised'
              : oversight.requiresQuickConfirm
                ? 'supervised'
                : 'allow'
            : 'block',
          reason: oversight.reason,
          metadata: {
            tier: oversight.tier,
            requiresQuickConfirm: oversight.requiresQuickConfirm,
            requiresFormalApproval: oversight.requiresFormalApproval,
            requiresAdminApproval: oversight.requiresAdminApproval,
          },
        });

        if (!oversight.allowed) {
          allowed = false;
          reasons.push(oversight.reason);
        } else if (
          oversight.requiresAdminApproval ||
          oversight.requiresFormalApproval ||
          oversight.requiresQuickConfirm
        ) {
          requiresApproval = true;
          tier = 'supervised';
          reasons.push(oversight.reason);
        }
      } catch (err: any) {
        this.logger.warn(
          `[evaluate][${context.businessId}] AiOversight evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        trace.push({
          source: 'AiOversightService',
          rule: 'error-fallback',
          result: 'block',
          reason: 'Evaluation failed — defaulting to manual',
        });
        allowed = false;
        reasons.push('AI oversight evaluation failed');
      }
    }

    // 3. Genome cross-domain autonomy gate.
    if (allowed) {
      try {
        const gateInput = {
          businessId: context.businessId,
          actionType: context.actionKey,
          affectedDomains: context.affectedDomains as any,
          payload: context.parameters ?? {},
          proposedBy: context.proposedBy ?? null,
        };
        const gateResult = await this.genomeGate.checkGate(gateInput);

        const decision: GenomeAutonomyGateDecision = gateResult.decision;
        const gateRequiresApproval =
          decision === 'ALLOW_WITH_APPROVAL' || decision === 'NEEDS_MORE_EVIDENCE';

        trace.push({
          source: 'GenomeAutonomyGateService',
          rule: `genome-${decision}`,
          result: decision === 'BLOCK' ? 'block' : gateRequiresApproval ? 'supervised' : 'allow',
          reason:
            gateResult.blockingReasons.join('; ') ||
            gateResult.approvalReasons.join('; ') ||
            'Genome autonomy gate evaluated',
          metadata: {
            readinessScore: gateResult.readinessScore,
            riskLevel: gateResult.riskLevel,
            confidenceScore: gateResult.confidenceScore,
          },
        });

        if (decision === 'BLOCK') {
          allowed = false;
          reasons.push(
            gateResult.blockingReasons.join('; ') || 'Blocked by Genome autonomy gate',
          );
        } else if (gateRequiresApproval) {
          requiresApproval = true;
          tier = 'supervised';
          reasons.push(
            gateResult.approvalReasons.join('; ') ||
            'Genome autonomy gate requires approval',
          );
        }

        confidence = Math.min(confidence, (gateResult.confidenceScore ?? 100) / 100);
      } catch (err: any) {
        this.logger.warn(
          `[evaluate][${context.businessId}] Genome gate evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        trace.push({
          source: 'GenomeAutonomyGateService',
          rule: 'error-fallback',
          result: 'block',
          reason: 'Evaluation failed — defaulting to manual',
        });
        allowed = false;
        reasons.push('Genome autonomy gate evaluation failed');
      }
    }

    // 4. Per-module Genome readiness for known KEY executable actions.
    if (allowed) {
      const executableAction = this.toExecutableActionType(context.actionKey);
      if (executableAction) {
        try {
          const policyDecision = await this.genomePolicy.evaluateExecution(context.businessId, {
            actionType: executableAction,
          } as any);

          trace.push({
            source: 'KeyActionGenomePolicyService',
            rule: `module-readiness-${policyDecision.module ?? 'none'}`,
            result: policyDecision.allowed
              ? policyDecision.requiresExtraConfirmation
                ? 'supervised'
                : 'allow'
              : 'block',
            reason: policyDecision.message,
            metadata: {
              readinessScore: policyDecision.readinessScore,
              riskLevel: policyDecision.riskLevel,
              missingFacts: policyDecision.missingFacts.length,
            },
          });

          if (!policyDecision.allowed) {
            allowed = false;
            reasons.push(policyDecision.message);
          } else if (policyDecision.requiresExtraConfirmation) {
            requiresApproval = true;
            tier = 'supervised';
            reasons.push(policyDecision.message);
          }
        } catch (err: any) {
          this.logger.warn(
            `[evaluate][${context.businessId}] Genome policy evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          trace.push({
            source: 'KeyActionGenomePolicyService',
            rule: 'error-fallback',
            result: 'block',
            reason: 'Evaluation failed — defaulting to manual',
          });
          allowed = false;
          reasons.push('Genome policy evaluation failed');
        }
      }
    }

    // 5. Tool outcome score guard.
    // If a tool has a poor track record for this business, downgrade to supervised
    // or block automatically regardless of other gates.
    if (allowed) {
      try {
        const toolScore = await this.getToolOutcomeScore(context.businessId, context.actionKey);
        if (toolScore.totalUses >= 3) {
          trace.push({
            source: 'ToolOutcomeScore',
            rule: `tool-score-${context.actionKey}`,
            result: toolScore.successRate < 0.5 ? 'supervised' : 'allow',
            reason: `Tool ${context.actionKey} success rate is ${(toolScore.successRate * 100).toFixed(0)}% over ${toolScore.totalUses} uses`,
            metadata: { successRate: toolScore.successRate, totalUses: toolScore.totalUses },
          });

          if (toolScore.successRate < 0.3 && toolScore.totalUses >= 5) {
            allowed = false;
            reasons.push(`Tool ${context.actionKey} success rate is below 30% — blocked`);
          } else if (toolScore.successRate < 0.5) {
            requiresApproval = true;
            tier = 'supervised';
            reasons.push(`Tool ${context.actionKey} success rate is below 50% — requires approval`);
          }
        }
      } catch (err: any) {
        this.logger.warn(
          `[evaluate][${context.businessId}] Tool outcome score lookup failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 6. Constitution / Blueprint value guard.
    if (allowed) {
      try {
        const valueCheck = await this.constitutionValues.checkAction(
          context.businessId,
          context.actionKey,
          context.parameters,
        );

        trace.push({
          source: 'ConstitutionValuesService',
          rule: `value-conflict-${valueCheck.severity}`,
          result: valueCheck.severity === 'none' ? 'skip' : valueCheck.severity,
          reason: valueCheck.reason,
          metadata: { matchedTerms: valueCheck.matchedTerms },
        });

        if (valueCheck.severity === 'block') {
          allowed = false;
          reasons.push(valueCheck.reason);
        } else if (valueCheck.severity === 'supervised') {
          requiresApproval = true;
          tier = 'supervised';
          reasons.push(valueCheck.reason);
        }
      } catch (err: any) {
        this.logger.warn(
          `[evaluate][${context.businessId}] Value check failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 6. Authority grant check (informational — AiOversight already enforces for tier 4).
    try {
      const hasGrant = await this.authorityGrantRule.hasValidGrant(
        context.businessId,
        context.actionKey,
      );
      trace.push({
        source: 'AuthorityGrantRuleService',
        rule: 'l4-grant',
        result: hasGrant ? 'allow' : 'skip',
        reason: hasGrant ? 'Valid L4 authority grant present' : 'No L4 authority grant',
        metadata: { hasGrant },
      });
    } catch (err: any) {
      this.logger.warn(
        `[evaluate][${context.businessId}] Authority grant check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 7. Static action metadata (informational; does not override other gates).
    const executableAction = this.toExecutableActionType(context.actionKey);
    if (executableAction) {
      try {
        const staticPolicy = this.actionPolicy.getPolicy(executableAction);
        trace.push({
          source: 'KeyActionPolicyService',
          rule: `static-metadata-${executableAction}`,
          result: staticPolicy.executable
            ? staticPolicy.requiresApproval
              ? 'supervised'
              : 'allow'
            : 'skip',
          reason: `Static policy: executable=${staticPolicy.executable}, requiresApproval=${staticPolicy.requiresApproval}`,
          metadata: {
            riskLevel: staticPolicy.riskLevel,
          },
        });

        if (staticPolicy.requiresApproval && allowed) {
          requiresApproval = true;
          tier = 'supervised';
          reasons.push(`Action ${executableAction} requires approval by static policy`);
        }
      } catch {
        // Unknown executable action — ignore static metadata.
      }
    }

    if (!allowed) {
      tier = 'manual';
      requiresApproval = true;
    }

    const verdict: AutonomyVerdict = {
      allowed,
      requiresApproval,
      tier,
      confidence,
      reason: reasons.join(' | ') || (allowed ? 'All gates passed' : 'Blocked by autonomy gate'),
      ruleTrace: trace,
      createdAt: now,
      proposalId: context.proposalId,
    };

    // Persist verdict asynchronously; failures must not block the caller.
    this.persistVerdict(context, verdict).catch((err) =>
      this.logger.warn(
        `[evaluate][${context.businessId}] Failed to persist verdict: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );

    return verdict;
  }

  /**
   * Convenience overload for callers that only have an action key string.
   */
  async evaluateAction(
    businessId: string,
    actionKey: string,
    parameters?: Record<string, unknown>,
    opts?: { proposedBy?: string; affectedDomains?: string[]; role?: string; proposalId?: string },
  ): Promise<AutonomyVerdict> {
    const [module = 'unknown', action = actionKey] = actionKey.split('.');
    return this.evaluate({
      businessId,
      module,
      action,
      actionKey,
      parameters,
      proposedBy: opts?.proposedBy,
      affectedDomains: opts?.affectedDomains,
      role: opts?.role,
      proposalId: opts?.proposalId,
    });
  }

  private async persistVerdict(
    context: AutonomyActionContext,
    verdict: AutonomyVerdict,
  ): Promise<void> {
    await this.prisma.client.autonomyVerdict.create({
      data: {
        businessId: context.businessId,
        actionKey: context.actionKey,
        allowed: verdict.allowed,
        requiresApproval: verdict.requiresApproval,
        tier: verdict.tier,
        confidence: verdict.confidence,
        reason: verdict.reason,
        ruleTrace: verdict.ruleTrace as any,
        proposalId: context.proposalId ?? null,
        contextHash: this.hashContext(context),
      },
    });
  }

  private hashContext(context: AutonomyActionContext): string {
    try {
      const json = JSON.stringify({
        actionKey: context.actionKey,
        module: context.module,
        action: context.action,
        parameters: context.parameters,
        role: context.role,
        affectedDomains: context.affectedDomains,
        proposalId: context.proposalId,
      });
      let hash = 0;
      for (let i = 0; i < json.length; i++) {
        const char = json.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0;
      }
      return hash.toString(16);
    } catch {
      return '0';
    }
  }

  private async getToolOutcomeScore(
    businessId: string,
    actionKey: string,
  ): Promise<{ successRate: number; totalUses: number }> {
    const row = await this.prisma.client.toolOutcomeScore.findUnique({
      where: { businessId_toolName: { businessId, toolName: actionKey } },
    });
    if (!row) {
      return { successRate: 0, totalUses: 0 };
    }
    const totalUses = row.successCount + row.failureCount;
    return {
      successRate: totalUses > 0 ? row.successCount / totalUses : 0,
      totalUses,
    };
  }

  private toExecutableActionType(actionKey: string): KeyExecutableActionType | null {
    const parts = actionKey.split('.');
    const last = parts[parts.length - 1];
    const candidates: KeyExecutableActionType[] = [
      'OPEN_GENOME',
      'OPEN_TEMPORAL_FLOW',
      'OPEN_INTELLIGENCE',
      'REVIEW_EVOLUTION_PROPOSALS',
      'REVIEW_ASSETS',
      'OPEN_CONSTITUTION',
      'OPEN_KEY_INBOX',
      'CREATE_DOCUMENT',
      'REQUEST_APPROVAL',
      'CREATE_TASK',
      'GENERATE_DOCUMENT_EXPORT',
      'CREATE_GENOME_EVOLUTION_PROPOSAL',
      'GENERATE_CONSTITUTION_VERSION',
      'SCHEDULE_FOLLOWUP',
      'ESCALATE_THREAD',
    ];
    return (candidates.find((c) => c === last) as KeyExecutableActionType) ?? null;
  }
}
