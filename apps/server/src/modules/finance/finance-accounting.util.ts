import { BadRequestException } from '@nestjs/common';

export interface ExchangeRateRow {
  fromCurrency: string;
  toCurrency: string;
  rate: number | string | { toString(): string };
  date?: Date | string;
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
  debit?: unknown;
  credit?: unknown;
  currency?: string | null;
  transactionType?: string | null;
}

/**
 * Compute authoritative available cash in `baseCurrency`:
 * - When non-OPENING_BALANCE ledger movements are supplied for linked
 *   ChartOfAccount ids, cash is derived from each FinancialAccount's
 *   `openingBalance` (falling back to `currentBalance` only if `openingBalance`
 *   is undefined in a legacy/stub row) plus the net `debit - credit` of
 *   non-OPENING_BALANCE ledger entries across distinct linked `chartOfAccountId`s.
 *   Each FinancialAccount and each ChartOfAccount is counted at most once so
 *   shared COA links and opening-balance journal entries never double-count.
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
  for (const acc of accounts) {
    if (acc.chartOfAccountId) linkedCoaIds.add(acc.chartOfAccountId);
  }

  const relevantMovements = ledgerMovements.filter(
    (m) =>
      m.accountId &&
      linkedCoaIds.has(m.accountId) &&
      m.transactionType !== 'OPENING_BALANCE',
  );

  const hasLedgerMovements = relevantMovements.length > 0;

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
