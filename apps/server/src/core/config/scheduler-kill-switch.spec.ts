/**
 * V1-24-KEY-KILL-SWITCHES (M47, M52, PRS-M05): one scheduler kill switch, and a
 * server-side KEY off switch the cortex crons obey.
 *
 * THE FAILURE THIS EXISTS FOR. The manual product survives today only because
 * no provider is configured. Two kinds of background work ignore every switch
 * an operator or a test harness can set:
 *
 *   - OnModuleInit interval schedulers. The repo convention is
 *     `if (process.env.DISABLE_SCHEDULERS === '1' || process.env.NODE_ENV === 'test') return;`
 *     at the top of onModuleInit. margin-snapshot, financial-briefing,
 *     best-channel and crm-sequence had neither, so they tick inside every
 *     integration run, including the Release 0 journey, which sets both.
 *   - The @Cron handlers under modules/key-cortex (16 handlers in 9 files at
 *     the V1-24 base). Each one walks every active business and, with a key
 *     configured, calls the model on every cycle. Nothing could switch KEY off
 *     on the server: AI_DISABLED is read only by the storefront.
 *
 * WHAT IS PROVEN HERE
 *   - env.ts exports the unified switches: schedulersDisabled() (DISABLE_SCHEDULERS,
 *     KF_DISABLE_SCHEDULERS, NODE_ENV=test), keyDisabled() (KEY_DISABLED) and
 *     keyCronsDisabled() (KEY_DISABLED, DISABLE_SCHEDULERS, KF_DISABLE_SCHEDULERS;
 *     not NODE_ENV, because the cortex specs call these handlers directly).
 *   - Behaviourally, each of the four packet schedulers arms no timer under
 *     DISABLE_SCHEDULERS=1, NODE_ENV=test or KF_DISABLE_SCHEDULERS=1, and still
 *     arms one with no switch set (the control that makes "no timer" mean
 *     something).
 *   - Behaviourally, every scanned cortex @Cron handler, called on a `this`
 *     that records and refuses every property read, returns without touching
 *     its service when KEY_DISABLED=1 (or DISABLE_SCHEDULERS=1), and touches it
 *     when neither is set (the control).
 *   - Structurally, the guard is each handler's first statement, so a handler
 *     added later without it fails here.
 *   - A ratchet over every OnModuleInit interval scheduler in apps/server/src:
 *     the ones outside the V1-24 write set that do not honour DISABLE_SCHEDULERS
 *     are pinned by name, so a new one fails and a fixed one must leave the list.
 *   - KF_DISABLE_SCHEDULERS and the per-scheduler flags are still read where they
 *     were (the change is additive).
 *
 * Every scan asserts its input was non-empty (gate-vacuity.spec.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import * as envModule from './env';
import { MarginSnapshotSchedulerService } from '../../modules/commerce/margin-snapshot-scheduler.service';
import { FinancialBriefingSchedulerService } from '../../modules/commerce/financial-briefing-scheduler.service';
import { BestChannelSchedulerService } from '../../modules/crm/best-channel-scheduler.service';
import { CrmSequenceSchedulerService } from '../../modules/crm/crm-sequence-scheduler.service';

const SERVER_ROOT = join(__dirname, '..', '..', '..');
const SRC = join(SERVER_ROOT, 'src');
const CORTEX = join(SRC, 'modules', 'key-cortex');

const posix = (abs: string) => relative(SERVER_ROOT, abs).split(sep).join('/');

function sourceFiles(dir: string): string[] {
  let out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist', 'coverage'].includes(e.name)) continue;
      out = out.concat(sourceFiles(p));
    } else if (/\.ts$/.test(e.name) && !/\.(spec|test)\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/** The text between the brace at or after `from` and its match (strings are not special-cased). */
function braceBlock(src: string, from: number): string {
  const open = src.indexOf('{', from);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return '';
}

