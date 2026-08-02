/**
 * Interoception — the afferent half of the peripheral nervous system.
 *
 * Organ adapters have always declared getState(). Before this service, that
 * method had ZERO call sites in the entire server: the registrar harvested
 * listTools() at boot (efferent — brain acting on organs) and nothing ever
 * asked an organ how it was doing. KEY could move its limbs and not feel them.
 *
 * The properties that matter most here are the failure ones. Interoception runs
 * inside the conscious pipeline, so it must be incapable of breaking the thought
 * it is informing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexInteroceptionService } from './key-cortex-interoception.service';

type Adapter = {
  organId: string;
  organName: string;
  getState: (businessId: string) => Promise<unknown>;
};

/** Minimal stand-in for the registrar: interoception only needs listAdapters. */
function registrarOf(adapters: Adapter[]) {
  return { listAdapters: () => adapters };
}

function makeService(registrar: { listAdapters: () => Adapter[] }) {
  return new KeyCortexInteroceptionService(
    registrar as unknown as ConstructorParameters<
      typeof KeyCortexInteroceptionService
    >[0],
  );
}

const healthy = (id: string): Adapter => ({
  organId: id,
  organName: id.toUpperCase(),
  getState: () => Promise.resolve({ healthy: true, status: 'ok' }),
});

const unhealthy = (id: string, gaps: string[] = []): Adapter => ({
  organId: id,
  organName: id.toUpperCase(),
  getState: () => Promise.resolve({ healthy: false, status: 'degraded', gaps }),
});

const throwing = (id: string): Adapter => ({
  organId: id,
  organName: id.toUpperCase(),
  getState: () => Promise.reject(new Error('connector refused')),
});

describe('senseBody', () => {
  let service: KeyCortexInteroceptionService;

  beforeEach(() => {
    service = makeService(registrarOf([healthy('a'), healthy('b')]));
  });

  it('reads every organ', async () => {
    const body = await service.senseBody('biz_1');
    expect(body.totalCount).toBe(2);
    expect(body.healthyCount).toBe(2);
    expect(body.integrity).toBe(1);
  });

  it('a throwing organ becomes a reading, not an exception', async () => {
    // This is the property the whole design rests on: interoception must never
    // be able to fail the query it is informing.
    const s = makeService(registrarOf([healthy('a'), throwing('b')]));
    const body = await s.senseBody('biz_1');

    expect(body.totalCount).toBe(2);
    expect(body.unreachableCount).toBe(1);
    expect(body.readings.find((r) => r.organId === 'b')?.unreachable).toContain(
      'connector refused',
    );
  });

  it('never rejects even when every organ fails', async () => {
    const s = makeService(registrarOf([throwing('a'), throwing('b')]));
    await expect(s.senseBody('biz_1')).resolves.toBeDefined();
    const body = await s.senseBody('biz_1', true);
    expect(body.integrity).toBe(0);
  });

  it('an unreachable organ counts against integrity like an unhealthy one', async () => {
    // "I cannot feel it" and "it is not working" warrant the same caution.
    const withUnhealthy = makeService(registrarOf([healthy('a'), unhealthy('b')]));
    const withUnreachable = makeService(registrarOf([healthy('a'), throwing('b')]));

    expect((await withUnhealthy.senseBody('biz_1')).integrity).toBe(
      (await withUnreachable.senseBody('biz_1')).integrity,
    );
  });

  it('collects gaps across organs without duplicates', async () => {
    const s = makeService(
      registrarOf([unhealthy('a', ['no bank feed']), unhealthy('b', ['no bank feed', 'no tax id'])]),
    );
    const body = await s.senseBody('biz_1');
    expect([...body.gaps].sort()).toEqual(['no bank feed', 'no tax id']);
  });

  it('a hanging organ does not hang cognition', async () => {
    vi.useFakeTimers();
    const hanging: Adapter = {
      organId: 'slow',
      organName: 'SLOW',
      getState: () => new Promise(() => {}), // never settles
    };
    const s = makeService(registrarOf([healthy('a'), hanging]));

    const promise = s.senseBody('biz_1');
    await vi.advanceTimersByTimeAsync(3_500);
    const body = await promise;

    expect(body.unreachableCount).toBe(1);
    expect(body.readings.find((r) => r.organId === 'slow')?.unreachable).toMatch(
      /no response/,
    );
    vi.useRealTimers();
  });

  it('caches within the TTL and re-reads when forced', async () => {
    const getState = vi.fn().mockResolvedValue({ healthy: true, status: 'ok' });
    const s = makeService(
      registrarOf([{ organId: 'a', organName: 'A', getState }]),
    );

    await s.senseBody('biz_1');
    await s.senseBody('biz_1');
    expect(getState).toHaveBeenCalledTimes(1);

    await s.senseBody('biz_1', true);
    expect(getState).toHaveBeenCalledTimes(2);
  });

  it('invalidate forces the next read to hit the organs', async () => {
    const getState = vi.fn().mockResolvedValue({ healthy: true, status: 'ok' });
    const s = makeService(
      registrarOf([{ organId: 'a', organName: 'A', getState }]),
    );

    await s.senseBody('biz_1');
    s.invalidate('biz_1');
    await s.senseBody('biz_1');
    expect(getState).toHaveBeenCalledTimes(2);
  });

  it('caches per business, so one tenant never sees another body', async () => {
    const getState = vi.fn().mockResolvedValue({ healthy: true, status: 'ok' });
    const s = makeService(
      registrarOf([{ organId: 'a', organName: 'A', getState }]),
    );

    await s.senseBody('biz_1');
    await s.senseBody('biz_2');
    expect(getState).toHaveBeenCalledTimes(2);
    expect(getState).toHaveBeenNthCalledWith(1, 'biz_1');
    expect(getState).toHaveBeenNthCalledWith(2, 'biz_2');
  });
});

describe('describeForPrompt', () => {
  it('says nothing when everything is healthy', async () => {
    // Emitting "all systems normal" on every query spends tokens to say nothing
    // and trains the model to skim the section.
    const s = makeService(registrarOf([healthy('a'), healthy('b')]));
    expect(s.describeForPrompt(await s.senseBody('biz_1'))).toBeNull();
  });

  it('names the impaired organs and instructs honesty about incompleteness', async () => {
    const s = makeService(registrarOf([healthy('a'), unhealthy('b')]));
    const text = s.describeForPrompt(await s.senseBody('biz_1'));

    expect(text).toContain('B');
    expect(text).toContain('1 of 2');
    expect(text).toMatch(/incomplete/i);
  });

  it('distinguishes unreachable from merely unwell', async () => {
    const s = makeService(registrarOf([throwing('a')]));
    const text = s.describeForPrompt(await s.senseBody('biz_1'));
    expect(text).toMatch(/unreachable/);
  });
});
