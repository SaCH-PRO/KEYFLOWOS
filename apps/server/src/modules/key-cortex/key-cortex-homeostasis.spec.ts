/**
 * Homeostasis — the control loop KEY did not have.
 *
 * Every other pathway in this cortex is a reflex chain: stimulus, afferent,
 * integration, efferent, effector. That makes KEY reactive. What makes a
 * nervous system a CONTROL system is a variable with a setpoint, a measured
 * deviation, and a corrective response that opposes the disturbance.
 *
 * Nothing measured KEY's own condition over time before this. Grepping the
 * server for `drift`, `homeostasis` or `equilibrium` returned no
 * implementation. KEY had interoception — a snapshot — and no baseline to
 * compare it against, so it could not notice itself getting worse.
 *
 * The failure modes worth pinning in a control system are not "does it
 * compute a number". They are:
 *
 *   - FALSE ALARM: reporting an unmeasured variable as a deviation, so KEY
 *     doses itself with caution because a table was empty.
 *   - SMALL SAMPLE: one failure out of two is not a 50% integrity crisis.
 *   - NO DAMPING: reacting hard to a brief blip, which oscillates.
 *   - DEAD LOOP: measuring deviation and never converting it to a response —
 *     this repo's signature defect.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexHomeostasisService } from './key-cortex-homeostasis.service';

class PrismaStub {
  logs: Array<{ success: boolean; durationMs: number | null }> = [];
  client = {
    aiExecutionLog: {
      findMany: vi.fn((q: { select?: Record<string, boolean> }) => {
        // The latency query filters durationMs not-null; mirror that.
        if (q.select?.durationMs) {
          return Promise.resolve(this.logs.filter((l) => l.durationMs !== null));
        }
        return Promise.resolve(this.logs);
      }),
    },
    business: { findMany: vi.fn(() => Promise.resolve([{ id: 'biz_1' }])) },
  };
}

class EndocrineStub {
  released: Array<{ businessId: string; signals: Array<Record<string, unknown>> }> = [];
  release = vi.fn((businessId: string, signals: Array<Record<string, unknown>>) => {
    this.released.push({ businessId, signals });
  });
}

class InteroStub {
  body: { totalCount: number; integrity: number } | null = null;
  // senseBody, not peekBody. This loop runs on a cron in a process that has
  // usually served no traffic for the business, so the peek cache was always
  // cold and bodyIntegrity was structurally null on every sweep — a reading
  // that never contributed while still paying for a discarded organ fan-out.
  senseBody = vi.fn(() => Promise.resolve(this.body));
  peekBody = vi.fn(() => {
    throw new Error('homeostasis must SENSE, not peek — the cron cache is always cold');
  });
}

function make() {
  const prisma = new PrismaStub();
  const endocrine = new EndocrineStub();
  const intero = new InteroStub();
  const svc = new KeyCortexHomeostasisService(
    prisma as never,
    endocrine as never,
    intero as never,
  );
  return { svc, prisma, endocrine, intero };
}

/** n healthy executions — enough to clear the minimum sample. */
function healthyLogs(n = 20) {
  return Array.from({ length: n }, () => ({ success: true, durationMs: 1000 }));
}

describe('measurement is honest about what it does not know', () => {
  it('an unmeasured variable is NOT a deviation', async () => {
    // The important false-alarm case: no execution history must not read as
    // "0% success", which would dose KEY with caution for being idle.
    const { svc, prisma, endocrine } = make();
    prisma.logs = [];

    const readings = await svc.regulate('biz_1');

    expect(readings.every((r) => r.deviation === 0)).toBe(true);
    expect(endocrine.release).not.toHaveBeenCalled();
  });

  it('reports null rather than zero for an unmeasured variable', async () => {
    const { svc, prisma } = make();
    prisma.logs = [];

    const readings = await svc.assess('biz_1');
    expect(readings.find((r) => r.variable === 'executionIntegrity')?.value).toBeNull();
  });

  it('ignores a sample too small to mean anything', async () => {
    // One failure out of two is not a 50% integrity crisis.
    const { svc, prisma, endocrine } = make();
    prisma.logs = [
      { success: true, durationMs: 100 },
      { success: false, durationMs: 100 },
    ];

    await svc.regulate('biz_1');
    expect(endocrine.release).not.toHaveBeenCalled();
  });

  it('a cold interoception cache is unmeasured, not unhealthy', async () => {
    const { svc, intero } = make();
    intero.body = null;

    const readings = await svc.assess('biz_1');
    expect(readings.find((r) => r.variable === 'bodyIntegrity')?.value).toBeNull();
  });
});

