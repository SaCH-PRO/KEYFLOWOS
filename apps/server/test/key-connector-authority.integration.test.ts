/**
 * W7-KEY-CONNECTOR-TENANT review repairs: KeyConnectorController authority
 * (REAL database).
 *
 * The packet bound every KeyConnectorController handler to the tenant
 * BusinessGuard checked. Its security review found two older gaps on the same
 * routes, both reproduced here against the real service and the real tables:
 *
 *   SEC-W7KC-1  KeyConnectorService.mapDbToConnection copies the stored
 *               provider credentials (IntegrationConnection.authData, a
 *               plaintext Json column) into every connection it maps, and
 *               GET connections, GET providers, GET providers/:key and POST
 *               providers/:key/connect answered them to any member of the
 *               tenant, a STAFF member with no scopes included (the class of
 *               R0-SEC2). The tRPC keyConnector router reads the same table and
 *               never selects authData.
 *   SEC-W7KC-2  The controller sits behind AuthGuard and BusinessGuard only, so
 *               any member could connect a provider, disconnect one, trigger a
 *               sync or run an AI command through the gateway. The tRPC router
 *               runs the same operations for OWNER or ADMIN only
 *               (assertBusinessRole(ctx, ["OWNER", "ADMIN"])).
 *
 * The fix stays in the controller (the packet's write set): every connection a
 * route answers is projected without authData (the service keeps reading it
 * for its sync and health engines), and the four write routes admit OWNER or
 * ADMIN (or the business's distinguished owner, or SUPER_ADMIN, whom
 * BusinessGuard already admits) before any service is reached. No owner ruling
 * names this surface; the role set is the tRPC router's for the same table.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * the production TenantInterceptor (with the Prisma tenant extension reading
 * its ambient tenant, as main.ts wires it), the global exception filter and
 * ValidationPipe, the real KeyConnectorController and KeyConnectorService with
 * its real registry, sync engine and AI gateway (whose provider and module
 * calls are local stubs, no provider traffic). The health checker is built
 * over an HTTP client that throws if anything calls it; no route here reaches
 * it. The only stand-in is identity attachment: a test middleware reads
 * `x-v93a-user` and attaches the seeded user row, as AuthMiddleware does after
 * token verification.
 *
 * Every seeded row carries the `v93a_` prefix and is hard-deleted by raw SQL
 * with sqlLikePrefix() in beforeAll and afterAll; no $transaction wrapping.
 * Credential values are obviously fake.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v93a_';
const HEADER = 'x-v93a-user';
const ID = {
  ownerA: `${P}owner_a`, // OWNER membership of A, and A's Business.ownerId
  adminA: `${P}admin_a`, // ADMIN of A
  staffA: `${P}staff_a`, // STAFF of A, permissionScopes {}
  ownerB: `${P}owner_b`, // OWNER of B
  bizA: `${P}biz_a`,
  bizB: `${P}biz_b`,
  connA: `${P}conn_a`, // A's stripe connection
  connA2: `${P}conn_a2`, // A's slack connection (the ADMIN positive control disconnects it)
  connA3: `${P}conn_a3`, // A's sendgrid connection (the STAFF case's sync and disconnect target)
  connB: `${P}conn_b`, // B's stripe connection
};

// Obviously fake credential values: never a real key shape.
const SECRET_A = 'v93a-fake-credential-A-not-a-real-key-qqq';
const SECRET_A2 = 'v93a-fake-credential-A2-not-a-real-key-www';
const SECRET_A3 = 'v93a-fake-credential-A3-not-a-real-key-vvv';
const SECRET_B = 'v93a-fake-credential-B-not-a-real-key-zzz';
const SECRET_NEW = 'v93a-fake-credential-NEW-not-a-real-key-yyy';
const SECRET_STAFF = 'v93a-fake-credential-STAFF-not-a-real-key-xxx';
const ALL_SECRETS = [SECRET_A, SECRET_A2, SECRET_A3, SECRET_B, SECRET_NEW, SECRET_STAFF];

let db: any;
let app: any;
let httpCalls = 0;

async function cleanup() {
  for (const sql of [
    `DELETE FROM sync_jobs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM connector_audit_logs WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM integration_connections WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function call(
  verb: 'get' | 'post' | 'delete',
  url: string,
  opts: { user: string; businessId?: string; body?: Record<string, unknown> },
) {
  let req = request(app.getHttpServer())[verb](url).set(HEADER, opts.user).query({ businessId: opts.businessId ?? ID.bizA });
  if (opts.body) req = req.send(opts.body);
  return req;
}

/** No response body may carry a stored credential, or an authData field at all. */
function expectNoCredentials(label: string, body: unknown) {
  const text = JSON.stringify(body ?? null);
  for (const secret of ALL_SECRETS) expect(text, label).not.toContain(secret);
  expect(text, label).not.toContain('"authData"');
}

