import { describe, expect, it, vi } from 'vitest';
import { EvidenceService } from './evidence.service';

function createMockPrisma() {
  const store = {
    evidences: new Map<string, any>(),
    contactTasks: new Map<string, any>(),
    projectTasks: new Map<string, any>(),
  };

  return {
    client: {
      evidence: {
        create: vi.fn(async (args: any) => {
          const id = `ev_${Math.random().toString(36).slice(2)}`;
          const record = { id, ...args.data, submittedAt: new Date() };
          store.evidences.set(id, record);
          return record;
        }),
        findUnique: vi.fn(async (args: any) => store.evidences.get(args.where.id) ?? null),
        findFirst: vi.fn(async (args: any) => {
          for (const item of store.evidences.values()) {
            if (args.where?.id && item.id === args.where.id) return item;
          }
          return null;
        }),
        findMany: vi.fn(async (args: any) => {
          const items = Array.from(store.evidences.values());
          const filtered = items.filter((e) => {
            if (args.where?.linkedType && e.linkedType !== args.where.linkedType) return false;
            if (args.where?.linkedId && e.linkedId !== args.where.linkedId) return false;
            if (args.where?.businessId && e.businessId !== args.where.businessId) return false;
            if (args.where?.evidenceType && e.evidenceType !== args.where.evidenceType) return false;
            if (args.where?.deletedAt === null && e.deletedAt) return false;
            return true;
          });
          return filtered.sort((a, b) => b.submittedAt - a.submittedAt);
        }),
        update: vi.fn(async (args: any) => {
          const existing = store.evidences.get(args.where.id);
          if (!existing) return null;
          const updated = { ...existing, ...args.data };
          store.evidences.set(args.where.id, updated);
          return updated;
        }),
        delete: vi.fn(async (args: any) => {
          store.evidences.delete(args.where.id);
          return { id: args.where.id };
        }),
        count: vi.fn(async () => store.evidences.size),
      },
      contactTask: {
        findUnique: vi.fn(async (args: any) => store.contactTasks.get(args.where.id) ?? null),
      },
      projectTask: {
        findUnique: vi.fn(async (args: any) => store.projectTasks.get(args.where.id) ?? null),
      },
    },
    store,
  };
}

function createMockEventService() {
  return {
    emit: vi.fn(async () => ({ id: 'evt_1' })),
  };
}

function createMockEmitter() {
  return {
    emit: vi.fn(),
  };
}

describe('EvidenceService', () => {
  it('submits evidence and returns the record', async () => {
    const prisma = createMockPrisma();
    const events = createMockEventService();
    const emitter = createMockEmitter();
    const svc = new EvidenceService(prisma as any, events as any, emitter as any);

    const result = await svc.submit({
      businessId: 'biz_1',
      evidenceType: 'photo',
      url: 'https://example.com/img.jpg',
      storageKey: 's3://bucket/img.jpg',
      submittedBy: 'user_1',
      linkedType: 'ContactTask',
      linkedId: 'task_1',
    });

    expect(result.id).toBeDefined();
    expect(result.evidenceType).toBe('photo');
    expect(result.url).toBe('https://example.com/img.jpg');
    expect(events.emit).toHaveBeenCalled();
    expect(emitter.emit).toHaveBeenCalledWith('evidence.submitted', expect.any(Object));
  });

  it('verifies evidence and sets verifiedAt', async () => {
    const prisma = createMockPrisma();
    const events = createMockEventService();
    const emitter = createMockEmitter();
    const svc = new EvidenceService(prisma as any, events as any, emitter as any);

    const submitted = await svc.submit({
      businessId: 'biz_1',
      evidenceType: 'file',
      url: 'https://example.com/doc.pdf',
      storageKey: 's3://bucket/doc.pdf',
      submittedBy: 'user_1',
      linkedType: 'ProjectTask',
      linkedId: 'task_2',
    });

    const verified = await svc.verify({ evidenceId: submitted.id, verifierId: 'admin_1' });
    expect(verified.verifiedBy).toBe('admin_1');
    expect(verified.verifiedAt).toBeInstanceOf(Date);
    expect(emitter.emit).toHaveBeenCalledWith('evidence.verified', expect.any(Object));
  });

  it('throws NotFoundException when verifying nonexistent evidence', async () => {
    const prisma = createMockPrisma();
    const events = createMockEventService();
    const emitter = createMockEmitter();
    const svc = new EvidenceService(prisma as any, events as any, emitter as any);

    await expect(svc.verify({ evidenceId: 'missing', verifierId: 'admin' })).rejects.toThrow('Evidence not found');
  });

  it('lists evidence for a business with filters', async () => {
    const prisma = createMockPrisma();
    const events = createMockEventService();
    const emitter = createMockEmitter();
    const svc = new EvidenceService(prisma as any, events as any, emitter as any);

    await svc.submit({ businessId: 'biz_1', evidenceType: 'photo', url: 'u1', storageKey: 'k1', submittedBy: 'u1', linkedType: 'X', linkedId: '1' });
    await svc.submit({ businessId: 'biz_1', evidenceType: 'file', url: 'u2', storageKey: 'k2', submittedBy: 'u1', linkedType: 'X', linkedId: '2' });
    await svc.submit({ businessId: 'biz_2', evidenceType: 'photo', url: 'u3', storageKey: 'k3', submittedBy: 'u1', linkedType: 'X', linkedId: '3' });

    const list = await svc.listForBusiness('biz_1', { evidenceType: 'photo' });
    expect(list.items.length).toBeGreaterThanOrEqual(1);
    expect(list.total).toBeGreaterThanOrEqual(1);
  });

  it('checks task evidence requirement correctly', async () => {
    const prisma = createMockPrisma();
    prisma.store.contactTasks.set('task_a', { id: 'task_a', evidenceRequired: true });
    const events = createMockEventService();
    const emitter = createMockEmitter();
    const svc = new EvidenceService(prisma as any, events as any, emitter as any);

    const check = await svc.checkTaskEvidence('ContactTask', 'task_a');
    expect(check.required).toBe(true);
    expect(check.hasEvidence).toBe(false);
    expect(check.evidenceCount).toBe(0);
  });
});
