/**
 * P82 — FU-KEY-GENOME-READS-RESIDUAL-2 (owner rulings D-100, D-128, D-233, D-234, D-235):
 * Residual live HTTP-reachable genome & V2 context read paths uncovered by the D-235 audit on main:
 *   1. FlowOrchestratorService.buildBlueprintSection (chat() & streamChat()) — injects blueprint
 *      financial fields (revenueModel, budgetRange, avgTicket, runwayMonths, riskScore, completeness)
 *      and all top 30 Business Genome facts (incl. FINANCIAL/TAX/PROJECTIONS/SALES) without checking
 *      whether the turn's reader holds revenue:read.
 *   2. KeyGenomeAdapterService organ tools (key_genome.get_blueprint, calculate_integrity,
 *      list_facts, get_readiness) — run under settings:read without projecting out financial
 *      sections, DNA scores, facts, or module readiness when !readerReadsRevenue(ctx).
 *   3. KeyCortexQueryPipelineService (processQuery & streamQuery when integrationV2Enabled) and
 *      KeyCortexController (POST /cortex/execute & POST /cortex/batch NL mode) — pass unprojected
 *      contextV2Service.getFullContext() (commerce totalRevenue/outstandingRevenue + genome stage/
 *      dnaScores/recommendations) into buildV2SystemPrompt/buildV3SystemPrompt and command.parseIntent.
 */
import { describe, it, expect, vi } from 'vitest';
import { FlowOrchestratorService } from '../../ai/flow-orchestrator.service';
import { KeyGenomeAdapterService } from '../organs/key-genome-adapter.service';
import { KeyCortexQueryPipelineService } from '../key-cortex-query-pipeline.service';
import { KeyCortexSystemPromptService } from '../key-cortex-system-prompt.service';
import { KeyCortexController } from '../key-cortex.controller';

function makePrismaForRole(role: 'OWNER' | 'STAFF' | 'ADMIN', permissionScopes: Record<string, string> | null = null) {
  return {
    client: {
      user: {
        findUnique: vi.fn(async () => ({ id: 'u1', role: 'USER' })),
      },
      membership: {
        findUnique: vi.fn(async () => ({ role, permissionScopes })),
      },
    },
  };
}

const SAMPLE_BLUEPRINT_CTX = {
  completeness: 84,
  summary: 'Trinidad wellness studio',
  identity: { archetype: 'SERVICE_STUDIO', industry: 'Wellness' },
  operatingModel: { revenueModel: 'Retainer + high-margin packages', deliveryMode: 'In-person' },
  goals: { northStar: 'Serve 200 clients cleanly', ninetyDayGoals: ['Standardize booking flow'] },
  constraints: { budgetRange: 'TTD 45000/mo', timeCommitment: 'Full-time' },
  brand: { voice: 'Warm and crisp' },
  customerModel: { idealCustomer: 'Busy professionals' },
  financials: { avgTicket: 'TTD 850' },
  legalProfile: { recommendedEntityType: 'LLC' },
  registrationProfile: { missingRegistrationSteps: ['VAT filing'] },
  projectionProfile: { runwayMonths: 2.5 },
  riskProfile: { riskScore: 72 },
  executionRoadmap: { today: ['Confirm Friday bookings'] },
  complianceProfile: { complianceScore: 80 },
};

const SAMPLE_FACTS = [
  {
    id: 'f_fin',
    section: 'FINANCIAL',
    domain: 'financials',
    field: 'monthlyRevenue',
    value: { raw: 'TTD 125000 monthly gross revenue' },
    verificationStatus: 'USER_VERIFIED',
  },
  {
    id: 'f_tax',
    section: 'TAX',
    domain: 'taxProfile',
    field: 'estimatedAnnualRevenue',
    value: { raw: 'TTD 1500000 annual revenue' },
    verificationStatus: 'USER_VERIFIED',
  },
  {
    id: 'f_ops_money_text',
    section: 'OPERATIONS',
    domain: 'operations',
    field: 'note',
    value: { raw: 'Raise invoice pricing to $450 per session to fix cash runway' },
    verificationStatus: 'UNVERIFIED',
  },
  {
    id: 'f_ops_clean',
    section: 'OPERATIONS_DELIVERY',
    domain: 'operations',
    field: 'openingTime',
    value: { raw: 'Opens 9am Monday to Saturday' },
    verificationStatus: 'USER_VERIFIED',
  },
];

