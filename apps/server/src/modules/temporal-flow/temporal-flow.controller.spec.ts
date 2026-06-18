import { describe, expect, it, vi } from 'vitest';
import { TemporalFlowController } from './temporal-flow.controller';
import type { TemporalFlowService } from './temporal-flow.service';

function makeController() {
  const temporal = {
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

  const controller = new TemporalFlowController(temporal);
  return { controller, temporal };
}

describe('TemporalFlowController', () => {
  it('GET / lists events with filters', async () => {
    const { controller, temporal } = makeController();
    const result = await controller.list('biz_1', {
      source: 'APP',
      status: 'RECORDED',
      importance: 'HIGH',
    } as any);
    expect(temporal.list).toHaveBeenCalledWith('biz_1', {
      source: 'APP',
      type: undefined,
      module: undefined,
      status: 'RECORDED',
      importance: 'HIGH',
      from: undefined,
      to: undefined,
      limit: undefined,
    });
    expect(result).toEqual([{ id: 'tf_1' }]);
  });

  it('GET /calendar returns calendar range', async () => {
    const { controller, temporal } = makeController();
    const result = await controller.calendar('biz_1', '2026-06-01', '2026-06-30');
    expect(temporal.calendarRange).toHaveBeenCalledWith('biz_1', '2026-06-01', '2026-06-30');
    expect(result).toEqual([{ id: 'tf_2' }]);
  });

  it('GET /reminders returns reminders', async () => {
    const { controller, temporal } = makeController();
    const result = await controller.reminders('biz_1');
    expect(temporal.remindersDue).toHaveBeenCalledWith('biz_1');
    expect(result).toEqual([{ id: 'tf_3' }]);
  });

  it('POST / creates an event', async () => {
    const { controller, temporal } = makeController();
    const result = await controller.create('biz_1', {
      source: 'MANUAL',
      type: 'manual.note',
      title: 'Note',
      occurredAt: '2026-06-10T00:00:00Z',
    } as any);
    expect(temporal.emit).toHaveBeenCalled();
    expect(result.id).toBe('tf_4');
  });

  it('PATCH /:eventId/resolve marks resolved', async () => {
    const { controller, temporal } = makeController();
    const result = await controller.resolve('biz_1', 'tf_1');
    expect(temporal.markResolved).toHaveBeenCalledWith('biz_1', 'tf_1');
    expect(result).toEqual({ count: 1 });
  });

  it('POST /analyze returns analysis', async () => {
    const { controller, temporal } = makeController();
    const result = await controller.analyze('biz_1');
    expect(temporal.analyze).toHaveBeenCalledWith('biz_1');
    expect(result.summary).toBe('Analysis complete.');
  });
});
