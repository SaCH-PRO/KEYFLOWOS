import { describe, it, expect, beforeEach } from 'vitest';
import { runGuarded } from '../scheduling/safe-interval';
import { errorRegistry } from './error-registry';

/**
 * The registry's own spec proves it CAN store a failure. This one proves the
 * failure actually ARRIVES — that the reporters are wired to it.
 *
 * They are separate on purpose. `error-registry.spec.ts` would stay entirely
 * green if the `errorRegistry.record(...)` call were deleted from `runGuarded`
 * and from `GlobalHttpExceptionFilter`, leaving a working store nothing writes
 * to: a diagnostics endpoint that always reports zero errors and reads as good
 * news. That is the exact shape of green-but-useless this repo keeps finding,
 * so the delivery path gets its own assertion.
 *
 * The HTTP side is covered by the filter's own spec rather than duplicated
 * here; this file pins the background path, which has no other test that
 * exercises the real singleton.
 */
describe('background failures actually reach the error registry', () => {
  const silent = { error: () => {} };

  beforeEach(() => errorRegistry.reset());

  it('records a rejected async tick', async () => {
    runGuarded('WiredJob', async () => {
      throw new Error('db down');
    }, silent);
    await new Promise((r) => setTimeout(r, 30));

    const snap = errorRegistry.snapshot();
    expect(
      snap.bySource.background,
      'runGuarded no longer reports to the registry — the diagnostics endpoint ' +
        'will show zero errors regardless of what is failing',
    ).toBe(1);
    expect(snap.entries[0].label).toBe('WiredJob');
    expect(snap.entries[0].message).toContain('db down');
  });

  it('records a synchronous throw from a tick', async () => {
    runGuarded('SyncJob', () => {
      throw new Error('sync boom');
    }, silent);
    await new Promise((r) => setTimeout(r, 10));
    expect(errorRegistry.snapshot().entries[0].label).toBe('SyncJob');
  });

  it('leaves the registry untouched when a tick succeeds', async () => {
    runGuarded('HappyJob', async () => 'fine', silent);
    await new Promise((r) => setTimeout(r, 20));
    expect(errorRegistry.snapshot().total).toBe(0);
  });

  it('groups repeat failures of one job under a single counted entry', async () => {
    for (let i = 0; i < 5; i++) {
      runGuarded('FlakyJob', async () => {
        throw new Error('same cause');
      }, silent);
    }
    await new Promise((r) => setTimeout(r, 40));
    const snap = errorRegistry.snapshot();
    expect(snap.distinct).toBe(1);
    expect(snap.entries[0].count).toBe(5);
  });
});