describe('P82 [GR2-01] FlowOrchestratorService.buildBlueprintSection (FLOW chat & streamChat)', () => {
  function makeOrchestrator(role: 'OWNER' | 'STAFF', scopes: Record<string, string> | null) {
    const svc = Object.create(FlowOrchestratorService.prototype) as any;
    svc.prisma = makePrismaForRole(role, scopes);
    svc.blueprint = {
      getBlueprintContext: vi.fn(async () => SAMPLE_BLUEPRINT_CTX),
    };
    svc.genomeFacts = {
      listTopFacts: vi.fn(async () => SAMPLE_FACTS),
    };
    return svc;
  }

  it('RED-BEFORE: STAFF without revenue:read receives NO financial blueprint fields, NO completeness, and NO financial/tax/money-worded genome facts', async () => {
    const svc = makeOrchestrator('STAFF', { bookings: 'read', revenue: 'none' });
    const prompt: string = await svc.buildBlueprintSection('biz_A', 'u1');

    // Non-money operating context remains
    expect(prompt).toContain('Wellness');
    expect(prompt).toContain('Opens 9am Monday to Saturday');

    // Money fields & facts MUST be withheld
    expect(prompt).not.toContain('Retainer + high-margin packages');
    expect(prompt).not.toContain('TTD 45000/mo');
    expect(prompt).not.toContain('TTD 850');
    expect(prompt).not.toContain('2.5 months');
    expect(prompt).not.toContain('72/100');
    expect(prompt).not.toContain('Completeness: 84%');
    expect(prompt).not.toContain('125000');
    expect(prompt).not.toContain('1500000');
    expect(prompt).not.toContain('cash runway');
  });

  it('RED-BEFORE: memberless turn (userId undefined) fails closed and withholds all financial blueprint data', async () => {
    const svc = makeOrchestrator('OWNER', null);
    const prompt: string = await svc.buildBlueprintSection('biz_A', undefined);

    expect(prompt).toContain('Wellness');
    expect(prompt).not.toContain('TTD 45000/mo');
    expect(prompt).not.toContain('TTD 850');
    expect(prompt).not.toContain('2.5 months');
    expect(prompt).not.toContain('125000');
  });

  it('control: OWNER (with revenue:read) still receives full financial blueprint fields and facts', async () => {
    const svc = makeOrchestrator('OWNER', null);
    const prompt: string = await svc.buildBlueprintSection('biz_A', 'u1');

    expect(prompt).toContain('Retainer + high-margin packages');
    expect(prompt).toContain('TTD 45000/mo');
    expect(prompt).toContain('TTD 850');
    expect(prompt).toContain('2.5 months');
    expect(prompt).toContain('125000');
  });
});

