import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/**
 * RR-SELFTUNE-CANDIDATE-ONLY (REC-NO-SELF-PROMOTION, human-agency doctrine):
 *
 * Fail-closed structural census pinning three invariants across every non-test
 * server source:
 *   1. `ModelGatewayService.updatePreferences` is referenced/called ONLY inside
 *      the owner-facing `AiController.updateAiPreferences` route in
 *      `modules/ai/ai.controller.ts` (decorated with `@Put('businesses/:businessId/ai/preferences')`
 *      and `@RequireModuleScope('settings', 'admin')`, and calling
 *      `assertBusinessOwnerMember`). Any other `updatePreferences` access,
 *      call, `.call`/`.apply`/`.bind`, or destructuring outside the two
 *      explicitly allowlisted non-gateway notification preference sites fails.
 *   2. No production source contains `'key_self_tuning'`, and no production
 *      source outside read-only `modules/ai/memory-classification.ts` contains
 *      `'evolution_tuning'` (with `memory-classification.ts` pinned to have
 *      zero Prisma / AiMemory / memory-writer calls).
 *   3. `KeyCortexEvolutionService` does not re-introduce `selfTune`,
 *      `applyTuningAdjustment`, or `buildTuningPrompt` in any declaration shape.
 */

export interface VirtualSource {
  file: string;
  text: string;
}

export interface Violation {
  file: string;
  line: number;
  kind:
    | 'updatePreferences'
    | 'evolution_tuning_literal'
    | 'key_self_tuning_source'
    | 'classification_writer'
    | 'self_tune_method';
  detail: string;
}

const SERVER_SRC_ROOT = path.resolve(__dirname, '../..');
const AI_CONTROLLER_FILE = 'modules/ai/ai.controller.ts';
const ALLOWED_AI_PREFERENCES_METHOD = 'updateAiPreferences';
const MEMORY_CLASSIFICATION_FILE = 'modules/ai/memory-classification.ts';
const EVOLUTION_SERVICE_FILE = 'modules/key-cortex/key-cortex-evolution.service.ts';
const FORBIDDEN_SELF_TUNE_NAMES = new Set(['selfTune', 'applyTuningAdjustment', 'buildTuningPrompt']);

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTsFiles(full, out);
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

export function loadServerSources(): VirtualSource[] {
  return walkTsFiles(SERVER_SRC_ROOT)
    .sort()
    .map((abs) => ({
      file: path.relative(SERVER_SRC_ROOT, abs).replace(/\\/g, '/'),
      text: readFileSync(abs, 'utf8'),
    }));
}

function lineOf(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

/**
 * Evaluates a constant string expression (`'a'`, `` `a` ``, `'a' + 'b'`,
 * `` `a_${'b'}` ``, parenthesized) to catch trivial string-splitting bypasses.
 */
function evalStaticString(node: ts.Node): string | null {
  if (ts.isParenthesizedExpression(node)) {
    return evalStaticString(node.expression);
  }
  if (ts.isStringLiteralLike(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) {
      const part = evalStaticString(span.expression);
      if (part === null) return null;
      out += part + span.literal.text;
    }
    return out;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = evalStaticString(node.left);
    const right = evalStaticString(node.right);
    if (left !== null && right !== null) return left + right;
  }
  return null;
}

function enclosingClassAndMethod(node: ts.Node): { className?: string; methodName?: string } {
  let className: string | undefined;
  let methodName: string | undefined;
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (!methodName && ts.isMethodDeclaration(cur) && ts.isIdentifier(cur.name)) {
      methodName = cur.name.text;
    }
    if (!className && ts.isClassDeclaration(cur) && cur.name) {
      className = cur.name.text;
    }
    cur = cur.parent;
  }
  return { className, methodName };
}

