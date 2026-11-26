#!/usr/bin/env tsx
/**
 * Read-only census of which key every stored `enc:v1:` token column value was
 * encrypted under (packet RR-DB-CRYPTO-KEY-CENSUS, V1-72; rulings D-261, D-262, D-174).
 *
 * WHY THIS EXISTS
 *
 * DiagnosticsService.checkTokenEncryptionKeySource() reports only which key env var
 * is set NOW. It cannot see rows that were encrypted under the in-repo dev fallback
 * before that variable was set, nor rows encrypted by core/crypto under
 * DRIVE_TOKEN_ENCRYPTION_SECRET (which packages/db does not read). Landing the
 * packages/db production key guard before checking stored rows would turn any such
 * row undecryptable.
 *
 * WHAT THIS DOES (DETECT AND REPORT ONLY — ZERO WRITES, NO --apply)
 *
 *   1. Reads the exact model/column list from `@keyflow/db`'s `ENCRYPTED_FIELDS`
 *      and resolves table/column names from Prisma's DMMF (single source of truth).
 *   2. Opens a PostgreSQL read-only transaction (`SET TRANSACTION READ ONLY`) and
 *      walks every column in pages with raw `SELECT id, "<col>"` queries.
 *   3. Classifies every non-null, non-empty value via `classifyStoredToken()` into
 *      one of: `plaintext`, `current`, `fallback`, `core-chain`, `undecryptable`.
 *   4. Prints counts per `Model.field` per label and the row `id`s of non-`current`
 *      rows. Never prints token plaintexts, ciphertexts, key material, or DATABASE_URL.
 *
 * Usage (from apps/server):
 *   tsx --tsconfig scripts/tsconfig.json --env-file-if-exists=../../.env scripts/token-encryption-key-census.ts
 *   tsx --tsconfig scripts/tsconfig.json --env-file-if-exists=../../.env scripts/token-encryption-key-census.ts --json
 *   tsx --tsconfig scripts/tsconfig.json --env-file-if-exists=../../.env scripts/token-encryption-key-census.ts --page-size=500
 *
 * Exit status: 0 done, 1 database read failure, 2 bad arguments (including --apply).
 */
import {
  db,
  Prisma,
  ENCRYPTED_FIELDS,
  classifyStoredToken,
  tokenEncryptionKeySource,
  type TokenEncryptionKeyLabel,
  type TokenEncryptionKeyVar,
} from '@keyflow/db';

const DEFAULT_PAGE_SIZE = 500;
const TRANSACTION_MAX_WAIT_MS = 10_000;
const TRANSACTION_TIMEOUT_MS = 300_000;
const SAFE_SQL_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

const LABELS: readonly TokenEncryptionKeyLabel[] = [
  'plaintext',
  'current',
  'fallback',
  'core-chain',
  'undecryptable',
] as const;

export type NonCurrentTokenLabel = Exclude<TokenEncryptionKeyLabel, 'current'>;

export interface EncryptedColumnTarget {
  model: string;
  field: string;
  column: string;
  table: string;
  dbColumn: string;
}

export interface ColumnCensusResult {
  model: string;
  field: string;
  column: string;
  table: string;
  dbColumn: string;
  scanned: number;
  counts: Record<TokenEncryptionKeyLabel, number>;
  nonCurrentIds: Record<NonCurrentTokenLabel, string[]>;
}

export interface TokenEncryptionKeyCensusReport {
  keySource: TokenEncryptionKeyVar | null;
  coreChainVarSet: boolean;
  pageSize: number;
  columns: ColumnCensusResult[];
  totals: Record<TokenEncryptionKeyLabel, number>;
}

export interface TokenEncryptionKeyCensusOptions {
  pageSize?: number;
  encryptedFields?: Record<string, readonly string[]>;
}

export interface CensusQueryClient {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

export interface CensusDb extends CensusQueryClient {
  $transaction<T>(
    fn: (tx: CensusQueryClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T>;
}

type Log = (...args: unknown[]) => void;

export type ParsedArgs =
  | { json: boolean; pageSize: number }
  | { error: string };

export function parseArgs(argv: string[]): ParsedArgs {
  let json = false;
  let pageSize = DEFAULT_PAGE_SIZE;

  for (const arg of argv) {
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg.startsWith('--page-size=')) {
      const raw = arg.slice('--page-size='.length).trim();
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1) {
        return { error: '--page-size= must be a positive integer' };
      }
      pageSize = parsed;
      continue;
    }
    if (arg === '--apply') {
      return { error: 'this census script is strictly read-only and does not support --apply' };
    }
    // Do not echo arbitrary arguments: a pasted token or database URL must never land in terminal logs.
    return { error: `unknown argument (${arg.length} characters); this script is read-only` };
  }

