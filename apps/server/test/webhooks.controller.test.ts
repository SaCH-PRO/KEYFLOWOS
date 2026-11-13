import { Test } from '@nestjs/testing';
import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('stripe', () => ({
  default: class Stripe {
    webhooks = {
      // R0-20b: the session KeyFlow's checkout creates names the invoice's business and carries its amount and currency.
      constructEvent: vi.fn().mockReturnValue({
        id: 'evt_1',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'sess_1',
            metadata: { invoiceId: 'inv_1', businessId: 'biz_1' },
            client_reference_id: null,
            amount_total: 25000,
            currency: 'usd',
          },
        },
      }),
    };
  },
}));
import { WebhooksController } from '../src/modules/webhooks/webhooks.controller';
import { CommerceService } from '../src/modules/commerce/commerce.service';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { WebhookDispatcherService } from '../src/modules/webhooks/webhook-dispatcher.service';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { BusinessGuard } from '../src/core/auth/business.guard';
import { StripeConnector } from '../src/core/connectors/implementations/stripe.connector';

interface BusinessAccess {
  businessId: string;
  ownerId?: string;
  memberIds?: string[];
}

class WebhooksPrismaMock {
  webhooks: any[] = [];
  invoices: any[] = [{ id: 'inv_1', businessId: 'biz_1', total: 250, currency: 'USD' }];
  // R0-20b review (CR-R020B-2): the payment the Stripe ledger door records for sess_1.
  payments: any[] = [
    { providerPaymentId: 'sess_1', invoiceId: 'inv_1', businessId: 'biz_1', provider: 'stripe', status: 'SUCCESSFUL', amount: 250, currency: 'USD' },
  ];
  // R0-20b review (SEC-R020B-3); R0-20d: the route keeps no refusal row itself (the door binding keeps it).
  webhookEvents: any[] = [];
  businessAccess: BusinessAccess[] = [{ businessId: 'biz_1', ownerId: 'user_1', memberIds: ['user_1'] }];
  client: any;

  constructor() {
    const self = this;
    self.client = {
      webhook: {
        findMany: vi.fn(({ where, orderBy, select }: any) => {
          let rows = self.webhooks.filter((w) => w.businessId === where.businessId);
          if (orderBy?.createdAt === 'desc') {
            rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          }
          // SWEEP-P0-SCOPES (BUG-001): the list selects its fields (no signing secret).
          if (select) rows = rows.map((r) => Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, r[k]])));
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
      marketplaceOrder: {
        findUnique: vi.fn(() => Promise.resolve(null)),
      },
      payment: {
        findUnique: vi.fn(({ where }: any) =>
          Promise.resolve(self.payments.find((p) => p.providerPaymentId === where.providerPaymentId) ?? null),
        ),
      },
      webhookEvent: {
        create: vi.fn(({ data }: any) => {
          self.webhookEvents.push(data);
          return Promise.resolve({ id: `we_${self.webhookEvents.length}`, ...data });
        }),
      },
      // SWEEP-P0-SCOPES (BUG-001): ModuleScopeGuard reads the caller's membership (settings scope);
      // every member here is an OWNER with no explicit map (settings admin by role default).
      membership: {
        findUnique: vi.fn(({ where }: any) => {
          const { userId, businessId } = where?.userId_businessId ?? {};
          const access = self.businessAccess.find((b) => b.businessId === businessId);
          return Promise.resolve(access?.memberIds?.includes(userId) ? { userId, businessId, role: 'OWNER', permissionScopes: null } : null);
        }),
      },
      business: {
        // BusinessGuard's predicate { id, members: { some: { userId } } }:
        // owner ruling D-104 (W10-OWNER-MEMBERSHIP), a Membership is the one rule.
        findFirst: vi.fn(({ where }: any) => {
          const id: string = where?.id;
          const access = self.businessAccess.find((b) => b.businessId === id);
          if (!access) return Promise.resolve(null);
          const userId = where?.members?.some?.userId;
          return Promise.resolve(userId && access.memberIds?.includes(userId) ? { id } : null);
        }),
      },
    };
  }
}