function classHasTypedMember(cls: ts.ClassDeclaration | undefined, memberName: string, typeName: string): boolean {
  if (!cls) return false;
  for (const m of cls.members) {
    if (ts.isConstructorDeclaration(m)) {
      for (const p of m.parameters) {
        if (ts.isIdentifier(p.name) && p.name.text === memberName && p.type?.getText().includes(typeName)) {
          return true;
        }
      }
    } else if (ts.isPropertyDeclaration(m) && ts.isIdentifier(m.name) && m.name.text === memberName) {
      if (m.type?.getText().includes(typeName)) return true;
    }
  }
  return false;
}

function findEnclosingClass(node: ts.Node): ts.ClassDeclaration | undefined {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (ts.isClassDeclaration(cur)) return cur;
    cur = cur.parent;
  }
  return undefined;
}

/**
 * Explicit allowlist for `updatePreferences` references across `apps/server/src`:
 *   1. `modules/ai/ai.controller.ts` -> `AiController.updateAiPreferences` calling `this.gateway.updatePreferences(...)`
 *   2. `modules/notifications/notifications.controller.ts` -> `NotificationsController.updatePreferences` calling `this.transactionalEmail.updatePreferences(...)` (typed `TransactionalEmailService`)
 *   3. `modules/key-cortex/adapters/notifications-adapter.service.ts` -> `NotificationsAdapterService` calling `this.updatePreferences(...)`
 *
 * Everything else (including `ModuleRef.get(ModelGatewayService)`, local aliases,
 * `@Inject(ModelGatewayService) gw: any`, `(this as any).gateway`, `.call`/`.apply`/`.bind`,
 * destructuring `const { updatePreferences } = ...`, untyped params, internal
 * `ModelGatewayService.this.updatePreferences`, or any other route in `ai.controller.ts`)
 * is flagged fail-closed.
 */
function isAllowlistedUpdatePreferencesAccess(
  file: string,
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression | ts.BindingElement,
): boolean {
  if (!ts.isPropertyAccessExpression(node)) return false;
  // Must be directly called (`receiver.updatePreferences(...)`), never extracted or `.call`/`.apply`/`.bind`
  if (!ts.isCallExpression(node.parent) || node.parent.expression !== node) return false;

  const { className, methodName } = enclosingClassAndMethod(node);
  const cls = findEnclosingClass(node);

  if (
    file === AI_CONTROLLER_FILE &&
    className === 'AiController' &&
    methodName === ALLOWED_AI_PREFERENCES_METHOD &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
    node.expression.name.text === 'gateway' &&
    classHasTypedMember(cls, 'gateway', 'ModelGatewayService')
  ) {
    return true;
  }

  if (
    file === 'modules/notifications/notifications.controller.ts' &&
    className === 'NotificationsController' &&
    methodName === 'updatePreferences' &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
    node.expression.name.text === 'transactionalEmail' &&
    classHasTypedMember(cls, 'transactionalEmail', 'TransactionalEmailService')
  ) {
    return true;
  }

  if (
    file === 'modules/key-cortex/adapters/notifications-adapter.service.ts' &&
    className === 'NotificationsAdapterService' &&
    methodName === 'execute' &&
    node.expression.kind === ts.SyntaxKind.ThisKeyword
  ) {
    return true;
  }

  return false;
}

function declarationName(name: ts.PropertyName | ts.Identifier | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return evalStaticString(name.expression);
  return null;
}

function isInsideAssignmentLhs(node: ts.Node): boolean {
  let cur: ts.Node | undefined = node;
  while (cur && cur.parent) {
    const parent = cur.parent;
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      parent.left === cur
    ) {
      return true;
    }
    if (
      ts.isObjectLiteralExpression(parent) ||
      ts.isArrayLiteralExpression(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isShorthandPropertyAssignment(parent) ||
      ts.isSpreadAssignment(parent) ||
      ts.isParenthesizedExpression(parent)
    ) {
      cur = parent;
      continue;
    }
    break;
  }
  return false;
}

const ALLOWED_CLASSIFICATION_IMPORTS = new Set([
  '../../core/authority/module-vocabulary',
  '../business-genome/key-genome/genome-finance-scope',
]);

