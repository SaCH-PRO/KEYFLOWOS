/**
 * PR196-SYSTEM-EMAIL review repair SE-1 (owner ruling D-82): business email to
 * a contact never relays through the platform sender.
 *
 * AiMessageSenderService.sendEmail is the 1:1 email path behind
 *   - POST communications/businesses/:businessId/drafts/:id/send
 *     (ResponseDraftService.sendDraft: an APPROVED reply draft on a KEY inbox
 *     thread),
 *   - the message-intake 'send_reply' action
 *     (MessageIntakeOrchestratorService),
 *   - CommunicationsService.sendMessage and KEY's send_message_with_approval.
 * When Gmail threw (e.g. GmailService's 503 provider_not_configured "Gmail not
 * connected"), it fell back to SystemEmailService.sendTransactional, sending
 * the business's mail from "Keyflow <EMAIL_FROM_ADDRESS>" (the platform's
 * sign-in sender), and the draft was marked SENT.
 *
 * Under D-82: without a usable Gmail the send fails with a clear message
 * (EMAIL_ACCOUNT_NOT_CONNECTED); the platform sender is never called; a
 * connected Gmail still sends; a draft whose send failed stays APPROVED.
 *
 * The real SystemEmailService is fully configured (RESEND_API_KEY and
 * EMAIL_FROM_ADDRESS set, the Resend client mocked at the module boundary) and
 * its prototype is spied, so a relay would show if one existed. No provider
 * traffic.
 */
import { ServiceUnavailableException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resendSend = vi.hoisted(() => vi.fn(async () => ({ data: { id: 'platform_relay_1' }, error: null })));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));

import { AiMessageSenderService } from './ai-message-sender.service';
import { ResponseDraftService } from '../communications/response-draft.service';
import { SystemEmailService } from '../notifications/system-email.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GmailService } from '../commerce/gmail.service';
import { TimelineService } from '../timeline/timeline.service';

/** The message the sender returns (and the draft route throws) when the business has no usable Gmail. */
const NOT_CONNECTED = /^Gmail is not connected for this business, so this email was not sent\. .*connect it in Settings > Connections, then retry\.$/;

type Row = Record<string, any>;

const CUSTOMER = 'customer.se1@example.test';

function gmailNotConnected() {
  return new ServiceUnavailableException({
    code: 'provider_not_configured',
    service: 'gmail',
    message: 'Gmail not connected',
    error: 'Service Unavailable',
  });
}

/**
 * Built through Nest DI with the real SystemEmailService registered, exactly as
 * a module that provides it would wire the sender: the relay, if the sender
 * still had one, would be reachable.
 */
async function harness(gmail: Row | undefined) {
  const timeline = { recordContactEvent: vi.fn(async () => undefined) };
  const events = { emit: vi.fn() };
  const client: Row = {
    contact: {
      findFirst: vi.fn(async ({ where }: Row) =>
        where.businessId === 'biz_se1'
          ? { id: 'contact_se1', email: CUSTOMER, firstName: 'C', lastName: 'X', phone: null, whatsappNumber: null, preferredChannel: null }
          : null,
      ),
    },
    responseDraft: {
      findFirst: vi.fn(async () => ({
        id: 'draft_se1',
        businessId: 'biz_se1',
        status: 'APPROVED',
        channel: 'email',
        body: 'Thanks for your message',
        contactId: null,
        threadId: 'thread_se1',
      })),
      update: vi.fn(async ({ data }: Row) => ({ id: 'draft_se1', ...data })),
    },
    keyInboxThread: { findUnique: vi.fn(async () => ({ contactId: 'contact_se1' })) },
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      AiMessageSenderService,
      SystemEmailService,
      { provide: PrismaService, useValue: { client } },
      { provide: EventEmitter2, useValue: events },
      { provide: TimelineService, useValue: timeline },
      ...(gmail ? [{ provide: GmailService, useValue: gmail }] : []),
    ],
  }).compile();
  const sender = moduleRef.get(AiMessageSenderService);
  return { sender, client, timeline, events };
}

