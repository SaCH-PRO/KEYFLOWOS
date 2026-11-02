import { describe, expect, it, vi } from 'vitest';
import { CallLogService } from './call-log.service';

function createMockPrisma() {
  const store = {
    callLogs: new Map<string, any>(),
    contactTasks: new Map<string, any>(),
    // the contacts the cases name, each in its business (createCallLog checks it, review 9 TD9-2)
    contacts: new Map<string, any>([
      ['contact_1', { id: 'contact_1', businessId: 'biz_1' }],
      ['contact_2', { id: 'contact_2', businessId: 'biz_1' }],
      ['contact_t', { id: 'contact_t', businessId: 'biz_theirs' }],
    ]),
  };
  let idCounter = 0;

  return {
    client: {
      callLog: {
        create: vi.fn(async (args: any) => {
          const id = `cl_${++idCounter}`;
          const record = { id, ...args.data, createdAt: new Date(), completedAt: args.data.completedAt ?? null };
          store.callLogs.set(id, record);
          return record;
        }),
        // findUnique answers by id alone, as Prisma does with no tenant context (the staff bridge)
        findUnique: vi.fn(async (args: any) =>
          store.callLogs.get(args.where.id) ?? null,
        ),
        findFirst: vi.fn(async (args: any) => {
          const row = store.callLogs.get(args.where.id);
          if (!row) return null;
          if (args.where.businessId !== undefined && row.businessId !== args.where.businessId) return null;
          return row;
        }),
        findMany: vi.fn(async (args: any) => {
          const items = Array.from(store.callLogs.values()).filter(
            (log: any) => {
              if (args.where?.businessId && log.businessId !== args.where.businessId)
                return false;
              if (args.where?.callerId && log.callerId !== args.where.callerId)
                return false;
              if (args.where?.contactId && log.contactId !== args.where.contactId)
                return false;
              if (args.where?.outcome && log.outcome !== args.where.outcome)
                return false;
              if (args.where?.completedAt === null && log.completedAt !== null)
                return false;
              if (
                args.where?.scheduledAt?.gte &&
                log.scheduledAt < args.where.scheduledAt.gte
              )
                return false;
              if (
                args.where?.scheduledAt?.lte &&
                log.scheduledAt > args.where.scheduledAt.lte
              )
                return false;
              return true;
            },
          );
          return items.sort(
            (a: any, b: any) =>
              (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0),
          );
        }),
        update: vi.fn(async (args: any) => {
          const existing = store.callLogs.get(args.where.id);
          if (!existing) return null;
          const updated = { ...existing, ...args.data };
          store.callLogs.set(args.where.id, updated);
          return updated;
        }),
        updateMany: vi.fn(async () => ({ count: 0 })),
        delete: vi.fn(async (args: any) => {
          store.callLogs.delete(args.where.id);
          return { id: args.where.id };
        }),
        count: vi.fn(async (args: any) => {
          const items = Array.from(store.callLogs.values()).filter((log: any) => {
            if (args.where?.businessId && log.businessId !== args.where.businessId) return false;
            if (args.where?.callerId && log.callerId !== args.where.callerId) return false;
            if (args.where?.contactId && log.contactId !== args.where.contactId) return false;
            if (args.where?.outcome && log.outcome !== args.where.outcome) return false;
            if (args.where?.completedAt === null && log.completedAt !== null) return false;
            if (args.where?.scheduledAt?.gte && log.scheduledAt < args.where.scheduledAt.gte) return false;
            if (args.where?.scheduledAt?.lte && log.scheduledAt > args.where.scheduledAt.lte) return false;
            return true;
          });
          return items.length;
        }),
      },
      contactTask: {
        create: vi.fn(async (args: any) => {
          const id = `ct_${++idCounter}`;
          const record = { id, ...args.data, createdAt: new Date() };
          store.contactTasks.set(id, record);
          return record;
        }),
        findUnique: vi.fn(async (args: any) =>
          store.contactTasks.get(args.where.id) ?? null,
        ),
      },
      contact: {
        findUnique: vi.fn(async (args: any) =>
          store.contacts.get(args.where.id) ?? null,
        ),
        findFirst: vi.fn(async (args: any) => {
          const row = store.contacts.get(args.where.id);
          if (!row) return null;
          if (args.where.businessId !== undefined && row.businessId !== args.where.businessId) return null;
          return row;
        }),
      },
    },
    store,
  };
}

function createMockEmitter() {
  return { emit: vi.fn() };
}

