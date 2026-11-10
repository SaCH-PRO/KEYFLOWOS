import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ConflictException, INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { describe, beforeAll, afterAll, it, expect, vi } from 'vitest';
import { IdentityController } from '../src/modules/identity/identity.controller';
import { IdentityService } from '../src/modules/identity/identity.service';
import { IdentitySignupService } from '../src/modules/identity/identity-signup.service';
import { BusinessContextService } from '../src/modules/identity/business-context.service';
import { AiUsageService } from '../src/modules/ai/ai-usage.service';
import { AuthSecurityService } from '../src/modules/identity/auth-security.service';
import { IdentityPasswordService } from '../src/modules/identity/identity-password.service';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AuthMiddleware } from '../src/core/auth/auth.middleware';
import { SupabaseAuthService } from '../src/core/auth/supabase-auth.service';
import { REDIS_CLIENT } from '../src/core/redis/redis.constants';
import { SupabaseAdminService } from '../src/core/auth/supabase-admin.service';

// Server-side leg of the Google sign-in callback flow (task #310).
// Exercises the real AuthMiddleware -> AuthGuard -> POST /identity/bootstrap
// path with a stubbed SupabaseAuthService so a fake token resolves to a
// known user — i.e. the test-only auth bypass lives entirely at the
// SupabaseAuthService boundary, no production code is loosened.

const FAKE_TOKEN = 'fake-supabase-jwt-for-e2e';
const FAKE_USER = { id: 'supabase-user-id', email: 'owner@example.com' };

const supabaseAuthMock = {
  getUserFromToken: vi.fn(async (token?: string) =>
    token === FAKE_TOKEN ? FAKE_USER : null,
  ),
};

const identityServiceMock = {
  bootstrapUser: vi.fn(),
};

/**
 * D-97 (W8-RISC-SIGNIN-CUTOFF) / W7-RISC-REVOKE review SEC-W7RR-1: GoTrue's
 * admin user record for the token's user, as the service-role client reads it
 * (GET /admin/users/:id). Its google identity carries the Google sub a RISC
 * event names. Nothing leaves the process.
 */
const VERIFIED_GOOGLE_SUB = 'google-sub-verified-callback';
const FORGED_GOOGLE_SUB = 'google-sub-of-another-person';
const verifiedRecord = (id: string) => ({
  id,
  email: FAKE_USER.email,
  identities: [
    {
      identity_id: '6a0e3f52-1b9c-4d7e-8f21-3c4d5e6f7a8b',
      id: VERIFIED_GOOGLE_SUB,
      user_id: id,
      provider: 'google',
      identity_data: { sub: VERIFIED_GOOGLE_SUB, email: FAKE_USER.email },
    },
  ],
});
const getUserById = vi.fn(async (id: string) => ({ data: { user: verifiedRecord(id) }, error: null as { message: string } | null }));
const supabaseAdminMock = {
  signOut: vi.fn(async () => undefined),
  isConfigured: vi.fn(() => true),
  getClient: vi.fn(() => ({ auth: { admin: { getUserById } } })),
};

function makePrismaMock() {
  return {
    client: {
      user: {
        findUnique: vi.fn(async () => ({ role: 'OWNER' })),
      },
    },
  } as unknown as PrismaService;
}

