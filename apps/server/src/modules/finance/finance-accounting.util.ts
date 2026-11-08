import { BadRequestException } from '@nestjs/common';

export interface ExchangeRateRow {
  fromCurrency: string;
  toCurrency: string;
  rate: number | string | { toString(): string };
  date?: Date | string;
}

export const PRISMA_PAGE_CAP = 1000;

/**
 * Paginate through a Prisma `findMany` delegate in chunks of `PRISMA_PAGE_CAP` (1,000)
 * so queries are never silently truncated by `defaultTakeExtension` (`packages/db/src/client.ts`).
 * When a dataset has fewer than 1,000 rows (including unit test stubs), only a single
 * call is issued.
 */
export async function fetchAllPages<T>(
  fetchPage: (pagination: { skip: number; take: number }) => Promise<T[]>,
): Promise<T[]> {
  const all: T[] = [];
  let skip = 0;
  while (true) {
    const page = await fetchPage({ skip, take: PRISMA_PAGE_CAP });
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    if (page.length < PRISMA_PAGE_CAP) break;
    skip += page.length;
  }
  return all;
}

/**
 * Load the latest ExchangeRate row for each `(fromCurrency, toCurrency)` pair
 * in a business so high-frequency snapshots of one pair never evict other pairs.
 */
export async function loadLatestExchangeRates(
  exchangeRateDelegate: unknown,
  businessId: string,
): Promise<ExchangeRateRow[]> {
  const delegate = exchangeRateDelegate as
    | {
        findMany?: (args: Record<string, unknown>) => Promise<ExchangeRateRow[]>;
      }
    | undefined;
  if (!delegate?.findMany) return [];
  return fetchAllPages<ExchangeRateRow>(({ skip, take }) =>
    delegate.findMany!({
      where: { businessId },
      orderBy: { date: 'desc' },
      distinct: ['fromCurrency', 'toCurrency'],
      ...(skip > 0 ? { skip, take } : {}),
    }),
  );
}

export function normalizeCurrencyCode(code?: string | null, fallback = 'TTD'): string {
  const cleaned = (code ?? '').trim().toUpperCase();
  return cleaned || fallback.trim().toUpperCase() || 'TTD';
}

/**
 * Resolve a conversion multiplier from `fromCurrency` to `toCurrency` using
 * the latest configured ExchangeRate rows (ordered newest first).
 * Supports direct (`from -> to`) and inverse (`to -> from` as `1 / rate`) pairs.
 * Returns `null` when no valid conversion rate is configured.
 */
export function resolveConversionRate(
  fromCurrency: string,
  toCurrency: string,
  rates: ExchangeRateRow[],
): number | null {
  const from = normalizeCurrencyCode(fromCurrency);
  const to = normalizeCurrencyCode(toCurrency);
  if (from === to) return 1;

  for (const row of rates) {
    const rowFrom = normalizeCurrencyCode(row.fromCurrency, '');
    const rowTo = normalizeCurrencyCode(row.toCurrency, '');
    const numRate = Number(row.rate?.toString?.() ?? row.rate);
    if (!Number.isFinite(numRate) || numRate <= 0) continue;
    if (rowFrom === from && rowTo === to) {
      return numRate;
    }
  }

  for (const row of rates) {
    const rowFrom = normalizeCurrencyCode(row.fromCurrency, '');
    const rowTo = normalizeCurrencyCode(row.toCurrency, '');
    const numRate = Number(row.rate?.toString?.() ?? row.rate);
    if (!Number.isFinite(numRate) || numRate <= 0) continue;
    if (rowFrom === to && rowTo === from) {
      return 1 / numRate;
    }
  }

  return null;
}

/**
 * Convert an amount into `baseCurrency` or fail closed with BadRequestException
 * when the amount is in a foreign currency with no configured exchange rate.
 */
