/**
 * W11-QUERY-DTO-COERCION (P75, BUG-011):
 *
 * Production runs `new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS)` with
 * `{ whitelist: true, transform: true }` and NO `enableImplicitConversion`.
 * Express delivers every query-string parameter as a `string`, so any
 * whole-object `@Query()` DTO class with a numeric or boolean class-validator
 * constraint (`@IsInt`, `@IsNumber`, `@Min`, `@Max`, `@IsPositive`,
 * `@IsNegative`, `@IsBoolean`) and no `@Type(...)` / `@Transform(...)` refuses
 * EVERY query string with HTTP 400 in production.
 *
 * This census walks every `*.controller.ts` under `apps/server/src` with the
 * TypeScript compiler API, discovers every whole-object `@Query()` parameter
 * (no argument), resolves its DTO class, and pushes a valid stringified query
 * value for every numeric/boolean-constrained property through the exact
 * production `ValidationPipe`. Non-class (`interface` / `Record`) whole-object
 * `@Query()` params are pinned to an exact allowlist so any new one is caught.
 */
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import { getMetadataStorage } from 'class-validator';
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import * as appBootstrap from '../../app-bootstrap';

const SERVER_SRC_ROOT = path.resolve(__dirname, '../..');

const NUMERIC_CONSTRAINTS = new Set([
  'isInt',
  'isNumber',
  'min',
  'max',
  'isPositive',
  'isNegative',
]);

const BOOLEAN_CONSTRAINTS = new Set(['isBoolean']);

/**
 * Exact allowlist of non-class whole-object `@Query()` params (interfaces or
 * `Record<string, string>`). Any new entry fails the census so its coercion
 * strategy is explicitly audited.
 */
const ALLOWED_NON_CLASS_QUERY_PARAMS = new Set([
  'modules/ai/ai-approvals.controller.ts::listItems::ListAiApprovalsQuery',
  'modules/payments/payments.controller.ts::handleWipayCallback::Record<string, string>',
]);

interface DiscoveredQueryParam {
  relFile: string;
  absFile: string;
  methodName: string;
  typeName: string;
  resolvedImportPath: string | null;
}

function walkControllers(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...walkControllers(full));
    } else if (entry.isFile() && entry.name.endsWith('.controller.ts')) {
      out.push(full);
    }
  }
  return out.sort();
}