describe('WebhooksController', () => {
  let app: INestApplication;
  let prismaMock: WebhooksPrismaMock;
  const markInvoicePaid = vi.fn().mockResolvedValue({ id: 'inv_1', status: 'PAID' });
  // R0-20b: the Stripe ledger door (what POST /payments/stripe/webhook runs).
  const handleStripeWebhook = vi.fn().mockResolvedValue({ ok: true, received: true, processed: 'checkout.session.completed' });
  const sendTestEvent = vi.fn();
  const getDeliveryLogs = vi.fn();
  // R0-20b review (CR-R020B-2): the Stripe connector's 'payment.received'.
  const emitPaymentReceived = vi.fn().mockResolvedValue(undefined);
  let controller: WebhooksController;
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
        { provide: PaymentsService, useValue: { handleStripeWebhook } },
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: WebhookDispatcherService,
          useValue: { sendTestEvent, getDeliveryLogs },
        },
        { provide: StripeConnector, useValue: { emitPaymentReceived } },
      ],
    }).compile();
    controller = moduleRef.get(WebhooksController);

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
    prismaMock.businessAccess = [{ businessId: 'biz_1', ownerId: 'user_1', memberIds: ['user_1'] }];
    markInvoicePaid.mockClear();
    handleStripeWebhook.mockClear();
    emitPaymentReceived.mockClear();
    prismaMock.webhookEvents = [];
    sendTestEvent.mockReset();
    getDeliveryLogs.mockReset();
  });

  it('handles stripe webhook and marks invoice paid', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('stripe-signature', 'test_sig')
      .send({ invoiceId: 'inv_1' })
      .expect(201);

    // R0-20b (D-05): the verified bytes and their signature go to the Stripe
    // ledger door, which records the payment; the anonymous, tenantless
    // markInvoicePaid(invoiceId) of the deprecated route is gone.
    expect(handleStripeWebhook).toHaveBeenCalledTimes(1);
    // R0-20d (W3-STRIPE-LEGACY-BINDING): the door binds the event and keeps a refusal under the legacy label.
    expect(handleStripeWebhook).toHaveBeenCalledWith(JSON.stringify({ invoiceId: 'inv_1' }), 'test_sig', { refusedProvider: 'stripe-legacy-refused' });
    expect(markInvoicePaid).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ received: true, processed: 'checkout.session.completed', deprecated: true, use: '/payments/stripe/webhook' });
  });

  it('R0-20b review (CR-R020B-2): emits the Stripe connector payment.received once, for the payment the door recorded, and not for a delivery the door did not process', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('stripe-signature', 'test_sig')
      .send({ invoiceId: 'inv_1' })
      .expect(201);
    expect(emitPaymentReceived).toHaveBeenCalledTimes(1);
    expect(emitPaymentReceived).toHaveBeenCalledWith('biz_1', { amount: 250, currency: 'USD', invoiceId: 'inv_1', externalId: 'sess_1' });

    // A redelivery (the door's claim already taken): acknowledged without `processed`, no second event.
    handleStripeWebhook.mockResolvedValueOnce({ ok: true, received: true });
    const again = await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('stripe-signature', 'test_sig')
      .send({ invoiceId: 'inv_1' })
      .expect(201);
    expect(again.body).not.toHaveProperty('processed');
    expect(emitPaymentReceived).toHaveBeenCalledTimes(1);
  });

  it('R0-20b review (SEC-R020B-3), R0-20d: the route keeps no binding of its own: a payment event the door binding refuses (it keeps the refusal under the legacy label stripe-legacy-refused) is answered 400 with no payment.received, and the route reads no invoice and writes no row itself', async () => {
    const constructEvent = (controller as unknown as { stripe: { webhooks: { constructEvent: ReturnType<typeof vi.fn> } } }).stripe.webhooks.constructEvent;
    constructEvent.mockReturnValueOnce({
      id: 'evt_foreign',
      type: 'checkout.session.completed',
      data: { object: { id: 'sess_foreign', metadata: { invoiceId: 'inv_1', businessId: 'biz_other' }, amount_total: 25000, currency: 'usd' } },
    });
    // The door's binding (PaymentsService.bindStripePaymentEvent) refuses it; the real refusal row is proven in
    // payments-mark-paid.integration.test.ts (MP-06c, MP-06d, MP-06h).
    handleStripeWebhook.mockRejectedValueOnce(new BadRequestException('Stripe event does not match the invoice'));
    const invoiceLookups = prismaMock.client.invoice.findUnique.mock.calls.length;
    const res = await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('stripe-signature', 'test_sig')
      .send({ invoiceId: 'inv_1' })
      .expect(400);
    expect(res.body.message).toMatch(/does not match the invoice/);
    expect(handleStripeWebhook).toHaveBeenCalledTimes(1);
    expect(handleStripeWebhook).toHaveBeenCalledWith(JSON.stringify({ invoiceId: 'inv_1' }), 'test_sig', { refusedProvider: 'stripe-legacy-refused' });
    expect(emitPaymentReceived).not.toHaveBeenCalled();
    expect(prismaMock.client.invoice.findUnique.mock.calls.length, 'the route binds nothing itself').toBe(invoiceLookups);
    expect(prismaMock.webhookEvents).toEqual([]);
  });

  it('rejects authenticated CRUD when no user is on the request', async () => {
    currentUserId = undefined;
    await request(app.getHttpServer())
      .get('/webhooks/businesses/biz_1/webhooks')
      .expect(401);
  });

  it('rejects CRUD when the user does not have access to the business', async () => {
    prismaMock.businessAccess = [{ businessId: 'biz_other', ownerId: 'user_1', memberIds: ['user_1'] }];
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
    // SWEEP-P0-SCOPES (BUG-001): no read answers a signing secret after creation.
    expect(res.body[0]).not.toHaveProperty('secret');
  });

  it('creates a webhook with a generated secret and selected events', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/businesses/biz_1/webhooks')
      // SWEEP-P0-SCOPES (BUG-001): the URL host is checked public (an IP literal: no DNS here; TEST-NET-3).
      .send({ url: 'https://203.0.113.10/hook', events: ['invoice.paid'], name: 'My Hook' })
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
      // SWEEP-P0-SCOPES (BUG-001): a refused URL is a 400 (it was a 201 carrying an `error`).
      .expect(400);
    expect(res.body.message).toMatch(/valid URL/);
    expect(prismaMock.webhooks).toHaveLength(0);
  });

  it('rejects creation when no events are selected', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/businesses/biz_1/webhooks')
      .send({ url: 'https://203.0.113.10/hook', events: [] })
      // SWEEP-P0-SCOPES (BUG-001): 400, nothing written.
      .expect(400);
    expect(res.body.message).toMatch(/At least one event/);
    expect(prismaMock.webhooks).toHaveLength(0);
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
