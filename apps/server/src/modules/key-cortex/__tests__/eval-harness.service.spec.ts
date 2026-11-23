import { describe, it, expect } from 'vitest';
import { EvalHarnessService, runIsGreen, type EvalSuiteResult } from '../eval-harness.service';

const mockAutonomyOrchestrator = {
  evaluateAction: async () => ({
    allowed: true,
    requiresApproval: false,
    tier: 'full',
    reason: 'All gates passed',
    ruleTrace: [{ source: 'test', rule: 'test', result: 'allow' as const }],
    confidence: 1,
    createdAt: new Date(),
  }),
};

const mockConstitutionValues = {
  checkAction: async () => ({
    conflict: true,
    severity: 'supervised' as const,
    reason: 'Possible conflict',
    matchedTerms: ['refund'],
  }),
};

const mockUnifiedMemory = {
  retrieveContext: async () => [
    {
      id: 'm1',
      sourceType: 'ai_memory',
      title: 'Revenue',
      content: 'Q3 revenue was strong',
      timestamp: new Date(),
      confidence: 0.9,
      relevanceScore: 0.8,
      recencyScore: 0.9,
      rankScore: 0.85,
    },
  ],
};

const mockPlanEngine = {
  generatePlan: async () => ({
    goal: { objective: 'test' },
    steps: [{ order: 1, action: 'step1' }],
    confidence: 0.8,
  }),
};

describe('EvalHarnessService', () => {
  it('runs all built-in suites', async () => {
    const harness = new EvalHarnessService(
      mockAutonomyOrchestrator as any,
      mockConstitutionValues as any,
      mockUnifiedMemory as any,
      mockPlanEngine as any,
    );

    const results = await harness.runAll();
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.failed === 0)).toBe(true);
  });

  it('exposes suite names', () => {
    const harness = new EvalHarnessService();
    expect(harness.getSuiteNames()).toContain('autonomy-consistency');
    expect(harness.getSuiteNames()).toContain('memory-retrieval-precision');
  });

  it('fails closed when the services under test are not wired: every assertion is NOT_RUN, nothing is green, and the missing dependency is named', async () => {
    // No dependencies injected: a quality gate must not green-light on the
    // absence of the thing it checks. RR-EVAL-HARNESS-NO-VACUOUS: the status is
    // NOT_RUN, distinct from a real FAIL, so a reader can tell "not measured"
    // from "measured and wrong".
    const harness = new EvalHarnessService();

    const results = await harness.runAll();
    expect(results.length).toBeGreaterThan(0);
    for (const suite of results) {
      expect(suite.green, suite.name).toBe(false);
      expect(suite.notRun, suite.name).toBe(suite.total);
      expect(suite.passed, suite.name).toBe(0);
      for (const a of suite.assertions) {
        expect(a.status, `${suite.name} / ${a.name}`).toBe('NOT_RUN');
        expect(a.passed).toBe(false);
        expect(a.error ?? '').toMatch(/fail-closed: \w+ not wired/);
      }
    }
    expect(await harness.allPass()).toBe(false);
    expect(runIsGreen(results)).toBe(false);
  });
});

/**
 * RR-EVAL-HARNESS-NO-VACUOUS (REC-EVAL-HONEST, non-memory part): the harness
 * cannot pass vacuously. Each assertion carries a status; a suite or a run is
 * green only when it has at least one assertion and every one is PASS.
 */