describe('P82 [GR2-02] KeyGenomeAdapterService organ tools (get_blueprint, calculate_integrity, list_facts, get_readiness)', () => {
  const SAMPLE_BLUEPRINT = {
    schemaVersion: 2,
    identity: { businessName: 'Maria Studio', industry: 'Wellness' },
    operatingModel: { revenueModel: 'Retainer', deliveryMode: 'In-person' },
    goals: { northStar: 'Serve 200 clients' },
    constraints: { budgetRange: 'TTD 45000/mo', timeCommitment: 'Full-time' },
    brand: { voice: 'Warm' },
    customerModel: { idealCustomer: 'Professionals' },
    financials: { avgTicket: 850, monthlyRevenue: 125000 },
    taxProfile: { estimatedAnnualRevenue: 1500000 },
    projectionProfile: { runwayMonths: 2.5 },
    offerArchitecture: { coreOffer: { name: 'VIP', price: 950 } },
    salesSystem: { avgDealSize: 1200 },
    riskProfile: { riskScore: 72 },
    intelligence: {},
    workflowModel: {},
    aiPreferences: {},
    confidenceScores: { identity: 90, financials: 95, taxProfile: 80, operationsSystem: 70 },
    completeness: 84,
    readinessScore: 78,
    genomeIntegrity: 76,
    genomeDnaScores: { founder: 80, operations: 70, financial: 10, sales: 20 },
    genomeDnaConfidence: { founder: 85, operations: 75, financial: 90, sales: 60 },
    genomeStage: 'REVENUE_ENGINE',
    executiveReadinessScore: 68,
    updatedAt: '2026-11-25T00:00:00.000Z',
  };

  const SAMPLE_INTEGRITY = {
    genomeIntegrity: 45, // avg of (80+70+10+20)/4
    genomeDnaScores: { founder: 80, operations: 70, financial: 10, sales: 20 },
    genomeDnaConfidence: { founder: 85, operations: 75, financial: 90, sales: 60 },
    genomeStage: 'REVENUE_ENGINE',
    threePillarMinimumMet: true,
    dnaSections: [
      { key: 'founder', label: 'Founder', integrity: 80, confidence: 85, summary: 'Strong', fieldsCaptured: 4, fieldsTotal: 5, missingFields: [], recommendation: '' },
      { key: 'operations', label: 'Operations', integrity: 70, confidence: 75, summary: 'Good', fieldsCaptured: 3, fieldsTotal: 4, missingFields: [], recommendation: '' },
      { key: 'financial', label: 'Financial', integrity: 10, confidence: 90, summary: 'Cash low', fieldsCaptured: 1, fieldsTotal: 5, missingFields: [], recommendation: 'Fix cash' },
      { key: 'sales', label: 'Sales', integrity: 20, confidence: 60, summary: 'Low pipeline', fieldsCaptured: 1, fieldsTotal: 5, missingFields: [], recommendation: 'Grow sales' },
    ],
    executiveReadinessScore: 45,
    readinessBreakdown: { operations: 70, finance: 10, sales: 20 },
  };

  const SAMPLE_READINESS = [
    { module: 'bookings', readinessScore: 85, missingFacts: [] },
    { module: 'finance', readinessScore: 15, missingFacts: [{ section: 'FINANCIAL', domain: 'financials', field: 'cashBalance', reason: 'Missing cash balance', impact: 'HIGH' }] },
    { module: 'commerce', readinessScore: 25, missingFacts: [] },
  ];

  function makeAdapter(role: 'OWNER' | 'ADMIN' | 'STAFF', scopes: Record<string, string> | null) {
    const adapter = new KeyGenomeAdapterService(
      { getBlueprint: vi.fn(async () => SAMPLE_BLUEPRINT), calculateGenomeIntegrity: vi.fn(async () => SAMPLE_INTEGRITY) } as any,
      { listSignals: vi.fn(async () => []) } as any,
      { listRecommendations: vi.fn(async () => []) } as any,
      { listFacts: vi.fn(async () => SAMPLE_FACTS) } as any,
      { getReadiness: vi.fn(async (_b: string, mod?: string) => (mod ? SAMPLE_READINESS.find((r) => r.module === mod) ?? null : SAMPLE_READINESS)) } as any,
      { computeBusinessScore: vi.fn(() => 50) } as any,
      { publish: vi.fn(), subscribe: vi.fn() } as any,
      makePrismaForRole(role, scopes) as any,
    );
    const tools = new Map(adapter.listTools().map((t) => [t.name, t]));
    const runTool = (name: string, ctx: any, input: Record<string, unknown> = {}) =>
      adapter.executeTool(name, ctx, input);
    return { adapter, tools, runTool };
  }

  it('RED-BEFORE: settings:read + revenue:none member receives projected blueprint, integrity, facts, and readiness with zero finance/sales leak', async () => {
    const { runTool } = makeAdapter('ADMIN', { settings: 'read', revenue: 'none' });
    const ctx = { businessId: 'biz_A', userId: 'u1' } as any;

    const bpRes = await runTool('key_genome.get_blueprint', ctx, {});
    const bpJson = JSON.stringify(bpRes.data);
    expect(bpRes.data.identity.industry).toBe('Wellness');
    // P106 (Ruling B4): withheld whole columns return {}, withheld money sub-fields are deleted, composites are null + withheldForRevenue.
    expect(bpRes.data.financials).toEqual({});
    expect(bpRes.data.taxProfile.estimatedAnnualRevenue).toBeUndefined();
    expect(bpRes.data.projectionProfile).toEqual({});
    expect(bpRes.data.offerArchitecture).toEqual({});
    expect(bpRes.data.salesSystem).toEqual({});
    expect(bpRes.data.riskProfile.riskScore).toBeUndefined();
    expect(bpRes.data.completeness).toBeNull();
    expect(bpRes.data.readinessScore).toBeNull();
    expect(bpRes.data.genomeStage).toBeNull();
    expect(bpRes.data.genomeIntegrity).toBeNull();
    expect(bpRes.data.executiveReadinessScore).toBeNull();
    expect(bpRes.data.withheldForRevenue).toEqual(
      expect.arrayContaining(['genomeIntegrity', 'executiveReadinessScore', 'genomeStage', 'completeness', 'readinessScore']),
    );
    expect(bpRes.data.operatingModel.revenueModel).toBeUndefined();
    expect(bpRes.data.constraints.budgetRange).toBeUndefined();
    expect(bpRes.data.genomeDnaScores.financial).toBeUndefined();
    expect(bpRes.data.genomeDnaScores.sales).toBeUndefined();
    expect(bpJson).not.toContain('125000');
    expect(bpJson).not.toContain('1500000');
    expect(bpJson).not.toContain('REVENUE_ENGINE');
    expect(bpJson).not.toContain('riskScore');

    const intRes = await runTool('key_genome.calculate_integrity', ctx, {});
    expect(intRes.data.genomeDnaScores.financial).toBeUndefined();
    expect(intRes.data.genomeDnaScores.sales).toBeUndefined();
    expect(intRes.data.dnaSections.map((s: any) => s.key)).toEqual(['founder', 'operations']);
    // P106 (Ruling B4): composites withheld as null (not recomputed), named in withheldForRevenue.
    expect(intRes.data.genomeStage).toBeNull();
    expect(intRes.data.genomeIntegrity).toBeNull();
    expect(intRes.data.executiveReadinessScore).toBeNull();
    expect(intRes.data.withheldForRevenue).toEqual(
      expect.arrayContaining(['genomeIntegrity', 'executiveReadinessScore', 'genomeStage']),
    );
    expect(intRes.data.readinessBreakdown.finance).toBeUndefined();
    expect(intRes.data.readinessBreakdown.sales).toBeUndefined();

    const factsRes = await runTool('key_genome.list_facts', ctx, {});
    expect(factsRes.data.facts.map((f: any) => f.id)).toEqual(['f_ops_clean']);
    expect(factsRes.data.count).toBe(1);

    const finSectionFacts = await runTool('key_genome.list_facts', ctx, { section: 'FINANCIAL' });
    expect(finSectionFacts.data.facts).toEqual([]);
    expect(finSectionFacts.data.count).toBe(0);

    const readRes = await runTool('key_genome.get_readiness', ctx, {});
    expect(readRes.data.readiness.map((r: any) => r.module)).toEqual(['bookings']);

    const finReadRes = await runTool('key_genome.get_readiness', ctx, { module: 'finance' });
    expect(finReadRes.data.readiness).toBeNull();
  });

  it('control: OWNER with revenue:read receives full unprojected organ tool outputs', async () => {
    const { runTool } = makeAdapter('OWNER', null);
    const ctx = { businessId: 'biz_A', userId: 'u1' } as any;

    const bpRes = await runTool('key_genome.get_blueprint', ctx, {});
    expect(bpRes.data.financials.monthlyRevenue).toBe(125000);
    expect(bpRes.data.genomeStage).toBe('REVENUE_ENGINE');

    const intRes = await runTool('key_genome.calculate_integrity', ctx, {});
    expect(intRes.data.genomeIntegrity).toBe(45);
    expect(intRes.data.genomeDnaScores.financial).toBe(10);

    const factsRes = await runTool('key_genome.list_facts', ctx, {});
    expect(factsRes.data.count).toBe(4);

    const readRes = await runTool('key_genome.get_readiness', ctx, {});
    expect(readRes.data.readiness).toHaveLength(3);
  });
});

