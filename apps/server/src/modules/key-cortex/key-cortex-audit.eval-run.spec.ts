import { describe, it, expect, vi } from 'vitest';
import { KeyCortexAuditController } from './key-cortex-audit.controller';
import type { EvalSuiteResult } from './eval-harness.service';

/**
 * RR-EVAL-HARNESS-NO-VACUOUS: POST eval/run answers allPass from the assertions
 * of the suites it returns, so a NOT_RUN, INDETERMINATE or ERROR assertion, or
 * an empty suite, is never reported green. (The route's other behaviour and
 * its tenant binding are covered by key-cortex-audit.controller.spec.ts and
 * test/cortex-audit-tenant.integration.test.ts; this file pins only allPass.)
 */
const suite = (over: Partial<EvalSuiteResult>): EvalSuiteResult => ({
  name: 's', description: '', passed: 1, failed: 0, notRun: 0, indeterminate: 0, errors: 0, total: 1, green: true, durationMs: 0,
  assertions: [{ name: 'a', status: 'PASS', passed: true, durationMs: 0 }],
  ...over,
});

function controllerWith(results: EvalSuiteResult[]) {
  const evalHarness = { getSuiteNames: vi.fn().mockReturnValue(['s']), runAll: vi.fn().mockResolvedValue(results), runSuite: vi.fn().mockResolvedValue(results[0]) };
  // Only the eval harness is read by runEval; every other dependency is an inert stub.
  const inert = new Proxy({}, { get: () => vi.fn() });
  const args = KeyCortexAuditController.length;
  const deps: unknown[] = Array.from({ length: args }, () => inert);
  const index = controllerDependencyIndex();
  deps[index] = evalHarness;
  return { controller: new (KeyCortexAuditController as unknown as new (...a: unknown[]) => KeyCortexAuditController)(...deps), evalHarness };
}

/** The constructor position of evalHarness, read from the source so a reordering of the constructor is caught here. */
function controllerDependencyIndex(): number {
  const source = String(KeyCortexAuditController);
  const params = source.slice(source.indexOf('constructor(') + 'constructor('.length, source.indexOf(') {', source.indexOf('constructor('))).split(',');
  const at = params.findIndex((p) => p.trim().startsWith('evalHarness'));
  if (at < 0) throw new Error('evalHarness is no longer a constructor parameter of KeyCortexAuditController');
  return at;
}

describe('POST cortex/eval/run: allPass is derived from the assertions (RR-EVAL-HARNESS-NO-VACUOUS)', () => {
  it('a NOT_RUN assertion with failed 0 is not green', async () => {
    const notRun = suite({ green: false, passed: 0, notRun: 1, assertions: [{ name: 'a', status: 'NOT_RUN', passed: false, error: 'fail-closed: X not wired', durationMs: 0 }] });
    const { controller } = controllerWith([notRun]);
    const out = await controller.runEval({});
    expect(out).toMatchObject({ scope: 'synthetic', allPass: false });
    expect(out.results).toEqual([notRun]);
  });

  it('an empty suite is not green; an all-PASS run is', async () => {
    expect((await controllerWith([suite({ total: 0, passed: 0, green: false, assertions: [] })]).controller.runEval({})).allPass).toBe(false);
    expect((await controllerWith([suite({})]).controller.runEval({})).allPass).toBe(true);
    expect((await controllerWith([suite({}), suite({ assertions: [{ name: 'b', status: 'INDETERMINATE', passed: false, durationMs: 0 }] })]).controller.runEval({})).allPass).toBe(false);
  });

  it('with a suite named, allPass is over that one suite only (the response says so by returning one result)', async () => {
    const { controller, evalHarness } = controllerWith([suite({})]);
    const out = await controller.runEval({ suite: 's' });
    expect(evalHarness.runSuite).toHaveBeenCalledWith('s');
    expect(out.results).toHaveLength(1);
    expect(out.allPass).toBe(true);
  });
});
