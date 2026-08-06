/**
 * The second version of a fix, reinstating the bug the first version fixed.
 *
 * `commerce_send_invoice` originally flipped the invoice to SENT, logged
 * "Invoice INV-001 sent to Ada", and called no mail service at all. That was
 * fixed by adding the send.
 *
 * The fix was wrong. TransactionalEmailService.send() reports failure by RETURN
 * VALUE — 'SENT' | 'QUEUED' | 'FAILED' — it does not throw. The handler awaited
 * it and discarded the result, so on every failure path execution fell straight
 * through to the status flip, the activity log and `emailedTo`. Identical
 * behaviour to the original defect, now with a mail call in the middle of it.
 *
 * And worse in one specific way. `send()` returns FAILED when the contact is
 * marked do-not-contact — a guard added to that service in the same session as
 * this handler. So KEY would refuse to email someone on compliance grounds and
 * then report that it had emailed them. A guard nobody reads is not a guard.
 *
 * The tests that shipped with the broken fix were readFileSync + string-index
 * assertions: "the handler mentions getTransactionalEmail", "send appears
 * before status: 'SENT'". Both were true of the broken code. Source order is
 * not control flow, and only running the thing can tell the difference.
 */
import { describe, it, expect, vi } from 'vitest';
import { FlowOrchestratorService } from './flow-orchestrator.service';

const BIZ = 'biz_1';

function makeOrchestrator(deliveryStatus: 'SENT' | 'QUEUED' | 'FAILED') {
  const send = vi.fn(async () => ({ status: deliveryStatus }));
  const updateInvoiceStatus = vi.fn(async () => ({ id: 'inv_1', status: 'SENT' }));
  const createActivity = vi.fn(async () => ({}));

  const orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    prisma: {
      client: {
        invoice: {
          findFirst: vi.fn(async () => ({
            id: 'inv_1',
            invoiceNumber: 'INV-001',
            total: 500,
            currency: 'TTD',
            contactId: 'con_1',
            contact: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
          })),
        },
      },
    },
    getTransactionalEmail: () => ({ send }),
    getCommerce: () => ({ updateInvoiceStatus }),
    getActivityLog: () => ({ createActivity }),
  });

  const run = () => (orchestrator as any).executeToolAction(BIZ, 'commerce_send_invoice', { invoiceId: 'inv_1' });
  return { run, send, updateInvoiceStatus, createActivity };
}

describe('a failed delivery is not reported as a send', () => {
  it('throws rather than returning success', async () => {
    const { run } = makeOrchestrator('FAILED');

    await expect(run()).rejects.toThrow(/was NOT emailed/);
  });

  it('does not flip the invoice to SENT', async () => {
    // The durable record. An invoice marked SENT is one nobody chases.
    const { run, updateInvoiceStatus } = makeOrchestrator('FAILED');

    await run().catch(() => undefined);

    expect(updateInvoiceStatus).not.toHaveBeenCalled();
  });

  it('does not write an activity log saying it was sent', async () => {
    const { run, createActivity } = makeOrchestrator('FAILED');

    await run().catch(() => undefined);

    expect(createActivity).not.toHaveBeenCalled();
  });

  it('names something a human can act on', async () => {
    // The three real causes — Gmail not connected, notifications disabled for
    // this type, contact marked do-not-contact — are all fixable by a person,
    // and none of them is helped by a bare "failed".
    const { run } = makeOrchestrator('FAILED');

    await expect(run()).rejects.toThrow(/do-not-contact|connected/i);
  });
});

describe('a real send still works', () => {
  it('flips the invoice and logs when delivery succeeds', async () => {
    const { run, updateInvoiceStatus, createActivity } = makeOrchestrator('SENT');

    const result = await run();

    expect(updateInvoiceStatus).toHaveBeenCalledTimes(1);
    expect(createActivity).toHaveBeenCalledTimes(1);
    expect(result.emailedTo).toBe('ada@example.com');
  });

  it('accepts QUEUED as a send, because it will be delivered', async () => {
    // Treating QUEUED as failure would be the opposite error: refusing to
    // record an invoice that genuinely goes out a moment later.
    const { run, updateInvoiceStatus } = makeOrchestrator('QUEUED');

    const result = await run();

    expect(updateInvoiceStatus).toHaveBeenCalledTimes(1);
    expect(result.delivery).toBe('QUEUED');
  });

  it('sends before it flips, and only flips after checking', async () => {
    // Ordering AND the check. The broken version had the ordering right.
    const order: string[] = [];
    const { run, send, updateInvoiceStatus } = makeOrchestrator('SENT');
    send.mockImplementation(async () => {
      order.push('send');
      return { status: 'SENT' as const };
    });
    updateInvoiceStatus.mockImplementation(async () => {
      order.push('flip');
      return { id: 'inv_1', status: 'SENT' };
    });

    await run();

    expect(order).toEqual(['send', 'flip']);
  });
});
