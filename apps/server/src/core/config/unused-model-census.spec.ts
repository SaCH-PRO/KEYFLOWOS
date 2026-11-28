/**
 * RR-UNUSED-MODEL-CENSUS (D-261, D-262, D-257)
 *
 * Shrink-only census of Prisma models declared in `packages/db/prisma/schema.prisma`
 * (read-only; this packet never edits `schema.prisma`) that no production code in
 * `apps/`, `packages/`, or `scripts/` reads or writes.
 *
 * Snapshot header (updated only when models shrink from this list):
 *   - Date:  2026-11-27
 *   - Count: 19
 *   - Total schema models at snapshot: 442
 *
 * What counts as "used" (to eliminate false positives):
 *   1. Direct Prisma delegate access on a verified Prisma client/tx/db receiver
 *      (`prisma`, `prisma.client`, `this.prisma.client`, `tx`, `db`, etc. — NOT
 *      arbitrary `ctx`, `client`, or `*Client` objects) or chained Prisma
 *      delegate operation (`findUnique`, `findUniqueOrThrow`, `findFirst`,
 *      `findFirstOrThrow`, `findMany`, `create`, `createMany`,
 *      `createManyAndReturn`, `update`, `updateMany`, `updateManyAndReturn`,
 *      `upsert`, `delete`, `deleteMany`, `count`, `aggregate`, `groupBy`,
 *      `fields`), including aliased/destructured Prisma clients and bracket access.
 *   2. Schema-guided nested relation access (`include`, `select`, `data`, `create`,
 *      `createMany`, `update`, `updateMany`, `deleteMany`, `upsert`,
 *      `connectOrCreate`, `where` relation filters `some`/`every`/`none`/`is`/
 *      `isNot`, `_count`, `orderBy`, including array forms) reachable from a used
 *      parent model (e.g. `DocumentType` -> `DocumentTemplate` ->
 *      `DocumentClause` -> `ClauseVariant`).
 *   3. Raw SQL queries (`$queryRaw`, `$queryRawUnsafe`, `$executeRaw`,
 *      `$executeRawUnsafe`, `Prisma.sql`, `Prisma.raw`, and DB/pg `pool.query`
 *      with a SQL string first argument — never tRPC `.query(...)` callbacks,
 *      `String.raw`, or bind-parameter arrays) referencing the model's `@@map`
 *      table name in a SQL clause (`FROM [ONLY]`, `JOIN`, `INTO`, `UPDATE [ONLY]`,
 *      `DELETE FROM [ONLY]`, `TRUNCATE [TABLE] [ONLY]`, `ALTER TABLE`,
 *      `LOCK TABLE`, `MERGE INTO`), excluding CTE aliases.
 *
 * Non-SQL strings (such as GitHub Actions `/workflow_runs` URLs), test/fixture
 * directories, and comments do NOT count as usage. Memory-store models (D-257)
 * are only listed when unused, never acted on here.
 *
 * Ratchet rules:
 *   - A new Prisma model with no reader or writer FAILS CI.
 *   - A listed model that gains a reader or writer FAILS CI ("list outlived the
 *     problem") until removed from `COMMITTED_UNUSED_MODELS`.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

export interface UnusedModelEntry {
  readonly model: string;
  readonly table: string;
  readonly recordedAt: string;
  readonly disposition: string;
}

export const COMMITTED_UNUSED_MODELS_DATE = '2026-11-27';
export const COMMITTED_UNUSED_MODELS_COUNT = 19;
export const COMMITTED_UNUSED_MODELS: readonly UnusedModelEntry[] = [
  {
    model: 'AiApprovalRequest',
    table: 'ai_approval_requests',
    recordedAt: '2026-11-27',
    disposition: 'dormant — candidate for future retirement (see RR-APPROVAL-MODEL-CENSUS)',
  },
  {
    model: 'AssessmentResult',
    table: 'assessment_results',
    recordedAt: '2026-11-27',
    disposition: 'unreviewed',
  },
  {
    model: 'AutomationOutcome',
    table: 'automation_outcomes',
    recordedAt: '2026-11-27',
    disposition: 'unreviewed',
  },
  {
    model: 'BotAgent',
    table: 'bot_agents',
    recordedAt: '2026-11-27',
    disposition: 'unreviewed',
  },
  {
    model: 'BotConversationState',
    table: 'bot_conversation_states',
    recordedAt: '2026-11-27',
    disposition: 'unreviewed',
  },
  {
    model: 'BusinessEntityLink',
    table: 'business_entity_links',
    recordedAt: '2026-11-27',
    disposition: 'unreviewed',
  },
  {
    model: 'BusinessInitiative',
    table: 'business_initiatives',
    recordedAt: '2026-11-27',
    disposition: 'unreviewed',
  },
  {
    model: 'ExternalObjectMap',
    table: 'external_object_maps',
    recordedAt: '2026-11-27',
    disposition: 'unreviewed',
  },
  {
    model: 'FlowRoleSubscription',
    table: 'flow_role_subscriptions',
    recordedAt: '2026-11-27',
    disposition: 'unreviewed',
  },
  {
    model: 'GuidanceAssessment',
    table: 'guidance_assessments',
    recordedAt: '2026-11-27',
    disposition: 'unreviewed',
  },
  {
    model: 'GuidanceRecommendation',
    table: 'guidance_recommendations',
    recordedAt: '2026-11-27',
    disposition: 'unreviewed',
  },
  {
    model: 'NetworkEdge',
    table: 'network_edges',
    recordedAt: '2026-11-27',
    disposition: 'unreviewed',
  },
  {
    model: 'NetworkNode',
    table: 'network_nodes',
    recordedAt: '2026-11-27',
    disposition: 'unreviewed',
  },
  {
    model: 'ProductExperiment',
    table: 'product_experiments',
    recordedAt: '2026-11-27',
    disposition: 'unreviewed',
  },
  {
    model: 'ProgressSnapshot',
    table: 'progress_snapshots',
    recordedAt: '2026-11-27',
    disposition: 'unreviewed',
  },
  {
    model: 'PromptVersion',
    table: 'prompt_versions',
    recordedAt: '2026-11-27',
    disposition: 'unreviewed',
  },
  {
    model: 'RoadmapItem',
    table: 'roadmap_items',
    recordedAt: '2026-11-27',
    disposition: 'unreviewed',
  },
  {
    model: 'WorkflowRun',
    table: 'workflow_runs',
    recordedAt: '2026-11-27',
    disposition: 'unreviewed',
  },
  {
    model: 'WorkflowTemplate',
    table: 'workflow_templates',
    recordedAt: '2026-11-27',
    disposition: 'unreviewed',
  },
];

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'packages/db/prisma/schema.prisma');
const SCAN_ROOTS = ['apps', 'packages', 'scripts'] as const;

const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'generated',
  'migrations',
  '__pycache__',
  'test',
  'tests',
  '__tests__',
  '__mocks__',
  'fixtures',
]);

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const TEST_OR_DECL_RE = /\.(?:spec|test|e2e-spec)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$/;

const PRISMA_DELEGATE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
  'fields',
]);

const PRISMA_CLIENT_IDENT_RE = /^(?:_?prisma(?:Client|Service|Tx)?|_?tx|db(?:Tx)?)$/i;
const PG_QUERY_RECEIVER_RE = /^(?:pool|pg|pgClient|pgPool|db|conn|connection|sqlClient|database)$/i;

const PRISMA_DOLLAR_SQL_METHODS = new Set([
  '$queryRaw',
  '$queryRawUnsafe',
  '$executeRaw',
  '$executeRawUnsafe',
]);

const SQL_CLAUSE_TABLE_RE =
  /\b(?:FROM(?:\s+ONLY)?|JOIN|INTO|UPDATE(?:\s+ONLY)?|DELETE\s+FROM(?:\s+ONLY)?|TRUNCATE(?:\s+TABLE)?(?:\s+ONLY)?|ALTER\s+TABLE|LOCK\s+TABLE|MERGE\s+INTO)\s+(?:["`]?[a-z_][a-z0-9_]*["`]?\.)?["`]?([a-z_][a-z0-9_]*)["`]?/gi;

const CTE_ALIAS_RE = /(?:^|\bWITH(?:\s+RECURSIVE)?|,)\s*["`]?([a-z_][a-z0-9_]*)["`]?\s*(?:\([^)]*\)\s*)?AS\s*\(/gi;

export interface ParsedPrismaModel {
  readonly name: string;
  readonly delegate: string;
  readonly table: string;
  readonly relations: ReadonlyMap<string, string>;
}

function stripSchemaComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
}

export function parsePrismaSchemaModels(schemaSource: string): Map<string, ParsedPrismaModel> {
  const rawBodies = new Map<string, { table: string; body: string }>();
  const modelRe = /^([ \t]*)model\s+(\w+)\s*\{([\s\S]*?)^\1\}/gm;
  for (const match of schemaSource.matchAll(modelRe)) {
    const name = match[2];
    const body = match[3];
    const commentFreeBody = stripSchemaComments(body);
    const mapMatch = commentFreeBody.match(/@@map\s*\(\s*(?:name\s*:\s*)?"([^"]+)"\s*\)/);
    rawBodies.set(name, { table: mapMatch ? mapMatch[1] : name, body: commentFreeBody });
  }

  const models = new Map<string, ParsedPrismaModel>();
  for (const [name, { table, body }] of rawBodies.entries()) {
    const relations = new Map<string, string>();
    for (const rawLine of body.split('\n')) {
      const cleaned = rawLine.trim();
      if (!cleaned || cleaned.startsWith('@@')) continue;
      const parts = cleaned.split(/\s+/);
      if (parts.length < 2) continue;
      const fieldName = parts[0];
      const fieldType = parts[1].replace(/[[\]?]/g, '');
      if (rawBodies.has(fieldType)) {
        relations.set(fieldName, fieldType);
      }
    }
    models.set(name, {
      name,
      delegate: name[0].toLowerCase() + name.slice(1),
      table,
      relations,
    });
  }
  return models;
}

function scriptKindForPath(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(filePath)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function unwrapExpr(expr: ts.Expression): ts.Expression {
  let cur = expr;
  while (
    ts.isParenthesizedExpression(cur) ||
    ts.isAsExpression(cur) ||
    ts.isNonNullExpression(cur) ||
    ts.isSatisfiesExpression(cur) ||
    ts.isTypeAssertionExpression(cur)
  ) {
    cur = cur.expression;
  }
  return cur;
}

function staticString(expr: ts.Expression): string | null {
  const u = unwrapExpr(expr);
  if (ts.isStringLiteral(u) || ts.isNoSubstitutionTemplateLiteral(u)) return u.text;
  if (ts.isBinaryExpression(u) && u.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(u.left);
    const right = staticString(u.right);
    if (left !== null && right !== null) return left + right;
  }
  return null;
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return staticString(name.expression);
  return null;
}

function memberAccessProp(expr: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | null {
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return expr.argumentExpression ? staticString(expr.argumentExpression) : null;
}

function isPrismaClientLike(expr: ts.Expression, clientAliases: ReadonlySet<string>): boolean {
  const u = unwrapExpr(expr);
  if (ts.isIdentifier(u)) {
    return clientAliases.has(u.text) || PRISMA_CLIENT_IDENT_RE.test(u.text);
  }
  if (ts.isPropertyAccessExpression(u)) {
    if (u.name.text === 'client') {
      return isPrismaClientLike(u.expression, clientAliases);
    }
    return PRISMA_CLIENT_IDENT_RE.test(u.name.text);
  }
  return false;
}

function isPrismaNamespaceOrClient(expr: ts.Expression, clientAliases: ReadonlySet<string>): boolean {
  const u = unwrapExpr(expr);
  if (ts.isIdentifier(u) && u.text === 'Prisma') return true;
  if (ts.isPropertyAccessExpression(u) && u.name.text === 'Prisma') return true;
  return isPrismaClientLike(u, clientAliases);
}

function isPgQueryReceiver(expr: ts.Expression, clientAliases: ReadonlySet<string>): boolean {
  if (isPrismaClientLike(expr, clientAliases)) return true;
  const u = unwrapExpr(expr);
  if (ts.isIdentifier(u)) return PG_QUERY_RECEIVER_RE.test(u.text);
  if (ts.isPropertyAccessExpression(u)) return PG_QUERY_RECEIVER_RE.test(u.name.text);
  return false;
}

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/**
 * Extracts SQL text chunks ONLY from string/template/concatenation expressions
 * (never descending into function bodies, callbacks, or bind-parameter objects).
 */
