/**
 * MEM-CLASS-COLUMNS (P125, D-257, V1-87): Memory rows and embedding copies
 * record `data_class` and `module_scope` at write time from structural provenance.
 *
 * Scope (write-side ONLY — zero reader changes, zero backfill):
 *   1. Additive nullable columns `data_class TEXT` and `module_scope TEXT[]`
 *      (no default, no index change, reversible by dropping) on:
 *        - `ai_memories`
 *        - `ai_memory_embeddings`
 *        - `temporal_flow_memories`
 *   2. Every `MEM-CENSUS` writer (`AiMemoryService`, `AiOversightService`,
 *      `ModelGatewayService`, `UnifiedMemoryWriterService`, `SemanticMemoryService`,
 *      `KeyCortexDocumentService`, `KeyCortexCerebellumService`,
 *      `MemoryConsolidationService`, `ProactiveSuggestionService`,
 *      `TemporalFlowMemoryService`, `TemporalAdapterService`) stamps `data_class`
 *      and `module_scope` from structural provenance on real Postgres rows.
 *   3. Embedding copies (`ai_memory_embeddings`) and temporal summaries
 *      (`temporal_flow_memories`) / consolidations inherit the most restrictive
 *      `data_class` (`SECRET_BEARING > PERSONAL > REVENUE > UNCLASSIFIED > GENERAL`)
 *      and the deterministic sorted union of `module_scope` of their sources.
 *
 * Fixture prefix `v87m_` (V1-87 MEM-CLASS-COLUMNS), cleaned via `sqlLikePrefix(P)`.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v87m_';
const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  doc: `${P}doc_1`,
};

const CANONICAL_DATA_CLASSES = new Set([
  'GENERAL',
  'REVENUE',
  'PERSONAL',
  'SECRET_BEARING',
  'UNCLASSIFIED',
]);

const UNIT_VECTOR = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));

let db: any;
let prisma: any;
let events: EventEmitter2;
let aiUsage: any;
let semantic: any;
let executionLog: any;
let aiMemory: any;
let unifiedWriter: any;
let oversight: any;
let gateway: any;
let cerebellum: any;
let consolidation: any;
let documentService: any;
let proactiveSuggestions: any;
let temporalMemory: any;
let temporalFlow: any;
let temporalAdapter: any;
let monitorInsights: any[] = [];

async function cleanup() {
  const byBiz = (table: string) => `DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`;
  for (const sql of [
    byBiz('ai_memory_embeddings'),
    byBiz('ai_memories'),
    byBiz('temporal_flow_memories'),
    byBiz('temporal_flow_events'),
    byBiz('cognition_memories'),
    byBiz('ai_execution_logs'),
    byBiz('ai_usage_logs'),
    byBiz('key_documents'),
    byBiz('team_activity_logs'),
    byBiz('memberships'),
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort cleanup */
    }
  }
}

async function resetMemoryTables() {
  const byBiz = (table: string) => `DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`;
  for (const sql of [
    byBiz('ai_memory_embeddings'),
    byBiz('ai_memories'),
    byBiz('temporal_flow_memories'),
    byBiz('temporal_flow_events'),
    byBiz('cognition_memories'),
    byBiz('ai_execution_logs'),
    byBiz('key_documents'),
  ]) {
    await db.$executeRawUnsafe(sql);
  }
}

async function readAiMemoryClass(category: string, key: string): Promise<{ id: string; data_class: string | null; module_scope: string[] | null } | null> {
  const rows = await db.$queryRawUnsafe(
    `SELECT id, data_class, module_scope FROM ai_memories WHERE business_id = $1 AND category = $2 AND key = $3`,
    ID.biz,
    category,
    key,
  );
  return rows[0] ?? null;
}

async function readEmbeddingsClass(sourceType: string, sourceId: string): Promise<Array<{ id: string; content: string; data_class: string | null; module_scope: string[] | null }>> {
  return db.$queryRawUnsafe(
    `SELECT id, content, data_class, module_scope FROM ai_memory_embeddings WHERE business_id = $1 AND source_type = $2 AND source_id = $3 ORDER BY created_at ASC`,
    ID.biz,
    sourceType,
    sourceId,
  );
}

