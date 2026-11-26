#!/usr/bin/env tsx
/**
 * Backfill one own-tenant SUCCESSFUL Payment row for every live rowless PAID
 * invoice (`status = 'PAID'`, `deletedAt IS NULL`, non-deleted business,
 * finite rounded `total > 0`) that has zero own-tenant settling `Payment` rows.
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
 * For each non-deleted `PAID` invoice on a non-deleted business with finite
 * rounded `total > 0` that has ZERO own-tenant settling `Payment` rows
 * (`payments.business_id = invoices.business_id` AND
 * `status = 'SUCCESSFUL' OR (status = 'REFUNDED' AND amount > 0)` — D-75 &
 * pre-V1-29 positive REFUNDED rows excluded; negative REFUNDED rows remain
 * eligible per D-250 / MT-15 so `SUCCESSFUL +total` + `REFUNDED -refund`
 * preserves net revenue):
 *   - `businessId`: `invoice.businessId` (own tenant)
 *   - `invoiceId`: `invoice.id`
 *   - `amount`: D-13 rounded `invoice.total`
 *   - `currency`: trimmed upper-case `invoice.currency` (fallback `'TTD'` if blank)
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
 * - Optional `--business-id=<id>` / `--business=<id>` (repeatable) scopes both
 *   scan and write strictly to the named tenant(s). Fail-closed: empty/blank
 *   ids throw; an empty `businessIds: []` matches 0 rows (never widens to all
 *   tenants).
 * - Each write locks ONLY the invoice row (`FOR UPDATE OF i` joined to
 *   `businesses` with `b.deleted_at IS NULL`), re-checks eligibility and
 *   own-tenant settling payment existence inside `$transaction`, and uses
 *   `createMany({ skipDuplicates: true })` on the deterministic unique
 *   `providerPaymentId`, so re-runs and concurrent runs are 100% idempotent.
 * - Never touches invoices that already have an own-tenant `SUCCESSFUL` or
 *   legacy positive `REFUNDED` payment row, nor `DRAFT`/`SENT`/`PENDING`/
 *   `VOID`/soft-deleted/soft-deleted-business/zero/sub-cent/`NaN`/`Infinity`
 *   invoices.
 * - Never prints `DATABASE_URL` or customer PII; on errors logs only the error
 *   class/code.
 *
 * Usage (from apps/server; DATABASE_URL from env or repo-root .env):
 *   tsx --tsconfig scripts/tsconfig.json scripts/backfill-paid-invoice-payment-rows.ts [--dry-run]
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

/**
 * Exact decimal half-away-from-zero cent rounding (matches D-13 `roundMoney`
 * in `apps/server/src/modules/commerce/money.ts`, kept standalone so this
 * operator script runs without `apps/server/src/` in the API container image).
 */
const TEN = BigInt(10);
const TWO = BigInt(2);
const ZERO = BigInt(0);
const ONE = BigInt(1);

