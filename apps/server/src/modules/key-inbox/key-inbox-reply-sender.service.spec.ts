import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyInboxReplySenderService } from './key-inbox-reply-sender.service';

describe('KeyInboxReplySenderService', () => {
  let prismaMock: any;
  let businessEventsMock: any;
  let moduleRefMock: any;
  let service: KeyInboxReplySenderService;

  beforeEach(() => {
    prismaMock = {
      client: {
        keyInboxMessage: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'msg-in-1',
            senderEmail: 'client@example.com',
            externalMessageId: '<ext-1@example.com>',
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        business: {
          findUnique: vi.fn().mockResolvedValue({ email: 'hello@keyflow.tt' }),
        },
      },
    };
    businessEventsMock = {
      emit: vi.fn().mockResolvedValue(undefined),
    };
    moduleRefMock = {
      get: vi.fn(),
    };
    service = new KeyInboxReplySenderService(moduleRefMock, prismaMock, businessEventsMock);
  });

  it('sends email reply via GmailService when Gmail is connected', async () => {
    const sendReplyMock = vi.fn().mockResolvedValue({ messageId: 'gmail-msg-1', threadId: 'gmail-th-1' });
    (service as any).gmailServiceCache = {
      sendReply: sendReplyMock,
    };

    const res = await service.sendReply(
      'biz-1',
      {
        id: 'th-1',
        channel: 'email',
        subject: 'Invoice Question',
        externalThreadId: 'gmail-th-1',
        metadata: {},
      } as any,
      {
        id: 'msg-out-1',
        contentText: 'Here is your receipt.',
        contentHtml: '<p>Here is your receipt.</p>',
      } as any,
      'user-1',
    );

    expect(res.success).toBe(true);
    expect(res.sentVia).toBe('gmail');
    expect(res.providerMessageId).toBe('gmail-msg-1');
    expect(sendReplyMock).toHaveBeenCalledOnce();
    expect(prismaMock.client.keyInboxMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'msg-out-1' },
        data: expect.objectContaining({ sendStatus: 'SENT', sentVia: 'gmail' }),
      }),
    );
  });

  it('falls back to platform ESP when Gmail is not connected for the business', async () => {
    (service as any).gmailServiceCache = {
      sendReply: vi.fn().mockRejectedValue(new Error('Gmail not connected')),
    };
    const espSpy = vi.spyOn(service as any, 'trySendViaPlatformEsp').mockResolvedValue({
      success: true,
      status: 'SENT',
      providerMessageId: 'resend-msg-99',
      sentVia: 'resend',
    });

    const res = await service.sendReply(
      'biz-1',
      {
        id: 'th-1',
        channel: 'email',
        subject: 'Invoice Question',
        externalThreadId: 'gmail-th-1',
        metadata: {},
      } as any,
      {
        id: 'msg-out-2',
        contentText: 'Fallback reply via platform ESP.',
        contentHtml: null,
      } as any,
      'user-1',
    );

    expect(espSpy).toHaveBeenCalledOnce();
    expect(res.success).toBe(true);
    expect(res.sentVia).toBe('resend');
    expect(res.providerMessageId).toBe('resend-msg-99');
  });
});
