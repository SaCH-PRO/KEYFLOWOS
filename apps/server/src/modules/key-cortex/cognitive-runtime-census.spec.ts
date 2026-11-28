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
  'apps/server/src/modules/ai/ai-usage.service.ts',
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
  'member-and-memberless',
  'memberless',
  'owner-only',
]);
const VALID_AUTHORITY = new Set<CognitiveAuthorityPath>([
  'Flow confirmation boundary',
  'Cortex autonomy orchestrator',
  'PhoneVoice dispatch + memberless allowlist + KeyActionBoundary',
  'none (read-only)',
]);
const VALID_SIGNALS = new Set<CognitiveEntrySignal>([
  'flow-chat',
  'flow-stream-chat',
  'processConsciously',
  'processQuery',
  'streamQuery',
  'streamReasoning',
  'model-tools-call',
]);

const MODEL_CALL_METHODS = new Set([
  'complete',
  'streamComplete',
  'trackAndComplete',
  'trackAndStream',
  'callAi',
  'create',
  'open',
  'connect',
  'openSession',
  'stringify',
  'send',
]);

const TOOL_CHOICE_KEYS = new Set(['toolChoice', 'tool_choice']);
const TOOLS_KEYS = new Set(['tools']);

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
    ts.isSatisfiesExpression(cur) ||
    ts.isTypeAssertionExpression(cur)
  ) {
    cur = cur.expression;
  }
  return cur;
}

function collectStringConsts(sf: ts.SourceFile): Map<string, string> {
  const consts = new Map<string, string>();
  const walk = (node: ts.Node) => {
    if (ts.isJSDoc(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const val = evalStaticString(node.initializer, consts);
      if (val !== null) consts.set(node.name.text, val);
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return consts;
}

function evalStaticString(
  expr: ts.Expression,
  stringConsts: ReadonlyMap<string, string>,
): string | null {
  const u = unwrapExpr(expr);
  if (ts.isStringLiteral(u) || ts.isNoSubstitutionTemplateLiteral(u)) {
    return u.text;
  }
  if (ts.isIdentifier(u)) {
    return stringConsts.get(u.text) ?? null;
  }
  if (
    ts.isBinaryExpression(u) &&
    u.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = evalStaticString(u.left, stringConsts);
    const right = evalStaticString(u.right, stringConsts);
    if (left !== null && right !== null) return left + right;
  }
  if (ts.isTemplateExpression(u)) {
    let acc = u.head.text;
    for (const span of u.templateSpans) {
      const part = evalStaticString(span.expression, stringConsts);
      if (part === null) return null;
      acc += part + span.literal.text;
    }
    return acc;
  }
  return null;
}

function staticPropKey(
  node: ts.PropertyName | ts.Expression,
  stringConsts: ReadonlyMap<string, string>,
): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isComputedPropertyName(node)) {
    return evalStaticString(node.expression, stringConsts);
  }
  return evalStaticString(node as ts.Expression, stringConsts);
}

function memberAccessName(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  stringConsts: ReadonlyMap<string, string>,
): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return evalStaticString(node.argumentExpression, stringConsts);
}

