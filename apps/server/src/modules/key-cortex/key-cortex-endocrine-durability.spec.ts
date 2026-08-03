/**
 * KEY's disposition used to die on every restart.
 *
 * Hormone levels are the only thing in the system that carries a posture across
 * time — the whole reason the endocrine service exists separately from
 * interoception is that a business in sustained trouble should get a sustained
 * change in how KEY reasons. That state lived in a process-local `Map`, so:
 *
 *   - a deploy reset three weeks of accumulated caution to zero
 *   - two instances of the server disagreed about the same business
 *   - `effortMultiplier` returned exactly 1.0 after every restart
 *
 * A cheerful KEY greeting a business that has been failing for a month is the
 * exact failure this service was written to prevent, and it happened on every
 * restart.
 *
 * The failure modes worth pinning are not "does it write a row":
 *
 *   - CLOBBERING: hydrate must never overwrite a level observed while the read
 *     was in flight.
 *   - RESURRECTION: state written before a long gap must come back correctly
 *     AGED, not at full strength.
 *   - BLOCKING: release() and read() are synchronous because the thalamus calls
 *     them on the request path. Durability must never make them async or throw.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexEndocrineService } from './key-cortex-endocrine.service';

class PrismaStub {
  rows: Array<{ id: string; value: string }> = [];
  failOn: 'none' | 'read' | 'write' = 'none';

  client = {
    keyCortexMemory: {
      findFirst: vi.fn(() => {
        if (this.failOn === 'read') return Promise.reject(new Error('db down'));
        return Promise.resolve(this.rows[0] ?? null);
      }),
      create: vi.fn((args: { data: { value: string } }) => {
        if (this.failOn === 'write') return Promise.reject(new Error('db down'));
        this.rows.push({ id: 'mem_1', value: args.data.value });
        return Promise.resolve(this.rows[0]);
      }),
      update: vi.fn((args: { data: { value: string } }) => {
        if (this.failOn === 'write') return Promise.reject(new Error('db down'));
        this.rows[0].value = args.data.value;
        return Promise.resolve(this.rows[0]);
      }),
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const SIGNAL = { hormone: 'cortisol' as const, magnitude: 0.3, reason: 'cash tightening' };

describe('hormone state survives a restart', () => {
  let prisma: PrismaStub;

  beforeEach(() => {
    prisma = new PrismaStub();
  });

  it('writes levels after a release', async () => {
    const svc = new KeyCortexEndocrineService(prisma as never);
    svc.release('biz_1', [SIGNAL]);
    await flush();

    expect(prisma.rows).toHaveLength(1);
    expect(JSON.parse(prisma.rows[0].value)[0].name).toBe('cortisol');
  });

  it('a NEW process reads back what the old one learned', async () => {
    const first = new KeyCortexEndocrineService(prisma as never);
    first.release('biz_1', [SIGNAL]);
    await flush();

    // Simulate the restart: fresh instance, same storage.
    const second = new KeyCortexEndocrineService(prisma as never);
    await second.hydrate('biz_1');

    const levels = second.read('biz_1');
    expect(levels).toHaveLength(1);
    expect(levels[0].name).toBe('cortisol');
    expect(levels[0].level).toBeGreaterThan(0);
  });

  it('carries the evidence across, not just the number', async () => {
    // A level without its reasons is a mood, and this service refuses moods.
    const first = new KeyCortexEndocrineService(prisma as never);
    first.release('biz_1', [SIGNAL]);
    await flush();

    const second = new KeyCortexEndocrineService(prisma as never);
    await second.hydrate('biz_1');

    expect(second.read('biz_1')[0].reasons).toContain('cash tightening');
  });

  it('effortMultiplier is no longer 1.0 after a restart', async () => {
    // The concrete symptom: the thalamus read a permanently neutral subcortex.
    const first = new KeyCortexEndocrineService(prisma as never);
    first.release('biz_1', [{ ...SIGNAL, magnitude: 0.35 }]);
    await flush();

    const second = new KeyCortexEndocrineService(prisma as never);
    await second.hydrate('biz_1');

    expect(second.effortMultiplier('biz_1')).toBeGreaterThan(1);
  });
});

describe('restored state is aged, not resurrected', () => {
  it('a level written long ago comes back decayed', async () => {
    const prisma = new PrismaStub();
    const old = new Date('2026-08-01T00:00:00Z');

    const first = new KeyCortexEndocrineService(prisma as never);
    first.release('biz_1', [{ ...SIGNAL, magnitude: 0.35 }], old);
    await flush();
    const levelThen = first.read('biz_1', old)[0].level;

    // Two days later, in a fresh process.
    const later = new Date('2026-08-03T00:00:00Z');
    const second = new KeyCortexEndocrineService(prisma as never);
    await second.hydrate('biz_1');

    const restored = second.read('biz_1', later);
    // Decay is anchored to updatedAt, so a gap in time is handled correctly
    // rather than the level being restored at full strength.
    expect(restored.length === 0 || restored[0].level < levelThen).toBe(true);
  });
});

describe('durability never costs correctness', () => {
  it('hydrate does not clobber a level observed while it was in flight', async () => {
    // Storage says cortisol 0.1; the live process has just observed 0.35.
    const prisma = new PrismaStub();
    prisma.rows = [
      {
        id: 'mem_1',
        value: JSON.stringify([
          { name: 'cortisol', level: 0.1, reasons: ['stale'], updatedAt: new Date().toISOString() },
        ]),
      },
    ];

    // Writes are disabled so storage STAYS stale. Without this, release()
    // persists the fresh value first and there is nothing left to clobber —
    // which is why a first version of this test passed with the guard removed.
    prisma.failOn = 'write';

    const svc = new KeyCortexEndocrineService(prisma as never);
    svc.release('biz_1', [{ ...SIGNAL, magnitude: 0.35, reason: 'fresh observation' }]);
    await flush();

    prisma.failOn = 'none';
    await svc.hydrate('biz_1');

    const levels = svc.read('biz_1');
    expect(levels[0].reasons).toContain('fresh observation');
    expect(levels[0].level).toBeGreaterThan(0.1);
  });

  it('release stays synchronous — the thalamus calls it on the request path', () => {
    const svc = new KeyCortexEndocrineService(new PrismaStub() as never);
    expect(svc.release('biz_1', [SIGNAL])).toBeUndefined();
  });

  it('a write failure never fails the observation', async () => {
    const prisma = new PrismaStub();
    prisma.failOn = 'write';
    const svc = new KeyCortexEndocrineService(prisma as never);

    expect(() => svc.release('biz_1', [SIGNAL])).not.toThrow();
    await flush();
    // The level is still held in memory even though it could not be stored.
    expect(svc.read('biz_1')).toHaveLength(1);
  });

  it('a read failure degrades to neutral rather than throwing', async () => {
    const prisma = new PrismaStub();
    prisma.failOn = 'read';
    const svc = new KeyCortexEndocrineService(prisma as never);

    await expect(svc.hydrate('biz_1')).resolves.toBeUndefined();
    expect(svc.read('biz_1')).toEqual([]);
  });

  it('works with no storage at all', async () => {
    // @Optional — the service must still function as pure in-memory state.
    const svc = new KeyCortexEndocrineService();
    svc.release('biz_1', [SIGNAL]);

    expect(svc.read('biz_1')).toHaveLength(1);
    await expect(svc.hydrate('biz_1')).resolves.toBeUndefined();
  });

  it('hydrates a business only once per process', async () => {
    const prisma = new PrismaStub();
    const svc = new KeyCortexEndocrineService(prisma as never);

    await svc.hydrate('biz_1');
    await svc.hydrate('biz_1');
    svc.read('biz_1');

    expect(prisma.client.keyCortexMemory.findFirst).toHaveBeenCalledTimes(1);
  });
});
