#!/usr/bin/env tsx
/**
 * Backfill one own-tenant SUCCESSFUL Payment row for every live rowless PAID
 * invoice (`status = 'PAID'`, `deletedAt IS NULL`, `total > 0`) that has zero
 * own-tenant `SUCCESSFUL` `Payment` rows.
 *
 * WHY THIS EXISTS (V1-85 / FU-MARKETPLACE-PAID-PAYMENT-ROW, P120; D-249 / D-75 / D-14)
 *
 * Under SWP-INV-MONEY-TOTALS (D-249), revenue is read from own-tenant Payment
 * rows, with a fallback that counts a PAID invoice carrying no Payment row at
 * its total on its `paidAt` date. The legacy marketplace order writer and older
 * storefront checkouts left PAID invoices without a `SUCCESSFUL` Payment row.
 *
 * WHAT IT WRITES (only when `--apply` is passed)
 *
 * For each non-deleted `PAID` invoice with `total > 0` that has ZERO own-tenant
 * `SUCCESSFUL` `Payment` rows (`payments.business_id = invoices.business_id`,
 * D-75: foreign-tenant rows never hide an invoice's missing own-tenant row):
 *   - `businessId`: `invoice.businessId` (own tenant)
 *   - `invoiceId`: `invoice.id`
 *   - `amount`: `invoice.total`
 *   - `currency`: `invoice.currency` (fallback `'TTD'` if blank)
 *   - `status`: `'SUCCESSFUL'`
 *   - `provider`: `'backfill'` (never a live gateway provider, D-55)
 *   - `method`: `'other'`
 *   - `providerPaymentId`: `backfill:paid-invoice:${invoice.businessId}:${invoice.id}`
 *   - `createdAt`: `invoice.paidAt ?? invoice.createdAt` (lands revenue on the
 *     invoice's paid date matching D-249)
 *
 * SAFETY
 *
 * - Dry-run by default: reads and reports per-business counts and writes ZERO
 *   rows unless `--apply` is explicitly passed.
 * - Optional `--business-id=<id>` scopes both scan and write strictly to that
 *   single tenant.
 * - Each write locks the invoice row (`FOR UPDATE`), re-checks eligibility and
 *   own-tenant `SUCCESSFUL` payment existence inside `$transaction`, and uses
 *   `createMany({ skipDuplicates: true })` on the deterministic unique
 *   `providerPaymentId`, so re-runs and concurrent runs are 100% idempotent.
 * - Never touches invoices that already have an own-tenant `SUCCESSFUL`
 *   payment row, nor `DRAFT`/`SENT`/`PENDING`/`VOID`/soft-deleted/zero-total
 *   invoices.
 * - Never prints `DATABASE_URL` or customer PII; on errors logs only the error
 *   class/code.
 *
 * Usage (from apps/server; DATABASE_URL from env or repo-root .env):
 *   tsx --tsconfig scripts/tsconfig.json scripts/backfill-paid-invoice-payment-rows.ts
 *   tsx --tsconfig scripts/tsconfig.json scripts/backfill-paid-invoice-payment-rows.ts --business-id=<id>
 *   tsx --tsconfig scripts/tsconfig.json scripts/backfill-paid-invoice-payment-rows.ts --apply
 *   tsx --tsconfig scripts/tsconfig.json scripts/backfill-paid-invoice-payment-rows.ts --apply --business-id=<id>
 *
 * Exit status: 0 done, 1 failure, 2 bad arguments.
 */
import { db } from '@keyflow/db';

export type BackfillDbClient = Pick<typeof db, '$queryRawUnsafe' | '$transaction'>;

/** Deterministic unique Payment.providerPaymentId for a backfilled PAID invoice. */
export function backfillProviderPaymentId(businessId: string, invoiceId: string): string {
  return `backfill:paid-invoice:${businessId}:${invoiceId}`;
}

