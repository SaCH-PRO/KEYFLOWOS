/**
 * FU-NMS-SERVER-METADATA (D-179, D-263):
 * Runtime/compiled verification of every server route cited by NAV-A1's
 * `apps/web/src/lib/__tests__/nav-member-scope.spec.ts` (`NMS-18` / `MODULE_TABLE`).
 *
 * Closes the three documented limits of `NMS-18`'s source-text check:
 *   1. Scopes attached by an imported/composed decorator defined in another file.
 *   2. Metadata written dynamically via `Reflect.defineMetadata` at module load time.
 *   3. `ModuleScopeGuard` subclasses whose body could weaken enforcement (verified
 *      both via prototype chain AND by executing `canActivate` against a denied
 *      non-owner member).
 *
 * Reads `MODULE_TABLE` directly from `apps/web/src/lib/__tests__/nav-member-scope.spec.ts`
 * via the TypeScript compiler API, dynamically imports every cited compiled controller
 * under `apps/server/src/`, and inspects live NestJS reflection metadata
 * (`PATH_METADATA`, `METHOD_METADATA`, `GUARDS_METADATA`, `MODULE_SCOPE_KEY`,
 * `MODULE_SCOPE_ALTERNATIVES_KEY`).
 */
import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, it, expect } from 'vitest';
import {
  Controller,
  ForbiddenException,
  Get,
  RequestMethod,
  SetMetadata,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import {
  MODULE_SCOPE_ALTERNATIVES_KEY,
  MODULE_SCOPE_KEY,
  ModuleScopeGuard,
  RequireModuleScope,
  type ModuleScopeRequirement,
} from '../auth/module-scope.guard';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SERVER_SRC = path.resolve(__dirname, '../..');
const WEB_NMS_SPEC = path.join(
  REPO_ROOT,
  'apps/web/src/lib/__tests__/nav-member-scope.spec.ts',
);

interface NavTableRow {
  href: string;
  modules: string[];
  cite: string[];
}

interface ParsedRouteCitation {
  kind: 'scoped' | 'unscoped' | 'service-check';
  relFile: string;
  className?: string;
  routePath: string;
  raw: string;
}

interface CompiledRouteRecord {
  controllerName: string;
  controllerClass: Function;
  methodName: string;
  handler: Function;
  httpMethod: RequestMethod;
  methodPath: string;
  fullPath: string;
  primaryScope: ModuleScopeRequirement | undefined;
  alternativeScopes: ModuleScopeRequirement[];
  classScope: ModuleScopeRequirement | undefined;
  guards: unknown[];
}

function unparen(node: ts.Expression): ts.Expression {
  let cur = node;
  while (ts.isParenthesizedExpression(cur)) cur = cur.expression;
  return cur;
}

function evalStringExpr(expr: ts.Expression): string | null {
  const e = unparen(expr);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
    return e.text;
  }
  if (
    ts.isCallExpression(e) &&
    ts.isIdentifier(e.expression) &&
    e.expression.text === 'SRV' &&
    e.arguments.length === 2
  ) {
    const fileArg = evalStringExpr(e.arguments[0]);
    const routeArg = evalStringExpr(e.arguments[1]);
    if (fileArg !== null && routeArg !== null) {
      return `modules/${fileArg}#${routeArg}`;
    }
  }
  return null;
}

function evalStringArray(expr: ts.Expression): string[] | null {
  const e = unparen(expr);
  if (!ts.isArrayLiteralExpression(e)) return null;
  const out: string[] = [];
  for (const el of e.elements) {
    const val = evalStringExpr(el);
    if (val === null) return null;
    out.push(val);
  }
  return out;
}

/**
 * Extracts `MODULE_TABLE` from `apps/web/src/lib/__tests__/nav-member-scope.spec.ts`
 * via the TypeScript parser, failing closed on any unreadable entry.
 */
