import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import { IdentityController } from '../src/modules/identity/identity.controller';
import { IdentityService } from '../src/modules/identity/identity.service';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { BusinessGuard } from '../src/core/auth/business.guard';

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
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(BusinessGuard)
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
