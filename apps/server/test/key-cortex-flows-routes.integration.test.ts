/**
 * R0-13g-KEY-FLOWS-ROUTES — the last two shadowed routes come alive safely
 * (REAL database).
 *
 * R0-13e's static guard (apps/server/src/core/config/route-shadowing.spec.ts)
 * found them in key-cortex.controller.ts. Nest registers a controller's
 * handlers in declaration order and Express answers with the first pattern
 * that matches, so both were answered by flowGet (GET flows/:id) with the
 * literal segment as a flow id, and the handler each names had never run over
 * HTTP:
 *
 *   GET /api/v1/cortex/flows/templates   answered by flowGet as flow 'templates'
 *   GET /api/v1/cortex/flows/nodes       answered by flowGet as flow 'nodes'
 *
 * flowGet calls `flowStudio.get(...)`, a method KeyCortexFlowStudioService does
 * not have (the controller holds the service as `any`), so at the base both
 * answered flowGet's 503 'Unable to retrieve flow', not a 404. No web screen
 * calls either route: apps/web's flow screens read templates from
 * /api/flows/businesses/:businessId/templates (modules/flow).
 *
 * What each handler was checked for before it went live (the cases below; the
 * static half is in route-shadowing.spec.ts):
 *   - guards: the class's AuthGuard and BusinessGuard, exactly flowGet's (it has
 *     no module scope): 401 unauthenticated, 403 for a user who is no member of
 *     the named business, 403 with no business named;
 *   - tenant binding (R0-34b): neither handler reads a tenant; the tenant is the
 *     one BusinessGuard checked (a body businessId naming another tenant is the
 *     one the guard resolves first, and refuses);
 *   - actor binding (R0-09c): neither handler reads an actor; a ?userId or body
 *     userId naming another user changes nothing;
 *   - the data: both answer a global catalogue, KeyCortexFlowStudioService's
 *     built-in templates and its node registry, the same bytes for every
 *     tenant and member, and never a tenant's flow definition.
 *
 * WHAT IS REAL: PrismaService, AuthGuard, BusinessGuard, TenantInterceptor (as
 * the APP_INTERCEPTOR app.module.ts installs) with the Prisma tenant extension's
 * context provider installed (main.ts), the production GlobalHttpExceptionFilter
 * and ValidationPipe, KeyCortexController and KeyCortexFlowStudioService (its
 * template catalogue and node registry; its database reads and writes are
 * real too, and no case reaches them), against DATABASE_URL. Stand-ins:
 * identity attachment (a test middleware reads `x-k13g-user` and attaches the
 * seeded user row, as AuthMiddleware does after token verification); the flow
 * studio's connector, model gateway and AI usage service (no case reaches them);
 * and the controller's collaborators for its other routes (an allow-listed
 * mocker). Vitest's esbuild transform emits no constructor parameter types, so
 * the suite writes the ones tsc emits for the controller, as
 * key-cortex-tenant-binding does.
 *
 * Every seeded row carries the `k13g_` prefix and is hard-deleted by raw SQL
 * with sqlLikePrefix() in beforeAll and afterAll; no $transaction wrapping.
 * Cases tagged NEGATIVE CONTROL are the pre-fix failing controls; cases tagged
 * refusal pass before and after (flowGet carried the same guards). The case
 * list is bound by scripts/proof-admission/manifests/shadowed-routes-live.json
 * (allowAdditionalCases false).
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k13g_';
const HEADER = 'x-k13g-user';

const ID = {
  ownerA: `${P}ownerA`, // OWNER of bizA only
  staffA: `${P}staffA`, // STAFF of bizA with no module scopes
  ownerB: `${P}ownerB`, // OWNER of bizB only
  nomember: `${P}nomember`, // no business anywhere
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  flowA: `${P}flow_a`,
  flowB: `${P}flow_b`,
};
const A_MARKER = 'k13g-tenant-A-private';
const B_MARKER = 'k13g-tenant-B-private';
const ROUTES = ['flows/templates', 'flows/nodes'] as const;

/** The controller's collaborators for its other routes; the two routes under test reach none of them. */
const OFF_BOUNDARY = new Set([
  'KeyCortexReasoningService', 'KeyCortexConversationService', 'KeyCortexVoiceService', 'KeyCortexPersonalityService',
  'KeyCortexActionsService', 'KeyCortexContextService', 'KeyCortexConnectorService', 'KeyCortexCommandService',
  'KeyCortexExecutorService', 'KeyCortexContextV2Service', 'KeyCortexInsightService', 'KeyCortexMonitorV2Service',
  'KeyCortexSandboxService', 'KeyCortexEvolutionService', 'KeyCortexPhoneService', 'KeyCortexDocumentService',
  'KeyCortexLearningService', 'KeyAutonomySafetyService', 'KeyCortexApprovalOrchestratorService',
  'KeyCortexConsciousnessService', 'KeyCortexSessionService', 'KeyCortexAwarenessService',
]);