const connectionsOf = (businessId: string) =>
  db.$queryRawUnsafe(`SELECT id, provider_key FROM integration_connections WHERE business_id = $1 ORDER BY id`, businessId);
const syncJobsOf = (businessId: string) =>
  db.$queryRawUnsafe(`SELECT id, connection_id FROM sync_jobs WHERE business_id = $1`, businessId);
const auditOf = (businessId: string) =>
  db.$queryRawUnsafe(`SELECT user_id, action, connection_id FROM connector_audit_logs WHERE business_id = $1 ORDER BY created_at`, businessId);

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
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { KeyConnectorController } = await import('../src/modules/key-connector/key-connector.controller');
  const { KeyConnectorService } = await import('../src/modules/key-connector/key-connector.service');
  const { ProviderRegistryService } = await import('../src/modules/key-connector/providers/provider-registry.service');
  const { HealthCheckService } = await import('../src/modules/key-connector/health/health-check.service');
  const { SyncEngineService } = await import('../src/modules/key-connector/sync/sync-engine.service');
  const { AiGatewayService } = await import('../src/modules/key-connector/ai-gateway/ai-gateway.service');

  // The constructor parameter types tsc emits for the controller (Nest injects
  // by them; vitest's esbuild transform emits none), left alone if present.
  if (!Reflect.getMetadata('design:paramtypes', KeyConnectorController)) {
    Reflect.defineMetadata('design:paramtypes', [KeyConnectorService, PrismaService], KeyConnectorController);
  }

  // No route in this suite may reach a provider over the network.
  const noNetwork = new Proxy({}, {
    get() {
      return () => {
        httpCalls += 1;
        throw new Error('v93a: no provider traffic in this suite');
      };
    },
  });

  const moduleRef = await Test.createTestingModule({
    controllers: [KeyConnectorController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      {
        provide: KeyConnectorService,
        useFactory: () => {
          const registry = new ProviderRegistryService();
          return new KeyConnectorService(
            registry,
            new HealthCheckService(noNetwork as any, registry),
            new SyncEngineService(),
            new AiGatewayService(registry),
          );
        },
      },
      // Installed globally in production (app.module.ts).
      { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
    ],
  }).compile();

  app = moduleRef.createNestApplication({ logger: false });
  // Identity attachment only, for seeded v93a_ users. No guard is overridden.
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

  for (const id of [ID.ownerA, ID.adminA, ID.staffA, ID.ownerB]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V93A Biz A', ownerId: ID.ownerA } });
  await db.business.create({ data: { id: ID.bizB, name: 'V93A Biz B', ownerId: ID.ownerB } });
  for (const [userId, businessId, role, permissionScopes] of [
    [ID.ownerA, ID.bizA, 'OWNER', undefined],
    [ID.adminA, ID.bizA, 'ADMIN', undefined],
    [ID.staffA, ID.bizA, 'STAFF', {}],
    [ID.ownerB, ID.bizB, 'OWNER', undefined],
  ] as const) {
    await db.membership.create({
      data: { id: `${P}m_${userId.slice(P.length)}`, userId, businessId, role, permissionScopes: permissionScopes ?? undefined },
    });
  }
  // Raw inserts: the Prisma tenant extension scopes IntegrationConnection to
  // an ambient tenant, and seeding runs outside any request.
  for (const [id, businessId, providerKey, authData] of [
    [ID.connA, ID.bizA, 'stripe', { apiKey: SECRET_A }],
    [ID.connA2, ID.bizA, 'slack', { botToken: SECRET_A2 }],
    [ID.connA3, ID.bizA, 'sendgrid', { apiKey: SECRET_A3 }],
    [ID.connB, ID.bizB, 'stripe', { apiKey: SECRET_B }],
  ] as const) {
    await db.$executeRawUnsafe(
      `INSERT INTO integration_connections (id, business_id, provider_key, display_name, status, auth_data, settings, health_score, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'connected', $5::jsonb, '{}'::jsonb, 100, NOW(), NOW())`,
      id, businessId, providerKey, `${id} display`, JSON.stringify(authData),
    );
  }
}, 60_000);

afterAll(async () => {
  await app?.close();
  await cleanup();
});

