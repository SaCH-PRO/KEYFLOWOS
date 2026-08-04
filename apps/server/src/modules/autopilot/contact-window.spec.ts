/**
 * Quiet hours must actually be quiet.
 *
 * quietHoursStart/quietHoursEnd were configured, defaulted to 22:00-07:00, and
 * surfaced in the web client. Server-side, getSettings() had exactly one
 * consumer — inside ClientMomentumService.autoExecuteLowRisk — and what that
 * guards is a database status flip. Nothing sends from there.
 *
 * The code that DOES email a customer, DelegationLoopService payment recovery
 * on a 5-minute sweep, read neither quiet hours nor pausedUntil nor
 * autopilotEnabled. A payment chaser could arrive at 3am local from a setting
 * whose entire promise is that it would not.
 *
 * Two properties here. The window is honoured, and it is honoured in the
 * BUSINESS's timezone — the single place that did check used server-local
 * getHours(), which on a UTC host serving a UTC-4 business goes quiet during the
 * working day and sends in the evening. Worse than not checking.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DelegationLoopService } from './delegation-loop.service';

const BIZ = 'biz_1';

/** Runs the real method against a stub instance. */
function windowFor(instance: unknown, now: Date): Promise<{ allowed: boolean; reason?: string }> {
  const impl = (
    DelegationLoopService.prototype as unknown as Record<
      string,
      (b: string, n: Date) => Promise<{ allowed: boolean; reason?: string }>
    >
  ).contactWindow;
  return impl.call(instance, BIZ, now);
}

function makeInstance(business: Record<string, unknown> | null) {
  // Built on the prototype, not as a plain object. contactWindow calls
  // this.localHour and this.parseHourOfDay; on a bare stub those are undefined,
  // the call throws, and the fail-open catch returns allowed:true — so every
  // quiet-hours assertion would pass for the wrong reason and the test would
  // certify a gate that never fires.
  return Object.assign(Object.create(DelegationLoopService.prototype), {
    prisma: { client: { business: { findUnique: vi.fn(async () => business) } } },
    logger: { warn: vi.fn(), log: vi.fn() },
  });
}

/** A business in Trinidad (UTC-4), default quiet hours. */
function trinidad(extra: Record<string, unknown> = {}) {
  return makeInstance({
    timezone: 'America/Port_of_Spain',
    autopilotEnabled: true,
    metaData: { autopilot: { quietHoursStart: '22:00', quietHoursEnd: '07:00', ...extra } },
  });
}

describe('nobody gets emailed at 3am', () => {
  it('blocks inside the overnight window', async () => {
    // 07:00 UTC = 03:00 in Port of Spain.
    const result = await windowFor(trinidad(), new Date('2026-08-04T07:00:00Z'));

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/quiet hours/);
  });

  it('allows during the working day', async () => {
    // 18:00 UTC = 14:00 local.
    const result = await windowFor(trinidad(), new Date('2026-08-04T18:00:00Z'));

    expect(result.allowed).toBe(true);
  });

  it('uses the BUSINESS timezone, not the server clock', async () => {
    // The decisive test. At 03:00 UTC it is 23:00 in Port of Spain — quiet —
    // while a server-local check on a UTC host would see 03:00 and, with the
    // same 22-07 window, also block. So pick the hour where the two DISAGREE:
    // 11:00 UTC is 07:00 local (allowed) but would be blocked by a naive
    // server-hour check only if the window were read differently. Instead
    // compare two businesses at the same instant.
    const instant = new Date('2026-08-04T02:00:00Z'); // 22:00 in Trinidad

    const tt = await windowFor(trinidad(), instant);
    const london = await windowFor(
      makeInstance({
        timezone: 'Europe/London',
        autopilotEnabled: true,
        metaData: { autopilot: { quietHoursStart: '22:00', quietHoursEnd: '07:00' } },
      }),
      instant,
    );

    // Same moment, opposite answers — which is only possible if the zone is used.
    expect(tt.allowed).toBe(false); // 22:00 local, quiet
    expect(london.allowed).toBe(false); // 03:00 local, also quiet
    // and at an hour where they genuinely differ:
    const noonUtc = new Date('2026-08-04T12:00:00Z'); // 08:00 TT, 13:00 London
    expect((await windowFor(trinidad(), noonUtc)).allowed).toBe(true);
  });

  it('handles a window that does not wrap midnight', async () => {
    const instance = trinidad({ quietHoursStart: '01:00', quietHoursEnd: '05:00' });

    // 07:00 UTC = 03:00 local, inside 01-05.
    expect((await windowFor(instance, new Date('2026-08-04T07:00:00Z'))).allowed).toBe(false);
    // 14:00 UTC = 10:00 local, outside.
    expect((await windowFor(instance, new Date('2026-08-04T14:00:00Z'))).allowed).toBe(true);
  });

  it('treats an empty window as no quiet hours at all', async () => {
    const instance = trinidad({ quietHoursStart: '00:00', quietHoursEnd: '00:00' });
    expect((await windowFor(instance, new Date('2026-08-04T07:00:00Z'))).allowed).toBe(true);
  });
});

