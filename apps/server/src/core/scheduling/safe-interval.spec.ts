import { describe, it, expect, vi, afterEach } from 'vitest';
import { safeInterval, safeTimeout, runGuarded } from './safe-interval';

/**
 * The property under test is not "errors are logged" — it is that a background
 * job can NEVER produce an unhandled rejection, because `main.ts` turns one of
 * those into `process.exit(1)` and drops every in-flight request for every
 * tenant.
 *
 * So the assertions below watch the process's own `unhandledRejection` event
 * rather than trusting that a `.catch()` is present in the source. A test that
 * only asserted "logger.error was called" would stay green against an
 * implementation that logged AND still leaked the rejection.
 */

const logger = { error: vi.fn() };

/** Runs `body`, then reports any unhandledRejection the process observed. */
async function watchUnhandled(body: () => Promise<void> | void): Promise<unknown[]> {
  const seen: unknown[] = [];
  const onUnhandled = (reason: unknown) => seen.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    await body();
    // Unhandled-rejection detection is deferred to a later microtask/tick, so a
    // synchronous assertion would pass before Node has decided.
    await new Promise((r) => setTimeout(r, 60));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  return seen;
}

afterEach(() => {
  logger.error.mockReset();
  vi.useRealTimers();
});

describe('runGuarded', () => {
  it('contains a synchronous throw', async () => {
    const seen = await watchUnhandled(() => {
      runGuarded('sync', () => {
        throw new Error('boom');
      }, logger);
    });
    expect(seen).toEqual([]);
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error.mock.calls[0][0]).toContain('boom');
  });

  it('contains a rejected promise — the shape that kills the API', async () => {
    const seen = await watchUnhandled(() => {
      runGuarded('async', async () => {
        throw new Error('transient db blip');
      }, logger);
    });
    expect(
      seen,
      'a rejection escaped: main.ts would call process.exit(1) and drop every ' +
        'in-flight request for every tenant',
    ).toEqual([]);
    expect(logger.error.mock.calls[0][0]).toContain('transient db blip');
  });

  it('contains a rejection from a non-native thenable', async () => {
    const seen = await watchUnhandled(() => {
      runGuarded('thenable', () => ({
        then: (_res: unknown, rej: (e: unknown) => void) => rej(new Error('foreign realm')),
      }), logger);
    });
    expect(seen).toEqual([]);
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('leaves a successful job alone', async () => {
    const seen = await watchUnhandled(async () => {
      runGuarded('ok', async () => 'fine', logger);
    });
    expect(seen).toEqual([]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('labels the failure so the noisy job is identifiable', async () => {
    await watchUnhandled(() => {
      runGuarded('InvoiceOverdueScheduler', () => {
        throw new Error('x');
      }, logger);
    });
    expect(logger.error.mock.calls[0][0]).toContain('[InvoiceOverdueScheduler]');
  });

  it('never rethrows, so it cannot re-enter the process handler', () => {
    const throwingLogger = {
      error: () => {
        throw new Error('the logger itself failed');
      },
    };
    // A logger that throws must not convert a handled job error into an
    // unhandled one. This is the failure mode where the safety net has a hole
    // exactly where it is needed most.
    expect(() => runGuarded('nested', () => {
      throw new Error('inner');
    }, throwingLogger)).toThrow('the logger itself failed');
  });
});

describe('safeInterval / safeTimeout', () => {
  it('keeps ticking after a failed tick', async () => {
    let calls = 0;
    const seen = await watchUnhandled(async () => {
      const t = safeInterval('ticker', 10, async () => {
        calls++;
        throw new Error('every tick fails');
      }, logger);
      await new Promise((r) => setTimeout(r, 75));
      clearInterval(t);
    });
    expect(seen).toEqual([]);
    expect(calls, 'the scheduler stopped after the first failure').toBeGreaterThan(1);
  });

  it('returns a handle that clearInterval actually stops', async () => {
    let calls = 0;
    const t = safeInterval('stoppable', 10, () => { calls++; }, logger);
    await new Promise((r) => setTimeout(r, 45));
    clearInterval(t);
    const atStop = calls;
    await new Promise((r) => setTimeout(r, 45));
    expect(calls).toBe(atStop);
  });

  it('guards a delayed start too', async () => {
    const seen = await watchUnhandled(async () => {
      safeTimeout('delayed', 5, async () => {
        throw new Error('startup tick failed');
      }, logger);
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(seen).toEqual([]);
    expect(logger.error).toHaveBeenCalledOnce();
  });
});

describe('the failure mode this exists to prevent', () => {
  it('demonstrates that an UNGUARDED async interval callback does leak', async () => {
    // The negative control, and the reason the wrapper is not decorative. If
    // this ever stops leaking, Node's semantics changed and the guard's
    // justification should be re-examined rather than assumed.
    const seen = await watchUnhandled(async () => {
      const t = setInterval(async () => {
        throw new Error('unguarded');
      }, 10);
      await new Promise((r) => setTimeout(r, 40));
      clearInterval(t);
    });
    expect(
      seen.length,
      'an unguarded async interval callback no longer produces an ' +
        'unhandledRejection — re-check whether safeInterval is still needed',
    ).toBeGreaterThan(0);
  });
});