describe('Auth callback -> /identity/bootstrap (server middleware path)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [IdentityController],
      providers: [
        AuthMiddleware,
        { provide: SupabaseAuthService, useValue: supabaseAuthMock },
        { provide: PrismaService, useValue: makePrismaMock() },
        { provide: IdentityService, useValue: identityServiceMock },
        { provide: IdentitySignupService, useValue: {} },
        { provide: BusinessContextService, useValue: {} },
        { provide: AiUsageService, useValue: {} },
        { provide: AuthSecurityService, useValue: { enforce: vi.fn(async () => undefined), audit: vi.fn(async () => undefined) } },
        // Added when IdentityController gained password recovery; these suites
        // do not exercise it, but Nest still has to resolve it.
        { provide: IdentityPasswordService, useValue: {} },
        // `get` returning null is the not-revoked path: AuthMiddleware reads
        // `auth:revoked:user:<id>` on every request, and this suite exercises
        // the real middleware. The revoked path is covered by
        // auth.middleware.spec.ts:126.
        { provide: REDIS_CLIENT, useValue: { get: vi.fn(async () => null), set: vi.fn(async () => 'OK'), setex: vi.fn(async () => 'OK') } },
        // Logout dependency. Functional, not `{}` — the controller swallows its
        // failures. See identity.e2e.test.ts. D-97 / SEC-W7RR-1: bootstrap
        // also reads the token user's VERIFIED record here (GoTrue's admin
        // user record), whose identities it hands to bootstrapUser.
        { provide: SupabaseAdminService, useValue: supabaseAdminMock },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Wire the real middleware on the bootstrap route so the full
    // token-verification path runs end-to-end.
    const middleware = moduleRef.get(AuthMiddleware);
    app.use((req: any, res: any, next: any) => middleware.use(req, res, next));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects bootstrap with 401 when no Bearer token is supplied', async () => {
    identityServiceMock.bootstrapUser.mockClear();
    const res = await request(app.getHttpServer()).post('/identity/bootstrap').send({});
    expect(res.status).toBe(401);
    expect(identityServiceMock.bootstrapUser).not.toHaveBeenCalled();
  });

  it('accepts the fake token, attaches the user, and returns the bootstrapped workspace', async () => {
    identityServiceMock.bootstrapUser.mockResolvedValueOnce({
      user: { id: FAKE_USER.id, email: FAKE_USER.email, role: 'OWNER' },
      business: { id: 'biz-callback-1', name: "Ada's Workspace" },
    });

    const res = await request(app.getHttpServer())
      .post('/identity/bootstrap')
      .set('Authorization', `Bearer ${FAKE_TOKEN}`)
      .send({ firstName: 'Ada', lastName: 'Lovelace', name: 'Ada Lovelace' })
      .expect(201);

    expect(supabaseAuthMock.getUserFromToken).toHaveBeenCalledWith(FAKE_TOKEN);
    expect(identityServiceMock.bootstrapUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: FAKE_USER.id,
        email: FAKE_USER.email,
        firstName: 'Ada',
        lastName: 'Lovelace',
      }),
      // R0-SEC-01 review repair: the proof a pending team invitation needs.
      expect.objectContaining({ proveEmailOwnership: expect.any(Function) }),
    );
    expect(res.body).toMatchObject({
      user: { id: FAKE_USER.id, email: FAKE_USER.email },
      business: { id: 'biz-callback-1' },
    });
  });

  it('surfaces an account_email_conflict ConflictException as 409 with the structured code the callback page switches on', async () => {
    const friendly = 'An account already exists for this email.';
    identityServiceMock.bootstrapUser.mockRejectedValueOnce(
      new ConflictException({ code: 'account_email_conflict', message: friendly }),
    );

    const res = await request(app.getHttpServer())
      .post('/identity/bootstrap')
      .set('Authorization', `Bearer ${FAKE_TOKEN}`)
      .send({ firstName: 'Ada' })
      .expect(409);

    // The frontend bootstrapIdentity() helper reads `code` from either the
    // top-level body or `message.code` (Nest exception payload). Either way
    // the structured `account_email_conflict` value must round-trip so the
    // callback page can render the dedicated conflict screen.
    const code = res.body.code ?? res.body.message?.code;
    const message = res.body.message?.message ?? res.body.message;
    expect(code).toBe('account_email_conflict');
    expect(message).toBe(friendly);
    expect(JSON.stringify(res.body)).not.toMatch(/internal server error/i);
  });

  describe('D-97 (W8-RISC-SIGNIN-CUTOFF) / W7-RISC-REVOKE review SEC-W7RR-1 — the identities bootstrap persists come from the verified provider record, never the body', () => {
    const forgedBody = {
      firstName: 'Ada',
      identities: [{ provider: 'google', id: FORGED_GOOGLE_SUB, identity_data: { sub: FORGED_GOOGLE_SUB } }],
    };
    const lastInput = () => identityServiceMock.bootstrapUser.mock.calls.at(-1)?.[0] as { identities?: Array<Record<string, unknown>> } | undefined;

    it("D-97 / SEC-W7RR-1: forwards the identities of GoTrue's record for the token's own user (read with the service-role client), so the Google sub a RISC event names maps to this user; body.identities is ignored", async () => {
      identityServiceMock.bootstrapUser.mockClear();
      getUserById.mockClear();
      identityServiceMock.bootstrapUser.mockResolvedValueOnce({ user: { id: FAKE_USER.id }, business: { id: 'biz-callback-1' } });

      await request(app.getHttpServer())
        .post('/identity/bootstrap')
        .set('Authorization', `Bearer ${FAKE_TOKEN}`)
        .send(forgedBody)
        .expect(201);

      expect(getUserById).toHaveBeenCalledWith(FAKE_USER.id);
      expect(lastInput()?.identities).toEqual([
        expect.objectContaining({ provider: 'google', id: VERIFIED_GOOGLE_SUB, identity_data: expect.objectContaining({ sub: VERIFIED_GOOGLE_SUB }) }),
      ]);
      expect(JSON.stringify(identityServiceMock.bootstrapUser.mock.calls)).not.toContain(FORGED_GOOGLE_SUB);
    });

    it.each([
      ['a record of another user', () => getUserById.mockResolvedValueOnce({ data: { user: verifiedRecord('someone-else') }, error: null })],
      ['an error result', () => getUserById.mockResolvedValueOnce({ data: { user: null as never }, error: { message: 'gotrue 500' } })],
      ['a throw', () => getUserById.mockRejectedValueOnce(new TypeError('fetch failed'))],
      ['an unconfigured admin client', () => supabaseAdminMock.isConfigured.mockReturnValueOnce(false)],
    ] as Array<[string, () => void]>)(
      'SEC-W7RR-1 negative control: with %s no identity is forwarded (never the body one) and bootstrap still answers 201',
      async (_name, arrange) => {
        identityServiceMock.bootstrapUser.mockClear();
        identityServiceMock.bootstrapUser.mockResolvedValueOnce({ user: { id: FAKE_USER.id }, business: { id: 'biz-callback-1' } });
        arrange();

        await request(app.getHttpServer())
          .post('/identity/bootstrap')
          .set('Authorization', `Bearer ${FAKE_TOKEN}`)
          .send(forgedBody)
          .expect(201);

        expect(identityServiceMock.bootstrapUser).toHaveBeenCalledTimes(1);
        expect(lastInput()?.identities ?? []).toEqual([]);
        expect(JSON.stringify(identityServiceMock.bootstrapUser.mock.calls)).not.toContain(FORGED_GOOGLE_SUB);
      },
    );
  });
});
