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

  it('routes simple greetings as concise + general', async () => {
    const decision = await router.route(query('Hello'));
    expect(decision.taskCategory).toBe('general');
    expect(decision.promptVariant).toBe('concise');
    expect(decision.complexity).toBe('simple');
    expect(decision.layers).toContain('ethics');
    expect(decision.includeGenomeContext).toBe(false);
  });

  it('routes strategy queries as complex + reasoning + deep', async () => {
    const decision = await router.route(
      query('How should we position the product for the next 12 months?'),
    );
    expect(decision.complexity).toBe('complex');
    expect(decision.taskCategory).toBe('reasoning');
    expect(decision.promptVariant).toBe('deep');
    expect(decision.layers).toContain('reasoning');
    expect(decision.layers).toContain('temporal');
    expect(decision.timeHorizon).toBe('strategic');
  });

  it('routes emotional queries with emotion layer', async () => {
    const decision = await router.route(query('I am frustrated with our sales numbers'));
    expect(decision.emotionalWeight).toBe('high');
    expect(decision.layers).toContain('emotion');
    expect(decision.taskCategory).toBe('emotion-analysis');
  });

  it('routes urgent queries with high urgency and emotion layer', async () => {
    const decision = await router.route(query('URGENT: server is down'));
    expect(decision.urgency).toBe('critical');
    expect(decision.layers).toContain('emotion');
  });

  it('routes code queries to code task category', async () => {
    const decision = await router.route(
      query('Write a TypeScript function to calculate LTV'),
    );
    expect(decision.taskCategory).toBe('code');
    expect(decision.domain).toBe('general');
  });

  it('routes forecasting queries to forecasting with temporal layer', async () => {
    const decision = await router.route(
      query('Forecast revenue for next quarter'),
    );
    expect(decision.taskCategory).toBe('forecasting');
    expect(decision.dataRequirement).toBe('predictive');
    expect(decision.layers).toContain('temporal');
  });

  it('routes creative queries to creative with creativity layer', async () => {
    const decision = await router.route(
      query('Brainstorm a marketing campaign for our launch'),
    );
    expect(decision.taskCategory).toBe('creative');
    expect(decision.layers).toContain('creativity');
  });

  it('routes action queries to tool-calling when actions enabled', async () => {
    const decision = await router.route(
      query('Create a task to follow up with the client', { enableActions: true }),
    );
    expect(decision.taskCategory).toBe('tool-calling');
    expect(decision.includeActions).toBe(true);
    expect(decision.layers).toContain('actions');
  });

  it('does not include actions when actions disabled', async () => {
    const decision = await router.route(
      query('Create a task to follow up with the client'),
    );
    expect(decision.taskCategory).not.toBe('tool-calling');
    expect(decision.includeActions).toBe(false);
    expect(decision.layers).not.toContain('actions');
  });

  it('routes finance domain queries correctly', async () => {
    const decision = await router.route(query('What is our profit margin this month?'));
    expect(decision.domain).toBe('finance');
    expect(decision.dataRequirement).toBe('analytical');
    expect(decision.includeGenomeContext).toBe(true);
  });

  it('routes people domain queries correctly', async () => {
    const decision = await router.route(query('How is the team performing?'));
    expect(decision.domain).toBe('people');
  });

  it('returns temperature and max token overrides', async () => {
    const decision = await router.route(query('Summarize the Q3 report'));
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

  describe('module routing', () => {
    it('routes finance/revenue/invoices to commerce', async () => {
      const decision = await router.route(query('What invoices are overdue?'));
      expect(decision.moduleRoute).toBe('commerce');
    });

    it('routes leads/deals/contacts to crm', async () => {
      const decision = await router.route(query('Show me my top deals'));
      expect(decision.moduleRoute).toBe('crm');
    });

    it('routes calendar/bookings/appointments to bookings', async () => {
      const decision = await router.route(query('What appointments do I have today?'));
      expect(decision.moduleRoute).toBe('bookings');
    });

    it('routes content/campaigns/social to content', async () => {
      const decision = await router.route(query('Draft a social media campaign'));
      expect(decision.moduleRoute).toBe('content');
    });

    it('routes email/communications to communications', async () => {
      const decision = await router.route(query('Send an email to the team'));
      expect(decision.moduleRoute).toBe('communications');
    });

    it('routes workflows/automations to flow', async () => {
      const decision = await router.route(query('Run the onboarding workflow'));
      expect(decision.moduleRoute).toBe('flow');
    });

    it('routes tasks/projects to projects', async () => {
      const decision = await router.route(query('List my project tasks'));
      expect(decision.moduleRoute).toBe('projects');
    });

    it('leaves moduleRoute undefined for general queries', async () => {
      const decision = await router.route(query('Hello'));
      expect(decision.moduleRoute).toBeUndefined();
    });

    it('exposes resolveModuleRoute independently', () => {
      expect(
        router.resolveModuleRoute('How much revenue did we make?', {} as any, 'analysis'),
      ).toBe('commerce');
    });
  });

  describe('memory context gating', () => {
    it('enables memory context for analytical finance queries', async () => {
      const decision = await router.route(query('What is our profit margin this month?'));
      expect(decision.includeMemoryContext).toBe(true);
    });

    it('disables memory context for simple greetings', async () => {
      const decision = await router.route(query('Hello'));
      expect(decision.includeMemoryContext).toBe(false);
    });
  });
});