function extractSqlExprChunks(expr: ts.Expression, out: string[]): void {
  const u = unwrapExpr(expr);
  if (ts.isFunctionLike(u)) return;
  if (ts.isStringLiteral(u) || ts.isNoSubstitutionTemplateLiteral(u)) {
    out.push(u.text);
    return;
  }
  if (ts.isTemplateExpression(u)) {
    out.push(u.head.text);
    for (const span of u.templateSpans) {
      extractSqlExprChunks(span.expression, out);
      out.push(span.literal.text);
    }
    return;
  }
  if (ts.isBinaryExpression(u) && u.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    extractSqlExprChunks(u.left, out);
    extractSqlExprChunks(u.right, out);
    return;
  }
  if (ts.isConditionalExpression(u)) {
    extractSqlExprChunks(u.whenTrue, out);
    extractSqlExprChunks(u.whenFalse, out);
  }
}

function extractTaggedTemplateChunks(template: ts.TemplateLiteral, out: string[]): void {
  if (ts.isNoSubstitutionTemplateLiteral(template)) {
    out.push(template.text);
    return;
  }
  out.push(template.head.text);
  for (const span of template.templateSpans) {
    // Only preserve static string fragments; interpolated expressions are bind params.
    out.push(span.literal.text);
  }
}

export interface ModelUsageScanResult {
  readonly totalModels: number;
  readonly usedViaDirect: ReadonlySet<string>;
  readonly usedViaRelation: ReadonlySet<string>;
  readonly usedViaSql: ReadonlySet<string>;
  readonly unusedModels: readonly string[];
}

