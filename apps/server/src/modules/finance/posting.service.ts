import { randomUUID } from 'node:crypto';
import { Inject, Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { skipTenantIsolation } from '@keyflow/db';
import { PrismaService } from '../../core/prisma/prisma.service';

import {
  extractFinancialAccountTargetFromMetadata,
  invalidateBusinessFinancialSnapshotCache,
  loadLatestExchangeRates,
  normalizeCurrencyCode,
  type PersistedEntryFinancialAccountTarget,
  resolveConversionRate,
} from './finance-accounting.util';

export interface PostingEntryInput {
  /** ChartOfAccount.id this entry posts against. */
  accountId: string;
  /** Optional explicit FinancialAccount.id when a specific cash/bank/processor account is targeted. */
  financialAccountId?: string | null;
  debit?: Prisma.Decimal | number | string;
  credit?: Prisma.Decimal | number | string;
  memo?: string;
}

const ASSET_ACCOUNT_TYPES = new Set(['CASH', 'BANK', 'PAYMENT_PROCESSOR']);
const LIABILITY_EQUITY_ACCOUNT_TYPES = new Set(['CREDIT_CARD', 'LOAN', 'EQUITY', 'TAX']);

interface ResolvedAccountDelta {
  ledgerEntryId?: string;
  entryIndex: number;
  accountId: string;
  financialAccountId: string;
  delta: Prisma.Decimal;
}

interface TxFinancialAccountDelegate {
  findFirst?: (args: Record<string, unknown>) => Promise<{
    id: string;
    businessId?: string;
    chartOfAccountId?: string | null;
    type: string;
    currency?: string | null;
    isActive?: boolean;
    currentBalance?: unknown;
  } | null>;
  findMany?: (args: Record<string, unknown>) => Promise<
    Array<{
      id: string;
      businessId?: string;
      chartOfAccountId?: string | null;
      type: string;
      currency?: string | null;
      isActive?: boolean;
      currentBalance?: unknown;
    }>
  >;
  update?: (args: Record<string, unknown>) => Promise<unknown>;
}

async function resolveFinancialAccountTargets(
  tx: Prisma.TransactionClient,
  businessId: string,
  entries: Array<{
    ledgerEntryId?: string;
    accountId: string;
    financialAccountId?: string | null;
    overrideDelta?: Prisma.Decimal | null;
    debit?: Prisma.Decimal | number | string;
    credit?: Prisma.Decimal | number | string;
  }>,
  postingCurrency: string,
  isOpeningBalance: boolean,
  allowArchivedExplicitTarget = false,
): Promise<{
  deltas: ResolvedAccountDelta[];
  metadataTargets: PersistedEntryFinancialAccountTarget[];
}> {
  if (isOpeningBalance) return { deltas: [], metadataTargets: [] };
  const rawTx = tx as unknown as {
    financialAccount?: TxFinancialAccountDelegate;
    exchangeRate?: {
      findMany?: (args: Record<string, unknown>) => Promise<
        Array<{ fromCurrency: string; toCurrency: string; rate: number | string | { toString(): string } }>
      >;
    };
  };
  const faDelegate = rawTx.financialAccount;
  if (!faDelegate || typeof faDelegate.findFirst !== 'function' || typeof faDelegate.update !== 'function') {
    return { deltas: [], metadataTargets: [] };
  }

  const normalizedPostingCurrency = normalizeCurrencyCode(postingCurrency, 'TTD');
  const deltas: ResolvedAccountDelta[] = [];
  const metadataTargets: PersistedEntryFinancialAccountTarget[] = [];

  for (let idx = 0; idx < entries.length; idx += 1) {
    const e = entries[idx];
    const dr = new D(String(e.debit ?? 0));
    const cr = new D(String(e.credit ?? 0));
    const netAssetDelta = dr.sub(cr);
    if (netAssetDelta.eq(ZERO)) continue;

    let targetAccount: {
      id: string;
      businessId?: string;
      chartOfAccountId?: string | null;
      type: string;
      currency?: string | null;
      isActive?: boolean;
      currentBalance?: unknown;
    } | null;

    if (e.financialAccountId) {
      targetAccount = await faDelegate.findFirst(
        skipTenantIsolation({
          where: allowArchivedExplicitTarget
            ? { id: e.financialAccountId }
            : { id: e.financialAccountId, isActive: true },
          select: {
            id: true,
            businessId: true,
            chartOfAccountId: true,
            type: true,
            currency: true,
            isActive: true,
            currentBalance: true,
          },
        }),
      );
      if (!targetAccount || (!allowArchivedExplicitTarget && targetAccount.isActive === false)) {
        throw new BadRequestException(
          `Financial account ${e.financialAccountId} not found or inactive for business ${businessId}`,
        );
      }
      if (targetAccount.businessId && targetAccount.businessId !== businessId) {
        throw new BadRequestException(
          `Financial account ${e.financialAccountId} does not belong to business ${businessId}`,
        );
      }
      if (!targetAccount.chartOfAccountId || targetAccount.chartOfAccountId !== e.accountId) {
        throw new BadRequestException(
          `Financial account ${e.financialAccountId} is linked to chart of account ${targetAccount.chartOfAccountId ?? 'none'}, which does not match ledger entry account ${e.accountId}`,
        );
      }
    } else {
      if (typeof faDelegate.findMany === 'function') {
        const candidateAccounts = await faDelegate.findMany({
          where: {
            businessId,
            chartOfAccountId: e.accountId,
            isActive: true,
          },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            businessId: true,
            chartOfAccountId: true,
            type: true,
            currency: true,
            isActive: true,
            currentBalance: true,
          },
        });
        const matchingAccounts = (candidateAccounts ?? []).filter(
          (a) =>
            (!a.businessId || a.businessId === businessId) &&
            a.chartOfAccountId === e.accountId &&
            a.isActive !== false,
        );
        if (matchingAccounts.length > 1) {
          throw new BadRequestException(
            `Multiple active financial accounts (${matchingAccounts.map((a) => a.id).join(', ')}) share chart of account ${e.accountId}; specify financialAccountId explicitly to disambiguate`,
          );
        }
        targetAccount = matchingAccounts[0] ?? null;
      } else {
        targetAccount = await faDelegate.findFirst({
          where: {
            businessId,
            chartOfAccountId: e.accountId,
            isActive: true,
            currency: normalizedPostingCurrency,
          },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            businessId: true,
            chartOfAccountId: true,
            type: true,
            currency: true,
            isActive: true,
            currentBalance: true,
          },
        });
        if (!targetAccount) {
          targetAccount = await faDelegate.findFirst({
            where: { businessId, chartOfAccountId: e.accountId, isActive: true },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              businessId: true,
              chartOfAccountId: true,
              type: true,
              currency: true,
              isActive: true,
              currentBalance: true,
            },
          });
        }
      }
      if (!targetAccount) continue;
    }

    const acctCurrency = normalizeCurrencyCode(targetAccount.currency, normalizedPostingCurrency);
    let delta: Prisma.Decimal;
    if (e.overrideDelta != null) {
      delta = e.overrideDelta;
    } else {
      delta = LIABILITY_EQUITY_ACCOUNT_TYPES.has(targetAccount.type)
        ? cr.sub(dr)
        : ASSET_ACCOUNT_TYPES.has(targetAccount.type)
          ? netAssetDelta
          : netAssetDelta;

      if (acctCurrency !== normalizedPostingCurrency) {
        const rates = await loadLatestExchangeRates(rawTx.exchangeRate, businessId);
        const mult = resolveConversionRate(normalizedPostingCurrency, acctCurrency, rates);
        if (mult == null) {
          throw new BadRequestException(
            `Currency mismatch between posting (${normalizedPostingCurrency}) and financial account ${targetAccount.id} (${acctCurrency}) with no configured exchange rate`,
          );
        }
        const converted = Math.round(Number(delta.toString()) * mult * 10000) / 10000;
        delta = new D(String(converted));
      }
    }

    deltas.push({
      ledgerEntryId: e.ledgerEntryId,
      entryIndex: idx,
      accountId: e.accountId,
      financialAccountId: targetAccount.id,
      delta,
    });
    metadataTargets.push({
      ...(e.ledgerEntryId ? { ledgerEntryId: e.ledgerEntryId } : {}),
      entryIndex: idx,
      accountId: e.accountId,
      financialAccountId: targetAccount.id,
      appliedDelta: delta.toString(),
      accountCurrency: acctCurrency,
    });
  }

  return { deltas, metadataTargets };
}

