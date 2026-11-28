import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import {
  COGNITIVE_RUNTIME_ENTRIES,
  type CognitiveAuthorityPath,
  type CognitiveEntrySignal,
  type CognitiveReachability,
  type CognitiveRuntimeEntry,
  type CognitiveRuntimeId,
} from './cognitive-runtime-registry';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SERVER_SRC_DIR = path.join(REPO_ROOT, 'apps/server/src');

const EXEMPT_FILES = new Set([
  'apps/server/src/modules/ai/model-gateway.service.ts',
  'apps/server/src/modules/key-cortex/cognitive-runtime-registry.ts',
]);

const SOURCE_FILE_EXT_RE = /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/;
const TEST_OR_DECL_EXT_RE =
  /\.(?:spec|test|e2e-spec)\.(?:[cm]?ts|tsx|[cm]?js|jsx)$|\.d\.[cm]?ts$/;

const VALID_RUNTIMES = new Set<CognitiveRuntimeId>([
  'flow-orchestrator',
  'cortex-consciousness',
  'cortex-reasoning',
  'cortex-query-pipeline',
  'intent-parser',
  'phone-voice-realtime',
]);
const VALID_REACHABILITY = new Set<CognitiveReachability>([
  'member',
  'memberless',
  'owner-only',
]);
const VALID_AUTHORITY = new Set<CognitiveAuthorityPath>([
  'Flow confirmation boundary',
  'Cortex autonomy orchestrator',
  'none (read-only)',
]);
const VALID_SIGNALS = new Set<CognitiveEntrySignal>([
  'flow-chat',
  'flow-stream-chat',
  'processConsciously',
  'processQuery',
  'model-tools-call',
]);

const MODEL_CALL_METHODS = new Set([
  'complete',
  'streamComplete',
  'create',
  'open',
  'connect',
  'openSession',
]);

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
    ts.isNonNullExpression(cur) ||
    ts.isAsExpression(cur) ||
    ts.isSatisfiesExpression(cur)
  ) {
    cur = cur.expression;
  }
  return cur;
}

function staticPropKey(node: ts.PropertyName | ts.Expression): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isComputedPropertyName(node)) {
    return staticPropKey(unwrapExpr(node.expression));
  }
  return null;
}

function memberAccessName(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  const arg = unwrapExpr(node.argumentExpression);
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
    return arg.text;
  }
  return null;
}