function nodeReferencesAny(
  root: ts.Node | undefined,
  targets: ReadonlySet<string>,
): boolean {
  if (!root) return false;
  let found = false;
  const walk = (n: ts.Node) => {
    if (found || ts.isJSDoc(n)) return;
    if (ts.isIdentifier(n) && targets.has(n.text)) {
      found = true;
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(root);
  return found;
}

function collectFlowOrchestratorSymbols(sf: ts.SourceFile): {
  typeNames: Set<string>;
  receivers: Set<string>;
  helperMethods: Set<string>;
} {
  const typeNames = new Set<string>(['FlowOrchestratorService']);
  const receivers = new Set<string>();
  const helperMethods = new Set<string>();

  // 1. Track import aliases: `import { FlowOrchestratorService as Flow } from ...`
  const findImports = (node: ts.Node) => {
    if (ts.isImportSpecifier(node)) {
      const imported = node.propertyName ? node.propertyName.text : node.name.text;
      if (imported === 'FlowOrchestratorService') {
        typeNames.add(node.name.text);
      }
    }
    ts.forEachChild(node, findImports);
  };
  findImports(sf);

  // 2. Track helper methods/functions returning or resolving FlowOrchestratorService
  const stringConsts = collectStringConsts(sf);
  const findHelpers = (node: ts.Node) => {
    if (ts.isJSDoc(node)) return;
    if (
      (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) &&
      node.name &&
      (nodeReferencesAny(node.type, typeNames) || nodeReferencesAny(node.body, typeNames))
    ) {
      const name = ts.isIdentifier(node.name)
        ? node.name.text
        : staticPropKey(node.name, stringConsts);
      if (name) helperMethods.add(name);
    }
    ts.forEachChild(node, findHelpers);
  };
  findHelpers(sf);

  // 3. Collect typed or @Inject-decorated params/properties
  const hasInjectFlowDecorator = (node: ts.HasDecorators): boolean => {
    const mods = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
    if (!mods) return false;
    return mods.some((d) => nodeReferencesAny(d.expression, typeNames));
  };

  const collectInitial = (node: ts.Node) => {
    if (ts.isJSDoc(node)) return;
    if (ts.isParameter(node) || ts.isPropertyDeclaration(node)) {
      if (
        ts.isIdentifier(node.name) &&
        (nodeReferencesAny(node.type, typeNames) || hasInjectFlowDecorator(node))
      ) {
        receivers.add(node.name.text);
      }
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (nodeReferencesAny(node.type, typeNames)) {
        receivers.add(node.name.text);
      }
    }
    ts.forEachChild(node, collectInitial);
  };
  collectInitial(sf);

  // 4. Fixed-point propagation through local aliases and helper/moduleRef.get calls
  let changed = true;
  while (changed) {
    changed = false;
    const propagate = (node: ts.Node) => {
      if (ts.isJSDoc(node)) return;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (
          !receivers.has(node.name.text) &&
          receiverMatchesFlowOrchestrator(
            node.initializer,
            receivers,
            helperMethods,
            typeNames,
            stringConsts,
          )
        ) {
          receivers.add(node.name.text);
          changed = true;
        }
      }
      ts.forEachChild(node, propagate);
    };
    propagate(sf);
  }

  return { typeNames, receivers, helperMethods };
}

function receiverMatchesFlowOrchestrator(
  expr: ts.Expression,
  flowReceivers: ReadonlySet<string>,
  helperMethods: ReadonlySet<string>,
  flowTypeNames: ReadonlySet<string>,
  stringConsts: ReadonlyMap<string, string>,
): boolean {
  const u = unwrapExpr(expr);
  if (ts.isIdentifier(u)) return flowReceivers.has(u.text);
  if (ts.isPropertyAccessExpression(u) || ts.isElementAccessExpression(u)) {
    const prop = memberAccessName(u, stringConsts);
    return prop !== null && flowReceivers.has(prop);
  }
  if (ts.isCallExpression(u)) {
    const callee = unwrapExpr(u.expression);
    const calleeName = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)
        ? memberAccessName(callee, stringConsts)
        : null;
    if (calleeName && helperMethods.has(calleeName)) return true;
    if (u.arguments.some((a) => nodeReferencesAny(a, flowTypeNames))) return true;
  }
  return false;
}

interface MethodAliasInfo {
  methodName: string;
  receiver: ts.Expression | null;
}

