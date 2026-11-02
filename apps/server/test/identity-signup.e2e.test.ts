import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { BadRequestException, HttpException, INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { describe, beforeAll, afterAll, it, expect, vi } from 'vitest';
import { IdentityController, USERNAME_CHECK_RULE } from '../src/modules/identity/identity.controller';
import { IdentityService } from '../src/modules/identity/identity.service';
import { IdentitySignupService } from '../src/modules/identity/identity-signup.service';
import { BusinessContextService } from '../src/modules/identity/business-context.service';
import { AiUsageService } from '../src/modules/ai/ai-usage.service';
import { AuthSecurityService } from '../src/modules/identity/auth-security.service';
import { IdentityPasswordService } from '../src/modules/identity/identity-password.service';
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
        // Added when IdentityController gained password recovery; these suites
        // do not exercise it, but Nest still has to resolve it.
        { provide: IdentityPasswordService, useValue: {} },
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
        { provide: IdentityPasswordService, useValue: {} },
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
        { provide: IdentityPasswordService, useValue: {} },
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

/**
 * V1-56-AUTH-USERNAME-THROTTLE — GET /identity/check-username is an
 * unauthenticated oracle (it says whether a username exists) and had no
 * throttle: any number of calls in any window answered 200.
 *
 * The limit is not free to choose. The signup form checks once per keystroke
 * after a 300 ms debounce and once more on submit, and a refused check reaches
 * the form as 'unknown', which blocks signup ("Unable to verify username"). A
 * limit the form can reach is therefore a signup outage, not a throttle. That
 * half of the proof drives the real form:
 * apps/web/src/app/auth/signup/__tests__/signup-username-throttle.test.tsx
 * reads the rule pinned here from the controller source and shows the form
 * stays under it. This suite proves the server half: the rule's numbers, 200 up
 * to the limit, 429 above it, per client IP, and a window that slides.
 *
 * The REAL AuthSecurityService runs here (bucket key, the 429 and its body);
 * only its store is a double. `$queryRaw` below answers the one statement
 * enforce() sends — count the bucket's hits at or after the window start,
 * insert a hit only while that count is under the limit — so the window is
 * counted the way auth_rate_limits counts it. This is a mocked-HTTP suite and
 * needs no database (vitest.e2e.config.ts).
 */
describe('Identity check-username throttle (V1-56)', () => {
  /** The pinned rule. Changing it changes what the signup form may send. */
  const LIMIT = 240;
  const WINDOW_MS = 60_000;
  /** The form's debounce (apps/web/src/hooks/use-username-availability.ts). */
  const FORM_DEBOUNCE_MS = 300;

  let app: NestExpressApplication;
  const hitsByBucket = new Map<string, number[]>();
  const userFindFirst = vi.fn(async () => null);
  const queryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    if (!sql.includes('auth_rate_limits') || !sql.includes('INSERT')) {
      throw new Error(`unexpected raw query: ${sql}`);
    }
    const [bucket, windowStart, , limit] = values as [string, Date, string, number];
    const inWindow = (hitsByBucket.get(bucket) ?? []).filter((t) => t >= windowStart.getTime());
    const prior = inWindow.length;
    const allowed = prior < limit;
    if (allowed) inWindow.push(Date.now());
    hitsByBucket.set(bucket, inWindow);
    return [{ prior_count: prior, allowed }];
  });
  const prismaDouble = {
    client: {
      user: { findFirst: userFindFirst },
      authRateLimit: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      $queryRaw: queryRaw,
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [IdentityController],
      providers: [
        { provide: IdentityService, useValue: {} },
        { provide: IdentitySignupService, useValue: { signup: vi.fn(), resendVerification: vi.fn(), signInWithPassword: vi.fn() } },
        { provide: BusinessContextService, useValue: {} },
        { provide: AiUsageService, useValue: {} },
        AuthSecurityService,
        { provide: IdentityPasswordService, useValue: {} },
        { provide: PrismaService, useValue: prismaDouble },
        { provide: SupabaseAdminService, useValue: supabaseAdminStub },
        { provide: REDIS_CLIENT, useValue: redisStub },
      ],
    })
      .overrideGuard(AuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(BusinessGuard).useValue({ canActivate: () => true })
      .overrideGuard(OptionalAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(ModuleScopeGuard).useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    // app-bootstrap.ts sets trust proxy from TRUST_PROXY. Here it lets each case
    // name its own client address, so no bucket is shared between cases.
    app.getHttpAdapter().getInstance().set('trust proxy', true);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => { await app.close(); });

  const check = (ip: string, username = 'someone_new') =>
    request(app.getHttpServer())
      .get('/identity/check-username')
      .query({ username })
      .set('X-Forwarded-For', ip);

  /** `n` checks from one address, each for a different username; their statuses. */
  async function spend(ip: string, n: number): Promise<number[]> {
    const statuses: number[] = [];
    for (let i = 0; i < n; i++) statuses.push((await check(ip, `user_${i}`)).status);
    return statuses;
  }

  it('pins the rule: 240 checks per client IP per 60 s, above the form ceiling of one check per debounce plus submit', () => {
    expect(USERNAME_CHECK_RULE).toEqual({ scope: 'check_username:ip', limit: LIMIT, windowMs: WINDOW_MS });
    // Debounced checks are at least FORM_DEBOUNCE_MS apart, so one window holds
    // at most floor(window / debounce) + 1 of them, and submit adds one.
    const formCeiling = Math.floor(WINDOW_MS / FORM_DEBOUNCE_MS) + 1 + 1;
    expect(formCeiling).toBe(202);
    expect(LIMIT).toBeGreaterThan(formCeiling);
  });

  it('answers 200 to every check up to the limit inside one window', async () => {
    const statuses = await spend('198.51.100.1', LIMIT);
    expect(statuses.filter((s) => s !== 200)).toEqual([]);
    expect(userFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: { equals: 'user_0', mode: 'insensitive' } } }),
    );
  });

  it('answers 429 rate_limited to the check after the limit, without reading the user table', async () => {
    const ip = '198.51.100.2';
    const statuses = await spend(ip, LIMIT);
    expect(statuses.filter((s) => s !== 200)).toEqual([]);

    const readsBefore = userFindFirst.mock.calls.length;
    const refused = await check(ip, 'one_too_many');
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe('rate_limited');
    expect(refused.body.available).toBeUndefined();
    expect(userFindFirst.mock.calls.length).toBe(readsBefore);

    // Per client IP: another address is still answered while this one is refused.
    const other = await check('198.51.100.3');
    expect(other.status).toBe(200);
    expect(other.body).toEqual({ available: true });
  });

  it('slides: a refused address is answered again once its window has passed, and refusals do not extend it', async () => {
    const ip = '198.51.100.4';
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-02T10:00:00.000Z'));
      await spend(ip, LIMIT);
      expect((await check(ip)).status).toBe(429);

      // One second before the window closes: still refused.
      vi.setSystemTime(new Date(Date.now() + WINDOW_MS - 1_000));
      expect((await check(ip)).status).toBe(429);

      // Past it: answered, although the two refusals above were inside it.
      vi.setSystemTime(new Date(Date.now() + 1_001));
      const again = await check(ip);
      expect(again.status).toBe(200);
      expect(again.body).toEqual({ available: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
