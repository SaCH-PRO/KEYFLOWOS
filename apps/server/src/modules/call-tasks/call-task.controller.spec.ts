import { describe, expect, it, vi } from 'vitest';
import { CallTaskController } from './call-task.controller';
import { CallLogService } from './call-log.service';
import { CallScriptService } from './call-script.service';

describe('CallTaskController', () => {
  function createMockService(): CallLogService {
    return {
      createCallLog: vi.fn(async (input) => ({ id: 'cl_1', ...input, createdAt: new Date() })),
      getCallLog: vi.fn(async (businessId, id) => ({ id, businessId, callerId: 'user_1', contactId: 'c1', createdAt: new Date() })),
      // V1-84: the call log as the session member may open it, and the contact check of a write
      getVisibleCallLog: vi.fn(async (businessId, id) => ({ id, businessId, callerId: 'user_1', contactId: 'c1', createdAt: new Date() })),
      assertContactVisibleTo: vi.fn(async () => undefined),
      listCalls: vi.fn(async () => ({ items: [], total: 0, offset: 0, limit: 50 })),
      updateCallLog: vi.fn(async (_businessId, id, data) => ({ id, ...data, createdAt: new Date() })),
      completeCall: vi.fn(async (_businessId, id, data) => ({ id, ...data, completedAt: new Date() })),
      getScheduledCalls: vi.fn(async () => []),
      createFollowUpTask: vi.fn(async () => ({ id: 'ct_1', title: 'Follow up', status: 'OPEN' })),
      createFromContactNextAction: vi.fn(async () => ({ id: 'cl_2', contactId: 'c1', createdAt: new Date() })),
      deleteCallLog: vi.fn(async () => ({ success: true })),
    } as any;
  }

  function createMockScriptService(): CallScriptService {
    return {
      generateScript: vi.fn(async () => ({
        greeting: 'Hi there!',
        talkingPoints: ['How are you?', 'Wanted to follow up'],
        ask: 'Are you ready to move forward?',
        close: 'Thanks for your time!',
        durationEstimate: 5,
      })),
    } as any;
  }

  // The session member every handler reads and writes for (V1-54 caller, V1-84 viewer).
  const req = { user: { id: 'user_1' } } as any;
  const viewer = { userId: 'user_1', role: null };

  it('creates a call log', async () => {
    const svc = createMockService();
    const scriptSvc = createMockScriptService();
    const ctrl = new CallTaskController(svc, scriptSvc);

    const result = await ctrl.create('biz_1', {
      businessId: 'biz_1',
      callerId: 'user_1',
      contactId: 'c1',
      scheduledAt: '2026-05-20T10:00:00Z',
    } as any, { user: { id: 'user_1' } } as any);

    expect(result.businessId).toBe('biz_1');
    expect(svc.assertContactVisibleTo).toHaveBeenCalledWith('biz_1', 'c1', viewer);
    expect(svc.createCallLog).toHaveBeenCalled();
  });

  it('lists calls', async () => {
    const svc = createMockService();
    const scriptSvc = createMockScriptService();
    const ctrl = new CallTaskController(svc, scriptSvc);

    const result = await ctrl.list('biz_1', {} as any, req);
    expect(result.total).toBe(0);
    expect(svc.listCalls).toHaveBeenCalledWith('biz_1', expect.objectContaining({ viewer }));
  });

  it('gets call by id', async () => {
    const svc = createMockService();
    const scriptSvc = createMockScriptService();
    const ctrl = new CallTaskController(svc, scriptSvc);

    const result = await ctrl.getById('biz_1', 'cl_1', req);
    expect(result.id).toBe('cl_1');
    expect(svc.getVisibleCallLog).toHaveBeenCalledWith('biz_1', 'cl_1', viewer);
  });

  it('updates a call', async () => {
    const svc = createMockService();
    const scriptSvc = createMockScriptService();
    const ctrl = new CallTaskController(svc, scriptSvc);

    const result = await ctrl.update('biz_1', 'cl_1', { notes: 'Updated' }, req);
    expect(svc.getVisibleCallLog).toHaveBeenCalledWith('biz_1', 'cl_1', viewer);
    expect(svc.updateCallLog).toHaveBeenCalledWith('biz_1', 'cl_1', { notes: 'Updated' });
  });

  it('completes a call', async () => {
    const svc = createMockService();
    const scriptSvc = createMockScriptService();
    const ctrl = new CallTaskController(svc, scriptSvc);

    const result = await ctrl.complete('biz_1', 'cl_1', {
      outcome: 'reached',
      duration: 120,
    } as any, { user: { id: 'user_1' } } as any);

    expect(svc.getVisibleCallLog).toHaveBeenCalledWith('biz_1', 'cl_1', viewer);
    expect(svc.completeCall).toHaveBeenCalledWith('biz_1', 'cl_1', expect.any(Object), 'user_1');
  });

  it('creates follow-up task', async () => {
    const svc = createMockService();
    const scriptSvc = createMockScriptService();
    const ctrl = new CallTaskController(svc, scriptSvc);

    const result = await ctrl.createFollowUp('biz_1', 'cl_1', {
      title: 'Send email',
    } as any, { user: { id: 'user_1' } } as any);

    expect(svc.getVisibleCallLog).toHaveBeenCalledWith('biz_1', 'cl_1', viewer);
    expect(svc.createFollowUpTask).toHaveBeenCalledWith('biz_1', 'cl_1', expect.any(Object), 'user_1');
  });

  it('deletes a call', async () => {
    const svc = createMockService();
    const scriptSvc = createMockScriptService();
    const ctrl = new CallTaskController(svc, scriptSvc);

    const result = await ctrl.delete('biz_1', 'cl_1', req);
    expect(result.success).toBe(true);
    expect(svc.getVisibleCallLog).toHaveBeenCalledWith('biz_1', 'cl_1', viewer);
    expect(svc.deleteCallLog).toHaveBeenCalledWith('biz_1', 'cl_1');
  });

  it('gets scheduled calls for today', async () => {
    const svc = createMockService();
    const scriptSvc = createMockScriptService();
    const ctrl = new CallTaskController(svc, scriptSvc);

    await ctrl.getScheduledToday('biz_1', 'user_1', req);
    expect(svc.getScheduledCalls).toHaveBeenCalledWith('biz_1', 'user_1', expect.any(Date), viewer);
  });

  // V1-54 review CR-1: no callerId reads every member's calls for the day, as the Operations
  // dashboard and the call-tasks page (which send none) have always shown.
  it("gets every member's scheduled calls for today when no callerId is named", async () => {
    const svc = createMockService();
    const scriptSvc = createMockScriptService();
    const ctrl = new CallTaskController(svc, scriptSvc);

    await ctrl.getScheduledToday('biz_1', undefined, req);
    await ctrl.getScheduledToday('biz_1', '', req);
    expect(svc.getScheduledCalls).toHaveBeenNthCalledWith(1, 'biz_1', undefined, expect.any(Date), viewer);
    expect(svc.getScheduledCalls).toHaveBeenNthCalledWith(2, 'biz_1', undefined, expect.any(Date), viewer);
  });

  it('creates from next action within the path business (review ST-3)', async () => {
    const svc = createMockService();
    const scriptSvc = createMockScriptService();
    const ctrl = new CallTaskController(svc, scriptSvc);

    const result = await ctrl.createFromNextAction('biz_1', 'c1', {}, { user: { id: 'user_1' } } as any);
    expect(svc.assertContactVisibleTo).toHaveBeenCalledWith('biz_1', 'c1', viewer);
    expect(svc.createFromContactNextAction).toHaveBeenCalledWith('biz_1', 'c1', 'user_1', undefined);
  });

  it('generates a call script', async () => {
    const svc = createMockService();
    const scriptSvc = createMockScriptService();
    const ctrl = new CallTaskController(svc, scriptSvc);

    const result = await ctrl.generateScript('biz_1', 'cl_1', { user: { id: 'user_1' } } as any);
    expect(svc.getVisibleCallLog).toHaveBeenCalledWith('biz_1', 'cl_1', viewer);
    expect(scriptSvc.generateScript).toHaveBeenCalledWith('biz_1', 'cl_1', 'c1');
    expect(result.greeting).toBe('Hi there!');
  });

  it('auto-generates script when creating from next action if requested', async () => {
    const svc = createMockService();
    const scriptSvc = createMockScriptService();
    const ctrl = new CallTaskController(svc, scriptSvc);

    await ctrl.createFromNextAction('biz_1', 'c1', { autoGenerateScript: true }, { user: { id: 'user_1' } } as any);
    expect(scriptSvc.generateScript).toHaveBeenCalledWith('biz_1', 'cl_2', 'c1');
  });
});