export function scanSelfPromotionViolations(
  sources: readonly VirtualSource[] = loadServerSources(),
): Violation[] {
  const violations: Violation[] = [];

  for (const { file, text } of sources) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

    const visit = (node: ts.Node): void => {
      // 1. Fail-closed check for EVERY `updatePreferences` access / bracket / destructuring /
      //    assignment-LHS destructuring (`({ updatePreferences: fn } = gw)`).
      if (ts.isPropertyAccessExpression(node) && node.name.text === 'updatePreferences') {
        if (!isAllowlistedUpdatePreferencesAccess(file, node)) {
          violations.push({
            file,
            line: lineOf(sf, node.getStart(sf)),
            kind: 'updatePreferences',
            detail: `Unallowlisted updatePreferences access: ${node.getText(sf)}`,
          });
        }
      } else if (ts.isElementAccessExpression(node) && node.argumentExpression) {
        const key = evalStaticString(node.argumentExpression);
        if (key === 'updatePreferences' && !isAllowlistedUpdatePreferencesAccess(file, node)) {
          violations.push({
            file,
            line: lineOf(sf, node.getStart(sf)),
            kind: 'updatePreferences',
            detail: `Unallowlisted bracket updatePreferences access: ${node.getText(sf)}`,
          });
        }
      } else if (ts.isBindingElement(node)) {
        const propName = node.propertyName
          ? declarationName(node.propertyName)
          : ts.isIdentifier(node.name)
            ? node.name.text
            : null;
        if (propName === 'updatePreferences' && !isAllowlistedUpdatePreferencesAccess(file, node)) {
          violations.push({
            file,
            line: lineOf(sf, node.getStart(sf)),
            kind: 'updatePreferences',
            detail: `Unallowlisted destructuring of updatePreferences: ${node.getText(sf)}`,
          });
        }
      } else if (
        (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
        isInsideAssignmentLhs(node)
      ) {
        const propName = declarationName(node.name);
        if (propName === 'updatePreferences') {
          violations.push({
            file,
            line: lineOf(sf, node.getStart(sf)),
            kind: 'updatePreferences',
            detail: `Unallowlisted assignment-LHS destructuring of updatePreferences: ${node.getText(sf)}`,
          });
        }
      }

      // 2. Fail-closed check for maximal constant string expressions:
      //    - `'updatePreferences'` (banned as any static string literal/concat/template —
      //      catches Reflect.get(gw, 'updatePreferences'), const k = 'updatePreferences'; gw[k], etc.)
      //    - `'key_self_tuning'` (banned everywhere)
      //    - `'evolution_tuning'` (banned everywhere outside read-only memory-classification.ts)
      const isPartOfOuterStaticString =
        Boolean(node.parent) &&
        ((ts.isBinaryExpression(node.parent) &&
          node.parent.operatorToken.kind === ts.SyntaxKind.PlusToken &&
          evalStaticString(node.parent) !== null) ||
          (ts.isTemplateSpan(node.parent) && evalStaticString(node.parent.parent) !== null));

      if (!isPartOfOuterStaticString) {
        const strVal = evalStaticString(node);
        if (strVal === 'updatePreferences') {
          violations.push({
            file,
            line: lineOf(sf, node.getStart(sf)),
            kind: 'updatePreferences',
            detail: `Static string 'updatePreferences' is forbidden in production sources: ${node.getText(sf)}`,
          });
        } else if (strVal === 'key_self_tuning') {
          violations.push({
            file,
            line: lineOf(sf, node.getStart(sf)),
            kind: 'key_self_tuning_source',
            detail: `AiMemory source 'key_self_tuning' is forbidden in production sources`,
          });
        } else if (strVal === 'evolution_tuning' && file !== MEMORY_CLASSIFICATION_FILE) {
          violations.push({
            file,
            line: lineOf(sf, node.getStart(sf)),
            kind: 'evolution_tuning_literal',
            detail: `'evolution_tuning' is forbidden outside read-only ${MEMORY_CLASSIFICATION_FILE}`,
          });
        }
      }

      // 2b. Ensure memory-classification.ts stays a pure read-only leaf module:
      //     pin its imports to the pure leaf allowlist AND forbid Prisma / AiMemory / writer calls.
      if (file === MEMORY_CLASSIFICATION_FILE) {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const spec = node.moduleSpecifier.text;
          if (!ALLOWED_CLASSIFICATION_IMPORTS.has(spec)) {
            violations.push({
              file,
              line: lineOf(sf, node.getStart(sf)),
              kind: 'classification_writer',
              detail: `${MEMORY_CLASSIFICATION_FILE} may only import pure leaf modules; found '${spec}'`,
            });
          }
        }
        if (ts.isCallExpression(node)) {
          const callee = node.expression.getText(sf);
          if (/\baiMemory\b|upsertAiMemory|\bprisma\b|memoryService|memoryWriter/i.test(callee)) {
            violations.push({
              file,
              line: lineOf(sf, node.getStart(sf)),
              kind: 'classification_writer',
              detail: `${MEMORY_CLASSIFICATION_FILE} must stay read-only; found ${callee}`,
            });
          }
        }
      }

      // 3. Deleted self-tuning symbols in KeyCortexEvolutionService (method, property, accessor,
      //    function, or variable declaration — including computed string property names).
      if (file === EVOLUTION_SERVICE_FILE) {
        let name: string | null = null;
        if (
          ts.isMethodDeclaration(node) ||
          ts.isPropertyDeclaration(node) ||
          ts.isGetAccessorDeclaration(node) ||
          ts.isSetAccessorDeclaration(node)
        ) {
          name = declarationName(node.name);
        } else if (ts.isFunctionDeclaration(node) && node.name) {
          name = node.name.text;
        } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
          name = node.name.text;
        }
        if (name && FORBIDDEN_SELF_TUNE_NAMES.has(name)) {
          violations.push({
            file,
            line: lineOf(sf, node.getStart(sf)),
            kind: 'self_tune_method',
            detail: `Unreachable self-tuning symbol ${name} must not exist in ${EVOLUTION_SERVICE_FILE}`,
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sf);
  }

  return violations;
}

describe('RR-SELFTUNE-CANDIDATE-ONLY — fail-closed self-promotion census (REC-NO-SELF-PROMOTION)', () => {
  it('allows ModelGatewayService.updatePreferences ONLY in AiController.updateAiPreferences and forbids evolution_tuning / key_self_tuning across production sources', () => {
    const violations = scanSelfPromotionViolations();
    expect(
      violations,
      violations.map((v) => `${v.file}:${v.line} [${v.kind}] ${v.detail}`).join('\n'),
    ).toEqual([]);
  });

  it('pins via AST that AiController.updateAiPreferences is the sole updatePreferences call in ai.controller.ts and retains @UseGuards, @Put, @RequireModuleScope(settings, admin), and a real CallExpression to assertBusinessOwnerMember', () => {
    const aiController = loadServerSources().find((s) => s.file === AI_CONTROLLER_FILE);
    expect(aiController).toBeDefined();
    const sf = ts.createSourceFile(aiController!.file, aiController!.text, ts.ScriptTarget.Latest, true);

    const callMethods: string[] = [];
    let updateMethod: ts.MethodDeclaration | undefined;

    const visit = (node: ts.Node): void => {
      if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === ALLOWED_AI_PREFERENCES_METHOD) {
        updateMethod = node;
      }
      if (ts.isPropertyAccessExpression(node) && node.name.text === 'updatePreferences') {
        callMethods.push(enclosingClassAndMethod(node).methodName ?? '<top>');
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);

    expect(callMethods).toEqual([ALLOWED_AI_PREFERENCES_METHOD]);
    expect(updateMethod).toBeDefined();

    const decorators = ts.canHaveDecorators(updateMethod!) ? ts.getDecorators(updateMethod!) ?? [] : [];
    const decoratorsText = decorators.map((d) => d.getText(sf)).join('\n');
    expect(decoratorsText).toContain('@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)');
    expect(decoratorsText).toContain("@Put('businesses/:businessId/ai/preferences')");
    expect(decoratorsText).toContain("@RequireModuleScope('settings', 'admin')");

    let foundOwnerAssertCall = false;
    const walkBody = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const expr = node.expression;
        if (
          (ts.isIdentifier(expr) && expr.text === 'assertBusinessOwnerMember') ||
          (ts.isPropertyAccessExpression(expr) && expr.name.text === 'assertBusinessOwnerMember')
        ) {
          foundOwnerAssertCall = true;
        }
      }
      ts.forEachChild(node, walkBody);
    };
    if (updateMethod!.body) walkBody(updateMethod!.body);
    expect(foundOwnerAssertCall).toBe(true);
  });

  it('negative controls: catches EVERY updatePreferences indirection (ModuleRef, local alias, @Inject any, (this as any), optional chaining, .call/.apply/.bind, destructuring, computed destructuring, assignment-LHS destructuring, Reflect.get / static key, internal this, wrong NotificationsAdapterService method, and another ai.controller.ts route)', () => {
    const bypassSamples: Array<[string, VirtualSource]> = [
      [
        'direct key-cortex call',
        {
          file: 'modules/key-cortex/key-cortex-evolution.service.ts',
          text: `
            import { ModelGatewayService } from '../ai/model-gateway.service';
            export class KeyCortexEvolutionService {
              constructor(private readonly gateway: ModelGatewayService) {}
              async run(b: string) { await this.gateway.updatePreferences(b, { aiMode: 'premium' }); }
            }
          `,
        },
      ],
      [
        'second route inside ai.controller.ts',
        {
          file: AI_CONTROLLER_FILE,
          text: `
            import { ModelGatewayService } from './model-gateway.service';
            export class AiController {
              constructor(private readonly gateway: ModelGatewayService) {}
              async otherRoute(b: string) { await this.gateway.updatePreferences(b, { aiMode: 'fast' }); }
            }
          `,
        },
      ],
      [
        'ModuleRef.get(ModelGatewayService)',
        {
          file: 'modules/key-cortex/foo.service.ts',
          text: `
            export class FooService {
              constructor(private readonly moduleRef: any) {}
              async run(b: string) { await this.moduleRef.get(ModelGatewayService).updatePreferences(b, {}); }
            }
          `,
        },
      ],
      [
        'local alias + @Inject(ModelGatewayService) any + optional chaining',
        {
          file: 'modules/key-cortex/bar.service.ts',
          text: `
            export class BarService {
              constructor(@Inject(ModelGatewayService) private readonly gw: any) {}
              async run(b: string) {
                const alias = this.gw;
                await alias?.updatePreferences(b, {});
              }
            }
          `,
        },
      ],
      [
        '(this as any).gateway and .call/.apply/.bind',
        {
          file: 'modules/key-cortex/baz.service.ts',
          text: `
            export class BazService {
              async run(b: string) {
                await (this as any).gateway.updatePreferences.call(this, b, {});
              }
            }
          `,
        },
      ],
      [
        'destructuring updatePreferences',
        {
          file: 'modules/key-cortex/qux.service.ts',
          text: `
            export class QuxService {
              async run(gw: any, b: string) {
                const { updatePreferences } = gw;
                await updatePreferences(b, {});
              }
            }
          `,
        },
      ],
      [
        'computed destructuring and assignment-LHS destructuring',
        {
          file: 'modules/key-cortex/destr.service.ts',
          text: `
            export class DestrService {
              async run(gw: any, b: string) {
                let fn: any;
                ({ updatePreferences: fn } = gw);
                await fn(b, {});
              }
            }
          `,
        },
      ],
      [
        'Reflect.get / indirect const key',
        {
          file: 'modules/key-cortex/refl.service.ts',
          text: `
            export class ReflService {
              async run(gw: any, b: string) {
                const k = 'update' + 'Preferences';
                await Reflect.get(gw, k).call(gw, b, {});
              }
            }
          `,
        },
      ],
      [
        'bracket access with constant concatenation',
        {
          file: 'modules/key-cortex/br.service.ts',
          text: `
            export class BrService {
              async run(gw: any, b: string) {
                await gw['update' + 'Preferences'](b, {});
              }
            }
          `,
        },
      ],
      [
        'internal this.updatePreferences inside ModelGatewayService',
        {
          file: 'modules/ai/model-gateway.service.ts',
          text: `
            export class ModelGatewayService {
              async updatePreferences(b: string, p: any) { return p; }
              async autoPromote(b: string) { return this.updatePreferences(b, { aiMode: 'premium' }); }
            }
          `,
        },
      ],
      [
        'non-execute method inside NotificationsAdapterService',
        {
          file: 'modules/key-cortex/adapters/notifications-adapter.service.ts',
          text: `
            export class NotificationsAdapterService {
              async rogue(b: string) { return this.updatePreferences(b); }
            }
          `,
        },
      ],
    ];

    for (const [label, source] of bypassSamples) {
      const hits = scanSelfPromotionViolations([source]).filter((v) => v.kind === 'updatePreferences');
      expect(hits.length, `expected updatePreferences violation for: ${label}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('negative controls: catches EVERY evolution_tuning / key_self_tuning bypass, memory-classification writer/import drift, and property/accessor/variable selfTune', () => {
    const samples: VirtualSource[] = [
      {
        file: 'modules/key-cortex/rogue-positional.service.ts',
        text: `export class A { async run(mem: any, b: string) { await mem.store(b, 'evolution_tuning', 'tone', 'bold'); } }`,
      },
      {
        file: 'modules/key-cortex/rogue-extracted.service.ts',
        text: `export class B { async run(prisma: any, b: string) { const data = { businessId: b, category: 'evolution_' + 'tuning' }; await prisma.client.aiMemory?.create({ data }); } }`,
      },
      {
        file: 'modules/key-cortex/rogue-upsert-many.service.ts',
        text: "export class C { async run(memory: any, b: string) { await memory.upsertMany(b, [{ category: `evolution_${'tuning'}`, source: `key_self_${'tuning'}` }]); } }",
      },
      {
        file: MEMORY_CLASSIFICATION_FILE,
        text: `
          import { PrismaService } from '../../core/prisma/prisma.service';
          export async function sneaky(prisma: PrismaService) {
            return prisma.client.aiMemory.create({ data: { category: 'evolution_tuning' } });
          }
        `,
      },
      {
        file: EVOLUTION_SERVICE_FILE,
        text: `
          export class KeyCortexEvolutionService {
            selfTune = async () => {};
            get ['applyTuning' + 'Adjustment']() { return null; }
          }
          const buildTuningPrompt = () => '';
        `,
      },
    ];
    const violations = scanSelfPromotionViolations(samples);
    expect(violations.map((v) => v.kind)).toEqual(
      expect.arrayContaining([
        'evolution_tuning_literal',
        'key_self_tuning_source',
        'classification_writer',
        'self_tune_method',
      ]),
    );
    expect(violations.filter((v) => v.file === 'modules/key-cortex/rogue-positional.service.ts')).toHaveLength(1);
    expect(violations.filter((v) => v.file === 'modules/key-cortex/rogue-extracted.service.ts')).toHaveLength(1);
    expect(violations.filter((v) => v.file === 'modules/key-cortex/rogue-upsert-many.service.ts')).toHaveLength(2);
    expect(
      violations.filter((v) => v.file === MEMORY_CLASSIFICATION_FILE && v.kind === 'classification_writer'),
    ).toHaveLength(2);
    expect(violations.filter((v) => v.file === EVOLUTION_SERVICE_FILE)).toHaveLength(3);
  });

  it('negative control: allowlisted notification preferences updatePreferences is not falsely flagged', () => {
    const synthetic: VirtualSource[] = [
      {
        file: 'modules/notifications/notifications.controller.ts',
        text: `
          export class NotificationsController {
            constructor(private readonly transactionalEmail: TransactionalEmailService) {}
            async updatePreferences(businessId: string, body: any) {
              return this.transactionalEmail.updatePreferences(businessId, body);
            }
          }
        `,
      },
    ];
    expect(scanSelfPromotionViolations(synthetic)).toEqual([]);
  });
});
