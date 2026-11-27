import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { getCurrentBusinessId } from '../../core/tenant/tenant-context';

export interface CoaSeed {
  systemKey: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'COGS' | 'EXPENSE';
  subtype?: string;
  code?: string;
  parentSystemKey?: string;
}

export interface CoaSeedCodeCollision {
  systemKey: string;
  code: string;
  holderId: string;
  holderName: string;
}

export interface CoaSeedResult {
  seeded: number;
  skippedCodes: CoaSeedCodeCollision[];
}

/** Namespace of the per-business advisory lock that serializes account-code writes and seeding. */
export const COA_CODE_LOCK_NAMESPACE = 'coa-code:';

/**
 * Wait and run limits of the account-code transaction, stated rather than left to Prisma's defaults (maxWait
 * 2 s, timeout 5 s), in line with the repo's other short lock-holding transactions (bookings
 * SLOT_CLAIM_TX_OPTIONS). A writer that still cannot get a connection or the lock in time gets P2028, which
 * answers 503 (try again), not a 500.
 */
export const COA_CODE_TX_OPTIONS = { isolationLevel: 'ReadCommitted', maxWait: 5_000, timeout: 10_000 } as const;

/**
 * The whitespace trimmed off a code, on both sides of the comparison: the SQL check trims the stored code
 * with this same set (rows written before this rule were stored verbatim), so the service and the database
 * agree on what a code is. ASCII whitespace only: a no-break or other Unicode space, a zero-width
 * character or full-width digits make a different code here, though it may look the same on screen.
 */
export const COA_CODE_WHITESPACE = ' \t\n\r\f\v';