describe('deviation from setpoint produces a corrective response', () => {
  it('stays silent while inside tolerance', async () => {
    // Damping: a healthy system must not be constantly dosing itself.
    const { svc, prisma, endocrine } = make();
    prisma.logs = healthyLogs();

    const readings = await svc.regulate('biz_1');

    expect(readings.every((r) => r.deviation === 0)).toBe(true);
    expect(endocrine.release).not.toHaveBeenCalled();
  });

  it('failing actions release HUMILITY, not cortisol', async () => {
    // KEY's own actions failing means its predictions were wrong — that
    // warrants hedging, not treating the business as under threat.
    const { svc, prisma, endocrine } = make();
    prisma.logs = Array.from({ length: 20 }, (_, i) => ({
      success: i < 10,
      durationMs: 500,
    }));

    await svc.regulate('biz_1');

    expect(endocrine.release).toHaveBeenCalledTimes(1);
    const signal = endocrine.released[0].signals.find((s) => s.hormone === 'humility');
    expect(signal).toBeDefined();
    expect(signal!.magnitude).toBeGreaterThan(0);
  });

  it('a degraded body releases malaise', async () => {
    const { svc, prisma, endocrine, intero } = make();
    prisma.logs = healthyLogs();
    intero.body = { totalCount: 4, integrity: 0.25 };

    await svc.regulate('biz_1');

    const signal = endocrine.released[0].signals.find((s) => s.hormone === 'malaise');
    expect(signal).toBeDefined();
  });

  it('every signal carries evidence — release() refuses an unexplained one', async () => {
    const { svc, prisma, endocrine } = make();
    prisma.logs = Array.from({ length: 20 }, () => ({ success: false, durationMs: 500 }));

    await svc.regulate('biz_1');

    for (const s of endocrine.released[0].signals) {
      expect(String(s.reason)).toMatch(/setpoint/);
      expect(String(s.reason).length).toBeGreaterThan(10);
    }
  });

  it('magnitude scales with how far out of range it is', async () => {
    // A slightly degraded system must not react as hard as a badly broken one,
    // or the loop cannot settle.
    const mild = make();
    mild.prisma.logs = Array.from({ length: 20 }, (_, i) => ({
      success: i < 17,
      durationMs: 500,
    }));
    await mild.svc.regulate('biz_1');

    const severe = make();
    severe.prisma.logs = Array.from({ length: 20 }, () => ({ success: false, durationMs: 500 }));
    await severe.svc.regulate('biz_1');

    const mildMag = mild.endocrine.released[0]?.signals[0]?.magnitude as number;
    const severeMag = severe.endocrine.released[0].signals[0].magnitude as number;
    expect(severeMag).toBeGreaterThan(mildMag ?? 0);
  });
});

describe('the loop is closed, not merely computed', () => {
  it('regulate converts deviation into an actual release', async () => {
    // Measuring and discarding is this repo's signature defect. The corrective
    // response must reach the effector.
    const { svc, prisma, endocrine } = make();
    prisma.logs = Array.from({ length: 20 }, () => ({ success: false, durationMs: 500 }));

    await svc.regulate('biz_1');
    expect(endocrine.release).toHaveBeenCalled();
  });

  it('the response is neuroendocrine, never a direct business action', async () => {
    // Homeostasis changes how carefully KEY thinks. It must not act on the
    // business — a control loop with hands would oscillate against real data.
    const svcSrc = (await import('node:fs')).readFileSync(
      (await import('node:path')).join(__dirname, 'key-cortex-homeostasis.service.ts'),
      'utf8',
    );
    expect(svcSrc).not.toMatch(/executeTool|toolRegistry|executeToolDirectly/);
  });

  it('one business failing does not stop the loop for the rest', async () => {
    const { svc, prisma } = make();
    prisma.client.business.findMany = vi.fn(() =>
      Promise.resolve([{ id: 'biz_1' }, { id: 'biz_2' }]),
    );
    prisma.client.aiExecutionLog.findMany = vi.fn(() => Promise.reject(new Error('locked')));

    await expect(svc.scheduledHomeostasis()).resolves.toBeUndefined();
  });

  it('works with no endocrine system registered at all', async () => {
    const bare = new KeyCortexHomeostasisService(new PrismaStub() as never);
    await expect(bare.regulate('biz_1')).resolves.toBeDefined();
  });
});

describe('reads are bounded', () => {
  it('never runs an unbounded scan — this is a cron across every business', async () => {
    const { svc, prisma } = make();
    prisma.logs = healthyLogs();

    await svc.assess('biz_1');

    for (const call of prisma.client.aiExecutionLog.findMany.mock.calls) {
      const q = call[0] as { take?: number; where?: { createdAt?: unknown } };
      expect(q.take, 'unbounded read').toBeGreaterThan(0);
      expect(q.where?.createdAt, 'no time window').toBeDefined();
    }
  });
});