describe('P82 [GR2-03] KeyCortexQueryPipelineService V2 system prompt projection (processQuery & streamQuery)', () => {
  const V2_FULL = {
    commerce: { totalRevenue: 99500, outstandingRevenue: 12400, productCount: 14 },
    bookings: { upcomingCount: 5, todayCount: 2 },
    genome: {
      dnaScores: { operations: 75, financial: 15, sales: 25 },
      currentStage: 'REVENUE_ENGINE',
      readinessScore: 42,
      recommendations: [
        { id: 'r_fin', title: 'Raise invoice pricing', category: 'FINANCIAL' },
        { id: 'r_ops', title: 'Confirm bookings early', category: 'OPERATIONS' },
      ],
    },
  };

  function makePipeline(readsRevenue: boolean) {
    const promptSvc = new KeyCortexSystemPromptService(
      {
        buildSystemPrompt: vi.fn(() => 'BASE PROMPT'),
        getRoleSystemPrompt: vi.fn(() => ''),
      } as any,
      undefined,
    );
    const capturedPrompts: string[] = [];
    const pipeline = Object.create(KeyCortexQueryPipelineService.prototype) as any;
    pipeline.logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() };
    pipeline.systemPromptService = promptSvc;
    pipeline.personalityService = {
      classifyPersona: vi.fn(async () => 'jarvis'),
      getPersonalityConfig: vi.fn(() => ({ name: 'Jarvis', temperature: 0.3 })),
      selectTone: vi.fn(async () => ({ tone: '', temperatureAdjustment: 0 })),
      buildSystemPrompt: vi.fn(() => 'BASE PROMPT'),
      buildValueBlock: vi.fn(async () => ''),
      detectValueConflict: vi.fn(async () => ({ conflict: false, terms: [] })),
    };
    pipeline.contextService = {
      buildContextSnapshot: vi.fn(async () => ({
        businessId: 'biz_A',
        metrics: { revenue: 99500, activeBookings: 5 },
        pendingInvoices: 7,
      })),
      formatContextForPrompt: vi.fn(() => ''),
    };
    pipeline.contextV2Service = {
      getFullContext: vi.fn(async () => V2_FULL),
    };
    pipeline.sessionService = {
      getOrCreateSession: vi.fn(async () => ({ id: 's1', businessId: 'biz_A', userId: 'u1', persona: 'jarvis', messages: [] })),
      saveMessage: vi.fn(async () => undefined),
      updateRunningSummary: vi.fn(async () => undefined),
      updateSessionCognitionMetadata: vi.fn(async () => undefined),
      generateId: vi.fn(() => 'id_1'),
    };
    pipeline.promptContextService = {
      buildMemoryContext: vi.fn(async () => ({})),
      buildMessages: vi.fn((_q: any, _ctx: any, sys: string) => {
        capturedPrompts.push(sys);
        return [{ role: 'system', content: sys }, { role: 'user', content: 'hi' }];
      }),
    };
    pipeline.memoryRetrieval = { retrieveForQuery: vi.fn(async () => []) };
    pipeline.router = {
      route: vi.fn(async () => ({ provider: 'openai', model: 'gpt-4o-mini', taskCategory: 'general', reason: 'test' })),
    };
    pipeline.structuredOutputService = {
      classifyTaskCategory: vi.fn(() => 'general'),
      buildStructuredOutputInstructions: vi.fn(() => ''),
      parseStructuredResponse: vi.fn(() => ({ role: 'assistant', recommendation: 'ok', confidence: 90 })),
    };
    pipeline.moodDetectionService = { detectMood: vi.fn(() => 'neutral') };
    pipeline.actionsService = { buildToolDefinitions: vi.fn(async () => []), executeActions: vi.fn(async () => []) };
    pipeline.actionDetectionService = { detectActions: vi.fn(async () => []) };
    pipeline.suggestionService = { generateSuggestions: vi.fn(async () => []) };
    pipeline.genomeContextService = { getGenomeEnrichedContext: vi.fn(async () => null) };
    pipeline.toolLoopService = {
      runWithToolLoop: vi.fn(async (opts: any) => {
        capturedPrompts.push(opts.systemPrompt);
        return { content: 'Done', toolCallsMade: [], tokensUsed: 10, cost: 0 };
      }),
      handleToolCalls: vi.fn(async (_q: any, completion: any) => ({
        finalContent: completion?.content ?? 'Done',
        toolResults: [],
        toolCallsExecuted: [],
      })),
    };
    pipeline.modelGateway = {
      complete: vi.fn(async () => ({ content: 'Done', usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 }, cost: 0 })),
      streamComplete: vi.fn(async function* () {
        yield { type: 'text', text: 'Done' };
      }),
    };
    pipeline.readsRevenue = vi.fn(async () => readsRevenue);
    pipeline.logEvent = vi.fn(async () => undefined);
    pipeline.saveExecutionTrace = vi.fn(async () => undefined);
    return { pipeline, capturedPrompts };
  }

  it('RED-BEFORE: processQuery with integrationV2Enabled omits commerce revenue from V2 system prompt for non-revenue STAFF', async () => {
    const { pipeline, capturedPrompts } = makePipeline(false);
    await pipeline.processQuery(
      { businessId: 'biz_A', userId: 'u1', text: 'What is on today?' },
      { integrationV2Enabled: true, genomeV3Enabled: false },
    );
    expect(capturedPrompts.length).toBeGreaterThan(0);
    expect(capturedPrompts[0]).toContain('Bookings: 5 upcoming, 2 today');
    expect(capturedPrompts[0]).not.toContain('99500');
    expect(capturedPrompts[0]).not.toContain('12400');
    expect(capturedPrompts[0]).not.toContain('total revenue');
  });

  it('RED-BEFORE: streamQuery with integrationV2Enabled omits commerce revenue from V2 system prompt for non-revenue STAFF', async () => {
    const { pipeline, capturedPrompts } = makePipeline(false);
    for await (const _chunk of pipeline.streamQuery(
      { businessId: 'biz_A', userId: 'u1', text: 'What is on today?' },
      { integrationV2Enabled: true, genomeV3Enabled: false },
    )) {
      /* drain */
    }
    expect(capturedPrompts.length).toBeGreaterThan(0);
    expect(capturedPrompts[0]).toContain('Bookings: 5 upcoming, 2 today');
    expect(capturedPrompts[0]).not.toContain('99500');
    expect(capturedPrompts[0]).not.toContain('12400');
    expect(capturedPrompts[0]).not.toContain('total revenue');
  });

  it('control: processQuery with integrationV2Enabled keeps commerce revenue for revenue reader', async () => {
    const { pipeline, capturedPrompts } = makePipeline(true);
    await pipeline.processQuery(
      { businessId: 'biz_A', userId: 'u1', text: 'How is revenue?' },
      { integrationV2Enabled: true, genomeV3Enabled: false },
    );
    expect(capturedPrompts[0]).toContain('99500');
  });
});

