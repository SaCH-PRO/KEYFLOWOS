/**
 * SWEEP-P0-SCOPES census (docs/reconstruction/REST-SCOPE-CENSUS-2026-11-13.md) — the route families
 * the census gated where the module was obvious and the fix mechanical, against a REAL database
 * through the HTTP routes. One case family per route family:
 *
 *   ANALYTICS  AnalyticsController declared @RequireModuleScope('analytics') on every handler but
 *              ran BusinessGuard only: no AuthGuard and no ModuleScopeGuard, so the declaration was
 *              inert (the guard is what reads it) and a member whose map says analytics 'none'
 *              generated projections and dismissed insights. It now runs AuthGuard, BusinessGuard
 *              and ModuleScopeGuard: analytics read for a GET (as declared), analytics write for
 *              every POST (each writes: projections, insights, their read/dismissed state, a
 *              maturity assessment).
 *   CATALOG    CatalogController's product writes (the canonical catalog surface) run AuthGuard and
 *              BusinessGuard only, while the same writes through CommerceController's deprecated
 *              pass-throughs need revenue write. Left open (it.todo): gating them moves KEY tools out
 *              of the legacy commerce job-role family, which is pinned as an owner decision.
 *   SOCIAL     GET /social/businesses/:id/connections answered every SocialConnection row whole,
 *              its OAuth access token and refresh token included, to every member. A census
 *              secret-bearing read: the tokens are now never answered (the server reads them
 *              itself to publish and test).
 *
 * Nothing on the authorization or persistence path is mocked: PrismaService, AuthGuard,
 * BusinessGuard, ModuleScopeGuard, the controllers, CatalogService and SocialConnectionsService
 * are real against DATABASE_URL. Stand-ins: identity attachment (`x-test-user`), recorders for the
 * analytics services (the claim is whether the handler is reached) and empty collaborators of
 * SocialController no case reaches.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v99f_` prefix and is hard-deleted by raw SQL
 * (sqlLikePrefix) in beforeAll and afterAll. Cases tagged RED-BEFORE fail on the unmodified code.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v99f_';
const ID = {
  owner: `${P}owner`, // OWNER of bizA, no explicit map
  staffDefault: `${P}staffDefault`, // STAFF of bizA, no explicit map (analytics read, revenue read)
  analyticsNone: `${P}analyticsNone`, // STAFF of bizA, explicit analytics 'none'
  analyticsWrite: `${P}analyticsWrite`, // STAFF of bizA, explicit analytics 'write'
  revenueWrite: `${P}revenueWrite`, // STAFF of bizA, explicit revenue 'write'
  outsider: `${P}outsider`, // OWNER of bizB
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  product: `${P}product`,
  social: `${P}social_fb`,
};
const TOKEN = `${P}EAAB-access-token-value`;
const REFRESH = `${P}refresh-token-value`;

let db: any;
let app: any;
let MODULE_SCOPE_KEY = '';
const controllers: Record<string, any> = {};
const reached: string[] = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM social_connections WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

type Verb = 'get' | 'post' | 'patch' | 'delete';
function send(verb: Verb, url: string, actor: string, body?: unknown) {
  const r = (request(app.getHttpServer()) as any)[verb](url).set('x-test-user', actor);
  return body === undefined ? r : r.send(body);
}

function census(cls: any) {
  const classGuards: any[] = Reflect.getMetadata(GUARDS_METADATA, cls) ?? [];
  return Object.getOwnPropertyNames(cls.prototype)
    .filter((name) => name !== 'constructor')
    .flatMap((name) => {
      const fn = cls.prototype[name];
      const routePath = Reflect.getMetadata(PATH_METADATA, fn);
      if (routePath === undefined) return [];
      const methodGuards: any[] = Reflect.getMetadata(GUARDS_METADATA, fn) ?? [];
      return [{
        key: `${cls.name}.${name}`,
        handler: name,
        method: RequestMethod[Reflect.getMetadata(METHOD_METADATA, fn)] as string,
        path: routePath as string,
        guards: [...classGuards, ...methodGuards].map((g) => g.name as string),
        scope: Reflect.getMetadata(MODULE_SCOPE_KEY, fn) as { module: string; minLevel: string } | undefined,
      }];
    });
}

function chainProblems(r: ReturnType<typeof census>[number], want: { module: string; minLevel: string }): string[] {
  const problems: string[] = [];
  for (const g of ['AuthGuard', 'BusinessGuard', 'ModuleScopeGuard']) {
    if (!r.guards.includes(g)) problems.push(`${r.key} does not run ${g}`);
  }
  if (r.guards.indexOf('ModuleScopeGuard') >= 0 && r.guards.indexOf('ModuleScopeGuard') < r.guards.indexOf('BusinessGuard')) {
    problems.push(`${r.key} runs ModuleScopeGuard before BusinessGuard`);
  }
  if (r.scope?.module !== want.module || r.scope?.minLevel !== want.minLevel) {
    problems.push(`${r.key} (${r.method} ${r.path}) requires ${r.scope ? `${r.scope.module}:${r.scope.minLevel}` : 'no module scope'}, not ${want.module}:${want.minLevel}`);
  }
  return problems;
}

/** A recorder with exactly these methods (not a Proxy: a Proxy answering `then` reads as a promise and hangs). */
function recorder(name: string, methods: string[]) {
  return Object.fromEntries(
    methods.map((method) => [method, async (...args: unknown[]) => { reached.push(`${name}.${method}:${String(args[0])}`); return { ok: true }; }]),
  );
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { Logger, ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const scopeMod = await import('../src/core/auth/module-scope.guard');
  MODULE_SCOPE_KEY = scopeMod.MODULE_SCOPE_KEY;
  const { AnalyticsController } = await import('../src/modules/analytics/analytics.controller');
  const { AnalyticsEngineService } = await import('../src/modules/analytics/analytics-engine.service');
  const { ProjectionService } = await import('../src/modules/analytics/projection.service');
  const { GrowthInsightGeneratorService } = await import('../src/modules/analytics/growth-insight-generator.service');
  const { MaturityAssessmentService } = await import('../src/modules/analytics/maturity-assessment.service');
  const { CatalogController } = await import('../src/modules/catalog/catalog.controller');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { SocialController } = await import('../src/modules/social/social.controller');
  const { SocialService } = await import('../src/modules/social/social.service');
  const { SocialConnectionsService } = await import('../src/modules/social/social-connections.service');
  const { SocialAnalyticsService } = await import('../src/modules/social/social-analytics.service');
  const { MetaSocialIngestionService } = await import('../src/modules/social/meta-social-ingestion.service');
  const { WebhookIngressLoggerService } = await import('../src/core/connectors/webhook-ingress-logger.service');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  Object.assign(controllers, { AnalyticsController, CatalogController, SocialController });

  // AnalyticsController takes its services without @Inject (tsc's emitDecoratorMetadata, which
  // vitest's esbuild transform does not emit): name them, as production's compiled metadata does.
  Reflect.defineMetadata('design:paramtypes', [AnalyticsEngineService, ProjectionService, GrowthInsightGeneratorService, MaturityAssessmentService], AnalyticsController);

  Logger.overrideLogger(false);
  const moduleRef = await Test.createTestingModule({
    controllers: [AnalyticsController, CatalogController, SocialController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      scopeMod.ModuleScopeGuard,
      CatalogService,
      SocialConnectionsService,
      { provide: EventEmitter2, useValue: { emit: () => true } },
      { provide: AnalyticsEngineService, useValue: recorder('engine', ['getOverview', 'getSnapshots', 'getTrends', 'getAvailableMetrics']) },
      { provide: ProjectionService, useValue: recorder('projection', ['generateRevenueProjection', 'generateContactGrowthProjection', 'getLatestProjections']) },
      { provide: GrowthInsightGeneratorService, useValue: recorder('intelligence', ['generateInsights', 'getInsights', 'markInsightRead', 'dismissInsight']) },
      { provide: MaturityAssessmentService, useValue: recorder('maturity', ['assessBusiness', 'getLatestAssessment', 'getAssessmentHistory']) },
      { provide: SocialService, useValue: {} },
      { provide: SocialAnalyticsService, useValue: {} },
      { provide: MetaSocialIngestionService, useValue: {} },
      { provide: WebhookIngressLoggerService, useValue: {} },
      // The public catalog listing's rate-limit guard; no case calls a public route.
      { provide: REDIS_CLIENT, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup();

  for (const id of [ID.owner, ID.staffDefault, ID.analyticsNone, ID.analyticsWrite, ID.revenueWrite, ID.outsider]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V99F Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V99F Biz B', ownerId: ID.outsider } });
  const m = (user: string, biz: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({ data: { id: `${P}m_${user.slice(P.length)}`, userId: user, businessId: biz, role, permissionScopes: permissionScopes ?? undefined } });
  await m(ID.owner, ID.bizA, 'OWNER');
  await m(ID.staffDefault, ID.bizA, 'STAFF');
  await m(ID.analyticsNone, ID.bizA, 'STAFF', { analytics: 'none', crm: 'read' });
  await m(ID.analyticsWrite, ID.bizA, 'STAFF', { analytics: 'write' });
  await m(ID.revenueWrite, ID.bizA, 'STAFF', { revenue: 'write' });
  await m(ID.outsider, ID.bizB, 'OWNER');

  await db.product.create({ data: { id: ID.product, businessId: ID.bizA, name: `${P}Widget`, price: 10 } });
  await db.socialConnection.create({
    data: { id: ID.social, businessId: ID.bizA, platform: 'FACEBOOK', platformId: `${P}page`, accountName: `${P}Page`, token: TOKEN, refreshToken: REFRESH },
  });
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('ANALYTICS: the declared analytics scope is enforced', () => {
  it('[CEN-AN-C01] RED-BEFORE: every AnalyticsController route runs AuthGuard, BusinessGuard, then ModuleScopeGuard; analytics read for a GET, write for every POST', () => {
    const problems = census(controllers.AnalyticsController).flatMap((r) =>
      chainProblems(r, { module: 'analytics', minLevel: r.method === 'GET' ? 'read' : 'write' }),
    );
    expect(problems).toEqual([]);
  });

  it('[CEN-AN-01] RED-BEFORE: a member whose map says analytics none is refused a read and a write before the service is reached', async () => {
    reached.length = 0;
    expect((await send('get', `/api/businesses/${ID.bizA}/analytics/overview`, ID.analyticsNone)).status).toBe(403);
    expect((await send('post', `/api/businesses/${ID.bizA}/analytics/insights/generate`, ID.analyticsNone)).status).toBe(403);
    expect(reached).toEqual([]);
  });

  it('[CEN-AN-02] RED-BEFORE: a member with analytics read (STAFF default) reads but is refused every analytics write', async () => {
    reached.length = 0;
    expect((await send('get', `/api/businesses/${ID.bizA}/analytics/overview`, ID.staffDefault)).status).toBe(200);
    for (const url of ['projections/revenue', 'projections/contacts', 'insights/generate', `insights/${P}i1/read`, `insights/${P}i1/dismiss`, 'maturity/assess']) {
      const res = await send('post', `/api/businesses/${ID.bizA}/analytics/${url}`, ID.staffDefault);
      expect(res.status, url).toBe(403);
    }
    expect(reached).toEqual([`engine.getOverview:${ID.bizA}`]);
  });

  it('[CEN-AN-03] analytics write and the owner are admitted', async () => {
    expect((await send('post', `/api/businesses/${ID.bizA}/analytics/insights/generate`, ID.analyticsWrite)).status).toBe(201);
    expect((await send('post', `/api/businesses/${ID.bizA}/analytics/maturity/assess`, ID.owner)).status).toBe(201);
  });
});

describe('CATALOG: product writes (left open: a KEY seam needs an owner ruling)', () => {
  // Withdrawn from this packet after the RED commit: gating CatalogController's product writes with
  // revenue write (as CommerceController's are) makes CatalogService.createProduct / updateProduct
  // governed, so the KEY derivation (job-role-tool-families.spec.ts) moves commerce_create_product,
  // commerce_update_product and apply_storefront_recommendation into CANONICAL_MODULE_TOOLS.revenue
  // and takes them from the legacy commerce_* job-role family, which job-role-policy.service.spec.ts
  // pins as an owner decision ("the governed tools a legacy key loses") and ESC-3 pins as reachable.
  // Recorded as `open` in docs/reconstruction/REST-SCOPE-CENSUS-2026-11-13.md with that owner question.
  it.todo('[CEN-CAT-C01] every CatalogController product write requires revenue write (owner ruling on the legacy commerce key first)');
  it.todo('[CEN-CAT-01] a member with revenue read is refused creating, editing and deleting a product through /catalog');
});

describe('SOCIAL: a social connection read never answers its OAuth tokens', () => {
  it('[CEN-SOC-01] RED-BEFORE: GET .../connections answers the connection without its access token or refresh token, to the owner and to a STAFF member', async () => {
    for (const actor of [ID.owner, ID.staffDefault]) {
      const res = await send('get', `/social/businesses/${ID.bizA}/connections`, actor);
      expect(res.status, actor).toBe(200);
      const row = (res.body as any[]).find((c) => c.id === ID.social);
      expect(row, actor).toBeTruthy();
      expect(row.platform).toBe('FACEBOOK');
      expect(row, actor).not.toHaveProperty('token');
      expect(row, actor).not.toHaveProperty('refreshToken');
      expect(JSON.stringify(res.body), actor).not.toContain(TOKEN);
      expect(JSON.stringify(res.body), actor).not.toContain(REFRESH);
    }
    // the stored tokens are untouched (the server still reads them to publish and to test)
    const stored = await db.socialConnection.findUnique({ where: { id: ID.social } });
    expect(stored.token).toBe(TOKEN);
    expect(stored.refreshToken).toBe(REFRESH);
  });

  it('[CEN-SOC-02] a member of another business is refused (BusinessGuard, unchanged)', async () => {
    expect((await send('get', `/social/businesses/${ID.bizA}/connections`, ID.outsider)).status).toBe(403);
  });
});
