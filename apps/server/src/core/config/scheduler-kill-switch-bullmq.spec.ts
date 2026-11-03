/**
 * V1-24b review repairs (SEC-V124b-1, CR-V124b-1): the BullMQ repeatables the
 * server registers at boot are schedulers too, and the unified switch
 * (schedulersDisabled(): DISABLE_SCHEDULERS, KF_DISABLE_SCHEDULERS, or
 * NODE_ENV=test without ENABLE_SCHEDULERS_IN_TEST) must stop them.
 *
 *   SEC-V124b-1  CronSchedulerService.onModuleInit seeded every tenant's
 *                scheduled AgentTrigger as a repeatable (QueueService
 *                .enqueueCronTrigger), and QueueService started the cron worker
 *                on every boot, so repeatables an earlier boot left in Redis kept
 *                firing processCronTrigger (plan creation, auto-approval) with
 *                the switch on.
 *   CR-V124b-1   temporal-flow-memory looked its 6-hourly compaction up by `id`,
 *                which bullmq 5's getRepeatableJobs() entries do not carry, so the
 *                schedulers-off boot never removed the one an earlier boot left.
 *
 * Proven against REAL BullMQ on the Redis at REDIS_URL (the shape of
 * getRepeatableJobs() is the bug, so a hand-written queue stub would prove
 * nothing). Queues are moved under a per-run key prefix so concurrent suites
 * sharing that Redis are not touched; cleanup removes only this run's keys.
 * Under vitest.unit.config.ts (isolate: false) a service module another file
 * loaded first keeps the real, unprefixed bullmq: the tests then run in the
 * default namespace, filter by this run's ids, and clean up the namespace the
 * services actually used (recorded below), never only the prefixed one.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { CronSchedulerService } from '../../modules/ai/cron-scheduler.service';
import { QueueService } from '../../modules/ai/queue.service';
import { TemporalFlowMemoryQueueService } from '../../modules/temporal-flow/temporal-flow-memory.queue.service';

const bull = vi.hoisted(() => ({ prefix: `v124b-${process.pid}-${Date.now().toString(36)}` }));

vi.mock('bullmq', async (importOriginal) => {
  const actual: any = await importOriginal();
  class PrefixedQueue extends actual.Queue {
    constructor(name: string, opts: any = {}) {
      super(name, { ...opts, prefix: opts.prefix ?? bull.prefix });
    }
  }
  class PrefixedWorker extends actual.Worker {
    constructor(name: string, processor: any, opts: any = {}) {
      super(name, processor, { ...opts, prefix: opts.prefix ?? bull.prefix });
    }
  }
  class PrefixedQueueEvents extends actual.QueueEvents {
    constructor(name: string, opts: any = {}) {
      super(name, { ...opts, prefix: opts.prefix ?? bull.prefix });
    }
  }
  return { ...actual, Queue: PrefixedQueue, Worker: PrefixedWorker, QueueEvents: PrefixedQueueEvents };
});

// ---------------------------------------------------------------------------
// FOLLOW3-C3: no unhandled 'Connection is closed' rejection, as a named case
// ---------------------------------------------------------------------------

/**
 * About 1 run in 8 of this file ended with vitest's "Unhandled Rejection: Error:
 * Connection is closed." while all 12 tests passed. The ioredis stack named
 * only the socket close that flushed the command (event_handler.js:214), not
 * the command or who issued it, so `redis()` below turns on
 * showFriendlyErrorStack, which every BullMQ duplicate() inherits.
 *
 * Every unhandled rejection while this file runs is recorded here. process.on
 * ADDS a listener next to vitest's. But vitest 2 (execute.js listenForErrors)
 * leaves a rejection raised during a test to user code once a second listener
 * exists, so this file must fail on EVERY rejection it records, not only the
 * one it was written for: the afterAll below does both, by name, with the
 * stack, and then removes the listener so vitest reports anything later.
 */
const unhandledRejections: unknown[] = [];
const recordUnhandledRejection = (reason: unknown) => {
  unhandledRejections.push(reason);
};
process.on('unhandledRejection', recordUnhandledRejection);

const rejectionText = (r: unknown) => (r instanceof Error ? (r.stack ?? r.message) : String(r));

