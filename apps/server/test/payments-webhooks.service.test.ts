import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { CommerceService } from '../src/modules/commerce/commerce.service';
import { InvoiceWorkflowService } from '../src/modules/commerce/invoice-workflow.service';

function makeWorkflowMock(prisma?: PrismaMock): {
  workflow: InvoiceWorkflowService;
  seen: Set<string>;
  reconcile: ReturnType<typeof vi.fn>;
  transition: ReturnType<typeof vi.fn>;
} {
  const seen = new Set<string>();
  const reconcile = vi.fn(async (invoiceId: string) => {
    return { status: 'PAID' as const, balance: { remaining: 0 }, changed: true };
  });
  const transition = vi.fn(async () => undefined);
  const workflow = {
    assertNewProviderEvent: vi.fn(async (provider: string, eventId?: string) => {
      if (!eventId) return true;
      const key = `${provider}:${eventId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    transition,
    reconcileFromPayments: reconcile,
    getBalance: vi.fn(),
    assertLegalTransition: vi.fn(),
  } as unknown as InvoiceWorkflowService;
  return { workflow, seen, reconcile, transition };
}

class PrismaMock {
  invoices = new Map<string, any>([
    ['inv_1', { id: 'inv_1', businessId: 'biz_1', status: 'SENT', total: 50, currency: 'USD' }],
  ]);
  payments: any[] = [];

  businesses = new Map<string, any>();

  client: any = {
    $transaction: vi.fn(async (fn: any) => fn(this.client)),
    invoice: {
      findUnique: vi.fn(async ({ where }: any) => this.invoices.get(where.id) ?? null),
    },
    business: {
      findUnique: vi.fn(async ({ where }: any) => this.businesses.get(where.id) ?? null),
    },
    payment: {
      findUnique: vi.fn(async ({ where }: any) =>
        this.payments.find((p) => p.providerPaymentId === where.providerPaymentId) ?? null,
      ),
      findFirst: vi.fn(async ({ where }: any) => {
        const matchValue = (rowVal: any, cond: any): boolean => {
          if (cond && typeof cond === 'object' && 'in' in cond) {
            return (cond.in as any[]).includes(rowVal);
          }
          return rowVal === cond;
        };
        return this.payments.find((p) => {
          if (where.provider && p.provider !== where.provider) return false;
          if (where.status && p.status !== where.status) return false;
          if (where.invoiceId && p.invoiceId !== where.invoiceId) return false;
          if (where.providerPaymentId && !matchValue(p.providerPaymentId, where.providerPaymentId)) return false;
          if (where.OR) {
            return (where.OR as any[]).some((cond) =>
              Object.entries(cond).every(([k, v]) => matchValue((p as any)[k], v)),
            );
          }
          return true;
        }) ?? null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `pay_${this.payments.length + 1}`, ...data };
        this.payments.push(row);
        return row;
      }),
    },
  };
}

function stripeSig(payload: string, secret: string): string {
  const t = Math.floor(Date.now() / 1000).toString();
  const sig = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${sig}`;
}

describe('PaymentsService Stripe webhooks', () => {
  let prisma: PrismaMock;
  let commerce: { markInvoicePaid: ReturnType<typeof vi.fn> };
  let svc: PaymentsService;
  let workflowSeen: Set<string>;
  let reconcile: ReturnType<typeof vi.fn>;
  const SECRET = 'whsec_test';

  beforeEach(() => {
    prisma = new PrismaMock();
    commerce = { markInvoicePaid: vi.fn(async () => undefined) };
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    const wf = makeWorkflowMock();
    workflowSeen = wf.seen;
    reconcile = wf.reconcile;
    svc = new PaymentsService(
      prisma as unknown as PrismaService,
      commerce as unknown as CommerceService,
      wf.workflow,
      {
        onPaymentRecorded: vi.fn(),
        onPaymentRefunded: vi.fn(),
        onInvoiceFinalized: vi.fn(),
        onInvoiceVoided: vi.fn(),
      } as any,
    );
  });

  it('rejects bad signature', async () => {
    const payload = JSON.stringify({ type: 'charge.succeeded', data: { object: {} } });
    await expect(svc.handleStripeWebhook(payload, 't=1,v1=deadbeef')).rejects.toThrow(/signature/i);
  });

  it('persists payment on checkout.session.completed', async () => {
    const obj = {
      id: 'cs_test_1',
      amount_total: 5000,
      currency: 'usd',
      metadata: { invoiceId: 'inv_1' },
    };
    const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: obj } });
    const res = await svc.handleStripeWebhook(payload, stripeSig(payload, SECRET));
    expect(res.processed).toBe('checkout.session.completed');
    expect(prisma.payments).toHaveLength(1);
    expect(prisma.payments[0]).toMatchObject({
      provider: 'stripe',
      providerPaymentId: 'cs_test_1',
      status: 'SUCCESSFUL',
      amount: 50,
      invoiceId: 'inv_1',
    });
    expect(reconcile).toHaveBeenCalledWith('inv_1');
  });

  it('is idempotent on duplicate charge.succeeded', async () => {
    const obj = { id: 'ch_test_1', amount: 5000, currency: 'usd', metadata: { invoiceId: 'inv_1' } };
    const payload = JSON.stringify({ type: 'charge.succeeded', data: { object: obj } });
    await svc.handleStripeWebhook(payload, stripeSig(payload, SECRET));
    await svc.handleStripeWebhook(payload, stripeSig(payload, SECRET));
    expect(prisma.payments).toHaveLength(1);
  });

  it('replayed webhook with the same event id is a no-op (dedup table catches it)', async () => {
    const obj = {
      id: 'cs_replay_1',
      amount_total: 5000,
      currency: 'usd',
      metadata: { invoiceId: 'inv_1' },
    };
    const payload = JSON.stringify({
      id: 'evt_replay_1',
      type: 'checkout.session.completed',
      data: { object: obj },
    });
    const sig = stripeSig(payload, SECRET);
    await svc.handleStripeWebhook(payload, sig);
    expect(prisma.payments).toHaveLength(1);
    expect(reconcile).toHaveBeenCalledTimes(1);

    // Replay: dedup short-circuits before any side-effect runs.
    await svc.handleStripeWebhook(payload, sig);
    expect(prisma.payments).toHaveLength(1);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(workflowSeen.has('stripe:evt_replay_1')).toBe(true);
  });

  it('accumulates partial payments — second successful charge does NOT short-circuit', async () => {
    // Bumping invoice total so partials are well-defined: 100 USD invoice,
    // two 50 USD captures arrive on different Stripe events. Both must be
    // recorded; reconcile is invoked twice so the workflow can flip the
    // invoice from SENT -> PARTIALLY_PAID -> PAID. This guards against the
    // "first payment wins, ignore the rest" regression.
    prisma.invoices.set('inv_1', {
      id: 'inv_1', businessId: 'biz_1', status: 'SENT', total: 100, currency: 'USD',
    });
    const mk = (id: string) => JSON.stringify({
      id: `evt_${id}`,
      type: 'charge.succeeded',
      data: { object: { id, amount: 5000, currency: 'usd', metadata: { invoiceId: 'inv_1' } } },
    });
    const p1 = mk('ch_partial_1');
    const p2 = mk('ch_partial_2');
    await svc.handleStripeWebhook(p1, stripeSig(p1, SECRET));
    await svc.handleStripeWebhook(p2, stripeSig(p2, SECRET));
    expect(prisma.payments).toHaveLength(2);
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it('createStripeCheckout rejects DRAFT invoices (DRAFT->PAID is illegal)', async () => {
    prisma.invoices.set('inv_draft', {
      id: 'inv_draft', businessId: 'biz_1', status: 'DRAFT', total: 50, currency: 'USD',
      contact: { email: 'x@y.z' },
      business: { id: 'biz_1', name: 'b', metaData: { stripeSecretKey: 'sk_test' } },
    });
    await expect(
      svc.createStripeCheckout('inv_draft', 'https://example.com/ok', 'https://example.com/cancel'),
    ).rejects.toThrow(/draft/i);
  });

  it('records refund on charge.refunded with negative amount', async () => {
    // Seed an existing successful charge
    prisma.payments.push({
      id: 'pay_seed',
      provider: 'stripe',
      providerPaymentId: 'ch_test_2',
      amount: 50,
      currency: 'USD',
      status: 'SUCCESSFUL',
      invoiceId: 'inv_1',
      businessId: 'biz_1',
    });
    const obj = {
      id: 'ch_test_2',
      amount: 5000,
      amount_refunded: 5000,
      currency: 'usd',
      refunds: { data: [{ id: 're_test_1', amount: 5000, currency: 'usd', charge: 'ch_test_2', status: 'succeeded' }] },
    };
    const payload = JSON.stringify({ type: 'charge.refunded', data: { object: obj } });
    const res = await svc.handleStripeWebhook(payload, stripeSig(payload, SECRET));
    expect(res.processed).toBe('charge.refunded');
    const refund = prisma.payments.find((p) => p.providerPaymentId === 're_test_1');
    expect(refund).toBeDefined();
    expect(refund.status).toBe('REFUNDED');
    expect(refund.amount).toBe(-50);
    expect(refund.invoiceId).toBe('inv_1');
  });

  it('links refund to original even when checkout.session.completed arrived first', async () => {
    // Order: session.completed -> charge.refunded.
    // session.completed stores a row keyed by `cs_xxx` with payment_intent
    // (`pi_xxx`) stashed in `reference`. The refund event's `refund.charge`
    // is `ch_xxx` (which we never saw), but the wrapping Charge object
    // carries `payment_intent`, so the refund must still link via that.
    const sessionObj = {
      id: 'cs_order_1',
      amount_total: 5000,
      currency: 'usd',
      payment_intent: 'pi_order_1',
      metadata: { invoiceId: 'inv_1' },
    };
    const sessionPayload = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: sessionObj },
    });
    await svc.handleStripeWebhook(sessionPayload, stripeSig(sessionPayload, SECRET));
    expect(prisma.payments).toHaveLength(1);
    expect(prisma.payments[0].providerPaymentId).toBe('cs_order_1');
    expect(prisma.payments[0].reference).toBe('pi_order_1');

    const chargeObj = {
      id: 'ch_order_1',
      amount: 5000,
      amount_refunded: 5000,
      currency: 'usd',
      payment_intent: 'pi_order_1',
      refunds: {
        data: [
          {
            id: 're_order_1',
            amount: 5000,
            currency: 'usd',
            charge: 'ch_order_1',
            payment_intent: 'pi_order_1',
            status: 'succeeded',
          },
        ],
      },
    };
    const refundPayload = JSON.stringify({ type: 'charge.refunded', data: { object: chargeObj } });
    const res = await svc.handleStripeWebhook(refundPayload, stripeSig(refundPayload, SECRET));
    expect(res.processed).toBe('charge.refunded');
    const refund = prisma.payments.find((p) => p.providerPaymentId === 're_order_1');
    expect(refund).toBeDefined();
    expect(refund.status).toBe('REFUNDED');
    expect(refund.amount).toBe(-50);
    expect(refund.invoiceId).toBe('inv_1');
  });

  it('acks unknown event types without persisting', async () => {
    const payload = JSON.stringify({ type: 'customer.created', data: { object: {} } });
    const res = await svc.handleStripeWebhook(payload, stripeSig(payload, SECRET));
    expect(res.received).toBe(true);
    expect(prisma.payments).toHaveLength(0);
  });
});

