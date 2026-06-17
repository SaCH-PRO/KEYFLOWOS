import { Inject, Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PostingService } from './posting.service';
import { ChartOfAccountsSeederService } from './chart-of-accounts-seeder.service';

const D = Prisma.Decimal;

/**
 * FIN3 — Posting recipes for expenses, bills, purchase orders, and the
 * cost-of-goods-sold leg that fires on product sales.
 *
 * Every method here is the *single* place that translates a domain event
 * (paid expense, bill paid, PO received, product sold) into a balanced
 * pair of ledger entries through PostingService. Direct LedgerEntry
 * inserts from anywhere else are still forbidden by FIN1 architectural
 * rules.
 *
 * All methods accept an optional `txClient` so callers can post in the
 * same `$transaction` as the source-row write — that's how we keep the
 * ledger atomically consistent with the business event (FIN2 same rule).
 */

/** Map an Expense.paymentMethod string to a Cash/Bank/CreditCard COA. */
export function paymentMethodToCoaSystemKey(method?: string | null): string {
  const m = (method ?? '').toLowerCase().trim();
  if (!m) return 'CASH';
  if (m === 'cash') return 'CASH';
  if (
    m === 'bank' ||
    m === 'bank_transfer' ||
    m === 'transfer' ||
    m === 'wire' ||
    m === 'ach' ||
    m === 'cheque' ||
    m === 'check'
  ) {
    return 'BANK';
  }
  if (m === 'credit_card' || m === 'card' || m === 'creditcard' || m === 'credit-card') {
    return 'CREDIT_CARD';
  }
  // wipay, paypal, stripe etc. clear through the payment-processor account.
  if (m === 'wipay' || m === 'paypal' || m === 'stripe' || m === 'processor') {
    return 'PAYMENT_PROCESSOR';
  }
  return 'CASH';
}