describe('KeyConnectorController authority (W7-KEY-CONNECTOR-TENANT review SEC-W7KC-1, SEC-W7KC-2)', () => {
  it("GET connections, providers and providers/:key answer A's connections to A's STAFF, ADMIN and OWNER without the stored credentials (no authData field) (SEC-W7KC-1)", async () => {
    const seen: Record<string, number> = {};
    for (const user of [ID.staffA, ID.adminA, ID.ownerA]) {
      for (const url of ['/key-connector/connections', '/key-connector/providers', '/key-connector/providers/stripe']) {
        const res = await call('get', url, { user });
        const label = `${user} GET ${url}`;
        seen[label] = res.status;
        expect(JSON.stringify(res.body), label).toContain(ID.connA);
        expectNoCredentials(label, res.body);
      }
    }
    expect(Object.values(seen).every((s) => s === 200), JSON.stringify(seen)).toBe(true);
    // A's other connections are listed too, still without their tokens; none of B's is.
    const list = await call('get', '/key-connector/connections', { user: ID.staffA });
    expect(list.body.data.map((c: { id: string }) => c.id).sort()).toEqual([ID.connA, ID.connA2, ID.connA3].sort());
    expect(list.body.data.every((c: Record<string, unknown>) => !('authData' in c))).toBe(true);
    expect(httpCalls).toBe(0);
  });

  it("POST providers/:key/connect by A's OWNER answers the new connection without its credentials, and stores them for the sync and health engines (SEC-W7KC-1)", async () => {
    const res = await call('post', '/key-connector/providers/mailchimp/connect', {
      user: ID.ownerA,
      body: { providerKey: 'mailchimp', authData: { apiKey: SECRET_NEW } },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ businessId: ID.bizA, providerKey: 'mailchimp' });
    expectNoCredentials('POST connect', res.body);
    const rows = await db.$queryRawUnsafe(
      `SELECT auth_data FROM integration_connections WHERE business_id = $1 AND provider_key = 'mailchimp'`,
      ID.bizA,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].auth_data).toEqual({ apiKey: SECRET_NEW });
    expect(httpCalls).toBe(0);
  });

  it('a STAFF member of A with no scopes is refused 403 on connect, disconnect, sync trigger and AI command, and nothing is written: no connection added or removed, no sync job, no connector audit row (SEC-W7KC-2)', async () => {
    const connectionsBefore = await connectionsOf(ID.bizA);
    const auditBefore = await auditOf(ID.bizA);
    const statuses: Record<string, number> = {};
    const attempts: Array<[string, 'post' | 'delete', string, Record<string, unknown> | undefined]> = [
      ['POST providers/:key/connect', 'post', '/key-connector/providers/typeform/connect', { providerKey: 'typeform', authData: { apiKey: SECRET_STAFF } }],
      ['POST sync/:id/trigger', 'post', `/key-connector/sync/${ID.connA3}/trigger`, undefined],
      ['POST ai/command', 'post', '/key-connector/ai/command', { command: 'list contacts' }],
      ['DELETE connections/:id', 'delete', `/key-connector/connections/${ID.connA3}`, undefined],
    ];
    const bodies: Record<string, unknown> = {};
    for (const [name, verb, url, body] of attempts) {
      const res = await call(verb, url, { user: ID.staffA, body });
      statuses[name] = res.status;
      bodies[name] = res.body;
    }
    expect(statuses).toEqual({
      'POST providers/:key/connect': 403,
      'POST sync/:id/trigger': 403,
      'POST ai/command': 403,
      'DELETE connections/:id': 403,
    });
    for (const [name, body] of Object.entries(bodies)) expectNoCredentials(name, body);
    expect(await connectionsOf(ID.bizA)).toEqual(connectionsBefore);
    expect(await syncJobsOf(ID.bizA)).toEqual([]);
    expect(await auditOf(ID.bizA)).toEqual(auditBefore);
    expect((await auditOf(ID.bizA)).filter((r: { user_id: string }) => r.user_id === ID.staffA)).toEqual([]);
  });

  it("A's ADMIN triggers a sync, runs an AI command and disconnects A's slack connection, each acting on A and audited under the ADMIN; B's connection is untouched (positive control, OWNER or ADMIN as the tRPC keyConnector router admits)", async () => {
    const sync = await call('post', `/key-connector/sync/${ID.connA}/trigger`, { user: ID.adminA });
    expect(sync.status, JSON.stringify(sync.body)).toBe(202);
    expect(sync.body.data).toMatchObject({ connectionId: ID.connA, businessId: ID.bizA, providerKey: 'stripe' });
    expectNoCredentials('POST sync', sync.body);
    expect((await syncJobsOf(ID.bizA)).map((j: { connection_id: string }) => j.connection_id)).toContain(ID.connA);

    const command = await call('post', '/key-connector/ai/command', { user: ID.adminA, body: { command: 'list contacts' } });
    expect(command.status, JSON.stringify(command.body)).toBe(200);
    expectNoCredentials('POST ai/command', command.body);

    const gone = await call('delete', `/key-connector/connections/${ID.connA2}`, { user: ID.adminA });
    expect(gone.status, JSON.stringify(gone.body)).toBe(200);
    expect((await connectionsOf(ID.bizA)).map((c: { id: string }) => c.id)).not.toContain(ID.connA2);
    expect(await auditOf(ID.bizA)).toEqual(
      expect.arrayContaining([{ user_id: ID.adminA, action: 'disconnect_provider', connection_id: ID.connA2 }]),
    );

    expect(await connectionsOf(ID.bizB)).toEqual([{ id: ID.connB, provider_key: 'stripe' }]);
    expect(await syncJobsOf(ID.bizB)).toEqual([]);
    expect(httpCalls).toBe(0);
  });
});
