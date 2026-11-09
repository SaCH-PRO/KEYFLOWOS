/**
 * PR196-SYSTEM-EMAIL (owner ruling D-82): a KEY inbox email reply leaves only
 * from the business's own Gmail. Without Gmail connected it fails visibly; it
 * never falls back to the platform's sender (SystemEmailService / Resend, the
 * "Keyflow <EMAIL_FROM_ADDRESS>" address used for sign-in mail).
 *
 * PR #196 (9b) added that fallback (`trySendViaPlatformEsp`, 9B-D1..D3). This
 * suite pins the ruled contract on our sender:
 *
 *   - Gmail not connected (GmailService's 503 provider_not_configured,
 *     "Gmail not connected"): FAILED, persisted and evented as reply_failed,
 *     and the error the web toast shows (key-inbox/page.tsx reads
 *     sendResult.error) says Gmail is not connected, that nothing was sent, and
 *     where to connect it;
 *   - in every case the platform sender is never reached: the Resend client is
 *     mocked at the module boundary and the platform sender is fully configured
 *     (RESEND_API_KEY, EMAIL_FROM_ADDRESS, MARKETING_ESP_FALLBACK unset = on), so
 *     a fallback would fire if one existed. No provider traffic: Gmail is a stub.
 */
import { ServiceUnavailableException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resendSend = vi.hoisted(() => vi.fn(async () => ({ data: { id: 'platform_relay_1' }, error: null })));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));
vi.mock('../commerce/gmail.service', () => ({
  GmailService: class GmailService {},
}));

import { GmailService } from '../commerce/gmail.service';
import { SystemEmailService } from '../notifications/system-email.service';
import { KeyInboxReplySenderService } from './key-inbox-reply-sender.service';

const CUSTOMER = 'customer.d82@example.test';

/** What GmailService throws when the business has no mailbox (gmail.service.ts gmailNotConfigured). */
function gmailNotConnected(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'provider_not_configured',
    service: 'gmail',
    message: 'Gmail not connected',
    error: 'Service Unavailable',
  });
}

function makeSender(gmail: Record<string, unknown> | null, opts?: { externalMessageId?: string | null }) {
  const reference = {
    id: 'msg_in_1',
    threadId: 'thread_1',
    direction: 'INBOUND',
    senderEmail: CUSTOMER,
    externalMessageId: opts?.externalMessageId ?? null,
  };
  const prisma = {
    client: {
      keyInboxMessage: {
        findFirst: vi.fn(async () => reference),
        update: vi.fn(async () => ({})),
      },
    },
  };
  const moduleRef = {
    get: vi.fn((token: unknown) => {
      if (token === GmailService && gmail) return gmail;
      throw new Error(`Nest could not find ${String((token as { name?: string })?.name ?? token)} element`);
    }),
  };
  const businessEvents = { emit: vi.fn(async () => undefined) };
  const sender = new KeyInboxReplySenderService(moduleRef as any, prisma as any, businessEvents as any);
  return { sender, prisma, moduleRef, businessEvents };
}

function emailThread(overrides: Record<string, unknown> = {}) {
  return {
    id: 'thread_1',
    businessId: 'biz_d82',
    channel: 'email',
    subject: 'Question about my booking',
    externalThreadId: null,
    metadata: null,
    ...overrides,
  } as any;
}

const outbound = { id: 'msg_out_1', contentText: 'Thanks, see you Tuesday.', contentHtml: null } as any;

