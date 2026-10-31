/**
 * R0-34-KEY-AUDIT-TENANT (PRS-M30) — the cortex audit routes bind the tenant
 * the guards checked, not an absent path parameter.
 *
 * KeyCortexAuditController is mounted at `/api/v1/cortex` (no `:businessId`
 * segment) behind AuthGuard and BusinessGuard. BusinessGuard resolves the tenant
 * from params, then body, then query (core/auth/request-business-id.ts), and the
 * web compliance page calls `/api/v1/cortex/audit/decisions?businessId=<id>`.
 * The handlers read `@Param('businessId')`, which on these paths is always
 * `undefined`, and passed it to Prisma, where `where: { businessId: undefined }`
 * is no filter at all.
 *
 * This file is the pure half of the proof (no database):
 *   - each audit handler's tenant argument is the GuardedBusinessId resolver,
 *     so the value it receives is the one BusinessGuard checked;
 *   - a handler that receives no tenant (SUPER_ADMIN bypasses BusinessGuard)
 *     refuses instead of calling a service with `undefined`;
 *   - no route on this controller, and no route anywhere in apps/server/src,
 *     reads `@Param('businessId')` on a path without `:businessId`.
 *
 * The real-database half is test/cortex-audit-tenant.integration.test.ts.
 */
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as ts from 'typescript';
import { HttpException, RequestMethod } from '@nestjs/common';
import {
  CUSTOM_ROUTE_ARGS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { KeyCortexAuditController } from './key-cortex-audit.controller';
import { resolveRequestBusinessId } from '../../core/auth/request-business-id';

const SERVER_SRC = join(__dirname, '..', '..');

const AUDIT_HANDLERS = ['auditDecisions', 'auditValues', 'auditAssessment', 'auditAcceptance'] as const;

function joinPaths(prefixes: string[], paths: string[]): string[] {
  const out: string[] = [];
  for (const p of prefixes) for (const q of paths) out.push(`/${p}/${q}`.replace(/\/+/g, '/'));
  return out;
}

function asPaths(value: unknown): string[] {
  if (value === undefined || value === null) return [''];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

/** Routes on a controller class whose handler reads `@Param('businessId')` on a full path with no `:businessId`. */
function reflectOffenders(controller: new (...args: any[]) => unknown): string[] {
  const prefixes = asPaths(Reflect.getMetadata(PATH_METADATA, controller));
  const proto = controller.prototype as Record<string, unknown>;
  const offenders: string[] = [];
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'constructor') continue;
    const handler = proto[name];
    if (typeof handler !== 'function') continue;
    const method = Reflect.getMetadata(METHOD_METADATA, handler);
    if (method === undefined) continue; // not a route
    const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) ?? {}) as Record<string, { data?: unknown }>;
    const readsParam = Object.entries(args).some(
      ([key, meta]) => key.startsWith(`${RouteParamtypes.PARAM}:`) && meta?.data === 'businessId',
    );
    if (!readsParam) continue;
    for (const full of joinPaths(prefixes, asPaths(Reflect.getMetadata(PATH_METADATA, handler)))) {
      if (!full.includes(':businessId')) offenders.push(`${RequestMethod[method]} ${full} (${name})`);
    }
  }
  return offenders;
}

// ---- source scan over every controller in apps/server/src ------------------

const HTTP_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Options', 'Head', 'Search']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      walk(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function decoratorCall(node: ts.Node, names: Set<string> | string): { name: string; args: readonly ts.Expression[] } | undefined {
  const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
  for (const d of decorators) {
    const expr = d.expression;
    if (!ts.isCallExpression(expr) || !ts.isIdentifier(expr.expression)) continue;
    const name = expr.expression.text;
    if (typeof names === 'string' ? name === names : names.has(name)) return { name, args: expr.arguments };
  }
  return undefined;
}

