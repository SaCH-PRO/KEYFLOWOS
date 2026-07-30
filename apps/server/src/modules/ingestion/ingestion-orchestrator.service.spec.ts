import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IngestionOrchestrator } from './ingestion-orchestrator.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EntityResolutionService } from '../../core/connectors/entity-resolution.service';
import { AiOversightService } from '../ai/ai-oversight.service';
import { DriveIntakeOrchestrator } from '../commerce/drive-intake-orchestrator.service';
import { KeyInboxService } from '../key-inbox/key-inbox.service';
import { KeyInboxActionExecutorService } from '../key-inbox/key-inbox-action-executor.service';
import { IngestionItemInput } from '../../core/connectors/connector.interface';

describe('IngestionOrchestrator', () => {
  let service: IngestionOrchestrator;
  let prisma: {
    client: {
      ingestionItem: {
        findUnique: ReturnType<typeof vi.fn>;
        findFirst: ReturnType<typeof vi.fn>;
        create: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
      };
      keyInboxMessage: {
        findUnique: ReturnType<typeof vi.fn>;
      };
      connectorStatus: {
        findUnique: ReturnType<typeof vi.fn>;
      };
    };
  };
  let keyInbox: {
    upsertThread: ReturnType<typeof vi.fn>;
    addMessage: ReturnType<typeof vi.fn>;
    analyzeMessage: ReturnType<typeof vi.fn>;
    analyzeThread: ReturnType<typeof vi.fn>;
  };
  let entityResolution: { resolveContact: ReturnType<typeof vi.fn> };
  let governance: { createApprovalItem: ReturnType<typeof vi.fn> };
  let keyInboxActionExecutor: { execute: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    prisma = {
      client: {
        ingestionItem: {
          findUnique: vi.fn(),
          findFirst: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
        },
        keyInboxMessage: {
          findUnique: vi.fn(),
        },
        connectorStatus: {
          findUnique: vi.fn(),
        },
      },
    };
    keyInbox = {
      upsertThread: vi.fn(),
      addMessage: vi.fn(),
      analyzeMessage: vi.fn(),
      analyzeThread: vi.fn(),
    };
    entityResolution = { resolveContact: vi.fn() };
    governance = { createApprovalItem: vi.fn() };
    keyInboxActionExecutor = { execute: vi.fn() };

    service = new IngestionOrchestrator(
      prisma as unknown as PrismaService,
      entityResolution as unknown as EntityResolutionService,
      governance as unknown as AiOversightService,
      {} as DriveIntakeOrchestrator,
      keyInbox as unknown as KeyInboxService,
      keyInboxActionExecutor as unknown as KeyInboxActionExecutorService,
    );
  });

  it('routes message sources through Key Inbox instead of legacy MessageIntake', async () => {
    const input: IngestionItemInput = {
      sourceType: 'email',
      sourceConnectorType: 'gmail',
      externalId: 'msg_1',
      from: { id: 'contact_1', name: 'Alice', email: 'alice@example.com' },
      subject: 'Invoice request',
      body: 'Please send me an invoice.',
      rawPayload: { id: 'msg_1' },
    };

    entityResolution.resolveContact.mockResolvedValue({
      contactId: 'contact_1',
      matchedOn: 'email',
      isNew: false,
      merged: false,
    });

    prisma.client.ingestionItem.create.mockResolvedValue({
      id: 'item_1',
      businessId: 'biz_1',
      sourceType: 'email',
      sourceConnectorType: 'gmail',
      externalId: 'msg_1',
      fromEmail: 'alice@example.com',
      fromPhone: null,
      fromName: 'Alice',
      fromExternalId: 'contact_1',
      toDestination: null,
      subject: 'Invoice request',
      body: 'Please send me an invoice.',
      rawPayload: { id: 'msg_1' },
      contactId: 'contact_1',
      receivedAt: new Date(),
    });

    prisma.client.ingestionItem.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        id: 'item_1',
        businessId: 'biz_1',
      sourceType: 'email',
      sourceConnectorType: 'gmail',
      externalId: 'msg_1',
      fromEmail: 'alice@example.com',
      fromPhone: null,
      fromName: 'Alice',
      fromExternalId: 'contact_1',
      toDestination: null,
      subject: 'Invoice request',
      body: 'Please send me an invoice.',
      rawPayload: { id: 'msg_1' },
      contactId: 'contact_1',
      receivedAt: new Date(),
    });

    keyInbox.upsertThread.mockResolvedValue({ id: 'thread_1' });
    keyInbox.addMessage.mockResolvedValue({
      thread: { id: 'thread_1' },
      message: { id: 'message_1' },
    });
    keyInbox.analyzeMessage.mockResolvedValue({ id: 'message_1' });
    keyInbox.analyzeThread.mockResolvedValue({
      id: 'thread_1',
      aiSummary: 'Invoice request from Alice',
      aiIntent: 'invoice_request',
      aiUrgency: 'high',
    });
    prisma.client.keyInboxMessage.findUnique.mockResolvedValue({
      id: 'message_1',
      aiConfidence: 0.85,
      extractedEntities: { contacts: ['Alice'] },
      suggestedActions: [{ type: 'create_invoice', label: 'Create invoice', confidence: 0.9 }],
    });
    prisma.client.connectorStatus.findUnique.mockResolvedValue({
      businessId: 'biz_1',
      connectorType: 'gmail',
      intakeEnabled: true,
      autoApproveThreshold: null,
    });

    const result = await service.receive(input, 'biz_1');

    expect(result.id).toBe('item_1');
    expect(keyInbox.upsertThread).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz_1',
        channel: 'email',
        externalThreadId: 'alice@example.com',
        contactId: 'contact_1',
      }),
    );
    expect(keyInbox.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz_1',
        threadId: 'thread_1',
        channel: 'email',
        direction: 'INBOUND',
        externalMessageId: 'msg_1',
        skipAnalysis: true,
      }),
    );
    expect(keyInbox.analyzeMessage).toHaveBeenCalledWith('biz_1', 'message_1');
    expect(keyInbox.analyzeThread).toHaveBeenCalledWith('biz_1', 'thread_1');
    expect(prisma.client.ingestionItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'item_1' },
        data: expect.objectContaining({
          status: 'reviewing',
          intentType: 'invoice_request',
          confidence: 0.9,
        }),
      }),
    );
    expect(governance.createApprovalItem).toHaveBeenCalled();
  });

  it('skips duplicate ingestion items', async () => {
    const input: IngestionItemInput = {
      sourceType: 'email',
      from: { email: 'alice@example.com' },
      rawPayload: {},
    };

    prisma.client.ingestionItem.findUnique.mockResolvedValue({ id: 'item_existing' });

    const result = await service.receive(input, 'biz_1');

    expect(result.id).toBe('item_existing');
    expect(prisma.client.ingestionItem.create).not.toHaveBeenCalled();
    expect(keyInbox.addMessage).not.toHaveBeenCalled();
  });

  it('rejects items when connector intake is disabled', async () => {
    const input: IngestionItemInput = {
      sourceType: 'email',
      sourceConnectorType: 'gmail',
      from: { email: 'alice@example.com' },
      rawPayload: {},
    };

    entityResolution.resolveContact.mockResolvedValue({ contactId: 'contact_1' });
    prisma.client.ingestionItem.create.mockResolvedValue({ id: 'item_1' });
    prisma.client.connectorStatus.findUnique.mockResolvedValue({
      businessId: 'biz_1',
      connectorType: 'gmail',
      intakeEnabled: false,
      autoApproveThreshold: null,
    });
    prisma.client.ingestionItem.update.mockResolvedValue({ id: 'item_1', status: 'rejected' });

    const result = await service.receive(input, 'biz_1');

    expect(result.status).toBe('rejected');
    expect(keyInbox.addMessage).not.toHaveBeenCalled();
    expect(prisma.client.ingestionItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'item_1' },
        data: expect.objectContaining({ status: 'rejected' }),
      }),
    );
  });

  it('auto-executes reviewing items when confidence meets connector autoApproveThreshold', async () => {
    const input: IngestionItemInput = {
      sourceType: 'email',
      sourceConnectorType: 'gmail',
      from: { email: 'alice@example.com' },
      rawPayload: {},
    };

    entityResolution.resolveContact.mockResolvedValue({ contactId: 'contact_1' });
    prisma.client.ingestionItem.create.mockResolvedValue({ id: 'item_1' });
    prisma.client.connectorStatus.findUnique.mockResolvedValue({
      businessId: 'biz_1',
      connectorType: 'gmail',
      intakeEnabled: true,
      autoApproveThreshold: 0.75,
    });

    keyInbox.upsertThread.mockResolvedValue({ id: 'thread_1' });
    keyInbox.addMessage.mockResolvedValue({ thread: { id: 'thread_1' }, message: { id: 'message_1' } });
    keyInbox.analyzeMessage.mockResolvedValue({ id: 'message_1' });
    keyInbox.analyzeThread.mockResolvedValue({ id: 'thread_1', aiSummary: 'Invoice request', aiIntent: 'invoice_request' });
    prisma.client.keyInboxMessage.findUnique.mockResolvedValue({
      id: 'message_1',
      aiConfidence: 0.9,
      extractedEntities: {},
      suggestedActions: [{ type: 'create_invoice', label: 'Create invoice', confidence: 0.9 }],
    });

    const reviewingItem = {
      id: 'item_1',
      businessId: 'biz_1',
      sourceType: 'email',
      status: 'reviewing',
      confidence: 0.9,
      proposedActions: [{ type: 'create_invoice', label: 'Create invoice', confidence: 0.9 }],
      extractedData: { _keyInboxThreadId: 'thread_1', _keyInboxMessageId: 'message_1' },
    };

    prisma.client.ingestionItem.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(reviewingItem)
      .mockResolvedValueOnce(reviewingItem)
      .mockResolvedValueOnce(reviewingItem);

    prisma.client.ingestionItem.update.mockResolvedValue({
      id: 'item_1',
      businessId: 'biz_1',
      sourceType: 'email',
      status: 'approved',
    });

    keyInboxActionExecutor.execute.mockResolvedValue({ success: true, actionType: 'create_invoice' });

    const result = await service.receive(input, 'biz_1');

    expect(keyInboxActionExecutor.execute).toHaveBeenCalled();
    expect(result.status).toBe('approved');
  });

  it('does not auto-execute when confidence is below connector autoApproveThreshold', async () => {
    const input: IngestionItemInput = {
      sourceType: 'email',
      sourceConnectorType: 'gmail',
      from: { email: 'alice@example.com' },
      rawPayload: {},
    };

    entityResolution.resolveContact.mockResolvedValue({ contactId: 'contact_1' });
    prisma.client.ingestionItem.create.mockResolvedValue({ id: 'item_1' });
    prisma.client.connectorStatus.findUnique.mockResolvedValue({
      businessId: 'biz_1',
      connectorType: 'gmail',
      intakeEnabled: true,
      autoApproveThreshold: 0.95,
    });

    keyInbox.upsertThread.mockResolvedValue({ id: 'thread_1' });
    keyInbox.addMessage.mockResolvedValue({ thread: { id: 'thread_1' }, message: { id: 'message_1' } });
    keyInbox.analyzeMessage.mockResolvedValue({ id: 'message_1' });
    keyInbox.analyzeThread.mockResolvedValue({ id: 'thread_1', aiSummary: 'Question', aiIntent: 'question' });
    prisma.client.keyInboxMessage.findUnique.mockResolvedValue({
      id: 'message_1',
      aiConfidence: 0.6,
      extractedEntities: {},
      suggestedActions: [{ type: 'draft_reply', label: 'Draft reply', confidence: 0.6 }],
    });

    prisma.client.ingestionItem.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        id: 'item_1',
        businessId: 'biz_1',
        sourceType: 'email',
        status: 'reviewing',
        confidence: 0.6,
        proposedActions: [{ type: 'draft_reply', label: 'Draft reply', confidence: 0.6 }],
      });

    const result = await service.receive(input, 'biz_1');

    expect(keyInboxActionExecutor.execute).not.toHaveBeenCalled();
    expect(result.status).toBe('reviewing');
  });

  it('execute() uses actions corrected via correct()', async () => {
    const correctedActions = [{ type: 'create_task', label: 'Create task', confidence: 0.9 }];

    prisma.client.ingestionItem.findUnique
      .mockResolvedValueOnce({
        id: 'item_1',
        businessId: 'biz_1',
        sourceType: 'email',
        status: 'reviewing',
        proposedActions: correctedActions,
        extractedData: { _keyInboxThreadId: 'thread_1', _keyInboxMessageId: 'message_1' },
      })
      .mockResolvedValue({
        id: 'item_1',
        status: 'reviewing',
        proposedActions: correctedActions,
        extractedData: { _keyInboxThreadId: 'thread_1', _keyInboxMessageId: 'message_1' },
      });

    keyInboxActionExecutor.execute.mockResolvedValue({ success: true, actionType: 'create_task' });

    await service.execute('item_1', 'user_1');

    expect(keyInboxActionExecutor.execute).toHaveBeenCalledWith(
      'biz_1',
      'thread_1',
      expect.objectContaining({ type: 'create_task' }),
      expect.objectContaining({ messageId: 'message_1', userId: 'user_1' }),
    );
  });
});
