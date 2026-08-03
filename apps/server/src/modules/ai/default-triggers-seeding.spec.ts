/**
 * Autopilot rules had no seeder call, so the engine ran on an empty table.
 *
 * AgentTriggerService.onModuleInit installs an `events.onAny(...)` firehose and,
 * for every emitted event, runs
 * `agentTrigger.findMany({ businessId, enabled: true, eventPattern })`.
 * That returned zero rows forever, because the only seeder —
 * DefaultTriggersService.seedForBusiness — had no callers anywhere.
 *
 * It is also the ONLY writer of AutopilotSettings, and two live readers depend
 * on that row: MorningBriefingService (briefingEnabled / briefingModules) and
 * AgentTriggerService (maxDailyAutoActions). Without it the daily auto-action
 * cap was never enforced.
 *
 * The safety property pinned here is that rules seed DISABLED. Seeding them
 * enabled would mean KEY starts creating and auto-approving plans against real
 * data the moment a business is created, with nobody having chosen that.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DefaultTriggersService } from './default-triggers.service';

class PrismaStub {
  existingTriggers = 0;
  created: Array<Record<string, unknown>> = [];
  settings: Array<Record<string, unknown>> = [];

  client = {
    agentTrigger: {
      count: vi.fn(() => Promise.resolve(this.existingTriggers)),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        this.created.push(data);
        return Promise.resolve({ id: `trg_${this.created.length}`, ...data });
      }),
    },
    autopilotSettings: {
      upsert: vi.fn((args: { create: Record<string, unknown> }) => {
        this.settings.push(args.create);
        return Promise.resolve(args.create);
      }),
    },
  };
}

describe('seedForBusiness', () => {
  let prisma: PrismaStub;
  let svc: DefaultTriggersService;

  beforeEach(() => {
    prisma = new PrismaStub();
    svc = new DefaultTriggersService(prisma as never);
  });

  it('creates the default rule set', async () => {
    const n = await svc.seedForBusiness('biz_1');
    expect(n).toBeGreaterThan(15);
    expect(prisma.created.length).toBe(n);
  });

  it('seeds every rule DISABLED by default', async () => {
    // The safety property. KEY must not begin acting on production data
    // because a business was created.
    await svc.seedForBusiness('biz_1');

    expect(prisma.created.length).toBeGreaterThan(0);
    expect(prisma.created.every((t) => t.enabled === false)).toBe(true);
  });

  it('allows deliberate enabling via an explicit option', async () => {
    await svc.seedForBusiness('biz_1', { enabled: true });
    expect(prisma.created.every((t) => t.enabled === true)).toBe(true);
  });

  it('writes the AutopilotSettings row — the part with live readers', async () => {
    await svc.seedForBusiness('biz_1');

    expect(prisma.settings).toHaveLength(1);
    // maxDailyAutoActions is read by AgentTriggerService to cap autonomous
    // actions. With no row, that cap was never enforced.
    expect(prisma.settings[0].maxDailyAutoActions).toBeGreaterThan(0);
  });

  it('scopes every row to the business', async () => {
    await svc.seedForBusiness('biz_1');
    expect(prisma.created.every((t) => t.businessId === 'biz_1')).toBe(true);
    expect(prisma.settings[0].businessId).toBe('biz_1');
  });

  it('is idempotent — a second call creates nothing', async () => {
    // createBusiness is not the only path that could reach this, and a retry
    // must not double the rule set.
    prisma.existingTriggers = 21;
    const n = await svc.seedForBusiness('biz_1');

    expect(n).toBe(0);
    expect(prisma.client.agentTrigger.create).not.toHaveBeenCalled();
  });

  it('gives every rule an event pattern and an objective', async () => {
    await svc.seedForBusiness('biz_1');
    for (const t of prisma.created) {
      expect(t.eventPattern, `rule "${String(t.name)}" has no pattern`).toBeTruthy();
      expect(t.objective, `rule "${String(t.name)}" has no objective`).toBeTruthy();
    }
  });

  it('one failing row does not abort the whole seed', async () => {
    prisma.client.agentTrigger.create.mockRejectedValueOnce(new Error('constraint'));
    const n = await svc.seedForBusiness('biz_1');
    expect(n).toBeGreaterThan(10);
  });
});

describe('rules that cannot fire are marked', () => {
  it('names the two patterns with no emitter', async () => {
    // store_order.abandoned and content_request.approved have no emitter
    // anywhere in the server. Left in place so the intent survives, but a
    // reader must not assume enabling them does anything.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    // The rules moved to a decorator-free module so scripts/ can import them
    // through tsx, which cannot process NestJS parameter decorators.
    const src = readFileSync(join(__dirname, 'default-triggers.constants.ts'), 'utf8');

    const abandoned = src.slice(0, src.indexOf("eventPattern: 'store_order.abandoned'"));
    const approved = src.slice(0, src.indexOf("eventPattern: 'content_request.approved'"));

    expect(abandoned.slice(-400)).toMatch(/no emitter/i);
    expect(approved.slice(-400)).toMatch(/no emitter/i);
  });
});
