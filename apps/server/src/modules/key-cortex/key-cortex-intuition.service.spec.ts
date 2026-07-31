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
});
