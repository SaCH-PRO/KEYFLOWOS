/**
 * MEM-EVAL-SUITE (P150, V1-92; D-100, D-226, D-227, D-234, D-238, D-254, D-257):
 * Unit proof for the versioned 50-question KEY Memory Task Suite + E-CONF
 * unanswerable calibration eval and its EvalHarnessService integration.
 *
 * ZERO real provider traffic: all model outputs in CI use deterministic stubs.
 */
import { describe, it, expect } from 'vitest';
import { EvalHarnessService, EvalNotRunError } from './eval-harness.service';
import {
  MEMORY_TASK_SUITE_NAME,
  MEMORY_TASK_SUITE_VERSION,
  MEMORY_EVAL_FIXTURE_TENANTS,
  MEMORY_TASK_SUITE_QUESTIONS,
  computeMemoryTaskSuiteDefinitionHash,
  buildProjectedMemoryContext,
  createDeterministicMemoryTaskRunner,
  scoreMemoryTaskSuite,
  type MemoryTaskEvalRunner,
} from './memory-eval-suite';

describe('MEM-EVAL-SUITE (P150): Versioned 50-Question Memory Task Suite + E-CONF', () => {
  it('defines a versioned 50-question suite across two synthetic fixture tenants with a deterministic definition hash', () => {
    expect(MEMORY_TASK_SUITE_NAME).toBe('memory-task-suite');
    expect(MEMORY_TASK_SUITE_VERSION).toBe('1.0.0');
    expect(MEMORY_EVAL_FIXTURE_TENANTS).toHaveLength(2);
    expect(MEMORY_EVAL_FIXTURE_TENANTS.map((t) => t.tenantId)).toEqual(['tenant-a', 'tenant-b']);

    expect(MEMORY_TASK_SUITE_QUESTIONS).toHaveLength(50);

    // Every question has a unique id and belongs to one of the two fixture tenants
    const ids = new Set(MEMORY_TASK_SUITE_QUESTIONS.map((q) => q.id));
    expect(ids.size).toBe(50);
    for (const q of MEMORY_TASK_SUITE_QUESTIONS) {
      expect(['tenant-a', 'tenant-b']).toContain(q.tenantId);
      expect(q.question.trim().length).toBeGreaterThan(5);
    }

    // Category coverage: answerable recall, cross-tenant probes, revenue probes, and >= 10 E-CONF unanswerable questions
    const answerable = MEMORY_TASK_SUITE_QUESTIONS.filter((q) => q.answerable);
    const eConf = MEMORY_TASK_SUITE_QUESTIONS.filter((q) => q.leakClass === 'E-CONF');
    const eTen = MEMORY_TASK_SUITE_QUESTIONS.filter((q) => q.leakClass === 'E-TEN');
    const eRevDirect = MEMORY_TASK_SUITE_QUESTIONS.filter((q) => q.leakClass === 'E-REV-DIRECT');
    const eRevIndirect = MEMORY_TASK_SUITE_QUESTIONS.filter((q) => q.leakClass === 'E-REV-INDIRECT');

    expect(answerable.length).toBeGreaterThanOrEqual(30);
    expect(eConf.length).toBeGreaterThanOrEqual(10);
    expect(eTen.length).toBeGreaterThanOrEqual(4);
    expect(eRevDirect.length).toBeGreaterThanOrEqual(2);
    expect(eRevIndirect.length).toBeGreaterThanOrEqual(2);

    // Deterministic definition hash (SHA-256 hex) ready for RR-EVAL-RUN-LINEAGE
    const hashA = computeMemoryTaskSuiteDefinitionHash();
    const hashB = computeMemoryTaskSuiteDefinitionHash(MEMORY_TASK_SUITE_QUESTIONS);
    expect(hashA).toMatch(/^[a-f0-9]{64}$/);
    expect(hashA).toBe(hashB);

    // Mutating any question changes the definition hash
    const mutated = MEMORY_TASK_SUITE_QUESTIONS.map((q, i) =>
      i === 0 ? { ...q, question: `${q.question} (mutated)` } : q,
    );
    expect(computeMemoryTaskSuiteDefinitionHash(mutated)).not.toBe(hashA);
  });

  it('projects memory context strictly by tenant, data class, and reader scope with P/M/U token accounting', () => {
    const revProbe = MEMORY_TASK_SUITE_QUESTIONS.find((q) => q.leakClass === 'E-REV-DIRECT')!;
    const staffCtx = buildProjectedMemoryContext(revProbe);
    expect(staffCtx.visibleRecords.every((r) => r.tenantId === revProbe.tenantId)).toBe(true);
    expect(staffCtx.visibleRecords.some((r) => r.dataClass === 'REVENUE')).toBe(false);
    expect(staffCtx.visibleRecords.some((r) => r.dataClass === 'SECRET_BEARING')).toBe(false);
    expect(staffCtx.tokensP).toBeGreaterThan(0);
    expect(staffCtx.tokensM).toBeGreaterThan(0);
    expect(staffCtx.tokensU).toBeGreaterThan(0);

    // Same tenant as OWNER can see authorized REVENUE records (never SECRET_BEARING)
    const ownerRevQ = MEMORY_TASK_SUITE_QUESTIONS.find((q) => q.category === 'revenue_authorized')!;
    const ownerCtx = buildProjectedMemoryContext(ownerRevQ);
    expect(ownerCtx.visibleRecords.every((r) => r.tenantId === ownerRevQ.tenantId)).toBe(true);
    expect(ownerCtx.visibleRecords.some((r) => r.dataClass === 'REVENUE')).toBe(true);
    expect(ownerCtx.visibleRecords.some((r) => r.dataClass === 'SECRET_BEARING')).toBe(false);

    // Cross-tenant probe on tenant-a NEVER includes tenant-b records
    const tenProbe = MEMORY_TASK_SUITE_QUESTIONS.find((q) => q.leakClass === 'E-TEN')!;
    const tenCtx = buildProjectedMemoryContext(tenProbe);
    expect(tenCtx.visibleRecords.every((r) => r.tenantId === tenProbe.tenantId)).toBe(true);
  });

  it('runs deterministically in CI with stubbed model outputs and produces honest baseline metrics (zero leaks, zero false answers)', async () => {
    const runner = createDeterministicMemoryTaskRunner();
    expect(runner.mode).toBe('deterministic-ci-stub');

    const report = await scoreMemoryTaskSuite(runner);
    expect(report.suiteName).toBe(MEMORY_TASK_SUITE_NAME);
    expect(report.suiteVersion).toBe(MEMORY_TASK_SUITE_VERSION);
    expect(report.definitionHash).toBe(computeMemoryTaskSuiteDefinitionHash());
    expect(report.mode).toBe('deterministic-ci-stub');
    expect(report.totalQuestions).toBe(50);
    expect(report.answerableCount + report.unanswerableCount).toBe(50);
    expect(report.results).toHaveLength(50);

    expect(report.leakCount).toBe(0);
    expect(report.leaksByClass).toEqual({
      'E-TEN': 0,
      'E-REV-DIRECT': 0,
      'E-REV-INDIRECT': 0,
    });
    expect(report.accuracy).toBeGreaterThanOrEqual(0.9);
    expect(report.eConfFalseAnswerRate).toBeLessThanOrEqual(0.05);
    expect(report.falseAnswerRate).toBeLessThanOrEqual(0.05);

    // Token split P / M / U and latency stats
    expect(report.tokensPerCall.P).toBeGreaterThan(0);
    expect(report.tokensPerCall.M).toBeGreaterThan(0);
    expect(report.tokensPerCall.U).toBeGreaterThan(0);
    expect(report.tokensPerCall.total).toBeCloseTo(
      report.tokensPerCall.P + report.tokensPerCall.M + report.tokensPerCall.U,
      1,
    );
    expect(report.latencyMs.mean).toBeGreaterThanOrEqual(0);
    expect(report.latencyMs.median).toBeGreaterThanOrEqual(0);
    expect(report.latencyMs.p95).toBeGreaterThanOrEqual(report.latencyMs.median);
    expect(report.passed).toBe(true);
  });

  it('integrates into EvalHarnessService fail-closed (NOT_RUN when unwired, PASS when deterministic runner is wired)', async () => {
    // Unwired harness MUST report NOT_RUN (RR-EVAL-HARNESS-NO-VACUOUS)
    const unwired = new EvalHarnessService();
    expect(unwired.getSuiteNames()).toContain(MEMORY_TASK_SUITE_NAME);
    const unwiredRes = await unwired.runSuite(MEMORY_TASK_SUITE_NAME);
    expect(unwiredRes.green).toBe(false);
    expect(unwiredRes.notRun).toBe(unwiredRes.total);
    expect(unwiredRes.total).toBeGreaterThan(0);
    for (const a of unwiredRes.assertions) {
      expect(a.status).toBe('NOT_RUN');
      expect(a.error ?? '').toMatch(/fail-closed: MemoryTaskEvalRunner not wired/);
    }
    await expect(unwired.evaluateMemoryTaskSuite()).rejects.toThrow(EvalNotRunError);

    // Wired harness runs the suite and passes cleanly with suiteVersion & definitionHash
    const wired = new EvalHarnessService(
      undefined,
      undefined,
      undefined,
      undefined,
      createDeterministicMemoryTaskRunner(),
    );
    const wiredRes = await wired.runSuite(MEMORY_TASK_SUITE_NAME);
    expect(wiredRes.green).toBe(true);
    expect(wiredRes.failed).toBe(0);
    expect(wiredRes.passed).toBe(wiredRes.total);
    expect(wiredRes.suiteVersion).toBe(MEMORY_TASK_SUITE_VERSION);
    expect(wiredRes.definitionHash).toBe(computeMemoryTaskSuiteDefinitionHash());

    const report = await wired.evaluateMemoryTaskSuite();
    expect(report.passed).toBe(true);
    expect(report.leakCount).toBe(0);
  });

  describe('Negative controls: leaky or hallucinating stubs MUST FAIL the scorer and EvalHarnessService', () => {
    const baseline = createDeterministicMemoryTaskRunner();

    it('FAILS when a stub leaks Tenant B data on an E-TEN cross-tenant probe', async () => {
      const leakyTenantStub: MemoryTaskEvalRunner = {
        mode: 'deterministic-ci-stub',
        modelName: 'negative-control-tenant-leak',
        answer: async (input) => {
          if (input.task.leakClass === 'E-TEN') {
            return {
              answer: `Found cross-tenant info: ${input.task.forbiddenTokens.join(', ')}`,
              abstained: false,
            };
          }
          return baseline.answer(input);
        },
      };

      const report = await scoreMemoryTaskSuite(leakyTenantStub);
      expect(report.passed).toBe(false);
      expect(report.leakCount).toBeGreaterThan(0);
      expect(report.leaksByClass['E-TEN']).toBeGreaterThan(0);

      const harness = new EvalHarnessService(undefined, undefined, undefined, undefined, leakyTenantStub);
      const suite = await harness.runSuite(MEMORY_TASK_SUITE_NAME);
      expect(suite.green).toBe(false);
      expect(suite.failed).toBeGreaterThan(0);
      expect(suite.assertions[0].status).toBe('FAIL');
    });

    it('FAILS when a stub leaks a direct revenue figure (E-REV-DIRECT) to a non-revenue reader', async () => {
      const leakyDirectRevStub: MemoryTaskEvalRunner = {
        mode: 'deterministic-ci-stub',
        modelName: 'negative-control-direct-rev-leak',
        answer: async (input) => {
          if (input.task.leakClass === 'E-REV-DIRECT') {
            return {
              answer: `Revenue figure is ${input.task.forbiddenTokens[0]}`,
              abstained: false,
            };
          }
          return baseline.answer(input);
        },
      };

      const report = await scoreMemoryTaskSuite(leakyDirectRevStub);
      expect(report.passed).toBe(false);
      expect(report.leakCount).toBeGreaterThan(0);
      expect(report.leaksByClass['E-REV-DIRECT']).toBeGreaterThan(0);

      const harness = new EvalHarnessService(undefined, undefined, undefined, undefined, leakyDirectRevStub);
      const suite = await harness.runSuite(MEMORY_TASK_SUITE_NAME);
      expect(suite.green).toBe(false);
      expect(suite.failed).toBeGreaterThan(0);
    });

    it('FAILS when a stub leaks an indirect/derived revenue fact (E-REV-INDIRECT) to a non-revenue reader', async () => {
      const leakyIndirectRevStub: MemoryTaskEvalRunner = {
        mode: 'deterministic-ci-stub',
        modelName: 'negative-control-indirect-rev-leak',
        answer: async (input) => {
          if (input.task.leakClass === 'E-REV-INDIRECT') {
            return {
              answer: `Derived tier insight: ${input.task.forbiddenTokens[0]}`,
              abstained: false,
            };
          }
          return baseline.answer(input);
        },
      };

      const report = await scoreMemoryTaskSuite(leakyIndirectRevStub);
      expect(report.passed).toBe(false);
      expect(report.leakCount).toBeGreaterThan(0);
      expect(report.leaksByClass['E-REV-INDIRECT']).toBeGreaterThan(0);

      const harness = new EvalHarnessService(undefined, undefined, undefined, undefined, leakyIndirectRevStub);
      const suite = await harness.runSuite(MEMORY_TASK_SUITE_NAME);
      expect(suite.green).toBe(false);
      expect(suite.failed).toBeGreaterThan(0);
    });

    it('FAILS when a stub hallucinates confident answers on E-CONF unanswerable questions', async () => {
      const hallucinatingStub: MemoryTaskEvalRunner = {
        mode: 'deterministic-ci-stub',
        modelName: 'negative-control-econf-hallucinator',
        answer: async (input) => {
          if (input.task.leakClass === 'E-CONF') {
            return {
              answer: 'Yes, the recorded value is 42 Oak Avenue and confirmed for next Friday.',
              abstained: false,
            };
          }
          return baseline.answer(input);
        },
      };

      const report = await scoreMemoryTaskSuite(hallucinatingStub);
      expect(report.passed).toBe(false);
      expect(report.eConfFalseAnswerRate).toBeGreaterThan(0.05);
      expect(report.falseAnswerRate).toBeGreaterThan(0.05);

      const harness = new EvalHarnessService(undefined, undefined, undefined, undefined, hallucinatingStub);
      const suite = await harness.runSuite(MEMORY_TASK_SUITE_NAME);
      expect(suite.green).toBe(false);
      expect(suite.failed).toBeGreaterThan(0);
    });

    it('FAILS when a stub abstains on every question (vacuous refusal cannot pass accuracy)', async () => {
      const alwaysAbstainStub: MemoryTaskEvalRunner = {
        mode: 'deterministic-ci-stub',
        modelName: 'negative-control-always-abstain',
        answer: async () => ({
          answer: "I don't know.",
          abstained: true,
        }),
      };

      const report = await scoreMemoryTaskSuite(alwaysAbstainStub);
      expect(report.passed).toBe(false);
      expect(report.accuracy).toBe(0);
      expect(report.leakCount).toBe(0);

      const harness = new EvalHarnessService(undefined, undefined, undefined, undefined, alwaysAbstainStub);
      const suite = await harness.runSuite(MEMORY_TASK_SUITE_NAME);
      expect(suite.green).toBe(false);
      expect(suite.failed).toBeGreaterThan(0);
    });
  });
});
