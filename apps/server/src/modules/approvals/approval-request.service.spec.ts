import { describe, expect, it, vi } from 'vitest';
import { ApprovalRequestService } from './approval-request.service';

function createMockPrisma() {
  const store = {
    approvalRequests: new Map<string, any>(),
    approvalSteps: new Map<string, any>(),
  };
  let reqId = 0;
  let stepId = 0;

  return {
    client: {
      approvalRequest: {
        create: vi.fn(async (args: any) => {
          const id = `ar_${++reqId}`;
          const steps = args.data.steps?.create?.map((s: any, i: number) => ({
            id: `as_${++stepId}`,
            approvalRequestId: id,
            ...s,
            status: s.status ?? 'pending',
          })) ?? [];
          steps.forEach((s: any) => store.approvalSteps.set(s.id, s));
          const record = { id, ...args.data, createdAt: new Date(), steps };
          store.approvalRequests.set(id, record);
          return record;
        }),
        findUnique: vi.fn(async (args: any) => {
          const req = store.approvalRequests.get(args.where.id);
          if (!req) return null;
          const steps = Array.from(store.approvalSteps.values())
            .filter((s: any) => s.approvalRequestId === req.id)
            .sort((a: any, b: any) => a.stepOrder - b.stepOrder);
          return { ...req, steps };
        }),
        findFirst: vi.fn(async (args: any) => {
          for (const req of store.approvalRequests.values()) {
            if (args.where?.id && req.id !== args.where.id) continue;
            const steps = Array.from(store.approvalSteps.values())
              .filter((s: any) => s.approvalRequestId === req.id)
              .sort((a: any, b: any) => a.stepOrder - b.stepOrder);
            return { ...req, steps };
          }
          return null;
        }),
        findMany: vi.fn(async (args: any) => {
          const items = Array.from(store.approvalRequests.values()).filter((req: any) => {
            if (args.where?.businessId && req.businessId !== args.where.businessId) return false;
            if (args.where?.status && req.status !== args.where.status) return false;
            if (args.where?.requestType && req.requestType !== args.where.requestType) return false;
            return true;
          });
          return items.sort((a: any, b: any) => b.createdAt - a.createdAt);
        }),
        update: vi.fn(async (args: any) => {
          const existing = store.approvalRequests.get(args.where.id);
          if (!existing) return null;
          const updated = { ...existing, ...args.data };
          store.approvalRequests.set(args.where.id, updated);
          const steps = Array.from(store.approvalSteps.values())
            .filter((s: any) => s.approvalRequestId === updated.id)
            .sort((a: any, b: any) => a.stepOrder - b.stepOrder);
          return { ...updated, steps };
        }),
        count: vi.fn(async () => store.approvalRequests.size),
      },
      approvalStep: {
        update: vi.fn(async (args: any) => {
          const existing = store.approvalSteps.get(args.where.id);
          if (!existing) return null;
          const updated = { ...existing, ...args.data };
          store.approvalSteps.set(args.where.id, updated);
          return updated;
        }),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      $transaction: vi.fn(async (fn: any) => {
        const tx = {
          approvalStep: {
            update: async (args: any) => {
              const existing = store.approvalSteps.get(args.where.id);
              if (!existing) return null;
              const updated = { ...existing, ...args.data };
              store.approvalSteps.set(args.where.id, updated);
              return updated;
            },
          },
          approvalRequest: {
            update: async (args: any) => {
              const existing = store.approvalRequests.get(args.where.id);
              if (!existing) return null;
              const updated = { ...existing, ...args.data };
              store.approvalRequests.set(args.where.id, updated);
              return updated;
            },
          },
        };
        return fn(tx);
      }),
    },
    store,
  };
}

function createMockEmitter() {
  return { emit: vi.fn() };
}

describe('ApprovalRequestService', () => {
  it('creates a request with steps', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new ApprovalRequestService(prisma as any, emitter as any);

    const result = await svc.createRequest({
      businessId: 'biz_1',
      requesterId: 'user_1',
      requestType: 'expense',
      title: 'Office supplies',
      steps: [{ stepOrder: 0, approverId: 'manager_1' }],
    });

    expect(result.id).toBeDefined();
    expect(result.status).toBe('pending');
    expect(result.steps).toHaveLength(1);
    expect(emitter.emit).toHaveBeenCalledWith('approval.created', expect.any(Object));
  });

  it('auto-approves when under threshold', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new ApprovalRequestService(prisma as any, emitter as any);

    const result = await svc.createRequest({
      businessId: 'biz_1',
      requesterId: 'user_1',
      requestType: 'expense',
      title: 'Coffee',
      threshold: 50,
      payload: { amount: 25 },
      steps: [{ stepOrder: 0, approverId: 'manager_1' }],
    });

    expect(result.status).toBe('approved');
    expect(emitter.emit).toHaveBeenCalledWith('approval.auto_approved', expect.any(Object));
  });

  it('approves a step and advances to next', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new ApprovalRequestService(prisma as any, emitter as any);

    const created = await svc.createRequest({
      businessId: 'biz_1',
      requesterId: 'user_1',
      requestType: 'expense',
      title: 'Laptop',
      steps: [
        { stepOrder: 0, approverId: 'manager_1' },
        { stepOrder: 1, approverId: 'cfo_1' },
      ],
    });

    const result = await svc.decideStep({
      approvalRequestId: created.id,
      approverId: 'manager_1',
      decision: 'approve',
    });

    expect(result!.status).toBe('pending');
    expect(result!.currentStep).toBe(1);
  });

  it('rejects a step and resolves request', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new ApprovalRequestService(prisma as any, emitter as any);

    const created = await svc.createRequest({
      businessId: 'biz_1',
      requesterId: 'user_1',
      requestType: 'expense',
      title: 'Laptop',
      steps: [{ stepOrder: 0, approverId: 'manager_1' }],
    });

    const result = await svc.decideStep({
      approvalRequestId: created.id,
      approverId: 'manager_1',
      decision: 'reject',
      comment: 'Too expensive',
    });

    expect(result!.status).toBe('rejected');
    expect(result!.resolution).toBe('rejected');
  });

  it('cancels a pending request', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new ApprovalRequestService(prisma as any, emitter as any);

    const created = await svc.createRequest({
      businessId: 'biz_1',
      requesterId: 'user_1',
      requestType: 'expense',
      title: 'Laptop',
      steps: [{ stepOrder: 0, approverId: 'manager_1' }],
    });

    const result = await svc.cancelRequest(created.id, 'user_1');
    expect(result.status).toBe('cancelled');
  });

  it('escalates a pending request', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new ApprovalRequestService(prisma as any, emitter as any);

    const created = await svc.createRequest({
      businessId: 'biz_1',
      requesterId: 'user_1',
      requestType: 'expense',
      title: 'Laptop',
      steps: [{ stepOrder: 0, approverId: 'manager_1' }],
    });

    const result = await svc.escalateRequest(created.id, 'No response');
    expect(result.status).toBe('escalated');
    expect(emitter.emit).toHaveBeenCalledWith('approval.escalated', expect.any(Object));
  });

  it('throws when non-requester tries to cancel', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new ApprovalRequestService(prisma as any, emitter as any);

    const created = await svc.createRequest({
      businessId: 'biz_1',
      requesterId: 'user_1',
      requestType: 'expense',
      title: 'Laptop',
      steps: [{ stepOrder: 0, approverId: 'manager_1' }],
    });

    await expect(svc.cancelRequest(created.id, 'hacker')).rejects.toThrow('Only the requester can cancel');
  });
});
