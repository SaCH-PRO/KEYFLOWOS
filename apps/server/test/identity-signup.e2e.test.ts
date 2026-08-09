import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { BadRequestException, HttpException, INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { describe, beforeAll, afterAll, it, expect, vi } from 'vitest';
import { IdentityController } from '../src/modules/identity/identity.controller';
import { IdentityService } from '../src/modules/identity/identity.service';
import { IdentitySignupService } from '../src/modules/identity/identity-signup.service';
import { BusinessContextService } from '../src/modules/identity/business-context.service';
import { AiUsageService } from '../src/modules/ai/ai-usage.service';
import { AuthSecurityService } from '../src/modules/identity/auth-security.service';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { BusinessGuard } from '../src/core/auth/business.guard';
import { OptionalAuthGuard } from '../src/core/auth/optional-auth.guard';
import { ModuleScopeGuard } from '../src/core/auth/module-scope.guard';
import { SupabaseAdminService } from '../src/core/auth/supabase-admin.service';
import { REDIS_CLIENT } from '../src/core/redis/redis.constants';

/**
 * Logout dependencies. Functional stubs, not `{}` — identity.controller.ts
 * swallows failures from both so an empty object would let a broken logout look
 * like a passing one. See the longer note in identity.e2e.test.ts.
 */
const supabaseAdminStub = { signOut: async () => undefined };
const redisStub = { setex: async () => 'OK', set: async () => 'OK', get: async () => null, del: async () => 0 };

/**
 * Smoke test for the new server-driven signup + resend-verification
 * endpoints. The IdentitySignupService is mocked so we only exercise
 * the controller wiring, DTO validation, and response shape.
 */
describe('Identity signup endpoints', () => {
  let app: INestApplication;
  const signupSvcMock = {
    signup: vi.fn(),
    resendVerification: vi.fn(),
    signInWithPassword: vi.fn(),
  };
  const authSecMock = {
    enforce: vi.fn(async () => undefined),
    audit: vi.fn(async () => undefined),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [IdentityController],
      providers: [
        { provide: IdentityService, useValue: {} },
        { provide: IdentitySignupService, useValue: signupSvcMock },
        { provide: BusinessContextService, useValue: {} },
        { provide: AiUsageService, useValue: {} },
        { provide: AuthSecurityService, useValue: authSecMock },
        { provide: PrismaService, useValue: { client: {} } },
        { provide: SupabaseAdminService, useValue: supabaseAdminStub },
        { provide: REDIS_CLIENT, useValue: redisStub },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(BusinessGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(OptionalAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ModuleScopeGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a session when verification is disabled (auto-confirm)', async () => {
    signupSvcMock.signup.mockResolvedValueOnce({
      mode: 'session',
      userId: 'u1',
      email: 'a@b.com',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
    });
    const res = await request(app.getHttpServer())
      .post('/identity/signup')
      .send({ email: 'a@b.com', password: 'StrongPass1' })
      .expect(201);
    expect(res.body.status).toBe('authenticated');
    expect(res.body.verificationRequired).toBe(false);
    expect(res.body.accessToken).toBe('access-1');
    expect(res.body.refreshToken).toBe('refresh-1');
  });

  it('returns verification_sent when verification is required', async () => {
    signupSvcMock.signup.mockResolvedValueOnce({
      mode: 'verification',
      userId: 'u2',
      email: 'c@d.com',
    });
    const res = await request(app.getHttpServer())
      .post('/identity/signup')
      .send({ email: 'c@d.com', password: 'StrongPass1' })
      .expect(201);
    expect(res.body.status).toBe('verification_sent');
    expect(res.body.verificationRequired).toBe(true);
    // Sensitive fields must NOT leak on the verification path.
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();
  });

  it('propagates email_taken errors from the service as 400 with a code', async () => {
    signupSvcMock.signup.mockRejectedValueOnce(
      new BadRequestException({ code: 'email_taken', message: 'That email is already registered.' }),
    );
    const res = await request(app.getHttpServer())
      .post('/identity/signup')
      .send({ email: 'dup@d.com', password: 'StrongPass1' })
      .expect(400);
    expect(res.body.code).toBe('email_taken');
    expect(res.body.message).toMatch(/already registered/i);
  });

  it('resend-verification returns ok with cooldown when throttled', async () => {
    signupSvcMock.resendVerification.mockResolvedValueOnce({ ok: true, cooldownRemainingMs: 45000 });
    const res = await request(app.getHttpServer())
      .post('/identity/resend-verification')
      .send({ email: 'a@b.com' })
      .expect(201);
    expect(res.body.status).toBe('ok');
    expect(res.body.cooldownRemainingMs).toBe(45000);
  });

});

describe('Identity login endpoint', () => {
  let app: INestApplication;
  const signupSvcMock = {
    signup: vi.fn(),
    resendVerification: vi.fn(),
    signInWithPassword: vi.fn(),
  };
  const authSecMock = {
    enforce: vi.fn(async () => undefined),
    audit: vi.fn(async () => undefined),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [IdentityController],
      providers: [
        { provide: IdentityService, useValue: {} },
        { provide: IdentitySignupService, useValue: signupSvcMock },
        { provide: BusinessContextService, useValue: {} },
        { provide: AiUsageService, useValue: {} },
        { provide: AuthSecurityService, useValue: authSecMock },
        { provide: PrismaService, useValue: { client: {} } },
        { provide: SupabaseAdminService, useValue: supabaseAdminStub },
        { provide: REDIS_CLIENT, useValue: redisStub },
      ],
    })
      .overrideGuard(AuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(BusinessGuard).useValue({ canActivate: () => true })
      .overrideGuard(OptionalAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(ModuleScopeGuard).useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => { await app.close(); });

  it('returns access + refresh tokens on successful sign-in', async () => {
    signupSvcMock.signInWithPassword.mockResolvedValueOnce({
      accessToken: 'acc-1',
      refreshToken: 'ref-1',
    });
    const res = await request(app.getHttpServer())
      .post('/identity/login')
      .send({ email: 'good@example.com', password: 'StrongPass1' })
      .expect(201);
    expect(res.body.status).toBe('authenticated');
    expect(res.body.accessToken).toBe('acc-1');
    expect(res.body.refreshToken).toBe('ref-1');
    // Must have audited a success.
    expect(authSecMock.audit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'login_success', outcome: 'success' }),
    );
  });

  it('surfaces invalid_credentials as 400 with stable error code', async () => {
    signupSvcMock.signInWithPassword.mockRejectedValueOnce(
      new BadRequestException({ code: 'invalid_credentials', message: 'Invalid email or password.' }),
    );
    const res = await request(app.getHttpServer())
      .post('/identity/login')
      .send({ email: 'wrong@example.com', password: 'WrongPass1' })
      .expect(400);
    expect(res.body.code).toBe('invalid_credentials');
    expect(authSecMock.audit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'login_failure', reason: 'invalid_credentials' }),
    );
  });

  it('surfaces email_not_confirmed so the UI can offer Resend', async () => {
    signupSvcMock.signInWithPassword.mockRejectedValueOnce(
      new BadRequestException({ code: 'email_not_confirmed', message: 'Please verify your email before signing in.' }),
    );
    const res = await request(app.getHttpServer())
      .post('/identity/login')
      .send({ email: 'unconf@example.com', password: 'StrongPass1' })
      .expect(400);
    expect(res.body.code).toBe('email_not_confirmed');
  });

  it('returns 429 with rate_limited when AuthSecurityService trips the per-IP bucket', async () => {
    authSecMock.enforce.mockImplementationOnce(async () => {
      throw new HttpException({ code: 'rate_limited', message: 'Too many attempts. Try again later.' }, 429);
    });
    const res = await request(app.getHttpServer())
      .post('/identity/login')
      .send({ email: 'rl@example.com', password: 'StrongPass1' })
      .expect(429);
    expect(res.body.code).toBe('rate_limited');
    // Must audit the rate-limit decision so admins can see it in the audit log.
    expect(authSecMock.audit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'rate_limited', outcome: 'rate_limited', reason: 'login' }),
    );
    // And signInWithPassword must NOT have been called — rate-limit fires before the credential exchange.
    expect(signupSvcMock.signInWithPassword).not.toHaveBeenCalledWith('rl@example.com', expect.anything());
  });
});

