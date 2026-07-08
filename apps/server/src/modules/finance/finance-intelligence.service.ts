import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { RevenueActionService } from '../commerce/revenue-action.service';
import { CommandService } from '../command/command.service';

/**
 * FIN8 — Finance intelligence detectors. Eight deterministic detectors
 * mirrored into the existing RevenueAction queue (via
 * RevenueActionService.upsertExternal) so the same items also surface in
 * KEYFLOW Today / R3.
 *
 * Only the daily insight strip uses the LLM (Multi-Model AI Gateway via
 * AiUsageService); the deterministic copy is always returned if the
 * model call fails or times out.
 */

export type FinDetectorKind =
  | 'CASHFLOW_RISK'
  | 'SLOW_PAYER'
  | 'MARGIN_DECLINE'
  | 'OVERSPENDING'
  | 'MISSING_RECEIPT'
  | 'UNCATEGORISED'
  | 'TAX_RESERVE_GAP'
  | 'DUPLICATE_EXPENSE';

export type FinSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

interface Detection {
  kind: FinDetectorKind;
  severity: FinSeverity;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
  recommendedAction?: string | null;
  amount?: number | null;
  evidence?: Record<string, unknown> | null;
}

export interface FinanceActionItemDto {
  id: string;
  kind: FinDetectorKind | string;
  severity: FinSeverity | string;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  recommendedAction: string | null;
  amount: number | null;
  evidence: unknown;
  status: string;
  detectedAt: string;
  resolvedAt: string | null;
}

export interface FinanceInsightStrip {
  headline: string;
  body: string;
  source: 'ai' | 'deterministic';
  generatedAt: string;
  cacheKey: string;
}

interface InsightCacheEntry {
  expiresAt: number;
  value: FinanceInsightStrip;
}

const MS_DAY = 24 * 3600 * 1000;
const TRINIDAD_OFFSET_MS = 4 * 3600 * 1000;

function trinidadDayKey(now: Date): string {
  const t = new Date(now.getTime() - TRINIDAD_OFFSET_MS);
  return t.toISOString().slice(0, 10);
}

function trinidadMonthStart(now: Date, monthsBack = 0): Date {
  const t = new Date(now.getTime() - TRINIDAD_OFFSET_MS);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - monthsBack, 1, 4, 0, 0, 0));
}