// Registered before every other after-hook in this file, so it runs last
// (vitest's default sequence.hooks 'stack' runs after-hooks in reverse): after
// each describe's cleanQueue and the quit() of every connection below.
afterAll(async () => {
  // One turn of the event loop, so a rejection the teardown above left
  // pending is delivered before the count.
  await new Promise((r) => setImmediate(r));
  process.off('unhandledRejection', recordUnhandledRejection);
  const closed = unhandledRejections.filter((r) => /Connection is closed/.test(r instanceof Error ? r.message : String(r)));
  expect(closed.map(rejectionText), "unhandled 'Connection is closed' rejections while this file ran (FOLLOW3-C3)").toEqual([]);
  expect(
    unhandledRejections.filter((r) => !closed.includes(r)).map(rejectionText),
    'other unhandled rejections while this file ran (recorded here, so vitest did not report them)',
  ).toEqual([]);
});

// ---------------------------------------------------------------------------
// env discipline
// ---------------------------------------------------------------------------

const SWITCHES = ['DISABLE_SCHEDULERS', 'KF_DISABLE_SCHEDULERS', 'KEY_DISABLED', 'NODE_ENV', 'ENABLE_SCHEDULERS_IN_TEST'] as const;
type Switches = Partial<Record<(typeof SWITCHES)[number], string>>;
let saved: Record<string, string | undefined>;

function setSwitches(next: Switches) {
  for (const k of SWITCHES) delete process.env[k];
  for (const [k, v] of Object.entries(next)) if (v !== undefined) process.env[k] = v;
}

/** The three ways to switch schedulers off. */
const OFF: Array<[string, Switches]> = [
  ['DISABLE_SCHEDULERS=1 (NODE_ENV=production)', { NODE_ENV: 'production', DISABLE_SCHEDULERS: '1' }],
  ['KF_DISABLE_SCHEDULERS=1 (NODE_ENV=production)', { NODE_ENV: 'production', KF_DISABLE_SCHEDULERS: '1' }],
  ['NODE_ENV=test alone', { NODE_ENV: 'test' }],
];
/** Schedulers on: no switch, and NODE_ENV=test with the explicit opt-in. */
const ON: Array<[string, Switches]> = [
  ['no switch (NODE_ENV=production)', { NODE_ENV: 'production' }],
  ['NODE_ENV=test with ENABLE_SCHEDULERS_IN_TEST=1', { NODE_ENV: 'test', ENABLE_SCHEDULERS_IN_TEST: '1' }],
];

beforeEach(() => {
  saved = Object.fromEntries(SWITCHES.map((k) => [k, process.env[k]]));
  for (const m of ['log', 'warn', 'error', 'debug'] as const) vi.spyOn(Logger.prototype, m).mockImplementation(() => undefined);
});