export function scanModelUsage(
  models: ReadonlyMap<string, ParsedPrismaModel>,
  filesByRelPath: ReadonlyMap<string, string>,
): ModelUsageScanResult {
  const delegateToModel = new Map<string, string>();
  const tableToModel = new Map<string, string>();
  for (const info of models.values()) {
    delegateToModel.set(info.delegate, info.name);
    tableToModel.set(info.table.toLowerCase(), info.name);
  }

  const usedViaDirect = new Set<string>();
  const usedViaRelation = new Set<string>();
  const usedViaSql = new Set<string>();

  const walkNestedValue = (val: ts.Expression, targetModel: string) => {
    const u = unwrapExpr(val);
    if (ts.isObjectLiteralExpression(u)) {
      walkRelationFields(u, targetModel);
      walkPrismaQueryObject(u, targetModel);
    } else if (ts.isArrayLiteralExpression(u)) {
      for (const el of u.elements) {
        const ue = unwrapExpr(el);
        if (ts.isObjectLiteralExpression(ue)) {
          walkRelationFields(ue, targetModel);
          walkPrismaQueryObject(ue, targetModel);
        }
      }
    }
  };

  const walkPrismaQueryObject = (obj: ts.ObjectLiteralExpression, modelName: string) => {
    const info = models.get(modelName);
    if (!info) return;
    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const key = propertyNameText(prop.name);
      if (!key) continue;
      const val = unwrapExpr(prop.initializer);
      if (
        key === 'include' ||
        key === 'select' ||
        key === 'data' ||
        key === 'create' ||
        key === 'createMany' ||
        key === 'update' ||
        key === 'updateMany' ||
        key === 'deleteMany' ||
        key === 'upsert' ||
        key === 'connectOrCreate' ||
        key === 'where' ||
        key === 'orderBy' ||
        key === '_count'
      ) {
        walkNestedValue(val, modelName);
      }
    }
  };

  const walkRelationFields = (obj: ts.ObjectLiteralExpression, modelName: string) => {
    const info = models.get(modelName);
    if (!info) return;
    for (const prop of obj.properties) {
      if (ts.isShorthandPropertyAssignment(prop)) {
        const target = info.relations.get(prop.name.text);
        if (target) usedViaRelation.add(target);
        continue;
      }
      if (!ts.isPropertyAssignment(prop)) continue;
      const key = propertyNameText(prop.name);
      if (!key) continue;
      const val = unwrapExpr(prop.initializer);

      if (
        key === 'select' ||
        key === 'include' ||
        key === '_count' ||
        key === 'AND' ||
        key === 'OR' ||
        key === 'NOT' ||
        key === 'data' ||
        key === 'where'
      ) {
        walkNestedValue(val, modelName);
        continue;
      }

      const target = info.relations.get(key);
      if (!target) continue;
      if (
        val.kind === ts.SyntaxKind.FalseKeyword ||
        (ts.isIdentifier(val) && val.text === 'undefined')
      ) {
        continue;
      }
      usedViaRelation.add(target);
      if (ts.isObjectLiteralExpression(val)) {
        walkPrismaQueryObject(val, target);
        for (const sub of val.properties) {
          if (!ts.isPropertyAssignment(sub)) continue;
          const sk = propertyNameText(sub.name);
          if (!sk) continue;
          const sv = unwrapExpr(sub.initializer);
          if (
            sk === 'some' ||
            sk === 'every' ||
            sk === 'none' ||
            sk === 'is' ||
            sk === 'isNot' ||
            sk === 'create' ||
            sk === 'createMany' ||
            sk === 'update' ||
            sk === 'updateMany' ||
            sk === 'deleteMany' ||
            sk === 'upsert' ||
            sk === 'connectOrCreate'
          ) {
            walkNestedValue(sv, target);
          }
        }
      }
    }
  };

  const scanSqlChunks = (chunks: readonly string[]) => {
    const cleaned = stripSqlComments(chunks.join(' '));
    const cteAliases = new Set<string>();
    CTE_ALIAS_RE.lastIndex = 0;
    for (const cteMatch of cleaned.matchAll(CTE_ALIAS_RE)) {
      cteAliases.add(cteMatch[1].toLowerCase());
    }

    SQL_CLAUSE_TABLE_RE.lastIndex = 0;
    for (const match of cleaned.matchAll(SQL_CLAUSE_TABLE_RE)) {
      const tableName = match[1].toLowerCase();
      if (cteAliases.has(tableName)) continue;
      const mName = tableToModel.get(tableName);
      if (mName) usedViaSql.add(mName);
    }
  };

  for (const [relPath, src] of filesByRelPath.entries()) {
    const sf = ts.createSourceFile(
      relPath,
      src,
      ts.ScriptTarget.Latest,
      false,
      scriptKindForPath(relPath),
    );
    const clientAliases = new Set<string>();
    const delegateAliases = new Map<string, string>();

    const collectAliases = (node: ts.Node) => {
      if (ts.isJSDoc(node)) return;
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const init = unwrapExpr(node.initializer);
        if (ts.isIdentifier(node.name)) {
          if (isPrismaClientLike(init, clientAliases)) {
            clientAliases.add(node.name.text);
          } else if (
            (ts.isPropertyAccessExpression(init) || ts.isElementAccessExpression(init)) &&
            isPrismaClientLike(init.expression, clientAliases)
          ) {
            const prop = memberAccessProp(init);
            if (prop && delegateToModel.has(prop)) {
              const mName = delegateToModel.get(prop)!;
              delegateAliases.set(node.name.text, mName);
              usedViaDirect.add(mName);
            }
          }
        } else if (ts.isObjectBindingPattern(node.name) && isPrismaClientLike(init, clientAliases)) {
          for (const el of node.name.elements) {
            if (!ts.isIdentifier(el.name)) continue;
            const prop = el.propertyName ? propertyNameText(el.propertyName) : el.name.text;
            if (prop && delegateToModel.has(prop)) {
              const mName = delegateToModel.get(prop)!;
              delegateAliases.set(el.name.text, mName);
              usedViaDirect.add(mName);
            }
          }
        }
      }
      ts.forEachChild(node, collectAliases);
    };
    collectAliases(sf);

    const visit = (node: ts.Node) => {
      if (ts.isJSDoc(node)) return;

      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const prop = memberAccessProp(node);
        if (prop && delegateToModel.has(prop) && isPrismaClientLike(node.expression, clientAliases)) {
          usedViaDirect.add(delegateToModel.get(prop)!);
        }
      }

      if (ts.isCallExpression(node)) {
        const callee = unwrapExpr(node.expression);
        if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
          const op = memberAccessProp(callee);
          if (op && PRISMA_DELEGATE_OPS.has(op)) {
            const recv = unwrapExpr(callee.expression);
            let mName: string | null = null;
            if (ts.isIdentifier(recv) && delegateAliases.has(recv.text)) {
              mName = delegateAliases.get(recv.text)!;
            } else if (
              (ts.isPropertyAccessExpression(recv) || ts.isElementAccessExpression(recv)) &&
              isPrismaClientLike(recv.expression, clientAliases)
            ) {
              const prop = memberAccessProp(recv);
              if (prop && delegateToModel.has(prop)) {
                mName = delegateToModel.get(prop)!;
              }
            }
            if (mName) {
              usedViaDirect.add(mName);
              if (node.arguments.length > 0) {
                const arg0 = unwrapExpr(node.arguments[0]);
                if (ts.isObjectLiteralExpression(arg0)) {
                  walkPrismaQueryObject(arg0, mName);
                }
              }
            }
          }

          // Raw SQL call-form:
          // - Prisma $queryRaw/$queryRawUnsafe/$executeRaw/$executeRawUnsafe
          // - Prisma.raw / Prisma.sql (only on Prisma namespace or Prisma client)
          // - pg/db pool.query(sqlString, ...) (only on DB/pg receivers with SQL string arg0)
          if (
            op &&
            node.arguments.length >= 1 &&
            (PRISMA_DOLLAR_SQL_METHODS.has(op) ||
              ((op === 'raw' || op === 'sql') &&
                isPrismaNamespaceOrClient(callee.expression, clientAliases)) ||
              (op === 'query' && isPgQueryReceiver(callee.expression, clientAliases)))
          ) {
            const chunks: string[] = [];
            extractSqlExprChunks(node.arguments[0], chunks);
            if (chunks.length > 0) scanSqlChunks(chunks);
          }
        }
      }

      if (ts.isTaggedTemplateExpression(node)) {
        const tag = unwrapExpr(node.tag);
        if (ts.isPropertyAccessExpression(tag) || ts.isElementAccessExpression(tag)) {
          const op = memberAccessProp(tag);
          if (
            op &&
            (PRISMA_DOLLAR_SQL_METHODS.has(op) ||
              ((op === 'sql' || op === 'raw') &&
                isPrismaNamespaceOrClient(tag.expression, clientAliases)))
          ) {
            const chunks: string[] = [];
            extractTaggedTemplateChunks(node.template, chunks);
            if (chunks.length > 0) scanSqlChunks(chunks);
          }
        }
      }

      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  const used = new Set<string>([...usedViaDirect, ...usedViaRelation, ...usedViaSql]);
  const unusedModels = [...models.keys()].filter((m) => !used.has(m)).sort();

  return {
    totalModels: models.size,
    usedViaDirect,
    usedViaRelation,
    usedViaSql,
    unusedModels,
  };
}

