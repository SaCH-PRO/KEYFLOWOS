import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { describe, beforeAll, afterAll, it, expect, vi } from 'vitest';
import { IdentityController } from '../src/modules/identity/identity.controller';
import { IdentityService } from '../src/modules/identity/identity.service';
import { IdentitySignupService } from '../src/modules/identity/identity-signup.service';
import { BusinessContextService } from '../src/modules/identity/business-context.service';
import { AiUsageService } from '../src/modules/ai/ai-usage.service';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { BusinessGuard } from '../src/core/auth/business.guard';
import { OptionalAuthGuard } from '../src/core/auth/optional-auth.guard';
import { ModuleScopeGuard } from '../src/core/auth/module-scope.guard';

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
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [IdentityController],
      providers: [
        { provide: IdentityService, useValue: {} },
        { provide: IdentitySignupService, useValue: signupSvcMock },
        { provide: BusinessContextService, useValue: {} },
        { provide: AiUsageService, useValue: {} },
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