let db: any;
let app: any;
/** What the real flow studio was asked, in order (recorded, then called through). */
const studioCalls: string[] = [];
/** The two catalogues as the service builds them, computed outside any request. */
let expectedTemplates: Array<Record<string, any>>;
let expectedNodes: Array<Record<string, any>>;

async function cleanup() {
  for (const sql of [
    `DELETE FROM flow_executions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM flow_definitions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** GET /api/v1/cortex/<route>, as `user`, with a raw query string and an optional JSON body. */
function get(route: string, opts: { user?: string; query?: string; body?: Record<string, unknown> } = {}) {
  let req = request(app.getHttpServer()).get(`/api/v1/cortex/${route}${opts.query ? `?${opts.query}` : ''}`);
  if (opts.user) req = req.set(HEADER, opts.user);
  if (opts.body) req = req.send(opts.body);
  return req;
}

const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const flowRows = () => db.flowDefinition.count({ where: { businessId: { in: [ID.bizA, ID.bizB] } } });
const executionRows = () => db.flowExecution.count({ where: { businessId: { in: [ID.bizA, ID.bizB] } } });

/** Neither tenant's flow definition, nor any tenant id, appears in a body. */
function expectNoTenantData(text: string, where: string) {
  for (const needle of [A_MARKER, B_MARKER, ID.flowA, ID.flowB, ID.bizA, ID.bizB, '"businessId"']) {
    expect(text.includes(needle), `${where} carries ${needle}`).toBe(false);
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const tenant = await import('../src/core/tenant/tenant-context');
  // As main.ts does before the app serves: the extension reads the ambient
  // tenant that TenantInterceptor installs.
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { APP_INTERCEPTOR } = await import('@nestjs/core');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { KeyCortexController } = await import('../src/modules/key-cortex/key-cortex.controller');
  const { KeyCortexReasoningService } = await import('../src/modules/key-cortex/key-cortex-reasoning.service');
  const { KeyCortexConversationService } = await import('../src/modules/key-cortex/key-cortex-conversation.service');
  const { KeyCortexVoiceService } = await import('../src/modules/key-cortex/key-cortex-voice.service');
  const { KeyCortexPersonalityService } = await import('../src/modules/key-cortex/key-cortex-personality.service');
  const { KeyCortexActionsService } = await import('../src/modules/key-cortex/key-cortex-actions.service');
  const { KeyCortexContextService } = await import('../src/modules/key-cortex/key-cortex-context.service');
  const { KeyCortexConnectorService } = await import('../src/modules/key-cortex/key-cortex-connector.service');
  const { KeyCortexCommandService } = await import('../src/modules/key-cortex/key-cortex-command.service');
  const { KeyCortexExecutorService } = await import('../src/modules/key-cortex/key-cortex-executor.service');
  const { KeyCortexContextV2Service } = await import('../src/modules/key-cortex/key-cortex-context-v2.service');
  const { KeyCortexInsightService } = await import('../src/modules/key-cortex/key-cortex-insight.service');
  const { KeyCortexMonitorV2Service } = await import('../src/modules/key-cortex/key-cortex-monitor-v2.service');
  const { KeyCortexSandboxService } = await import('../src/modules/key-cortex/key-cortex-sandbox.service');
  const { KeyCortexFlowStudioService } = await import('../src/modules/key-cortex/key-cortex-flow-studio.service');
  const { KeyCortexEvolutionService } = await import('../src/modules/key-cortex/key-cortex-evolution.service');
  const { KeyCortexPhoneService } = await import('../src/modules/key-cortex/key-cortex-phone.service');
  const { KeyCortexDocumentService } = await import('../src/modules/key-cortex/key-cortex-document.service');
  const { KeyCortexLearningService } = await import('../src/modules/key-cortex/key-cortex-learning.service');
  const { KeyAutonomySafetyService } = await import('../src/modules/key-autonomy/key-autonomy-safety.service');
  const { KeyCortexApprovalOrchestratorService } = await import('../src/modules/key-cortex/key-cortex-approval-orchestrator.service');
  const { KeyCortexConsciousnessService } = await import('../src/modules/key-cortex/key-cortex-consciousness.service');
  const { KeyCortexSessionService } = await import('../src/modules/key-cortex/key-cortex-session.service');
  const { KeyCortexAwarenessService } = await import('../src/modules/key-cortex/key-cortex-awareness.service');

  // The production build (tsc, emitDecoratorMetadata) records the constructor
  // parameter types Nest injects by; vitest's esbuild transform does not. This
  // writes exactly what tsc emits (and leaves the class alone if it is there).
  if (!Reflect.getMetadata('design:paramtypes', KeyCortexController)) {
    Reflect.defineMetadata('design:paramtypes', [
      KeyCortexReasoningService, KeyCortexConversationService, KeyCortexVoiceService, KeyCortexPersonalityService,
      KeyCortexActionsService, KeyCortexContextService, KeyCortexConnectorService, KeyCortexCommandService,
      KeyCortexExecutorService, KeyCortexContextV2Service, KeyCortexInsightService, KeyCortexMonitorV2Service,
      KeyCortexSandboxService, KeyCortexFlowStudioService, KeyCortexEvolutionService, KeyCortexPhoneService,
      KeyCortexDocumentService, KeyCortexLearningService, KeyAutonomySafetyService, KeyCortexApprovalOrchestratorService,
      KeyCortexConsciousnessService, KeyCortexSessionService, KeyCortexAwarenessService,
    ], KeyCortexController);
  }

  // The flow studio's AI collaborators are off this path: any use of one throws.
  const off = (name: string) => new Proxy({}, {
    get: (_t, prop) => (prop === 'then' ? undefined : () => { throw new Error(`k13g: ${name}.${String(prop)} is off this path`); }),
  });
  const reference = new KeyCortexFlowStudioService({} as any, off('connector') as any, off('modelGateway') as any, off('aiUsage') as any, new EventEmitter2());
  expectedTemplates = json(reference.getTemplates());
  expectedNodes = json(reference.getNodeRegistry());

  const moduleRef = await Test.createTestingModule({
    controllers: [KeyCortexController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      {
        provide: KeyCortexFlowStudioService,
        useFactory: (prisma: any) => new KeyCortexFlowStudioService(
          prisma, off('connector') as any, off('modelGateway') as any, off('aiUsage') as any, new EventEmitter2(),
        ),
        inject: [PrismaService],
      },
      // Installed globally in production (app.module.ts).
      { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
    ],
  })
    .useMocker((token: any) => {
      const name = typeof token === 'function' ? token.name : String(token);
      return OFF_BOUNDARY.has(name) ? {} : undefined;
    })
    .compile();

  // Record (and call through) what the real flow studio is asked.
  const studio: any = moduleRef.get(KeyCortexFlowStudioService);
  for (const method of ['getTemplates', 'getTemplateById', 'getNodeRegistry', 'loadFlow', 'listFlows', 'persistFlow', 'deleteFlow']) {
    const original = studio[method].bind(studio);
    vi.spyOn(studio, method).mockImplementation((...args: any[]) => {
      studioCalls.push(method);
      return original(...args);
    });
  }

  app = moduleRef.createNestApplication();
  // Identity attachment only, for seeded k13g_ users. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  // Same filter and pipe as app-bootstrap.ts, so status codes and bodies are the production ones.
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup(); // in case a prior run aborted

  for (const id of [ID.ownerA, ID.staffA, ID.ownerB, ID.nomember]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'K13G Biz A', ownerId: ID.ownerA } });
  await db.business.create({ data: { id: ID.bizB, name: 'K13G Biz B', ownerId: ID.ownerB } });
  await db.membership.create({ data: { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_staffA`, userId: ID.staffA, businessId: ID.bizA, role: 'STAFF', permissionScopes: {} } });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });

  // One private flow definition per tenant: what a tenant-scoped answer would leak.
  for (const [id, businessId, marker] of [[ID.flowA, ID.bizA, A_MARKER], [ID.flowB, ID.bizB, B_MARKER]] as const) {
    await db.flowDefinition.create({
      data: {
        id, businessId, name: `${marker} flow`, description: `${marker} description`, status: 'active',
        category: marker, tags: [marker], nodes: [{ id: `${P}node`, type: 'trigger', data: { label: marker } }],
      },
    });
  }
}, 120_000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (app) await app.close();
  if (db) await cleanup();
  const dbMod = await import('@keyflow/db');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: () => undefined });
});

