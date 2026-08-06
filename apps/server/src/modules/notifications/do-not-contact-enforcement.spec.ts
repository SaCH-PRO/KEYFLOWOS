/**
 * "Do not contact" was enforced by convention, and convention forgot.
 *
 * DelegationLoopService checks `contact.doNotContact` before payment recovery.
 * The campaign sender filters on `doNotContact` and `marketingOptIn`. Both
 * correct — and both are the same check written twice, by hand, in the caller.
 *
 * TransactionalEmailService.send() checked nothing. It took a recipientEmail
 * and a contactId and sent. Every caller was on its honour, and the third one
 * added to this codebase — the invoice-send path, written on 2026-08-05 to fix
 * a tool that marked invoices SENT without emailing anyone — promptly forgot.
 * A fix for one honesty defect quietly introduced a compliance one.
 *
 * That is the argument for putting the check in the PATHWAY rather than in a
 * checklist: the checklist is only as good as the next person's memory, and it
 * has already failed once, here, within a day.
 */
import { describe, it, expect, vi } from 'vitest';
import { TransactionalEmailService } from './transactional-email.service';

const BIZ = 'biz_1';
const OTHER = 'biz_other';

function makeService(contact: { doNotContact: boolean; businessId?: string } | null) {
  const findFirst = vi.fn(async ({ where }: any) => {
    if (!contact) return null;
    if ((contact.businessId ?? BIZ) !== where.businessId) return null;
    return { doNotContact: contact.doNotContact };
  });

  const service = Object.assign(Object.create(TransactionalEmailService.prototype), {
    prisma: { client: { contact: { findFirst }, customerNotificationLog: { findFirst: vi.fn(async () => null) } } },
    logger: { log: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
    getBusinessContext: vi.fn(async () => ({ preferences: {}, business: { id: BIZ } })),
    isEnabled: vi.fn(() => true),
    // Reaching these means the guard let the send through. The assertion is
    // only ever "not FAILED" — this spec is about the gate, not about delivery.
    gmail: { getGmailStatus: vi.fn(async () => ({ connected: false })) },
    deliver: vi.fn(async () => ({ status: 'SENT' as const })),
  });

  return { service, findFirst };
}

const PAYLOAD = {
  businessId: BIZ,
  type: 'invoice_sent' as never,
  recipientEmail: 'ada@example.com',
  recipientName: 'Ada',
  templateData: {},
};

describe('a contact who asked not to be contacted is not contacted', () => {
  it('refuses when the contact is marked do-not-contact', async () => {
    const { service } = makeService({ doNotContact: true });

    const result = await service.send({ ...PAYLOAD, contactId: 'con_1' });

    expect(result.status).toBe('FAILED');
  });

  it('sends when they are not', async () => {
    // A guard that refuses everything is not a guard.
    const { service } = makeService({ doNotContact: false });

    const result = await service.send({ ...PAYLOAD, contactId: 'con_1' });

    expect(result.status).not.toBe('FAILED');
  });

  it('checks the contact rather than trusting the caller', async () => {
    const { service, findFirst } = makeService({ doNotContact: false });

    await service.send({ ...PAYLOAD, contactId: 'con_1' });

    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});

describe('the lookup is tenant-scoped', () => {
  it('refuses a contactId belonging to another business', async () => {
    // Without the businessId filter, a contactId from another tenant would
    // resolve, its doNotContact flag would be read, and an email would be sent
    // to an address this business has no relationship with.
    const { service } = makeService({ doNotContact: false, businessId: OTHER });

    const result = await service.send({ ...PAYLOAD, contactId: 'con_from_other_biz' });

    expect(result.status).toBe('FAILED');
  });

  it('refuses rather than sending blind when the contact does not exist', async () => {
    const { service } = makeService(null);

    const result = await service.send({ ...PAYLOAD, contactId: 'con_ghost' });

    expect(result.status).toBe('FAILED');
  });
});

describe('it does not break sends that have no contact', () => {
  it('allows a send with no contactId at all', async () => {
    // Plenty of notifications are to the business itself, or to an address with
    // no Contact row. Those must keep working.
    const { service, findFirst } = makeService(null);

    const result = await service.send(PAYLOAD);

    expect(result.status).not.toBe('FAILED');
    expect(findFirst).not.toHaveBeenCalled();
  });
});
