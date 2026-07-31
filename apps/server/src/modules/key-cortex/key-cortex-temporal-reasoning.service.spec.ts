/**
 * The temporal organ reads real business time-series — invoices, bookings,
 * payments, tasks — and reasons about trends, cycles and anomalies.
 *
 * Mocks mirror the real PrismaService.client contract. The queries under test
 * use Prisma enum values (uppercase) and real column names; these tests pin both,
 * since the original code used lowercase strings and columns that do not exist.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyCortexTemporalReasoningService } from './key-cortex-temporal-reasoning.service';

function makeService(rows: Record<string, unknown[]> = {}) {
  const model = (name: string) => ({
    findMany: vi.fn().mockResolvedValue(rows[name] ?? []),
    count: vi.fn().mockResolvedValue((rows[name] ?? []).length),
  });
  const client = {
    invoice: model('invoice'),
    booking: model('booking'),
    payment: model('payment'),
    contact: model('contact'),
    message: model('message'),
    autopilotTask: model('autopilotTask'),
  };
  const prisma = { client };
  const contextV2 = { getFullContext: vi.fn().mockResolvedValue({}) };
  const service = new KeyCortexTemporalReasoningService(
    prisma as never,
    contextV2 as never,
  );
  return { service, client };
}

describe('KeyCortexTemporalReasoningService', () => {
  let service: KeyCortexTemporalReasoningService;

  beforeEach(() => {
    service = makeService().service;
  });

  describe('analyzeTimeSeries', () => {
    it('returns an analysis for a known metric and period', async () => {
      const result = await service.analyzeTimeSeries('biz_1', 'revenue', 'month');
      expect(result).toBeDefined();
    });

    it('handles an empty series without throwing', async () => {
      const { service: svc } = makeService();
      const result = await svc.analyzeTimeSeries('biz_1', 'bookings', 'week');
      expect(result).toBeDefined();
    });

    it('scopes every query to the requested business', async () => {
      const { service: svc, client } = makeService({
        invoice: [{ createdAt: new Date(), total: 100 }],
      });
      await svc.analyzeTimeSeries('biz_scoped', 'revenue', 'month');
      const queried = Object.values(client)
        .flatMap((m) => (m.findMany as ReturnType<typeof vi.fn>).mock.calls)
        .map((c) => c[0]?.where?.businessId)
        .filter(Boolean);
      // Any query that ran must have been business-scoped.
      for (const b of queried) expect(b).toBe('biz_scoped');
    });
  });

  describe('Prisma contract', () => {
    // These pin the corrections made during the port. The original used
    // lowercase status strings and a completedAt column that does not exist.
    it('uses uppercase enum values for booking status', async () => {
      const { service: svc, client } = makeService();
      await svc.analyzeTimeSeries('biz_1', 'bookings', 'month');
      const calls = (client.booking.findMany as ReturnType<typeof vi.fn>).mock.calls;
      for (const [args] of calls) {
        const status = args?.where?.status;
        const values = status?.notIn ?? status?.in ?? (status ? [status] : []);
        for (const v of values) {
          expect(typeof v === 'string' ? v : '').toBe(
            typeof v === 'string' ? v.toUpperCase() : '',
          );
        }
      }
    });

    it('never selects a completedAt column on AutopilotTask', async () => {
      const { service: svc, client } = makeService();
      await svc.analyzeTimeSeries('biz_1', 'tasks', 'month');
      const calls = (client.autopilotTask.findMany as ReturnType<typeof vi.fn>).mock.calls;
      for (const [args] of calls) {
        expect(JSON.stringify(args ?? {})).not.toContain('completedAt');
      }
    });
  });

  describe('resilience', () => {
    it('survives a database failure rather than propagating it', async () => {
      const failing = {
        findMany: vi.fn().mockRejectedValue(new Error('db down')),
        count: vi.fn().mockRejectedValue(new Error('db down')),
      };
      const prisma = {
        client: {
          invoice: failing,
          booking: failing,
          payment: failing,
          contact: failing,
          message: failing,
          autopilotTask: failing,
        },
      };
      const svc = new KeyCortexTemporalReasoningService(
        prisma as never,
        { getFullContext: vi.fn().mockResolvedValue({}) } as never,
      );
      await expect(
        svc.analyzeTimeSeries('biz_1', 'revenue', 'month'),
      ).resolves.toBeDefined();
    });
  });
});
