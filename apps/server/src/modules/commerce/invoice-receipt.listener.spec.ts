/**
 * V1-49-PUBLIC-RECEIPT (M24): the auto-receipt email on `invoice.paid` states
 * what was actually received.
 *
 * At the V1-48 head the listener built the receipt with
 * `amountPaid: paid || Number(invoice.total)` and `amountRemaining: 0`
 * (invoice-receipt.listener.ts:82-83), whatever the invoice's rows said: an
 * invoice read back PARTIALLY_PAID (a refund reopened it before the listener
 * ran), a PAID invoice whose rows fall short of the total, or a PAID invoice
 * with no payment row at all each got a receipt claiming full settlement.
 *
 * Contract pinned here:
 *   - the figures are computeBalance's paid / remaining over the invoice's own
 *     tenant's Payment rows (M31: a row tagged with another businessId is not
 *     this invoice's money);
 *   - a receipt is sent only when the invoice is PAID and nothing remains;
 *     otherwise nothing is sent and no receipt is logged (no "remaining 0"
 *     receipt for a partial);
 *   - the settled path is unchanged: one email, one recordReceiptSent, the
 *     link fallback as before.
 *
 * CommerceService and GmailService are stubs; the email template is the real
 * one, wrapped in a spy so the figures handed to it can be read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./invoice-email.template', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./invoice-email.template')>();
  return { ...actual, buildInvoiceEmailHtml: vi.fn(actual.buildInvoiceEmailHtml) };
});

import { buildInvoiceEmailHtml } from './invoice-email.template';
import { InvoiceReceiptListener } from './invoice-receipt.listener';

const BIZ = 'biz_v49_listener';
const OTHER_BIZ = 'biz_v49_other';

type Row = { amount: number; status: string; businessId?: string };

function invoice(status: string, total: number, payments: Row[]) {
  return {
    id: 'inv_v49_1',
    businessId: BIZ,
    contactId: 'contact_1',
    invoiceNumber: 'INV-0049',
    status,
    total,
    subtotal: total,
    currency: 'TTD',
    notes: null,
    issueDate: '2026-10-01T00:00:00.000Z',
    dueDate: null,
    contact: { firstName: 'Ada', lastName: 'Customer', email: 'ada@customer.example' },
    business: { name: 'Harbour Studio', logoUrl: null, email: 'hello@harbour.example', phone: null, primaryColor: '#F97316' },
    items: [{ description: 'Consulting', quantity: 1, unitPrice: total }],
    payments: payments.map((p) => ({ businessId: BIZ, ...p })),
  };
}

function setup(inv: ReturnType<typeof invoice> | null, opts: { link?: { token: string } | null; createRefusal?: boolean } = {}) {
  const commerce = {
    getInvoiceWithBusiness: vi.fn(async () => inv),
    findAnyPaymentLink: vi.fn(async () => (opts.link === undefined ? { token: 'tok_v49_link' } : opts.link)),
    createPaymentLink: vi.fn(async () => {
      if (opts.createRefusal) throw new Error('Cannot create payment link for a paid or voided invoice');
      return { token: 'tok_v49_new' };
    }),
    recordReceiptSent: vi.fn(async () => undefined),
  };
  const gmail = { sendEmail: vi.fn(async () => ({ messageId: 'msg_v49' })) };
  const listener = new InvoiceReceiptListener(commerce as any, gmail as any);
  const fire = () => listener.onInvoicePaid({ invoice: { id: 'inv_v49_1' }, businessId: BIZ });
  return { commerce, gmail, fire };
}

/** The figures the listener handed to the email template on its last call. */
function templateArgs() {
  const calls = vi.mocked(buildInvoiceEmailHtml).mock.calls;
  return calls[calls.length - 1]?.[0];
}

beforeEach(() => {
  vi.mocked(buildInvoiceEmailHtml).mockClear();
});

