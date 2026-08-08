import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { WhatsAppService } from './whatsapp.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EntityResolutionService } from '../../core/connectors/entity-resolution.service';
import { KeyInboxService } from '../key-inbox/key-inbox.service';
import { StaffChatBridgeService } from '../structure/staff-chat-bridge.service';

function mockPrismaClient(overrides: Record<string, unknown> = {}) {
  return {
    client: {
      business: {
        findUnique: vi.fn().mockResolvedValue({ messageIntakeEnabled: false }),
      },
      keyInboxMessage: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      ...overrides,
    },
  };
}

function mockResolvedEntity(): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    contactId: 'contact_123',
    isNew: true,
    merged: false,
    matchedOn: 'phone',
  });
}

describe('WhatsAppService (B.5 KEYInbox ingestion)', () => {
  let service: WhatsAppService;
  let prisma: ReturnType<typeof mockPrismaClient>;
  let events: EventEmitter2;
  let keyInbox: {
    upsertThread: ReturnType<typeof vi.fn>;
    addMessage: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    prisma = mockPrismaClient();
    events = new EventEmitter2();
    vi.spyOn(events, 'emit');

    keyInbox = {
      upsertThread: vi.fn().mockResolvedValue({ id: 'thread_123' }),
      addMessage: vi.fn().mockResolvedValue({ thread: { id: 'thread_123' }, message: { id: 'msg_123' } }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WhatsAppService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: events },
        { provide: EntityResolutionService, useValue: { resolveContact: mockResolvedEntity() } },
        { provide: KeyInboxService, useValue: keyInbox },
        // These tests are all about the customer-contact intake path; every
        // inbound number here is a customer, so the staff bridge never matches.
        { provide: StaffChatBridgeService, useValue: { routeInboundMessage: vi.fn().mockResolvedValue({ handled: false }) } },
      ],
    }).compile();

    service = moduleRef.get(WhatsAppService);
  });

  it('ingests a Twilio inbound message into KEYInbox', async () => {
    const result = await service.receiveInbound('biz_123', {
      from: '+18681234567',
      body: 'Hi, I want to book an appointment',
      senderName: 'Jane Doe',
      externalId: 'SMtwilio123',
      provider: 'twilio',
      rawPayload: { From: '+18681234567', Body: 'Hi, I want to book an appointment' },
    });

    expect(result.contactId).toBe('contact_123');
    expect(keyInbox.upsertThread).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz_123',
        channel: 'whatsapp',
        externalThreadId: '+18681234567',
        contactId: 'contact_123',
        subject: 'Hi, I want to book an appointment',
      }),
    );
    expect(keyInbox.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz_123',
        threadId: 'thread_123',
        channel: 'whatsapp',
        direction: 'INBOUND',
        senderName: 'Jane Doe',
        senderPhone: '+18681234567',
        contentText: 'Hi, I want to book an appointment',
        externalMessageId: 'SMtwilio123',
      }),
    );
  });

  it('ingests a Meta inbound message into KEYInbox', async () => {
    await service.receiveInbound('biz_123', {
      from: '18681234567',
      body: 'Do you deliver to Port of Spain?',
      senderName: 'John Smith',
      externalId: 'wamid.meta456',
      provider: 'meta',
      receivedAt: new Date('2030-01-01T12:00:00Z'),
    });

    expect(keyInbox.upsertThread).toHaveBeenCalledWith(
      expect.objectContaining({
        externalThreadId: '+18681234567',
        contactId: 'contact_123',
      }),
    );
    expect(keyInbox.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        senderPhone: '+18681234567',
        contentText: 'Do you deliver to Port of Spain?',
        externalMessageId: 'wamid.meta456',
        receivedAt: new Date('2030-01-01T12:00:00Z'),
      }),
    );
  });

  it('deduplicates KEYInbox messages by externalMessageId', async () => {
    prisma.client.keyInboxMessage.findFirst = vi.fn().mockResolvedValue({ id: 'existing_msg' });

    await service.receiveInbound('biz_123', {
      from: '+18681234567',
      body: 'Duplicate message',
      externalId: 'SMdup789',
      provider: 'twilio',
    });

    expect(keyInbox.upsertThread).not.toHaveBeenCalled();
    expect(keyInbox.addMessage).not.toHaveBeenCalled();
  });

  it('emits message.intake.received when intake is enabled and still writes to KEYInbox', async () => {
    prisma.client.business.findUnique = vi.fn().mockResolvedValue({ messageIntakeEnabled: true });

    await service.receiveInbound('biz_123', {
      from: '+18681234567',
      body: 'Intake enabled message',
      externalId: 'SMintake001',
      provider: 'twilio',
    });

    expect(events.emit).toHaveBeenCalledWith(
      'message.intake.received',
      expect.objectContaining({ businessId: 'biz_123', from: '+18681234567' }),
    );
    expect(keyInbox.upsertThread).toHaveBeenCalled();
    expect(keyInbox.addMessage).toHaveBeenCalled();
  });

  it('emits message.received when intake is disabled', async () => {
    await service.receiveInbound('biz_123', {
      from: '+18681234567',
      body: 'Intake disabled message',
      externalId: 'SMnormal002',
      provider: 'twilio',
    });

    expect(events.emit).toHaveBeenCalledWith(
      'message.received',
      expect.objectContaining({ businessId: 'biz_123', channel: 'whatsapp', from: '+18681234567' }),
    );
  });

  it('skips KEYInbox ingest when externalId is missing', async () => {
    await service.receiveInbound('biz_123', {
      from: '+18681234567',
      body: 'No external id',
    });

    expect(keyInbox.upsertThread).not.toHaveBeenCalled();
    expect(keyInbox.addMessage).not.toHaveBeenCalled();
  });
});