/** Literal route paths of a decorator argument; a path that is not a literal is reported, not guessed. */
function literalPaths(arg: ts.Expression | undefined): string[] {
  if (!arg) return [''];
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return [arg.text];
  if (ts.isArrayLiteralExpression(arg)) return arg.elements.flatMap((e) => literalPaths(e as ts.Expression));
  if (ts.isObjectLiteralExpression(arg)) {
    const pathProp = arg.properties.find(
      (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'path',
    ) as ts.PropertyAssignment | undefined;
    return literalPaths(pathProp?.initializer);
  }
  return ['<non-literal>'];
}

function sourceOffenders(): string[] {
  const offenders: string[] = [];
  for (const file of walk(SERVER_SRC)) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('@Controller(') || !/@Param\(\s*['"`]businessId['"`]\s*\)/.test(text)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node) => {
      if (ts.isClassDeclaration(node)) {
        const ctl = decoratorCall(node, 'Controller');
        if (ctl) {
          const prefixes = literalPaths(ctl.args[0]);
          for (const member of node.members) {
            if (!ts.isMethodDeclaration(member)) continue;
            const route = decoratorCall(member, HTTP_DECORATORS);
            if (!route) continue;
            const readsParam = member.parameters.some((p) => {
              const param = decoratorCall(p, 'Param');
              const a0 = param?.args[0];
              return !!a0 && (ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0)) && a0.text === 'businessId';
            });
            if (!readsParam) continue;
            for (const full of joinPaths(prefixes, literalPaths(route.args[0]))) {
              if (!full.includes(':businessId')) {
                const line = sf.getLineAndCharacterOfPosition(member.getStart(sf)).line + 1;
                offenders.push(`${relative(SERVER_SRC, file)}:${line} ${route.name.toUpperCase()} ${full}`);
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return offenders.sort();
}

// ---- controller over recorders -----------------------------------------------

function makeController() {
  const verdictRows = [{ id: 'v1', businessId: 'biz_A', allowed: true }];
  const prisma = {
    client: {
      autonomyVerdict: {
        findMany: vi.fn().mockResolvedValue(verdictRows),
        count: vi.fn().mockResolvedValue(1),
      },
    },
  };
  const evalHarness = { getSuiteNames: vi.fn().mockReturnValue([]), runAll: vi.fn(), runSuite: vi.fn() };
  const selfAssessment = { generate: vi.fn().mockResolvedValue({ businessId: 'biz_A' }) };
  const acceptance = {
    getScenario: vi.fn().mockReturnValue({ name: 'one_week_routine_operations' }),
    evaluate: vi.fn().mockResolvedValue({ score: 1 }),
  };
  const valueLearning = {
    getValueConstraints: vi.fn().mockResolvedValue([]),
    detectDrift: vi.fn().mockResolvedValue({ driftScore: 0, conflicting: [] }),
  };
  const compliance = { getAll: vi.fn().mockReturnValue([]) };
  const controller = new KeyCortexAuditController(
    prisma as any,
    evalHarness as any,
    selfAssessment as any,
    acceptance as any,
    valueLearning as any,
    compliance as any,
  );
  return { controller, prisma, selfAssessment, acceptance, valueLearning, compliance };
}

type Rig = ReturnType<typeof makeController>;

function serviceCalls(rig: Rig): unknown[][] {
  return [
    ...rig.prisma.client.autonomyVerdict.findMany.mock.calls,
    ...rig.prisma.client.autonomyVerdict.count.mock.calls,
    ...rig.valueLearning.getValueConstraints.mock.calls,
    ...rig.valueLearning.detectDrift.mock.calls,
    ...rig.selfAssessment.generate.mock.calls,
    ...rig.acceptance.evaluate.mock.calls,
  ];
}

function call(controller: KeyCortexAuditController, handler: (typeof AUDIT_HANDLERS)[number], businessId: string | undefined) {
  return (controller as any)[handler](businessId) as Promise<Record<string, unknown>>;
}

/** The tenant a handler's first argument resolves to for a given request, read from Nest's own route-argument metadata. */
function resolvedTenantArgument(handler: string, req: { params?: any; body?: any; query?: any }): unknown {
  const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, KeyCortexAuditController, handler) ?? {}) as Record<
    string,
    { index: number; data?: unknown; factory?: (data: unknown, ctx: unknown) => unknown }
  >;
  const first = Object.entries(args).find(([, meta]) => meta.index === 0);
  if (!first) return '<no decorated argument at index 0>';
  const [key, meta] = first;
  if (!key.includes(CUSTOM_ROUTE_ARGS_METADATA) || typeof meta.factory !== 'function') {
    // A built-in extractor (e.g. @Param('businessId')): resolve it the way Nest does for PARAM.
    if (key.startsWith(`${RouteParamtypes.PARAM}:`)) return req.params?.[meta.data as string];
    return `<unsupported extractor ${key}>`;
  }
  const ctx = { switchToHttp: () => ({ getRequest: () => req }) };
  return meta.factory(meta.data, ctx);
}

describe('KeyCortexAuditController tenant binding (R0-34)', () => {
  let rig: Rig;

  beforeEach(() => {
    rig = makeController();
  });

  describe('each audit route receives the tenant the guard resolved', () => {
    for (const handler of AUDIT_HANDLERS) {
      it(`${handler} reads ?businessId= through the guard's resolver, not an absent path param`, () => {
        // The request the web compliance page sends: no :businessId in the path.
        const req = { params: {}, body: {}, query: { businessId: 'biz_A' } };
        expect(resolveRequestBusinessId(req)).toBe('biz_A');
        expect(resolvedTenantArgument(handler, req)).toBe('biz_A');
      });

      it(`${handler} acts on the tenant BusinessGuard checked when body and query disagree`, () => {
        const req = { params: {}, body: { businessId: 'biz_B' }, query: { businessId: 'biz_A' } };
        expect(resolvedTenantArgument(handler, req)).toBe(resolveRequestBusinessId(req));
      });
    }
  });

  describe('a handler with no tenant refuses instead of calling a service with undefined', () => {
    for (const handler of AUDIT_HANDLERS) {
      for (const [label, tenant] of [['no businessId', undefined], ['an empty businessId', '']] as const) {
        it(`${handler} with ${label} is refused (400/403) and reaches no service`, async () => {
          let thrown: unknown;
          try {
            await call(rig.controller, handler, tenant);
          } catch (err) {
            thrown = err;
          }
          expect(thrown).toBeInstanceOf(HttpException);
          expect([400, 403]).toContain((thrown as HttpException).getStatus());
          expect(serviceCalls(rig)).toEqual([]);
        });
      }
    }
  });

  describe('a handler with a tenant forwards it to every read', () => {
    for (const handler of AUDIT_HANDLERS) {
      it(`${handler} forwards the resolved tenant to every service read`, async () => {
        const body = await call(rig.controller, handler, 'biz_A');
        expect(body.businessId).toBe('biz_A');
        const calls = serviceCalls(rig);
        expect(calls.length).toBeGreaterThan(0);
        for (const args of calls) {
          const first = args[0] as unknown;
          const tenant = typeof first === 'object' && first !== null ? (first as any).where?.businessId : first;
          expect(tenant).toBe('biz_A');
        }
      });
    }
  });

  describe("no route reads @Param('businessId') on a path without :businessId", () => {
    it('KeyCortexAuditController (Nest route metadata)', () => {
      expect(reflectOffenders(KeyCortexAuditController)).toEqual([]);
    });

    it('every controller in apps/server/src (source scan)', () => {
      expect(sourceOffenders()).toEqual([]);
    });
  });
});
