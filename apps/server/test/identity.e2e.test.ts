import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import { IdentityController } from '../src/modules/identity/identity.controller';
import { IdentityService } from '../src/modules/identity/identity.service';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { BusinessGuard } from '../src/core/auth/business.guard';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { ValidationPipe } from '@nestjs/common';

class PrismaMock implements Partial<PrismaService> {
  private businesses: any[] = [];
  client = {
    business: {
      findMany: async ({ where }: any) => {
        if (where?.ownerId) {
          return this.businesses.filter((b) => b.ownerId === where.ownerId && b.deletedAt === null);
        }
        return this.businesses.filter((b) => b.deletedAt === null);
      },
      create: async ({ data }: any) => {
        const item = { ...data, id: `biz_${this.businesses.length + 1}`, deletedAt: null };
        this.businesses.push(item);
        return item;
      },
    },
  };
}

describe.skip('Identity e2e', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [IdentityController],
      providers: [
        { provide: PrismaService, useValue: new PrismaMock() },
        IdentityService,
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(BusinessGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
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