describe('fixture sanity (real rows)', () => {
  it("seeded two tenants with their members and one private flow definition each; A's owner has no membership of B and B's owner none of A; the reference catalogues are not empty", async () => {
    expect(await db.membership.count({ where: { businessId: ID.bizA } })).toBe(2);
    expect(await db.membership.count({ where: { businessId: ID.bizB } })).toBe(1);
    expect(await db.membership.count({ where: { businessId: ID.bizB, userId: ID.ownerA } })).toBe(0);
    expect(await db.membership.count({ where: { businessId: ID.bizA, userId: ID.ownerB } })).toBe(0);
    expect(await db.membership.count({ where: { userId: ID.nomember } })).toBe(0);
    expect(await flowRows()).toBe(2);
    // 45 at this base (the service's '50+' comment is aspirational).
    expect(expectedTemplates.length).toBeGreaterThan(10);
    expect(expectedNodes.length).toBeGreaterThan(5);
  });

  it("the guarded sibling GET flows/:id refuses the same callers for a real flow id: 401 with no identity, 403 for B's owner naming A", async () => {
    expect((await get(`flows/${ID.flowA}`, { query: `businessId=${ID.bizA}` })).status).toBe(401);
    expect((await get(`flows/${ID.flowA}`, { user: ID.ownerB, query: `businessId=${ID.bizA}` })).status).toBe(403);
  });
});

