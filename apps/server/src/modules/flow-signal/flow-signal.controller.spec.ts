import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { FlowSignalController } from './flow-signal.controller';
import { FlowSignalService } from './flow-signal.service';
import { RoleFlowService } from './role-flow.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard } from '../../core/auth/module-scope.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { FlowRouterService } from './flow-router.service';
import { FlowType } from '@prisma/client';

/**
 * SWP-CENSUS-HIDDEN review repair (COR-HID-1): a signal's status changes need write on the signal's own module,
 * checked in the handler (revenue for a money signal, automations for any other); the real-DB proof through the
 * HTTP routes is census-hidden.integration.test.ts CH-FS-*. Here: the handler reads the signal in this business
 * first and refuses before the service is called.
 */
const signals: Record<string, { flows: FlowType[]; type: string; module: string | null; entityType: string | null }> = {
  sig_1: { flows: [FlowType.FINANCIAL, FlowType.TEMPORAL, FlowType.PEOPLE], type: 'invoice.overdue', module: null, entityType: 'Invoice' },
  sig_lead: { flows: [FlowType.PEOPLE], type: 'lead.created', module: 'crm', entityType: 'Contact' },
};
const scopesOf: Record<string, Record<string, string>> = {
  u_bookkeeper: { revenue: 'write', expenses: 'write' },
  u_auto: { automations: 'write', revenue: 'read' },
};
const prismaMock = {
  client: {
    flowSignal: {
      findFirst: vi.fn(async ({ where }: any) => (where.businessId === 'biz_1' && signals[where.id] ? signals[where.id] : null)),
    },
    membership: {
      findUnique: vi.fn(async ({ where }: any) => {
        const scopes = scopesOf[where.userId_businessId.userId];
        return scopes ? { role: 'STAFF', permissionScopes: scopes } : null;
      }),
    },
  },
};
const as = (id: string) => ({ user: { id, role: 'USER' } });

describe('FlowSignalController', () => {
  let controller: FlowSignalController;
  let flowSignalService: FlowSignalService;
  let roleFlowService: RoleFlowService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [FlowSignalController],
      providers: [
        {
          provide: FlowSignalService,
          useValue: {
            list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
            markResolved: vi.fn().mockResolvedValue({ id: 'sig_1', status: 'RESOLVED' }),
            markActionRequired: vi.fn().mockResolvedValue({ id: 'sig_1', status: 'ACTION_REQUIRED' }),
            snooze: vi.fn().mockResolvedValue({ id: 'sig_1', status: 'SNOOZED' }),
          },
        },
        { provide: PrismaService, useValue: prismaMock },
        { provide: FlowRouterService, useValue: new FlowRouterService() },
        {
          provide: RoleFlowService,
          useValue: {
            getRoleQueue: vi.fn().mockResolvedValue({
              roleKey: 'ACCOUNTS_RECEIVABLE_CLERK',
              flowTypes: [FlowType.FINANCIAL],
              total: 1,
              items: [{ id: 'sig_1', type: 'invoice.overdue' }],
              summary: { critical: 0, high: 1, actionRequired: 0 },
            }),
          },
        },
      ],
    })
      .overrideGuard(AuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(BusinessGuard).useValue({ canActivate: () => true })
      // These cases call the controller's methods directly, so no guard runs, as for the two above.
      .overrideGuard(ModuleScopeGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get(FlowSignalController);
    flowSignalService = module.get(FlowSignalService);
    roleFlowService = module.get(RoleFlowService);
  });

  it('lists signals with filters', async () => {
    const result = await controller.list('biz_1', FlowType.FINANCIAL, 'invoice.overdue');

    expect(flowSignalService.list).toHaveBeenCalledWith(
      'biz_1',
      expect.objectContaining({ flows: FlowType.FINANCIAL, type: 'invoice.overdue' }),
    );
    expect(result).toEqual({ items: [], total: 0 });
  });

  it('returns role queue', async () => {
    const result = await controller.getRoleQueue('biz_1', 'ACCOUNTS_RECEIVABLE_CLERK');

    expect(roleFlowService.getRoleQueue).toHaveBeenCalledWith('biz_1', 'ACCOUNTS_RECEIVABLE_CLERK');
    expect(result.roleKey).toBe('ACCOUNTS_RECEIVABLE_CLERK');
  });

  it('resolves a signal', async () => {
    const result = await (controller.resolve as any)('biz_1', 'sig_1', as('u_bookkeeper'));

    expect(flowSignalService.markResolved).toHaveBeenCalledWith('biz_1', 'sig_1');
    expect(result.status).toBe('RESOLVED');
  });

  it('RED-BEFORE (COR-HID-1): a money signal needs revenue write, checked before the service is called; any other signal needs automations write', async () => {
    await expect((controller.resolve as any)('biz_1', 'sig_1', as('u_auto'))).rejects.toThrow(/revenue requires write access \(you have read\)/);
    await expect((controller.snooze as any)('biz_1', 'sig_1', '2026-12-01T00:00:00.000Z', as('u_auto'))).rejects.toThrow(/revenue requires write access/);
    await expect((controller.actionRequired as any)('biz_1', 'sig_lead', as('u_bookkeeper'))).rejects.toThrow(/automations requires write access \(you have none\)/);
    expect(flowSignalService.markResolved).not.toHaveBeenCalled();
    expect(flowSignalService.snooze).not.toHaveBeenCalled();
    expect(flowSignalService.markActionRequired).not.toHaveBeenCalled();
    await (controller.actionRequired as any)('biz_1', 'sig_lead', as('u_auto'));
    expect(flowSignalService.markActionRequired).toHaveBeenCalledWith('biz_1', 'sig_lead');
  });

  it('RED-BEFORE (COR-HID-1): a signal that is not this business\'s is 404 and the service is not called', async () => {
    await expect((controller.resolve as any)('biz_1', 'sig_other', as('u_bookkeeper'))).rejects.toThrow(/not found/i);
    expect(flowSignalService.markResolved).not.toHaveBeenCalled();
  });
});
