import { Inject, Injectable } from '@nestjs/common';
import { V1_HIDDEN_MODULES, type V1HiddenModule, type V1HiddenModuleKey } from '@keyflow/shared';
import { PrismaService } from '../../core/prisma/prisma.service';

const PLAIN_SQL_IDENT = /^[a-z_][a-z0-9_]*$/;
const UNSAFE_SQL_FILTER = /;|--|\/\*/;

const READ_ONLY_PREAMBLE = [
  'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY',
  "SET LOCAL statement_timeout = '10s'",
  "SET LOCAL lock_timeout = '2s'",
] as const;

function quoteIdent(name: string): string {
  if (!PLAIN_SQL_IDENT.test(name)) {
    throw new Error(`Invalid SQL identifier in V1_HIDDEN_MODULES: ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

/**
 * Builds one read-only `EXISTS` statement for a hidden v1 module over the exact
 * `tables` list shared with `v1-module-usage-count.ts` (`packages/shared/src/v1-modules.ts`).
 *
 * Returns `null` when the module has no tables of its own (dashboards/hubs derived
 * from other modules). Joins `businesses` with `deleted_at IS NULL`, applies any
 * `softDeleteColumn`, and applies any constant `where` filter so the per-business
 * read agrees 100% with the usage-count script (`formatVersion 2`).
 *
 * Every table/column identifier is validated against `/^[a-z_][a-z0-9_]*$/` and
 * `businessId` is bound strictly as parameter `$1`.
 */
export function buildLegacyModuleExistsQuery(module: V1HiddenModule): string | null {
  if (module.tables.length === 0) return null;

  const branches = module.tables.map((entry) => {
    const table = quoteIdent(entry.table);
    const bizCol = quoteIdent(entry.businessColumn);

    for (const col of entry.whereColumns ?? []) {
      quoteIdent(col);
    }

    const predicates: string[] = [
      `t.${bizCol} = $1`,
      'b."deleted_at" IS NULL',
    ];

    if (entry.softDeleteColumn) {
      predicates.push(`t.${quoteIdent(entry.softDeleteColumn)} IS NULL`);
    }

    if (entry.where) {
      if (UNSAFE_SQL_FILTER.test(entry.where)) {
        throw new Error(`Unsafe SQL filter in V1_HIDDEN_MODULES (${module.key}.${entry.name})`);
      }
      predicates.push(`(${entry.where})`);
    }

    return (
      `EXISTS (SELECT 1 FROM ${table} t ` +
      `JOIN "businesses" b ON b."id" = t.${bizCol} ` +
      `WHERE ${predicates.join(' AND ')})`
    );
  });

  return `SELECT (${branches.join(' OR ')}) AS present`;
}

interface CompiledModuleProbe {
  readonly key: V1HiddenModuleKey;
  readonly sql: string;
}

const COMPILED_PROBES: readonly CompiledModuleProbe[] = V1_HIDDEN_MODULES.flatMap((module) => {
  const sql = buildLegacyModuleExistsQuery(module);
  return sql ? [{ key: module.key, sql }] : [];
});

/**
 * Per-business live read of which hidden v1 modules already have live data for
 * a business (NAV-B-LEGACY-SERVER, V1-67).
 *
 * Runs strictly read-only (`SET TRANSACTION ... READ ONLY`) `EXISTS` queries
 * over `V1_HIDDEN_MODULES` and returns ONLY sorted unique module key strings —
 * never counts, names, amounts, or credentials.
 */
@Injectable()
export class LegacyModulesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getLegacyModules(businessId: string): Promise<V1HiddenModuleKey[]> {
    if (typeof businessId !== 'string' || businessId.trim().length === 0) {
      return [];
    }

    const found = await this.prisma.client.$transaction(
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

        const keys: V1HiddenModuleKey[] = [];
        for (const probe of COMPILED_PROBES) {
          const [row] = await tx.$queryRawUnsafe<Array<{ present: boolean }>>(probe.sql, businessId);
          if (row?.present === true) {
            keys.push(probe.key);
          }
        }
        return keys;
      },
      { maxWait: 10_000, timeout: 15_000 },
    );

    return [...new Set(found)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }
}
