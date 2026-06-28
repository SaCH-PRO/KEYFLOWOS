import { describe, it, expect, beforeEach } from 'vitest';
import {
  AdaptiveRouterService,
  RouteDecision,
} from '../adaptive-router.service';
import { CortexQuery } from '../key-cortex.types';

describe('AdaptiveRouterService', () => {
  let router: AdaptiveRouterService;

  beforeEach(() => {
    router = new AdaptiveRouterService();
  });

  const query = (text: string, overrides?: Partial<CortexQuery>): CortexQuery => ({
    text,
    businessId: 'biz_1',
    userId: 'user_1',
    enableActions: false,
    ...overrides,
  });

  it('routes simple greetings as concise + general', () => {
    const decision = router.route(query('Hello'));
    expect(decision.taskCategory).toBe('general');
    expect(decision.promptVariant).toBe('concise');
    expect(decision.complexity).toBe('simple');
    expect(decision.layers).toContain('ethics');
    expect(decision.includeGenomeContext).toBe(false);
  });

  it('routes strategy queries as complex + reasoning + deep', () => {
    const decision = router.route(
      query('How should we position the product for the next 12 months?'),
    );
    expect(decision.complexity).toBe('complex');
    expect(decision.taskCategory).toBe('reasoning');
    expect(decision.promptVariant).toBe('deep');
    expect(decision.layers).toContain('reasoning');
    expect(decision.layers).toContain('temporal');
    expect(decision.timeHorizon).toBe('strategic');
  });

  it('routes emotional queries with emotion layer', () => {
    const decision = router.route(query('I am frustrated with our sales numbers'));
    expect(decision.emotionalWeight).toBe('high');
    expect(decision.layers).toContain('emotion');
    expect(decision.taskCategory).toBe('emotion-analysis');
  });

  it('routes urgent queries with high urgency and emotion layer', () => {
    const decision = router.route(query('URGENT: server is down'));
    expect(decision.urgency).toBe('critical');
    expect(decision.layers).toContain('emotion');
  });

  it('routes code queries to code task category', () => {
    const decision = router.route(
      query('Write a TypeScript function to calculate LTV'),
    );
    expect(decision.taskCategory).toBe('code');
    expect(decision.domain).toBe('general');
  });

  it('routes forecasting queries to forecasting with temporal layer', () => {
    const decision = router.route(
      query('Forecast revenue for next quarter'),
    );
    expect(decision.taskCategory).toBe('forecasting');
    expect(decision.dataRequirement).toBe('predictive');
    expect(decision.layers).toContain('temporal');
  });

  it('routes creative queries to creative with creativity layer', () => {
    const decision = router.route(
      query('Brainstorm a marketing campaign for our launch'),
    );
    expect(decision.taskCategory).toBe('creative');
    expect(decision.layers).toContain('creativity');
  });

  it('routes action queries to tool-calling when actions enabled', () => {
    const decision = router.route(
      query('Create a task to follow up with the client', { enableActions: true }),
    );
    expect(decision.taskCategory).toBe('tool-calling');
    expect(decision.includeActions).toBe(true);
    expect(decision.layers).toContain('actions');
  });

  it('does not include actions when actions disabled', () => {
    const decision = router.route(
      query('Create a task to follow up with the client'),
    );
    expect(decision.taskCategory).not.toBe('tool-calling');
    expect(decision.includeActions).toBe(false);
    expect(decision.layers).not.toContain('actions');
  });

  it('routes finance domain queries correctly', () => {
    const decision = router.route(query('What is our profit margin this month?'));
    expect(decision.domain).toBe('finance');
    expect(decision.dataRequirement).toBe('analytical');
    expect(decision.includeGenomeContext).toBe(true);
  });

  it('routes people domain queries correctly', () => {
    const decision = router.route(query('How is the team performing?'));
    expect(decision.domain).toBe('people');
  });

  it('returns temperature and max token overrides', () => {
    const decision = router.route(query('Summarize the Q3 report'));
    expect(decision.temperatureOverride).toBeDefined();
    expect(decision.maxTokensOverride).toBeDefined();
    expect(decision.maxTokensOverride).toBeGreaterThan(0);
  });

  it('classifies dimensions independently', () => {
    const dims = router.classifyDimensions(
      undefined,
      query('I need a detailed risk analysis before tomorrow'),
    );
    expect(dims.complexity).toBe('complex');
    expect(dims.urgency).toBe('low');
    expect(dims.emotionalWeight).toBe('low');
    expect(dims.timeHorizon).toBe('tactical');
  });
});
