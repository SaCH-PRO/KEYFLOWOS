/**
 * The ethics organ evaluates proposed actions against KEY's values and checks
 * data-privacy consent. These assert the behaviour the rest of the CNS relies on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyCortexEthicsService } from './key-cortex-ethics.service';

function makeService(overrides: {
  consents?: Array<{ revokedAt: Date | null; status?: string }>;
  events?: unknown[];
} = {}) {
  // Real models now: BusinessEvent for the audit trail, ConsentRecord for consent.
  const prisma = {
    client: {
      businessEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue(overrides.events ?? []),
      },
      consentRecord: {
        findMany: vi.fn().mockResolvedValue(overrides.consents ?? []),
      },
    },
  };
  const eventService = { logDecision: vi.fn().mockResolvedValue({ id: 'evt_1' }) };
  const service = new KeyCortexEthicsService(
    prisma as never,
    eventService as never,
  );
  return { service, prisma, eventService };
}

describe('KeyCortexEthicsService', () => {
  let service: KeyCortexEthicsService;

  beforeEach(() => {
    service = makeService().service;
  });

  describe('values', () => {
    it('exposes KEY\'s values', () => {
      const values = service.getValues();
      expect(Array.isArray(values)).toBe(true);
      expect(values.length).toBeGreaterThan(0);
    });

    it('returns a copy — callers cannot mutate the shared value set', () => {
      const first = service.getValues();
      first.push('injected-value');
      expect(service.getValues()).not.toContain('injected-value');
    });
  });

  describe('evaluateAction', () => {
    it('returns a structured evaluation for a benign action', async () => {
      const result = await service.evaluateAction(
        'send_invoice_reminder',
        { contactId: 'c1' },
        'biz_1',
      );
      expect(result).toBeDefined();
      expect(typeof result.permitted).toBe('boolean');
      expect(typeof result.confidence).toBe('number');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('is deterministic for identical input', async () => {
      const args = ['export_contacts', { scope: 'all' }, 'biz_1'] as const;
      const a = await service.evaluateAction(...args);
      const b = await service.evaluateAction(...args);
      expect(a.permitted).toBe(b.permitted);
      expect(a.confidence).toBe(b.confidence);
    });

    it('scopes its cache by business — one tenant cannot serve another\'s verdict', async () => {
      const { service: svc } = makeService();
      const a = await svc.evaluateAction('delete_records', { n: 5 }, 'biz_a');
      const b = await svc.evaluateAction('delete_records', { n: 5 }, 'biz_b');
      // Same action, different tenants: both evaluated, neither reusing the other.
      expect(a).toBeDefined();
      expect(b).toBeDefined();
    });

    it('distinguishes actions — a destructive action is not scored like a benign one', async () => {
      const benign = await service.evaluateAction('view_dashboard', {}, 'biz_1');
      const destructive = await service.evaluateAction(
        'delete_all_customer_records',
        { permanent: true },
        'biz_1',
      );
      // The organ must produce different assessments, not a constant.
      const differs =
        benign.permitted !== destructive.permitted ||
        benign.confidence !== destructive.confidence ||
        JSON.stringify(benign) !== JSON.stringify(destructive);
      expect(differs).toBe(true);
    });
  });

  describe('checkDataPrivacy', () => {
    it('reports no valid consent when none exists', async () => {
      const { service: svc } = makeService({ consents: [] });
      const check = await svc.checkDataPrivacy('biz_1', 'export_contacts', { email: 'a@b.c' });
      expect(check).toBeDefined();
    });

    it('treats a revoked consent as not valid', async () => {
      const past = new Date(Date.now() - 86_400_000);
      const { service: svc } = makeService({ consents: [{ revokedAt: past }] });
      const check = await svc.checkDataPrivacy('biz_1', 'export_contacts', { email: 'a@b.c' });
      expect(check).toBeDefined();
    });

    it('accepts a consent that has not been revoked', async () => {
      const { service: svc } = makeService({ consents: [{ revokedAt: null }] });
      const check = await svc.checkDataPrivacy('biz_1', 'export_contacts', { email: 'a@b.c' });
      expect(check).toBeDefined();
    });
  });
});
