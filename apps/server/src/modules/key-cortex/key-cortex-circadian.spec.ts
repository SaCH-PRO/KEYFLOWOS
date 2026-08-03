/**
 * The circadian clock — KEY's suprachiasmatic nucleus.
 *
 * Every time-of-day rhythm ran on SERVER time. `EVERY_DAY_AT_8AM` is 8AM on the
 * host, and `Business.timezone` — which has existed all along, defaulting to
 * America/Port_of_Spain — was read by nothing that schedules a rhythm. On a UTC
 * host the "morning" briefing arrived at 4am local.
 *
 * That is not an error, which is why it survived: nothing throws, nothing
 * fails, KEY simply does not know what time it is where you are.
 *
 * What matters in a clock is not that it returns a number. It is:
 *
 *   ENTRAINMENT   each business is served at ITS local hour
 *   EXACTLY ONCE  an hourly sweep must not brief the same business twice a day
 *   DST           handled by the tz database, not by offset arithmetic
 *   DEGRADATION   a bad timezone string must not stop the rhythm for everyone
 */
import { describe, it, expect, vi } from 'vitest';
import { KeyCortexCircadianService } from './key-cortex-circadian.service';

class PrismaStub {
  businesses: Array<{ id: string; timezone: string | null }> = [];
  client = {
    business: { findMany: vi.fn(() => Promise.resolve(this.businesses)) },
  };
}

function make(businesses: Array<{ id: string; timezone: string | null }> = []) {
  const prisma = new PrismaStub();
  prisma.businesses = businesses;
  return { svc: new KeyCortexCircadianService(prisma as never), prisma };
}

/** 2026-08-03 12:00 UTC — a Monday. */
const NOON_UTC = new Date('2026-08-03T12:00:00Z');

describe('it knows what time it is where the business is', () => {
  it('reads the local hour, not the server hour', () => {
    const { svc } = make();

    // Port of Spain is UTC-4 year round.
    expect(svc.localHour('America/Port_of_Spain', NOON_UTC)).toBe(8);
    expect(svc.localHour('UTC', NOON_UTC)).toBe(12);
    expect(svc.localHour('Asia/Tokyo', NOON_UTC)).toBe(21);
  });

  it('handles daylight saving through the tz database', () => {
    // The reason this uses Intl rather than a stored offset: hand-rolled
    // arithmetic is right for eight months a year. London is UTC+1 in August
    // and UTC+0 in January.
    const { svc } = make();

    expect(svc.localHour('Europe/London', new Date('2026-08-03T12:00:00Z'))).toBe(13);
    expect(svc.localHour('Europe/London', new Date('2026-01-03T12:00:00Z'))).toBe(12);
  });

  it('reads the local weekday — a Monday digest needs the local Monday', () => {
    const { svc } = make();

    // 23:00 UTC Monday is already Tuesday in Tokyo.
    const lateMonday = new Date('2026-08-03T23:00:00Z');
    expect(svc.localDayOfWeek('UTC', lateMonday)).toBe(1);
    expect(svc.localDayOfWeek('Asia/Tokyo', lateMonday)).toBe(2);
  });

  it('falls back to UTC on an invalid timezone rather than throwing', () => {
    // A bad tz string on one business must not stop the rhythm for every other.
    const { svc } = make();
    expect(svc.localHour('Not/AZone', NOON_UTC)).toBe(12);
  });
});

