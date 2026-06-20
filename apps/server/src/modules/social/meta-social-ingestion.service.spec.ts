import { describe, expect, it, vi } from 'vitest';
import { MetaSocialIngestionService } from './meta-social-ingestion.service';
import { KeyInboxService } from '../key-inbox/key-inbox.service';
import { EntityResolutionService } from '../../core/connectors/entity-resolution.service';
import { PrismaService } from '../../core/prisma/prisma.service';

function createMocks() {
  const messages: any[] = [];
  const findMessage = vi.fn().mockResolvedValue(null);
  const createEngagement = vi.fn(() => ({ id: 'eng_1' }));

  const prisma = {
    client: {
      keyInboxMessage: { findFirst: findMessage },
      keyInboxThread: { findFirst: vi.fn(() => null) },
      socialEngagement: { create: createEngagement },
    },
  } as unknown as PrismaService;

  const keyInbox = {
    upsertThread: vi.fn(({ businessId, channel, externalThreadId }) =>
      Promise.resolve({
        id: `thread_${channel}_${externalThreadId}`,
        businessId,
        channel,
        externalThreadId,
        contactId: 'contact_1',
      }),
    ),
    addMessage: vi.fn(() =>
      Promise.resolve({
        thread: { id: 'thread_1' },
        message: { id: 'msg_1' },
      }),
    ),
  } as unknown as KeyInboxService;

  const entityResolution = {
    resolveContact: vi.fn(() =>
      Promise.resolve({ contactId: 'contact_1', isNew: true, merged: false, matchedOn: 'none' }),
    ),
  } as unknown as EntityResolutionService;

  return { prisma, keyInbox, entityResolution, findMessage, createEngagement };
}

describe('MetaSocialIngestionService', () => {
  it('ingests a real Messenger DM payload', async () => {
    const { prisma, keyInbox, entityResolution } = createMocks();
    const service = new MetaSocialIngestionService(prisma, keyInbox, entityResolution);

    const payload = {
      object: 'page',
      entry: [
        {
          id: 'page_1',
          time: 1458692752478,
          messaging: [
            {
              sender: { id: 'user_123' },
              recipient: { id: 'page_1' },
              timestamp: 1458692752478,
              message: { mid: 'mid.abc', text: 'Hello from Messenger' },
            },
          ],
        },
      ],
    };

    const result = await service.receiveInbound('biz_1', payload);

    expect(result.contactId).toBe('contact_1');
    expect(result.isNew).toBe(true);
    expect(keyInbox.upsertThread).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz_1',
        channel: 'facebook_messenger',
        externalThreadId: 'user_123',
        contactId: 'contact_1',
        subject: 'Hello from Messenger',
      }),
    );
    expect(keyInbox.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz_1',
        channel: 'facebook_messenger',
        direction: 'INBOUND',
        senderHandle: 'user_123',
        contentText: 'Hello from Messenger',
        externalMessageId: 'mid.abc',
      }),
    );
  });

  it('ingests a real Instagram DM payload', async () => {
    const { prisma, keyInbox, entityResolution } = createMocks();
    const service = new MetaSocialIngestionService(prisma, keyInbox, entityResolution);

    const payload = {
      object: 'instagram',
      entry: [
        {
          id: 'ig_1',
          time: 1458692752478,
          messaging: [
            {
              sender: { id: 'ig_user_456' },
              recipient: { id: 'ig_1' },
              timestamp: 1458692752478,
              message: { mid: 'mid.ig.123', text: 'Hi on Instagram' },
            },
          ],
        },
      ],
    };

    const result = await service.receiveInbound('biz_1', payload);

    expect(result.contactId).toBe('contact_1');
    expect(keyInbox.upsertThread).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz_1',
        channel: 'instagram_dm',
        externalThreadId: 'ig_user_456',
      }),
    );
    expect(keyInbox.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'instagram_dm',
        externalMessageId: 'mid.ig.123',
        contentText: 'Hi on Instagram',
      }),
    );
  });

  it('ingests the legacy simplified DM body and records a social engagement', async () => {
    const { prisma, keyInbox, entityResolution, createEngagement } = createMocks();
    const service = new MetaSocialIngestionService(prisma, keyInbox, entityResolution);

    const payload = {
      type: 'DM',
      platform: 'instagram',
      from: { id: 'legacy_user', name: 'Jane Doe' },
      message: 'Legacy DM',
      externalId: 'legacy_1',
    };

    const result = await service.receiveInbound('biz_1', payload);

    expect(result.contactId).toBe('contact_1');
    expect(entityResolution.resolveContact).toHaveBeenCalledWith(
      'biz_1',
      expect.objectContaining({
        source: 'meta_instagram_dm',
        externalId: 'legacy_user',
        firstName: 'Jane',
        lastName: 'Doe',
      }),
    );
    expect(createEngagement).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessId: 'biz_1',
          platform: 'INSTAGRAM',
          type: 'DM',
          fromUserId: 'legacy_user',
          fromUserName: 'Jane Doe',
          content: 'Legacy DM',
          externalId: 'legacy_1',
        }),
      }),
    );
  });

  it('deduplicates by externalMessageId', async () => {
    const { prisma, keyInbox, entityResolution, findMessage } = createMocks();
    findMessage.mockResolvedValue({
      id: 'msg_existing',
      threadId: 'thread_existing',
    });
    const service = new MetaSocialIngestionService(prisma, keyInbox, entityResolution);

    const payload = {
      object: 'page',
      entry: [
        {
          messaging: [
            {
              sender: { id: 'user_123' },
              timestamp: 1458692752478,
              message: { mid: 'mid.dupe', text: 'Dupe' },
            },
          ],
        },
      ],
    };

    const result = await service.receiveInbound('biz_1', payload);

    expect(result.messageId).toBe('msg_existing');
    expect(keyInbox.upsertThread).not.toHaveBeenCalled();
    expect(keyInbox.addMessage).not.toHaveBeenCalled();
  });

  it('throws on unrecognized payload', async () => {
    const { prisma, keyInbox, entityResolution } = createMocks();
    const service = new MetaSocialIngestionService(prisma, keyInbox, entityResolution);

    await expect(service.receiveInbound('biz_1', { foo: 'bar' })).rejects.toThrow(
      'Unrecognized Meta social webhook payload',
    );
  });
});
