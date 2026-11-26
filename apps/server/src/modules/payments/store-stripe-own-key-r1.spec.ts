import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

function makeService(prismaClient: Record<string, any>, storeOrderService?: any) {
  const prisma = { client: prismaClient } as any;
  const invoiceWorkflow = { reconcileFromPayments: vi.fn().mockResolvedValue(undefined) } as any;
  const postingService = { post: vi.fn().mockResolvedValue(undefined) } as any;
  return new PaymentsService(
    prisma,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    invoiceWorkflow,
    undefined,
    postingService,
    storeOrderService,
  );
}

describe('W1F-STORE-STRIPE-R0 (P128 R1 regressions)', () => {
  it('[SEC-W1FS-1] bindStripeRefundEvent propagates DB errors from marketplaceOrder.findUnique and payment.findMany (never fails open)', async () => {
    const dbErr = new Error('transient connection reset');
    const svc1 = makeService({
      marketplaceOrder: { findUnique: vi.fn().mockRejectedValue(dbErr) },
      payment: { findMany: vi.fn().mockResolvedValue([]) },
    });
    await expect(
      (svc1 as any).bindStripeRefundEvent(
        { id: 'evt_r1_1', type: 'charge.refunded', data: { object: { id: 'ch_1', metadata: { orderId: 'ord_1' } } } },
        null,
        'stripe-refused',
      ),
    ).rejects.toThrow('transient connection reset');

    const svc2 = makeService({
      marketplaceOrder: { findUnique: vi.fn().mockResolvedValue(null) },
      payment: { findMany: vi.fn().mockRejectedValue(dbErr) },
    });
    await expect(
      (svc2 as any).bindStripeRefundEvent(
        { id: 'evt_r1_2', type: 'charge.refunded', data: { object: { id: 'ch_2', payment_intent: 'pi_2' } } },
        null,
        'stripe-refused',
      ),
    ).rejects.toThrow('transient connection reset');
  });

  it('[SEC-W1FS-1] processStripeRefund propagates DB error from stripeStorefrontSettlementOf instead of bypassing D-196 or split-braining order/invoice', async () => {
    const dbErr = new Error('db read timeout');
    const svc = makeService({
      payment: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'pay_1',
          providerPaymentId: 'cs_1',
          invoiceId: 'inv_1',
          businessId: 'biz_store',
          currency: 'USD',
          amount: 100,
        }),
      },
      invoice: {
        findUnique: vi.fn().mockResolvedValue({ businessId: 'biz_store', invoiceNumber: 'INV-ORD-1' }),
      },
      marketplaceOrder: {
        findUnique: vi.fn().mockRejectedValue(dbErr),
      },
    });
    await expect(
      (svc as any).processStripeRefund(
        'charge.refunded',
        { id: 'ch_1', payment_intent: 'pi_1', amount_refunded: 10000, currency: 'usd', refunds: { data: [{ id: 're_1', amount: 10000, currency: 'usd' }] } },
        'biz_store',
      ),
    ).rejects.toThrow('db read timeout');
  });

  it('[COR-W1FS-2] processStripeRefund throws fail-closed when store settlement has no storeOrderService (prevents invoice/order split-brain)', async () => {
    const svc = makeService(
      {
        payment: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'pay_2',
            providerPaymentId: 'cs_2',
            invoiceId: 'inv_2',
            businessId: 'biz_store',
            currency: 'USD',
            amount: 100,
          }),
        },
        invoice: {
          findUnique: vi.fn().mockResolvedValue({ businessId: 'biz_store', invoiceNumber: 'INV-ORD-2' }),
        },
        marketplaceOrder: {
          findUnique: vi.fn().mockResolvedValue({ id: 'ord_2', businessId: 'biz_store', paymentRef: 'cs_2' }),
        },
      },
      undefined, // storeOrderService unavailable
    );
    await expect(
      (svc as any).processStripeRefund(
        'charge.refunded',
        { id: 'ch_2', payment_intent: 'pi_2', amount_refunded: 10000, currency: 'usd', refunds: { data: [{ id: 're_2', amount: 10000, currency: 'usd' }] } },
        'biz_store',
      ),
    ).rejects.toThrow(/store orders are unavailable/);
  });

  it('[COR-W1FS-NB1] out-of-order store-signed charge.refunded on an unsettled store order throws ConflictException to release claim for retry', async () => {
    const svc = makeService({
      payment: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      invoice: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      marketplaceOrder: {
        findFirst: vi.fn().mockResolvedValue({ orderNumber: 'ORD-UNSETTLED', paymentRef: null }),
      },
    });
    await expect(
      (svc as any).processStripeRefund(
        'charge.refunded',
        {
          id: 'ch_early',
          payment_intent: 'pi_early',
          amount_refunded: 5000,
          currency: 'usd',
          metadata: { orderId: 'ord_unsettled' },
          refunds: { data: [{ id: 're_early', amount: 5000, currency: 'usd' }] },
        },
        'biz_store',
      ),
    ).rejects.toThrow(ConflictException);
  });
});