async function applyFinancialAccountBalanceDeltas(
  tx: Prisma.TransactionClient,
  deltas: ResolvedAccountDelta[],
): Promise<void> {
  if (deltas.length === 0) return;
  const faDelegate = (tx as unknown as { financialAccount?: TxFinancialAccountDelegate }).financialAccount;
  if (!faDelegate?.update) return;
  for (const item of deltas) {
    await faDelegate.update({
      where: { id: item.financialAccountId },
      data: { currentBalance: { increment: item.delta } },
    });
  }
}

function mergeMetadataWithFinancialAccountTargets(
  baseMetadata: Prisma.InputJsonValue | undefined,
  metadataTargets: PersistedEntryFinancialAccountTarget[],
): Prisma.InputJsonValue | undefined {
  if (metadataTargets.length === 0) return baseMetadata;
  const existingObj =
    baseMetadata && typeof baseMetadata === 'object' && !Array.isArray(baseMetadata)
      ? (baseMetadata as Record<string, unknown>)
      : {};
  const byCoaSet = new Map<string, Set<string>>();
  for (const t of metadataTargets) {
    const s = byCoaSet.get(t.accountId) ?? new Set<string>();
    s.add(t.financialAccountId);
    byCoaSet.set(t.accountId, s);
  }
  const byCoa: Record<string, string> = {};
  for (const [coaId, faSet] of byCoaSet.entries()) {
    if (faSet.size === 1) {
      byCoa[coaId] = Array.from(faSet)[0];
    }
  }
  return {
    ...existingObj,
    entryFinancialAccounts: metadataTargets as unknown as Prisma.InputJsonValue,
    entryFinancialAccountByCoa: byCoa as unknown as Prisma.InputJsonValue,
  };
}

