import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommandService } from './command.service';
import { NotFoundException } from '@nestjs/common';

function makePrismaMock() {
  return {
    client: {
      commandItem: {
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'ci_1', ...data })),
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'ci_1', ...data })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        delete: vi.fn().mockResolvedValue({ id: 'ci_1' }),
      },
    },
  };
}

function makeTimelineMock() {
  return { recordEvent: vi.fn().mockResolvedValue(undefined) };
}

describe('CommandService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let timeline: ReturnType<typeof makeTimelineMock>;
  let svc: CommandService;

  beforeEach(() => {
    prisma = makePrismaMock();
    timeline = makeTimelineMock();
    svc = new CommandService(prisma as any, timeline as any);
    vi.clearAllMocks();
  });

  it('creates a command item with defaults', async () => {
    const dto = {
      sourceModule: 'finance',
      sourceType: 'detection',
      sourceId: 'det_1',
      title: 'Low cash reserve',
      description: 'Cash below threshold',
      category: 'MONEY',
      actionType: 'ALERT',
    };
    const res = await svc.create('biz_1', dto as any);
    expect(res.title).toBe('Low cash reserve');
    expect(res.status).toBe('OPEN');
    expect(res.priority).toBe(50);
    expect(res.riskTier).toBe(1);
    expect(timeline.recordEvent).toHaveBeenCalled();
  });

  it('findMany applies filters and returns total', async () => {
    prisma.client.commandItem.findMany.mockResolvedValue([{ id: 'ci_1', title: 'Test' }]);
    prisma.client.commandItem.count.mockResolvedValue(1);
    const res = await svc.findMany('biz_1', { status: 'OPEN', category: 'MONEY', limit: 10 });
    expect(res.items).toHaveLength(1);
    expect(res.total).toBe(1);
    const where = prisma.client.commandItem.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('OPEN');
    expect(where.category).toBe('MONEY');
  });

  it('findOne throws NotFoundException when missing', async () => {
    await expect(svc.findOne('biz_1', 'missing')).rejects.toThrow(NotFoundException);
  });

  it('dismiss updates status to DISMISSED and records timeline', async () => {
    prisma.client.commandItem.findFirst.mockResolvedValue({ id: 'ci_1', status: 'OPEN' });
    await svc.dismiss('biz_1', 'ci_1');
    const updateCall = prisma.client.commandItem.update.mock.calls.at(-1)![0];
    expect(updateCall.data.status).toBe('DISMISSED');
    expect(timeline.recordEvent).toHaveBeenCalled();
  });

  it('execute updates status to EXECUTED', async () => {
    prisma.client.commandItem.findFirst.mockResolvedValue({ id: 'ci_1', status: 'OPEN' });
    await svc.execute('biz_1', 'ci_1');
    const updateCall = prisma.client.commandItem.update.mock.calls.at(-1)![0];
    expect(updateCall.data.status).toBe('EXECUTED');
  });

  it('approve updates status to EXECUTED', async () => {
    prisma.client.commandItem.findFirst.mockResolvedValue({ id: 'ci_1', status: 'WAITING_APPROVAL' });
    await svc.approve('biz_1', 'ci_1');
    const updateCall = prisma.client.commandItem.update.mock.calls.at(-1)![0];
    expect(updateCall.data.status).toBe('EXECUTED');
  });

  it('delete removes item and records timeline', async () => {
    prisma.client.commandItem.findFirst.mockResolvedValue({ id: 'ci_1', title: 'T' });
    await svc.delete('biz_1', 'ci_1');
    expect(prisma.client.commandItem.delete).toHaveBeenCalled();
    expect(timeline.recordEvent).toHaveBeenCalled();
  });
});
