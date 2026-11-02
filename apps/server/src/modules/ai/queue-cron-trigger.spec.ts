/**
 * V1-24c-CRON-TRIGGER-REPEATABLES (V1-24b repair residual): a tenant's cron
 * AgentTrigger is registered as a BullMQ repeatable by
 * QueueService.enqueueCronTrigger and unregistered by removeCronTrigger. Both
 * looked the trigger's repeatable up with
 *
 *   (await cronQueue.getRepeatableJobs()).find((r) => r.id === `cron:${triggerId}`)
 *
 * but bullmq 5's getRepeatableJobs() entries carry key, name, tz, pattern and
 * next and no `id` (the jobId is folded into the key, an md5 of
 * name:jobId:endDate:tz:pattern). Nothing ever matched, so:
 *
 *   - removeCronTrigger removed nothing and a deleted trigger kept firing;
 *   - re-enqueueing a changed schedule hashed to a new key and added a second
 *     repeatable next to the old one, which kept firing on the old pattern.
 *
 * A trigger's repeatables are identified by the job name it is registered
 * under, `cron-trigger:<triggerId>`, which bullmq stores with every entry and
 * which does not change with the schedule. The API takes no business: a trigger
 * is addressed by its AgentTrigger id (a globally unique cuid), so the
 * isolation proven here is by exact trigger id, across businesses.
 *
 * Proven against REAL BullMQ on the Redis at REDIS_URL (the shape of
 * getRepeatableJobs() is the bug, so a hand-written queue stub would prove
 * nothing), with every-second triggers and the service's own cron worker.
 * Queues are moved under a per-run key prefix so concurrent suites sharing that
 * Redis are not touched; cleanup removes only this run's keys. Under
 * vitest.unit.config.ts (isolate: false) a QueueService module another file
 * loaded first keeps the real, unprefixed bullmq: the tests then run in the
 * default namespace, filter by this run's trigger ids, and clean up the
 * namespace the service actually used (recorded below).
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { QueueService, type CronTriggerJob } from './queue.service';
import { CronSchedulerService } from './cron-scheduler.service';

const bull = vi.hoisted(() => ({ prefix: `v124c-${process.pid}-${Date.now().toString(36)}` }));

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
// env discipline
// ---------------------------------------------------------------------------

const SWITCHES = ['DISABLE_SCHEDULERS', 'KF_DISABLE_SCHEDULERS', 'KEY_DISABLED', 'NODE_ENV', 'ENABLE_SCHEDULERS_IN_TEST'] as const;
type Switches = Partial<Record<(typeof SWITCHES)[number], string>>;
let saved: Record<string, string | undefined>;

function setSwitches(next: Switches) {
  for (const k of SWITCHES) delete process.env[k];
  for (const [k, v] of Object.entries(next)) if (v !== undefined) process.env[k] = v;
}

/** Schedulers on, so QueueService starts its cron worker and the triggers really fire. */
const SCHEDULERS_ON: Switches = { NODE_ENV: 'production' };

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
// real BullMQ on the Redis at REDIS_URL
// ---------------------------------------------------------------------------

const REDIS_URL = process.env.REDIS_URL;
const connections: IORedis[] = [];
function redis(): IORedis {
  const c = new IORedis(REDIS_URL!, { maxRetriesPerRequest: null });
  connections.push(c);
  return c;
}

/** The key prefix each queue actually used in this run (bull.prefix when the mock reached QueueService, else bullmq's default). */
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
      for (const j of await q.getJobs(['delayed', 'wait', 'completed', 'failed', 'paused', 'prioritized'])) if (j && ours(j)) await j.remove().catch(() => undefined);
    } finally {
      await q.close();
    }
  }
}

const RUN = `v124c-${process.pid}-${Date.now().toString(36)}`;
const ours = (j: { name: string; data?: any }) =>
  String(j.name ?? '').startsWith(`cron-trigger:${RUN}`) || String(j.data?.triggerId ?? '').startsWith(RUN);

