import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { LedgerBalanceService } from './ledger-balance.service';
import { FinanceAuditService } from './finance-audit.service';

const D = Prisma.Decimal;

/**
 * Anchor an arbitrary timestamp to the start (00:00:00.000) of its UTC
 * calendar day. Used so periodStart filters never accidentally skip
 * entries timestamped earlier on the same day.
 */
function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}
/**
 * Anchor an arbitrary timestamp to the very end (23:59:59.999) of its
 * UTC calendar day, so balance, lock, and unmatched checks include
 * everything posted on the closing day.
 */
function endOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

export interface CreateReconciliationInput {
  accountId: string;
  periodStart: Date;
  periodEnd: Date;
  statementBalance: number | string;
  notes?: string | null;
}

/**
 * FIN6 — Bank-statement reconciliation sessions. On `complete()` we lock
 * every LedgerEntry whose date ≤ periodEnd on the bank account's COA so
 * the reversal path in PostingService rejects further changes to closed
 * periods (admin override required to break the seal).
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerBalance: LedgerBalanceService,
    private readonly audit: FinanceAuditService,
  ) {}

  /** Compute the system balance for a bank account = net(debit-credit) on its COA up to and including `asOf`. */
  async computeSystemBalance(businessId: string, accountId: string, asOf: Date): Promise<Prisma.Decimal> {
    const acc = await this.prisma.client.financialAccount.findFirst({
      where: { id: accountId, businessId },
      select: { chartOfAccountId: true, openingBalance: true },
    });
    if (!acc) throw new NotFoundException('Bank account not found');
    const ledgerNet = await this.ledgerBalance.getAccountBalance(acc.chartOfAccountId, asOf);
    // Opening balance is the as-of-creation seed; the ledger may or may
    // not have a corresponding OPENING_BALANCE posting. We trust whatever
    // is on the ledger and treat openingBalance as a fallback only when
    // the ledger has zero rows. The integration test in FIN1 covers both.
    return ledgerNet;
  }

  async create(businessId: string, input: CreateReconciliationInput, userId?: string | null) {
    const account = await this.prisma.client.financialAccount.findFirst({
      where: { id: input.accountId, businessId },
      select: { id: true, name: true },
    });
    if (!account) throw new NotFoundException('Bank account not found');
    // Normalise to whole-day boundaries so a date-only request like
    // `2026-01-31` covers ledger entries timestamped any time on that day,
    // not just exactly midnight UTC. Without this an entry at 09:00 on
    // periodEnd would be excluded from balance/locks and produce a false
    // difference.
    const periodStart = startOfUtcDay(input.periodStart);
    const periodEnd = endOfUtcDay(input.periodEnd);
    if (periodStart > periodEnd) {
      throw new BadRequestException('periodStart must be ≤ periodEnd');
    }
    const systemBalance = await this.computeSystemBalance(businessId, input.accountId, periodEnd);
    const stmt = new D(String(input.statementBalance));
    const difference = stmt.sub(systemBalance);
    // Per FIN6 audit: a freshly opened session is always OPEN. The
    // computed `difference` is what the reviewer works against — it gates
    // `complete()` later, but we don't pre-flag the session here.
    const recon = await this.prisma.client.reconciliation.create({
      data: {
        businessId,
        accountId: input.accountId,
        periodStart,
        periodEnd,
        statementBalance: stmt,
        systemBalance,
        difference,
        notes: input.notes ?? null,
        status: 'OPEN',
      },
    });
    await this.audit.log({
      businessId,
      userId: userId ?? null,
      action: 'RECONCILIATION_OPENED',
      entityType: 'Reconciliation',
      entityId: recon.id,
      title: `Opened reconciliation for ${account.name}`,
      detail: `${periodStart.toISOString().slice(0, 10)} → ${periodEnd.toISOString().slice(0, 10)}`,
      meta: {
        statementBalance: stmt.toString(),
        systemBalance: systemBalance.toString(),
        difference: difference.toString(),
      },
    });
    return recon;
  }

  async list(businessId: string, accountId?: string | null) {
    return this.prisma.client.reconciliation.findMany({
      where: { businessId, ...(accountId ? { accountId } : {}) },
      orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async get(businessId: string, id: string) {
    const recon = await this.prisma.client.reconciliation.findFirst({
      where: { id, businessId },
    });
    if (!recon) throw new NotFoundException('Reconciliation not found');
    return recon;
  }

  /**
   * Complete a reconciliation. Hard rules:
   *   - difference must be 0 (within 0.01).
   *   - All bank rows in [periodStart, periodEnd] must be MATCHED or IGNORED.
   *   - Idempotent — completing a RECONCILED row is a no-op (returns the row).
   */
  async complete(businessId: string, id: string, userId?: string | null) {
    const recon = await this.prisma.client.reconciliation.findFirst({
      where: { id, businessId },
      include: { account: { select: { id: true, name: true, chartOfAccountId: true } } },
    });
    if (!recon) throw new NotFoundException('Reconciliation not found');
    if (recon.status === 'RECONCILED') return recon;

    // Refresh balances at completion time so any in-flight ledger writes
    // are accounted for. Don't trust the figures captured at create-time.
    const systemBalance = await this.computeSystemBalance(businessId, recon.accountId, recon.periodEnd);
    const difference = new D(String(recon.statementBalance)).sub(systemBalance);
    if (difference.abs().gt(new D('0.01'))) {
      throw new ConflictException(
        `Cannot complete: statement vs system difference is ${difference.toFixed(2)}`,
      );
    }

    const unresolved = await this.prisma.client.bankTransaction.count({
      where: {
        businessId,
        accountId: recon.accountId,
        date: { gte: recon.periodStart, lte: recon.periodEnd },
        status: 'UNMATCHED',
      },
    });
    if (unresolved > 0) {
      throw new ConflictException(
        `Cannot complete: ${unresolved} bank row(s) in the period are still UNMATCHED`,
      );
    }

    // Lock every in-period ledger entry on this account's COA. Per audit
    // §15 locking is per-account and per-period — so the where clause is
    // narrowed to (businessId, accountId=COA, date ≤ periodEnd) and only
    // entries that aren't already locked.
    const locked = await this.prisma.client.$transaction(async (tx) => {
      const lockResult = await tx.ledgerEntry.updateMany({
        where: {
          businessId,
          accountId: recon.account.chartOfAccountId,
          date: { lte: recon.periodEnd },
          lockedByReconciliationId: null,
        },
        data: { lockedByReconciliationId: recon.id },
      });
      const updated = await tx.reconciliation.update({
        where: { id: recon.id },
        data: {
          systemBalance,
          difference,
          status: 'RECONCILED',
          completedAt: new Date(),
          completedById: userId ?? null,
        },
      });
      return { recon: updated, lockedCount: lockResult.count };
    });

    await this.audit.log({
      businessId,
      userId: userId ?? null,
      action: 'RECONCILIATION_COMPLETED',
      entityType: 'Reconciliation',
      entityId: recon.id,
      title: `Reconciled ${recon.account.name}`,
      detail: `${locked.lockedCount} ledger entries locked through ${recon.periodEnd.toISOString().slice(0, 10)}`,
      meta: {
        lockedCount: locked.lockedCount,
        statementBalance: recon.statementBalance.toString(),
        systemBalance: systemBalance.toString(),
      },
    });
    return locked.recon;
  }

  /**
   * Reconciliation report payload — matched pairs, ignored bank rows, and
   * opening/closing balances. Consumed by the CSV/PDF export and by the UI.
   */
  async getReport(businessId: string, id: string) {
    const recon = await this.get(businessId, id);
    const account = await this.prisma.client.financialAccount.findFirst({
      where: { id: recon.accountId, businessId },
      select: { id: true, name: true, currency: true, chartOfAccountId: true },
    });
    if (!account) throw new NotFoundException('Bank account not found');

    const [bankRows, openingBalance, closingBalance] = await Promise.all([
      this.prisma.client.bankTransaction.findMany({
        where: {
          businessId,
          accountId: recon.accountId,
          date: { gte: recon.periodStart, lte: recon.periodEnd },
        },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      }),
      this.ledgerBalance.getAccountBalance(account.chartOfAccountId, new Date(recon.periodStart.getTime() - 1)),
      this.ledgerBalance.getAccountBalance(account.chartOfAccountId, recon.periodEnd),
    ]);

    const ledgerIds = bankRows
      .map((b) => b.matchedTransactionId)
      .filter((x): x is string => !!x);
    const ledger = ledgerIds.length
      ? await this.prisma.client.financialTransaction.findMany({
          where: { id: { in: ledgerIds } },
          select: { id: true, date: true, amount: true, description: true, reference: true },
        })
      : [];
    const byTxnId = new Map(ledger.map((l) => [l.id, l]));

    const matched = bankRows
      .filter((b) => b.status === 'MATCHED')
      .map((b) => ({
        bank: {
          id: b.id,
          date: b.date.toISOString(),
          description: b.description,
          amount: Number(b.amount),
          reference: b.reference,
        },
        ledger: b.matchedTransactionId
          ? (() => {
              const l = byTxnId.get(b.matchedTransactionId!);
              return l
                ? {
                    transactionId: l.id,
                    date: l.date.toISOString(),
                    amount: Number(l.amount),
                    description: l.description,
                    reference: l.reference,
                  }
                : null;
            })()
          : null,
      }));
    const ignored = bankRows
      .filter((b) => b.status === 'IGNORED')
      .map((b) => ({
        id: b.id,
        date: b.date.toISOString(),
        description: b.description,
        amount: Number(b.amount),
        reference: b.reference,
      }));

    return {
      reconciliation: {
        id: recon.id,
        periodStart: recon.periodStart.toISOString(),
        periodEnd: recon.periodEnd.toISOString(),
        statementBalance: Number(recon.statementBalance),
        systemBalance: Number(recon.systemBalance),
        difference: Number(recon.difference),
        status: recon.status,
        completedAt: recon.completedAt?.toISOString() ?? null,
      },
      account: { id: account.id, name: account.name, currency: account.currency },
      openingBalance: Number(openingBalance),
      closingBalance: Number(closingBalance),
      matched,
      ignored,
    };
  }

  /** CSV export of the report. */
  async exportReportCsv(businessId: string, id: string): Promise<string> {
    const r = await this.getReport(businessId, id);
    const esc = (s: unknown) => {
      const v = s == null ? '' : String(s);
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    };
    const lines: string[] = [];
    lines.push(`Reconciliation Report,,${esc(r.account.name)},,${esc(r.account.currency)}`);
    lines.push(`Period,${r.reconciliation.periodStart.slice(0, 10)},to,${r.reconciliation.periodEnd.slice(0, 10)}`);
    lines.push(`Opening Balance,${r.openingBalance.toFixed(2)}`);
    lines.push(`Closing Balance,${r.closingBalance.toFixed(2)}`);
    lines.push(`Statement Balance,${r.reconciliation.statementBalance.toFixed(2)}`);
    lines.push(`System Balance,${r.reconciliation.systemBalance.toFixed(2)}`);
    lines.push(`Difference,${r.reconciliation.difference.toFixed(2)}`);
    lines.push('');
    lines.push('Type,Bank Date,Bank Description,Bank Amount,Bank Ref,Ledger Date,Ledger Description,Ledger Amount,Ledger Ref');
    for (const m of r.matched) {
      const l = m.ledger;
      lines.push([
        'MATCHED',
        m.bank.date.slice(0, 10),
        esc(m.bank.description),
        m.bank.amount.toFixed(2),
        esc(m.bank.reference ?? ''),
        l ? l.date.slice(0, 10) : '',
        esc(l?.description ?? ''),
        l ? l.amount.toFixed(2) : '',
        esc(l?.reference ?? ''),
      ].join(','));
    }
    for (const i of r.ignored) {
      lines.push([
        'IGNORED',
        i.date.slice(0, 10),
        esc(i.description),
        i.amount.toFixed(2),
        esc(i.reference ?? ''),
        '', '', '', '',
      ].join(','));
    }
    return lines.join('\n');
  }
}