export interface PostingInput {
  businessId: string;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'REFUND' | 'TAX' | 'ADJUSTMENT' | 'REVERSAL' | 'OPENING_BALANCE';
  date: Date;
  amount: Prisma.Decimal | number | string;
  currency?: string;
  description?: string;
  contactId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  /** Discriminator within (sourceType, sourceId) for idempotency. e.g. 'invoice_finalized', 'payment_received'. */
  kind?: string | null;
  reference?: string | null;
  notes?: string | null;
  metadata?: Prisma.InputJsonValue;
  createdById?: string | null;
  entries: PostingEntryInput[];
}

export interface PostingResult {
  transactionId: string;
  externalRef: string | null;
  alreadyPosted: boolean;
}

const D = Prisma.Decimal;
const ZERO = new D(0);
const TOLERANCE = new D('0.0001');

/**
 * Build the deterministic idempotency key used to dedupe re-postings.
 * Returns null when the caller does not pass enough info to dedupe; the
 * transaction will still be written but not idempotent.
 */
export function buildExternalRef(
  sourceType?: string | null,
  sourceId?: string | null,
  kind?: string | null,
): string | null {
  if (!sourceType || !sourceId) return null;
  const k = kind ?? 'default';
  return `${sourceType}:${sourceId}:${k}`;
}

/** Sum debits and credits to Decimal. Exposed for unit tests. */
export function sumEntries(entries: PostingEntryInput[]): { debit: Prisma.Decimal; credit: Prisma.Decimal } {
  let debit = ZERO;
  let credit = ZERO;
  for (const e of entries) {
    debit = debit.add(new D(String(e.debit ?? 0)));
    credit = credit.add(new D(String(e.credit ?? 0)));
  }
  return { debit, credit };
}

/**
 * Validate a posting batch BEFORE the DB transaction. Pure function so
 * unit tests can exercise every rejection path without a database.
 *
 * Rules enforced:
 *   - Must have at least 2 entries.
 *   - Every entry must have exactly one non-zero side (debit XOR credit).
 *   - Sum(debit) must equal sum(credit) within TOLERANCE.
 *   - All amounts must be non-negative.
 */