function collectMethodAliases(
  sf: ts.SourceFile,
  stringConsts: ReadonlyMap<string, string>,
): Map<string, MethodAliasInfo> {
  const aliases = new Map<string, MethodAliasInfo>();
  const walk = (node: ts.Node) => {
    if (ts.isJSDoc(node)) return;
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = unwrapExpr(node.initializer);
      if (ts.isIdentifier(node.name)) {
        if (ts.isPropertyAccessExpression(init) || ts.isElementAccessExpression(init)) {
          const prop = memberAccessName(init, stringConsts);
          if (prop) aliases.set(node.name.text, { methodName: prop, receiver: init.expression });
        }
      } else if (ts.isObjectBindingPattern(node.name)) {
        for (const el of node.name.elements) {
          if (!ts.isIdentifier(el.name)) continue;
          const prop = el.propertyName
            ? staticPropKey(el.propertyName, stringConsts)
            : el.name.text;
          if (prop) aliases.set(el.name.text, { methodName: prop, receiver: init });
        }
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return aliases;
}

function exprHasNestedKeys(
  expr: ts.Expression,
  keys: ReadonlySet<string>,
  stringConsts: ReadonlyMap<string, string>,
  flaggedVars: ReadonlySet<string>,
): boolean {
  let found = false;
  const walk = (node: ts.Node) => {
    if (found || ts.isJSDoc(node)) return;
    if (ts.isIdentifier(node) && flaggedVars.has(node.text)) {
      found = true;
      return;
    }
    if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop)) {
          const k = staticPropKey(prop.name, stringConsts);
          if (k && keys.has(k)) {
            found = true;
            return;
          }
          walk(prop.initializer);
        } else if (ts.isShorthandPropertyAssignment(prop)) {
          if (keys.has(prop.name.text) || flaggedVars.has(prop.name.text)) {
            found = true;
            return;
          }
        } else if (ts.isSpreadAssignment(prop)) {
          walk(prop.expression);
        }
      }
      return;
    }
    if (ts.isCallExpression(node)) {
      // Recurse into arguments (e.g., JSON.stringify({ session: { tools, tool_choice } }))
      for (const arg of node.arguments) walk(arg);
      return;
    }
    ts.forEachChild(node, walk);
  };
  walk(expr);
  return found;
}

function collectFlaggedOptionVars(
  sf: ts.SourceFile,
  keys: ReadonlySet<string>,
  stringConsts: ReadonlyMap<string, string>,
): Set<string> {
  const flagged = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    const walk = (node: ts.Node) => {
      if (ts.isJSDoc(node)) return;
      // Variable declaration initialized with an object/spread containing the key
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        !flagged.has(node.name.text) &&
        exprHasNestedKeys(node.initializer, keys, stringConsts, flagged)
      ) {
        flagged.add(node.name.text);
        changed = true;
      }
      // Property assignment mutation: `req.tools = ...` or `req['toolChoice'] = ...`
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ) {
        const lhs = unwrapExpr(node.left);
        if (ts.isPropertyAccessExpression(lhs) || ts.isElementAccessExpression(lhs)) {
          const prop = memberAccessName(lhs, stringConsts);
          const root = unwrapExpr(lhs.expression);
          if (prop && keys.has(prop) && ts.isIdentifier(root) && !flagged.has(root.text)) {
            flagged.add(root.text);
            changed = true;
          }
        }
      }
      ts.forEachChild(node, walk);
    };
    walk(sf);
  }
  return flagged;
}

