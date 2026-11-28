/**
 * RR-APPROVAL-MODEL-CENSUS (D-261, D-262, D-17, D-226, D-238, D-103)
 *
 * REC-ONE-APPROVAL-MODEL, first slice only (read-only static census).
 *
 * Scans `apps/server/src` via TypeScript AST for every Prisma write
 * (create/createMany/createManyAndReturn/update/updateMany/updateManyAndReturn/
 * upsert/delete/deleteMany), nested relation write across all delegates, raw SQL
 * DML write (including `idempotency_keys` Flow confirmations), and Flow-bound
 * IdempotencyKey confirmation write across the five approval-shaped stores:
 *   - KeyActionProposal   (`key_action_proposals`)
 *   - AiApprovalItem      (`ai_approval_items`)
 *   - ApprovalRequest     (`approval_requests`)
 *   - ApprovalStep        (`approval_steps`)
 *   - AiApprovalRequest   (`ai_approval_requests` — dormant)
 *   - IdempotencyKey      (`idempotency_keys`, Flow inline confirmations only)
 *
 * Fails if:
 *   1. Any live writer is not registered in `APPROVAL_MODEL_WRITERS`.
 *   2. Any registered non-dormant row no longer matches a live writer.
 *   3. `AiApprovalRequest` is not registered as `dormant` or gains a live code reference/writer.
 *   4. Any row is missing required metadata (`kind`, `gatedEffect`, `executionSite`,
 *      `clearerScope`, `manualPath`, or `bypassNote` when `effectRunsWithoutApproval`).
 *
 * `packages/db/prisma/schema.prisma` is read-only — this packet never edits it.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  APPROVAL_MODEL_WRITERS,
  type ApprovalModelName,
  type ApprovalModelWriterEntry,
} from './approval-model-registry';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SERVER_SRC_DIR = path.join(REPO_ROOT, 'apps/server/src');
const SCHEMA_PATH = path.join(REPO_ROOT, 'packages/db/prisma/schema.prisma');
const SELF_REGISTRY_REL = 'apps/server/src/core/config/approval-model-registry.ts';

const DELEGATE_TO_MODEL: Record<string, ApprovalModelName> = {
  keyActionProposal: 'KeyActionProposal',
  aiApprovalItem: 'AiApprovalItem',
  approvalRequest: 'ApprovalRequest',
  approvalStep: 'ApprovalStep',
  aiApprovalRequest: 'AiApprovalRequest',
};

const TABLE_TO_MODEL: Record<string, ApprovalModelName> = {
  key_action_proposals: 'KeyActionProposal',
  ai_approval_items: 'AiApprovalItem',
  approval_requests: 'ApprovalRequest',
  approval_steps: 'ApprovalStep',
  ai_approval_requests: 'AiApprovalRequest',
};

const EXPECTED_SCHEMA_MAPS: Record<ApprovalModelName, string> = {
  KeyActionProposal: 'key_action_proposals',
  AiApprovalItem: 'ai_approval_items',
  ApprovalRequest: 'approval_requests',
  ApprovalStep: 'approval_steps',
  AiApprovalRequest: 'ai_approval_requests',
  IdempotencyKey: 'idempotency_keys',
};

const PRISMA_WRITE_OPS = new Set([
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

const NESTED_PRISMA_WRITE_OPS = new Set([
  ...PRISMA_WRITE_OPS,
  'connectOrCreate',
  'set',
]);

const NESTED_RELATION_TO_MODEL: Record<string, ApprovalModelName> = {
  aiApprovalItems: 'AiApprovalItem',
  aiApprovalResolutions: 'AiApprovalItem',
  approvalRequest: 'ApprovalRequest',
  approvalRequests: 'ApprovalRequest',
  aiApprovalRequests: 'AiApprovalRequest',
};

const CALL_PROXY_METHODS = new Set(['call', 'apply', 'bind']);

const FLOW_CONFIRM_IDENTIFIERS = [
  'flowConfirmationKey',
  'FLOW_CONFIRMATION_KEY_PREFIX',
  'flow-confirm:',
  'flow_confirmation',
];

interface DiscoveredWriter {
  model: ApprovalModelName;
  file: string;
  method: string;
  operation: string;
  line: number;
}

interface LexicalScope {
  constStrings: Map<string, string>;
  delegateAliases: Map<string, string>;
  methodAliases: Map<string, { delegate: string; op: string }>;
}

function lookupString(scopes: readonly LexicalScope[], name: string): string | null {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const v = scopes[i].constStrings.get(name);
    if (v !== undefined) return v;
  }
  return null;
}

function lookupDelegateAlias(scopes: readonly LexicalScope[], name: string): string | null {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const v = scopes[i].delegateAliases.get(name);
    if (v !== undefined) return v;
  }
  return null;
}

function lookupMethodAlias(
  scopes: readonly LexicalScope[],
  name: string,
): { delegate: string; op: string } | null {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const v = scopes[i].methodAliases.get(name);
    if (v !== undefined) return v;
  }
  return null;
}

function walkServerTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkServerTsFiles(full, out);
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.d.ts') &&
      path.relative(REPO_ROOT, full).replace(/\\/g, '/') !== SELF_REGISTRY_REL
    ) {
      out.push(full);
    }
  }
  return out.sort();
}

function unwrapExpr(node: ts.Expression): ts.Expression {
  let cur: ts.Expression = node;
  while (true) {
    if (
      ts.isParenthesizedExpression(cur) ||
      ts.isAsExpression(cur) ||
      ts.isSatisfiesExpression(cur) ||
      ts.isNonNullExpression(cur) ||
      ts.isTypeAssertionExpression(cur)
    ) {
      cur = cur.expression;
      continue;
    }
    break;
  }
  return cur;
}

function staticStringValue(node: ts.Expression, scopes: readonly LexicalScope[]): string | null {
  const u = unwrapExpr(node);
  if (ts.isStringLiteral(u) || ts.isNoSubstitutionTemplateLiteral(u)) {
    return u.text;
  }
  if (ts.isIdentifier(u)) {
    return lookupString(scopes, u.text);
  }
  if (ts.isBinaryExpression(u) && u.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticStringValue(u.left, scopes);
    const right = staticStringValue(u.right, scopes);
    if (left !== null && right !== null) return left + right;
  }
  if (ts.isTemplateExpression(u)) {
    let acc = u.head.text;
    for (const span of u.templateSpans) {
      const part = staticStringValue(span.expression, scopes);
      if (part === null) return null;
      acc += part + span.literal.text;
    }
    return acc;
  }
  return null;
}

function propertyNameText(name: ts.PropertyName, scopes: readonly LexicalScope[]): string | null {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return staticStringValue(name.expression, scopes);
  return null;
}

function memberAccessParts(
  node: ts.Expression,
  scopes: readonly LexicalScope[],
): { receiver: ts.Expression; prop: string } | null {
  const u = unwrapExpr(node);
  if (ts.isPropertyAccessExpression(u)) {
    return { receiver: u.expression, prop: u.name.text };
  }
  if (ts.isElementAccessExpression(u) && u.argumentExpression) {
    const prop = staticStringValue(u.argumentExpression, scopes);
    if (prop !== null) return { receiver: u.expression, prop };
  }
  return null;
}

function enclosingMethodName(node: ts.Node, sf: ts.SourceFile): string {
  // Prefer the enclosing class method so inner helper arrows (like `transition`
  // inside `claimFlowConfirmation`) attribute to their owning method.
  let cur: ts.Node | undefined = node.parent;
  let fallback: string | null = null;
  while (cur) {
    if (
      ts.isMethodDeclaration(cur) ||
      ts.isGetAccessorDeclaration(cur) ||
      ts.isSetAccessorDeclaration(cur) ||
      ts.isConstructorDeclaration(cur)
    ) {
      if (ts.isConstructorDeclaration(cur)) return 'constructor';
      return cur.name ? cur.name.getText(sf) : '<anonymous>';
    }
    if (ts.isFunctionDeclaration(cur) && cur.name && !fallback) {
      fallback = cur.name.text;
    } else if ((ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) && cur.parent && !fallback) {
      if (ts.isVariableDeclaration(cur.parent) && ts.isIdentifier(cur.parent.name)) {
        fallback = cur.parent.name.text;
      } else if (ts.isPropertyAssignment(cur.parent) || ts.isPropertyDeclaration(cur.parent)) {
        fallback = cur.parent.name.getText(sf);
      }
    }
    cur = cur.parent;
  }
  return fallback ?? '<module>';
}

function enclosingMethodNode(node: ts.Node, sf: ts.SourceFile): ts.Node {
  let cur: ts.Node | undefined = node.parent;
  let fallback: ts.Node | null = null;
  while (cur) {
    if (
      ts.isMethodDeclaration(cur) ||
      ts.isGetAccessorDeclaration(cur) ||
      ts.isSetAccessorDeclaration(cur) ||
      ts.isConstructorDeclaration(cur)
    ) {
      return cur;
    }
    if (ts.isFunctionDeclaration(cur) && !fallback) {
      fallback = cur;
    } else if ((ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) && cur.parent && !fallback) {
      if (
        ts.isVariableDeclaration(cur.parent) ||
        ts.isPropertyAssignment(cur.parent) ||
        ts.isPropertyDeclaration(cur.parent)
      ) {
        fallback = cur;
      }
    }
    cur = cur.parent;
  }
  return fallback ?? sf;
}

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

function buildSqlDmlRegex(table: string): RegExp {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const schemaPrefix = `(?:(?:"[a-z_][a-z0-9_]*"|\`[a-z_][a-z0-9_]*\`|[a-z_][a-z0-9_]*)\\.)?`;
  const tableIdent = `(?:${schemaPrefix}(?:"${escaped}"|\`${escaped}\`|\\b${escaped}\\b))`;
  return new RegExp(
    `\\b(?:INSERT\\s+INTO|UPDATE(?:\\s+ONLY)?|DELETE\\s+FROM(?:\\s+ONLY)?|MERGE\\s+INTO|TRUNCATE(?:\\s+TABLE)?(?:\\s+ONLY)?)\\s+${tableIdent}`,
    'i',
  );
}

const TABLE_DML_REGEXES: Array<[ApprovalModelName, RegExp]> = Object.entries(TABLE_TO_MODEL).map(
  ([table, model]) => [model, buildSqlDmlRegex(table)],
);
const IDEMPOTENCY_KEYS_DML_RE = buildSqlDmlRegex('idempotency_keys');

function sqlWriteModelsInString(
  rawText: string,
  getIncludeFlowIdempotencyKeys: () => boolean,
): ApprovalModelName[] {
  const cleaned = stripSqlComments(rawText);
  const found = new Set<ApprovalModelName>();
  for (const [model, dmlRe] of TABLE_DML_REGEXES) {
    if (dmlRe.test(cleaned)) {
      found.add(model);
    }
  }
  if (
    IDEMPOTENCY_KEYS_DML_RE.test(cleaned) &&
    (FLOW_CONFIRM_IDENTIFIERS.some((needle) => cleaned.includes(needle)) ||
      getIncludeFlowIdempotencyKeys())
  ) {
    found.add('IdempotencyKey');
  }
  return [...found];
}

function collectNestedApprovalWrites(
  expr: ts.Expression,
  parentDelegate: string | null,
  getInFlowConfirmScope: () => boolean,
  scopes: readonly LexicalScope[],
): Array<{ model: ApprovalModelName; op: string }> {
  const results: Array<{ model: ApprovalModelName; op: string }> = [];

  function inspectNestedObj(
    relName: string,
    targetModel: ApprovalModelName,
    obj: ts.ObjectLiteralExpression,
  ) {
    for (const p of obj.properties) {
      let opName: string | null = null;
      if (ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p)) {
        opName = propertyNameText(p.name, scopes);
      } else if (ts.isShorthandPropertyAssignment(p)) {
        opName = p.name.text;
      }
      if (opName && NESTED_PRISMA_WRITE_OPS.has(opName)) {
        results.push({ model: targetModel, op: `nested:${relName}.${opName}` });
      }
    }
  }

  function scanObj(node: ts.Node) {
    if (ts.isJSDoc(node)) return;
    if (ts.isPropertyAssignment(node)) {
      const relName = propertyNameText(node.name, scopes);
      const val = unwrapExpr(node.initializer);
      if (relName && ts.isObjectLiteralExpression(val)) {
        if (relName === 'steps' && parentDelegate === 'approvalRequest') {
          inspectNestedObj(relName, 'ApprovalStep', val);
        } else if (relName in NESTED_RELATION_TO_MODEL) {
          inspectNestedObj(relName, NESTED_RELATION_TO_MODEL[relName], val);
        } else if (relName === 'idempotencyKeys' && getInFlowConfirmScope()) {
          inspectNestedObj(relName, 'IdempotencyKey', val);
        }
      }
    }
    ts.forEachChild(node, scanObj);
  }
  scanObj(expr);
  return results;
}

function methodLooksLikeFlowConfirmation(
  node: ts.Node,
  sf: ts.SourceFile,
  scopes: readonly LexicalScope[],
): boolean {
  const owner = enclosingMethodNode(node, sf);
  let found = false;
  function scanTokens(n: ts.Node) {
    if (found || ts.isJSDoc(n)) return;
    if (ts.isIdentifier(n) && FLOW_CONFIRM_IDENTIFIERS.includes(n.text)) {
      found = true;
      return;
    }
    if (
      (ts.isStringLiteral(n) ||
        ts.isNoSubstitutionTemplateLiteral(n) ||
        ts.isTemplateHead(n) ||
        ts.isTemplateMiddle(n) ||
        ts.isTemplateTail(n)) &&
      FLOW_CONFIRM_IDENTIFIERS.some((needle) => n.text.includes(needle))
    ) {
      found = true;
      return;
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const folded = staticStringValue(n, scopes);
      if (folded !== null && FLOW_CONFIRM_IDENTIFIERS.some((needle) => folded.includes(needle))) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, scanTokens);
  }
  scanTokens(owner);
  return found;
}

function scanSourceForApprovalWriters(sourceText: string, relFile: string): {
  writers: DiscoveredWriter[];
  aiApprovalRequestCodeRefs: number[];
} {
  const sf = ts.createSourceFile(relFile, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const writers: DiscoveredWriter[] = [];
  const scopes: LexicalScope[] = [];

  const pushScope = () =>
    scopes.push({
      constStrings: new Map(),
      delegateAliases: new Map(),
      methodAliases: new Map(),
    });
  const popScope = () => scopes.pop();

  function resolveDelegateName(expr: ts.Expression): string | null {
    const u = unwrapExpr(expr);
    if (ts.isIdentifier(u)) {
      return lookupDelegateAlias(scopes, u.text);
    }
    const parts = memberAccessParts(u, scopes);
    if (parts && (parts.prop in DELEGATE_TO_MODEL || parts.prop === 'idempotencyKey')) {
      return parts.prop;
    }
    return null;
  }

  function record(model: ApprovalModelName, node: ts.Node, operation: string) {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    writers.push({
      model,
      file: relFile,
      method: enclosingMethodName(node, sf),
      operation,
      line,
    });
  }

  function resolveWriteCall(
    node: ts.CallExpression,
  ): { delegate: string | null; op: string | null; rawDelegateProp: string | null } {
    const expr = unwrapExpr(node.expression);

    // Reflect.apply(targetFn, thisArg, args)
    const directCallee = memberAccessParts(expr, scopes);
    if (
      directCallee &&
      directCallee.prop === 'apply' &&
      ts.isIdentifier(unwrapExpr(directCallee.receiver)) &&
      (unwrapExpr(directCallee.receiver) as ts.Identifier).text === 'Reflect' &&
      node.arguments.length >= 1
    ) {
      const target = unwrapExpr(node.arguments[0]);
      if (ts.isIdentifier(target)) {
        const aliased = lookupMethodAlias(scopes, target.text);
        if (aliased) return { delegate: aliased.delegate, op: aliased.op, rawDelegateProp: aliased.delegate };
      }
      const targetParts = memberAccessParts(target, scopes);
      if (targetParts && PRISMA_WRITE_OPS.has(targetParts.prop)) {
        const delegate = resolveDelegateName(targetParts.receiver);
        const recvParts = memberAccessParts(targetParts.receiver, scopes);
        return { delegate, op: targetParts.prop, rawDelegateProp: delegate ?? recvParts?.prop ?? null };
      }
      return { delegate: null, op: null, rawDelegateProp: null };
    }

    // Bare identifier calling an extracted write-method alias: `const fn = prisma.aiApprovalItem.create; fn(...)`
    if (ts.isIdentifier(expr)) {
      const aliased = lookupMethodAlias(scopes, expr.text);
      if (aliased) {
        return { delegate: aliased.delegate, op: aliased.op, rawDelegateProp: aliased.delegate };
      }
      return { delegate: null, op: null, rawDelegateProp: null };
    }

    let callee = directCallee;
    // Unwrap `.call(...)`, `.apply(...)`, `.bind(...)`
    if (callee && CALL_PROXY_METHODS.has(callee.prop)) {
      const recv = unwrapExpr(callee.receiver);
      if (ts.isIdentifier(recv)) {
        const aliased = lookupMethodAlias(scopes, recv.text);
        if (aliased) {
          return { delegate: aliased.delegate, op: aliased.op, rawDelegateProp: aliased.delegate };
        }
      }
      callee = memberAccessParts(callee.receiver, scopes);
    }

    if (callee && PRISMA_WRITE_OPS.has(callee.prop)) {
      const delegate = resolveDelegateName(callee.receiver);
      const recvParts = memberAccessParts(callee.receiver, scopes);
      return {
        delegate,
        op: callee.prop,
        rawDelegateProp: delegate ?? recvParts?.prop ?? null,
      };
    }

    return { delegate: null, op: null, rawDelegateProp: null };
  }

  function registerDeclarations(node: ts.VariableDeclaration) {
    const curScope = scopes[scopes.length - 1];
    if (!node.initializer) return;
    const init = unwrapExpr(node.initializer);

    if (ts.isIdentifier(node.name)) {
      const name = node.name.text;
      // 1. Static string const
      const strVal = staticStringValue(init, scopes);
      if (strVal !== null) {
        curScope.constStrings.set(name, strVal);
        return;
      }
      // 2. Transitive delegate alias: `const b = a` or `const store = this.prisma.client.aiApprovalItem`
      const resolvedDelegate = resolveDelegateName(init);
      if (resolvedDelegate) {
        curScope.delegateAliases.set(name, resolvedDelegate);
        return;
      }
      // 3. Extracted write-method alias: `const fn = prisma.aiApprovalItem.create`
      const parts = memberAccessParts(init, scopes);
      if (parts && PRISMA_WRITE_OPS.has(parts.prop)) {
        const deg = resolveDelegateName(parts.receiver);
        if (deg) {
          curScope.methodAliases.set(name, { delegate: deg, op: parts.prop });
        }
      }
    } else if (ts.isObjectBindingPattern(node.name)) {
      // Case A: Destructuring write methods from a delegate: `const { create, update: upd } = prisma.aiApprovalItem`
      const initDelegate = resolveDelegateName(init);
      if (initDelegate) {
        for (const el of node.name.elements) {
          if (!ts.isIdentifier(el.name)) continue;
          const propName = el.propertyName ? propertyNameText(el.propertyName, scopes) : el.name.text;
          if (propName && PRISMA_WRITE_OPS.has(propName)) {
            curScope.methodAliases.set(el.name.text, { delegate: initDelegate, op: propName });
          }
        }
        return;
      }
      // Case B: Destructuring delegates from a client: `const { aiApprovalItem: a } = tx`
      for (const el of node.name.elements) {
        if (!ts.isIdentifier(el.name)) continue;
        const propName = el.propertyName ? propertyNameText(el.propertyName, scopes) : el.name.text;
        if (propName && (propName in DELEGATE_TO_MODEL || propName === 'idempotencyKey')) {
          curScope.delegateAliases.set(el.name.text, propName);
        }
      }
    }
  }

  function visit(node: ts.Node) {
    if (ts.isJSDoc(node)) return;

    const createsScope =
      ts.isSourceFile(node) ||
      ts.isBlock(node) ||
      ts.isFunctionLike(node) ||
      ts.isClassLike(node) ||
      ts.isModuleBlock(node);
    if (createsScope) pushScope();

    try {
      if (ts.isVariableDeclaration(node)) {
        registerDeclarations(node);
      }

      if (ts.isCallExpression(node)) {
        const { delegate, op, rawDelegateProp } = resolveWriteCall(node);
        let flowConfirmCache: boolean | undefined;
        const getInFlowConfirm = () => {
          if (flowConfirmCache === undefined) {
            flowConfirmCache = methodLooksLikeFlowConfirmation(node, sf, scopes);
          }
          return flowConfirmCache;
        };

        if (op) {
          if (delegate && delegate in DELEGATE_TO_MODEL) {
            record(DELEGATE_TO_MODEL[delegate], node, op);
          } else if (delegate === 'idempotencyKey' && getInFlowConfirm()) {
            record('IdempotencyKey', node, op);
          }

          // Inspect nested relation writes on ANY Prisma write call (e.g., business.update,
          // user.update, approvalRequest.create, approvalStep.update).
          const payloadArg =
            node.arguments.length >= 3 &&
            memberAccessParts(unwrapExpr(node.expression), scopes)?.prop === 'apply'
              ? node.arguments[2]
              : node.arguments[0];
          if (payloadArg) {
            const nestedWrites = collectNestedApprovalWrites(
              payloadArg,
              rawDelegateProp,
              getInFlowConfirm,
              scopes,
            );
            for (const nw of nestedWrites) {
              record(nw.model, node, nw.op);
            }
          }
        }

        // Raw SQL writes via $executeRaw / $executeRawUnsafe / $queryRaw / $queryRawUnsafe / Prisma.raw
        const callee = memberAccessParts(node.expression, scopes);
        if (
          callee &&
          (callee.prop === '$executeRaw' ||
            callee.prop === '$executeRawUnsafe' ||
            callee.prop === '$queryRaw' ||
            callee.prop === '$queryRawUnsafe' ||
            callee.prop === 'raw')
        ) {
          const rawText = node.arguments
            .map((a) => staticStringValue(a, scopes) ?? a.getText(sf))
            .join(' ');
          for (const model of sqlWriteModelsInString(rawText, getInFlowConfirm)) {
            record(model, node, `rawSql:${callee.prop}`);
          }
        }
      }

      // Tagged template SQL: tx.$executeRaw`UPDATE ai_approval_items ...`
      if (ts.isTaggedTemplateExpression(node)) {
        const tag = memberAccessParts(node.tag, scopes);
        if (
          tag &&
          (tag.prop === '$executeRaw' ||
            tag.prop === '$executeRawUnsafe' ||
            tag.prop === '$queryRaw' ||
            tag.prop === '$queryRawUnsafe' ||
            tag.prop === 'sql')
        ) {
          const rawText = node.template.getText(sf);
          for (const model of sqlWriteModelsInString(rawText, () =>
            methodLooksLikeFlowConfirmation(node, sf, scopes),
          )) {
            record(model, node, `rawSql:${tag.prop}`);
          }
        }
      }

      ts.forEachChild(node, visit);
    } finally {
      if (createsScope) popScope();
    }
  }
  visit(sf);

  // Scan AST code tokens only (comments/JSDoc excluded automatically) for any
  // live reference to dormant AiApprovalRequest / aiApprovalRequest(s) / ai_approval_requests.
  const aiApprovalRequestCodeRefs: number[] = [];
  function scanDormantRefs(node: ts.Node) {
    if (ts.isJSDoc(node)) return;
    if (
      (ts.isIdentifier(node) &&
        (node.text === 'AiApprovalRequest' ||
          node.text === 'aiApprovalRequest' ||
          node.text === 'aiApprovalRequests')) ||
      ((ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
        /\b(?:AiApprovalRequest|aiApprovalRequests?|ai_approval_requests)\b/.test(node.text))
    ) {
      aiApprovalRequestCodeRefs.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1);
    }
    ts.forEachChild(node, scanDormantRefs);
  }
  scanDormantRefs(sf);

  return { writers, aiApprovalRequestCodeRefs };
}

function writerKey(entry: { file: string; method: string; model: ApprovalModelName }): string {
  return `${entry.file}#${entry.method}::${entry.model}`;
}

function evaluateRegistryAgainstWriters(
  discovered: readonly DiscoveredWriter[],
  registry: readonly ApprovalModelWriterEntry[],
): {
  unregistered: string[];
  stale: string[];
  duplicates: string[];
} {
  const discoveredKeys = new Map<string, DiscoveredWriter[]>();
  for (const w of discovered) {
    const k = writerKey(w);
    const list = discoveredKeys.get(k) ?? [];
    list.push(w);
    discoveredKeys.set(k, list);
  }

  const registeredKeys = new Set<string>();
  const duplicates: string[] = [];
  for (const r of registry) {
    if (r.kind === 'dormant') continue;
    const k = writerKey(r);
    if (registeredKeys.has(k)) duplicates.push(k);
    registeredKeys.add(k);
  }

  const unregistered: string[] = [];
  for (const [k, hits] of discoveredKeys.entries()) {
    if (!registeredKeys.has(k)) {
      const ops = hits.map((h) => `${h.operation}@L${h.line}`).join(', ');
      unregistered.push(`${k} [${ops}]`);
    }
  }

  const stale: string[] = [];
  for (const k of registeredKeys) {
    if (!discoveredKeys.has(k)) {
      stale.push(k);
    }
  }

  return {
    unregistered: unregistered.sort(),
    stale: stale.sort(),
    duplicates: duplicates.sort(),
  };
}

describe('RR-APPROVAL-MODEL-CENSUS — approval writer registry', () => {
  it('verifies all approval-shaped Prisma models and @@map tables exist in schema.prisma (read-only)', () => {
    const schemaSrc = fs.readFileSync(SCHEMA_PATH, 'utf8');
    for (const [modelName, expectedTable] of Object.entries(EXPECTED_SCHEMA_MAPS)) {
      const blockRe = new RegExp(`^model\\s+${modelName}\\s*\\{[\\s\\S]*?^\\}`, 'm');
      const match = schemaSrc.match(blockRe);
      expect(match, `Prisma model ${modelName} must exist in schema.prisma`).not.toBeNull();
      expect(
        match![0],
        `Prisma model ${modelName} must map to "${expectedTable}"`,
      ).toContain(`@@map("${expectedTable}")`);
    }
  });

  it('registers every live approval writer with complete metadata and keeps AiApprovalRequest dormant', () => {
    const files = walkServerTsFiles(SERVER_SRC_DIR);
    const allWriters: DiscoveredWriter[] = [];
    const dormantRefs: string[] = [];

    for (const absFile of files) {
      const relFile = path.relative(REPO_ROOT, absFile).replace(/\\/g, '/');
      const src = fs.readFileSync(absFile, 'utf8');
      const { writers, aiApprovalRequestCodeRefs } = scanSourceForApprovalWriters(src, relFile);
      allWriters.push(...writers);
      for (const line of aiApprovalRequestCodeRefs) {
        dormantRefs.push(`${relFile}:${line}`);
      }
    }

    // AiApprovalRequest must remain dormant (zero live code references).
    expect(dormantRefs, 'AiApprovalRequest must have zero live code references').toEqual([]);

    const diff = evaluateRegistryAgainstWriters(allWriters, APPROVAL_MODEL_WRITERS);
    expect(diff.duplicates, 'Duplicate approval-model registry entries').toEqual([]);
    expect(diff.unregistered, 'Unregistered approval writers discovered in apps/server/src').toEqual([]);
    expect(diff.stale, 'Stale approval-model registry entries with no matching live writer').toEqual([]);

    const dormantEntry = APPROVAL_MODEL_WRITERS.find((e) => e.model === 'AiApprovalRequest');
    expect(dormantEntry, 'AiApprovalRequest must be registered as dormant').toBeDefined();
    expect(dormantEntry?.kind).toBe('dormant');

    // Every registered entry must carry complete, non-empty governance metadata.
    for (const entry of APPROVAL_MODEL_WRITERS) {
      expect(entry.gatedEffect.trim().length, `${writerKey(entry)} missing gatedEffect`).toBeGreaterThan(0);
      expect(entry.executionSite.trim().length, `${writerKey(entry)} missing executionSite`).toBeGreaterThan(0);
      expect(entry.clearerScope.trim().length, `${writerKey(entry)} missing clearerScope`).toBeGreaterThan(0);
      expect(entry.manualPath.trim().length, `${writerKey(entry)} missing manualPath`).toBeGreaterThan(0);
      if (entry.effectRunsWithoutApproval) {
        expect(
          entry.bypassNote?.trim().length ?? 0,
          `${writerKey(entry)} sets effectRunsWithoutApproval=true without bypassNote`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('negative controls: detects unregistered Prisma, aliased, Reflect.apply, nested, raw-SQL, Flow-confirm, arrow, and dormant writers', () => {
    // 1. DoD RED fixture: unregistered prisma.aiApprovalItem.create
    const fixtureCreate = `
      class RogueService {
        async sneak(prisma: any, businessId: string) {
          await prisma.aiApprovalItem.create({ data: { businessId, toolName: 'rogue' } });
        }
      }
    `;
    const r1 = scanSourceForApprovalWriters(fixtureCreate, 'apps/server/src/modules/rogue/rogue.service.ts');
    const diff1 = evaluateRegistryAgainstWriters(r1.writers, APPROVAL_MODEL_WRITERS);
    expect(diff1.unregistered).toEqual([
      'apps/server/src/modules/rogue/rogue.service.ts#sneak::AiApprovalItem [create@L4]',
    ]);

    // 2. Comprehensive bypass negative controls (transitive alias, extracted method, destructured op,
    //    const bracket op, Reflect.apply, nested Business/ApprovalStep writes, concatenated & var raw SQL,
    //    raw SQL Flow confirm on idempotency_keys, top-level arrow Flow confirm, plural aiApprovalRequests,
    //    and lexical-scope isolation proving a same-named Map in another method does NOT false-positive).
    const fixtureTricks = `
      const topLevelFlowBind = async (prisma: any) => {
        const prefix = 'flow-' + 'confirm:';
        await prisma.client.idempotencyKey.create({ data: { idempotencyKey: prefix + 'abc' } });
      };
      class TrickyService {
        async aliasWrite(prisma: any) {
          const store = prisma.client.keyActionProposal;
          const alias2 = store;
          await alias2.updateMany({ where: {}, data: {} });
        }
        async unrelatedMapScope() {
          const store = new Map<string, string>();
          store.delete('unrelated');
        }
        async extractedMethod(prisma: any) {
          const fn = prisma.client.aiApprovalItem.create;
          await fn({ data: {} });
        }
        async destructuredOp(prisma: any) {
          const { update } = prisma.client.approvalRequest;
          await update({ where: { id: '1' }, data: {} });
        }
        async constBracketOp(prisma: any) {
          const op = 'create';
          await prisma.client.aiApprovalItem[op]({ data: {} });
        }
        async reflectApplyWrite(prisma: any) {
          await Reflect.apply(prisma.client.aiApprovalItem.create, prisma.client.aiApprovalItem, [{ data: {} }]);
        }
        async nestedBusinessWrites(prisma: any) {
          await prisma.client.business.update({
            where: { id: 'b1' },
            data: {
              aiApprovalItems: { connectOrCreate: [] },
              aiApprovalRequests: { create: [] },
            },
          });
        }
        async nestedStepParent(prisma: any) {
          await prisma.client.approvalStep.update({
            where: { id: 's1' },
            data: { approvalRequest: { update: { status: 'approved' } } },
          });
        }
        async rawSqlConcatAndVar(tx: any) {
          await tx.$executeRawUnsafe('UPDATE ' + '"ai_approval_items" SET status = 1');
          const q = "DELETE FROM approval_requests WHERE id = 'x'";
          await tx.$executeRawUnsafe(q);
        }
        async rawSqlFlowConfirm(tx: any) {
          await tx.$executeRaw\`INSERT INTO idempotency_keys (idempotency_key) VALUES ('flow-confirm:z')\`;
        }
      }
    `;
    const r2 = scanSourceForApprovalWriters(fixtureTricks, 'apps/server/src/modules/rogue/tricky.service.ts');
    const keys2 = r2.writers.map((w) => writerKey(w));
    expect(keys2).toContain('apps/server/src/modules/rogue/tricky.service.ts#topLevelFlowBind::IdempotencyKey');
    expect(keys2).toContain('apps/server/src/modules/rogue/tricky.service.ts#aliasWrite::KeyActionProposal');
    expect(keys2).not.toContain('apps/server/src/modules/rogue/tricky.service.ts#unrelatedMapScope::KeyActionProposal');
    expect(keys2).toContain('apps/server/src/modules/rogue/tricky.service.ts#extractedMethod::AiApprovalItem');
    expect(keys2).toContain('apps/server/src/modules/rogue/tricky.service.ts#destructuredOp::ApprovalRequest');
    expect(keys2).toContain('apps/server/src/modules/rogue/tricky.service.ts#constBracketOp::AiApprovalItem');
    expect(keys2).toContain('apps/server/src/modules/rogue/tricky.service.ts#reflectApplyWrite::AiApprovalItem');
    expect(keys2).toContain('apps/server/src/modules/rogue/tricky.service.ts#nestedBusinessWrites::AiApprovalItem');
    expect(keys2).toContain('apps/server/src/modules/rogue/tricky.service.ts#nestedBusinessWrites::AiApprovalRequest');
    expect(keys2).toContain('apps/server/src/modules/rogue/tricky.service.ts#nestedStepParent::ApprovalRequest');
    expect(keys2).toContain('apps/server/src/modules/rogue/tricky.service.ts#rawSqlConcatAndVar::AiApprovalItem');
    expect(keys2).toContain('apps/server/src/modules/rogue/tricky.service.ts#rawSqlConcatAndVar::ApprovalRequest');
    expect(keys2).toContain('apps/server/src/modules/rogue/tricky.service.ts#rawSqlFlowConfirm::IdempotencyKey');
    // Plural `aiApprovalRequests` must ALSO trip the dormant-ref gate
    expect(r2.aiApprovalRequestCodeRefs.length).toBeGreaterThan(0);

    // 3. DoD negative control: scanning the real source file on disk with a registry row removed fails the census
    const nonDormant = APPROVAL_MODEL_WRITERS.filter((e) => e.kind !== 'dormant');
    expect(nonDormant.length).toBeGreaterThan(0);
    const removed = nonDormant[0];
    const withoutOne = APPROVAL_MODEL_WRITERS.filter((e) => e !== removed);
    const realFileSrc = fs.readFileSync(path.join(REPO_ROOT, removed.file), 'utf8');
    const scannedReal = scanSourceForApprovalWriters(realFileSrc, removed.file);
    const diffRemoved = evaluateRegistryAgainstWriters(scannedReal.writers, withoutOne);
    expect(diffRemoved.unregistered.some((u) => u.startsWith(writerKey(removed)))).toBe(true);
  });
});
