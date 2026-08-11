import { describe, it, expect, beforeEach } from 'vitest';
import { CapabilityModelService } from './capability-map.service';

describe('CapabilityModelService', () => {
  let service: CapabilityModelService;

  beforeEach(() => {
    service = new CapabilityModelService();
  });

  it('loads a non-empty, well-formed capability model', () => {
    const model = service.getModel();
    expect(model.domains.length).toBeGreaterThan(0);
    expect(model.summary.flowTools).toBeGreaterThan(0);
    expect(model.summary.cortexCapabilities).toBeGreaterThan(0);
  });

  it('reports 100% declared coverage and a lower active coverage', () => {
    const s = service.getSummary();
    expect(s.declaredCoveragePct).toBe(100);
    expect(s.activeCoveragePct).toBeGreaterThan(0);
    expect(s.activeCoveragePct).toBeLessThanOrEqual(100);
    expect(s.targetsActive + s.targetsPlanned).toBe(s.targetsTotal);
  });

  it('every planned capability carries a full build spec', () => {
    const planned = service.listPlanned();
    expect(planned.length).toBe(service.getSummary().targetsPlanned);
    for (const p of planned) {
      expect(p.status).toBe('planned');
      expect(p.riskTier).toBeGreaterThanOrEqual(1);
      expect(p.riskTier).toBeLessThanOrEqual(4);
      expect(p.uiSurface).toBeTruthy();
      expect(p.evaluator).toBeTruthy();
      expect(Array.isArray(p.requiredTools)).toBe(true);
    }
  });

  it('per-domain active + planned always equals total', () => {
    for (const d of service.getModel().domains) {
      expect(d.targetsActive + d.targetsPlanned).toBe(d.targetsTotal);
      expect(d.targets.length).toBe(d.targetsTotal);
    }
  });

  it('never allows autonomy for human-gated capabilities', () => {
    expect(service.isAutonomyAllowed('agentic')).toBe(true);
    expect(service.isAutonomyAllowed('assisted')).toBe(false);
    expect(service.isAutonomyAllowed('assisted_approval')).toBe(false);
    expect(service.isAutonomyAllowed('human_gated')).toBe(false);
  });

  it('resolves coverage for a domain-relevant goal and surfaces planned blockers', () => {
    const res = service.getCoverage('score and enrich new sales leads for the CRM pipeline');
    expect(res.method).toBe('keyword-overlap-v0');
    expect(res.matchCount).toBeGreaterThan(0);
    expect(res.domainsTouched.length).toBeGreaterThan(0);
    // the sales domain has planned lead-scoring/enrichment capabilities
    const labels = res.relevantPlanned.map((p) => p.capability.toLowerCase()).join(' ');
    expect(labels.length).toBeGreaterThan(0);
  });

  it('returns an empty-but-valid result for a goal that matches nothing', () => {
    const res = service.getCoverage('zzzz qqqq xxxx');
    expect(res.matchCount).toBe(0);
    expect(res.matched).toEqual([]);
    expect(res.domainsTouched).toEqual([]);
  });

  it('getDomain returns a known domain and undefined for an unknown id', () => {
    expect(service.getDomain('sales_crm')).toBeDefined();
    expect(service.getDomain('does_not_exist')).toBeUndefined();
  });
});
