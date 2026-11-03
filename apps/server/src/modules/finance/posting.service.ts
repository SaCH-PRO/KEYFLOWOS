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
 *
 * V1-37d-LEGACY-CURRENCY-PAYMENTS (verify-money VR-04): money that follows a
 * legacy document, an invoice stored in a currency outside D-13 before D-13
 * held it (a TTD business's JMD invoice), posts in that document's own
 * currency, as the base did. `followedDocumentCurrency` is that stored
 * currency, which post() reads itself (followedDocumentCurrency below); a
 * sourced posting in exactly that currency is accepted. Every other document
 * is new and held to D-13: where it is written (CommerceService.documentCurrency,
 * RecurringInvoiceService) and, for the writers that do not check yet
 * (storefront checkout, quote conversion, marketplace, KEY), here, where its
 * money keeps the refusal above (V1-37d review ST-V37D-1 / CR-V37D-1). A
 * posting that follows no legacy document keeps the refusal too.
 */
export function resolvePostingCurrency(
  input: Pick<PostingInput, 'currency' | 'sourceType' | 'sourceId'>,
  businessCurrency: string,
  followedDocumentCurrency?: string | null,
): string {
  const business = normalizeCurrency(businessCurrency);
  const requested = normalizeCurrency(input.currency);
  if (!requested || requested === business) return business;
  const sourced = Boolean(input.sourceType && input.sourceId);
  if (sourced && normalizeCurrency(followedDocumentCurrency) === requested) return requested;
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
 * V1-37d review (ST-V37D-1 / CR-V37D-1): the day D-13 began to hold new
 * documents to its currencies (V1-37, CommerceService.documentCurrency). An
 * invoice created before it was written when any currency was allowed: it is a
 * legacy document. One created on or after it is a new document, whichever
 * writer made it, so its money is held to D-13 at this door. It may be moved to
 * the day D-13 reaches production, never later (a later day would let the money
 * of a new document in an unsupported currency through again).
 */
export const D13_DOCUMENTS_FROM = new Date('2026-11-02T00:00:00.000Z');

/**
 * V1-37d: the currency of the legacy document a posting follows, read only
 * when the posting needs it (a currency that is neither the business's nor a
 * D-13 one). Read from the posting business's rows, never taken from the
 * caller. Two postings follow an invoice:
 *   - one sourced by a Payment (its recording, a partial refund of it) follows
 *     the payment's invoice, when the payment carries the invoice's currency;
 *   - an invoice's COGS (sourceType Invoice, kind 'cogs', posted when it
 *     becomes PAID) follows that invoice (V1-37d review ST-V37D-3).
 * The invoice must be that business's, not deleted, stored in the requested
 * currency, and legacy: created before D13_DOCUMENTS_FROM, or already holding
 * money in that currency in the ledger (its receivable, or the posting of one
 * of its payments). A new document never gets that money: the door refuses
 * its first posting in the currency, so the second test cannot open for it.
 * Anything else follows no legacy document (null) and keeps the D-13 refusal:
 * an invoice's receivable is the document being issued (a legacy draft issued
 * now is a new document), and any other invoice-sourced posting is not money
 * that follows it. A void and a full refund are reversals (reverse()), which
 * copy the original's currency and never come here.
 */
async function followedDocumentCurrency(
  tx: Prisma.TransactionClient,
  input: Pick<PostingInput, 'businessId' | 'currency' | 'sourceType' | 'sourceId' | 'kind'>,
  businessCurrency: string,
): Promise<string | null> {
  const requested = normalizeCurrency(input.currency);
  if (!requested || requested === normalizeCurrency(businessCurrency) || D13_CURRENCIES.includes(requested)) {
    return null;
  }
  if (!input.sourceId) return null;
  const invoiceSelect = { id: true, businessId: true, currency: true, deletedAt: true, createdAt: true } as const;
  let invoice: { id: string; businessId: string; currency: string; deletedAt: Date | null; createdAt: Date } | null;
  if (input.sourceType === 'Payment') {
    const payment = await tx.payment.findFirst({
      where: { id: input.sourceId, businessId: input.businessId },
      select: { currency: true, invoice: { select: invoiceSelect } },
    });
    if (!payment || normalizeCurrency(payment.currency) !== requested) return null;
    invoice = payment.invoice ?? null;
  } else if (input.sourceType === 'Invoice' && input.kind === 'cogs') {
    invoice = await tx.invoice.findFirst({
      where: { id: input.sourceId, businessId: input.businessId },
      select: invoiceSelect,
    });
  } else {
    return null;
  }
  if (!invoice || invoice.businessId !== input.businessId || invoice.deletedAt) return null;
  if (normalizeCurrency(invoice.currency) !== requested) return null;
  if (invoice.createdAt instanceof Date && invoice.createdAt.getTime() < D13_DOCUMENTS_FROM.getTime()) return requested;
  return (await holdsMoneyIn(tx, input.businessId, invoice.id, requested)) ? requested : null;
}

/**
 * V1-37d review: whether the ledger already holds money of `invoiceId` in
 * `currency`: its receivable (or any other posting sourced by it) or the
 * posting of one of its payments, all of `businessId`. The currency is compared
 * case-insensitively (a row the base wrote may not be upper-case).
 */
async function holdsMoneyIn(
  tx: Prisma.TransactionClient,
  businessId: string,
  invoiceId: string,
  currency: string,
): Promise<boolean> {
  const payments = await tx.payment.findMany({
    where: { invoiceId, businessId },
    select: { id: true },
  });
  const paymentIds = payments.map((p) => p.id);
  const prior = await tx.financialTransaction.findFirst({
    where: {
      businessId,
      currency: { equals: currency, mode: 'insensitive' },
      OR: [
        { sourceType: 'Invoice', sourceId: invoiceId },
        ...(paymentIds.length > 0 ? [{ sourceType: 'Payment', sourceId: { in: paymentIds } }] : []),
      ],
    },
    select: { id: true },
  });
  return Boolean(prior);
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
      // V1-37d: money that follows a legacy invoice (stored in its currency
      // before D-13) posts in that invoice's currency (read here, inside the
      // posting transaction).
      const businessCurrency = accounts[0]?.business?.currency ?? 'TTD';
      const currency = resolvePostingCurrency(
        input,
        businessCurrency,
        await followedDocumentCurrency(tx, input, businessCurrency),
      );

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
