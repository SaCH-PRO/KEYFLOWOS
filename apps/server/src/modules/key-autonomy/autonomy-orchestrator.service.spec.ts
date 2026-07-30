import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { AutonomyOrchestratorService } from './autonomy-orchestrator.service';
import { AiOversightService } from '../ai/ai-oversight.service';
import { GenomeAutonomyGateService } from '../business-genome/key-genome/genome-autonomy-gate.service';
import { KeyActionPolicyService } from './key-action-policy.service';
import { KeyActionGenomePolicyService } from './key-action-genome-policy.service';
import { AutonomyLevelService, UnifiedAutonomyLevel } from './autonomy-level.service';
import { ConstitutionValuesService } from './constitution-values.service';
import { AuthorityGrantRuleService } from './authority-grant-rule.service';
import { AutonomyRuleDbService } from './autonomy-rule-db.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { AutonomyActionContext, AutonomyVerdict } from './autonomy-orchestrator.types';
import type { GovernanceDecision } from '../ai/ai-oversight.service';
import type { GenomeAutonomyGateResult } from '../business-genome/key-genome/key-genome.types';
import type { GenomeActionPolicyDecision } from './key-action-genome-policy.service';

type RuleDecision = { ruleKey: string; decision: 'allow' | 'block' | 'supervised'; reason: string; priority: number; source: string };

function createMock<T>(overrides: Partial<T> = {}): T {
  return overrides as T;
}

function baseContext(overrides: Partial<AutonomyActionContext> = {}): AutonomyActionContext {
  return {
    businessId: 'biz_1',
    module: 'crm',
    action: 'create_contact',
    actionKey: 'crm.create_contact',
    ...overrides,
  };
}

function baseLevel(level = 3): UnifiedAutonomyLevel {
  return { level, mode: 'autopilot', maxAutoRiskTier: 3, label: 'Autopilot' };
}

function baseOversight(overrides: Partial<GovernanceDecision> = {}): GovernanceDecision {
  return {
    allowed: true,
    requiresQuickConfirm: false,
    requiresFormalApproval: false,
    requiresAdminApproval: false,
    tier: 'LOW',
    reason: 'OK',
    ...overrides,
  };
}

function baseGate(decision: GenomeAutonomyGateResult['decision'] = 'ALLOW'): GenomeAutonomyGateResult {
  return {
    businessId: 'biz_1',
    actionType: 'crm.create_contact',
    affectedDomains: [],
    decision,
    riskLevel: 'LOW',
    readinessScore: 80,
    confidenceScore: 85,
    blockingReasons: decision === 'BLOCK' ? ['Missing genome evidence'] : [],
    approvalReasons: decision === 'ALLOW_WITH_APPROVAL' ? ['Cross-domain risk'] : [],
    evidenceWarnings: [],
    recommendedNextStep: '',
    checkedAt: new Date().toISOString(),
  };
}

function basePolicy(overrides: Partial<GenomeActionPolicyDecision> = {}): GenomeActionPolicyDecision {
  return {
    allowed: true,
    requiresExtraConfirmation: false,
    module: null,
    readinessScore: null,
    riskLevel: null,
    automationAllowed: null,
    blockedReasons: [],
    missingFacts: [],
    recommendedSetupActions: [],
    message: 'No module gate applies',
    ...overrides,
  };
}