function roundMoneyCents(amount: number): number {
  if (!Number.isFinite(amount)) return Number.NaN;
  const [coefficient, exponent] = String(amount).split('e');
  const negative = coefficient.startsWith('-');
  const digits = negative ? coefficient.slice(1) : coefficient;
  const dot = digits.indexOf('.');
  const whole = dot < 0 ? digits : digits.slice(0, dot) + digits.slice(dot + 1);
  const e = (exponent ? Number(exponent) : 0) - (dot < 0 ? 0 : digits.length - dot - 1);
  const m = negative ? -BigInt(whole) : BigInt(whole);
  const shift = e + 2;
  let cents: bigint;
  if (shift >= 0) {
    cents = m * TEN ** BigInt(shift);
  } else {
    const d = TEN ** BigInt(-shift);
    const q = m / d;
    const r = m % d;
    const abs = r < ZERO ? -r : r;
    cents = abs * TWO >= d ? (m < ZERO ? q - ONE : q + ONE) : q;
  }
  return cents === ZERO ? 0 : Number(cents) / 100;
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
  /** Optional single businessId scope. Must be non-empty when provided. */
  businessId?: string;
  /** Optional list of businessIds. Empty array matches 0 rows (fail-closed). */
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

/**
 * R1-SEC-02 (fail-closed):
 * - If neither `businessId` nor `businessIds` is provided (`undefined`), returns
 *   `null` (scan all non-deleted businesses).
 * - If `businessId` is provided, trims and throws on non-string or blank input.
 * - If `businessIds` is provided, validates every entry is a non-empty string
 *   (throws otherwise); an empty array returns `[]` so SQL matches 0 rows and
 *   NEVER widens to all tenants.
 */
export function resolveBusinessScope(opts: BackfillPaidInvoicePaymentRowsOptions): string[] | null {
  const scoped: string[] = [];
  let scopeProvided = false;

  if (opts.businessId !== undefined) {
    scopeProvided = true;
    if (typeof opts.businessId !== 'string' || opts.businessId.trim().length === 0) {
      throw new Error('businessId must be a non-empty string when provided');
    }
    scoped.push(opts.businessId.trim());
  }

  if (opts.businessIds !== undefined) {
    scopeProvided = true;
    for (const rawId of opts.businessIds) {
      if (typeof rawId !== 'string' || rawId.trim().length === 0) {
        throw new Error('Every entry in businessIds must be a non-empty string');
      }
      scoped.push(rawId.trim());
    }
  }

  if (!scopeProvided) return null;
  return [...new Set(scoped)];
}

async function readCandidatePage(
  prisma: BackfillDbClient,
  cursor: string | null,
  businessIds: readonly string[] | null,
): Promise<CandidateInvoiceRow[]> {
  if (businessIds !== null && businessIds.length === 0) return [];
  return prisma.$queryRawUnsafe<CandidateInvoiceRow[]>(
    `SELECT i.id AS "id",
            i.business_id AS "businessId",
            i.invoice_number AS "invoiceNumber",
            i.total AS "total",
            i.currency AS "currency",
            i.paid_at AS "paidAt",
            i.created_at AS "createdAt"
       FROM invoices i
       INNER JOIN businesses b ON b.id = i.business_id AND b.deleted_at IS NULL
      WHERE i.status::text = 'PAID'
        AND i.deleted_at IS NULL
        AND i.total > 0
        AND i.total < 'Infinity'::float8
        AND i.total != 'NaN'::float8
        AND NOT EXISTS (
          SELECT 1
            FROM payments p
           WHERE p.invoice_id = i.id
             AND p.business_id = i.business_id
             AND (p.status = 'SUCCESSFUL' OR (p.status = 'REFUNDED' AND p.amount > 0))
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
  if (businessIds !== null && businessIds.length === 0) return 0;
  const rows = await prisma.$queryRawUnsafe<Array<{ cnt: bigint | number | string }>>(
    `SELECT COUNT(*)::bigint AS "cnt"
       FROM invoices i
       INNER JOIN businesses b ON b.id = i.business_id AND b.deleted_at IS NULL
      WHERE i.status::text = 'PAID'
        AND i.deleted_at IS NULL
        AND i.total > 0
        AND i.total < 'Infinity'::float8
        AND i.total != 'NaN'::float8
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
      `SELECT i.id AS "id",
              i.business_id AS "businessId",
              i.invoice_number AS "invoiceNumber",
              i.status::text AS "status",
              i.total AS "total",
              i.currency AS "currency",
              i.paid_at AS "paidAt",
              i.created_at AS "createdAt",
              i.deleted_at AS "deletedAt"
         FROM invoices i
         INNER JOIN businesses b ON b.id = i.business_id
        WHERE i.id = $1
          AND i.business_id = $2
          AND b.deleted_at IS NULL
          FOR UPDATE OF i`,
      candidate.id,
      candidate.businessId,
    );

    if (!locked || locked.deletedAt !== null || locked.status !== 'PAID') {
      return 'already_present';
    }

    const amount = roundMoneyCents(Number(locked.total));
    if (!Number.isFinite(amount) || !(amount > 0)) {
      return 'already_present';
    }

    const existing = await tx.payment.findFirst({
      where: {
        OR: [
          { providerPaymentId },
          { businessId: locked.businessId, invoiceId: locked.id, status: 'SUCCESSFUL' },
          { businessId: locked.businessId, invoiceId: locked.id, status: 'REFUNDED', amount: { gt: 0 } },
        ],
      },
      select: { id: true },
    });
    if (existing) return 'already_present';

    const currency = String(locked.currency ?? 'TTD').trim().toUpperCase() || 'TTD';
    const paymentDate = locked.paidAt ? new Date(locked.paidAt) : new Date(locked.createdAt);

    const { count } = await tx.payment.createMany({
      data: [
        {
          businessId: locked.businessId,
          invoiceId: locked.id,
          amount,
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
 * Scan live `PAID` invoices (`deletedAt IS NULL`, non-deleted business, finite
 * rounded `total > 0`) that have zero own-tenant settling `Payment` rows.
 * Dry-run by default (`apply: false`). When `apply: true`, inserts exactly one
 * own-tenant `SUCCESSFUL` `Payment` row per rowless `PAID` invoice, preserving
 * `paidAt ?? createdAt`.
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
    businessId: opts.businessId !== undefined ? opts.businessId.trim() : null,
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
      const roundedAmount = roundMoneyCents(Number(row.total));
      if (!Number.isFinite(roundedAmount) || !(roundedAmount > 0)) {
        continue;
      }

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
  dryRun: boolean;
  businessId?: string;
  businessIds: string[];
  error?: string;
}

export function parseArgs(argv: string[]): ParsedBackfillArgs {
  let apply = false;
  let dryRun = false;
  const businessIds: string[] = [];

  const addBusiness = (raw: string, flag: string): string | null => {
    const value = raw.trim();
    if (!value || value.startsWith('--')) {
      return `${flag} requires a non-empty business id`;
    }
    if (!businessIds.includes(value)) businessIds.push(value);
    return null;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      apply = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--business-id=')) {
      const err = addBusiness(arg.slice('--business-id='.length), '--business-id');
      if (err) return { apply, dryRun, businessIds, error: err };
    } else if (arg === '--business-id') {
      const err = addBusiness(argv[i + 1] ?? '', '--business-id');
      if (err) return { apply, dryRun, businessIds, error: err };
      i += 1;
    } else if (arg.startsWith('--business=')) {
      const err = addBusiness(arg.slice('--business='.length), '--business');
      if (err) return { apply, dryRun, businessIds, error: err };
    } else if (arg === '--business') {
      const err = addBusiness(argv[i + 1] ?? '', '--business');
      if (err) return { apply, dryRun, businessIds, error: err };
      i += 1;
    } else {
      return {
        apply,
        dryRun,
        businessIds,
        error: `Unknown argument: ${arg}. Usage: backfill-paid-invoice-payment-rows [--dry-run | --apply] [--business-id=<id> | --business=<id>]...`,
      };
    }
  }

  if (apply && dryRun) {
    return {
      apply,
      dryRun,
      businessIds,
      error: 'Cannot pass both --dry-run and --apply together',
    };
  }

  return {
    apply,
    dryRun,
    businessId: businessIds.length === 1 ? businessIds[0] : undefined,
    businessIds,
  };
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

  const scopeBanner =
    parsed.businessIds.length > 0 ? ` [businesses=${parsed.businessIds.join(',')}]` : '';
  log(
    parsed.apply
      ? `Paid invoice payment-row backfill (D-249) - APPLY${scopeBanner}: writing missing own-tenant SUCCESSFUL payment rows`
      : `Paid invoice payment-row backfill (D-249) - DRY RUN${scopeBanner}: nothing is written; re-run with --apply to write`,
  );

  try {
    const result = await runBackfillPaidInvoicePaymentRows(deps.db ?? db, {
      apply: parsed.apply,
      ...(parsed.businessIds.length === 1
        ? { businessId: parsed.businessIds[0] }
        : parsed.businessIds.length > 1
          ? { businessIds: parsed.businessIds }
          : {}),
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
