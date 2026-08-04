/**
 * The parasympathetic arm: repair while nobody is working.
 *
 * Every mobilising system in this cortex was live — arousal, threat detection,
 * hormone release, delegation loops. Nothing rested. Two halves of the recovery
 * arm existed and neither was connected to anything:
 *
 *   MemoryConsolidationService — decay, conflict resolution, fact promotion, all
 *   implemented, registered in providers AND exports, injected by NOBODY. Its own
 *   docblock called it "nightly-style" and nothing ever made a night happen.
 *
 *   KeyCortexCircadianService.isRestingHours() — correct, tested, and called from
 *   nowhere in production.
 *
 * Two properties matter here and they pull in opposite directions: it must
 * actually run (the failure it is fixing is never running), and it must not run
 * on a business that is awake, or hourly all night on one that is not.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryConsolidationService } from './memory-consolidation.service';
import { KeyCortexCircadianService } from './key-cortex-circadian.service';

/** Restful for Trinidad (UTC-4): 06:00Z is 02:00 local. */
const NIGHT = new Date('2026-08-04T06:00:00Z');
/** 18:00Z is 14:00 local — the middle of the working day. */
const DAY = new Date('2026-08-04T18:00:00Z');

function makeService(
  businesses: Array<{ id: string; timezone: string | null }>,
  opts: { withCircadian?: boolean; failOn?: string } = {},
) {
  const ran: string[] = [];

  // The REAL circadian service, not an approximation of it. A hand-rolled stub
  // reimplemented the Intl call without its try/catch and threw on an invalid
  // timezone — so the test would have reported a crash the production code does
  // not have, and could equally have hidden one it does.
  const circadian = new KeyCortexCircadianService({} as never);

  const service = new MemoryConsolidationService(
    { client: { business: { findMany: vi.fn(async () => businesses) } } } as never,
    opts.withCircadian === false ? undefined : (circadian as never),
  );

  (service as any).run = vi.fn(async (businessId: string) => {
    if (opts.failOn === businessId) throw new Error('boom');
    ran.push(businessId);
    return { decayed: 1, promoted: 2, conflictsResolved: 0 };
  });
  (service as any).logger = { log: vi.fn(), warn: vi.fn() };

  return { service, ran };
}

const TT = [{ id: 'biz_tt', timezone: 'America/Port_of_Spain' }];

describe('it runs, which is the failure it exists to fix', () => {
  it('consolidates a business during its own night', async () => {
    const { service, ran } = makeService(TT);
    await service.scheduledConsolidation(NIGHT);

    expect(ran).toEqual(['biz_tt']);
  });

  it('does not consolidate a business in the middle of its working day', async () => {
    const { service, ran } = makeService(TT);
    await service.scheduledConsolidation(DAY);

    expect(ran).toEqual([]);
  });

  it('uses the BUSINESS timezone, not the server clock', async () => {
    // Same instant, two businesses. 06:00Z is 02:00 in Trinidad (resting) and
    // 07:00 in London (awake). The nightly jobs elsewhere in this codebase use
    // server time, which on a UTC host runs them mid-evening for Trinidad.
    const { service, ran } = makeService([
      { id: 'biz_tt', timezone: 'America/Port_of_Spain' },
      { id: 'biz_uk', timezone: 'Europe/London' },
    ]);
    await service.scheduledConsolidation(NIGHT);

    expect(ran).toEqual(['biz_tt']);
  });
});

describe('once a night, not once an hour', () => {
  it('does not repeat within the same local day', async () => {
    // The sweep is hourly so a missed window can be caught later; without this
    // guard a resting business would consolidate every hour until dawn.
    const { service, ran } = makeService(TT);

    await service.scheduledConsolidation(NIGHT);
    await service.scheduledConsolidation(new Date('2026-08-04T07:00:00Z'));
    await service.scheduledConsolidation(new Date('2026-08-04T08:00:00Z'));

    expect(ran).toEqual(['biz_tt']);
  });

  it('runs again the following night', async () => {
    const { service, ran } = makeService(TT);

    await service.scheduledConsolidation(NIGHT);
    await service.scheduledConsolidation(new Date('2026-08-05T06:00:00Z'));

    expect(ran).toEqual(['biz_tt', 'biz_tt']);
  });

  it('catches up later the same night if an hour was missed', async () => {
    // The reason this is hourly rather than businessesAtLocalHour(3): a fixed
    // hour fires exactly once, and exactly never if the process happened to be
    // restarting during that minute.
    const { service, ran } = makeService(TT);
    await service.scheduledConsolidation(new Date('2026-08-04T09:00:00Z')); // 05:00 local

    expect(ran).toEqual(['biz_tt']);
  });
});

describe('it fails safe', () => {
  it('skips everything when the clock is unavailable rather than guessing', async () => {
    // Without circadian there is no way to know whose night it is, and
    // consolidating the estate on the server's clock would be worse than
    // waiting.
    const { service, ran } = makeService(TT, { withCircadian: false });
    await service.scheduledConsolidation(NIGHT);

    expect(ran).toEqual([]);
  });

  it('one tenant failing does not stop the rest of the estate', async () => {
    const { service, ran } = makeService(
      [
        { id: 'biz_a', timezone: 'America/Port_of_Spain' },
        { id: 'biz_b', timezone: 'America/Port_of_Spain' },
      ],
      { failOn: 'biz_a' },
    );
    await service.scheduledConsolidation(NIGHT);

    expect(ran).toEqual(['biz_b']);
  });

  it('retries a failed tenant on the next sweep', async () => {
    // A failure must not mark the night as done.
    const { service, ran } = makeService(TT, { failOn: 'biz_tt' });
    await service.scheduledConsolidation(NIGHT);
    (service as any).run = vi.fn(async (id: string) => {
      ran.push(id);
      return { decayed: 0, promoted: 0, conflictsResolved: 0 };
    });
    await service.scheduledConsolidation(new Date('2026-08-04T07:00:00Z'));

    expect(ran).toEqual(['biz_tt']);
  });

  it('survives an invalid timezone', async () => {
    const { service } = makeService([{ id: 'biz_x', timezone: 'Not/A_Zone' }]);
    await expect(service.scheduledConsolidation(NIGHT)).resolves.toBeUndefined();
  });

  it('tolerates a business with no timezone set', async () => {
    const { service } = makeService([{ id: 'biz_x', timezone: null }]);
    await expect(service.scheduledConsolidation(NIGHT)).resolves.toBeUndefined();
  });
});

describe('rest costs nothing', () => {
  const src = readFileSync(join(__dirname, 'memory-consolidation.service.ts'), 'utf8');

  it('makes no model calls', () => {
    // A nightly sweep across every business that called a model would be one of
    // the more expensive things in the system. This is database work.
    expect(src).not.toMatch(/aiUsage|trackAndComplete|gateway\.|openai/i);
  });

  it('is driven by a schedule, so it is no longer inert', () => {
    expect(src).toMatch(/@Cron\(CronExpression\.EVERY_HOUR\)/);
  });

  it('actually consults the resting-hours clock', () => {
    expect(src).toMatch(/isRestingHours\(/);
  });
});