function resolveImportTarget(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [
    `${base}.ts`,
    path.join(base, 'index.ts'),
    base.replace(/\.js$/, '.ts'),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

function discoverWholeObjectQueryParams(): DiscoveredQueryParam[] {
  const results: DiscoveredQueryParam[] = [];
  for (const absFile of walkControllers(SERVER_SRC_ROOT)) {
    const relFile = path.relative(SERVER_SRC_ROOT, absFile).split(path.sep).join('/');
    const src = fs.readFileSync(absFile, 'utf8');
    const sf = ts.createSourceFile(absFile, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    const importMap = new Map<string, string | null>();
    const localClassNames = new Set<string>();
    const localInterfaceNames = new Set<string>();

    for (const stmt of sf.statements) {
      if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const spec = stmt.moduleSpecifier.text;
        const resolved = resolveImportTarget(absFile, spec);
        const bindings = stmt.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) {
            importMap.set(el.name.text, resolved);
          }
        }
      } else if (ts.isClassDeclaration(stmt) && stmt.name) {
        localClassNames.add(stmt.name.text);
      } else if (ts.isInterfaceDeclaration(stmt)) {
        localInterfaceNames.add(stmt.name.text);
      }
    }

    const visit = (node: ts.Node) => {
      if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
        const methodName = node.name.text;
        for (const param of node.parameters) {
          const decorators = ts.canHaveDecorators(param) ? ts.getDecorators(param) : undefined;
          if (!decorators) continue;
          const hasBareQuery = decorators.some((dec) => {
            if (!ts.isCallExpression(dec.expression)) return false;
            const expr = dec.expression.expression;
            if (!ts.isIdentifier(expr) || expr.text !== 'Query') return false;
            return dec.expression.arguments.length === 0;
          });
          if (!hasBareQuery || !param.type) continue;

          const typeText = param.type.getText(sf).trim();
          let resolvedImportPath: string | null = null;
          if (ts.isTypeReferenceNode(param.type) && ts.isIdentifier(param.type.typeName)) {
            const sym = param.type.typeName.text;
            if (localClassNames.has(sym) || localInterfaceNames.has(sym)) {
              resolvedImportPath = absFile;
            } else if (importMap.has(sym)) {
              resolvedImportPath = importMap.get(sym) ?? null;
            }
          }
          results.push({
            relFile,
            absFile,
            methodName,
            typeName: typeText,
            resolvedImportPath,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return results;
}

function sampleNumericString(metadatas: ReturnType<ReturnType<typeof getMetadataStorage>['getTargetValidationMetadatas']>): string {
  let minVal: number | undefined;
  let maxVal: number | undefined;
  let mustBeNeg = false;

  for (const m of metadatas) {
    if (m.name === 'min' && typeof m.constraints?.[0] === 'number') {
      minVal = minVal === undefined ? m.constraints[0] : Math.max(minVal, m.constraints[0]);
    }
    if (m.name === 'max' && typeof m.constraints?.[0] === 'number') {
      maxVal = maxVal === undefined ? m.constraints[0] : Math.min(maxVal, m.constraints[0]);
    }
    if (m.name === 'isPositive') {
      minVal = minVal === undefined ? 1 : Math.max(minVal, 1);
    }
    if (m.name === 'isNegative') {
      mustBeNeg = true;
    }
  }

  if (mustBeNeg) return '-1';
  if (minVal !== undefined && maxVal !== undefined) {
    return String(Math.ceil((minVal + maxVal) / 2));
  }
  if (minVal !== undefined) return String(Math.max(1, Math.ceil(minVal)));
  if (maxVal !== undefined) return String(Math.min(1, Math.floor(maxVal)));
  return '10';
}

describe('W11-QUERY-DTO-COERCION (P75, BUG-011): production ValidationPipe query DTO coercion census', () => {
  it('[QDC-01] RED-BEFORE: app-bootstrap exports GLOBAL_VALIDATION_PIPE_OPTIONS matching production { whitelist: true, transform: true }', () => {
    const exported = (appBootstrap as Record<string, unknown>).GLOBAL_VALIDATION_PIPE_OPTIONS;
    expect(exported).toEqual({ whitelist: true, transform: true });
  });

  it('[QDC-02] RED-BEFORE: every whole-object @Query() DTO class coerces numeric & boolean query strings under the production ValidationPipe, and non-class params match the exact allowlist', async () => {
    const discovered = discoverWholeObjectQueryParams();
    expect(discovered.length, 'census must discover real @Query() controller params').toBeGreaterThanOrEqual(14);

    const pipeOptions =
      ((appBootstrap as Record<string, unknown>).GLOBAL_VALIDATION_PIPE_OPTIONS as
        | { whitelist: true; transform: true }
        | undefined) ?? { whitelist: true, transform: true };
    const pipe = new ValidationPipe(pipeOptions);
    const metadataStorage = getMetadataStorage();

    const nonClassSeen: string[] = [];
    const coercionFailures: string[] = [];
    let checkedProps = 0;

    for (const item of discovered) {
      let dtoCtor: (new () => Record<string, unknown>) | null = null;
      if (item.resolvedImportPath) {
        const mod = (await import(item.resolvedImportPath)) as Record<string, unknown>;
        const candidate = mod[item.typeName];
        if (typeof candidate === 'function') {
          dtoCtor = candidate as new () => Record<string, unknown>;
        }
      }

      if (!dtoCtor) {
        nonClassSeen.push(`${item.relFile}::${item.methodName}::${item.typeName}`);
        continue;
      }

      const metadatas = metadataStorage.getTargetValidationMetadatas(dtoCtor, '', false, false);
      const byProp = new Map<string, typeof metadatas>();
      for (const m of metadatas) {
        const list = byProp.get(m.propertyName) ?? [];
        list.push(m);
        byProp.set(m.propertyName, list);
      }

      for (const [prop, propMetas] of byProp.entries()) {
        const isNumeric = propMetas.some((m) => m.name && NUMERIC_CONSTRAINTS.has(m.name));
        const isBool = propMetas.some((m) => m.name && BOOLEAN_CONSTRAINTS.has(m.name));
        if (!isNumeric && !isBool) continue;

        checkedProps += 1;
        const rawValue = isNumeric ? sampleNumericString(propMetas) : 'true';
        const expectedType = isNumeric ? 'number' : 'boolean';

        try {
          const transformed = (await pipe.transform(
            { [prop]: rawValue },
            { type: 'query', metatype: dtoCtor },
          )) as Record<string, unknown>;
          if (typeof transformed[prop] !== expectedType) {
            coercionFailures.push(
              `${item.typeName}.${prop} (${item.relFile}:${item.methodName}): expected ${expectedType} from "${rawValue}", got ${typeof transformed[prop]} (${JSON.stringify(transformed[prop])})`,
            );
          }
        } catch (err: unknown) {
          const detail =
            err && typeof err === 'object' && 'getResponse' in err && typeof (err as { getResponse: () => unknown }).getResponse === 'function'
              ? JSON.stringify((err as { getResponse: () => unknown }).getResponse())
              : String(err);
          coercionFailures.push(
            `${item.typeName}.${prop} (${item.relFile}:${item.methodName}): rejected "${rawValue}" -> ${detail}`,
          );
        }
      }
    }

    expect(checkedProps, 'census must verify numeric/boolean properties across real DTOs').toBeGreaterThanOrEqual(10);
    expect(nonClassSeen.sort()).toEqual([...ALLOWED_NON_CLASS_QUERY_PARAMS].sort());
    expect(coercionFailures).toEqual([]);
  }, 60_000);
});