  return { json, pageSize };
}

function assertSafeIdentifier(ident: string, context: string): string {
  if (!SAFE_SQL_IDENT.test(ident)) {
    throw new Error(`Unsafe SQL identifier for ${context}`);
  }
  return ident;
}

/**
 * Resolves every model.field entry in `ENCRYPTED_FIELDS` to its PostgreSQL table
 * and column name using Prisma's generated DMMF, keeping `ENCRYPTED_FIELDS` as
 * the single source of truth.
 */
export function resolveEncryptedTargets(
  fieldsMap: Record<string, readonly string[]> = ENCRYPTED_FIELDS as unknown as Record<string, readonly string[]>,
): EncryptedColumnTarget[] {
  const dmmfModels = Prisma.dmmf.datamodel.models;
  const targets: EncryptedColumnTarget[] = [];

  for (const [modelName, fieldNames] of Object.entries(fieldsMap)) {
    const dmmfModel = dmmfModels.find((m) => m.name === modelName);
    if (!dmmfModel) {
      throw new Error(`ENCRYPTED_FIELDS references unknown Prisma model: ${modelName}`);
    }
    const table = assertSafeIdentifier(dmmfModel.dbName ?? dmmfModel.name, `model ${modelName}`);

    for (const fieldName of fieldNames) {
      const dmmfField = dmmfModel.fields.find((f) => f.name === fieldName);
      if (!dmmfField) {
        throw new Error(`ENCRYPTED_FIELDS references unknown field: ${modelName}.${fieldName}`);
      }
      const dbColumn = assertSafeIdentifier(
        dmmfField.dbName ?? dmmfField.name,
        `field ${modelName}.${fieldName}`,
      );
      targets.push({
        model: modelName,
        field: fieldName,
        column: `${modelName}.${fieldName}`,
        table,
        dbColumn,
      });
    }
  }

  return targets;
}

function emptyCounts(): Record<TokenEncryptionKeyLabel, number> {
  return {
    plaintext: 0,
    current: 0,
    fallback: 0,
    'core-chain': 0,
    undecryptable: 0,
  };
}

function emptyNonCurrentIds(): Record<NonCurrentTokenLabel, string[]> {
  return {
    plaintext: [],
    fallback: [],
    'core-chain': [],
    undecryptable: [],
  };
}

/**
 * Runs a strictly read-only census across every column in `ENCRYPTED_FIELDS`
 * inside a PostgreSQL `READ ONLY` transaction, scanning in keyset-paginated batches.
 * Returns counts per column and row IDs for non-`current` labels only.
 */
export async function runTokenEncryptionKeyCensus(
  prisma: CensusDb,
  opts: TokenEncryptionKeyCensusOptions = {},
): Promise<TokenEncryptionKeyCensusReport> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error('pageSize must be a positive integer');
  }

  const targets = resolveEncryptedTargets(opts.encryptedFields);
  const keySource = tokenEncryptionKeySource();
  const coreChainVarSet = Boolean(process.env.DRIVE_TOKEN_ENCRYPTION_SECRET);
  const totals = emptyCounts();

  const columns = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');

      const results: ColumnCensusResult[] = [];
      for (const target of targets) {
        const counts = emptyCounts();
        const nonCurrentIds = emptyNonCurrentIds();
        let scanned = 0;
        let lastId: string | null = null;

        for (;;) {
          const rows = (
            lastId === null
              ? await tx.$queryRawUnsafe<Array<{ id: string; val: string | null }>>(
                  `SELECT id, "${target.dbColumn}" AS val FROM "${target.table}" WHERE "${target.dbColumn}" IS NOT NULL AND "${target.dbColumn}" <> '' ORDER BY id ASC LIMIT $1`,
                  pageSize,
                )
              : await tx.$queryRawUnsafe<Array<{ id: string; val: string | null }>>(
                  `SELECT id, "${target.dbColumn}" AS val FROM "${target.table}" WHERE "${target.dbColumn}" IS NOT NULL AND "${target.dbColumn}" <> '' AND id > $1 ORDER BY id ASC LIMIT $2`,
                  lastId,
                  pageSize,
                )
          );

          for (const row of rows) {
            if (typeof row.val !== 'string' || row.val.length === 0) continue;
            scanned += 1;
            const label = classifyStoredToken(row.val);
            counts[label] += 1;
            totals[label] += 1;
            if (label !== 'current') {
              nonCurrentIds[label].push(row.id);
            }
          }

          if (rows.length < pageSize) break;
          lastId = rows[rows.length - 1].id;
        }

        results.push({
          model: target.model,
          field: target.field,
          column: target.column,
          table: target.table,
          dbColumn: target.dbColumn,
          scanned,
          counts,
          nonCurrentIds,
        });
      }

      return results;
    },
    {
      maxWait: TRANSACTION_MAX_WAIT_MS,
      timeout: TRANSACTION_TIMEOUT_MS,
    },
  );

  return {
    keySource,
    coreChainVarSet,
    pageSize,
    columns,
    totals,
  };
}

