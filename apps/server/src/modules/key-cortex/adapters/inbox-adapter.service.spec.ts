import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InboxAdapterService } from './inbox-adapter.service';
import { KeyInboxService } from '../../key-inbox/key-inbox.service';
import { KeyInboxIntelligenceService } from '../../key-inbox/key-inbox-intelligence.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ConnectorCommand } from '../key-cortex-connector.types';

const mkCmd = (action: string, parameters: Record<string, unknown> = {}): ConnectorCommand => ({
  module: 'inbox',
  action,
  parameters,
  businessId: 'biz_123',
  userId: 'user_456',
  source: 'key_cortex',
  timestamp: new Date(),
  correlationId: 'corr_001',
});

describe('InboxAdapterService', () => {
  let service: InboxAdapterService;
  let inbox: KeyInboxService;
  let intelligence: KeyInboxIntelligenceService;
  let prisma: { client: any };

  beforeEach(() => {
    inbox = {
      listThreads: vi.fn(),
      getThread: vi.fn(),
      addReply: vi.fn(),
      analyzeMessage: vi.fn(),
      analyzeThread: vi.fn(),
      updateThread: vi.fn(),
      generateBrief: vi.fn(),
    } as unknown as KeyInboxService;

    intelligence = {
      generateReport: vi.fn(),
    } as unknown as KeyInboxIntelligenceService;

    prisma = {
      client: {
        keyInboxThread: { count: vi.fn(), findMany: vi.fn() },
        keyInboxMessage: { updateMany: vi.fn(), findMany: vi.fn() },
      },
    };

    service = new InboxAdapterService(inbox, intelligence, prisma as unknown as PrismaService);
  });

  // ── Actions ───────────────────────────────────────────────────────────────

  it('get_threads delegates to listThreads', async () => {
    (inbox.listThreads as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 't1' }]);
    const result = await service.execute(mkCmd('get_threads', { status: 'OPEN' }));
    expect(result.success).toBe(true);
    expect(inbox.listThreads).toHaveBeenCalledWith('biz_123', expect.objectContaining({ status: 'OPEN' }));
  });

  it('send_reply delegates to addReply', async () => {
    (inbox.addReply as ReturnType<typeof vi.fn>).mockResolvedValue({ thread: { id: 't1' } });
    const result = await service.execute(mkCmd('send_reply', { threadId: 't1', body: 'Hello' }));
    expect(result.success).toBe(true);
    expect(inbox.addReply).toHaveBeenCalledWith('biz_123', 't1', 'Hello', undefined, { mode: 'send' });
  });

  it('classify_message analyzes and updates thread', async () => {
    (inbox.getThread as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 't1', messages: [{ id: 'm1' }] });
    (inbox.analyzeMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'm1', aiIntent: 'question' });
    (inbox.updateThread as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 't1' });
    const result = await service.execute(mkCmd('classify_message', { threadId: 't1', priority: 'high', assignTo: 'u1' }));
    expect(result.success).toBe(true);
    expect(inbox.updateThread).toHaveBeenCalledWith('biz_123', 't1', expect.objectContaining({ priority: 'HIGH', status: 'WAITING' }));
  });

  it('close_thread updates status DONE with resolution metadata', async () => {
    (inbox.updateThread as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 't1', status: 'DONE' });
    const result = await service.execute(mkCmd('close_thread', { threadId: 't1', resolution: 'Resolved' }));
    expect(result.success).toBe(true);
    expect(inbox.updateThread).toHaveBeenCalledWith('biz_123', 't1', expect.objectContaining({ status: 'DONE' }));
  });

  it('snooze_thread updates status WAITING with snooze metadata', async () => {
    (inbox.updateThread as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 't1', status: 'WAITING' });
    const result = await service.execute(mkCmd('snooze_thread', { threadId: 't1', until: '2026-07-02T10:00:00.000Z', reason: 'Awaiting reply' }));
    expect(result.success).toBe(true);
    expect(inbox.updateThread).toHaveBeenCalledWith('biz_123', 't1', expect.objectContaining({ status: 'WAITING' }));
  });

  it('assign_thread updates status WAITING with assignedTo metadata', async () => {
    (inbox.updateThread as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 't1', status: 'WAITING' });
    const result = await service.execute(mkCmd('assign_thread', { threadId: 't1', userId: 'u1' }));
    expect(result.success).toBe(true);
    expect(inbox.updateThread).toHaveBeenCalledWith('biz_123', 't1', expect.objectContaining({ status: 'WAITING', metadata: expect.objectContaining({ assignedTo: 'u1' }) }));
  });

  it('get_intelligence_report honors threadId', async () => {
    (inbox.analyzeThread as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 't1' });
    const result = await service.execute(mkCmd('get_intelligence_report', { threadId: 't1' }));
    expect(result.success).toBe(true);
    expect(inbox.analyzeThread).toHaveBeenCalledWith('biz_123', 't1');
  });

  it('merge_threads moves messages and archives duplicate', async () => {
    (inbox.getThread as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 't1' });
    (prisma.client.keyInboxMessage.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 2 });
    (inbox.updateThread as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 't2' });
    const result = await service.execute(mkCmd('merge_threads', { masterThreadId: 't1', duplicateThreadId: 't2' }));
    expect(result.success).toBe(true);
    expect(prisma.client.keyInboxMessage.updateMany).toHaveBeenCalled();
    expect(result.data).toMatchObject({ merged: true });
  });

  // ── Queries ───────────────────────────────────────────────────────────────

  it('get_unread_threads returns open threads', async () => {
    (inbox.listThreads as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 't1' }]);
    const result = await service.execute(mkCmd('get_unread_threads', { limit: 10 }));
    expect(result.success).toBe(true);
    expect(inbox.listThreads).toHaveBeenCalledWith('biz_123', expect.objectContaining({ status: 'OPEN' }));
  });

  it('get_thread_details returns thread', async () => {
    (inbox.getThread as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 't1', messages: [] });
    const result = await service.execute(mkCmd('get_thread_details', { threadId: 't1' }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 't1', messages: [] });
  });

  it('get_inbox_summary returns counts', async () => {
    (prisma.client.keyInboxThread.count as ReturnType<typeof vi.fn>).mockResolvedValueOnce(3).mockResolvedValueOnce(1).mockResolvedValueOnce(5);
    const result = await service.execute(mkCmd('get_inbox_summary', {}));
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ open: 3, waiting: 1, done: 5 });
  });

  it('get_classification_stats aggregates intents', async () => {
    (prisma.client.keyInboxThread.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { aiIntent: 'question' },
      { aiIntent: 'complaint' },
    ]);
    const result = await service.execute(mkCmd('get_classification_stats', {}));
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ intents: { question: 1, complaint: 1 }, total: 2 });
  });

  it('get_response_times returns average minutes', async () => {
    (prisma.client.keyInboxMessage.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const result = await service.execute(mkCmd('get_response_times', {}));
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ averageMinutes: 0, sampleSize: 0 });
  });

  it('returns connectorFail for unknown action', async () => {
    const result = await service.execute(mkCmd('nonexistent'));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown inbox action');
  });
});
