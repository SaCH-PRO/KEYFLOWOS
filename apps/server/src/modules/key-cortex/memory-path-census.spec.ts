/**
 * MEM-CENSUS (P107; D-100, D-128, D-227, D-234, D-238, D-254, D-257)
 *
 * Enforceable AST census of every KEY memory read and write path across
 * `apps/server/src` for the 10 memory/event/log models and tables:
 *   AiMemory, AiMemoryEmbedding, TemporalFlowMemory, CognitionMemory,
 *   KeyCortexMemory, GenomeMemoryEvent, CognitiveEvent, BusinessEvent,
 *   AiExecutionLog, CortexActionLog.
 *
 * Test contract:
 *   MEM-CEN-01  Synthetic negative controls (unregistered Prisma call,
 *               unregistered raw SQL + multi-table JOIN, false tenantPredicate
 *               claim on bare-id findUnique, synthetic caller of a DORMANT method).
 *   MEM-CEN-02  Live completeness: every Prisma delegate call and raw SQL access
 *               to the 10 models/tables across `apps/server/src` is registered
 *               in `MEMORY_STORE_PATHS` (0 unregistered sites, 0 duplicates).
 *   MEM-CEN-03  Zero stale entries: every `MEMORY_STORE_PATHS` row matches a
 *               real AST site (with matching kind/via), every
 *               `MEMORY_SERVICE_WRITERS` entry points to an existing file,
 *               class, and methods, and every `DORMANT_MEMORY_PATHS` entry
 *               points to an existing file, class, and method.
 *   MEM-CEN-04  Tenant-predicate truthfulness: every `MEMORY_STORE_PATHS` row
 *               claiming `tenantPredicate: 'yes'` genuinely contains a
 *               `businessId` / `business_id` predicate in its query AST (no
 *               post-fetch or bare-id reads/writes may claim `'yes'`).
 *   MEM-CEN-05  Dormant path guard: every `DORMANT_MEMORY_PATHS` entry has
 *               0 live non-test callers across `apps/server/src`.
 *   MEM-CEN-06  Surface, projection, dataClass & follow-up ownership: every
 *               entry uses closed enum values, and every `unprojected`,
 *               `tenantPredicate: 'no'`, or `dormant` entry cites an explicit
 *               owning follow-up packet / ruling.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as ts from 'typescript';
import {
  DORMANT_MEMORY_PATHS,
  MEMORY_ACCESS_KINDS,
  MEMORY_ACCESS_VIAS,
  MEMORY_DATA_CLASSES,
  MEMORY_PROJECTIONS,
  MEMORY_SERVICE_WRITERS,
  MEMORY_STORE_MODELS,
  MEMORY_STORE_PATHS,
  MEMORY_SURFACES,
  TENANT_PREDICATE_STATUSES,
  type DormantMemoryPathEntry,
  type MemoryAccessKind,
  type MemoryAccessVia,
  type MemoryStoreModel,
  type MemoryStorePathEntry,
} from './memory-path-registry';

const SRC = resolve(__dirname, '../..');

interface ModelSpec {
  readonly model: MemoryStoreModel;
  readonly delegate: string;
  readonly table: string;
}

const MODEL_SPECS: readonly ModelSpec[] = [
  { model: 'AiMemory', delegate: 'aiMemory', table: 'ai_memories' },
  { model: 'AiMemoryEmbedding', delegate: 'aiMemoryEmbedding', table: 'ai_memory_embeddings' },
  { model: 'TemporalFlowMemory', delegate: 'temporalFlowMemory', table: 'temporal_flow_memories' },
  { model: 'CognitionMemory', delegate: 'cognitionMemory', table: 'cognition_memories' },
  { model: 'KeyCortexMemory', delegate: 'keyCortexMemory', table: 'key_cortex_memories' },
  { model: 'GenomeMemoryEvent', delegate: 'genomeMemoryEvent', table: 'genome_memory_events' },
  { model: 'CognitiveEvent', delegate: 'cognitiveEvent', table: 'cognitive_events' },
  { model: 'BusinessEvent', delegate: 'businessEvent', table: 'business_events' },
  { model: 'AiExecutionLog', delegate: 'aiExecutionLog', table: 'ai_execution_logs' },
  { model: 'CortexActionLog', delegate: 'cortexActionLog', table: 'cortex_action_logs' },
];

const DELEGATE_TO_SPEC = new Map<string, ModelSpec>(MODEL_SPECS.map((m) => [m.delegate, m]));

const PRISMA_READ_OPS = new Set<string>([
  'findMany',
  'findFirst',
  'findUnique',
  'findUniqueOrThrow',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

const PRISMA_WRITE_OPS = new Set<string>([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

const PRISMA_OPS = new Set<string>([...PRISMA_READ_OPS, ...PRISMA_WRITE_OPS]);
const RAW_SQL_OPS = new Set<string>(['$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe']);

export interface VirtualSource {
  file: string;
  text: string;
}

export interface ScannedMemoryAccess {
  file: string;
  symbol: string;
  model: MemoryStoreModel;
  op: string;
  occurrenceIndex: number;
  kind: MemoryAccessKind;
  via: MemoryAccessVia;
  hasTenantPredicate: boolean;
  line: number;
}

export interface DormantCallerHit {
  target: string;
  callerFile: string;
  callerSymbol: string;
  line: number;
  expression: string;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function walkServerSource(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__mocks__') continue;
      walkServerSource(full, out);
    } else if (
      full.endsWith('.ts') &&
      !full.endsWith('.spec.ts') &&
      !full.endsWith('.test.ts') &&
      !full.endsWith('.d.ts') &&
      !toPosix(full).endsWith('modules/key-cortex/memory-path-registry.ts')
    ) {
      out.push(full);
    }
  }
  return out.sort();
}

let cachedSources: VirtualSource[] | null = null;
function loadServerSources(): VirtualSource[] {
  if (cachedSources) return cachedSources;
  cachedSources = walkServerSource(SRC).map((abs) => ({
    file: toPosix(relative(SRC, abs)),
    text: readFileSync(abs, 'utf8'),
  }));
  return cachedSources;
}

function unwrapExpr(expr: ts.Expression): ts.Expression {
  let cur: ts.Expression = expr;
  while (
    ts.isParenthesizedExpression(cur) ||
    ts.isAsExpression(cur) ||
    ts.isNonNullExpression(cur) ||
    ts.isTypeAssertionExpression(cur)
  ) {
    cur = cur.expression;
  }
  return cur;
}

function getEnclosingOwner(
  node: ts.Node,
  sf: ts.SourceFile,
): { symbol: string; scopeNode: ts.Node; classDecl: ts.ClassDeclaration | null } {
  let cur: ts.Node | undefined = node.parent;
  let memberNode: ts.Node | null = null;
  let memberName: string | null = null;
  let classDecl: ts.ClassDeclaration | null = null;
  let topFnNode: ts.Node | null = null;
  let topFnName: string | null = null;

  while (cur) {
    if (!memberNode) {
      if (ts.isMethodDeclaration(cur) && cur.name) {
        memberNode = cur;
        memberName = cur.name.getText(sf);
      } else if (ts.isConstructorDeclaration(cur)) {
        memberNode = cur;
        memberName = 'constructor';
      } else if ((ts.isGetAccessorDeclaration(cur) || ts.isSetAccessorDeclaration(cur)) && cur.name) {
        memberNode = cur;
        memberName = cur.name.getText(sf);
      } else if (ts.isPropertyDeclaration(cur) && cur.name) {
        memberNode = cur;
        memberName = cur.name.getText(sf);
      }
    }
    if (!classDecl && ts.isClassDeclaration(cur) && cur.name) {
      classDecl = cur;
    }
    if (ts.isFunctionDeclaration(cur) && cur.name) {
      topFnNode = cur;
      topFnName = cur.name.text;
    } else if (
      ts.isVariableDeclaration(cur) &&
      ts.isIdentifier(cur.name) &&
      cur.initializer &&
      (ts.isArrowFunction(cur.initializer) || ts.isFunctionExpression(cur.initializer)) &&
      cur.parent &&
      ts.isVariableDeclarationList(cur.parent) &&
      cur.parent.parent &&
      ts.isVariableStatement(cur.parent.parent) &&
      ts.isSourceFile(cur.parent.parent.parent)
    ) {
      topFnNode = cur;
      topFnName = cur.name.text;
    }
    cur = cur.parent;
  }

  if (classDecl?.name && memberName && memberNode) {
    return { symbol: `${classDecl.name.text}.${memberName}`, scopeNode: memberNode, classDecl };
  }
  if (classDecl?.name) {
    return { symbol: classDecl.name.text, scopeNode: classDecl, classDecl };
  }
  if (topFnName && topFnNode) {
    return { symbol: topFnName, scopeNode: topFnNode, classDecl: null };
  }
  return { symbol: '<module>', scopeNode: sf, classDecl: null };
}

function propKeyName(prop: ts.ObjectLiteralElementLike): string | null {
  if (ts.isShorthandPropertyAssignment(prop)) return prop.name.text;
  if (ts.isPropertyAssignment(prop)) {
    if (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) return prop.name.text;
  }
  return null;
}

function getObjectProp(obj: ts.ObjectLiteralExpression, propName: string): ts.Expression | null {
  for (const p of obj.properties) {
    if (propKeyName(p) === propName) {
      return ts.isShorthandPropertyAssignment(p) ? p.name : (p as ts.PropertyAssignment).initializer;
    }
  }
  return null;
}

function findClassMethod(cls: ts.ClassDeclaration | null, methodName: string, sf: ts.SourceFile): ts.MethodDeclaration | null {
  if (!cls) return null;
  for (const m of cls.members) {
    if (ts.isMethodDeclaration(m) && m.name && m.name.getText(sf) === methodName) {
      return m;
    }
  }
  return null;
}

/**
 * Checks whether an expression contains an embedded `businessId` value (used
 * solely for tenant-namespaced synthetic `id` templates in `upsert` where
 * `create` also explicitly supplies `businessId`).
 */
