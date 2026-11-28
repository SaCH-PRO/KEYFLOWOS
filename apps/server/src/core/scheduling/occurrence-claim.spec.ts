/**
 * RR-CRON-OCCURRENCE-LOCK (D-261, D-262, D-17, D-257):
 *
 * Proves cross-replica / restart single-execution claiming for scheduled `@Cron` jobs:
 *   1. Two concurrent `claimOccurrence(redis, 'contract-renewal', '2026-11-22', ...)` calls
 *      against an NX-honouring Redis double yield exactly one `true` and one `false`.
 *   2. Different occurrence slots (or expired TTL) succeed cleanly.
 *   3. `RedisService.setNx(key, value, ttlMs)` delegates to `ioredis.set(key, value, 'PX', ttlMs, 'NX')`
 *      and returns `true` only on `'OK'`.
 *   4. When Redis is unavailable or rejects, `claimOccurrence` fails open (`true`) and
 *      records the miss in `errorRegistry` (never silent, never throws).
 *   5. `ContractRenewalSweep.scheduledSweep` run twice in the same slot emits
 *      `WORK_OBLIGATION_RAISED` once; with Redis down it runs fail-open and records an
 *      error-registry entry; with `DISABLE_SCHEDULERS=1` it returns before touching Redis.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WORK_OBLIGATION_RAISED } from '@keyflow/shared';
import { RedisService } from '../redis/redis.service';
import { ErrorRegistry, errorRegistry } from '../observability/error-registry';
import { ContractRenewalSweep } from '../../modules/contracts/contract-renewal.sweep';
import { claimOccurrence, occurrenceRedisKey, utcDateSlot } from './occurrence-claim';

/** In-memory Redis test double that honours atomic SET NX PX. */
function makeNxRedisDouble() {
  const store = new Map<string, { value: string; expiresAt: number }>();
  let nowMs = 1_763_769_600_000; // 2025-11-22T00:00:00Z

  const setNx = vi.fn(async (key: string, value: string, ttlMs: number): Promise<boolean> => {
    const existing = store.get(key);
    if (existing && existing.expiresAt > nowMs) {
      return false;
    }
    store.set(key, { value, expiresAt: nowMs + ttlMs });
    return true;
  });

  return {
    setNx,
    store,
    advanceMs(ms: number) {
      nowMs += ms;
    },
  };
}

