/**
 * R0-14-AUTH-LOCAL-SIGNIN (D-02 option C: hosted Supabase free tier) — the
 * auth-boundary facts docs/auth-pathway.md asks a Release 0 operator to rely
 * on, measured at the REAL boundary.
 *
 * Under D-02 option C the packet changes no identity code. What it does change
 * is operator guidance, and two review findings showed that guidance resting on
 * unproven claims:
 *
 *   ST-R014-2  `SUPABASE_JWT_SECRET` was described as inert with a hosted
 *              project. It is not: `verifyLocal` accepts any HS256 token signed
 *              with it whose `iss` is absent or equals SUPABASE_URL, and
 *              .env.example shipped a public placeholder as its value. The
 *              Release 0 rule is now "leave it empty". The first block proves
 *              that rule closes the forged-token path; the second pins the
 *              hazard the doc describes, so the doc goes stale loudly when a
 *              code packet fixes the issuer check.
 *   ST-R014-1  POST /identity/bootstrap moves another user's row, role,
 *              memberships and businesses to the caller on an email match. The
 *              fix is a code change outside this packet's ruling and write set
 *              (identity.controller.ts, identity.service.ts), so it is held
 *              here as it.todo, with the reason, until that packet lands.
 *
 * Nothing on the boundary is mocked: the real AuthMiddleware (real
 * SupabaseAuthService, real PrismaService against DATABASE_URL, real Redis for
 * the revocation lookup) runs in front of the real AuthGuard under
 * configureNestApp. The only test-owned piece is a probe route that returns
 * what the middleware attached, so the assertion is about the boundary and not
 * about any controller behind it.
 *
 * No network: SUPABASE_URL is a fake host and no anon key is set, so the
 * getUser() fallback has no client and never runs; global fetch is replaced by
 * a recorder that refuses every call, and the suite asserts it was never used.
 *
 * RESOURCES: fixture prefix k14a_ (docs/reconstruction/BUILD-MAP-001.md, R0-14
 * row). The suite writes no rows. The forged `sub` values carry the prefix and
 * are checked absent from `users` by exact id, before and after.
 */
