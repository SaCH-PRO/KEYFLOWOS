import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CalendarProjectionService } from './calendar-projection.service';
import { CalendarEventInput } from '@keyflow/shared';

function makePrismaMock() {
  return {
    client: {
      calendarEvent: {
        upsert: vi.fn().mockImplementation(({ create }) => Promise.resolve({ id: 'ev_' + create.sourceId, ...create })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    },
  };
}

const baseInput: CalendarEventInput = {
  businessId: 'biz_1',
  type: 'BOOKING',
  module: 'BOOKINGS',
  title: 'Cut & Style',
  startAt: new Date('2026-06-01T10:00:00Z'),
  endAt: new Date('2026-06-01T11:00:00Z'),
  sourceType: 'booking',
  sourceId: 'bk_1',
  contactId: 'c_1',
};

describe('CalendarProjectionService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let svc: CalendarProjectionService;

  beforeEach(() => {
    prisma = makePrismaMock();
    svc = new CalendarProjectionService(prisma as any);
  });

  it('upserts a projection keyed by (businessId, sourceType, sourceId)', async () => {
    await svc.upsertFromSource(baseInput);
    const call = prisma.client.calendarEvent.upsert.mock.calls[0][0];
    expect(call.where.businessId_sourceType_sourceId).toEqual({
      businessId: 'biz_1',
      sourceType: 'booking',
      sourceId: 'bk_1',
    });
    expect(call.create.title).toBe('Cut & Style');
    expect(call.create.module).toBe('BOOKINGS');
    expect(call.create.status).toBe('SCHEDULED');
    expect(call.create.priority).toBe('NORMAL');
    expect(call.create.visibility).toBe('TEAM');
    expect(call.create.syncStatus).toBe('LOCAL');
    expect(call.create.color).toBe('#0EA5E9'); // BOOKING default
    expect(call.update.deletedAt).toBeNull();
  });

  it('preserves explicit overrides for color, status, priority', async () => {
    await svc.upsertFromSource({
      ...baseInput,
      color: '#000000',
      status: 'CONFIRMED',
      priority: 'HIGH',
      visibility: 'PRIVATE',
    });
    const call = prisma.client.calendarEvent.upsert.mock.calls[0][0];
    expect(call.create.color).toBe('#000000');
    expect(call.create.status).toBe('CONFIRMED');
    expect(call.create.priority).toBe('HIGH');
    expect(call.create.visibility).toBe('PRIVATE');
  });

  it('upsertManyFromSource swallows individual failures and counts successes', async () => {
    prisma.client.calendarEvent.upsert
      .mockResolvedValueOnce({ id: 'ok' })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ id: 'ok2' });

    const count = await svc.upsertManyFromSource([
      { ...baseInput, sourceId: 'bk_1' },
      { ...baseInput, sourceId: 'bk_2' },
      { ...baseInput, sourceId: 'bk_3' },
    ]);
    expect(count).toBe(2);
    expect(prisma.client.calendarEvent.upsert).toHaveBeenCalledTimes(3);
  });

  it('removeForSource soft-deletes the matching projection', async () => {
    await svc.removeForSource({
      businessId: 'biz_1',
      sourceType: 'booking',
      sourceId: 'bk_1',
    });
    const call = prisma.client.calendarEvent.updateMany.mock.calls[0][0];
    expect(call.where.businessId).toBe('biz_1');
    expect(call.where.sourceType).toBe('booking');
    expect(call.where.sourceId).toBe('bk_1');
    expect(call.where.deletedAt).toBeNull();
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });

  it('pruneMissing soft-deletes projections whose source ids are absent', async () => {
    await svc.pruneMissing({
      businessId: 'biz_1',
      sourceType: 'booking',
      keepIds: ['bk_1', 'bk_2'],
    });
    const call = prisma.client.calendarEvent.updateMany.mock.calls[0][0];
    expect(call.where.sourceId).toEqual({ notIn: ['bk_1', 'bk_2'] });
  });

  it('pruneMissing handles empty keep list without nuking everything by accident', async () => {
    await svc.pruneMissing({
      businessId: 'biz_1',
      sourceType: 'booking',
      keepIds: [],
    });
    const call = prisma.client.calendarEvent.updateMany.mock.calls[0][0];
    expect(call.where.sourceId).toEqual({ notIn: ['__none__'] });
  });
});
