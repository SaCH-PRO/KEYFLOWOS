import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('stripe', () => ({
  default: class Stripe {
    webhooks = {
      constructEvent: vi.fn().mockReturnValue({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'sess_1',
            metadata: { invoiceId: 'inv_1' },
            client_reference_id: null,
          },
        },
      }),
    };
  },
}));
import { WebhooksController } from '../src/modules/webhooks/webhooks.controller';
import { CommerceService } from '../src/modules/commerce/commerce.service';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { WebhookDispatcherService } from '../src/modules/webhooks/webhook-dispatcher.service';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { BusinessGuard } from '../src/core/auth/business.guard';

interface BusinessAccess {
  businessId: string;
  ownerId?: string;
  memberIds?: string[];
}

class WebhooksPrismaMock {
  webhooks: any[] = [];
  invoices: any[] = [{ id: 'inv_1', businessId: 'biz_1', total: 250, currency: 'USD' }];
  businessAccess: BusinessAccess[] = [{ businessId: 'biz_1', ownerId: 'user_1' }];
  client: any;

  constructor() {
    const self = this;
    self.client = {
      webhook: {
        findMany: vi.fn(({ where, orderBy }: any) => {
          let rows = self.webhooks.filter((w) => w.businessId === where.businessId);
          if (orderBy?.createdAt === 'desc') {
            rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          }
          return Promise.resolve(rows);
        }),
        create: vi.fn(({ data }: any) => {
          const item = {
            id: `wh_${self.webhooks.length + 1}`,
            createdAt: new Date(),
            ...data,
          };
          self.webhooks.push(item);
          return Promise.resolve(item);
        }),
        deleteMany: vi.fn(({ where }: any) => {
          const before = self.webhooks.length;
          self.webhooks = self.webhooks.filter(
            (w) => !(w.id === where.id && w.businessId === where.businessId),
          );
          return Promise.resolve({ count: before - self.webhooks.length });
        }),
        updateMany: vi.fn(({ where, data }: any) => {
          let count = 0;
          for (const w of self.webhooks) {
            if (w.id === where.id && w.businessId === where.businessId) {
              Object.assign(w, data);
              count += 1;
            }
          }
          return Promise.resolve({ count });
        }),
      },
      invoice: {
        findUnique: vi.fn(({ where }: any) =>
          Promise.resolve(self.invoices.find((i) => i.id === where.id) ?? null),
        ),
      },
      business: {
        findFirst: vi.fn(({ where }: any) => {
          const id: string = where?.id;
          const orClauses: Array<any> = where?.OR ?? [];
          const access = self.businessAccess.find((b) => b.businessId === id);
          if (!access) return Promise.resolve(null);
          for (const clause of orClauses) {
            if (clause.ownerId && access.ownerId === clause.ownerId) {
              return Promise.resolve({ id });
            }
            if (
              clause.members?.some?.userId &&
              access.memberIds?.includes(clause.members.some.userId)
            ) {
              return Promise.resolve({ id });
            }
          }
          return Promise.resolve(null);
        }),
      },
    };
  }
}

