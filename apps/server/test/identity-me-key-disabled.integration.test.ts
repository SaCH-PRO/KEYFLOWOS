/**
 * P89 — V1-63 (SWP-KEY-SHELL-SMOKE server half, P1 launch-track, Journeys A/K):
 *
 * Real Postgres + real NestJS HTTP app (`IdentityController`, `IdentityService`,
 * `AuthGuard`, `GlobalHttpExceptionFilter`) proving `GET /identity/me` exposes
 * `keyDisabled: boolean` from `keyDisabled()` (`apps/server/src/core/config/env.ts`):
 *
 *   - [KSS-01] RED-BEFORE: When `KEY_DISABLED` is unset, `'0'`, or `'false'`,
 *              `GET /identity/me` returns 200 with `keyDisabled: false` (strict
 *              boolean) and preserves every existing profile field.
 *   - [KSS-02] RED-BEFORE: When `KEY_DISABLED` is `'1'`, `'true'`, or `' TRUE '`,
 *              `GET /identity/me` returns 200 with `keyDisabled: true`.
 *   - [KSS-03] RED-BEFORE: `AI_DISABLED=1` alone does NOT flip `keyDisabled`
 *              (distinct from `KEY_DISABLED` per D-17 / `env.ts`).
 *   - [KSS-04] Control: Unauthenticated `GET /identity/me` is refused 401 (does
 *              not disclose `keyDisabled`); authenticated unknown user returns 404.
 *
 * Fixtures use pre-allocated prefix `v63n_` and are hard-deleted with `sqlLikePrefix(P)`.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 90_000 });
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v63n_';
const HEADER = 'x-test-user-id';

const ID = {
  user: `${P}user`,
  missingUser: `${P}missing`,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let app: INestApplication;
/* eslint-enable @typescript-eslint/no-explicit-any */

const origKeyDisabled = process.env.KEY_DISABLED;
const origAiDisabled = process.env.AI_DISABLED;

function restoreEnv() {
  if (origKeyDisabled === undefined) delete process.env.KEY_DISABLED;
  else process.env.KEY_DISABLED = origKeyDisabled;
  if (origAiDisabled === undefined) delete process.env.AI_DISABLED;
  else process.env.AI_DISABLED = origAiDisabled;
}

async function cleanup() {
  try {
    await db.$executeRawUnsafe(`DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`);
  } catch {
    /* best-effort cleanup */
  }
}

beforeAll(async () => {
  Logger.overrideLogger(false);

  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { IdentityController } = await import('../src/modules/identity/identity.controller');
  const { IdentityService } = await import('../src/modules/identity/identity.service');
  const { IdentitySignupService } = await import('../src/modules/identity/identity-signup.service');
  const { AuthSecurityService } = await import('../src/modules/identity/auth-security.service');
  const { IdentityPasswordService } = await import('../src/modules/identity/identity-password.service');
  const { BusinessContextService } = await import('../src/modules/identity/business-context.service');
  const { BlueprintService } = await import('../src/modules/blueprint/blueprint.service');
  const { DefaultTriggersService } = await import('../src/modules/ai/default-triggers.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { SupabaseAdminService } = await import('../src/core/auth/supabase-admin.service');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');

  const prismaService = new PrismaService();
  await prismaService.onModuleInit();
  db = prismaService.client;
  await cleanup();

  await db.user.create({
    data: {
      id: ID.user,
      email: `${P}user@test.local`,
      name: 'Ada Shell',
      firstName: 'Ada',
      lastName: 'Shell',
      role: 'USER',
    },
  });

  const noop = {};
  const moduleRef = await Test.createTestingModule({
    controllers: [IdentityController],
    providers: [
      { provide: PrismaService, useValue: prismaService },
      IdentityService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      { provide: BlueprintService, useValue: noop },
      { provide: DefaultTriggersService, useValue: noop },
      { provide: AiUsageService, useValue: noop },
      { provide: IdentitySignupService, useValue: noop },
      { provide: AuthSecurityService, useValue: noop },
      { provide: IdentityPasswordService, useValue: noop },
      { provide: BusinessContextService, useValue: noop },
      { provide: SupabaseAdminService, useValue: noop },
      { provide: REDIS_CLIENT, useValue: null },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.use((req: any, _res: any, next: () => void) => {
    const uid = req.headers[HEADER];
    if (typeof uid === 'string' && uid.length > 0) {
      req.user = { id: uid, role: 'USER', email: `${P}req_${uid}@test.local` };
    }
    next();
  });
  await app.init();
});

afterEach(() => {
  restoreEnv();
});

afterAll(async () => {
  restoreEnv();
  if (app) await app.close();
  if (db) {
    await cleanup();
    await db.$disconnect();
  }
});

describe('P89 — SWP-KEY-SHELL-SMOKE server half (GET /identity/me keyDisabled)', () => {
  it('[KSS-01] RED-BEFORE: returns keyDisabled: false when KEY_DISABLED is unset, 0, or false and preserves profile fields', async () => {
    for (const val of [undefined, '', '0', 'false']) {
      if (val === undefined) delete process.env.KEY_DISABLED;
      else process.env.KEY_DISABLED = val;

      const res = await request(app.getHttpServer()).get('/identity/me').set(HEADER, ID.user);
      expect(res.status, `KEY_DISABLED=${String(val)}`).toBe(200);
      expect(res.body.keyDisabled).toBe(false);
      expect(res.body).toMatchObject({
        id: ID.user,
        email: `${P}user@test.local`,
        name: 'Ada Shell',
        firstName: 'Ada',
        lastName: 'Shell',
        role: 'USER',
      });
    }
  });

  it('[KSS-02] RED-BEFORE: returns keyDisabled: true when KEY_DISABLED is 1, true, or padded TRUE', async () => {
    for (const val of ['1', 'true', ' TRUE ']) {
      process.env.KEY_DISABLED = val;

      const res = await request(app.getHttpServer()).get('/identity/me').set(HEADER, ID.user);
      expect(res.status, `KEY_DISABLED=${val}`).toBe(200);
      expect(res.body.keyDisabled).toBe(true);
      expect(res.body.id).toBe(ID.user);
    }
  });

  it('[KSS-03] RED-BEFORE: AI_DISABLED=1 alone leaves keyDisabled: false (distinct switches per D-17)', async () => {
    delete process.env.KEY_DISABLED;
    process.env.AI_DISABLED = '1';

    const res = await request(app.getHttpServer()).get('/identity/me').set(HEADER, ID.user);
    expect(res.status).toBe(200);
    expect(res.body.keyDisabled).toBe(false);
  });

  it('[KSS-04] Control: unauthenticated GET /identity/me is refused 401 without keyDisabled; unknown user is 404', async () => {
    process.env.KEY_DISABLED = '1';
    const unauth = await request(app.getHttpServer()).get('/identity/me');
    expect(unauth.status).toBe(401);
    expect(unauth.body).not.toHaveProperty('keyDisabled');

    const missing = await request(app.getHttpServer()).get('/identity/me').set(HEADER, ID.missingUser);
    expect(missing.status).toBe(404);
  });
});