export interface DiscoveredCognitiveEntry {
  file: string;
  method: string;
  signal: CognitiveEntrySignal;
}

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
  const stringConsts = collectStringConsts(sf);
  const flowSymbols = collectFlowOrchestratorSymbols(sf);
  const methodAliases = collectMethodAliases(sf, stringConsts);
  const toolChoiceVars = collectFlaggedOptionVars(sf, TOOL_CHOICE_KEYS, stringConsts);
  const toolsVars = collectFlaggedOptionVars(sf, TOOLS_KEYS, stringConsts);
  const hits = new Map<string, DiscoveredCognitiveEntry>();

  const add = (method: string, signal: CognitiveEntrySignal) => {
    const key = `${relPath}#${method}::${signal}`;
    hits.set(key, { file: relPath, method, signal });
  };

  const resolveCallTarget = (
    call: ts.CallExpression,
  ): { invokedMethod: string | null; receiver: ts.Expression | null } => {
    const callee = unwrapExpr(call.expression);

    // Reflect.apply(targetFn, thisArg, argsList)
    if (
      (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) &&
      memberAccessName(callee, stringConsts) === 'apply' &&
      ts.isIdentifier(unwrapExpr(callee.expression)) &&
      (unwrapExpr(callee.expression) as ts.Identifier).text === 'Reflect' &&
      call.arguments.length >= 1
    ) {
      const target = unwrapExpr(call.arguments[0]);
      if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
        return {
          invokedMethod: memberAccessName(target, stringConsts),
          receiver: call.arguments[1] ? unwrapExpr(call.arguments[1]) : target.expression,
        };
      }
      if (ts.isIdentifier(target)) {
        const aliased = methodAliases.get(target.text);
        if (aliased) {
          return {
            invokedMethod: aliased.methodName,
            receiver: call.arguments[1] ? unwrapExpr(call.arguments[1]) : aliased.receiver,
          };
        }
      }
    }

    if (ts.isIdentifier(callee)) {
      const aliased = methodAliases.get(callee.text);
      if (aliased) {
        return { invokedMethod: aliased.methodName, receiver: aliased.receiver };
      }
      return { invokedMethod: callee.text, receiver: null };
    }

    if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
      const directName = memberAccessName(callee, stringConsts);
      if (directName === 'call' || directName === 'apply' || directName === 'bind') {
        const inner = unwrapExpr(callee.expression);
        if (ts.isPropertyAccessExpression(inner) || ts.isElementAccessExpression(inner)) {
          return {
            invokedMethod: memberAccessName(inner, stringConsts),
            receiver: inner.expression,
          };
        }
        if (ts.isIdentifier(inner)) {
          const aliased = methodAliases.get(inner.text);
          if (aliased) {
            return { invokedMethod: aliased.methodName, receiver: aliased.receiver };
          }
        }
      }
      return { invokedMethod: directName, receiver: callee.expression };
    }

    return { invokedMethod: null, receiver: null };
  };

  const visit = (node: ts.Node, currentMethod: string) => {
    if (ts.isJSDoc(node)) return;

    let nextMethod = currentMethod;
    if (ts.isMethodDeclaration(node) && node.name) {
      nextMethod = staticPropKey(node.name, stringConsts) ?? currentMethod;
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
      const { invokedMethod, receiver } = resolveCallTarget(node);

      if (invokedMethod === 'processConsciously') {
        add(nextMethod, 'processConsciously');
      } else if (invokedMethod === 'processQuery') {
        add(nextMethod, 'processQuery');
      } else if (invokedMethod === 'streamQuery') {
        add(nextMethod, 'streamQuery');
      } else if (invokedMethod === 'streamReasoning') {
        add(nextMethod, 'streamReasoning');
      } else if (
        invokedMethod === 'streamChat' &&
        receiver &&
        receiverMatchesFlowOrchestrator(
          receiver,
          flowSymbols.receivers,
          flowSymbols.helperMethods,
          flowSymbols.typeNames,
          stringConsts,
        )
      ) {
        add(nextMethod, 'flow-stream-chat');
      } else if (
        invokedMethod === 'chat' &&
        receiver &&
        receiverMatchesFlowOrchestrator(
          receiver,
          flowSymbols.receivers,
          flowSymbols.helperMethods,
          flowSymbols.typeNames,
          stringConsts,
        )
      ) {
        add(nextMethod, 'flow-chat');
      }

      // Any model/realtime call passing `toolChoice`/`tool_choice` (direct, nested, spread, or via variable)
      // or passing `tools` to a model/bridge call.
      const hasToolChoiceArg = node.arguments.some((arg) =>
        exprHasNestedKeys(arg, TOOL_CHOICE_KEYS, stringConsts, toolChoiceVars),
      );
      const hasToolsOnModelCall =
        invokedMethod !== null &&
        MODEL_CALL_METHODS.has(invokedMethod) &&
        node.arguments.some((arg) =>
          exprHasNestedKeys(arg, TOOLS_KEYS, stringConsts, toolsVars),
        );

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

/**
 * AST check verifying that `KeyCortexConsciousnessService.processConsciously`
 * calls `mayReadFullKeyContext(...)` inside an early-return `if` guard BEFORE
 * Step 1 (`detectEmotion` / any model or organ work). Unlike a substring check,
 * deleting the STEP 0 gate while leaving the helper declaration intact fails.
 */
export function verifyProcessConsciouslyOwnerGate(source: string): boolean {
  const sf = ts.createSourceFile(
    'key-cortex-consciousness.service.ts',
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  let processMethod: ts.MethodDeclaration | null = null;
  const findMethod = (node: ts.Node) => {
    if (processMethod || ts.isJSDoc(node)) return;
    if (
      ts.isClassDeclaration(node) &&
      node.name?.text === 'KeyCortexConsciousnessService'
    ) {
      for (const member of node.members) {
        if (
          ts.isMethodDeclaration(member) &&
          ts.isIdentifier(member.name) &&
          member.name.text === 'processConsciously'
        ) {
          processMethod = member;
          return;
        }
      }
    }
    ts.forEachChild(node, findMethod);
  };
  findMethod(sf);
  if (!processMethod || !(processMethod as ts.MethodDeclaration).body) return false;
  const body = (processMethod as ts.MethodDeclaration).body!;

  let gatePos: number | null = null;
  let step1Pos: number | null = null;

  const hasCallNamed = (root: ts.Node, target: string): boolean => {
    let found = false;
    const w = (n: ts.Node) => {
      if (found || ts.isJSDoc(n)) return;
      if (ts.isCallExpression(n)) {
        const c = unwrapExpr(n.expression);
        if (ts.isIdentifier(c) && c.text === target) {
          found = true;
          return;
        }
        if (ts.isPropertyAccessExpression(c) && c.name.text === target) {
          found = true;
          return;
        }
      }
      ts.forEachChild(n, w);
    };
    w(root);
    return found;
  };

  const hasReturnStatement = (root: ts.Node): boolean => {
    let found = false;
    const w = (n: ts.Node) => {
      if (found || ts.isJSDoc(n)) return;
      if (ts.isReturnStatement(n)) {
        found = true;
        return;
      }
      ts.forEachChild(n, w);
    };
    w(root);
    return found;
  };

  const walkBody = (node: ts.Node) => {
    if (ts.isJSDoc(node)) return;
    if (
      ts.isIfStatement(node) &&
      gatePos === null &&
      hasCallNamed(node.expression, 'mayReadFullKeyContext') &&
      hasReturnStatement(node.thenStatement)
    ) {
      gatePos = node.getStart(sf);
    }
    if (
      ts.isCallExpression(node) &&
      step1Pos === null &&
      ts.isPropertyAccessExpression(unwrapExpr(node.expression)) &&
      (unwrapExpr(node.expression) as ts.PropertyAccessExpression).name.text === 'detectEmotion'
    ) {
      step1Pos = node.getStart(sf);
    }
    ts.forEachChild(node, walkBody);
  };
  walkBody(body);

  return gatePos !== null && (step1Pos === null || gatePos < step1Pos);
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
  it('registers every cognitive runtime entry and model/realtime tool-offering call with zero drift and enforces owner-only on every processConsciously caller (D-208/D-129)', () => {
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

    // AST pin: KeyCortexConsciousnessService.processConsciously MUST invoke
    // mayReadFullKeyContext(...) in an early-return guard before Step 1 (D-129/D-208).
    const consciousnessSrc =
      sourceMap.get(
        'apps/server/src/modules/key-cortex/key-cortex-consciousness.service.ts',
      ) ?? '';
    expect(verifyProcessConsciouslyOwnerGate(consciousnessSrc)).toBe(true);

    // Negative control (DoD): deleting any row from the real registry fails the audit
    const truncatedAudit = auditCognitiveRuntimeEntries(
      sourceMap,
      COGNITIVE_RUNTIME_ENTRIES.slice(1),
    );
    expect(truncatedAudit.unregistered.length).toBeGreaterThanOrEqual(1);
  });

  it('NEGATIVE CONTROLS: catches unregistered entries, streaming/nested/aliased/spread/mutated/Reflect bypasses, missing STEP 0 gate, non-owner processConsciously, and stale rows', () => {
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
        'apps/server/src/modules/rogue/rogue-track-tools.service.ts',
        `export class RogueTrack { async ask(aiUsage: any, tools: any) { return aiUsage.trackAndComplete('b', 'u', 'f', { messages: [], tools }); } }`,
      ],
      [
        'apps/server/src/modules/rogue/rogue-stream-query.service.ts',
        `export class RogueStream { async *ask(reasoning: any) { yield* reasoning.streamQuery({ message: 'hi' }); } }`,
      ],
      [
        'apps/server/src/modules/rogue/rogue-nested-ws.service.ts',
        `export class RogueWs { open(ws: any, tools: any) { ws.send(JSON.stringify({ type: 'session.update', session: { tools, tool_choice: 'auto' } })); } }`,
      ],
      [
        'apps/server/src/modules/rogue/rogue-var-spread.service.ts',
        `export class RogueVar {
          async viaVar(gw: any, t: any) {
            const req: any = { messages: [] };
            req.tools = t;
            return gw.complete(req);
          }
          async viaSpread(gw: any) {
            const extra = { toolChoice: 'auto' };
            return gw.complete({ messages: [], ...extra });
          }
        }`,
      ],
      [
        'apps/server/src/modules/rogue/rogue-flow-evasion.service.ts',
        `import { FlowOrchestratorService as Flow } from '../ai/flow-orchestrator.service';
         export class RogueFlow {
           constructor(@Inject(Flow) private readonly f: any) {}
           async viaInject() { const alias = this.f; return alias.chat('b', 'hi'); }
           async viaChained(moduleRef: any) { return moduleRef.get(Flow).streamChat('b', 'hi'); }
         }`,
      ],
      [
        'apps/server/src/modules/rogue/rogue-method-evasion.service.ts',
        `export class RogueMethod {
          async viaDestructure(c: any) { const { processConsciously: pc } = c; return pc('q', {}); }
          async viaConcat(c: any) { return c['process' + 'Consciously']('q', {}); }
          async viaReflect(c: any) { return Reflect.apply(c.processConsciously, c, ['q', {}]); }
        }`,
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
        authorityPath: 'none (read-only)',
        notes: 'Synthetic invalid entry violating owner-only rule for D-208.',
      },
      {
        runtimeId: 'flow-orchestrator',
        file: 'apps/server/src/modules/clean/retired.service.ts',
        method: 'gone',
        signal: 'flow-chat',
        reachableBy: 'member',
        toolsOffered: true,
        authorityPath: 'Flow confirmation boundary',
        notes: 'Synthetic stale entry whose call site no longer exists.',
      },
    ];

    const audit = auditCognitiveRuntimeEntries(syntheticFiles, registry);
    const unregKeys = audit.unregistered.map(
      (e) => `${e.file}#${e.method}::${e.signal}`,
    );

    expect(unregKeys).toContain(
      'apps/server/src/modules/rogue/rogue-conscious.service.ts#run::processConsciously',
    );
    expect(unregKeys).toContain(
      'apps/server/src/modules/rogue/rogue-tool-choice.service.ts#ask::model-tools-call',
    );
    expect(unregKeys).toContain(
      'apps/server/src/modules/rogue/rogue-track-tools.service.ts#ask::model-tools-call',
    );
    expect(unregKeys).toContain(
      'apps/server/src/modules/rogue/rogue-stream-query.service.ts#ask::streamQuery',
    );
    expect(unregKeys).toContain(
      'apps/server/src/modules/rogue/rogue-nested-ws.service.ts#open::model-tools-call',
    );
    expect(unregKeys).toContain(
      'apps/server/src/modules/rogue/rogue-var-spread.service.ts#viaVar::model-tools-call',
    );
    expect(unregKeys).toContain(
      'apps/server/src/modules/rogue/rogue-var-spread.service.ts#viaSpread::model-tools-call',
    );
    expect(unregKeys).toContain(
      'apps/server/src/modules/rogue/rogue-flow-evasion.service.ts#viaInject::flow-chat',
    );
    expect(unregKeys).toContain(
      'apps/server/src/modules/rogue/rogue-flow-evasion.service.ts#viaChained::flow-stream-chat',
    );
    expect(unregKeys).toContain(
      'apps/server/src/modules/rogue/rogue-method-evasion.service.ts#viaDestructure::processConsciously',
    );
    expect(unregKeys).toContain(
      'apps/server/src/modules/rogue/rogue-method-evasion.service.ts#viaConcat::processConsciously',
    );
    expect(unregKeys).toContain(
      'apps/server/src/modules/rogue/rogue-method-evasion.service.ts#viaReflect::processConsciously',
    );
    expect(unregKeys.some((k) => k.includes('commented.service.ts'))).toBe(false);
    expect(audit.staleEntries).toEqual([
      'apps/server/src/modules/clean/retired.service.ts#gone::flow-chat',
    ]);
    expect(audit.ownerOnlyViolations.length).toBe(1);

    // Negative control: helper declaration exists, but STEP 0 gate is removed from processConsciously
    const gateRemovedSrc = `
      export async function mayReadFullKeyContext() { return false; }
      export class KeyCortexConsciousnessService {
        async processConsciously(query: string, session: any) {
          const emotionalState = await this.emotion.detectEmotion(session.businessId, session.userId, query, []);
          return emotionalState;
        }
      }
    `;
    expect(verifyProcessConsciouslyOwnerGate(gateRemovedSrc)).toBe(false);
  });
});