describe('P82 [GR2-04] KeyCortexController NL execute/batch context projection', () => {
  const V2_FULL = {
    commerce: { totalRevenue: 99500, outstandingRevenue: 12400 },
    bookings: { upcomingCount: 5, todayCount: 2 },
    genome: {
      dnaScores: { operations: 75, financial: 15, sales: 25 },
      currentStage: 'REVENUE_ENGINE',
      readinessScore: 42,
      recommendations: [{ id: 'r_fin', title: 'Raise prices', category: 'FINANCIAL' }],
    },
  };

  function makeController() {
    const ctrl = Object.create(KeyCortexController.prototype) as any;
    ctrl.connector = { getAllCapabilities: vi.fn(() => []) };
    ctrl.contextV2 = { getFullContext: vi.fn(async () => V2_FULL) };
    const parseIntent = vi.fn(async () => [{ module: 'bookings', action: 'list', parameters: {}, confidence: 0.9 }]);
    ctrl.command = {
      parseIntent,
      toConnectorCommand: vi.fn(() => ({ module: 'bookings', action: 'list', parameters: {}, businessId: 'biz_A', userId: 'u1' })),
    };
    ctrl.assertDirectCommands = vi.fn(async () => undefined);
    ctrl.executor = {
      execute: vi.fn(async () => ({ success: true })),
      executeBatch: vi.fn(async () => ({ success: true, results: [] })),
    };
    ctrl.generateCorrelationId = () => 'corr_1';
    return { ctrl, parseIntent };
  }

  it('RED-BEFORE: POST /cortex/execute NL mode strips commerce/finance and financial genome fields from context for non-revenue member', async () => {
    const { ctrl, parseIntent } = makeController();
    const user = { id: 'u1', role: 'USER' };
    const nonRevMember = { userId: 'u1', businessId: 'biz_A', role: 'STAFF', isSuperAdmin: false, scopes: { bookings: 'read', revenue: 'none' } };
    await ctrl.executeCommand({ businessId: 'biz_A', command: 'list my bookings' }, user, nonRevMember);

    expect(parseIntent).toHaveBeenCalledTimes(1);
    const passedContext = parseIntent.mock.calls[0][1].context;
    expect(passedContext.bookings).toEqual({ upcomingCount: 5, todayCount: 2 });
    expect(passedContext.commerce).toBeUndefined();
    expect(passedContext.genome?.currentStage).toBeUndefined();
    expect(passedContext.genome?.dnaScores?.financial).toBeUndefined();
    expect(JSON.stringify(passedContext)).not.toContain('99500');
    expect(JSON.stringify(passedContext)).not.toContain('REVENUE_ENGINE');
  });

  it('RED-BEFORE: POST /cortex/batch NL mode strips commerce/finance and financial genome fields from context for non-revenue member', async () => {
    const { ctrl, parseIntent } = makeController();
    const user = { id: 'u1', role: 'USER' };
    const nonRevMember = { userId: 'u1', businessId: 'biz_A', role: 'STAFF', isSuperAdmin: false, scopes: { bookings: 'read', revenue: 'none' } };
    await ctrl.executeBatch({ businessId: 'biz_A', commands: [{ type: 'natural', command: 'list my bookings' }] }, user, nonRevMember);

    expect(parseIntent).toHaveBeenCalledTimes(1);
    const passedContext = parseIntent.mock.calls[0][1].context;
    expect(passedContext.commerce).toBeUndefined();
    expect(passedContext.genome?.dnaScores?.financial).toBeUndefined();
    expect(JSON.stringify(passedContext)).not.toContain('99500');
  });
});