function walkRepoSources(): Map<string, string> {
  const result = new Map<string, string>();
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        entry.isFile() &&
        SOURCE_EXTS.has(path.extname(entry.name)) &&
        !TEST_OR_DECL_RE.test(entry.name)
      ) {
        const rel = path.relative(REPO_ROOT, full).replace(/\\/g, '/');
        result.set(rel, fs.readFileSync(full, 'utf8'));
      }
    }
  };
  for (const root of SCAN_ROOTS) {
    walk(path.join(REPO_ROOT, root));
  }
  return result;
}

export function diffUnusedModels(
  computedUnused: readonly string[],
  committedList: readonly UnusedModelEntry[],
): {
  newUnused: string[];
  nowUsed: string[];
  duplicates: string[];
} {
  const computedSet = new Set(computedUnused);
  const committedSet = new Set<string>();
  const duplicates: string[] = [];
  for (const entry of committedList) {
    if (committedSet.has(entry.model)) duplicates.push(entry.model);
    committedSet.add(entry.model);
  }

  const newUnused = [...computedSet].filter((m) => !committedSet.has(m)).sort();
  const nowUsed = [...committedSet].filter((m) => !computedSet.has(m)).sort();
  return { newUnused, nowUsed, duplicates: duplicates.sort() };
}

