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

/**
 * A stub that HONOURS its where-clause.
 *
 * The first version ignored args entirely and returned rows[0]. An audit
 * mutation-proved the consequence: deleting `businessId` from the where-clause
 * in BOTH persist and hydrate — a total cross-tenant leak, one business reading
 * another's disposition — left all 32 tests in this file green.
 *
 * A stub that does not filter cannot test filtering. It converts every tenancy
 * assertion into a tautology.
 */
class PrismaStub {
  rows: Array<{ id: string; businessId: string; type: string; key: string; value: string }> = [];
  failOn: 'none' | 'read' | 'write' = 'none';
  private seq = 0;

  /** Convenience for tests that only care about a single business. */
  seed(value: string, businessId = 'biz_1') {
    this.rows.push({
      id: `mem_${(this.seq += 1)}`,
      businessId,
      type: 'endocrine_state',
      key: 'hormones',
      value,
    });
  }

  private match(where: Record<string, unknown>) {
    return this.rows.find((r) =>
      Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v),
    );
  }

  client = {
    keyCortexMemory: {
      findFirst: vi.fn((args: { where: Record<string, unknown> }) => {
        if (this.failOn === 'read') return Promise.reject(new Error('db down'));
        return Promise.resolve(this.match(args.where) ?? null);
      }),
      create: vi.fn((args: { data: Record<string, string> }) => {
        if (this.failOn === 'write') return Promise.reject(new Error('db down'));
        const row = { id: `mem_${(this.seq += 1)}`, ...args.data } as PrismaStub['rows'][number];
        this.rows.push(row);
        return Promise.resolve(row);
      }),
      update: vi.fn((args: { where: { id: string }; data: { value: string } }) => {
        if (this.failOn === 'write') return Promise.reject(new Error('db down'));
        const row = this.rows.find((r) => r.id === args.where.id);
        if (row) row.value = args.data.value;
        return Promise.resolve(row);
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

describe('one business can never read another’s disposition', () => {
  // MUTATION-PROVED GAP. Deleting `businessId` from the where-clause in BOTH
  // persist and hydrate — a total cross-tenant leak — left all 32 tests in this
  // file green, because the old stub ignored its arguments and returned rows[0].
  //
  // Endocrine state is a business's private condition: which pressures it is
  // under, and the evidence for each. Leaking it across tenants would put one
  // company's financial distress into another's prompt.
  it('hydrate reads only its own tenant’s row', async () => {
    const prisma = new PrismaStub();
    prisma.seed(
      JSON.stringify([
        { name: 'cortisol', level: 0.6, reasons: ['biz_1 cash crisis'], updatedAt: new Date().toISOString() },
      ]),
      'biz_1',
    );

    const svc = new KeyCortexEndocrineService(prisma as never);
    await svc.hydrate('biz_2');

    expect(svc.read('biz_2'), 'biz_2 hydrated biz_1’s hormones').toEqual([]);
    expect(svc.effortMultiplier('biz_2')).toBe(1);
  });

  it('persist writes to its own tenant’s row', async () => {
    const prisma = new PrismaStub();
    prisma.seed(
      JSON.stringify([
        { name: 'cortisol', level: 0.6, reasons: ['biz_1 cash crisis'], updatedAt: new Date().toISOString() },
      ]),
      'biz_1',
    );

    const svc = new KeyCortexEndocrineService(prisma as never);
    svc.release('biz_2', [{ hormone: 'malaise', magnitude: 0.2, reason: 'biz_2 organs' }]);
    await flush();

    const b1 = prisma.rows.find((r) => r.businessId === 'biz_1')!;
    const b2 = prisma.rows.find((r) => r.businessId === 'biz_2')!;

    expect(b2, 'no row written for biz_2').toBeDefined();
    expect(JSON.parse(b1.value)[0].reasons).toContain('biz_1 cash crisis');
    expect(JSON.parse(b2.value).map((h: { name: string }) => h.name)).toEqual(['malaise']);
  });
});

describe('restored state is aged, not resurrected', () => {
  it('a level written earlier comes back decayed but still present', async () => {
    // MUTATION-PROVED USELESS in its first form. The old version used a 48-hour
    // gap, and 0.35 * 0.92^48 = 0.0064 falls below NOISE_FLOOR, so read()
    // always returned [] and the assertion
    //   `restored.length === 0 || restored[0].level < levelThen`
    // was satisfied by its FIRST disjunct every time. It passed with the entire
    // hydration merge replaced by a no-op — testing neither restoration nor
    // aging.
    //
    // A four-hour gap keeps the level above the noise floor, so both halves are
    // forced: the hormone must actually come back, AND it must have decayed.
    const prisma = new PrismaStub();
    const written = new Date('2026-08-03T00:00:00Z');
    const later = new Date('2026-08-03T04:00:00Z');

    const first = new KeyCortexEndocrineService(prisma as never);
    first.release('biz_1', [{ ...SIGNAL, magnitude: 0.35 }], written);
    await flush();
    const levelThen = first.read('biz_1', written)[0].level;

    const second = new KeyCortexEndocrineService(prisma as never);
    await second.hydrate('biz_1');
    const restored = second.read('biz_1', later);

    expect(restored, 'nothing was restored — hydration is a no-op').toHaveLength(1);
    expect(restored[0].level, 'restored at full strength — decay not applied').toBeLessThan(levelThen);
    expect(restored[0].level, 'decayed to nothing — the anchor is wrong').toBeGreaterThan(0.05);
    // 4h at 0.92/hour retains ~71%.
    expect(restored[0].level).toBeCloseTo(levelThen * Math.pow(0.92, 4), 3);
  });
});

describe('a cold process must not destroy accumulated state', () => {
  // THIS IS THE ONE THE ORIGINAL SUITE MISSED, and it was data-destroying.
  //
  // persist() serialised the in-memory Map wholesale. A process that has never
  // hydrated a business holds only the hormone it just released, so writing
  // that map erased every level it had not seen. Proved against a real
  // Postgres: a business carrying cortisol and humility was reduced to a
  // single malaise entry by one release from a cold instance.
  //
  // The homeostasis @Cron made it systematic rather than rare — it sweeps
  // EVERY business every 30 minutes from a process that has usually hydrated
  // none of them, so within half an hour of a deploy the stored disposition of
  // the whole estate would be replaced by whatever that sweep observed.
  //
  // Every test in the original suite reused ONE instance, so none of them
  // could see it.
  it('preserves hormones the releasing process has never seen', async () => {
    const prisma = new PrismaStub();

    const warm = new KeyCortexEndocrineService(prisma as never);
    warm.release('biz_1', [{ hormone: 'cortisol', magnitude: 0.3, reason: 'cash tightening' }]);
    await flush();
    warm.release('biz_1', [{ hormone: 'humility', magnitude: 0.3, reason: 'predictions wrong' }]);
    await flush();

    // A brand-new instance that has never hydrated this business.
    const cold = new KeyCortexEndocrineService(prisma as never);
    cold.release('biz_1', [{ hormone: 'malaise', magnitude: 0.2, reason: 'organs degraded' }]);
    await flush();

    const names = JSON.parse(prisma.rows[0].value).map((h: { name: string }) => h.name).sort();
    expect(names, 'a cold release wiped prior state').toEqual(['cortisol', 'humility', 'malaise']);
  });

  it('the fresher observation still wins for a hormone in both', async () => {
    const prisma = new PrismaStub();
    const warm = new KeyCortexEndocrineService(prisma as never);
    warm.release('biz_1', [{ hormone: 'cortisol', magnitude: 0.1, reason: 'old' }]);
    await flush();

    const cold = new KeyCortexEndocrineService(prisma as never);
    cold.release('biz_1', [{ hormone: 'cortisol', magnitude: 0.35, reason: 'new and worse' }]);
    await flush();

    const [stored] = JSON.parse(prisma.rows[0].value);
    expect(stored.reasons).toContain('new and worse');
  });
});

describe('storage is treated as untrusted input', () => {
  it('a corrupt row degrades to neutral instead of throwing', async () => {
    // This value is a JSON string in a database column. A half-written row must
    // not break the request that happened to trigger the read.
    const prisma = new PrismaStub();
    prisma.seed('{not json');

    const svc = new KeyCortexEndocrineService(prisma as never);
    await expect(svc.hydrate('biz_1')).resolves.toBeUndefined();
    expect(svc.read('biz_1')).toEqual([]);
  });

  it('a malformed level never reaches the arithmetic', async () => {
    // A NaN level would flow into effortMultiplier and produce a NaN token
    // multiplier on the request path — far harder to diagnose than absence.
    const prisma = new PrismaStub();
    prisma.seed(JSON.stringify([
          { name: 'cortisol', level: 'high', reasons: [], updatedAt: new Date().toISOString() },
          { name: 'not_a_hormone', level: 0.5, reasons: [], updatedAt: new Date().toISOString() },
          { name: 'humility', level: 0.4, reasons: ['ok'], updatedAt: 'never' },
        ]));

    const svc = new KeyCortexEndocrineService(prisma as never);
    await svc.hydrate('biz_1');

    expect(svc.read('biz_1')).toEqual([]);
    expect(Number.isFinite(svc.effortMultiplier('biz_1'))).toBe(true);
  });

  it('a transient read failure does not disable hydration permanently', async () => {
    // Marking the business hydrated before the query is what dedupes concurrent
    // reads; leaving it marked after a failure would run that business
    // permanently neutral while believing it had loaded state.
    const prisma = new PrismaStub();
    prisma.failOn = 'read';
    const svc = new KeyCortexEndocrineService(prisma as never);

    await svc.hydrate('biz_1');

    prisma.failOn = 'none';
    prisma.seed(JSON.stringify([
          { name: 'cortisol', level: 0.4, reasons: ['recovered'], updatedAt: new Date().toISOString() },
        ]));
    await svc.hydrate('biz_1');

    expect(svc.read('biz_1'), 'hydration never retried after a blip').toHaveLength(1);
  });
});

describe('durability never costs correctness', () => {
  it('hydrate does not clobber a level observed while it was in flight', async () => {
    // Storage says cortisol 0.1; the live process has just observed 0.35.
    const prisma = new PrismaStub();
    prisma.seed(JSON.stringify([
          { name: 'cortisol', level: 0.1, reasons: ['stale'], updatedAt: new Date().toISOString() },
        ]));

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