describe('KEY inbox email replies never relay through the platform sender (D-82)', () => {
  let platformSend: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.RESEND_API_KEY = 're_test_d82_not_a_key';
    process.env.EMAIL_FROM_ADDRESS = 'no-reply@platform.example.test';
    delete process.env.MARKETING_ESP_FALLBACK;
    resendSend.mockClear();
    platformSend = vi.spyOn(SystemEmailService.prototype, 'sendTransactional');
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM_ADDRESS;
    vi.restoreAllMocks();
  });

  function expectNoPlatformRelay(moduleRef: { get: ReturnType<typeof vi.fn> }) {
    expect(resendSend).not.toHaveBeenCalled();
    expect(platformSend).not.toHaveBeenCalled();
    for (const [token] of moduleRef.get.mock.calls) expect(token).toBe(GmailService);
  }

  it('[D-82] RED-BEFORE: Gmail not connected (new email) fails visibly: FAILED, persisted, reply_failed, and the error the UI shows says Gmail is not connected, nothing was sent, and where to connect it; no platform send', async () => {
    const gmail = { sendEmail: vi.fn(async () => { throw gmailNotConnected(); }), sendReply: vi.fn() };
    const { sender, prisma, moduleRef, businessEvents } = makeSender(gmail);

    const result = await sender.sendReply('biz_d82', emailThread(), outbound, 'user_owner');

    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: false, status: 'FAILED', sentVia: 'gmail' });
    expect(result.error).toMatch(/Gmail is not connected/);
    expect(result.error).toMatch(/not sent/i);
    expect(result.error).toMatch(/Settings/);
    expect(result.error).not.toContain(CUSTOMER);
    expect(prisma.client.keyInboxMessage.update).toHaveBeenCalledWith({
      where: { id: 'msg_out_1' },
      data: expect.objectContaining({ sendStatus: 'FAILED', sendError: result.error, sentVia: 'gmail', providerMessageId: null }),
    });
    expect(businessEvents.emit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'key_inbox.reply_failed', businessId: 'biz_d82', subjectId: 'msg_out_1' }),
    );
    expectNoPlatformRelay(moduleRef);
  });

  it('[D-82] RED-BEFORE: Gmail not connected (in-thread reply) fails visibly with the same error; no platform send', async () => {
    const gmail = { sendEmail: vi.fn(), sendReply: vi.fn(async () => { throw gmailNotConnected(); }) };
    const { sender, moduleRef } = makeSender(gmail, { externalMessageId: '<abc@mail.gmail.com>' });

    const result = await sender.sendReply('biz_d82', emailThread({ externalThreadId: 'gmail_thread_1' }), outbound, 'user_owner');

    expect(gmail.sendReply).toHaveBeenCalledTimes(1);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, status: 'FAILED', sentVia: 'gmail' });
    expect(result.error).toMatch(/Gmail is not connected/);
    expect(result.error).toMatch(/not sent/i);
    expectNoPlatformRelay(moduleRef);
  });

  it('[D-82] GmailService cannot be resolved: FAILED "Gmail service is not available"; no platform send', async () => {
    const { sender, moduleRef } = makeSender(null);

    const result = await sender.sendReply('biz_d82', emailThread(), outbound, 'user_owner');

    expect(result).toMatchObject({ success: false, status: 'FAILED', sentVia: 'gmail', error: 'Gmail service is not available' });
    expectNoPlatformRelay(moduleRef);
  });

  it('[D-82] a Gmail send that reached Google and failed keeps its own error (it is not "not connected"); no platform send', async () => {
    const gmail = { sendEmail: vi.fn(async () => { throw new Error('Gmail API error: 500 backend error'); }), sendReply: vi.fn() };
    const { sender, moduleRef } = makeSender(gmail);

    const result = await sender.sendReply('biz_d82', emailThread(), outbound, 'user_owner');

    expect(result).toMatchObject({ success: false, status: 'FAILED', sentVia: 'gmail', error: 'Gmail API error: 500 backend error' });
    expectNoPlatformRelay(moduleRef);
  });

  it('[D-82] Gmail connected: the reply leaves from the business Gmail, SENT with its message id; no platform send', async () => {
    const gmail = { sendEmail: vi.fn(async () => ({ messageId: 'gmail_msg_1' })), sendReply: vi.fn() };
    const { sender, prisma, moduleRef } = makeSender(gmail);

    const result = await sender.sendReply('biz_d82', emailThread(), outbound, 'user_owner');

    expect(gmail.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'biz_d82', to: CUSTOMER, subject: 'Question about my booking' }),
    );
    expect(result).toEqual({ success: true, status: 'SENT', providerMessageId: 'gmail_msg_1', sentVia: 'gmail' });
    expect(prisma.client.keyInboxMessage.update).toHaveBeenCalledWith({
      where: { id: 'msg_out_1' },
      data: expect.objectContaining({ sendStatus: 'SENT', providerMessageId: 'gmail_msg_1', sendError: null }),
    });
    expectNoPlatformRelay(moduleRef);
  });
});