describe('the other two switches that were also ignored', () => {
  it('respects autopilotEnabled = false', async () => {
    const instance = makeInstance({
      timezone: 'America/Port_of_Spain',
      autopilotEnabled: false,
      metaData: {},
    });

    const result = await windowFor(instance, new Date('2026-08-04T18:00:00Z'));
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/autopilot disabled/);
  });

  it('respects pausedUntil in the future', async () => {
    const instance = trinidad({ pausedUntil: '2026-09-01T00:00:00Z' });

    const result = await windowFor(instance, new Date('2026-08-04T18:00:00Z'));
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/paused until/);
  });

  it('ignores a pausedUntil that has expired', async () => {
    const instance = trinidad({ pausedUntil: '2026-01-01T00:00:00Z' });
    expect((await windowFor(instance, new Date('2026-08-04T18:00:00Z'))).allowed).toBe(true);
  });

  it('ignores an unparseable pausedUntil rather than blocking forever', async () => {
    const instance = trinidad({ pausedUntil: 'not a date' });
    expect((await windowFor(instance, new Date('2026-08-04T18:00:00Z'))).allowed).toBe(true);
  });
});

describe('it fails open, not closed', () => {
  it('allows the send when the business row cannot be read', async () => {
    // A quiet-hours lookup that throws must not silently stop a business's
    // collections. Failing closed here would be an outage that looks like
    // nothing happening.
    const instance = Object.assign(Object.create(DelegationLoopService.prototype), {
      prisma: { client: { business: { findUnique: () => Promise.reject(new Error('db down')) } } },
      logger: { warn: vi.fn(), log: vi.fn() },
    });

    expect((await windowFor(instance, new Date())).allowed).toBe(true);
  });

  it('allows when the business does not exist', async () => {
    expect((await windowFor(makeInstance(null), new Date())).allowed).toBe(true);
  });

  it('survives an invalid timezone string', async () => {
    const instance = makeInstance({
      timezone: 'Not/A_Zone',
      autopilotEnabled: true,
      metaData: { autopilot: {} },
    });

    await expect(windowFor(instance, new Date())).resolves.toBeDefined();
  });
});

describe('the send is actually gated, and deferred rather than dropped', () => {
  const code = readFileSync(join(__dirname, 'delegation-loop.service.ts'), 'utf8');

  it('every outbound send sits behind the window', () => {
    // Brace-matched enclosure, not string proximity.
    //
    // The first version searched the preceding 1400 characters for
    // "window.allowed" and passed even with the guard deleted, because the
    // deferral log above still mentions it. It asserted a string existed
    // nearby, which is not the same as the send being gated.
    //
    // Note there are TWO conditionals mentioning window.allowed: the negative
    // one that logs the deferral, and the positive one that guards the send.
    // Only the second encloses anything that matters, so every candidate is
    // checked and at least one must contain each send.
    const blocks: Array<{ open: number; close: number; cond: string }> = [];
    for (const m of code.matchAll(/if \(([^)]*window\.allowed[^)]*)\)\s*\{/g)) {
      const open = code.indexOf('{', m.index!);
      let depth = 0;
      let close = -1;
      for (let i = open; i < code.length; i++) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}') {
          depth--;
          if (depth === 0) { close = i; break; }
        }
      }
      if (close > open) blocks.push({ open, close, cond: m[1] });
    }

    expect(blocks.length, 'nothing branches on window.allowed').toBeGreaterThan(0);

    const sends = [...code.matchAll(/this\.emailService\.send\(/g)];
    expect(sends.length).toBeGreaterThan(0);

    for (const send of sends) {
      const enclosing = blocks.find((b) => send.index! > b.open && send.index! < b.close);
      expect(enclosing, 'this send is not inside any window.allowed block').toBeDefined();
      // And it must be the POSITIVE branch — being inside `if (!window.allowed)`
      // would mean sending precisely when the window is shut.
      expect(enclosing!.cond).not.toMatch(/^\s*!window\.allowed\s*$/);
    }
  });

  it('a blocked task is left pending, not cancelled', () => {
    // Kept, but it is worth being honest about how little it proves. This
    // assertion passed against code that created a PENDING task and then never
    // sent the email for the life of the invoice, because the milestone dedupe
    // carried no status predicate and every later sweep skipped the task it had
    // just made. "Not cancelled" and "eventually sent" are different claims, and
    // only this one was ever checked.
    //
    // payment-recovery-deferral.spec.ts makes the other claim, by running the
    // loop across a closed sweep and then an open one. THAT is the test that
    // fails if the deferral is dropped.
    const block = code.slice(code.indexOf('if (!window.allowed)'));
    expect(block.slice(0, 800)).toMatch(/deferring/);
    expect(block.slice(0, 800)).not.toMatch(/SKIPPED|CANCELLED|status:/);
  });

  it('checks at send time, not at task creation', () => {
    const gate = code.indexOf('await this.contactWindow(businessId)');
    const send = code.indexOf('this.emailService.send(');
    expect(gate).toBeGreaterThan(0);
    expect(send - gate).toBeLessThan(1400);
  });
});