function loadNavModuleTable(): NavTableRow[] {
  const src = fs.readFileSync(WEB_NMS_SPEC, 'utf8');
  const sf = ts.createSourceFile(WEB_NMS_SPEC, src, ts.ScriptTarget.Latest, true);

  let tableInit: ts.ObjectLiteralExpression | null = null;
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const decl of st.declarationList.declarations) {
      if (
        ts.isIdentifier(decl.name) &&
        decl.name.text === 'MODULE_TABLE' &&
        decl.initializer
      ) {
        const init = unparen(decl.initializer);
        if (ts.isObjectLiteralExpression(init)) {
          tableInit = init;
        }
      }
    }
  }
  if (!tableInit) {
    throw new Error(`Could not locate MODULE_TABLE object literal in ${WEB_NMS_SPEC}`);
  }

  const rows: NavTableRow[] = [];
  for (const prop of tableInit.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      throw new Error(`Unreadable MODULE_TABLE property: ${prop.getText(sf)}`);
    }
    const href =
      ts.isStringLiteral(prop.name) || ts.isNoSubstitutionTemplateLiteral(prop.name)
        ? prop.name.text
        : null;
    if (!href) {
      throw new Error(`Unreadable MODULE_TABLE key: ${prop.name.getText(sf)}`);
    }
    const val = unparen(prop.initializer);
    if (!ts.isObjectLiteralExpression(val)) {
      throw new Error(`Unreadable MODULE_TABLE value for ${href}`);
    }
    let modules: string[] | null = null;
    let cite: string[] | null = null;
    for (const field of val.properties) {
      if (!ts.isPropertyAssignment(field) || !ts.isIdentifier(field.name)) {
        throw new Error(`Unreadable field in MODULE_TABLE[${href}]: ${field.getText(sf)}`);
      }
      if (field.name.text === 'modules') modules = evalStringArray(field.initializer);
      if (field.name.text === 'cite') cite = evalStringArray(field.initializer);
    }
    if (!modules || !cite) {
      throw new Error(`Missing readable modules or cite array in MODULE_TABLE[${href}]`);
    }
    rows.push({ href, modules, cite });
  }
  return rows;
}

const NON_ROUTE_CITE_RE = /^(hub:|data:|D-\d+|tracked:)/;

