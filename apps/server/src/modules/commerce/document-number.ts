import { Prisma } from '@prisma/client';

/**
 * V1-43-DM-NUMBERING (M22, CF-37; owner ruling D-15): invoice and quote
 * numbers are sequential per business, continuing from its current highest
 * number; existing numbers are never renumbered.
 *
 * No counter table (no migration): the next number is read from the rows
 * themselves and the existing unique indexes (business_id, invoice_number) and
 * (business_id, quote_number) are the guard. A writer calls
 * allocateDocumentNumber inside its own transaction, then inserts the row with
 * that number; its whole transaction runs under retryDocumentNumber, so an
 * insert that still meets the index (P2002: a writer that names its own number,
 * such as the storefront or document intake, took it first) rolls back and is
 * redone with the following number. A failed attempt therefore leaves nothing
 * behind: no Invoice, no posting, no event.
 *
 * Allocations in one business are serialized by a transaction-scoped advisory
 * lock (released at commit or rollback), so a burst of creates numbers
 * 1, 2, 3 ... instead of colliding and retrying round after round.
 */
export type DocumentKind = 'invoice' | 'quote';

const PREFIX: Record<DocumentKind, string> = { invoice: 'INV-', quote: 'QT-' };

/** The allocator's own form of a number: the one allocateDocumentNumber counts and draws. */
const SEQUENCE: Record<DocumentKind, RegExp> = { invoice: /^INV-[0-9]+$/, quote: /^QT-[0-9]+$/ };

/**
 * True when `value` has the form of the business's own sequence
 * (INV-<digits> / QT-<digits>), so a row holding it can be one the allocator drew.
 */
export function isSequenceNumber(value: string, kind: DocumentKind): boolean {
  return SEQUENCE[kind].test(value);
}

/** Attempts per create before a persistent collision is handed to the caller. */
export const DOCUMENT_NUMBER_ATTEMPTS = 5;

/** The advisory lock namespace (first key of pg_advisory_xact_lock(int, int)). */
const LOCK_NAMESPACE = 'kf-document-number:';

/** The slice of a Prisma (transaction) client the allocator uses. */
type RawClient = Pick<Prisma.TransactionClient, '$executeRaw' | '$queryRaw'>;

/**
 * The next number of `kind` in `businessId`: one above the highest
 * `<PREFIX><digits>` number the business holds, soft-deleted rows included
 * (they still occupy the unique index), zero-padded to four digits. Numbers
 * of any other form (INV-ORD-..., DEMO-..., a number a caller named) are kept
 * and not counted. Call it inside the transaction that inserts the row.
 */
export async function allocateDocumentNumber(tx: RawClient, businessId: string, kind: DocumentKind): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCK_NAMESPACE + kind}), hashtext(${businessId}))`;
  const rows =
    kind === 'invoice'
      ? await tx.$queryRaw<Array<{ max: string | null }>>`
          SELECT MAX(CAST(substring(invoice_number FROM '^INV-([0-9]+)$') AS numeric))::text AS max
          FROM invoices WHERE business_id = ${businessId}`
      : await tx.$queryRaw<Array<{ max: string | null }>>`
          SELECT MAX(CAST(substring(quote_number FROM '^QT-([0-9]+)$') AS numeric))::text AS max
          FROM quotes WHERE business_id = ${businessId}`;
  const highest = rows[0]?.max ? BigInt(rows[0].max) : 0n;
  return `${PREFIX[kind]}${(highest + 1n).toString().padStart(4, '0')}`;
}

/**
 * A unique-constraint failure (P2002) on the document number of `kind`, as
 * Prisma reports it: the constraint's fields (meta.target, or the driver
 * adapter's constraint), else the field list of the error's "Unique
 * constraint failed on the fields: (...)" line. Only those are read, never the
 * whole message: it quotes the calling source, which names invoiceNumber
 * whichever index failed (Invoice.quoteId on a quote conversion race).
 */
export function isDocumentNumberConflict(err: unknown, kind: DocumentKind): boolean {
  const e = err as {
    code?: unknown;
    message?: unknown;
    meta?: { target?: unknown; driverAdapterError?: { cause?: { constraint?: { fields?: unknown; index?: unknown } } } };
  } | null;
  if (e?.code !== 'P2002') return false;
  const constraint = e.meta?.driverAdapterError?.cause?.constraint;
  const named = [e.meta?.target, constraint?.fields, constraint?.index]
    .flatMap((v) => (Array.isArray(v) ? v : v == null ? [] : [v]))
    .map(String);
  const failed = /Unique constraint failed on the (?:fields|constraint): ([^\n]*)/i.exec(String(e.message ?? ''));
  if (failed) named.push(failed[1]);
  const field = kind === 'invoice' ? /invoice_?number/i : /quote_?number/i;
  return named.some((name) => field.test(name));
}

/**
 * Runs `attempt` (a writer's whole transaction, which allocates its number
 * inside) and runs it again when it fails on the document number's unique
 * index, up to DOCUMENT_NUMBER_ATTEMPTS times. Any other failure, and the last
 * collision, is thrown as it is.
 */
export async function retryDocumentNumber<T>(kind: DocumentKind, attempt: () => Promise<T>): Promise<T> {
  for (let n = 1; ; n += 1) {
    try {
      return await attempt();
    } catch (err) {
      if (n >= DOCUMENT_NUMBER_ATTEMPTS || !isDocumentNumberConflict(err, kind)) throw err;
    }
  }
}
