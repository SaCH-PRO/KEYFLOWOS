import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import { IdentityController } from '../src/modules/identity/identity.controller';
import { IdentityService } from '../src/modules/identity/identity.service';
import { AiUsageService } from '../src/modules/ai/ai-usage.service';
import { BusinessContextService } from '../src/modules/identity/business-context.service';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { BusinessGuard } from '../src/core/auth/business.guard';
import { OptionalAuthGuard } from '../src/core/auth/optional-auth.guard';
import { ModuleScopeGuard } from '../src/core/auth/module-scope.guard';
import { PlanLimitGuard } from '../src/modules/subscriptions/plan-limit.guard';
import { FeatureFlagGuard } from '../src/modules/crm/guards/feature-flag.guard';

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
  bootstrapUser(input: { userId: string; email: string; firstName?: string; lastName?: string }) {
    return {
      user: {
        id: input.userId,
        email: input.email,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        role: 'USER',
      },
      business: { id: 'biz_bootstrap', name: 'Workspace' },
    };
  },
};

const aiUsageServiceMock = {};
const businessContextServiceMock = {
  gatherContext: async () => ({}),
  buildContextBlock: () => '',
};

describe('Identity e2e', () => {
  let app: INestApplication;

  beforeAll(async () => {
    identityServiceMock.items = [];
    const moduleRef = await Test.createTestingModule({
      controllers: [IdentityController],
      providers: [
        { provide: IdentityService, useValue: identityServiceMock },
        { provide: AiUsageService, useValue: aiUsageServiceMock },
        { provide: BusinessContextService, useValue: businessContextServiceMock },
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
      .overrideGuard(PlanLimitGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(FeatureFlagGuard)
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

  it('bootstraps identity when middleware user has id-only and body provides email', async () => {
    const agent = request(app.getHttpServer());
    const res = await agent
      .post('/identity/bootstrap')
      .send({ email: 'id.only@example.com', firstName: 'Id', lastName: 'Only' })
      .expect(201);

    expect(res.body.user.id).toBe('user_1');
    expect(res.body.user.email).toBe('id.only@example.com');
    expect(res.body.business.id).toBe('biz_bootstrap');
  });
});
