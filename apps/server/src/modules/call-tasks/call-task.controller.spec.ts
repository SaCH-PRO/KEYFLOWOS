import { describe, expect, it, vi } from 'vitest';
import { CallTaskController } from './call-task.controller';
import { CallLogService } from './call-log.service';

describe('CallTaskController', () => {
  function createMockService(): CallLogService {
    return {
      createCallLog: vi.fn(async (input) => ({ id: 'cl_1', ...input, createdAt: new Date() })),
      getCallLog: vi.fn(async (id) => ({ id, businessId: 'biz_1', callerId: 'user_1', createdAt: new Date() })),
      listCalls: vi.fn(async () => ({ items: [], total: 0, offset: 0, limit: 50 })),
      updateCallLog: vi.fn(async (id, data) => ({ id, ...data, createdAt: new Date() })),
      completeCall: vi.fn(async (id, data) => ({ id, ...data, completedAt: new Date() })),
      getScheduledCalls: vi.fn(async () => []),
      createFollowUpTask: vi.fn(async () => ({ id: 'ct_1', title: 'Follow up', status: 'OPEN' })),
      createFromContactNextAction: vi.fn(async () => ({ id: 'cl_2', contactId: 'c1', createdAt: new Date() })),
      deleteCallLog: vi.fn(async () => ({ success: true })),
    } as any;
  }

  it('creates a call log', async () => {
    const svc = createMockService();
    const ctrl = new CallTaskController(svc);

    const result = await ctrl.create('biz_1', {
      businessId: 'biz_1',
      callerId: 'user_1',
      contactId: 'c1',
      scheduledAt: '2026-05-20T10:00:00Z',
    } as any, { user: { id: 'user_1' } } as any);

    expect(result.businessId).toBe('biz_1');
    expect(svc.createCallLog).toHaveBeenCalled();
  });

  it('lists calls', async () => {
    const svc = createMockService();
    const ctrl = new CallTaskController(svc);

    const result = await ctrl.list('biz_1', {} as any);
    expect(result.total).toBe(0);
    expect(svc.listCalls).toHaveBeenCalledWith('biz_1', expect.any(Object));
  });

  it('gets call by id', async () => {
    const svc = createMockService();
    const ctrl = new CallTaskController(svc);

    const result = await ctrl.getById('cl_1');
    expect(result.id).toBe('cl_1');
  });

  it('updates a call', async () => {
    const svc = createMockService();
    const ctrl = new CallTaskController(svc);

    const result = await ctrl.update('cl_1', { notes: 'Updated' });
    expect(svc.updateCallLog).toHaveBeenCalledWith('cl_1', { notes: 'Updated' });
  });

  it('completes a call', async () => {
    const svc = createMockService();
    const ctrl = new CallTaskController(svc);

    const result = await ctrl.complete('cl_1', {
      outcome: 'reached',
      duration: 120,
    } as any, { user: { id: 'user_1' } } as any);

    expect(svc.completeCall).toHaveBeenCalledWith('cl_1', expect.any(Object), 'user_1');
  });

  it('creates follow-up task', async () => {
    const svc = createMockService();
    const ctrl = new CallTaskController(svc);

    const result = await ctrl.createFollowUp('cl_1', {
      title: 'Send email',
    } as any, { user: { id: 'user_1' } } as any);

    expect(svc.createFollowUpTask).toHaveBeenCalledWith('cl_1', expect.any(Object), 'user_1');
  });

  it('deletes a call', async () => {
    const svc = createMockService();
    const ctrl = new CallTaskController(svc);

    const result = await ctrl.delete('cl_1');
    expect(result.success).toBe(true);
  });

  it('gets scheduled calls for today', async () => {
    const svc = createMockService();
    const ctrl = new CallTaskController(svc);

    await ctrl.getScheduledToday('biz_1', 'user_1');
    expect(svc.getScheduledCalls).toHaveBeenCalledWith('biz_1', 'user_1', expect.any(Date));
  });

  it('creates from next action', async () => {
    const svc = createMockService();
    const ctrl = new CallTaskController(svc);

    const result = await ctrl.createFromNextAction('biz_1', 'c1', {}, { user: { id: 'user_1' } } as any);
    expect(svc.createFromContactNextAction).toHaveBeenCalledWith('c1', 'user_1', undefined);
  });
});
