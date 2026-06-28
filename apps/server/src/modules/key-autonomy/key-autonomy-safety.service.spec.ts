import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyAutonomySafetyService } from './key-autonomy-safety.service';

function createMockClient() {
  const profiles: any[] = [];
  const actionCounts: any[] = [];
  const spends: any[] = [];

  return {
    profiles,
    actionCounts,
    spends,
    businessAutonomyProfile: {
      findUnique: vi.fn(async ({ where }: any) => {
        return profiles.find((p) => p.businessId === where.businessId) ?? null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = {
          ...data,
          id: 'profile_1',
          globalKillSwitch: data.globalKillSwitch ?? false,
          maxDailyAutoActions: data.maxDailyAutoActions ?? 10,
          maxDailySpendTtd: data.maxDailySpendTtd ?? 0,
          notifyOnBlock: data.notifyOnBlock ?? true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        profiles.push(row);
        return row;
      }),
    },
    autopilotSettings: {
      findUnique: vi.fn(async () => null),
    },
    autonomyDailyActionCount: {
      findUnique: vi.fn(async ({ where }: any) => {
        return (
          actionCounts.find(
            (r) =>
              r.businessId === where.businessId_date_actionType.businessId &&
              r.actionType === where.businessId_date_actionType.actionType,
          ) ?? null
        );
      }),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const existing = actionCounts.find(
          (r) =>
            r.businessId === where.businessId_date_actionType.businessId &&
            r.actionType === where.businessId_date_actionType.actionType,
        );
        if (existing) {
          existing.count += update.count.increment;
          existing.updatedAt = new Date();
          return existing;
        }
        const row = { ...create, id: 'count_1', createdAt: new Date(), updatedAt: new Date() };
        actionCounts.push(row);
        return row;
      }),
    },
    autonomyDailySpend: {
      findUnique: vi.fn(async ({ where }: any) => {
        return (
          spends.find(
            (r) =>
              r.businessId === where.businessId_date_currency.businessId &&
              r.currency === where.businessId_date_currency.currency,
          ) ?? null
        );
      }),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const existing = spends.find(
          (r) =>
            r.businessId === where.businessId_date_currency.businessId &&
            r.currency === where.businessId_date_currency.currency,
        );
        if (existing) {
          existing.amountTtd += update.amountTtd.increment;
          existing.updatedAt = new Date();
          return existing;
        }
        const row = { ...create, id: 'spend_1', createdAt: new Date(), updatedAt: new Date() };
        spends.push(row);
        return row;
      }),
    },
  };
}

function makeService(client: any) {
  return new KeyAutonomySafetyService({ client } as any);
}

describe('KeyAutonomySafetyService', () => {
  let client: ReturnType<typeof createMockClient>;
  let service: KeyAutonomySafetyService;

  beforeEach(() => {
    client = createMockClient();
    service = makeService(client);
  });

  describe('ensureProfile', () => {
    it('creates a default profile when none exists', async () => {
      const profile = await service.ensureProfile('biz_1');
      expect(profile.businessId).toBe('biz_1');
      expect(profile.globalKillSwitch).toBe(false);
      expect(profile.maxDailyAutoActions).toBe(10);
    });

    it('seeds maxDailyAutoActions from AutopilotSettings', async () => {
      client.autopilotSettings.findUnique.mockResolvedValue({ maxDailyAutoActions: 25 });
      const profile = await service.ensureProfile('biz_1');
      expect(profile.maxDailyAutoActions).toBe(25);
    });

    it('returns existing profile without creating', async () => {
      client.profiles.push({
        id: 'existing',
        businessId: 'biz_1',
        globalKillSwitch: true,
        maxDailyAutoActions: 5,
        maxDailySpendTtd: 100,
        notifyOnBlock: true,
      });
      const profile = await service.ensureProfile('biz_1');
      expect(profile.globalKillSwitch).toBe(true);
      expect(client.businessAutonomyProfile.create).not.toHaveBeenCalled();
    });
  });

  describe('check', () => {
    it('blocks when global kill switch is active', async () => {
      client.profiles.push({
        id: 'p1',
        businessId: 'biz_1',
        globalKillSwitch: true,
        maxDailyAutoActions: 10,
        maxDailySpendTtd: 0,
        notifyOnBlock: true,
      });
      const result = await service.check({ businessId: 'biz_1', toolName: 'crm.create_contact' });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('kill switch');
    });

    it('allows auto actions under the daily limit', async () => {
      const result = await service.check({
        businessId: 'biz_1',
        toolName: 'crm.create_contact',
        mode: 'auto',
      });
      expect(result.allowed).toBe(true);
    });

    it('blocks auto actions when daily limit is reached', async () => {
      client.profiles.push({
        id: 'p1',
        businessId: 'biz_1',
        globalKillSwitch: false,
        maxDailyAutoActions: 2,
        maxDailySpendTtd: 0,
        notifyOnBlock: true,
      });
      client.actionCounts.push({ businessId: 'biz_1', actionType: 'auto', count: 2 });

      const result = await service.check({
        businessId: 'biz_1',
        toolName: 'crm.create_contact',
        mode: 'auto',
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Daily autonomous action limit');
    });

    it('does not enforce action limits for approved/manual modes', async () => {
      client.profiles.push({
        id: 'p1',
        businessId: 'biz_1',
        globalKillSwitch: false,
        maxDailyAutoActions: 0,
        maxDailySpendTtd: 0,
        notifyOnBlock: true,
      });

      const approved = await service.check({
        businessId: 'biz_1',
        toolName: 'crm.create_contact',
        mode: 'approved',
      });
      expect(approved.allowed).toBe(true);

      const manual = await service.check({
        businessId: 'biz_1',
        toolName: 'crm.create_contact',
        mode: 'manual',
      });
      expect(manual.allowed).toBe(true);
    });

    it('blocks auto actions that would exceed daily spend limit', async () => {
      client.profiles.push({
        id: 'p1',
        businessId: 'biz_1',
        globalKillSwitch: false,
        maxDailyAutoActions: 100,
        maxDailySpendTtd: 100,
        notifyOnBlock: true,
      });
      client.spends.push({ businessId: 'biz_1', currency: 'TTD', amountTtd: 80 });

      const result = await service.check({
        businessId: 'biz_1',
        toolName: 'ads.purchase_ad',
        mode: 'auto',
        estimatedCostTtd: 25,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('spend limit');
    });
  });

  describe('recordExecution', () => {
    it('increments the daily action counter', async () => {
      await service.recordExecution({ businessId: 'biz_1', toolName: 'crm.create_contact', mode: 'auto' });
      expect(client.actionCounts).toHaveLength(1);
      expect(client.actionCounts[0].count).toBe(1);

      await service.recordExecution({ businessId: 'biz_1', toolName: 'crm.create_contact', mode: 'auto' });
      expect(client.actionCounts[0].count).toBe(2);
    });

    it('increments daily spend when cost is provided', async () => {
      await service.recordExecution({
        businessId: 'biz_1',
        toolName: 'ads.purchase_ad',
        mode: 'auto',
        actualCostTtd: 50,
      });
      expect(client.spends[0].amountTtd).toBe(50);

      await service.recordExecution({
        businessId: 'biz_1',
        toolName: 'ads.purchase_ad',
        mode: 'auto',
        actualCostTtd: 30,
      });
      expect(client.spends[0].amountTtd).toBe(80);
    });

    it('does not create a spend row when cost is zero', async () => {
      await service.recordExecution({
        businessId: 'biz_1',
        toolName: 'crm.create_contact',
        mode: 'auto',
      });
      expect(client.spends).toHaveLength(0);
    });
  });
});