describe('settled: the receipt carries the received amount (V1-49)', () => {
  it('RL-01: PAID 100 of 100 (60 + 40) sends one receipt with amountPaid 100 and amountRemaining 0, and logs it once', async () => {
    const { commerce, gmail, fire } = setup(invoice('PAID', 100, [{ amount: 60, status: 'SUCCESSFUL' }, { amount: 40, status: 'SUCCESSFUL' }]));
    await fire();
    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
    expect(templateArgs()).toMatchObject({ variant: 'receipt', total: 100, amountPaid: 100, amountRemaining: 0 });
    const html = (gmail.sendEmail.mock.calls[0] as any[])[0].htmlBody as string;
    expect(html).toContain('received your payment of TT$100.00');
    expect(commerce.recordReceiptSent).toHaveBeenCalledTimes(1);
    expect(commerce.recordReceiptSent).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: 'inv_v49_1', businessId: BIZ, channel: 'email', recipientEmail: 'ada@customer.example', messageId: 'msg_v49' }),
    );
  });

  it('RL-02 control: the link fallback is unchanged (a PAID invoice with no link: createPaymentLink refuses, the receipt still goes with no invoice URL)', async () => {
    const { commerce, gmail, fire } = setup(invoice('PAID', 100, [{ amount: 100, status: 'SUCCESSFUL' }]), { link: null, createRefusal: true });
    await fire();
    expect(commerce.createPaymentLink).toHaveBeenCalledTimes(1);
    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
    expect(templateArgs()).toMatchObject({ amountPaid: 100, amountRemaining: 0, invoiceUrl: null, paymentUrl: null });
  });

  it('RL-03: an over-payment (120 on 100) is stated as received, with nothing remaining', async () => {
    const { gmail, fire } = setup(invoice('PAID', 100, [{ amount: 120, status: 'SUCCESSFUL' }]));
    await fire();
    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
    expect(templateArgs()).toMatchObject({ amountPaid: 120, amountRemaining: 0 });
  });
});

describe('no "remaining 0" receipt for a partial state (V1-49, M24)', () => {
  it('RL-04: the invoice reads back PARTIALLY_PAID 40 of 100 when invoice.paid is handled: no email and no receipt logged', async () => {
    const { commerce, gmail, fire } = setup(invoice('PARTIALLY_PAID', 100, [{ amount: 40, status: 'SUCCESSFUL' }]));
    await fire();
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(commerce.recordReceiptSent).not.toHaveBeenCalled();
  });

  it('RL-05: a PAID invoice whose own rows cover 40 of 100 gets no receipt (never "paid in full" with 60 owed)', async () => {
    const { commerce, gmail, fire } = setup(invoice('PAID', 100, [{ amount: 40, status: 'SUCCESSFUL' }, { amount: 60, status: 'PENDING' }]));
    await fire();
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(commerce.recordReceiptSent).not.toHaveBeenCalled();
  });

  it('RL-06: a PAID invoice with no payment row at all gets no receipt claiming the total was received', async () => {
    const { commerce, gmail, fire } = setup(invoice('PAID', 100, []));
    await fire();
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(commerce.recordReceiptSent).not.toHaveBeenCalled();
  });

  it("RL-07 TENANT (M31): a SUCCESSFUL row tagged with another tenant does not settle the invoice: 60 own + 40 foreign on 100 sends nothing", async () => {
    const { gmail, fire } = setup(
      invoice('PAID', 100, [
        { amount: 60, status: 'SUCCESSFUL' },
        { amount: 40, status: 'SUCCESSFUL', businessId: OTHER_BIZ },
      ]),
    );
    await fire();
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it('RL-08: a skipped receipt mints no payment link either (nothing is written for a receipt that is not sent)', async () => {
    const { commerce, fire } = setup(invoice('PARTIALLY_PAID', 100, [{ amount: 40, status: 'SUCCESSFUL' }]), { link: null });
    await fire();
    expect(commerce.findAnyPaymentLink).not.toHaveBeenCalled();
    expect(commerce.createPaymentLink).not.toHaveBeenCalled();
  });

  it('RL-09 (review SEC-V49-2): a PAID invoice whose only payment was refunded (deriveStatusAfterPayment leaves it PAID) gets no receipt', async () => {
    const { commerce, gmail, fire } = setup(invoice('PAID', 100, [{ amount: 100, status: 'REFUNDED' }]));
    await fire();
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(commerce.recordReceiptSent).not.toHaveBeenCalled();
  });
});