function idExprEmbedsBusinessId(
  expr: ts.Expression,
  scopeNode: ts.Node,
  sf: ts.SourceFile,
  visited = new Set<string>(),
): boolean {
  const e = unwrapExpr(expr);
  if (ts.isTemplateExpression(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isBinaryExpression(e)) {
    return /\bbusinessId\b/.test(e.getText(sf));
  }
  if (ts.isIdentifier(e)) {
    const name = e.text;
    if (visited.has(name)) return false;
    const nextVisited = new Set(visited);
    nextVisited.add(name);
    let found = false;
    const search = (x: ts.Node): void => {
      if (found) return;
      if (ts.isVariableDeclaration(x) && ts.isIdentifier(x.name) && x.name.text === name && x.initializer) {
        if (idExprEmbedsBusinessId(x.initializer, scopeNode, sf, nextVisited)) found = true;
      }
      ts.forEachChild(x, search);
    };
    search(scopeNode);
    return found;
  }
  return false;
}

/**
 * Structural tenant-predicate verifier for Prisma `where` and `data` clauses.
 *
 * Returns true ONLY when the clause itself carries a `businessId` (or
 * `businessId_*` / `*_businessId`) key — directly, via spread, via `AND`/`OR`/`NOT`,
 * via a local clause variable in the enclosing method, or via a same-class
 * `this.helper(...)` whose returned object carries `businessId`.
 *
 * Critically, does NOT follow scalar row property references like
 * `where: { id: existing.id }`, so bare-id follow-ups and post-fetch checks
 * cannot falsely pass as having a query-level tenant predicate.
 */
function clauseHasBusinessId(
  expr: ts.Expression,
  scopeNode: ts.Node,
  classDecl: ts.ClassDeclaration | null,
  sf: ts.SourceFile,
  visited: Set<string> = new Set(),
): boolean {
  const e = unwrapExpr(expr);

  if (ts.isObjectLiteralExpression(e)) {
    for (const p of e.properties) {
      if (ts.isSpreadAssignment(p)) {
        if (clauseHasBusinessId(p.expression, scopeNode, classDecl, sf, new Set(visited))) return true;
        continue;
      }
      const key = propKeyName(p);
      if (!key) continue;
      if (key === 'businessId' || key.startsWith('businessId_') || key.endsWith('_businessId')) {
        return true;
      }
      if (key === 'AND' || key === 'OR' || key === 'NOT') {
        const val = ts.isPropertyAssignment(p) ? p.initializer : (p as ts.ShorthandPropertyAssignment).name;
        if (clauseHasBusinessId(val, scopeNode, classDecl, sf, new Set(visited))) return true;
      }
    }
    return false;
  }

  if (ts.isArrayLiteralExpression(e)) {
    return e.elements.some((el) => clauseHasBusinessId(el, scopeNode, classDecl, sf, new Set(visited)));
  }

  if (ts.isConditionalExpression(e)) {
    return (
      clauseHasBusinessId(e.whenTrue, scopeNode, classDecl, sf, new Set(visited)) &&
      clauseHasBusinessId(e.whenFalse, scopeNode, classDecl, sf, new Set(visited))
    );
  }

  if (ts.isCallExpression(e)) {
    if (e.arguments.some((arg) => clauseHasBusinessId(arg, scopeNode, classDecl, sf, new Set(visited)))) {
      return true;
    }
    const callee = unwrapExpr(e.expression);
    if (
      ts.isPropertyAccessExpression(callee) &&
      callee.expression.kind === ts.SyntaxKind.ThisKeyword &&
      classDecl
    ) {
      const helperKey = `this.${callee.name.text}`;
      if (!visited.has(helperKey)) {
        const helper = findClassMethod(classDecl, callee.name.text, sf);
        if (helper?.body) {
          const nextVisited = new Set(visited);
          nextVisited.add(helperKey);
          let helperReturnsScoped = false;
          const findReturn = (x: ts.Node): void => {
            if (helperReturnsScoped) return;
            if (ts.isReturnStatement(x) && x.expression) {
              if (clauseHasBusinessId(x.expression, helper, classDecl, sf, new Set(nextVisited))) {
                helperReturnsScoped = true;
              }
            }
            ts.forEachChild(x, findReturn);
          };
          findReturn(helper.body);
          if (helperReturnsScoped) return true;
        }
      }
    }
    return false;
  }

  if (ts.isIdentifier(e)) {
    const name = e.text;
    if (visited.has(name)) return false;
    const nextVisited = new Set(visited);
    nextVisited.add(name);
    let found = false;
    const searchDef = (x: ts.Node): void => {
      if (found) return;
      if (ts.isVariableDeclaration(x) && ts.isIdentifier(x.name) && x.name.text === name && x.initializer) {
        if (clauseHasBusinessId(x.initializer, scopeNode, classDecl, sf, new Set(nextVisited))) {
          found = true;
        }
      }
      if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        if (
          ts.isPropertyAccessExpression(x.left) &&
          ts.isIdentifier(x.left.expression) &&
          x.left.expression.text === name &&
          x.left.name.text === 'businessId'
        ) {
          found = true;
        } else if (ts.isIdentifier(x.left) && x.left.text === name) {
          if (clauseHasBusinessId(x.right, scopeNode, classDecl, sf, new Set(nextVisited))) {
            found = true;
          }
        }
      }
      ts.forEachChild(x, searchDef);
    };
    searchDef(scopeNode);
    return found;
  }

  return false;
}

