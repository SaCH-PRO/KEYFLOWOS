/**
 * MEM-UNIFIED-SEMANTIC-SIGHT (P0; owner rulings D-257 (KEY's memory design, its four scope fixes), D-234 (sales and money
 * data need revenue read; authorization follows provenance; ambiguity fails closed), D-100; journey K).
 *
 * Found by the MEM-SEMANTIC-SIGHT reviews: UnifiedMemoryRetrievalService.loadSemanticMemory searched the semantic store
 * (ai_memory_embeddings) with no reader projection (no visibleTo) and re-typed every hit 'ai_memory_embedding', dropping
 * its source (sourceType, sourceId). A prompt's memory projection (readersOwnPromptMemory: recordModulesOf) names no
 * module for such a fragment, so a temporal-memory summary of an overdue invoice, a summary of a contact's payment events,
 * a knowledge-source chunk of a statement and the copy of a money pattern reached KEY's memory block for a STAFF member
 * whose revenue scope is none: POST /cortex/chat and its stream (the pipeline's chatMemoryFragments) and
 * KeyCortexPromptContextService.buildMemoryContext.
 *
 * GREEN: the read carries the reader's semantic sight (readerSearchOptions, MEM-SEMANTIC-SIGHT's projection, through
 * MemoryRetrievalOptions.semanticSight), so each hit is resolved to its source and kept only when its source's rule admits
 * the reader, before the limit is cut; a read that carries no sight keeps no hit (fail closed). The fragment keeps its
 * source (metadata SEMANTIC_SOURCE_METADATA_KEY). The owner and a revenue reader are unchanged.
 *
 * Every write goes through its real writer on the real database: TemporalFlowService.emit and
 * TemporalFlowMemoryService.summarizeThread / summarizeContact (which embed through the real SemanticMemoryService),
 * AiMemoryService.upsert and SemanticMemoryService.backfillFromAiMemory, KnowledgeIngestionService.ingestText. Every read
 * goes through the real KeyCortexPromptContextService.buildMemoryContext and the real KeyCortexQueryPipelineService
 * (processQuery and streamQuery) over the real UnifiedMemoryRetrievalService and SemanticMemoryService.
 *
 * Isolation: the structured stores are read over the last 90 days (UnifiedMemoryRetrievalService.loadStructuredMemory),
 * and the temporal-memory rows and the money AiMemory rows are dated 120 days ago once embedded, so the structured
 * read does not render them (their own projection is another packet's) and only their semantic copies can carry them.
 * A semantic copy is matched to its source by content, not date, so it still resolves.
 *
 * Stand-ins: the embedding provider (a fixed vector per marker: every query is e0, a revenue-derived hit is e0
 * (similarity 1, ranked first), the n-th ordinary hit has similarity 0.95 - 0.01n), the model provider and the
 * pipeline's other collaborators (the system prompt is recorded). globalThis.fetch is a tap that refuses and records
 * every outbound request: none is made.
 *
 * Fixture prefix v74u_ (MEM-UNIFIED-SEMANTIC-SIGHT), cleaned with sqlLikePrefix().
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v74u_';

const ID = {
  owner: `${P}owner`,
  /** STAFF, explicit scope map: crm and operations read, revenue and expenses 'none'. */
  blind: `${P}blind`,
  /** STAFF, explicit scope map: revenue and expenses read. */
  revenue: `${P}revenue`,
  /** A platform SUPER_ADMIN with no membership: no member reader (memberless). */
  root: `${P}root`,
  /** The owner of the other business, who is no member of this one. */
  outsider: `${P}outsider`,
  biz: `${P}biz`,
  other: `${P}other`,
};
const m = (who: string, biz = ID.biz) => `${P}m_${who.slice(P.length)}_${biz.slice(P.length)}`;
const BLIND_SCOPES = {
  crm: 'read', bookings: 'read', projects: 'read', content: 'read', automations: 'read', storefront: 'read',
  analytics: 'read', operations: 'read', ai: 'read', team: 'read', expenses: 'none', revenue: 'none',
};
const REVENUE_SCOPES = { ...BLIND_SCOPES, revenue: 'read', expenses: 'read' };

