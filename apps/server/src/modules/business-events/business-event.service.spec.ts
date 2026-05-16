import { describe, expect, it, vi } from 'vitest';
import { BusinessEventService } from './business-event.service';

function createMockPrisma() {
  const store = new Map<string, any>();
  let idCounter = 0;

  return {
    client: {
      businessEvent: {
        create: vi.fn(async (args: any) => {
          const id = `evt_${++idCounter}`;
          const record = { id, ...args.data, createdAt: new Date() };
          store.set(id, record);
          return record;
        }),
        findMany: vi.fn(async (args: any) => {
          const items = Array.from(store.values());
          const filtered = items.filter((e) => {
            if (args.where?.businessId && e.businessId !== args.where.businessId) return false;
            if (args.where?.subjectType && e.subjectType !== args.where.subjectType) return false;
            if (args.where?.subjectId && e.subjectId !== args.where.subjectId) return false;
            return true;
          });
          return filtered.sort((a, b) => b.createdAt - a.createdAt);
        }),
        count: vi.fn(async () => store.size),
      },
    },
    store,
  };
}

describe('BusinessEventService', () => {
  it('emits a business event without throwing', async () => {
    const prisma = createMockPrisma();
    const svc = new BusinessEventService(prisma as any);

    await expect(
      svc.emit({
        businessId: 'biz_1',
        eventType: 'contact.created',
        subjectType: 'contact',
        subjectId: 'c1',
        actorType: 'human',
        actorId: 'user_1',
        action: 'create',
        source: 'web',
      }),
    ).resolves.toBeUndefined();

    expect(prisma.client.businessEvent.create).toHaveBeenCalled();
  });

  it('swallows errors and does not throw', async () => {
    const prisma = createMockPrisma();
    prisma.client.businessEvent.create = vi.fn(async () => {
      throw new Error('DB down');
    });
    const svc = new BusinessEventService(prisma as any);

    await expect(
      svc.emit({
        businessId: 'biz_1',
        eventType: 'contact.created',
        subjectType: 'contact',
        subjectId: 'c1',
        actorType: 'human',
        actorId: 'user_1',
        action: 'create',
        source: 'web',
      }),
    ).resolves.toBeUndefined();
  });

  it('gets timeline for a subject', async () => {
    const prisma = createMockPrisma();
    const svc = new BusinessEventService(prisma as any);

    await svc.emit({ businessId: 'biz_1', eventType: 'a.b', subjectType: 'contact', subjectId: 'c1', actorType: 'human', actorId: 'u1', action: 'create', source: 'web' });
    await svc.emit({ businessId: 'biz_1', eventType: 'a.c', subjectType: 'contact', subjectId: 'c1', actorType: 'human', actorId: 'u1', action: 'update', source: 'web' });
    await svc.emit({ businessId: 'biz_1', eventType: 'a.d', subjectType: 'deal', subjectId: 'd1', actorType: 'human', actorId: 'u1', action: 'create', source: 'web' });

    const timeline = await svc.getTimeline('contact', 'c1');
    expect(timeline).toHaveLength(2);
  });

  it('emits a batch of events', async () => {
    const prisma = createMockPrisma();
    const svc = new BusinessEventService(prisma as any);

    await expect(
      svc.emitBatch([
        { businessId: 'biz_1', eventType: 'a.b', subjectType: 'contact', subjectId: 'c1', actorType: 'human', actorId: 'u1', action: 'create', source: 'web' },
        { businessId: 'biz_1', eventType: 'a.c', subjectType: 'contact', subjectId: 'c2', actorType: 'human', actorId: 'u1', action: 'create', source: 'web' },
      ]),
    ).resolves.toBeUndefined();

    expect(prisma.client.businessEvent.create).toHaveBeenCalledTimes(2);
  });
});