function prismaCallHasTenantPredicate(
  callNode: ts.CallExpression,
  op: string,
  scopeNode: ts.Node,
  classDecl: ts.ClassDeclaration | null,
  sf: ts.SourceFile,
): boolean {
  const arg0 = callNode.arguments[0] ? unwrapExpr(callNode.arguments[0]) : null;
  if (!arg0) return false;
  if (ts.isObjectLiteralExpression(arg0)) {
    if (op === 'create' || op === 'createMany' || op === 'createManyAndReturn') {
      const dataProp = getObjectProp(arg0, 'data');
      return dataProp ? clauseHasBusinessId(dataProp, scopeNode, classDecl, sf) : false;
    }
    const whereProp = getObjectProp(arg0, 'where');
    if (whereProp && clauseHasBusinessId(whereProp, scopeNode, classDecl, sf)) {
      return true;
    }
    if (op === 'upsert' && whereProp) {
      const createProp = getObjectProp(arg0, 'create');
      const unwrappedWhere = unwrapExpr(whereProp);
      if (createProp && ts.isObjectLiteralExpression(unwrappedWhere)) {
        const idProp = getObjectProp(unwrappedWhere, 'id');
        if (
          idProp &&
          clauseHasBusinessId(createProp, scopeNode, classDecl, sf) &&
          idExprEmbedsBusinessId(idProp, scopeNode, sf)
        ) {
          return true;
        }
      }
    }
    for (const p of arg0.properties) {
      if (ts.isSpreadAssignment(p) && clauseHasBusinessId(p.expression, scopeNode, classDecl, sf)) {
        return true;
      }
    }
    return false;
  }
  return clauseHasBusinessId(arg0, scopeNode, classDecl, sf);
}

