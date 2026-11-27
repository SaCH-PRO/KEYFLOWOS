/**
 * MEM-EVAL-SUITE (P150, V1-92; D-100, D-226, D-227, D-234, D-238, D-254, D-257):
 * Real-Postgres Memory Leak Integration Suite over EVERY path in `memory-path-registry.ts`
 * (`MEM-CENSUS`), using two fixture tenants (`v92a_bizA`, `v92a_bizB`) and three readers
 * (Owner A with full scopes, Staff A without `revenue:read` / `ai:none`, and Foreign Owner B /
 * Memberless caller) plus peer Staff A2 for D-130 member cognition isolation.
 *
 * Covers all 6 Section 3 leak classes:
 *   1. E-TEN          — Cross-tenant isolation across all 10 memory stores
 *   2. E-REV-DIRECT   — Direct revenue leak (explicit monetary figures & REVENUE class)
 *   3. E-REV-INDIRECT — Indirect/derived revenue leak (zero-keyword REVENUE facts/patterns/suggestions/reflections)
 *   4. E-MEMBERLESS   — No-actor / background / foreign-tenant caller fails closed
 *   5. E-UNCLASS      — UNCLASSIFIED, legacy NULL, unknown class, invalid module_scope, and SECRET_BEARING fail closed
 *   6. E-MEMBER       — Member cognition & personal rows under D-130 stay scoped strictly to owning member
 *
 * Programmatically checks `MEMORY_STORE_PATHS` and `DORMANT_MEMORY_PATHS` so ZERO registered
 * paths are silently uncovered: every fixed projected path is actively exercised, and every
 * genuinely unfixed (`tenantPredicate === 'no'` or `projection === 'unprojected'`) path is
 * tracked by an explicit named `it.todo` citing its owning follow-up packet id.
 *
 * Fixture prefix `v92a_` (registered in `apps/server/test/helpers/fixture-prefixes.json`).
 * Cleanup uses raw SQL `LIKE ${sqlLikePrefix(P)}` ONLY (zero `.deleteMany(` on soft-deleted models).
 * ZERO real provider traffic (deterministic unit vector stub only).
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { sqlLikePrefix } from './helpers/sql-like.js';
import type { CanonicalModule } from '../src/core/authority/module-vocabulary';
import {
  MEMORY_STORE_PATHS,
  DORMANT_MEMORY_PATHS,
  type MemoryStorePathEntry,
} from '../src/modules/key-cortex/memory-path-registry';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v92a_';
const ID = {
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  ownerA: `${P}owner_a`,
  staffA: `${P}staff_a`,
  staffA2: `${P}staff_a2`,
  ownerB: `${P}owner_b`,
  ksDocA: `${P}ks_doc_a`,
  ksDocB: `${P}ks_doc_b`,
};

const UNIT_VECTOR = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
const VECTOR_LITERAL = `[${UNIT_VECTOR.join(',')}]`;

const OWNER_SIGHT = (_m: CanonicalModule) => true;
const STAFF_NO_REV_SIGHT = (m: CanonicalModule) => m === 'crm' || m === 'bookings';
const BLIND_SIGHT = (_m: CanonicalModule) => false;

function registryPathKey(e: MemoryStorePathEntry): string {
  const occ = e.occurrenceIndex !== undefined ? `#${e.occurrenceIndex}` : '';
  return `${e.file}::${e.symbol}::${e.model}.${e.op}${occ}`;
}

/**
 * Every genuinely unfixed path in `MEMORY_STORE_PATHS` (`tenantPredicate === 'no'`
 * or `projection === 'unprojected'`) MUST appear here AND have a matching named
 * `it.todo(...)` citing its owning follow-up packet id.
 */
const UNFIXED_TODO_REGISTRY: ReadonlyMap<string, { followUp: string; leakClasses: string[] }> = new Map([
  [
    'modules/ai/proactive-suggestion.service.ts::ProactiveSuggestionService.generateSuggestions::AiMemory.findMany',
    { followUp: 'MEM-CLASS-READ', leakClasses: ['E-REV-DIRECT', 'E-REV-INDIRECT', 'E-UNCLASS'] },
  ],
  [
    'modules/business-events/business-event.service.ts::BusinessEventService.getTimeline::BusinessEvent.findMany',
    { followUp: 'MEM-EVAL-SUITE, MEM-CLASS-READ', leakClasses: ['E-TEN'] },
  ],
  [
    'modules/business-genome/key-genome/genome-memory.service.ts::GenomeMemoryService.getMemoryEvent::GenomeMemoryEvent.findUnique',
    { followUp: 'MEM-EVAL-SUITE, FU-KEY-GENOME-READS-RESIDUAL', leakClasses: ['E-TEN'] },
  ],
  [
    'modules/key-cortex/cognitive-event-bus.service.ts::CognitiveEventBusService.list::CognitiveEvent.findMany',
    { followUp: 'MEM-CLASS-READ', leakClasses: ['E-REV-DIRECT', 'E-REV-INDIRECT', 'E-UNCLASS'] },
  ],
  [
    'modules/key-cortex/key-cortex-actions.service.ts::KeyCortexActionsService.getActionHistory::CortexActionLog.findMany',
    { followUp: 'MEM-EVAL-SUITE, MEM-CLASS-READ', leakClasses: ['E-TEN'] },
  ],
  [
    'modules/key-cortex/key-cortex-learning.service.ts::KeyCortexLearningService.recordFeedback::CognitionMemory.findFirst',
    { followUp: 'RR-LEARNING-OUTCOME-SEMANTICS, MEM-EVAL-SUITE', leakClasses: ['E-TEN', 'E-MEMBER'] },
  ],
  [
    'modules/key-cortex/key-cortex-learning.service.ts::KeyCortexLearningService.recordFeedback::CognitionMemory.update',
    { followUp: 'RR-LEARNING-OUTCOME-SEMANTICS, MEM-EVAL-SUITE', leakClasses: ['E-TEN', 'E-MEMBER'] },
  ],
  [
    'modules/key-cortex/key-cortex-metacognition.service.ts::KeyCortexMetacognitionService.explainConfidence::BusinessEvent.findMany',
    { followUp: 'MEM-EVAL-SUITE, MEM-CLASS-READ', leakClasses: ['E-TEN'] },
  ],
]);

/**
 * Every fixed projected read symbol in `MEMORY_STORE_PATHS` (`kind === 'read'`,
 * `projection !== 'system-internal' && projection !== 'unprojected'`, and NOT in
 * `UNFIXED_TODO_REGISTRY`) mapped to the active real-DB leak tests that verify it.
 */
const ACTIVE_PROJECTED_READ_SYMBOLS: ReadonlySet<string> = new Set([
  'modules/ai/agent.controller.ts::AgentController.getDetectedPatterns',
  'modules/ai/ai-execution-log.service.ts::AiExecutionLogService.getHistory',
  'modules/ai/ai-execution-log.service.ts::AiExecutionLogService.getStats',
  'modules/ai/ai-memory.service.ts::AiMemoryService.get',
  'modules/ai/ai-memory.service.ts::AiMemoryService.getAll',
  'modules/ai/ai-memory.service.ts::AiMemoryService.getByCategory',
  'modules/ai/ai.controller.ts::AiController.servedExecutionLogPage',
  'modules/ai/proactive-suggestion.service.ts::ProactiveSuggestionService.getPendingSuggestions',
  'modules/ai/role-engine.service.ts::RoleEngineService.getRoleContext',
  'modules/ai/semantic-memory-sight.ts::semanticHitsVisibleTo',
  'modules/ai/semantic-memory.service.ts::SemanticMemoryService.search',
  'modules/business-events/business-event.service.ts::BusinessEventService.getAuditTrail',
  'modules/business-events/business-event.service.ts::BusinessEventService.getKpiStats',
  'modules/business-genome/key-genome/genome-memory.service.ts::GenomeMemoryService.countRecentFailedOutcomes',
  'modules/business-genome/key-genome/genome-memory.service.ts::GenomeMemoryService.countRecentMemoryEvents',
  'modules/business-genome/key-genome/genome-memory.service.ts::GenomeMemoryService.listMemoryEvents',
  'modules/business-genome/key-genome/key-genome-governance.service.ts::KeyGenomeGovernanceService.summary',
  'modules/key-cortex/key-cortex-awareness.service.ts::KeyCortexAwarenessService.getAwareness',
  'modules/key-cortex/key-cortex-context-v2.service.ts::KeyCortexContextV2Service.getTemporalContext',
  'modules/key-cortex/key-cortex-creativity.service.ts::KeyCortexCreativityService.recentWeakSignals',
  'modules/key-cortex/key-cortex-endocrine.service.ts::KeyCortexEndocrineService.hydrate',
  'modules/key-cortex/key-cortex-ethics.service.ts::KeyCortexEthicsService.explainDecision',
  'modules/key-cortex/key-cortex-event.service.ts::KeyCortexEventService.getEventChain',
  'modules/key-cortex/key-cortex-event.service.ts::KeyCortexEventService.getEvents',
  'modules/key-cortex/key-cortex-event.service.ts::KeyCortexEventService.getEventStats',
  'modules/key-cortex/key-cortex-immune.service.ts::KeyCortexImmuneService.load',
  'modules/key-cortex/key-cortex-learning.service.ts::KeyCortexLearningService.retrieveLessons',
  'modules/key-cortex/key-cortex-prompt-context.service.ts::readersOwnCognitionMemory',
  'modules/key-cortex/key-cortex-reflection.service.ts::KeyCortexReflectionService.getLastReflectionSession',
  'modules/key-cortex/key-cortex-reflection.service.ts::KeyCortexReflectionService.getWeeklySessions',
  'modules/key-cortex/key-cortex-salience.service.ts::KeyCortexSalienceService.countSignal',
  'modules/key-cortex/unified-memory-retrieval.service.ts::UnifiedMemoryRetrievalService.loadStructuredMemory',
  'modules/temporal-flow/temporal-flow-memory.service.ts::TemporalFlowMemoryService.findByEntity',
  'modules/temporal-flow/temporal-flow-memory.service.ts::TemporalFlowMemoryService.findById',
  'modules/temporal-flow/temporal-flow-memory.service.ts::TemporalFlowMemoryService.findMany',
  'modules/temporal-flow/temporal-flow-memory.service.ts::TemporalFlowMemoryService.getStats',
  'modules/temporal-flow/temporal-flow.service.ts::TemporalFlowService.listMemory',
  'modules/temporal-flow/temporal-flow.service.ts::TemporalFlowService.visibleMemoryById',
  'modules/temporal-flow/temporal-flow.service.ts::TemporalFlowService.visibleMemoryIds',
]);

/** Runtime tracker proving every symbol in ACTIVE_PROJECTED_READ_SYMBOLS was actually executed against Postgres. */
const invokedSymbols = new Set<string>();
function markInvoked(symbolKey: string): void {
  invokedSymbols.add(symbolKey);
}

let db: any;
let prisma: any;
let semantic: any;
let aiMemory: any;
let executionLog: any;
let roleEngine: any;
let proactiveSuggestions: any;
let agentController: any;
let aiController: any;
let temporalMemory: any;
let temporalFlow: any;
let unifiedRetrieval: any;
let contextV2: any;
let learningService: any;
let awarenessService: any;
let cortexEventService: any;
let cortexEthicsService: any;
let cortexReflectionService: any;
let cortexCreativityService: any;
let cortexActionsService: any;
let cortexSalienceService: any;
let cortexEndocrineService: any;
let cortexImmuneService: any;
let businessEventService: any;
let genomeMemoryService: any;
let genomeGovernanceService: any;
let cognitiveEventBus: any;
let KeyCortexEndocrineServiceCtor: any;
let KeyCortexImmuneServiceCtor: any;
let KeyCortexSalienceServiceCtor: any;
let readersOwnPromptMemoryFn: any;
let readersOwnCognitionMemoryFn: any;
let readersModuleSightFn: any;
let readerSearchOptionsFn: any;
let viewerMemoryReaderContextFn: any;

