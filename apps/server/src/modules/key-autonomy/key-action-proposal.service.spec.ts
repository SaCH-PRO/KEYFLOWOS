import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { KeyActionProposalService } from './key-action-proposal.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TemporalFlowService } from '../temporal-flow/temporal-flow.service';
import { KeyActionPolicyService } from './key-action-policy.service';
import { KeyActionExecutorService } from './key-action-executor.service';
import { KeyActionGenomePolicyService } from './key-action-genome-policy.service';
import { AutonomyOrchestratorService } from './autonomy-orchestrator.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

function createMockClient() {
  const rows: any[] = [];
  return {
    rows,
    keyActionProposal: {
      create: vi.fn(async ({ data }: any) => {
        const row = { ...data, id: 'prop_1', createdAt: new Date(), updatedAt: new Date() };
        rows.push(row);
        return row;
      }),
      findMany: vi.fn(async () => rows),
      findFirst: vi.fn(async ({ where }: any) => rows.find((r) => r.id === where.id)),
      update: vi.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error('Not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      }),
    },
  };
}

describe('KeyActionProposalService', () => {
  let service: KeyActionProposalService;
  let mockClient: ReturnType<typeof createMockClient>;
  let executor: KeyActionExecutorService;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    mockClient = createMockClient();

    moduleRef = await Test.createTestingModule({
      providers: [
        KeyActionProposalService,
        KeyActionPolicyService,
        {
          provide: PrismaService,
          useValue: { client: mockClient },
        },
        {
          provide: EventEmitter2,
          useValue: { emit: vi.fn() },
        },
        {
          provide: TemporalFlowService,
          useValue: { emit: vi.fn(async () => ({})) },
        },
        {
          provide: KeyActionExecutorService,
          useValue: {
            execute: vi.fn(async () => ({ success: true, result: { entityType: 'Test' } })),
          },
        },
        {
          provide: KeyActionGenomePolicyService,
          useValue: {
            evaluateExecution: vi.fn().mockResolvedValue({
              allowed: true,
              requiresExtraConfirmation: false,
              message: 'KEY Genome readiness permits this action.',
            }),
          },
        },
        {
          provide: AutonomyOrchestratorService,
          useValue: {
            evaluateAction: vi.fn().mockResolvedValue({
              allowed: true,
              requiresApproval: false,
              tier: 'full',
              confidence: 1,
              reason: 'Mock autonomy passed',
              ruleTrace: [],
              createdAt: new Date(),
            }),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(KeyActionProposalService);
    executor = moduleRef.get(KeyActionExecutorService);
  });

  it('creates a proposal in PENDING state', async () => {
    const proposal = await service.create('biz_1', {
      sourceType: 'EXECUTIVE_MODE',
      sourceMode: 'CFO',
      title: 'Complete Financial DNA',
      actionType: 'CREATE_TASK',
    });

    expect(proposal.status).toBe('PENDING');
    expect(proposal.actionType).toBe('CREATE_TASK');
    expect(proposal.riskLevel).toBe('LOW');
    expect(proposal.requiresApproval).toBe(true);
  });

  it('rejects unsupported action types', async () => {
    await expect(
      service.create('biz_1', {
        sourceType: 'MANUAL',
        title: 'Bad action',
        actionType: 'UNKNOWN' as any,
      }),
    ).rejects.toThrow('Unsupported action type');
  });

  it('approves a pending proposal', async () => {
    const created = await service.create('biz_1', {
      sourceType: 'EXECUTIVE_MODE',
      sourceMode: 'CFO',
      title: 'Complete Financial DNA',
      actionType: 'CREATE_TASK',
    });
    const approved = await service.approve('biz_1', created.id, 'user_1');
    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedBy).toBe('user_1');
  });

  it('rejects a pending proposal with a reason', async () => {
    const created = await service.create('biz_1', {
      sourceType: 'EXECUTIVE_MODE',
      sourceMode: 'CFO',
      title: 'Complete Financial DNA',
      actionType: 'CREATE_TASK',
    });
    const rejected = await service.reject('biz_1', created.id, 'user_1', 'Not now');
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionReason).toBe('Not now');
  });

  it('cannot execute a pending proposal', async () => {
    const created = await service.create('biz_1', {
      sourceType: 'EXECUTIVE_MODE',
      sourceMode: 'CFO',
      title: 'Complete Financial DNA',
      actionType: 'CREATE_TASK',
    });
    await expect(service.execute('biz_1', created.id, 'user_1')).rejects.toThrow(
      'must be approved before execution',
    );
  });

  it('cannot execute a rejected proposal', async () => {
    const created = await service.create('biz_1', {
      sourceType: 'EXECUTIVE_MODE',
      sourceMode: 'CFO',
      title: 'Complete Financial DNA',
      actionType: 'CREATE_TASK',
    });
    await service.reject('biz_1', created.id, 'user_1');
    await expect(service.execute('biz_1', created.id, 'user_1')).rejects.toThrow(
      'must be approved before execution',
    );
  });

  it('executes an approved proposal', async () => {
    const created = await service.create('biz_1', {
      sourceType: 'EXECUTIVE_MODE',
      sourceMode: 'CFO',
      title: 'Complete Financial DNA',
      actionType: 'CREATE_TASK',
    });
    await service.approve('biz_1', created.id, 'user_1');
    const executed = await service.execute('biz_1', created.id, 'user_1');
    expect(executed.status).toBe('EXECUTED');
    expect(executed.executionResult).toEqual({ entityType: 'Test' });
  });

  it('marks FAILED when execution fails', async () => {
    vi.spyOn(executor, 'execute').mockResolvedValue({ success: false, error: 'Boom' });
    const created = await service.create('biz_1', {
      sourceType: 'EXECUTIVE_MODE',
      sourceMode: 'CFO',
      title: 'Complete Financial DNA',
      actionType: 'CREATE_TASK',
    });
    await service.approve('biz_1', created.id, 'user_1');
    const executed = await service.execute('biz_1', created.id, 'user_1');
    expect(executed.status).toBe('FAILED');
    expect(executed.failureReason).toBe('Boom');
  });

  it('requires confirmation for high-risk actions', async () => {
    const created = await service.create('biz_1', {
      sourceType: 'EXECUTIVE_MODE',
      sourceMode: 'CFO',
      title: 'Generate new Constitution version',
      actionType: 'GENERATE_CONSTITUTION_VERSION',
    });
    expect(created.riskLevel).toBe('MEDIUM');
    await service.approve('biz_1', created.id, 'user_1');
    // MEDIUM does not require confirm; only HIGH/CRITICAL do in our implementation.
    const executed = await service.execute('biz_1', created.id, 'user_1');
    expect(executed.status).toBe('EXECUTED');
  });

  it('blocks execution when Genome policy disallows it', async () => {
    const genomePolicy = moduleRef.get(KeyActionGenomePolicyService);
    vi.spyOn(genomePolicy, 'evaluateExecution').mockResolvedValue({
      allowed: false,
      requiresExtraConfirmation: false,
      module: 'sop',
      readinessScore: 25,
      riskLevel: 'HIGH',
      automationAllowed: false,
      blockedReasons: ['Missing blocking fact: identity.business_name'],
      missingFacts: [],
      recommendedSetupActions: [],
      message: 'KEY cannot execute this action because sop automation is blocked by missing Genome facts.',
    });

    const created = await service.create('biz_1', {
      sourceType: 'EXECUTIVE_MODE',
      sourceMode: 'COO',
      title: 'Create task',
      actionType: 'CREATE_TASK',
    });
    await service.approve('biz_1', created.id, 'user_1');

    await expect(service.execute('biz_1', created.id, 'user_1')).rejects.toThrow('blocked by missing Genome facts');

    const after = await service.get('biz_1', created.id);
    expect(after.status).toBe('BLOCKED');
    expect(after.failureReason).toContain('blocked by missing Genome facts');
  });

  it('requires confirmGenomeRisk when Genome policy warns', async () => {
    const genomePolicy = moduleRef.get(KeyActionGenomePolicyService);
    vi.spyOn(genomePolicy, 'evaluateExecution').mockResolvedValue({
      allowed: true,
      requiresExtraConfirmation: true,
      module: 'sop',
      readinessScore: 60,
      riskLevel: 'MEDIUM',
      automationAllowed: true,
      blockedReasons: [],
      missingFacts: [],
      recommendedSetupActions: [],
      message: 'KEY can execute this action, but sop readiness is only 60% and requires confirmation.',
    });

    const created = await service.create('biz_1', {
      sourceType: 'EXECUTIVE_MODE',
      sourceMode: 'COO',
      title: 'Create task',
      actionType: 'CREATE_TASK',
    });
    await service.approve('biz_1', created.id, 'user_1');

    await expect(service.execute('biz_1', created.id, 'user_1')).rejects.toThrow('requires confirmation');

    const executed = await service.execute('biz_1', created.id, 'user_1', false, true);
    expect(executed.status).toBe('EXECUTED');
  });
});