function extractSqlText(node: ts.Node, scopeNode: ts.Node): string {
  const parts: string[] = [];
  const visitedVars = new Set<string>();

  const collect = (n: ts.Node | undefined): void => {
    if (!n) return;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      parts.push(n.text);
    } else if (ts.isTemplateExpression(n)) {
      parts.push(n.head.text);
      for (const span of n.templateSpans) {
        collect(span.expression);
        parts.push(span.literal.text);
      }
    } else if (ts.isTaggedTemplateExpression(n)) {
      collect(n.template);
    } else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      collect(n.left);
      collect(n.right);
    } else if (ts.isCallExpression(n)) {
      for (const arg of n.arguments) collect(arg);
    } else if (ts.isIdentifier(n)) {
      const varName = n.text;
      if (visitedVars.has(varName)) return;
      visitedVars.add(varName);
      const findDef = (x: ts.Node): void => {
        if (ts.isVariableDeclaration(x) && ts.isIdentifier(x.name) && x.name.text === varName && x.initializer) {
          collect(x.initializer);
        }
        if (
          ts.isBinaryExpression(x) &&
          ts.isIdentifier(x.left) &&
          x.left.text === varName &&
          (x.operatorToken.kind === ts.SyntaxKind.EqualsToken ||
            x.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken)
        ) {
          collect(x.right);
        }
        ts.forEachChild(x, findDef);
      };
      findDef(scopeNode);
    } else if (ts.isConditionalExpression(n)) {
      collect(n.whenTrue);
      collect(n.whenFalse);
    } else if (ts.isArrayLiteralExpression(n)) {
      for (const el of n.elements) collect(el);
    }
  };

  collect(node);
  return parts.join(' ');
}

function isWriteSql(op: string, sqlText: string): boolean {
  if (op.includes('execute')) return true;
  return /\b(INSERT\s+INTO|UPDATE\s+[\s\S]*?\bSET\b|DELETE\s+FROM)\b/i.test(sqlText);
}

/**
 * AST scanner over all non-test `.ts` files under `apps/server/src` (or synthetic
 * virtual sources for `MEM-CEN-01`). Detects both Prisma delegate calls and raw
 * SQL statements touching any of the 10 memory/event/log models/tables.
 */
