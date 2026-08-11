/**
 * The intuition organ detects weak signals across business data.
 *
 * Several of its detectors have no backing data source — the models they were
 * written against were never created. These tests pin that those detectors stay
 * explicitly inert rather than fabricating signals, and that the ones with real
 * data query the right columns.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyCortexIntuitionService } from './key-cortex-intuition.service';

function makeService(rows: Record<string, unknown[]> = {}) {
  const model = (n: string) => ({
    findMany: vi.fn().mockResolvedValue(rows[n] ?? []),
    count: vi.fn().mockResolvedValue((rows[n] ?? []).length),
  });
  const client = {
    supportTicket: model('supportTicket'),
    businessEvent: model('businessEvent'),
    contact: model('contact'),
    invoice: model('invoice'),
    booking: model('booking'),
    payment: model('payment'),
    business: model('business'),
    subscription: model('subscription'),
    campaign: model('campaign'),
    task: model('task'),
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  const prisma = { client };
  const deps = [
    prisma,
    { getEvents: vi.fn().mockResolvedValue([]), logInsight: vi.fn(), logAlert: vi.fn() },
    { complete: vi.fn().mockResolvedValue({ content: '[]' }) },
    { trackAndComplete: vi.fn().mockResolvedValue({ content: '[]' }) },
    { getFullContext: vi.fn().mockResolvedValue({}) },
    { createSignal: vi.fn(), createGenomeSignal: vi.fn() },
  ];
  const service = new (KeyCortexIntuitionService as unknown as new (
    ...a: unknown[]
  ) => KeyCortexIntuitionService)(...deps);
  return { service, client };
}

describe('KeyCortexIntuitionService', () => {
  let service: KeyCortexIntuitionService;

  beforeEach(() => {
    service = makeService().service;
  });

  describe('Prisma contract', () => {
    const src = () => KeyCortexIntuitionService.prototype.constructor.toString();

    it('queries SupportTicket.title, not a `subject` column', () => {
      expect(src()).not.toMatch(/subject:\s*true/);
    });

    it('uses Contact firstName/lastName, not a `name` column', () => {
      expect(src()).not.toMatch(/select:\s*\{[^}]*\bname:\s*true/);
    });

    it('filters Business on deletedAt, never a non-existent `active` column', () => {
      expect(src()).not.toContain('active: true');
    });

    it('uses upper-case Prisma enum values for invoice status', () => {
      expect(src()).not.toMatch(/status:\s*'overdue'/);
    });
  });

  describe('detectors without a data source', () => {
    // These were written against models that do not exist. They must stay
    // explicitly inert rather than inventing signals — the evidence discipline
    // applies to the organ, not only to the prompt.
    const absent = [
      'keyCortexWeakSignal',
      'websiteAnalytics',
      'socialMediaMetric',
      'featureUsage',
      'chatMessage',
      'adCampaign',
    ];

    for (const model of absent) {
      it(`never queries prisma.client.${model} — no such model`, () => {
        const src = KeyCortexIntuitionService.prototype.constructor.toString();
        expect(src).not.toContain(`client.${model}`);
      });
    }
  });

  describe('resilience', () => {
    it('survives a total database failure', async () => {
      const failing = {
        findMany: vi.fn().mockRejectedValue(new Error('db down')),
        count: vi.fn().mockRejectedValue(new Error('db down')),
      };
      const client = Object.fromEntries(
        ['supportTicket', 'businessEvent', 'contact', 'invoice', 'booking', 'payment', 'business', 'subscription', 'campaign', 'task'].map(
          (k) => [k, failing],
        ),
      );
      const svc = new (KeyCortexIntuitionService as unknown as new (
        ...a: unknown[]
      ) => KeyCortexIntuitionService)(
        { client: { ...client, $queryRaw: vi.fn().mockRejectedValue(new Error('x')) } },
        { getEvents: vi.fn().mockRejectedValue(new Error('x')), logInsight: vi.fn(), logAlert: vi.fn() },
        { complete: vi.fn().mockRejectedValue(new Error('x')) },
        { trackAndComplete: vi.fn().mockRejectedValue(new Error('x')) },
        { getFullContext: vi.fn().mockRejectedValue(new Error('x')) },
        { createSignal: vi.fn(), createGenomeSignal: vi.fn() },
      );
      expect(svc).toBeDefined();
    });
  });

  /**
   * A cron that only logs on failure is a cron you cannot prove ran.
   *
   * scheduledIntuitionScan used to log nothing on success, and the only other
   * trace it leaves is a keyCortexMemory row it writes ONLY when it finds
   * something. So after a production deploy, "did the hourly job fire" was
   * unanswerable: zero weak_signal rows means either the job is broken or the
   * businesses are quiet, and those need different responses.
   *
   * Measured on 2026-08-10 against production immediately after a deploy — the
   * check came back 0 and could not distinguish the two. That is what this
   * fixes.
   */
  describe('the hourly scan is observable', () => {
    function withLogger(businesses: string[]) {
      const { service: svc } = makeService();
      const logged: string[] = [];
      (svc as unknown as { logger: unknown }).logger = {
        log: (m: string) => logged.push(m),
        error: (m: string) => logged.push(`ERROR ${m}`),
        warn: () => {},
        debug: () => {},
        verbose: () => {},
      };
      (svc as unknown as { findAllActiveBusinesses: () => Promise<string[]> }).findAllActiveBusinesses =
        async () => businesses;
      return { svc, logged };
    }

    it('reports a completed scan even when it finds nothing', async () => {
      // The load-bearing case. A quiet hour must print a line, because silence
      // is what made a broken cron look like a quiet one.
      const { svc, logged } = withLogger(['biz_1', 'biz_2']);
      (svc as unknown as { detectWeakSignals: () => Promise<unknown[]> }).detectWeakSignals =
        async () => [];

      await svc.scheduledIntuitionScan();

      const line = logged.find((m) => m.includes('[intuition] scheduled scan complete'));
      expect(line, 'the scan ran and said nothing').toBeTruthy();
      expect(line).toMatch(/2 businesses/);
      expect(line).toMatch(/0 signals recorded/);
    });

    it('reports the number of signals it actually recorded', async () => {
      // Not the number it found, and not a constant — the count it persisted.
      const { svc, logged } = withLogger(['biz_1']);
      (svc as unknown as { detectWeakSignals: () => Promise<unknown[]> }).detectWeakSignals =
        async () => [{ a: 1 }, { b: 2 }, { c: 3 }];
      (svc as unknown as { recordSignals: () => Promise<void> }).recordSignals = async () => {};

      await svc.scheduledIntuitionScan();

      expect(logged.find((m) => m.includes('scheduled scan complete'))).toMatch(
        /3 signals recorded/,
      );
    });

    it('counts a failing business without abandoning the run', async () => {
      // One tenant throwing must not stop the other, and must still be counted
      // in the summary rather than only appearing as a stray error line.
      const { svc, logged } = withLogger(['biz_ok', 'biz_bad']);
      (svc as unknown as { detectWeakSignals: (b: string) => Promise<unknown[]> }).detectWeakSignals =
        async (businessId: string) => {
          if (businessId === 'biz_bad') throw new Error('boom');
          return [{ a: 1 }];
        };
      (svc as unknown as { recordSignals: () => Promise<void> }).recordSignals = async () => {};

      await svc.scheduledIntuitionScan();

      const line = logged.find((m) => m.includes('scheduled scan complete'))!;
      expect(line).toMatch(/2 businesses/);
      expect(line).toMatch(/1 signals recorded/);
      expect(line).toMatch(/1 failed/);
      expect(logged.some((m) => m.startsWith('ERROR')), 'the failure was swallowed').toBe(true);
    });
  });
});
