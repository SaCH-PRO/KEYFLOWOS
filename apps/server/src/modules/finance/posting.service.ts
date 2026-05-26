import { Inject, Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

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
      const accountIds = Array.from(new Set(input.entries.map((e) => e.accountId)));
      const accounts = await tx.chartOfAccount.findMany({
        where: { id: { in: accountIds } },
        select: { id: true, businessId: true },
      });
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

      const txn = await tx.financialTransaction.create({
        data: {
          businessId: input.businessId,
          type: input.type,
          status: 'POSTED',
          date: input.date,
          amount: new D(String(input.amount)),
          currency: input.currency ?? 'TTD',
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
              currency: input.currency ?? 'TTD',
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
    } catch (err) {
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
      const original = await tx.financialTransaction.findUnique({
        where: { id: transactionId },
        include: { entries: true, reversedBy: true },
      });
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
              date: new Date(),
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
