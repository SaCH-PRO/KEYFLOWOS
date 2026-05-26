import { Injectable, Inject, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { FinanceAuditService } from './finance-audit.service';

const D = Prisma.Decimal;
const AMOUNT_TOLERANCE = new D('0.01');
const DATE_WINDOW_DAYS = 3;

/** Strip noise so two descriptions can be compared by token overlap. */
export function tokenize(text: string): Set<string> {
  if (!text) return new Set();
  const cleaned = text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ');
  const tokens = cleaned
    .split(/\s+/)
    .filter((t) => t.length >= 3); // ignore "to", "the", "for"
  return new Set(tokens);
}

/**
 * Token-overlap score = |intersection| / min(|a|, |b|). We use min rather
 * than union (Jaccard) so a bank line like "ACH DEPOSIT ACME CORP"
 * scores highly against a chattier ledger description like
 * "Payment from Acme Corp invoice #123" — the brand-name signal that
 * matters survives even when one side has more boilerplate words.
 * Threshold ≥ 0.5 is the auto-match cutoff (audit §6).
 */
export function descriptionOverlap(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersect = 0;
  for (const t of ta) if (tb.has(t)) intersect += 1;
  const denom = Math.min(ta.size, tb.size);
  return denom === 0 ? 0 : intersect / denom;
}

export interface MatchCandidate {
  bankTransactionId: string;
  bankDate: Date;
  bankAmount: Prisma.Decimal;
  bankDescription: string;
  bankReference: string | null;
  ledger: Array<{
    transactionId: string;
    date: Date;
    amount: Prisma.Decimal;
    description: string | null;
    reference: string | null;
    score: number;
  }>;
}

export interface AutoMatchResult {
  scanned: number;
  matched: number;
  ambiguous: number;
}

/**
 * FIN6 — Rule-based, deterministic auto-matcher between BankTransaction
 * rows and ledger FinancialTransactions on the same FinancialAccount.
 * Match rules (audit §6):
 *   - Amount equal within ±0.01
 *   - Bank date within ±3 days of ledger date
 *   - Either (a) reference equality OR (b) description-token overlap ≥ 0.5
 *   - Ledger transaction not already matched, not REVERSED/VOID
 * Idempotent — re-running on the same data is a no-op.
 */
@Injectable()
export class BankMatchingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FinanceAuditService) private readonly audit: FinanceAuditService,
  ) {}

  /** Resolve the ChartOfAccount.id this FinancialAccount posts against. */
  private async resolveCoaId(businessId: string, accountId: string): Promise<string> {
    const acc = await this.prisma.client.financialAccount.findFirst({
      where: { id: accountId, businessId },
      select: { chartOfAccountId: true },
    });
    if (!acc) throw new NotFoundException('Bank account not found');
    return acc.chartOfAccountId;
  }

  /**
   * Load candidate ledger transactions touching the bank account's COA in
   * the period of interest, that aren't already pointed at by a
   * BankTransaction.matchedTransactionId.
   */
  private async loadLedgerCandidates(
    businessId: string,
    accountId: string,
    sinceDate: Date | null,
    untilDate: Date | null,
  ) {
    const coaId = await this.resolveCoaId(businessId, accountId);
    // Pad the candidate window by DATE_WINDOW_DAYS so a bank row at the
    // edge of the period can still see ledger entries just outside it.
    const padMs = DATE_WINDOW_DAYS * 86400 * 1000;
    const dateFilter: Prisma.LedgerEntryWhereInput['date'] = {};
    if (sinceDate) dateFilter.gte = new Date(sinceDate.getTime() - padMs);
    if (untilDate) dateFilter.lte = new Date(untilDate.getTime() + padMs);

    const entries = await this.prisma.client.ledgerEntry.findMany({
      where: {
        businessId,
        accountId: coaId,
        ...(sinceDate || untilDate ? { date: dateFilter } : {}),
        transaction: { status: 'POSTED' },
      },
      include: {
        transaction: {
          select: {
            id: true, date: true, amount: true, description: true, reference: true, status: true,
          },
        },
      },
    });

    // Already-matched transactionIds — exclude.
    const txnIds = Array.from(new Set(entries.map((e) => e.transactionId)));
    if (txnIds.length === 0) return [];
    const alreadyMatched = await this.prisma.client.bankTransaction.findMany({
      where: { businessId, accountId, matchedTransactionId: { in: txnIds }, status: 'MATCHED' },
      select: { matchedTransactionId: true },
    });
    const matchedSet = new Set(alreadyMatched.map((m) => m.matchedTransactionId));

    // Compute the net signed effect on the bank COA per transaction so we
    // can match against the bank tx amount sign (deposit > 0, withdrawal < 0).
    const byTxn = new Map<string, { netDebit: Prisma.Decimal; date: Date; description: string | null; reference: string | null }>();
    for (const e of entries) {
      const cur = byTxn.get(e.transactionId);
      const debit = new D(String(e.debit));
      const credit = new D(String(e.credit));
      const net = debit.sub(credit);
      if (cur) {
        cur.netDebit = cur.netDebit.add(net);
      } else {
        byTxn.set(e.transactionId, {
          netDebit: net,
          date: e.transaction.date,
          description: e.transaction.description,
          reference: e.transaction.reference,
        });
      }
    }

    return Array.from(byTxn.entries())
      .filter(([id]) => !matchedSet.has(id))
      .map(([transactionId, v]) => ({
        transactionId,
        date: v.date,
        signedAmount: v.netDebit,
        description: v.description,
        reference: v.reference,
      }))
      // Stable order so auto-match scoring ties are always broken the
      // same way across runs.
      .sort((a, b) => {
        const d = a.date.getTime() - b.date.getTime();
        if (d !== 0) return d;
        return a.transactionId < b.transactionId ? -1 : a.transactionId > b.transactionId ? 1 : 0;
      });
  }

  /**
   * Run the auto-matcher across UNMATCHED bank transactions on the
   * account, optionally restricted to a window. Returns counts; per-row
   * details are auditable via FinanceAuditService logs.
   */
  async autoMatch(
    businessId: string,
    accountId: string,
    opts: { sinceDate?: Date | null; untilDate?: Date | null; userId?: string | null } = {},
  ): Promise<AutoMatchResult> {
    const where: Prisma.BankTransactionWhereInput = {
      businessId,
      accountId,
      status: 'UNMATCHED',
    };
    if (opts.sinceDate || opts.untilDate) {
      where.date = {};
      if (opts.sinceDate) (where.date as Prisma.DateTimeFilter).gte = opts.sinceDate;
      if (opts.untilDate) (where.date as Prisma.DateTimeFilter).lte = opts.untilDate;
    }
    // Deterministic processing order: oldest first, then by id, so two
    // bank rows competing for the same ledger candidate always resolve
    // the same way regardless of insertion order.
    const bankRows = await this.prisma.client.bankTransaction.findMany({
      where,
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });
    if (bankRows.length === 0) return { scanned: 0, matched: 0, ambiguous: 0 };

    const candidates = await this.loadLedgerCandidates(
      businessId,
      accountId,
      opts.sinceDate ?? null,
      opts.untilDate ?? null,
    );

    let matched = 0;
    let ambiguous = 0;
    // Track which ledger txns we've already paired this run so two bank
    // rows don't claim the same FinancialTransaction.
    const claimed = new Set<string>();

    for (const bank of bankRows) {
      const bankAmt = new D(String(bank.amount));
      const bankRef = (bank.reference ?? '').trim().toLowerCase();

      const within: Array<{ id: string; score: number; refMatch: boolean }> = [];
      for (const c of candidates) {
        if (claimed.has(c.transactionId)) continue;
        if (c.signedAmount.sub(bankAmt).abs().gt(AMOUNT_TOLERANCE)) continue;
        const days = Math.abs((bank.date.getTime() - c.date.getTime()) / 86400000);
        if (days > DATE_WINDOW_DAYS) continue;
        const refMatch = !!bankRef && (c.reference ?? '').trim().toLowerCase() === bankRef;
        const overlap = descriptionOverlap(bank.description, c.description ?? '');
        if (!refMatch && overlap < 0.5) continue;
        // Score: reference is the strongest signal, then closer date wins.
        const score = (refMatch ? 1 : 0) + overlap - days * 0.05;
        within.push({ id: c.transactionId, score, refMatch });
      }

      if (within.length === 0) continue;
      // Sort by score desc, then ledger id asc as a deterministic tie-break.
      within.sort((a, b) => (b.score - a.score) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const top = within[0];
      const second = within[1];
      // If the top two are tied within 0.05 we treat it as ambiguous and
      // leave it for a human to resolve in the UI.
      if (second && Math.abs(top.score - second.score) < 0.05) {
        ambiguous += 1;
        continue;
      }
      claimed.add(top.id);
      await this.prisma.client.bankTransaction.update({
        where: { id: bank.id },
        data: { matchedTransactionId: top.id, status: 'MATCHED' },
      });
      await this.audit.log({
        businessId,
        userId: opts.userId ?? null,
        action: 'BANK_TRANSACTION_MATCHED',
        entityType: 'BankTransaction',
        entityId: bank.id,
        title: `Auto-matched bank row to ledger ${top.id}`,
        detail: bank.description,
        meta: { transactionId: top.id, refMatch: top.refMatch, score: top.score },
      });
      matched += 1;
    }

    return { scanned: bankRows.length, matched, ambiguous };
  }

  /** Manual click-to-match. */
  async manualMatch(
    businessId: string,
    bankTransactionId: string,
    transactionId: string,
    userId?: string | null,
  ) {
    const bank = await this.prisma.client.bankTransaction.findFirst({
      where: { id: bankTransactionId, businessId },
    });
    if (!bank) throw new NotFoundException('Bank transaction not found');
    if (bank.status === 'MATCHED' && bank.matchedTransactionId) {
      throw new ConflictException('Bank transaction is already matched');
    }
    const txn = await this.prisma.client.financialTransaction.findFirst({
      where: { id: transactionId, businessId },
      select: { id: true, status: true },
    });
    if (!txn) throw new NotFoundException('Ledger transaction not found');
    if (txn.status !== 'POSTED') {
      throw new BadRequestException('Cannot match against a reversed/void ledger entry');
    }
    // INTEGRITY: a manual match is only valid if the chosen ledger
    // transaction actually touches the bank account's chart-of-account.
    // Without this guard the UI/API could pair a bank row to an unrelated
    // posting (e.g. a payroll entry against a different COA), which would
    // satisfy reconciliation completion but produce a meaningless lock.
    const coaId = await this.resolveCoaId(businessId, bank.accountId);
    const onAccount = await this.prisma.client.ledgerEntry.findFirst({
      where: { businessId, transactionId, accountId: coaId },
      select: { id: true },
    });
    if (!onAccount) {
      throw new BadRequestException(
        'Selected ledger transaction does not post to this bank account',
      );
    }
    // Only one bank row may claim a given ledger txn at a time.
    const existingClaim = await this.prisma.client.bankTransaction.findFirst({
      where: { businessId, matchedTransactionId: transactionId, status: 'MATCHED', id: { not: bankTransactionId } },
      select: { id: true },
    });
    if (existingClaim) {
      throw new ConflictException('That ledger entry is already matched to another bank row');
    }
    const updated = await this.prisma.client.bankTransaction.update({
      where: { id: bankTransactionId },
      data: { matchedTransactionId: transactionId, status: 'MATCHED' },
    });
    await this.audit.log({
      businessId,
      userId: userId ?? null,
      action: 'BANK_TRANSACTION_MATCHED',
      entityType: 'BankTransaction',
      entityId: bankTransactionId,
      title: `Manually matched bank row to ledger ${transactionId}`,
      meta: { transactionId, manual: true },
    });
    return updated;
  }

  async unmatch(businessId: string, bankTransactionId: string, userId?: string | null) {
    const bank = await this.prisma.client.bankTransaction.findFirst({
      where: { id: bankTransactionId, businessId },
    });
    if (!bank) throw new NotFoundException('Bank transaction not found');
    const updated = await this.prisma.client.bankTransaction.update({
      where: { id: bankTransactionId },
      data: { matchedTransactionId: null, status: 'UNMATCHED' },
    });
    await this.audit.log({
      businessId,
      userId: userId ?? null,
      action: 'BANK_TRANSACTION_UNMATCHED',
      entityType: 'BankTransaction',
      entityId: bankTransactionId,
      title: 'Unmatched bank row',
      meta: { previousTransactionId: bank.matchedTransactionId },
    });
    return updated;
  }

  async ignore(businessId: string, bankTransactionId: string, userId?: string | null) {
    const bank = await this.prisma.client.bankTransaction.findFirst({
      where: { id: bankTransactionId, businessId },
    });
    if (!bank) throw new NotFoundException('Bank transaction not found');
    const updated = await this.prisma.client.bankTransaction.update({
      where: { id: bankTransactionId },
      data: { status: 'IGNORED', matchedTransactionId: null },
    });
    await this.audit.log({
      businessId,
      userId: userId ?? null,
      action: 'BANK_TRANSACTION_IGNORED',
      entityType: 'BankTransaction',
      entityId: bankTransactionId,
      title: 'Ignored bank row',
      detail: bank.description,
    });
    return updated;
  }

  /** Split-view payload for the UI. */
  async getSplitView(businessId: string, accountId: string, opts: { sinceDate?: Date | null; untilDate?: Date | null } = {}) {
    const where: Prisma.BankTransactionWhereInput = { businessId, accountId };
    if (opts.sinceDate || opts.untilDate) {
      where.date = {};
      if (opts.sinceDate) (where.date as Prisma.DateTimeFilter).gte = opts.sinceDate;
      if (opts.untilDate) (where.date as Prisma.DateTimeFilter).lte = opts.untilDate;
    }
    const bankRows = await this.prisma.client.bankTransaction.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    const ledger = await this.loadLedgerCandidates(
      businessId,
      accountId,
      opts.sinceDate ?? null,
      opts.untilDate ?? null,
    );
    return {
      bankTransactions: bankRows.map((b) => ({
        id: b.id,
        date: b.date.toISOString(),
        description: b.description,
        amount: Number(b.amount),
        reference: b.reference,
        status: b.status,
        matchedTransactionId: b.matchedTransactionId,
      })),
      ledgerCandidates: ledger
        .sort((a, b) => b.date.getTime() - a.date.getTime())
        .slice(0, 500)
        .map((c) => ({
          transactionId: c.transactionId,
          date: c.date.toISOString(),
          amount: Number(c.signedAmount),
          description: c.description,
          reference: c.reference,
        })),
    };
  }
}
