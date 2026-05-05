import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CrmRelationshipHealthService } from './crm-relationship-health.service';
import { DEFAULT_RELATIONSHIP_HEALTH_THRESHOLDS } from '@keyflow/shared';

const MS_PER_DAY = 86_400_000;
const businessId = 'biz-1';

function daysAgo(d: number) {
  return new Date(Date.now() - d * MS_PER_DAY);
}

function makePrisma(overrides: { contacts?: any[]; business?: any } = {}) {
  const business = overrides.business ?? { id: businessId, crmHealthThresholds: null };
  const contacts = overrides.contacts ?? [];
  const updates: any[] = [];
  return {
    updates,
    client: {
      business: {
        findUnique: vi.fn(async ({ where }: any) => (where.id === business.id ? business : null)),
        findMany: vi.fn(async () => [{ id: business.id }]),
        update: vi.fn(async ({ data }: any) => {
          Object.assign(business, data);
          return business;
        }),
      },
      contact: {
        findFirst: vi.fn(async ({ where }: any) =>
          contacts.find((c) => c.id === where.id?.equals || c.id === where.id) ??
          contacts.find((c) => c.id === (where.AND?.[1]?.id ?? where.id)) ??
          contacts[0] ??
          null,
        ),
        findMany: vi.fn(async () => contacts),
        update: vi.fn(async ({ where, data }: any) => {
          const c = contacts.find((x) => x.id === where.id);
          if (c) Object.assign(c, data);
          updates.push({ id: where.id, data });
          return c;
        }),
      },
    },
  };
}

function makeTimeline() {
  return { logEvent: vi.fn(async () => undefined) };
}
function makeStats() {
  return { invalidateCache: vi.fn() };
}

function build(prisma: any, timeline: any = makeTimeline(), stats: any = makeStats()) {
  return new CrmRelationshipHealthService(prisma as any, timeline as any, stats as any);
}

