/**
 * The onboarding state cache has to be bounded, and evicting has to be safe.
 *
 * `stateCache` was a plain Map with exactly one eviction path: a user hitting
 * reset. Every business that ever opened onboarding left an entry behind, each
 * holding the full message transcript, in a process that runs for weeks.
 * Nothing swept it and nothing capped it.
 *
 * It was reported as "state durability: in-memory Map, refresh restarts the
 * interview". That part is not right, and the difference is the whole reason
 * this is cheap to fix: getState REBUILDS from the persisted blueprint on a
 * miss — completedSections and currentSection are derived from saved data, so
 * progress survives. Only the transcript is cache-resident, and the caller
 * passes that in.
 *
 * So the tests that matter are: it forgets, and forgetting costs nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BlueprintOnboardingService } from './blueprint-onboarding.service';

function makeService() {
  const getBlueprint = vi.fn(async () => ({ identity: {}, offering: {} }) as never);
  const svc = new BlueprintOnboardingService(
    { getBlueprint } as never,
    {} as never,
    {} as never,
  );
  return { svc, getBlueprint };
}

describe('the onboarding state cache is bounded', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('serves a repeat read from cache, without re-reading the blueprint', async () => {
    const { svc, getBlueprint } = makeService();
    await svc.getState('biz_1');
    await svc.getState('biz_1');
    expect(getBlueprint, 'the cache should still be a cache').toHaveBeenCalledTimes(1);
  });

  it('forgets an entry once it goes stale, and rebuilds it', async () => {
    const { svc, getBlueprint } = makeService();
    await svc.getState('biz_1');

    vi.advanceTimersByTime(61 * 60_000);
    await svc.getState('biz_1');

    expect(getBlueprint, 'an expired entry is a miss, not stale data').toHaveBeenCalledTimes(2);
  });

  it('does not grow without limit', async () => {
    // The actual defect: one entry per business, forever, each holding a
    // transcript, in a process that runs for weeks.
    const { svc } = makeService();
    for (let i = 0; i < 700; i++) await svc.getState(`biz_${i}`);

    const size = (svc as unknown as { stateCache: Map<string, unknown> }).stateCache.size;
    expect(size, 'the cache must be capped').toBeLessThanOrEqual(500);
  });

  it('keeps the most recent entries when it evicts', async () => {
    const { svc } = makeService();
    for (let i = 0; i < 700; i++) await svc.getState(`biz_${i}`);

    const cache = (svc as unknown as { stateCache: Map<string, unknown> }).stateCache;
    expect(cache.has('biz_699'), 'the newest write must survive').toBe(true);
    expect(cache.has('biz_0'), 'the oldest must be the one dropped').toBe(false);
  });

  it('rebuilds progress from the blueprint after eviction — nothing is lost', async () => {
    // Why eviction is safe at all: the state is derived, not stored.
    const { svc, getBlueprint } = makeService();
    const first = await svc.getState('biz_1');

    (svc as unknown as { stateCache: Map<string, unknown> }).stateCache.clear();
    const rebuilt = await svc.getState('biz_1');

    expect(getBlueprint).toHaveBeenCalledTimes(2);
    expect(rebuilt.completedSections).toEqual(first.completedSections);
    expect(rebuilt.currentSection).toEqual(first.currentSection);
  });

  it('a refreshed entry is not treated as old', async () => {
    // delete-before-set: without it, re-reading a business keeps its original
    // insertion position and it gets evicted while still in active use.
    const { svc } = makeService();
    for (let i = 0; i < 499; i++) await svc.getState(`biz_${i}`);
    await svc.getState('biz_0');            // touch the oldest
    for (let i = 500; i < 520; i++) await svc.getState(`biz_${i}`);

    const cache = (svc as unknown as { stateCache: Map<string, unknown> }).stateCache;
    expect(cache.has('biz_0'), 'a recently used entry must not be evicted first').toBe(true);
  });
});