afterAll(async () => {
  try {
    await cleanQueue('ai-cron-triggers', ours);
    await cleanQueue('ai-plan-steps', () => false);
  } finally {
    for (const c of connections) c.disconnect();
  }
});

const stub = () => ({}) as any;

function queueService(emit: (...a: unknown[]) => unknown = vi.fn()) {
  const svc = new QueueService(redis() as any, stub(), { emit } as any, stub(), stub(), stub(), stub(), stub(), stub());
  noteNamespace(svc.cronQueue);
  noteNamespace(svc.planQueue);
  return svc;
}

const EVENT = 'v124c.cron.fired';
const EVERY_SECOND = '* * * * * *';
const YEARLY = '0 0 1 1 *';

function trigger(triggerId: string, businessId: string): CronTriggerJob {
  return { triggerId, businessId, eventName: EVENT, payload: { triggerId } };
}

/** The repeatables registered for one trigger (found by the name it is registered under). */
async function entries(svc: QueueService, triggerId: string) {
  return (await svc.cronQueue.getRepeatableJobs()).filter((r) => r.name === `cron-trigger:${triggerId}`);
}

/** The trigger's runs queued and not yet taken by a worker. */
async function pending(svc: QueueService, triggerId: string) {
  return (await svc.cronQueue.getJobs(['delayed', 'wait', 'prioritized', 'paused'])).filter((j) => j?.data?.triggerId === triggerId);
}

/** How many times processCronTrigger ran for the trigger (it emits the trigger's event, tagged with its id). */
function fires(emit: ReturnType<typeof vi.fn>, triggerId: string): number {
  return emit.mock.calls.filter((c) => c[0] === EVENT && (c[1] as { triggerId?: string })?.triggerId === triggerId).length;
}

/**
 * "Stops firing within one interval": at most one run already taken by the
 * worker when the schedule changed may still land (in the next 1.5s), and
 * nothing after that.
 */
async function expectStoppedFiring(emit: ReturnType<typeof vi.fn>, triggerId: string, what: string) {
  const atChange = fires(emit, triggerId);
  await pause(1_500);
  const afterOneInterval = fires(emit, triggerId);
  expect(afterOneInterval - atChange, `${what}: runs that landed within one interval of the change`).toBeLessThanOrEqual(1);
  await pause(2_500);
  expect(fires(emit, triggerId), `${what}: the old every-second schedule kept firing after the change`).toBe(afterOneInterval);
}

