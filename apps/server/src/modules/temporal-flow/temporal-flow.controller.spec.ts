import { describe, expect, it, vi } from 'vitest';
import { TemporalFlowController } from './temporal-flow.controller';
import type { TemporalFlowService } from './temporal-flow.service';

// FU-TEMPORAL-FLOW-INBOX-SCOPE: each timeline read asks the service for its reader's filter and passes it on.
const READER = { id: 'user_1', role: 'USER' };
const REQ = { user: READER };
const FILTER = { NOT: { OR: [{ module: 'key_inbox' }] } };
const MEMORY_FILTER = { sourceModule: { in: [] } };
// MEM-TEMPORAL-MEMORY-ROUTES-SIGHT: the analysis is handed the reader's memory sight (readerMemoryFilter and the reader).
const MEMORY_SIGHT = { filter: MEMORY_FILTER, who: { reader: 'user_1', sight: () => false } };

function makeController() {
  const temporal = {
    readerFilter: vi.fn().mockResolvedValue(FILTER),
    readerMemoryFilter: vi.fn().mockResolvedValue(MEMORY_FILTER),
    memorySight: vi.fn().mockResolvedValue(MEMORY_SIGHT),
    list: vi.fn().mockResolvedValue([{ id: 'tf_1' }]),
    calendarRange: vi.fn().mockResolvedValue([{ id: 'tf_2' }]),
    remindersDue: vi.fn().mockResolvedValue([{ id: 'tf_3' }]),
    emit: vi.fn().mockResolvedValue({ id: 'tf_4' }),
    markResolved: vi.fn().mockResolvedValue({ count: 1 }),
    analyze: vi.fn().mockResolvedValue({
      summary: 'Analysis complete.',
      urgentItems: [],
      opportunities: [],
      risks: [],
      genomeProposalCandidates: [],
    }),
  } as unknown as TemporalFlowService;

  const memory = { findMany: vi.fn(), searchMemory: vi.fn() } as any;
  const memoryQueue = { enqueue: vi.fn() } as any;
  const genomeBridge = {} as any;
  const controller = new TemporalFlowController(temporal, memory, memoryQueue, genomeBridge);
  return { controller, temporal };
}

describe('TemporalFlowController', () => {
  it('GET / lists events with filters', async () => {
    const { controller, temporal } = makeController();
    const result = await controller.list('biz_1', {
      source: 'APP',
      status: 'RECORDED',
      importance: 'HIGH',
    } as any, REQ);
    expect(temporal.readerFilter).toHaveBeenCalledWith('biz_1', READER);
    expect(temporal.list).toHaveBeenCalledWith('biz_1', {
      source: 'APP',
      type: undefined,
      module: undefined,
      status: 'RECORDED',
      importance: 'HIGH',
      from: undefined,
      to: undefined,
      limit: undefined,
    }, READER, FILTER);
    expect(result).toEqual([{ id: 'tf_1' }]);
  });

  it('D-238: a read with no request user passes the reader as null (none), with the fail-closed module filter', async () => {
    const { controller, temporal } = makeController();
    await controller.list('biz_1', {} as any);
    expect(temporal.readerFilter).toHaveBeenCalledWith('biz_1', undefined);
    expect((temporal.list as any).mock.calls[0][2]).toBeNull();
    expect((temporal.list as any).mock.calls[0][3]).toBe(FILTER);
    await controller.calendar('biz_1', '2026-06-01', '2026-06-30');
    expect(temporal.calendarRange).toHaveBeenCalledWith('biz_1', '2026-06-01', '2026-06-30', null, FILTER);
    await controller.reminders('biz_1');
    expect(temporal.remindersDue).toHaveBeenCalledWith('biz_1', null, FILTER);
  });

  it('D-238 with the module filter: an analysis with no request user passes the reader as null and both filters', async () => {
    const { controller, temporal } = makeController();
    await controller.analyze('biz_1');
    expect(temporal.readerFilter).toHaveBeenCalledWith('biz_1', undefined);
    expect(temporal.memorySight).toHaveBeenCalledWith('biz_1', undefined);
    expect(temporal.analyze).toHaveBeenCalledWith('biz_1', FILTER, MEMORY_SIGHT, null);
  });

  it('GET /calendar returns calendar range', async () => {
    const { controller, temporal } = makeController();
    const result = await controller.calendar('biz_1', '2026-06-01', '2026-06-30', REQ);
    expect(temporal.readerFilter).toHaveBeenCalledWith('biz_1', READER);
    expect(temporal.calendarRange).toHaveBeenCalledWith('biz_1', '2026-06-01', '2026-06-30', READER, FILTER);
    expect(result).toEqual([{ id: 'tf_2' }]);
  });

  it('GET /reminders returns reminders', async () => {
    const { controller, temporal } = makeController();
    const result = await controller.reminders('biz_1', REQ);
    expect(temporal.readerFilter).toHaveBeenCalledWith('biz_1', READER);
    expect(temporal.remindersDue).toHaveBeenCalledWith('biz_1', READER, FILTER);
    expect(result).toEqual([{ id: 'tf_3' }]);
  });

  it('POST / creates an event', async () => {
    const { controller, temporal } = makeController();
    const result = await controller.create('biz_1', {
      source: 'MANUAL',
      type: 'manual.note',
      title: 'Note',
      occurredAt: '2026-06-10T00:00:00Z',
    } as any, REQ);
    expect(temporal.readerFilter).toHaveBeenCalledWith('biz_1', READER);
    expect(temporal.emit).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz_1', title: 'Note' }), FILTER, READER);
    expect(result.id).toBe('tf_4');
  });

  it('PATCH /:eventId/resolve marks resolved with writer filter and reader', async () => {
    const { controller, temporal } = makeController();
    const result = await controller.resolve('biz_1', 'tf_1', REQ);
    expect(temporal.readerFilter).toHaveBeenCalledWith('biz_1', READER);
    expect(temporal.markResolved).toHaveBeenCalledWith('biz_1', 'tf_1', FILTER, READER);
    expect(result).toEqual({ count: 1 });
  });

  it('PATCH /:eventId/resolve passes null reader when req.user is absent', async () => {
    const { controller, temporal } = makeController();
    await controller.resolve('biz_1', 'tf_1');
    expect(temporal.readerFilter).toHaveBeenCalledWith('biz_1', undefined);
    expect(temporal.markResolved).toHaveBeenCalledWith('biz_1', 'tf_1', FILTER, null);
  });

  it('POST /analyze returns analysis', async () => {
    const { controller, temporal } = makeController();
    const result = await controller.analyze('biz_1', REQ);
    expect(temporal.readerFilter).toHaveBeenCalledWith('biz_1', READER);
    expect(temporal.memorySight).toHaveBeenCalledWith('biz_1', READER);
    expect(temporal.analyze).toHaveBeenCalledWith('biz_1', FILTER, MEMORY_SIGHT, READER);
    expect(result.summary).toBe('Analysis complete.');
  });
});