function parseRouteCitation(raw: string): ParsedRouteCitation | null {
  if (NON_ROUTE_CITE_RE.test(raw)) return null;

  let kind: ParsedRouteCitation['kind'] = 'scoped';
  let body = raw;
  if (raw.startsWith('unscoped:')) {
    kind = 'unscoped';
    body = raw.slice('unscoped:'.length);
  } else if (raw.startsWith('service-check:')) {
    kind = 'service-check';
    body = raw.slice('service-check:'.length);
  }

  const m = /^((?:modules|core)\/[^#]+\.ts)#(?:([A-Za-z0-9_]+)\s+)?GET\s*(.*)$/.exec(body);
  if (!m) {
    throw new Error(`Unrecognized citation format in MODULE_TABLE: ${JSON.stringify(raw)}`);
  }
  return {
    kind,
    relFile: m[1],
    className: m[2] || undefined,
    routePath: m[3].trim(),
    raw,
  };
}

function normalizePath(p: string): string {
  const cleaned = p.replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
  return cleaned;
}

function joinPaths(prefix: string, methodPath: string): string {
  const a = normalizePath(prefix);
  const b = normalizePath(methodPath);
  if (!a) return b;
  if (!b) return a;
  return `${a}/${b}`;
}

function pathSegments(p: string): string[] {
  const n = normalizePath(p);
  return n ? n.split('/') : [];
}

function shadowsRoute(earlierFullPath: string, citedFullPath: string): boolean {
  const eSegs = pathSegments(earlierFullPath);
  const cSegs = pathSegments(citedFullPath);
  if (eSegs.length !== cSegs.length) return false;
  return eSegs.every((seg, i) => seg.startsWith(':') || seg === cSegs[i]);
}

function extractCompiledRoutes(mod: Record<string, unknown>): CompiledRouteRecord[] {
  const records: CompiledRouteRecord[] = [];
  for (const [exportName, exported] of Object.entries(mod)) {
    if (typeof exported !== 'function') continue;
    const rawPrefix = Reflect.getMetadata(PATH_METADATA, exported);
    if (rawPrefix === undefined) continue;

    const prefixes = Array.isArray(rawPrefix) ? rawPrefix : [String(rawPrefix)];
    const classGuards: unknown[] =
      (Reflect.getMetadata(GUARDS_METADATA, exported) as unknown[] | undefined) ?? [];
    const classScope = Reflect.getMetadata(MODULE_SCOPE_KEY, exported) as
      | ModuleScopeRequirement
      | undefined;

    const proto = exported.prototype as Record<string, unknown> | undefined;
    if (!proto) continue;

    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === 'constructor') continue;
      const descriptor = Object.getOwnPropertyDescriptor(proto, key);
      if (!descriptor || typeof descriptor.value !== 'function') continue;

      const handler = descriptor.value as Function;
      const httpMethod = Reflect.getMetadata(METHOD_METADATA, handler) as
        | RequestMethod
        | undefined;
      const rawMethodPath = Reflect.getMetadata(PATH_METADATA, handler);
      if (httpMethod === undefined || rawMethodPath === undefined) continue;

      const methodPaths = Array.isArray(rawMethodPath)
        ? rawMethodPath.map(String)
        : [String(rawMethodPath)];
      const handlerGuards: unknown[] =
        (Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[] | undefined) ?? [];
      const primaryScope = Reflect.getMetadata(MODULE_SCOPE_KEY, handler) as
        | ModuleScopeRequirement
        | undefined;
      const alternativeScopes =
        (Reflect.getMetadata(MODULE_SCOPE_ALTERNATIVES_KEY, handler) as
          | ModuleScopeRequirement[]
          | undefined) ?? [];

      for (const prefix of prefixes) {
        for (const methodPath of methodPaths) {
          records.push({
            controllerName: exported.name || exportName,
            controllerClass: exported,
            methodName: key,
            handler,
            httpMethod,
            methodPath: normalizePath(methodPath),
            fullPath: joinPaths(String(prefix), methodPath),
            primaryScope,
            alternativeScopes,
            classScope,
            guards: [...classGuards, ...handlerGuards],
          });
        }
      }
    }
  }
  return records;
}

function isModuleScopeGuardRef(guard: unknown): boolean {
  if (guard === ModuleScopeGuard) return true;
  if (guard instanceof ModuleScopeGuard) return true;
  if (typeof guard === 'function' && guard.prototype instanceof ModuleScopeGuard) {
    return true;
  }
  return false;
}

/**
 * Verifies a ModuleScopeGuard subclass actually enforces `MODULE_SCOPE_KEY` at
 * runtime for a non-owner STAFF member whose scope is `'none'` (closing NMS-18
 * documented limit #3: pinned guard subclass bodies).
 */