describe('RR-UNUSED-MODEL-CENSUS — shrink-only unused Prisma model ratchet', () => {
  it('matches today’s computed unused Prisma model set with zero new unused models and zero stale entries', () => {
    const schemaSrc = fs.readFileSync(SCHEMA_PATH, 'utf8');
    const models = parsePrismaSchemaModels(schemaSrc);
    expect(models.size).toBeGreaterThanOrEqual(400);

    const sources = walkRepoSources();
    const scan = scanModelUsage(models, sources);

    // Header count & date integrity
    expect(COMMITTED_UNUSED_MODELS_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(COMMITTED_UNUSED_MODELS_COUNT).toBe(COMMITTED_UNUSED_MODELS.length);

    for (const entry of COMMITTED_UNUSED_MODELS) {
      expect(entry.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.disposition.trim().length).toBeGreaterThan(0);
      const parsed = models.get(entry.model);
      expect(parsed, `Listed model ${entry.model} no longer exists in schema.prisma`).toBeDefined();
      expect(parsed!.table).toBe(entry.table);
    }

    const diff = diffUnusedModels(scan.unusedModels, COMMITTED_UNUSED_MODELS);
    expect(diff.duplicates, 'Duplicate entries in COMMITTED_UNUSED_MODELS').toEqual([]);
    expect(
      diff.newUnused,
      'New unused Prisma model(s) detected with no reader or writer across apps/, packages/, scripts/',
    ).toEqual([]);
    expect(
      diff.nowUsed,
      'Listed unused Prisma model(s) gained a reader or writer — remove them from COMMITTED_UNUSED_MODELS (list outlived the problem)',
    ).toEqual([]);

    // Sanity check: relation-only models & raw-SQL-only models are recognized as USED (no false positives)
    expect(scan.usedViaRelation.has('DocumentTemplate')).toBe(true);
    expect(scan.usedViaRelation.has('DocumentClause')).toBe(true);
    expect(scan.usedViaRelation.has('ClauseVariant')).toBe(true);
    expect(scan.usedViaSql.has('Tag')).toBe(true);
  });

  it('NEGATIVE CONTROLS: catches new unused models, list-outlived models, rejects ctx/client/tRPC/String.raw/CTE/bind-param false positives, and handles deep nested relations', () => {
    const scratchSchema = `
      model ParentDoc {
        id String @id
        children ChildClause[]
        @@map("parent_docs")
      }
      model ChildClause {
        id String @id
        parentId String
        parent ParentDoc @relation(fields: [parentId], references: [id])
        grandChildren GrandChildItem[]
        // @@map("commented_old_name")
        @@map(name: "child_clauses")
      }
      model GrandChildItem {
        id String @id
        clauseId String
        clause ChildClause @relation(fields: [clauseId], references: [id])
        @@map("grand_child_items")
      }
      model RawOnlyRow {
        id String @id
        @@map("raw_only_rows")
      }
      model ListedUnused {
        id String @id
        @@map("listed_unused")
      }
      model BrandNewOrphan {
        id String @id
        @@map("brand_new_orphans")
      }
    `;
    const scratchModels = parsePrismaSchemaModels(scratchSchema);
    expect(scratchModels.get('ChildClause')?.table).toBe('child_clauses');

    const committed: UnusedModelEntry[] = [
      {
        model: 'ListedUnused',
        table: 'listed_unused',
        recordedAt: '2026-11-27',
        disposition: 'unreviewed',
      },
    ];

    // Case 1: BrandNewOrphan has NO real Prisma/SQL usage — only non-Prisma lookalikes:
    // ctx.*, httpClient.*, bare client.*, tRPC protectedProcedure.query(...), String.raw,
    // SQL bind-parameter array, CTE alias named brand_new_orphans, and non-SQL URL.
    // Meanwhile ChildClause & GrandChildItem ARE used via deep nested array upsert/update,
    // and RawOnlyRow IS used via FROM ONLY.
    const sourcesNewOrphan = new Map<string, string>([
      [
        'apps/server/src/sample.ts',
        `
          // prisma.client.brandNewOrphan.findMany()
          const githubUrl = 'https://api.github.com/repos/org/repo/brand_new_orphans';
          function nonPrismaNoise(ctx: any, httpClient: any, client: any, protectedProcedure: any, pool: any) {
            const x = ctx.brandNewOrphan;
            const y = httpClient.brandNewOrphan;
            const z = client.brandNewOrphan;
            const rawStr = String.raw\`SELECT * FROM brand_new_orphans\`;
            protectedProcedure.query(async () => {
              const a = 'from';
              return 'brand_new_orphans';
            });
            pool.query('SELECT 1 FROM users WHERE x = $1', ['FROM brand_new_orphans']);
            pool.query('WITH brand_new_orphans AS (SELECT 1) SELECT * FROM brand_new_orphans');
            return [x, y, z, rawStr];
          }
          async function run(prisma: any) {
            await prisma.client.parentDoc.update({
              where: { id: 'p1' },
              data: {
                children: {
                  upsert: [
                    {
                      where: { id: 'c1' },
                      create: { grandChildren: { create: [{ id: 'g1' }] } },
                      update: { data: { grandChildren: { deleteMany: {} } } },
                    },
                  ],
                },
              },
            });
            await prisma.client.$queryRaw\`SELECT id FROM ONLY raw_only_rows\`;
          }
        `,
      ],
    ]);
    const scan1 = scanModelUsage(scratchModels, sourcesNewOrphan);
    expect(scan1.usedViaDirect.has('ParentDoc')).toBe(true);
    expect(scan1.usedViaRelation.has('ChildClause')).toBe(true);
    expect(scan1.usedViaRelation.has('GrandChildItem')).toBe(true);
    expect(scan1.usedViaSql.has('RawOnlyRow')).toBe(true);
    const diff1 = diffUnusedModels(scan1.unusedModels, committed);
    expect(diff1.newUnused).toEqual(['BrandNewOrphan']);
    expect(diff1.nowUsed).toEqual([]);

    // Case 2: ListedUnused gains a fixture accessor -> fails the "list outlived the problem" check
    const sourcesOutlived = new Map<string, string>([
      [
        'apps/server/src/sample.ts',
        `
          async function run(prisma: any) {
            await prisma.client.parentDoc.findMany({ include: { children: { include: { grandChildren: true } } } });
            await prisma.client.$queryRaw\`SELECT id FROM raw_only_rows\`;
            await prisma.client.listedUnused.findMany();
            await prisma.client.brandNewOrphan.count();
          }
        `,
      ],
    ]);
    const scan2 = scanModelUsage(scratchModels, sourcesOutlived);
    const diff2 = diffUnusedModels(scan2.unusedModels, committed);
    expect(diff2.newUnused).toEqual([]);
    expect(diff2.nowUsed).toEqual(['ListedUnused']);
  });
});
