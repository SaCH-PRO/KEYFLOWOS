import 'reflect-metadata';
import path from 'node:path';
import { Controller, MiddlewareConsumer, Module, NestModule, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthMiddleware } from '../../core/auth/auth.middleware';
import { SupabaseAuthService } from '../../core/auth/supabase-auth.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import { buildAdminToken } from '../../core/auth/admin-token.util';
import { HandoffMonitorController } from './handoff-monitor.controller';
import { HandoffMonitorService, resolveSharedModuleDir } from './handoff-monitor.service';

/**
 * The handoff snapshot endpoint through the real credential path: the
 * production AuthMiddleware (Supabase JWT, then the owner console's HMAC admin
 * token), the real AuthGuard and AdminGuard, and the real service reading the
 * shared projector over the PR #177 fixture. Only the identity providers
 * (Supabase, the user table, Redis) are stubbed.
 *
 * KF-META-HANDOFF-MONITOR-001: unauthorized requests are refused before the
 * service or its cache is reached, including after an admin has warmed it.
 */

// vitest runs this file in a VM context with no callback for the service's
// own native import(), so the spec hands it vitest's. The compiled-server
// proof (docs/development/HANDOFF_MONITOR.md) exercises the default importer.
const vitestImport = (specifier: string) => import(/* @vite-ignore */ specifier) as Promise<Record<string, unknown>>;

const SECRET = 'handoff-monitor-spec-secret';
const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const FIXTURE = path.join(REPO_ROOT, 'scripts/agent-control/fixtures/handoff-irp177.json');
const ROUTE = '/api/admin/mission-control/handoffs';

const supabaseUsers: Record<string, { id: string; email: string }> = {
  'supabase-tenant-owner': { id: 'u-tenant-owner', email: 'owner@tenant.test' },
  'supabase-super-admin': { id: 'u-super', email: 'super@keyflow.test' },
};
const dbRoles: Record<string, string> = { 'u-tenant-owner': 'USER', 'u-super': 'SUPER_ADMIN' };

const supabaseStub = { getUserFromToken: async (token?: string) => (token ? supabaseUsers[token] ?? null : null) };
const prismaStub = {
  client: {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        dbRoles[where.id] ? { role: dbRoles[where.id], deletedAt: null, bannedAt: null } : null,
    },
  },
};
const redisStub = { get: async () => null };

const adminToken = (role: string, exp?: number) => {
  const token = buildAdminToken({ id: `admin-${role}`, email: `${role}@keyflow.test`, role }, SECRET);
  if (exp === undefined) return token;
  const [h, b] = token.split('.');
  const payload = { ...JSON.parse(Buffer.from(b, 'base64url').toString('utf8')), exp };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sig = require('crypto').createHmac('sha256', SECRET).update(`${h}.${body}`).digest('base64url');
  return `${h}.${body}.${sig}`;
};

function buildModule(service: HandoffMonitorService) {
  @Controller()
  class NoopController {}

  @Module({
    controllers: [HandoffMonitorController, NoopController],
    providers: [
      { provide: HandoffMonitorService, useValue: service },
      { provide: SupabaseAuthService, useValue: supabaseStub },
      { provide: PrismaService, useValue: prismaStub },
      { provide: REDIS_CLIENT, useValue: redisStub },
      AuthMiddleware,
    ],
  })
  class HandoffSpecModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
      consumer.apply(AuthMiddleware).forRoutes('*');
    }
  }
  return HandoffSpecModule;
}

async function boot(service: HandoffMonitorService): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [buildModule(service)] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return app;
}

