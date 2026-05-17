import { describe, expect, it, vi } from 'vitest';
import { KeyAuditorService } from './key-auditor.service';

function createMockPrisma() {
  const store = {
    contactTasks: new Map<string, any>(),
    evidence: new Map<string, any>(),
    approvalRequests: new Map<string, any>(),
    approvalSteps: new Map<string, any[]>(),
    contentRequests: new Map<string, any>(),
    contentDeliveryPackages: new Map<string, any[]>(),
  };

  return {
    client: {
      contactTask: {
        findUnique: vi.fn(async (args: any) => store.contactTasks.get(args.where.id) ?? null),
        findMany: vi.fn(async (args: any) =>
          Array.from(store.contactTasks.values()).filter(
            (t: any) =>
              t.businessId === args.where?.businessId &&
              t.evidenceRequired === args.where?.evidenceRequired &&
              t.status !== args.where?.status?.not,
          ),
        ),
      },
      contentDeliveryPackage: {
        findMany: vi.fn(async (args: any) =>
          Array.from(store.contentDeliveryPackages.values()).filter(
            (d: any) => d.contentRequestId === args.where?.contentRequestId,
          ),
        ),
      },
      evidence: {
        findMany: vi.fn(async (args: any) =>
          Array.from(store.evidence.values()).filter(
            (e: any) => e.linkedType === args.where?.linkedType && e.linkedId === args.where?.linkedId,
          ),
        ),
      },
      approvalRequest: {
        findUnique: vi.fn(async (args: any) => {
          const req = store.approvalRequests.get(args.where.id);
          if (!req) return null;
          return { ...req, steps: store.approvalSteps.get(args.where.id) ?? [] };
        }),
        findMany: vi.fn(async (args: any) =>
          Array.from(store.approvalRequests.values()).filter(
            (r: any) => r.businessId === args.where?.businessId && r.status === args.where?.status,
          ),
        ),
      },
      contentRequest: {
        findUnique: vi.fn(async (args: any) => {
          const req = store.contentRequests.get(args.where.id);
          if (!req) return null;
          return { ...req, deliveries: store.contentDeliveryPackages.get(args.where.id) ?? [] };
        }),
        findMany: vi.fn(async (args: any) =>
          Array.from(store.contentRequests.values()).filter(
            (r: any) => r.businessId === args.where?.businessId && r.status !== args.where?.status?.not,
          ),
        ),
      },
    },
    store,
  };
}

describe('KeyAuditorService', () => {
  it('passes evidence check when no evidence required', async () => {
    const prisma = createMockPrisma();
    prisma.store.contactTasks.set('t1', { id: 't1', evidenceRequired: false, status: 'OPEN', title: 'Task 1' });
    const svc = new KeyAuditorService(prisma as any);

    const result = await svc.checkEvidence('t1');
    expect(result.passed).toBe(true);
    expect(result.score).toBe(100);
  });

  it('fails evidence check when evidence required but missing', async () => {
    const prisma = createMockPrisma();
    prisma.store.contactTasks.set('t1', { id: 't1', evidenceRequired: true, status: 'OPEN', title: 'Task 1' });
    const svc = new KeyAuditorService(prisma as any);

    const result = await svc.checkEvidence('t1');
    expect(result.passed).toBe(false);
    expect(result.score).toBe(50);
    expect(result.issues[0].severity).toBe('critical');
  });

  it('warns on unverified evidence', async () => {
    const prisma = createMockPrisma();
    prisma.store.contactTasks.set('t1', { id: 't1', evidenceRequired: true, status: 'OPEN', title: 'Task 1' });
    prisma.store.evidence.set('e1', { id: 'e1', linkedType: 'ContactTask', linkedId: 't1', verifiedAt: null });
    const svc = new KeyAuditorService(prisma as any);

    const result = await svc.checkEvidence('t1');
    expect(result.passed).toBe(true);
    expect(result.score).toBe(80);
    expect(result.issues[0].severity).toBe('warning');
  });

  it('passes approval check for approved request', async () => {
    const prisma = createMockPrisma();
    prisma.store.approvalRequests.set('a1', { id: 'a1', status: 'approved', title: 'Test', createdAt: new Date() });
    prisma.store.approvalSteps.set('a1', []);
    const svc = new KeyAuditorService(prisma as any);

    const result = await svc.checkApproval('a1');
    expect(result.passed).toBe(true);
    expect(result.score).toBe(100);
  });

  it('fails approval check for rejected request', async () => {
    const prisma = createMockPrisma();
    prisma.store.approvalRequests.set('a1', { id: 'a1', status: 'rejected', title: 'Test', createdAt: new Date() });
    prisma.store.approvalSteps.set('a1', []);
    const svc = new KeyAuditorService(prisma as any);

    const result = await svc.checkApproval('a1');
    expect(result.passed).toBe(false);
    expect(result.score).toBe(60);
  });

  it('flags missing delivery for approved content', async () => {
    const prisma = createMockPrisma();
    prisma.store.contentRequests.set('cr1', { id: 'cr1', status: 'approved', businessGoal: 'G1' });
    prisma.store.contentDeliveryPackages.set('cr1', []);
    const svc = new KeyAuditorService(prisma as any);

    const result = await svc.checkDriveDelivery('cr1');
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.message.includes('no delivery package'))).toBe(true);
  });

  it('runs full audit across modules', async () => {
    const prisma = createMockPrisma();
    prisma.store.approvalRequests.set('a1', { id: 'a1', status: 'pending', title: 'Test', businessId: 'biz_1', createdAt: new Date() });
    prisma.store.approvalSteps.set('a1', [{ status: 'pending', createdAt: new Date() }]);
    prisma.store.contentRequests.set('cr1', { id: 'cr1', status: 'approved', businessGoal: 'G1', businessId: 'biz_1' });
    prisma.store.contentDeliveryPackages.set('cr1', []);
    prisma.store.contactTasks.set('t1', { id: 't1', evidenceRequired: true, status: 'OPEN', title: 'Task', businessId: 'biz_1' });

    const svc = new KeyAuditorService(prisma as any);
    const results = await svc.runFullAudit('biz_1');

    expect(Object.keys(results).length).toBeGreaterThan(0);
  });
});
