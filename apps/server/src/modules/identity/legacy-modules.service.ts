import { Inject, Injectable } from '@nestjs/common';
import {
  V1_HIDDEN_MODULES,
  V1_HIDDEN_MODULE_KEYS,
  type V1HiddenModule,
  type V1HiddenModuleKey,
} from '@keyflow/shared';
import { PrismaService } from '../../core/prisma/prisma.service';

const PLAIN_SQL_IDENT = /^[a-z_][a-z0-9_]*$/;
const UNSAFE_SQL_FILTER =
  /;|--|\/\*|\*\/|\$|\b(SELECT|UNION|INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|COPY|EXECUTE|CALL|DO)\b/i;

const READ_ONLY_PREAMBLE = [
  'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY',
  "SET LOCAL statement_timeout = '10s'",
  "SET LOCAL lock_timeout = '2s'",
] as const;

const KNOWN_MODULE_KEYS: ReadonlySet<string> = new Set(V1_HIDDEN_MODULE_KEYS);

function validatePlainIdent(name: string, context: string): string {
  if (!PLAIN_SQL_IDENT.test(name)) {
    throw new Error(`Invalid SQL identifier in V1_HIDDEN_MODULES (${context}): ${JSON.stringify(name)}`);
  }
  return name;
}

function quoteIdent(name: string, context: string): string {
  return `"${validatePlainIdent(name, context)}"`;
}

/**
 * Builds the boolean `EXISTS (...) OR ...` expression for one hidden v1 module
 * over the exact `tables` list shared with `v1-module-usage-count.ts`
 * (`packages/shared/src/v1-modules.ts`).
 *
 * Returns `null` when the module has no tables of its own (dashboards/hubs
 * derived from other modules). Every table/column identifier is validated
 * against `/^[a-z_][a-z0-9_]*$/`, every `where` filter is validated against
 * `UNSAFE_SQL_FILTER`, and `businessId` is bound strictly as parameter `$1`.
 */
export function buildLegacyModuleExistsExpr(module: V1HiddenModule): string | null {
  if (module.tables.length === 0) return null;

  const branches = module.tables.map((entry) => {
    const ctx = `${module.key}.${entry.name}`;
    const table = quoteIdent(entry.table, `${ctx}.table`);
    const bizCol = quoteIdent(entry.businessColumn, `${ctx}.businessColumn`);

    for (const col of entry.whereColumns ?? []) {
      validatePlainIdent(col, `${ctx}.whereColumns`);
    }

    const predicates: string[] = [`t.${bizCol} = $1`];

    if (entry.table === 'businesses') {
      predicates.push('t."deleted_at" IS NULL');
    }

    if (entry.softDeleteColumn) {
      predicates.push(`t.${quoteIdent(entry.softDeleteColumn, `${ctx}.softDeleteColumn`)} IS NULL`);
    }

    if (entry.where) {
      if (UNSAFE_SQL_FILTER.test(entry.where)) {
        throw new Error(`Unsafe SQL filter in V1_HIDDEN_MODULES (${ctx})`);
      }
      predicates.push(`(${entry.where})`);
    }

    return `EXISTS (SELECT 1 FROM ${table} t WHERE ${predicates.join(' AND ')})`;
  });

  return `(${branches.join(' OR ')})`;
}

/**
 * Compiles all measured hidden modules in `V1_HIDDEN_MODULES` into ONE single
 * parameterized read-only `SELECT` statement, gated by a `live_biz` CTE so
 * nonexistent or soft-deleted businesses short-circuit all `EXISTS` probes
 * immediately.
 */
export function buildLegacyModulesQuery(
  modules: readonly V1HiddenModule[] = V1_HIDDEN_MODULES,
): string | null {
  const valueRows: string[] = [];

  for (const module of modules) {
    const expr = buildLegacyModuleExistsExpr(module);
    if (!expr) continue;
    const key = validatePlainIdent(module.key, `${module.key}.key`);
    valueRows.push(`('${key}', ${expr})`);
  }

  if (valueRows.length === 0) return null;

  return (
    'WITH live_biz AS (\n' +
    '  SELECT 1 FROM "businesses" b WHERE b."id" = $1 AND b."deleted_at" IS NULL\n' +
    ')\n' +
    'SELECT v.key\n' +
    'FROM live_biz,\n' +
    `LATERAL (VALUES\n  ${valueRows.join(',\n  ')}\n) AS v(key, present)\n` +
    'WHERE v.present = true'
  );
}

const COMPILED_LEGACY_MODULES_QUERY = buildLegacyModulesQuery(V1_HIDDEN_MODULES);

/**
 * Per-business live read of which hidden v1 modules already have live data for
 * a business (NAV-B-LEGACY-SERVER, V1-67).
 *
 * Runs ONE strictly read-only (`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ,
 * READ ONLY`) parameterized `SELECT` over `V1_HIDDEN_MODULES` and returns ONLY
 * sorted unique module key strings — never counts, names, amounts, or credentials.
 */
@Injectable()
export class LegacyModulesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getLegacyModules(businessId: string): Promise<V1HiddenModuleKey[]> {
    if (typeof businessId !== 'string' || businessId.trim().length === 0) {
      return [];
    }
    if (!COMPILED_LEGACY_MODULES_QUERY) {
      return [];
    }

    const query = COMPILED_LEGACY_MODULES_QUERY;
    const rows = await this.prisma.client.$transaction(
      async (tx) => {
        for (const stmt of READ_ONLY_PREAMBLE) {
          await tx.$executeRawUnsafe(stmt);
        }

        const [txState] = await tx.$queryRawUnsafe<Array<{ read_only: string }>>(
          "SELECT current_setting('transaction_read_only') AS read_only",
        );
        if (txState?.read_only !== 'on') {
          throw new Error('Legacy modules transaction is not read only');
        }

        return tx.$queryRawUnsafe<Array<{ key: string }>>(query, businessId);
      },
      { maxWait: 10_000, timeout: 15_000 },
    );

    const keys: V1HiddenModuleKey[] = [];
    for (const row of rows) {
      if (typeof row?.key === 'string' && KNOWN_MODULE_KEYS.has(row.key)) {
        keys.push(row.key as V1HiddenModuleKey);
      }
    }

    return [...new Set(keys)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }
}