describe('PaymentsService PayPal webhooks', () => {
  let prisma: PrismaMock;
  let commerce: { markInvoicePaid: ReturnType<typeof vi.fn> };
  let svc: PaymentsService;

  beforeEach(() => {
    prisma = new PrismaMock();
    commerce = { markInvoicePaid: vi.fn(async () => undefined) };
    process.env.PAYPAL_WEBHOOK_ID = 'WH-TEST';
    process.env.PAYPAL_CLIENT_ID = 'cid';
    process.env.PAYPAL_CLIENT_SECRET = 'csec';
    svc = new PaymentsService(
      prisma as unknown as PrismaService,
      commerce as unknown as CommerceService,
      makeWorkflowMock().workflow,
      {
        onPaymentRecorded: vi.fn(),
        onPaymentRefunded: vi.fn(),
        onInvoiceFinalized: vi.fn(),
        onInvoiceVoided: vi.fn(),
      } as any,
    );
  });

  it('rejects when signature verification fails', async () => {
    // No PAYPAL_WEBHOOK_ID -> verification returns false
    delete process.env.PAYPAL_WEBHOOK_ID;
    const payload = JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {} });
    await expect(svc.handlePaypalWebhook(payload, {})).rejects.toThrow(/signature/i);
  });

  it('handles ORDER.COMPLETED + CAPTURE.COMPLETED dual events without duplicating', async () => {
    const verifySpy = vi
      .spyOn(svc as any, 'verifyPaypalSignature')
      .mockResolvedValue(true);

    const orderEvent = {
      event_type: 'CHECKOUT.ORDER.COMPLETED',
      resource: {
        id: 'ORDER_X',
        custom_id: 'inv_1',
        purchase_units: [
          {
            custom_id: 'inv_1',
            payments: {
              captures: [
                {
                  id: 'CAPT_X',
                  amount: { value: '50.00', currency_code: 'USD' },
                  custom_id: 'inv_1',
                },
              ],
            },
          },
        ],
      },
    };
    const r1 = await svc.handlePaypalWebhook(JSON.stringify(orderEvent), {});
    expect(r1.processed).toBe('CHECKOUT.ORDER.COMPLETED');
    expect(prisma.payments.filter((p) => p.provider === 'paypal')).toHaveLength(1);
    expect(prisma.payments[0].providerPaymentId).toBe('CAPT_X');

    const captureEvent = {
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        id: 'CAPT_X',
        custom_id: 'inv_1',
        amount: { value: '50.00', currency_code: 'USD' },
        supplementary_data: { related_ids: { order_id: 'ORDER_X' } },
      },
    };
    const r2 = await svc.handlePaypalWebhook(JSON.stringify(captureEvent), {});
    expect(r2.processed).toBe('PAYMENT.CAPTURE.COMPLETED');
    expect(prisma.payments.filter((p) => p.provider === 'paypal')).toHaveLength(1);

    const refundEvent = {
      event_type: 'PAYMENT.CAPTURE.REFUNDED',
      resource: {
        id: 'REFUND_X',
        amount: { value: '50.00', currency_code: 'USD' },
        supplementary_data: { related_ids: { capture_id: 'CAPT_X' } },
      },
    };
    const r3 = await svc.handlePaypalWebhook(JSON.stringify(refundEvent), {});
    expect(r3.processed).toBe('PAYMENT.CAPTURE.REFUNDED');
    const refund = prisma.payments.find((p) => p.providerPaymentId === 'REFUND_X');
    expect(refund).toBeDefined();
    expect(refund.amount).toBe(-50);
    expect(refund.invoiceId).toBe('inv_1');

    verifySpy.mockRestore();
  });

  it('uses per-business PayPal credentials when available', async () => {
    prisma.businesses.set('biz_1', {
      id: 'biz_1',
      metaData: {
        paypalClientId: 'biz_cid',
        paypalClientSecret: 'biz_sec',
        paypalWebhookId: 'WH-BIZ',
      },
    });

    let observedCreds: any = null;
    const verifySpy = vi
      .spyOn(svc as any, 'verifyPaypalSignature')
      .mockImplementation(async (...args: any[]) => {
        observedCreds = args[3];
        return true;
      });

    const event = {
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        id: 'CAPT_BIZ',
        custom_id: 'inv_1',
        amount: { value: '50.00', currency_code: 'USD' },
      },
    };
    await svc.handlePaypalWebhook(JSON.stringify(event), {});
    expect(observedCreds).toMatchObject({
      clientId: 'biz_cid',
      clientSecret: 'biz_sec',
      webhookId: 'WH-BIZ',
    });

    verifySpy.mockRestore();
  });

  it('replayed PayPal webhook with same event id is a no-op', async () => {
    const verifySpy = vi.spyOn(svc as any, 'verifyPaypalSignature').mockResolvedValue(true);
    const event = {
      id: 'WH-EVT-REPLAY',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        id: 'CAPT_REPLAY',
        custom_id: 'inv_1',
        amount: { value: '50.00', currency_code: 'USD' },
      },
    };
    await svc.handlePaypalWebhook(JSON.stringify(event), {});
    expect(prisma.payments).toHaveLength(1);
    await svc.handlePaypalWebhook(JSON.stringify(event), {});
    expect(prisma.payments).toHaveLength(1);
    verifySpy.mockRestore();
  });

  it('records capture and refund when verifier passes (mocked)', async () => {
    // Bypass network verifier
    const verifySpy = vi
      .spyOn(svc as any, 'verifyPaypalSignature')
      .mockResolvedValue(true);

    const captureEvent = {
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        id: 'CAPT_1',
        custom_id: 'inv_1',
        amount: { value: '50.00', currency_code: 'USD' },
        supplementary_data: { related_ids: { order_id: 'ORDER_1' } },
      },
    };
    const r1 = await svc.handlePaypalWebhook(JSON.stringify(captureEvent), {});
    expect(r1.processed).toBe('PAYMENT.CAPTURE.COMPLETED');
    expect(prisma.payments).toHaveLength(1);
    expect(prisma.payments[0]).toMatchObject({
      provider: 'paypal',
      providerPaymentId: 'CAPT_1',
      status: 'SUCCESSFUL',
      invoiceId: 'inv_1',
      amount: 50,
    });
    const refundEvent = {
      event_type: 'PAYMENT.CAPTURE.REFUNDED',
      resource: {
        id: 'REFUND_1',
        amount: { value: '50.00', currency_code: 'USD' },
        supplementary_data: { related_ids: { capture_id: 'CAPT_1' } },
      },
    };
    const r2 = await svc.handlePaypalWebhook(JSON.stringify(refundEvent), {});
    expect(r2.processed).toBe('PAYMENT.CAPTURE.REFUNDED');
    const refund = prisma.payments.find((p) => p.providerPaymentId === 'REFUND_1');
    expect(refund).toBeDefined();
    expect(refund.amount).toBe(-50);
    expect(refund.status).toBe('REFUNDED');
    expect(refund.invoiceId).toBe('inv_1');

    verifySpy.mockRestore();
  });
});