/** Index just past the `)` that closes the `(` at `open`. */
function closeParen(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// OnModuleInit interval schedulers
// ---------------------------------------------------------------------------

const ON_MODULE_INIT = /\n\s*(?:public\s+)?(?:async\s+)?onModuleInit\s*\(\s*\)\s*(?::\s*[^{]+)?\{/;
const ARMS_INTERVAL = /\b(?:setInterval|safeInterval)\s*\(/;
/** The unified switch, or the legacy spelling of DISABLE_SCHEDULERS. */
const HONOURS_DISABLE_SCHEDULERS = /\bschedulersDisabled\s*\(|process\.env\.DISABLE_SCHEDULERS\b/;

interface Scheduler { file: string; init: string; honours: boolean }

function intervalSchedulers(): Scheduler[] {
  const out: Scheduler[] = [];
  for (const abs of sourceFiles(SRC)) {
    const src = readFileSync(abs, 'utf8');
    const m = ON_MODULE_INIT.exec(src);
    if (!m) continue;
    const init = braceBlock(src, m.index);
    if (!ARMS_INTERVAL.test(init)) continue;
    out.push({ file: posix(abs), init, honours: HONOURS_DISABLE_SCHEDULERS.test(init) });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** The four the packet names; all inside the V1-24 write set. */
const PACKET_SCHEDULERS = [
  'src/modules/commerce/financial-briefing-scheduler.service.ts',
  'src/modules/commerce/margin-snapshot-scheduler.service.ts',
  'src/modules/crm/best-channel-scheduler.service.ts',
  'src/modules/crm/crm-sequence-scheduler.service.ts',
];

/**
 * OnModuleInit interval schedulers OUTSIDE the V1-24 write set whose
 * onModuleInit does not honour DISABLE_SCHEDULERS, as observed at the V1-24
 * base (int/trial-F f5c93ba0). The packet's RED claim named four; the census
 * finds 37 that honour neither DISABLE_SCHEDULERS nor NODE_ENV==='test' (these
 * 33 plus the four), and calendar-insight honours NODE_ENV only. Some carry
 * their own flag (noted), which still works. They need a follow-up packet; this
 * list only stops it growing. Remove an entry when its scheduler is fixed.
 */
const KNOWN_UNGATED_OUTSIDE_WRITE_SET = [
  'src/core/connectors/connector-health-monitor.service.ts',
  'src/core/connectors/connector-sync-scheduler.service.ts',
  'src/core/observability/error-digest.service.ts',
  'src/modules/ai/agent-health.service.ts',
  'src/modules/ai/ai-usage-alert-scheduler.service.ts', // AI_USAGE_ALERT_SCHEDULER_DISABLED (module-level), NODE_ENV=test
  'src/modules/ai/connector-intelligence.service.ts',
  'src/modules/ai/match-refresh-scheduler.service.ts',
  'src/modules/ai/pattern-detector.service.ts',
  'src/modules/ai/plan-executor.service.ts',
  'src/modules/ai/pro-auto-monitor.service.ts',
  'src/modules/autopilot/delegation-loop.service.ts',
  'src/modules/bookings/bookings.service.ts',
  'src/modules/calendar/calendar-insight-scheduler.service.ts', // DISABLE_CALENDAR_INSIGHT_SCHEDULER, NODE_ENV=test
  'src/modules/calendar/calendar-sync.scheduler.ts', // KF_DISABLE_SCHEDULERS
  'src/modules/commerce/recurring-invoice.service.ts',
  'src/modules/communications/delivery-queue.service.ts',
  'src/modules/conversion/abandoned-cart-recovery.service.ts',
  'src/modules/conversion/review-solicitation.service.ts',
  'src/modules/crm/crm-data-quality.scheduler.ts', // KF_DISABLE_SCHEDULERS
  'src/modules/crm/crm-relationship-health-scheduler.service.ts', // CRM_HEALTH_SCHEDULER_DISABLED
  'src/modules/crm/deal-intelligence-scheduler.service.ts', // DEAL_INTEL_SCHEDULER_DISABLED
  'src/modules/crm/lead-scoring.scheduler.ts', // LEAD_SCORE_SCHEDULER_DISABLED
  'src/modules/crm/privacy/contact-privacy.service.ts', // DISABLE_FORGET_SCHEDULER
  'src/modules/email-marketing/campaign-scheduler.service.ts',
  'src/modules/expenses/recurring-expense.service.ts',
  'src/modules/finance/recurring-journal-entry.service.ts',
  'src/modules/flow/flow.listener.ts',
  'src/modules/growth-intelligence/growth-intelligence-scheduler.service.ts',
  'src/modules/momentum/momentum-scheduler.service.ts',
  'src/modules/notifications/transactional-email.service.ts',
  'src/modules/payments/currency-rates.scheduler.ts',
  'src/modules/site/storefront-conversion.scheduler.ts',
  'src/modules/social/social-gap-detector.service.ts',
  'src/modules/social/social-scheduler.service.ts',
];

/**
 * Own flags that worked before V1-24 and must keep working (additive): the
 * file still reads the flag. The unified switch also honours
 * KF_DISABLE_SCHEDULERS (proven behaviourally below).
 */
const OWN_FLAGS: Array<[string, string]> = [
  ['src/modules/ai/ai-usage-alert-scheduler.service.ts', 'AI_USAGE_ALERT_SCHEDULER_DISABLED'],
  ['src/modules/calendar/calendar-insight-scheduler.service.ts', 'DISABLE_CALENDAR_INSIGHT_SCHEDULER'],
  ['src/modules/calendar/calendar-sync.scheduler.ts', 'KF_DISABLE_SCHEDULERS'],
  ['src/modules/crm/crm-data-quality.scheduler.ts', 'KF_DISABLE_SCHEDULERS'],
  ['src/modules/crm/crm-relationship-health-scheduler.service.ts', 'CRM_HEALTH_SCHEDULER_DISABLED'],
  ['src/modules/crm/deal-intelligence-scheduler.service.ts', 'DEAL_INTEL_SCHEDULER_DISABLED'],
  ['src/modules/crm/lead-scoring.scheduler.ts', 'LEAD_SCORE_SCHEDULER_DISABLED'],
  ['src/modules/crm/privacy/contact-privacy.service.ts', 'DISABLE_FORGET_SCHEDULER'],
];

// ---------------------------------------------------------------------------
// cortex @Cron handlers
// ---------------------------------------------------------------------------

interface CronHandler { file: string; abs: string; method: string; body: string }

function cortexCronHandlers(): CronHandler[] {
  const out: CronHandler[] = [];
  for (const abs of sourceFiles(CORTEX)) {
    const src = readFileSync(abs, 'utf8');
    const re = /^\s*@Cron\(/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const decoratorOpen = src.indexOf('(', m.index);
      const afterDecorator = closeParen(src, decoratorOpen);
      const sig = /^\s*(?:public\s+)?(?:async\s+)?([A-Za-z0-9_]+)\s*\(/.exec(src.slice(afterDecorator));
      if (!sig) continue;
      const paramsOpen = afterDecorator + sig[0].length - 1;
      const paramsClose = closeParen(src, paramsOpen);
      out.push({ file: posix(abs), abs, method: sig[1], body: braceBlock(src, paramsClose) });
    }
  }
  return out.sort((a, b) => `${a.file}#${a.method}`.localeCompare(`${b.file}#${b.method}`));
}

/** `{`, any comment lines, then `if (keyCronsDisabled()) return` as the first statement. */
const CRON_GUARD_FIRST = /^\{\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*if\s*\(\s*keyCronsDisabled\(\)\s*\)\s*(?:\{\s*)?return\b/;

/**
 * A `this` that records every property read and refuses it. A handler that
 * returns before reading anything leaves `reads` empty.
 */
function trap() {
  const reads: string[] = [];
  const self = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') return undefined;
        reads.push(String(prop));
        throw new Error(`cron handler touched this.${String(prop)}`);
      },
    },
  );
  return { self, reads };
}

async function runOn(fn: (...args: unknown[]) => unknown, self: object): Promise<void> {
  try {
    await fn.call(self);
  } catch {
    /* the trap throws on purpose; the reads are the evidence */
  }
}

// ---------------------------------------------------------------------------
// env discipline
// ---------------------------------------------------------------------------

const SWITCHES = ['DISABLE_SCHEDULERS', 'KF_DISABLE_SCHEDULERS', 'KEY_DISABLED', 'NODE_ENV'] as const;
let saved: Record<string, string | undefined>;

function setSwitches(next: Partial<Record<(typeof SWITCHES)[number], string>>) {
  for (const k of SWITCHES) delete process.env[k];
  for (const [k, v] of Object.entries(next)) if (v !== undefined) process.env[k] = v;
}

beforeEach(() => {
  saved = Object.fromEntries(SWITCHES.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const k of SWITCHES) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// the switches
// ---------------------------------------------------------------------------

describe('env.ts exports the unified switches (V1-24)', () => {
  const env = envModule as unknown as Record<string, ((...a: unknown[]) => boolean) | undefined>;

  it('schedulersDisabled() is on for DISABLE_SCHEDULERS, KF_DISABLE_SCHEDULERS (1 or true) and NODE_ENV=test, and off otherwise', () => {
    expect(typeof env.schedulersDisabled).toBe('function');
    const on = env.schedulersDisabled!;
    setSwitches({ NODE_ENV: 'production' });
    expect(on()).toBe(false);
    setSwitches({ NODE_ENV: 'production', DISABLE_SCHEDULERS: '1' });
    expect(on()).toBe(true);
    setSwitches({ NODE_ENV: 'production', DISABLE_SCHEDULERS: 'true' });
    expect(on()).toBe(true);
    setSwitches({ NODE_ENV: 'production', KF_DISABLE_SCHEDULERS: '1' });
    expect(on()).toBe(true);
    setSwitches({ NODE_ENV: 'production', KF_DISABLE_SCHEDULERS: 'true' });
    expect(on()).toBe(true);
    setSwitches({ NODE_ENV: 'test' });
    expect(on()).toBe(true);
    setSwitches({ NODE_ENV: 'development', DISABLE_SCHEDULERS: '0' });
    expect(on()).toBe(false);
    // KEY_DISABLED is the KEY switch, not a scheduler switch.
    setSwitches({ NODE_ENV: 'production', KEY_DISABLED: '1' });
    expect(on()).toBe(false);
  });

  it('keyDisabled() reads KEY_DISABLED only (1 or true); AI_DISABLED, the storefront switch, does not turn KEY off', () => {
    expect(typeof env.keyDisabled).toBe('function');
    const off = env.keyDisabled!;
    const savedAi = process.env.AI_DISABLED;
    try {
      setSwitches({ NODE_ENV: 'production' });
      delete process.env.AI_DISABLED;
      expect(off()).toBe(false);
      setSwitches({ NODE_ENV: 'production', KEY_DISABLED: '1' });
      expect(off()).toBe(true);
      setSwitches({ NODE_ENV: 'production', KEY_DISABLED: 'TRUE' });
      expect(off()).toBe(true);
      setSwitches({ NODE_ENV: 'production', KEY_DISABLED: '0' });
      expect(off()).toBe(false);
      setSwitches({ NODE_ENV: 'test', DISABLE_SCHEDULERS: '1' });
      process.env.AI_DISABLED = '1';
      expect(off()).toBe(false);
    } finally {
      if (savedAi === undefined) delete process.env.AI_DISABLED;
      else process.env.AI_DISABLED = savedAi;
    }
  });

  it('keyCronsDisabled() is on for KEY_DISABLED, DISABLE_SCHEDULERS or KF_DISABLE_SCHEDULERS, and NOT for NODE_ENV=test alone', () => {
    expect(typeof env.keyCronsDisabled).toBe('function');
    const off = env.keyCronsDisabled!;
    setSwitches({ NODE_ENV: 'test' });
    expect(off()).toBe(false);
    setSwitches({ NODE_ENV: 'test', KEY_DISABLED: '1' });
    expect(off()).toBe(true);
    setSwitches({ NODE_ENV: 'production', DISABLE_SCHEDULERS: '1' });
    expect(off()).toBe(true);
    setSwitches({ NODE_ENV: 'production', KF_DISABLE_SCHEDULERS: 'true' });
    expect(off()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// the four packet schedulers, behaviourally
// ---------------------------------------------------------------------------

/** A dependency stub that fails the test if onModuleInit reaches it. */
const untouchable = () =>
  new Proxy({}, { get: (_t, p) => { if (p === 'then') return undefined; throw new Error(`onModuleInit touched a dependency (.${String(p)})`); } });

const PACKET_FACTORIES: Array<[string, () => { onModuleInit(): unknown; onModuleDestroy(): unknown }]> = [
  ['margin-snapshot', () => new MarginSnapshotSchedulerService(untouchable() as any, untouchable() as any)],
  ['financial-briefing', () => new FinancialBriefingSchedulerService(untouchable() as any, untouchable() as any, untouchable() as any)],
  ['best-channel', () => new BestChannelSchedulerService(untouchable() as any, untouchable() as any)],
  ['crm-sequence', () => new CrmSequenceSchedulerService(untouchable() as any, untouchable() as any, untouchable() as any)],
];

function timersArmedBy(make: () => { onModuleInit(): unknown; onModuleDestroy(): unknown }): number {
  vi.useFakeTimers();
  const svc = make();
  svc.onModuleInit();
  const armed = vi.getTimerCount();
  svc.onModuleDestroy();
  vi.useRealTimers();
  return armed;
}

describe('the four OnModuleInit interval schedulers honour the unified switch', () => {
  it('control: with no switch set (NODE_ENV=production) each one arms its timer, so "no timer" below is a real answer', () => {
    expect(PACKET_FACTORIES).toHaveLength(4);
    for (const [name, make] of PACKET_FACTORIES) {
      setSwitches({ NODE_ENV: 'production' });
      expect(timersArmedBy(make), `${name} armed nothing even with no switch set`).toBeGreaterThan(0);
    }
  });

  it('DISABLE_SCHEDULERS=1 (NODE_ENV=production): none of the four arms a timer', () => {
    const armed = PACKET_FACTORIES.map(([name, make]) => {
      setSwitches({ NODE_ENV: 'production', DISABLE_SCHEDULERS: '1' });
      return [name, timersArmedBy(make)] as const;
    });
    expect(armed).toEqual(PACKET_FACTORIES.map(([name]) => [name, 0]));
  });

  it("NODE_ENV==='test' alone: none of the four arms a timer", () => {
    const armed = PACKET_FACTORIES.map(([name, make]) => {
      setSwitches({ NODE_ENV: 'test' });
      return [name, timersArmedBy(make)] as const;
    });
    expect(armed).toEqual(PACKET_FACTORIES.map(([name]) => [name, 0]));
  });

  it('KF_DISABLE_SCHEDULERS=1 (NODE_ENV=production) is honoured too: the unified switch is additive', () => {
    const armed = PACKET_FACTORIES.map(([name, make]) => {
      setSwitches({ NODE_ENV: 'production', KF_DISABLE_SCHEDULERS: '1' });
      return [name, timersArmedBy(make)] as const;
    });
    expect(armed).toEqual(PACKET_FACTORIES.map(([name]) => [name, 0]));
  });

  it('structurally, each packet scheduler calls schedulersDisabled() in onModuleInit before it arms an interval', () => {
    const all = intervalSchedulers();
    const packet = all.filter((s) => PACKET_SCHEDULERS.includes(s.file));
    expect(packet.map((s) => s.file)).toEqual(PACKET_SCHEDULERS);
    const ungated = packet
      .filter((s) => {
        const guard = s.init.search(/\bschedulersDisabled\s*\(/);
        const arm = s.init.search(/\b(?:setInterval|safeInterval|setTimeout|safeTimeout)\s*\(/);
        return guard < 0 || guard > arm;
      })
      .map((s) => s.file);
    expect(ungated).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// every OnModuleInit interval scheduler: census and ratchet
// ---------------------------------------------------------------------------

describe('census: every OnModuleInit interval scheduler in apps/server/src', () => {
  const all = intervalSchedulers();

  it('the scan is non-empty and sees both gated and ungated schedulers (gate-vacuity control)', () => {
    expect(all.length).toBeGreaterThan(40);
    expect(all.filter((s) => s.honours).length).toBeGreaterThanOrEqual(10);
    // The legacy spelling is recognised: invoice-overdue has honoured DISABLE_SCHEDULERS since before V1-24.
    expect(all.find((s) => s.file === 'src/modules/commerce/invoice-overdue.scheduler.ts')?.honours).toBe(true);
    for (const f of PACKET_SCHEDULERS) expect(all.map((s) => s.file)).toContain(f);
  });

  it('ratchet: no scheduler outside the pinned list ignores DISABLE_SCHEDULERS, and every pinned entry is still ungated (remove it when fixed)', () => {
    const ungatedOutside = all.filter((s) => !s.honours && !PACKET_SCHEDULERS.includes(s.file)).map((s) => s.file);
    expect(ungatedOutside.filter((f) => !KNOWN_UNGATED_OUTSIDE_WRITE_SET.includes(f))).toEqual([]);
    expect(KNOWN_UNGATED_OUTSIDE_WRITE_SET.filter((f) => !ungatedOutside.includes(f))).toEqual([]);
    expect(KNOWN_UNGATED_OUTSIDE_WRITE_SET.length).toBeGreaterThan(0);
  });

  it.todo(
    'every OnModuleInit interval scheduler honours DISABLE_SCHEDULERS: the 34 in KNOWN_UNGATED_OUTSIDE_WRITE_SET are outside the V1-24 write set (follow-up packet; the packet named only four)',
  );

  it('own flags still honoured (additive): every scheduler that read a per-scheduler or KF_ flag still reads it', () => {
    expect(OWN_FLAGS.length).toBeGreaterThan(5);
    const missing = OWN_FLAGS.filter(([file, flag]) => !readFileSync(join(SERVER_ROOT, file), 'utf8').includes(`process.env.${flag}`)).map(
      ([file, flag]) => `${file}: ${flag}`,
    );
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// cortex @Cron handlers
// ---------------------------------------------------------------------------

describe('every cortex @Cron handler returns early with KEY off', () => {
  const handlers = cortexCronHandlers();

  it('the scan is non-empty: 16 handlers in 9 files at the V1-24 base (gate-vacuity control)', () => {
    expect(handlers.length).toBeGreaterThanOrEqual(16);
    expect(new Set(handlers.map((h) => h.file)).size).toBeGreaterThanOrEqual(9);
    expect(handlers.every((h) => h.body.startsWith('{'))).toBe(true);
  });

  it('structurally, `if (keyCronsDisabled()) return` is the first statement of every handler', () => {
    const unguarded = handlers.filter((h) => !CRON_GUARD_FIRST.test(h.body)).map((h) => `${h.file}#${h.method}`);
    expect(unguarded).toEqual([]);
  });

  async function cronFns(): Promise<Array<{ id: string; fn: (...a: unknown[]) => unknown }>> {
    const out: Array<{ id: string; fn: (...a: unknown[]) => unknown }> = [];
    for (const h of handlers) {
      const mod = (await import(h.abs)) as Record<string, unknown>;
      const owner = Object.values(mod).find(
        (v): v is { prototype: Record<string, unknown> } =>
          typeof v === 'function' && typeof (v as { prototype?: Record<string, unknown> }).prototype?.[h.method] === 'function',
      );
      expect(owner, `${h.file}: no exported class has ${h.method}`).toBeDefined();
      out.push({ id: `${h.file}#${h.method}`, fn: owner!.prototype[h.method] as (...a: unknown[]) => unknown });
    }
    return out;
  }

  it('control: with neither KEY_DISABLED nor a scheduler switch set, every handler reads its service (so "no read" below is a real answer)', async () => {
    setSwitches({ NODE_ENV: 'test' });
    const fns = await cronFns();
    expect(fns.length).toBeGreaterThanOrEqual(16);
    const silent: string[] = [];
    for (const { id, fn } of fns) {
      const t = trap();
      await runOn(fn, t.self);
      if (t.reads.length === 0) silent.push(id);
    }
    expect(silent).toEqual([]);
  }, 60_000);

  it('KEY_DISABLED=1: every handler returns without reading anything from its service (no business scan, no model call)', async () => {
    setSwitches({ NODE_ENV: 'test', KEY_DISABLED: '1' });
    const fns = await cronFns();
    expect(fns.length).toBeGreaterThanOrEqual(16);
    const touched: string[] = [];
    for (const { id, fn } of fns) {
      const t = trap();
      await runOn(fn, t.self);
      if (t.reads.length > 0) touched.push(`${id} read this.${t.reads[0]}`);
    }
    expect(touched).toEqual([]);
  }, 60_000);

  it('DISABLE_SCHEDULERS=1 stops them too (one switch for every scheduler)', async () => {
    setSwitches({ NODE_ENV: 'production', DISABLE_SCHEDULERS: '1' });
    const fns = await cronFns();
    expect(fns.length).toBeGreaterThanOrEqual(16);
    const touched: string[] = [];
    for (const { id, fn } of fns) {
      const t = trap();
      await runOn(fn, t.self);
      if (t.reads.length > 0) touched.push(`${id} read this.${t.reads[0]}`);
    }
    expect(touched).toEqual([]);
  }, 60_000);
});
