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
 *   - What KEY_DISABLED does NOT cover yet (review SEC-V124-1, V124-CR-1): a census
 *     of every source file that reaches an AI provider without the gateway (an SDK
 *     client, or a provider credential plus its own fetch/WebSocket). Each one that
 *     does not read keyDisabled() must be in KEY_DISABLED_NOT_COVERED, which the
 *     boot warning prints, so the operator is never told "no provider is called"
 *     while one of these still calls it. A fixed entry must leave the list.
 *
 * Every scan asserts its input was non-empty (gate-vacuity.spec.ts).
 *
 * V1-24b-KEY-OFF-SWITCH-COVERAGE (from the V1-24 census, SEC-V124-1/2 and the
 * f5c93ba0 scheduler-race flake): the ratchets above become absolute.
 *   - Every OnModuleInit interval scheduler in apps/server/src calls
 *     schedulersDisabled() as the first statement of onModuleInit, and,
 *     behaviourally, arms no timer and reads nothing but its logger under
 *     DISABLE_SCHEDULERS, KF_DISABLE_SCHEDULERS or NODE_ENV=test. The control
 *     (it arms with no switch, and under NODE_ENV=test with the explicit opt-in
 *     ENABLE_SCHEDULERS_IN_TEST=1) makes "no timer" a real answer.
 *   - A timer armed anywhere else (a constructor, a helper) is either gated
 *     the same way or named in IN_PROCESS_TIMERS with why it is not a scheduler.
 *   - Every @Cron, @Interval and @Timeout handler in apps/server/src (not only
 *     the cortex ones) runs the guard first and, behaviourally, returns without
 *     touching its service under NODE_ENV=test unless opted in, and under
 *     DISABLE_SCHEDULERS or KF_DISABLE_SCHEDULERS. keyCronsDisabled() now
 *     includes schedulersDisabled(), so the cortex crons also stop under
 *     NODE_ENV=test (V1-24 left that out; a spawned test server that does not
 *     set DISABLE_SCHEDULERS, such as app-module-boots, ran them).
 *   - KEY_DISABLED_NOT_COVERED is empty: every direct AI provider path reads
 *     keyDisabled() (behaviour proven in ai-usage.service.spec.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import * as envModule from './env';
import { MarginSnapshotSchedulerService } from '../../modules/commerce/margin-snapshot-scheduler.service';
import { FinancialBriefingSchedulerService } from '../../modules/commerce/financial-briefing-scheduler.service';
import { BestChannelSchedulerService } from '../../modules/crm/best-channel-scheduler.service';
import { CrmSequenceSchedulerService } from '../../modules/crm/crm-sequence-scheduler.service';
import { KEY_DISABLED_NOT_COVERED } from '../../modules/ai/model-gateway.service';

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
 * onModuleInit did not honour DISABLE_SCHEDULERS. At the V1-24 base
 * (int/trial-F f5c93ba0) and again at the V1-24b base (0a481439) this held 34
 * entries (connector health/sync, error-digest, agent-health, ai-usage-alert,
 * connector-intelligence, match-refresh, pattern-detector, plan-executor,
 * pro-auto-monitor, delegation-loop, bookings reminders, calendar-insight,
 * calendar-sync, recurring-invoice, delivery-queue, abandoned-cart,
 * review-solicitation, crm-data-quality, crm relationship-health,
 * deal-intelligence, lead-scoring, contact-privacy, campaign-scheduler,
 * recurring-expense, recurring-journal-entry, flow.listener, growth-intelligence,
 * momentum, transactional-email, currency-rates, storefront-conversion,
 * social-gap-detector, social-scheduler). V1-24b gates every one; the list
 * must stay empty.
 */
const KNOWN_UNGATED_OUTSIDE_WRITE_SET: string[] = [];

/** `{`, any comment lines, then `if (schedulersDisabled())` as the first statement. */
const SCHEDULER_GUARD_FIRST = /^\{\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*if\s*\(\s*schedulersDisabled\(\)\s*\)/;

/**
 * Own flags that worked before V1-24 and must keep working (additive): the
 * file still reads the flag. KF_DISABLE_SCHEDULERS, which calendar-sync and
 * crm-data-quality used to read themselves, is now read through
 * schedulersDisabled() and proven behaviourally for every scheduler below.
 */
const OWN_FLAGS: Array<[string, string]> = [
  ['src/modules/ai/ai-usage-alert-scheduler.service.ts', 'AI_USAGE_ALERT_SCHEDULER_DISABLED'],
  ['src/modules/calendar/calendar-insight-scheduler.service.ts', 'DISABLE_CALENDAR_INSIGHT_SCHEDULER'],
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

const SWITCHES = ['DISABLE_SCHEDULERS', 'KF_DISABLE_SCHEDULERS', 'KEY_DISABLED', 'NODE_ENV', 'ENABLE_SCHEDULERS_IN_TEST'] as const;
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

  // V1-24b: V1-24 left NODE_ENV=test out of keyCronsDisabled() because the cortex
  // specs call the handlers directly. A spawned test server that does not set
  // DISABLE_SCHEDULERS (app-module-boots spreads the runner's env) then ran every
  // cortex cron against the shared database. Now NODE_ENV=test stops them too,
  // and a spec that calls a handler directly opts in with ENABLE_SCHEDULERS_IN_TEST.
  it('keyCronsDisabled() is on for KEY_DISABLED, DISABLE_SCHEDULERS, KF_DISABLE_SCHEDULERS and NODE_ENV=test, and off under NODE_ENV=test only with the explicit opt-in (V1-24b)', () => {
    expect(typeof env.keyCronsDisabled).toBe('function');
    const off = env.keyCronsDisabled!;
    setSwitches({ NODE_ENV: 'production' });
    expect(off()).toBe(false);
    setSwitches({ NODE_ENV: 'test' });
    expect(off()).toBe(true);
    setSwitches({ NODE_ENV: 'test', ENABLE_SCHEDULERS_IN_TEST: '1' });
    expect(off()).toBe(false);
    setSwitches({ NODE_ENV: 'test', ENABLE_SCHEDULERS_IN_TEST: '1', KEY_DISABLED: '1' });
    expect(off()).toBe(true);
    setSwitches({ NODE_ENV: 'production', KEY_DISABLED: '1' });
    expect(off()).toBe(true);
    setSwitches({ NODE_ENV: 'production', DISABLE_SCHEDULERS: '1' });
    expect(off()).toBe(true);
    setSwitches({ NODE_ENV: 'production', KF_DISABLE_SCHEDULERS: 'true' });
    expect(off()).toBe(true);
  });

  it('ENABLE_SCHEDULERS_IN_TEST is an opt-in for NODE_ENV=test only: it never overrides DISABLE_SCHEDULERS or KF_DISABLE_SCHEDULERS, and outside test it changes nothing (V1-24b)', () => {
    const on = env.schedulersDisabled!;
    setSwitches({ NODE_ENV: 'test', ENABLE_SCHEDULERS_IN_TEST: '1' });
    expect(on()).toBe(false);
    setSwitches({ NODE_ENV: 'test', ENABLE_SCHEDULERS_IN_TEST: 'true' });
    expect(on()).toBe(false);
    setSwitches({ NODE_ENV: 'test', ENABLE_SCHEDULERS_IN_TEST: '0' });
    expect(on()).toBe(true);
    setSwitches({ NODE_ENV: 'test', ENABLE_SCHEDULERS_IN_TEST: '1', DISABLE_SCHEDULERS: '1' });
    expect(on()).toBe(true);
    setSwitches({ NODE_ENV: 'test', ENABLE_SCHEDULERS_IN_TEST: '1', KF_DISABLE_SCHEDULERS: '1' });
    expect(on()).toBe(true);
    setSwitches({ NODE_ENV: 'production', ENABLE_SCHEDULERS_IN_TEST: '1', DISABLE_SCHEDULERS: '1' });
    expect(on()).toBe(true);
    setSwitches({ NODE_ENV: 'production', ENABLE_SCHEDULERS_IN_TEST: '1' });
    expect(on()).toBe(false);
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
// every OnModuleInit interval scheduler: census, structure and behaviour
// ---------------------------------------------------------------------------

const QUIET_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {}, fatal() {} };

/**
 * A deep, permissive stand-in for a dependency: every property is itself,
 * every call returns itself, it is not thenable, iterates as empty and
 * stringifies. Used only for the CONTROL runs, where the question is "does this
 * scheduler arm a timer at all", not what its work does.
 */
function permissive(): any {
  const target = function stub() {};
  const p: any = new Proxy(target, {
    get(_t, prop) {
      if (prop === 'then') return undefined;
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === Symbol.iterator) return function* empty() {};
      if (typeof prop === 'symbol') return undefined;
      return p;
    },
    apply: () => p,
    construct: () => p,
  });
  return p;
}

/**
 * A `this` for onModuleInit built from the class prototype (no constructor
 * runs). It hands out a silent logger, keeps what onModuleInit assigns, and
 * records every other property read. Strict: the read throws (the disabled runs
 * must read nothing but the logger). Permissive: prototype methods run for real
 * and anything else is a permissive() stand-in (the control runs).
 */
function schedulerSelf(proto: Record<string, unknown>, mode: 'strict' | 'permissive') {
  const reads: string[] = [];
  const own = new Map<PropertyKey, unknown>();
  const self: any = new Proxy(Object.create(proto), {
    get(t, prop, receiver) {
      if (prop === 'then') return undefined;
      if (prop === 'logger') return QUIET_LOGGER;
      if (own.has(prop)) return own.get(prop);
      if (typeof prop === 'symbol') return Reflect.get(t, prop, receiver);
      reads.push(prop);
      if (mode === 'strict') throw new Error(`onModuleInit touched this.${prop}`);
      const fromProto = proto[prop];
      return typeof fromProto === 'function' ? (fromProto as (...a: unknown[]) => unknown).bind(self) : permissive();
    },
    set(_t, prop, value) {
      own.set(prop, value);
      return true;
    },
  });
  return { self, reads };
}

/** The exported class of a scheduler file whose prototype defines `method`. */
async function exportedClassWith(abs: string, method: string): Promise<{ name: string; prototype: Record<string, unknown> } | undefined> {
  const mod = (await import(abs)) as Record<string, unknown>;
  return Object.values(mod).find(
    (v): v is { name: string; prototype: Record<string, unknown> } =>
      typeof v === 'function' && typeof (v as { prototype?: Record<string, unknown> }).prototype?.[method] === 'function',
  );
}

/** Timers onModuleInit arms (fake clock, nothing fires), and what it read off `this`. */
async function initRun(proto: Record<string, unknown>, mode: 'strict' | 'permissive'): Promise<{ armed: number; reads: string[]; error?: string }> {
  const { self, reads } = schedulerSelf(proto, mode);
  vi.useFakeTimers();
  let error: string | undefined;
  try {
    await (proto.onModuleInit as () => unknown).call(self);
  } catch (e) {
    error = (e as Error).message;
  }
  const armed = vi.getTimerCount();
  vi.clearAllTimers();
  vi.useRealTimers();
  return { armed, reads, error };
}

describe('census: every OnModuleInit interval scheduler in apps/server/src', () => {
  const all = intervalSchedulers();

  it('the scan is non-empty and sees every scheduler class the V1-24 census counted (gate-vacuity control)', () => {
    // 48 at the V1-24b base: 34 ungated, 10 on the legacy DISABLE_SCHEDULERS spelling, the 4 V1-24 ones.
    expect(all.length).toBeGreaterThanOrEqual(48);
    for (const f of PACKET_SCHEDULERS) expect(all.map((s) => s.file)).toContain(f);
    for (const f of [
      'src/modules/crm/crm-data-quality.scheduler.ts',
      'src/core/connectors/connector-sync-scheduler.service.ts',
      'src/modules/calendar/calendar-insight-scheduler.service.ts',
      'src/modules/commerce/invoice-overdue.scheduler.ts',
    ]) {
      expect(all.map((s) => s.file)).toContain(f);
    }
  });

  it('ratchet: the pinned list of ungated schedulers is empty, and nothing outside it ignores DISABLE_SCHEDULERS (V1-24b)', () => {
    const ungatedOutside = all.filter((s) => !s.honours && !PACKET_SCHEDULERS.includes(s.file)).map((s) => s.file);
    expect(ungatedOutside.filter((f) => !KNOWN_UNGATED_OUTSIDE_WRITE_SET.includes(f))).toEqual([]);
    expect(KNOWN_UNGATED_OUTSIDE_WRITE_SET.filter((f) => !ungatedOutside.includes(f))).toEqual([]);
    expect(KNOWN_UNGATED_OUTSIDE_WRITE_SET).toEqual([]);
  });

  it('structurally, `if (schedulersDisabled())` is the first statement of every onModuleInit that arms an interval (the legacy DISABLE_SCHEDULERS spelling does not honour KF_DISABLE_SCHEDULERS or the test opt-in)', () => {
    const notFirst = all.filter((s) => !SCHEDULER_GUARD_FIRST.test(s.init)).map((s) => s.file);
    expect(notFirst).toEqual([]);
  });

  async function schedulerProtos(): Promise<Array<{ file: string; proto: Record<string, unknown> }>> {
    const out: Array<{ file: string; proto: Record<string, unknown> }> = [];
    for (const s of all) {
      const cls = await exportedClassWith(join(SERVER_ROOT, s.file), 'onModuleInit');
      expect(cls, `${s.file}: no exported class has onModuleInit`).toBeDefined();
      out.push({ file: s.file, proto: cls!.prototype });
    }
    return out;
  }

  for (const [label, switches] of [
    ['DISABLE_SCHEDULERS=1 (NODE_ENV=production)', { NODE_ENV: 'production', DISABLE_SCHEDULERS: '1' }],
    ['KF_DISABLE_SCHEDULERS=1 (NODE_ENV=production)', { NODE_ENV: 'production', KF_DISABLE_SCHEDULERS: '1' }],
    ["NODE_ENV==='test' alone (every integration app, in-process or spawned)", { NODE_ENV: 'test' }],
  ] as const) {
    it(`${label}: no scheduler arms a timer or reads anything but its logger`, async () => {
      const protos = await schedulerProtos();
      expect(protos.length).toBeGreaterThanOrEqual(48);
      const ticking: string[] = [];
      for (const { file, proto } of protos) {
        setSwitches(switches);
        const run = await initRun(proto, 'strict');
        if (run.armed > 0 || run.reads.length > 0) ticking.push(`${file}: armed ${run.armed}, read ${run.reads.join(',') || 'nothing'}`);
      }
      expect(ticking).toEqual([]);
    }, 120_000);
  }

  for (const [label, switches] of [
    ['no switch set (NODE_ENV=production)', { NODE_ENV: 'production' }],
    ['NODE_ENV=test with the explicit opt-in ENABLE_SCHEDULERS_IN_TEST=1', { NODE_ENV: 'test', ENABLE_SCHEDULERS_IN_TEST: '1' }],
  ] as const) {
    it(`control, ${label}: every scheduler arms a timer, so "no timer" above is a real answer`, async () => {
      const protos = await schedulerProtos();
      const silent: string[] = [];
      for (const { file, proto } of protos) {
        setSwitches(switches);
        const run = await initRun(proto, 'permissive');
        if (run.armed === 0) silent.push(`${file}${run.error ? ` (threw: ${run.error})` : ''}`);
      }
      expect(silent).toEqual([]);
    }, 120_000);
  }

  it('own flags still honoured (additive): every scheduler that read a per-scheduler flag still reads it', () => {
    expect(OWN_FLAGS.length).toBeGreaterThan(5);
    const missing = OWN_FLAGS.filter(([file, flag]) => !readFileSync(join(SERVER_ROOT, file), 'utf8').includes(`process.env.${flag}`)).map(
      ([file, flag]) => `${file}: ${flag}`,
    );
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// timers armed outside onModuleInit
// ---------------------------------------------------------------------------

/**
 * Timers armed outside onModuleInit that are NOT schedulers: in-process
 * housekeeping that touches no database, sends nothing and calls no provider,
 * or a security control that must run in tests. Every other file that arms an
 * interval outside onModuleInit must call schedulersDisabled().
 */
const IN_PROCESS_TIMERS: Record<string, string> = {
  'src/core/scheduling/safe-interval.ts': 'the safeInterval helper itself',
  'src/modules/ai/ai-usage.service.ts': 'prunes the in-memory per-business rate-limit map',
  'src/modules/key-cortex/key-cortex-executor.service.ts': 'prunes the in-memory pending-approvals map',
  'src/modules/social/social-connections.service.ts': 'prunes the in-memory OAuth session map',
  'src/modules/key-cortex/key-cortex.gateway.ts':
    'the WebSocket live-revocation re-check (R0-W): a security control, measured by identity-boundary ST-WS-R1, that must run in tests',
};

/** Source text with comments removed (URLs survive: `//` after `:` is kept). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function timersOutsideOnModuleInit(): Array<{ file: string; gated: boolean }> {
  const out: Array<{ file: string; gated: boolean }> = [];
  for (const abs of sourceFiles(SRC)) {
    let src = stripComments(readFileSync(abs, 'utf8'));
    const m = ON_MODULE_INIT.exec(src);
    if (m) src = src.replace(braceBlock(src, m.index), '{}');
    if (!ARMS_INTERVAL.test(src)) continue;
    out.push({ file: posix(abs), gated: /\bschedulersDisabled\s*\(/.test(src) });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** A class member declaration at the repo's 2-space member indentation. */
const MEMBER_DECL = /^ {2}(?:(?:public|private|protected|static|readonly|override)\s+)*(?:async\s+)?(?!(?:if|for|while|switch|catch|return|await)\b)(\w+)\s*\(/gm;
const REGISTERS_REPEATABLE = /\brepeat\s*:/;

/** The name of the class member whose declaration precedes `at`. */
function memberAt(src: string, at: number): string | undefined {
  let name: string | undefined;
  for (const m of src.matchAll(MEMBER_DECL)) {
    if ((m.index ?? 0) > at) break;
    name = m[1];
  }
  return name;
}

/** The body of class member `name` (past its parameters and any return type, `Promise<{ ... }>` included). */
function memberBody(src: string, name: string): string {
  const m = new RegExp(`^ {2}(?:(?:public|private|protected|static|override)\\s+)*(?:async\\s+)?${name}\\s*\\(`, 'm').exec(src);
  if (!m) return '';
  let i = closeParen(src, src.indexOf('(', m.index));
  let angle = 0;
  for (; i > 0 && i < src.length; i++) {
    const c = src[i];
    if (c === '<') angle++;
    else if (c === '>' && src[i - 1] !== '=') angle--;
    else if (c === '{') {
      if (angle <= 0) return braceBlock(src, i);
      i += braceBlock(src, i).length - 1;
    }
  }
  return '';
}

/** Methods anywhere in apps/server/src whose body registers a BullMQ repeatable (QueueService.enqueueCronTrigger, ...). */
function repeatRegistrars(): string[] {
  const names = new Set<string>();
  for (const abs of sourceFiles(SRC)) {
    const src = stripComments(readFileSync(abs, 'utf8'));
    for (const m of src.matchAll(/\brepeat\s*:/g)) {
      const name = memberAt(src, m.index ?? 0);
      if (name && name !== 'onModuleInit' && name !== 'constructor') names.add(name);
    }
  }
  return [...names].sort();
}

/**
 * Every onModuleInit that registers a BullMQ repeatable: directly (`repeat:` in
 * its body), by calling a registrar method on another object, or through a
 * same-class method that does either (followed transitively). `at` is the index
 * in the onModuleInit body of the first such registration point.
 */
function bootRepeatableRegistrations(): Array<{ file: string; init: string; at: number; via: string }> {
  const registrars = repeatRegistrars();
  const callsRegistrar = (body: string) => registrars.find((r) => new RegExp(`\\.${r}\\s*\\(`).test(body));
  const out: Array<{ file: string; init: string; at: number; via: string }> = [];
  for (const abs of sourceFiles(SRC)) {
    const src = stripComments(readFileSync(abs, 'utf8'));
    const m = ON_MODULE_INIT.exec(src);
    if (!m) continue;
    const init = braceBlock(src, m.index);
    const reaches = (name: string, seen: Set<string>): string | undefined => {
      if (seen.has(name)) return undefined;
      seen.add(name);
      const body = memberBody(src, name);
      if (REGISTERS_REPEATABLE.test(body)) return `${name}: repeat`;
      const r = callsRegistrar(body);
      if (r) return `${name} -> ${r}`;
      for (const c of body.matchAll(/\bthis\.(\w+)\s*\(/g)) {
        const via = reaches(c[1], seen);
        if (via) return `${name} -> ${via}`;
      }
      return undefined;
    };
    const points: Array<{ at: number; via: string }> = [];
    const direct = init.search(REGISTERS_REPEATABLE);
    if (direct >= 0) points.push({ at: direct, via: 'repeat in onModuleInit' });
    for (const r of registrars) {
      const at = init.search(new RegExp(`\\.${r}\\s*\\(`));
      if (at >= 0) points.push({ at, via: r });
    }
    for (const c of init.matchAll(/\bthis\.(\w+)\s*\(/g)) {
      const via = reaches(c[1], new Set(['onModuleInit']));
      if (via) points.push({ at: c.index ?? 0, via });
    }
    if (points.length === 0) continue;
    points.sort((a, b) => a.at - b.at);
    out.push({ file: posix(abs), init, at: points[0].at, via: points[0].via });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

describe('census: intervals armed outside onModuleInit (constructors, helpers)', () => {
  const found = timersOutsideOnModuleInit();

  it('the scan is non-empty and finds the in-process housekeeping timers (gate-vacuity control)', () => {
    expect(found.length).toBeGreaterThanOrEqual(6);
    for (const f of Object.keys(IN_PROCESS_TIMERS)) expect(found.map((t) => t.file)).toContain(f);
    expect(found.map((t) => t.file)).toContain('src/modules/flow/cross-module-agent.service.ts');
  });

  it('every one is either gated by schedulersDisabled() or named in IN_PROCESS_TIMERS with why it is not a scheduler', () => {
    const ungated = found.filter((t) => !t.gated && !(t.file in IN_PROCESS_TIMERS)).map((t) => t.file);
    expect(ungated).toEqual([]);
    expect(Object.keys(IN_PROCESS_TIMERS).filter((f) => !found.some((t) => t.file === f)), 'listed but no longer arms a timer').toEqual([]);
  });

  // Found while implementing V1-24b (added after the tests-first commit): a BullMQ
  // repeatable job registered in onModuleInit is a scheduler too, kept in Redis
  // and run by any worker. temporal-flow-memory registered a 6-hourly compaction.
  //
  // V1-24b review (SEC-V124b-1): the first version of this scan looked for a
  // literal `repeat:` inside an onModuleInit body only, so it could not see
  // CronSchedulerService, whose onModuleInit calls this.syncCronTriggers(),
  // which calls QueueService.enqueueCronTrigger(), which holds the `repeat:`.
  // The scan now follows the calls: same-class methods (transitively) and any
  // method, in any file, that registers a repeatable. Behaviour, on real BullMQ,
  // is proven in scheduler-kill-switch-bullmq.spec.ts.
  it('a BullMQ repeatable job registered at boot, directly or through the methods onModuleInit calls, reads schedulersDisabled() first (temporal-flow-memory compaction, the tenant AI cron triggers)', () => {
    const registering = bootRepeatableRegistrations();
    expect(registering.map((r) => r.file)).toEqual(
      expect.arrayContaining(['src/modules/temporal-flow/temporal-flow-memory.queue.service.ts', 'src/modules/ai/cron-scheduler.service.ts']),
    );
    const ungated = registering
      .filter((r) => {
        const guard = r.init.search(/\bschedulersDisabled\s*\(/);
        return guard < 0 || guard > r.at;
      })
      .map((r) => `${r.file} (${r.via})`);
    expect(ungated).toEqual([]);
  });

  it('a file that registers a BullMQ repeatable and starts a Worker reads schedulersDisabled(), so a repeatable an earlier boot left in Redis is not run with schedulers off (SEC-V124b-1, CR-V124b-1)', () => {
    const files = sourceFiles(SRC)
      .map((abs) => ({ file: posix(abs), src: stripComments(readFileSync(abs, 'utf8')) }))
      .filter((f) => /\brepeat\s*:/.test(f.src) && /\bnew\s+Worker\s*[<(]/.test(f.src));
    expect(files.map((f) => f.file)).toEqual(
      expect.arrayContaining(['src/modules/temporal-flow/temporal-flow-memory.queue.service.ts', 'src/modules/ai/queue.service.ts']),
    );
    expect(files.filter((f) => !/\bschedulersDisabled\s*\(/.test(f.src)).map((f) => f.file)).toEqual([]);
  });

  it('behaviourally, the cross-module agent job poller (armed in its constructor) arms nothing under NODE_ENV=test or DISABLE_SCHEDULERS, and arms with the opt-in (control)', async () => {
    const cls = (await exportedClassWith(join(SRC, 'modules/flow/cross-module-agent.service.ts'), 'onModuleDestroy')) as unknown as new (
      ...a: unknown[]
    ) => { onModuleDestroy(): void };
    expect(cls).toBeDefined();
    const armedUnder = (switches: Partial<Record<(typeof SWITCHES)[number], string>>) => {
      setSwitches(switches);
      vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      vi.useFakeTimers();
      const svc = new cls(permissive(), permissive(), permissive(), null, permissive());
      const armed = vi.getTimerCount();
      svc.onModuleDestroy();
      vi.clearAllTimers();
      vi.useRealTimers();
      return armed;
    };
    expect(armedUnder({ NODE_ENV: 'test' })).toBe(0);
    expect(armedUnder({ NODE_ENV: 'production', DISABLE_SCHEDULERS: '1' })).toBe(0);
    expect(armedUnder({ NODE_ENV: 'production', KF_DISABLE_SCHEDULERS: '1' })).toBe(0);
    expect(armedUnder({ NODE_ENV: 'test', ENABLE_SCHEDULERS_IN_TEST: '1' })).toBeGreaterThan(0);
    expect(armedUnder({ NODE_ENV: 'production' })).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// cortex @Cron handlers
// ---------------------------------------------------------------------------

/** Every `@Cron(` / `@Interval(` / `@Timeout(` handler under `dir`, past any comments and stacked decorators. */
function scheduledHandlers(dir: string, decorators: RegExp): CronHandler[] {
  const out: CronHandler[] = [];
  for (const abs of sourceFiles(dir)) {
    const src = readFileSync(abs, 'utf8');
    const re = new RegExp(`^\\s*@(?:${decorators.source})\\(`, 'gm');
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      let i = closeParen(src, src.indexOf('(', m.index));
      // Skip whitespace, comments and further decorators up to the method signature.
      for (;;) {
        const rest = src.slice(i);
        const trivia = /^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)/.exec(rest);
        if (trivia && trivia[0].length > 0) {
          i += trivia[0].length;
          continue;
        }
        const deco = /^@[A-Za-z0-9_.]+/.exec(rest);
        if (deco) {
          i += deco[0].length;
          if (src[i] === '(') i = closeParen(src, i);
          continue;
        }
        break;
      }
      const sig = /^(?:public\s+)?(?:async\s+)?([A-Za-z0-9_]+)\s*\(/.exec(src.slice(i));
      if (!sig) continue;
      const paramsOpen = i + sig[0].length - 1;
      const paramsClose = closeParen(src, paramsOpen);
      out.push({ file: posix(abs), abs, method: sig[1], body: braceBlock(src, paramsClose) });
    }
  }
  return out.sort((a, b) => `${a.file}#${a.method}`.localeCompare(`${b.file}#${b.method}`));
}

/** `{`, any comment lines, then `if (schedulersDisabled()) return` or `if (keyCronsDisabled()) return` first. */
const SCHEDULED_GUARD_FIRST =
  /^\{\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*if\s*\(\s*(?:schedulersDisabled|keyCronsDisabled)\(\)\s*\)\s*(?:\{\s*)?return\b/;

async function handlerFns(handlers: CronHandler[]): Promise<Array<{ id: string; fn: (...a: unknown[]) => unknown }>> {
  const out: Array<{ id: string; fn: (...a: unknown[]) => unknown }> = [];
  for (const h of handlers) {
    const owner = await exportedClassWith(h.abs, h.method);
    expect(owner, `${h.file}: no exported class has ${h.method}`).toBeDefined();
    out.push({ id: `${h.file}#${h.method}`, fn: owner!.prototype[h.method] as (...a: unknown[]) => unknown });
  }
  return out;
}

async function readsUnder(
  fns: Array<{ id: string; fn: (...a: unknown[]) => unknown }>,
  switches: Partial<Record<(typeof SWITCHES)[number], string>>,
): Promise<{ touched: string[]; silent: string[] }> {
  const touched: string[] = [];
  const silent: string[] = [];
  for (const { id, fn } of fns) {
    setSwitches(switches);
    const t = trap();
    await runOn(fn, t.self);
    if (t.reads.length > 0) touched.push(`${id} read this.${t.reads[0]}`);
    else silent.push(id);
  }
  return { touched, silent };
}

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

  it('control: with no switch set (NODE_ENV=test plus the explicit opt-in ENABLE_SCHEDULERS_IN_TEST=1), every handler reads its service (so "no read" below is a real answer)', async () => {
    const fns = await handlerFns(handlers);
    expect(fns.length).toBeGreaterThanOrEqual(16);
    const { silent } = await readsUnder(fns, { NODE_ENV: 'test', ENABLE_SCHEDULERS_IN_TEST: '1' });
    expect(silent).toEqual([]);
  }, 60_000);

  it('KEY_DISABLED=1 alone (NODE_ENV=production, or NODE_ENV=test with the opt-in): every handler returns without reading anything from its service (no business scan, no model call)', async () => {
    const fns = await handlerFns(handlers);
    expect(fns.length).toBeGreaterThanOrEqual(16);
    expect((await readsUnder(fns, { NODE_ENV: 'production', KEY_DISABLED: '1' })).touched).toEqual([]);
    expect((await readsUnder(fns, { NODE_ENV: 'test', ENABLE_SCHEDULERS_IN_TEST: '1', KEY_DISABLED: '1' })).touched).toEqual([]);
  }, 60_000);

  it('DISABLE_SCHEDULERS=1 stops them too (one switch for every scheduler)', async () => {
    const fns = await handlerFns(handlers);
    expect(fns.length).toBeGreaterThanOrEqual(16);
    expect((await readsUnder(fns, { NODE_ENV: 'production', DISABLE_SCHEDULERS: '1' })).touched).toEqual([]);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// every @Cron / @Interval / @Timeout handler in apps/server/src (V1-24b)
// ---------------------------------------------------------------------------

describe('every @Cron, @Interval and @Timeout handler in apps/server/src honours the scheduler switches (V1-24b)', () => {
  const handlers = scheduledHandlers(SRC, /Cron|Interval|Timeout/);

  it('the scan is non-empty: the 16 cortex @Cron handlers plus the @Interval ticks and the @Cron handlers outside the cortex (gate-vacuity control)', () => {
    expect(handlers.length).toBeGreaterThanOrEqual(30);
    expect(handlers.filter((h) => !h.file.startsWith('src/modules/key-cortex/')).length).toBeGreaterThanOrEqual(13);
    for (const f of [
      'src/modules/analytics/analytics-scheduler.service.ts',
      'src/modules/whatsapp/whatsapp.service.ts',
      'src/modules/intelligence/scheduled-scans.service.ts',
      'src/modules/key-cortex/key-cortex-realtime.service.ts',
    ]) {
      expect(handlers.map((h) => h.file)).toContain(f);
    }
    expect(handlers.every((h) => h.body.startsWith('{'))).toBe(true);
  });

  it('structurally, the guard (schedulersDisabled(), or keyCronsDisabled() which includes it) is the first statement of every handler', () => {
    const unguarded = handlers.filter((h) => !SCHEDULED_GUARD_FIRST.test(h.body)).map((h) => `${h.file}#${h.method}`);
    expect(unguarded).toEqual([]);
  });

  it('control: NODE_ENV=test with the explicit opt-in ENABLE_SCHEDULERS_IN_TEST=1, every handler reads its service', async () => {
    const fns = await handlerFns(handlers);
    const { silent } = await readsUnder(fns, { NODE_ENV: 'test', ENABLE_SCHEDULERS_IN_TEST: '1' });
    expect(silent).toEqual([]);
  }, 60_000);

  for (const [label, switches] of [
    ["NODE_ENV==='test' alone (an integration app that boots ScheduleModule)", { NODE_ENV: 'test' }],
    ['DISABLE_SCHEDULERS=1 (NODE_ENV=production)', { NODE_ENV: 'production', DISABLE_SCHEDULERS: '1' }],
    ['KF_DISABLE_SCHEDULERS=1 (NODE_ENV=production)', { NODE_ENV: 'production', KF_DISABLE_SCHEDULERS: '1' }],
  ] as const) {
    it(`${label}: every handler returns without reading anything from its service`, async () => {
      const fns = await handlerFns(handlers);
      expect(fns.length).toBeGreaterThanOrEqual(30);
      expect((await readsUnder(fns, switches)).touched).toEqual([]);
    }, 60_000);
  }
});

// ---------------------------------------------------------------------------
// direct AI provider paths that bypass the gateway (review SEC-V124-1, V124-CR-1)
// ---------------------------------------------------------------------------

const GATEWAY_FILE = 'src/modules/ai/model-gateway.service.ts';
/** An AI provider SDK client built outside the gateway. */
const BUILDS_SDK_CLIENT = /\bnew\s+(?:OpenAI|Anthropic)\s*\(/;
/** An AI provider credential (the ones the gateway reads, plus OPENAI_API_KEY and ELEVENLABS_API_KEY). */
const PROVIDER_CREDENTIAL =
  /\bprocess\.env\.(?:AI_INTEGRATIONS_OPENAI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|XAI_API_KEY|KIMI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|OPENROUTER_API_KEY|NATIVE_AI_API_KEY|NATIVE_AI_BASE_URL|KEYFLOW_NATIVE_AI_URL|OLLAMA_BASE_URL|ELEVENLABS_API_KEY)\b|\bdirectOpenAiKey\s*\(/;
/** ...used by a file that opens its own connection. */
const OPENS_CONNECTION = /\bfetch\s*\(|\bnew\s+WebSocket\s*\(/;
const READS_KEY_SWITCH = /\bkeyDisabled\s*\(/;
/**
 * V1-24b review (SEC-V124b-2): an INDIRECT provider path. Dispatching the KEY
 * voice agent through LiveKit reaches OpenAI Realtime from another process
 * (apps/voice-agent), with no SDK client, credential or fetch in this server.
 */
const DISPATCHES_KEY_AGENT = /\bnew\s+AgentDispatchClient\s*\(|\.createDispatch\s*\(/;

interface DirectPath { file: string; gated: boolean }

function directProviderPaths(): DirectPath[] {
  const out: DirectPath[] = [];
  for (const abs of sourceFiles(SRC)) {
    const src = readFileSync(abs, 'utf8');
    if (!BUILDS_SDK_CLIENT.test(src) && !(PROVIDER_CREDENTIAL.test(src) && OPENS_CONNECTION.test(src)) && !DISPATCHES_KEY_AGENT.test(src)) continue;
    out.push({ file: posix(abs), gated: READS_KEY_SWITCH.test(src) });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** apps/voice-agent/src: the KEY voice agent worker, a separate process that holds the OpenAI Realtime session. */
const VOICE_AGENT_SRC = join(SERVER_ROOT, '..', 'voice-agent', 'src');
/** A model built in the worker: the agents OpenAI Realtime plugin, an SDK client, or a provider credential. */
const AGENT_BUILDS_MODEL = /\bRealtimeModel\s*\(|\bnew\s+(?:OpenAI|Anthropic)\s*\(|\bprocess\.env\.(?:AI_INTEGRATIONS_OPENAI_API_KEY|OPENAI_API_KEY)\b/;

function voiceAgentModelPaths(): DirectPath[] {
  return sourceFiles(VOICE_AGENT_SRC)
    .map((abs) => ({ abs, src: readFileSync(abs, 'utf8') }))
    .filter((f) => AGENT_BUILDS_MODEL.test(f.src))
    .map((f) => ({ file: relative(join(SERVER_ROOT, '..', '..'), f.abs).split(sep).join('/'), gated: READS_KEY_SWITCH.test(f.src) }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

describe('KEY_DISABLED coverage: every direct AI provider path outside the gateway is either gated or named in the boot warning', () => {
  const all = directProviderPaths();
  const notCovered = KEY_DISABLED_NOT_COVERED.map((p) => p.file);

  it('the scan is non-empty and finds the gateway as a gated path (gate-vacuity control)', () => {
    expect(all.length).toBeGreaterThanOrEqual(7);
    expect(all.find((p) => p.file === GATEWAY_FILE)).toEqual({ file: GATEWAY_FILE, gated: true });
    // The paths the review reproduced are seen by the scan (it would otherwise pass vacuously).
    for (const f of [
      'src/modules/key-cortex/key-cortex-voice.service.ts',
      'src/modules/ai/ai-usage.service.ts',
      'src/modules/key-cortex/key-cortex-document.service.ts',
      'src/modules/phone-voice/realtime-bridge.service.ts',
      // V1-24b review (SEC-V124b-2): the indirect path, LiveKit dispatch of the KEY voice agent.
      'src/modules/livekit/livekit.service.ts',
    ]) {
      expect(all.map((p) => p.file)).toContain(f);
    }
  });

  it('ratchet: every ungated direct path is in KEY_DISABLED_NOT_COVERED (so the boot line names it), and every listed entry is still a direct, ungated path (remove it when it reads keyDisabled())', () => {
    const ungated = all.filter((p) => !p.gated && p.file !== GATEWAY_FILE).map((p) => p.file);
    expect(ungated.filter((f) => !notCovered.includes(f)), 'a direct AI provider path ignores KEY_DISABLED and the boot line does not name it').toEqual([]);
    expect(notCovered.filter((f) => !ungated.includes(f)), 'listed as not covered but no longer an ungated direct path').toEqual([]);
    expect(new Set(notCovered).size).toBe(notCovered.length);
  });

  // V1-24b (SEC-V124-1): the it.todo that stood here. Every direct path reads
  // keyDisabled(); the refusal itself (no client built, no provider reached,
  // the KEY-disabled 503 or the path's own refusal) is proven per path in
  // ai-usage.service.spec.ts.
  it('every direct AI provider path reads keyDisabled(), so KEY_DISABLED_NOT_COVERED is empty (V1-24b, SEC-V124-1)', () => {
    const ungated = all.filter((p) => !p.gated && p.file !== GATEWAY_FILE).map((p) => p.file);
    expect(ungated).toEqual([]);
    expect(KEY_DISABLED_NOT_COVERED).toEqual([]);
  });

  // V1-24b review (SEC-V124b-2): the server census scanned apps/server/src only,
  // so the worker that actually talks to OpenAI Realtime was invisible. Every
  // file in apps/voice-agent/src that builds a model or reads an OpenAI key
  // reads KEY_DISABLED (behaviour in livekit.service.spec.ts).
  it('the KEY voice agent worker (apps/voice-agent/src) reads KEY_DISABLED wherever it builds a model (V1-24b, SEC-V124b-2)', () => {
    const paths = voiceAgentModelPaths();
    expect(paths.map((p) => p.file), 'gate-vacuity: the scan sees the worker entry').toContain('apps/voice-agent/src/main.ts');
    expect(paths.filter((p) => !p.gated).map((p) => p.file)).toEqual([]);
  });
});