describe('EvalHarnessService: no vacuous pass (RR-EVAL-HARNESS-NO-VACUOUS)', () => {
  const wired = (overrides: { autonomy?: unknown; planner?: unknown; memory?: unknown } = {}) =>
    new EvalHarnessService(
      (overrides.autonomy ?? mockAutonomyOrchestrator) as any,
      mockConstitutionValues as any,
      (overrides.memory ?? mockUnifiedMemory) as any,
      (overrides.planner ?? mockPlanEngine) as any,
    );

  const assertion = (results: EvalSuiteResult[], suite: string, index = 0) =>
    results.find((r) => r.name === suite)!.assertions[index];

  it('DoD RED: an autonomy verdict with an EMPTY rule trace fails explanation-quality', async () => {
    const autonomy = {
      evaluateAction: async () => ({ ...(await mockAutonomyOrchestrator.evaluateAction()), ruleTrace: [] }),
    };
    const result = await wired({ autonomy }).runSuite('explanation-quality');
    expect(result.green).toBe(false);
    expect(result.assertions[0]).toMatchObject({ status: 'FAIL', passed: false });
  });

  it('a rule trace whose entries name no source or result also fails; a proper trace passes', async () => {
    const shapeless = {
      evaluateAction: async () => ({ ...(await mockAutonomyOrchestrator.evaluateAction()), ruleTrace: [{ note: 'x' }] }),
    };
    expect((await wired({ autonomy: shapeless }).runSuite('explanation-quality')).assertions[0].status).toBe('FAIL');
    expect((await wired().runSuite('explanation-quality')).assertions[0].status).toBe('PASS');
  });

  it('DoD RED: a planner that answers "send invoice to customer" with one unrelated step fails planning-correctness', async () => {
    const planner = {
      generatePlan: async () => ({ goal: { objective: 'send invoice to customer' }, steps: [{ order: 1, action: 'analyze_request', module: 'ai' }], confidence: 0.9 }),
    };
    const result = await wired({ planner }).runSuite('planning-correctness');
    expect(result.green).toBe(false);
    expect(result.assertions[0]).toMatchObject({ status: 'FAIL', passed: false });
  });

  it('a plan with an invoice-send step passes planning-correctness, in the fallback and the canonical tool-name spellings', async () => {
    for (const steps of [
      [{ order: 1, action: 'list_contacts', module: 'crm' }, { order: 2, action: 'create_invoice', module: 'commerce' }, { order: 3, action: 'send_invoice', module: 'commerce' }],
      [{ order: 1, action: 'commerce.send_invoice' }],
      [{ order: 1, action: 'invoice.email', module: 'commerce' }],
    ]) {
      const planner = { generatePlan: async () => ({ goal: { objective: 'send invoice to customer' }, steps, confidence: 0.9 }) };
      expect((await wired({ planner }).runSuite('planning-correctness')).assertions[0].status, JSON.stringify(steps)).toBe('PASS');
    }
    // create_invoice alone is not a send; an empty plan is not either.
    for (const steps of [[{ order: 1, action: 'create_invoice', module: 'commerce' }], []]) {
      const planner = { generatePlan: async () => ({ goal: { objective: 'send invoice to customer' }, steps, confidence: 0.9 }) };
      expect((await wired({ planner }).runSuite('planning-correctness')).assertions[0].status, JSON.stringify(steps)).toBe('FAIL');
    }
  });

  it('DoD RED: with no autonomy orchestrator wired the explanation assertion is NOT_RUN (not a plain failure), and names the dependency', async () => {
    const harness = new EvalHarnessService(undefined, mockConstitutionValues as any, mockUnifiedMemory as any, mockPlanEngine as any);
    const results = await harness.runAll();
    expect(assertion(results, 'explanation-quality')).toMatchObject({ status: 'NOT_RUN', passed: false });
    expect(assertion(results, 'explanation-quality').error).toContain('AutonomyOrchestratorService not wired');
    expect(assertion(results, 'autonomy-consistency').status).toBe('NOT_RUN');
    // The wired suites still measure: value-alignment and planning pass, memory is INDETERMINATE by design.
    expect(assertion(results, 'value-alignment').status).toBe('PASS');
    expect(assertion(results, 'planning-correctness').status).toBe('PASS');
    expect(results.find((r) => r.name === 'autonomy-consistency')!.notRun).toBe(2);
    expect(runIsGreen(results)).toBe(false);
  });

  it('memory-retrieval-precision is INDETERMINATE when wired (shape only; precision is MEM-EVAL-SUITE\'s), and NOT_RUN when not', async () => {
    const when = await wired().runSuite('memory-retrieval-precision');
    expect(when.assertions[0].status).toBe('INDETERMINATE');
    expect(when.assertions[0].passed).toBe(false);
    expect(when.assertions[0].error ?? '').toMatch(/MEM-EVAL-SUITE/);
    expect(when.indeterminate).toBe(1);
    expect(when.green).toBe(false);
    const without = new EvalHarnessService(mockAutonomyOrchestrator as any, mockConstitutionValues as any, undefined, mockPlanEngine as any);
    expect((await without.runSuite('memory-retrieval-precision')).assertions[0].status).toBe('NOT_RUN');
  });

  it('a harness-side throw is ERROR, distinct from FAIL and NOT_RUN, and the suite is not green', async () => {
    const harness = wired();
    harness.registerSuite({
      name: 'throws',
      description: 'an assertion whose run() throws an ordinary error',
      assertions: [{ name: 'boom', run: () => { throw new Error('boom'); }, check: () => true }],
    });
    const result = await harness.runSuite('throws');
    expect(result.assertions[0]).toMatchObject({ status: 'ERROR', passed: false, error: 'boom' });
    expect(result.errors).toBe(1);
    expect(result.green).toBe(false);
  });

  it('DoD RED: a registered suite with zero assertions is not green, and a run that contains it is not green either', async () => {
    const harness = wired();
    harness.registerSuite({ name: 'empty', description: 'no assertions', assertions: [] });
    const empty = await harness.runSuite('empty');
    expect(empty.total).toBe(0);
    expect(empty.failed).toBe(0);
    expect(empty.green).toBe(false);
    expect(await harness.allPass()).toBe(false);
    expect(runIsGreen([empty])).toBe(false);
    expect(runIsGreen([])).toBe(false);
  });

  it('runIsGreen: true only when every suite has at least one assertion and every assertion is PASS', () => {
    const suite = (over: Partial<EvalSuiteResult>): EvalSuiteResult => ({
      name: 's', description: '', passed: 1, failed: 0, notRun: 0, indeterminate: 0, errors: 0, total: 1, green: true, durationMs: 0,
      assertions: [{ name: 'a', status: 'PASS', passed: true, durationMs: 0 }],
      ...over,
    });
    expect(runIsGreen([suite({})])).toBe(true);
    expect(runIsGreen([suite({}), suite({ green: false, notRun: 1, passed: 0, assertions: [{ name: 'a', status: 'NOT_RUN', passed: false, durationMs: 0 }] })])).toBe(false);
    // green is derived from the assertions, not trusted from the flag: a suite flagged green with a non-PASS assertion is not green.
    expect(runIsGreen([suite({ assertions: [{ name: 'a', status: 'INDETERMINATE', passed: false, durationMs: 0 }] })])).toBe(false);
    expect(runIsGreen([suite({ total: 0, passed: 0, assertions: [] })])).toBe(false);
  });

  it('the suite counts add up and the per-assertion statuses are the five named ones', async () => {
    const results = await wired().runAll();
    for (const r of results) {
      expect(r.passed + r.failed + r.notRun + r.indeterminate + r.errors).toBe(r.total);
      for (const a of r.assertions) expect(['PASS', 'FAIL', 'NOT_RUN', 'INDETERMINATE', 'ERROR']).toContain(a.status);
    }
    // With every stub wired, every suite but memory-retrieval-precision is green.
    expect(results.filter((r) => r.green).map((r) => r.name).sort()).toEqual(['autonomy-consistency', 'explanation-quality', 'planning-correctness', 'value-alignment']);
    expect(await wired().allPass()).toBe(false); // the INDETERMINATE memory suite keeps the whole run from being green
  });
});
