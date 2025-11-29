import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import { CrmController } from '../src/modules/crm/crm.controller';
import { CrmService } from '../src/modules/crm/crm.service';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { BusinessGuard } from '../src/core/auth/business.guard';

class PrismaMock implements Partial<PrismaService> {
  private contacts: any[] = [];
  client = {
    contact: {
      findMany: async ({ where }: any) =>
        this.contacts.filter((c) => c.businessId === where.businessId && c.deletedAt === null),
      create: async ({ data }: any) => {
        const item = { ...data, id: `contact_${this.contacts.length + 1}`, deletedAt: null };
        this.contacts.push(item);
        return item;
      },
    },
  };
}

describe.skip('CRM e2e', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CrmController],
      providers: [
        { provide: PrismaService, useValue: new PrismaMock() },
        CrmService,
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

  it('creates and lists contacts for a business', async () => {
    const agent = request(app.getHttpServer());
    await agent
      .post('/crm/businesses/biz_1/contacts')
      .send({ firstName: 'Alice', email: 'alice@example.com' })
      .expect(201);

    const res = await agent.get('/crm/businesses/biz_1/contacts').expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].firstName).toBe('Alice');
  });
});