@Injectable()
export class FinanceIntelligenceService {
  private readonly logger = new Logger(FinanceIntelligenceService.name);
  private readonly insightCache = new Map<string, InsightCacheEntry>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(forwardRef(() => RevenueActionService))
    private readonly revenueActions: RevenueActionService,
    @Inject(CommandService)
    private readonly commandService: CommandService,
  ) {}

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  async list(
    businessId: string,
    opts: { status?: string; kind?: string } = {},
  ): Promise<FinanceActionItemDto[]> {
    const where: Prisma.FinanceActionItemWhereInput = { businessId };
    if (opts.status) where.status = opts.status;
    else where.status = 'OPEN';
    if (opts.kind) where.kind = opts.kind;
    const rows = await this.prisma.client.financeActionItem.findMany({
      where,
      orderBy: [{ amount: 'desc' }, { detectedAt: 'desc' }],
      take: 100,
    });
    const sevWeight: Record<string, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    rows.sort((a, b) => {
      const w = (sevWeight[a.severity] ?? 9) - (sevWeight[b.severity] ?? 9);
      if (w !== 0) return w;
      return Number(b.amount ?? 0) - Number(a.amount ?? 0);
    });
    return rows.map((r) => this.toDto(r));
  }

  async resolve(
    businessId: string,
    id: string,
    userId: string,
    resolution?: string | null,
  ): Promise<FinanceActionItemDto> {
    const row = await this.prisma.client.financeActionItem.findFirst({
      where: { id, businessId },
    });
    if (!row) throw new Error('Finance action item not found');
    const updated = await this.prisma.client.financeActionItem.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedBy: userId,
        resolution: resolution ?? null,
      },
    });
    if (row.mirroredActionId) {
      await this.prisma.client.revenueAction
        .update({
          where: { id: row.mirroredActionId },
          data: { status: 'COMPLETED', completedAt: new Date() },
        })
        .catch(() => undefined);
    }
    // Resolve linked CommandItem
    await this.dismissCommandItem(businessId, row, 'COMPLETED');
    return this.toDto(updated);
  }

  async dismiss(businessId: string, id: string, userId: string): Promise<FinanceActionItemDto> {
    const row = await this.prisma.client.financeActionItem.findFirst({
      where: { id, businessId },
    });
    if (!row) throw new Error('Finance action item not found');
    const updated = await this.prisma.client.financeActionItem.update({
      where: { id },
      data: { status: 'DISMISSED', resolvedAt: new Date(), resolvedBy: userId },
    });
    if (row.mirroredActionId) {
      await this.prisma.client.revenueAction
        .update({ where: { id: row.mirroredActionId }, data: { status: 'DISMISSED' } })
        .catch(() => undefined);
    }
    // Dismiss linked CommandItem
    await this.dismissCommandItem(businessId, row);
    return this.toDto(updated);
  }

  // ------------------------------------------------------------------
  // Scan — runs all 8 detectors, persists FinanceActionItem rows, and
  // mirrors each open detection into RevenueAction via RevenueActionService.
  // Idempotent via the (businessId, kind, entityType, entityId) unique
  // key. Detections that no longer fire are flagged SUPERSEDED so the
  // queue self-heals without manual cleanup.
  // ------------------------------------------------------------------

  async scan(businessId: string): Promise<{ created: number; refreshed: number; superseded: number }> {
    const now = new Date();
    const detections: Detection[] = [];
    for (const fn of [
      this.detectCashflowRisk.bind(this),
      this.detectSlowPayer.bind(this),
      this.detectMarginDecline.bind(this),
      this.detectOverspending.bind(this),
      this.detectMissingReceipt.bind(this),
      this.detectUncategorised.bind(this),
      this.detectTaxReserveGap.bind(this),
      this.detectDuplicateExpense.bind(this),
    ]) {
      try {
        const found = await fn(businessId, now);
        detections.push(...found);
      } catch (e) {
        this.logger.warn(`detector failed: ${(e as Error).message}`);
      }
    }

    let created = 0;
    let refreshed = 0;
    const seenKeys = new Set<string>();
    for (const d of detections) {
      const key = `${d.kind}::${d.entityType ?? ''}::${d.entityId ?? ''}`;
      seenKeys.add(key);
      const wasNew = await this.upsertOne(businessId, d, now);
      if (wasNew) created++;
      else refreshed++;
    }

    // Self-heal: any OPEN row this scan didn't touch is no longer a
    // live detection — mark SUPERSEDED so the queue empties cleanly.
    const open = await this.prisma.client.financeActionItem.findMany({
      where: { businessId, status: 'OPEN' },
      select: { id: true, kind: true, entityType: true, entityId: true, mirroredActionId: true },
    });
    let superseded = 0;
    for (const row of open) {
      const key = `${row.kind}::${row.entityType ?? ''}::${row.entityId ?? ''}`;
      if (seenKeys.has(key)) continue;
      await this.prisma.client.financeActionItem.update({
        where: { id: row.id },
        data: { status: 'SUPERSEDED', resolvedAt: now },
      });
      if (row.mirroredActionId) {
        await this.prisma.client.revenueAction
          .update({ where: { id: row.mirroredActionId }, data: { status: 'COMPLETED', completedAt: now } })
          .catch(() => undefined);
      }
      superseded++;
    }
    if (created + refreshed + superseded > 0) {
      this.logger.log(
        `[FIN8] scan(${businessId}): +${created} new, ${refreshed} refreshed, ${superseded} superseded`,
      );
    }
    return { created, refreshed, superseded };
  }

  // ------------------------------------------------------------------
  // Detectors — thresholds per FIN8 spec.
  // ------------------------------------------------------------------

  /**
   * CASHFLOW_RISK: cash runway < 30 days, computed off the trailing
   * 90-day burn rate.
   */
  private async detectCashflowRisk(businessId: string, now: Date): Promise<Detection[]> {
    const ninetyAgo = new Date(now.getTime() - 90 * MS_DAY);
    const [accounts, ninetyExp] = await Promise.all([
      this.prisma.client.financialAccount.findMany({
        where: { businessId, isActive: true, type: { in: ['CASH', 'BANK', 'PAYMENT_PROCESSOR'] } },
        select: { currentBalance: true },
      }),
      this.prisma.client.expense.aggregate({
        where: { businessId, deletedAt: null, date: { gte: ninetyAgo, lt: now } },
        _sum: { amount: true },
      }),
    ]);
    const cash = accounts.reduce((s, a) => s + Number(a.currentBalance ?? 0), 0);
    const dailyBurn = Number(ninetyExp._sum.amount ?? 0) / 90;
    if (dailyBurn <= 0) return [];
    const days = cash / dailyBurn;
    if (days >= 30) return [];
    const severity: FinSeverity = days < 14 ? 'CRITICAL' : 'WARNING';
    return [{
      kind: 'CASHFLOW_RISK',
      severity,
      title: `Low cash runway — ~${days.toFixed(0)} days`,
      body: `Cash ${cash.toFixed(2)} against ${dailyBurn.toFixed(2)}/day burn (90-day average). Runway is under 30 days.`,
      entityType: 'business',
      entityId: businessId,
      recommendedAction: '/app/finance/cashflow',
      amount: cash,
      evidence: { cash, dailyBurn: Math.round(dailyBurn * 100) / 100, days: Math.round(days) },
    }];
  }

  /**
   * SLOW_PAYER: a customer with more than 2 invoices that are >30 days
   * past their due date.
   */
  private async detectSlowPayer(businessId: string, now: Date): Promise<Detection[]> {
    const thirtyAgo = new Date(now.getTime() - 30 * MS_DAY);
    const grouped = await this.prisma.client.invoice.groupBy({
      by: ['contactId'],
      where: {
        businessId,
        deletedAt: null,
        status: 'OVERDUE',
        dueDate: { lt: thirtyAgo },
      },
      _count: { _all: true },
      _sum: { total: true },
      take: 100,
    });
    const filtered = (grouped as Array<{
      contactId: string | null;
      _count: { _all: number };
      _sum: { total: number | null };
    }>).filter((g) => g._count._all > 2).slice(0, 10);
    const out: Detection[] = [];
    for (const g of filtered) {
      if (!g.contactId) continue;
      const c = await this.prisma.client.contact.findUnique({
        where: { id: g.contactId },
        select: { firstName: true, lastName: true, displayName: true, email: true },
      });
      const name =
        (c?.displayName ?? `${c?.firstName ?? ''} ${c?.lastName ?? ''}`.trim()) || c?.email || 'Customer';
      const total = Number(g._sum.total ?? 0);
      out.push({
        kind: 'SLOW_PAYER',
        severity: g._count._all >= 5 ? 'CRITICAL' : 'WARNING',
        title: `Slow payer: ${name}`,
        body: `${name} has ${g._count._all} invoices more than 30 days overdue, totalling ${total.toFixed(2)}.`,
        entityType: 'contact',
        entityId: g.contactId,
        recommendedAction: `/app/crm/contacts/${g.contactId}?action=remind`,
        amount: total,
        evidence: { overdueCount: g._count._all, overdueTotal: total },
      });
    }
    return out;
  }

  /**
   * MARGIN_DECLINE: per product, the gross margin % over the last 30 days
   * dropped by >15 percentage points vs the prior 30 days. Cost is sourced
   * from `ProductCostProfile.landedCostEstimate` × line quantity (skip
   * products without a cost profile so we don't false-positive on services).
   */
  private async detectMarginDecline(businessId: string, now: Date): Promise<Detection[]> {
    const thirtyAgo = new Date(now.getTime() - 30 * MS_DAY);
    const sixtyAgo = new Date(now.getTime() - 60 * MS_DAY);
    const items = await this.prisma.client.invoiceItem.findMany({
      where: {
        invoice: {
          businessId,
          deletedAt: null,
          status: { in: ['PAID', 'SENT', 'PARTIAL'] },
          issueDate: { gte: sixtyAgo },
        },
        productId: { not: null },
      },
      select: {
        productId: true,
        quantity: true,
        total: true,
        invoice: { select: { issueDate: true } },
      },
      take: 5000,
    });
    if (items.length === 0) return [];
    const productIds = Array.from(new Set(items.map((i) => i.productId).filter((x): x is string => !!x)));
    const [costProfiles, products] = await Promise.all([
      this.prisma.client.productCostProfile.findMany({
        where: { productId: { in: productIds } },
        select: { productId: true, landedCostEstimate: true },
      }),
      this.prisma.client.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true },
      }),
    ]);
    const costMap = new Map(costProfiles.map((c) => [c.productId, Number(c.landedCostEstimate ?? 0)]));
    const nameMap = new Map(products.map((p) => [p.id, p.name]));
    type Bucket = { recentRev: number; recentCost: number; priorRev: number; priorCost: number };
    const byProduct = new Map<string, Bucket>();
    for (const it of items) {
      if (!it.productId || !it.invoice?.issueDate) continue;
      const unitCost = costMap.get(it.productId);
      if (!unitCost || unitCost <= 0) continue; // no cost profile → can't compute margin
      const b = byProduct.get(it.productId) ?? { recentRev: 0, recentCost: 0, priorRev: 0, priorCost: 0 };
      const lineCost = unitCost * Number(it.quantity ?? 0);
      const lineRev = Number(it.total ?? 0);
      if (it.invoice.issueDate >= thirtyAgo) {
        b.recentRev += lineRev;
        b.recentCost += lineCost;
      } else {
        b.priorRev += lineRev;
        b.priorCost += lineCost;
      }
      byProduct.set(it.productId, b);
    }
    const out: Detection[] = [];
    for (const [productId, b] of byProduct.entries()) {
      if (b.priorRev < 100 || b.recentRev < 100) continue; // need both windows to be meaningful
      const priorMargin = (b.priorRev - b.priorCost) / b.priorRev;
      const recentMargin = (b.recentRev - b.recentCost) / b.recentRev;
      const dropPp = (priorMargin - recentMargin) * 100; // percentage-point drop
      if (dropPp <= 15) continue;
      const lostMargin = (priorMargin - recentMargin) * b.recentRev;
      const productName = nameMap.get(productId) ?? 'Item';
      out.push({
        kind: 'MARGIN_DECLINE',
        severity: dropPp > 30 ? 'CRITICAL' : 'WARNING',
        title: `Margin down ${dropPp.toFixed(0)}pp — ${productName}`,
        body: `${productName} gross margin fell from ${(priorMargin * 100).toFixed(1)}% to ${(recentMargin * 100).toFixed(1)}% over the last 30 days (cost basis: landed cost × qty). Review pricing and supplier cost.`,
        entityType: 'product',
        entityId: productId,
        recommendedAction: `/app/finance/reports?productId=${productId}`,
        amount: Math.max(0, Math.round(lostMargin * 100) / 100),
        evidence: {
          recent30d: { revenue: Math.round(b.recentRev * 100) / 100, cost: Math.round(b.recentCost * 100) / 100, marginPct: Math.round(recentMargin * 1000) / 10 },
          prior30d: { revenue: Math.round(b.priorRev * 100) / 100, cost: Math.round(b.priorCost * 100) / 100, marginPct: Math.round(priorMargin * 1000) / 10 },
          marginDropPp: Math.round(dropPp * 10) / 10,
        },
      });
    }
    return out;
  }

  /**
   * OVERSPENDING: actual category expense for the current month is
   * >120% of the configured ExpenseBudget for that category/month.
   */
  private async detectOverspending(businessId: string, now: Date): Promise<Detection[]> {
    const monthStart = trinidadMonthStart(now);
    const t = new Date(now.getTime() - TRINIDAD_OFFSET_MS);
    const month = t.getUTCMonth() + 1;
    const year = t.getUTCFullYear();
    const budgets = await this.prisma.client.expenseBudget.findMany({
      where: { businessId, month, year, categoryId: { not: null } },
      select: { categoryId: true, amount: true },
    });
    if (budgets.length === 0) return [];
    const ids = budgets.map((b) => b.categoryId).filter((x): x is string => !!x);
    const actuals = await this.prisma.client.expense.groupBy({
      by: ['categoryId'],
      where: { businessId, deletedAt: null, date: { gte: monthStart }, categoryId: { in: ids } },
      _sum: { amount: true },
    });
    const actualMap = new Map(
      actuals.map((g) => [g.categoryId, Number(g._sum.amount ?? 0)]),
    );
    const cats = await this.prisma.client.expenseCategory.findMany({
      where: { businessId, id: { in: ids } },
      select: { id: true, name: true },
    });
    const nameMap = new Map(cats.map((c) => [c.id, c.name]));
    const out: Detection[] = [];
    for (const b of budgets) {
      if (!b.categoryId) continue;
      const budget = Number(b.amount ?? 0);
      if (budget <= 0) continue;
      const actual = actualMap.get(b.categoryId) ?? 0;
      const ratio = actual / budget;
      if (ratio < 1.2) continue;
      const overshoot = actual - budget;
      out.push({
        kind: 'OVERSPENDING',
        severity: ratio > 1.5 ? 'CRITICAL' : 'WARNING',
        title: `Over budget: ${nameMap.get(b.categoryId) ?? 'Category'}`,
        body: `${nameMap.get(b.categoryId) ?? 'This category'} is at ${actual.toFixed(2)} this month against a ${budget.toFixed(2)} budget — ${Math.round((ratio - 1) * 100)}% over.`,
        entityType: 'category',
        entityId: b.categoryId,
        recommendedAction: `/app/finance/expenses?categoryId=${b.categoryId}`,
        amount: overshoot,
        evidence: { actual, budget, ratio: Math.round(ratio * 100) / 100 },
      });
    }
    return out;
  }

  /**
   * MISSING_RECEIPT: a paid expense over $100 has no receipt attached
   * and is at least 7 days old.
   */
  private async detectMissingReceipt(businessId: string, now: Date): Promise<Detection[]> {
    const sevenAgo = new Date(now.getTime() - 7 * MS_DAY);
    const rows = await this.prisma.client.expense.findMany({
      where: {
        businessId,
        deletedAt: null,
        receiptUrl: null,
        amount: { gt: 100 },
        status: 'PAID',
        date: { lte: sevenAgo },
      },
      orderBy: [{ amount: 'desc' }],
      take: 25,
      select: { id: true, amount: true, vendor: true, date: true },
    });
    return rows.map<Detection>((e) => ({
      kind: 'MISSING_RECEIPT',
      severity: Number(e.amount) >= 500 ? 'WARNING' : 'INFO',
      title: `Attach receipt — ${e.vendor ?? 'Unknown vendor'}`,
      body: `Paid expense of ${Number(e.amount).toFixed(2)} on ${e.date.toISOString().slice(0, 10)} has no receipt attached after 7+ days.`,
      entityType: 'expense',
      entityId: e.id,
      recommendedAction: `/app/finance/expenses?id=${e.id}&action=upload-receipt`,
      amount: Number(e.amount),
      evidence: { vendor: e.vendor, date: e.date.toISOString() },
    }));
  }

  /**
   * UNCATEGORISED: expenses with no category set, >14 days old, plus
   * still-unmatched bank transactions older than 14 days.
   */
  private async detectUncategorised(businessId: string, now: Date): Promise<Detection[]> {
    const fourteenAgo = new Date(now.getTime() - 14 * MS_DAY);
    const [exp, bankTx] = await Promise.all([
      this.prisma.client.expense.findMany({
        where: {
          businessId,
          deletedAt: null,
          categoryId: null,
          date: { lte: fourteenAgo },
        },
        orderBy: [{ amount: 'desc' }],
        take: 25,
        select: { id: true, amount: true, vendor: true, date: true },
      }),
      this.prisma.client.bankTransaction.findMany({
        where: {
          businessId,
          status: 'UNMATCHED',
          date: { lte: fourteenAgo },
        },
        orderBy: [{ amount: 'desc' }],
        take: 25,
        select: { id: true, amount: true, description: true, date: true },
      }),
    ]);
    const out: Detection[] = exp.map((e) => ({
      kind: 'UNCATEGORISED',
      severity: 'INFO',
      title: `Categorise expense — ${e.vendor ?? 'Unknown vendor'}`,
      body: `Expense of ${Number(e.amount).toFixed(2)} from ${e.date.toISOString().slice(0, 10)} still has no category after 14+ days.`,
      entityType: 'expense',
      entityId: e.id,
      recommendedAction: `/app/finance/expenses?id=${e.id}&action=categorise`,
      amount: Number(e.amount),
      evidence: { vendor: e.vendor, date: e.date.toISOString() },
    }));
    for (const tx of bankTx) {
      out.push({
        kind: 'UNCATEGORISED',
        severity: 'INFO',
        title: `Unmatched bank transaction — ${tx.description.slice(0, 50)}`,
        body: `Bank transaction of ${Number(tx.amount).toFixed(2)} from ${tx.date.toISOString().slice(0, 10)} is still unmatched after 14+ days. Reconcile to assign it.`,
        entityType: 'bank_transaction',
        entityId: tx.id,
        recommendedAction: `/app/finance/reconciliation?txId=${tx.id}`,
        amount: Number(tx.amount),
        evidence: { description: tx.description, date: tx.date.toISOString() },
      });
    }
    return out;
  }

  /**
   * TAX_RESERVE_GAP: tax-collected balance (TAX_PAYABLE liability) is
   * larger than the cash sitting in `FinancialAccount.type = 'TAX'` —
   * the canonical "tax reserve" bucket per the FinancialAccount.type
   * enum. We use that linkage (not a name regex) so the detector
   * matches the configured source of truth.
   */
  private async detectTaxReserveGap(businessId: string, now: Date): Promise<Detection[]> {
    void now;
    const taxAcc = await this.prisma.client.chartOfAccount.findFirst({
      where: { businessId, systemKey: 'TAX_PAYABLE' },
      select: { id: true },
    });
    let collected = 0;
    if (taxAcc) {
      const agg = await this.prisma.client.ledgerEntry.aggregate({
        where: { accountId: taxAcc.id },
        _sum: { debit: true, credit: true },
      });
      // Liability: credits - debits is what we owe (tax we've collected).
      collected = Number(agg._sum.credit ?? 0) - Number(agg._sum.debit ?? 0);
    }
    if (collected < 50) return [];
    const reserveAccounts = await this.prisma.client.financialAccount.findMany({
      where: { businessId, isActive: true, type: 'TAX' },
      select: { currentBalance: true },
    });
    const reserved = reserveAccounts.reduce((s, a) => s + Number(a.currentBalance ?? 0), 0);
    const gap = collected - reserved;
    if (gap <= 0) return [];
    return [{
      kind: 'TAX_RESERVE_GAP',
      severity: gap > collected * 0.5 ? 'CRITICAL' : 'WARNING',
      title: `Tax reserve short by ${gap.toFixed(2)}`,
      body: `You've collected ${collected.toFixed(2)} in taxes but only ${reserved.toFixed(2)} sits in a tax/reserve account. Move ${gap.toFixed(2)} aside before the next filing.`,
      entityType: 'business',
      entityId: businessId,
      recommendedAction: '/app/finance/tax',
      amount: gap,
      evidence: { collected, reserved, gap },
    }];
  }

  /**
   * DUPLICATE_EXPENSE: same vendor + same amount within 3 days.
   */
  private async detectDuplicateExpense(businessId: string, now: Date): Promise<Detection[]> {
    const threeDaysAgo = new Date(now.getTime() - 30 * MS_DAY); // pull a wider window then filter pairs to 3d
    const rows = await this.prisma.client.expense.findMany({
      where: { businessId, deletedAt: null, date: { gte: threeDaysAgo }, vendor: { not: null } },
      orderBy: [{ date: 'desc' }],
      take: 500,
      select: { id: true, amount: true, vendor: true, date: true },
    });
    const groups = new Map<string, Array<{ id: string; date: Date; amount: number }>>();
    for (const r of rows) {
      if (!r.vendor) continue;
      const key = `${r.vendor.toLowerCase().trim()}::${Number(r.amount).toFixed(2)}`;
      const arr = groups.get(key) ?? [];
      arr.push({ id: r.id, date: r.date, amount: Number(r.amount) });
      groups.set(key, arr);
    }
    const out: Detection[] = [];
    for (const arr of groups.values()) {
      if (arr.length < 2) continue;
      arr.sort((a, b) => b.date.getTime() - a.date.getTime());
      const [first, second] = arr;
      const daysApart = Math.abs(first.date.getTime() - second.date.getTime()) / MS_DAY;
      if (daysApart > 3) continue;
      out.push({
        kind: 'DUPLICATE_EXPENSE',
        severity: 'WARNING',
        title: `Possible duplicate expense`,
        body: `Found ${arr.length} expenses for the same vendor + amount (${first.amount.toFixed(2)}) within 3 days. Verify it isn't double-booked.`,
        entityType: 'expense',
        entityId: first.id,
        recommendedAction: `/app/finance/reconciliation?expenseId=${first.id}`,
        amount: first.amount,
        evidence: { duplicateIds: arr.map((a) => a.id), daysApart: Math.round(daysApart * 10) / 10 },
      });
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Persistence + R3 mirror (via RevenueActionService)
  // ------------------------------------------------------------------

  private async upsertOne(businessId: string, d: Detection, now: Date): Promise<boolean> {
    const entityType = d.entityType ?? '';
    const entityId = d.entityId ?? '';
    const evidenceJson: Prisma.InputJsonValue | typeof Prisma.JsonNull = d.evidence
      ? (d.evidence as Prisma.InputJsonValue)
      : Prisma.JsonNull;
    const existing = await this.prisma.client.financeActionItem.findUnique({
      where: {
        businessId_kind_entityType_entityId: {
          businessId, kind: d.kind, entityType, entityId,
        },
      },
    });
    let row;
    let isNew = false;
    if (existing) {
      // Don't reopen rows the user has resolved/dismissed manually.
      if (existing.status === 'RESOLVED' || existing.status === 'DISMISSED') return false;
      row = await this.prisma.client.financeActionItem.update({
        where: { id: existing.id },
        data: {
          severity: d.severity,
          title: d.title,
          body: d.body,
          recommendedAction: d.recommendedAction ?? null,
          amount: d.amount ?? null,
          evidence: evidenceJson,
          status: 'OPEN',
          lastSeenAt: now,
        },
      });
    } else {
      row = await this.prisma.client.financeActionItem.create({
        data: {
          businessId, kind: d.kind, severity: d.severity,
          title: d.title, body: d.body,
          entityType, entityId,
          recommendedAction: d.recommendedAction ?? null,
          amount: d.amount ?? null,
          evidence: evidenceJson,
        },
      });
      isNew = true;
    }
    // Mirror through RevenueActionService — preserves idempotency and
    // the "never resurrect a COMPLETED/DISMISSED row" guarantee.
    try {
      const mirrorType = `FIN_${d.kind}` as const;
      const result = await this.revenueActions.upsertExternal({
        businessId,
        type: mirrorType,
        title: d.title,
        detail: d.body,
        priority: d.severity === 'CRITICAL' ? 1 : d.severity === 'WARNING' ? 2 : 3,
        relatedType: entityType || 'finance',
        relatedId: entityId || row.id,
        amountAtRisk: d.amount ?? null,
      });
      if (result.actionId && row.mirroredActionId !== result.actionId) {
        await this.prisma.client.financeActionItem.update({
          where: { id: row.id },
          data: { mirroredActionId: result.actionId },
        });
      }
    } catch (e) {
      this.logger.warn(`mirror to RevenueAction failed: ${(e as Error).message}`);
    }
    // Mirror into CommandItem — universal command spine
    try {
      const actionType = `FIN8_${d.kind}`;
      const sourceType = entityType || 'finance_detection';
      const sourceId = entityId || row.id;
      const existingCommand = await this.prisma.client.commandItem.findUnique({
        where: {
          businessId_sourceModule_sourceType_sourceId_actionType: {
            businessId,
            sourceModule: 'finance',
            sourceType,
            sourceId,
            actionType,
          },
        },
      });
      const commandData = {
        businessId,
        sourceModule: 'finance',
        sourceType,
        sourceId,
        actionType,
        title: d.title,
        description: d.body,
        category: 'MONEY',
        priority: d.severity === 'CRITICAL' ? 90 : d.severity === 'WARNING' ? 70 : 40,
        urgency: d.severity === 'CRITICAL' ? 90 : d.severity === 'WARNING' ? 60 : 30,
        impactScore: d.amount ? Math.min(100, Math.round(Number(d.amount) / 100)) : 50,
        expectedValue: d.amount ? String(d.amount) : null,
        currency: 'TTD',
        riskTier: d.severity === 'CRITICAL' ? 3 : d.severity === 'WARNING' ? 2 : 1,
        requiresApproval: d.severity === 'CRITICAL',
        executableByKey: d.severity !== 'CRITICAL',
        executionTool: d.recommendedAction ?? undefined,
        recommendedBy: 'SYSTEM',
        entityType: sourceType,
        entityId: sourceId,
        status: 'OPEN' as const,
      };
      if (existingCommand) {
        // Don't reopen dismissed/completed commands
        if (existingCommand.status !== 'OPEN' && existingCommand.status !== 'WAITING_APPROVAL') {
          // leave it
        } else {
          await this.prisma.client.commandItem.update({
            where: { id: existingCommand.id },
            data: {
              title: commandData.title,
              description: commandData.description,
              priority: commandData.priority,
              urgency: commandData.urgency,
              impactScore: commandData.impactScore,
              expectedValue: commandData.expectedValue,
              riskTier: commandData.riskTier,
              requiresApproval: commandData.requiresApproval,
              status: 'OPEN',
            },
          });
        }
      } else {
        await this.prisma.client.commandItem.create({ data: commandData });
      }
    } catch (e) {
      this.logger.warn(`mirror to CommandItem failed: ${(e as Error).message}`);
    }
    return isNew;
  }

  private async dismissCommandItem(
    businessId: string,
    row: { kind: string; entityType: string | null; entityId: string | null; id: string },
    status: 'COMPLETED' | 'DISMISSED' = 'DISMISSED',
  ) {
    try {
      const actionType = `FIN8_${row.kind}`;
      const sourceType = row.entityType || 'finance_detection';
      const sourceId = row.entityId || row.id;
      const existing = await this.prisma.client.commandItem.findUnique({
        where: {
          businessId_sourceModule_sourceType_sourceId_actionType: {
            businessId,
            sourceModule: 'finance',
            sourceType,
            sourceId,
            actionType,
          },
        },
      });
      if (existing && (existing.status === 'OPEN' || existing.status === 'WAITING_APPROVAL')) {
        await this.prisma.client.commandItem.update({
          where: { id: existing.id },
          data: {
            status,
            dismissedAt: status === 'DISMISSED' ? new Date() : null,
            completedAt: status === 'COMPLETED' ? new Date() : null,
          },
        });
      }
    } catch (e) {
      this.logger.warn(`dismissCommandItem failed: ${(e as Error).message}`);
    }
  }

  private toDto(r: {
    id: string; kind: string; severity: string; title: string; body: string;
    entityType: string; entityId: string; recommendedAction: string | null;
    amount: Prisma.Decimal | number | null; evidence: unknown; status: string;
    detectedAt: Date; resolvedAt: Date | null;
  }): FinanceActionItemDto {
    return {
      id: r.id,
      kind: r.kind,
      severity: r.severity,
      title: r.title,
      body: r.body,
      entityType: r.entityType,
      entityId: r.entityId,
      recommendedAction: r.recommendedAction,
      amount: r.amount != null ? Number(r.amount) : null,
      evidence: r.evidence,
      status: r.status,
      detectedAt: r.detectedAt.toISOString(),
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    };
  }

  // ------------------------------------------------------------------
  // AI insight strip — cached per business per day. Always returns the
  // deterministic copy if the LLM call fails or times out (3s).
  // ------------------------------------------------------------------

  async getInsightStrip(businessId: string, now: Date = new Date()): Promise<FinanceInsightStrip> {
    const dayKey = trinidadDayKey(now);
    const cacheKey = `${businessId}::${dayKey}`;
    const cached = this.insightCache.get(cacheKey);
    if (cached && cached.expiresAt > now.getTime()) return cached.value;

    const items = await this.list(businessId, { status: 'OPEN' });
    const top = items.slice(0, 5);
    const deterministic = this.deterministicInsight(top);

    let value: FinanceInsightStrip = {
      headline: deterministic.headline,
      body: deterministic.body,
      source: 'deterministic',
      generatedAt: now.toISOString(),
      cacheKey,
    };

    if (top.length > 0) {
      try {
        const aiText = await this.callAiInsight(businessId, top);
        if (aiText) {
          const split = aiText.indexOf('\n');
          const headline = (split > 0 ? aiText.slice(0, split) : aiText).trim().slice(0, 120);
          const body = (split > 0 ? aiText.slice(split + 1) : '').trim().slice(0, 400) || deterministic.body;
          value = { headline, body, source: 'ai', generatedAt: now.toISOString(), cacheKey };
        }
      } catch (e) {
        this.logger.debug(`insight AI fallback: ${(e as Error).message}`);
      }
    }

    this.insightCache.set(cacheKey, { expiresAt: now.getTime() + MS_DAY, value });
    return value;
  }

  private deterministicInsight(top: FinanceActionItemDto[]): { headline: string; body: string } {
    if (top.length === 0) {
      return {
        headline: 'Finance is clear today.',
        body: 'No open detections from the eight automated checks. Cash, receivables, and tax reserves all look healthy.',
      };
    }
    const critical = top.filter((t) => t.severity === 'CRITICAL').length;
    const sumAtRisk = top.reduce((s, t) => s + (t.amount ?? 0), 0);
    const headline = critical > 0
      ? `${critical} critical finance item${critical === 1 ? '' : 's'} need attention`
      : `${top.length} finance item${top.length === 1 ? '' : 's'} to review`;
    const body = `Top issue: ${top[0].title}. Total exposure across the queue: ~${sumAtRisk.toFixed(2)}. Open the action queue for one-click resolutions.`;
    return { headline, body };
  }

  private async callAiInsight(
    businessId: string,
    top: FinanceActionItemDto[],
  ): Promise<string | null> {
    const lines = top
      .map((t, i) => `${i + 1}. [${t.severity}] ${t.kind} — ${t.title} (${t.body})`)
      .join('\n');
    const promise = this.aiUsage.callAi({
      businessId,
      feature: 'finance.insight',
      taskCategory: 'summarization',
      maxTokens: 220,
      temperature: 0.3,
      outputCategory: 'briefings',
      messages: [
        {
          role: 'system',
          content:
            'You are the finance copilot for a Caribbean small business. Write a concise daily strip: a single headline (under 12 words) on the first line, then a 1–2 sentence plain-English summary on the second line. No markdown, no JSON, no emojis. Use TTD currency framing.',
        },
        {
          role: 'user',
          content: `Open finance action items today:\n${lines}\n\nWrite the strip now.`,
        },
      ],
    });
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
    const result = await Promise.race([promise.then((r) => r.content), timeout]);
    return result ?? null;
  }
}
