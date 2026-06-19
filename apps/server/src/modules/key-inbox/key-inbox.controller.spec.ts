import { describe, expect, it, vi } from 'vitest';
import { KeyInboxController } from './key-inbox.controller';
import { KeyInboxService } from './key-inbox.service';
import { KeyInboxActionExecutorService } from './key-inbox-action-executor.service';
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

    const controller = new KeyInboxController(keyInbox, executor, businessEvents);
    return { controller, keyInbox, executor, businessEvents };
  }

  it('lists threads with filters', async () => {
    const { controller, keyInbox } = makeController();
    const result = await controller.listThreads('biz_1', 'whatsapp', 'OPEN', 'HIGH', 'lead_inquiry', 'urgent', 'positive', 'hello');

    expect(result).toEqual([{ id: 'thread_1' }]);
    expect(keyInbox.listThreads).toHaveBeenCalledWith('biz_1', {
      channel: 'whatsapp',
      status: 'OPEN',
      priority: 'HIGH',
      intent: 'lead_inquiry',
      urgency: 'urgent',
      sentiment: 'positive',
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
    const result = await controller.reply('biz_1', 'thread_1', { contentText: 'Reply text' });

    expect(result.message.id).toBe('msg_reply');
    expect(keyInbox.addReply).toHaveBeenCalledWith('biz_1', 'thread_1', 'Reply text', []);
  });

  it('executes a suggested action', async () => {
    const { controller, executor, businessEvents } = makeController();
    const result = await controller.executeAction('biz_1', 'thread_1', '0', { actionIndex: '0' });

    expect(result.success).toBe(true);
    expect(executor.execute).toHaveBeenCalledWith(
      'biz_1',
      'thread_1',
      { type: 'create_task', label: 'Task', confidence: 0.9 },
      { messageId: 'msg_1' },
    );
    expect(businessEvents.emit).toHaveBeenCalled();
  });

  it('returns a timeline', async () => {
    const { controller, businessEvents } = makeController();
    const result = await controller.getTimeline('biz_1', 'thread_1');

    expect(result).toEqual([{ id: 'evt_1' }]);
    expect(businessEvents.getTimeline).toHaveBeenCalledWith('KeyInboxThread', 'thread_1');
  });
});
