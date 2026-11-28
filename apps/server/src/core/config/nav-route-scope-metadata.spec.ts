/**
 * FU-NMS-SERVER-METADATA (D-179, D-263):
 * Runtime/compiled verification of every server route cited by NAV-A1's
 * `apps/web/src/lib/__tests__/nav-member-scope.spec.ts` (`NMS-18` / `MODULE_TABLE`).
 *
 * Closes the three documented limits of `NMS-18`'s source-text check:
 *   1. Scopes attached by an imported/composed decorator defined in another file.
 *   2. Metadata written dynamically via `Reflect.defineMetadata` at module load time.
 *   3. `ModuleScopeGuard` subclasses (both class tokens AND guard instances) whose
 *      body could weaken or misdirect enforcement — verified both via prototype
 *      chain AND by executing `canActivate` against a STAFF member holding
 *      `'admin'` on every unrelated canonical module and `'none'` only on the
 *      required module(s).
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
  SELF_DECLARED_DEPS_METADATA,
} from '@nestjs/common/constants';
import { PrismaService } from '../prisma/prisma.service';
import {
  CANONICAL_MODULES,
  type AccessLevel,
  type CanonicalModule,
} from '../authority/module-vocabulary';
import { EffectiveAuthorityResolver } from '../authority/effective-authority.resolver';
import {
  MODULE_SCOPE_ALTERNATIVES_KEY,
  MODULE_SCOPE_KEY,
  ModuleScopeGuard,
  RequireAlternativeModuleScope,
  RequireModuleScope,
  type ModuleScopeRequirement,
} from '../auth/module-scope.guard';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SERVER_SRC = path.resolve(__dirname, '../..');
const WEB_NMS_SPEC = path.join(
  REPO_ROOT,
  'apps/web/src/lib/__tests__/nav-member-scope.spec.ts',
);

const ENFORCEABLE_MIN_LEVELS = new Set<string>(['read', 'write', 'admin']);
const SPAN_TOKEN_RE = /[*?+({]/;

/**
 * Known `service-check:` route whose handler carries inert `@RequireModuleScope`
 * metadata without `ModuleScopeGuard` because it enforces per-model module
 * scopes inside the handler itself (W6-TRASH-MODULE-SCOPE, D-95; documented at
 * `trash.controller.ts:386`). Shrink-only; any OTHER `service-check:` route
 * carrying `MODULE_SCOPE_KEY` without `ModuleScopeGuard` fails closed.
 */
