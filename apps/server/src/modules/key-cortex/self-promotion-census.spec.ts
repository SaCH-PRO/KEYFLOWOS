import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/**
 * RR-SELFTUNE-CANDIDATE-ONLY (REC-NO-SELF-PROMOTION, human-agency doctrine):
 *
 * Structural census pinning two invariants across every non-test server source:
 *   1. The ONLY caller of `ModelGatewayService.updatePreferences` is the
 *      owner-facing preferences route in `apps/server/src/modules/ai/ai.controller.ts`.
 *      No learning, evolution, or cortex service may mutate AI preferences
 *      autonomously from a model response.
 *   2. No production source writes an `AiMemory` row with
 *      `category: 'evolution_tuning'` or `source: 'key_self_tuning'`.
 *   3. `KeyCortexEvolutionService` does not re-introduce the unreachable
 *      `selfTune` / `applyTuningAdjustment` / `buildTuningPrompt` path.
 */

export interface VirtualSource {
  file: string;
  text: string;
}

export interface Violation {
  file: string;
  line: number;
  kind: 'updatePreferences' | 'evolution_tuning_write' | 'key_self_tuning_source' | 'self_tune_method';
  detail: string;
}

const SERVER_SRC_ROOT = path.resolve(__dirname, '../..');
const ALLOWED_UPDATE_PREFERENCES_FILE = 'modules/ai/ai.controller.ts';

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

function typeMentionsModelGateway(typeNode: ts.TypeNode | undefined): boolean {
  if (!typeNode) return false;
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(n) && n.text === 'ModelGatewayService') {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(typeNode);
  return found;
}

function collectModelGatewayIdentifiers(sf: ts.SourceFile): {
  memberNames: Set<string>;
  localNames: Set<string>;
} {
  const memberNames = new Set<string>();
  const localNames = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && typeMentionsModelGateway(node.type)) {
      const hasParamProp = (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some(
        (m) =>
          m.kind === ts.SyntaxKind.PrivateKeyword ||
          m.kind === ts.SyntaxKind.ProtectedKeyword ||
          m.kind === ts.SyntaxKind.PublicKeyword ||
          m.kind === ts.SyntaxKind.ReadonlyKeyword,
      );
      if (hasParamProp) memberNames.add(node.name.text);
      localNames.add(node.name.text);
    } else if (
      ts.isPropertyDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      typeMentionsModelGateway(node.type)
    ) {
      memberNames.add(node.name.text);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      (typeMentionsModelGateway(node.type) ||
        (node.initializer &&
          ts.isNewExpression(node.initializer) &&
          ts.isIdentifier(node.initializer.expression) &&
          node.initializer.expression.text === 'ModelGatewayService'))
    ) {
      localNames.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return { memberNames, localNames };
}

function isModelGatewayReceiver(
  expr: ts.Expression,
  ids: { memberNames: Set<string>; localNames: Set<string> },
): boolean {
  if (ts.isParenthesizedExpression(expr)) {
    return isModelGatewayReceiver(expr.expression, ids);
  }
  if (ts.isAsExpression(expr) || ts.isNonNullExpression(expr) || ts.isTypeAssertionExpression(expr)) {
    return isModelGatewayReceiver(expr.expression, ids);
  }
  if (ts.isPropertyAccessExpression(expr) && expr.expression.kind === ts.SyntaxKind.ThisKeyword) {
    return ids.memberNames.has(expr.name.text);
  }
  if (ts.isIdentifier(expr)) {
    return ids.localNames.has(expr.text);
  }
  return false;
}

function getCalledMethodName(callee: ts.Expression): {
  receiver: ts.Expression;
  methodName: string;
} | null {
  if (ts.isPropertyAccessExpression(callee)) {
    return { receiver: callee.expression, methodName: callee.name.text };
  }
  if (
    ts.isElementAccessExpression(callee) &&
    callee.argumentExpression &&
    ts.isStringLiteralLike(callee.argumentExpression)
  ) {
    return { receiver: callee.expression, methodName: callee.argumentExpression.text };
  }
  return null;
}

function isEnclosingAiMemoryWrite(node: ts.Node): boolean {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (ts.isCallExpression(cur)) {
      const text = cur.expression.getText();
      if (
        /upsertAiMemoryDroppingStaleCopies\b/.test(text) ||
        /aiMemory\.(?:create|createMany|upsert|update|updateMany)\b/.test(text) ||
        /(?:memory|memoryService|keyCortexMemory)\.(?:store|upsert|save|create|set)\b/i.test(text)
      ) {
        return true;
      }
    }
    cur = cur.parent;
  }
  return false;
}