describe('AiMessageSenderService email never relays through the platform sender (D-82, SE-1)', () => {
  let platformSend: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.RESEND_API_KEY = 're_test_se1_not_a_key';
    process.env.EMAIL_FROM_ADDRESS = 'no-reply@platform.example.test';
    resendSend.mockClear();
    platformSend = vi.spyOn(SystemEmailService.prototype, 'sendTransactional');
    // The platform sender is configured: a relay, if one existed, would fire.
    expect(new SystemEmailService().isConfigured()).toBe(true);
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM_ADDRESS;
    vi.restoreAllMocks();
  });

  it('[D-82] RED-BEFORE: Gmail not connected (503 provider_not_configured): fails with a clear error, nothing sent through the platform sender', async () => {
    const gmail = { sendEmail: vi.fn(async () => { throw gmailNotConnected(); }) };
    const h = await harness(gmail);

    const result = await h.sender.sendMessage({ businessId: 'biz_se1', contactId: 'contact_se1', channel: 'email', body: 'Hello' });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('EMAIL_ACCOUNT_NOT_CONNECTED');
    expect(result.error).toMatch(NOT_CONNECTED);
    expect(result.error).toMatch(/Gmail/);
    expect(result.error).toMatch(/connect/i);
    expect(result.error).not.toContain(CUSTOMER);
    expect(result).not.toHaveProperty('fallback');
    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
    expect(platformSend).not.toHaveBeenCalled();
    expect(resendSend).not.toHaveBeenCalled();
    // Nothing went out, so nothing is recorded as sent.
    expect(h.timeline.recordContactEvent).not.toHaveBeenCalled();
    expect(h.events.emit).not.toHaveBeenCalledWith('message.sent', expect.anything());
  });

  it('[D-82] RED-BEFORE: no Gmail service at all: the same clear failure, no platform send', async () => {
    const h = await harness(undefined);

    const result = await h.sender.sendMessage({ businessId: 'biz_se1', contactId: 'contact_se1', channel: 'email', body: 'Hello' });

    expect(result).toMatchObject({ success: false, channel: 'email', errorCode: 'EMAIL_ACCOUNT_NOT_CONNECTED', error: expect.stringMatching(NOT_CONNECTED) });
    expect(platformSend).not.toHaveBeenCalled();
    expect(resendSend).not.toHaveBeenCalled();
  });

  it('[D-82] RED-BEFORE: any other Gmail failure keeps its own error and is not relayed through the platform sender either', async () => {
    const gmail = { sendEmail: vi.fn(async () => { throw new Error('Gmail send failed (500): backend error'); }) };
    const h = await harness(gmail);

    const result = await h.sender.sendMessage({ businessId: 'biz_se1', contactId: 'contact_se1', channel: 'email', body: 'Hello' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Gmail send failed (500): backend error');
    expect(result.errorCode).toBeUndefined();
    expect(platformSend).not.toHaveBeenCalled();
    expect(resendSend).not.toHaveBeenCalled();
  });

  it('[D-82] a connected Gmail still sends the business email through Gmail', async () => {
    const gmail = { sendEmail: vi.fn(async () => ({ messageId: 'gmail_msg_se1' })) };
    const h = await harness(gmail);

    const result = await h.sender.sendMessage({ businessId: 'biz_se1', contactId: 'contact_se1', channel: 'email', subject: 'Re: hello', body: 'Hello' });

    expect(result).toEqual({ success: true, channel: 'email', messageId: 'gmail_msg_se1' });
    expect(gmail.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz_se1', to: CUSTOMER, subject: 'Re: hello' }));
    expect(platformSend).not.toHaveBeenCalled();
    expect(resendSend).not.toHaveBeenCalled();
  });

  it('[D-82] RED-BEFORE: an APPROVED email draft on a KEY inbox thread (drafts/:id/send) is not sent through the platform sender and is not marked SENT', async () => {
    const gmail = { sendEmail: vi.fn(async () => { throw gmailNotConnected(); }) };
    const h = await harness(gmail);
    const drafts = new ResponseDraftService({ client: h.client } as any, h.sender);

    await expect(drafts.sendDraft('biz_se1', 'draft_se1', 'user_se1')).rejects.toThrow(NOT_CONNECTED);

    expect(platformSend).not.toHaveBeenCalled();
    expect(resendSend).not.toHaveBeenCalled();
    expect(h.client.responseDraft.update).not.toHaveBeenCalled();
  });

  it('[D-82] RED-BEFORE: static: the sender has no path to the platform sender (no SystemEmailService, no sendTransactional)', () => {
    const source = readFileSync(join(__dirname, 'ai-message-sender.service.ts'), 'utf8');
    expect(source).not.toMatch(/SystemEmailService|system-email\.service|sendTransactional|resend_fallback/);
  });
});