describe.skipIf(!REDIS_URL)('V1-24c on real BullMQ (REDIS_URL): user cron triggers are found and removed by their repeatable name', () => {
  it('control: getRepeatableJobs() entries carry no `id` in this bullmq (why the lookup by id never matched); the trigger is found by its name', async () => {
    const svc = queueService();
    const id = `${RUN}-shape`;
    try {
      await svc.enqueueCronTrigger(trigger(id, 'v124c-biz-A'), YEARLY);
      const mine = await entries(svc, id);
      expect(mine).toHaveLength(1);
      expect((mine[0] as { id?: unknown }).id).toBeUndefined();
      expect(mine[0]).toMatchObject({ name: `cron-trigger:${id}`, pattern: YEARLY, tz: 'UTC' });
    } finally {
      await svc.removeCronTrigger(id).catch(() => undefined);
      await svc.onModuleDestroy();
    }
  }, 20_000);

  it('removeCronTrigger removes the every-second trigger and its next run: it stops firing within one interval', async () => {
    setSwitches(SCHEDULERS_ON);
    const emit = vi.fn();
    const svc = queueService(emit);
    await svc.onModuleInit();
    const id = `${RUN}-remove`;
    try {
      await svc.enqueueCronTrigger(trigger(id, 'v124c-biz-A'), EVERY_SECOND);
      expect(await entries(svc, id), 'control: registered').toHaveLength(1);
      expect(await until(() => fires(emit, id) >= 1, 6_000), 'control: the every-second trigger fires').toBe(true);

      await svc.removeCronTrigger(id);

      await expectStoppedFiring(emit, id, 'after removeCronTrigger');
      expect(await entries(svc, id), 'the repeatable is still registered after removeCronTrigger').toHaveLength(0);
      expect(await pending(svc, id), 'a run of the removed trigger is still queued').toHaveLength(0);
    } finally {
      await svc.onModuleDestroy();
    }
  }, 30_000);

  it('enqueueCronTrigger with a changed schedule replaces the old repeatable: exactly one per trigger, on the new pattern, and the old every-second pattern stops firing within one interval', async () => {
    setSwitches(SCHEDULERS_ON);
    const emit = vi.fn();
    const svc = queueService(emit);
    await svc.onModuleInit();
    const id = `${RUN}-change`;
    try {
      await svc.enqueueCronTrigger(trigger(id, 'v124c-biz-A'), EVERY_SECOND);
      expect(await until(() => fires(emit, id) >= 1, 6_000), 'control: the every-second trigger fires').toBe(true);

      await svc.enqueueCronTrigger(trigger(id, 'v124c-biz-A'), YEARLY);

      await expectStoppedFiring(emit, id, 'after the schedule changed to yearly');
      const mine = await entries(svc, id);
      expect(mine.map((r) => r.pattern), 'repeatables registered for the trigger after the change').toEqual([YEARLY]);
      expect(mine[0].tz).toBe('UTC');
      const queued = await pending(svc, id);
      expect(queued, 'exactly the next yearly run is queued').toHaveLength(1);
      expect(queued[0].timestamp + (queued[0].opts.delay ?? 0)).toBeGreaterThan(Date.now() + 24 * 3600 * 1000);
    } finally {
      await svc.removeCronTrigger(id).catch(() => undefined);
      await svc.onModuleDestroy();
    }
  }, 30_000);

  it('a changed schedule takes effect (yearly -> every second fires), and re-enqueueing the same schedule, as every boot re-seeds it, keeps exactly one repeatable', async () => {
    setSwitches(SCHEDULERS_ON);
    const emit = vi.fn();
    const svc = queueService(emit);
    await svc.onModuleInit();
    const id = `${RUN}-takes-effect`;
    try {
      await svc.enqueueCronTrigger(trigger(id, 'v124c-biz-A'), YEARLY);
      await svc.enqueueCronTrigger(trigger(id, 'v124c-biz-A'), EVERY_SECOND);
      expect((await entries(svc, id)).map((r) => r.pattern), 'after yearly -> every second').toEqual([EVERY_SECOND]);
      expect(await until(() => fires(emit, id) >= 1, 6_000), 'the new every-second schedule fires').toBe(true);

      await svc.enqueueCronTrigger(trigger(id, 'v124c-biz-A'), EVERY_SECOND);
      expect((await entries(svc, id)).map((r) => r.pattern), 'after the same schedule is enqueued again').toEqual([EVERY_SECOND]);
      const before = fires(emit, id);
      expect(await until(() => fires(emit, id) > before, 6_000), 'still fires after the re-seed').toBe(true);
    } finally {
      await svc.removeCronTrigger(id).catch(() => undefined);
      await svc.onModuleDestroy();
    }
  }, 30_000);

  it('remove of an unknown trigger is a no-op, and removal is by exact trigger id: removing business B\'s trigger leaves business A\'s (whose id is a prefix of it) registered and firing', async () => {
    setSwitches(SCHEDULERS_ON);
    const emit = vi.fn();
    const svc = queueService(emit);
    await svc.onModuleInit();
    const idA = `${RUN}-x`;
    const idB = `${RUN}-x0`;
    try {
      await svc.enqueueCronTrigger(trigger(idA, 'v124c-biz-A'), EVERY_SECOND);
      await svc.enqueueCronTrigger(trigger(idB, 'v124c-biz-B'), EVERY_SECOND);
      expect(await until(() => fires(emit, idA) >= 1 && fires(emit, idB) >= 1, 6_000), 'control: both fire').toBe(true);

      await expect(svc.removeCronTrigger(`${RUN}-unknown`)).resolves.toBeUndefined();
      expect(await entries(svc, idA), 'an unknown-trigger remove touched A').toHaveLength(1);
      expect(await entries(svc, idB), 'an unknown-trigger remove touched B').toHaveLength(1);

      await svc.removeCronTrigger(idB);

      await expectStoppedFiring(emit, idB, "business B's removed trigger");
      expect(await entries(svc, idB), "business B's trigger is still registered after its removal").toHaveLength(0);
      expect(await entries(svc, idA), "business A's trigger was removed through B's id").toHaveLength(1);
      const before = fires(emit, idA);
      expect(await until(() => fires(emit, idA) > before, 6_000), "business A's trigger stopped firing").toBe(true);
    } finally {
      await svc.removeCronTrigger(idA).catch(() => undefined);
      await svc.removeCronTrigger(idB).catch(() => undefined);
      await svc.onModuleDestroy();
    }
  }, 30_000);

  it('the duplicates the old lookup left in Redis (one repeatable per earlier schedule) are all replaced by one enqueue and all cleared by one remove', async () => {
    const svc = queueService();
    const id = `${RUN}-dupes`;
    // Exactly what enqueueCronTrigger registered before this repair, once per schedule the trigger had.
    const legacy = (pattern: string) =>
      svc.cronQueue.add(`cron-trigger:${id}`, trigger(id, 'v124c-biz-A'), {
        jobId: `cron:${id}`,
        repeat: { pattern, tz: 'UTC' },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      });
    try {
      await legacy('0 9 * * *');
      await legacy('0 10 * * *');
      expect(await entries(svc, id), 'control: two leftovers').toHaveLength(2);

      await svc.enqueueCronTrigger(trigger(id, 'v124c-biz-A'), '0 11 * * *');
      expect((await entries(svc, id)).map((r) => r.pattern)).toEqual(['0 11 * * *']);
      expect(await pending(svc, id), 'only the new schedule has a run queued').toHaveLength(1);

      await legacy('0 12 * * *');
      expect(await entries(svc, id), 'control: a leftover next to the current one').toHaveLength(2);
      await svc.removeCronTrigger(id);
      expect(await entries(svc, id)).toHaveLength(0);
      expect(await pending(svc, id)).toHaveLength(0);
    } finally {
      await svc.removeCronTrigger(id).catch(() => undefined);
      await svc.onModuleDestroy();
    }
  }, 20_000);

  it('schedulers-off boot (V1-24b) still registers nothing and starts no cron worker; with schedulers on the same boot registers the trigger and CronSchedulerService.removeCronTrigger removes it (control)', async () => {
    const id = `${RUN}-boot`;
    const row = {
      id,
      businessId: 'v124c-biz-A',
      name: 'v124c every second',
      eventPattern: EVENT,
      objective: 'v124c',
      condition: null,
      schedule: EVERY_SECOND,
      enabled: true,
    };

    setSwitches({ NODE_ENV: 'test' });
    const off = queueService();
    const findMany = vi.fn().mockResolvedValue([row]);
    await off.onModuleInit();
    try {
      await new CronSchedulerService({ client: { agentTrigger: { findMany } } } as any, off).onModuleInit();
      expect((off as any).cronWorker, 'a cron worker was started with schedulers off').toBeUndefined();
      expect(findMany).not.toHaveBeenCalled();
      expect(await entries(off, id)).toHaveLength(0);
    } finally {
      await off.onModuleDestroy();
    }

    setSwitches(SCHEDULERS_ON);
    const on = queueService();
    try {
      const cron = new CronSchedulerService({ client: { agentTrigger: { findMany: vi.fn().mockResolvedValue([row]) } } } as any, on);
      await cron.onModuleInit();
      expect(await entries(on, id), 'control: a schedulers-on boot registers it').toHaveLength(1);
      await cron.removeCronTrigger(id);
      expect(await entries(on, id)).toHaveLength(0);
    } finally {
      await on.removeCronTrigger(id).catch(() => undefined);
      await on.onModuleDestroy();
    }
  }, 20_000);
});