/**
 * Formats a census report for operator review. Contains only counts, column names,
 * and non-`current` row IDs — never token values, ciphertexts, or key material.
 */
export function formatCensusReport(report: TokenEncryptionKeyCensusReport): string {
  const lines: string[] = [
    'Token encryption key census (RR-DB-CRYPTO-KEY-CENSUS, V1-72) - READ ONLY: nothing is written',
    `  key_source             ${report.keySource ?? 'none set (dev fallback key)'}`,
    `  core_chain_var_set     ${report.coreChainVarSet ? 'yes (DRIVE_TOKEN_ENCRYPTION_SECRET)' : 'no'}`,
    `  columns_scanned        ${report.columns.length}`,
    `  page_size              ${report.pageSize}`,
    '',
    'Counts per column:',
  ];

  for (const col of report.columns) {
    const summary = LABELS.map((l) => `${l}=${col.counts[l]}`).join(' ');
    lines.push(`  ${col.column.padEnd(36)} scanned=${col.scanned} ${summary}`);
  }

  lines.push('');
  lines.push('Totals:');
  for (const label of LABELS) {
    lines.push(`  ${label.padEnd(22)} ${report.totals[label]}`);
  }

  const nonCurrentLabels: readonly NonCurrentTokenLabel[] = [
    'plaintext',
    'fallback',
    'core-chain',
    'undecryptable',
  ];
  const nonCurrentLines: string[] = [];
  for (const col of report.columns) {
    for (const label of nonCurrentLabels) {
      for (const id of col.nonCurrentIds[label]) {
        nonCurrentLines.push(`  ${col.column}  ${label}  ${id}`);
      }
    }
  }

  lines.push('');
  if (nonCurrentLines.length === 0) {
    lines.push('Non-current rows: none');
  } else {
    lines.push(`Non-current rows (${nonCurrentLines.length}):`);
    lines.push(...nonCurrentLines);
  }

  return lines.join('\n');
}

function describeFailure(err: unknown): string {
  const e = err as { code?: unknown; name?: unknown };
  if (typeof e?.code === 'string') return `database error ${e.code}`;
  return typeof e?.name === 'string' ? e.name : 'unknown error';
}

export async function main(
  argv: string[],
  deps: { db?: CensusDb; log?: Log; error?: Log } = {},
): Promise<number> {
  const log: Log = deps.log ?? console.log;
  const error: Log = deps.error ?? console.error;
  const parsed = parseArgs(argv);
  if ('error' in parsed) {
    error(
      `Bad arguments (${parsed.error}). Usage: token-encryption-key-census [--json] [--page-size=<N>]`,
    );
    return 2;
  }

  const database: CensusDb = deps.db ?? (db as unknown as CensusDb);
  try {
    const report = await runTokenEncryptionKeyCensus(database, { pageSize: parsed.pageSize });
    log(parsed.json ? JSON.stringify(report, null, 2) : formatCensusReport(report));
    return 0;
  } catch (err: unknown) {
    error(`Token encryption key census failed: ${describeFailure(err)}. Nothing was written.`);
    return 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error(`Token encryption key census failed: ${describeFailure(err)}`);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
