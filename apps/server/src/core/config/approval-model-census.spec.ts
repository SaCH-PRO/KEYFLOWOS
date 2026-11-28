/**
 * RR-APPROVAL-MODEL-CENSUS (D-261, D-262, D-17, D-226, D-238, D-103)
 *
 * REC-ONE-APPROVAL-MODEL, first slice only (read-only static census).
 *
 * Scans `apps/server/src` via TypeScript AST for every Prisma write
 * (create/createMany/createManyAndReturn/update/updateMany/updateManyAndReturn/
 * upsert/delete/deleteMany), nested relation write, raw SQL DML write, and
 * Flow-bound IdempotencyKey confirmation write across the five approval-shaped
 * stores:
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

export type ApprovalModelName =
  | 'KeyActionProposal'
  | 'AiApprovalItem'
  | 'ApprovalRequest'
  | 'ApprovalStep'
  | 'AiApprovalRequest'
  | 'IdempotencyKey';

export type ApprovalWriterKind =
  | 'KEY action proposal'
  | 'KEY approval queue'
  | 'human workflow approval'
  | 'Flow confirmation'
  | 'dormant';

export interface ApprovalModelWriterEntry {
  model: ApprovalModelName;
  file: string;
  method: string;
  kind: ApprovalWriterKind;
  gatedEffect: string;
  executionSite: string;
  clearerScope: string;
  manualPath: string;
  /**
   * True when an effect can run without the approval row this writer creates or
   * when this writer commits/clears without enforcing prior approval.
   */
  effectRunsWithoutApproval: boolean;
  bypassNote?: string;
}

// RED baseline: empty registry — must fail against live writers on main until populated.
const APPROVAL_MODEL_WRITERS: readonly ApprovalModelWriterEntry[] = [];

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SERVER_SRC_DIR = path.join(REPO_ROOT, 'apps/server/src');
const SCHEMA_PATH = path.join(REPO_ROOT, 'packages/db/prisma/schema.prisma');

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

function walkServerTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkServerTsFiles(full, out);
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.d.ts')
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

function staticStringValue(node: ts.Expression): string | null {
  const u = unwrapExpr(node);
  if (ts.isStringLiteral(u) || ts.isNoSubstitutionTemplateLiteral(u)) {
    return u.text;
  }
  return null;
}

function memberAccessParts(node: ts.Expression): { receiver: ts.Expression; prop: string } | null {
  const u = unwrapExpr(node);
  if (ts.isPropertyAccessExpression(u)) {
    return { receiver: u.expression, prop: u.name.text };
  }
  if (ts.isElementAccessExpression(u) && u.argumentExpression) {
    const prop = staticStringValue(u.argumentExpression);
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
      } else if (ts.isPropertyAssignment(cur.parent)) {
        fallback = cur.parent.name.getText(sf);
      }
    }
    cur = cur.parent;
  }
  return fallback ?? '<module>';
}

function enclosingMethodNode(node: ts.Node): ts.Node | null {
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
    }
    cur = cur.parent;
  }
  return fallback;
}