describe('CallLogService', () => {
  it('creates a call log', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new CallLogService(prisma as any, emitter as any);

    const result = await svc.createCallLog({
      businessId: 'biz_1',
      callerId: 'user_1',
      contactId: 'contact_1',
      scheduledAt: new Date('2026-05-20T10:00:00Z'),
      script: 'Hello, calling about your recent inquiry',
    });

    expect(result.id).toBeDefined();
    expect(result.businessId).toBe('biz_1');
    expect(result.callerId).toBe('user_1');
    expect(result.contactId).toBe('contact_1');
    expect(result.script).toBe('Hello, calling about your recent inquiry');
    expect(emitter.emit).toHaveBeenCalledWith(
      'call_log.created',
      expect.any(Object),
    );
  });

  it('lists calls with filters', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new CallLogService(prisma as any, emitter as any);

    await svc.createCallLog({
      businessId: 'biz_1',
      callerId: 'user_1',
      contactId: 'contact_1',
      scheduledAt: new Date('2026-05-20T10:00:00Z'),
    });
    await svc.createCallLog({
      businessId: 'biz_1',
      callerId: 'user_2',
      contactId: 'contact_2',
      scheduledAt: new Date('2026-05-20T11:00:00Z'),
    });

    const result = await svc.listCalls('biz_1', { callerId: 'user_1' });
    expect(result.total).toBe(1);
    expect(result.items[0].callerId).toBe('user_1');
  });

  it('completes a call', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new CallLogService(prisma as any, emitter as any);

    const created = await svc.createCallLog({
      businessId: 'biz_1',
      callerId: 'user_1',
      contactId: 'contact_1',
    });

    const result = await svc.completeCall('biz_1', created.id, {
      outcome: 'reached',
      duration: 120,
      notes: 'Customer is interested',
    }, 'user_1');

    expect(result.outcome).toBe('reached');
    expect(result.duration).toBe(120);
    expect(result.completedAt).toBeInstanceOf(Date);
    expect(emitter.emit).toHaveBeenCalledWith(
      'call_log.completed',
      expect.any(Object),
    );
  });

  it('rejects completing an already completed call', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new CallLogService(prisma as any, emitter as any);

    const created = await svc.createCallLog({
      businessId: 'biz_1',
      callerId: 'user_1',
    });

    await svc.completeCall('biz_1', created.id, { outcome: 'reached' }, 'user_1');

    await expect(
      svc.completeCall('biz_1', created.id, { outcome: 'no_answer' }, 'user_1'),
    ).rejects.toThrow('Call is already completed');
  });

  it('creates a follow-up task', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new CallLogService(prisma as any, emitter as any);

    const created = await svc.createCallLog({
      businessId: 'biz_1',
      callerId: 'user_1',
      contactId: 'contact_1',
    });

    const task = await svc.createFollowUpTask(
      'biz_1',
      created.id,
      { title: 'Send proposal', priority: 'HIGH' },
      'user_1',
    );

    expect(task.title).toBe('Send proposal');
    expect(task.priority).toBe('HIGH');
    expect(task.callLogId).toBe(created.id);
    expect(task.source).toBe('call_follow_up');
    expect(emitter.emit).toHaveBeenCalledWith(
      'call_log.follow_up_created',
      expect.any(Object),
    );
  });

  it('rejects follow-up for call without contact', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new CallLogService(prisma as any, emitter as any);

    const created = await svc.createCallLog({
      businessId: 'biz_1',
      callerId: 'user_1',
    });

    await expect(
      svc.createFollowUpTask('biz_1', created.id, { title: 'Test' }, 'user_1'),
    ).rejects.toThrow('Cannot create follow-up task for a call without a contact');
  });

  it('creates call log from contact next action', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new CallLogService(prisma as any, emitter as any);

    prisma.store.contacts.set('contact_1', {
      id: 'contact_1',
      businessId: 'biz_1',
      nextActionAt: new Date('2026-05-20T14:00:00Z'),
      nextActionType: 'call',
    });

    const result = await svc.createFromContactNextAction(
      'contact_1',
      'user_1',
      'Follow up on quote',
    );

    expect(result.contactId).toBe('contact_1');
    expect(result.callerId).toBe('user_1');
    expect(result.script).toBe('Follow up on quote');
    expect(emitter.emit).toHaveBeenCalledWith(
      'call_log.created_from_next_action',
      expect.any(Object),
    );
  });

  it('rejects creating from contact without call next action', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new CallLogService(prisma as any, emitter as any);

    prisma.store.contacts.set('contact_1', {
      id: 'contact_1',
      businessId: 'biz_1',
      nextActionAt: new Date(),
      nextActionType: 'email',
    });

    await expect(
      svc.createFromContactNextAction('contact_1', 'user_1'),
    ).rejects.toThrow("Contact next action is 'email', not 'call'");
  });

  it('deletes a scheduled call', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new CallLogService(prisma as any, emitter as any);

    const created = await svc.createCallLog({
      businessId: 'biz_1',
      callerId: 'user_1',
    });

    const result = await svc.deleteCallLog('biz_1', created.id);
    expect(result.success).toBe(true);
    expect(emitter.emit).toHaveBeenCalledWith(
      'call_log.deleted',
      expect.any(Object),
    );
  });

  it('rejects deleting a completed call', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new CallLogService(prisma as any, emitter as any);

    const created = await svc.createCallLog({
      businessId: 'biz_1',
      callerId: 'user_1',
    });

    await svc.completeCall('biz_1', created.id, { outcome: 'reached' }, 'user_1');

    await expect(svc.deleteCallLog('biz_1', created.id)).rejects.toThrow(
      'Cannot delete a completed call log',
    );
  });

  it('gets scheduled calls for a date', async () => {
    const prisma = createMockPrisma();
    const emitter = createMockEmitter();
    const svc = new CallLogService(prisma as any, emitter as any);

    const today = new Date();
    today.setHours(10, 0, 0, 0);

    await svc.createCallLog({
      businessId: 'biz_1',
      callerId: 'user_1',
      scheduledAt: today,
    });
    await svc.createCallLog({
      businessId: 'biz_1',
      callerId: 'user_1',
      scheduledAt: new Date(today.getTime() + 60 * 60 * 1000),
    });

    const result = await svc.getScheduledCalls('biz_1', 'user_1', today);
    expect(result.length).toBe(2);
  });

  /**
   * V1-21b review 8 DD8-1: every CallLogService method that takes a call log id looks it up within
   * the business it is given. The KEY dispatcher calls completeCall / createFollowUpTask on the
   * WhatsApp/SMS staff bridge, where no tenant context binds a bare-id lookup, so a call log id
   * from another business completed that business's call and planted a task in its CRM.
   */
  describe("another business's call log is not found (review 8 DD8-1)", () => {
    async function seeded() {
      const prisma = createMockPrisma();
      const emitter = createMockEmitter();
      const svc = new CallLogService(prisma as any, emitter as any);
      const theirs = await svc.createCallLog({ businessId: 'biz_theirs', callerId: 'user_t', contactId: 'contact_t' });
      return { prisma, emitter, svc, theirs };
    }

    it('getCallLog', async () => {
      const { svc, theirs } = await seeded();
      await expect(svc.getCallLog('biz_1', theirs.id)).rejects.toThrow('Call log not found');
      expect((await svc.getCallLog('biz_theirs', theirs.id)).id).toBe(theirs.id);
    });

    it('completeCall writes nothing and emits nothing', async () => {
      const { prisma, emitter, svc, theirs } = await seeded();
      emitter.emit.mockClear();
      await expect(svc.completeCall('biz_1', theirs.id, { outcome: 'not_interested' }, 'key_ai')).rejects.toThrow('Call log not found');
      expect(prisma.client.callLog.update).not.toHaveBeenCalled();
      expect(prisma.store.callLogs.get(theirs.id).completedAt).toBeNull();
      expect(emitter.emit).not.toHaveBeenCalled();
    });

    it('createFollowUpTask plants no task', async () => {
      const { prisma, svc, theirs } = await seeded();
      await expect(svc.createFollowUpTask('biz_1', theirs.id, { title: 'planted' }, 'key_ai')).rejects.toThrow('Call log not found');
      expect(prisma.client.contactTask.create).not.toHaveBeenCalled();
      expect(prisma.store.contactTasks.size).toBe(0);
    });

    it('updateCallLog and deleteCallLog', async () => {
      const { prisma, svc, theirs } = await seeded();
      await expect(svc.updateCallLog('biz_1', theirs.id, { notes: 'x' })).rejects.toThrow('Call log not found');
      await expect(svc.deleteCallLog('biz_1', theirs.id)).rejects.toThrow('Call log not found');
      expect(prisma.client.callLog.update).not.toHaveBeenCalled();
      expect(prisma.client.callLog.delete).not.toHaveBeenCalled();
      expect(prisma.store.callLogs.has(theirs.id)).toBe(true);
    });

    it('the follow-up task of its own call log lands in its own business', async () => {
      const { svc, prisma } = await seeded();
      const mine = await svc.createCallLog({ businessId: 'biz_1', callerId: 'user_1', contactId: 'contact_1' });
      const task = await svc.createFollowUpTask('biz_1', mine.id, { title: 'mine' }, 'key_ai');
      expect(task.businessId).toBe('biz_1');
      expect(prisma.store.callLogs.get(mine.id).followUpTaskId).toBe(task.id);
    });
  });
});