describe('R0-13g: each formerly shadowed route reaches its own handler over HTTP, not flows/:id', () => {
  it("NEGATIVE CONTROL: GET flows/templates answers flowTemplates' { templates }, the built-in catalogue KeyCortexFlowStudioService.getTemplates() returns (every template, in order), not flowGet's answer for flow 'templates'", async () => {
    const from = studioCalls.length;
    const res = await get('flows/templates', { user: ID.ownerA, query: `businessId=${ID.bizA}` });
    expect(res.status, res.text.slice(0, 300)).toBe(200);
    expect(res.body).toEqual({ templates: expectedTemplates });
    expect(res.body.templates.map((t: any) => t.id)).toContain('tpl_new_lead_welcome');
    expect(studioCalls.slice(from)).toEqual(['getTemplates']);
  });

  it("NEGATIVE CONTROL: GET flows/nodes answers flowNodes' { nodes }, the node registry KeyCortexFlowStudioService.getNodeRegistry() returns (every node type, in order), not flowGet's answer for flow 'nodes'", async () => {
    const from = studioCalls.length;
    const res = await get('flows/nodes', { user: ID.ownerA, query: `businessId=${ID.bizA}` });
    expect(res.status, res.text.slice(0, 300)).toBe(200);
    expect(res.body).toEqual({ nodes: expectedNodes });
    expect(res.body.nodes.map((n: any) => n.type)).toContain('trigger');
    expect(studioCalls.slice(from)).toEqual(['getNodeRegistry']);
  });

  it('NEGATIVE CONTROL: GET flows/templates?category= narrows the catalogue to that category, matched without regard to case; an unknown category answers an empty list; a repeated category answers 400', async () => {
    const sales = expectedTemplates.filter((t) => t.category === 'Sales');
    expect(sales.length).toBeGreaterThan(1);
    for (const category of ['Sales', 'sales', 'SALES']) {
      const res = await get('flows/templates', { user: ID.ownerA, query: `businessId=${ID.bizA}&category=${category}` });
      expect(res.status, `${category} ${res.text.slice(0, 300)}`).toBe(200);
      expect(res.body, category).toEqual({ templates: sales });
    }
    const unknown = await get('flows/templates', { user: ID.ownerA, query: `businessId=${ID.bizA}&category=${P}none` });
    expect(unknown.status, unknown.text.slice(0, 300)).toBe(200);
    expect(unknown.body).toEqual({ templates: [] });
    const repeated = await get('flows/templates', { user: ID.ownerA, query: `businessId=${ID.bizA}&category=Sales&category=Finance` });
    expect(repeated.status, repeated.text.slice(0, 300)).toBe(400);
    expect(repeated.text).toMatch(/category/);
  });
});

