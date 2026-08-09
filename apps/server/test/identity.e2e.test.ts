import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { describe, beforeAll, afterAll, it, expect } from 'vitest';
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
 * IdentityController gained SupabaseAdminService and REDIS_CLIENT for the
 * server-driven logout endpoint. app.module resolves both, so the real server
 * boots and the boot gate stays green — only the hand-rolled test modules here
 * and in identity-signup / auth-callback-bootstrap went stale.
 *
 * The stubs are functional rather than `{}` on purpose. identity.controller.ts
 * wraps both calls in try/catch and swallows the error deliberately, so a client
 * can always clear its own storage. An `{}` stub therefore does not fail — the
 * TypeError is caught, logged at warn, and logout returns `{ status:
 * 'logged_out' }` having revoked nothing. Anything asserting on that response
 * would pass while the session stayed alive.
 */
const supabaseAdminStub = { signOut: async () => undefined };
const redisStub = {
  setex: async () => 'OK',
  set: async () => 'OK',
  get: async () => null, // no revocation marker — the not-revoked path
  del: async () => 0,
};

const identityServiceMock = {
  items: [] as any[],
  listBusinesses() {
    return this.items;
  },
  createBusiness(input: { name: string; ownerId?: string }) {
    const item = { id: `biz_${this.items.length + 1}`, ...input };
    this.items.push(item);
    return item;
  },
};

describe('Identity e2e', () => {
  let app: INestApplication;

  beforeAll(async () => {
    identityServiceMock.items = [];
    const moduleRef = await Test.createTestingModule({
      controllers: [IdentityController],
      providers: [
        { provide: IdentityService, useValue: identityServiceMock },
        { provide: IdentitySignupService, useValue: {} },
        { provide: BusinessContextService, useValue: {} },
        { provide: AiUsageService, useValue: {} },
        { provide: AuthSecurityService, useValue: { enforce: async () => undefined, audit: async () => undefined } },
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
    const controller = moduleRef.get(IdentityController);
    (controller as any).identity = identityServiceMock;
    app.use((req: any, _res: any, next: any) => {
      (req as any).user = { id: 'user_1' };
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates and lists businesses', async () => {
    const agent = request(app.getHttpServer());
    await agent.post('/identity/businesses').send({ name: 'Acme' }).expect(201);
    const res = await agent.get('/identity/businesses').expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Acme');
  });
});