describe('AutonomyOrchestratorService', () => {
  let service: AutonomyOrchestratorService;
  let prisma: { client: { autonomyVerdict: { create: ReturnType<typeof vi.fn> }; toolOutcomeScore: { findUnique: ReturnType<typeof vi.fn> } } };
  let levelService: { resolve: ReturnType<typeof vi.fn> };
  let aiOversight: { evaluate: ReturnType<typeof vi.fn> };
  let genomeGate: { checkGate: ReturnType<typeof vi.fn> };
  let genomePolicy: { evaluateExecution: ReturnType<typeof vi.fn> };
  let constitutionValues: { checkAction: ReturnType<typeof vi.fn> };
  let authorityGrantRule: { hasValidGrant: ReturnType<typeof vi.fn> };
  let ruleDb: { findMatchingRules: ReturnType<typeof vi.fn> };
  let actionPolicy: { getPolicy: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    prisma = {
      client: {
        autonomyVerdict: { create: vi.fn().mockResolvedValue({ id: 'v1' }) },
        toolOutcomeScore: { findUnique: vi.fn().mockResolvedValue(null) },
      },
    };
    levelService = { resolve: vi.fn().mockResolvedValue(baseLevel()) };
    aiOversight = { evaluate: vi.fn().mockResolvedValue(baseOversight()) };
    genomeGate = { checkGate: vi.fn().mockResolvedValue(baseGate()) };
    genomePolicy = { evaluateExecution: vi.fn().mockResolvedValue(basePolicy()) };
    constitutionValues = { checkAction: vi.fn().mockResolvedValue({ conflict: false, severity: 'none', reason: '', matchedTerms: [] }) };
    authorityGrantRule = { hasValidGrant: vi.fn().mockResolvedValue(false) };
    ruleDb = { findMatchingRules: vi.fn().mockResolvedValue([]) };
    actionPolicy = { getPolicy: vi.fn().mockReturnValue({ executable: false, requiresApproval: false, riskLevel: 'LOW' }) };

    service = new AutonomyOrchestratorService(
      prisma as unknown as PrismaService,
      aiOversight as unknown as AiOversightService,
      genomeGate as unknown as GenomeAutonomyGateService,
      actionPolicy as unknown as KeyActionPolicyService,
      genomePolicy as unknown as KeyActionGenomePolicyService,
      levelService as unknown as AutonomyLevelService,
      constitutionValues as unknown as ConstitutionValuesService,
      authorityGrantRule as unknown as AuthorityGrantRuleService,
      ruleDb as unknown as AutonomyRuleDbService,
    );
  });

  async function evaluate(context: AutonomyActionContext): Promise<AutonomyVerdict> {
    const verdict = await service.evaluate(context);
    // Let the fire-and-forget persistence resolve.
    await new Promise((r) => setTimeout(r, 0));
    return verdict;
  }

  it('allows when all gates pass', async () => {
    const verdict = await evaluate(baseContext());
    expect(verdict.allowed).toBe(true);
    expect(verdict.requiresApproval).toBe(false);
    expect(verdict.tier).toBe('full');
    expect(verdict.reason).toBe('All gates passed');
  });

  it('blocks when canonical autonomy level is 0', async () => {
    levelService.resolve.mockResolvedValue(baseLevel(0));
    const verdict = await evaluate(baseContext());
    expect(verdict.allowed).toBe(false);
    expect(verdict.tier).toBe('manual');
    expect(verdict.reason).toContain('Autonomy level is advisory/manual');
  });

  it('requires approval when autonomy level is 2 or lower', async () => {
    levelService.resolve.mockResolvedValue(baseLevel(2));
    const verdict = await evaluate(baseContext());
    expect(verdict.allowed).toBe(true);
    expect(verdict.requiresApproval).toBe(true);
    expect(verdict.tier).toBe('supervised');
  });

  it('blocks when a DB rule blocks', async () => {
    ruleDb.findMatchingRules.mockResolvedValue([
      { ruleKey: 'block-sensitive', decision: 'block', reason: 'Blocked by operator', priority: 1, source: 'operator' },
    ]);
    const verdict = await evaluate(baseContext());
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('Blocked by operator');
  });

  it('promotes to supervised when a DB rule requires approval', async () => {
    ruleDb.findMatchingRules.mockResolvedValue([
      { ruleKey: 'supervise-invoices', decision: 'supervised', reason: 'High-value invoice', priority: 1, source: 'operator' },
    ]);
    const verdict = await evaluate(baseContext());
    expect(verdict.allowed).toBe(true);
    expect(verdict.requiresApproval).toBe(true);
    expect(verdict.tier).toBe('supervised');
  });

  it('blocks when AI oversight blocks', async () => {
    aiOversight.evaluate.mockResolvedValue(baseOversight({ allowed: false, reason: 'Blocked tool' }));
    const verdict = await evaluate(baseContext());
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('Blocked tool');
  });

  it('promotes to supervised when AI oversight requires approval', async () => {
    aiOversight.evaluate.mockResolvedValue(
      baseOversight({ requiresFormalApproval: true, reason: 'Formal approval required' }),
    );
    const verdict = await evaluate(baseContext());
    expect(verdict.allowed).toBe(true);
    expect(verdict.requiresApproval).toBe(true);
    expect(verdict.tier).toBe('supervised');
  });

  it('blocks when genome autonomy gate blocks', async () => {
    genomeGate.checkGate.mockResolvedValue(baseGate('BLOCK'));
    const verdict = await evaluate(baseContext());
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('Missing genome evidence');
  });

  it('promotes to supervised when genome gate requires approval', async () => {
    genomeGate.checkGate.mockResolvedValue(baseGate('ALLOW_WITH_APPROVAL'));
    const verdict = await evaluate(baseContext());
    expect(verdict.allowed).toBe(true);
    expect(verdict.requiresApproval).toBe(true);
    expect(verdict.tier).toBe('supervised');
  });

  it('blocks when genome module policy blocks', async () => {
    genomePolicy.evaluateExecution.mockResolvedValue(
      basePolicy({ allowed: false, message: 'Module not ready' }),
    );
    const verdict = await evaluate(baseContext({ actionKey: 'key.CREATE_TASK', action: 'CREATE_TASK', module: 'key' }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('Module not ready');
  });

  it('promotes to supervised when genome module policy requires extra confirmation', async () => {
    genomePolicy.evaluateExecution.mockResolvedValue(
      basePolicy({ allowed: true, requiresExtraConfirmation: true, message: 'Low readiness' }),
    );
    const verdict = await evaluate(baseContext({ actionKey: 'key.CREATE_TASK', action: 'CREATE_TASK', module: 'key' }));
    expect(verdict.allowed).toBe(true);
    expect(verdict.requiresApproval).toBe(true);
    expect(verdict.tier).toBe('supervised');
  });

  it('blocks when constitution values conflict is severe', async () => {
    constitutionValues.checkAction.mockResolvedValue({
      conflict: true,
      severity: 'block',
      reason: 'Violates blueprint value',
      matchedTerms: ['value'],
    });
    const verdict = await evaluate(baseContext());
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('Violates blueprint value');
  });

  it('includes trace entries from every contributing provider', async () => {
    const verdict = await evaluate(baseContext());
    const sources = verdict.ruleTrace.map((t) => t.source);
    expect(sources).toContain('AutonomyLevelService');
    expect(sources).toContain('AiOversightService');
    expect(sources).toContain('GenomeAutonomyGateService');
    expect(sources).toContain('AuthorityGrantRuleService');
  });

  it('persists the verdict', async () => {
    const context = baseContext();
    await evaluate(context);
    expect(prisma.client.autonomyVerdict.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: context.businessId,
          actionKey: context.actionKey,
          allowed: true,
          ruleTrace: expect.anything(),
        }),
      }),
    );
  });

  it('uses evaluateAction convenience overload', async () => {
    const verdict = await service.evaluateAction('biz_1', 'crm.create_contact');
    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toBe('All gates passed');
  });
});