describe('R0-13g: the newly reachable handlers carry the guards of flows/:id', () => {
  it('refusal: an unauthenticated caller gets 401 on both routes, as on flows/:id, and the flow studio is never asked', async () => {
    const from = studioCalls.length;
    for (const route of ROUTES) {
      const res = await get(route, { query: `businessId=${ID.bizA}` });
      expect(res.status, `${route} ${res.text.slice(0, 200)}`).toBe(401);
    }
    expect(studioCalls.slice(from)).toEqual([]);
  });

  it("refusal: a user who is no member of the named business (B's owner naming A, a user with no business) gets 403 on both routes, as on flows/:id, naming no business is 403, and the flow studio is never asked", async () => {
    const from = studioCalls.length;
    for (const route of ROUTES) {
      for (const user of [ID.ownerB, ID.nomember]) {
        const res = await get(route, { user, query: `businessId=${ID.bizA}` });
        expect(res.status, `${route} ${user} ${res.text.slice(0, 200)}`).toBe(403);
      }
      const none = await get(route, { user: ID.ownerA });
      expect(none.status, `${route} ${none.text.slice(0, 200)}`).toBe(403);
      expect(none.text).toMatch(/businessId is required/);
    }
    expect(studioCalls.slice(from)).toEqual([]);
  });
});

describe('R0-13g: the newly reachable handlers are tenant-bound and actor-bound', () => {
  it("NEGATIVE CONTROL: both answers are the global catalogue and nothing tenant-specific: byte-identical for A's owner under A, A's STAFF member with no module scopes under A and B's owner under B, carrying neither tenant's flow definition (id, name, category) nor any business id, and nothing is written", async () => {
    const flowsBefore = await flowRows();
    const executionsBefore = await executionRows();
    for (const route of ROUTES) {
      const answers: string[] = [];
      for (const [user, businessId] of [[ID.ownerA, ID.bizA], [ID.staffA, ID.bizA], [ID.ownerB, ID.bizB]] as const) {
        const res = await get(route, { user, query: `businessId=${businessId}` });
        expect(res.status, `${route} ${user} ${res.text.slice(0, 300)}`).toBe(200);
        expectNoTenantData(res.text, `${route} for ${user}`);
        answers.push(res.text);
      }
      expect(new Set(answers).size, route).toBe(1);
      expect(JSON.parse(answers[0]), route).toEqual(route === 'flows/templates' ? { templates: expectedTemplates } : { nodes: expectedNodes });
    }
    expect(await flowRows()).toBe(flowsBefore);
    expect(await executionRows()).toBe(executionsBefore);
  });

  it('NEGATIVE CONTROL: the handlers read no tenant or actor from the request: a ?userId or body userId naming another user changes nothing, and a body businessId naming another tenant is the tenant BusinessGuard checks (403 for a non-member), never one the handler reads', async () => {
    for (const route of ROUTES) {
      const plain = await get(route, { user: ID.ownerA, query: `businessId=${ID.bizA}` });
      expect(plain.status, `${route} ${plain.text.slice(0, 300)}`).toBe(200);
      const viaQuery = await get(route, { user: ID.ownerA, query: `businessId=${ID.bizA}&userId=${ID.ownerB}` });
      const viaBody = await get(route, { user: ID.ownerA, query: `businessId=${ID.bizA}`, body: { userId: ID.ownerB } });
      for (const res of [viaQuery, viaBody]) {
        expect(res.status, `${route} ${res.text.slice(0, 300)}`).toBe(200);
        expect(res.text, route).toBe(plain.text);
      }
      // The guard resolves the body first: A's owner naming B there is refused, whatever the query says.
      const foreignBody = await get(route, { user: ID.ownerA, query: `businessId=${ID.bizA}`, body: { businessId: ID.bizB } });
      expect(foreignBody.status, `${route} ${foreignBody.text.slice(0, 200)}`).toBe(403);
      // ... and B's owner naming B there is admitted for B, and gets the same catalogue.
      const ownBody = await get(route, { user: ID.ownerB, query: `businessId=${ID.bizA}`, body: { businessId: ID.bizB } });
      expect(ownBody.status, `${route} ${ownBody.text.slice(0, 300)}`).toBe(200);
      expect(ownBody.text, route).toBe(plain.text);
    }
  });
});
