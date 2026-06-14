import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface CoaSeed {
  systemKey: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'COGS' | 'EXPENSE';
  subtype?: string;
  code?: string;
  parentSystemKey?: string;
}

/**
 * The canonical Chart of Accounts every business gets on first read.
 * Order matters — parents must precede children so the seeder can resolve
 * `parentSystemKey` -> id in a single pass.
 */
export const SYSTEM_COA: CoaSeed[] = [
  // ASSETS
  { systemKey: 'CASH', name: 'Cash', type: 'ASSET', code: '1000' },
  { systemKey: 'BANK', name: 'Bank Account', type: 'ASSET', code: '1010' },
  { systemKey: 'PAYMENT_PROCESSOR', name: 'Payment Processor Clearing', type: 'ASSET', code: '1020' },
  { systemKey: 'ACCOUNTS_RECEIVABLE', name: 'Accounts Receivable', type: 'ASSET', code: '1100' },
  { systemKey: 'INVENTORY_ASSET', name: 'Inventory', type: 'ASSET', code: '1200' },
  { systemKey: 'FIXED_ASSET_EQUIPMENT', name: 'Fixed Assets — Equipment', type: 'ASSET', code: '1300' },
  { systemKey: 'ACCUMULATED_DEPRECIATION', name: 'Accumulated Depreciation', type: 'ASSET', code: '1310' },

  // LIABILITIES
  { systemKey: 'ACCOUNTS_PAYABLE', name: 'Accounts Payable', type: 'LIABILITY', code: '2000' },
  { systemKey: 'TAX_PAYABLE', name: 'Tax Payable', type: 'LIABILITY', code: '2100' },
  { systemKey: 'CREDIT_CARD', name: 'Credit Card', type: 'LIABILITY', code: '2200' },
  { systemKey: 'LOAN_PAYABLE', name: 'Loans Payable', type: 'LIABILITY', code: '2300' },

  // EQUITY
  { systemKey: 'OWNER_EQUITY', name: 'Owner Equity', type: 'EQUITY', code: '3000' },
  { systemKey: 'OWNER_DRAWINGS', name: 'Owner Drawings', type: 'EQUITY', code: '3100' },
  { systemKey: 'RETAINED_EARNINGS', name: 'Retained Earnings', type: 'EQUITY', code: '3200' },

  // INCOME
  { systemKey: 'REVENUE', name: 'Revenue', type: 'INCOME', code: '4000' },
  { systemKey: 'REVENUE_SERVICE', name: 'Service Revenue', type: 'INCOME', code: '4010', parentSystemKey: 'REVENUE' },
  { systemKey: 'REVENUE_PRODUCT', name: 'Product Revenue', type: 'INCOME', code: '4020', parentSystemKey: 'REVENUE' },
  { systemKey: 'REVENUE_PACKAGE', name: 'Package Revenue', type: 'INCOME', code: '4030', parentSystemKey: 'REVENUE' },
  { systemKey: 'OTHER_INCOME', name: 'Other Income', type: 'INCOME', code: '4900' },
  { systemKey: 'DISCOUNTS_GIVEN', name: 'Discounts Given', type: 'INCOME', code: '4100' },

  // COGS
  { systemKey: 'COGS', name: 'Cost of Goods Sold', type: 'COGS', code: '5000' },

  // OPERATING EXPENSES — mirror the default ExpenseCategory buckets.
  { systemKey: 'EXPENSE_GENERAL', name: 'Operating Expenses', type: 'EXPENSE', code: '6000' },
  { systemKey: 'EXPENSE_MARKETING', name: 'Marketing', type: 'EXPENSE', code: '6100', parentSystemKey: 'EXPENSE_GENERAL' },
  { systemKey: 'EXPENSE_SOFTWARE', name: 'Software & Subscriptions', type: 'EXPENSE', code: '6200', parentSystemKey: 'EXPENSE_GENERAL' },
  { systemKey: 'EXPENSE_RENT', name: 'Rent & Utilities', type: 'EXPENSE', code: '6300', parentSystemKey: 'EXPENSE_GENERAL' },
  { systemKey: 'EXPENSE_PAYROLL', name: 'Payroll & Contractors', type: 'EXPENSE', code: '6400', parentSystemKey: 'EXPENSE_GENERAL' },
  { systemKey: 'EXPENSE_OFFICE', name: 'Office & Supplies', type: 'EXPENSE', code: '6500', parentSystemKey: 'EXPENSE_GENERAL' },
  { systemKey: 'EXPENSE_TRAVEL', name: 'Travel & Transport', type: 'EXPENSE', code: '6600', parentSystemKey: 'EXPENSE_GENERAL' },
  { systemKey: 'EXPENSE_PROFESSIONAL', name: 'Professional Services', type: 'EXPENSE', code: '6700', parentSystemKey: 'EXPENSE_GENERAL' },
  { systemKey: 'EXPENSE_BANK_FEES', name: 'Bank & Processor Fees', type: 'EXPENSE', code: '6800', parentSystemKey: 'EXPENSE_GENERAL' },
  { systemKey: 'EXPENSE_OTHER', name: 'Other Expenses', type: 'EXPENSE', code: '6900', parentSystemKey: 'EXPENSE_GENERAL' },
  { systemKey: 'DEPRECIATION_EXPENSE', name: 'Depreciation Expense', type: 'EXPENSE', code: '6950', parentSystemKey: 'EXPENSE_GENERAL' },
  { systemKey: 'GAIN_LOSS_ON_DISPOSAL', name: 'Gain/Loss on Asset Disposal', type: 'EXPENSE', code: '6960', parentSystemKey: 'EXPENSE_GENERAL' },
];

