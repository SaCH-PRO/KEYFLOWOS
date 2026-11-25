/**
 * W11-QUERY-DTO-COERCION (P75, BUG-011):
 *
 * Production runs `new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS)` with
 * `{ whitelist: true, transform: true }` and NO `enableImplicitConversion`.
 * Express delivers every query-string parameter as a `string`, so any
 * whole-object `@Query()` DTO class with a numeric or boolean class-validator
 * constraint (`@IsInt`, `@IsNumber`, `@Min`, `@Max`, `@IsPositive`,
 * `@IsNegative`, `@IsBoolean`) and no `@Type(...)` / `@Transform(...)` refuses
 * EVERY query string with HTTP 400 in production — and `@Type(() => Boolean)`
 * silently coerces `'false'` to `true`.
 *
 * This census walks every `*.controller.ts` under `apps/server/src` with the
 * TypeScript compiler API, discovers every whole-object `@Query()` parameter
 * (including aliased `Query` imports and `@Query(Pipe)` calls whose first arg
 * is not a string literal), resolves its DTO class (including aliased imports),
 * and pushes valid stringified query values for every numeric/boolean-constrained
 * property (including BOTH `'true'` -> `true` and `'false'` -> `false` for
 * booleans) through `new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS)`.
 * Non-class (`interface` / `Record` / untyped) whole-object `@Query()` params
 * are pinned to an exact allowlist so any new one is caught.
 */
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Type } from 'class-transformer';
import { getMetadataStorage, IsBoolean, IsInt } from 'class-validator';
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../app-bootstrap';

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

