import { Inject, Injectable } from '@nestjs/common';
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

export interface GeneralLedgerRow {
  entryId: string;
  transactionId: string;
  date: Date;
  accountId: string;
  accountName: string;
  accountCode: string | null;
  accountType: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  memo: string | null;
  description: string | null;
  reference: string | null;
  sourceType: string | null;
  sourceId: string | null;
  runningBalance: Prisma.Decimal;
}

const D = Prisma.Decimal;
const ZERO = new D(0);

@Injectable()
export class LedgerBalanceService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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

  /**
   * General ledger detail view — chronological ledger rows with running balance.
   * Paginated; default page size 100.
   */
  async getGeneralLedger(
    businessId: string,
    opts: {
      accountId?: string;
      from?: Date;
      to?: Date;
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<{ rows: GeneralLedgerRow[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(500, Math.max(1, opts.pageSize ?? 100));

    const where: Prisma.LedgerEntryWhereInput = { businessId };
    if (opts.accountId) where.accountId = opts.accountId;
    if (opts.from || opts.to) {
      where.date = {};
      if (opts.from) where.date.gte = opts.from;
      if (opts.to) where.date.lte = opts.to;
    }

    const total = await this.prisma.client.ledgerEntry.count({ where });

    const entries = await this.prisma.client.ledgerEntry.findMany({
      where,
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        account: { select: { id: true, name: true, code: true, type: true } },
        transaction: { select: { id: true, description: true, reference: true, sourceType: true, sourceId: true } },
      },
    });

    // Running balance is scoped per account if accountId is provided; otherwise global net.
    const running = new Map<string, Prisma.Decimal>();
    const rows: GeneralLedgerRow[] = entries.map((e): GeneralLedgerRow => {
      const accountRunning = running.get(e.accountId) ?? ZERO;
      const nextBalance = accountRunning.add(new D(e.debit.toString())).sub(new D(e.credit.toString()));
      running.set(e.accountId, nextBalance);
      return {
        entryId: e.id,
        transactionId: e.transactionId,
        date: e.date,
        accountId: e.accountId,
        accountName: e.account.name,
        accountCode: e.account.code ?? null,
        accountType: e.account.type,
        debit: new D(e.debit.toString()),
        credit: new D(e.credit.toString()),
        memo: e.memo,
        description: e.transaction.description,
        reference: e.transaction.reference,
        sourceType: e.transaction.sourceType,
        sourceId: e.transaction.sourceId,
        runningBalance: nextBalance,
      };
    });

    return { rows, total, page, pageSize };
  }
}