describe('GET /api/admin/mission-control/handoffs', () => {
  let app: INestApplication;
  let service: HandoffMonitorService;
  let snapshotSpy: ReturnType<typeof vi.spyOn>;
  const priorSecret = process.env.ADMIN_JWT_SECRET;

  beforeAll(async () => {
    process.env.ADMIN_JWT_SECRET = SECRET;
    service = new HandoffMonitorService({ KEYFLOW_HANDOFF_MONITOR_FIXTURE: FIXTURE, NODE_ENV: 'test' }, vitestImport);
    snapshotSpy = vi.spyOn(service, 'snapshot');
    app = await boot(service);
  });

  afterAll(async () => {
    await app?.close();
    if (priorSecret === undefined) delete process.env.ADMIN_JWT_SECRET;
    else process.env.ADMIN_JWT_SECRET = priorSecret;
  });

  const denied: Array<[string, Record<string, string>, number]> = [
    ['no credential', {}, 401],
    ['an unverifiable bearer token', { Authorization: 'Bearer not-a-token' }, 401],
    ['an expired SUPER_ADMIN admin token', { Authorization: `Bearer ${adminToken('SUPER_ADMIN', Date.now() - 1000)}` }, 401],
    ['an admin token with role USER', { Authorization: `Bearer ${adminToken('USER')}` }, 403],
    ['an admin token with role ADMIN', { Authorization: `Bearer ${adminToken('ADMIN')}` }, 403],
    ['a Supabase tenant owner (platform role USER)', { Authorization: 'Bearer supabase-tenant-owner' }, 403],
  ];

  async function expectDenied(headers: Record<string, string>, status: number) {
    const calls = snapshotSpy.mock.calls.length;
    const res = await request(app.getHttpServer()).get(`${ROUTE}?task=6229439023`).set(headers);
    expect(res.status).toBe(status);
    expect(snapshotSpy.mock.calls.length).toBe(calls);
    expect(JSON.stringify(res.body)).not.toContain('CG-DIR-IRP177-REVIEW-001');
    expect(JSON.stringify(res.body)).not.toContain('6229520428');
  }

  it.each(denied)('refuses %s before the service is reached', async (_label, headers, status) => {
    await expectDenied(headers, status);
  });

  it('serves the owner console admin token (SUPER_ADMIN) the real #177 chain, uncached by the browser', async () => {
    const res = await request(app.getHttpServer())
      .get(`${ROUTE}?task=6229439023`)
      .set({ Authorization: `Bearer ${adminToken('SUPER_ADMIN')}` });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.mode).toBe('FIXTURE');
    expect(res.body.freshness.status).toBe('FRESH');
    expect(res.body.freshness.coverage.status).toBe('COMPLETE');
    const task = res.body.view.task;
    expect(task.request.message_id).toBe('CG-DIR-IRP177-REVIEW-001');
    expect(task.delivery.stage).toBe('DECISION_RECORDED');
    expect(task.stages.RETURN_CONSUMED.evidence.comment_id).toBe(6229558462);
    expect(task.stage_evidence.ACKNOWLEDGED.map((e: { comment_id: number }) => e.comment_id)).toEqual([6229470452]);
    expect(task.review.outcome).toBe('CHANGES_REQUIRED');
    expect(task.review.unresolved_substantive_findings).toBe(6);
    expect(task.merge_authority.status).toBe('NOT_GRANTED');
    expect(task.stages.WORKING_LAST_OBSERVED.status).toBe('NOT_OBSERVED');
    expect(res.body.view.worker.status).toBe('UNKNOWN');
    expect(task.chain.map((m: { comment_id: number }) => m.comment_id)).toEqual(
      [6229439023, 6229470452, 6229480291, 6229520428, 6229558462],
    );
  });

  it('serves a Supabase user whose platform role is SUPER_ADMIN', async () => {
    const res = await request(app.getHttpServer()).get(ROUTE).set({ Authorization: 'Bearer supabase-super-admin' });
    expect(res.status).toBe(200);
    expect(res.body.view.tasks[0].request.message_id).toBe('CG-DIR-IRP177-REVIEW-001');
  });

  it.each(denied)('still refuses %s after an admin has warmed the cache', async (_label, headers, status) => {
    const warm = await request(app.getHttpServer()).get(ROUTE).set({ Authorization: `Bearer ${adminToken('SUPER_ADMIN')}` });
    expect(warm.status).toBe(200);
    await expectDenied(headers, status);
  });

  it('has no write route', async () => {
    const auth = { Authorization: `Bearer ${adminToken('SUPER_ADMIN')}` };
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await request(app.getHttpServer())[method](ROUTE).set(auth).send({});
      expect(res.status).toBe(404);
    }
  });

  it('rejects malformed query input', async () => {
    const auth = { Authorization: `Bearer ${adminToken('SUPER_ADMIN')}` };
    expect((await request(app.getHttpServer()).get(`${ROUTE}?task=javascript:alert(1)`).set(auth)).status).toBe(400);
    expect((await request(app.getHttpServer()).get(`${ROUTE}?limit=-1`).set(auth)).status).toBe(400);
  });
});

describe('HandoffMonitorService configuration', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is off by default and makes no request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await new HandoffMonitorService({}).snapshot();
    expect(res.mode).toBe('NOT_CONFIGURED');
    expect(res.view).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses fixture mode in production', async () => {
    const res = await new HandoffMonitorService({ KEYFLOW_HANDOFF_MONITOR_FIXTURE: FIXTURE, NODE_ENV: 'production' }).snapshot();
    expect(res.mode).toBe('UNAVAILABLE');
  });

  it('live mode sends GET requests to GitHub only and never returns the credential', async () => {
    const token = `ghp_${'Q7w8'.repeat(9)}`;
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ message: `Bad credentials ${token}` }), { status: 401 });
    });
    const res = await new HandoffMonitorService({ KEYFLOW_HANDOFF_MONITOR_GITHUB_TOKEN: token }, vitestImport).snapshot();
    expect(res.mode).toBe('LIVE');
    expect(res.freshness?.status).toBe('NO_DATA');
    expect(JSON.stringify(res)).not.toContain(token);
    expect(calls.length).toBe(1);
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].url).toBe('https://api.github.com/repos/SaCH-PRO/KEYFLOWOS/issues/80');
  });

  it('finds the shared projector from the source tree and reports when a build lacks it', () => {
    expect(resolveSharedModuleDir({}, __dirname)).toBe(path.join(REPO_ROOT, 'scripts', 'agent-control', 'lib'));
    expect(resolveSharedModuleDir({}, path.parse(__dirname).root)).toBeNull();
  });
});