type Reader = 'owner' | 'blind' | 'revenue' | 'root' | 'outsider';
const BLIND_READERS: Reader[] = ['blind', 'root', 'outsider'];
const SEEING_READERS: Reader[] = ['owner', 'revenue'];

const QUERY = 'V74U-Q how is the business doing';
const REV = 'v74u-rev';
const OTHER = 'v74u-other';
const AMOUNT = '4812.37';
const okMarker = (n: number) => `V74U-OK-${n}`;

const saved = { fetch: globalThis.fetch };
const outbound: string[] = [];

let db: any;
let prisma: any;
let semantic: any;
let memory: any;
let temporal: any;
let temporalMemory: any;
let knowledge: any;
let unified: any;
let buildMemoryContextFor: (userId: string) => Promise<string>;
let pipelinePromptFor: (userId: string, stream: boolean) => Promise<string>;

const DIM = 1536;
const unit = (i: number) => Array.from({ length: DIM }, (_, k) => (k === i ? 1 : 0));
function embed(text: string): number[] {
  const t = text.toLowerCase();
  if (t.includes('v74u-q') || t.includes(REV) || t.includes(OTHER)) return unit(0);
  const ok = /v74u-ok-(\d+)/.exec(t);
  if (ok) {
    const n = Number(ok[1]);
    const cos = 0.95 - 0.01 * n;
    const v = unit(1 + n).map((x) => x * Math.sqrt(1 - cos * cos));
    v[0] = cos;
    return v;
  }
  return unit(DIM - 1);
}

async function cleanup() {
  const byBiz = (table: string) => `DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`;
  for (const sql of [
    byBiz('ai_memory_embeddings'),
    byBiz('ai_memories'),
    byBiz('temporal_flow_memories'),
    byBiz('temporal_flow_events'),
    byBiz('knowledge_sources'),
    byBiz('ai_execution_logs'),
    byBiz('cortex_action_logs'),
    byBiz('cognition_memories'),
    byBiz('cortex_events'),
    byBiz('memberships'),
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort: a table may not exist on an older schema */
    }
  }
}

