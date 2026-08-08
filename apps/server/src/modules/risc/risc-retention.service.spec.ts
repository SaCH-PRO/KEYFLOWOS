import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RiscRetentionService } from './risc-retention.service';

describe('RiscRetentionService', () => {
  let service: RiscRetentionService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    service = new RiscRetentionService(prisma as any);
  });

  afterEach(() => {
    delete process.env.RISC_EVENT_RETENTION_DAYS;
    vi.restoreAllMocks();
  });

  function makePrisma() {
    return {
      client: {
        riscEvent: {
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      },
    };
  }

  it('purges events older than the default 90 days', async () => {
    const result = await service.purgeExpiredEvents();

    expect(result.deleted).toBe(0);
    expect(prisma.client.riscEvent.deleteMany).toHaveBeenCalledWith({
      where: {
        receivedAt: {
          lt: expect.any(Date) as Date,
        },
      },
    });

    const cutoff = (prisma.client.riscEvent.deleteMany as any).mock.calls[0][0].where.receivedAt.lt as Date;
    const roughly90DaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    expect(cutoff.getTime()).toBeGreaterThan(roughly90DaysAgo - 5000);
    expect(cutoff.getTime()).toBeLessThan(roughly90DaysAgo + 5000);
  });

  it('respects RISC_EVENT_RETENTION_DAYS override', async () => {
    process.env.RISC_EVENT_RETENTION_DAYS = '7';
    prisma.client.riscEvent.deleteMany.mockResolvedValue({ count: 42 });

    const result = await service.purgeExpiredEvents();

    expect(result.deleted).toBe(42);
    const cutoff = (prisma.client.riscEvent.deleteMany as any).mock.calls[0][0].where.receivedAt.lt as Date;
    const roughly7DaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(cutoff.getTime()).toBeGreaterThan(roughly7DaysAgo - 5000);
    expect(cutoff.getTime()).toBeLessThan(roughly7DaysAgo + 5000);
  });

  it('ignores invalid RISC_EVENT_RETENTION_DAYS and falls back to 90', async () => {
    process.env.RISC_EVENT_RETENTION_DAYS = 'not-a-number';

    await service.purgeExpiredEvents();

    const cutoff = (prisma.client.riscEvent.deleteMany as any).mock.calls[0][0].where.receivedAt.lt as Date;
    const roughly90DaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    expect(cutoff.getTime()).toBeGreaterThan(roughly90DaysAgo - 5000);
    expect(cutoff.getTime()).toBeLessThan(roughly90DaysAgo + 5000);
  });
});