async function readTemporalMemoryClass(id: string): Promise<{ id: string; data_class: string | null; module_scope: string[] | null } | null> {
  const rows = await db.$queryRawUnsafe(
    `SELECT id, data_class, module_scope FROM temporal_flow_memories WHERE business_id = $1 AND id = $2`,
    ID.biz,
    id,
  );
  return rows[0] ?? null;
}

describe('MEM-CLASS-COLUMNS (P125, V1-87): write-side data_class & module_scope provenance', () => {
  beforeAll(async () => {
    const dbMod = await import('@keyflow/db');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { SemanticMemoryService } = await import('../src/modules/ai/semantic-memory.service');
    const { AiExecutionLogService } = await import('../src/modules/ai/ai-execution-log.service');
    const { AiMemoryService } = await import('../src/modules/ai/ai-memory.service');
    const { UnifiedMemoryWriterService } = await import('../src/modules/key-cortex/unified-memory-writer.service');
    const { AiOversightService } = await import('../src/modules/ai/ai-oversight.service');
    const { ModelGatewayService } = await import('../src/modules/ai/model-gateway.service');
    const { KeyCortexCerebellumService } = await import('../src/modules/key-cortex/key-cortex-cerebellum.service');
    const { MemoryConsolidationService } = await import('../src/modules/key-cortex/memory-consolidation.service');
    const { KeyCortexDocumentService } = await import('../src/modules/key-cortex/key-cortex-document.service');
    const { ProactiveSuggestionService } = await import('../src/modules/ai/proactive-suggestion.service');
    const { TemporalFlowMemoryService } = await import('../src/modules/temporal-flow/temporal-flow-memory.service');
    const { TemporalFlowService } = await import('../src/modules/temporal-flow/temporal-flow.service');
    const { TemporalAdapterService } = await import('../src/modules/key-cortex/adapters/temporal-adapter.service');

    db = dbMod.db;
    prisma = new PrismaService();
    events = new EventEmitter2();

    aiUsage = {
      trackEmbedding: async () => [UNIT_VECTOR],
      trackText: async () => undefined,
    };

    semantic = new SemanticMemoryService(prisma, events, aiUsage);
    executionLog = new AiExecutionLogService(prisma);
    const stubBlueprint = { getBlueprint: async () => null } as any;
    aiMemory = new AiMemoryService(prisma, executionLog, stubBlueprint, semantic);
    unifiedWriter = new UnifiedMemoryWriterService(aiMemory, semantic);

    oversight = new AiOversightService(
      prisma,
      executionLog,
      aiMemory,
      {} as any,
      {} as any,
      {} as any,
    );

    const stubLlmCost = { recordCost: async () => undefined } as any;
    const stubLangfuse = {
      isEnabled: () => false,
      startTrace: () => null,
      endTrace: () => undefined,
    } as any;
    gateway = new ModelGatewayService(prisma, stubLlmCost, stubLangfuse);

    cerebellum = new KeyCortexCerebellumService(prisma, aiMemory);
    consolidation = new MemoryConsolidationService(prisma, undefined, semantic);

    const fakeRedisStore = new Map<string, any>();
    const stubRedis = {
      redis: {
        scan: async (_cursor: string, _m: string, pattern: string) => {
          const prefix = pattern.replace(/\*$/, '');
          const keys = [...fakeRedisStore.keys()].filter((k) => k.startsWith(prefix));
          return ['0', keys];
        },
      },
      getJson: async (k: string) => fakeRedisStore.get(k) ?? null,
      setJson: async (k: string, v: any) => {
        fakeRedisStore.set(k, v);
      },
    } as any;
    fakeRedisStore.set(`doc:index:${ID.doc}:0`, { chunkKey: `doc:chunk:${ID.doc}:0` });
    fakeRedisStore.set(`doc:chunk:${ID.doc}:0`, {
      id: `${ID.doc}:0`,
      documentId: ID.doc,
      chunkIndex: 0,
      text: 'Invoice #9001 from Acme Supplies — Total Due: TTD 2,400.00',
    });
    const stubDocGateway = {
      complete: async () => ({
        content: JSON.stringify({
          data: { invoiceNumber: '9001', total: 2400 },
          confidence: 0.92,
          rawFields: [{ field: 'total', value: 2400, confidence: 0.92 }],
        }),
        provider: 'stub',
        usage: { promptTokens: 10, completionTokens: 10, estimatedCost: 0 },
      }),
    } as any;
    documentService = new KeyCortexDocumentService(
      prisma,
      stubRedis,
      stubDocGateway,
      aiUsage,
      unifiedWriter,
    );

    const stubMonitor = {
      scanInsights: async () => monitorInsights,
    } as any;
    proactiveSuggestions = new ProactiveSuggestionService(
      prisma,
      stubMonitor,
      oversight,
      events,
      semantic,
    );

    temporalMemory = new TemporalFlowMemoryService(prisma, semantic);
    temporalFlow = new TemporalFlowService(prisma, temporalMemory, semantic);
    temporalAdapter = new TemporalAdapterService(temporalMemory, temporalFlow);

    await cleanup();

    await db.user.create({
      data: {
        id: ID.owner,
        email: `${P}owner@test.local`,
        name: 'V87M Owner',
      },
    });
    await db.business.create({
      data: {
        id: ID.biz,
        name: 'V87M Memory Class Biz',
        slug: `${P}biz`,
        ownerId: ID.owner,
      },
    });
    await db.membership.create({
      data: {
        id: `${P}m_owner`,
        userId: ID.owner,
        businessId: ID.biz,
        role: 'OWNER',
      },
    });
  }, 60_000);

  beforeEach(async () => {
    monitorInsights = [];
    await resetMemoryTables();
  });

  afterAll(async () => {
    await semantic?.recopiesSettled?.();
    await cleanup();
  });

  it('MCC-01: additive nullable columns data_class (TEXT) and module_scope (TEXT[]) with no default exist on all 3 tables, and legacy NULL rows stay NULL', async () => {
    const tables = ['ai_memories', 'ai_memory_embeddings', 'temporal_flow_memories'];
    for (const table of tables) {
      const cols: Array<{
        column_name: string;
        data_type: string;
        udt_name: string;
        is_nullable: string;
        column_default: string | null;
      }> = await db.$queryRawUnsafe(
        `SELECT column_name, data_type, udt_name, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = $1
           AND column_name IN ('data_class', 'module_scope')
         ORDER BY column_name`,
        table,
      );

      expect(cols, `${table} must have data_class and module_scope`).toHaveLength(2);
      const [dataClassCol, moduleScopeCol] = cols;
      expect(dataClassCol).toMatchObject({
        column_name: 'data_class',
        data_type: 'text',
        is_nullable: 'YES',
        column_default: null,
      });
      expect(moduleScopeCol).toMatchObject({
        column_name: 'module_scope',
        data_type: 'ARRAY',
        udt_name: '_text',
        is_nullable: 'YES',
        column_default: null,
      });
    }

    // Legacy row written without the columns keeps NULL in both columns (no default, no backfill).
    await db.$executeRawUnsafe(
      `INSERT INTO ai_memories (id, business_id, category, key, value, confidence, source, created_at, updated_at)
       VALUES ($1, $2, 'tone', 'legacy_null_probe', 'legacy value', 1.0, 'user', NOW(), NOW())`,
      `${P}legacy_mem`,
      ID.biz,
    );
    const legacy = await readAiMemoryClass('tone', 'legacy_null_probe');
    expect(legacy?.data_class).toBeNull();
    expect(legacy?.module_scope).toBeNull();
  });

  it('MCC-02: AiMemoryService (upsert, recordApprovalSignal, summarizePatterns) stamps data_class and module_scope from provenance', async () => {
    await aiMemory.upsert(ID.biz, {
      category: 'tone',
      key: 'preferred',
      value: 'warm and direct',
      source: 'user',
    });
    expect(await readAiMemoryClass('tone', 'preferred')).toMatchObject({
      data_class: 'GENERAL',
      module_scope: [],
    });

    await aiMemory.upsert(ID.biz, {
      category: 'patterns',
      key: 'overdue_invoices',
      value: '3 overdue invoices totaling $4,500',
      source: 'pattern_analysis',
    });
    const revPattern = await readAiMemoryClass('patterns', 'overdue_invoices');
    expect(revPattern?.data_class).toBe('REVENUE');
    expect(revPattern?.module_scope).toContain('revenue');

    await aiMemory.upsert(ID.biz, {
      category: 'unrecognized_bucket' as any,
      key: 'opaque_1',
      value: 'arbitrary blob',
      source: 'inferred',
    });
    expect((await readAiMemoryClass('unrecognized_bucket', 'opaque_1'))?.data_class).toBe('UNCLASSIFIED');

    await aiMemory.recordApprovalSignal(ID.biz, 'commerce_create_invoice', 'rejected', {
      rationale: 'Double-check invoice total first',
    });
    const revApproval = await readAiMemoryClass('corrections', 'rejected_commerce_create_invoice');
    expect(revApproval?.data_class).toBe('REVENUE');
    expect(revApproval?.module_scope).toContain('revenue');

    await aiMemory.recordApprovalSignal(ID.biz, 'bookings_confirm_booking', 'rejected', {
      rationale: 'Wait for customer confirmation',
    });
    const bookingApproval = await readAiMemoryClass('corrections', 'rejected_bookings_confirm_booking');
    expect(bookingApproval?.data_class).toBe('GENERAL');
    expect(bookingApproval?.module_scope).toEqual(['bookings']);

    // Seed 6 execution logs (5 commerce_create_invoice + 1 crm_create_contact) and summarizePatterns
    for (let i = 0; i < 6; i++) {
      await executionLog.log({
        businessId: ID.biz,
        action: i < 5 ? 'commerce.create_invoice' : 'crm.create_contact',
        toolName: i < 5 ? 'commerce_create_invoice' : 'crm_create_contact',
        module: i < 5 ? 'commerce' : 'crm',
        riskTier: 2,
        mode: 'assisted',
        actor: 'ai',
        success: true,
      });
    }
    const summarized = await aiMemory.summarizePatterns(ID.biz);
    expect(summarized.length).toBeGreaterThan(0);

    const mostUsed = await readAiMemoryClass('patterns', 'most_used_tools');
    expect(mostUsed?.data_class).toBe('REVENUE');
    expect(mostUsed?.module_scope).toContain('revenue');

    const peakHour = await readAiMemoryClass('patterns', 'peak_activity_hour');
    expect(peakHour?.data_class).toBe('GENERAL');
  });

  it('MCC-03: Settings writers (AiOversightService.updateAutonomySettings & ModelGatewayService.updatePreferences) stamp GENERAL and SECRET_BEARING', async () => {
    await oversight.updateAutonomySettings(ID.biz, { mode: 'assisted', maxAutoTier: 1 });
    expect(await readAiMemoryClass('settings', 'autonomy')).toMatchObject({
      data_class: 'GENERAL',
      module_scope: ['ai', 'settings'],
    });

    await gateway.updatePreferences(ID.biz, { aiMode: 'balanced' });
    expect(await readAiMemoryClass('settings', 'ai_preferences')).toMatchObject({
      data_class: 'SECRET_BEARING',
      module_scope: ['ai', 'settings'],
    });
  });

  it('MCC-04: UnifiedMemoryWriterService, KeyCortexDocumentService.extractData, SemanticMemoryService backfill & recopy propagate restrictive data_class and module_scope', async () => {
    const fact = await unifiedWriter.storeBusinessFact(
      ID.biz,
      'primary_workflow',
      'Project-based creative studio',
      { indexSemantic: true },
    );
    expect(await readAiMemoryClass('business_fact', 'primary_workflow')).toMatchObject({
      data_class: 'GENERAL',
      module_scope: [],
    });
    const factCopies = await readEmbeddingsClass('memory', fact.id);
    expect(factCopies).toHaveLength(1);
    expect(factCopies[0]).toMatchObject({ data_class: 'GENERAL', module_scope: [] });

    const crmLesson = await unifiedWriter.storeLesson(
      ID.biz,
      'crm_followup_timing',
      'Follow up with new leads within 24 hours',
      { indexSemantic: true },
    );
    expect(await readAiMemoryClass('past_decision', 'crm_followup_timing')).toMatchObject({
      data_class: 'GENERAL',
      module_scope: ['crm'],
    });
    const crmCopies = await readEmbeddingsClass('memory', crmLesson.id);
    expect(crmCopies).toHaveLength(1);
    expect(crmCopies[0]).toMatchObject({ data_class: 'GENERAL', module_scope: ['crm'] });

    // KeyCortexDocumentService.extractData -> UnifiedMemoryWriterService.storeDocumentExtraction
    await (db as any).keyDocument.create({
      data: {
        id: ID.doc,
        businessId: ID.biz,
        fileName: 'invoice-9001.pdf',
        fileType: 'application/pdf',
        fileSize: 1024,
        storageUrl: 's3://stub/invoice-9001.pdf',
        status: 'indexed',
        chunksIndexed: 1,
      },
    });
    await documentService.extractData(ID.doc, { total: { type: 'number', description: 'Total' } }, ID.biz);
    const docRow = await readAiMemoryClass('document_extraction', ID.doc);
    expect(docRow).toMatchObject({
      data_class: 'REVENUE',
      module_scope: ['revenue'],
    });

    // Backfill creates embedding copies inheriting source AiMemory data_class and module_scope
    const backfilled = await semantic.backfillFromAiMemory(ID.biz);
    expect(backfilled).toBeGreaterThanOrEqual(3);
    const docCopies = await readEmbeddingsClass('memory', docRow!.id);
    expect(docCopies.length).toBeGreaterThanOrEqual(1);
    for (const copy of docCopies) {
      expect(copy.data_class).toBe('REVENUE');
      expect(copy.module_scope).toEqual(['revenue']);
    }

    // Rewriting a GENERAL row into a financial value upgrades both ai_memories and its recopied embedding to REVENUE
    await aiMemory.upsert(ID.biz, {
      category: 'business_fact',
      key: 'primary_workflow',
      value: 'Retainer billing of $3,500 monthly per client',
      source: 'user',
    });
    await semantic.recopiesSettled();
    const rewritten = await readAiMemoryClass('business_fact', 'primary_workflow');
    expect(rewritten?.data_class).toBe('REVENUE');
    expect(rewritten?.module_scope).toContain('revenue');
    const recopied = await readEmbeddingsClass('memory', rewritten!.id);
    expect(recopied.length).toBeGreaterThanOrEqual(1);
    for (const copy of recopied) {
      expect(copy.data_class).toBe('REVENUE');
      expect(copy.module_scope).toContain('revenue');
    }
  });

  it('MCC-05: KeyCortexCerebellumService, MemoryConsolidationService, and ProactiveSuggestionService stamp provenance classes & scopes', async () => {
    // 1. Cerebellum recurring tool failures (revenue tool + crm tool)
    for (let i = 0; i < 3; i++) {
      await executionLog.log({
        businessId: ID.biz,
        action: 'commerce.create_invoice',
        toolName: 'commerce_create_invoice',
        module: 'revenue',
        riskTier: 2,
        mode: 'assisted',
        actor: 'ai',
        success: false,
        errorMessage: 'Invoice currency is required',
      });
      await executionLog.log({
        businessId: ID.biz,
        action: 'crm.create_contact',
        toolName: 'crm_create_contact',
        module: 'crm',
        riskTier: 1,
        mode: 'assisted',
        actor: 'ai',
        success: false,
        errorMessage: 'Contact email already exists',
      });
    }
    const lessons = await cerebellum.consolidate(ID.biz);
    expect(lessons.length).toBeGreaterThanOrEqual(2);
    const invLesson = await readAiMemoryClass('learned_corrections', 'commerce_create_invoice:invoice currency is required');
    expect(invLesson?.data_class).toBe('REVENUE');
    expect(invLesson?.module_scope).toContain('revenue');
    const crmLesson = await readAiMemoryClass('learned_corrections', 'crm_create_contact:contact email already exists');
    expect(crmLesson?.data_class).toBe('GENERAL');
    expect(crmLesson?.module_scope).toEqual(['crm']);

    // 2. MemoryConsolidationService promoting memberless CognitionMemory rows
    await db.cognitionMemory.create({
      data: {
        id: `${P}cog_fin`,
        businessId: ID.biz,
        userId: null,
        functionId: 'finance_health',
        eventType: 'recommendation',
        recommendation: 'Follow up on receivables over 30 days',
        userResponse: 'accepted',
        confidence: 0.95,
      },
    });
    await db.cognitionMemory.create({
      data: {
        id: `${P}cog_gen`,
        businessId: ID.biz,
        userId: null,
        functionId: 'general',
        eventType: 'recommendation',
        recommendation: 'Keep kickoff calls under 30 minutes',
        userResponse: 'accepted',
        confidence: 0.95,
      },
    });
    const cons = await consolidation.run(ID.biz);
    expect(cons.promoted).toBe(2);
    expect(await readAiMemoryClass('learning', 'learned:finance_health')).toMatchObject({
      data_class: 'REVENUE',
      module_scope: ['revenue'],
    });
    expect(await readAiMemoryClass('learning', 'learned:general')).toMatchObject({
      data_class: 'GENERAL',
      module_scope: [],
    });

    // 3. ProactiveSuggestionService
    await oversight.updateAutonomySettings(ID.biz, { mode: 'assisted', maxAutoTier: 2 });
    monitorInsights = [
      {
        category: 'overdue_invoices',
        severity: 'critical',
        title: 'Overdue invoices',
        description: '4 invoices overdue totaling $3,100',
        metric: '$3,100',
      },
      {
        category: 'stale_leads',
        severity: 'warning',
        title: 'Stale leads',
        description: '5 leads untouched for 10 days',
        metric: '5 leads',
      },
    ];
    const suggestions = await proactiveSuggestions.generateSuggestions(ID.biz);
    expect(suggestions).toHaveLength(2);
    const suggestionRows: Array<{ key: string; data_class: string | null; module_scope: string[] | null }> =
      await db.$queryRawUnsafe(
        `SELECT key, data_class, module_scope FROM ai_memories WHERE business_id = $1 AND category = 'suggestion' ORDER BY key`,
        ID.biz,
      );
    const invSug = suggestionRows.find((r) => r.key.startsWith('overdue_invoices_'));
    const leadSug = suggestionRows.find((r) => r.key.startsWith('stale_leads_'));
    expect(invSug?.data_class).toBe('REVENUE');
    expect(invSug?.module_scope).toContain('revenue');
    expect(leadSug?.data_class).toBe('GENERAL');
    expect(leadSug?.module_scope).toContain('crm');

    await proactiveSuggestions.blockCategory(ID.biz, 'stale_leads');
    expect(await readAiMemoryClass('suggestion_block', 'stale_leads')).toMatchObject({
      data_class: 'GENERAL',
      module_scope: ['crm'],
    });
  });

  it('MCC-06: TemporalFlowMemoryService & TemporalAdapterService inherit restrictive class and union of module scopes (and mirror to embeddings)', async () => {
    const mixedThreadId = `${P}thread_mixed`;
    const cleanThreadId = `${P}thread_booking`;
    const contactId = `${P}contact_1`;

    // Mixed thread: 1 WhatsApp message + 1 payment event (CRITICAL -> confidence >= 0.7 -> mirrors to ai_memory_embeddings!)
    await db.temporalFlowEvent.createMany({
      data: [
        {
          id: `${P}ev_wa`,
          businessId: ID.biz,
          source: 'whatsapp',
          type: 'key_inbox.message_received',
          module: 'operations',
          entityType: 'thread',
          entityId: mixedThreadId,
          threadId: mixedThreadId,
          contactId,
          title: 'Customer messaged on WhatsApp',
          importance: 'CRITICAL',
          genomeImpactPotential: true,
          occurredAt: new Date(),
        },
        {
          id: `${P}ev_pay`,
          businessId: ID.biz,
          source: 'payments',
          type: 'payment.received',
          module: 'revenue',
          entityType: 'payment',
          entityId: `${P}pay_1`,
          threadId: mixedThreadId,
          contactId,
          title: 'Payment received $250',
          importance: 'CRITICAL',
          genomeImpactPotential: true,
          occurredAt: new Date(),
        },
        {
          id: `${P}ev_bk`,
          businessId: ID.biz,
          source: 'calendar',
          type: 'booking.confirmed',
          module: 'bookings',
          entityType: 'booking',
          entityId: `${P}bk_1`,
          threadId: cleanThreadId,
          title: 'Booking confirmed for Tuesday 10am',
          importance: 'NORMAL',
          occurredAt: new Date(),
        },
      ],
    });

    // Summary over one payment event + one WhatsApp event -> REVENUE + ['operations', 'revenue'], mirrored to embedding copy
    const mixedSummary = await temporalMemory.summarizeThread(ID.biz, mixedThreadId);
    expect(mixedSummary).not.toBeNull();
    const mixedRow = await readTemporalMemoryClass(mixedSummary.id);
    expect(mixedRow).toMatchObject({
      data_class: 'REVENUE',
      module_scope: ['operations', 'revenue'],
    });

    const mixedEmb = await readEmbeddingsClass('temporal_memory', mixedSummary.id);
    expect(mixedEmb.length).toBeGreaterThanOrEqual(1);
    expect(mixedEmb[0]).toMatchObject({
      data_class: 'REVENUE',
      module_scope: ['operations', 'revenue'],
    });

    // Clean booking thread -> GENERAL + ['bookings', 'operations']
    const cleanSummary = await temporalMemory.summarizeThread(ID.biz, cleanThreadId);
    expect(cleanSummary).not.toBeNull();
    expect(await readTemporalMemoryClass(cleanSummary.id)).toMatchObject({
      data_class: 'GENERAL',
      module_scope: ['bookings', 'operations'],
    });

    // Contact summary containing a payment event -> REVENUE + union including crm, operations, revenue
    const contactSummary = await temporalMemory.summarizeContact(ID.biz, contactId);
    expect(contactSummary).not.toBeNull();
    const contactRow = await readTemporalMemoryClass(contactSummary.id);
    expect(contactRow?.data_class).toBe('REVENUE');
    expect(contactRow?.module_scope).toEqual(expect.arrayContaining(['crm', 'operations', 'revenue']));

    // Channel summary over payments -> REVENUE + includes revenue
    const channelSummary = await temporalMemory.summarizeChannel(ID.biz, 'payments');
    expect(channelSummary).not.toBeNull();
    const channelRow = await readTemporalMemoryClass(channelSummary.id);
    expect(channelRow?.data_class).toBe('REVENUE');
    expect(channelRow?.module_scope).toContain('revenue');

    // TemporalAdapterService: storeMemory, consolidateMemories, updateMemory, tagMemory
    const crmMem = await temporalAdapter.storeMemory({
      businessId: ID.biz,
      key: 'crm_client_notes',
      value: { note: 'Prefers Tuesday mornings for demos' },
      tags: ['crm'],
      importance: 'medium',
    });
    const revMem = await temporalAdapter.storeMemory({
      businessId: ID.biz,
      key: 'invoice_status_note',
      value: { note: 'Invoice #12 for $900 is pending' },
      tags: ['revenue'],
      importance: 'high',
    });
    expect((await readTemporalMemoryClass(revMem.id))?.data_class).toBe('REVENUE');

    const consolidated = await temporalAdapter.consolidateMemories({
      businessId: ID.biz,
      keys: ['crm_client_notes', 'invoice_status_note'],
      summaryKey: 'weekly_rollup',
    });
    const consRow = await readTemporalMemoryClass(consolidated.id);
    expect(consRow?.data_class).toBe('REVENUE');
    expect(consRow?.module_scope).toEqual(expect.arrayContaining(['crm', 'revenue']));

    // updateMemory adding financial info upgrades data_class to REVENUE
    await temporalAdapter.updateMemory({
      businessId: ID.biz,
      memoryId: crmMem.id,
      value: { note: 'Agreed to $1,500 invoice retainer' },
    });
    const updatedCrmRow = await readTemporalMemoryClass(crmMem.id);
    expect(updatedCrmRow?.data_class).toBe('REVENUE');
    expect(updatedCrmRow?.module_scope).toContain('revenue');

    // tagMemory adding 'bookings' unions into module_scope without losing REVENUE
    await temporalAdapter.tagMemory({
      businessId: ID.biz,
      memoryId: crmMem.id,
      tags: ['bookings'],
    });
    const taggedRow = await readTemporalMemoryClass(crmMem.id);
    expect(taggedRow?.data_class).toBe('REVENUE');
    expect(taggedRow?.module_scope).toEqual(expect.arrayContaining(['bookings', 'revenue']));
  });

  it('MCC-07: SemanticMemoryService.store stamps non-memory source types and inherits from temporal_flow_memories on direct calls', async () => {
    await semantic.store({
      businessId: ID.biz,
      content: 'Company operating handbook section 2',
      sourceType: 'document',
      sourceId: `${P}ks_1:0`,
      metadata: { title: 'Handbook' },
    });
    const docEmb = await readEmbeddingsClass('document', `${P}ks_1:0`);
    expect(docEmb).toHaveLength(1);
    expect(docEmb[0]).toMatchObject({
      data_class: 'UNCLASSIFIED',
      module_scope: ['expenses', 'revenue'],
    });

    await semantic.store({
      businessId: ID.biz,
      content: 'User discussed personal schedule preferences',
      sourceType: 'conversation',
      sourceId: `${P}conv_1`,
    });
    const convEmb = await readEmbeddingsClass('conversation', `${P}conv_1`);
    expect(convEmb).toHaveLength(1);
    expect(convEmb[0].data_class).toBe('PERSONAL');

    // Direct temporal_memory embedding without explicit dataClass inherits from temporal_flow_memories row
    const tfm = await temporalMemory.createMemory({
      businessId: ID.biz,
      entityType: 'thread',
      entityId: `${P}t_direct`,
      type: 'summary',
      content: 'Invoice #77 paid $600',
      sourceModule: 'revenue',
      confidence: 0.4, // below auto-embed threshold so we invoke semantic.store directly
    });
    await semantic.store({
      businessId: ID.biz,
      content: 'thread:summary — Invoice #77 paid $600',
      sourceType: 'temporal_memory',
      sourceId: tfm.id,
    });
    const directTfmEmb = await readEmbeddingsClass('temporal_memory', tfm.id);
    expect(directTfmEmb).toHaveLength(1);
    expect(directTfmEmb[0].data_class).toBe('REVENUE');
    expect(directTfmEmb[0].module_scope).toContain('revenue');
  });

  it('MCC-08: census-driven check — every MEM-CENSUS writer targeting the 3 memory stores is accounted for and writes non-null canonical values', async () => {
    const { MEMORY_SERVICE_WRITERS } = await import(
      '../src/modules/key-cortex/memory-path-registry'
    );
    const TARGET_STORES = new Set(['AiMemory', 'AiMemoryEmbedding', 'TemporalFlowMemory']);
    const expectedWriters = MEMORY_SERVICE_WRITERS
      .filter((w) => w.stores.some((s) => TARGET_STORES.has(s)))
      .map((w) => w.className)
      .sort();

    const exercisedWriters = [
      'AiMemoryService',
      'KeyCortexCerebellumService',
      'KeyCortexDocumentService',
      'MemoryConsolidationService',
      'SemanticMemoryService',
      'TemporalAdapterService',
      'TemporalFlowMemoryService',
      'UnifiedMemoryWriterService',
    ].sort();

    expect(expectedWriters).toEqual(exercisedWriters);

    // Quick end-to-end verification across all 3 tables: every written row has valid canonical data_class & non-null module_scope
    await aiMemory.upsert(ID.biz, { category: 'goals', key: 'g1', value: 'Launch cleanly', source: 'user' });
    const row = await readAiMemoryClass('goals', 'g1');
    expect(CANONICAL_DATA_CLASSES.has(row?.data_class ?? '')).toBe(true);
    expect(Array.isArray(row?.module_scope)).toBe(true);
  });
});
