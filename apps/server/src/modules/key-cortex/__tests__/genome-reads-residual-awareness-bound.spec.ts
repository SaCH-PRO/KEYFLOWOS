/**
 * FU-KEY-GENOME-READS-RESIDUAL (D-235), orchestrator acceptance (correctness M1): GET cortex/awareness reads a reader
 * without revenue read (and no reader: fails closed) with headroom, and that read is bounded: exactly PER_KIND_HEADROOM
 * (100) rows of a kind, of which at most PER_KIND_LIMIT (25) are served and counted. A revenue reader reads 25 as before.
 */
import { describe, it, expect, vi } from 'vitest';
import { KeyCortexAwarenessService } from '../key-cortex-awareness.service';

const rows = Array.from({ length: 500 }, (_, i) => ({
  key: `c_${i}`,
  value: JSON.stringify({ headline: `Delivery ${i} slipped a day` }),
  confidence: 0.8,
  createdAt: new Date(Date.UTC(2026, 10, 22) - i * 60_000),
}));

function awareness() {
  const svc = Object.create(KeyCortexAwarenessService.prototype) as any;
  svc.logger = { log: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
  const findMany = vi.fn(async ({ take }: any) => rows.slice(0, take ?? rows.length));
  svc.prisma = { client: { keyCortexMemory: { findMany } } };
  return { svc, findMany };
}

describe('the awareness read bound (orchestrator acceptance, correctness M1)', () => {
  it.each([
    ['a reader without revenue read', { readsRevenue: false }],
    ['no reader (fails closed)', {}],
  ])('%s reads exactly 100 rows of each kind it is served, and is served and counted at most 25 of a kind', async (_label, opts) => {
    const { svc, findMany } = awareness();
    const out = await svc.getAwareness('biz_A', opts);
    expect(findMany).toHaveBeenCalled();
    for (const call of findMany.mock.calls) expect(call[0].take).toBe(100);
    const perKind = new Map<string, number>();
    for (const item of out.items) perKind.set(item.kind, (perKind.get(item.kind) ?? 0) + 1);
    for (const [kind, n] of perKind) expect(n, kind).toBeLessThanOrEqual(25);
    for (const [kind, n] of Object.entries(out.counts)) expect(n as number, kind).toBeLessThanOrEqual(25);
    expect(perKind.size).toBeGreaterThan(0);
    for (const n of perKind.values()) expect(n).toBe(25);
  });

  it('control: a revenue reader reads 25 rows of a kind, as before', async () => {
    const { svc, findMany } = awareness();
    await svc.getAwareness('biz_A', { readsRevenue: true });
    expect(findMany).toHaveBeenCalled();
    for (const call of findMany.mock.calls) expect(call[0].take).toBe(25);
  });
});