/**
 * /identity/me — verifies the AuthGuard wiring. Without a valid bearer
 * the guard rejects with 401 before the controller body runs; with a
 * valid bearer the controller delegates to IdentityService.getUser().
 */
import { UnauthorizedException as UnauthorizedExceptionForMeSuite } from '@nestjs/common';

describe('Identity me endpoint (auth gate)', () => {
  let app: INestApplication;
  const identityMock = { getUser: vi.fn() };
  let authedAs: { id: string; email: string; role: string } | null = null;
  const guardImpl = {
    canActivate: (ctx: { switchToHttp: () => { getRequest: () => { user?: unknown } } }) => {
      if (!authedAs) throw new UnauthorizedExceptionForMeSuite('Authentication required');
      const req = ctx.switchToHttp().getRequest();
      req.user = authedAs;
      return true;
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [IdentityController],
      providers: [
        { provide: IdentityService, useValue: identityMock },
        { provide: IdentitySignupService, useValue: { signup: vi.fn(), resendVerification: vi.fn(), signInWithPassword: vi.fn() } },
        { provide: BusinessContextService, useValue: {} },
        { provide: AiUsageService, useValue: {} },
        { provide: AuthSecurityService, useValue: { enforce: vi.fn(async () => undefined), audit: vi.fn(async () => undefined) } },
        { provide: PrismaService, useValue: { client: {} } },
        { provide: SupabaseAdminService, useValue: supabaseAdminStub },
        { provide: REDIS_CLIENT, useValue: redisStub },
      ],
    })
      .overrideGuard(AuthGuard).useValue(guardImpl)
      .overrideGuard(BusinessGuard).useValue({ canActivate: () => true })
      .overrideGuard(OptionalAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(ModuleScopeGuard).useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => { await app.close(); });

  it('returns 401 for unauthenticated callers and never invokes IdentityService', async () => {
    authedAs = null;
    identityMock.getUser.mockClear();
    const res = await request(app.getHttpServer()).get('/identity/me');
    expect(res.status).toBe(401);
    expect(identityMock.getUser).not.toHaveBeenCalled();
  });

  it('returns the user payload when AuthGuard accepts the bearer', async () => {
    authedAs = { id: 'u-42', email: 'me@example.com', role: 'OWNER' };
    identityMock.getUser.mockClear();
    identityMock.getUser.mockResolvedValueOnce({ id: 'u-42', email: 'me@example.com', role: 'OWNER' });
    const res = await request(app.getHttpServer()).get('/identity/me').expect(200);
    expect(res.body).toMatchObject({ id: 'u-42', email: 'me@example.com' });
    expect(identityMock.getUser).toHaveBeenCalledTimes(1);
    expect(identityMock.getUser).toHaveBeenCalledWith('u-42');
  });
});