const SERVICE_CHECK_INERT_SCOPE_ALLOWLIST = new Set<string>([
  'service-check:modules/trash/trash.controller.ts#GET ',
]);

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
  fullPaths: string[];
  primaryScope: ModuleScopeRequirement | undefined;
  alternativeScopes: ModuleScopeRequirement[];
  invalidAlternativesMetadata: boolean;
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
 * via the TypeScript parser, failing closed on unreadable entries, duplicate keys,
 * or empty `cite` arrays.
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

  const seenHrefs = new Set<string>();
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
    if (seenHrefs.has(href)) {
      throw new Error(`Duplicate MODULE_TABLE key: ${href}`);
    }
    seenHrefs.add(href);

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
    if (!modules || !cite || cite.length === 0) {
      throw new Error(`Missing or empty modules/cite array in MODULE_TABLE[${href}]`);
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

  // Require whitespace after GET when a path follows (or end-of-string/trailing space for empty route)
  const m = /^((?:modules|core)\/[^#]+\.ts)#(?:([A-Za-z0-9_]+)\s+)?GET(?:\s+(.*))?$/.exec(body);
  if (!m) {
    throw new Error(`Unrecognized citation format in MODULE_TABLE: ${JSON.stringify(raw)}`);
  }
  return {
    kind,
    relFile: m[1],
    className: m[2] || undefined,
    routePath: (m[3] ?? '').trim(),
    raw,
  };
}

function normalizePath(p: string): string {
  return p.replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
}

function joinPaths(prefix: string, methodPath: string): string {
  const a = normalizePath(prefix);
  const b = normalizePath(methodPath);
  if (!a) return b;
  if (!b) return a;
  return `${a}/${b}`;
}

function pathSegmentsLower(p: string): string[] {
  const n = normalizePath(p).toLowerCase();
  return n ? n.split('/') : [];
}

function isParamSegment(seg: string): boolean {
  return seg.includes(':');
}

/**
 * Express matches case-insensitively by default and supports wildcards/spans.
 * Returns true if `earlierFullPath` shadows `citedFullPath` within the same
 * controller (fail-closed on wildcard/span tokens).
 */
function shadowsRoute(earlierFullPath: string, citedFullPath: string): boolean {
  if (SPAN_TOKEN_RE.test(earlierFullPath)) return true;
  const eSegs = pathSegmentsLower(earlierFullPath);
  const cSegs = pathSegmentsLower(citedFullPath);
  if (eSegs.length !== cSegs.length) return false;
  return eSegs.every((seg, i) => isParamSegment(seg) || seg === cSegs[i]);
}

/**
 * Symmetric overlap check for routes on sibling controllers in the same file
 * (registration order depends on @Module({ controllers }), not file order).
 */
function overlapsRoute(aFullPath: string, bFullPath: string): boolean {
  if (SPAN_TOKEN_RE.test(aFullPath) || SPAN_TOKEN_RE.test(bFullPath)) return true;
  const aSegs = pathSegmentsLower(aFullPath);
  const bSegs = pathSegmentsLower(bFullPath);
  if (aSegs.length !== bSegs.length) return false;
  return aSegs.every((seg, i) => isParamSegment(seg) || isParamSegment(bSegs[i]) || seg === bSegs[i]);
}

function extractCompiledRoutes(mod: Record<string, unknown>): CompiledRouteRecord[] {
  const records: CompiledRouteRecord[] = [];
  const seenClasses = new Set<Function>();

  for (const [exportName, exported] of Object.entries(mod)) {
    if (typeof exported !== 'function') continue;
    if (seenClasses.has(exported)) continue;
    const rawPrefix = Reflect.getMetadata(PATH_METADATA, exported);
    if (rawPrefix === undefined) continue;
    seenClasses.add(exported);

    const prefixes = Array.isArray(rawPrefix) ? rawPrefix.map(String) : [String(rawPrefix)];
    const classGuards: unknown[] =
      (Reflect.getMetadata(GUARDS_METADATA, exported) as unknown[] | undefined) ?? [];
    const classScope = Reflect.getMetadata(MODULE_SCOPE_KEY, exported) as
      | ModuleScopeRequirement
      | undefined;

    // Walk prototype chain like NestJS MetadataScanner (subclasses inheriting @Get/@All routes)
    const seenMethods = new Set<string>();
    let curProto = exported.prototype as Record<string, unknown> | null;
    while (curProto && curProto !== Object.prototype) {
      for (const key of Object.getOwnPropertyNames(curProto)) {
        if (key === 'constructor' || seenMethods.has(key)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(curProto, key);
        if (!descriptor || typeof descriptor.value !== 'function') continue;
        seenMethods.add(key);

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
        const rawAlternatives: unknown = Reflect.getMetadata(
          MODULE_SCOPE_ALTERNATIVES_KEY,
          handler,
        );
        const invalidAlternativesMetadata =
          rawAlternatives !== undefined && !Array.isArray(rawAlternatives);
        const alternativeScopes = Array.isArray(rawAlternatives)
          ? (rawAlternatives as ModuleScopeRequirement[])
          : [];

        for (const methodPath of methodPaths) {
          records.push({
            controllerName: exported.name || exportName,
            controllerClass: exported,
            methodName: key,
            handler,
            httpMethod,
            methodPath: normalizePath(methodPath),
            fullPaths: prefixes.map((prefix) => joinPaths(prefix, methodPath)),
            primaryScope,
            alternativeScopes,
            invalidAlternativesMetadata,
            classScope,
            guards: [...classGuards, ...handlerGuards],
          });
        }
      }
      curProto = Object.getPrototypeOf(curProto) as Record<string, unknown> | null;
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

function buildProbePermissionScopes(deniedModules: readonly string[]): Record<CanonicalModule, AccessLevel> {
  const denied = new Set(deniedModules);
  const map = {} as Record<CanonicalModule, AccessLevel>;
  for (const mod of CANONICAL_MODULES) {
    map[mod] = denied.has(mod) ? 'none' : 'admin';
  }
  return map;
}

function resolveGuardConstructorArgs(
  guardCtor: Function,
  mockPrisma: unknown,
  reflector: Reflector,
): { args?: unknown[]; error?: string } {
  const selfDeps =
    (Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, guardCtor) as
      | Array<{ index: number; param: unknown }>
      | undefined) ?? [];
  const paramTypes =
    (Reflect.getMetadata('design:paramtypes', guardCtor) as unknown[] | undefined) ?? [];

  const maxLen = Math.max(
    guardCtor.length,
    paramTypes.length,
    ...selfDeps.map((d) => d.index + 1),
  );
  const byIndex = new Map<number, unknown>();
  for (let i = 0; i < paramTypes.length; i++) byIndex.set(i, paramTypes[i]);
  for (const d of selfDeps) byIndex.set(d.index, d.param);

  // Subclass inheriting ModuleScopeGuard's constructor directly without its own @Inject metadata
  if (maxLen === 0 && guardCtor.prototype instanceof ModuleScopeGuard) {
    return { args: [mockPrisma, reflector, undefined] };
  }

  const args: unknown[] = [];
  for (let i = 0; i < maxLen; i++) {
    const token = byIndex.get(i);
    const tokenName = typeof token === 'function' ? token.name : String(token ?? '');
    if (token === PrismaService || tokenName === 'PrismaService') {
      args.push(mockPrisma);
    } else if (token === Reflector || tokenName === 'Reflector') {
      args.push(reflector);
    } else if (token === EffectiveAuthorityResolver || tokenName === 'EffectiveAuthorityResolver') {
      args.push(undefined);
    } else if (tokenName === 'WhatsAppService') {
      args.push({ isConfigOwner: async () => false });
    } else if (token === undefined && i >= 2) {
      args.push(undefined);
    } else {
      return {
        error: `guard subclass ${guardCtor.name} has unrecognized DI parameter #${i} (${tokenName || 'unknown'})`,
      };
    }
  }
  return { args };
}

/**
 * Verifies a `ModuleScopeGuard` subclass (constructor OR pre-instantiated guard
 * object) actually enforces the handler's required module scope at runtime.
 * Grants `'admin'` on every unrelated canonical module and `'none'` ONLY on the
 * required module(s), so a subclass that always returns true OR checks the wrong
 * module fails the gate.
 */
async function verifyScopeGuardEnforces(
  guardRef: unknown,
  handler: Function,
  controllerClass: Function,
  requiredModules: readonly string[],
): Promise<string | null> {
  if (guardRef === ModuleScopeGuard) return null;

  const mockPrisma = {
    client: {
      business: {
        findUnique: async () => ({ id: 'biz_probe', ownerId: 'owner_probe' }),
      },
      membership: {
        findUnique: async () => ({
          role: 'STAFF',
          permissionScopes: buildProbePermissionScopes(requiredModules),
        }),
      },
    },
  };
  const reflector = new Reflector();

  let instance: ModuleScopeGuard;
  let guardLabel: string;

  if (typeof guardRef === 'function') {
    guardLabel = guardRef.name || 'AnonymousScopeGuardSubclass';
    const resolved = resolveGuardConstructorArgs(guardRef, mockPrisma, reflector);
    if (resolved.error) return resolved.error;
    try {
      instance = new (guardRef as new (...args: unknown[]) => ModuleScopeGuard)(
        ...(resolved.args ?? []),
      );
    } catch (err: unknown) {
      return `guard subclass ${guardLabel} failed to construct: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  } else if (guardRef instanceof ModuleScopeGuard) {
    guardLabel = `${guardRef.constructor?.name || 'ModuleScopeGuard'} instance`;
    instance = guardRef;
  } else {
    return `unrecognized ModuleScopeGuard reference: ${String(guardRef)}`;
  }

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
      return `guard ${guardLabel} admitted a STAFF member holding 'none' on [${requiredModules.join(', ')}] (and 'admin' elsewhere)`;
    }
    return null;
  } catch (err: unknown) {
    if (err instanceof ForbiddenException) return null;
    return `guard ${guardLabel} threw unexpected error instead of ForbiddenException: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
}

function validateScopeRequirements(
  href: string,
  citation: ParsedRouteCitation,
  rowModules: string[],
  allScopes: ModuleScopeRequirement[],
): string[] {
  const errors: string[] = [];
  for (const req of allScopes) {
    if (!req || typeof req.module !== 'string' || req.module.trim().length === 0) {
      errors.push(`${href} (${citation.raw}): compiled MODULE_SCOPE_KEY has empty/invalid module`);
      continue;
    }
    if (typeof req.minLevel !== 'string' || !ENFORCEABLE_MIN_LEVELS.has(req.minLevel)) {
      errors.push(
        `${href} (${citation.raw}): compiled MODULE_SCOPE_KEY for '${req.module}' has non-enforcing minLevel '${String(req.minLevel)}' (must be read|write|admin)`,
      );
    }
    if (!rowModules.includes(req.module)) {
      errors.push(
        `${href} (${citation.raw}): compiled MODULE_SCOPE_KEY requires '${req.module}' (${String(req.minLevel)}) which is not in nav row modules [${rowModules.join(', ')}]`,
      );
    }
  }
  return errors;
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

  // Fail loud on stray class-level MODULE_SCOPE_KEY (ModuleScopeGuard only reads handler metadata)
  if (target.classScope !== undefined) {
    errors.push(
      `${href} (${citation.raw}): controller ${target.controllerName} carries class-level MODULE_SCOPE_KEY (${target.classScope.module}:${target.classScope.minLevel}), which ModuleScopeGuard ignores`,
    );
  }
  if (target.invalidAlternativesMetadata) {
    errors.push(
      `${href} (${citation.raw}): compiled handler ${target.controllerName}.${target.methodName} carries non-array MODULE_SCOPE_ALTERNATIVES_KEY`,
    );
  }

  // 1. Same-controller route shadowing (earlier GET/ALL shadowing target)
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
      const hit = earlier.fullPaths.some((ep) =>
        target.fullPaths.some((tp) => shadowsRoute(ep, tp)),
      );
      if (hit) {
        errors.push(
          `${href} (${citation.raw}): compiled route ${target.controllerName}.${target.methodName} (${target.fullPaths.join('|')}) is shadowed by earlier ${earlier.controllerName}.${earlier.methodName} (${earlier.fullPaths.join('|')})`,
        );
      }
    }
  }

  // 2. Sibling-controller route overlap in the same file
  for (const other of routes) {
    if (other.controllerClass === target.controllerClass) continue;
    if (
      other.httpMethod === RequestMethod.GET ||
      other.httpMethod === RequestMethod.ALL
    ) {
      const hit = other.fullPaths.some((op) =>
        target.fullPaths.some((tp) => overlapsRoute(op, tp)),
      );
      if (hit) {
        errors.push(
          `${href} (${citation.raw}): compiled route ${target.controllerName}.${target.methodName} (${target.fullPaths.join('|')}) overlaps sibling controller route ${other.controllerName}.${other.methodName} (${other.fullPaths.join('|')})`,
        );
      }
    }
  }

  const allScopes = [
    ...(target.primaryScope ? [target.primaryScope] : []),
    ...target.alternativeScopes,
  ];
  const requiredModules = [...new Set(allScopes.map((s) => s.module).filter(Boolean))];
  const scopeGuards = target.guards.filter(isModuleScopeGuardRef);

  if (citation.kind === 'scoped') {
    if (!target.primaryScope) {
      errors.push(
        `${href} (${citation.raw}): compiled handler ${target.controllerName}.${target.methodName} has no MODULE_SCOPE_KEY metadata`,
      );
    } else {
      errors.push(...validateScopeRequirements(href, citation, rowModules, allScopes));
    }

    if (scopeGuards.length === 0) {
      errors.push(
        `${href} (${citation.raw}): compiled handler ${target.controllerName}.${target.methodName} is missing ModuleScopeGuard in GUARDS_METADATA`,
      );
    } else {
      for (const g of scopeGuards) {
        const subErr = await verifyScopeGuardEnforces(
          g,
          target.handler,
          target.controllerClass,
          requiredModules,
        );
        if (subErr) {
          errors.push(`${href} (${citation.raw}): ${subErr}`);
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
    if (allScopes.length > 0) {
      errors.push(...validateScopeRequirements(href, citation, rowModules, allScopes));
      if (
        scopeGuards.length === 0 &&
        !SERVICE_CHECK_INERT_SCOPE_ALLOWLIST.has(citation.raw)
      ) {
        errors.push(
          `${href} (${citation.raw}): service-check route carries MODULE_SCOPE_KEY without ModuleScopeGuard`,
        );
      }
      for (const g of scopeGuards) {
        const subErr = await verifyScopeGuardEnforces(
          g,
          target.handler,
          target.controllerClass,
          requiredModules,
        );
        if (subErr) {
          errors.push(`${href} (${citation.raw}): ${subErr}`);
        }
      }
    }
  }

  return errors;
}

describe('FU-NMS-SERVER-METADATA: compiled controller metadata matches every NAV-A1 NMS-18 route claim', () => {
  it('non-vacuous negative controls: catches composed decorator mismatch, runtime metadata mutation, minLevel:none, alternatives mismatch, missing guard, permissive/wrong-module subclass & guard instances, wildcard/case-insensitive shadowing, cross-controller overlap, and unguarded service-check scope', async () => {
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

    // 3. minLevel: 'none' (full runtime bypass) is rejected on both primary and alternative scopes
    @Controller('synthetic-none-level')
    @UseGuards(ModuleScopeGuard)
    class NoneLevelController {
      @Get('bypass')
      @SetMetadata(MODULE_SCOPE_KEY, { module: 'revenue', minLevel: 'none' })
      bypass() {
        return {};
      }
    }
    const noneLevelErrors = await evaluateCompiledRouteClaim(
      '/app/synthetic-none',
      ['revenue'],
      {
        kind: 'scoped',
        relFile: 'modules/synthetic/none.controller.ts',
        routePath: 'bypass',
        raw: 'modules/synthetic/none.controller.ts#GET bypass',
      },
      extractCompiledRoutes({ NoneLevelController }),
    );
    expect(noneLevelErrors).toHaveLength(1);
    expect(noneLevelErrors[0]).toMatch(/non-enforcing minLevel 'none'/);

    // 4. MODULE_SCOPE_ALTERNATIVES_KEY naming a module absent from nav row fails
    @Controller('synthetic-alt')
    @UseGuards(ModuleScopeGuard)
    class AltScopeMismatchController {
      @Get('shared')
      @RequireModuleScope('crm', 'read')
      @RequireAlternativeModuleScope('revenue', 'read')
      shared() {
        return {};
      }
    }
    const altErrors = await evaluateCompiledRouteClaim(
      '/app/synthetic-alt',
      ['crm'],
      {
        kind: 'scoped',
        relFile: 'modules/synthetic/alt.controller.ts',
        routePath: 'shared',
        raw: 'modules/synthetic/alt.controller.ts#GET shared',
      },
      extractCompiledRoutes({ AltScopeMismatchController }),
    );
    expect(altErrors).toHaveLength(1);
    expect(altErrors[0]).toMatch(/requires 'revenue'.*not in nav row modules \[crm\]/);

    // 5. Scoped handler without ModuleScopeGuard in GUARDS_METADATA fails
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

    // 6. Permissive ModuleScopeGuard subclass (class token AND pre-instantiated guard instance!) fails
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

    @Controller('synthetic-subclass-instance')
    @UseGuards(new BrokenAlwaysAllowScopeGuard({} as PrismaService, new Reflector()))
    class PermissiveInstanceController {
      @Get('ops-inst')
      @RequireModuleScope('operations', 'read')
      opsInst() {
        return {};
      }
    }

    const instanceErrors = await evaluateCompiledRouteClaim(
      '/app/synthetic-subclass-instance',
      ['operations'],
      {
        kind: 'scoped',
        relFile: 'modules/synthetic/instance.controller.ts',
        routePath: 'ops-inst',
        raw: 'modules/synthetic/instance.controller.ts#GET ops-inst',
      },
      extractCompiledRoutes({ PermissiveInstanceController }),
    );
    expect(instanceErrors).toHaveLength(1);
    expect(instanceErrors[0]).toMatch(/BrokenAlwaysAllowScopeGuard instance.*admitted a STAFF member/);

    // 7. Subclass enforcing the WRONG module ('crm' instead of 'operations') fails because probe holds crm:'admin'
    class WrongModuleScopeGuard extends ModuleScopeGuard implements CanActivate {
      override async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest();
        // Pretends to enforce crm instead of reading MODULE_SCOPE_KEY ('operations')
        const fakeHandler = () => {};
        Reflect.defineMetadata(MODULE_SCOPE_KEY, { module: 'crm', minLevel: 'read' }, fakeHandler);
        return super.canActivate({
          ...context,
          getHandler: () => fakeHandler,
          switchToHttp: () => ({ getRequest: () => req }),
        } as ExecutionContext);
      }
    }

    @Controller('synthetic-wrong-mod')
    @UseGuards(WrongModuleScopeGuard)
    class WrongModuleSubclassController {
      @Get('ops-wrong')
      @RequireModuleScope('operations', 'read')
      opsWrong() {
        return {};
      }
    }
    const wrongModErrors = await evaluateCompiledRouteClaim(
      '/app/synthetic-wrong-mod',
      ['operations'],
      {
        kind: 'scoped',
        relFile: 'modules/synthetic/wrong-mod.controller.ts',
        routePath: 'ops-wrong',
        raw: 'modules/synthetic/wrong-mod.controller.ts#GET ops-wrong',
      },
      extractCompiledRoutes({ WrongModuleSubclassController }),
    );
    expect(wrongModErrors).toHaveLength(1);
    expect(wrongModErrors[0]).toMatch(/WrongModuleScopeGuard.*admitted a STAFF member/);

    // 8. Wildcard & case-insensitive same-controller shadowing fail
    @Controller('synthetic-shadow')
    @UseGuards(ModuleScopeGuard)
    class ShadowedController {
      @Get('*')
      catchAll() {
        return {};
      }

      @Get('items')
      @RequireModuleScope('crm', 'read')
      items() {
        return [];
      }
    }
    const shadowErrors = await evaluateCompiledRouteClaim(
      '/app/synthetic-shadow',
      ['crm'],
      {
        kind: 'scoped',
        relFile: 'modules/synthetic/shadow.controller.ts',
        routePath: 'items',
        raw: 'modules/synthetic/shadow.controller.ts#GET items',
      },
      extractCompiledRoutes({ ShadowedController }),
    );
    expect(shadowErrors).toHaveLength(1);
    expect(shadowErrors[0]).toMatch(/shadowed by earlier ShadowedController\.catchAll/);

    // 9. Cross-controller route overlap in the same file fails
    @Controller('shared-prefix')
    class SiblingA {
      @Get(':id')
      byId() {
        return {};
      }
    }
    @Controller('shared-prefix')
    @UseGuards(ModuleScopeGuard)
    class SiblingB {
      @Get('summary')
      @RequireModuleScope('revenue', 'read')
      summary() {
        return {};
      }
    }
    const overlapErrors = await evaluateCompiledRouteClaim(
      '/app/synthetic-overlap',
      ['revenue'],
      {
        kind: 'scoped',
        relFile: 'modules/synthetic/overlap.controller.ts',
        className: 'SiblingB',
        routePath: 'summary',
        raw: 'modules/synthetic/overlap.controller.ts#SiblingB GET summary',
      },
      extractCompiledRoutes({ SiblingA, SiblingB }),
    );
    expect(overlapErrors).toHaveLength(1);
    expect(overlapErrors[0]).toMatch(/overlaps sibling controller route SiblingA\.byId/);

    // 10. Non-allowlisted service-check route carrying unguarded MODULE_SCOPE_KEY or wrong module fails
    @Controller('synthetic-sc')
    class ServiceCheckScopeController {
      @Get('stats')
      @RequireModuleScope('revenue', 'read')
      stats() {
        return {};
      }
    }
    const scErrors = await evaluateCompiledRouteClaim(
      '/app/synthetic-sc',
      ['crm'],
      {
        kind: 'service-check',
        relFile: 'modules/synthetic/sc.controller.ts',
        routePath: 'stats',
        raw: 'service-check:modules/synthetic/sc.controller.ts#GET stats',
      },
      extractCompiledRoutes({ ServiceCheckScopeController }),
    );
    expect(scErrors.length).toBeGreaterThanOrEqual(2);
    expect(scErrors.some((e) => /requires 'revenue'/.test(e))).toBe(true);
    expect(scErrors.some((e) => /without ModuleScopeGuard/.test(e))).toBe(true);

    // 11. parseRouteCitation fails closed on missing-space typo ("GETitems")
    expect(() => parseRouteCitation('modules/crm/crm.controller.ts#GETitems')).toThrow(
      /Unrecognized citation format/,
    );
  });

  it('every route cited in NAV-A1 MODULE_TABLE compiles, exists without shadowing or cross-controller overlap, and matches live MODULE_SCOPE_KEY + GUARDS_METADATA', async () => {
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