export interface BackfillBusinessSummary {
  businessId: string;
  rowlessPaidInvoices: number;
  wouldWrite: number;
  written: number;
  alreadyPresent: number;
  failed: number;
}

export interface BackfillPaidInvoicePaymentRowsOptions {
  /** When true, writes SUCCESSFUL Payment rows. Defaults to false (dry-run). */
  apply?: boolean;
  /** Optional single businessId scope. */
  businessId?: string;
  /** Optional list of businessIds (used for multi-tenant scoping / tests). */
  businessIds?: readonly string[];
}

export interface BackfillPaidInvoicePaymentRowsResult {
  apply: boolean;
  businessId: string | null;
  invoicesScanned: number;
  rowlessInvoicesFound: number;
  wouldWrite: number;
  written: number;
  alreadyPresent: number;
  failed: number;
  failedCodes: string[];
  byBusiness: Record<string, BackfillBusinessSummary>;
}

interface CandidateInvoiceRow {
  id: string;
  businessId: string;
  invoiceNumber: string | null;
  total: number;
  currency: string | null;
  paidAt: Date | null;
  createdAt: Date;
}

interface LockedInvoiceRow extends CandidateInvoiceRow {
  status: string;
  deletedAt: Date | null;
}

const PAGE_SIZE = 500;

function resolveBusinessScope(opts: BackfillPaidInvoicePaymentRowsOptions): string[] | null {
  if (opts.businessId && opts.businessIds && opts.businessIds.length > 0) {
    return [...new Set([opts.businessId, ...opts.businessIds])];
  }
  if (opts.businessId) return [opts.businessId];
  if (opts.businessIds && opts.businessIds.length > 0) return [...opts.businessIds];
  return null;
}

async function readCandidatePage(
  prisma: BackfillDbClient,
  cursor: string | null,
  businessIds: readonly string[] | null,
): Promise<CandidateInvoiceRow[]> {
  return prisma.$queryRawUnsafe<CandidateInvoiceRow[]>(
    `SELECT i.id AS "id",
            i.business_id AS "businessId",
            i.invoice_number AS "invoiceNumber",
            i.total AS "total",
            i.currency AS "currency",
            i.paid_at AS "paidAt",
            i.created_at AS "createdAt"
       FROM invoices i
      WHERE i.status::text = 'PAID'
        AND i.deleted_at IS NULL
        AND i.total > 0
        AND NOT EXISTS (
          SELECT 1
            FROM payments p
           WHERE p.invoice_id = i.id
             AND p.business_id = i.business_id
             AND p.status = 'SUCCESSFUL'
        )
        AND ($1::text IS NULL OR i.id > $1::text)
        AND ($2::text[] IS NULL OR i.business_id = ANY($2::text[]))
      ORDER BY i.id ASC
      LIMIT ${PAGE_SIZE}`,
    cursor,
    businessIds ? [...businessIds] : null,
  );
}

async function countEligiblePaidInvoices(
  prisma: BackfillDbClient,
  businessIds: readonly string[] | null,
): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ cnt: bigint | number | string }>>(
    `SELECT COUNT(*)::bigint AS "cnt"
       FROM invoices i
      WHERE i.status::text = 'PAID'
        AND i.deleted_at IS NULL
        AND i.total > 0
        AND ($1::text[] IS NULL OR i.business_id = ANY($1::text[]))`,
    businessIds ? [...businessIds] : null,
  );
  return Number(rows[0]?.cnt ?? 0);
}

