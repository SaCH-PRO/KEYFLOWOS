import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface CreateAccountingPeriodInput {
  year: number;
  month: number;
}

export interface CloseAccountingPeriodInput {
  closedById?: string;
}

@Injectable()
export class AccountingPeriodService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(businessId: string) {
    return this.prisma.client.accountingPeriod.findMany({
      where: { businessId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  async get(businessId: string, id: string) {
    const period = await this.prisma.client.accountingPeriod.findFirst({
      where: { id, businessId },
    });
    if (!period) throw new NotFoundException('Accounting period not found');
    return period;
  }

  async create(businessId: string, input: CreateAccountingPeriodInput) {
    if (input.month < 1 || input.month > 12) {
      throw new BadRequestException('Month must be 1-12');
    }

    const existing = await this.prisma.client.accountingPeriod.findFirst({
      where: { businessId, year: input.year, month: input.month },
    });
    if (existing) throw new BadRequestException('Accounting period already exists');

    const startDate = new Date(Date.UTC(input.year, input.month - 1, 1));
    const endDate = new Date(Date.UTC(input.year, input.month, 0, 23, 59, 59, 999));

    return this.prisma.client.accountingPeriod.create({
      data: {
        businessId,
        year: input.year,
        month: input.month,
        startDate,
        endDate,
      },
    });
  }

  async update(businessId: string, id: string, input: Partial<CreateAccountingPeriodInput>) {
    const period = await this.get(businessId, id);
    if (period.status === 'CLOSED') throw new BadRequestException('Cannot update a closed period');

    const year = input.year ?? period.year;
    const month = input.month ?? period.month;

    if (month < 1 || month > 12) {
      throw new BadRequestException('Month must be 1-12');
    }

    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    return this.prisma.client.accountingPeriod.update({
      where: { id },
      data: { year, month, startDate, endDate },
    });
  }

  async close(businessId: string, id: string, input: CloseAccountingPeriodInput = {}) {
    const period = await this.get(businessId, id);
    if (period.status === 'CLOSED') throw new BadRequestException('Period already closed');

    const stamp = `lock:${businessId}:${period.year}-${String(period.month).padStart(2, '0')}`;

    await this.prisma.client.$transaction(async (tx) => {
      // Stamp all transactions in the period — preserve existing metadata
      const txs = await tx.financialTransaction.findMany({
        where: {
          businessId,
          date: { gte: period.startDate, lte: period.endDate },
        },
        select: { id: true, metadata: true },
      });
      for (const t of txs) {
        const existing = (t.metadata as Record<string, unknown> | null) ?? {};
        await tx.financialTransaction.update({
          where: { id: t.id },
          data: { metadata: { ...existing, lockedByPeriod: stamp } },
        });
      }

      await tx.accountingPeriod.update({
        where: { id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedById: input.closedById ?? null,
          lockedTransactionStamp: stamp,
        },
      });
    });

    return this.get(businessId, id);
  }

  async reopen(businessId: string, id: string) {
    const period = await this.get(businessId, id);
    if (period.status !== 'CLOSED') throw new BadRequestException('Period is not closed');

    await this.prisma.client.$transaction(async (tx) => {
      // Clear stamp from transactions — preserve other metadata
      if (period.lockedTransactionStamp) {
        const txs = await tx.financialTransaction.findMany({
          where: {
            businessId,
            date: { gte: period.startDate, lte: period.endDate },
          },
          select: { id: true, metadata: true },
        });
        for (const t of txs) {
          const existing = { ...((t.metadata as Record<string, unknown> | null) ?? {}) };
          delete existing.lockedByPeriod;
          await tx.financialTransaction.update({
            where: { id: t.id },
            data: { metadata: Object.keys(existing).length > 0 ? existing : Prisma.JsonNull },
          });
        }
      }

      await tx.accountingPeriod.update({
        where: { id },
        data: {
          status: 'OPEN',
          closedAt: null,
          closedById: null,
          lockedTransactionStamp: null,
        },
      });
    });

    return this.get(businessId, id);
  }

  async remove(businessId: string, id: string) {
    const period = await this.get(businessId, id);
    if (period.status === 'CLOSED') throw new BadRequestException('Cannot delete a closed period');
    return this.prisma.client.accountingPeriod.delete({ where: { id } });
  }

  /** Check whether a date falls inside a closed period. Returns the period if locked. */
  async checkClosed(businessId: string, date: Date) {
    return this.prisma.client.accountingPeriod.findFirst({
      where: {
        businessId,
        status: 'CLOSED',
        startDate: { lte: date },
        endDate: { gte: date },
      },
    });
  }
}
