import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ActivityLogService } from './activity.service';

function makePrisma() {
  const logs: any[] = [];
  const createId = () => `log_${Math.random().toString(36).slice(2)}`;

  return {
    logs,
    client: {
      activityLog: {
        create: vi.fn(async ({ data }: any) => {
          const record = { id: createId(), ...data };
          logs.push(record);
          return record;
        }),
        createMany: vi.fn(async ({ data }: any) => {
          const created = data.map((d: any) => ({ id: createId(), ...d }));
          logs.push(...created);
          return { count: created.length };
        }),
        findMany: vi.fn(async ({ where, take, orderBy }: any) => {
          let result = [...logs];
          if (where?.businessId) result = result.filter((r) => r.businessId === where.businessId);
          if (where?.type) result = result.filter((r) => r.type === where.type);
          if (where?.createdAt?.gte) result = result.filter((r) => new Date(r.createdAt) >= new Date(where.createdAt.gte));
          if (where?.createdAt?.lte) result = result.filter((r) => new Date(r.createdAt) <= new Date(where.createdAt.lte));
          if (orderBy?.createdAt === 'desc') result.reverse();
          return take ? result.slice(0, take) : result;
        }),
        count: vi.fn(async ({ where }: any) => {
          let result = [...logs];
          if (where?.businessId) result = result.filter((r) => r.businessId === where.businessId);
          if (where?.createdAt?.gte) result = result.filter((r) => new Date(r.createdAt) >= new Date(where.createdAt.gte));
          return result.length;
        }),
        deleteMany: vi.fn(async ({ where }: any) => {
          const before = logs.length;
          let result = [...logs];
          if (where?.businessId) result = result.filter((r) => r.businessId === where.businessId);
          if (where?.type) result = result.filter((r) => r.type === where.type);
          if (where?.createdAt?.lt) result = result.filter((r) => new Date(r.createdAt) >= new Date(where.createdAt.lt));
          const removed = before - result.length;
          logs.length = 0;
          logs.push(...result);
          return { count: removed };
        }),
      },
    },
  };
}

describe('ActivityLogService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: ActivityLogService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new ActivityLogService(prisma as any);
  });

  it('logs a connector activity entry', async () => {
    const entry = await service.log({
      businessId: 'biz_1',
      entityType: 'contact',
      entityId: 'c_1',
      action: 'viewed',
      description: 'Contact viewed',
      source: 'key_cortex',
    });
    expect(entry.type).toBe('contact');
    expect(entry.metadata).toMatchObject({ entityId: 'c_1', action: 'viewed', source: 'key_cortex' });
  });

  it('logs bulk events', async () => {
    const result = await service.logBulk({
      businessId: 'biz_1',
      events: [
        { entityType: 'invoice', action: 'paid', description: 'Paid' },
        { entityType: 'task', action: 'completed', description: 'Done' },
      ],
    });
    expect(result.created).toBe(2);
    expect(prisma.logs).toHaveLength(2);
  });

  it('creates an audit note', async () => {
    const note = await service.createAuditNote({ businessId: 'biz_1', entityType: 'invoice', entityId: 'inv_1', note: 'Audited' });
    expect(note.type).toBe('audit_note');
    expect(note.description).toBe('Audited');
  });

  it('exports audit log as json', async () => {
    await service.log({ businessId: 'biz_1', entityType: 'contact', action: 'created', description: 'Created' });
    const exported = await service.exportAuditLog({ businessId: 'biz_1' });
    expect(exported.format).toBe('json');
    expect(exported.count).toBe(1);
  });

  it('exports audit log as csv', async () => {
    await service.log({ businessId: 'biz_1', entityType: 'contact', action: 'created', description: 'Created' });
    const exported = await service.exportAuditLog({ businessId: 'biz_1', format: 'csv' });
    expect(exported.format).toBe('csv');
    expect(exported.data).toContain('id,type');
  });

  it('deletes old logs', async () => {
    const old = new Date(Date.now() - 10 * 86400000).toISOString();
    await service.log({ businessId: 'biz_1', entityType: 'contact', action: 'created', description: 'Old' });
    // manipulate createdAt to be old
    prisma.logs[0].createdAt = old;
    const result = await service.deleteOldLogs({ businessId: 'biz_1', olderThanDays: 5 });
    expect(result.deleted).toBe(1);
    expect(prisma.logs).toHaveLength(0);
  });

  it('gets recent activity', async () => {
    await service.log({ businessId: 'biz_1', entityType: 'contact', action: 'created', description: 'Created' });
    const recent = await service.getRecent({ businessId: 'biz_1', limit: 5 });
    expect(recent).toHaveLength(1);
  });
});
