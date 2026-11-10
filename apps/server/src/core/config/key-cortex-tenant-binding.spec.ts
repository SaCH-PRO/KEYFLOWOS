/**
 * R0-34b-KEY-TENANT-BINDING — the KEY cortex controllers act only on the tenant
 * BusinessGuard checked (R0-07a security review ST-1; COST-LEDGER-001 section 7
 * items 7, 8 and 9). This file is the pure half of the proof (no database); the
 * real-database half is test/key-cortex-tenant-binding.integration.test.ts.
 *
 * KeyCortexController and KeyCortexGoalsController are mounted at
 * `/api/v1/cortex` (no `:businessId` segment) behind AuthGuard and
 * BusinessGuard. BusinessGuard checks the tenant resolveRequestBusinessId
 * resolves: path parameter, then body, then query
 * (core/auth/request-business-id.ts). At the base, 36 handlers in
 * key-cortex.controller.ts and 4 in key-cortex-goals.controller.ts read
 * `@Query('businessId')`, and `conscious/stream` read `dto.businessId` from a
 * whole-object `@Query()`. A request whose JSON body names tenant A (one the
 * caller belongs to) and whose query names tenant B passed the guard for A and
 * acted on B. The fix is the R0-34 pattern (key-cortex-audit.controller.ts):
 * every such handler takes `@GuardedBusinessId()`.
 *
 * What this file checks:
 *   - source scan of every BusinessGuard-guarded controller in
 *     modules/key-cortex: no handler reads `@Query('businessId')` or
 *     `@Body('businessId')`, none reads the tenant from a whole-object
 *     `@Query()`, and a multipart (FileInterceptor) handler does not read the
 *     tenant from the multipart body (multer fills `req.body` after the guards
 *     ran, so the guard never saw it);
 *   - the 41 handlers that read the query at the base now take
 *     `@GuardedBusinessId()`;
 *   - section 7 item 8: KeyCortexDocumentService builds no OpenAI client with
 *     the sentinel key `sk-no-key`; with no key it builds none and answers the
 *     structured 503 provider_not_configured before any write or provider call;
 *   - section 7 item 7: OpenAiVoiceProvider and KeyflowVoiceService rethrow a
 *     provider_not_configured / provider_unavailable 503 unchanged and keep
 *     rewrapping every other error.
 *
 * A handler that reads `dto.businessId` from a whole JSON `@Body()` is not an
 * offender only when the body is a class DTO that validates businessId as a
 * string: the body is the first field the guard resolves on these paths, so a
 * non-empty string there is the tenant the guard checked. Review ST-2 found
 * five handlers typed `Dto & { businessId }`: tsc emits an intersection as
 * `Object`, the global ValidationPipe skips `Object`, and a body businessId
 * that is not a string (which the guard skips) reached the service raw. They
 * take the class DTO and @GuardedBusinessId() now, and this file checks both.
 *
 * No real key is ever set: the document-service cases use a recording stand-in
 * for the OpenAI SDK and a value that is not a key.
 */
import 'reflect-metadata';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as ts from 'typescript';
import { HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

const SERVER_SRC = resolve(__dirname, '../..');
const KEY_CORTEX_DIR = join(SERVER_SRC, 'modules/key-cortex');
const HTTP_DECORATORS = ['Get', 'Post', 'Put', 'Patch', 'Delete', 'Sse', 'All'];

/**
 * The handlers that read the tenant from the query string at the base
 * (36 + conscious/stream in key-cortex.controller.ts, 4 in
 * key-cortex-goals.controller.ts). Each must now take @GuardedBusinessId().
 */
const QUERY_TENANT_HANDLERS_AT_BASE: Record<string, string[]> = {
  'modules/key-cortex/key-cortex.controller.ts': [
    'listSessions', 'streamChat', 'getMessages', 'streamEvents', 'getAutonomyProfile', 'speak', 'listen',
    'listTools', 'getContext', 'getProfitOpportunities', 'analyzeRevenue', 'analyzeChurnRisk', 'analyzePipeline',
    'getMonitors', 'updateMonitor', 'toggleMonitor', 'getAlerts', 'getBusinessReport', 'getRecommendations',
    'flowList', 'flowGet', 'flowUpdate', 'flowDelete', 'flowExecute', 'flowToggle', 'phoneHistory', 'phoneStatus',
    'documentUpload', 'documentList', 'documentGet', 'documentDelete', 'evolutionProfile', 'evolutionPatterns',
    'evolutionReport', 'evolutionExplainDecision', 'consciousStream', 'getAwareness',
  ],
  'modules/key-cortex/key-cortex-goals.controller.ts': ['listGoals', 'getGoal', 'deleteGoal', 'listTriggerRules'],
};

/**
 * Review ST-2: the body handlers whose @Body() was typed `Dto & { businessId }`
 * at the base (emitted as `Object`, so never validated). Each must now take
 * @GuardedBusinessId().
 */
const INTERSECTION_BODY_HANDLERS_AT_BASE: Record<string, string[]> = {
  'modules/key-cortex/key-cortex.controller.ts': ['updateAutonomyProfile'],
  'modules/key-cortex/key-cortex-goals.controller.ts': ['createGoal', 'createPlanFromGoal', 'createPlanFromCommand', 'updateTriggerRule'],
};

interface Decorator { name: string; args: readonly ts.Expression[] }
/**
 * `type` is the parameter's type annotation; `businessIdValidators` is, when
 * that type names a class declared in the same file, the decorator names on the
 * class's `businessId` property (undefined when the type is not such a class,
 * [] when the class declares no `businessId`).
 */
interface HandlerParam { name: string; decorators: Decorator[]; type: ts.TypeNode | undefined; businessIdValidators: string[] | undefined }
interface Handler {
  file: string;
  cls: string;
  line: number;
  name: string;
  route: string;
  params: HandlerParam[];
  interceptors: string;
  body: ts.Node | undefined;
}

function decoratorsOf(node: ts.Node): Decorator[] {
  if (!ts.canHaveDecorators(node)) return [];
  return (ts.getDecorators(node) ?? []).flatMap((d) => {
    const e = d.expression;
    if (ts.isCallExpression(e)) return [{ name: e.expression.getText(), args: e.arguments }];
    if (ts.isIdentifier(e)) return [{ name: e.text, args: [] as readonly ts.Expression[] }];
    return [];
  });
}

function stringArg(d: Decorator | undefined): string | undefined {
  const a0 = d?.args[0];
  return a0 && (ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0)) ? a0.text : undefined;
}