export function convertToBaseOrThrow(
  amount: number,
  itemCurrency: string | null | undefined,
  baseCurrency: string,
  rates: ExchangeRateRow[],
  contextLabel: string,
): number {
  const numAmount = Number(amount ?? 0);
  if (!Number.isFinite(numAmount) || numAmount === 0) return 0;

  const base = normalizeCurrencyCode(baseCurrency);
  const from = normalizeCurrencyCode(itemCurrency, base);
  if (from === base) return numAmount;

  const multiplier = resolveConversionRate(from, base, rates);
  if (multiplier == null) {
    throw new BadRequestException(
      `Cannot compute ${contextLabel}: missing exchange rate from ${from} to ${base}`,
    );
  }
  return Math.round(numAmount * multiplier * 100) / 100;
}

export interface CashAccountSnapshotRow {
  id?: string;
  chartOfAccountId?: string | null;
  openingBalance?: unknown;
  currentBalance?: unknown;
  currency?: string | null;
}

export interface CashLedgerMovementRow {
  accountId: string;
  financialAccountId?: string | null;
  debit?: unknown;
  credit?: unknown;
  currency?: string | null;
  transactionType?: string | null;
}

export interface PersistedEntryFinancialAccountTarget {
  entryIndex: number;
  accountId: string;
  financialAccountId: string;
}

export function extractFinancialAccountIdFromMetadata(
  metadata: unknown,
  coaAccountId: string,
  entryIndex?: number,
): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const record = metadata as Record<string, unknown>;
  const targets = record.entryFinancialAccounts;
  if (Array.isArray(targets)) {
    if (typeof entryIndex === 'number') {
      const byIdx = targets.find(
        (t): t is PersistedEntryFinancialAccountTarget =>
          Boolean(t && typeof t === 'object' && (t as { entryIndex?: unknown }).entryIndex === entryIndex),
      );
      if (byIdx && typeof byIdx.financialAccountId === 'string') {
        return byIdx.financialAccountId;
      }
    }
    const byCoa = targets.find(
      (t): t is PersistedEntryFinancialAccountTarget =>
        Boolean(t && typeof t === 'object' && (t as { accountId?: unknown }).accountId === coaAccountId),
    );
    if (byCoa && typeof byCoa.financialAccountId === 'string') {
      return byCoa.financialAccountId;
    }
  }
  const mapByCoa = record.entryFinancialAccountByCoa;
  if (mapByCoa && typeof mapByCoa === 'object' && !Array.isArray(mapByCoa)) {
    const val = (mapByCoa as Record<string, unknown>)[coaAccountId];
    if (typeof val === 'string' && val) return val;
  }
  return null;
}

/**
 * Load all cash/bank ledger movements across all pages (bypassing the 1,000-row
 * per-query pagination guard) for the given linked ChartOfAccount ids.
 */
export async function loadCashLedgerMovements(
  ledgerEntryDelegate: unknown,
  businessId: string,
  linkedCoaIds: string[],
): Promise<CashLedgerMovementRow[]> {
  const delegate = ledgerEntryDelegate as
    | {
        findMany?: (args: Record<string, unknown>) => Promise<
          Array<{
            accountId: string;
            financialAccountId?: string | null;
            debit: unknown;
            credit: unknown;
            currency?: string | null;
            transaction?: { type?: string | null; metadata?: unknown } | null;
          }>
        >;
      }
    | undefined;
  if (linkedCoaIds.length === 0 || !delegate?.findMany) {
    return [];
  }
  const rows = await fetchAllPages(({ skip, take }) =>
    delegate.findMany!({
      where: {
        businessId,
        accountId: { in: linkedCoaIds },
      },
      select: {
        accountId: true,
        debit: true,
        credit: true,
        currency: true,
        transaction: { select: { type: true, metadata: true } },
      },
      ...(skip > 0 ? { skip, take } : {}),
    }),
  );

  return rows.map((e) => ({
    accountId: e.accountId,
    financialAccountId:
      e.financialAccountId ??
      extractFinancialAccountIdFromMetadata(e.transaction?.metadata, e.accountId),
    debit: e.debit,
    credit: e.credit,
    currency: e.currency,
    transactionType: e.transaction?.type ?? null,
  }));
}

