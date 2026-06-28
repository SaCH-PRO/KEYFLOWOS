import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommunicationsService } from './communications.service';

function makeMocks() {
  const prisma = {
    client: {
      channelDestination: {
        findFirst: vi.fn(),
      },
    },
  };

  const messageSender = {
    sendMessage: vi.fn().mockResolvedValue({
      success: true,
      messageId: 'msg_123',
      channel: 'email',
    }),
  };

  const deliveryQueue = {
    publishNow: vi.fn().mockResolvedValue({ queued: 5, deliveryIds: ['d1'] }),
    schedule: vi.fn(),
  };

  const outboundContent = {
    create: vi.fn().mockResolvedValue({ id: 'content_123' }),
    delete: vi.fn().mockResolvedValue(undefined),
  };

  const inbox = {
    listThreads: vi.fn().mockResolvedValue([{ id: 'thread_1' }]),
    getThread: vi.fn().mockResolvedValue({ id: 'thread_1', messages: [] }),
    updateThread: vi.fn().mockResolvedValue({ id: 'thread_1' }),
    addReply: vi.fn().mockResolvedValue({
      thread: { id: 'thread_1' },
      message: { id: 'msg_123' },
      sendResult: { success: true, status: 'SENT' },
    }),
  };

  const replySender = {
    sendReply: vi.fn(),
  };

  return { prisma, messageSender, deliveryQueue, outboundContent, inbox, replySender };
}