describe('WebhooksController', () => {
  let app: INestApplication;
  let prismaMock: WebhooksPrismaMock;
  const markInvoicePaid = vi.fn().mockResolvedValue({ id: 'inv_1', status: 'PAID' });
  const sendTestEvent = vi.fn();
  const getDeliveryLogs = vi.fn();
  let currentUserId: string | undefined = 'user_1';

  const originalStripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const originalStripeSecretKey = process.env.STRIPE_SECRET_KEY;

  beforeAll(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    prismaMock = new WebhooksPrismaMock();

    const moduleRef = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        AuthGuard,
        BusinessGuard,
        { provide: CommerceService, useValue: { markInvoicePaid } },
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: WebhookDispatcherService,
          useValue: { sendTestEvent, getDeliveryLogs },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.use((req: any, _res: any, next: any) => {
      if (currentUserId) {
        req.user = { id: currentUserId };
      }
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env.STRIPE_WEBHOOK_SECRET = originalStripeWebhookSecret;
    process.env.STRIPE_SECRET_KEY = originalStripeSecretKey;
  });

  beforeEach(() => {
    currentUserId = 'user_1';
    prismaMock.webhooks = [];
    prismaMock.businessAccess = [{ businessId: 'biz_1', ownerId: 'user_1' }];
    markInvoicePaid.mockClear();
    sendTestEvent.mockReset();
    getDeliveryLogs.mockReset();
  });

  it('handles stripe webhook and marks invoice paid', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('stripe-signature', 'test_sig')
      .send({ invoiceId: 'inv_1' })
      .expect(201);

    expect(markInvoicePaid).toHaveBeenCalledWith('inv_1');
  });

  it('rejects authenticated CRUD when no user is on the request', async () => {
    currentUserId = undefined;
    await request(app.getHttpServer())
      .get('/webhooks/businesses/biz_1/webhooks')
      .expect(401);
  });

  it('rejects CRUD when the user does not have access to the business', async () => {
    prismaMock.businessAccess = [{ businessId: 'biz_other', ownerId: 'user_1' }];
    await request(app.getHttpServer())
      .get('/webhooks/businesses/biz_1/webhooks')
      .expect(403);
  });

  it('lists webhooks for the authenticated business', async () => {
    prismaMock.webhooks.push({
      id: 'wh_seed',
      businessId: 'biz_1',
      url: 'https://example.com/hook',
      events: ['invoice.paid'],
      name: 'Seed',
      secret: 'secret',
      isActive: true,
      createdAt: new Date(),
    });
    const res = await request(app.getHttpServer())
      .get('/webhooks/businesses/biz_1/webhooks')
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].url).toBe('https://example.com/hook');
  });

  it('creates a webhook with a generated secret and selected events', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/businesses/biz_1/webhooks')
      .send({ url: 'https://example.com/hook', events: ['invoice.paid'], name: 'My Hook' })
      .expect(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.secret).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.isActive).toBe(true);
    expect(prismaMock.webhooks).toHaveLength(1);
  });

  it('rejects creation with an invalid url', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/businesses/biz_1/webhooks')
      .send({ url: 'not-a-url', events: ['invoice.paid'] })
      .expect(201);
    expect(res.body.error).toMatch(/valid URL/);
  });

  it('rejects creation when no events are selected', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/businesses/biz_1/webhooks')
      .send({ url: 'https://example.com/hook', events: [] })
      .expect(201);
    expect(res.body.error).toMatch(/At least one event/);
  });

  it('toggles webhook active state', async () => {
    prismaMock.webhooks.push({
      id: 'wh_toggle',
      businessId: 'biz_1',
      url: 'https://example.com/hook',
      events: ['invoice.paid'],
      name: 'Toggle',
      secret: 'secret',
      isActive: true,
      createdAt: new Date(),
    });

    const res = await request(app.getHttpServer())
      .post('/webhooks/businesses/biz_1/webhooks/wh_toggle/toggle')
      .send({ isActive: false })
      .expect(201);

    expect(res.body).toEqual({ success: true, isActive: false });
    expect(prismaMock.webhooks[0].isActive).toBe(false);
  });

  it('returns an error when toggling a webhook owned by another business', async () => {
    prismaMock.webhooks.push({
      id: 'wh_other',
      businessId: 'biz_other',
      url: 'https://example.com/hook',
      events: ['invoice.paid'],
      name: 'Other',
      secret: 'secret',
      isActive: true,
      createdAt: new Date(),
    });

    const res = await request(app.getHttpServer())
      .post('/webhooks/businesses/biz_1/webhooks/wh_other/toggle')
      .send({ isActive: false })
      .expect(201);

    expect(res.body.error).toMatch(/not found/);
  });

  it('deletes a webhook scoped to the business', async () => {
    prismaMock.webhooks.push({
      id: 'wh_delete',
      businessId: 'biz_1',
      url: 'https://example.com/hook',
      events: ['invoice.paid'],
      name: 'Delete',
      secret: 'secret',
      isActive: true,
      createdAt: new Date(),
    });

    const res = await request(app.getHttpServer())
      .delete('/webhooks/businesses/biz_1/webhooks/wh_delete')
      .expect(200);
    expect(res.body).toEqual({ success: true });
    expect(prismaMock.webhooks).toHaveLength(0);
  });

  it('refuses to delete a webhook that does not belong to the business', async () => {
    prismaMock.webhooks.push({
      id: 'wh_other',
      businessId: 'biz_other',
      url: 'https://example.com/hook',
      events: ['invoice.paid'],
      name: 'Other',
      secret: 'secret',
      isActive: true,
      createdAt: new Date(),
    });

    const res = await request(app.getHttpServer())
      .delete('/webhooks/businesses/biz_1/webhooks/wh_other')
      .expect(200);
    expect(res.body.error).toMatch(/not found/);
    expect(prismaMock.webhooks).toHaveLength(1);
  });

  it('forwards test events and delivery log requests through the dispatcher', async () => {
    sendTestEvent.mockResolvedValue({ ok: true, statusCode: 200 });
    getDeliveryLogs.mockResolvedValue([{ id: 'log_1', status: 'success' }]);

    const testRes = await request(app.getHttpServer())
      .post('/webhooks/businesses/biz_1/webhooks/wh_1/test')
      .send({})
      .expect(201);
    expect(testRes.body).toEqual({ ok: true, statusCode: 200 });
    expect(sendTestEvent).toHaveBeenCalledWith('wh_1', 'biz_1');

    const logRes = await request(app.getHttpServer())
      .get('/webhooks/businesses/biz_1/webhooks/wh_1/deliveries?limit=25')
      .expect(200);
    expect(logRes.body).toEqual([{ id: 'log_1', status: 'success' }]);
    expect(getDeliveryLogs).toHaveBeenCalledWith('biz_1', 'wh_1', 25);
  });
});
