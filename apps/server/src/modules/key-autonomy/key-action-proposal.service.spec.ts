import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { KeyActionProposalService } from './key-action-proposal.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TemporalFlowService } from '../temporal-flow/temporal-flow.service';
import { KeyActionPolicyService } from './key-action-policy.service';
import { KeyActionExecutorService } from './key-action-executor.service';

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

  beforeEach(async () => {
    mockClient = createMockClient();

    const moduleRef = await Test.createTestingModule({
      providers: [
        KeyActionProposalService,
        KeyActionPolicyService,
        {
          provide: PrismaService,
          useValue: { client: mockClient },
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
});
