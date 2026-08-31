/**
 * A CRM sequence that sends nothing must not look like one that is running.
 *
 * The send node did everything except send: picked a variant, resolved the
 * copy, stamped `sentAt` into the enrollment metadata, logged the step to the
 * contact timeline, emitted `sequence.step_due`, and advanced. The three
 * listeners on that event are an AI processor, an insight staleness marker and
 * a flow logger, all observers. And the scheduler injects only Prisma, the
 * event bus and the timeline service, so it had nothing to send WITH.
 *
 * The tell was never a broken call. It was an absent one, behind a set of
 * surfaces that all agreed the sequence was working.
 *
 * These tests drive `dispatchSendNode` directly. The queue it writes to is
 * real and already drained every 30 seconds by DeliveryQueueService, the same
 * path flow automation uses, so "queued" here means the message genuinely goes
 * out rather than that another TODO was reached.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CrmSequenceSchedulerService } from './crm-sequence-scheduler.service';

const BIZ = 'biz_1';
const CONTACT = 'contact_1';

type Dispatch = (
  businessId: string,
  enrollment: unknown,
  node: unknown,
  payload: { subject?: string; body?: string },
  variantId: string | null,
) => Promise<{ queued: boolean; reason?: string }>;

function harness(opts: { connected?: boolean } = {}) {
  const created = { content: 0, variant: 0, delivery: 0 };
  let lastDelivery: Record<string, unknown> | null = null;

  const prisma = {
    client: {
      channelConnection: {
        findFirst: vi.fn(async () =>
          opts.connected === false ? null : { id: 'conn_1', destinations: [{ id: 'dest_1' }] },
        ),
      },
      outboundContent: {
        create: vi.fn(async () => {
          created.content++;
          return { id: 'content_1' };
        }),
      },
      outboundVariant: {
        create: vi.fn(async () => {
          created.variant++;
          return { id: 'variant_1' };
        }),
      },
      outboundDelivery: {
        create: vi.fn(async (args: { data: Record<string, unknown> }) => {
          created.delivery++;
          lastDelivery = args.data;
          return { id: 'delivery_1' };
        }),
      },
    },
  };

  const proto = CrmSequenceSchedulerService.prototype as unknown as Record<string, unknown>;
  const instance = { prisma, logger: { warn: vi.fn(), log: vi.fn() } } as Record<string, unknown>;
  const dispatch = (proto.dispatchSendNode as (...a: unknown[]) => unknown).bind(instance) as Dispatch;

  return { dispatch, prisma, created, delivery: () => lastDelivery };
}

const emailContact = { contactId: CONTACT, contact: { email: 'a@b.test', phone: null } };
const waContact = { contactId: CONTACT, contact: { email: null, phone: '+18681234567' } };
const BODY = { subject: 'Following up', body: 'Just checking in on the quote.' };

describe('a send step actually enqueues a delivery', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  it('queues an email delivery onto the real outbound queue', async () => {
    const r = await h.dispatch(BIZ, emailContact, { id: 'n1', type: 'email' }, BODY, null);
    expect(r.queued, r.reason).toBe(true);
    expect(h.created).toEqual({ content: 1, variant: 1, delivery: 1 });
  });

  it('addresses the delivery to the contact, and scopes it to the business', async () => {
    await h.dispatch(BIZ, emailContact, { id: 'n1', type: 'email' }, BODY, null);
    expect(h.delivery()).toMatchObject({
      businessId: BIZ,
      contactId: CONTACT,
      recipientEmail: 'a@b.test',
      status: 'Queued',
    });
  });

  it('queues WhatsApp against the phone, not the email field', async () => {
    await h.dispatch(BIZ, waContact, { id: 'n1', type: 'whatsapp' }, BODY, null);
    expect(h.delivery()).toMatchObject({ recipientPhone: '+18681234567', recipientEmail: null });
  });
});

describe('a step it cannot deliver says so, and writes nothing', () => {
  it('refuses when no channel is connected', async () => {
    const h = harness({ connected: false });
    const r = await h.dispatch(BIZ, emailContact, { id: 'n1', type: 'email' }, BODY, null);
    expect(r.queued).toBe(false);
    expect(r.reason).toMatch(/no active email channel/);
    expect(h.created.delivery, 'nothing may be written on a refusal').toBe(0);
  });

  it('refuses when the contact has no email', async () => {
    const h = harness();
    const r = await h.dispatch(BIZ, { contactId: CONTACT, contact: { email: null } }, { id: 'n1', type: 'email' }, BODY, null);
    expect(r.queued).toBe(false);
    expect(r.reason).toMatch(/no email/);
    expect(h.created.delivery).toBe(0);
  });

  it('refuses when the contact has no phone', async () => {
    const h = harness();
    const r = await h.dispatch(BIZ, { contactId: CONTACT, contact: { phone: null } }, { id: 'n1', type: 'whatsapp' }, BODY, null);
    expect(r.queued).toBe(false);
    expect(r.reason).toMatch(/no phone/);
  });

  it('refuses an SMS step, because no SMS provider exists', async () => {
    const h = harness();
    const r = await h.dispatch(BIZ, waContact, { id: 'n1', type: 'sms' }, BODY, null);
    expect(r.queued).toBe(false);
    expect(r.reason).toMatch(/SMS/);
    expect(h.created.delivery).toBe(0);
  });

  it('refuses an empty body rather than sending a blank message', async () => {
    const h = harness();
    const r = await h.dispatch(BIZ, emailContact, { id: 'n1', type: 'email' }, { body: '   ' }, null);
    expect(r.queued).toBe(false);
    expect(h.created.content, 'no content row for a message with nothing in it').toBe(0);
  });
});

describe('the send branch calls it and believes the result', () => {
  const src = (() => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    return fs.readFileSync(path.join(__dirname, 'crm-sequence-scheduler.service.ts'), 'utf8');
  })();

  it('reads the scheduler — this gate is not vacuous', () => {
    expect(src.length).toBeGreaterThan(2000);
    expect(src).toContain('isSendNode(node)');
  });

  it('the send branch dispatches', () => {
    const at = src.indexOf('if (isSendNode(node)) {');
    const branch = src.slice(at, at + 2500);
    expect(branch, 'a send node must attempt a send').toContain('this.dispatchSendNode(');
  });

  it('sentAt is conditional on the dispatch, not unconditional', () => {
    const at = src.indexOf('if (isSendNode(node)) {');
    const branch = src.slice(at, at + 2500);
    expect(branch, 'stamping sentAt regardless is the original defect').toContain('dispatch.queued ?');
  });
});
