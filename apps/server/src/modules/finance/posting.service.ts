import { Inject, Injectable, BadRequestException, ConflictException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { skipTenantIsolation } from '@keyflow/db';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AccountingPeriodService } from './accounting-period.service';

export interface PostingEntryInput {
  /** ChartOfAccount.id this entry posts against. */
  accountId: string;
  debit?: Prisma.Decimal | number | string;
  credit?: Prisma.Decimal | number | string;
  memo?: string;
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
 * V1-37-DM-CURRENCY (CF-38; owner ruling D-13): the currencies KEYFLOW
 * supports. One currency per business, documents default to it.
 */
export const D13_CURRENCIES: readonly string[] = ['TTD', 'USD'];

/** An ISO currency code as stored and compared: trimmed, upper-case; '' when absent. */
export function normalizeCurrency(currency?: string | null): string {
  return typeof currency === 'string' ? currency.trim().toUpperCase() : '';
}

/**
 * The currency a posting is written in, under the D-13 policy (V1-37). Pure,
 * so the unit spec reaches every branch; post() applies it inside the posting
 * transaction with the business currency read alongside the chart rows.
 *
 *   - No currency: the business currency. (It was the literal 'TTD', so a USD
 *     business's manual journal, recurring journal and tax payment were TTD.)
 *   - The business currency: always postable, also one that predates D-13.
 *   - Another currency is a mismatch. D-13 allows it only for a supported
 *     currency (TTD, USD) carried by a source document (sourceType and
 *     sourceId): the document's explicit currency wins (a TTD business's USD
 *     invoice, its AR and its payments; V1-15 TB-01). A sourceless mismatch (a
 *     manual or KEY journal in a currency the business does not keep) and any
 *     unsupported currency are refused with 400 before anything is written.
 *
 * The ledger stays balanced per currency: every entry carries the posting's
 * one currency, and the trial balance groups by it (LedgerBalanceService).
 */
export function resolvePostingCurrency(
  input: Pick<PostingInput, 'currency' | 'sourceType' | 'sourceId'>,
  businessCurrency: string,
): string {
  const business = normalizeCurrency(businessCurrency);
  const requested = normalizeCurrency(input.currency);
  if (!requested || requested === business) return business;
  if (!D13_CURRENCIES.includes(requested)) {
    throw new BadRequestException(
      `Unsupported posting currency ${requested}: the business currency is ${business}; supported currencies are ${D13_CURRENCIES.join(', ')}`,
    );
  }
  if (!input.sourceType || !input.sourceId) {
    throw new BadRequestException(
      `Posting currency ${requested} differs from the business currency ${business}: only a posting from a source document may carry another currency`,
    );
  }
  return requested;
}

/**
 * The single entry point for writing to the ledger. Direct INSERTs into
 * `LedgerEntry` from anywhere else are forbidden by FIN1 architectural
 * rules — every monetary movement must come through here.
 * (V1-15: enforced by ledger-writer-integrity.spec.ts.)
 *
 * V1-15 (CF-40): post() and reverse() refuse, with 409, a transaction dated
 * inside a CLOSED accounting period of the posting business, checked inside
 * the posting transaction under the period lock of its date's month (held
 * shared, so a concurrent close of that month waits for the posting and
 * stamps it; V1-15 review SEC-V15-3, scoped to the month by repair2 LC-1).
 * A period can be closed only once it has ended, so what is dated
 * now (payments, provider settlements, refunds, every reversal) is never
 * refused (SEC-V15-1). AccountingPeriodService is @Optional only so that
 * hand-built instances in hermetic unit specs keep working; every Nest module
 * that provides PostingService must provide it too (pinned by
 * ledger-writer-integrity.spec.ts, LWI-04), so the running app always checks.
 */
@Injectable()
export class PostingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(AccountingPeriodService) private readonly periods?: AccountingPeriodService | null,
  ) {}

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

      // V1-15 (CF-40): nothing new is dated inside a CLOSED period. After the
      // idempotency lookup on purpose: a replay of a posting that already
      // exists writes nothing, so it returns that posting even once its
      // period has closed.
      await this.periods?.assertOpenForPosting(input.businessId, input.date, tx);

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
      //
      // V1-37: each row also carries its business's currency, so the D-13
      // currency check below reads it in the same query.
      const accountIds = Array.from(new Set(input.entries.map((e) => e.accountId)));
      const accounts = await tx.chartOfAccount.findMany(
        skipTenantIsolation({
          where: { id: { in: accountIds } },
          select: { id: true, businessId: true, business: { select: { currency: true } } },
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

      // V1-37 (CF-38, D-13): the posting's one currency. Every account is the
      // posting business's here, so any row names its currency. A stub that
      // returns no business relation reads as the schema default.
      const currency = resolvePostingCurrency(input, accounts[0]?.business?.currency ?? 'TTD');

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

      const txn = await tx.financialTransaction.create({
        data: {
          businessId: input.businessId,
          type: input.type,
          status: 'POSTED',
          date: input.date,
          amount: new D(String(input.amount)),
          currency,
          description: input.description ?? null,
          contactId: input.contactId ?? null,
          sourceType: input.sourceType ?? null,
          sourceId: input.sourceId ?? null,
          externalRef,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          metadata: input.metadata,
          postedAt: new Date(),
          createdById: input.createdById ?? null,
          entries: {
            create: input.entries.map((e) => ({
              businessId: input.businessId,
              accountId: e.accountId,
              debit: new D(String(e.debit ?? 0)),
              credit: new D(String(e.credit ?? 0)),
              currency,
              date: input.date,
              memo: e.memo ?? null,
            })),
          },
        },
        select: { id: true },
      });
      return { transactionId: txn.id, externalRef, alreadyPosted: false };
    };

    try {
      if (txClient) return await exec(txClient);
      return await this.prisma.client.$transaction(async (tx) =>
        exec(tx as unknown as Prisma.TransactionClient),
      );
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

      // The reversal is dated now (V1-15). The original may sit in a closed
      // period: it is offset in the open one, never edited. A period closes
      // only after it ends, so "now" never lies in an enforced closed period;
      // the check stays so every write through the door takes the period lock.
      const reversalDate = new Date();
      await this.periods?.assertOpenForPosting(original.businessId, reversalDate, tx);

      const reversal = await tx.financialTransaction.create({
        data: {
          businessId: original.businessId,
          type: 'REVERSAL',
          status: 'POSTED',
          date: reversalDate,
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
          postedAt: new Date(),
          createdById: opts.createdById ?? null,
          entries: {
            create: original.entries.map((e) => ({
              businessId: original.businessId,
              accountId: e.accountId,
              // Flip debit/credit to offset the original.
              debit: e.credit,
              credit: e.debit,
              currency: e.currency,
              date: reversalDate,
              memo: `Reversal of entry ${e.id}`,
            })),
          },
        },
        select: { id: true, externalRef: true },
      });

      await tx.financialTransaction.update({
        where: { id: original.id },
        data: { status: 'REVERSED' },
      });

      return { transactionId: reversal.id, externalRef: reversal.externalRef, alreadyPosted: false };
    };

    if (txClient) return exec(txClient);
    return this.prisma.client.$transaction(async (tx) =>
      exec(tx as unknown as Prisma.TransactionClient),
    );
  }
}