async function writeBackfillPaymentRow(
  prisma: BackfillDbClient,
  candidate: CandidateInvoiceRow,
): Promise<'written' | 'already_present'> {
  const providerPaymentId = backfillProviderPaymentId(candidate.businessId, candidate.id);
  return prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRawUnsafe<LockedInvoiceRow[]>(
      `SELECT id AS "id",
              business_id AS "businessId",
              invoice_number AS "invoiceNumber",
              status::text AS "status",
              total AS "total",
              currency AS "currency",
              paid_at AS "paidAt",
              created_at AS "createdAt",
              deleted_at AS "deletedAt"
         FROM invoices
        WHERE id = $1
          AND business_id = $2
          FOR UPDATE`,
      candidate.id,
      candidate.businessId,
    );

    if (!locked || locked.deletedAt !== null || locked.status !== 'PAID' || !(Number(locked.total) > 0)) {
      return 'already_present';
    }

    const existing = await tx.payment.findFirst({
      where: {
        OR: [
          { providerPaymentId },
          { businessId: locked.businessId, invoiceId: locked.id, status: 'SUCCESSFUL' },
        ],
      },
      select: { id: true },
    });
    if (existing) return 'already_present';

    const currency = String(locked.currency ?? 'TTD').trim() || 'TTD';
    const paymentDate = locked.paidAt ? new Date(locked.paidAt) : new Date(locked.createdAt);

    const { count } = await tx.payment.createMany({
      data: [
        {
          businessId: locked.businessId,
          invoiceId: locked.id,
          amount: Number(locked.total),
          currency,
          status: 'SUCCESSFUL',
          provider: 'backfill',
          method: 'other',
          providerPaymentId,
          reference: locked.invoiceNumber ?? locked.id,
          notes: `Backfilled SUCCESSFUL payment row for rowless PAID invoice ${locked.invoiceNumber ?? locked.id} (D-249)`,
          createdAt: paymentDate,
        },
      ],
      skipDuplicates: true,
    });

    return count === 1 ? 'written' : 'already_present';
  });
}

function getOrInitBusinessSummary(
  byBusiness: Record<string, BackfillBusinessSummary>,
  businessId: string,
): BackfillBusinessSummary {
  if (!byBusiness[businessId]) {
    byBusiness[businessId] = {
      businessId,
      rowlessPaidInvoices: 0,
      wouldWrite: 0,
      written: 0,
      alreadyPresent: 0,
      failed: 0,
    };
  }
  return byBusiness[businessId];
}

/**
 * Scan live `PAID` invoices (`deletedAt IS NULL`, `total > 0`) that have zero
 * own-tenant `SUCCESSFUL` `Payment` rows. Dry-run by default (`apply: false`).
 * When `apply: true`, inserts exactly one own-tenant `SUCCESSFUL` `Payment`
 * row per rowless `PAID` invoice, preserving `paidAt ?? createdAt`.
 */
export async function runBackfillPaidInvoicePaymentRows(
  prisma: BackfillDbClient,
  opts: BackfillPaidInvoicePaymentRowsOptions = {},
): Promise<BackfillPaidInvoicePaymentRowsResult> {
  const apply = opts.apply === true;
  const scope = resolveBusinessScope(opts);
  const invoicesScanned = await countEligiblePaidInvoices(prisma, scope);

  const result: BackfillPaidInvoicePaymentRowsResult = {
    apply,
    businessId: opts.businessId ?? null,
    invoicesScanned,
    rowlessInvoicesFound: 0,
    wouldWrite: 0,
    written: 0,
    alreadyPresent: 0,
    failed: 0,
    failedCodes: [],
    byBusiness: {},
  };

  for (let cursor: string | null = null; ; ) {
    const page = await readCandidatePage(prisma, cursor, scope);
    if (page.length === 0) break;

    for (const row of page) {
      const biz = getOrInitBusinessSummary(result.byBusiness, row.businessId);
      result.rowlessInvoicesFound += 1;
      biz.rowlessPaidInvoices += 1;

      if (!apply) {
        result.wouldWrite += 1;
        biz.wouldWrite += 1;
        continue;
      }

      try {
        const outcome = await writeBackfillPaymentRow(prisma, row);
        if (outcome === 'written') {
          result.written += 1;
          biz.written += 1;
        } else {
          result.alreadyPresent += 1;
          biz.alreadyPresent += 1;
        }
      } catch (err: unknown) {
        result.failed += 1;
        biz.failed += 1;
        const code = (err as { code?: unknown } | null)?.code;
        const label = typeof code === 'string' ? code : err instanceof Error ? err.name : 'unknown';
        if (!result.failedCodes.includes(label)) result.failedCodes.push(label);
      }
    }

    cursor = page[page.length - 1].id;
  }

  return result;
}

