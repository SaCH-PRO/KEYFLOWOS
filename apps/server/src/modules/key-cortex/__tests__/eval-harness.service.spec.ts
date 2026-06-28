import { describe, it, expect } from 'vitest';
import { EvalHarnessService } from '../eval-harness.service';

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
});