afterEach(() => {
  for (const k of SWITCHES) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

async function until(cond: () => Promise<boolean> | boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return cond();
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// SEC-V124b-1, unit: CronSchedulerService reads and registers nothing with schedulers off
// ---------------------------------------------------------------------------

/** Two enabled, scheduled triggers in two tenants (the boot read has no businessId filter). */
function twoTenantTriggers() {
  return [
    { id: 'v124b-trg-a', businessId: 'v124b-biz-A', name: 'A daily', eventPattern: 'v124b.a', objective: 'a', condition: null, schedule: '0 9 * * *', enabled: true },
    { id: 'v124b-trg-b', businessId: 'v124b-biz-B', name: 'B daily', eventPattern: 'v124b.b', objective: 'b', condition: null, schedule: '0 10 * * *', enabled: true },
  ];
}

function cronSchedulerWith() {
  const findMany = vi.fn().mockResolvedValue(twoTenantTriggers());
  const enqueueCronTrigger = vi.fn().mockResolvedValue(undefined);
  const svc = new CronSchedulerService({ client: { agentTrigger: { findMany } } } as any, { enqueueCronTrigger } as any);
  return { svc, findMany, enqueueCronTrigger };
}

describe('the AI cron triggers seeded at boot honour the scheduler switch (SEC-V124b-1)', () => {
  for (const [label, switches] of OFF) {
    it(`${label}: CronSchedulerService.onModuleInit reads no tenant trigger and registers no repeatable`, async () => {
      setSwitches(switches);
      const { svc, findMany, enqueueCronTrigger } = cronSchedulerWith();
      await svc.onModuleInit();
      expect(findMany).not.toHaveBeenCalled();
      expect(enqueueCronTrigger).not.toHaveBeenCalled();
    });
  }

  for (const [label, switches] of ON) {
    it(`control, ${label}: onModuleInit registers every tenant's scheduled trigger, so "nothing registered" above is a real answer`, async () => {
      setSwitches(switches);
      const { svc, findMany, enqueueCronTrigger } = cronSchedulerWith();
      await svc.onModuleInit();
      expect(findMany).toHaveBeenCalledTimes(1);
      expect(enqueueCronTrigger.mock.calls.map((c) => [c[0].businessId, c[1]])).toEqual([
        ['v124b-biz-A', '0 9 * * *'],
        ['v124b-biz-B', '0 10 * * *'],
      ]);
    });
  }
});

// ---------------------------------------------------------------------------
// real BullMQ on the Redis at REDIS_URL
// ---------------------------------------------------------------------------

const REDIS_URL = process.env.REDIS_URL;
const connections: IORedis[] = [];
function redis(): IORedis {
  // showFriendlyErrorStack (FOLLOW3-C3): a rejected command carries the stack
  // of the call that issued it (ioredis Commander.js:84), and BullMQ's
  // duplicate() copies the option to every worker and events connection.
  const c = new IORedis(REDIS_URL!, { maxRetriesPerRequest: null, showFriendlyErrorStack: true });
  connections.push(c);
  return c;
}

/** The key prefix each queue's services actually used in this run (bull.prefix when the mock reached them, else bullmq's default). */
const usedPrefixes = new Map<string, Set<string>>();
function noteNamespace(q: { name: string; opts: unknown }) {
  const prefix = (q.opts as { prefix?: string }).prefix ?? 'bull';
  if (!usedPrefixes.has(q.name)) usedPrefixes.set(q.name, new Set());
  usedPrefixes.get(q.name)!.add(prefix);
}

/** Under bull.prefix everything is this run's: obliterate. In any other namespace remove only this run's repeatables and jobs. */
async function cleanQueue(name: string, ours: (j: { name: string; data?: any }) => boolean) {
  for (const prefix of usedPrefixes.get(name) ?? []) {
    const q = new Queue(name, { connection: redis(), prefix });
    try {
      if (prefix === bull.prefix) {
        await q.obliterate({ force: true });
        continue;
      }
      for (const r of await q.getRepeatableJobs()) if (ours({ name: r.name })) await q.removeRepeatableByKey(r.key);
      for (const j of await q.getJobs(['delayed', 'wait', 'completed', 'failed', 'paused'])) if (j && ours(j)) await j.remove().catch(() => undefined);
    } finally {
      await q.close();
    }
  }
}

afterAll(async () => {
  // quit() waits for the replies still owed on each connection; disconnect()
  // closed them under in-flight BullMQ commands, which then rejected with
  // 'Connection is closed' after the suite (an unhandled rejection in the run).
  await Promise.all(connections.map((c) => c.quit().catch(() => undefined)));
});

const stub = () => ({}) as any;

function queueService(conn: IORedis, emit: (...a: unknown[]) => unknown, prisma: unknown = stub()) {
  const svc = new QueueService(conn as any, prisma as ConstructorParameters<typeof QueueService>[1], { emit } as any, stub(), stub(), stub(), stub(), stub(), stub());
  noteNamespace(svc.cronQueue);
  noteNamespace(svc.planQueue);
  return svc;
}

describe.skipIf(!REDIS_URL)('SEC-V124b-1 on real BullMQ (REDIS_URL): a tenant cron trigger an earlier boot left in Redis does not fire with schedulers off', () => {
  const TRIGGER = {
    id: `v124b-trg-${process.pid}-${Date.now().toString(36)}`,
    businessId: 'v124b-biz-A',
    name: 'v124b every second',
    eventPattern: 'v124b.cron.fired',
    objective: 'v124b',
    condition: null,
    schedule: '* * * * * *',
    enabled: true,
  };
  const ours = (j: { name: string; data?: any }) => j.name === `cron-trigger:${TRIGGER.id}` || j.data?.triggerId === TRIGGER.id;
  // V1-24c review (ST-V124c-1): the cron worker re-reads the trigger's row (by id
  // and business) on every run and fires only while it is enabled and on the same
  // schedule. The row still exists here, in every boot, so a worker that ran
  // would emit and "nothing fires" below stays a real check.
  const rowStillThere = {
    client: {
      agentTrigger: {
        findFirst: async ({ where }: { where: { id?: string; businessId?: string } }) =>
          where.id === TRIGGER.id && where.businessId === TRIGGER.businessId ? { ...TRIGGER } : null,
      },
    },
  };

  afterAll(async () => {
    await cleanQueue('ai-cron-triggers', ours);
    await cleanQueue('ai-plan-steps', (j) => String(j.data?.businessId ?? '').startsWith('v124b-'));
  });

  it('an earlier schedulers-on boot registers the every-second trigger; schedulers-off boots start no cron worker and nothing fires; a schedulers-on boot fires it (control)', async () => {
    // Boot A: schedulers on. It seeds the tenant's trigger as a repeatable, then goes away.
    setSwitches({ NODE_ENV: 'production' });
    const a = queueService(redis(), vi.fn(), rowStillThere);
    await a.onModuleInit();
    await new CronSchedulerService({ client: { agentTrigger: { findMany: vi.fn().mockResolvedValue([TRIGGER]) } } } as any, a).onModuleInit();
    const left = (await a.cronQueue.getRepeatableJobs()).filter((r) => r.name === `cron-trigger:${TRIGGER.id}`);
    expect(left, 'boot A registered the trigger (the control for "left in Redis")').toHaveLength(1);
    await a.onModuleDestroy();

    // Boots B: one per way of switching schedulers off, all up at once.
    const booted: Array<{ label: string; svc: QueueService; emit: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> }> = [];
    for (const [label, switches] of OFF) {
      setSwitches(switches);
      const emit = vi.fn();
      const findMany = vi.fn().mockResolvedValue([TRIGGER]);
      const svc = queueService(redis(), emit, rowStillThere);
      await svc.onModuleInit();
      await new CronSchedulerService({ client: { agentTrigger: { findMany } } } as any, svc).onModuleInit();
      booted.push({ label, svc, emit, findMany });
    }
    try {
      for (const b of booted) {
        expect((b.svc as any).cronWorker, `${b.label}: a cron worker was started`).toBeUndefined();
        expect(b.findMany, `${b.label}: tenant triggers were read`).not.toHaveBeenCalled();
      }
      // The leftover repeatable is still in Redis and due every second: nothing here runs it.
      expect((await booted[0].svc.cronQueue.getRepeatableJobs()).filter((r) => r.name === `cron-trigger:${TRIGGER.id}`)).toHaveLength(1);
      await pause(2_500);
      for (const b of booted) expect(b.emit, `${b.label}: processCronTrigger ran (emitted the trigger event)`).not.toHaveBeenCalled();
    } finally {
      for (const b of booted) await b.svc.onModuleDestroy();
    }

    // Control C: schedulers on. The same leftover repeatable fires within a couple of seconds.
    setSwitches({ NODE_ENV: 'production' });
    const emitC = vi.fn();
    const c = queueService(redis(), emitC, rowStillThere);
    await c.onModuleInit();
    try {
      expect((c as any).cronWorker).toBeDefined();
      const mine = (call: unknown[]) => call[0] === TRIGGER.eventPattern && (call[1] as { triggerId?: string })?.triggerId === TRIGGER.id;
      const fired = await until(() => emitC.mock.calls.some(mine), 6_000);
      expect(fired, 'control: a schedulers-on boot runs the leftover trigger').toBe(true);
      expect(emitC.mock.calls.find(mine)![1]).toMatchObject({ businessId: 'v124b-biz-A', source: 'cron', triggerId: TRIGGER.id });
    } finally {
      await c.onModuleDestroy();
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// CR-V124b-1: temporal-flow-memory periodic compaction
// ---------------------------------------------------------------------------

function memoryQueue(conn: IORedis, deps: { findMany?: ReturnType<typeof vi.fn>; compactBusiness?: ReturnType<typeof vi.fn> } = {}) {
  const prisma = { client: { temporalFlowEvent: { findMany: deps.findMany ?? vi.fn().mockResolvedValue([]) } } };
  const memory = { compactBusiness: deps.compactBusiness ?? vi.fn().mockResolvedValue({ threads: 0, contacts: 0, channels: 0 }) };
  const svc = new TemporalFlowMemoryQueueService(conn as any, prisma as any, memory as any, stub());
  noteNamespace(svc.queue);
  return svc;
}

async function periodic(q: Queue): Promise<number> {
  return (await q.getRepeatableJobs()).filter((r) => r.name === 'periodic-compact').length;
}

async function delayedPeriodic(q: Queue): Promise<number> {
  return (await q.getJobs(['delayed'])).filter((j) => j?.name === 'periodic-compact').length;
}

async function settled(job: { getState(): Promise<string> }): Promise<string> {
  let state = '';
  await until(async () => ['completed', 'failed'].includes((state = await job.getState())), 8_000);
  return state;
}

describe.skipIf(!REDIS_URL)('CR-V124b-1 on real BullMQ (REDIS_URL): the 6-hourly temporal-flow-memory compaction stops with schedulers off', () => {
  afterAll(async () => {
    await cleanQueue('temporal-flow-memory', (j) => j.name === 'periodic-compact' || String(j.data?.businessId ?? '').startsWith('v124b-'));
  });

  it('getRepeatableJobs() entries carry no `id` in this bullmq (why the lookup by id never matched): the job is found by its name', async () => {
    setSwitches({ NODE_ENV: 'production' });
    const a = memoryQueue(redis());
    await a.onModuleInit();
    try {
      const entries = (await a.queue.getRepeatableJobs()).filter((r) => r.name === 'periodic-compact');
      expect(entries).toHaveLength(1);
      expect((entries[0] as { id?: unknown }).id).toBeUndefined();
    } finally {
      await a.onModuleDestroy();
    }
  }, 20_000);

  for (const [label, switches] of OFF) {
    it(`${label}: a boot removes the compaction an earlier schedulers-on boot left in Redis (and its next delayed run), and does not register it`, async () => {
      setSwitches({ NODE_ENV: 'production' });
      const a = memoryQueue(redis());
      await a.onModuleInit();
      expect(await periodic(a.queue), 'control: boot A registered it').toBe(1);
      expect(await delayedPeriodic(a.queue), 'control: its next run is delayed in Redis').toBe(1);
      await a.onModuleDestroy();

      setSwitches(switches);
      const b = memoryQueue(redis());
      await b.onModuleInit();
      try {
        expect(await periodic(b.queue)).toBe(0);
        expect(await delayedPeriodic(b.queue)).toBe(0);
      } finally {
        await b.onModuleDestroy();
      }
    }, 20_000);
  }

  it('control: schedulers-on boots re-register exactly one compaction (the lookup by name replaces, never duplicates)', async () => {
    setSwitches({ NODE_ENV: 'production' });
    for (let i = 0; i < 2; i++) {
      const s = memoryQueue(redis());
      await s.onModuleInit();
      expect(await periodic(s.queue)).toBe(1);
      await s.onModuleDestroy();
    }
  }, 20_000);

  it('with schedulers off the worker still runs on-demand jobs (the memory/compact route), but a periodic-compact run already queued does no work; with schedulers on it does (control)', async () => {
    setSwitches({ NODE_ENV: 'test' });
    const findMany = vi.fn().mockResolvedValue([]);
    const compactBusiness = vi.fn().mockResolvedValue({ threads: 1, contacts: 0, channels: 0 });
    const b = memoryQueue(redis(), { findMany, compactBusiness });
    await b.onModuleInit();
    try {
      const queuedRun = await b.queue.add('periodic-compact', { businessId: 'ALL', operation: 'compact' });
      const onDemand = await b.enqueue({ businessId: 'v124b-biz-ondemand', operation: 'compact' });
      expect(await settled(queuedRun)).toBe('completed');
      expect(await settled(onDemand)).toBe('completed');
      expect(findMany, 'the periodic all-business compaction ran with schedulers off').not.toHaveBeenCalled();
      expect(compactBusiness.mock.calls).toEqual([['v124b-biz-ondemand']]);
    } finally {
      await b.onModuleDestroy();
    }

    setSwitches({ NODE_ENV: 'production' });
    const findManyOn = vi.fn().mockResolvedValue([]);
    const c = memoryQueue(redis(), { findMany: findManyOn });
    await c.onModuleInit();
    try {
      const run = await c.queue.add('periodic-compact', { businessId: 'ALL', operation: 'compact' });
      expect(await settled(run)).toBe('completed');
      expect(findManyOn).toHaveBeenCalledTimes(1);
    } finally {
      await c.onModuleDestroy();
    }
  }, 30_000);
});
