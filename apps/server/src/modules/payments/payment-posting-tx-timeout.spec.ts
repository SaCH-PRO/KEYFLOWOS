/**
 * W11-LOAD-SENSITIVE-TESTS (MR-02 / MR-03 production fix):
 * `PaymentsService`'s interactive payment and refund posting transactions
 * (`createPaymentWithPosting`, `createRefundWithPosting` via
 * `processStripeRefund`, and `createRefundWithPostingByInvoice`) lock the
 * invoice row, record the Payment row, and post/reverse ledger entries inside
 * one interactive Prisma `$transaction`. Leaving `$transaction` on Prisma's
 * 5 s default aborts genuine refunds and settlements under load
 * (`P2028 Transaction already closed`), unlike `CommerceService.recordPayment`
 * (`RECORD_PAYMENT_TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 }`).
 */
import { createHmac } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { PaymentsService } from './payments.service';

const EXPECTED_TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };
const PLATFORM_SECRET = 'whsec_test_tx_timeout_platform';

function signStripe(raw: string, secret = PLATFORM_SECRET): string {
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return `t=${t},v1=${sig}`;
}

async function withPlatformSecret<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = PLATFORM_SECRET;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = prev;
  }
}

function buildHarness() {
  const originalPayment = {
    id: 'pay_orig_1',
    providerPaymentId: 'pi_orig_1',
    invoiceId: 'inv_1',
    businessId: 'biz_1',
    currency: 'TTD',
    amount: 100,
  };

  const tx = {
    $queryRaw: vi.fn(async () => [{ id: 'inv_1' }]),
    invoice: {
      findUnique: vi.fn(async () => ({ id: 'inv_1', status: 'SENT', businessId: 'biz_1', currency: 'TTD', total: 100 })),
    },
    payment: {
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => originalPayment),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'pay_created_1', ...data })),
    },
  };

  const $transaction = vi.fn(async (cb: (client: typeof tx) => Promise<unknown>, _opts?: unknown) => cb(tx));

  const prisma = {
    client: {
      $transaction,
      invoice: {
        findUnique: vi.fn(async () => ({
          id: 'inv_1',
          invoiceNumber: 'INV-001',
          status: 'SENT',
          businessId: 'biz_1',
          currency: 'TTD',
          total: 100,
          contactId: 'contact_1',
        })),
      },
      business: {
        findUnique: vi.fn(async () => ({ id: 'biz_1', metaData: {} })),
      },
      payment: {
        findUnique: vi.fn(async () => null),
        findFirst: vi.fn(async ({ where }: { where?: Record<string, unknown> }) => {
          // Cross-tenant ambiguity check excludes original.businessId.
          if (where?.businessId && typeof where.businessId === 'object' && 'not' in where.businessId) return null;
          return originalPayment;
        }),
        findMany: vi.fn(async () => []),
      },
    },
  };

  const invoiceWorkflow = {
    assertNewProviderEvent: vi.fn(async () => true),
    releaseProviderEventClaim: vi.fn(async () => undefined),
    reconcileFromPayments: vi.fn(async () => ({ status: 'PAID', balance: 0 })),
  };

  const revenuePosting = {
    onPaymentRecorded: vi.fn(async () => ({ transactionId: 'ft_pay_1' })),
    onPaymentRefunded: vi.fn(async () => ({ transactionId: 'ft_ref_1' })),
  };

  const service = new PaymentsService(
    prisma as never,
    {} as never,
    invoiceWorkflow as never,
    revenuePosting as never,
  );

  return { service, $transaction, tx, revenuePosting };
}

describe('PaymentsService interactive transaction timeouts (W11-LOAD-SENSITIVE-TESTS)', () => {
  it('processStripeRefund passes explicit maxWait and timeout options to $transaction', async () => {
    const { service, $transaction, revenuePosting } = buildHarness();
    const raw = JSON.stringify({
      id: 'evt_refund_tx_1',
      type: 'refund.created',
      data: {
        object: {
          id: 're_tx_1',
          amount: 4000,
          currency: 'ttd',
          charge: 'ch_orig_1',
          payment_intent: 'pi_orig_1',
          status: 'succeeded',
          metadata: { invoiceId: 'inv_1' },
        },
      },
    });

    const ack = await withPlatformSecret(() => service.handleStripeWebhook(raw, signStripe(raw)));
    expect(ack).toEqual({ ok: true, received: true, processed: 'refund.created' });
    expect(revenuePosting.onPaymentRefunded).toHaveBeenCalledTimes(1);
    expect($transaction).toHaveBeenCalledTimes(1);
    expect($transaction.mock.calls[0][1]).toEqual(EXPECTED_TX_OPTIONS);
  });

  it('payment_intent.succeeded (createPaymentWithPosting) passes explicit maxWait and timeout options to $transaction', async () => {
    const { service, $transaction, revenuePosting } = buildHarness();
    const raw = JSON.stringify({
      id: 'evt_pi_tx_1',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_new_1',
          amount_received: 10000,
          currency: 'ttd',
          latest_charge: 'ch_new_1',
          metadata: { invoiceId: 'inv_1', businessId: 'biz_1' },
        },
      },
    });

    const ack = await withPlatformSecret(() => service.handleStripeWebhook(raw, signStripe(raw)));
    expect(ack).toEqual({ ok: true, received: true, processed: 'payment_intent.succeeded' });
    expect(revenuePosting.onPaymentRecorded).toHaveBeenCalledTimes(1);
    expect($transaction).toHaveBeenCalledTimes(1);
    expect($transaction.mock.calls[0][1]).toEqual(EXPECTED_TX_OPTIONS);
  });

  it('createRefundWithPostingByInvoice passes explicit maxWait and timeout options to $transaction', async () => {
    const { service, $transaction, revenuePosting } = buildHarness();
    const created = await (
      service as unknown as {
        createRefundWithPostingByInvoice: (
          invoice: { invoiceId: string; businessId: string },
          refund: { provider: string; providerPaymentId: string; currency: string; notes: string | null },
          requested: number,
        ) => Promise<unknown>;
      }
    ).createRefundWithPostingByInvoice(
      { invoiceId: 'inv_1', businessId: 'biz_1' },
      { provider: 'paypal', providerPaymentId: 'pp_ref_tx_1', currency: 'TTD', notes: null },
      40,
    );

    expect(created).toMatchObject({ providerPaymentId: 'pp_ref_tx_1', status: 'REFUNDED', amount: -40 });
    expect(revenuePosting.onPaymentRefunded).toHaveBeenCalledTimes(1);
    expect($transaction).toHaveBeenCalledTimes(1);
    expect($transaction.mock.calls[0][1]).toEqual(EXPECTED_TX_OPTIONS);
  });
});
