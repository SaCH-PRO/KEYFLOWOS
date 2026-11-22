/**
 * FU-KEY-GENOME-READS-RESIDUAL (owner ruling D-235; D-128, D-100, D-233, D-234): the KEY genome read paths that still
 * handed business-genome content to a reader without a per-reader projection (the packet's inventory, 2026-11-22).
 * A reader without revenue read is handed no finance or sales signal, recommendation, opportunity, DNA score, or
 * anything derived from them: not in a prompt, a response, a cache another reader is served, a ranking, a count or a
 * composite score. A path with no reader fails closed (it is read as a reader without revenue read). Each read is bound
 * to the business it names.
 */
import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { KeyCortexEvolutionService } from '../key-cortex-evolution.service';
import { KeyCortexInteractionService } from '../key-cortex-interaction.service';
import { KeyCortexReasoningService } from '../key-cortex-reasoning.service';
import { KeyCortexGenomeContextService } from '../key-cortex-genome-context.service';
import { KeyCortexConsciousnessService } from '../key-cortex-consciousness.service';
import { KeyCortexAwarenessService } from '../key-cortex-awareness.service';
import { genomeContextForReader, genomeRecommendationsForReader } from '../genome-context-for-reader';
import { snapshotForViewer } from '../key-cortex-context.service';

const FIN_DECISION = { id: 'dec_fin', businessId: 'biz_A', userId: 'u1', query: 'should I raise prices?', recommendation: 'Raise prices 10% on the retainer', recommendationType: 'pricing', userAction: 'accepted', outcome: null, createdAt: new Date() };
const OPS_DECISION = { id: 'dec_ops', businessId: 'biz_A', userId: 'u1', query: 'how do I cut delays?', recommendation: 'Write the delivery SOPs', recommendationType: 'operations', userAction: 'accepted', outcome: null, createdAt: new Date() };

function evolution(decision: Record<string, unknown> | null, related: unknown[] = [], patterns: unknown[] = []) {
  const svc = Object.create(KeyCortexEvolutionService.prototype) as any;
  svc.logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() };
  const findFirst = vi.fn(async ({ where }: any) => (decision && where.id === decision.id && where.businessId === decision.businessId ? decision : null));
  svc.prisma = { client: { keyEvolutionLog: { findUnique: vi.fn(async () => decision), findFirst, findMany: vi.fn(async () => related) } } };
  svc.redis = { getJson: vi.fn(async () => patterns), setJson: vi.fn() };
  const prompts: string[] = [];
  svc.gateway = { complete: vi.fn(async (req: any) => { prompts.push(JSON.stringify(req.messages)); return { content: '{}' }; }) };
  return { svc, prompts, findFirst };
}