/**
 * Every route handler of every BusinessGuard-guarded controller class in
 * modules/key-cortex (or, W7-KEY-CONNECTOR-TENANT, in the module directory
 * `dir` names).
 */
function guardedKeyCortexHandlers(dir: string = KEY_CORTEX_DIR): { controllers: string[]; handlers: Handler[] } {
  const controllers: string[] = [];
  const handlers: Handler[] = [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.controller.ts')).map((f) => join(dir, f));
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const classes = new Map<string, ts.ClassDeclaration>();
    sf.forEachChild((n) => { if (ts.isClassDeclaration(n) && n.name) classes.set(n.name.text, n); });
    const businessIdValidators = (type: ts.TypeNode | undefined): string[] | undefined => {
      if (!type || !ts.isTypeReferenceNode(type)) return undefined;
      const cls = classes.get(type.typeName.getText(sf));
      if (!cls) return undefined;
      const prop = cls.members.find((m) => ts.isPropertyDeclaration(m) && m.name.getText(sf) === 'businessId');
      return prop ? decoratorsOf(prop).map((d) => d.name) : [];
    };
    const visit = (node: ts.Node) => {
      if (ts.isClassDeclaration(node)) {
        const classDecs = decoratorsOf(node);
        const ctl = classDecs.find((d) => d.name === 'Controller');
        const classGuarded = classDecs.some((d) => d.name === 'UseGuards' && d.args.some((a) => a.getText() === 'BusinessGuard'));
        if (ctl) {
          if (classGuarded) controllers.push(`${relative(SERVER_SRC, file)} ${node.name?.text}`);
          for (const member of node.members) {
            if (!ts.isMethodDeclaration(member)) continue;
            const decs = decoratorsOf(member);
            const route = decs.find((d) => HTTP_DECORATORS.includes(d.name));
            if (!route) continue;
            const methodGuarded = decs.some((d) => d.name === 'UseGuards' && d.args.some((a) => a.getText() === 'BusinessGuard'));
            if (!classGuarded && !methodGuarded) continue;
            handlers.push({
              file: relative(SERVER_SRC, file),
              cls: node.name?.text ?? '',
              line: sf.getLineAndCharacterOfPosition(member.getStart(sf)).line + 1,
              name: member.name.getText(sf),
              route: `${route.name.toUpperCase()} ${stringArg(ctl) ?? ''}/${stringArg(route) ?? ''}`.replace(/\/+/g, '/'),
              params: member.parameters.map((p) => ({
                name: p.name.getText(sf),
                decorators: decoratorsOf(p),
                type: p.type,
                businessIdValidators: businessIdValidators(p.type),
              })),
              interceptors: decs.filter((d) => d.name === 'UseInterceptors').map((d) => d.args.map((a) => a.getText()).join(',')).join(','),
              body: member.body,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { controllers: controllers.sort(), handlers };
}

/** True when `body` reads `<ident>.businessId` (or `<ident>['businessId']`). */
function readsBusinessIdOf(body: ts.Node | undefined, ident: string): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === ident && node.name.text === 'businessId') found = true;
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === ident
      && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === 'businessId') found = true;
    ts.forEachChild(node, visit);
  };
  if (body) visit(body);
  return found;
}

const label = (h: Handler) => `${h.file}:${h.line} ${h.route} (${h.name})`;

/**
 * The `design:paramtypes` tsc emits (emitDecoratorMetadata, as the production
 * build) for each method of `file`, as `Class.method -> [type, ...]` source
 * text. The ValidationPipe validates a @Body() only when its entry is a class;
 * an intersection or a type literal is emitted as `Object`, which it skips.
 */
function emittedParamTypes(file: string): Map<string, string[]> {
  const source = readFileSync(join(SERVER_SRC, file), 'utf8');
  const out = ts.transpileModule(source, {
    compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true, target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const sf = ts.createSourceFile('emitted.js', out, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const types = new Map<string, string[]>();
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(sf) === '__decorate' && node.arguments.length >= 3) {
      const [decorators, target, name] = node.arguments;
      if (ts.isArrayLiteralExpression(decorators) && ts.isStringLiteral(name)) {
        for (const d of decorators.elements) {
          if (ts.isCallExpression(d) && d.expression.getText(sf) === '__metadata'
            && ts.isStringLiteral(d.arguments[0]) && d.arguments[0].text === 'design:paramtypes' && ts.isArrayLiteralExpression(d.arguments[1])) {
            types.set(`${target.getText(sf).replace(/\.prototype$/, '')}.${name.text}`, d.arguments[1].elements.map((e) => e.getText(sf)));
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return types;
}

describe('KEY cortex controllers bind the tenant BusinessGuard checked (R0-34b, R0-07a review ST-1)', () => {
  const { controllers, handlers } = guardedKeyCortexHandlers();

  it('finds the BusinessGuard-guarded KEY cortex controllers and their handlers', () => {
    expect(controllers).toEqual(expect.arrayContaining([
      'modules/key-cortex/key-cortex-audit.controller.ts KeyCortexAuditController',
      'modules/key-cortex/key-cortex-goals.controller.ts KeyCortexGoalsController',
      'modules/key-cortex/key-cortex.controller.ts KeyCortexController',
    ]));
    for (const [file, names] of Object.entries(QUERY_TENANT_HANDLERS_AT_BASE)) {
      const found = handlers.filter((h) => h.file === file).map((h) => h.name);
      expect(found, file).toEqual(expect.arrayContaining(names));
    }
  });

  it("no handler reads the tenant with @Query('businessId') or @Body('businessId')", () => {
    const offenders = handlers
      .filter((h) => h.params.some((p) => p.decorators.some((d) => (d.name === 'Query' || d.name === 'Body') && stringArg(d) === 'businessId')))
      .map(label);
    expect(offenders).toEqual([]);
  });

  it('no handler reads the tenant from a whole-object @Query() (dto.businessId)', () => {
    const offenders = handlers
      .filter((h) => h.params.some((p) => p.decorators.some((d) => d.name === 'Query' && d.args.length === 0) && readsBusinessIdOf(h.body, p.name)))
      .map(label);
    expect(offenders).toEqual([]);
  });

  it('a multipart (FileInterceptor) handler does not read the tenant from the multipart body, which the guard never saw', () => {
    const offenders = handlers
      .filter((h) => h.interceptors.includes('FileInterceptor'))
      .filter((h) => h.params.some((p) => p.decorators.some((d) => d.name === 'Body') && readsBusinessIdOf(h.body, p.name)))
      .map(label);
    expect(offenders).toEqual([]);
  });

  it('every handler that read the query for the tenant at the base takes @GuardedBusinessId()', () => {
    const missing: string[] = [];
    for (const [file, names] of Object.entries(QUERY_TENANT_HANDLERS_AT_BASE)) {
      for (const name of names) {
        const h = handlers.find((x) => x.file === file && x.name === name);
        if (!h || !h.params.some((p) => p.decorators.some((d) => d.name === 'GuardedBusinessId'))) missing.push(`${file} ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('a handler that reads businessId from a whole @Body() takes a class DTO that validates it as a string (review ST-2: an intersection or literal type is emitted as Object, which the ValidationPipe skips)', () => {
    const offenders = handlers
      .flatMap((h) => h.params
        .filter((p) => p.decorators.some((d) => d.name === 'Body' && d.args.length === 0) && readsBusinessIdOf(h.body, p.name))
        .filter((p) => !p.businessIdValidators?.includes('IsString'))
        .map((p) => `${label(h)} @Body() ${p.name}: ${p.type?.getText() ?? '(untyped)'}`));
    expect(offenders).toEqual([]);
  });

  it('every body handler whose @Body() was an intersection at the base takes @GuardedBusinessId() and a class-typed body (review ST-2)', () => {
    const missing: string[] = [];
    for (const [file, names] of Object.entries(INTERSECTION_BODY_HANDLERS_AT_BASE)) {
      for (const name of names) {
        const h = handlers.find((x) => x.file === file && x.name === name);
        const body = h?.params.find((p) => p.decorators.some((d) => d.name === 'Body'));
        if (!h || !h.params.some((p) => p.decorators.some((d) => d.name === 'GuardedBusinessId'))) missing.push(`${file} ${name}: no @GuardedBusinessId()`);
        if (!body?.type || !ts.isTypeReferenceNode(body.type) || body.businessIdValidators === undefined) {
          missing.push(`${file} ${name}: @Body() is not a class DTO (${body?.type?.getText() ?? 'none'})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('tsc emits a class, never Object, as the @Body() type of every guarded handler that reads businessId from its body, and the five emit exactly the types the real-database suite writes (review ST-2)', () => {
    const emitted = new Map<string, string[]>();
    for (const file of new Set(handlers.map((h) => h.file))) for (const [k, v] of emittedParamTypes(file)) emitted.set(`${file} ${k}`, v);

    const objectBodies = handlers.flatMap((h) => h.params
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.decorators.some((d) => d.name === 'Body' && d.args.length === 0) && readsBusinessIdOf(h.body, p.name))
      .filter(({ i }) => (emitted.get(`${h.file} ${h.cls}.${h.name}`)?.[i] ?? 'Object') === 'Object')
      .map(() => label(h)));
    expect(objectBodies).toEqual([]);

    // test/key-cortex-tenant-binding.integration.test.ts writes these (vitest emits no metadata).
    expect({
      updateAutonomyProfile: emitted.get('modules/key-cortex/key-cortex.controller.ts KeyCortexController.updateAutonomyProfile'),
      createGoal: emitted.get('modules/key-cortex/key-cortex-goals.controller.ts KeyCortexGoalsController.createGoal'),
      createPlanFromGoal: emitted.get('modules/key-cortex/key-cortex-goals.controller.ts KeyCortexGoalsController.createPlanFromGoal'),
      createPlanFromCommand: emitted.get('modules/key-cortex/key-cortex-goals.controller.ts KeyCortexGoalsController.createPlanFromCommand'),
      updateTriggerRule: emitted.get('modules/key-cortex/key-cortex-goals.controller.ts KeyCortexGoalsController.updateTriggerRule'),
    }).toEqual({
      updateAutonomyProfile: ['UpdateAutonomyProfileDto', 'String'],
      createGoal: ['CreateGoalDto', 'String'],
      // The trailing Object is the @CurrentUser() principal (R0-09e-KEY-PLAN-ACTOR).
      createPlanFromGoal: ['String', 'CreatePlanFromGoalDto', 'String', 'Object'],
      createPlanFromCommand: ['CreatePlanFromCommandDto', 'String', 'Object'],
      // KEY-R3b-PLAN-AUTHORITY (D-73): the member who changes a rule is recorded, so it takes the principal too.
      updateTriggerRule: ['String', 'UpdateTriggerRuleDto', 'String', 'Object'],
    });
  });

});

/* ------------------------------------------------------------------ */
/*  W7-KEY-CONNECTOR-TENANT: KeyConnectorController, the same split   */
/* ------------------------------------------------------------------ */

/**
 * W7-KEY-CONNECTOR-TENANT (R0-34b parked it here as an it.todo, outside its
 * write set). KeyConnectorController is mounted at `/key-connector` (no
 * `:businessId` segment) behind AuthGuard and BusinessGuard, and at the base
 * its 10 handlers read `@Query('businessId')`. BusinessGuard checks the tenant
 * resolveRequestBusinessId resolves (params, then body, then query), so a
 * member of A sending the JSON body {businessId: A} with ?businessId=B passed
 * the guard for A and the handler acted on B; and SUPER_ADMIN, whom the guard
 * admits naming no tenant, reached the service with `undefined`, which the
 * service's Prisma reads drop (`where: { businessId: undefined }` is no
 * filter): every tenant's connections. The fix is the R0-34b pattern: every
 * handler takes `@GuardedBusinessId()` and refuses a request that named none.
 *
 * The real-route cases run the real controller, the real AuthGuard and
 * BusinessGuard, Nest's routing, body parser and the production
 * ValidationPipe over HTTP. Two things stand in: the membership lookup the
 * guard runs (A's owner belongs to A only, B's owner to B only) and
 * KeyConnectorService, which records the tenant every call is handed and
 * holds rows of both tenants, answering, as the real service's Prisma reads
 * do, every tenant's rows for an undefined tenant.
 */
const KEY_CONNECTOR_DIR = join(SERVER_SRC, 'modules/key-connector');
const KEY_CONNECTOR_HANDLERS = [
  'getProviders', 'getProviderDetail', 'connectProvider', 'disconnectProvider', 'getConnections',
  'getHealth', 'triggerSync', 'getSyncHistory', 'executeAiCommand', 'getAuditLog',
];

const KC = {
  bizA: 'k34b_kc_biz_a',
  bizB: 'k34b_kc_biz_b',
  ownerA: 'k34b_kc_owner_a',
  ownerB: 'k34b_kc_owner_b',
  superAdmin: 'k34b_kc_super_admin',
  connA: 'k34b_kc_conn_a',
  connB: 'k34b_kc_conn_b',
};
const KC_USER_HEADER = 'x-k34b-kc-user';
const KC_USERS: Record<string, { id: string; role: string }> = {
  [KC.ownerA]: { id: KC.ownerA, role: 'USER' },
  [KC.ownerB]: { id: KC.ownerB, role: 'USER' },
  [KC.superAdmin]: { id: KC.superAdmin, role: 'SUPER_ADMIN' },
};
const KC_OWNERS: Record<string, string> = { [KC.bizA]: KC.ownerA, [KC.bizB]: KC.ownerB };
/** Every row of B carries this; no response to a caller acting on A may. */
const KC_B_MARKER = 'k34b-kc-tenant-B-row';
const KC_A_MARKER = 'k34b-kc-tenant-A-row';
const KC_PROVIDER = 'k34b-kc-provider';

/**
 * A stand-in row. `displayName` repeats the marker: the controller answers a
 * connection through an allow-list projection without its credentials (review
 * SEC-W7KC-1) that keeps displayName, so the marker survives into every
 * response that carries a row and "no response carries a row of B" stays a
 * real check.
 */
interface KcRow { id: string; businessId: string | undefined; kind: 'connection' | 'sync' | 'audit'; providerKey: string; marker: string; displayName: string }

const kcSeed = (): KcRow[] => ([
  { id: KC.connA, businessId: KC.bizA, kind: 'connection', providerKey: KC_PROVIDER, marker: KC_A_MARKER },
  { id: KC.connB, businessId: KC.bizB, kind: 'connection', providerKey: KC_PROVIDER, marker: KC_B_MARKER },
  { id: 'k34b_kc_sync_a', businessId: KC.bizA, kind: 'sync', providerKey: KC_PROVIDER, marker: KC_A_MARKER },
  { id: 'k34b_kc_sync_b', businessId: KC.bizB, kind: 'sync', providerKey: KC_PROVIDER, marker: KC_B_MARKER },
  { id: 'k34b_kc_audit_a', businessId: KC.bizA, kind: 'audit', providerKey: KC_PROVIDER, marker: KC_A_MARKER },
  { id: 'k34b_kc_audit_b', businessId: KC.bizB, kind: 'audit', providerKey: KC_PROVIDER, marker: KC_B_MARKER },
] as Array<Omit<KcRow, 'displayName'>>).map((r) => ({ ...r, displayName: r.marker }));

/**
 * KeyConnectorService stand-in: records the tenant each call is handed and
 * answers from rows of both tenants. An undefined tenant matches every
 * tenant's rows, as `where: { businessId: undefined }` does in the real
 * service's Prisma reads.
 */
class RecordingKeyConnectorService {
  handed: Array<{ method: string; businessId: unknown }> = [];
  rows: KcRow[] = kcSeed();

  reset() {
    this.handed = [];
    this.rows = kcSeed();
  }

  private of(businessId: unknown, kind: KcRow['kind']) {
    return this.rows.filter((r) => r.kind === kind && (businessId === undefined || r.businessId === businessId));
  }

  private connection(businessId: unknown, id: string) {
    const row = this.of(businessId, 'connection').find((r) => r.id === id);
    if (!row) throw new NotFoundException(`Connection "${id}" not found for this business`);
    return row;
  }

  private note(method: string, businessId: unknown) {
    this.handed.push({ method, businessId });
  }

  async getProviders(businessId: unknown) {
    this.note('getProviders', businessId);
    return this.of(businessId, 'connection').map((c) => ({ provider: { key: c.providerKey }, connection: c }));
  }

  async getProviderDetail(businessId: unknown, providerKey: string) {
    this.note('getProviderDetail', businessId);
    return { provider: { key: providerKey }, connection: this.of(businessId, 'connection').find((c) => c.providerKey === providerKey) };
  }

  async connectProvider(businessId: unknown, _userId: string, providerKey: string) {
    this.note('connectProvider', businessId);
    const marker = businessId === KC.bizB ? KC_B_MARKER : 'k34b-kc-new-row';
    const row: KcRow = {
      id: `k34b_kc_conn_new_${this.rows.length}`,
      businessId: businessId as string | undefined,
      kind: 'connection',
      providerKey,
      marker,
      displayName: marker,
    };
    this.rows.push(row);
    return row;
  }

  async disconnectProvider(businessId: unknown, connectionId: string) {
    this.note('disconnectProvider', businessId);
    const row = this.connection(businessId, connectionId);
    this.rows = this.rows.filter((r) => r !== row);
  }

  async getConnections(businessId: unknown) {
    this.note('getConnections', businessId);
    return this.of(businessId, 'connection');
  }

  async getConnectionHealth(businessId: unknown) {
    this.note('getConnectionHealth', businessId);
    return this.of(businessId, 'connection').map((c) => ({ connectionId: c.id, providerKey: c.providerKey, healthy: true, marker: c.marker }));
  }

  async triggerSync(businessId: unknown, connectionId: string, direction: string) {
    this.note('triggerSync', businessId);
    const row = this.connection(businessId, connectionId);
    return { connectionId: row.id, direction, status: 'scheduled', marker: row.marker };
  }

  async getSyncHistory(businessId: unknown) {
    this.note('getSyncHistory', businessId);
    return this.of(businessId, 'sync');
  }

  async processAiCommand(businessId: unknown, _userId: string, command: { businessId?: unknown }) {
    this.note('processAiCommand', businessId);
    this.note('processAiCommand(command.businessId)', command?.businessId);
    return { success: true, data: this.of(businessId, 'connection') };
  }

  async getAuditLog(businessId: unknown) {
    this.note('getAuditLog', businessId);
    return this.of(businessId, 'audit');
  }
}

/** BusinessGuard's membership lookup (userCanAccessBusiness): the owner of each business, and no one else, belongs to it. */
const kcMembershipPrisma = {
  client: {
    business: {
      // BusinessGuard asks { id, OR: [{ ownerId }, { members }] }; the
      // controller's writer check (review SEC-W7KC-2) asks { id, ownerId }.
      findFirst: async ({ where }: { where: { id?: unknown; ownerId?: unknown; OR?: Array<{ ownerId?: unknown; members?: { some?: { userId?: unknown } } }> } }) => {
        const userId = where.ownerId ?? where.OR?.find((o) => o.ownerId !== undefined)?.ownerId ?? where.OR?.find((o) => o.members)?.members?.some?.userId;
        const id = typeof where.id === 'string' ? where.id : undefined;
        return id && KC_OWNERS[id] !== undefined && KC_OWNERS[id] === userId ? { id, ownerId: userId } : null;
      },
    },
    // The owners here hold no Membership row: the writer check (review
    // SEC-W7KC-2) admits each as its business's distinguished owner, the arm
    // BusinessGuard admits them by. test/key-connector-authority.integration.test.ts
    // proves the role arm (OWNER, ADMIN admitted; STAFF refused) on real rows.
    membership: {
      findUnique: async () => null,
    },
  },
};

interface KcRoute {
  name: string;
  verb: 'get' | 'post' | 'delete';
  path: (connectionId: string) => string;
  body?: Record<string, unknown>;
}

/** The 10 routes, the DELETE last so a positive control still finds A's connection for the sync trigger. */
const KC_ROUTES: KcRoute[] = [
  { name: 'GET providers', verb: 'get', path: () => '/key-connector/providers' },
  { name: 'GET providers/:key', verb: 'get', path: () => `/key-connector/providers/${KC_PROVIDER}` },
  {
    name: 'POST providers/:key/connect',
    verb: 'post',
    path: () => '/key-connector/providers/k34b-kc-provider-new/connect',
    body: { providerKey: 'k34b-kc-provider-new', authData: {} },
  },
  { name: 'GET connections', verb: 'get', path: () => '/key-connector/connections' },
  { name: 'GET health', verb: 'get', path: () => '/key-connector/health' },
  { name: 'POST sync/:id/trigger', verb: 'post', path: (id) => `/key-connector/sync/${id}/trigger` },
  { name: 'GET sync', verb: 'get', path: () => '/key-connector/sync' },
  { name: 'POST ai/command', verb: 'post', path: () => '/key-connector/ai/command', body: { command: 'k34b-kc list my connections' } },
  { name: 'GET audit', verb: 'get', path: () => '/key-connector/audit' },
  { name: 'DELETE connections/:id', verb: 'delete', path: (id) => `/key-connector/connections/${id}` },
];

describe('KeyConnectorController binds the tenant BusinessGuard checked (W7-KEY-CONNECTOR-TENANT, the R0-34b pattern)', () => {
  const service = new RecordingKeyConnectorService();
  let app: { getHttpServer(): unknown; close(): Promise<void> } | undefined;

  beforeAll(async () => {
    const { Test } = await import('@nestjs/testing');
    const { ValidationPipe } = await import('@nestjs/common');
    const { KeyConnectorController } = await import('../../modules/key-connector/key-connector.controller');
    const { KeyConnectorService } = await import('../../modules/key-connector/key-connector.service');
    const { PrismaService } = await import('../prisma/prisma.service');
    const { AuthGuard } = await import('../auth/auth.guard');
    const { BusinessGuard } = await import('../auth/business.guard');
    // The production build (tsc, emitDecoratorMetadata) records the
    // controller's constructor parameter type and Nest injects by it; vitest's
    // esbuild transform emits no metadata, so this writes what tsc emits.
    if (!Reflect.getMetadata('design:paramtypes', KeyConnectorController)) {
      Reflect.defineMetadata('design:paramtypes', [KeyConnectorService, PrismaService], KeyConnectorController);
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [KeyConnectorController],
      providers: [
        AuthGuard,
        BusinessGuard,
        { provide: PrismaService, useValue: kcMembershipPrisma },
        { provide: KeyConnectorService, useValue: service },
      ],
    }).compile();
    const nest = moduleRef.createNestApplication({ logger: false });
    // Identity attachment only. No guard is overridden.
    nest.use((req: { headers: Record<string, unknown>; user?: unknown }, _res: unknown, next: () => void) => {
      const header = req.headers[KC_USER_HEADER];
      if (typeof header === 'string' && KC_USERS[header]) req.user = { ...KC_USERS[header] };
      next();
    });
    // The same pipe as app-bootstrap.ts.
    nest.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await nest.init();
    app = nest;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => service.reset());

  const call = async (route: KcRoute, opts: { user?: string; query?: string; body?: Record<string, unknown>; connectionId: string }) => {
    const { default: request } = await import('supertest');
    const url = route.path(opts.connectionId) + (opts.query ? `?businessId=${opts.query}` : '');
    let req = request(app!.getHttpServer() as Parameters<typeof request>[0])[route.verb](url);
    if (opts.user) req = req.set(KC_USER_HEADER, opts.user);
    const body = { ...(route.body ?? {}), ...(opts.body ?? {}) };
    return Object.keys(body).length > 0 ? req.send(body) : req;
  };
  const rowsOfB = () => service.rows.filter((r) => r.businessId === KC.bizB);

  it("key-connector/key-connector.controller.ts: none of its 10 BusinessGuard-guarded handlers reads @Query('businessId'), @Body('businessId') or a whole-object @Query(), and every one takes @GuardedBusinessId() (W7-KEY-CONNECTOR-TENANT)", () => {
    const { controllers, handlers } = guardedKeyCortexHandlers(KEY_CONNECTOR_DIR);
    expect(controllers).toEqual(['modules/key-connector/key-connector.controller.ts KeyConnectorController']);
    expect(handlers.map((h) => h.name).sort()).toEqual([...KEY_CONNECTOR_HANDLERS].sort());

    const readsRequestField = handlers
      .filter((h) => h.params.some((p) => p.decorators.some((d) => (d.name === 'Query' || d.name === 'Body') && stringArg(d) === 'businessId')))
      .map(label);
    expect(readsRequestField).toEqual([]);

    const readsWholeQuery = handlers
      .filter((h) => h.params.some((p) => p.decorators.some((d) => d.name === 'Query' && d.args.length === 0) && readsBusinessIdOf(h.body, p.name)))
      .map(label);
    expect(readsWholeQuery).toEqual([]);

    const readsWholeBody = handlers
      .filter((h) => h.params.some((p) => p.decorators.some((d) => d.name === 'Body' && d.args.length === 0) && readsBusinessIdOf(h.body, p.name)))
      .map(label);
    expect(readsWholeBody).toEqual([]);

    const missing = handlers.filter((h) => !h.params.some((p) => p.decorators.some((d) => d.name === 'GuardedBusinessId'))).map(label);
    expect(missing).toEqual([]);
  });

  it("a member of A sending the JSON body {businessId: A} with ?businessId=B acts on A only on each of the 10 routes: no service is handed B, no response carries a row of B, and B's connection survives (W7-KEY-CONNECTOR-TENANT)", async () => {
    const statuses: Record<string, number> = {};
    for (const route of KC_ROUTES) {
      const res = await call(route, { user: KC.ownerA, query: KC.bizB, body: { businessId: KC.bizA }, connectionId: KC.connB });
      statuses[route.name] = res.status;
      expect(JSON.stringify(res.body ?? null), route.name).not.toContain(KC_B_MARKER);
    }
    expect(statuses).toEqual({
      'GET providers': 200,
      'GET providers/:key': 200,
      'POST providers/:key/connect': 201,
      'GET connections': 200,
      'GET health': 200,
      // A has no connection with B's id: the handler looked in A.
      'POST sync/:id/trigger': 404,
      'GET sync': 200,
      'POST ai/command': 200,
      'GET audit': 200,
      'DELETE connections/:id': 404,
    });
    expect(service.handed.filter((h) => h.businessId !== KC.bizA)).toEqual([]);
    expect([...new Set(service.handed.map((h) => h.method))].sort()).toEqual([
      'connectProvider', 'disconnectProvider', 'getAuditLog', 'getConnectionHealth', 'getConnections', 'getProviderDetail',
      'getProviders', 'getSyncHistory', 'processAiCommand', 'processAiCommand(command.businessId)', 'triggerSync',
    ]);
    // Nothing of B was written, moved or removed; the new connection is A's.
    expect(rowsOfB()).toEqual(kcSeed().filter((r) => r.businessId === KC.bizB));
    expect(service.rows.filter((r) => r.providerKey === 'k34b-kc-provider-new').map((r) => r.businessId)).toEqual([KC.bizA]);
  });

  it('SUPER_ADMIN naming no tenant is refused 403 on each of the 10 routes, and no service is handed undefined, which reads every tenant (W7-KEY-CONNECTOR-TENANT)', async () => {
    const statuses: Record<string, number> = {};
    for (const route of KC_ROUTES) {
      const res = await call(route, { user: KC.superAdmin, connectionId: KC.connB });
      statuses[route.name] = res.status;
      expect(JSON.stringify(res.body ?? null), route.name).not.toContain(KC_B_MARKER);
      expect(JSON.stringify(res.body ?? null), route.name).not.toContain(KC_A_MARKER);
    }
    expect(statuses).toEqual(Object.fromEntries(KC_ROUTES.map((r) => [r.name, 403])));
    expect(service.handed).toEqual([]);
    expect(service.rows).toEqual(kcSeed());
  });

  it('a caller the guard refuses reaches no service on any of the 10 routes: no identity is 401, a member of A naming B in the query only is 403 (negative control)', async () => {
    const statuses: Record<string, [number, number]> = {};
    for (const route of KC_ROUTES) {
      const anonymous = await call(route, { query: KC.bizB, connectionId: KC.connB });
      const outsider = await call(route, { user: KC.ownerA, query: KC.bizB, connectionId: KC.connB });
      statuses[route.name] = [anonymous.status, outsider.status];
    }
    expect(statuses).toEqual(Object.fromEntries(KC_ROUTES.map((r) => [r.name, [401, 403]])));
    expect(service.handed).toEqual([]);
    expect(service.rows).toEqual(kcSeed());
  });

  it("A's owner naming A in the query (as the web client does) acts on A on each of the 10 routes and reads A's rows (positive control)", async () => {
    const statuses: Record<string, number> = {};
    const bodies: Record<string, string> = {};
    for (const route of KC_ROUTES) {
      const res = await call(route, { user: KC.ownerA, query: KC.bizA, connectionId: KC.connA });
      statuses[route.name] = res.status;
      bodies[route.name] = JSON.stringify(res.body ?? null);
      expect(bodies[route.name], route.name).not.toContain(KC_B_MARKER);
    }
    expect(statuses).toEqual({
      'GET providers': 200,
      'GET providers/:key': 200,
      'POST providers/:key/connect': 201,
      'GET connections': 200,
      'GET health': 200,
      'POST sync/:id/trigger': 202,
      'GET sync': 200,
      'POST ai/command': 200,
      'GET audit': 200,
      'DELETE connections/:id': 200,
    });
    for (const name of ['GET providers', 'GET connections', 'GET health', 'POST sync/:id/trigger', 'GET sync', 'POST ai/command', 'GET audit']) {
      expect(bodies[name], name).toContain(KC_A_MARKER);
    }
    expect(service.handed.filter((h) => h.businessId !== KC.bizA)).toEqual([]);
    expect(service.rows.some((r) => r.id === KC.connA)).toBe(false);
    expect(rowsOfB()).toEqual(kcSeed().filter((r) => r.businessId === KC.bizB));
  });
});

/* ------------------------------------------------------------------ */
/*  COST-LEDGER-001 section 7 item 8: no sentinel key                  */
/* ------------------------------------------------------------------ */

/** The OpenAI SDK, replaced by a recorder: no request can leave this file. */
const sdk = vi.hoisted(() => ({
  attempts: [] as Array<{ apiKey?: string }>,
  embeddings: [] as Array<Record<string, unknown>>,
}));

vi.mock('openai', () => {
  class RecordingOpenAI {
    embeddings = {
      create: async (args: Record<string, unknown>) => {
        sdk.embeddings.push(args);
        return { data: [{ embedding: [0.25, 0.5, 0.75] }] };
      },
    };
    constructor(options: { apiKey?: string } = {}) {
      sdk.attempts.push({ apiKey: options.apiKey });
    }
  }
  return { default: RecordingOpenAI, OpenAI: RecordingOpenAI };
});

const OPENAI_ENV = ['AI_INTEGRATIONS_OPENAI_API_KEY', 'OPENAI_API_KEY'];
/** Not a key: the recorder above is the only thing that ever sees it. */
const NOT_A_KEY = 'k34b-test-not-a-real-key';

function expectNotConfigured(err: unknown) {
  expect(err).toBeInstanceOf(HttpException);
  const e = err as HttpException;
  expect(e.getStatus()).toBe(503);
  expect(e.getResponse()).toMatchObject({ code: 'provider_not_configured', service: 'ai' });
}

function documentServiceDeps() {
  const keyDocument = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'k34b_doc', ...data })),
    update: vi.fn(async () => ({})),
    findMany: vi.fn(async () => [{ id: 'k34b_doc', fileName: 'k34b.txt', status: 'indexed' }]),
    findFirst: vi.fn(async () => ({ id: 'k34b_doc', fileName: 'k34b.txt', status: 'indexed' })),
  };
  const prisma = { client: { keyDocument } };
  const redis = { setJson: vi.fn(async () => undefined), getJson: vi.fn(async () => null), keys: vi.fn(async () => []) };
  const gateway = { complete: vi.fn(async () => { throw new Error('k34b: the gateway is not under test'); }) };
  return { prisma, redis, gateway, keyDocument };
}

describe('KeyCortexDocumentService builds no OpenAI client with a sentinel key (COST-LEDGER-001 section 7 item 8)', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of OPENAI_ENV) { saved[key] = process.env[key]; delete process.env[key]; }
    sdk.attempts.length = 0;
    sdk.embeddings.length = 0;
  });
  afterEach(() => {
    for (const key of OPENAI_ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  const build = async () => {
    const { KeyCortexDocumentService } = await import('../../modules/key-cortex/key-cortex-document.service');
    const deps = documentServiceDeps();
    const service = new KeyCortexDocumentService(deps.prisma as any, deps.redis as any, deps.gateway as any, {} as any, {} as any);
    return { service, ...deps };
  };
  const textFile = () => ({ buffer: Buffer.from('k34b document text', 'utf8'), originalname: 'k34b.txt', mimetype: 'text/plain', size: 18 });

  it('the service source names no sentinel key and takes its key from directOpenAiKey()/directOpenAiNotConfigured()', () => {
    const source = readFileSync(join(KEY_CORTEX_DIR, 'key-cortex-document.service.ts'), 'utf8');
    expect(source).not.toContain('sk-no-key');
    expect(source).toMatch(/import\s*\{[^}]*\bdirectOpenAiKey\b[^}]*\}\s*from\s*'\.\.\/ai\/ai-usage\.service'/);
    expect(source).toMatch(/import\s*\{[^}]*\bdirectOpenAiNotConfigured\b[^}]*\}\s*from\s*'\.\.\/ai\/ai-usage\.service'/);
  });

  it('with neither AI_INTEGRATIONS_OPENAI_API_KEY nor OPENAI_API_KEY set it builds no OpenAI client', async () => {
    await build();
    expect(sdk.attempts).toEqual([]);
  });

  it('with no key, uploadDocument answers 503 provider_not_configured before any KeyDocument row or provider call', async () => {
    const { service, keyDocument } = await build();
    const err = await service.uploadDocument(textFile(), {}, 'k34b_biz').then(() => null, (e: unknown) => e);
    expectNotConfigured(err);
    expect(keyDocument.create).not.toHaveBeenCalled();
    expect(keyDocument.update).not.toHaveBeenCalled();
    expect(sdk.embeddings).toEqual([]);
  });

  it('with no key, askAcrossDocuments answers 503 provider_not_configured instead of calling the provider', async () => {
    const { service } = await build();
    const err = await service.askAcrossDocuments('k34b question', 'k34b_biz').then(() => null, (e: unknown) => e);
    expectNotConfigured(err);
    expect(sdk.embeddings).toEqual([]);
  });

  it('with a key configured, it builds one client with that key and uploadDocument embeds and indexes as before', async () => {
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = NOT_A_KEY;
    const { service, keyDocument, redis } = await build();
    expect(sdk.attempts).toEqual([{ apiKey: NOT_A_KEY }]);
    const result = await service.uploadDocument(textFile(), {}, 'k34b_biz');
    expect(result).toMatchObject({ documentId: 'k34b_doc', status: 'indexed', chunksIndexed: 1 });
    expect(keyDocument.create).toHaveBeenCalledTimes(1);
    expect(sdk.embeddings).toHaveLength(1);
    expect(sdk.embeddings[0]).toMatchObject({ model: 'text-embedding-3-small', input: 'k34b document text' });
    expect(redis.setJson).toHaveBeenCalled();
  });

  it('OPENAI_API_KEY alone (the production container name) builds the client with that key', async () => {
    process.env.OPENAI_API_KEY = NOT_A_KEY;
    await build();
    expect(sdk.attempts).toEqual([{ apiKey: NOT_A_KEY }]);
  });
});

/* ------------------------------------------------------------------ */
/*  COST-LEDGER-001 section 7 item 7: the 503 code survives           */
/* ------------------------------------------------------------------ */

const notConfigured = () => new ServiceUnavailableException({
  code: 'provider_not_configured', service: 'ai', message: 'No AI providers available: k34b', error: 'Service Unavailable',
});
const unavailable = () => new ServiceUnavailableException({
  code: 'provider_unavailable', service: 'ai', message: 'No AI providers available: k34b circuit open', error: 'Service Unavailable',
});

describe('voice wrappers keep the provider_not_configured / provider_unavailable 503 (COST-LEDGER-001 section 7 item 7)', () => {
  const cases = async () => {
    const { OpenAiVoiceProvider } = await import('../../modules/voice/openai-voice.provider');
    const { KeyflowVoiceService } = await import('../../modules/keyflow-command/keyflow-voice.service');
    return [
      { label: 'OpenAiVoiceProvider.synthesize', run: (usage: any) => new OpenAiVoiceProvider(usage).synthesize('k34b_biz', 'Hello') },
      { label: 'KeyflowVoiceService.synthesize', run: (usage: any) => new KeyflowVoiceService(usage).synthesize('k34b_biz', { text: 'Hello' }) },
      { label: 'KeyflowVoiceService.transcribe', run: (usage: any) => new KeyflowVoiceService(usage).transcribe('k34b_biz', Buffer.from('k34b'), 'audio/webm') },
    ];
  };

  it('rethrow a provider_not_configured 503 unchanged (same exception, code intact)', async () => {
    for (const c of await cases()) {
      const thrown = notConfigured();
      const err = await c.run({ trackAudio: async () => { throw thrown; } }).then(() => null, (e: unknown) => e);
      expect(err, c.label).toBe(thrown);
    }
  });

  it('rethrow a provider_unavailable 503 unchanged', async () => {
    for (const c of await cases()) {
      const thrown = unavailable();
      const err = await c.run({ trackAudio: async () => { throw thrown; } }).then(() => null, (e: unknown) => e);
      expect(err, c.label).toBe(thrown);
    }
  });

  it('keep rewrapping every other error in their own 503', async () => {
    const expected: Record<string, string> = {
      'OpenAiVoiceProvider.synthesize': 'OpenAI TTS failed: k34b provider exploded',
      'KeyflowVoiceService.synthesize': 'Voice synthesis failed.',
      'KeyflowVoiceService.transcribe': 'Voice transcription failed.',
    };
    for (const c of await cases()) {
      for (const cause of [new Error('k34b provider exploded'), new HttpException('k34b provider exploded', 502)]) {
        const err = await c.run({ trackAudio: async () => { throw cause; } }).then(() => null, (e: unknown) => e);
        expect(err, c.label).toBeInstanceOf(ServiceUnavailableException);
        expect(err, c.label).not.toBe(cause);
        expect((err as HttpException).message, c.label).toBe(expected[c.label]);
        expect((err as HttpException).getResponse(), c.label).not.toMatchObject({ code: expect.anything() });
      }
    }
  });
});
