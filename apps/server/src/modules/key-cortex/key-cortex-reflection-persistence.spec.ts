/**
 * Reflection persistence — making the learning layer actually learn.
 *
 * persistSession and persistHypothesisUpdate were empty bodies, and
 * getWeeklySessions returned a hardcoded []. The consequences compounded:
 *
 *   - every reflection, dream and synthesis died with the process
 *   - weekly synthesis consolidated ZERO sessions forever, while logging that
 *     it had consolidated them
 *   - getLastReflectionSession returned null after any restart, so the
 *     consciousness layer saw a KEY with no recollection of ever reflecting
 *
 * A cognition system that cannot remember what it concluded is an expensive
 * logger. These tests pin the round-trip: what a cycle writes, the weekly
 * synthesis can read back.
 *
 * Storage is KeyCortexMemory, which already existed with the needed shape, so
 * none of this required a schema migration.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexReflectionService } from './key-cortex-reflection.service';

/** In-memory stand-in for the KeyCortexMemory table. */
class MemoryStore {
  rows: Array<Record<string, unknown>> = [];
  private seq = 0;

  client = {
    keyCortexMemory: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `mem_${++this.seq}`, createdAt: new Date(), ...data };
        this.rows.push(row);
        return Promise.resolve(row);
      }),
      findFirst: vi.fn(({ where, orderBy }: { where: Record<string, unknown>; orderBy?: Record<string, string> }) => {
        let matches = this.rows.filter((r) =>
          Object.entries(where).every(([k, v]) => typeof v !== 'object' && r[k] === v),
        );
        if (orderBy?.createdAt === 'desc') matches = [...matches].reverse();
        return Promise.resolve(matches[0] ?? null);
      }),
      findMany: vi.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          this.rows.filter((r) =>
            Object.entries(where).every(([k, v]) => {
              if (v && typeof v === 'object') return true; // date range: ignore in the fake
              return r[k] === v;
            }),
          ),
        ),
      ),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = this.rows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
  };
}

/** Construct the service with only the dependency these paths touch. */
function makeService(prisma: MemoryStore) {
  const noop = new Proxy({}, { get: () => vi.fn() });
  return new KeyCortexReflectionService(
    prisma as never,
    noop as never,
    noop as never,
    noop as never,
    noop as never,
    noop as never,
  );
}

type Internals = {
  persistSession(s: Record<string, unknown>): Promise<void>;
  persistHypothesisUpdate(h: Record<string, unknown>): Promise<void>;
  getWeeklySessions(b: string, s: Date, e: Date): Promise<Array<Record<string, unknown>>>;
};

const session = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  type: 'reflection',
  startedAt: new Date('2026-03-01T10:00:00Z'),
  durationMs: 1234,
  insights: [{ id: 'i1', type: 'pattern', description: 'invoices cluster on Fridays', confidence: 0.7 }],
  actionsTaken: ['reviewed 3 decisions'],
  businessId: 'biz_1',
  ...overrides,
});

describe('session persistence', () => {
  let prisma: MemoryStore;
  let svc: KeyCortexReflectionService & Internals;

  beforeEach(() => {
    prisma = new MemoryStore();
    svc = makeService(prisma) as KeyCortexReflectionService & Internals;
  });

  it('writes a session instead of discarding it', async () => {
    await svc.persistSession(session('sess_1'));
    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0].type).toBe('reflection_session');
    expect(prisma.rows[0].key).toBe('sess_1');
  });

  it('round-trips through the weekly read — the loop that consolidated nothing', async () => {
    await svc.persistSession(session('sess_1'));
    await svc.persistSession(session('sess_2', { durationMs: 999 }));

    const back = await svc.getWeeklySessions(
      'biz_1',
      new Date('2026-02-25T00:00:00Z'),
      new Date('2026-03-05T00:00:00Z'),
    );

    expect(back).toHaveLength(2);
    expect(back.map((s) => s.id).sort()).toEqual(['sess_1', 'sess_2']);
  });

  it('preserves the insights, which are the point of storing it at all', async () => {
    await svc.persistSession(session('sess_1'));
    const [back] = await svc.getWeeklySessions('biz_1', new Date(0), new Date());

    const insights = back.insights as Array<Record<string, unknown>>;
    expect(insights).toHaveLength(1);
    expect(insights[0].description).toBe('invoices cluster on Fridays');
    expect(back.actionsTaken).toEqual(['reviewed 3 decisions']);
    expect(back.durationMs).toBe(1234);
  });

  it('survives a restart: last session is read from storage, not memory', async () => {
    await svc.persistSession(session('sess_1'));

    // A fresh service instance = a restarted process, empty in-memory cache.
    const restarted = makeService(prisma);
    const last = await restarted.getLastReflectionSession('biz_1');

    expect(last).not.toBeNull();
    expect(last?.id).toBe('sess_1');
  });

  it('a storage failure does not break the reflection cycle', async () => {
    // Background cognition losing one record must not take down the cycle.
    prisma.client.keyCortexMemory.create.mockRejectedValueOnce(new Error('db down'));
    await expect(svc.persistSession(session('sess_1'))).resolves.toBeUndefined();
  });

  it('one malformed row does not lose the whole week', async () => {
    await svc.persistSession(session('sess_1'));
    prisma.rows.push({
      id: 'mem_bad',
      businessId: 'biz_1',
      type: 'reflection_session',
      key: 'corrupt',
      value: '{not json',
      createdAt: new Date(),
    });

    const back = await svc.getWeeklySessions('biz_1', new Date(0), new Date());
    expect(back).toHaveLength(1);
    expect(back[0].id).toBe('sess_1');
  });
});

describe('hypothesis persistence', () => {
  let prisma: MemoryStore;
  let svc: KeyCortexReflectionService & Internals;

  beforeEach(() => {
    prisma = new MemoryStore();
    svc = makeService(prisma) as KeyCortexReflectionService & Internals;
  });

  const hypothesis = (status: string) => ({
    id: 'hyp_1',
    description: 'churn follows support latency',
    sources: ['tickets', 'invoices'],
    confidence: 0.3,
    creativityScore: 0.8,
    status,
    businessId: 'biz_1',
    createdAt: new Date('2026-03-01T03:00:00Z'),
  });

  it('stores a new hypothesis', async () => {
    await svc.persistHypothesisUpdate(hypothesis('pending'));
    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0].type).toBe('dream_hypothesis');
  });

  it('UPDATES in place when validated rather than duplicating', async () => {
    // Accumulating duplicates would make the weekly report count the same
    // hypothesis once per validation pass.
    await svc.persistHypothesisUpdate(hypothesis('pending'));
    await svc.persistHypothesisUpdate(hypothesis('confirmed'));

    expect(prisma.rows).toHaveLength(1);
    expect(JSON.parse(prisma.rows[0].value as string).status).toBe('confirmed');
  });

  it('a storage failure does not break the dream cycle', async () => {
    prisma.client.keyCortexMemory.findFirst.mockRejectedValueOnce(new Error('db down'));
    await expect(svc.persistHypothesisUpdate(hypothesis('pending'))).resolves.toBeUndefined();
  });
});

describe('the destructive maintenance job', () => {
  it('no longer deletes BusinessEvent rows', async () => {
    // archiveOldEvents hard-deleted up to 1000 audit rows per business per
    // night while its paired "archive" was a comment, then logged that it had
    // archived them. 12 modules read that table; there is no backup path.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, 'key-cortex-reflection.service.ts'), 'utf8');

    expect(src).not.toMatch(/businessEvent\s*\n?\s*\.deleteMany/);
    expect(src).not.toMatch(/businessEvent\.deleteMany/);
  });
});