describe('CrmRelationshipHealthService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('hasManualOverride', () => {
    it('returns true only when manual flag is set', () => {
      expect(CrmRelationshipHealthService.hasManualOverride(null)).toBe(false);
      expect(CrmRelationshipHealthService.hasManualOverride({})).toBe(false);
      expect(
        CrmRelationshipHealthService.hasManualOverride({
          relationshipHealthOverride: { manual: false, value: 'HOT' },
        }),
      ).toBe(false);
      expect(
        CrmRelationshipHealthService.hasManualOverride({
          relationshipHealthOverride: { manual: true, value: 'WARM' },
        }),
      ).toBe(true);
    });
  });

  describe('getThresholdsFor', () => {
    it('returns defaults when business has none configured', async () => {
      const p = makePrisma();
      const svc = build(p);
      const t = await svc.getThresholdsFor(businessId);
      expect(t).toEqual(DEFAULT_RELATIONSHIP_HEALTH_THRESHOLDS);
    });

    it('merges stored thresholds over defaults', async () => {
      const p = makePrisma({ business: { id: businessId, crmHealthThresholds: { hot: 7 } } });
      const svc = build(p);
      const t = await svc.getThresholdsFor(businessId);
      expect(t.hot).toBe(7);
      expect(t.warm).toBe(DEFAULT_RELATIONSHIP_HEALTH_THRESHOLDS.warm);
    });
  });

  describe('recomputeForBusiness', () => {
    it('classifies contacts by days since lastContactedAt', async () => {
      const contacts = [
        { id: 'c-hot', status: 'LEAD', lastContactedAt: daysAgo(2), createdAt: daysAgo(60), relationshipHealth: null, custom: null },
        { id: 'c-warm', status: 'LEAD', lastContactedAt: daysAgo(20), createdAt: daysAgo(60), relationshipHealth: 'HOT', custom: null },
        { id: 'c-cold', status: 'LEAD', lastContactedAt: daysAgo(60), createdAt: daysAgo(120), relationshipHealth: 'WARM', custom: null },
        { id: 'c-dormant', status: 'LEAD', lastContactedAt: daysAgo(180), createdAt: daysAgo(365), relationshipHealth: 'COLD', custom: null },
      ];
      const p = makePrisma({ contacts });
      const svc = build(p);
      const result = await svc.recomputeForBusiness(businessId);
      expect(result.scanned).toBe(4);
      expect(result.updated).toBe(4);
      expect(result.skipped).toBe(0);
      expect(result.byHealth.HOT).toBe(1);
      expect(result.byHealth.WARM).toBe(1);
      expect(result.byHealth.COLD).toBe(1);
      expect(result.byHealth.DORMANT).toBe(1);
    });

    it('flags active CLIENT contacts as AT_RISK past atRiskClientDays', async () => {
      const contacts = [
        {
          id: 'c-client',
          status: 'CLIENT',
          lastContactedAt: daysAgo(75),
          createdAt: daysAgo(365),
          relationshipHealth: 'WARM',
          custom: null,
        },
      ];
      const p = makePrisma({ contacts });
      const svc = build(p);
      const result = await svc.recomputeForBusiness(businessId);
      expect(result.byHealth.AT_RISK).toBe(1);
      expect(p.updates[0].data.relationshipHealth).toBe('AT_RISK');
    });

    it('skips contacts with manual override flag', async () => {
      const contacts = [
        {
          id: 'c-manual',
          status: 'LEAD',
          lastContactedAt: daysAgo(180),
          createdAt: daysAgo(365),
          relationshipHealth: 'HOT',
          custom: { relationshipHealthOverride: { manual: true, value: 'HOT' } },
        },
      ];
      const p = makePrisma({ contacts });
      const svc = build(p);
      const result = await svc.recomputeForBusiness(businessId);
      expect(result.skipped).toBe(1);
      expect(result.updated).toBe(0);
      expect(p.updates).toHaveLength(0);
    });

    it('does not write when dryRun is true', async () => {
      const contacts = [
        { id: 'c1', status: 'LEAD', lastContactedAt: daysAgo(180), createdAt: daysAgo(365), relationshipHealth: 'HOT', custom: null },
      ];
      const p = makePrisma({ contacts });
      const svc = build(p);
      const result = await svc.recomputeForBusiness(businessId, { dryRun: true });
      expect(result.updated).toBe(1);
      expect(p.updates).toHaveLength(0);
    });

    it('logs a relationship_health.changed event when health changes', async () => {
      const contacts = [
        { id: 'c1', status: 'LEAD', lastContactedAt: daysAgo(180), createdAt: daysAgo(365), relationshipHealth: 'HOT', custom: null },
      ];
      const p = makePrisma({ contacts });
      const timeline = makeTimeline();
      const svc = build(p, timeline);
      await svc.recomputeForBusiness(businessId);
      expect(timeline.logEvent).toHaveBeenCalledTimes(1);
      const args = timeline.logEvent.mock.calls[0];
      expect(args[0]).toBe(businessId);
      expect(args[1]).toBe('c1');
      expect(args[2]).toBe('relationship_health.changed');
      expect(args[3]).toMatchObject({ to: 'DORMANT', reason: 'auto' });
    });
  });

  describe('setManualOverride', () => {
    it('sets manual override flag and updates relationshipHealth', async () => {
      const contacts = [
        { id: 'c1', status: 'LEAD', lastContactedAt: daysAgo(2), createdAt: daysAgo(60), relationshipHealth: 'HOT', custom: null },
      ];
      const p = makePrisma({ contacts });
      const svc = build(p);
      await svc.setManualOverride({ businessId, contactId: 'c1', value: 'COLD' as any, actorId: 'u1' });
      const update = p.updates[0];
      expect(update.data.relationshipHealth).toBe('COLD');
      expect(update.data.custom.relationshipHealthOverride.manual).toBe(true);
      expect(update.data.custom.relationshipHealthOverride.value).toBe('COLD');
    });

    it('clears override and recomputes auto value when value=null', async () => {
      const contacts = [
        {
          id: 'c1',
          status: 'LEAD',
          lastContactedAt: daysAgo(60),
          createdAt: daysAgo(120),
          relationshipHealth: 'HOT',
          custom: { relationshipHealthOverride: { manual: true, value: 'HOT' }, foo: 'bar' },
        },
      ];
      const p = makePrisma({ contacts });
      const svc = build(p);
      await svc.setManualOverride({ businessId, contactId: 'c1', value: null });
      const update = p.updates[0];
      expect(update.data.custom.relationshipHealthOverride).toBeUndefined();
      expect(update.data.custom.foo).toBe('bar');
      expect(update.data.relationshipHealth).toBe('COLD');
    });
  });

  describe('listAtRisk', () => {
    it('returns AT_RISK + DORMANT contacts with daysSinceLastContact', async () => {
      const contacts = [
        {
          id: 'c1',
          firstName: 'A',
          lastName: 'B',
          email: null,
          phone: null,
          status: 'CLIENT',
          relationshipHealth: 'AT_RISK',
          lastContactedAt: daysAgo(80),
          priority: null,
        },
      ];
      const p = makePrisma({ contacts });
      const svc = build(p);
      const out = await svc.listAtRisk(businessId, { limit: 5 });
      expect(out).toHaveLength(1);
      expect(out[0].daysSinceLastContact).toBeGreaterThanOrEqual(79);
      expect(out[0].daysSinceLastContact).toBeLessThanOrEqual(81);
    });
  });
});