describe('CommunicationsService', () => {
  let service: CommunicationsService;
  let mocks: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    mocks = makeMocks();
    service = new CommunicationsService(
      mocks.prisma as any,
      mocks.messageSender as any,
      mocks.deliveryQueue as any,
      mocks.outboundContent as any,
      mocks.inbox as any,
      mocks.replySender as any,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendMessage', () => {
    it('delegates to AiMessageSenderService.sendMessage', async () => {
      const result = await service.sendMessage({
        businessId: 'biz_1',
        contactId: 'contact_1',
        channel: 'email',
        body: 'Hello',
        subject: 'Hi',
      });

      expect(mocks.messageSender.sendMessage).toHaveBeenCalledWith({
        businessId: 'biz_1',
        contactId: 'contact_1',
        channel: 'email',
        body: 'Hello',
        subject: 'Hi',
      });
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg_123');
    });
  });

  describe('sendWhatsapp', () => {
    it('delegates with channel whatsapp', async () => {
      await service.sendWhatsapp({
        businessId: 'biz_1',
        contactId: 'contact_1',
        body: 'Hello',
      });

      expect(mocks.messageSender.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'whatsapp' }),
      );
    });
  });

  describe('sendEmail', () => {
    it('delegates with channel email', async () => {
      await service.sendEmail({
        businessId: 'biz_1',
        contactId: 'contact_1',
        subject: 'Hi',
        body: 'Hello',
      });

      expect(mocks.messageSender.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'email' }),
      );
    });
  });

  describe('sendBroadcast', () => {
    it('creates content and publishes to an active destination', async () => {
      mocks.prisma.client.channelDestination.findFirst.mockResolvedValue({
        id: 'dest_1',
        connection: { provider: 'EMAIL' },
      });

      const result = await service.sendBroadcast({
        businessId: 'biz_1',
        segment: 'customers',
        channel: 'email',
        body: 'Broadcast body',
      });

      expect(mocks.outboundContent.create).toHaveBeenCalledWith(
        'biz_1',
        expect.objectContaining({
          contentType: 'campaign_email',
          body: 'Broadcast body',
          contentMeta: expect.objectContaining({ segmentTags: ['customers'] }),
        }),
      );
      expect(mocks.deliveryQueue.publishNow).toHaveBeenCalledWith('biz_1', 'content_123', ['dest_1']);
      expect(result.success).toBe(true);
      expect(result.queued).toBe(5);
    });

    it('returns error when no active destination exists', async () => {
      mocks.prisma.client.channelDestination.findFirst.mockResolvedValue(null);

      const result = await service.sendBroadcast({
        businessId: 'biz_1',
        segment: 'customers',
        channel: 'email',
        body: 'Broadcast body',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No active email destination');
      expect(mocks.deliveryQueue.publishNow).not.toHaveBeenCalled();
    });
  });

  describe('sendReply', () => {
    it('delegates to KeyInboxService.addReply and normalizes string attachments', async () => {
      const result = await service.sendReply({
        businessId: 'biz_1',
        conversationId: 'thread_1',
        body: 'Reply body',
        attachments: ['https://example.com/file.pdf'],
      });

      expect(mocks.inbox.addReply).toHaveBeenCalledWith(
        'biz_1',
        'thread_1',
        'Reply body',
        [{ url: 'https://example.com/file.pdf' }],
        { mode: 'send' },
      );
      expect(result.success).toBe(true);
      expect(result.status).toBe('SENT');
    });
  });

  describe('getConversation', () => {
    it('delegates to KeyInboxService.listThreads filtered by contactId', async () => {
      const result = await service.getConversation({
        businessId: 'biz_1',
        contactId: 'contact_1',
        channel: 'email',
        limit: 25,
      });

      expect(mocks.inbox.listThreads).toHaveBeenCalledWith(
        'biz_1',
        expect.objectContaining({ search: 'contact_1', channel: 'email', limit: 25 }),
      );
      expect(result).toEqual(expect.objectContaining({ contactId: 'contact_1', channel: 'email' }));
    });
  });

  describe('getUnreadConversations', () => {
    it('delegates to KeyInboxService.listThreads with OPEN status', async () => {
      const result = await service.getUnreadConversations({ businessId: 'biz_1' });

      expect(mocks.inbox.listThreads).toHaveBeenCalledWith(
        'biz_1',
        expect.objectContaining({ status: 'OPEN', limit: 50 }),
      );
      expect(result).toEqual([{ id: 'thread_1' }]);
    });
  });

  describe('markRead', () => {
    it('updates thread status to DONE', async () => {
      await service.markRead({ businessId: 'biz_1', conversationId: 'thread_1' });

      expect(mocks.inbox.updateThread).toHaveBeenCalledWith('biz_1', 'thread_1', { status: 'DONE' });
    });
  });

  describe('archiveConversation', () => {
    it('updates thread status to ARCHIVED', async () => {
      await service.archiveConversation({ businessId: 'biz_1', conversationId: 'thread_1' });

      expect(mocks.inbox.updateThread).toHaveBeenCalledWith('biz_1', 'thread_1', { status: 'ARCHIVED' });
    });
  });

  describe('createTemplate', () => {
    it('creates an outbound content template record', async () => {
      const result = await service.createTemplate({
        businessId: 'biz_1',
        name: 'Welcome',
        channel: 'email',
        subject: 'Welcome!',
        body: 'Hello there',
        variables: ['name'],
      });

      expect(mocks.outboundContent.create).toHaveBeenCalledWith(
        'biz_1',
        expect.objectContaining({
          contentType: 'template',
          subject: 'Welcome!',
          body: 'Hello there',
          contentMeta: expect.objectContaining({ name: 'Welcome', channel: 'email', variables: ['name'] }),
        }),
      );
      expect(result.success).toBe(true);
      expect(result.templateId).toBe('content_123');
    });
  });

  describe('deleteTemplate', () => {
    it('deletes the outbound content record', async () => {
      const result = await service.deleteTemplate({ businessId: 'biz_1', templateId: 'content_123' });

      expect(mocks.outboundContent.delete).toHaveBeenCalledWith('biz_1', 'content_123');
      expect(result.deleted).toBe(true);
    });
  });

  describe('stub guard', () => {
    it('does not return empty placeholder objects for send methods', async () => {
      const result = await service.sendMessage({
        businessId: 'biz_1',
        contactId: 'contact_1',
        channel: 'email',
        body: 'Hello',
      });

      expect(result).not.toEqual({});
      expect(mocks.messageSender.sendMessage).toHaveBeenCalled();
    });
  });
});