function stripTsComments(sourceText: string, filePath: string): string {
  const sf = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const ranges: Array<{ pos: number; end: number }> = [];
  function visit(node: ts.Node) {
    if (ts.isJSDoc(node)) return;
    if (node.getChildCount(sf) === 0) {
      const start = node.getStart(sf, false);
      if (node.pos < start) {
        const trivia = sourceText.slice(node.pos, start);
        if (trivia.includes('//') || trivia.includes('/*')) {
          ranges.push({ pos: node.pos, end: start });
        }
      }
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  if (ranges.length === 0) return sourceText;
  let out = '';
  let cursor = 0;
  for (const r of ranges) {
    if (r.pos < cursor) continue;
    out += sourceText.slice(cursor, r.pos);
    out += sourceText.slice(r.pos, r.end).replace(/[^\n]/g, ' ');
    cursor = r.end;
  }
  out += sourceText.slice(cursor);
  return out;
}

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

function sqlWriteModelsInString(rawText: string): ApprovalModelName[] {
  const cleaned = stripSqlComments(rawText);
  const found = new Set<ApprovalModelName>();
  for (const [table, model] of Object.entries(TABLE_TO_MODEL)) {
    const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ident = `(?:["\`]?[a-z_][a-z0-9_]*["\`]?\\.)?["\`]?${escaped}["\`]?`;
    const dmlRe = new RegExp(
      `\\b(?:INSERT\\s+INTO|UPDATE(?:\\s+ONLY)?|DELETE\\s+FROM(?:\\s+ONLY)?|MERGE\\s+INTO|TRUNCATE(?:\\s+TABLE)?(?:\\s+ONLY)?)\\s+${ident}\\b`,
      'i',
    );
    if (dmlRe.test(cleaned)) {
      found.add(model);
    }
  }
  return [...found];
}

function collectNestedStepWriteOps(expr: ts.Expression, sf: ts.SourceFile): string[] {
  const ops: string[] = [];
  function scanObj(node: ts.Node) {
    if (ts.isPropertyAssignment(node)) {
      const propName = ts.isIdentifier(node.name)
        ? node.name.text
        : ts.isStringLiteral(node.name)
          ? node.name.text
          : null;
      if (propName === 'steps' && ts.isObjectLiteralExpression(node.initializer)) {
        for (const p of node.initializer.properties) {
          if (ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p)) {
            const opName = p.name.getText(sf).replace(/^['"]|['"]$/g, '');
            if (PRISMA_WRITE_OPS.has(opName)) {
              ops.push(`nested:steps.${opName}`);
            }
          }
        }
      }
    }
    ts.forEachChild(node, scanObj);
  }
  scanObj(expr);
  return ops;
}

function methodLooksLikeFlowConfirmation(node: ts.Node, sf: ts.SourceFile): boolean {
  const owner = enclosingMethodNode(node);
  const text = owner ? stripTsComments(owner.getText(sf), sf.fileName) : '';
  return FLOW_CONFIRM_IDENTIFIERS.some((needle) => text.includes(needle));
}

function scanSourceForApprovalWriters(sourceText: string, relFile: string): {
  writers: DiscoveredWriter[];
  aiApprovalRequestCodeRefs: number[];
} {
  const sf = ts.createSourceFile(relFile, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const writers: DiscoveredWriter[] = [];

  // Map local variable aliases (const x = this.prisma.client.aiApprovalItem,
  // const { aiApprovalItem: a } = tx, const store = this.prisma.client.idempotencyKey)
  // to their delegate name.
  const delegateAliases = new Map<string, string>();

  function collectAliases(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = unwrapExpr(node.initializer);
      if (ts.isIdentifier(node.name)) {
        const parts = memberAccessParts(init);
        if (parts && (parts.prop in DELEGATE_TO_MODEL || parts.prop === 'idempotencyKey')) {
          delegateAliases.set(node.name.text, parts.prop);
        }
      } else if (ts.isObjectBindingPattern(node.name)) {
        for (const el of node.name.elements) {
          const propName = el.propertyName
            ? el.propertyName.getText(sf).replace(/^['"]|['"]$/g, '')
            : ts.isIdentifier(el.name)
              ? el.name.text
              : null;
          if (
            propName &&
            (propName in DELEGATE_TO_MODEL || propName === 'idempotencyKey') &&
            ts.isIdentifier(el.name)
          ) {
            delegateAliases.set(el.name.text, propName);
          }
        }
      }
    }
    ts.forEachChild(node, collectAliases);
  }
  collectAliases(sf);

  function resolveDelegateName(expr: ts.Expression): string | null {
    const u = unwrapExpr(expr);
    if (ts.isIdentifier(u)) {
      return delegateAliases.get(u.text) ?? null;
    }
    const parts = memberAccessParts(u);
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

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      let callee = memberAccessParts(node.expression);
      // Unwrap `.call(...)`, `.apply(...)`, `.bind(...)`
      if (callee && CALL_PROXY_METHODS.has(callee.prop)) {
        callee = memberAccessParts(callee.receiver);
      }

      if (callee && PRISMA_WRITE_OPS.has(callee.prop)) {
        const delegate = resolveDelegateName(callee.receiver);
        if (delegate && delegate in DELEGATE_TO_MODEL) {
          const model = DELEGATE_TO_MODEL[delegate];
          record(model, node, callee.prop);
          if (model === 'ApprovalRequest' && node.arguments.length > 0) {
            for (const nestedOp of collectNestedStepWriteOps(node.arguments[0], sf)) {
              record('ApprovalStep', node, nestedOp);
            }
          }
        } else if (delegate === 'idempotencyKey' && methodLooksLikeFlowConfirmation(node, sf)) {
          record('IdempotencyKey', node, callee.prop);
        }
      }

      // Raw SQL writes via $executeRaw / $executeRawUnsafe / $queryRaw / $queryRawUnsafe / Prisma.raw
      if (
        callee &&
        (callee.prop === '$executeRaw' ||
          callee.prop === '$executeRawUnsafe' ||
          callee.prop === '$queryRaw' ||
          callee.prop === '$queryRawUnsafe' ||
          callee.prop === 'raw')
      ) {
        const rawText = node.arguments.map((a) => a.getText(sf)).join(' ');
        for (const model of sqlWriteModelsInString(rawText)) {
          record(model, node, `rawSql:${callee.prop}`);
        }
      }
    }

    // Tagged template SQL: tx.$executeRaw`UPDATE ai_approval_items ...`
    if (ts.isTaggedTemplateExpression(node)) {
      const tag = memberAccessParts(node.tag);
      if (
        tag &&
        (tag.prop === '$executeRaw' ||
          tag.prop === '$executeRawUnsafe' ||
          tag.prop === '$queryRaw' ||
          tag.prop === '$queryRawUnsafe' ||
          tag.prop === 'sql')
      ) {
        const rawText = node.template.getText(sf);
        for (const model of sqlWriteModelsInString(rawText)) {
          record(model, node, `rawSql:${tag.prop}`);
        }
      }
    }

    ts.forEachChild(node, visit);
  }
  visit(sf);

  // Scan AST code tokens only (comments/JSDoc are excluded automatically) for
  // any live reference to dormant AiApprovalRequest / ai_approval_requests.
  const aiApprovalRequestCodeRefs: number[] = [];
  function scanDormantRefs(node: ts.Node) {
    if (ts.isJSDoc(node)) return;
    if (
      (ts.isIdentifier(node) &&
        (node.text === 'AiApprovalRequest' || node.text === 'aiApprovalRequest')) ||
      ((ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
        /\b(?:AiApprovalRequest|aiApprovalRequest|ai_approval_requests)\b/.test(node.text))
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

  it('negative controls: detects unregistered Prisma, aliased, nested, raw-SQL, Flow-confirm, and dormant writers', () => {
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

    // 2. Aliased delegate + nested ApprovalStep + raw SQL + Flow confirmation + dormant AiApprovalRequest
    const fixtureTricks = `
      class TrickyService {
        async aliasWrite(prisma: any) {
          const store = prisma.client.keyActionProposal;
          await store.updateMany({ where: {}, data: {} });
        }
        async nestedStep(prisma: any) {
          await prisma.client.approvalRequest.create({
            data: { steps: { create: [{ stepOrder: 0, approverId: 'u1' }] } },
          });
        }
        async rawWrite(tx: any) {
          await tx.$executeRaw\`UPDATE ai_approval_items SET status = 'approved'\`;
        }
        async bindFlow(prisma: any) {
          const key = 'flow-confirm:123';
          await prisma.client.idempotencyKey.create({ data: { idempotencyKey: key } });
        }
        async wakeDormant(prisma: any) {
          await prisma.client.aiApprovalRequest.create({ data: {} });
        }
      }
    `;
    const r2 = scanSourceForApprovalWriters(fixtureTricks, 'apps/server/src/modules/rogue/tricky.service.ts');
    const keys2 = r2.writers.map((w) => writerKey(w));
    expect(keys2).toContain('apps/server/src/modules/rogue/tricky.service.ts#aliasWrite::KeyActionProposal');
    expect(keys2).toContain('apps/server/src/modules/rogue/tricky.service.ts#nestedStep::ApprovalRequest');
    expect(keys2).toContain('apps/server/src/modules/rogue/tricky.service.ts#nestedStep::ApprovalStep');
    expect(keys2).toContain('apps/server/src/modules/rogue/tricky.service.ts#rawWrite::AiApprovalItem');
    expect(keys2).toContain('apps/server/src/modules/rogue/tricky.service.ts#bindFlow::IdempotencyKey');
    expect(keys2).toContain('apps/server/src/modules/rogue/tricky.service.ts#wakeDormant::AiApprovalRequest');
    expect(r2.aiApprovalRequestCodeRefs.length).toBeGreaterThan(0);

    // 3. DoD negative control: removing a registry row fails the census
    const nonDormant = APPROVAL_MODEL_WRITERS.filter((e) => e.kind !== 'dormant');
    expect(nonDormant.length).toBeGreaterThan(0);
    const removed = nonDormant[0];
    const withoutOne = APPROVAL_MODEL_WRITERS.filter((e) => e !== removed);
    const diffRemoved = evaluateRegistryAgainstWriters(
      [{ model: removed.model, file: removed.file, method: removed.method, operation: 'create', line: 1 }],
      withoutOne,
    );
    expect(diffRemoved.unregistered).toContain(`${writerKey(removed)} [create@L1]`);
  });
});
