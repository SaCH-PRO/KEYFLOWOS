import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface AccountBalance {
  accountId: string;
  systemKey: string | null;
  name: string;
  type: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  /** Net = debit - credit (positive for assets/expenses, negative for liabilities/equity/income by convention). */
  net: Prisma.Decimal;
}

const D = Prisma.Decimal;
const ZERO = new D(0);

@Injectable()
export class LedgerBalanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Net balance of one ChartOfAccount, optionally as-of a date. */
  async getAccountBalance(accountId: string, asOf?: Date): Promise<Prisma.Decimal> {
    const where: Prisma.LedgerEntryWhereInput = { accountId };
    if (asOf) where.date = { lte: asOf };
    const agg = await this.prisma.client.ledgerEntry.aggregate({
      where,
      _sum: { debit: true, credit: true },
    });
    const debit = (agg._sum.debit as Prisma.Decimal | null) ?? ZERO;
    const credit = (agg._sum.credit as Prisma.Decimal | null) ?? ZERO;
    return new D(debit.toString()).sub(new D(credit.toString()));
  }

  /**
   * Trial balance — every active account with non-zero net activity.
   * Sums debit/credit per account in one grouped query.
   */
  async getTrialBalance(businessId: string, asOf?: Date): Promise<AccountBalance[]> {
    const where: Prisma.LedgerEntryWhereInput = { businessId };
    if (asOf) where.date = { lte: asOf };

    const grouped = await this.prisma.client.ledgerEntry.groupBy({
      by: ['accountId'],
      where,
      _sum: { debit: true, credit: true },
    });

    if (grouped.length === 0) return [];

    const accounts = await this.prisma.client.chartOfAccount.findMany({
      where: { id: { in: grouped.map((g) => g.accountId) } },
      select: { id: true, name: true, type: true, systemKey: true },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));

    return grouped
      .map((g): AccountBalance => {
        const meta = byId.get(g.accountId);
        const debit = new D(((g._sum.debit as Prisma.Decimal | null) ?? ZERO).toString());
        const credit = new D(((g._sum.credit as Prisma.Decimal | null) ?? ZERO).toString());
        return {
          accountId: g.accountId,
          systemKey: meta?.systemKey ?? null,
          name: meta?.name ?? '(unknown)',
          type: meta?.type ?? 'ASSET',
          debit,
          credit,
          net: debit.sub(credit),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