async function cleanup() {
  if (!db) return;
  const byBiz = (table: string) => `DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`;
  for (const sql of [
    byBiz('ai_memory_embeddings'),
    byBiz('ai_memories'),
    byBiz('temporal_flow_memories'),
    byBiz('temporal_flow_events'),
    byBiz('cognition_memories'),
    byBiz('key_cortex_memories'),
    byBiz('genome_memory_events'),
    byBiz('cognitive_events'),
    byBiz('business_events'),
    byBiz('ai_execution_logs'),
    byBiz('cortex_action_logs'),
    byBiz('knowledge_sources'),
    byBiz('key_action_proposals'),
    byBiz('memberships'),
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch (err: any) {
      const code = err?.code ?? err?.meta?.code;
      if (code !== '42P01') {
        throw err;
      }
    }
  }
}

async function resetMemoryRows() {
  const byBiz = (table: string) => `DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`;
  for (const sql of [
    byBiz('ai_memory_embeddings'),
    byBiz('ai_memories'),
    byBiz('temporal_flow_memories'),
    byBiz('temporal_flow_events'),
    byBiz('cognition_memories'),
    byBiz('key_cortex_memories'),
    byBiz('genome_memory_events'),
    byBiz('cognitive_events'),
    byBiz('business_events'),
    byBiz('ai_execution_logs'),
    byBiz('cortex_action_logs'),
    byBiz('knowledge_sources'),
  ]) {
    await db.$executeRawUnsafe(sql);
  }
}

async function insertEmbeddingRow(params: {
  id: string;
  businessId: string;
  sourceType: string;
  sourceId: string;
  content: string;
  metadata?: Record<string, unknown>;
  dataClass?: string | null;
  moduleScope?: string[] | null;
  createdAt?: Date;
}) {
  await db.$executeRawUnsafe(
    `INSERT INTO ai_memory_embeddings
       (id, business_id, source_type, source_id, content, embedding, metadata, data_class, module_scope, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::vector, $7::jsonb, $8, $9::text[], $10)`,
    params.id,
    params.businessId,
    params.sourceType,
    params.sourceId,
    params.content,
    VECTOR_LITERAL,
    JSON.stringify(params.metadata ?? {}),
    params.dataClass ?? null,
    params.moduleScope ?? null,
    params.createdAt ?? new Date(),
  );
}

describe('MEM-EVAL-SUITE (P150, V1-92): Real-DB Memory Leak Suite over MEM-CENSUS Registry', () => {
  const prevFlag = process.env.MEMORY_CLASS_READ;

  beforeAll(async () => {
    const dbMod = await import('@keyflow/db');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { SemanticMemoryService } = await import('../src/modules/ai/semantic-memory.service');
    const { AiExecutionLogService } = await import('../src/modules/ai/ai-execution-log.service');
    const { AiMemoryService } = await import('../src/modules/ai/ai-memory.service');
    const { AiOversightService } = await import('../src/modules/ai/ai-oversight.service');
    const { RoleEngineService } = await import('../src/modules/ai/role-engine.service');
    const { ProactiveSuggestionService } = await import('../src/modules/ai/proactive-suggestion.service');
    const { AgentController } = await import('../src/modules/ai/agent.controller');
    const { AiController } = await import('../src/modules/ai/ai.controller');
    const { TemporalFlowMemoryService } = await import('../src/modules/temporal-flow/temporal-flow-memory.service');
    const { TemporalFlowService } = await import('../src/modules/temporal-flow/temporal-flow.service');
    const { UnifiedMemoryRetrievalService } = await import('../src/modules/key-cortex/unified-memory-retrieval.service');
    const { KeyCortexContextV2Service } = await import('../src/modules/key-cortex/key-cortex-context-v2.service');
    const { KeyCortexLearningService } = await import('../src/modules/key-cortex/key-cortex-learning.service');
    const { KeyCortexAwarenessService } = await import('../src/modules/key-cortex/key-cortex-awareness.service');
    const { KeyCortexEventService } = await import('../src/modules/key-cortex/key-cortex-event.service');
    const { KeyCortexEthicsService } = await import('../src/modules/key-cortex/key-cortex-ethics.service');
    const { KeyCortexReflectionService } = await import('../src/modules/key-cortex/key-cortex-reflection.service');
    const { KeyCortexCreativityService } = await import('../src/modules/key-cortex/key-cortex-creativity.service');
    const { KeyCortexActionsService } = await import('../src/modules/key-cortex/key-cortex-actions.service');
    const { KeyCortexSalienceService } = await import('../src/modules/key-cortex/key-cortex-salience.service');
    const { KeyCortexEndocrineService } = await import('../src/modules/key-cortex/key-cortex-endocrine.service');
    const { KeyCortexImmuneService } = await import('../src/modules/key-cortex/key-cortex-immune.service');
    const { BusinessEventService } = await import('../src/modules/business-events/business-event.service');
    const { GenomeMemoryService } = await import('../src/modules/business-genome/key-genome/genome-memory.service');
    const { KeyGenomeGovernanceService } = await import(
      '../src/modules/business-genome/key-genome/key-genome-governance.service'
    );
    const { CognitiveEventBusService } = await import('../src/modules/key-cortex/cognitive-event-bus.service');
    const {
      readersOwnPromptMemory,
      readersOwnCognitionMemory,
      readersModuleSight,
    } = await import('../src/modules/key-cortex/key-cortex-prompt-context.service');
    const { readerSearchOptions } = await import('../src/modules/ai/semantic-memory-sight');
    const { viewerMemoryReaderContext } = await import('../src/modules/key-cortex/key-cortex.controller');

    db = dbMod.db;
    prisma = new PrismaService();
    const events = new EventEmitter2();
    const aiUsage = {
      trackEmbedding: async (_b: string, _u: unknown, _o: string, texts: string[]) =>
        texts.map(() => UNIT_VECTOR),
      trackText: async () => undefined,
    };

    semantic = new SemanticMemoryService(prisma, events, aiUsage as any);
    executionLog = new AiExecutionLogService(prisma);
    aiMemory = new AiMemoryService(prisma, executionLog, { getBlueprint: async () => null } as any, semantic);
    roleEngine = new RoleEngineService(prisma, aiMemory, events);
    const oversight = new AiOversightService(prisma, executionLog, aiMemory, {} as any, {} as any, {} as any);
    proactiveSuggestions = new ProactiveSuggestionService(
      prisma,
      { scanInsights: async () => [] } as any,
      oversight,
      events,
      semantic,
    );
    agentController = new AgentController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      semantic,
      prisma,
    );
    const aiCtrlDeps: unknown[] = Array.from({ length: Math.max(AiController.length, 30) }, () => ({}));
    aiCtrlDeps[2] = prisma;
    aiCtrlDeps[3] = executionLog;
    aiController = new (AiController as unknown as new (...args: unknown[]) => any)(...aiCtrlDeps);
    temporalMemory = new TemporalFlowMemoryService(prisma, semantic);
    temporalFlow = new TemporalFlowService(prisma, temporalMemory, semantic);
    unifiedRetrieval = new UnifiedMemoryRetrievalService(prisma, semantic);
    const stubRedis = {
      get: async () => null,
      set: async () => undefined,
    };
    contextV2 = new KeyCortexContextV2Service(prisma, stubRedis as any);
    learningService = new KeyCortexLearningService(prisma);
    awarenessService = new KeyCortexAwarenessService(prisma);
    cortexEventService = new KeyCortexEventService(prisma);
    cortexEthicsService = new KeyCortexEthicsService(prisma, cortexEventService);
    cortexReflectionService = new KeyCortexReflectionService(
      prisma,
      cortexEventService,
      {} as any,
      {} as any,
      {} as any,
      aiUsage as any,
    );
    cortexCreativityService = new KeyCortexCreativityService(
      prisma,
      {} as any,
      aiUsage as any,
      contextV2,
      {} as any,
    );
    cortexActionsService = new KeyCortexActionsService(
      prisma,
      undefined,
      {} as any,
      {} as any,
    );
    KeyCortexEndocrineServiceCtor = KeyCortexEndocrineService;
    KeyCortexImmuneServiceCtor = KeyCortexImmuneService;
    KeyCortexSalienceServiceCtor = KeyCortexSalienceService;
    cortexEndocrineService = new KeyCortexEndocrineService(prisma);
    cortexSalienceService = new KeyCortexSalienceService(prisma, cortexEndocrineService);
    cortexImmuneService = new KeyCortexImmuneService(prisma, cortexEndocrineService);
    businessEventService = new BusinessEventService(prisma, events);
    genomeMemoryService = new GenomeMemoryService(prisma);
    genomeGovernanceService = new KeyGenomeGovernanceService(
      prisma,
      { listSignals: async () => [] } as any,
      { listRecommendations: async () => [] } as any,
      { listExperiments: async () => [] } as any,
      { getReadiness: async () => [] } as any,
      {
        computeFactScores: async () => [],
        computeBusinessScore: (businessId: string) => ({
          businessId,
          overall: 0,
          integrity: 0,
          readiness: 0,
          confidence: 0,
          sections: [],
          computedAt: new Date().toISOString(),
        }),
      } as any,
      { listDepartments: async () => [] } as any,
    );
    cognitiveEventBus = new CognitiveEventBusService(prisma);

    readersOwnPromptMemoryFn = readersOwnPromptMemory;
    readersOwnCognitionMemoryFn = readersOwnCognitionMemory;
    readersModuleSightFn = readersModuleSight;
    readerSearchOptionsFn = readerSearchOptions;
    viewerMemoryReaderContextFn = viewerMemoryReaderContext;

    await cleanup();

    for (const u of [
      { id: ID.ownerA, email: `${P}owner_a@test.local`, name: 'V92A Owner A', role: 'USER' },
      { id: ID.staffA, email: `${P}staff_a@test.local`, name: 'V92A Staff A', role: 'USER' },
      { id: ID.staffA2, email: `${P}staff_a2@test.local`, name: 'V92A Staff A2', role: 'USER' },
      { id: ID.ownerB, email: `${P}owner_b@test.local`, name: 'V92A Owner B', role: 'USER' },
    ]) {
      await db.user.create({ data: u });
    }

    await db.business.createMany({
      data: [
        { id: ID.bizA, name: 'V92A Tenant A Studio', slug: `${P}biz_a`, ownerId: ID.ownerA },
        { id: ID.bizB, name: 'V92A Tenant B Marine', slug: `${P}biz_b`, ownerId: ID.ownerB },
      ],
    });

    await db.membership.createMany({
      data: [
        { id: `${P}m_owner_a`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
        {
          id: `${P}m_staff_a`,
          userId: ID.staffA,
          businessId: ID.bizA,
          role: 'STAFF',
          permissionScopes: { crm: 'read', bookings: 'read', revenue: 'none', expenses: 'none', ai: 'none' },
        },
        {
          id: `${P}m_staff_a2`,
          userId: ID.staffA2,
          businessId: ID.bizA,
          role: 'STAFF',
          permissionScopes: { crm: 'read', bookings: 'none', revenue: 'none', expenses: 'none', ai: 'none' },
        },
        { id: `${P}m_owner_b`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
      ],
    });
  }, 120_000);

  beforeEach(async () => {
    delete process.env.MEMORY_CLASS_READ;
    await resetMemoryRows();
  });

  afterEach(() => {
    if (prevFlag === undefined) delete process.env.MEMORY_CLASS_READ;
    else process.env.MEMORY_CLASS_READ = prevFlag;
  });

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  it('0. MEM-CENSUS registry coverage: zero registered paths silently uncovered; every unfixed path is an explicit named it.todo', () => {
    // Non-vacuous input proof (gate-vacuity)
    expect(MEMORY_STORE_PATHS.length).toBeGreaterThan(100);
    expect(DORMANT_MEMORY_PATHS.length).toBeGreaterThan(0);

    const unfixedInRegistry = MEMORY_STORE_PATHS.filter(
      (p) => p.tenantPredicate === 'no' || p.projection === 'unprojected',
    );
    const unfixedKeys = new Set(unfixedInRegistry.map(registryPathKey));

    // Every unfixed path in memory-path-registry.ts MUST be tracked in UNFIXED_TODO_REGISTRY (with a named it.todo below)
    const untrackedUnfixed = [...unfixedKeys].filter((k) => !UNFIXED_TODO_REGISTRY.has(k));
    expect(
      untrackedUnfixed,
      'Unfixed memory-path-registry entries must be actively fixed or tracked as a named it.todo citing their owning packet',
    ).toEqual([]);

    // No stale entries in UNFIXED_TODO_REGISTRY once fixed
    const staleTodos = [...UNFIXED_TODO_REGISTRY.keys()].filter((k) => !unfixedKeys.has(k));
    expect(staleTodos, 'Fixed paths should be promoted from UNFIXED_TODO_REGISTRY to active assertions').toEqual([]);

    // Every unfixed entry carries a non-empty followUp packet id
    for (const entry of unfixedInRegistry) {
      expect(entry.followUp && entry.followUp.trim().length > 0, registryPathKey(entry)).toBe(true);
    }

    // Every fixed projected read symbol (excluding entries tracked in UNFIXED_TODO_REGISTRY) MUST be in ACTIVE_PROJECTED_READ_SYMBOLS
    const projectedReads = MEMORY_STORE_PATHS.filter(
      (p) =>
        p.kind === 'read' &&
        p.projection !== 'system-internal' &&
        p.projection !== 'unprojected' &&
        !UNFIXED_TODO_REGISTRY.has(registryPathKey(p)),
    );
    expect(projectedReads.length).toBeGreaterThan(30);
    const projectedSyms = new Set(projectedReads.map((p) => `${p.file}::${p.symbol}`));
    const missingActive = [...projectedSyms].filter((sym) => !ACTIVE_PROJECTED_READ_SYMBOLS.has(sym));
    expect(missingActive, 'Every fixed projected memory reader must be covered by MEM-EVAL-SUITE').toEqual([]);
    const extraActive = [...ACTIVE_PROJECTED_READ_SYMBOLS].filter((sym) => !projectedSyms.has(sym));
    expect(extraActive, 'ACTIVE_PROJECTED_READ_SYMBOLS must not double-claim UNFIXED_TODO_REGISTRY or non-projected symbols').toEqual([]);

    // Every remaining path (system-internal / writer-only) outside UNFIXED_TODO_REGISTRY MUST carry tenantPredicate yes | ambient-only | platform
    const internalOrWriter = MEMORY_STORE_PATHS.filter(
      (p) => (p.kind === 'write' || p.projection === 'system-internal') && !UNFIXED_TODO_REGISTRY.has(registryPathKey(p)),
    );
    expect(internalOrWriter.length).toBeGreaterThan(50);
    const unscopedInternal = internalOrWriter.filter(
      (p) => p.tenantPredicate !== 'yes' && p.tenantPredicate !== 'ambient-only' && p.tenantPredicate !== 'platform',
    );
    expect(unscopedInternal.map(registryPathKey)).toEqual([]);

    // Every dormant path cites its owning follow-up packet
    for (const d of DORMANT_MEMORY_PATHS) {
      expect(d.followUp.trim().length).toBeGreaterThan(0);
    }
  });

  it('1. E-TEN: cross-tenant isolation across 9 memory stores (Tenant A readers never receive Tenant B rows; CortexActionLog E-TEN tracked via it.todo #5)', async () => {
    const now = new Date();
    const future = new Date(Date.now() + 86_400_000);
    const corrShared = `${P}corr_shared`;

    // Seed both Tenant A and Tenant B across all 10 stores
    await db.aiMemory.createMany({
      data: [
        {
          id: `${P}am_a`,
          businessId: ID.bizA,
          category: 'business_fact',
          key: 'studio_fact',
          value: 'Tenant A salon studio opens Tuesday at 09:00',
          source: 'user',
          dataClass: 'GENERAL',
          moduleScope: [],
          createdAt: now,
        },
        {
          id: `${P}am_b`,
          businessId: ID.bizB,
          category: 'business_fact',
          key: 'marine_fact',
          value: 'Tenant B marine warehouse SECRET_B_TOKEN at Pier 7 North',
          source: 'user',
          dataClass: 'GENERAL',
          moduleScope: [],
          createdAt: now,
        },
        {
          id: `${P}am_pat_a`,
          businessId: ID.bizA,
          category: 'patterns',
          key: 'pat_a',
          value: JSON.stringify({ name: 'Tenant A booking pattern' }),
          source: 'inferred',
          dataClass: 'GENERAL',
          moduleScope: ['bookings'],
          createdAt: now,
        },
        {
          id: `${P}am_pat_b`,
          businessId: ID.bizB,
          category: 'patterns',
          key: 'pat_b',
          value: JSON.stringify({ name: 'Tenant B SECRET_B_PATTERN' }),
          source: 'inferred',
          dataClass: 'GENERAL',
          moduleScope: ['bookings'],
          createdAt: now,
        },
        {
          id: `${P}am_sug_a`,
          businessId: ID.bizA,
          category: 'suggestion',
          key: 'sug_a',
          value: JSON.stringify({ id: `${P}sug_a`, title: 'Follow up with Tenant A client', message: 'Check in' }),
          source: 'inferred',
          dataClass: 'GENERAL',
          moduleScope: ['crm'],
          expiresAt: future,
          createdAt: now,
        },
        {
          id: `${P}am_sug_b`,
          businessId: ID.bizB,
          category: 'suggestion',
          key: 'sug_b',
          value: JSON.stringify({ id: `${P}sug_b`, title: 'Tenant B SECRET_B_SUGGESTION', message: 'Marine check' }),
          source: 'inferred',
          dataClass: 'GENERAL',
          moduleScope: ['crm'],
          expiresAt: future,
          createdAt: now,
        },
      ],
    });

    await insertEmbeddingRow({
      id: `${P}emb_a`,
      businessId: ID.bizA,
      sourceType: 'memory',
      sourceId: `${P}am_a`,
      content: 'Tenant A salon studio opens Tuesday at 09:00',
      metadata: { category: 'business_fact', key: 'studio_fact' },
      dataClass: 'GENERAL',
      moduleScope: [],
    });
    await insertEmbeddingRow({
      id: `${P}emb_b`,
      businessId: ID.bizB,
      sourceType: 'memory',
      sourceId: `${P}am_b`,
      content: 'Tenant B marine warehouse SECRET_B_TOKEN at Pier 7 North',
      metadata: { category: 'business_fact', key: 'marine_fact' },
      dataClass: 'GENERAL',
      moduleScope: [],
    });

    await db.temporalFlowMemory.createMany({
      data: [
        {
          id: `${P}tf_a`,
          businessId: ID.bizA,
          entityType: 'contact',
          entityId: `${P}c_shared`,
          type: 'summary',
          content: 'Tenant A client summary',
          sourceModule: 'crm',
          sourceEventIds: [],
          metadata: {},
          confidence: 0.9,
          dataClass: 'GENERAL',
          moduleScope: ['crm'],
        },
        {
          id: `${P}tf_b`,
          businessId: ID.bizB,
          entityType: 'contact',
          entityId: `${P}c_shared`,
          type: 'summary',
          content: 'Tenant B SECRET_B_TEMPORAL summary',
          sourceModule: 'crm',
          sourceEventIds: [],
          metadata: {},
          confidence: 0.9,
          dataClass: 'GENERAL',
          moduleScope: ['crm'],
        },
      ],
    });

    await db.cognitionMemory.createMany({
      data: [
        {
          id: `${P}cog_a`,
          businessId: ID.bizA,
          sessionId: `${P}sess_a`,
          userId: ID.ownerA,
          query: 'Tenant A studio schedule',
          recommendation: 'Keep Tuesday open',
          userResponse: 'accepted',
          confidence: 0.9,
          lessonsLearned: ['Tenant A lesson'],
          createdAt: now,
        },
        {
          id: `${P}cog_b`,
          businessId: ID.bizB,
          sessionId: `${P}sess_b`,
          userId: ID.ownerB,
          query: 'Tenant B marine schedule',
          recommendation: 'Check Pier 7',
          userResponse: 'accepted',
          confidence: 0.9,
          lessonsLearned: ['Tenant B SECRET_B_LESSON'],
          createdAt: now,
        },
      ],
    });

    await db.keyCortexMemory.createMany({
      data: [
        {
          id: `${P}kc_a`,
          businessId: ID.bizA,
          type: 'weak_signal',
          key: `${P}ws_a`,
          userId: null,
          value: JSON.stringify({ description: 'Tenant A weak signal' }),
          confidence: 0.85,
          createdAt: now,
        },
        {
          id: `${P}kc_b`,
          businessId: ID.bizB,
          type: 'weak_signal',
          key: `${P}ws_b`,
          userId: null,
          value: JSON.stringify({ description: 'Tenant B SECRET_B_SIGNAL' }),
          confidence: 0.85,
          createdAt: now,
        },
      ],
    });

    await db.genomeMemoryEvent.createMany({
      data: [
        {
          id: `${P}gm_a`,
          businessId: ID.bizA,
          sourceType: 'crm',
          eventType: 'LESSON_LEARNED',
          domain: 'crm',
          title: 'Tenant A genome memory',
          summary: 'Tenant A customer retention note',
          outcome: 'SUCCESS',
          impactScore: 0.8,
          occurredAt: now,
        },
        {
          id: `${P}gm_b`,
          businessId: ID.bizB,
          sourceType: 'crm',
          eventType: 'LESSON_LEARNED',
          domain: 'crm',
          title: 'Tenant B SECRET_B_GENOME',
          summary: 'Tenant B private genome event',
          outcome: 'FAILURE',
          impactScore: 0.9,
          occurredAt: now,
        },
      ],
    });

    await db.cognitiveEvent.createMany({
      data: [
        {
          id: `${P}ce_a`,
          businessId: ID.bizA,
          sourceType: 'crm',
          eventType: 'signal.detected',
          payload: { note: 'Tenant A cognitive event' },
          confidence: 0.8,
        },
        {
          id: `${P}ce_b`,
          businessId: ID.bizB,
          sourceType: 'crm',
          eventType: 'signal.detected',
          payload: { note: 'Tenant B SECRET_B_COGNITIVE' },
          confidence: 0.8,
        },
      ],
    });

    await db.businessEvent.createMany({
      data: [
        {
          id: `${P}be_a`,
          businessId: ID.bizA,
          eventType: 'contact.updated',
          subjectType: 'contact',
          subjectId: `${P}subj_shared`,
          actorType: 'human',
          actorId: ID.ownerA,
          action: 'update',
          source: 'key_observation',
          correlationId: corrShared,
          metadata: { note: 'Tenant A event' },
          createdAt: now,
        },
        {
          id: `${P}be_b`,
          businessId: ID.bizB,
          eventType: 'contact.updated',
          subjectType: 'contact',
          subjectId: `${P}subj_shared`,
          actorType: 'human',
          actorId: ID.ownerB,
          action: 'update',
          source: 'key_observation',
          correlationId: corrShared,
          metadata: { note: 'Tenant B SECRET_B_EVENT' },
          createdAt: now,
        },
      ],
    });

    await db.aiExecutionLog.createMany({
      data: [
        {
          id: `${P}ael_a`,
          businessId: ID.bizA,
          userId: ID.ownerA,
          action: 'crm.update_contact',
          toolName: 'crm_update_contact',
          module: 'crm',
          rationale: 'Tenant A execution log',
          success: true,
          createdAt: now,
        },
        {
          id: `${P}ael_b`,
          businessId: ID.bizB,
          userId: ID.ownerB,
          action: 'crm.update_contact',
          toolName: 'crm_update_contact',
          module: 'crm',
          rationale: 'Tenant B SECRET_B_EXEC',
          success: true,
          createdAt: now,
        },
      ],
    });

    const ownerACtx = viewerMemoryReaderContextFn({
      userId: ID.ownerA,
      businessId: ID.bizA,
      role: 'OWNER',
      superAdmin: false,
      scopes: { crm: 'admin', bookings: 'admin', revenue: 'admin', expenses: 'admin', ai: 'admin' },
      member: true,
    });

    // AiMemoryService (getAll, getByCategory, get)
    expect((await aiMemory.getAll(ID.bizA, ownerACtx)).every((r: any) => r.businessId === ID.bizA)).toBe(true);
    expect((await aiMemory.getAll(ID.bizA, ownerACtx)).map((r: any) => r.id)).not.toContain(`${P}am_b`);
    markInvoked('modules/ai/ai-memory.service.ts::AiMemoryService.getAll');
    expect((await aiMemory.getByCategory(ID.bizA, 'business_fact', ownerACtx)).map((r: any) => r.id)).toEqual([`${P}am_a`]);
    markInvoked('modules/ai/ai-memory.service.ts::AiMemoryService.getByCategory');
    expect(await aiMemory.get(ID.bizA, 'business_fact', 'marine_fact', ownerACtx)).toBeNull();
    markInvoked('modules/ai/ai-memory.service.ts::AiMemoryService.get');

    // SemanticMemoryService (pgvector raw SQL) + semanticHitsVisibleTo
    const semA = await semantic.search({
      businessId: ID.bizA,
      query: 'marine warehouse salon studio',
      limit: 20,
      minSimilarity: 0.1,
      visibleTo: readerSearchOptionsFn(prisma, ID.bizA, ownerACtx).visibleTo,
    });
    expect(semA.map((h: any) => h.id)).toEqual([`${P}emb_a`]);
    markInvoked('modules/ai/semantic-memory.service.ts::SemanticMemoryService.search');
    markInvoked('modules/ai/semantic-memory-sight.ts::semanticHitsVisibleTo');

    // TemporalFlowMemoryService (findMany, findById, findByEntity, getStats)
    expect((await temporalMemory.findMany(ID.bizA, { limit: 50 }, ownerACtx)).map((r: any) => r.id)).toEqual([`${P}tf_a`]);
    markInvoked('modules/temporal-flow/temporal-flow-memory.service.ts::TemporalFlowMemoryService.findMany');
    expect(await temporalMemory.findById(ID.bizA, `${P}tf_b`, ownerACtx)).toBeNull();
    markInvoked('modules/temporal-flow/temporal-flow-memory.service.ts::TemporalFlowMemoryService.findById');
    expect((await temporalMemory.findByEntity(ID.bizA, 'contact', `${P}c_shared`, ownerACtx)).map((r: any) => r.id)).toEqual([`${P}tf_a`]);
    markInvoked('modules/temporal-flow/temporal-flow-memory.service.ts::TemporalFlowMemoryService.findByEntity');
    const tfStatsA = await temporalMemory.getStats(ID.bizA, ownerACtx);
    expect(tfStatsA.total).toBe(1);
    markInvoked('modules/temporal-flow/temporal-flow-memory.service.ts::TemporalFlowMemoryService.getStats');

    // TemporalFlowService (listMemory, visibleMemoryById)
    const ownerATfSight = await temporalFlow.memorySight(ID.bizA, { id: ID.ownerA });
    const listA = await temporalFlow.listMemory(ID.bizA, { limit: 50 }, ownerATfSight);
    expect(listA.map((r: any) => r.id)).toEqual([`${P}tf_a`]);
    markInvoked('modules/temporal-flow/temporal-flow.service.ts::TemporalFlowService.listMemory');
    expect(await temporalFlow.visibleMemoryById(ID.bizA, `${P}tf_b`, ownerATfSight)).toBeNull();
    markInvoked('modules/temporal-flow/temporal-flow.service.ts::TemporalFlowService.visibleMemoryById');

    // UnifiedMemoryRetrievalService (all 8 structured stores + semantic)
    const unifiedA = await unifiedRetrieval.retrieveContext(ID.bizA, {
      limit: 50,
      boostRecency: false,
      readerContext: ownerACtx,
      semanticSight: readerSearchOptionsFn(prisma, ID.bizA, ownerACtx),
      query: 'marine salon',
    });
    expect(JSON.stringify(unifiedA)).not.toContain('SECRET_B_');
    expect(unifiedA.some((f: any) => f.id === `${P}am_a`)).toBe(true);
    markInvoked('modules/key-cortex/unified-memory-retrieval.service.ts::UnifiedMemoryRetrievalService.loadStructuredMemory');

    // KeyCortexContextV2Service
    const tempCtxA = await contextV2.getTemporalContext(ID.bizA, ownerACtx);
    expect(JSON.stringify(tempCtxA)).not.toContain('SECRET_B_');
    markInvoked('modules/key-cortex/key-cortex-context-v2.service.ts::KeyCortexContextV2Service.getTemporalContext');

    // KeyCortexLearningService
    const lessonsA = await learningService.retrieveLessons(ID.bizA, 'schedule', {
      userId: ID.ownerA,
      readerContext: ownerACtx,
    });
    expect(lessonsA).toEqual(['[accepted] Tenant A lesson']);
    markInvoked('modules/key-cortex/key-cortex-learning.service.ts::KeyCortexLearningService.retrieveLessons');

    // KeyCortexAwarenessService
    const awarenessA = await awarenessService.getAwareness(ID.bizA, {
      kinds: ['weakSignal'],
      readsRevenue: true,
      readerContext: ownerACtx,
    });
    expect(awarenessA.items.map((i: any) => i.id)).toEqual([`${P}ws_a`]);
    markInvoked('modules/key-cortex/key-cortex-awareness.service.ts::KeyCortexAwarenessService.getAwareness');

    // KeyCortexEventService (getEvents, getEventChain, getEventStats)
    const evsA = await cortexEventService.getEvents(ID.bizA, { limit: 50 }, ownerACtx);
    expect(evsA.map((e: any) => e.id)).toEqual([`${P}be_a`]);
    markInvoked('modules/key-cortex/key-cortex-event.service.ts::KeyCortexEventService.getEvents');
    const chainA = await cortexEventService.getEventChain(ID.bizA, corrShared, ownerACtx);
    expect(chainA.map((e: any) => e.id)).toEqual([`${P}be_a`]);
    markInvoked('modules/key-cortex/key-cortex-event.service.ts::KeyCortexEventService.getEventChain');
    const evStatsA = await cortexEventService.getEventStats(ID.bizA, 'week', ownerACtx);
    expect(evStatsA['contact.updated']).toBe(1);
    markInvoked('modules/key-cortex/key-cortex-event.service.ts::KeyCortexEventService.getEventStats');

    // KeyCortexEthicsService.explainDecision (cross-tenant decisionId must not be revealed)
    const ethicsCross = await cortexEthicsService.explainDecision(`${P}be_b`, ID.bizA, ownerACtx);
    expect(ethicsCross).toContain('not found');
    expect(ethicsCross).not.toContain('SECRET_B_');
    markInvoked('modules/key-cortex/key-cortex-ethics.service.ts::KeyCortexEthicsService.explainDecision');

    // BusinessEventService (getAuditTrail, getKpiStats)
    const auditA = await businessEventService.getAuditTrail(ID.bizA, { limit: 50 }, ownerACtx);
    expect(auditA.events.map((e: any) => e.id)).toEqual([`${P}be_a`]);
    markInvoked('modules/business-events/business-event.service.ts::BusinessEventService.getAuditTrail');
    const kpiA = await businessEventService.getKpiStats(ID.bizA, 7, ownerACtx);
    expect(kpiA.totalEvents).toBe(1);
    markInvoked('modules/business-events/business-event.service.ts::BusinessEventService.getKpiStats');

    // AiExecutionLogService (getHistory, getStats)
    const histA = await executionLog.getHistory(ID.bizA, {}, 50, 0, ownerACtx);
    expect(histA.logs.map((l: any) => l.id)).toEqual([`${P}ael_a`]);
    markInvoked('modules/ai/ai-execution-log.service.ts::AiExecutionLogService.getHistory');
    const statsA = await executionLog.getStats(ID.bizA, 30, ownerACtx);
    expect(statsA.totalActions).toBe(1);
    markInvoked('modules/ai/ai-execution-log.service.ts::AiExecutionLogService.getStats');

    // ProactiveSuggestionService & AgentController.getDetectedPatterns
    const sugsA = await proactiveSuggestions.getPendingSuggestions(ID.bizA, ownerACtx);
    expect(JSON.stringify(sugsA)).not.toContain('SECRET_B_');
    markInvoked('modules/ai/proactive-suggestion.service.ts::ProactiveSuggestionService.getPendingSuggestions');
    const patsA = await agentController.getDetectedPatterns(ID.bizA, { user: { id: ID.ownerA } } as any);
    expect(JSON.stringify(patsA)).not.toContain('SECRET_B_');
    markInvoked('modules/ai/agent.controller.ts::AgentController.getDetectedPatterns');

    // GenomeMemoryService (listMemoryEvents, getMemoryEvent, counts)
    const gmListA = await genomeMemoryService.listMemoryEvents(ID.bizA, { limit: 50 });
    expect(gmListA.map((g: any) => g.id)).toEqual([`${P}gm_a`]);
    markInvoked('modules/business-genome/key-genome/genome-memory.service.ts::GenomeMemoryService.listMemoryEvents');
    await expect(genomeMemoryService.getMemoryEvent(ID.bizA, `${P}gm_b`)).rejects.toThrow();
    expect(await genomeMemoryService.countRecentMemoryEvents(ID.bizA, 30)).toBe(1);
    markInvoked('modules/business-genome/key-genome/genome-memory.service.ts::GenomeMemoryService.countRecentMemoryEvents');
    expect(await genomeMemoryService.countRecentFailedOutcomes(ID.bizA, 30)).toBe(0);
    markInvoked('modules/business-genome/key-genome/genome-memory.service.ts::GenomeMemoryService.countRecentFailedOutcomes');

    // CognitiveEventBusService.list
    const cogEvA = await cognitiveEventBus.list(ID.bizA, { limit: 50 });
    expect(cogEvA.map((c: any) => c.id)).toEqual([`${P}ce_a`]);

    // KeyCortexSalienceService (raw SQL BusinessEvent countSignal isolated to bizA)
    const salienceA = await cortexSalienceService.appraise(ID.bizA);
    expect(JSON.stringify(salienceA)).not.toContain('SECRET_B_');
  });

  it('2. E-REV-DIRECT: direct revenue rows and monetary figures are withheld from revenue:none STAFF and visible to OWNER', async () => {
    const now = new Date();
    const future = new Date(Date.now() + 86_400_000);
    const revFigure = '$84,600.00';

    await db.aiMemory.createMany({
      data: [
        {
          id: `${P}am_gen`,
          businessId: ID.bizA,
          category: 'business_fact',
          key: 'hours',
          value: 'Studio open Tue-Sat 09:00-19:00',
          source: 'user',
          dataClass: 'GENERAL',
          moduleScope: [],
          createdAt: now,
        },
        {
          id: `${P}am_rev_dir`,
          businessId: ID.bizA,
          category: 'business_fact',
          key: 'q3_gross',
          value: `Q3 gross revenue reached ${revFigure}`,
          source: 'inferred',
          dataClass: 'REVENUE',
          moduleScope: ['revenue'],
          createdAt: now,
        },
        {
          id: `${P}am_pat_rev`,
          businessId: ID.bizA,
          category: 'patterns',
          key: 'rev_pat',
          value: JSON.stringify({ name: `Monthly invoice payouts average ${revFigure}` }),
          source: 'inferred',
          dataClass: 'REVENUE',
          moduleScope: ['revenue'],
          createdAt: now,
        },
        {
          id: `${P}am_sug_rev`,
          businessId: ID.bizA,
          category: 'suggestion',
          key: 'rev_sug',
          value: JSON.stringify({ id: `${P}sug_rev`, title: `Collect overdue ${revFigure}`, message: 'Invoice follow-up' }),
          source: 'inferred',
          dataClass: 'REVENUE',
          moduleScope: ['revenue'],
          expiresAt: future,
          createdAt: now,
        },
      ],
    });

    await insertEmbeddingRow({
      id: `${P}emb_gen`,
      businessId: ID.bizA,
      sourceType: 'memory',
      sourceId: `${P}am_gen`,
      content: 'Studio open Tue-Sat 09:00-19:00',
      metadata: { category: 'business_fact', key: 'hours' },
      dataClass: 'GENERAL',
      moduleScope: [],
    });
    await insertEmbeddingRow({
      id: `${P}emb_rev_dir`,
      businessId: ID.bizA,
      sourceType: 'memory',
      sourceId: `${P}am_rev_dir`,
      content: `Q3 gross revenue reached ${revFigure}`,
      metadata: { category: 'business_fact', key: 'q3_gross' },
      dataClass: 'REVENUE',
      moduleScope: ['revenue'],
    });

    await db.temporalFlowEvent.create({
      data: {
        id: `${P}tfe_crm_gen`,
        businessId: ID.bizA,
        source: 'crm',
        type: 'contact.updated',
        module: 'crm',
        entityType: 'contact',
        entityId: `${P}c1`,
        title: 'Updated contact preference',
        summary: 'Prefers morning appointment reminders',
        occurredAt: now,
      },
    });

    await db.temporalFlowMemory.createMany({
      data: [
        {
          id: `${P}tf_gen`,
          businessId: ID.bizA,
          entityType: 'contact',
          entityId: `${P}c1`,
          type: 'summary',
          content: 'Prefers morning appointment reminders',
          sourceModule: 'crm',
          sourceEventIds: [`${P}tfe_crm_gen`],
          metadata: {},
          confidence: 0.9,
          dataClass: 'GENERAL',
          moduleScope: ['crm'],
        },
        {
          id: `${P}tf_rev_dir`,
          businessId: ID.bizA,
          entityType: 'invoice',
          entityId: `${P}inv1`,
          type: 'summary',
          content: `Invoice INV-904 settled for ${revFigure}`,
          sourceModule: 'revenue',
          sourceEventIds: [],
          metadata: {},
          confidence: 0.9,
          dataClass: 'REVENUE',
          moduleScope: ['revenue'],
        },
      ],
    });

    await db.businessEvent.createMany({
      data: [
        {
          id: `${P}be_gen`,
          businessId: ID.bizA,
          eventType: 'contact.updated',
          subjectType: 'contact',
          subjectId: `${P}c1`,
          actorType: 'human',
          actorId: ID.ownerA,
          action: 'update',
          source: 'key_observation',
          correlationId: `${P}corr_rev`,
          metadata: { note: 'Updated email preference' },
          createdAt: now,
        },
        {
          id: `${P}be_rev`,
          businessId: ID.bizA,
          eventType: 'invoice.paid',
          subjectType: 'invoice',
          subjectId: `${P}inv1`,
          actorType: 'system',
          actorId: 'system',
          action: 'complete',
          source: 'key_observation',
          correlationId: `${P}corr_rev`,
          after: { amount: 84600, total: revFigure },
          metadata: { summary: `Paid ${revFigure}` },
          createdAt: now,
        },
      ],
    });

    await db.keyCortexMemory.create({
      data: {
        id: `${P}kc_refl_rev`,
        businessId: ID.bizA,
        type: 'reflection_session',
        key: `${P}refl_1`,
        userId: null,
        value: JSON.stringify({
          id: `${P}refl_1`,
          businessId: ID.bizA,
          period: 'daily',
          summary: `Q3 invoice revenue reached ${revFigure}`,
          insights: [{ title: 'Revenue milestone', detail: `Gross revenue ${revFigure}` }],
          hypotheses: [],
          createdAt: now.toISOString(),
        }),
        confidence: 0.9,
        createdAt: now,
      },
    });

    const staffCtx = { reader: ID.staffA, sight: STAFF_NO_REV_SIGHT };
    const ownerCtx = { reader: ID.ownerA, sight: OWNER_SIGHT };

    // STAFF without revenue:read sees ZERO direct revenue rows or figures
    expect((await aiMemory.getAll(ID.bizA, staffCtx)).map((r: any) => r.id)).toEqual([`${P}am_gen`]);
    expect(await aiMemory.get(ID.bizA, 'business_fact', 'q3_gross', staffCtx)).toBeNull();
    expect((await temporalMemory.findMany(ID.bizA, { limit: 50 }, staffCtx)).map((r: any) => r.id)).toEqual([`${P}tf_gen`]);
    expect(await temporalMemory.findById(ID.bizA, `${P}tf_rev_dir`, staffCtx)).toBeNull();
    expect((await temporalMemory.getStats(ID.bizA, staffCtx)).total).toBe(1);

    const staffTfSight = await temporalFlow.memorySight(ID.bizA, { id: ID.staffA });
    const staffTfList = await temporalFlow.listMemory(ID.bizA, { limit: 50 }, staffTfSight);
    expect(staffTfList.map((r: any) => r.id)).not.toContain(`${P}tf_rev_dir`);
    expect(JSON.stringify(staffTfList)).not.toContain(revFigure);
    const ownerTfSight = await temporalFlow.memorySight(ID.bizA, { id: ID.ownerA });
    expect((await temporalFlow.listMemory(ID.bizA, { limit: 50 }, ownerTfSight)).map((r: any) => r.id)).toContain(
      `${P}tf_rev_dir`,
    );

    const staffSem = await semantic.search({
      businessId: ID.bizA,
      query: 'studio revenue gross',
      limit: 20,
      minSimilarity: 0.1,
      visibleTo: readerSearchOptionsFn(prisma, ID.bizA, staffCtx).visibleTo,
    });
    expect(staffSem.map((h: any) => h.id)).toEqual([`${P}emb_gen`]);

    const staffUnified = await unifiedRetrieval.retrieveContext(ID.bizA, {
      limit: 50,
      boostRecency: false,
      readerContext: staffCtx,
      semanticSight: readerSearchOptionsFn(prisma, ID.bizA, staffCtx),
      query: 'studio revenue gross',
    });
    expect(JSON.stringify(staffUnified)).not.toContain(revFigure);
    expect(staffUnified.map((f: any) => f.id)).not.toContain(`${P}am_rev_dir`);
    expect(staffUnified.map((f: any) => f.id)).not.toContain(`${P}tf_rev_dir`);

    const staffTempV2 = await contextV2.getTemporalContext(ID.bizA, staffCtx);
    expect(JSON.stringify(staffTempV2)).not.toContain(revFigure);

    const staffSugs = await proactiveSuggestions.getPendingSuggestions(ID.bizA, staffCtx);
    expect(staffSugs).toEqual([]);
    const staffPats = await agentController.getDetectedPatterns(ID.bizA, { user: { id: ID.staffA } } as any);
    expect(JSON.stringify(staffPats)).not.toContain(revFigure);

    const staffAudit = await businessEventService.getAuditTrail(ID.bizA, { limit: 50 }, staffCtx);
    expect(staffAudit.events.map((e: any) => e.id)).toEqual([`${P}be_gen`]);
    expect((await businessEventService.getKpiStats(ID.bizA, 7, staffCtx)).totalEvents).toBe(1);

    const staffCortexEvs = await cortexEventService.getEvents(ID.bizA, { limit: 50 }, staffCtx);
    expect(staffCortexEvs.map((e: any) => e.id)).toEqual([`${P}be_gen`]);
    const staffChain = await cortexEventService.getEventChain(ID.bizA, `${P}corr_rev`, staffCtx);
    expect(staffChain.map((e: any) => e.id)).toEqual([`${P}be_gen`]);

    const staffEthics = await cortexEthicsService.explainDecision(`${P}be_rev`, ID.bizA, staffCtx);
    expect(staffEthics).not.toContain(revFigure);

    const staffRefl = await cortexReflectionService.getLastReflectionSession(ID.bizA, staffCtx);
    expect(JSON.stringify(staffRefl ?? null)).not.toContain(revFigure);
    markInvoked('modules/key-cortex/key-cortex-reflection.service.ts::KeyCortexReflectionService.getLastReflectionSession');

    // OWNER with full scopes DOES see the authorized REVENUE rows (proves test is non-vacuous)
    expect((await aiMemory.getAll(ID.bizA, ownerCtx)).map((r: any) => r.id)).toContain(`${P}am_rev_dir`);
    expect((await temporalMemory.findMany(ID.bizA, { limit: 50 }, ownerCtx)).map((r: any) => r.id)).toContain(`${P}tf_rev_dir`);
    const ownerAudit = await businessEventService.getAuditTrail(ID.bizA, { limit: 50 }, ownerCtx);
    expect(ownerAudit.events.map((e: any) => e.id)).toContain(`${P}be_rev`);
  });

  it('3. E-REV-INDIRECT: zero-keyword derived revenue summaries, high-value-client facts, patterns, and suggestions are withheld from revenue:none STAFF', async () => {
    const now = new Date();
    const future = new Date(Date.now() + 86_400_000);
    const derivedText = 'Account Meridian Health belongs to the executive priority tier';

    await db.aiMemory.createMany({
      data: [
        {
          id: `${P}am_ind_gen`,
          businessId: ID.bizA,
          category: 'goals',
          key: 'g_open',
          value: 'Host spring wellness workshop',
          source: 'user',
          dataClass: 'GENERAL',
          moduleScope: [],
          createdAt: now,
        },
        {
          id: `${P}am_ind_rev`,
          businessId: ID.bizA,
          category: 'business_fact',
          key: 'meridian_tier',
          value: derivedText,
          source: 'inferred',
          dataClass: 'REVENUE',
          moduleScope: ['revenue'],
          createdAt: now,
        },
        {
          id: `${P}am_ind_pat`,
          businessId: ID.bizA,
          category: 'patterns',
          key: 'meridian_pat',
          value: JSON.stringify({ name: `Priority cohort: ${derivedText}` }),
          source: 'inferred',
          dataClass: 'REVENUE',
          moduleScope: ['crm', 'revenue'],
          createdAt: now,
        },
        {
          id: `${P}am_ind_sug`,
          businessId: ID.bizA,
          category: 'suggestion',
          key: 'meridian_sug',
          value: JSON.stringify({ id: `${P}ind_sug`, title: 'VIP outreach', message: derivedText }),
          source: 'inferred',
          dataClass: 'REVENUE',
          moduleScope: ['crm', 'revenue'],
          expiresAt: future,
          createdAt: now,
        },
      ],
    });

    await db.temporalFlowMemory.create({
      data: {
        id: `${P}tf_ind_rev`,
        businessId: ID.bizA,
        entityType: 'contact',
        entityId: `${P}c_meridian`,
        type: 'summary',
        content: derivedText,
        sourceModule: 'crm',
        sourceEventIds: [],
        metadata: {},
        confidence: 0.9,
        dataClass: 'REVENUE',
        moduleScope: ['crm', 'revenue'],
      },
    });

    await insertEmbeddingRow({
      id: `${P}emb_ind_rev`,
      businessId: ID.bizA,
      sourceType: 'memory',
      sourceId: `${P}am_ind_rev`,
      content: derivedText,
      metadata: { category: 'business_fact', key: 'meridian_tier' },
      dataClass: 'REVENUE',
      moduleScope: ['revenue'],
    });
    await insertEmbeddingRow({
      id: `${P}emb_ind_gen`,
      businessId: ID.bizA,
      sourceType: 'memory',
      sourceId: `${P}am_ind_gen`,
      content: 'Host spring wellness workshop',
      metadata: { category: 'goals', key: 'g_open' },
      dataClass: 'GENERAL',
      moduleScope: [],
    });

    const staffCtx = { reader: ID.staffA, sight: STAFF_NO_REV_SIGHT };
    const ownerCtx = { reader: ID.ownerA, sight: OWNER_SIGHT };

    expect((await aiMemory.getAll(ID.bizA, staffCtx)).map((r: any) => r.id)).toEqual([`${P}am_ind_gen`]);
    expect((await temporalMemory.findMany(ID.bizA, { limit: 50 }, staffCtx)).map((r: any) => r.id)).toEqual([]);
    expect((await contextV2.getTemporalContext(ID.bizA, staffCtx)).recentMemories).toEqual([]);
    expect(await proactiveSuggestions.getPendingSuggestions(ID.bizA, staffCtx)).toEqual([]);
    const staffPats = await agentController.getDetectedPatterns(ID.bizA, { user: { id: ID.staffA } } as any);
    expect(JSON.stringify(staffPats)).not.toContain('Meridian Health');

    const staffSem = await semantic.search({
      businessId: ID.bizA,
      query: 'Meridian workshop',
      limit: 10,
      minSimilarity: 0.1,
      visibleTo: readerSearchOptionsFn(prisma, ID.bizA, staffCtx).visibleTo,
    });
    expect(staffSem.map((h: any) => h.id)).toEqual([`${P}emb_ind_gen`]);

    const staffUnified = await unifiedRetrieval.retrieveContext(ID.bizA, {
      limit: 20,
      boostRecency: false,
      readerContext: staffCtx,
      semanticSight: readerSearchOptionsFn(prisma, ID.bizA, staffCtx),
      query: 'Meridian workshop',
    });
    expect(JSON.stringify(staffUnified)).not.toContain('Meridian Health');

    // OWNER sees the derived revenue items cleanly
    expect((await aiMemory.getAll(ID.bizA, ownerCtx)).map((r: any) => r.id)).toContain(`${P}am_ind_rev`);
    expect((await temporalMemory.findMany(ID.bizA, { limit: 50 }, ownerCtx)).map((r: any) => r.id)).toEqual([`${P}tf_ind_rev`]);
  });

  it('4. E-MEMBERLESS: missing-actor / background and foreign-tenant callers fail closed across memory readers', async () => {
    const now = new Date();
    await db.aiMemory.createMany({
      data: [
        {
          id: `${P}am_ml_rev`,
          businessId: ID.bizA,
          category: 'business_fact',
          key: 'rev_secret',
          value: 'Q3 revenue $84,600',
          source: 'inferred',
          dataClass: 'REVENUE',
          moduleScope: ['revenue'],
          createdAt: now,
        },
        {
          id: `${P}am_ml_unclass`,
          businessId: ID.bizA,
          category: 'custom',
          key: 'unclass_note',
          value: 'Unclassified background row',
          source: 'inferred',
          dataClass: 'UNCLASSIFIED',
          moduleScope: [],
          createdAt: now,
        },
        {
          id: `${P}am_ml_sec`,
          businessId: ID.bizA,
          category: 'business_fact',
          key: 'vault',
          value: 'Vault token sk_live_51NxAbCdEfGhIjKlMnOpQr',
          source: 'user',
          dataClass: 'SECRET_BEARING',
          moduleScope: ['ai'],
          createdAt: now,
        },
      ],
    });

    await db.cognitionMemory.create({
      data: {
        id: `${P}cog_ml`,
        businessId: ID.bizA,
        sessionId: `${P}sess_ml`,
        userId: ID.ownerA,
        query: 'Owner query',
        recommendation: 'Owner rec',
        userResponse: 'accepted',
        confidence: 0.9,
        lessonsLearned: ['Owner private cognition lesson'],
        createdAt: now,
      },
    });

    await db.cortexActionLog.create({
      data: {
        id: `${P}cal_ml`,
        businessId: ID.bizA,
        sessionId: `${P}sess_ml`,
        userId: ID.ownerA,
        actionType: 'crm.update_contact',
        status: 'success',
        description: 'Updated contact notes',
        createdAt: now,
      },
    });

    await db.aiExecutionLog.create({
      data: {
        id: `${P}ael_ml`,
        businessId: ID.bizA,
        userId: ID.ownerA,
        action: 'commerce.create_invoice',
        toolName: 'commerce_create_invoice',
        module: 'revenue',
        rationale: 'Created invoice for $6,200',
        success: true,
        createdAt: now,
      },
    });

    // Resolve sight from DB for both null actor and Foreign Owner B (non-member of bizA!)
    const memberlessSight = await readersModuleSightFn(prisma, ID.bizA, null);
    const foreignSight = await readersModuleSightFn(prisma, ID.bizA, ID.ownerB);
    expect(memberlessSight('revenue')).toBe(false);
    expect(memberlessSight('crm')).toBe(false);
    expect(foreignSight('revenue')).toBe(false);
    expect(foreignSight('crm')).toBe(false);

    const memberlessCtx = { reader: null, sight: BLIND_SIGHT };
    const foreignCtx = { reader: ID.ownerB, sight: foreignSight };

    for (const ctx of [memberlessCtx, foreignCtx]) {
      expect(await aiMemory.getAll(ID.bizA, ctx)).toEqual([]);
      expect(await temporalMemory.findMany(ID.bizA, { limit: 50 }, ctx)).toEqual([]);
      expect(
        await unifiedRetrieval.retrieveContext(ID.bizA, {
          limit: 50,
          boostRecency: false,
          readerContext: ctx,
          semanticSight: readerSearchOptionsFn(prisma, ID.bizA, ctx),
          query: 'revenue owner invoice',
        }),
      ).toEqual([]);
      expect(
        await learningService.retrieveLessons(ID.bizA, 'Owner query', {
          readerContext: ctx,
        }),
      ).toEqual([]);
      expect(await cortexActionsService.getActionHistory(`${P}sess_ml`, ctx)).toEqual([]);
      expect((await executionLog.getHistory(ID.bizA, {}, 50, 0, ctx)).logs).toEqual([]);
      const ownCog = await readersOwnCognitionMemoryFn(prisma, ID.bizA, ctx.reader, [
        { id: `${P}cog_ml`, sourceType: 'cognition_memory' },
      ]);
      expect(ownCog.size).toBe(0);
    }

    // Foreign Owner B calling AgentController.getDetectedPatterns on bizA fails closed
    const foreignPats = await agentController.getDetectedPatterns(ID.bizA, { user: { id: ID.ownerB } } as any);
    expect(foreignPats).toEqual({ patterns: [] });
  });

  it('5. E-UNCLASS: UNCLASSIFIED, legacy financial NULL, legacy document embeddings, unknown dataClass, invalid moduleScope, and SECRET_BEARING fail closed', async () => {
    const now = new Date();
    await db.aiMemory.createMany({
      data: [
        {
          id: `${P}am_u_ok`,
          businessId: ID.bizA,
          category: 'tone',
          key: 'tone_ok',
          value: 'Warm and concise tone',
          source: 'user',
          dataClass: 'GENERAL',
          moduleScope: [],
          createdAt: now,
        },
        {
          id: `${P}am_u_unclass`,
          businessId: ID.bizA,
          category: 'misc',
          key: 'u_row',
          value: 'Unclassified mystery fact',
          source: 'inferred',
          dataClass: 'UNCLASSIFIED',
          moduleScope: [],
          createdAt: now,
        },
        {
          id: `${P}am_u_unknown`,
          businessId: ID.bizA,
          category: 'tone',
          key: 'u_bad_class',
          value: 'Unrecognized class row',
          source: 'user',
          dataClass: 'TOP_SECRET_UNKNOWN',
          moduleScope: [],
          createdAt: now,
        },
        {
          id: `${P}am_u_bad_scope`,
          businessId: ID.bizA,
          category: 'tone',
          key: 'u_bad_scope',
          value: 'Row with unknown module scope',
          source: 'user',
          dataClass: 'GENERAL',
          moduleScope: ['nonexistent_secret_module'],
          createdAt: now,
        },
        {
          id: `${P}am_u_secret`,
          businessId: ID.bizA,
          category: 'business_fact',
          key: 'u_secret',
          value: 'Vault key sk_live_51NxAbCdEfGhIjKlMnOpQr',
          source: 'user',
          dataClass: 'SECRET_BEARING',
          moduleScope: ['ai'],
          createdAt: now,
        },
      ],
    });

    await db.knowledgeSource.create({
      data: {
        id: ID.ksDocA,
        businessId: ID.bizA,
        title: 'Legacy Unclassified Playbook',
        sourceType: 'text',
        content: 'Confidential owner margin targets',
        status: 'ready',
      },
    });
    await insertEmbeddingRow({
      id: `${P}emb_u_doc_null`,
      businessId: ID.bizA,
      sourceType: 'document',
      sourceId: `${ID.ksDocA}:0`,
      content: 'Confidential owner margin targets',
      metadata: { title: 'Legacy Unclassified Playbook' },
      dataClass: null,
      moduleScope: null,
    });
    await insertEmbeddingRow({
      id: `${P}emb_u_ok`,
      businessId: ID.bizA,
      sourceType: 'memory',
      sourceId: `${P}am_u_ok`,
      content: 'Warm and concise tone',
      metadata: { category: 'tone', key: 'tone_ok' },
      dataClass: 'GENERAL',
      moduleScope: [],
    });

    const staffCtx = { reader: ID.staffA, sight: STAFF_NO_REV_SIGHT };
    const ownerCtx = { reader: ID.ownerA, sight: OWNER_SIGHT };

    // STAFF sees ONLY am_u_ok (UNCLASSIFIED, TOP_SECRET_UNKNOWN, invalid moduleScope, SECRET_BEARING all fail closed)
    expect((await aiMemory.getAll(ID.bizA, staffCtx)).map((r: any) => r.id)).toEqual([`${P}am_u_ok`]);

    // Legacy NULL document embedding fails closed for STAFF
    const staffSem = await semantic.search({
      businessId: ID.bizA,
      query: 'margin tone',
      limit: 10,
      minSimilarity: 0.1,
      visibleTo: readerSearchOptionsFn(prisma, ID.bizA, staffCtx).visibleTo,
    });
    expect(staffSem.map((h: any) => h.id)).toEqual([`${P}emb_u_ok`]);

    // Even OWNER never receives SECRET_BEARING, unknown dataClass, or invalid moduleScope
    const ownerIds = (await aiMemory.getAll(ID.bizA, ownerCtx)).map((r: any) => r.id).sort();
    expect(ownerIds).toEqual([`${P}am_u_ok`, `${P}am_u_unclass`]);
    expect(ownerIds).not.toContain(`${P}am_u_secret`);
    expect(ownerIds).not.toContain(`${P}am_u_unknown`);
    expect(ownerIds).not.toContain(`${P}am_u_bad_scope`);
  });

  it('6. E-MEMBER (D-130): member cognition, personal KeyCortexMemory, and episodic action/execution rows stay strictly scoped to owning member', async () => {
    const now = new Date();
    const sharedSession = `${P}sess_shared`;

    await db.cognitionMemory.createMany({
      data: [
        {
          id: `${P}cog_owner`,
          businessId: ID.bizA,
          sessionId: `${P}sess_o`,
          userId: ID.ownerA,
          query: 'Owner personal reflection',
          recommendation: 'Owner plan',
          userResponse: 'accepted',
          confidence: 0.9,
          lessonsLearned: ['Owner private cognition'],
          createdAt: now,
        },
        {
          id: `${P}cog_staff1`,
          businessId: ID.bizA,
          sessionId: `${P}sess_s1`,
          userId: ID.staffA,
          query: 'Staff1 personal reflection',
          recommendation: 'Staff1 plan',
          userResponse: 'accepted',
          confidence: 0.9,
          lessonsLearned: ['Staff1 private cognition'],
          createdAt: now,
        },
        {
          id: `${P}cog_staff2`,
          businessId: ID.bizA,
          sessionId: `${P}sess_s2`,
          userId: ID.staffA2,
          query: 'Staff2 personal reflection',
          recommendation: 'Staff2 plan',
          userResponse: 'accepted',
          confidence: 0.9,
          lessonsLearned: ['Staff2 private cognition'],
          createdAt: now,
        },
      ],
    });

    await db.keyCortexMemory.createMany({
      data: [
        {
          id: `${P}kc_shared`,
          businessId: ID.bizA,
          type: 'weak_signal',
          key: `${P}ws_shared`,
          userId: null,
          value: JSON.stringify({ description: 'Shared booking cadence signal' }),
          confidence: 0.85,
          createdAt: now,
        },
        {
          id: `${P}kc_owner`,
          businessId: ID.bizA,
          type: 'weak_signal',
          key: `${P}ws_owner`,
          userId: ID.ownerA,
          value: JSON.stringify({ description: 'Owner private weak signal' }),
          confidence: 0.9,
          createdAt: now,
        },
        {
          id: `${P}kc_staff1`,
          businessId: ID.bizA,
          type: 'weak_signal',
          key: `${P}ws_staff1`,
          userId: ID.staffA,
          value: JSON.stringify({ description: 'Staff1 private weak signal' }),
          confidence: 0.9,
          createdAt: now,
        },
      ],
    });

    await db.cortexActionLog.createMany({
      data: [
        {
          id: `${P}cal_owner`,
          businessId: ID.bizA,
          sessionId: sharedSession,
          userId: ID.ownerA,
          actionType: 'crm.update_contact',
          status: 'success',
          description: 'Owner private action',
          createdAt: now,
        },
        {
          id: `${P}cal_staff1`,
          businessId: ID.bizA,
          sessionId: sharedSession,
          userId: ID.staffA,
          actionType: 'crm.update_contact',
          status: 'success',
          description: 'Staff1 private action',
          createdAt: now,
        },
      ],
    });

    await db.aiExecutionLog.createMany({
      data: [
        {
          id: `${P}ael_owner`,
          businessId: ID.bizA,
          userId: ID.ownerA,
          action: 'crm.update_contact',
          toolName: 'crm_update_contact',
          module: 'crm',
          role: 'operations',
          rationale: 'Owner private log',
          success: true,
          createdAt: now,
        },
        {
          id: `${P}ael_staff1`,
          businessId: ID.bizA,
          userId: ID.staffA,
          action: 'crm.update_contact',
          toolName: 'crm_update_contact',
          module: 'crm',
          role: 'operations',
          rationale: 'Staff1 private log',
          success: true,
          createdAt: now,
        },
      ],
    });

    const ownerCtx = viewerMemoryReaderContextFn({
      userId: ID.ownerA,
      businessId: ID.bizA,
      role: 'OWNER',
      superAdmin: false,
      scopes: { crm: 'admin', bookings: 'admin', revenue: 'admin', expenses: 'admin', ai: 'admin' },
      member: true,
    });
    const staff1Ctx = viewerMemoryReaderContextFn({
      userId: ID.staffA,
      businessId: ID.bizA,
      role: 'STAFF',
      superAdmin: false,
      scopes: { crm: 'read', bookings: 'read', revenue: 'none', expenses: 'none', ai: 'none' },
      member: true,
    });
    const staff2Ctx = viewerMemoryReaderContextFn({
      userId: ID.staffA2,
      businessId: ID.bizA,
      role: 'STAFF',
      superAdmin: false,
      scopes: { crm: 'read', bookings: 'none', revenue: 'none', expenses: 'none', ai: 'none' },
      member: true,
    });

    // UnifiedMemoryRetrievalService: strict ownerUserId === actor.id even for OWNER
    expect(
      (await unifiedRetrieval.retrieveContext(ID.bizA, { limit: 20, sourceTypes: ['cognition_memory'], readerContext: ownerCtx })).map(
        (f: any) => f.id,
      ),
    ).toEqual([`${P}cog_owner`]);
    expect(
      (await unifiedRetrieval.retrieveContext(ID.bizA, { limit: 20, sourceTypes: ['cognition_memory'], readerContext: staff1Ctx })).map(
        (f: any) => f.id,
      ),
    ).toEqual([`${P}cog_staff1`]);
    expect(
      (await unifiedRetrieval.retrieveContext(ID.bizA, { limit: 20, sourceTypes: ['cognition_memory'], readerContext: staff2Ctx })).map(
        (f: any) => f.id,
      ),
    ).toEqual([`${P}cog_staff2`]);

    // KeyCortexLearningService.retrieveLessons
    expect(await learningService.retrieveLessons(ID.bizA, 'personal reflection', { userId: ID.ownerA, readerContext: ownerCtx })).toEqual([
      '[accepted] Owner private cognition',
    ]);
    expect(await learningService.retrieveLessons(ID.bizA, 'personal reflection', { userId: ID.staffA, readerContext: staff1Ctx })).toEqual([
      '[accepted] Staff1 private cognition',
    ]);

    // readersOwnCognitionMemory + readersOwnPromptMemory
    const staff1OwnIds = await readersOwnCognitionMemoryFn(prisma, ID.bizA, ID.staffA, [
      { id: `${P}cog_owner`, sourceType: 'cognition_memory' },
      { id: `${P}cog_staff1`, sourceType: 'cognition_memory' },
      { id: `${P}cog_staff2`, sourceType: 'cognition_memory' },
    ]);
    expect([...staff1OwnIds]).toEqual([`${P}cog_staff1`]);
    markInvoked('modules/key-cortex/key-cortex-prompt-context.service.ts::readersOwnCognitionMemory');

    const promptKept = await readersOwnPromptMemoryFn(
      prisma,
      ID.bizA,
      ID.staffA,
      [
        { id: `${P}cog_owner`, sourceType: 'cognition_memory', content: 'Owner private cognition' },
        { id: `${P}cog_staff1`, sourceType: 'cognition_memory', content: 'Staff1 private cognition' },
      ],
      10,
      undefined,
      'v92a_member',
      STAFF_NO_REV_SIGHT,
    );
    expect(promptKept.map((f: any) => f.id)).toEqual([`${P}cog_staff1`]);

    // KeyCortexAwarenessService: personal KeyCortexMemory isolated per user
    const ownerAw = await awarenessService.getAwareness(ID.bizA, {
      kinds: ['weakSignal'],
      readsRevenue: true,
      readerContext: ownerCtx,
    });
    expect(ownerAw.items.map((i: any) => i.id).sort()).toEqual([`${P}ws_owner`, `${P}ws_shared`]);
    const staff1Aw = await awarenessService.getAwareness(ID.bizA, {
      kinds: ['weakSignal'],
      readsRevenue: false,
      readerContext: staff1Ctx,
    });
    expect(staff1Aw.items.map((i: any) => i.id).sort()).toEqual([`${P}ws_shared`, `${P}ws_staff1`]);

    // KeyCortexActionsService.getActionHistory: personal CortexActionLog isolated per user
    const staff1Actions = await cortexActionsService.getActionHistory(sharedSession, staff1Ctx);
    expect(staff1Actions.map((a: any) => a.description)).toEqual(['Staff1 private action']);
    const ownerActions = await cortexActionsService.getActionHistory(sharedSession, ownerCtx);
    expect(ownerActions.map((a: any) => a.description)).toEqual(['Owner private action']);

    // AiExecutionLogService + RoleEngineService.getRoleContext
    const staff1Logs = await executionLog.getHistory(ID.bizA, {}, 20, 0, staff1Ctx);
    expect(staff1Logs.logs.map((l: any) => l.id)).toEqual([`${P}ael_staff1`]);
    const staff1RoleCtx = await roleEngine.getRoleContext(ID.bizA, 'operations', staff1Ctx);
    expect(JSON.stringify(staff1RoleCtx)).not.toContain('Owner private log');
    markInvoked('modules/ai/role-engine.service.ts::RoleEngineService.getRoleContext');
  });

  it('7. Complete projected reader coverage: AiController.servedExecutionLogPage, KeyGenomeGovernanceService.summary, Creativity, WeeklyReflection, Endocrine.hydrate, Immune.load, Salience.countSignal + describeForPrompt, and TemporalFlow.visibleMemoryIds', async () => {
    const now = new Date();
    const weekStart = new Date(now.getTime() - 7 * 86_400_000);
    const weekEnd = new Date(now.getTime() + 60_000);
    const ownerCtx = viewerMemoryReaderContextFn({
      userId: ID.ownerA,
      businessId: ID.bizA,
      role: 'OWNER',
      superAdmin: false,
      scopes: { crm: 'admin', bookings: 'admin', revenue: 'admin', expenses: 'admin', ai: 'admin' },
      member: true,
    });
    const staffCtx = viewerMemoryReaderContextFn({
      userId: ID.staffA,
      businessId: ID.bizA,
      role: 'STAFF',
      superAdmin: false,
      scopes: { crm: 'read', bookings: 'read', revenue: 'none', expenses: 'none', ai: 'none' },
      member: true,
    });

    // 7a. AiController.servedExecutionLogPage (owner vs non-revenue staff vs foreign tenant)
    await db.aiExecutionLog.createMany({
      data: [
        {
          id: `${P}ael_ctrl_crm`,
          businessId: ID.bizA,
          userId: ID.staffA,
          action: 'crm.update_contact',
          toolName: 'crm_update_contact',
          module: 'crm',
          rationale: 'Staff CRM update',
          success: true,
          createdAt: now,
        },
        {
          id: `${P}ael_ctrl_rev`,
          businessId: ID.bizA,
          userId: ID.ownerA,
          action: 'commerce.create_invoice',
          toolName: 'commerce_create_invoice',
          module: 'revenue',
          rationale: 'Owner invoice $84,600',
          success: true,
          createdAt: now,
        },
        {
          id: `${P}ael_ctrl_b`,
          businessId: ID.bizB,
          userId: ID.ownerB,
          action: 'crm.update_contact',
          toolName: 'crm_update_contact',
          module: 'crm',
          rationale: 'Tenant B SECRET_B_CTRL_LOG',
          success: true,
          createdAt: now,
        },
      ],
    });
    const ownerExecPage = await aiController.getExecutionLogs(ID.bizA, { user: { id: ID.ownerA, role: 'USER' } } as any);
    expect(ownerExecPage.logs.map((l: any) => l.id).sort()).toEqual([`${P}ael_ctrl_crm`, `${P}ael_ctrl_rev`]);
    expect(JSON.stringify(ownerExecPage)).not.toContain('SECRET_B_CTRL_LOG');
    const staffExecPage = await aiController.getExecutionLogs(ID.bizA, { user: { id: ID.staffA, role: 'USER' } } as any);
    expect(staffExecPage.logs.map((l: any) => l.id)).toEqual([`${P}ael_ctrl_crm`]);
    expect(JSON.stringify(staffExecPage)).not.toContain('$84,600');
    const foreignExecPage = await aiController.getExecutionLogs(ID.bizA, { user: { id: ID.ownerB, role: 'USER' } } as any);
    expect(foreignExecPage.logs).toEqual([]);
    markInvoked('modules/ai/ai.controller.ts::AiController.servedExecutionLogPage');

    // 7b. KeyGenomeGovernanceService.summary (owner vs non-revenue staff + cross-tenant)
    await db.genomeMemoryEvent.createMany({
      data: [
        {
          id: `${P}gm_gov_crm`,
          businessId: ID.bizA,
          sourceType: 'crm',
          eventType: 'LESSON_LEARNED',
          domain: 'crm',
          section: 'CUSTOMER_MODEL',
          title: 'CRM follow-up cadence',
          summary: 'Clients respond well to Tuesday check-ins',
          outcome: 'SUCCESS',
          impactScore: 0.7,
          occurredAt: now,
          createdAt: now,
        },
        {
          id: `${P}gm_gov_fin`,
          businessId: ID.bizA,
          sourceType: 'finance',
          eventType: 'REVENUE_MILESTONE',
          domain: 'finance',
          section: 'FINANCIAL',
          title: 'Q3 revenue reached $84,600',
          summary: 'Revenue target exceeded with $84,600 gross',
          outcome: 'SUCCESS',
          impactScore: 0.9,
          occurredAt: now,
          createdAt: now,
        },
        {
          id: `${P}gm_gov_b`,
          businessId: ID.bizB,
          sourceType: 'crm',
          eventType: 'LESSON_LEARNED',
          domain: 'crm',
          section: 'CUSTOMER_MODEL',
          title: 'Tenant B SECRET_B_GOV_EVENT',
          summary: 'Tenant B marine note',
          outcome: 'FAILURE',
          impactScore: 0.8,
          occurredAt: now,
          createdAt: now,
        },
      ],
    });
    const ownerGov = await genomeGovernanceService.summary(ID.bizA, { readsRevenue: true });
    expect(ownerGov.counts.memoryEventsLast7Days).toBe(2);
    expect(JSON.stringify(ownerGov)).not.toContain('SECRET_B_GOV_EVENT');
    const staffGov = await genomeGovernanceService.summary(ID.bizA, { readsRevenue: false });
    expect(staffGov.counts.memoryEventsLast7Days).toBe(1);
    expect(JSON.stringify(staffGov)).not.toContain('$84,600');
    expect(JSON.stringify(staffGov)).not.toContain('SECRET_B_GOV_EVENT');
    markInvoked('modules/business-genome/key-genome/key-genome-governance.service.ts::KeyGenomeGovernanceService.summary');

    // 7c. KeyCortexCreativityService.recentWeakSignals (seeded bizA general/rev/personal/secret + bizB)
    await db.keyCortexMemory.createMany({
      data: [
        {
          id: `${P}kc_cr_gen`,
          businessId: ID.bizA,
          type: 'weak_signal',
          key: `${P}cr_gen`,
          userId: null,
          value: JSON.stringify({ description: 'Tuesday booking fill rate rising' }),
          confidence: 0.9,
          createdAt: now,
        },
        {
          id: `${P}kc_cr_rev`,
          businessId: ID.bizA,
          type: 'weak_signal',
          key: `${P}cr_rev`,
          userId: null,
          value: JSON.stringify({ description: 'Q3 invoice revenue $84,600 spike' }),
          confidence: 0.95,
          createdAt: now,
        },
        {
          id: `${P}kc_cr_priv`,
          businessId: ID.bizA,
          type: 'weak_signal',
          key: `${P}cr_priv`,
          userId: ID.ownerA,
          value: JSON.stringify({ description: 'Owner private studio expansion signal' }),
          confidence: 0.92,
          createdAt: now,
        },
        {
          id: `${P}kc_cr_b`,
          businessId: ID.bizB,
          type: 'weak_signal',
          key: `${P}cr_b`,
          userId: null,
          value: JSON.stringify({ description: 'Tenant B SECRET_B_CREATIVITY_SIGNAL' }),
          confidence: 0.99,
          createdAt: now,
        },
      ],
    });
    const staffCreative = await (cortexCreativityService as any).recentWeakSignals(ID.bizA, staffCtx);
    expect(staffCreative.map((s: any) => s.description)).toEqual(['Tuesday booking fill rate rising']);
    expect(JSON.stringify(staffCreative)).not.toContain('SECRET_B_');
    const ownerCreative = await (cortexCreativityService as any).recentWeakSignals(ID.bizA, ownerCtx);
    expect(ownerCreative.length).toBe(3);
    expect(JSON.stringify(ownerCreative)).not.toContain('SECRET_B_');
    markInvoked('modules/key-cortex/key-cortex-creativity.service.ts::KeyCortexCreativityService.recentWeakSignals');

    // 7d. KeyCortexReflectionService.getWeeklySessions (bizA revenue reflection + bizB)
    await db.keyCortexMemory.createMany({
      data: [
        {
          id: `${P}kc_wk_a`,
          businessId: ID.bizA,
          type: 'reflection_session',
          key: `${P}wk_a`,
          userId: null,
          value: JSON.stringify({
            type: 'reflection',
            startedAt: now.toISOString(),
            durationMs: 120,
            insights: [{ id: 'i1', type: 'pattern', description: 'Weekly revenue $84,600 review', confidence: 0.9, dataPoints: [], priority: 'high' }],
            actionsTaken: [],
          }),
          confidence: 0.9,
          createdAt: now,
        },
        {
          id: `${P}kc_wk_b`,
          businessId: ID.bizB,
          type: 'reflection_session',
          key: `${P}wk_b`,
          userId: null,
          value: JSON.stringify({
            type: 'reflection',
            startedAt: now.toISOString(),
            durationMs: 100,
            insights: [{ id: 'i2', type: 'pattern', description: 'Tenant B SECRET_B_WEEKLY_REFLECTION', confidence: 0.9, dataPoints: [], priority: 'high' }],
            actionsTaken: [],
          }),
          confidence: 0.9,
          createdAt: now,
        },
      ],
    });
    const staffWeekly = await (cortexReflectionService as any).getWeeklySessions(ID.bizA, weekStart, weekEnd, staffCtx);
    expect(staffWeekly).toEqual([]);
    const ownerWeekly = await (cortexReflectionService as any).getWeeklySessions(ID.bizA, weekStart, weekEnd, ownerCtx);
    expect(ownerWeekly.map((s: any) => s.id)).toEqual([`${P}wk_a`]);
    expect(JSON.stringify(ownerWeekly)).not.toContain('SECRET_B_WEEKLY_REFLECTION');
    markInvoked('modules/key-cortex/key-cortex-reflection.service.ts::KeyCortexReflectionService.getWeeklySessions');

    // 7e. KeyCortexEndocrineService.hydrate (non-vacuous: seed real hormone rows on bizA & bizB, await hydrate)
    await db.keyCortexMemory.createMany({
      data: [
        {
          id: `${P}kc_endo_a`,
          businessId: ID.bizA,
          type: 'endocrine_state',
          key: 'hormones',
          userId: null,
          value: JSON.stringify([
            { name: 'cortisol', level: 0.48, reasons: ['Tenant A booking backlog'], updatedAt: now.toISOString() },
          ]),
          source: 'endocrine',
          confidence: 0.9,
          createdAt: now,
        },
        {
          id: `${P}kc_endo_b`,
          businessId: ID.bizB,
          type: 'endocrine_state',
          key: 'hormones',
          userId: null,
          value: JSON.stringify([
            { name: 'malaise', level: 0.85, reasons: ['Tenant B SECRET_B_HORMONE'], updatedAt: now.toISOString() },
          ]),
          source: 'endocrine',
          confidence: 0.9,
          createdAt: now,
        },
      ],
    });
    const freshEndocrine = new KeyCortexEndocrineServiceCtor(prisma);
    await freshEndocrine.hydrate(ID.bizA);
    const endoOwner = freshEndocrine.readFor(ID.bizA, OWNER_SIGHT, now);
    expect(endoOwner.length).toBe(1);
    expect(endoOwner[0].name).toBe('cortisol');
    expect(JSON.stringify(endoOwner)).not.toContain('SECRET_B_HORMONE');
    // Hydrated levels without module provenance fail closed for restricted STAFF sight
    expect(freshEndocrine.readFor(ID.bizA, STAFF_NO_REV_SIGHT, now)).toEqual([]);
    markInvoked('modules/key-cortex/key-cortex-endocrine.service.ts::KeyCortexEndocrineService.hydrate');

    // 7f. KeyCortexImmuneService.load (non-vacuous: seed real bizA benign + bizA secret canary + bizB incident)
    await db.keyCortexMemory.createMany({
      data: [
        {
          id: `${P}kc_imm_a`,
          businessId: ID.bizA,
          type: 'immune_incident',
          key: `${P}imm_a`,
          userId: null,
          value: JSON.stringify({
            anomalyType: 'burst_updates',
            actorId: ID.staffA,
            encounters: 2,
            firstSeen: now.toISOString(),
            lastSeen: now.toISOString(),
            severity: 0.6,
            details: { note: 'Tenant A benign anomaly' },
          }),
          confidence: 0.9,
          createdAt: now,
        },
        {
          id: `${P}kc_imm_sec`,
          businessId: ID.bizA,
          type: 'immune_incident',
          key: `${P}imm_sec`,
          userId: null,
          value: JSON.stringify({
            anomalyType: 'credential_leak',
            actorId: ID.staffA,
            encounters: 1,
            firstSeen: now.toISOString(),
            lastSeen: now.toISOString(),
            severity: 0.9,
            details: { raw: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ2OTJhIn0.sig1234567890' },
          }),
          confidence: 0.9,
          createdAt: now,
        },
        {
          id: `${P}kc_imm_b`,
          businessId: ID.bizB,
          type: 'immune_incident',
          key: `${P}imm_b`,
          userId: null,
          value: JSON.stringify({
            anomalyType: 'burst_deletes',
            actorId: ID.ownerB,
            encounters: 3,
            firstSeen: now.toISOString(),
            lastSeen: now.toISOString(),
            severity: 0.9,
            details: { note: 'Tenant B SECRET_B_INCIDENT' },
          }),
          confidence: 0.9,
          createdAt: now,
        },
      ],
    });
    const freshImmune = new KeyCortexImmuneServiceCtor(prisma, freshEndocrine);
    const activeImmA = await freshImmune.activeIncidents(ID.bizA, now);
    expect(activeImmA.length).toBe(1);
    expect(activeImmA[0].anomalyType).toBe('burst_updates');
    expect(JSON.stringify(activeImmA)).not.toContain('SECRET_B_INCIDENT');
    expect(JSON.stringify(activeImmA)).not.toContain('eyJhbGci');
    markInvoked('modules/key-cortex/key-cortex-immune.service.ts::KeyCortexImmuneService.load');

    // 7g. KeyCortexSalienceService.countSignal + describeForPrompt (non-vacuous real threat/opportunity events on bizA & bizB)
    const recentTs = new Date(now.getTime() - 5 * 60_000);
    await db.businessEvent.createMany({
      data: [
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `${P}sal_a_crm_${i}`,
          businessId: ID.bizA,
          eventType: 'contact.created',
          subjectType: 'contact',
          subjectId: `${P}sc_${i}`,
          actorType: 'human',
          actorId: ID.ownerA,
          action: 'create',
          source: 'web',
          createdAt: recentTs,
        })),
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `${P}sal_a_rev_${i}`,
          businessId: ID.bizA,
          eventType: 'invoice.paid',
          subjectType: 'invoice',
          subjectId: `${P}si_${i}`,
          actorType: 'system',
          actorId: 'system',
          action: 'complete',
          source: 'api',
          createdAt: recentTs,
        })),
        ...Array.from({ length: 8 }, (_, i) => ({
          id: `${P}sal_b_thr_${i}`,
          businessId: ID.bizB,
          eventType: 'proactive.negative_sentiment',
          subjectType: 'message',
          subjectId: `${P}sm_b_${i}`,
          actorType: 'ai',
          actorId: 'watcher',
          action: 'detect',
          source: 'ai',
          createdAt: recentTs,
        })),
      ],
    });
    const freshSalience = new KeyCortexSalienceServiceCtor(prisma, freshEndocrine);
    const concernsA = await freshSalience.appraise(ID.bizA);
    expect(concernsA.length).toBeGreaterThanOrEqual(2);
    expect(concernsA.map((c: any) => c.signal)).toContain('contact.created');
    expect(concernsA.map((c: any) => c.signal)).toContain('invoice.paid');
    expect(concernsA.map((c: any) => c.signal)).not.toContain('proactive.negative_sentiment');
    const staffPromptSalience = freshSalience.describeForPrompt(ID.bizA, now, STAFF_NO_REV_SIGHT);
    expect(staffPromptSalience ?? '').toMatch(/contact/i);
    expect(staffPromptSalience ?? '').not.toMatch(/invoices?\s+paid/i);
    expect(staffPromptSalience ?? '').not.toMatch(/negative\s+sentiment/i);
    const ownerPromptSalience = freshSalience.describeForPrompt(ID.bizA, now, OWNER_SIGHT);
    expect(ownerPromptSalience ?? '').toMatch(/invoices?\s+paid/i);
    markInvoked('modules/key-cortex/key-cortex-salience.service.ts::KeyCortexSalienceService.countSignal');

    // 7h. TemporalFlowService.visibleMemoryIds (explicit real-DB check with restricted staff sight)
    await db.temporalFlowMemory.create({
      data: {
        id: `${P}tf_vis_rev`,
        businessId: ID.bizA,
        entityType: 'invoice',
        entityId: `${P}inv_vis`,
        type: 'summary',
        content: 'Invoice $84,600 settled',
        sourceModule: 'revenue',
        sourceEventIds: [],
        metadata: {},
        confidence: 0.9,
        dataClass: 'REVENUE',
        moduleScope: ['revenue'],
      },
    });
    const staffTfSight = await temporalFlow.memorySight(ID.bizA, { id: ID.staffA });
    const visIds = await temporalFlow.visibleMemoryIds(ID.bizA, [`${P}tf_vis_rev`], staffTfSight.filter);
    expect(visIds.has(`${P}tf_vis_rev`)).toBe(false);
    markInvoked('modules/temporal-flow/temporal-flow.service.ts::TemporalFlowService.visibleMemoryIds');
  });

  it('8. Runtime coverage proof: every symbol in ACTIVE_PROJECTED_READ_SYMBOLS was actually invoked against real Postgres', () => {
    expect(ACTIVE_PROJECTED_READ_SYMBOLS.size).toBeGreaterThan(30);
    const uninvoked = [...ACTIVE_PROJECTED_READ_SYMBOLS].filter((sym) => !invokedSymbols.has(sym));
    expect(
      uninvoked,
      'Every fixed projected memory reader listed in ACTIVE_PROJECTED_READ_SYMBOLS must be actively invoked at runtime',
    ).toEqual([]);
  });

  // ── Explicit named it.todo cases for every genuinely unfixed path in memory-path-registry.ts ──
  // Never silently skipped: each names the exact registry entry and owning follow-up packet id.
  it.todo(
    '[MEM-CLASS-READ] modules/ai/proactive-suggestion.service.ts :: ProactiveSuggestionService.generateSuggestions (AiMemory.findMany) — E-REV-DIRECT / E-REV-INDIRECT / E-UNCLASS: apply reader-sight projection to suggestion dedupe read',
  );
  it.todo(
    '[MEM-EVAL-SUITE, MEM-CLASS-READ] modules/business-events/business-event.service.ts :: BusinessEventService.getTimeline (BusinessEvent.findMany) — E-TEN: add businessId predicate to subject timeline query',
  );
  it.todo(
    '[MEM-EVAL-SUITE, FU-KEY-GENOME-READS-RESIDUAL] modules/business-genome/key-genome/genome-memory.service.ts :: GenomeMemoryService.getMemoryEvent (GenomeMemoryEvent.findUnique) — E-TEN: scope query by { id, businessId } instead of post-fetch check',
  );
  it.todo(
    '[MEM-CLASS-READ] modules/key-cortex/cognitive-event-bus.service.ts :: CognitiveEventBusService.list (CognitiveEvent.findMany) — E-REV-DIRECT / E-REV-INDIRECT / E-UNCLASS: project raw CognitiveEvent rows by reader sight',
  );
  it.todo(
    '[MEM-EVAL-SUITE, MEM-CLASS-READ] modules/key-cortex/key-cortex-actions.service.ts :: KeyCortexActionsService.getActionHistory (CortexActionLog.findMany) — E-TEN: add businessId predicate alongside sessionId',
  );
  it.todo(
    '[RR-LEARNING-OUTCOME-SEMANTICS, MEM-EVAL-SUITE] modules/key-cortex/key-cortex-learning.service.ts :: KeyCortexLearningService.recordFeedback (CognitionMemory.findFirst) — E-TEN / E-MEMBER: scope sessionId lookup by input.businessId',
  );
  it.todo(
    '[RR-LEARNING-OUTCOME-SEMANTICS, MEM-EVAL-SUITE] modules/key-cortex/key-cortex-learning.service.ts :: KeyCortexLearningService.recordFeedback (CognitionMemory.update) — E-TEN / E-MEMBER: scope cognitionMemory update by businessId + id',
  );
  it.todo(
    '[MEM-EVAL-SUITE, MEM-CLASS-READ] modules/key-cortex/key-cortex-metacognition.service.ts :: KeyCortexMetacognitionService.explainConfidence (BusinessEvent.findMany) — E-TEN: add businessId predicate to correlationId lookup',
  );
});