describe('GET cortex/evolution/decision: KeyCortexEvolutionService.explainDecision (D-235 inventory row 1)', () => {
  it('RED-BEFORE: the decision is read in the business the route names, and another business\'s decision does not exist', async () => {
    const { svc, findFirst } = evolution({ ...OPS_DECISION, businessId: 'biz_B' });
    await expect(svc.explainDecision('dec_ops', 'biz_A', { readsRevenue: true, userId: 'u1' })).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst.mock.calls[0][0].where).toMatchObject({ id: 'dec_ops', businessId: 'biz_A' });
  });

  it('RED-BEFORE: a finance or sales decision does not exist for a reader without revenue read, and nothing is sent to the model', async () => {
    const { svc, prompts } = evolution(FIN_DECISION);
    await expect(svc.explainDecision('dec_fin', 'biz_A', { readsRevenue: false, userId: 'u1' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prompts).toEqual([]);
  });

  it('RED-BEFORE: with no reader given it fails closed (read as a reader without revenue read)', async () => {
    const { svc } = evolution(FIN_DECISION);
    await expect(svc.explainDecision('dec_fin', 'biz_A')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('RED-BEFORE: an operations decision is explained to a reader without revenue read without the money decisions and money patterns of the business', async () => {
    const related = [{ query: 'raise the hourly rate to 150?', userAction: 'accepted' }, { query: 'write the SOPs?', userAction: 'accepted' }];
    // Both patterns pass the service's relevance filter (their type is a word of the recommendation), so only the money
    // one is withheld by the reader projection.
    const patterns = [{ type: 'delivery', description: 'Revenue concentrated in 3 accounts', confidence: 0.9 }, { type: 'delivery', description: 'Deliveries slip on Fridays', confidence: 0.8 }];
    const { svc, prompts } = evolution(OPS_DECISION, related, patterns);
    const out = await svc.explainDecision('dec_ops', 'biz_A', { readsRevenue: false, userId: 'u1', ownerView: true });
    expect(out.recommendation).toBe('Write the delivery SOPs');
    expect(prompts.join('')).not.toContain('hourly rate');
    expect(prompts.join('')).not.toContain('Revenue concentrated');
    expect(prompts.join('')).toContain('Deliveries slip');
    expect(JSON.stringify(out)).not.toContain('Revenue concentrated');
  });

  it('control: a revenue reader is explained a finance decision, as before', async () => {
    const { svc } = evolution(FIN_DECISION);
    const out = await svc.explainDecision('dec_fin', 'biz_A', { readsRevenue: true, userId: 'u1' });
    expect(out.recommendation).toContain('Raise prices');
  });
});

const DNA = { execution: 60, operations: 70, finance: 30, sales: 40, revenue: 35 };
const CTX = {
  dnaScores: DNA,
  genomeStage: 'growth',
  executiveReadiness: 30,
  autonomyMap: { finance: true, operations: false },
  signals: [{ id: 's_fin', type: 'RISK_PATTERN', module: 'finance', section: 'FINANCIAL', domain: 'finance', severity: 'critical', message: 'Runway is 0.8 months' }],
  recommendations: [{ id: 'r_fin', title: 'Raise prices', description: '', impact: 'high', category: 'FINANCIAL', confidence: 0.9 }],
  opportunities: [{ id: 'o', title: 'Upsell', estimatedValue: 9000, confidence: 0.9, category: 'revenue' }],
  timestamp: new Date(),
} as any;

function promptOf(model: { complete: ReturnType<typeof vi.fn> }) {
  return JSON.stringify(model.complete.mock.calls.map((c) => c[0]));
}

describe('KeyCortexInteractionService.explainDecision (D-235 inventory row 2)', () => {
  function interaction(sessionBiz: string) {
    const svc = Object.create(KeyCortexInteractionService.prototype) as any;
    svc.logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() };
    const findFirst = vi.fn(async ({ where }: any) => (where.businessId && where.businessId !== sessionBiz ? null : { id: 'sess', businessId: sessionBiz, messages: [] }));
    svc.prisma = { client: { cortexSession: { findFirst } } };
    svc.genomeContextService = { getGenomeEnrichedContext: vi.fn(async () => CTX) };
    svc.modelGateway = { complete: vi.fn(async () => ({ content: 'ok' })) };
    return { svc, findFirst };
  }

  it('RED-BEFORE: the session is read in the business named, and another business\'s genome is never read', async () => {
    const { svc, findFirst } = interaction('biz_B');
    await svc.explainDecision('corr_1', 'biz_A', false);
    expect(findFirst.mock.calls[0][0].where).toMatchObject({ businessId: 'biz_A' });
    expect(svc.genomeContextService.getGenomeEnrichedContext).not.toHaveBeenCalledWith('biz_B');
  });

  it('RED-BEFORE: a reader without revenue read (and no reader) gets a prompt with no finance or sales DNA, readiness or finance recommendation', async () => {
    for (const reads of [false, undefined]) {
      const { svc } = interaction('biz_A');
      await svc.explainDecision('corr_1', 'biz_A', reads);
      const prompt = promptOf(svc.modelGateway);
      expect(prompt, String(reads)).not.toMatch(/"finance"|\\"finance\\"|finance\\":|sales\\":|revenue\\":/);
      expect(prompt, String(reads)).not.toContain('Raise prices');
      expect(prompt, String(reads)).not.toContain('Executive Readiness: 30');
    }
  });
});

describe('KeyCortexReasoningService legacy genome paths (D-235 inventory rows 3, 4)', () => {
  function reasoning() {
    const svc = Object.create(KeyCortexReasoningService.prototype) as any;
    svc.logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() };
    svc.getGenomeEnrichedContext = vi.fn(async () => CTX);
    const store = new Map<string, unknown>();
    svc.redis = { getJson: vi.fn(async (k: string) => store.get(k) ?? null), setJson: vi.fn(async (k: string, v: unknown) => store.set(k, v)) };
    svc.genomeBridgeService = { getRankedRecommendations: vi.fn(async () => [{ id: 'r_fin', title: 'Raise prices', recommendation: 'x', impact: 0.9, confidence: 0.9, domain: 'FINANCIAL' }, { id: 'r_ops', title: 'Write the SOPs', recommendation: 'y', impact: 0.9, confidence: 0.9, domain: 'OPERATIONS' }]) };
    svc.integrationV2Enabled = false;
    svc.modelGateway = { complete: vi.fn(async () => ({ content: 'ok' })) };
    svc.prisma = { client: { cortexSession: { findFirst: vi.fn(async ({ where }: any) => (where.businessId === 'biz_A' ? { id: 's', businessId: 'biz_A', messages: [] } : null)) } } };
    return { svc, store };
  }

  it('RED-BEFORE: legacy getProactiveSuggestions with no reader (and for a reader without revenue read) offers no finance recommendation or finance signal', async () => {
    for (const reads of [false, undefined]) {
      const { svc } = reasoning();
      const out = await svc.getProactiveSuggestions('biz_A', reads);
      expect(JSON.stringify(out), String(reads)).not.toContain('Raise prices');
      expect(JSON.stringify(out), String(reads)).not.toContain('Runway');
    }
  });

  it('RED-BEFORE: legacy shouldSuggestProactiveAction is not decided by a finance signal or a money opportunity for a reader without revenue read, and stores no projected DNA', async () => {
    const { svc, store } = reasoning();
    expect(await svc.shouldSuggestProactiveAction('biz_A', false)).toBe(false);
    const stored = store.get('genome:dna:previous:biz_A') as Record<string, number> | undefined;
    if (stored) expect(stored).toMatchObject({ finance: 30 });
  });

  it('RED-BEFORE: legacy explainDecision reads the session in the business named and projects the genome', async () => {
    const { svc } = reasoning();
    await svc.explainDecision('corr_1', 'biz_A', false);
    expect(svc.prisma.client.cortexSession.findFirst.mock.calls[0][0].where).toMatchObject({ businessId: 'biz_A' });
    expect(promptOf(svc.modelGateway)).not.toContain('Raise prices');
  });
});

describe('KeyCortexGenomeContextService: fail-closed defaults, the DNA cache, the ranking (D-235 inventory rows 5, 6)', () => {
  function service(recs: any[] = []) {
    const store = new Map<string, unknown>();
    const redis = { getJson: vi.fn(async (k: string) => store.get(k) ?? null), setJson: vi.fn(async (k: string, v: unknown) => { store.set(k, v); }) } as any;
    const bridge = {
      getGenomeIntelligence: vi.fn(async () => ({ signals: [], recommendations: [], opportunities: [] })),
      getRankedRecommendations: vi.fn(async (_b: string, limit?: number) => recs.slice(0, limit ?? recs.length)),
    } as any;
    const svc = new KeyCortexGenomeContextService(redis, bridge);
    return { svc, store, bridge };
  }

  it('RED-BEFORE: getProactiveSuggestions and shouldSuggestProactiveAction with no reader fail closed', async () => {
    const { svc } = service([{ id: 'r_fin', title: 'Raise prices', recommendation: 'x', impact: 0.9, confidence: 0.9, domain: 'FINANCIAL' }]);
    vi.spyOn(svc, 'getGenomeEnrichedContext').mockResolvedValue(CTX);
    expect(JSON.stringify(await svc.getProactiveSuggestions('biz_A'))).not.toContain('Raise prices');
    expect(await svc.shouldSuggestProactiveAction('biz_A')).toBe(false);
  });

  it('RED-BEFORE: the previous-DNA cache holds the whole map, so a revenue reader still sees a finance decline after a turn of a reader without revenue read', async () => {
    const { svc, store } = service();
    const ctx = (finance: number) => ({ ...CTX, signals: [], opportunities: [], dnaScores: { ...DNA, finance } });
    const spy = vi.spyOn(svc, 'getGenomeEnrichedContext');
    spy.mockResolvedValue(ctx(80));
    await svc.shouldSuggestProactiveAction('biz_A', true);
    spy.mockResolvedValue(ctx(80));
    await svc.shouldSuggestProactiveAction('biz_A', false);
    expect(store.get('genome:dna:previous:biz_A')).toMatchObject({ finance: 80 });
    spy.mockResolvedValue(ctx(50));
    expect(await svc.shouldSuggestProactiveAction('biz_A', true)).toBe(true);
  });

  it('RED-BEFORE: a reader without revenue read is handed no ranking field that weighs money, and the order is not the money-weighted rank', () => {
    const rows = [
      { id: 'a', title: 'Write the SOPs', category: 'OPERATIONS', impact: 0.5, confidence: 0.5, rankScore: 99, rankReason: 'high financial value', financialViability: 0.9 },
      { id: 'b', title: 'Train the team', category: 'OPERATIONS', impact: 0.9, confidence: 0.9, rankScore: 10, rankReason: 'low financial value', financialViability: 0.1 },
    ];
    const out = genomeRecommendationsForReader(rows as any, false) as any[];
    for (const r of out) for (const k of ['rankScore', 'rankReason', 'financialViability', 'genomeScore']) expect(r, k).not.toHaveProperty(k);
    expect(out.map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('composite indicators (D-233: no inference via a score, grade or categorical indicator; inventory row 7)', () => {
  it('RED-BEFORE: genomeContextForReader recomputes executive readiness from the non-money DNA, withholds the genome stage and the money modules of the autonomy map', () => {
    const out = genomeContextForReader(CTX, false) as any;
    // D-233 "withheld or recomputed": the mean of the dimensions the reader may see (execution 60, operations 70).
    expect(out.executiveReadiness).toBe(65);
    expect(out.genomeStage).toBeUndefined();
    expect(out.autonomyMap).toEqual({ operations: false });
    expect(genomeContextForReader(CTX, true)).toBe(CTX);
  });

  it('RED-BEFORE: snapshotForViewer recomputes executive readiness from the non-money DNA and withholds the genome stage for a viewer without revenue read', () => {
    const snap = { businessId: 'b', genomeStage: 'growth', executiveReadiness: 30, genomeDna: DNA, keyMetrics: {}, recentTasks: [], recentEvents: [], activeProjects: [], teamMembers: [], unreadMessages: 0 } as any;
    const out = snapshotForViewer(snap, false) as any;
    expect(out.executiveReadiness).toBe(65);
    expect(out.genomeStage).toBeUndefined();
    expect((snapshotForViewer(snap, true) as any).executiveReadiness).toBe(30);
  });
});

describe('KeyCortexConsciousnessService.getActiveGoals (D-235 inventory row 8)', () => {
  function consciousness() {
    const svc = Object.create(KeyCortexConsciousnessService.prototype) as any;
    svc.activeGoalsCache = new Map();
    svc.genomeBridge = { getRankedRecommendations: vi.fn(async () => [{ id: 'r_fin', title: 'Raise prices', domain: 'FINANCIAL' }, { id: 'r_ops', title: 'Write the SOPs', domain: 'OPERATIONS' }]) };
    svc.eventService = { getEvents: vi.fn(async () => [{ metadata: { acted: false, recommendation: 'Chase the $4,000 invoice' } }, { metadata: { acted: false, recommendation: 'Call the supplier' } }]) };
    svc.intuition = { detectWeakSignals: vi.fn(async () => [{ potentialImpact: 'high', description: 'Revenue down 20%', recommendedInvestigation: 'check pricing' }, { potentialImpact: 'high', description: 'Deliveries late', recommendedInvestigation: 'check rota' }]) };
    return svc;
  }

  it('RED-BEFORE: a reader without revenue read (and no reader) gets no finance or sales goal, money request or revenue weak signal; the goals name the recommendation, not [object Object]', async () => {
    for (const reads of [false, undefined]) {
      const svc = consciousness();
      const goals: string[] = await svc.getActiveGoals('biz_A', reads);
      const text = goals.join('\n');
      expect(text, String(reads)).not.toContain('Raise prices');
      expect(text, String(reads)).not.toContain('$4,000');
      expect(text, String(reads)).not.toContain('Revenue down');
      expect(text, String(reads)).not.toContain('[object Object]');
      expect(text, String(reads)).toContain('Write the SOPs');
      expect(text, String(reads)).toContain('Call the supplier');
    }
  });

  it('RED-BEFORE: the goals cached for a revenue reader are not served to a reader without revenue read', async () => {
    const svc = consciousness();
    expect((await svc.getActiveGoals('biz_A', true)).join('\n')).toContain('Raise prices');
    expect((await svc.getActiveGoals('biz_A', false)).join('\n')).not.toContain('Raise prices');
  });
});

describe('creativity and GET cortex/awareness (D-235 inventory row 9)', () => {
  it('RED-BEFORE: the creativity genome insights carry no finance or sales DNA and no finance recommendation (a cron has no reader: fails closed)', async () => {
    const { KeyCortexCreativityService } = await import('../key-cortex-creativity.service');
    const svc = Object.create(KeyCortexCreativityService.prototype) as any;
    svc.contextService = { getGenomeContext: vi.fn(async () => ({ dnaScores: DNA, currentStage: 'growth', readinessScore: 30, recommendations: [{ title: 'Raise prices', domain: 'FINANCIAL' }, { title: 'Write the SOPs', domain: 'OPERATIONS' }] })) };
    const insights: string[] = await svc.getGenomeInsights('biz_A');
    const text = insights.join('\n');
    expect(text).not.toMatch(/"finance"|"sales"|"revenue"/);
    expect(text).not.toContain('Raise prices');
    expect(text).not.toMatch(/readinessScore|currentStage/);
    expect(text).toContain('Write the SOPs');
  });

  it('RED-BEFORE: GET cortex/awareness serves a reader without revenue read no item that states money, and its counts are of what is served', async () => {
    const svc = Object.create(KeyCortexAwarenessService.prototype) as any;
    svc.logger = { warn: vi.fn() };
    svc.prisma = { client: { keyCortexMemory: { findMany: vi.fn(async ({ where }: any) => (where.type === 'creative_idea' ? [
      { key: 'i1', value: JSON.stringify({ title: 'Bundle the retainer at $900', description: 'raise revenue' }), confidence: 0.8, createdAt: new Date() },
      { key: 'i2', value: JSON.stringify({ title: 'Run a Friday team huddle', description: 'cut delays' }), confidence: 0.8, createdAt: new Date() },
    ] : [])) } } };
    // Round 2 (security MAJOR-1): ideas are made from the unprojected business context, so the kind is withheld whole.
    const out = await svc.getAwareness('biz_A', { kinds: ['idea'], readsRevenue: false });
    expect(out.items.map((i: any) => i.id)).toEqual([]);
    expect(out.counts.idea).toBe(0);
    const owner = await svc.getAwareness('biz_A', { kinds: ['idea'], readsRevenue: true });
    expect(owner.items.map((i: any) => i.id)).toEqual(['i1', 'i2']);
    const none = await svc.getAwareness('biz_A', { kinds: ['idea'] });
    expect(none.items.map((i: any) => i.id), 'no reader fails closed').toEqual([]);
  });
});

describe('round-2 review repairs (security MAJOR-1..3; correctness MAJOR-1, minors 1-4)', () => {
  const projected = genomeContextForReader(CTX, false);

  it('RED-BEFORE (correctness MAJOR-1): no prompt renders "undefined" for the withheld genome stage', async () => {
    const { KeyCortexSystemPromptService } = await import('../key-cortex-system-prompt.service');
    const sp = Object.create(KeyCortexSystemPromptService.prototype) as any;
    expect(sp.buildGenomeContextBlock(projected, [])).not.toContain('undefined');
    const { KeyCortexSuggestionService } = await import('../key-cortex-suggestion.service');
    const sg = Object.create(KeyCortexSuggestionService.prototype) as any;
    sg.logger = { warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
    sg.modelGateway = { complete: vi.fn(async () => ({ content: '[]' })) };
    const snap = snapshotForViewer({ businessId: 'b', genomeStage: 'growth', executiveReadiness: 30, genomeDna: DNA, keyMetrics: {}, recentTasks: [], recentEvents: [], activeProjects: [], teamMembers: [], unreadMessages: 0 } as any, false);
    await sg.generateSuggestions('b', 'hello', undefined, false, snap);
    expect(promptOf(sg.modelGateway)).not.toContain('undefined');
    const r = Object.create(KeyCortexReasoningService.prototype) as any;
    r.logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() };
    r.genomeBridgeService = {};
    r.getGenomeEnrichedContext = vi.fn(async () => CTX);
    r.modelGateway = { complete: vi.fn(async () => ({ content: 'ok' })) };
    r.prisma = { client: { cortexSession: { findFirst: vi.fn(async () => ({ id: 's', businessId: 'biz_A', messages: [] })) } } };
    await r.explainDecision('corr_1', 'biz_A', false);
    expect(promptOf(r.modelGateway)).not.toContain('undefined');
  });

  it('RED-BEFORE (security MAJOR-3): a decision is explained only to the user who made it, unless the reader is an owner; patterns are withheld from other readers', async () => {
    const { svc, prompts } = evolution({ ...OPS_DECISION, userId: 'owner_1' }, [], [{ type: 'delivery', description: 'Deliveries slip on Fridays', confidence: 0.8 }]);
    await expect(svc.explainDecision('dec_ops', 'biz_A', { readsRevenue: true, userId: 'staff_1', ownerView: false })).rejects.toBeInstanceOf(NotFoundException);
    const own = await svc.explainDecision('dec_ops', 'biz_A', { readsRevenue: true, userId: 'owner_1', ownerView: false });
    expect(own.recommendation).toBe('Write the delivery SOPs');
    expect(prompts.join('')).not.toContain('Deliveries slip');
    const owner = await svc.explainDecision('dec_ops', 'biz_A', { readsRevenue: true, userId: 'other_owner', ownerView: true });
    expect(owner.recommendation).toBe('Write the delivery SOPs');
  });

  it('RED-BEFORE (security MAJOR-1, MAJOR-2): awareness withholds from a reader without revenue read the kinds made from unprojected context or finance provenance (ideas, hypotheses, reflections, statement-sweep integrations)', async () => {
    const svc = Object.create(KeyCortexAwarenessService.prototype) as any;
    svc.logger = { warn: vi.fn(), debug: vi.fn() };
    const rows: Record<string, unknown[]> = {
      creative_idea: [{ key: 'i', value: JSON.stringify({ title: 'Launch a Monday-only offer to lift your slowest day' }), confidence: 0.8, createdAt: new Date() }],
      dream_hypothesis: [{ key: 'h', value: JSON.stringify({ hypothesis: 'Mondays are quiet' }), confidence: 0.8, createdAt: new Date() }],
      reflection_session: [{ key: 'r', value: JSON.stringify({ summary: 'Reflected on the week' }), confidence: 0.8, createdAt: new Date() }],
      integration_health: [{ key: 'statement_source:acc_1', value: JSON.stringify({ message: 'Republic Bank Chequing: nothing has imported in 23 days', source: 'statement_sweep' }), confidence: 0.8, createdAt: new Date() }],
      salience_momentum: [{ key: 'm', value: JSON.stringify({ headline: 'New bookings up this week', valence: 'opportunity' }), confidence: 0.8, createdAt: new Date() }],
      churn_risk: [{ key: 'c', value: JSON.stringify({ prediction: 'Acme Ltd likely to lapse', churnRisk: 0.8 }), confidence: 0.8, createdAt: new Date() }],
    };
    svc.prisma = { client: { keyCortexMemory: { findMany: vi.fn(async ({ where }: any) => rows[where.type] ?? []) } } };
    const out = await svc.getAwareness('biz_A', { readsRevenue: false });
    const ids = out.items.map((i: any) => i.id).sort();
    // correctness minor 4: values are checked, not key names ("valence":"opportunity", "churnRisk").
    expect(ids).toEqual(['c', 'm']);
    const owner = await svc.getAwareness('biz_A', { readsRevenue: true });
    expect(owner.items.map((i: any) => i.id).sort()).toEqual(['c', 'h', 'i', 'm', 'r', 'statement_source:acc_1']);
  });

  it('RED-BEFORE (correctness minor 2): getActiveGoals reads the ranked recommendations with headroom before taking five for a reader without revenue read', async () => {
    const svc = Object.create(KeyCortexConsciousnessService.prototype) as any;
    svc.activeGoalsCache = new Map();
    const ranked = [1, 2, 3, 4, 5].map((i) => ({ id: `f${i}`, title: `Raise prices ${i}`, domain: 'FINANCIAL' })).concat([{ id: 'o', title: 'Write the SOPs', domain: 'OPERATIONS' }]);
    svc.genomeBridge = { getRankedRecommendations: vi.fn(async (_b: string, limit = 5) => ranked.slice(0, limit)) };
    svc.eventService = { getEvents: vi.fn(async () => []) };
    svc.intuition = { detectWeakSignals: vi.fn(async () => []) };
    expect((await svc.getActiveGoals('biz_A', false)).join('\n')).toContain('Write the SOPs');
  });

  it('RED-BEFORE (correctness minor 3): creativity keeps a non-money recommendation in the production shape (a string) and drops a money one', async () => {
    const { KeyCortexCreativityService } = await import('../key-cortex-creativity.service');
    const svc = Object.create(KeyCortexCreativityService.prototype) as any;
    svc.contextService = { getGenomeContext: vi.fn(async () => ({ dnaScores: DNA, recommendations: ['Raise prices 10% on the retainer', 'Write the delivery SOPs'] })) };
    const text = (await svc.getGenomeInsights('biz_A')).join('\n');
    expect(text).toContain('Write the delivery SOPs');
    expect(text).not.toContain('Raise prices');
  });
});