async function clearMemory() {
  for (const table of ['ai_memory_embeddings', 'ai_memories', 'temporal_flow_memories', 'temporal_flow_events', 'knowledge_sources']) {
    await db.$executeRawUnsafe(`DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  }
}

/** Dates every temporal-memory row, and every AiMemory row but the ordinary fact, 120 days back (see Isolation). */
async function ageSources() {
  await db.$executeRawUnsafe(`UPDATE temporal_flow_memories SET created_at = now() - interval '120 days' WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(
    `UPDATE ai_memories SET created_at = now() - interval '120 days' WHERE business_id LIKE ${sqlLikePrefix(P)} AND key <> $1`,
    `${P}fact`,
  );
}

async function inboxThread(businessId: string, threadId: string, title: string) {
  for (let i = 0; i < 3; i++) {
    await temporal.emit({
      businessId, source: 'key_inbox', type: 'key_inbox.message_received', module: 'key_inbox', title, threadId,
      importance: 'CRITICAL', genomeImpactPotential: true,
    });
  }
}

/** Ordinary memory every member with crm and operations read may see: a fact's copy and three inbox thread summaries. */
async function seedOrdinary() {
  await memory.upsert(ID.biz, { category: 'fact', key: `${P}fact`, value: `${okMarker(0)} we open at nine`, source: 'user' });
  await semantic.backfillFromAiMemory(ID.biz);
  for (let n = 1; n <= 3; n++) {
    await inboxThread(ID.biz, `${P}th_ok_${n}`, `${okMarker(n)} customer asked about opening hours`);
    await temporalMemory.summarizeThread(ID.biz, `${P}th_ok_${n}`);
  }
}

/**
 * `perKind` revenue-derived hits of each kind, all ranked above every ordinary hit: an inbox thread about an overdue
 * invoice (a temporal money summary by its text), a contact's payment events (by its source events), a knowledge-source
 * chunk of a statement; and `patterns` money pattern rows (AiMemory) copied by the backfill.
 */
async function seedRevenue(perKind: number, patterns = 0) {
  for (let i = 0; i < perKind; i++) {
    await inboxThread(ID.biz, `${P}th_rev_${i}`, `${REV} Invoice INV-${i} for TTD ${AMOUNT} is overdue`);
    await temporalMemory.summarizeThread(ID.biz, `${P}th_rev_${i}`);

    const contactId = `${P}ct_rev_${i}`;
    for (let k = 0; k < 3; k++) {
      await temporal.emit({
        businessId: ID.biz, source: `${REV}_gw`, type: 'payment.received', module: 'payments', title: 'settled',
        contactId, importance: 'CRITICAL', genomeImpactPotential: true,
      });
    }
    await temporalMemory.summarizeContact(ID.biz, contactId);

    const ksTitle = `${REV} statement ${i}`;
    const ksContent = `${REV} Balance owed TTD ${AMOUNT}`;
    const sourceId = await knowledge.ingestText({ businessId: ID.biz, title: ksTitle, sourceType: 'document', content: ksContent });
    await semantic.store({
      businessId: ID.biz,
      content: `[${ksTitle} chunk 1/1]\n${ksContent}`,
      sourceType: 'document',
      sourceId: `${sourceId}:0`,
      metadata: { knowledgeSourceId: sourceId, title: ksTitle, sourceType: 'document', chunkIndex: 0 },
    });
  }
  for (let i = 0; i < patterns; i++) {
    await memory.upsert(ID.biz, {
      category: 'pattern', key: `${P}pattern_${i}`, value: `${REV} overdue invoices total TTD ${AMOUNT} (${i})`, source: 'inferred',
    });
  }
  // The backfill copies every row again: the fact's copy is dropped first, so the fact keeps exactly one.
  await db.aiMemoryEmbedding.deleteMany({ where: { businessId: ID.biz, sourceType: 'memory' } });
  await semantic.backfillFromAiMemory(ID.biz);
  await ageSources();

  const copies = await db.aiMemoryEmbedding.findMany({ where: { businessId: ID.biz }, select: { sourceType: true, content: true } });
  const rev = copies.filter((c: any) => c.content.toLowerCase().includes(REV));
  expect(rev.filter((c: any) => c.sourceType === 'temporal_memory'), 'premise: the summaries were embedded').toHaveLength(2 * perKind);
  expect(rev.filter((c: any) => c.sourceType === 'document'), 'premise: the chunks were embedded').toHaveLength(perKind);
  expect(rev.filter((c: any) => c.sourceType === 'memory'), 'premise: the patterns were copied').toHaveLength(patterns);
  expect(copies.filter((c: any) => c.content.includes(okMarker(0)))).toHaveLength(1);
}

/** The memory lines of a rendered block (`[<store>] ...`), in order. */
const memoryLines = (block: string) => block.split('\n').filter((line) => /\[[a-z_]+\]/.test(line));

async function everythingFor(reader: Reader) {
  return {
    buildMemoryContext: await buildMemoryContextFor(ID[reader]),
    chat: await pipelinePromptFor(ID[reader], false),
    stream: await pipelinePromptFor(ID[reader], true),
  };
}

beforeAll(async () => {
  globalThis.fetch = (async (input: unknown) => {
    outbound.push(String(input));
    throw new Error('v74u: no outbound traffic in this suite');
  }) as typeof fetch;

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AiMemoryService } = await import('../src/modules/ai/ai-memory.service');
  const { UnifiedMemoryRetrievalService } = await import('../src/modules/key-cortex/unified-memory-retrieval.service');
  const { KnowledgeIngestionService } = await import('../src/modules/key-cortex/knowledge-ingestion.service');
  const { SemanticMemoryService } = await import('../src/modules/ai/semantic-memory.service');
  const { TemporalFlowService } = await import('../src/modules/temporal-flow/temporal-flow.service');
  const { TemporalFlowMemoryService } = await import('../src/modules/temporal-flow/temporal-flow-memory.service');
  const { KeyCortexPromptContextService } = await import('../src/modules/key-cortex/key-cortex-prompt-context.service');
  const { KeyCortexLearningService } = await import('../src/modules/key-cortex/key-cortex-learning.service');
  const { KeyCortexQueryPipelineService } = await import('../src/modules/key-cortex/key-cortex-query-pipeline.service');
  const { KeyCortexMemoryRetrievalService } = await import('../src/modules/key-cortex/key-cortex-memory-retrieval.service');

  prisma = new PrismaService();
  semantic = new SemanticMemoryService(prisma, new EventEmitter2(), {
    trackEmbedding: async (_b: string, _u: unknown, _o: string, texts: string[]) => texts.map(embed),
  } as any);
  memory = new AiMemoryService(prisma, {} as any, { getBlueprint: async () => null } as any, semantic);
  temporalMemory = new TemporalFlowMemoryService(prisma, semantic);
  temporal = new TemporalFlowService(prisma, temporalMemory, semantic);
  knowledge = new KnowledgeIngestionService(prisma);
  unified = new UnifiedMemoryRetrievalService(prisma, semantic);

  buildMemoryContextFor = async (userId) => {
    // Positionally, as Nest constructs it: context service, unified memory, learning service, prisma.
    const promptContext = new (KeyCortexPromptContextService as any)({} as any, unified, new KeyCortexLearningService(prisma), prisma);
    const session = { id: `${P}sess_mem`, businessId: ID.biz, userId, messages: [{ role: 'user', content: QUERY }] } as any;
    return (await promptContext.buildMemoryContext(ID.biz, session, userId)).aiMemory ?? '';
  };

  pipelinePromptFor = async (userId, stream) => {
    const prompts: string[] = [];
    const session = { id: `${P}sess_pipe`, businessId: ID.biz, userId, status: 'active', persona: 'jarvis', messages: [], detectedRole: null, detectedFunction: null };
    const route = {
      taskCategory: 'general', layers: ['reasoning'], promptVariant: 'standard', includeGenomeContext: false, includeMemoryContext: true,
      includeActions: false, complexity: 'simple', domain: 'general', urgency: 'low', emotionalWeight: 'low', timeHorizon: 'tactical', dataRequirement: 'none',
    };
    const pipeline = new KeyCortexQueryPipelineService(
      {
        complete: async () => ({ content: 'ok', provider: 'openai', model: 'stand-in', usage: { totalTokens: 1, estimatedCost: 0 }, fallbackUsed: false }),
        streamComplete: async function* () {
          yield { content: 'ok', provider: 'openai', model: 'stand-in' };
        },
      } as any,
      prisma,
      { get: async () => null, setex: async () => undefined } as any,
      {
        getPersonalityConfig: () => ({ persona: 'jarvis', temperature: 0.5 }),
        buildSystemPrompt: () => 'You are KEY.',
        buildValueBlock: async () => '',
        classifyPersona: async () => undefined,
        selectTone: async () => ({ tone: '', temperatureAdjustment: 0 }),
      } as any,
      { buildContextSnapshot: async () => ({ businessId: ID.biz, genomeStage: 'startup', executiveReadiness: 50 }), formatContextForPrompt: () => '' } as any,
      { buildToolDefinitions: async () => [], executeActions: async () => [] } as any,
      {
        getOrCreateSession: async () => session,
        generateId: () => `${P}msg`,
        saveMessage: async () => undefined,
        updateSessionCognitionMetadata: async () => undefined,
        updateRunningSummary: async () => undefined,
      } as any,
      {
        buildMemoryContext: async () => ({}),
        buildMessages: (_q: unknown, _c: unknown, systemPrompt: string) => {
          prompts.push(systemPrompt);
          return [];
        },
      } as any,
      { handleToolCalls: async () => null } as any,
      { detectActions: () => [] } as any,
      { generateSuggestions: async () => [] } as any,
      {} as any,
      { buildV2SystemPrompt: () => 'V2', buildV3SystemPrompt: () => 'V3', enrichSnapshotFromV2: () => undefined, enrichSnapshotFromGenome: () => undefined } as any,
      {
        classifyTaskCategory: () => 'general',
        buildStructuredOutputInstructions: () => '',
        parseStructuredResponse: () => ({ role: 'assistant', recommendation: 'ok', confidence: 80 }),
      } as any,
      { detectMood: () => 'casual' } as any,
      // The pipeline's read passes the turn's text as its query: the real semantic store answers it.
      new KeyCortexMemoryRetrievalService(unified),
      { route: async () => route } as any,
    );
    const query = { text: QUERY, businessId: ID.biz, userId } as any;
    const flags = { integrationV2Enabled: false, genomeV3Enabled: false };
    if (stream) {
      for await (const _chunk of pipeline.streamQuery(query, flags)) {
        /* drained */
      }
    } else {
      await pipeline.processQuery(query, flags);
    }
    expect(prompts, `one prompt for ${userId} (${stream ? 'stream' : 'chat'})`).toHaveLength(1);
    return prompts[0];
  };

  await cleanup();
  for (const [id, role] of [
    [ID.owner, 'USER'],
    [ID.blind, 'USER'],
    [ID.revenue, 'USER'],
    [ID.root, 'SUPER_ADMIN'],
    [ID.outsider, 'USER'],
  ] as const) {
    await db.user.create({ data: { id, email: `${id}@${P}test.local`, role } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'V74U Biz', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.other, name: 'V74U Other', slug: `${P}other`, ownerId: ID.outsider, currency: 'TTD' } });
  for (const [userId, businessId, role, extra] of [
    [ID.owner, ID.biz, 'OWNER', { maxApprovalTier: 4 }],
    [ID.blind, ID.biz, 'STAFF', { permissionScopes: BLIND_SCOPES, maxApprovalTier: 0 }],
    [ID.revenue, ID.biz, 'STAFF', { permissionScopes: REVENUE_SCOPES, maxApprovalTier: 0 }],
    [ID.outsider, ID.other, 'OWNER', { maxApprovalTier: 4 }],
  ] as const) {
    await db.membership.create({ data: { id: m(userId, businessId), userId, businessId, role, ...extra } });
  }
}, 180_000);

afterAll(async () => {
  globalThis.fetch = saved.fetch;
  if (db) await cleanup();
});

const lower = (x: unknown) => (typeof x === 'string' ? x : JSON.stringify(x)).toLowerCase();

describe('MEM-UNIFIED-SEMANTIC-SIGHT (D-257, D-234, D-100): the unified memory read applies the semantic reader projection', () => {
  it('V74U-01 RED: a temporal money summary, a payment-events summary, a statement chunk and a money pattern copy reach the owner and the revenue reader, and neither the blind STAFF member, the memberless SUPER_ADMIN nor the other business\'s owner, in buildMemoryContext and the cortex chat prompt (chat and stream)', async () => {
    await clearMemory();
    try {
      await seedOrdinary();
      await seedRevenue(1, 1);
      for (const reader of [...BLIND_READERS, ...SEEING_READERS]) {
        const seen = await everythingFor(reader);
        for (const [surface, value] of Object.entries(seen)) {
          const text = lower(value);
          const label = `${reader} ${surface}: ${text.slice(0, 1500)}`;
          if (SEEING_READERS.includes(reader)) {
            expect(text, label).toContain(REV);
            expect(text, label).toContain(AMOUNT);
          } else {
            expect(text, label).not.toContain(REV);
            expect(text, label).not.toContain(AMOUNT);
          }
        }
        // Every member sees the ordinary fact's copy (business-wide), whatever their revenue scope.
        if (reader === 'blind' || SEEING_READERS.includes(reader)) {
          expect(seen.buildMemoryContext, `${reader}: ordinary fact`).toContain(okMarker(0));
          expect(seen.chat, `${reader}: ordinary fact`).toContain(okMarker(0));
        }
      }
      expect(outbound).toEqual([]);
    } finally {
      await clearMemory();
    }
  }, 300_000);

  it('V74U-02 differential, filtered before the limit: every memory line the blind STAFF member is handed (buildMemoryContext, chat, stream) is identical whether the business holds no revenue-derived hit or 3 of each kind and 200 money pattern copies, all ranked above theirs; the owner sees them, and still every ordinary hit', async () => {
    await clearMemory();
    try {
      await seedOrdinary();
      await ageSources();
      const before = await everythingFor('blind');
      for (const n of [1, 2, 3]) expect(before.chat, `ordinary summary ${n}`).toContain(okMarker(n));
      await seedRevenue(3, 200);
      const after = await everythingFor('blind');
      for (const surface of ['buildMemoryContext', 'chat', 'stream'] as const) {
        expect(memoryLines(after[surface]), `blind ${surface}`).toEqual(memoryLines(before[surface]));
        expect(lower(after[surface])).not.toContain(REV);
      }
      // The owner is unchanged: the revenue-derived hits rank first, the ordinary ones follow (within the read's limit).
      const owner = await unified.retrieveContext(ID.biz, { query: QUERY, limit: 400, userId: ID.owner, semanticSight: await ownerSight() });
      const semanticContents = owner.filter((f: any) => f.sourceType === 'ai_memory_embedding').map((f: any) => lower(f.content));
      expect(semanticContents.filter((c: string) => c.includes(REV)).length).toBe(3 * 3 + 200);
      for (const n of [0, 1, 2, 3]) expect(semanticContents.some((c: string) => c.includes(lower(okMarker(n)))), `owner ok ${n}`).toBe(true);
    } finally {
      await clearMemory();
    }
  }, 600_000);

  it('V74U-03 the fragment keeps its source: each semantic fragment carries its source type and id (temporal_memory, document, memory) under its metadata, written after the copy\'s own metadata', async () => {
    await clearMemory();
    try {
      await seedOrdinary();
      await seedRevenue(1, 1);
      const { SEMANTIC_SOURCE_METADATA_KEY } = await import('../src/modules/key-cortex/unified-memory.types');
      const owner = await unified.retrieveContext(ID.biz, { query: QUERY, limit: 50, userId: ID.owner, semanticSight: await ownerSight() });
      const sources = owner
        .filter((f: any) => f.sourceType === 'ai_memory_embedding')
        .map((f: any) => f.metadata?.[SEMANTIC_SOURCE_METADATA_KEY]);
      expect(sources.every((s: any) => s && typeof s.sourceType === 'string' && typeof s.sourceId === 'string')).toBe(true);
      expect(new Set(sources.map((s: any) => s.sourceType))).toEqual(new Set(['temporal_memory', 'document', 'memory']));
      const ids = await db.aiMemoryEmbedding.findMany({ where: { businessId: ID.biz }, select: { sourceType: true, sourceId: true } });
      for (const s of sources) expect(ids.some((r: any) => r.sourceType === s.sourceType && r.sourceId === s.sourceId)).toBe(true);
    } finally {
      await clearMemory();
    }
  }, 300_000);

  it('V74U-06 a forged source cannot stand in: a copy whose own metadata carries a semanticSource naming another (visible) source keeps the source its row records (sourceType, sourceId), not the forged one', async () => {
    await clearMemory();
    try {
      await seedOrdinary();
      await ageSources();
      const { SEMANTIC_SOURCE_METADATA_KEY } = await import('../src/modules/key-cortex/unified-memory.types');
      const fact = await db.aiMemory.findFirst({ where: { businessId: ID.biz, key: `${P}fact` }, select: { id: true } });
      const summary = await db.temporalFlowMemory.findFirst({ where: { businessId: ID.biz, entityId: `${P}th_ok_1` }, select: { id: true } });
      expect(fact && summary, 'premise: a fact row and a visible summary row exist').toBeTruthy();
      const copy = await db.aiMemoryEmbedding.findFirst({ where: { businessId: ID.biz, sourceType: 'temporal_memory', sourceId: summary.id }, select: { content: true } });
      expect(copy, 'premise: the summary was embedded').toBeTruthy();
      // A second copy of the summary (visible to the owner) whose own metadata names the fact's copy, another visible source.
      const forged = { sourceType: 'memory', sourceId: fact.id };
      await semantic.store({
        businessId: ID.biz, content: copy.content, sourceType: 'temporal_memory', sourceId: summary.id,
        metadata: { [SEMANTIC_SOURCE_METADATA_KEY]: forged },
      });
      const stored = await db.aiMemoryEmbedding.findMany({ where: { businessId: ID.biz, sourceType: 'temporal_memory', sourceId: summary.id }, select: { metadata: true } });
      expect(stored, 'premise: two copies of the summary').toHaveLength(2);
      expect(stored.some((r: any) => (r.metadata as any)?.[SEMANTIC_SOURCE_METADATA_KEY]?.sourceId === fact.id), 'premise: the forged key is stored on a copy').toBe(true);
      const owner = await unified.retrieveContext(ID.biz, { query: QUERY, limit: 50, userId: ID.owner, semanticSight: await ownerSight() });
      const hits = owner.filter((f: any) => f.sourceType === 'ai_memory_embedding' && f.content === copy.content);
      expect(hits, 'both copies are served to the owner').toHaveLength(2);
      for (const hit of hits) expect(hit.metadata[SEMANTIC_SOURCE_METADATA_KEY]).toEqual({ sourceType: 'temporal_memory', sourceId: summary.id });
    } finally {
      await clearMemory();
    }
  }, 300_000);

  it('V74U-04 fail closed: a read that carries a query and no semantic sight (the eval harness, any future caller) keeps no semantic hit at all, not even an ordinary one', async () => {
    await clearMemory();
    try {
      await seedOrdinary();
      await seedRevenue(1, 1);
      const read = await unified.retrieveContext(ID.biz, { query: QUERY, limit: 50, userId: ID.owner });
      expect(read.filter((f: any) => f.sourceType === 'ai_memory_embedding')).toEqual([]);
    } finally {
      await clearMemory();
    }
  }, 300_000);

  it('V74U-05 cross-tenant: the other business\'s money summary never reaches this business\'s readers, the owner included; a copy in this business whose source is the other business\'s row resolves to nothing and is withheld from the owner; the other business\'s owner reads this one as nobody', async () => {
    await clearMemory();
    try {
      await seedOrdinary();
      await inboxThread(ID.other, `${P}th_other`, `${OTHER} Invoice INV-X for TTD ${AMOUNT} is overdue`);
      const theirs = await temporalMemory.summarizeThread(ID.other, `${P}th_other`);
      expect(await db.aiMemoryEmbedding.count({ where: { businessId: ID.other, sourceType: 'temporal_memory' } }), 'premise: embedded').toBe(1);
      const copy = await db.aiMemoryEmbedding.findFirst({ where: { businessId: ID.other, sourceType: 'temporal_memory' }, select: { content: true } });
      // A copy in this business naming the other business's row (by id) with that row's very copy text.
      await semantic.store({ businessId: ID.biz, content: copy.content, sourceType: 'temporal_memory', sourceId: theirs.id });
      await ageSources();
      for (const reader of ['owner', 'revenue', 'blind', 'root', 'outsider'] as Reader[]) {
        const seen = await everythingFor(reader);
        for (const [surface, value] of Object.entries(seen)) {
          expect(lower(value), `${reader} ${surface}`).not.toContain(OTHER);
        }
      }
      // The other business's owner, in their own business, still sees their own summary.
      const own = await unified.retrieveContext(ID.other, { query: QUERY, limit: 20, userId: ID.outsider, semanticSight: await sightFor(ID.other, ID.outsider) });
      expect(own.some((f: any) => lower(f.content).includes(OTHER))).toBe(true);
    } finally {
      await clearMemory();
    }
  }, 300_000);
});

/** The owner's semantic sight in ID.biz, as the KEY prompts build it (readerSearchOptions over readersModuleSight). */
async function ownerSight() {
  return sightFor(ID.biz, ID.owner);
}
async function sightFor(businessId: string, userId: string) {
  const { readersModuleSight } = await import('../src/modules/key-cortex/key-cortex-prompt-context.service');
  const { readerSearchOptions } = await import('../src/modules/ai/semantic-memory-sight');
  const sight = await readersModuleSight(prisma, businessId, userId);
  return readerSearchOptions(prisma, businessId, { reader: userId, sight });
}