export function scanSelfPromotionViolations(
  sources: readonly VirtualSource[] = loadServerSources(),
): Violation[] {
  const violations: Violation[] = [];

  for (const { file, text } of sources) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const gatewayIds = collectModelGatewayIdentifiers(sf);

    const visit = (node: ts.Node): void => {
      // 1. ModelGatewayService.updatePreferences calls outside ai.controller.ts
      if (ts.isCallExpression(node)) {
        const call = getCalledMethodName(node.expression);
        if (
          call &&
          call.methodName === 'updatePreferences' &&
          file !== ALLOWED_UPDATE_PREFERENCES_FILE &&
          isModelGatewayReceiver(call.receiver, gatewayIds)
        ) {
          violations.push({
            file,
            line: lineOf(sf, node.getStart(sf)),
            kind: 'updatePreferences',
            detail: `ModelGatewayService.updatePreferences called via ${call.receiver.getText(sf)} outside ${ALLOWED_UPDATE_PREFERENCES_FILE}`,
          });
        }
      }

      // 2a. Any string literal 'key_self_tuning' in production source
      if (ts.isStringLiteralLike(node) && node.text === 'key_self_tuning') {
        violations.push({
          file,
          line: lineOf(sf, node.getStart(sf)),
          kind: 'key_self_tuning_source',
          detail: `AiMemory source 'key_self_tuning' is forbidden in production sources`,
        });
      }

      // 2b. Any AiMemory write with category 'evolution_tuning'
      if (
        ts.isPropertyAssignment(node) &&
        ((ts.isIdentifier(node.name) && node.name.text === 'category') ||
          (ts.isStringLiteralLike(node.name) && node.name.text === 'category')) &&
        ts.isStringLiteralLike(node.initializer) &&
        node.initializer.text === 'evolution_tuning' &&
        isEnclosingAiMemoryWrite(node)
      ) {
        violations.push({
          file,
          line: lineOf(sf, node.getStart(sf)),
          kind: 'evolution_tuning_write',
          detail: `AiMemory write with category 'evolution_tuning' is forbidden`,
        });
      }

      // 3. Deleted self-tuning methods in KeyCortexEvolutionService
      if (
        file === 'modules/key-cortex/key-cortex-evolution.service.ts' &&
        ts.isMethodDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        (node.name.text === 'selfTune' ||
          node.name.text === 'applyTuningAdjustment' ||
          node.name.text === 'buildTuningPrompt')
      ) {
        violations.push({
          file,
          line: lineOf(sf, node.getStart(sf)),
          kind: 'self_tune_method',
          detail: `Unreachable self-tuning method ${node.name.text} must not exist on KeyCortexEvolutionService`,
        });
      }

      ts.forEachChild(node, visit);
    };

    visit(sf);
  }

  return violations;
}

describe('RR-SELFTUNE-CANDIDATE-ONLY — self-promotion census (REC-NO-SELF-PROMOTION)', () => {
  it('allows ModelGatewayService.updatePreferences ONLY in ai.controller.ts and forbids evolution_tuning / key_self_tuning AiMemory writes', () => {
    const violations = scanSelfPromotionViolations();
    expect(
      violations,
      violations.map((v) => `${v.file}:${v.line} [${v.kind}] ${v.detail}`).join('\n'),
    ).toEqual([]);
  });

  it('pins that ai.controller.ts retains the owner-facing ModelGatewayService.updatePreferences route', () => {
    const aiController = loadServerSources().find((s) => s.file === ALLOWED_UPDATE_PREFERENCES_FILE);
    expect(aiController).toBeDefined();
    expect(aiController!.text).toMatch(/this\.gateway\.updatePreferences\(/);
  });

  it('negative control: re-adding gateway.updatePreferences in a key-cortex service fails the census', () => {
    const synthetic: VirtualSource[] = [
      {
        file: 'modules/key-cortex/key-cortex-evolution.service.ts',
        text: `
          import { ModelGatewayService } from '../ai/model-gateway.service';
          export class KeyCortexEvolutionService {
            constructor(private readonly gateway: ModelGatewayService) {}
            async promote(businessId: string) {
              await this.gateway.updatePreferences(businessId, { aiMode: 'premium' });
            }
          }
        `,
      },
    ];
    const violations = scanSelfPromotionViolations(synthetic);
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('updatePreferences');
    expect(violations[0].file).toBe('modules/key-cortex/key-cortex-evolution.service.ts');
  });

  it('negative control: writing AiMemory with category evolution_tuning or source key_self_tuning fails the census', () => {
    const synthetic: VirtualSource[] = [
      {
        file: 'modules/key-cortex/rogue-tuning.service.ts',
        text: `
          export class RogueTuningService {
            async run(prisma: any, businessId: string) {
              await prisma.client.aiMemory.create({
                data: { businessId, category: 'evolution_tuning', key: 'tone', value: 'bold', source: 'key_self_tuning' },
              });
            }
          }
        `,
      },
    ];
    const violations = scanSelfPromotionViolations(synthetic);
    expect(violations.map((v) => v.kind).sort()).toEqual([
      'evolution_tuning_write',
      'key_self_tuning_source',
    ]);
  });

  it('negative control: notification preferences updatePreferences (non-ModelGatewayService) is not falsely flagged', () => {
    const synthetic: VirtualSource[] = [
      {
        file: 'modules/notifications/notifications.controller.ts',
        text: `
          export class NotificationsController {
            constructor(private readonly transactionalEmail: TransactionalEmailService) {}
            async save(businessId: string, body: any) {
              return this.transactionalEmail.updatePreferences(businessId, body);
            }
          }
        `,
      },
    ];
    expect(scanSelfPromotionViolations(synthetic)).toEqual([]);
  });
});