/**
 * Map common ExpenseCategory.name patterns (substring, case-insensitive)
 * to COA systemKeys. Order matters — first match wins. Anything that does
 * not match falls through to EXPENSE_GENERAL so every category gets linked.
 */
const EXPENSE_CATEGORY_NAME_MAP: Array<{ pattern: RegExp; systemKey: string }> = [
  { pattern: /market|advert|ads|promo|seo|content/i, systemKey: 'EXPENSE_MARKETING' },
  { pattern: /software|subscription|saas|license|tool/i, systemKey: 'EXPENSE_SOFTWARE' },
  { pattern: /rent|utility|utilities|electric|water|internet|phone/i, systemKey: 'EXPENSE_RENT' },
  { pattern: /payroll|salary|salaries|wage|contractor|freelanc/i, systemKey: 'EXPENSE_PAYROLL' },
  { pattern: /office|supply|supplies|equipment|stationery/i, systemKey: 'EXPENSE_OFFICE' },
  { pattern: /travel|transport|fuel|gas|mileage|flight|hotel/i, systemKey: 'EXPENSE_TRAVEL' },
  { pattern: /professional|legal|accountant|consult/i, systemKey: 'EXPENSE_PROFESSIONAL' },
  { pattern: /bank|fee|charge|processor|interchange/i, systemKey: 'EXPENSE_BANK_FEES' },
];

@Injectable()
export class ChartOfAccountsSeederService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Idempotently ensure the system Chart of Accounts exists for the given
   * business. Safe to call on every read of `/finance/accounts` — uses
   * the (businessId, systemKey) unique index so re-runs are no-ops.
   */
  async ensureDefaults(businessId: string): Promise<void> {
    await this.seedSystemAccounts(businessId);
    await this.linkExpenseCategories(businessId);
  }

  private async seedSystemAccounts(businessId: string): Promise<void> {
    const existing = await this.prisma.client.chartOfAccount.findMany({
      where: { businessId, systemKey: { in: SYSTEM_COA.map((s) => s.systemKey) } },
      select: { id: true, systemKey: true },
    });
    const haveBySystemKey = new Map(existing.map((r) => [r.systemKey, r.id] as const));

    // First pass — upsert rows without parents so concurrent first-runs
    // (e.g. two requests calling ensureDefaults() simultaneously) cannot
    // race into a P2002 violation. The (businessId, systemKey) index
    // makes this safe.
    for (const seed of SYSTEM_COA) {
      if (haveBySystemKey.has(seed.systemKey)) continue;
      const created = await this.prisma.client.chartOfAccount.upsert({
        where: { businessId_systemKey: { businessId, systemKey: seed.systemKey } },
        create: {
          businessId,
          systemKey: seed.systemKey,
          name: seed.name,
          type: seed.type,
          subtype: seed.subtype ?? null,
          code: seed.code ?? null,
          isSystem: true,
          isActive: true,
        },
        update: {},
        select: { id: true, systemKey: true },
      });
      haveBySystemKey.set(created.systemKey ?? seed.systemKey, created.id);
    }

    // Second pass — apply parent links for newly created rows.
    for (const seed of SYSTEM_COA) {
      if (!seed.parentSystemKey) continue;
      const id = haveBySystemKey.get(seed.systemKey);
      const parentId = haveBySystemKey.get(seed.parentSystemKey);
      if (!id || !parentId) continue;
      const row = await this.prisma.client.chartOfAccount.findUnique({
        where: { id },
        select: { parentId: true },
      });
      if (!row || row.parentId === parentId) continue;
      await this.prisma.client.chartOfAccount.update({
        where: { id },
        data: { parentId },
      });
    }
  }

  /**
   * Idempotently link existing `ExpenseCategory` rows that have no
   * `chartOfAccountId` yet to the appropriate EXPENSE_* system COA bucket.
   * Falls back to EXPENSE_GENERAL when no name pattern matches so every
   * category is linked. Safe to call on every read.
   */
  async linkExpenseCategories(businessId: string): Promise<void> {
    const unlinked = await this.prisma.client.expenseCategory.findMany({
      where: { businessId, chartOfAccountId: null },
      select: { id: true, name: true },
    });
    if (unlinked.length === 0) return;

    const expenseKeys = Array.from(
      new Set(EXPENSE_CATEGORY_NAME_MAP.map((m) => m.systemKey).concat(['EXPENSE_GENERAL'])),
    );
    const coaRows = await this.prisma.client.chartOfAccount.findMany({
      where: { businessId, systemKey: { in: expenseKeys } },
      select: { id: true, systemKey: true },
    });
    const coaBySystemKey = new Map(coaRows.map((r) => [r.systemKey ?? '', r.id] as const));
    const fallbackId = coaBySystemKey.get('EXPENSE_GENERAL');
    if (!fallbackId) return; // System COA not yet seeded — caller should run seedSystemAccounts first.

    for (const cat of unlinked) {
      const matched = EXPENSE_CATEGORY_NAME_MAP.find((m) => m.pattern.test(cat.name));
      const targetId = (matched && coaBySystemKey.get(matched.systemKey)) ?? fallbackId;
      await this.prisma.client.expenseCategory.update({
        where: { id: cat.id },
        data: { chartOfAccountId: targetId },
      });
    }
  }

  /** Resolve a system COA row by key — seeds defaults if missing. */
  async getBySystemKey(businessId: string, systemKey: string) {
    let row = await this.prisma.client.chartOfAccount.findUnique({
      where: { businessId_systemKey: { businessId, systemKey } },
    });
    if (!row) {
      await this.ensureDefaults(businessId);
      row = await this.prisma.client.chartOfAccount.findUnique({
        where: { businessId_systemKey: { businessId, systemKey } },
      });
    }
    return row;
  }
}