export function validatePosting(input: PostingInput): void {
  if (!input.businessId) throw new BadRequestException('Posting requires businessId');
  if (!input.entries || input.entries.length < 2) {
    throw new BadRequestException('Posting requires at least 2 ledger entries');
  }
  for (const [i, e] of input.entries.entries()) {
    if (!e.accountId) throw new BadRequestException(`Entry ${i}: accountId is required`);
    const dr = new D(String(e.debit ?? 0));
    const cr = new D(String(e.credit ?? 0));
    if (dr.lt(0) || cr.lt(0)) {
      throw new BadRequestException(`Entry ${i}: debit/credit must be non-negative`);
    }
    if (dr.eq(0) && cr.eq(0)) {
      throw new BadRequestException(`Entry ${i}: must have a non-zero debit or credit`);
    }
    if (dr.gt(0) && cr.gt(0)) {
      throw new BadRequestException(`Entry ${i}: cannot have both debit and credit set`);
    }
  }
  const { debit, credit } = sumEntries(input.entries);
  if (debit.sub(credit).abs().gt(TOLERANCE)) {
    throw new BadRequestException(
      `Unbalanced posting: debits (${debit.toString()}) != credits (${credit.toString()})`,
    );
  }
}

/**
 * The single entry point for writing to the ledger. Direct INSERTs into
 * `LedgerEntry` from anywhere else are forbidden by FIN1 architectural
 * rules — every monetary movement must come through here.
 */
@Injectable()
export class PostingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async post(input: PostingInput, txClient?: Prisma.TransactionClient): Promise<PostingResult> {
    validatePosting(input);

    const externalRef = buildExternalRef(input.sourceType, input.sourceId, input.kind);
    const exec = async (tx: Prisma.TransactionClient): Promise<PostingResult> => {
      // Idempotency check — scoped per business via the composite unique
      // index. Looking up by globally-unique externalRef would let one
      // tenant return another tenant's transactionId.
      if (externalRef) {
        const existing = await tx.financialTransaction.findUnique({
          where: { businessId_externalRef: { businessId: input.businessId, externalRef } },
          select: { id: true },
        });
        if (existing) {
          return { transactionId: existing.id, externalRef, alreadyPosted: true };
        }
      }

      // Verify every accountId belongs to the same businessId. Doing this
      // in one query (vs N round-trips) keeps the hot path fast.
      //
      // __skipTenantIsolation is load-bearing, not decoration. ChartOfAccount is
      // in BUSINESS_ID_MODELS, so without it the extension would add
      // `businessId: <ambient>` here — a foreign account would vanish from the
      // result set, the length check below would fire first with the misleading
      // "Unknown chart-of-account id(s)", and the cross-business throw that
      // follows it would become unreachable dead code. This query must SEE the
      // foreign row in order to reject it.
      const accountIds = Array.from(new Set(input.entries.map((e) => e.accountId)));
      const accounts = await tx.chartOfAccount.findMany(
        skipTenantIsolation({
          where: { id: { in: accountIds } },
          select: { id: true, businessId: true },
        }),
      );
      if (accounts.length !== accountIds.length) {
        const found = new Set(accounts.map((a) => a.id));
        const missing = accountIds.filter((id) => !found.has(id));
        throw new BadRequestException(`Unknown chart-of-account id(s): ${missing.join(', ')}`);
      }
      const wrongBusiness = accounts.filter((a) => a.businessId !== input.businessId);
      if (wrongBusiness.length > 0) {
        throw new BadRequestException(
          `Cross-business posting blocked: ${wrongBusiness.map((a) => a.id).join(', ')}`,
        );
      }

      // Verify contactId (when provided) belongs to the posting business.
      // Without this check a caller could attribute revenue to a foreign
      // tenant's contact and leak rows across businesses on subsequent reads.
      if (input.contactId) {
        const contact = await tx.contact.findUnique({
          where: { id: input.contactId },
          select: { businessId: true },
        });
        if (!contact || contact.businessId !== input.businessId) {
          throw new BadRequestException(
            `Contact ${input.contactId} does not belong to business ${input.businessId}`,
          );
        }
      }

      if (input.currency !== undefined && input.currency !== null && String(input.currency).trim() !== '') {
        const trimmedCurrency = String(input.currency).trim();
        if (!/^[A-Za-z]{3}$/.test(trimmedCurrency)) {
          throw new BadRequestException(`Invalid currency code: ${String(input.currency)}`);
        }
      }

      const rawTxWithBiz = tx as unknown as {
        business?: {
          findUnique?: (args: Record<string, unknown>) => Promise<{ currency?: string | null } | null>;
        };
        exchangeRate?: {
          findMany?: (args: Record<string, unknown>) => Promise<
            Array<{ fromCurrency: string; toCurrency: string; rate: number | string | { toString(): string } }>
          >;
        };
      };
      const rawClientWithBiz =
        (this.prisma?.client as unknown as {
          business?: {
            findUnique?: (args: Record<string, unknown>) => Promise<{ currency?: string | null } | null>;
          };
          exchangeRate?: {
            findMany?: (args: Record<string, unknown>) => Promise<
              Array<{ fromCurrency: string; toCurrency: string; rate: number | string | { toString(): string } }>
            >;
          };
        }) ?? {};

      const bizDelegate = rawTxWithBiz.business ?? rawClientWithBiz.business;
      const hasBusinessLookup = typeof bizDelegate?.findUnique === 'function';
      const bizRecord = hasBusinessLookup
        ? await bizDelegate!.findUnique!({
            where: { id: input.businessId },
            select: { currency: true },
          })
        : null;
      const businessBaseCurrency = normalizeCurrencyCode(bizRecord?.currency, 'TTD');
      const postingCurrency =
        input.currency && String(input.currency).trim() !== ''
          ? normalizeCurrencyCode(input.currency, businessBaseCurrency)
          : businessBaseCurrency;

      const fxDelegate = rawTxWithBiz.exchangeRate ?? rawClientWithBiz.exchangeRate;
      if (
        postingCurrency !== businessBaseCurrency &&
        hasBusinessLookup &&
        typeof fxDelegate?.findMany === 'function'
      ) {
        const rates = await loadLatestExchangeRates(fxDelegate, input.businessId);
        const rateToBase = resolveConversionRate(postingCurrency, businessBaseCurrency, rates);
        if (rateToBase == null) {
          throw new BadRequestException(
            `Unsupported foreign currency ${postingCurrency} for business ${input.businessId} (${businessBaseCurrency}): no configured exchange rate`,
          );
        }
      }

      const preparedEntries = input.entries.map((e) => ({
        ...e,
        ledgerEntryId: randomUUID(),
      }));
      const { deltas, metadataTargets } = await resolveFinancialAccountTargets(
        tx,
        input.businessId,
        preparedEntries,
        postingCurrency,
        input.type === 'OPENING_BALANCE',
        false,
      );
      const mergedMetadata = mergeMetadataWithFinancialAccountTargets(
        input.metadata,
        metadataTargets,
      );

      const txn = await tx.financialTransaction.create({
        data: {
          businessId: input.businessId,
          type: input.type,
          status: 'POSTED',
          date: input.date,
          amount: new D(String(input.amount)),
          currency: postingCurrency,
          description: input.description ?? null,
          contactId: input.contactId ?? null,
          sourceType: input.sourceType ?? null,
          sourceId: input.sourceId ?? null,
          externalRef,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          metadata: mergedMetadata,
          postedAt: new Date(),
          createdById: input.createdById ?? null,
          entries: {
            create: preparedEntries.map((e) => ({
              id: e.ledgerEntryId,
              businessId: input.businessId,
              accountId: e.accountId,
              debit: new D(String(e.debit ?? 0)),
              credit: new D(String(e.credit ?? 0)),
              currency: postingCurrency,
              date: input.date,
              memo: e.memo ?? null,
            })),
          },
        },
        select: { id: true },
      });
      await applyFinancialAccountBalanceDeltas(tx, deltas);
      return { transactionId: txn.id, externalRef, alreadyPosted: false };
    };

