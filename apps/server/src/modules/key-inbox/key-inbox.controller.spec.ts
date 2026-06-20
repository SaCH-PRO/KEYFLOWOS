import { describe, expect, it, vi } from 'vitest';
import { KeyInboxController } from './key-inbox.controller';
import { KeyInboxService } from './key-inbox.service';
import { KeyInboxActionExecutorService } from './key-inbox-action-executor.service';
import { KeyInboxIntelligenceService } from './key-inbox-intelligence.service';
import { BusinessEventService } from '../business-events/business-event.service';

describe('KeyInboxController', () => {
  function makeController() {
    const keyInbox = {
      listThreads: vi.fn().mockResolvedValue([{ id: 'thread_1' }]),
      getThread: vi.fn().mockResolvedValue({
        id: 'thread_1',
        messages: [{ id: 'msg_1', suggestedActions: [{ type: 'create_task', label: 'Task', confidence: 0.9 }] }],
      }),
      updateThread: vi.fn().mockResolvedValue({ id: 'thread_1', status: 'DONE' }),
      addReply: vi.fn().mockResolvedValue({ thread: { id: 'thread_1' }, message: { id: 'msg_reply' } }),
      analyzeThread: vi.fn().mockResolvedValue({ id: 'thread_1' }),
      generateBrief: vi.fn().mockResolvedValue({ id: 'insight_1' }),
      listInsights: vi.fn().mockResolvedValue([]),
    } as unknown as KeyInboxService;

    const executor = {
      execute: vi.fn().mockResolvedValue({ type: 'create_task', success: true, message: 'Task created', entityId: 'task_1' }),
    } as unknown as KeyInboxActionExecutorService;

    const businessEvents = {
      emit: vi.fn().mockResolvedValue(undefined),
      getTimeline: vi.fn().mockResolvedValue([{ id: 'evt_1' }]),
    } as unknown as BusinessEventService;

    const intelligence = {
      generateReport: vi.fn().mockResolvedValue({ id: 'intel_1', scope: 'WEEKLY' }),
      getLatestReport: vi.fn().mockResolvedValue({ id: 'intel_1', scope: 'WEEKLY' }),
      listReports: vi.fn().mockResolvedValue([{ id: 'intel_1', scope: 'WEEKLY' }]),
      getReport: vi.fn().mockResolvedValue({ id: 'intel_1', scope: 'WEEKLY' }),
    } as unknown as KeyInboxIntelligenceService;

    const controller = new KeyInboxController(keyInbox, executor, intelligence, businessEvents);
    return { controller, keyInbox, executor, intelligence, businessEvents };
  }

  it('lists threads with filters', async () => {
    const { controller, keyInbox } = makeController();
    const result = await controller.listThreads('biz_1', 'whatsapp', 'OPEN', 'HIGH', 'lead_inquiry', 'urgent', 'positive', undefined, 'hello');

    expect(result).toEqual([{ id: 'thread_1' }]);
    expect(keyInbox.listThreads).toHaveBeenCalledWith('biz_1', {
      channel: 'whatsapp',
      status: 'OPEN',
      priority: 'HIGH',
      intent: 'lead_inquiry',
      urgency: 'urgent',
      sentiment: 'positive',
      sendStatus: undefined,
      search: 'hello',
      limit: undefined,
      offset: undefined,
    });
  });

  it('updates a thread', async () => {
    const { controller, keyInbox } = makeController();
    const result = await controller.updateThread('biz_1', 'thread_1', { status: 'DONE', priority: 'LOW' });

    expect(result.status).toBe('DONE');
    expect(keyInbox.updateThread).toHaveBeenCalledWith('biz_1', 'thread_1', { status: 'DONE', priority: 'LOW' });
  });

  it('adds a reply', async () => {
    const { controller, keyInbox } = makeController();
    const result = await controller.reply('biz_1', 'thread_1', { contentText: 'Reply text' }, { user: { id: 'user_1' } } as any);

    expect(result.message.id).toBe('msg_reply');
    expect(keyInbox.addReply).toHaveBeenCalledWith('biz_1', 'thread_1', 'Reply text', [], { mode: 'draft', userId: 'user_1' });
  });

  it('executes a suggested action', async () => {
    const { controller, executor, businessEvents } = makeController();
    const result = await controller.executeAction('biz_1', 'thread_1', '0', { confirmed: true }, { user: { id: 'user_1' } } as any);

    expect(result.success).toBe(true);
    expect(executor.execute).toHaveBeenCalledWith(
      'biz_1',
      'thread_1',
      { type: 'create_task', label: 'Task', confidence: 0.9, payload: {} },
      { messageId: 'msg_1', userId: 'user_1' },
    );
    expect(businessEvents.emit).toHaveBeenCalled();
  });

  it('returns a timeline', async () => {
    const { controller, businessEvents } = makeController();
    const result = await controller.getTimeline('biz_1', 'thread_1');

    expect(result).toEqual([{ id: 'evt_1' }]);
    expect(businessEvents.getTimeline).toHaveBeenCalledWith('KeyInboxThread', 'thread_1');
  });

  it('generates intelligence report', async () => {
    const { controller, intelligence } = makeController();
    const result = await controller.generateIntelligence('biz_1', { scope: 'WEEKLY' }, { user: { id: 'user_1' } } as any);

    expect(result.id).toBe('intel_1');
    expect(intelligence.generateReport).toHaveBeenCalledWith('biz_1', { scope: 'WEEKLY' }, 'user_1');
  });

  it('gets latest intelligence report', async () => {
    const { controller, intelligence } = makeController();
    const result = await controller.getLatestIntelligence('biz_1', 'DAILY');

    expect(result.id).toBe('intel_1');
    expect(intelligence.getLatestReport).toHaveBeenCalledWith('biz_1', 'DAILY');
  });

  it('lists intelligence reports', async () => {
    const { controller, intelligence } = makeController();
    const result = await controller.listIntelligence('biz_1', 'MONTHLY', '10');

    expect(result).toEqual([{ id: 'intel_1', scope: 'WEEKLY' }]);
    expect(intelligence.listReports).toHaveBeenCalledWith('biz_1', 'MONTHLY', 10);
  });

  it('gets intelligence report by id', async () => {
    const { controller, intelligence } = makeController();
    const result = await controller.getIntelligence('biz_1', 'intel_1');

    expect(result.id).toBe('intel_1');
    expect(intelligence.getReport).toHaveBeenCalledWith('biz_1', 'intel_1');
  });
});