import 'reflect-metadata';
import path from 'path';
import { createHmac, randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { AuthGuard } from '../src/core/auth/auth.guard';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
// Every Supabase variable it may bring in is pinned below.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k14a_';
const FAKE_SUPABASE_URL = 'https://k14a-example-ref.supabase.co';
/** The value .env.example carried for SUPABASE_JWT_SECRET before this repair. */
const FORMER_PLACEHOLDER = 'your-supabase-jwt-signing-secret';
const OTHER_SECRET = `${P}a-secret-nobody-configured`;

const PINNED_KEYS = [
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_JWT_SECRET',
  'ADMIN_JWT_SECRET',
] as const;
const saved: Partial<Record<(typeof PINNED_KEYS)[number], string | undefined>> = {};

const SUBS = {
  noIssEmpty: `${P}forger_noiss_empty`,
  urlIssEmpty: `${P}forger_urliss_empty`,
  noIssPlaceholder: `${P}forger_noiss_placeholder`,
  urlIssPlaceholder: `${P}forger_urliss_placeholder`,
  hostedIss: `${P}forger_hostediss`,
  wrongSecret: `${P}forger_wrongsecret`,
};
const VICTIM_EMAIL = `${P}victim@test.local`;

@Controller('k14a-probe')
class K14aProbeController {
  @UseGuards(AuthGuard)
  @Get('whoami')
  whoami(@Req() req: { user: { id: string; email: string; role: string } }) {
    return { id: req.user.id, email: req.user.email, role: req.user.role };
  }
}

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** HS256 token in the shape the spawned-server suites mint, `iss` optional. */
function forge(secret: string, claims: { sub: string; email: string; iss?: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url({
    ...claims,
    aud: 'authenticated',
    role: 'authenticated',
    iat: now,
    exp: now + 600,
    jti: randomUUID(),
  });
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function setSecret(value: string | undefined) {
  if (value === undefined) delete process.env.SUPABASE_JWT_SECRET;
  else process.env.SUPABASE_JWT_SECRET = value;
}

let app: INestApplication;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the @keyflow/db client is loaded dynamically after env
let db: any;
let redis: { quit: () => Promise<unknown> } | undefined;
const outbound: string[] = [];
const realFetch = globalThis.fetch;

async function rowsForForgedSubs(): Promise<number> {
  return db.user.count({ where: { id: { in: Object.values(SUBS) } } });
}

beforeAll(async () => {
  for (const k of PINNED_KEYS) saved[k] = process.env[k];
  for (const k of PINNED_KEYS) delete process.env[k];
  process.env.SUPABASE_URL = FAKE_SUPABASE_URL;

  globalThis.fetch = (async (input: unknown) => {
    outbound.push(String(input instanceof Request ? input.url : input));
    throw new Error('k14a: outbound fetch refused by the test');
  }) as typeof fetch;

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const IORedis = (await import('ioredis')).default;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { SupabaseAuthService } = await import('../src/core/auth/supabase-auth.service');
  const { AuthMiddleware } = await import('../src/core/auth/auth.middleware');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { configureNestApp } = await import('../src/app-bootstrap');

  const client = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
  });
  redis = client;

  const moduleRef = await Test.createTestingModule({
    controllers: [K14aProbeController],
    providers: [
      PrismaService,
      SupabaseAuthService,
      AuthMiddleware,
      AuthGuard,
      { provide: REDIS_CLIENT, useValue: client },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  configureNestApp(app);
  // AppModule applies this middleware with consumer.apply(AuthMiddleware)
  // .forRoutes('*'); the DI-built instance is applied here the same way.
  const middleware = moduleRef.get(AuthMiddleware);
  app.use((req: never, res: never, next: () => void) => middleware.use(req, res, next));
  await app.init();

  expect(await rowsForForgedSubs()).toBe(0);
}, 60_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  if (db) expect(await rowsForForgedSubs()).toBe(0);
  if (app) await app.close();
  if (redis) await redis.quit();
  for (const k of PINNED_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function whoami(token?: string) {
  const req = request(app.getHttpServer()).get('/k14a-probe/whoami');
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
}

describe('Release 0 rule: SUPABASE_JWT_SECRET left empty closes the forged-token path (ST-R014-2)', () => {
  it('control: no bearer token answers 401', async () => {
    setSecret(undefined);
    const res = await whoami();
    expect(res.status).toBe(401);
  });

  it('a token with no iss, signed with the former placeholder, answers 401', async () => {
    setSecret(undefined);
    const res = await whoami(forge(FORMER_PLACEHOLDER, { sub: SUBS.noIssEmpty, email: VICTIM_EMAIL }));
    expect(res.status).toBe(401);
  });

  it('a token with iss = SUPABASE_URL, signed with the former placeholder, answers 401', async () => {
    setSecret('');
    const res = await whoami(
      forge(FORMER_PLACEHOLDER, { sub: SUBS.urlIssEmpty, email: VICTIM_EMAIL, iss: FAKE_SUPABASE_URL }),
    );
    expect(res.status).toBe(401);
  });

  it('nothing left the server: the getUser() fallback had no client, and no fetch was attempted', () => {
    expect(outbound).toEqual([]);
  });
});

describe('CHARACTERIZATION — the acceptance path the doc warns about (flips when a code packet fixes verifyLocal)', () => {
  // These pass today and SHOULD start failing once the issuer check requires
  // the hosted `iss` shape. When they do, update docs/auth-pathway.md (the
  // verifyLocal caveat and open defect 2) in the same change.
  it('with the secret set to the former placeholder, a forged token with no iss passes AuthGuard and its email claim is attached', async () => {
    setSecret(FORMER_PLACEHOLDER);
    const res = await whoami(forge(FORMER_PLACEHOLDER, { sub: SUBS.noIssPlaceholder, email: VICTIM_EMAIL }));
    expect(res.status).toBe(200);
    // Role comes from the local row; with none, the bootstrap default.
    expect(res.body).toEqual({ id: SUBS.noIssPlaceholder, email: VICTIM_EMAIL, role: 'USER' });
  });

  it('with the secret set, a forged token with iss = SUPABASE_URL also passes AuthGuard', async () => {
    setSecret(FORMER_PLACEHOLDER);
    const res = await whoami(
      forge(FORMER_PLACEHOLDER, { sub: SUBS.urlIssPlaceholder, email: VICTIM_EMAIL, iss: FAKE_SUPABASE_URL }),
    );
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(SUBS.urlIssPlaceholder);
  });

  it('with the secret set, the hosted shape iss = SUPABASE_URL/auth/v1 is refused (so the secret verifies no real hosted token)', async () => {
    setSecret(FORMER_PLACEHOLDER);
    const res = await whoami(
      forge(FORMER_PLACEHOLDER, { sub: SUBS.hostedIss, email: VICTIM_EMAIL, iss: `${FAKE_SUPABASE_URL}/auth/v1` }),
    );
    expect(res.status).toBe(401);
  });

  it('negative control: with the secret set, a token signed with another secret is refused', async () => {
    setSecret(FORMER_PLACEHOLDER);
    const res = await whoami(forge(OTHER_SECRET, { sub: SUBS.wrongSecret, email: VICTIM_EMAIL }));
    expect(res.status).toBe(401);
  });

  it('still nothing left the server', () => {
    expect(outbound).toEqual([]);
  });
});

describe('open defect: POST /identity/bootstrap takes over an account by email (ST-R014-1)', () => {
  // Not implementable in R0-14: D-02 option C rules no identity code change,
  // and identity.controller.ts / identity.service.ts are outside the packet's
  // write set. docs/auth-pathway.md records this as open defect 1 and a stop
  // condition for opening Release 0 sign-in. The code packet that fixes it
  // turns these into real-database cases.
  it.todo(
    "bootstrap with a body `email` naming another user's address never moves that user's row, role, memberships or Business.ownerId to the caller (today: identity.controller.ts:906 prefers body.email; identity.service.ts:979-985 reconciles by email)",
  );
  it.todo(
    "bootstrap with a token whose `email` claim matches a local user under a different `sub` never moves that user's row to the caller without proof of the same identity (today: reconcileUserId, identity.service.ts:814-876, copies the role and deletes the old row)",
  );
});