export function trimCoaCode(code: string): string {
  let start = 0;
  let end = code.length;
  while (start < end && COA_CODE_WHITESPACE.includes(code[start])) start++;
  while (end > start && COA_CODE_WHITESPACE.includes(code[end - 1])) end--;
  return code.slice(start, end);
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

/**
 * Prisma's unique-constraint violation (P2002). Matched on the code rather
 * than `instanceof` so it holds whichever `@prisma/client` copy raised it.
 */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

@Injectable()
export class ChartOfAccountsSeederService {
  private readonly logger = new Logger(ChartOfAccountsSeederService.name);

  /**
   * System-account seeding in flight, keyed by the tenant the run's queries
   * execute under: the active AsyncLocalStorage tenant when there is one (the
   * `@keyflow/db` extension rewrites every `where.businessId` and
   * `create.businessId` to it), else the businessId argument. Keying on the
   * argument alone would let a run started under another tenant's context be
   * joined by a legitimate caller for the argument's tenant, which would then
   * re-read under its own context and find nothing seeded.
   *
   * Concurrent callers in this process (e.g. the deposit and credit lookups
   * of one payment posting) await the same run instead of racing each other
   * into P2002 on the (businessId, systemKey) unique index. An entry is
   * removed when its run settles, so a failed run is retried by the next
   * caller, not pinned.
   */
  private readonly inFlight = new Map<string, Promise<CoaSeedResult>>();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Idempotently ensure the system Chart of Accounts exists for the given
   * business and every ExpenseCategory is linked to its bucket. Safe to call
   * on every read of `/finance/accounts` — uses the (businessId, systemKey)
   * unique index so re-runs are no-ops, serializes concurrent seeding per
   * tenant, and acquires the shared `coa-code:` advisory lock when writing so
   * a system code already held by an active custom account is skipped and
   * reported rather than creating a duplicate active holder.
   *
   * Only the seed is shared between concurrent callers. The link pass runs
   * for every caller after it, so a category committed after a shared run
   * took its scan is still linked when this call resolves — callers such as
   * ExpensePostingService re-read `chartOfAccountId` right after this.
   */
  async ensureDefaults(businessId: string): Promise<void> {
    await this.ensureDefaultsWithReport(businessId);
  }

  /**
   * Same as `ensureDefaults`, returning the number of newly seeded system rows
   * and any system codes skipped because an active account already held them.
   */
  async ensureDefaultsWithReport(businessId: string): Promise<CoaSeedResult> {
    const result = await this.seedSystemAccountsOnce(businessId);
    await this.linkExpenseCategories(businessId);
    return result;
  }

  /** One seed run per tenant at a time; concurrent callers await the same run. */
  private seedSystemAccountsOnce(businessId: string): Promise<CoaSeedResult> {
    const tenant = getCurrentBusinessId() ?? businessId;
    const running = this.inFlight.get(tenant);
    if (running) return running;
    const run = this.seedSystemAccounts(businessId, tenant).finally(() => {
      if (this.inFlight.get(tenant) === run) this.inFlight.delete(tenant);
    });
    this.inFlight.set(tenant, run);
    return run;
  }

  private isSeedComplete(
    rows: Array<{ id: string; systemKey: string | null; parentId: string | null }>,
  ): boolean {
    const byKey = new Map(rows.map((r) => [r.systemKey, r] as const));
    for (const seed of SYSTEM_COA) {
      const row = byKey.get(seed.systemKey);
      if (!row) return false;
      if (seed.parentSystemKey) {
        const parent = byKey.get(seed.parentSystemKey);
        if (!parent || row.parentId !== parent.id) return false;
      }
    }
    return true;
  }

  private async seedSystemAccounts(businessId: string, tenant: string): Promise<CoaSeedResult> {
    // Fast path: if all system accounts and parent links are already present,
    // avoid taking the advisory lock transaction on steady-state reads.
    const preCheck = await this.prisma.client.chartOfAccount.findMany({
      where: { businessId, systemKey: { in: SYSTEM_COA.map((s) => s.systemKey) } },
      select: { id: true, systemKey: true, parentId: true },
    });
    if (this.isSeedComplete(preCheck)) {
      return { seeded: 0, skippedCodes: [] };
    }

    // Acquire the exact same per-business advisory lock as FinanceCoaService
    // inside a READ COMMITTED transaction so active-code checks and writes are
    // serialized against concurrent custom account creates/updates and replicas.
    return this.prisma.client.$transaction(async (rawTx) => {
      const tx = rawTx as unknown as Prisma.TransactionClient;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${COA_CODE_LOCK_NAMESPACE + tenant}))`;

      const existing = await tx.chartOfAccount.findMany({
        where: { businessId, systemKey: { in: SYSTEM_COA.map((s) => s.systemKey) } },
        select: { id: true, systemKey: true, parentId: true },
      });
      const haveBySystemKey = new Map<string, { id: string; parentId: string | null }>();
      for (const r of existing) {
        if (r.systemKey) haveBySystemKey.set(r.systemKey, { id: r.id, parentId: r.parentId ?? null });
      }

      const missing = SYSTEM_COA.filter((seed) => !haveBySystemKey.has(seed.systemKey));
      const skippedCodes: CoaSeedCodeCollision[] = [];
      let seeded = 0;

      if (missing.length > 0) {
        // Load active coded accounts for the effective tenant under the lock,
        // matching FinanceCoaService.assertCodeFree's trim and case-folding rules.
        const activeHolders = await tx.$queryRaw<
          Array<{ id: string; name: string; norm_code: string }>
        >`
          SELECT id, name, lower(btrim(code, ${COA_CODE_WHITESPACE})) AS norm_code
          FROM chart_of_accounts
          WHERE business_id = ${tenant}
            AND is_active = true
            AND code IS NOT NULL
            AND btrim(code, ${COA_CODE_WHITESPACE}) <> ''
          ORDER BY created_at ASC, id ASC`;

        const holderByCode = new Map<string, { id: string; name: string }>();
        for (const h of activeHolders) {
          if (!holderByCode.has(h.norm_code)) {
            holderByCode.set(h.norm_code, { id: h.id, name: h.name });
          }
        }

        // First pass — upsert missing rows without parents. If an active account
        // already holds a seed's normalized code, create the system row with
        // code: null (so postings/systemKey lookups remain intact with zero
        // duplicate active code holders) and report the collision.
        for (const seed of missing) {
          const trimmedCode = seed.code ? trimCoaCode(seed.code) : '';
          const normCode = trimmedCode === '' ? null : trimmedCode.toLowerCase();
          let codeToAssign: string | null = trimmedCode === '' ? null : trimmedCode;

          if (normCode !== null) {
            const holder = holderByCode.get(normCode);
            if (holder) {
              codeToAssign = null;
              skippedCodes.push({
                systemKey: seed.systemKey,
                code: trimmedCode,
                holderId: holder.id,
                holderName: holder.name,
              });
              this.logger.warn(
                `Skipping system COA code ${trimmedCode} for ${seed.systemKey} (businessId=${tenant}): active account ${holder.id} already holds this code`,
              );
            }
          }

          const row = await this.upsertSystemAccount(tx, businessId, seed, codeToAssign);
          if (row) {
            seeded += 1;
            haveBySystemKey.set(row.systemKey ?? seed.systemKey, {
              id: row.id,
              parentId: row.parentId ?? null,
            });
            if (normCode !== null && codeToAssign !== null) {
              holderByCode.set(normCode, { id: row.id, name: seed.name });
            }
          }
        }
      }

      // Second pass — apply parent links for newly created (or unlinked) rows.
      for (const seed of SYSTEM_COA) {
        if (!seed.parentSystemKey) continue;
        const entry = haveBySystemKey.get(seed.systemKey);
        const parent = haveBySystemKey.get(seed.parentSystemKey);
        if (!entry || !parent) continue;
        if (entry.parentId === parent.id) continue;
        await tx.chartOfAccount.update({
          where: { id: entry.id },
          data: { parentId: parent.id },
        });
        entry.parentId = parent.id;
      }

      return { seeded, skippedCodes };
    }, COA_CODE_TX_OPTIONS).catch((err: unknown) => {
      if ((err as { code?: unknown } | null)?.code === 'P2028') {
        throw new ServiceUnavailableException(
          { code: 'COA_CODE_BUSY', message: 'The chart of accounts is busy. Please try again.' },
          { cause: err },
        );
      }
      throw err;
    });
  }

  /**
   * Upsert one system account inside the locked transaction. Keeps the P2002
   * re-read fallback for defense-in-depth (e.g. if a row landed outside the lock).
   */
  private async upsertSystemAccount(
    tx: Prisma.TransactionClient,
    businessId: string,
    seed: CoaSeed,
    code: string | null,
  ): Promise<{ id: string; systemKey: string | null; parentId: string | null } | null> {
    try {
      return await tx.chartOfAccount.upsert({
        where: { businessId_systemKey: { businessId, systemKey: seed.systemKey } },
        create: {
          businessId,
          systemKey: seed.systemKey,
          name: seed.name,
          type: seed.type,
          subtype: seed.subtype ?? null,
          code,
          isSystem: true,
          isActive: true,
        },
        update: {},
        select: { id: true, systemKey: true, parentId: true },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      return tx.chartOfAccount.findUnique({
        where: { businessId_systemKey: { businessId, systemKey: seed.systemKey } },
        select: { id: true, systemKey: true, parentId: true },
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
