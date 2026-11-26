/**
 * P213 (FU-RECURRING-EXPENSE-SERVER) R1 Security Regression Suite:
 * Covers sub-1000 AD / BC past-date bypasses, O(1) advancePast jump across
 * millennia without event-loop DoS, dueOffsetDays range/type validation, and
 * endDate validation (keeping the RED integration test file untouched).
 */
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { RecurringExpenseService } from './recurring-expense.service';

function makeService(overrides?: { timezone?: string | null; existing?: Record<string, unknown> }) {
  const prisma = {
    client: {
      business: {
        findUnique: vi.fn().mockResolvedValue({
          timezone: overrides?.timezone ?? 'America/Port_of_Spain',
          currency: 'TTD',
        }),
      },
      recurringExpense: {
        findFirst: vi.fn().mockResolvedValue(overrides?.existing ?? { id: 'rec_1', businessId: 'biz_1', deletedAt: null }),
        create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'rec_new', ...data })),
        update: vi.fn().mockImplementation(async ({ data }) => ({ id: 'rec_1', ...data })),
      },
    },
  } as any;
  const events = { emit: vi.fn() } as any;
  const expensesSvc = { createExpense: vi.fn().mockResolvedValue({ id: 'exp_1' }) } as any;
  return { svc: new RecurringExpenseService(prisma, events, expensesSvc), prisma, expensesSvc };
}

describe('P213 R1 regressions (FU-RECURRING-EXPENSE-SERVER)', () => {
  it('rejects years < 1000 AD and BC dates as past in create/update', async () => {
    const { svc } = makeService();
    const pastInputs = [
      '0999-01-01T12:00:00.000Z',
      '0300-01-01T12:00:00.000Z',
      '0300-01-01',
      '-003000-01-01T00:00:00.000Z',
      '-004700-01-01T00:00:00.000Z',
    ];
    for (const nextRunDate of pastInputs) {
      await expect(
        svc.create({
          businessId: 'biz_1',
          name: 'Rent',
          frequency: 'MONTHLY',
          nextRunDate,
          description: 'Office rent',
          amount: 100,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        svc.update({
          id: 'rec_1',
          businessId: 'biz_1',
          nextRunDate,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('advancePast jumps across millennia in O(1) while preserving cadence and anchorDay', () => {
    const now = new Date('2026-11-26T22:00:00.000Z');
    const ancientWeekly = new Date('-004700-01-01T00:00:00.000Z');
    const t0 = Date.now();
    const nextW = RecurringExpenseService.advancePast(ancientWeekly, 'WEEKLY', now);
    const nextB = RecurringExpenseService.advancePast(ancientWeekly, 'BIWEEKLY', now);
    const nextM = RecurringExpenseService.advancePast(new Date('0300-01-31T00:00:00.000Z'), 'MONTHLY', now);
    const nextQ = RecurringExpenseService.advancePast(new Date('0300-01-31T00:00:00.000Z'), 'QUARTERLY', now);
    const nextY = RecurringExpenseService.advancePast(new Date('0300-02-28T00:00:00.000Z'), 'YEARLY', now);
    const elapsedMs = Date.now() - t0;

    expect(elapsedMs).toBeLessThan(100);
    expect(nextW.getTime()).toBeGreaterThan(now.getTime());
    expect(nextW.getTime() - now.getTime()).toBeLessThanOrEqual(7 * 86_400_000);
    expect(nextB.getTime()).toBeGreaterThan(now.getTime());
    expect(nextB.getTime() - now.getTime()).toBeLessThanOrEqual(14 * 86_400_000);
    expect(nextM.toISOString()).toBe('2026-11-30T00:00:00.000Z');
    expect(nextQ.toISOString()).toBe('2027-01-31T00:00:00.000Z');
    expect(nextY.toISOString()).toBe('2027-02-28T00:00:00.000Z');
  });

  it('rejects negative, non-integer, and overflowing dueOffsetDays on create and update; allows 0..3650 and null', async () => {
    const { svc } = makeService();
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();

    for (const bad of [-1, -30, 1.5, Number.NaN, 3651, 200_000_000, '7' as any]) {
      await expect(
        svc.create({
          businessId: 'biz_1',
          name: 'Bill',
          frequency: 'MONTHLY',
          nextRunDate: future,
          description: 'Utility',
          amount: 50,
          createsBill: true,
          dueOffsetDays: bad,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        svc.update({
          id: 'rec_1',
          businessId: 'biz_1',
          dueOffsetDays: bad,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }

    for (const ok of [0, 30, 3650, null]) {
      const created = await svc.create({
        businessId: 'biz_1',
        name: 'Bill',
        frequency: 'MONTHLY',
        nextRunDate: future,
        description: 'Utility',
        amount: 50,
        createsBill: true,
        dueOffsetDays: ok,
      });
      expect(created.dueOffsetDays).toBe(ok);
    }
  });

  it('rejects invalid endDate strings on create and update with 400', async () => {
    const { svc } = makeService();
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();

    for (const badEnd of ['not-a-date', '2026-02-30', 12345 as any]) {
      await expect(
        svc.create({
          businessId: 'biz_1',
          name: 'Sub',
          frequency: 'MONTHLY',
          nextRunDate: future,
          endDate: badEnd,
          description: 'Sub',
          amount: 10,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        svc.update({
          id: 'rec_1',
          businessId: 'biz_1',
          endDate: badEnd,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('runOnce defensively ignores out-of-range dueOffsetDays in legacy DB rows without producing Invalid Date', async () => {
    const now = new Date('2026-11-26T22:00:00.000Z');
    const { svc, expensesSvc } = makeService({
      existing: {
        id: 'rec_legacy',
        businessId: 'biz_1',
        isActive: true,
        deletedAt: null,
        endDate: null,
        createsBill: true,
        dueOffsetDays: 200_000_000,
        description: 'Legacy',
        amount: 100,
        currency: 'TTD',
        frequency: 'MONTHLY',
        nextRunDate: new Date('2026-11-01T00:00:00.000Z'),
      },
    });
    await svc.runOnce('rec_legacy', 'biz_1', now);
    expect(expensesSvc.createExpense).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'BILL', dueDate: undefined }),
    );
  });
});