export function scanMemoryAccesses(sources: readonly VirtualSource[] = loadServerSources()): ScannedMemoryAccess[] {
  const allFindings: ScannedMemoryAccess[] = [];

  for (const { file, text } of sources) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const fileFindings: Omit<ScannedMemoryAccess, 'occurrenceIndex'>[] = [];

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = unwrapExpr(node.expression);
        if (ts.isPropertyAccessExpression(callee)) {
          const op = callee.name.text;
          if (PRISMA_OPS.has(op)) {
            const obj = unwrapExpr(callee.expression);
            let delegateName: string | null = null;
            let isBareThisService = false;
            if (ts.isPropertyAccessExpression(obj)) {
              delegateName = obj.name.text;
              // `this.aiMemory.upsert(...)` is an injected NestJS service, not a Prisma delegate.
              if (obj.expression.kind === ts.SyntaxKind.ThisKeyword) {
                isBareThisService = true;
              }
            } else if (
              ts.isElementAccessExpression(obj) &&
              ts.isStringLiteral(obj.argumentExpression)
            ) {
              delegateName = obj.argumentExpression.text;
              if (obj.expression.kind === ts.SyntaxKind.ThisKeyword) {
                isBareThisService = true;
              }
            }

            if (!isBareThisService && delegateName) {
              const spec = DELEGATE_TO_SPEC.get(delegateName);
              if (spec) {
                const { symbol, scopeNode, classDecl } = getEnclosingOwner(node, sf);
                const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
                fileFindings.push({
                  file,
                  symbol,
                  model: spec.model,
                  op,
                  kind: PRISMA_WRITE_OPS.has(op) ? 'write' : 'read',
                  via: 'prisma',
                  hasTenantPredicate: prismaCallHasTenantPredicate(node, op, scopeNode, classDecl, sf),
                  line,
                });
              }
            }
          }

          if (RAW_SQL_OPS.has(op)) {
            const { symbol, scopeNode } = getEnclosingOwner(node, sf);
            const sqlText = node.arguments.map((a) => extractSqlText(a, scopeNode)).join(' ');
            const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
            const kind: MemoryAccessKind = isWriteSql(op, sqlText) ? 'write' : 'read';
            const hasTenantPredicate = /\bbusiness_id\b/i.test(sqlText);
            for (const spec of MODEL_SPECS) {
              if (new RegExp(`\\b${spec.table}\\b`, 'i').test(sqlText)) {
                fileFindings.push({
                  file,
                  symbol,
                  model: spec.model,
                  op,
                  kind,
                  via: 'raw-sql',
                  hasTenantPredicate,
                  line,
                });
              }
            }
          }
        }
      }

      if (ts.isTaggedTemplateExpression(node)) {
        const tag = unwrapExpr(node.tag);
        let op: string | null = null;
        if (ts.isPropertyAccessExpression(tag) && RAW_SQL_OPS.has(tag.name.text)) {
          op = tag.name.text;
        } else if (
          ts.isExpressionWithTypeArguments(tag) &&
          ts.isPropertyAccessExpression(tag.expression) &&
          RAW_SQL_OPS.has(tag.expression.name.text)
        ) {
          op = tag.expression.name.text;
        }
        if (op) {
          const { symbol, scopeNode } = getEnclosingOwner(node, sf);
          const sqlText = extractSqlText(node.template, scopeNode);
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          const kind: MemoryAccessKind = isWriteSql(op, sqlText) ? 'write' : 'read';
          const hasTenantPredicate = /\bbusiness_id\b/i.test(sqlText);
          for (const spec of MODEL_SPECS) {
            if (new RegExp(`\\b${spec.table}\\b`, 'i').test(sqlText)) {
              fileFindings.push({
                file,
                symbol,
                model: spec.model,
                op,
                kind,
                via: 'raw-sql',
                hasTenantPredicate,
                line,
              });
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sf);

    const occurrenceCounts = new Map<string, number>();
    for (const f of fileFindings) {
      const base = `${f.file}::${f.symbol}::${f.model}::${f.op}`;
      const idx = occurrenceCounts.get(base) ?? 0;
      occurrenceCounts.set(base, idx + 1);
      allFindings.push({ ...f, occurrenceIndex: idx });
    }
  }

  return allFindings;
}

export function entryKey(entry: {
  file: string;
  symbol: string;
  model: MemoryStoreModel;
  op: string;
  occurrenceIndex?: number;
}): string {
  return `${entry.file}::${entry.symbol}::${entry.model}::${entry.op}#${entry.occurrenceIndex ?? 0}`;
}

export function diffCensus(
  scanned: readonly ScannedMemoryAccess[],
  registry: readonly MemoryStorePathEntry[],
): {
  missing: string[];
  stale: string[];
  duplicates: string[];
  mismatches: string[];
} {
  const scannedByKey = new Map<string, ScannedMemoryAccess>();
  for (const s of scanned) {
    scannedByKey.set(entryKey(s), s);
  }

  const registryByKey = new Map<string, MemoryStorePathEntry>();
  const duplicates: string[] = [];
  for (const r of registry) {
    const k = entryKey(r);
    if (registryByKey.has(k)) duplicates.push(k);
    else registryByKey.set(k, r);
  }

  const missing: string[] = [];
  for (const [k, s] of scannedByKey.entries()) {
    if (!registryByKey.has(k)) {
      missing.push(`${k} (line ${s.line}, ${s.via}, ${s.kind})`);
    }
  }

  const stale: string[] = [];
  const mismatches: string[] = [];
  for (const [k, r] of registryByKey.entries()) {
    const s = scannedByKey.get(k);
    if (!s) {
      stale.push(k);
    } else {
      if (s.kind !== r.kind) {
        mismatches.push(`${k}: registry kind='${r.kind}' != AST kind='${s.kind}'`);
      }
      if (s.via !== r.via) {
        mismatches.push(`${k}: registry via='${r.via}' != AST via='${s.via}'`);
      }
    }
  }

  return { missing, stale, duplicates, mismatches };
}

export function validateTenantPredicates(
  scanned: readonly ScannedMemoryAccess[],
  registry: readonly MemoryStorePathEntry[],
): string[] {
  const scannedByKey = new Map<string, ScannedMemoryAccess>(scanned.map((s) => [entryKey(s), s]));
  const violations: string[] = [];

  for (const r of registry) {
    if (r.tenantPredicate !== 'yes') continue;
    const k = entryKey(r);
    const s = scannedByKey.get(k);
    if (!s) continue;
    if (!s.hasTenantPredicate) {
      violations.push(
        `${k} (line ${s.line}): claims tenantPredicate='yes' but query AST has no businessId/business_id predicate`,
      );
    }
  }

  return violations;
}

/**
 * Extracts declared type names of constructor parameter properties, class
 * properties, and local variables/parameters within a class or method so the
 * dormant caller scanner distinguishes e.g. `KeyInboxService.addMessage` from
 * `KeyCortexConversationService.addMessage`.
 */
function buildClassPropTypes(cls: ts.ClassDeclaration | null, sf: ts.SourceFile): Map<string, string> {
  const map = new Map<string, string>();
  if (!cls) return map;
  for (const member of cls.members) {
    if (ts.isPropertyDeclaration(member) && member.name && member.type) {
      const typeName = extractTypeName(member.type, sf);
      if (typeName) map.set(member.name.getText(sf), typeName);
    }
    if (ts.isConstructorDeclaration(member)) {
      for (const param of member.parameters) {
        if (ts.isIdentifier(param.name) && param.type) {
          const typeName = extractTypeName(param.type, sf);
          if (typeName) map.set(param.name.text, typeName);
        }
      }
    }
  }
  return map;
}

function buildLocalTypes(scopeNode: ts.Node, sf: ts.SourceFile): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (n: ts.Node): void => {
    if (ts.isParameter(n) && ts.isIdentifier(n.name) && n.type) {
      const t = extractTypeName(n.type, sf);
      if (t) map.set(n.name.text, t);
    } else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      if (n.type) {
        const t = extractTypeName(n.type, sf);
        if (t) map.set(n.name.text, t);
      } else if (n.initializer) {
        const init = unwrapExpr(n.initializer);
        if (ts.isNewExpression(init) && ts.isIdentifier(init.expression)) {
          map.set(n.name.text, init.expression.text);
        }
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(scopeNode);
  return map;
}

function extractTypeName(typeNode: ts.TypeNode, sf: ts.SourceFile): string | null {
  if (ts.isTypeReferenceNode(typeNode)) {
    return typeNode.typeName.getText(sf);
  }
  if (ts.isUnionTypeNode(typeNode)) {
    for (const t of typeNode.types) {
      if (ts.isTypeReferenceNode(t)) return t.typeName.getText(sf);
    }
  }
  return null;
}

/**
 * Scans every non-test source file for live callers of any method registered
 * in `DORMANT_MEMORY_PATHS`.
 *
 * Calls from another method that is ALSO registered in `DORMANT_MEMORY_PATHS`
 * (e.g., dormant `selfTune` calling private `applyTuningAdjustment`) are treated
 * as inside the dormant subgraph; the first non-dormant caller of ANY dormant
 * entry immediately produces a hit and fails `MEM-CEN-05`.
 */
export function scanDormantCallers(
  dormantEntries: readonly DormantMemoryPathEntry[],
  sources: readonly VirtualSource[] = loadServerSources(),
): DormantCallerHit[] {
  const dormantSymbols = new Set<string>(
    dormantEntries.map((d) => `${d.className}.${d.methodName}`),
  );
  const byMethod = new Map<string, DormantMemoryPathEntry[]>();
  for (const d of dormantEntries) {
    const arr = byMethod.get(d.methodName) ?? [];
    arr.push(d);
    byMethod.set(d.methodName, arr);
  }

  const hits: DormantCallerHit[] = [];

  for (const { file, text } of sources) {
    // Fast pre-check: skip files mentioning none of the dormant method names.
    const candidates = [...byMethod.keys()].filter((m) => text.includes(m));
    if (candidates.length === 0) continue;

    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const importedIds = new Set<string>();
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st) && st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings)) {
        for (const el of st.importClause.namedBindings.elements) {
          importedIds.add(el.name.text);
        }
      }
    }

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = unwrapExpr(node.expression);
        let invokedMethod: string | null = null;
        let receiverExpr: ts.Expression | null = null;

        if (ts.isPropertyAccessExpression(callee)) {
          invokedMethod = callee.name.text;
          receiverExpr = unwrapExpr(callee.expression);
        } else if (
          ts.isElementAccessExpression(callee) &&
          ts.isStringLiteral(callee.argumentExpression)
        ) {
          invokedMethod = callee.argumentExpression.text;
          receiverExpr = unwrapExpr(callee.expression);
        }

        if (invokedMethod && byMethod.has(invokedMethod) && receiverExpr) {
          const { symbol: callerSymbol, scopeNode, classDecl } = getEnclosingOwner(node, sf);
          const propTypes = buildClassPropTypes(classDecl, sf);
          const localTypes = buildLocalTypes(scopeNode, sf);

          let resolvedClass: string | null = null;
          if (receiverExpr.kind === ts.SyntaxKind.ThisKeyword) {
            resolvedClass = classDecl?.name?.text ?? null;
          } else if (
            ts.isPropertyAccessExpression(receiverExpr) &&
            receiverExpr.expression.kind === ts.SyntaxKind.ThisKeyword
          ) {
            resolvedClass = propTypes.get(receiverExpr.name.text) ?? null;
          } else if (ts.isIdentifier(receiverExpr)) {
            resolvedClass = localTypes.get(receiverExpr.text) ?? null;
          }

          for (const target of byMethod.get(invokedMethod)!) {
            // Skip dormant-to-dormant internal calls (e.g. dormant selfTune -> private applyTuningAdjustment).
            if (dormantSymbols.has(callerSymbol)) continue;

            // If receiver type resolves to a different concrete class, this is an unrelated method name collision
            // (e.g., KeyInboxService.addMessage vs KeyCortexConversationService.addMessage).
            if (resolvedClass && resolvedClass !== target.className) continue;

            // If receiver type couldn't be resolved statically, only flag if this file defines or imports target.className.
            if (!resolvedClass && file !== target.file && !importedIds.has(target.className)) continue;

            const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
            hits.push({
              target: `${target.className}.${target.methodName}`,
              callerFile: file,
              callerSymbol,
              line,
              expression: node.getText(sf).replace(/\s+/g, ' ').slice(0, 120),
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sf);
  }

  return hits;
}

function classAndMethodsExist(file: string, className: string, methodNames: readonly string[]): string[] {
  const abs = join(SRC, file);
  if (!existsSync(abs)) return [`${file}: file does not exist`];
  const text = readFileSync(abs, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  let targetClass: ts.ClassDeclaration | null = null;
  for (const st of sf.statements) {
    if (ts.isClassDeclaration(st) && st.name?.text === className) {
      targetClass = st;
      break;
    }
  }
  if (!targetClass) return [`${file}: class '${className}' not found`];

  const foundMethods = new Set<string>();
  for (const m of targetClass.members) {
    if ((ts.isMethodDeclaration(m) || ts.isPropertyDeclaration(m)) && m.name) {
      foundMethods.add(m.name.getText(sf));
    }
  }
  const errors: string[] = [];
  for (const method of methodNames) {
    if (!foundMethods.has(method)) {
      errors.push(`${file}: method '${className}.${method}' not found`);
    }
  }
  return errors;
}

describe('MEM-CENSUS (P107): AST census of KEY memory read/write paths', () => {
  it('MEM-CEN-01: synthetic negative controls detect unregistered Prisma, unregistered raw SQL, false tenantPredicate, and dormant callers', () => {
    // 1. Unregistered Prisma delegate call
    const prismaFixture: VirtualSource[] = [
      {
        file: 'modules/synthetic/unregistered-reader.service.ts',
        text: `
          export class UnregisteredReaderService {
            constructor(private readonly prisma: any) {}
            async readMemories(businessId: string) {
              return this.prisma.client.aiMemory.findMany({ where: { businessId } });
            }
          }
        `,
      },
    ];
    const prismaSites = scanMemoryAccesses(prismaFixture);
    expect(prismaSites).toHaveLength(1);
    expect(prismaSites[0]).toMatchObject({
      file: 'modules/synthetic/unregistered-reader.service.ts',
      symbol: 'UnregisteredReaderService.readMemories',
      model: 'AiMemory',
      op: 'findMany',
      kind: 'read',
      via: 'prisma',
      hasTenantPredicate: true,
    });
    const prismaDiff = diffCensus(prismaSites, []);
    expect(prismaDiff.missing).toEqual([
      'modules/synthetic/unregistered-reader.service.ts::UnregisteredReaderService.readMemories::AiMemory::findMany#0 (line 5, prisma, read)',
    ]);

    // 2. Unregistered raw SQL (including multi-table JOIN emitting one finding per table)
    const rawSqlFixture: VirtualSource[] = [
      {
        file: 'modules/synthetic/raw-sql-reader.service.ts',
        text: `
          export class RawSqlReaderService {
            constructor(private readonly prisma: any) {}
            async searchJoined(businessId: string) {
              return this.prisma.client.$queryRaw\`
                SELECT e.id FROM ai_memory_embeddings e
                JOIN ai_memories m ON m.id = e.source_id
                WHERE e.business_id = \${businessId}
              \`;
            }
          }
        `,
      },
    ];
    const rawSites = scanMemoryAccesses(rawSqlFixture);
    expect(rawSites.map((s) => `${s.model}:${s.op}:${s.via}:${s.kind}`)).toEqual([
      'AiMemory:$queryRaw:raw-sql:read',
      'AiMemoryEmbedding:$queryRaw:raw-sql:read',
    ]);
    const rawDiff = diffCensus(rawSites, []);
    expect(rawDiff.missing).toHaveLength(2);
    expect(rawDiff.missing[0]).toContain('RawSqlReaderService.searchJoined::AiMemory::$queryRaw#0');
    expect(rawDiff.missing[1]).toContain('RawSqlReaderService.searchJoined::AiMemoryEmbedding::$queryRaw#0');

    // 3. Synthetic findUnique({ where: { id } }) falsely claiming tenantPredicate: 'yes'
    const unscopedFixture: VirtualSource[] = [
      {
        file: 'modules/synthetic/unscoped-reader.service.ts',
        text: `
          export class UnscopedReaderService {
            constructor(private readonly prisma: any) {}
            async readById(businessId: string, id: string) {
              const row = await this.prisma.client.aiMemory.findUnique({ where: { id } });
              if (!row || row.businessId !== businessId) return null;
              return row;
            }
          }
        `,
      },
    ];
    const unscopedSites = scanMemoryAccesses(unscopedFixture);
    expect(unscopedSites).toHaveLength(1);
    expect(unscopedSites[0].hasTenantPredicate).toBe(false);
    const falseClaimViolations = validateTenantPredicates(unscopedSites, [
      {
        file: 'modules/synthetic/unscoped-reader.service.ts',
        symbol: 'UnscopedReaderService.readById',
        model: 'AiMemory',
        op: 'findUnique',
        kind: 'read',
        via: 'prisma',
        tenantPredicate: 'yes',
        surface: 'api',
        projection: 'unprojected',
        dataClass: 'MIXED',
        followUp: 'MEM-CLASS-READ',
      },
    ]);
    expect(falseClaimViolations).toHaveLength(1);
    expect(falseClaimViolations[0]).toContain("claims tenantPredicate='yes'");

    // 4. Synthetic live caller invoking a DORMANT method (while unrelated class with same method name is ignored)
    const dormantEntries: DormantMemoryPathEntry[] = [
      {
        file: 'modules/key-cortex/key-cortex-conversation.service.ts',
        className: 'KeyCortexConversationService',
        methodName: 'addMessage',
        reason: 'Passes userId that AiMemory cannot store',
        followUp: 'MEM-CLASS-COLUMNS',
      },
    ];
    const callerFixtures: VirtualSource[] = [
      {
        file: 'modules/synthetic/unrelated-caller.service.ts',
        text: `
          import { KeyInboxService } from '../key-inbox/key-inbox.service';
          export class UnrelatedCallerService {
            constructor(private readonly inbox: KeyInboxService) {}
            async run() { return this.inbox.addMessage({}); }
          }
        `,
      },
      {
        file: 'modules/synthetic/bad-dormant-caller.service.ts',
        text: `
          import { KeyCortexConversationService } from '../key-cortex/key-cortex-conversation.service';
          export class BadDormantCallerService {
            constructor(private readonly conv: KeyCortexConversationService) {}
            async run(sessionId: string) {
              return this.conv.addMessage(sessionId, { role: 'user', content: 'hi' });
            }
          }
        `,
      },
    ];
    const dormantHits = scanDormantCallers(dormantEntries, callerFixtures);
    expect(dormantHits).toHaveLength(1);
    expect(dormantHits[0]).toMatchObject({
      target: 'KeyCortexConversationService.addMessage',
      callerFile: 'modules/synthetic/bad-dormant-caller.service.ts',
      callerSymbol: 'BadDormantCallerService.run',
    });
  });

  it('MEM-CEN-02: every Prisma call and raw SQL access to the 10 memory models across apps/server/src is registered (0 unregistered, 0 duplicates)', () => {
    const scanned = scanMemoryAccesses();
    expect(scanned.length).toBeGreaterThan(0);

    const { missing, duplicates } = diffCensus(scanned, MEMORY_STORE_PATHS);
    expect(
      duplicates,
      `Duplicate entries in MEMORY_STORE_PATHS:\n${duplicates.join('\n')}`,
    ).toEqual([]);
    expect(
      missing,
      `Unregistered memory store access site(s) found (${missing.length}):\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('MEM-CEN-03: zero stale registry entries, and every service writer and dormant entry references a real file, class, and method', () => {
    const scanned = scanMemoryAccesses();
    const { stale, mismatches } = diffCensus(scanned, MEMORY_STORE_PATHS);
    expect(stale, `Stale entries in MEMORY_STORE_PATHS:\n${stale.join('\n')}`).toEqual([]);
    expect(mismatches, `Kind/via mismatches in MEMORY_STORE_PATHS:\n${mismatches.join('\n')}`).toEqual([]);

    expect(
      MEMORY_SERVICE_WRITERS.length,
      'MEMORY_SERVICE_WRITERS must record the service-level memory write doors (>= 9)',
    ).toBeGreaterThanOrEqual(9);

    const writerErrors: string[] = [];
    for (const w of MEMORY_SERVICE_WRITERS) {
      if (w.methods.length === 0) {
        writerErrors.push(`${w.file}: ${w.className} must list at least one write method`);
      }
      writerErrors.push(...classAndMethodsExist(w.file, w.className, w.methods));
    }
    expect(writerErrors, `Invalid MEMORY_SERVICE_WRITERS entries:\n${writerErrors.join('\n')}`).toEqual([]);

    const dormantErrors: string[] = [];
    for (const d of DORMANT_MEMORY_PATHS) {
      dormantErrors.push(...classAndMethodsExist(d.file, d.className, [d.methodName]));
    }
    expect(dormantErrors, `Invalid DORMANT_MEMORY_PATHS entries:\n${dormantErrors.join('\n')}`).toEqual([]);
  });

  it('MEM-CEN-04: tenant-predicate truthfulness — every entry claiming tenantPredicate="yes" genuinely carries a tenant predicate in its query AST', () => {
    const scanned = scanMemoryAccesses();
    const violations = validateTenantPredicates(scanned, MEMORY_STORE_PATHS);
    expect(
      violations,
      `False tenantPredicate='yes' claim(s) in MEMORY_STORE_PATHS:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('MEM-CEN-05: dormant path guard — every DORMANT_MEMORY_PATHS entry has 0 live non-test callers across apps/server/src', () => {
    expect(
      DORMANT_MEMORY_PATHS.length,
      'DORMANT_MEMORY_PATHS must register known dormant memory paths',
    ).toBeGreaterThan(0);

    const liveCallers = scanDormantCallers(DORMANT_MEMORY_PATHS);
    expect(
      liveCallers,
      `Live caller(s) found for DORMANT memory path(s):\n${liveCallers
        .map((c) => `  ${c.target} called from ${c.callerFile}:${c.line} (${c.callerSymbol}): ${c.expression}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  it('MEM-CEN-06: every entry declares valid closed-enum surface, projection, dataClass, and explicit followUp ownership where required', () => {
    expect(MEMORY_STORE_PATHS.length).toBeGreaterThan(0);

    const validModels = new Set<string>(MEMORY_STORE_MODELS);
    const validKinds = new Set<string>(MEMORY_ACCESS_KINDS);
    const validVias = new Set<string>(MEMORY_ACCESS_VIAS);
    const validPredicates = new Set<string>(TENANT_PREDICATE_STATUSES);
    const validSurfaces = new Set<string>(MEMORY_SURFACES);
    const validProjections = new Set<string>(MEMORY_PROJECTIONS);
    const validDataClasses = new Set<string>(MEMORY_DATA_CLASSES);
    const packetRefPattern = /\b(MEM-[A-Z0-9-]+|RR-[A-Z0-9-]+|FU-[A-Z0-9-]+|W[0-9A-Z]+-[A-Z0-9-]+|D-\d+)\b/;

    const errors: string[] = [];
    for (const r of MEMORY_STORE_PATHS) {
      const k = entryKey(r);
      if (!validModels.has(r.model)) errors.push(`${k}: invalid model '${r.model}'`);
      if (!validKinds.has(r.kind)) errors.push(`${k}: invalid kind '${r.kind}'`);
      if (!validVias.has(r.via)) errors.push(`${k}: invalid via '${r.via}'`);
      if (!validPredicates.has(r.tenantPredicate)) errors.push(`${k}: invalid tenantPredicate '${r.tenantPredicate}'`);
      if (!validSurfaces.has(r.surface)) errors.push(`${k}: invalid surface '${r.surface}'`);
      if (!validProjections.has(r.projection)) errors.push(`${k}: invalid projection '${r.projection}'`);
      if (!validDataClasses.has(r.dataClass)) errors.push(`${k}: invalid dataClass '${r.dataClass}'`);

      const needsFollowUp =
        r.projection === 'unprojected' ||
        r.tenantPredicate === 'no' ||
        r.projection === 'dormant';
      if (needsFollowUp) {
        if (!r.followUp || !r.followUp.trim()) {
          errors.push(`${k}: requires explicit followUp (projection=${r.projection}, tenantPredicate=${r.tenantPredicate})`);
        } else if (!packetRefPattern.test(r.followUp)) {
          errors.push(`${k}: followUp '${r.followUp}' must cite an owning packet ID or ruling`);
        }
      }
    }

    for (const w of MEMORY_SERVICE_WRITERS) {
      if (!w.followUp || !packetRefPattern.test(w.followUp)) {
        errors.push(`writer ${w.className}: followUp '${w.followUp}' must cite an owning packet ID or ruling`);
      }
      if (w.stores.length === 0) errors.push(`writer ${w.className}: stores must be non-empty`);
      if (w.dataClasses.length === 0) errors.push(`writer ${w.className}: dataClasses must be non-empty`);
    }

    for (const d of DORMANT_MEMORY_PATHS) {
      if (!d.reason.trim()) errors.push(`dormant ${d.className}.${d.methodName}: reason must be non-empty`);
      if (!d.followUp || !packetRefPattern.test(d.followUp)) {
        errors.push(`dormant ${d.className}.${d.methodName}: followUp '${d.followUp}' must cite an owning packet ID or ruling`);
      }
    }

    expect(errors, `Schema/ownership validation errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