@Injectable()
export class ExpensePostingService {
  private readonly logger = new Logger(ExpensePostingService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(ChartOfAccountsSeederService) private readonly coa: ChartOfAccountsSeederService,
  ) {}

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  /**
   * Resolve the EXPENSE_* COA id for an expense. Order of precedence:
   *  1. Category.chartOfAccountId (set by ChartOfAccountsSeederService).
   *  2. Re-link the category by name pattern then re-read.
   *  3. EXPENSE_OTHER as the safe fallback.
   *
   * Always returns an id — never null — so callers can post unconditionally.
   */
  async resolveExpenseCoa(
    businessId: string,
    categoryId: string | null | undefined,
    txClient?: Prisma.TransactionClient,
  ): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx = txClient ? (txClient as any) : (this.prisma.client as any);
    if (categoryId) {
      const cat = await tx.expenseCategory.findUnique({
        where: { id: categoryId },
        select: { chartOfAccountId: true, businessId: true },
      });
      if (cat && cat.businessId === businessId && cat.chartOfAccountId) {
        return cat.chartOfAccountId;
      }
    }
    // Either no category or no link — make sure defaults exist and fall
    // back to EXPENSE_OTHER. This double-checks idempotently so the very
    // first posting on a brand-new business cannot fail with "no COA".
    await this.coa.ensureDefaults(businessId);
    if (categoryId) {
      const cat = await tx.expenseCategory.findUnique({
        where: { id: categoryId },
        select: { chartOfAccountId: true },
      });
      if (cat?.chartOfAccountId) return cat.chartOfAccountId;
    }
    const fallback =
      (await this.coa.getBySystemKey(businessId, 'EXPENSE_OTHER')) ??
      (await this.coa.getBySystemKey(businessId, 'EXPENSE_GENERAL'));
    if (!fallback) {
      throw new BadRequestException(
        `No EXPENSE_OTHER or EXPENSE_GENERAL COA for business ${businessId}`,
      );
    }
    return fallback.id;
  }

  /** Resolve the cash/bank/card COA for a payment method. */
  async resolvePaymentCoa(
    businessId: string,
    paymentMethod: string | null | undefined,
  ): Promise<string> {
    const key = paymentMethodToCoaSystemKey(paymentMethod);
    const row = await this.coa.getBySystemKey(businessId, key);
    if (!row) {
      const cash = await this.coa.getBySystemKey(businessId, 'CASH');
      if (!cash) {
        throw new BadRequestException(
          `No CASH COA for business ${businessId} — chart of accounts not seeded`,
        );
      }
      return cash.id;
    }
    return row.id;
  }

  async resolveSystemCoa(businessId: string, systemKey: string): Promise<string> {
    const row = await this.coa.getBySystemKey(businessId, systemKey);
    if (!row) {
      throw new BadRequestException(
        `No ${systemKey} COA for business ${businessId} — chart of accounts not seeded`,
      );
    }
    return row.id;
  }

  // ---------------------------------------------------------------------
  // Posting recipes
  // ---------------------------------------------------------------------

  /**
   * Paid expense — Dr Operating Expense / Cr Cash|Bank|Card.
   * Idempotent on `Expense:{id}:paid`.
   * Supports multi-line split items for detailed categorization.
   */
  async onExpensePaid(
    expense: {
      id: string;
      businessId: string;
      amount: number;
      currency: string;
      date: Date;
      categoryId: string | null;
      paymentMethod: string | null;
      description: string;
      contactId?: string | null;
      vendor?: string | null;
      items?: Array<{
        amount: number;
        categoryId?: string | null;
        description?: string;
        taxRateId?: string | null;
      }> | null;
    },
    txClient?: Prisma.TransactionClient,
  ) {
    if (expense.amount <= 0) {
      // 0/-amount expenses are a no-op for the ledger.
      return null;
    }

    const cashCoaId = await this.resolvePaymentCoa(expense.businessId, expense.paymentMethod);

    const entries: Array<{ accountId: string; debit: number; credit: number; memo?: string }> = [];
    let debitTotal = new D(0);

    const splitItems = Array.isArray(expense.items) && expense.items.length > 0 ? expense.items : null;

    if (splitItems) {
      for (const item of splitItems) {
        const itemAmount = new D(String(item.amount ?? 0));
        if (itemAmount.lte(0)) continue;
        const itemCoaId = await this.resolveExpenseCoa(expense.businessId, item.categoryId ?? expense.categoryId, txClient);
        entries.push({
          accountId: itemCoaId,
          debit: itemAmount.toNumber(),
          credit: 0,
          memo: item.description ?? expense.description,
        });
        debitTotal = debitTotal.add(itemAmount);
      }
    } else {
      const expenseCoaId = await this.resolveExpenseCoa(expense.businessId, expense.categoryId, txClient);
      entries.push({ accountId: expenseCoaId, debit: expense.amount, credit: 0, memo: expense.description });
      debitTotal = new D(String(expense.amount));
    }

    if (entries.length === 0) return null;

    // Credit the payment account for the total debit amount (may differ from
    // expense.amount if individual item rounding is involved).
    entries.push({
      accountId: cashCoaId,
      debit: 0,
      credit: debitTotal.toNumber(),
      memo: expense.vendor ?? expense.description,
    });

    return this.posting.post(
      {
        businessId: expense.businessId,
        type: 'EXPENSE',
        date: expense.date,
        amount: debitTotal.toNumber(),
        currency: expense.currency,
        description: expense.description,
        contactId: expense.contactId ?? null,
        sourceType: 'Expense',
        sourceId: expense.id,
        kind: 'paid',
        reference: expense.vendor ?? null,
        entries,
      },
      txClient,
    );
  }

  /**
   * Bill (unpaid expense) — Dr Operating Expense / Cr Accounts Payable.
   * Idempotent on `Expense:{id}:bill_created`.
   * Supports multi-line split items for detailed categorization.
   */
  async onBillCreated(
    expense: {
      id: string;
      businessId: string;
      amount: number;
      currency: string;
      date: Date;
      categoryId: string | null;
      description: string;
      contactId?: string | null;
      vendor?: string | null;
      items?: Array<{
        amount: number;
        categoryId?: string | null;
        description?: string;
        taxRateId?: string | null;
      }> | null;
    },
    txClient?: Prisma.TransactionClient,
  ) {
    if (expense.amount <= 0) return null;

    const apCoaId = await this.resolveSystemCoa(expense.businessId, 'ACCOUNTS_PAYABLE');

    const entries: Array<{ accountId: string; debit: number; credit: number; memo?: string }> = [];
    let debitTotal = new D(0);

    const splitItems = Array.isArray(expense.items) && expense.items.length > 0 ? expense.items : null;

    if (splitItems) {
      for (const item of splitItems) {
        const itemAmount = new D(String(item.amount ?? 0));
        if (itemAmount.lte(0)) continue;
        const itemCoaId = await this.resolveExpenseCoa(expense.businessId, item.categoryId ?? expense.categoryId, txClient);
        entries.push({
          accountId: itemCoaId,
          debit: itemAmount.toNumber(),
          credit: 0,
          memo: item.description ?? expense.description,
        });
        debitTotal = debitTotal.add(itemAmount);
      }
    } else {
      const expenseCoaId = await this.resolveExpenseCoa(expense.businessId, expense.categoryId, txClient);
      entries.push({ accountId: expenseCoaId, debit: expense.amount, credit: 0, memo: expense.description });
      debitTotal = new D(String(expense.amount));
    }

    if (entries.length === 0) return null;

    entries.push({
      accountId: apCoaId,
      debit: 0,
      credit: debitTotal.toNumber(),
      memo: `Bill: ${expense.vendor ?? expense.description}`,
    });

    return this.posting.post(
      {
        businessId: expense.businessId,
        type: 'EXPENSE',
        date: expense.date,
        amount: debitTotal.toNumber(),
        currency: expense.currency,
        description: expense.description,
        contactId: expense.contactId ?? null,
        sourceType: 'Expense',
        sourceId: expense.id,
        kind: 'bill_created',
        reference: expense.vendor ?? null,
        entries,
      },
      txClient,
    );
  }

  /**
   * Bill paid — Dr Accounts Payable / Cr Cash|Bank|Card.
   * Idempotent on `Expense:{id}:bill_paid`. Independent of bill_created
   * so both legs survive replay/backfill.
   */
  async onBillPaid(
    expense: {
      id: string;
      businessId: string;
      amount: number;
      currency: string;
      paidAt: Date;
      paymentMethod: string | null;
      description: string;
      contactId?: string | null;
      vendor?: string | null;
    },
    txClient?: Prisma.TransactionClient,
  ) {
    if (expense.amount <= 0) return null;
    const apCoaId = await this.resolveSystemCoa(expense.businessId, 'ACCOUNTS_PAYABLE');
    const cashCoaId = await this.resolvePaymentCoa(expense.businessId, expense.paymentMethod);
    return this.posting.post(
      {
        businessId: expense.businessId,
        type: 'EXPENSE',
        date: expense.paidAt,
        amount: expense.amount,
        currency: expense.currency,
        description: `Payment: ${expense.description}`,
        contactId: expense.contactId ?? null,
        sourceType: 'Expense',
        sourceId: expense.id,
        kind: 'bill_paid',
        reference: expense.vendor ?? null,
        entries: [
          { accountId: apCoaId, debit: expense.amount, memo: `Pay bill: ${expense.vendor ?? expense.description}` },
          { accountId: cashCoaId, credit: expense.amount, memo: expense.vendor ?? expense.description },
        ],
      },
      txClient,
    );
  }

  /**
   * Purchase order received — Dr Inventory / Cr (Cash|Bank|Card | AP).
   * Idempotent on `PurchaseOrder:{id}:received`.
   */
  async onPurchaseOrderReceived(
    po: {
      id: string;
      businessId: string;
      total: number;
      currency: string;
      receivedAt: Date;
      paymentStatus: string; // PAID | UNPAID
      paymentMethod?: string | null;
      supplierName?: string | null;
      poNumber: string;
    },
    txClient?: Prisma.TransactionClient,
  ) {
    if (po.total <= 0) return null;
    const inventoryCoaId = await this.resolveSystemCoa(po.businessId, 'INVENTORY_ASSET');
    const creditCoaId =
      po.paymentStatus === 'PAID'
        ? await this.resolvePaymentCoa(po.businessId, po.paymentMethod)
        : await this.resolveSystemCoa(po.businessId, 'ACCOUNTS_PAYABLE');
    return this.posting.post(
      {
        businessId: po.businessId,
        type: po.paymentStatus === 'PAID' ? 'EXPENSE' : 'ADJUSTMENT',
        date: po.receivedAt,
        amount: po.total,
        currency: po.currency,
        description: `PO ${po.poNumber} received from ${po.supplierName ?? 'supplier'}`,
        sourceType: 'PurchaseOrder',
        sourceId: po.id,
        kind: 'received',
        reference: po.poNumber,
        entries: [
          { accountId: inventoryCoaId, debit: po.total, memo: `PO ${po.poNumber}` },
          {
            accountId: creditCoaId,
            credit: po.total,
            memo: po.paymentStatus === 'PAID' ? `Paid to ${po.supplierName ?? 'supplier'}` : `Owed to ${po.supplierName ?? 'supplier'}`,
          },
        ],
      },
      txClient,
    );
  }

  /**
   * Product sold via Commerce/Storefront — Dr COGS / Cr Inventory using
   * the weighted-average unit cost stored on InventoryStock. Skipped
   * silently when no inventory tracking exists for the product (per
   * FIN3 architectural constraints — never fabricate cost values).
   *
   * Idempotent on `${sourceType}:{sourceId}:cogs`.
   */
  async onProductSold(
    sale: {
      businessId: string;
      sourceType: string; // 'Invoice' | 'MarketplaceOrder'
      sourceId: string;
      date: Date;
      currency: string;
      contactId?: string | null;
      items: Array<{ productId: string; quantity: number }>;
    },
    txClient?: Prisma.TransactionClient,
  ) {
    const tx = (txClient ?? this.prisma.client) as Prisma.TransactionClient;
    if (!sale.items || sale.items.length === 0) return null;

    const productIds = Array.from(new Set(sale.items.map((i) => i.productId).filter(Boolean)));
    if (productIds.length === 0) return null;

    const stocks = await tx.inventoryStock.findMany({
      where: { businessId: sale.businessId, productId: { in: productIds } },
      select: { productId: true, costPerUnit: true, quantity: true },
    });
    // Average across warehouses weighted by stock quantity (best
    // approximation when a product lives in multiple warehouses).
    const costByProduct = new Map<string, number>();
    for (const pid of productIds) {
      const rows = stocks.filter((s) => s.productId === pid && s.costPerUnit != null);
      if (rows.length === 0) continue;
      const totalQty = rows.reduce((s, r) => s + Math.max(r.quantity, 0), 0);
      if (totalQty > 0) {
        const wsum = rows.reduce((s, r) => s + Math.max(r.quantity, 0) * (r.costPerUnit ?? 0), 0);
        costByProduct.set(pid, wsum / totalQty);
      } else {
        // No on-hand stock — average the per-warehouse cost rows we do
        // have so a freshly-stocked-then-fully-sold product still posts.
        const avg = rows.reduce((s, r) => s + (r.costPerUnit ?? 0), 0) / rows.length;
        costByProduct.set(pid, avg);
      }
    }

    let totalCogs = 0;
    const detail: Array<{ productId: string; quantity: number; unitCost: number; total: number }> = [];
    for (const item of sale.items) {
      const unitCost = costByProduct.get(item.productId);
      if (unitCost == null || unitCost <= 0 || item.quantity <= 0) continue;
      const line = unitCost * item.quantity;
      totalCogs += line;
      detail.push({ productId: item.productId, quantity: item.quantity, unitCost, total: line });
    }
    // No inventory tracking → skip silently per spec.
    if (totalCogs <= 0 || detail.length === 0) return null;

    const cogsCoaId = await this.resolveSystemCoa(sale.businessId, 'COGS');
    const inventoryCoaId = await this.resolveSystemCoa(sale.businessId, 'INVENTORY_ASSET');
    return this.posting.post(
      {
        businessId: sale.businessId,
        type: 'EXPENSE',
        date: sale.date,
        amount: Number(totalCogs.toFixed(4)),
        currency: sale.currency,
        description: `COGS for ${sale.sourceType} ${sale.sourceId}`,
        contactId: sale.contactId ?? null,
        sourceType: sale.sourceType,
        sourceId: sale.sourceId,
        kind: 'cogs',
        metadata: { lines: detail } as Prisma.InputJsonValue,
        entries: [
          { accountId: cogsCoaId, debit: Number(totalCogs.toFixed(4)), memo: 'Cost of goods sold' },
          { accountId: inventoryCoaId, credit: Number(totalCogs.toFixed(4)), memo: 'Inventory consumed' },
        ],
      },
      txClient,
    );
  }
}