export interface DiscoveredQueryParam {
  relFile: string;
  absFile: string;
  methodName: string;
  typeName: string;
  exportName: string;
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

/**
 * Parse a single TypeScript controller source and discover every whole-object
 * `@Query()` parameter (no argument, OR first argument is not a string literal,
 * e.g. `@Query(ValidationPipe)` or `@Query(undefined, SomePipe)`), respecting
 * aliased `import { Query as ... } from '@nestjs/common'`.
 */
export function discoverWholeObjectQueryParamsInSource(
  absFile: string,
  relFile: string,
  src: string,
): DiscoveredQueryParam[] {
  const results: DiscoveredQueryParam[] = [];
  const sf = ts.createSourceFile(absFile, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const importMap = new Map<string, { resolvedPath: string | null; exportName: string }>();
  const queryDecoratorNames = new Set<string>();
  const localClassNames = new Set<string>();
  const localInterfaceNames = new Set<string>();

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const spec = stmt.moduleSpecifier.text;
      const resolved = resolveImportTarget(absFile, spec);
      const bindings = stmt.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          const exported = (el.propertyName ?? el.name).text;
          importMap.set(el.name.text, { resolvedPath: resolved, exportName: exported });
          if (spec === '@nestjs/common' && exported === 'Query') {
            queryDecoratorNames.add(el.name.text);
          }
        }
      }
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      localClassNames.add(stmt.name.text);
    } else if (ts.isInterfaceDeclaration(stmt)) {
      localInterfaceNames.add(stmt.name.text);
    }
  }

  // Fallback for synthetic snippets or namespace-less tests where `@Query` is used directly.
  if (queryDecoratorNames.size === 0) {
    queryDecoratorNames.add('Query');
  }

  const visit = (node: ts.Node) => {
    if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      const methodName = node.name.text;
      for (const param of node.parameters) {
        const decorators = ts.canHaveDecorators(param) ? ts.getDecorators(param) : undefined;
        if (!decorators) continue;
        const hasWholeObjectQuery = decorators.some((dec) => {
          if (!ts.isCallExpression(dec.expression)) return false;
          const expr = dec.expression.expression;
          if (!ts.isIdentifier(expr) || !queryDecoratorNames.has(expr.text)) return false;
          if (dec.expression.arguments.length === 0) return true;
          const firstArg = dec.expression.arguments[0];
          return !ts.isStringLiteral(firstArg) && !ts.isNoSubstitutionTemplateLiteral(firstArg);
        });
        if (!hasWholeObjectQuery) continue;

        if (!param.type) {
          results.push({
            relFile,
            absFile,
            methodName,
            typeName: '<untyped>',
            exportName: '<untyped>',
            resolvedImportPath: null,
          });
          continue;
        }

        const typeText = param.type.getText(sf).trim();
        let resolvedImportPath: string | null = null;
        let exportName = typeText;
        if (ts.isTypeReferenceNode(param.type) && ts.isIdentifier(param.type.typeName)) {
          const sym = param.type.typeName.text;
          if (localClassNames.has(sym) || localInterfaceNames.has(sym)) {
            resolvedImportPath = absFile;
            exportName = sym;
          } else if (importMap.has(sym)) {
            const entry = importMap.get(sym)!;
            resolvedImportPath = entry.resolvedPath;
            exportName = entry.exportName;
          }
        }
        results.push({
          relFile,
          absFile,
          methodName,
          typeName: typeText,
          exportName,
          resolvedImportPath,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return results;
}

function discoverWholeObjectQueryParams(): DiscoveredQueryParam[] {
  const results: DiscoveredQueryParam[] = [];
  for (const absFile of walkControllers(SERVER_SRC_ROOT)) {
    const relFile = path.relative(SERVER_SRC_ROOT, absFile).split(path.sep).join('/');
    const src = fs.readFileSync(absFile, 'utf8');
    results.push(...discoverWholeObjectQueryParamsInSource(absFile, relFile, src));
  }
  return results;
}

function sampleNumericString(
  metadatas: ReturnType<ReturnType<typeof getMetadataStorage>['getTargetValidationMetadatas']>,
): string {
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

  if (mustBeNeg) {
    return maxVal !== undefined ? String(Math.min(-1, Math.floor(maxVal))) : '-1';
  }
  if (minVal !== undefined && maxVal !== undefined) {
    return String(Math.ceil((minVal + maxVal) / 2));
  }
  if (minVal !== undefined) return String(Math.max(1, Math.ceil(minVal)));
  if (maxVal !== undefined) return String(Math.min(1, Math.floor(maxVal)));
  return '10';
}

async function checkDtoCoercion(
  dtoCtor: new () => Record<string, unknown>,
  label: string,
  pipe: ValidationPipe,
): Promise<{ checkedProps: number; failures: string[] }> {
  const metadataStorage = getMetadataStorage();
  const metadatas = metadataStorage.getTargetValidationMetadatas(dtoCtor, '', false, false);
  const byProp = new Map<string, typeof metadatas>();
  for (const m of metadatas) {
    const list = byProp.get(m.propertyName) ?? [];
    list.push(m);
    byProp.set(m.propertyName, list);
  }

  let checkedProps = 0;
  const failures: string[] = [];

  for (const [prop, propMetas] of byProp.entries()) {
    const isNumeric = propMetas.some((m) => m.name && NUMERIC_CONSTRAINTS.has(m.name));
    const isBool = propMetas.some((m) => m.name && BOOLEAN_CONSTRAINTS.has(m.name));
    if (!isNumeric && !isBool) continue;

    checkedProps += 1;

    if (isNumeric) {
      const rawValue = sampleNumericString(propMetas);
      try {
        const transformed = (await pipe.transform(
          { [prop]: rawValue },
          { type: 'query', metatype: dtoCtor },
        )) as Record<string, unknown>;
        if (typeof transformed[prop] !== 'number' || Number.isNaN(transformed[prop])) {
          failures.push(
            `${label}.${prop}: expected number from "${rawValue}", got ${typeof transformed[prop]} (${JSON.stringify(transformed[prop])})`,
          );
        }
      } catch (err: unknown) {
        const detail =
          err && typeof err === 'object' && 'getResponse' in err && typeof (err as { getResponse: () => unknown }).getResponse === 'function'
            ? JSON.stringify((err as { getResponse: () => unknown }).getResponse())
            : String(err);
        failures.push(`${label}.${prop}: rejected "${rawValue}" -> ${detail}`);
      }
    } else if (isBool) {
      // Probe BOTH 'true' -> true and 'false' -> false to catch `@Type(() => Boolean)`,
      // which maps Boolean('false') === true in JavaScript.
      for (const [rawValue, expectedBool] of [
        ['true', true],
        ['false', false],
      ] as const) {
        try {
          const transformed = (await pipe.transform(
            { [prop]: rawValue },
            { type: 'query', metatype: dtoCtor },
          )) as Record<string, unknown>;
          if (transformed[prop] !== expectedBool) {
            failures.push(
              `${label}.${prop}: expected boolean ${expectedBool} from "${rawValue}", got ${typeof transformed[prop]} (${JSON.stringify(transformed[prop])})`,
            );
          }
        } catch (err: unknown) {
          const detail =
            err && typeof err === 'object' && 'getResponse' in err && typeof (err as { getResponse: () => unknown }).getResponse === 'function'
              ? JSON.stringify((err as { getResponse: () => unknown }).getResponse())
              : String(err);
          failures.push(`${label}.${prop}: rejected "${rawValue}" -> ${detail}`);
        }
      }
    }
  }

  return { checkedProps, failures };
}

describe('W11-QUERY-DTO-COERCION (P75, BUG-011): production ValidationPipe query DTO coercion census', () => {
  it('[QDC-01] RED-BEFORE: app-bootstrap exports GLOBAL_VALIDATION_PIPE_OPTIONS matching production { whitelist: true, transform: true }', () => {
    expect(GLOBAL_VALIDATION_PIPE_OPTIONS).toEqual({ whitelist: true, transform: true });
  });

  it('[QDC-02] RED-BEFORE: every whole-object @Query() DTO class coerces numeric & boolean query strings under the production ValidationPipe, and non-class params match the exact allowlist', async () => {
    const discovered = discoverWholeObjectQueryParams();
    expect(discovered.length, 'census must discover real @Query() controller params').toBeGreaterThanOrEqual(14);

    const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
    const nonClassSeen: string[] = [];
    const coercionFailures: string[] = [];
    let checkedProps = 0;

    for (const item of discovered) {
      let dtoCtor: (new () => Record<string, unknown>) | null = null;
      if (item.resolvedImportPath) {
        const mod = (await import(item.resolvedImportPath)) as Record<string, unknown>;
        const candidate = mod[item.exportName];
        if (typeof candidate === 'function') {
          dtoCtor = candidate as new () => Record<string, unknown>;
        }
      }

      if (!dtoCtor) {
        nonClassSeen.push(`${item.relFile}::${item.methodName}::${item.typeName}`);
        continue;
      }

      const res = await checkDtoCoercion(
        dtoCtor,
        `${item.typeName} (${item.relFile}:${item.methodName})`,
        pipe,
      );
      checkedProps += res.checkedProps;
      coercionFailures.push(...res.failures);
    }

    expect(checkedProps, 'census must verify numeric/boolean properties across real DTOs').toBeGreaterThanOrEqual(10);
    expect(nonClassSeen.sort()).toEqual([...ALLOWED_NON_CLASS_QUERY_PARAMS].sort());
    expect(coercionFailures).toEqual([]);
  }, 60_000);

  it('[QDC-03] negative controls: uncoerced @IsInt DTO rejects under production pipe, @Type(() => Boolean) fails "false" -> false, and aliased @Query(Pipe) / untyped @Query() are discovered', async () => {
    const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);

    class UncoercedIntDto {
      @IsInt()
      count?: number;
    }

    // Proves enableImplicitConversion is NOT enabled on GLOBAL_VALIDATION_PIPE_OPTIONS.
    await expect(
      pipe.transform({ count: '10' }, { type: 'query', metatype: UncoercedIntDto }),
    ).rejects.toThrow(BadRequestException);
    const intCheck = await checkDtoCoercion(UncoercedIntDto as unknown as new () => Record<string, unknown>, 'UncoercedIntDto', pipe);
    expect(intCheck.failures).toHaveLength(1);

    class BrokenBooleanDto {
      @Type(() => Boolean)
      @IsBoolean()
      flag?: boolean;
    }

    // Proves `@Type(() => Boolean)` (which maps 'false' -> true) is caught by the census.
    const boolCheck = await checkDtoCoercion(BrokenBooleanDto as unknown as new () => Record<string, unknown>, 'BrokenBooleanDto', pipe);
    expect(boolCheck.failures).toHaveLength(1);
    expect(boolCheck.failures[0]).toContain('expected boolean false from "false"');

    // Proves aliased Query import, `@Query(Pipe)`, and untyped `@Query()` are discovered while primitive `@Query('id')` is ignored.
    const syntheticController = `
      import { Controller, Get, Query as NestQuery } from '@nestjs/common';
      import { FooDto as LocalFoo } from './foo.dto';
      @Controller('x')
      export class XController {
        @Get('a')
        a(@NestQuery(SomePipe) q: LocalFoo) { return q; }
        @Get('b')
        b(@NestQuery(undefined, SomePipe) q) { return q; }
        @Get('c')
        c(@NestQuery('page') page: string) { return page; }
      }
    `;
    const found = discoverWholeObjectQueryParamsInSource('/virtual/x.controller.ts', 'x.controller.ts', syntheticController);
    expect(found.map((f) => `${f.methodName}:${f.typeName}:${f.exportName}`)).toEqual([
      'a:LocalFoo:FooDto',
      'b:<untyped>:<untyped>',
    ]);
  });
});