/**
 * Compute authoritative available cash in `baseCurrency`:
 * - When non-OPENING_BALANCE ledger movements are supplied for linked
 *   ChartOfAccount ids, cash is derived from each active FinancialAccount's
 *   `openingBalance` (falling back to `currentBalance` only if `openingBalance`
 *   is undefined in a legacy/stub row) plus the net `debit - credit` of
 *   non-OPENING_BALANCE ledger entries across distinct linked `chartOfAccountId`s.
 * - Movements that carry a resolved `financialAccountId` belonging to an
 *   archived/inactive FinancialAccount (not present in `accounts`) are excluded
 *   even when an active FinancialAccount shares the same `chartOfAccountId`.
 * - When no ledger movements exist for those COA ids (or in hermetic stubs that
 *   only populate `currentBalance`), uses `currentBalance ?? openingBalance`.
 */
export function computeNormalizedCashBalance(params: {
  accounts: CashAccountSnapshotRow[];
  ledgerMovements?: CashLedgerMovementRow[];
  baseCurrency: string;
  rates: ExchangeRateRow[];
  failClosedOnMissingRate?: boolean;
  unconvertedByCurrency?: Record<string, number>;
}): number {
  const {
    accounts,
    ledgerMovements = [],
    baseCurrency,
    rates,
    failClosedOnMissingRate = true,
    unconvertedByCurrency,
  } = params;

  const base = normalizeCurrencyCode(baseCurrency);
  const linkedCoaIds = new Set<string>();
  const activeAccountIds = new Set<string>();
  for (const acc of accounts) {
    if (acc.chartOfAccountId) linkedCoaIds.add(acc.chartOfAccountId);
    if (acc.id) activeAccountIds.add(acc.id);
  }

  const relevantMovements = ledgerMovements.filter((m) => {
    if (!m.accountId || !linkedCoaIds.has(m.accountId)) return false;
    if (m.transactionType === 'OPENING_BALANCE') return false;
    if (m.financialAccountId && activeAccountIds.size > 0 && !activeAccountIds.has(m.financialAccountId)) {
      return false;
    }
    return true;
  });

  const hasLedgerMovements = relevantMovements.length > 0 || ledgerMovements.some(
    (m) =>
      m.accountId &&
      linkedCoaIds.has(m.accountId) &&
      m.transactionType !== 'OPENING_BALANCE' &&
      Boolean(m.financialAccountId),
  );

  let total = 0;

  const addAmount = (rawAmount: number, rawCurrency?: string | null) => {
    if (!Number.isFinite(rawAmount) || rawAmount === 0) return;
    const from = normalizeCurrencyCode(rawCurrency, base);
    if (from === base) {
      total += rawAmount;
      return;
    }
    if (failClosedOnMissingRate) {
      total += convertToBaseOrThrow(rawAmount, from, base, rates, 'cash balance');
      return;
    }
    const mult = resolveConversionRate(from, base, rates);
    if (mult != null) {
      total += rawAmount * mult;
    } else if (unconvertedByCurrency) {
      unconvertedByCurrency[from] = (unconvertedByCurrency[from] ?? 0) + rawAmount;
    }
  };

  for (const acc of accounts) {
    const hasOpening = acc.openingBalance !== undefined && acc.openingBalance !== null;
    const hasCurrent = acc.currentBalance !== undefined && acc.currentBalance !== null;
    const baseAccountAmount = hasLedgerMovements
      ? Number((hasOpening ? acc.openingBalance : acc.currentBalance) ?? 0)
      : Number((hasCurrent ? acc.currentBalance : acc.openingBalance) ?? 0);
    addAmount(baseAccountAmount, acc.currency);
  }

  if (hasLedgerMovements) {
    for (const m of relevantMovements) {
      const dr = Number(m.debit?.toString?.() ?? m.debit ?? 0);
      const cr = Number(m.credit?.toString?.() ?? m.credit ?? 0);
      addAmount(dr - cr, m.currency);
    }
  }

  return Math.round(total * 100) / 100;
}