describe('RR-CRON-OCCURRENCE-LOCK: claimOccurrence & RedisService.setNx', () => {
  const prevEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ['DISABLE_SCHEDULERS', 'KF_DISABLE_SCHEDULERS', 'ENABLE_SCHEDULERS_IN_TEST', 'NODE_ENV']) {
      prevEnv[k] = process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.restoreAllMocks();
  });

  it('RED-BEFORE: two concurrent claimOccurrence calls in the same slot return exactly one true', async () => {
    const redis = makeNxRedisDouble();
    const [a, b] = await Promise.all([
      claimOccurrence(redis, 'contract-renewal', '2026-11-22', 23 * 60 * 60 * 1000),
      claimOccurrence(redis, 'contract-renewal', '2026-11-22', 23 * 60 * 60 * 1000),
    ]);

    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect([a, b].filter((v) => !v)).toHaveLength(1);
    expect(redis.setNx).toHaveBeenCalledTimes(2);
    expect(redis.setNx.mock.calls[0][0]).toBe(occurrenceRedisKey('contract-renewal', '2026-11-22'));

    // Next slot succeeds independently
    const nextSlot = await claimOccurrence(redis, 'contract-renewal', '2026-11-23', 23 * 60 * 60 * 1000);
    expect(nextSlot).toBe(true);

    // After TTL expiry, same slot can be reclaimed
    redis.advanceMs(24 * 60 * 60 * 1000);
    const afterExpiry = await claimOccurrence(redis, 'contract-renewal', '2026-11-22', 23 * 60 * 60 * 1000);
    expect(afterExpiry).toBe(true);
  });

  it('RED-BEFORE: RedisService.setNx uses SET key value PX ttlMs NX and returns boolean', async () => {
    const rawSet = vi.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    const svc = new RedisService({ set: rawSet } as any);

    const first = await svc.setNx('cron:occ:demo:2026-11-22', '1', 60_000);
    const second = await svc.setNx('cron:occ:demo:2026-11-22', '1', 60_000);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(rawSet).toHaveBeenNthCalledWith(1, 'cron:occ:demo:2026-11-22', '1', 'PX', 60_000, 'NX');
    expect(rawSet).toHaveBeenNthCalledWith(2, 'cron:occ:demo:2026-11-22', '1', 'PX', 60_000, 'NX');
  });

  it('RED-BEFORE: fails open and records in errorRegistry when Redis throws or is unavailable', async () => {
    const registry = new ErrorRegistry();
    const brokenRedis = {
      setNx: vi.fn(async () => {
        throw new Error('ECONNREFUSED redis://user:secret@127.0.0.1:6379');
      }),
    };

    const allowedOnThrow = await claimOccurrence(brokenRedis, 'contract-renewal', '2026-11-22', 60_000, {
      registry,
    });
    expect(allowedOnThrow).toBe(true);
    const snap = registry.snapshot();
    expect(snap.total).toBe(1);
    expect(snap.entries[0].source).toBe('background');
    expect(snap.entries[0].label).toContain('contract-renewal');
    expect(snap.entries[0].message).not.toContain('secret');

    const registryAbsent = new ErrorRegistry();
    const allowedWhenNull = await claimOccurrence(undefined, 'contract-renewal', '2026-11-22', 60_000, {
      registry: registryAbsent,
    });
    expect(allowedWhenNull).toBe(true);
    expect(registryAbsent.snapshot().total).toBe(1);
    expect(registryAbsent.snapshot().entries[0].label).toContain('contract-renewal');
  });

  it('RED-BEFORE: ContractRenewalSweep.scheduledSweep emits once across two runs in one slot, fails open when Redis is down, and honours DISABLE_SCHEDULERS first', async () => {
    delete process.env.DISABLE_SCHEDULERS;
    delete process.env.KF_DISABLE_SCHEDULERS;
    process.env.ENABLE_SCHEDULERS_IN_TEST = '1';

    const dueContract = {
      id: 'ct_1',
      businessId: 'biz_1',
      title: 'Office Lease',
      renewalDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      renewalNoticeDays: 30,
      renewalType: 'AUTO_RENEW',
      contractValue: 5000,
      currency: 'TTD',
      parties: [{ name: 'Landlord Ltd' }],
    };

    const prisma = {
      client: {
        contract: { findMany: vi.fn(async () => [dueContract]) },
      },
    } as any;
    const events = { emit: vi.fn() } as any;
    const redis = makeNxRedisDouble();

    const sweep = new ContractRenewalSweep(prisma, events, redis as unknown as RedisService);

    // Two runs in the same slot (simulating two replicas or a restart within the day)
    await sweep.scheduledSweep();
    await sweep.scheduledSweep();

    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith(WORK_OBLIGATION_RAISED, expect.objectContaining({ sourceId: 'ct_1' }));
    expect(prisma.client.contract.findMany).toHaveBeenCalledTimes(1);
    expect(utcDateSlot(new Date('2026-11-22T15:30:00Z'))).toBe('2026-11-22');

    // Redis down -> fail-open: still runs AND records an entry in the singleton errorRegistry
    const beforeTotal = errorRegistry.snapshot().total;
    const downEvents = { emit: vi.fn() } as any;
    const downRedis = {
      setNx: vi.fn(async () => {
        throw new Error('Stream is not writeable');
      }),
    };
    const downSweep = new ContractRenewalSweep(prisma, downEvents, downRedis as unknown as RedisService);
    await downSweep.scheduledSweep();
    expect(downEvents.emit).toHaveBeenCalledTimes(1);
    expect(errorRegistry.snapshot().total).toBeGreaterThan(beforeTotal);

    // DISABLE_SCHEDULERS=1 stays FIRST (D-17): never touches Redis or Prisma
    process.env.DISABLE_SCHEDULERS = '1';
    const disabledRedis = makeNxRedisDouble();
    const disabledEvents = { emit: vi.fn() } as any;
    const disabledSweep = new ContractRenewalSweep(prisma, disabledEvents, disabledRedis as unknown as RedisService);
    await disabledSweep.scheduledSweep();
    expect(disabledRedis.setNx).not.toHaveBeenCalled();
    expect(disabledEvents.emit).not.toHaveBeenCalled();
  });

  it('R1 hardening: validates finite positive TTLs/intervals, key segments, rediss:// credential redaction before record(), constant ErrorRegistry cardinality, and throw-safe registry', async () => {
    const { utcIntervalSlot } = await import('./occurrence-claim');

    // M-2: non-finite / non-positive TTLs and intervals throw RangeError loudly
    const svc = new RedisService({ set: vi.fn() } as any);
    for (const bad of [NaN, Infinity, -Infinity, 0, -500]) {
      await expect(svc.setNx('k', '1', bad)).rejects.toThrow(RangeError);
      await expect(claimOccurrence(makeNxRedisDouble(), 'contract-renewal', '2026-11-22', bad)).rejects.toThrow(
        RangeError,
      );
      expect(() => utcIntervalSlot(bad)).toThrow(RangeError);
    }

    // m-1: delimiter / empty / glob segments rejected
    for (const badSeg of ['', 'a:b', 'has space', 'glob*', 'wild?', 'brack[1]']) {
      expect(() => occurrenceRedisKey(badSeg, '2026-11-22')).toThrow(RangeError);
      expect(() => occurrenceRedisKey('contract-renewal', badSeg)).toThrow(RangeError);
    }

    // M-3: unavailable Redis across rotating slots collapses to 1 ErrorRegistry entry (count === 2)
    const reg = new ErrorRegistry();
    await claimOccurrence(undefined, 'contract-renewal', '2026-11-22', 60_000, { registry: reg });
    await claimOccurrence(undefined, 'contract-renewal', '2026-11-23', 60_000, { registry: reg });
    expect(reg.snapshot().distinct).toBe(1);
    expect(reg.snapshot().entries[0].count).toBe(2);

    // M-4: rediss:// credentials are redacted BEFORE registry.record() receives the Error (protects Sentry too)
    const recordedArgs: unknown[] = [];
    const spyRegistry = {
      record: vi.fn((_source: string, _label: string, err: unknown) => {
        recordedArgs.push(err);
      }),
    } as unknown as ErrorRegistry;
    const tlsBroken = {
      setNx: vi.fn(async () => {
        throw new Error('ECONNREFUSED rediss://default:topsecretpass@redis.prod:6380 AUTH mypass');
      }),
    };
    expect(await claimOccurrence(tlsBroken, 'contract-renewal', '2026-11-22', 60_000, { registry: spyRegistry })).toBe(
      true,
    );
    expect(recordedArgs).toHaveLength(1);
    const passedMsg = (recordedArgs[0] as Error).message;
    expect(passedMsg).not.toContain('topsecretpass');
    expect(passedMsg).not.toContain('mypass');
    expect(passedMsg).toContain('rediss://***@redis.prod:6380');

    // m-2: throwing custom registry still fails open without rejecting
    const throwingRegistry = {
      record: () => {
        throw new Error('registry exploded');
      },
    } as unknown as ErrorRegistry;
    await expect(
      claimOccurrence(undefined, 'contract-renewal', '2026-11-22', 60_000, { registry: throwingRegistry }),
    ).resolves.toBe(true);
  });
});