async function verifyScopeGuardSubclassEnforces(
  guardCtor: new (...args: any[]) => ModuleScopeGuard,
  handler: Function,
  controllerClass: Function,
): Promise<string | null> {
  if (guardCtor === ModuleScopeGuard) return null;

  const mockPrisma = {
    client: {
      business: {
        findUnique: async () => ({ id: 'biz_probe', ownerId: 'owner_probe' }),
      },
      membership: {
        findUnique: async () => ({
          role: 'STAFF',
          permissionScopes: {
            crm: 'none',
            revenue: 'none',
            bookings: 'none',
            projects: 'none',
            content: 'none',
            expenses: 'none',
            automations: 'none',
            storefront: 'none',
            settings: 'none',
            ai: 'none',
            team: 'none',
            analytics: 'none',
            operations: 'none',
            connect: 'none',
          },
        }),
      },
    },
  };
  const reflector = new Reflector();
  const extraDepsStub = {
    isConfigOwner: async () => false,
  };
  const instance = new guardCtor(mockPrisma, reflector, extraDepsStub, undefined);

  const req = {
    user: { id: 'staff_probe', role: 'USER' },
    params: { businessId: 'biz_probe' },
    query: {},
    body: {},
  };
  const ctx = {
    getHandler: () => handler,
    getClass: () => controllerClass,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;

  try {
    const allowed = await instance.canActivate(ctx);
    if (allowed) {
      return `guard subclass ${guardCtor.name} admitted a STAFF member with all scopes 'none'`;
    }
    return null;
  } catch (err: unknown) {
    if (err instanceof ForbiddenException) return null;
    return `guard subclass ${guardCtor.name} threw unexpected error instead of ForbiddenException: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
}

async function evaluateCompiledRouteClaim(
  href: string,
  rowModules: string[],
  citation: ParsedRouteCitation,
  routes: CompiledRouteRecord[],
): Promise<string[]> {
  const errors: string[] = [];
  const wantedPath = normalizePath(citation.routePath);

  const matching = routes.filter(
    (r) =>
      r.httpMethod === RequestMethod.GET &&
      r.methodPath === wantedPath &&
      (!citation.className || r.controllerName === citation.className),
  );

  if (matching.length === 0) {
    errors.push(
      `${href} (${citation.raw}): no compiled @Get('${citation.routePath}') handler found`,
    );
    return errors;
  }
  if (matching.length > 1) {
    errors.push(
      `${href} (${citation.raw}): ambiguous compiled @Get('${citation.routePath}') matched ${matching
        .map((m) => `${m.controllerName}.${m.methodName}`)
        .join(', ')}`,
    );
    return errors;
  }

  const target = matching[0];
  const sameControllerRoutes = routes.filter(
    (r) => r.controllerClass === target.controllerClass,
  );
  const targetIndex = sameControllerRoutes.indexOf(target);
  for (let i = 0; i < targetIndex; i++) {
    const earlier = sameControllerRoutes[i];
    if (
      earlier.httpMethod === RequestMethod.GET ||
      earlier.httpMethod === RequestMethod.ALL
    ) {
      if (shadowsRoute(earlier.fullPath, target.fullPath)) {
        errors.push(
          `${href} (${citation.raw}): compiled route ${target.controllerName}.${target.methodName} (${target.fullPath}) is shadowed by earlier ${earlier.controllerName}.${earlier.methodName} (${earlier.fullPath})`,
        );
      }
    }
  }

  const allScopes = [
    ...(target.primaryScope ? [target.primaryScope] : []),
    ...target.alternativeScopes,
  ];
  const scopeGuards = target.guards.filter(isModuleScopeGuardRef);

  if (citation.kind === 'scoped') {
    if (!target.primaryScope) {
      errors.push(
        `${href} (${citation.raw}): compiled handler ${target.controllerName}.${target.methodName} has no MODULE_SCOPE_KEY metadata`,
      );
    } else {
      for (const req of allScopes) {
        if (!rowModules.includes(req.module)) {
          errors.push(
            `${href} (${citation.raw}): compiled MODULE_SCOPE_KEY requires '${req.module}' (${req.minLevel}) which is not in nav row modules [${rowModules.join(', ')}]`,
          );
        }
      }
    }

    if (scopeGuards.length === 0) {
      errors.push(
        `${href} (${citation.raw}): compiled handler ${target.controllerName}.${target.methodName} is missing ModuleScopeGuard in GUARDS_METADATA`,
      );
    } else {
      for (const g of scopeGuards) {
        if (typeof g === 'function' && g !== ModuleScopeGuard) {
          const subErr = await verifyScopeGuardSubclassEnforces(
            g as new (...args: any[]) => ModuleScopeGuard,
            target.handler,
            target.controllerClass,
          );
          if (subErr) {
            errors.push(`${href} (${citation.raw}): ${subErr}`);
          }
        }
      }
    }
  } else if (citation.kind === 'unscoped') {
    if (allScopes.length > 0) {
      errors.push(
        `${href} (${citation.raw}): claimed unscoped, but compiled handler ${target.controllerName}.${target.methodName} carries MODULE_SCOPE_KEY=${allScopes
          .map((s) => `${s.module}:${s.minLevel}`)
          .join(',')}`,
      );
    }
  } else if (citation.kind === 'service-check') {
    // A `service-check:` route enforces per-record/per-model module scopes in
    // its handler/service (e.g., TrashController W6-TRASH-MODULE-SCOPE D-95,
    // SiteController analytics). If it also carries MODULE_SCOPE_KEY, every
    // named module must appear in the nav row, and any attached ModuleScopeGuard
    // subclass must still enforce at runtime.
    if (allScopes.length > 0) {
      for (const req of allScopes) {
        if (!rowModules.includes(req.module)) {
          errors.push(
            `${href} (${citation.raw}): service-check route carries MODULE_SCOPE_KEY '${req.module}' not listed in nav row modules [${rowModules.join(', ')}]`,
          );
        }
      }
      for (const g of scopeGuards) {
        if (typeof g === 'function' && g !== ModuleScopeGuard) {
          const subErr = await verifyScopeGuardSubclassEnforces(
            g as new (...args: any[]) => ModuleScopeGuard,
            target.handler,
            target.controllerClass,
          );
          if (subErr) {
            errors.push(`${href} (${citation.raw}): ${subErr}`);
          }
        }
      }
    }
  }

  return errors;
}

describe('FU-NMS-SERVER-METADATA: compiled controller metadata matches every NAV-A1 NMS-18 route claim', () => {
  it('non-vacuous negative controls: catches imported/composed decorator mismatch, runtime metadata mutation, missing guard, and permissive guard subclass', async () => {
    // 1. Imported/composed decorator sets a scope ('revenue') that differs from the nav claim (['crm'])
    const ComposedRevenueDecorator = () =>
      SetMetadata(MODULE_SCOPE_KEY, {
        module: 'revenue',
        minLevel: 'read',
      } as ModuleScopeRequirement);

    @Controller('synthetic')
    @UseGuards(ModuleScopeGuard)
    class ImportedDecoratorMismatchController {
      @Get('items')
      @ComposedRevenueDecorator()
      listItems() {
        return [];
      }
    }

    const mismatchErrors = await evaluateCompiledRouteClaim(
      '/app/synthetic-mismatch',
      ['crm'],
      {
        kind: 'scoped',
        relFile: 'modules/synthetic/synthetic.controller.ts',
        routePath: 'items',
        raw: 'modules/synthetic/synthetic.controller.ts#GET items',
      },
      extractCompiledRoutes({ ImportedDecoratorMismatchController }),
    );
    expect(mismatchErrors).toHaveLength(1);
    expect(mismatchErrors[0]).toMatch(/requires 'revenue'.*not in nav row modules \[crm\]/);

    // 2. Runtime Reflect.defineMetadata adds a scope onto a route NMS-18 claims is unscoped
    @Controller('synthetic-runtime')
    class RuntimeMutatedController {
      @Get('overview')
      overview() {
        return {};
      }
    }
    Reflect.defineMetadata(
      MODULE_SCOPE_KEY,
      { module: 'operations', minLevel: 'read' } as ModuleScopeRequirement,
      RuntimeMutatedController.prototype.overview,
    );

    const runtimeErrors = await evaluateCompiledRouteClaim(
      '/app/synthetic-runtime',
      [],
      {
        kind: 'unscoped',
        relFile: 'modules/synthetic/runtime.controller.ts',
        routePath: 'overview',
        raw: 'unscoped:modules/synthetic/runtime.controller.ts#GET overview',
      },
      extractCompiledRoutes({ RuntimeMutatedController }),
    );
    expect(runtimeErrors).toHaveLength(1);
    expect(runtimeErrors[0]).toMatch(/claimed unscoped.*MODULE_SCOPE_KEY=operations:read/);

    // 3. Scoped handler without ModuleScopeGuard in GUARDS_METADATA fails
    @Controller('synthetic-unguarded')
    class UnguardedController {
      @Get('secret')
      @RequireModuleScope('revenue', 'read')
      secret() {
        return {};
      }
    }

    const unguardedErrors = await evaluateCompiledRouteClaim(
      '/app/synthetic-unguarded',
      ['revenue'],
      {
        kind: 'scoped',
        relFile: 'modules/synthetic/unguarded.controller.ts',
        routePath: 'secret',
        raw: 'modules/synthetic/unguarded.controller.ts#GET secret',
      },
      extractCompiledRoutes({ UnguardedController }),
    );
    expect(unguardedErrors).toHaveLength(1);
    expect(unguardedErrors[0]).toMatch(/missing ModuleScopeGuard/);

    // 4. A permissive ModuleScopeGuard subclass that always returns true fails runtime enforcement check
    class BrokenAlwaysAllowScopeGuard extends ModuleScopeGuard implements CanActivate {
      override async canActivate(_context: ExecutionContext): Promise<boolean> {
        return true;
      }
    }

    @Controller('synthetic-subclass')
    @UseGuards(BrokenAlwaysAllowScopeGuard)
    class PermissiveSubclassController {
      @Get('ops')
      @RequireModuleScope('operations', 'read')
      ops() {
        return {};
      }
    }

    const subclassErrors = await evaluateCompiledRouteClaim(
      '/app/synthetic-subclass',
      ['operations'],
      {
        kind: 'scoped',
        relFile: 'modules/synthetic/subclass.controller.ts',
        routePath: 'ops',
        raw: 'modules/synthetic/subclass.controller.ts#GET ops',
      },
      extractCompiledRoutes({ PermissiveSubclassController }),
    );
    expect(subclassErrors).toHaveLength(1);
    expect(subclassErrors[0]).toMatch(/BrokenAlwaysAllowScopeGuard.*admitted a STAFF member/);
  });

  it('every route cited in NAV-A1 MODULE_TABLE compiles, exists without shadowing, and matches live MODULE_SCOPE_KEY + GUARDS_METADATA', async () => {
    const rows = loadNavModuleTable();
    expect(rows.length).toBeGreaterThan(40);

    const citations: Array<{
      href: string;
      modules: string[];
      parsed: ParsedRouteCitation;
    }> = [];
    for (const row of rows) {
      for (const rawCite of row.cite) {
        const parsed = parseRouteCitation(rawCite);
        if (parsed) {
          citations.push({ href: row.href, modules: row.modules, parsed });
        }
      }
    }
    expect(citations.length).toBeGreaterThan(40);

    // Load each cited compiled controller module once and reflect its route/metadata table
    const routesByFile = new Map<string, CompiledRouteRecord[]>();
    const uniqueFiles = [...new Set(citations.map((c) => c.parsed.relFile))];
    for (const relFile of uniqueFiles) {
      const absPath = path.join(SERVER_SRC, relFile);
      expect(fs.existsSync(absPath), `Cited controller file missing: ${relFile}`).toBe(true);
      const mod = (await import(absPath)) as Record<string, unknown>;
      const routes = extractCompiledRoutes(mod);
      expect(
        routes.length,
        `No compiled NestJS @Controller routes exported from ${relFile}`,
      ).toBeGreaterThan(0);
      routesByFile.set(relFile, routes);
    }

    const errors: string[] = [];
    for (const { href, modules, parsed } of citations) {
      const fileRoutes = routesByFile.get(parsed.relFile) ?? [];
      const claimErrors = await evaluateCompiledRouteClaim(
        href,
        modules,
        parsed,
        fileRoutes,
      );
      errors.push(...claimErrors);
    }

    expect(
      errors,
      `Compiled controller metadata mismatches against NAV-A1 MODULE_TABLE:\n${errors.join('\n')}`,
    ).toEqual([]);
  }, 60_000);
});
