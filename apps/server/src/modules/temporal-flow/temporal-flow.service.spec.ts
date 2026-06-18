import { describe, expect, it, vi } from 'vitest';
import { TemporalFlowService } from './temporal-flow.service';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { TemporalFlowEventInput } from './temporal-flow.types';

function makeService(store: any[] = []) {
  const prisma = {
    client: {
      temporalFlowEvent: {
        create: vi.fn(async ({ data }: any) => {
          const record = { id: `tf_${store.length + 1}`, ...data, createdAt: new Date(), updatedAt: new Date() };
          store.push(record);
          return record;
        }),
        upsert: vi.fn(async ({ create, update }: any) => {
          const existing = store.find(
            (e) =>
              e.businessId === create.businessId &&
              e.source === create.source &&
              e.externalId === create.externalId,
          );
          if (existing) {
            Object.assign(existing, update, { updatedAt: new Date() });
            return existing;
          }
          const record = { id: `tf_${store.length + 1}`, ...create, createdAt: new Date(), updatedAt: new Date() };
          store.push(record);
          return record;
        }),
        findMany: vi.fn(async ({ where, orderBy, take }: any) => {
          const inRange = (value: Date | null, range?: { gte?: Date; lte?: Date }) => {
            if (!value) return false;
            const t = value.getTime();
            if (range?.gte && t < range.gte.getTime()) return false;
            if (range?.lte && t > range.lte.getTime()) return false;
            return true;
          };

          const matchesWhere = (e: any, w: any): boolean => {
            if (w.businessId && e.businessId !== w.businessId) return false;
            if (w.source && e.source !== w.source) return false;
            if (w.type && e.type !== w.type) return false;
            if (w.module && e.module !== w.module) return false;
            if (w.status) {
              if (w.status.in) {
                if (!w.status.in.includes(e.status)) return false;
              } else if (e.status !== w.status) {
                return false;
              }
            }
            if (w.importance && e.importance !== w.importance) return false;
            if (w.genomeImpactPotential != null && e.genomeImpactPotential !== w.genomeImpactPotential) return false;
            if (w.visibility?.not && e.visibility === w.visibility.not) return false;
            if (w.startsAt && !inRange(e.startsAt, w.startsAt)) return false;
            if (w.endsAt && !inRange(e.endsAt, w.endsAt)) return false;
            if (w.occurredAt && !inRange(e.occurredAt, w.occurredAt)) return false;
            if (w.reminderAt && !inRange(e.reminderAt, w.reminderAt)) return false;
            if (Array.isArray(w.OR)) {
              if (!w.OR.some((clause: any) => matchesWhere(e, clause))) return false;
            }
            return true;
          };

          let result = store.filter((e) => matchesWhere(e, where));
          result.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
          return take ? result.slice(0, take) : result;
        }),
        updateMany: vi.fn(async ({ where, data }: any) => {
          const matches = store.filter((e) => e.id === where.id && e.businessId === where.businessId);
          for (const m of matches) Object.assign(m, data);
          return { count: matches.length };
        }),
      },
    },
  } as unknown as PrismaService;

  return { service: new TemporalFlowService(prisma), store };
}

function baseInput(overrides: Partial<TemporalFlowEventInput> = {}): TemporalFlowEventInput {
  return {
    businessId: 'biz_1',
    source: 'APP',
    type: 'test.event',
    title: 'Test event',
    ...overrides,
  };
}

describe('TemporalFlowService', () => {
  it('creates an event without externalId', async () => {
    const { service } = makeService();
    const result = await service.emit(baseInput());
    expect(result.businessId).toBe('biz_1');
    expect(result.title).toBe('Test event');
  });

  it('upserts events by externalId', async () => {
    const { service, store } = makeService();
    await service.emit(baseInput({ externalId: 'ext_1', title: 'First' }));
    await service.emit(baseInput({ externalId: 'ext_1', title: 'Updated' }));
    expect(store).toHaveLength(1);
    expect(store[0].title).toBe('Updated');
  });

  it('lists events filtered by source', async () => {
    const { service } = makeService();
    await service.emit(baseInput({ source: 'APP', type: 'app.event' }));
    await service.emit(baseInput({ source: 'GOOGLE_CALENDAR', type: 'calendar.event' }));

    const appEvents = await service.list('biz_1', { source: 'APP' });
    expect(appEvents).toHaveLength(1);
    expect(appEvents[0].source).toBe('APP');
  });

  it('filters by importance and genome impact', async () => {
    const { service } = makeService();
    await service.emit(baseInput({ importance: 'HIGH', genomeImpactPotential: true }));
    await service.emit(baseInput({ importance: 'LOW' }));

    const high = await service.list('biz_1', { importance: 'HIGH' });
    expect(high).toHaveLength(1);

    const genome = await service.list('biz_1', { genomeImpactPotential: true });
    expect(genome).toHaveLength(1);
  });

  it('filters by date range', async () => {
    const { service } = makeService();
    await service.emit(baseInput({ occurredAt: new Date('2026-06-01T00:00:00Z') }));
    await service.emit(baseInput({ occurredAt: new Date('2026-06-15T00:00:00Z') }));

    const result = await service.list('biz_1', {
      from: '2026-06-10T00:00:00Z',
      to: '2026-06-20T00:00:00Z',
    });
    expect(result).toHaveLength(1);
  });

  it('returns calendar range events', async () => {
    const { service } = makeService();
    await service.emit(baseInput({ startsAt: new Date('2026-06-10T10:00:00Z') }));
    await service.emit(baseInput({ occurredAt: new Date('2026-06-12T10:00:00Z') }));
    await service.emit(baseInput({ occurredAt: new Date('2026-07-01T10:00:00Z') }));

    const result = await service.calendarRange('biz_1', '2026-06-01T00:00:00Z', '2026-06-30T23:59:59Z');
    expect(result).toHaveLength(2);
  });

  it('returns due reminders', async () => {
    const { service } = makeService();
    await service.emit(baseInput({ reminderAt: new Date(Date.now() - 1000), status: 'RECORDED' }));
    await service.emit(baseInput({ reminderAt: new Date(Date.now() + 1000 * 60 * 60) }));

    const reminders = await service.remindersDue('biz_1');
    expect(reminders).toHaveLength(1);
  });

  it('marks an event resolved', async () => {
    const { service, store } = makeService();
    await service.emit(baseInput());
    const id = store[0].id;
    await service.markResolved('biz_1', id);
    expect(store[0].status).toBe('RESOLVED');
    expect(store[0].completedAt).toBeInstanceOf(Date);
  });

  it('analyzes recent activity', async () => {
    const { service } = makeService();
    for (let i = 0; i < 3; i++) {
      await service.emit(baseInput({ source: 'WHATSAPP', type: 'whatsapp.lead.detected' }));
    }
    await service.emit(baseInput({ type: 'invoice.overdue', status: 'RECORDED' }));

    const analysis = await service.analyze('biz_1');
    expect(analysis.summary).toContain('4 events analyzed');
    expect(analysis.urgentItems.length).toBeGreaterThan(0);
    expect(analysis.opportunities.length).toBeGreaterThan(0);
    expect(analysis.risks.length).toBeGreaterThan(0);
  });

  it('detects genome signals from WhatsApp leads', async () => {
    const { service } = makeService();
    for (let i = 0; i < 3; i++) {
      await service.emit(baseInput({ source: 'WHATSAPP', type: 'whatsapp.lead.detected' }));
    }

    const signals = await service.findGenomeSignals('biz_1');
    expect(signals.some((s) => s.section === 'marketing')).toBe(true);
  });
});