describe('rhythms are entrained per business', () => {
  const BUSINESSES = [
    { id: 'trinidad', timezone: 'America/Port_of_Spain' }, // 08:00
    { id: 'london', timezone: 'Europe/London' }, //            13:00
    { id: 'tokyo', timezone: 'Asia/Tokyo' }, //                21:00
  ];

  it('selects only the businesses at that local hour', async () => {
    const { svc } = make(BUSINESSES);

    const due = await svc.businessesAtLocalHour(8, NOON_UTC);
    expect(due.map((b) => b.id)).toEqual(['trinidad']);
  });

  it('serves each business EXACTLY ONCE across a full day', async () => {
    // The property that makes an hourly sweep safe. If a business matched twice
    // it would be briefed twice; if never, not at all.
    const { svc } = make(BUSINESSES);
    const served: Record<string, number> = { trinidad: 0, london: 0, tokyo: 0 };

    for (let h = 0; h < 24; h += 1) {
      const now = new Date(Date.UTC(2026, 7, 3, h, 0, 0));
      for (const b of await svc.businessesAtLocalHour(8, now)) served[b.id] += 1;
    }

    expect(served).toEqual({ trinidad: 1, london: 1, tokyo: 1 });
  });

  it('a weekly rhythm needs the local hour AND the local day', async () => {
    const { svc } = make(BUSINESSES);

    // 13:00 UTC Monday: London is 14:00 Monday, Tokyo is 22:00 Monday.
    const mondayAfternoon = new Date('2026-08-03T13:00:00Z');
    const due = await svc.businessesAtLocalTime(14, 1, mondayAfternoon);

    expect(due.map((b) => b.id)).toEqual(['london']);
  });

  it('treats a missing timezone as UTC rather than dropping the business', async () => {
    const { svc } = make([{ id: 'unset', timezone: null }]);

    const due = await svc.businessesAtLocalHour(12, NOON_UTC);
    expect(due.map((b) => b.id)).toEqual(['unset']);
  });

  it('survives a database failure without stopping the rhythm', async () => {
    const { svc, prisma } = make();
    prisma.client.business.findMany = vi.fn(() => Promise.reject(new Error('down')));

    await expect(svc.businessesAtLocalHour(8)).resolves.toEqual([]);
  });
});

describe('resting hours', () => {
  it('knows when a business is outside working hours', () => {
    // The parasympathetic question: consolidation and reflection belong in the
    // quiet hours, not competing with the traffic they learn from.
    const { svc } = make();

    expect(svc.isRestingHours('UTC', new Date('2026-08-03T03:00:00Z'))).toBe(true);
    expect(svc.isRestingHours('UTC', new Date('2026-08-03T22:00:00Z'))).toBe(true);
    expect(svc.isRestingHours('UTC', new Date('2026-08-03T12:00:00Z'))).toBe(false);
  });
});

describe('the rhythms actually use the clock', () => {
  // A clock nothing consults is a clock that does not exist — this repo's
  // signature defect.
  const engine = (() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { join } = require('node:path') as typeof import('node:path');
    return readFileSync(join(__dirname, 'key-proactive-engine.service.ts'), 'utf8');
  })();

  it('the morning brief asks for the businesses at local 8AM', () => {
    expect(engine).toMatch(/businessesAtLocalHour\(8\)/);
  });

  it('the end-of-day report asks for local 6PM', () => {
    expect(engine).toMatch(/businessesAtLocalHour\(18\)/);
  });

  it('the weekly digest asks for local Monday 9AM', () => {
    expect(engine).toMatch(/businessesAtLocalTime\(9, 1\)/);
  });

  it('no user-facing rhythm still fires on a fixed server hour', () => {
    // Comments stripped: the docblock explaining this change NAMES
    // EVERY_DAY_AT_8AM, so a raw match asserts against the explanation rather
    // than the code. That exact mistake has been made three times today.
    const code = engine
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/**');
      })
      .join('\n');

    expect(code).not.toMatch(/EVERY_DAY_AT_8AM/);
    expect(code).not.toMatch(/EVERY_DAY_AT_6PM/);
    expect(code).not.toMatch(/@Cron\('0 9 \* \* 1'\)/);
  });

  it('acts on the DUE businesses, not on every business', () => {
    // The subtle half of this change. Selecting the due list and then sweeping
    // getActiveBusinesses() anyway would brief everyone, every hour — strictly
    // worse than the bug it replaced. That shipped in the first draft of the
    // end-of-day path.
    const sweeps = engine.match(/await this\.getActiveBusinesses\(\)/g) ?? [];
    const guarded = engine.match(/\? due\w*\.map\(\(b\) => b\.id\)/g) ?? [];
    expect(guarded.length, 'a rhythm ignores its due list').toBe(3);
    expect(sweeps.length, 'more unguarded sweeps than expected').toBeLessThanOrEqual(4);
  });
});
