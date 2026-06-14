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
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AuthMiddleware } from '../src/core/auth/auth.middleware';
import { SupabaseAuthService } from '../src/core/auth/supabase-auth.service';
import { REDIS_CLIENT } from '../src/core/redis/redis.constants';

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
        { provide: REDIS_CLIENT, useValue: { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') } },
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
});