    try {
      const result = txClient
        ? await exec(txClient)
        : await this.prisma.client.$transaction(async (tx) =>
            exec(tx as unknown as Prisma.TransactionClient),
          );
      invalidateBusinessFinancialSnapshotCache(input.businessId);
      return result;
    } catch (err: any) {
      // Race: a concurrent caller wrote the same externalRef between our
      // check and our insert. Prisma raises P2002 on the unique index.
      if (
        externalRef &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const existing = await this.prisma.client.financialTransaction.findUnique({
          where: { businessId_externalRef: { businessId: input.businessId, externalRef } },
          select: { id: true },
        });
        if (existing) {
          invalidateBusinessFinancialSnapshotCache(input.businessId);
          return { transactionId: existing.id, externalRef, alreadyPosted: true };
        }
        throw new ConflictException('Posting conflict on externalRef');
      }
      throw err;
    }
  }

  /**
   * Reverse a previously posted transaction by writing offsetting entries
   * linked via reversalOfId. Original entries are NEVER updated/deleted.
   */
  async reverse(
    businessId: string,
    transactionId: string,
    opts: { reason?: string; createdById?: string | null } = {},
    txClient?: Prisma.TransactionClient,
  ): Promise<PostingResult> {
    if (!businessId) throw new BadRequestException('reverse requires businessId');
    const exec = async (tx: Prisma.TransactionClient): Promise<PostingResult> => {
      // Same shape as the chart-of-account check above, and the same reason.
      // FinancialTransaction is scoped, so an injected businessId would make a
      // foreign transaction return null, the "not found" below would fire, and
      // the explicit cross-business throw underneath it could never run — in
      // either direction, for any ambient value. The comparison IS the control;
      // this read has to be able to see the row it rejects.
      const original = await tx.financialTransaction.findUnique(
        skipTenantIsolation({
          where: { id: transactionId },
          include: { entries: true, reversedBy: true },
        }),
      );
      if (!original) throw new BadRequestException(`Transaction ${transactionId} not found`);
      // Tenant scoping — never reverse a transaction that belongs to a
      // different business than the caller asserts.
      if (original.businessId !== businessId) {
        throw new BadRequestException(
          `Transaction ${transactionId} does not belong to business ${businessId}`,
        );
      }
      if (original.status === 'REVERSED' || original.reversedBy) {
        throw new ConflictException(`Transaction ${transactionId} already reversed`);
      }
      // FIN6 will enforce reconciliation locks here.
      const lockedEntry = original.entries.find((e) => e.lockedByReconciliationId);
      if (lockedEntry) {
        throw new ConflictException(
          `Cannot reverse: entry ${lockedEntry.id} is locked by reconciliation ${lockedEntry.lockedByReconciliationId}`,
        );
      }

      const reversalEntries = original.entries.map((e, idx) => {
        const persistedTarget = extractFinancialAccountTargetFromMetadata(
          (original as { metadata?: unknown }).metadata,
          e.accountId,
          idx,
          e.id,
        );
        return {
          ledgerEntryId: randomUUID(),
          originalEntryId: e.id,
          accountId: e.accountId,
          financialAccountId: persistedTarget?.financialAccountId ?? null,
          overrideDelta:
            persistedTarget?.appliedDelta !== undefined
              ? new D(String(persistedTarget.appliedDelta)).neg()
              : null,
          debit: e.credit,
          credit: e.debit,
          currency: e.currency,
        };
      });

      const { deltas, metadataTargets } = await resolveFinancialAccountTargets(
        tx,
        original.businessId,
        reversalEntries,
        original.currency,
        original.type === 'OPENING_BALANCE',
        true,
      );
      const reversalMetadata = mergeMetadataWithFinancialAccountTargets(
        undefined,
        metadataTargets,
      );

      const reversal = await tx.financialTransaction.create({
        data: {
          businessId: original.businessId,
          type: 'REVERSAL',
          status: 'POSTED',
          date: new Date(),
          amount: original.amount,
          currency: original.currency,
          description: opts.reason ?? `Reversal of ${original.id}`,
          contactId: original.contactId,
          sourceType: original.sourceType,
          sourceId: original.sourceId,
          externalRef: original.externalRef ? `${original.externalRef}:reversal` : null,
          reversalOfId: original.id,
          reference: original.reference,
          notes: opts.reason ?? null,
          metadata: reversalMetadata,
          postedAt: new Date(),
          createdById: opts.createdById ?? null,
          entries: {
            create: reversalEntries.map((re) => ({
              id: re.ledgerEntryId,
              businessId: original.businessId,
              accountId: re.accountId,
              // Flip debit/credit to offset the original.
              debit: re.debit,
              credit: re.credit,
              currency: re.currency,
              date: new Date(),
              memo: `Reversal of entry ${re.originalEntryId}`,
            })),
          },
        },
        select: { id: true, externalRef: true },
      });

      await tx.financialTransaction.update({
        where: { id: original.id },
        data: { status: 'REVERSED' },
      });

      await applyFinancialAccountBalanceDeltas(tx, deltas);

      return { transactionId: reversal.id, externalRef: reversal.externalRef, alreadyPosted: false };
    };

    const result = txClient
      ? await exec(txClient)
      : await this.prisma.client.$transaction(async (tx) =>
          exec(tx as unknown as Prisma.TransactionClient),
        );
    invalidateBusinessFinancialSnapshotCache(businessId);
    return result;
  }
}

