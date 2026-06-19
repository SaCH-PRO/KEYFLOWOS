import { describe, expect, it, vi } from 'vitest';
import { KeyInboxActionExecutorService } from './key-inbox-action-executor.service';
import { KeyInboxService } from './key-inbox.service';
import { PrismaService } from '../../core/prisma/prisma.service';

function createMocks() {
  const threadUpdate = vi.fn().mockResolvedValue({ id: 'thread_1' });
  const contactCreate = vi.fn().mockResolvedValue({ id: 'contact_new' });
  const taskCreate = vi.fn().mockResolvedValue({ id: 'task_1' });
  const addMessage = vi.fn().mockResolvedValue({ thread: { id: 'thread_1' }, message: { id: 'msg_out_1' } });

  const prisma = {
    client: {
      keyInboxThread: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'thread_1',
          businessId: 'biz_1',
          channel: 'whatsapp',
          contactId: 'contact_1',
          messages: [{ id: 'msg_1', senderName: 'Alice', senderEmail: 'alice@example.com' }],
        }),
        update: threadUpdate,
      },
      contact: { create: contactCreate },
      contactTask: { create: taskCreate },
    },
  } as unknown as PrismaService;

  const keyInbox = {
    addMessage,
  } as unknown as KeyInboxService;

  return { prisma, keyInbox, threadUpdate, contactCreate, taskCreate, addMessage };
}

describe('KeyInboxActionExecutorService', () => {
  it('creates a task when contact exists', async () => {
    const { prisma, keyInbox, taskCreate } = createMocks();
    const service = new KeyInboxActionExecutorService(prisma, keyInbox);

    const result = await service.execute('biz_1', 'thread_1', {
      type: 'create_task',
      label: 'Follow up',
      confidence: 0.9,
      payload: { title: 'Call Alice' },
    });

    expect(result.success).toBe(true);
    expect(result.entityType).toBe('ContactTask');
    expect(taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ businessId: 'biz_1', contactId: 'contact_1', title: 'Call Alice' }) }),
    );
  });

  it('creates a contact when thread has none', async () => {
    const { prisma, keyInbox, contactCreate, threadUpdate } = createMocks();
    (prisma.client.keyInboxThread.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'thread_1',
      businessId: 'biz_1',
      channel: 'whatsapp',
      contactId: null,
      messages: [{ id: 'msg_1', senderName: 'Alice Smith', senderEmail: 'alice@example.com', senderPhone: '+123' }],
    });

    const service = new KeyInboxActionExecutorService(prisma, keyInbox);
    const result = await service.execute('biz_1', 'thread_1', {
      type: 'create_contact',
      label: 'Create contact',
      confidence: 0.9,
    });

    expect(result.success).toBe(true);
    expect(result.entityType).toBe('Contact');
    expect(contactCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ businessId: 'biz_1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com', phone: '+123' }),
      }),
    );
    expect(threadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contactId: 'contact_new' }) }),
    );
  });

  it('escalates a thread', async () => {
    const { prisma, keyInbox, threadUpdate } = createMocks();
    const service = new KeyInboxActionExecutorService(prisma, keyInbox);

    const result = await service.execute('biz_1', 'thread_1', {
      type: 'escalate',
      label: 'Escalate',
      confidence: 0.9,
    });

    expect(result.success).toBe(true);
    expect(threadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ priority: 'URGENT', status: 'WAITING' }) }),
    );
  });

  it('saves a draft reply as outbound message', async () => {
    const { prisma, keyInbox, addMessage } = createMocks();
    const service = new KeyInboxActionExecutorService(prisma, keyInbox);

    const result = await service.execute('biz_1', 'thread_1', {
      type: 'draft_reply',
      label: 'Draft reply',
      confidence: 0.9,
      payload: { draft: 'Thanks, we will get back to you.' },
    });

    expect(result.success).toBe(true);
    expect(result.entityType).toBe('KeyInboxMessage');
    expect(addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz_1',
        threadId: 'thread_1',
        channel: 'whatsapp',
        direction: 'OUTBOUND',
        contentText: 'Thanks, we will get back to you.',
      }),
    );
  });

  it('returns a deep-link for create_invoice', async () => {
    const { prisma, keyInbox } = createMocks();
    const service = new KeyInboxActionExecutorService(prisma, keyInbox);

    const result = await service.execute('biz_1', 'thread_1', {
      type: 'create_invoice',
      label: 'Create invoice',
      confidence: 0.9,
    });

    expect(result.success).toBe(true);
    expect(result.redirectUrl).toContain('/app/financial-flow');
    expect(result.redirectUrl).toContain('createInvoice=1');
    expect(result.redirectUrl).toContain('contactId=contact_1');
  });
});
