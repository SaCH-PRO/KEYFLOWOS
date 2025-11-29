import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import { CrmController } from '../src/modules/crm/crm.controller';
import { CrmService } from '../src/modules/crm/crm.service';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { BusinessGuard } from '../src/core/auth/business.guard';

const crmServiceMock = {
  contacts: [] as any[],
  listContacts(businessId: string) {
    return this.contacts.filter((c: any) => c.businessId === businessId);
  },
  createContact(input: { businessId: string; firstName?: string; email?: string }) {
    const item = { id: `contact_${this.contacts.length + 1}`, ...input };
    this.contacts.push(item);
    return item;
  },
};

describe('CRM e2e', () => {
  let app: INestApplication;

  beforeAll(async () => {
    crmServiceMock.contacts = [];
    const moduleRef = await Test.createTestingModule({
      controllers: [CrmController],
      providers: [
        { provide: CrmService, useValue: crmServiceMock },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(BusinessGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    const controller = moduleRef.get(CrmController);
    (controller as any).crm = crmServiceMock;
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