function typeNodeReferences(
  typeNode: ts.TypeNode | undefined,
  targetName: string,
): boolean {
  if (!typeNode) return false;
  let found = false;
  const walk = (n: ts.Node) => {
    if (found) return;
    if (ts.isIdentifier(n) && n.text === targetName) {
      found = true;
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(typeNode);
  return found;
}

function collectFlowOrchestratorReceivers(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const helperMethods = new Set<string>();

  const findHelpers = (node: ts.Node) => {
    if (ts.isJSDoc(node)) return;
    if (
      (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) &&
      node.name &&
      (typeNodeReferences(node.type, 'FlowOrchestratorService') ||
        (node.body && node.body.getText(sf).includes('FlowOrchestratorService')))
    ) {
      const name = ts.isIdentifier(node.name) ? node.name.text : staticPropKey(node.name);
      if (name) helperMethods.add(name);
    }
    ts.forEachChild(node, findHelpers);
  };
  findHelpers(sf);

  const walk = (node: ts.Node) => {
    if (ts.isJSDoc(node)) return;
    if (
      (ts.isParameter(node) || ts.isPropertyDeclaration(node)) &&
      ts.isIdentifier(node.name) &&
      typeNodeReferences(node.type, 'FlowOrchestratorService')
    ) {
      names.add(node.name.text);
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (typeNodeReferences(node.type, 'FlowOrchestratorService')) {
        names.add(node.name.text);
      } else if (node.initializer) {
        const init = unwrapExpr(node.initializer);
        if (ts.isCallExpression(init)) {
          const callee = unwrapExpr(init.expression);
          const calleeName = ts.isIdentifier(callee)
            ? callee.text
            : ts.isPropertyAccessExpression(callee)
              ? callee.name.text
              : null;
          if (
            (calleeName && helperMethods.has(calleeName)) ||
            init.arguments.some(
              (a) => ts.isIdentifier(a) && a.text === 'FlowOrchestratorService',
            )
          ) {
            names.add(node.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return names;
}

function receiverMatchesFlowOrchestrator(
  expr: ts.Expression,
  flowReceivers: ReadonlySet<string>,
): boolean {
  const u = unwrapExpr(expr);
  if (ts.isIdentifier(u)) return flowReceivers.has(u.text);
  if (ts.isPropertyAccessExpression(u)) {
    return flowReceivers.has(u.name.text);
  }
  return false;
}

function objectLiteralHasKeys(
  obj: ts.ObjectLiteralExpression,
  keys: ReadonlySet<string>,
): boolean {
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop)) {
      const k = staticPropKey(prop.name);
      if (k && keys.has(k)) return true;
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      if (keys.has(prop.name.text)) return true;
    }
  }
  return false;
}

export interface DiscoveredCognitiveEntry {
  file: string;
  method: string;
  signal: CognitiveEntrySignal;
}

const TOOL_CHOICE_KEYS = new Set(['toolChoice', 'tool_choice']);
const TOOLS_KEYS = new Set(['tools']);

export function scanCognitiveRuntimeEntries(
  source: string,
  relPath: string,
): DiscoveredCognitiveEntry[] {
  if (EXEMPT_FILES.has(relPath)) return [];
  const sf = ts.createSourceFile(
    relPath,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKindForPath(relPath),
  );
  const flowReceivers = collectFlowOrchestratorReceivers(sf);
  const hits = new Map<string, DiscoveredCognitiveEntry>();

  const add = (method: string, signal: CognitiveEntrySignal) => {
    const key = `${relPath}#${method}::${signal}`;
    hits.set(key, { file: relPath, method, signal });
  };

  const visit = (node: ts.Node, currentMethod: string) => {
    if (ts.isJSDoc(node)) return;

    let nextMethod = currentMethod;
    if (ts.isMethodDeclaration(node) && node.name) {
      nextMethod = staticPropKey(node.name) ?? currentMethod;
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      nextMethod = node.name.text;
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      nextMethod = node.name.text;
    }

    if (ts.isCallExpression(node)) {
      const callee = unwrapExpr(node.expression);
      let invokedMethod: string | null = null;
      let receiver: ts.Expression | null = null;

      if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
        const directName = memberAccessName(callee);
        if (
          (directName === 'call' || directName === 'apply' || directName === 'bind') &&
          (ts.isPropertyAccessExpression(unwrapExpr(callee.expression)) ||
            ts.isElementAccessExpression(unwrapExpr(callee.expression)))
        ) {
          const inner = unwrapExpr(callee.expression) as
            | ts.PropertyAccessExpression
            | ts.ElementAccessExpression;
          invokedMethod = memberAccessName(inner);
          receiver = inner.expression;
        } else {
          invokedMethod = directName;
          receiver = callee.expression;
        }
      }

      if (invokedMethod === 'processConsciously') {
        add(nextMethod, 'processConsciously');
      } else if (invokedMethod === 'processQuery') {
        add(nextMethod, 'processQuery');
      } else if (
        invokedMethod === 'streamChat' &&
        receiver &&
        receiverMatchesFlowOrchestrator(receiver, flowReceivers)
      ) {
        add(nextMethod, 'flow-stream-chat');
      } else if (
        invokedMethod === 'chat' &&
        receiver &&
        receiverMatchesFlowOrchestrator(receiver, flowReceivers)
      ) {
        add(nextMethod, 'flow-chat');
      }

      // Any model/realtime call passing `toolChoice`/`tool_choice` or passing `tools` to a model/bridge call
      const hasToolChoiceArg = node.arguments.some((arg) => {
        const u = unwrapExpr(arg);
        return ts.isObjectLiteralExpression(u) && objectLiteralHasKeys(u, TOOL_CHOICE_KEYS);
      });
      const hasToolsOnModelCall =
        invokedMethod !== null &&
        MODEL_CALL_METHODS.has(invokedMethod) &&
        node.arguments.some((arg) => {
          const u = unwrapExpr(arg);
          return ts.isObjectLiteralExpression(u) && objectLiteralHasKeys(u, TOOLS_KEYS);
        });

      if (hasToolChoiceArg || hasToolsOnModelCall) {
        add(nextMethod, 'model-tools-call');
      }
    }

    ts.forEachChild(node, (child) => visit(child, nextMethod));
  };
  visit(sf, '<module>');

  return [...hits.values()].sort((a, b) =>
    `${a.file}#${a.method}::${a.signal}`.localeCompare(
      `${b.file}#${b.method}::${b.signal}`,
    ),
  );
}

function walkSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkSourceFiles(full));
    } else if (
      entry.isFile() &&
      SOURCE_FILE_EXT_RE.test(entry.name) &&
      !TEST_OR_DECL_EXT_RE.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

export interface CognitiveRuntimeAuditResult {
  unregistered: DiscoveredCognitiveEntry[];
  staleEntries: string[];
  duplicateEntries: string[];
  invalidEntries: string[];
  ownerOnlyViolations: string[];
}

export function auditCognitiveRuntimeEntries(
  filesByRelPath: ReadonlyMap<string, string>,
  registry: readonly CognitiveRuntimeEntry[],
): CognitiveRuntimeAuditResult {
  const unregistered: DiscoveredCognitiveEntry[] = [];
  const staleEntries: string[] = [];
  const duplicateEntries: string[] = [];
  const invalidEntries: string[] = [];
  const ownerOnlyViolations: string[] = [];

  const registeredByKey = new Map<string, CognitiveRuntimeEntry>();
  for (const entry of registry) {
    const key = `${entry.file}#${entry.method}::${entry.signal}`;
    if (registeredByKey.has(key)) {
      duplicateEntries.push(key);
    }
    registeredByKey.set(key, entry);

    if (
      !VALID_RUNTIMES.has(entry.runtimeId) ||
      !VALID_REACHABILITY.has(entry.reachableBy) ||
      !VALID_AUTHORITY.has(entry.authorityPath) ||
      !VALID_SIGNALS.has(entry.signal) ||
      typeof entry.toolsOffered !== 'boolean' ||
      entry.notes.trim().length < 15
    ) {
      invalidEntries.push(key);
    }

    // D-208 / D-129: every processConsciously caller must be owner-only
    if (entry.signal === 'processConsciously' && entry.reachableBy !== 'owner-only') {
      ownerOnlyViolations.push(
        `${key}: processConsciously entry must be reachableBy "owner-only" (D-208/D-129), got "${entry.reachableBy}"`,
      );
    }
  }

  const discoveredKeys = new Set<string>();
  for (const [relPath, content] of [...filesByRelPath.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const found = scanCognitiveRuntimeEntries(content, relPath);
    for (const item of found) {
      const key = `${item.file}#${item.method}::${item.signal}`;
      discoveredKeys.add(key);
      if (!registeredByKey.has(key)) {
        unregistered.push(item);
      }
    }
  }

  for (const key of registeredByKey.keys()) {
    if (!discoveredKeys.has(key)) {
      staleEntries.push(key);
    }
  }

  return {
    unregistered,
    staleEntries: staleEntries.sort(),
    duplicateEntries: [...new Set(duplicateEntries)].sort(),
    invalidEntries: [...new Set(invalidEntries)].sort(),
    ownerOnlyViolations: ownerOnlyViolations.sort(),
  };
}

describe('RR-COG-RUNTIME-ENTRY-CENSUS: KEY cognitive runtime entry & tool-offering ratchet', () => {
  it('registers every cognitive runtime entry and model tool-offering call with zero drift and enforces owner-only on every processConsciously caller (D-208/D-129)', () => {
    const files = walkSourceFiles(SERVER_SRC_DIR);
    const sourceMap = new Map<string, string>();
    for (const fullPath of files) {
      const rel = path.relative(REPO_ROOT, fullPath).replace(/\\/g, '/');
      sourceMap.set(rel, fs.readFileSync(fullPath, 'utf8'));
    }

    const audit = auditCognitiveRuntimeEntries(sourceMap, COGNITIVE_RUNTIME_ENTRIES);

    expect(audit.unregistered).toEqual([]);
    expect(audit.staleEntries).toEqual([]);
    expect(audit.duplicateEntries).toEqual([]);
    expect(audit.invalidEntries).toEqual([]);
    expect(audit.ownerOnlyViolations).toEqual([]);

    const consciousCallers = COGNITIVE_RUNTIME_ENTRIES.filter(
      (e) => e.signal === 'processConsciously',
    );
    expect(consciousCallers.length).toBeGreaterThanOrEqual(3);
    expect(consciousCallers.every((e) => e.reachableBy === 'owner-only')).toBe(true);

    // Pin that KeyCortexConsciousnessService.processConsciously enforces mayReadFullKeyContext (D-129/D-208)
    const consciousnessSrc =
      sourceMap.get(
        'apps/server/src/modules/key-cortex/key-cortex-consciousness.service.ts',
      ) ?? '';
    expect(consciousnessSrc).toContain('mayReadFullKeyContext(');

    // Negative control (DoD): deleting any row from the real registry fails the audit
    const truncatedAudit = auditCognitiveRuntimeEntries(
      sourceMap,
      COGNITIVE_RUNTIME_ENTRIES.slice(1),
    );
    expect(truncatedAudit.unregistered.length).toBeGreaterThanOrEqual(1);
  });

  it('NEGATIVE CONTROLS: catches unregistered processConsciously and toolChoice calls, rejects non-owner-only processConsciously, catches deleted/stale rows, and ignores comments', () => {
    const syntheticFiles = new Map<string, string>([
      [
        'apps/server/src/modules/rogue/rogue-conscious.service.ts',
        `export class Rogue { async run() { return this.consciousness.processConsciously('q', {} as any); } }`,
      ],
      [
        'apps/server/src/modules/rogue/rogue-tool-choice.service.ts',
        `export class RogueTools { async ask(gw: any) { return gw.complete({ messages: [], toolChoice: 'auto' }); } }`,
      ],
      [
        'apps/server/src/modules/clean/non-owner-conscious.service.ts',
        `export class BadOwner { async ask() { return this.consciousness.processConsciously('q', {} as any); } }`,
      ],
      [
        'apps/server/src/modules/clean/commented.service.ts',
        `// this.consciousness.processConsciously('q', {});\n/* gw.complete({ toolChoice: 'auto' }); */\nexport const ok = true;`,
      ],
      [
        'apps/server/src/modules/clean/retired.service.ts',
        `export const retired = true;`,
      ],
    ]);

    const registry: CognitiveRuntimeEntry[] = [
      {
        runtimeId: 'cortex-consciousness',
        file: 'apps/server/src/modules/clean/non-owner-conscious.service.ts',
        method: 'ask',
        signal: 'processConsciously',
        reachableBy: 'member',
        toolsOffered: false,
        authorityPath: 'Cortex autonomy orchestrator',
        notes: 'Intentionally mislabeled as member to verify D-208/D-129 owner-only assertion.',
      },
      {
        runtimeId: 'flow-orchestrator',
        file: 'apps/server/src/modules/clean/retired.service.ts',
        method: 'oldEntry',
        signal: 'flow-chat',
        reachableBy: 'member',
        toolsOffered: true,
        authorityPath: 'Flow confirmation boundary',
        notes: 'Stale entry whose caller was removed and must fail staleEntries.',
      },
    ];

    const audit = auditCognitiveRuntimeEntries(syntheticFiles, registry);

    expect(audit.unregistered).toEqual([
      {
        file: 'apps/server/src/modules/rogue/rogue-conscious.service.ts',
        method: 'run',
        signal: 'processConsciously',
      },
      {
        file: 'apps/server/src/modules/rogue/rogue-tool-choice.service.ts',
        method: 'ask',
        signal: 'model-tools-call',
      },
    ]);
    expect(audit.ownerOnlyViolations).toEqual([
      'apps/server/src/modules/clean/non-owner-conscious.service.ts#ask::processConsciously: processConsciously entry must be reachableBy "owner-only" (D-208/D-129), got "member"',
    ]);
    expect(audit.staleEntries).toEqual([
      'apps/server/src/modules/clean/retired.service.ts#oldEntry::flow-chat',
    ]);
  });
});
