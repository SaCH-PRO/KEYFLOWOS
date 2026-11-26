import { describe, it, expect, beforeEach, vi } from 'vitest';
import { admitAllSemanticSightForTests } from '../../../test/helpers/semantic-sight.js';
import { UnifiedMemoryRetrievalService } from './unified-memory-retrieval.service';

function makePrisma(overrides?: Partial<any>) {
  const defaults = {
    aiMemory: { findMany: vi.fn().mockResolvedValue([]) },
    genomeMemoryEvent: { findMany: vi.fn().mockResolvedValue([]) },
    temporalFlowMemory: { findMany: vi.fn().mockResolvedValue([]) },
    cognitionMemory: { findMany: vi.fn().mockResolvedValue([]) },
    cognitiveEvent: { findMany: vi.fn().mockResolvedValue([]) },
    businessEvent: { findMany: vi.fn().mockResolvedValue([]) },
    aiExecutionLog: { findMany: vi.fn().mockResolvedValue([]) },
    cortexActionLog: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return {
    client: { ...defaults, ...overrides },
  };
}

function makeSemanticMemory(overrides?: Partial<any>) {
  return {
    search: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('UnifiedMemoryRetrievalService', () => {
  let service: UnifiedMemoryRetrievalService;

  beforeEach(() => {
    service = new UnifiedMemoryRetrievalService(makePrisma() as any, makeSemanticMemory() as any);
  });

  it('returns normalized fragments from structured memory', async () => {
    const now = new Date();
    const prisma = makePrisma({
      aiMemory: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'am_1',
            category: 'preference',
            key: 'timezone',
            value: 'America/Port_of_Spain',
            confidence: 0.95,
            createdAt: now,
          },
        ]),
      },
    });

    service = new UnifiedMemoryRetrievalService(prisma as any, makeSemanticMemory() as any);
    const fragments = await service.retrieveContext('biz_1', {});

    expect(fragments).toHaveLength(1);
    expect(fragments[0]).toMatchObject({
      id: 'am_1',
      sourceType: 'ai_memory',
      title: 'preference',
      content: 'preference.timezone: America/Port_of_Spain',
      confidence: 0.95,
    });
  });

  it('includes semantic memory when a query is provided', async () => {
    const now = new Date();
    const semanticMemory = makeSemanticMemory({
      search: vi.fn().mockResolvedValue([
        {
          id: 'sem_1',
          content: 'Previous invoice discussion',
          similarity: 0.88,
          metadata: { createdAt: now.toISOString() },
        },
      ]),
    });

    service = new UnifiedMemoryRetrievalService(makePrisma() as any, semanticMemory as any);
    // MEM-UNIFIED-SEMANTIC-SIGHT: a semantic read carries the reader's sight (without one it reads nothing: fail closed).
    const visibleTo = vi.fn(async (hits: unknown[]) => hits.map(() => true));
    const fragments = await service.retrieveContext('biz_1', {
      query: 'invoice',
      semanticSight: { ...admitAllSemanticSightForTests(false), visibleTo },
    });

    expect(fragments).toHaveLength(1);
    expect(fragments[0]).toMatchObject({
      id: 'sem_1',
      sourceType: 'ai_memory_embedding',
      content: 'Previous invoice discussion',
    });
    expect(semanticMemory.search).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'biz_1', query: 'invoice', visibleTo }),
    );
  });

  it('filters by source type', async () => {
    const now = new Date();
    const prisma = makePrisma({
      aiMemory: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'am_1', category: 'pref', key: 'k1', value: 'v1', confidence: 1, createdAt: now },
        ]),
      },
      genomeMemoryEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'gme_1',
            sourceType: 'signal',
            sourceEntityId: null,
            eventType: 'opportunity',
            title: 'Opportunity',
            summary: 'Revenue opportunity detected',
            confidenceDelta: 0.2,
            createdAt: now,
            metadata: {},
          },
        ]),
      },
    });

    service = new UnifiedMemoryRetrievalService(prisma as any, makeSemanticMemory() as any);
    const fragments = await service.retrieveContext('biz_1', { sourceTypes: ['genome_memory_event'] });

    expect(fragments).toHaveLength(1);
    expect(fragments[0].sourceType).toBe('genome_memory_event');
  });

  it('limits results and ranks by composite score', async () => {
    const now = new Date();
    const prisma = makePrisma({
      aiMemory: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'am_1', category: 'pref', key: 'k1', value: 'v1', confidence: 0.5, createdAt: now },
          { id: 'am_2', category: 'pref', key: 'k2', value: 'v2', confidence: 1, createdAt: now },
        ]),
      },
    });

    service = new UnifiedMemoryRetrievalService(prisma as any, makeSemanticMemory() as any);
    const fragments = await service.retrieveContext('biz_1', { limit: 1 });

    expect(fragments).toHaveLength(1);
    expect(fragments[0].id).toBe('am_2');
  });

  it('gracefully returns empty results when structured memory load fails', async () => {
    const prisma = makePrisma({
      aiMemory: {
        findMany: vi.fn().mockRejectedValue(new Error('DB unavailable')),
      },
    });

    service = new UnifiedMemoryRetrievalService(prisma as any, makeSemanticMemory() as any);
    const fragments = await service.retrieveContext('biz_1', {});

    expect(fragments).toEqual([]);
  });

  it('includes episodic sources by default', async () => {
    const now = new Date();
    const prisma = makePrisma({
      businessEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'be_1',
            eventType: 'invoice_paid',
            subjectType: 'invoice',
            subjectId: 'inv_1',
            actorType: 'system',
            actorId: 'key',
            action: 'update',
            before: null,
            after: { status: 'paid' },
            metadata: {},
            createdAt: now,
          },
        ]),
      },
      aiExecutionLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'aex_1',
            action: 'send_email',
            toolName: 'email_sender',
            module: 'communications',
            success: true,
            rationale: 'User requested update',
            inputSummary: {},
            outputSummary: {},
            errorMessage: null,
            metadata: {},
            createdAt: now,
          },
        ]),
      },
      cortexActionLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'cal_1',
            actionType: 'CREATE_TASK',
            status: 'success',
            description: 'Follow up with client',
            result: 'Task created',
            error: null,
            requiresApproval: false,
            estimatedImpact: 'medium',
            createdAt: now,
          },
        ]),
      },
    });

    service = new UnifiedMemoryRetrievalService(prisma as any, makeSemanticMemory() as any);
    const fragments = await service.retrieveContext('biz_1', {});

    const sourceTypes = fragments.map((f) => f.sourceType);
    expect(sourceTypes).toContain('business_event');
    expect(sourceTypes).toContain('ai_execution_log');
    expect(sourceTypes).toContain('cortex_action_log');
  });

  it('excludes episodic sources when includeEpisodic is false', async () => {
    const prisma = makePrisma({
      businessEvent: {
        findMany: vi.fn().mockResolvedValue([{ id: 'be_1', createdAt: new Date() }]),
      },
    });

    service = new UnifiedMemoryRetrievalService(prisma as any, makeSemanticMemory() as any);
    const fragments = await service.retrieveContext('biz_1', { includeEpisodic: false });

    expect(fragments).toHaveLength(0);
    expect(prisma.client.businessEvent.findMany).not.toHaveBeenCalled();
  });

  // W11-FLOW-PERCEPTION-SCOPE review CR-W11FPS-1: the /ai flow chat's perception block reads, for a turn with no reader
  // (the support desk, the staff bridge, a SUPER_ADMIN who is no member), the business-wide stores by name: business
  // events still reach it, and no member's AiExecutionLog or CortexActionLog row is read at all (not read and dropped).
  it('a read that names its stores (sourceTypes) queries no personal store it leaves out, and still reads business events', async () => {
    const now = new Date();
    const prisma = makePrisma({
      businessEvent: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'be_1', eventType: 'invoice.overdue', subjectType: 'invoice', actorType: 'system', action: 'OVERDUE', createdAt: now },
        ]),
      },
      aiExecutionLog: { findMany: vi.fn().mockResolvedValue([{ id: 'ael_1', action: 'x', success: true, createdAt: now }]) },
      cortexActionLog: { findMany: vi.fn().mockResolvedValue([{ id: 'cal_1', actionType: 'X', status: 'success', createdAt: now }]) },
    });

    service = new UnifiedMemoryRetrievalService(prisma as any, makeSemanticMemory() as any);
    const fragments = await service.retrieveContext('biz_1', {
      sourceTypes: ['ai_memory', 'genome_memory_event', 'temporal_flow_memory', 'cognitive_event', 'business_event'],
    });

    expect(fragments.map((f) => f.sourceType)).toEqual(['business_event']);
    expect(prisma.client.businessEvent.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.client.aiExecutionLog.findMany).not.toHaveBeenCalled();
    expect(prisma.client.cortexActionLog.findMany).not.toHaveBeenCalled();

    // A read that names a personal store still queries it (retrieveEpisodicContext, the eval's cortex_action_log read).
    await service.retrieveContext('biz_1', { sourceTypes: ['cortex_action_log'] });
    expect(prisma.client.cortexActionLog.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.client.aiExecutionLog.findMany).not.toHaveBeenCalled();
  });

  it('retrieveEpisodicContext returns only episodic fragments', async () => {
    const now = new Date();
    const prisma = makePrisma({
      aiMemory: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'am_1', category: 'pref', key: 'k1', value: 'v1', confidence: 1, createdAt: now },
        ]),
      },
      cortexActionLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'cal_1',
            actionType: 'CREATE_TASK',
            status: 'success',
            description: 'Follow up',
            result: null,
            error: null,
            requiresApproval: false,
            estimatedImpact: null,
            createdAt: now,
          },
        ]),
      },
    });

    service = new UnifiedMemoryRetrievalService(prisma as any, makeSemanticMemory() as any);
    const fragments = await service.retrieveEpisodicContext('biz_1', {});

    expect(fragments).toHaveLength(1);
    expect(fragments[0].sourceType).toBe('cortex_action_log');
  });
  // FU-KEY-MEMORY-MONEY-SIGHT (V1-71; review SEC-W1FPMS-3; D-128, D-100): a genome fragment carries its row's own
  // sourceType, eventType, domain and section (metadata.genomeRow), beside the row's metadata, so a prompt's projection can
  // withhold the genome's money memory events (isMoneyMemoryEvent) from a reader without revenue read. The row's columns
  // are written last: a writer's own metadata cannot stand in for them.
  it('a genome fragment carries its row\'s sourceType, eventType, domain and section in metadata.genomeRow, beside the row\'s own metadata', async () => {
    const now = new Date();
    const prisma = makePrisma({
      genomeMemoryEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'gme_fin',
            sourceType: 'FINANCE_GENOME',
            sourceEntityId: null,
            eventType: 'FINANCE_SNAPSHOT_COMPUTED',
            domain: 'FINANCIAL',
            section: 'FINANCIAL',
            title: 'Finance snapshot computed',
            summary: 'Overall risk HIGH, health score 42.',
            confidenceDelta: 0,
            createdAt: now,
            metadata: { healthScore: 42, overallRisk: 'HIGH', genomeRow: { sourceType: 'OPERATIONS_GENOME', domain: 'OPERATIONS' } },
          },
        ]),
      },
    });

    service = new UnifiedMemoryRetrievalService(prisma as any, makeSemanticMemory() as any);
    const fragments = await service.retrieveContext('biz_1', { sourceTypes: ['genome_memory_event'] });

    expect(fragments).toHaveLength(1);
    expect(fragments[0]).toMatchObject({ sourceType: 'genome_memory_event', title: 'Finance snapshot computed', content: 'Overall risk HIGH, health score 42.' });
    expect(fragments[0].metadata).toEqual({
      healthScore: 42,
      overallRisk: 'HIGH',
      genomeRow: { sourceType: 'FINANCE_GENOME', eventType: 'FINANCE_SNAPSHOT_COMPUTED', domain: 'FINANCIAL', section: 'FINANCIAL' },
    });
    const select = prisma.client.genomeMemoryEvent.findMany.mock.calls[0][0].select;
    expect(select).toMatchObject({ sourceType: true, eventType: true, domain: true, section: true });
  });

  it('a genome row with no domain or section, or no metadata of its own, still carries its row', async () => {
    const now = new Date();
    const prisma = makePrisma({
      genomeMemoryEvent: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'gme_1', sourceType: 'KEY_ACTION_PROPOSAL', sourceEntityId: 'kap_1', eventType: 'ACTION_EXECUTED', domain: null, section: null, title: 'Action executed: x', summary: 'KEY action CREATE_TASK was executed.', confidenceDelta: 0.1, createdAt: now, metadata: null },
        ]),
      },
    });

    service = new UnifiedMemoryRetrievalService(prisma as any, makeSemanticMemory() as any);
    const [fragment] = await service.retrieveContext('biz_1', { sourceTypes: ['genome_memory_event'] });

    expect(fragment.metadata).toEqual({ genomeRow: { sourceType: 'KEY_ACTION_PROPOSAL', eventType: 'ACTION_EXECUTED', domain: null, section: null } });
  });

  // FU-KEY-MEMORY-MONEY-SIGHT (review COR-W1FPMS-1 follow-up): a cognitive fragment carries the row's payload (and its
  // source), so the projection reads a task's own type without parsing the rendered content; a business-event fragment
  // carries its actor type and action, which a memberless turn's proposal line is built from (SEC-W1FPMS-4).
  it('a cognitive fragment carries its payload in metadata.payload, and a business-event fragment its actorType and action', async () => {
    const now = new Date();
    const payload = { taskType: 'ContactTask', taskId: 'ct_1' };
    const prisma = makePrisma({
      cognitiveEvent: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'ce_1', sourceType: 'task_assignments', sourceId: 'ct_1', eventType: 'task.assigned', payload, confidence: 0.8, createdAt: now },
        ]),
      },
      businessEvent: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'be_1', eventType: 'GOVERNANCE_DECISION', subjectType: 'key_action_proposal', subjectId: 'kap_1', actorType: 'ai', actorId: 'key_ai', action: 'propose', before: null, after: { status: 'PENDING', riskLevel: 'LOW' }, metadata: { title: 't' }, createdAt: now },
        ]),
      },
    });

    service = new UnifiedMemoryRetrievalService(prisma as any, makeSemanticMemory() as any);
    const fragments = await service.retrieveContext('biz_1', { sourceTypes: ['cognitive_event', 'business_event'] });
    const cognitive = fragments.find((f) => f.sourceType === 'cognitive_event')!;
    const business = fragments.find((f) => f.sourceType === 'business_event')!;

    expect(cognitive.metadata).toEqual({ sourceType: 'task_assignments', payload });
    expect(cognitive.content).toBe(`task.assigned: ${JSON.stringify(payload)}`);
    expect(business.metadata).toMatchObject({ after: { status: 'PENDING', riskLevel: 'LOW' }, metadata: { title: 't' }, actorType: 'ai', action: 'propose' });
  });

  // P92 (MEM-EXPIRED-NOT-SERVED): AiMemory reads must filter expired rows (expiresAt) and confidence-0 must score lowest.
  it('filters expired AiMemory rows via expiresAt OR predicate', async () => {
    const prisma = makePrisma();
    service = new UnifiedMemoryRetrievalService(prisma as any, makeSemanticMemory() as any);
    await service.retrieveContext('biz_1', {});

    expect(prisma.client.aiMemory.findMany).toHaveBeenCalledTimes(1);
    const arg = (prisma.client.aiMemory.findMany as any).mock.calls[0][0];
    expect(arg.where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }]);
  });

  it('scores confidence-0 below unscored (0.5) and below every positive-confidence row while keeping positive order unchanged', async () => {
    const now = new Date();
    const prisma = makePrisma({
      temporalFlowMemory: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'tf_zero', entityType: 'business', entityId: 'biz_1', type: 'pattern', content: 'Zero confidence', confidence: 0, createdAt: now, metadata: null },
          { id: 'tf_unscored', entityType: 'business', entityId: 'biz_1', type: 'pattern', content: 'Unscored', confidence: null, createdAt: now, metadata: null },
          { id: 'tf_low', entityType: 'business', entityId: 'biz_1', type: 'pattern', content: 'Low positive', confidence: 0.1, createdAt: now, metadata: null },
          { id: 'tf_high', entityType: 'business', entityId: 'biz_1', type: 'pattern', content: 'High positive', confidence: 0.9, createdAt: now, metadata: null },
        ]),
      },
    });

    service = new UnifiedMemoryRetrievalService(prisma as any, makeSemanticMemory() as any);
    const fragments = await service.retrieveContext('biz_1', { sourceTypes: ['temporal_flow_memory'] });

    expect(fragments.map((f) => f.id)).toEqual(['tf_high', 'tf_low', 'tf_unscored', 'tf_zero']);
    const byId = Object.fromEntries(fragments.map((f) => [f.id, f]));
    expect(byId.tf_unscored.relevanceScore).toBe(0.5);
    expect(byId.tf_zero.relevanceScore).toBeLessThan(byId.tf_unscored.relevanceScore);
    expect(byId.tf_zero.relevanceScore).toBeLessThan(byId.tf_low.relevanceScore);
    expect(byId.tf_zero.confidence).toBe(0);
    expect(byId.tf_low.relevanceScore).toBeCloseTo(0.55, 6);
    expect(byId.tf_high.relevanceScore).toBeCloseTo(0.95, 6);
  });
});