export interface ParsedBackfillArgs {
  apply: boolean;
  businessId?: string;
  error?: string;
}

export function parseArgs(argv: string[]): ParsedBackfillArgs {
  let apply = false;
  let businessId: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      apply = true;
    } else if (arg.startsWith('--business-id=')) {
      const value = arg.slice('--business-id='.length).trim();
      if (!value) {
        return { apply, error: '--business-id requires a non-empty business id' };
      }
      businessId = value;
    } else if (arg === '--business-id') {
      const next = (argv[i + 1] ?? '').trim();
      if (!next || next.startsWith('--')) {
        return { apply, error: '--business-id requires a non-empty business id' };
      }
      businessId = next;
      i += 1;
    } else {
      return {
        apply,
        error: `Unknown argument: ${arg}. Usage: backfill-paid-invoice-payment-rows [--apply] [--business-id=<id>]`,
      };
    }
  }

  return { apply, businessId };
}

export function formatReport(result: BackfillPaidInvoicePaymentRowsResult): string[] {
  const row = (label: string, n: number) => `  ${label.padEnd(28)} ${n}`;
  const lines: string[] = [
    row('paid_invoices_scanned', result.invoicesScanned),
    row('rowless_paid_invoices', result.rowlessInvoicesFound),
    ...(result.apply
      ? [
          row('written', result.written),
          row('already_present', result.alreadyPresent),
          row('failed', result.failed) + (result.failedCodes.length > 0 ? `  (${result.failedCodes.join(', ')})` : ''),
        ]
      : [row('would_write', result.wouldWrite)]),
  ];

  const businesses = Object.values(result.byBusiness).sort((a, b) => a.businessId.localeCompare(b.businessId));
  if (businesses.length > 0) {
    lines.push('Per-business counts:');
    for (const b of businesses) {
      if (result.apply) {
        lines.push(
          `  ${b.businessId}: rowless=${b.rowlessPaidInvoices} written=${b.written} already_present=${b.alreadyPresent} failed=${b.failed}`,
        );
      } else {
        lines.push(`  ${b.businessId}: rowless=${b.rowlessPaidInvoices} would_write=${b.wouldWrite}`);
      }
    }
  }

  return lines;
}

function describeFailure(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? `${name} (code ${code})` : name;
}

type Log = (...args: unknown[]) => void;

export async function main(
  argv: string[],
  deps: { db?: BackfillDbClient; log?: Log; error?: Log } = {},
): Promise<number> {
  const log: Log = deps.log ?? console.log;
  const error: Log = deps.error ?? console.error;
  const parsed = parseArgs(argv);
  if (parsed.error) {
    error(parsed.error);
    return 2;
  }

  log(
    parsed.apply
      ? `Paid invoice payment-row backfill (D-249) - APPLY${parsed.businessId ? ` [business=${parsed.businessId}]` : ''}: writing missing own-tenant SUCCESSFUL payment rows`
      : `Paid invoice payment-row backfill (D-249) - DRY RUN${parsed.businessId ? ` [business=${parsed.businessId}]` : ''}: nothing is written; re-run with --apply to write`,
  );

  try {
    const result = await runBackfillPaidInvoicePaymentRows(deps.db ?? db, {
      apply: parsed.apply,
      businessId: parsed.businessId,
    });
    for (const line of formatReport(result)) log(line);
    return parsed.apply && result.failed > 0 ? 1 : 0;
  } catch (err: unknown) {
    error(`Paid invoice payment-row backfill failed: ${describeFailure(err)}`);
    return 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error(`Paid invoice payment-row backfill failed: ${describeFailure(err)}`);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
