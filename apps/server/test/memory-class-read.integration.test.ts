/**
 * MEM-CLASS-READ (P137, V1-91; D-100, D-128, D-226, D-227, D-233, D-234, D-238, D-257):
 * Real-Postgres integration proof covering all 5 memory tables
 * (`ai_memories`, `ai_memory_embeddings`, `temporal_flow_memories`,
 * `cognition_memories`, `key_cortex_memories`) plus `temporal_flow_events`
 * and `knowledge_sources`:
 *
 *   1. `SECRET_BEARING` & secret-pattern backstop withheld from EVERY reader
 *      including `OWNER` and `SUPER_ADMIN` across all stores (including raw
 *      pgvector SQL in `SemanticMemoryService.search`).
 *   2. Zero-keyword `REVENUE` (`E-REV-DIRECT` & `E-REV-INDIRECT`) withheld
 *      from `revenue:none` STAFF and visible to `revenue:read` / `OWNER`.
 *   3. `PERSONAL` strict `ownerUserId === actor.id` — even `OWNER` cannot read
 *      another user's `CognitionMemory` or `KeyCortexMemory` awareness rows.
 *   4. `UNCLASSIFIED`, invalid `module_scope` (`['unknown_secret_module']`),
 *      and unrecognized non-null `data_class` (`'RESTRICTED'`) fail closed.
 *   5. Legacy `data_class IS NULL` rows: benign `TemporalFlowMemory` with
 *      `sourceEventIds` stays visible through `UnifiedMemoryRetrievalService` +
 *      `readersOwnPromptMemory` for STAFF; legacy financial NULL rows and
 *      legacy `document` embeddings fail closed.
 *   6. `MEMORY_CLASS_READ = OFF | SHADOW | ACTIVE`: `ACTIVE` enforces, `OFF`
 *      preserves legacy, `SHADOW` returns legacy and emits sanitized diff
 *      (zero text/keys/PII).
 *   7. 0-vs-50 differential invariance on real Postgres: inserting 50 `REVENUE`
 *      rows + 50 denied `module_scope` (`['expenses']`) rows + 50 legacy NULL
 *      financial rows does NOT alter items, order, or counts for a restricted
 *      STAFF reader across `TemporalFlowMemoryService.findMany`/`getStats`,
 *      `UnifiedMemoryRetrievalService`, `ProactiveSuggestionService`, and
 *      `SemanticMemoryService`.
 *
 * Fixture prefix `v91m_` (registered in `fixture-prefixes.json`), cleaned via
 * raw SQL `sqlLikePrefix(P)` ONLY.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { sqlLikePrefix } from './helpers/sql-like.js';
import type { CanonicalModule } from '../src/core/authority/module-vocabulary';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v91m_';
const ID = {
  biz: `${P}biz`,
  owner: `${P}owner`,
  superAdmin: `${P}superadmin`,
  staffRev: `${P}staff_rev`,
  staffCrm: `${P}staff_crm`,
  staffBlind: `${P}staff_blind`,
  ksDoc: `${P}ks_doc_1`,
};

const UNIT_VECTOR = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
const VECTOR_LITERAL = `[${UNIT_VECTOR.join(',')}]`;

const OWNER_SIGHT = (_m: CanonicalModule) => true;
const REV_NO_EXP_SIGHT = (m: CanonicalModule) => m === 'crm' || m === 'bookings' || m === 'revenue';
const CRM_ONLY_SIGHT = (m: CanonicalModule) => m === 'crm';
const BLIND_SIGHT = (_m: CanonicalModule) => false;

let db: any;
let prisma: any;
let semantic: any;
let aiMemory: any;
let temporalMemory: any;
let unifiedRetrieval: any;
let proactiveSuggestions: any;
let contextV2: any;
let learningService: any;
let awarenessService: any;
let readersOwnPromptMemoryFn: any;
let readerSearchOptionsFn: any;
let viewerMemoryReaderContextFn: any;

async function cleanup() {
  const byBiz = (table: string) => `DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`;
  for (const sql of [
    byBiz('ai_memory_embeddings'),
    byBiz('ai_memories'),
    byBiz('temporal_flow_memories'),
    byBiz('temporal_flow_events'),
    byBiz('cognition_memories'),
    byBiz('key_cortex_memories'),
    byBiz('knowledge_sources'),
    byBiz('key_action_proposals'),
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

async function resetMemoryRows() {
  const byBiz = (table: string) => `DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`;
  for (const sql of [
    byBiz('ai_memory_embeddings'),
    byBiz('ai_memories'),
    byBiz('temporal_flow_memories'),
    byBiz('temporal_flow_events'),
    byBiz('cognition_memories'),
    byBiz('key_cortex_memories'),
    byBiz('knowledge_sources'),
  ]) {
    await db.$executeRawUnsafe(sql);
  }
}

async function insertEmbeddingRow(params: {
  id: string;
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
    ID.biz,
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

describe('MEM-CLASS-READ (P137, V1-91): Real-Postgres Unified Reader Projection', () => {
  const prevFlag = process.env.MEMORY_CLASS_READ;

  beforeAll(async () => {
    const dbMod = await import('@keyflow/db');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { SemanticMemoryService } = await import('../src/modules/ai/semantic-memory.service');
    const { AiExecutionLogService } = await import('../src/modules/ai/ai-execution-log.service');
    const { AiMemoryService } = await import('../src/modules/ai/ai-memory.service');
    const { AiOversightService } = await import('../src/modules/ai/ai-oversight.service');
    const { ProactiveSuggestionService } = await import('../src/modules/ai/proactive-suggestion.service');
    const { TemporalFlowMemoryService } = await import('../src/modules/temporal-flow/temporal-flow-memory.service');
    const { UnifiedMemoryRetrievalService } = await import('../src/modules/key-cortex/unified-memory-retrieval.service');
    const { KeyCortexContextV2Service } = await import('../src/modules/key-cortex/key-cortex-context-v2.service');
    const { KeyCortexLearningService } = await import('../src/modules/key-cortex/key-cortex-learning.service');
    const { KeyCortexAwarenessService } = await import('../src/modules/key-cortex/key-cortex-awareness.service');
    const { readersOwnPromptMemory } = await import('../src/modules/key-cortex/key-cortex-prompt-context.service');
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
    const executionLog = new AiExecutionLogService(prisma);
    aiMemory = new AiMemoryService(prisma, executionLog, { getBlueprint: async () => null } as any, semantic);
    const oversight = new AiOversightService(prisma, executionLog, aiMemory, {} as any, {} as any, {} as any);
    proactiveSuggestions = new ProactiveSuggestionService(
      prisma,
      { scanInsights: async () => [] } as any,
      oversight,
      events,
      semantic,
    );
    temporalMemory = new TemporalFlowMemoryService(prisma, semantic);
    unifiedRetrieval = new UnifiedMemoryRetrievalService(prisma, semantic);
    const stubRedis = {
      get: async () => null,
      set: async () => undefined,
    };
    contextV2 = new KeyCortexContextV2Service(prisma, stubRedis as any);
    learningService = new KeyCortexLearningService(prisma);
    awarenessService = new KeyCortexAwarenessService(prisma);
    readersOwnPromptMemoryFn = readersOwnPromptMemory;
    readerSearchOptionsFn = readerSearchOptions;
    viewerMemoryReaderContextFn = viewerMemoryReaderContext;

    await cleanup();

    for (const u of [
      { id: ID.owner, email: `${P}owner@test.local`, name: 'V91M Owner', role: 'USER' },
      { id: ID.superAdmin, email: `${P}super@test.local`, name: 'V91M SuperAdmin', role: 'SUPER_ADMIN' },
      { id: ID.staffRev, email: `${P}staff_rev@test.local`, name: 'V91M Staff Rev', role: 'USER' },
      { id: ID.staffCrm, email: `${P}staff_crm@test.local`, name: 'V91M Staff CRM', role: 'USER' },
      { id: ID.staffBlind, email: `${P}staff_blind@test.local`, name: 'V91M Staff Blind', role: 'USER' },
    ]) {
      await db.user.create({ data: u });
    }

    await db.business.create({
      data: {
        id: ID.biz,
        name: 'V91M Memory Class Read Biz',
        slug: `${P}biz`,
        ownerId: ID.owner,
      },
    });

    await db.membership.createMany({
      data: [
        { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' },
        {
          id: `${P}m_staff_rev`,
          userId: ID.staffRev,
          businessId: ID.biz,
          role: 'STAFF',
          permissionScopes: { crm: 'read', bookings: 'read', revenue: 'read', expenses: 'none' },
        },
        {
          id: `${P}m_staff_crm`,
          userId: ID.staffCrm,
          businessId: ID.biz,
          role: 'STAFF',
          permissionScopes: { crm: 'read', bookings: 'none', revenue: 'none', expenses: 'none' },
        },
        {
          id: `${P}m_staff_blind`,
          userId: ID.staffBlind,
          businessId: ID.biz,
          role: 'STAFF',
          permissionScopes: { crm: 'none', bookings: 'none', revenue: 'none', expenses: 'none' },
        },
      ],
    });
  }, 60_000);

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

  it('1. SECRET_BEARING and secret-pattern backstop are withheld from EVERY reader including OWNER and SUPER_ADMIN across all stores & pgvector raw SQL', async () => {
    const now = new Date();
    await db.aiMemory.createMany({
      data: [
        {
          id: `${P}am_ok`,
          businessId: ID.biz,
          category: 'tone',
          key: 'preferred',
          value: 'Warm and concise',
          source: 'user',
          dataClass: 'GENERAL',
          moduleScope: [],
          createdAt: now,
        },
        {
          id: `${P}am_sec`,
          businessId: ID.biz,
          category: 'business_fact',
          key: 'vault_token',
          value: 'Vault entry without pattern',
          source: 'user',
          dataClass: 'SECRET_BEARING',
          moduleScope: ['ai'],
          createdAt: now,
        },
        {
          id: `${P}am_mislabeled_secret`,
          businessId: ID.biz,
          category: 'business_fact',
          key: 'note_with_key',
          value: 'Stripe backup key sk_live_51NxAbCdEfGhIjKlMnOpQr',
          source: 'user',
          dataClass: 'GENERAL',
          moduleScope: [],
          createdAt: now,
        },
      ],
    });

    await db.temporalFlowMemory.createMany({
      data: [
        {
          id: `${P}tf_ok`,
          businessId: ID.biz,
          entityType: 'contact',
          entityId: `${P}c1`,
          type: 'summary',
          content: 'Prefers email check-ins',
          sourceModule: 'crm',
          sourceEventIds: [],
          metadata: {},
          confidence: 0.9,
          dataClass: 'GENERAL',
          moduleScope: ['crm'],
        },
        {
          id: `${P}tf_sec`,
          businessId: ID.biz,
          entityType: 'contact',
          entityId: `${P}c2`,
          type: 'summary',
          content: 'Internal secret summary',
          sourceModule: 'crm',
          sourceEventIds: [],
          metadata: {},
          confidence: 0.9,
          dataClass: 'SECRET_BEARING',
          moduleScope: ['crm'],
        },
      ],
    });

    await insertEmbeddingRow({
      id: `${P}emb_ok`,
      sourceType: 'memory',
      sourceId: `${P}am_ok`,
      content: 'tone: preferred = Warm and concise',
      metadata: { category: 'tone', key: 'preferred' },
      dataClass: 'GENERAL',
      moduleScope: [],
    });
    await insertEmbeddingRow({
      id: `${P}emb_sec`,
      sourceType: 'memory',
      sourceId: `${P}am_sec`,
      content: 'business_fact: vault_token = Vault entry without pattern',
      metadata: { category: 'business_fact', key: 'vault_token' },
      dataClass: 'SECRET_BEARING',
      moduleScope: ['ai'],
    });

    const ownerCtx = { reader: ID.owner, sight: OWNER_SIGHT };
    const superAdminCtx = { reader: ID.superAdmin, sight: OWNER_SIGHT };

    for (const ctx of [ownerCtx, superAdminCtx]) {
      const mems = await aiMemory.getAll(ID.biz, ctx);
      expect(mems.map((m: any) => m.id)).toEqual([`${P}am_ok`]);
      expect(await aiMemory.get(ID.biz, 'business_fact', 'vault_token', ctx)).toBeNull();

      const tfs = await temporalMemory.findMany(ID.biz, { limit: 50 }, ctx);
      expect(tfs.map((t: any) => t.id)).toEqual([`${P}tf_ok`]);
      expect(await temporalMemory.findById(ID.biz, `${P}tf_sec`, ctx)).toBeNull();

      const semHits = await semantic.search({
        businessId: ID.biz,
        query: 'vault warm concise',
        limit: 10,
        minSimilarity: 0.1,
        visibleTo: readerSearchOptionsFn(prisma, ID.biz, ctx).visibleTo,
      });
      expect(semHits.map((h: any) => h.id)).toEqual([`${P}emb_ok`]);

      const unified = await unifiedRetrieval.retrieveContext(ID.biz, {
        limit: 20,
        boostRecency: false,
        readerContext: ctx,
        semanticSight: readerSearchOptionsFn(prisma, ID.biz, ctx),
        query: 'vault warm concise',
      });
      const unifiedIds = unified.map((f: any) => f.id);
      expect(unifiedIds).not.toContain(`${P}am_sec`);
      expect(unifiedIds).not.toContain(`${P}am_mislabeled_secret`);
      expect(unifiedIds).not.toContain(`${P}tf_sec`);
      expect(unifiedIds).not.toContain(`${P}emb_sec`);
      expect(unifiedIds).toContain(`${P}am_ok`);
      expect(unifiedIds).toContain(`${P}tf_ok`);
    }

    // Even WITHOUT readerContext, SECRET_BEARING is unconditionally excluded
    const noCtxTemporal = await temporalMemory.findMany(ID.biz, { limit: 50 });
    expect(noCtxTemporal.map((t: any) => t.id)).toEqual([`${P}tf_ok`]);
    expect(await temporalMemory.findById(ID.biz, `${P}tf_sec`)).toBeNull();
    const noCtxAi = await aiMemory.getAll(ID.biz);
    expect(noCtxAi.map((m: any) => m.id)).toEqual([`${P}am_ok`]);
  });

  it('2. Zero-keyword REVENUE (E-REV-DIRECT & E-REV-INDIRECT) withheld from revenue:none STAFF and visible to revenue:read / OWNER', async () => {
    const now = new Date();
    const zeroKeywordText = 'Account Alpha prefers Tuesday morning check-ins';

    await db.aiMemory.createMany({
      data: [
        {
          id: `${P}am_gen`,
          businessId: ID.biz,
          category: 'goals',
          key: 'g1',
          value: 'Launch community workshop',
          source: 'user',
          dataClass: 'GENERAL',
          moduleScope: [],
          createdAt: now,
        },
        {
          id: `${P}am_rev`,
          businessId: ID.biz,
          category: 'business_fact',
          key: 'alpha_cadence',
          value: zeroKeywordText,
          source: 'inferred',
          dataClass: 'REVENUE',
          moduleScope: ['revenue'],
          createdAt: now,
        },
      ],
    });

    await db.temporalFlowMemory.create({
      data: {
        id: `${P}tf_rev`,
        businessId: ID.biz,
        entityType: 'contact',
        entityId: `${P}c_alpha`,
        type: 'summary',
        content: zeroKeywordText,
        sourceModule: 'crm',
        sourceEventIds: [],
        metadata: {},
        confidence: 0.9,
        dataClass: 'REVENUE',
        moduleScope: ['crm', 'revenue'],
      },
    });

    await insertEmbeddingRow({
      id: `${P}emb_rev`,
      sourceType: 'memory',
      sourceId: `${P}am_rev`,
      content: `business_fact: alpha_cadence = ${zeroKeywordText}`,
      metadata: { category: 'business_fact', key: 'alpha_cadence' },
      dataClass: 'REVENUE',
      moduleScope: ['revenue'],
    });
    await insertEmbeddingRow({
      id: `${P}emb_gen`,
      sourceType: 'memory',
      sourceId: `${P}am_gen`,
      content: 'goals: g1 = Launch community workshop',
      metadata: { category: 'goals', key: 'g1' },
      dataClass: 'GENERAL',
      moduleScope: [],
    });

    const crmCtx = { reader: ID.staffCrm, sight: CRM_ONLY_SIGHT };
    const revCtx = { reader: ID.staffRev, sight: REV_NO_EXP_SIGHT };
    const ownerCtx = { reader: ID.owner, sight: OWNER_SIGHT };

    // STAFF without revenue:read sees ZERO of the zero-keyword REVENUE items across all stores
    expect((await aiMemory.getAll(ID.biz, crmCtx)).map((r: any) => r.id)).toEqual([`${P}am_gen`]);
    expect((await temporalMemory.findMany(ID.biz, { limit: 50 }, crmCtx)).map((r: any) => r.id)).toEqual([]);
    const crmTemporalCtx = await contextV2.getTemporalContext(ID.biz, crmCtx);
    expect(crmTemporalCtx.recentMemories).toEqual([]);
    expect(crmTemporalCtx.patternsDetected).toEqual([]);
    const crmSem = await semantic.search({
      businessId: ID.biz,
      query: 'alpha workshop',
      limit: 10,
      minSimilarity: 0.1,
      visibleTo: readerSearchOptionsFn(prisma, ID.biz, crmCtx).visibleTo,
    });
    expect(crmSem.map((h: any) => h.id)).toEqual([`${P}emb_gen`]);

    // STAFF with revenue:read AND OWNER see them cleanly
    for (const ctx of [revCtx, ownerCtx]) {
      expect((await aiMemory.getAll(ID.biz, ctx)).map((r: any) => r.id).sort()).toEqual([`${P}am_gen`, `${P}am_rev`]);
      expect((await temporalMemory.findMany(ID.biz, { limit: 50 }, ctx)).map((r: any) => r.id)).toEqual([`${P}tf_rev`]);
      const sem = await semantic.search({
        businessId: ID.biz,
        query: 'alpha workshop',
        limit: 10,
        minSimilarity: 0.1,
        visibleTo: readerSearchOptionsFn(prisma, ID.biz, ctx).visibleTo,
      });
      expect(sem.map((h: any) => h.id).sort()).toEqual([`${P}emb_gen`, `${P}emb_rev`]);
    }
  });

  it('3. PERSONAL strict ownerUserId === actor.id (even OWNER cannot read another user personal CognitionMemory or KeyCortexMemory)', async () => {
    const now = new Date();
    await db.cognitionMemory.createMany({
      data: [
        {
          id: `${P}cog_owner`,
          businessId: ID.biz,
          sessionId: `${P}sess_owner`,
          userId: ID.owner,
          query: 'Owner personal query',
          recommendation: 'Owner recommendation',
          userResponse: 'accepted',
          confidence: 0.9,
          lessonsLearned: ['Owner private lesson'],
          createdAt: now,
        },
        {
          id: `${P}cog_staff`,
          businessId: ID.biz,
          sessionId: `${P}sess_staff`,
          userId: ID.staffCrm,
          query: 'Staff personal query',
          recommendation: 'Staff recommendation',
          userResponse: 'accepted',
          confidence: 0.9,
          lessonsLearned: ['Staff private lesson'],
          createdAt: now,
        },
      ],
    });

    await db.keyCortexMemory.createMany({
      data: [
        {
          id: `${P}kc_shared`,
          businessId: ID.biz,
          type: 'weak_signal',
          key: `${P}ws_shared`,
          userId: null,
          value: JSON.stringify({ description: 'Business-wide booking pattern' }),
          confidence: 0.85,
          createdAt: now,
        },
        {
          id: `${P}kc_staff_personal`,
          businessId: ID.biz,
          type: 'weak_signal',
          key: `${P}ws_staff`,
          userId: ID.staffCrm,
          value: JSON.stringify({ description: 'Staff private draft signal' }),
          confidence: 0.9,
          createdAt: now,
        },
        {
          id: `${P}kc_owner_personal`,
          businessId: ID.biz,
          type: 'weak_signal',
          key: `${P}ws_owner`,
          userId: ID.owner,
          value: JSON.stringify({ description: 'Owner private draft signal' }),
          confidence: 0.9,
          createdAt: now,
        },
      ],
    });

    const ownerAuthorityCtx = viewerMemoryReaderContextFn({
      userId: ID.owner,
      businessId: ID.biz,
      role: 'OWNER',
      superAdmin: false,
      scopes: { crm: 'admin', revenue: 'admin', expenses: 'admin' },
      member: true,
    });
    const staffAuthorityCtx = viewerMemoryReaderContextFn({
      userId: ID.staffCrm,
      businessId: ID.biz,
      role: 'STAFF',
      superAdmin: false,
      scopes: { crm: 'read', revenue: 'none', expenses: 'none' },
      member: true,
    });

    // OWNER cannot read staff's PERSONAL CognitionMemory via UnifiedMemoryRetrievalService or LearningService
    const ownerUnified = await unifiedRetrieval.retrieveContext(ID.biz, {
      limit: 20,
      sourceTypes: ['cognition_memory'],
      readerContext: ownerAuthorityCtx,
    });
    expect(ownerUnified.map((f: any) => f.id)).toEqual([`${P}cog_owner`]);

    const ownerLessons = await learningService.retrieveLessons(ID.biz, 'personal query', {
      userId: ID.owner,
      readerContext: ownerAuthorityCtx,
    });
    expect(ownerLessons).toEqual(['[accepted] Owner private lesson']);

    // OWNER cannot read staff's PERSONAL KeyCortexMemory awareness row (and vice versa)
    const ownerAwareness = await awarenessService.getAwareness(ID.biz, {
      kinds: ['weakSignal'],
      readsRevenue: true,
      readerContext: ownerAuthorityCtx,
    });
    expect(ownerAwareness.items.map((i: any) => i.id).sort()).toEqual([`${P}ws_owner`, `${P}ws_shared`]);

    const staffAwareness = await awarenessService.getAwareness(ID.biz, {
      kinds: ['weakSignal'],
      readsRevenue: false,
      readerContext: staffAuthorityCtx,
    });
    expect(staffAwareness.items.map((i: any) => i.id).sort()).toEqual([`${P}ws_shared`, `${P}ws_staff`]);
  });

  it('4. UNCLASSIFIED, invalid module_scope, and unrecognized non-null data_class fail closed on real Postgres rows', async () => {
    const now = new Date();
    await db.aiMemory.createMany({
      data: [
        {
          id: `${P}am_ok`,
          businessId: ID.biz,
          category: 'tone',
          key: 't1',
          value: 'Clear tone',
          source: 'user',
          dataClass: 'GENERAL',
          moduleScope: [],
          createdAt: now,
        },
        {
          id: `${P}am_unclass`,
          businessId: ID.biz,
          category: 'custom_misc',
          key: 'u1',
          value: 'Unclassified row',
          source: 'user',
          dataClass: 'UNCLASSIFIED',
          moduleScope: [],
          createdAt: now,
        },
        {
          id: `${P}am_bad_scope`,
          businessId: ID.biz,
          category: 'tone',
          key: 'bad_scope',
          value: 'Row with unknown module scope',
          source: 'user',
          dataClass: 'GENERAL',
          moduleScope: ['unknown_secret_module'],
          createdAt: now,
        },
        {
          id: `${P}am_bad_class`,
          businessId: ID.biz,
          category: 'tone',
          key: 'bad_class',
          value: 'Row with unrecognized data_class',
          source: 'user',
          dataClass: 'RESTRICTED',
          moduleScope: [],
          createdAt: now,
        },
      ],
    });

    const ownerCtx = { reader: ID.owner, sight: OWNER_SIGHT };
    const crmCtx = { reader: ID.staffCrm, sight: CRM_ONLY_SIGHT };

    // STAFF sees ONLY am_ok (UNCLASSIFIED, invalid module_scope, and RESTRICTED all fail closed)
    expect((await aiMemory.getAll(ID.biz, crmCtx)).map((r: any) => r.id)).toEqual([`${P}am_ok`]);

    // Even OWNER does NOT see invalid module_scope or unrecognized non-null data_class ('RESTRICTED')!
    expect((await aiMemory.getAll(ID.biz, ownerCtx)).map((r: any) => r.id).sort()).toEqual([
      `${P}am_ok`,
      `${P}am_unclass`,
    ]);
  });

  it('5. Legacy data_class IS NULL rows: benign TemporalFlowMemory stays visible through UnifiedMemoryRetrieval + readersOwnPromptMemory; legacy financial & document embeddings fail closed', async () => {
    const now = new Date();
    // Real benign CRM TemporalFlowEvent + legacy NULL TemporalFlowMemory referencing it
    await db.temporalFlowEvent.create({
      data: {
        id: `${P}ev_crm`,
        businessId: ID.biz,
        source: 'crm',
        type: 'contact.updated',
        module: 'crm',
        entityType: 'contact',
        entityId: `${P}c1`,
        title: 'Updated contact preference',
        summary: 'Prefers Tuesday mornings',
        occurredAt: now,
      },
    });
    await db.temporalFlowEvent.create({
      data: {
        id: `${P}ev_inv`,
        businessId: ID.biz,
        source: 'commerce',
        type: 'invoice.paid',
        module: 'revenue',
        entityType: 'invoice',
        entityId: `${P}inv1`,
        title: 'Invoice settled',
        summary: 'Payment received for INV-77',
        occurredAt: now,
      },
    });
    await db.temporalFlowMemory.createMany({
      data: [
        {
          id: `${P}tf_legacy_crm`,
          businessId: ID.biz,
          entityType: 'contact',
          entityId: `${P}c1`,
          type: 'summary',
          content: 'Client prefers Tuesday morning calls',
          sourceModule: 'crm',
          sourceEventIds: [`${P}ev_crm`],
          metadata: { eventCount: 1 },
          confidence: 0.9,
          dataClass: null,
          moduleScope: [],
          createdAt: now,
        },
        {
          id: `${P}tf_legacy_fin`,
          businessId: ID.biz,
          entityType: 'contact',
          entityId: `${P}c2`,
          type: 'summary',
          content: 'Account Alpha settled balance',
          sourceModule: 'crm',
          sourceEventIds: [`${P}ev_inv`],
          metadata: { eventCount: 1 },
          confidence: 0.9,
          dataClass: null,
          moduleScope: [],
          createdAt: now,
        },
      ],
    });
    await db.$executeRawUnsafe(
      `UPDATE temporal_flow_memories SET module_scope = NULL WHERE business_id = $1 AND id IN ($2, $3)`,
      ID.biz,
      `${P}tf_legacy_crm`,
      `${P}tf_legacy_fin`,
    );

    // Legacy knowledge document embedding (data_class = NULL)
    await db.knowledgeSource.create({
      data: {
        id: ID.ksDoc,
        businessId: ID.biz,
        title: 'Internal Handbook',
        sourceType: 'text',
        content: 'Internal handbook section with sensitive details',
        status: 'ready',
      },
    });
    await insertEmbeddingRow({
      id: `${P}emb_legacy_doc`,
      sourceType: 'document',
      sourceId: `${ID.ksDoc}:0`,
      content: 'Internal handbook section with sensitive details',
      metadata: { title: 'Internal Handbook' },
      dataClass: null,
      moduleScope: null,
    });

    const crmCtx = { reader: ID.staffCrm, sight: CRM_ONLY_SIGHT };
    const revNoExpCtx = { reader: ID.staffRev, sight: REV_NO_EXP_SIGHT };

    // Unified retrieval + downstream readersOwnPromptMemory MUST keep benign legacy CRM temporal row
    const retrieved = await unifiedRetrieval.retrieveContext(ID.biz, {
      limit: 20,
      boostRecency: false,
      readerContext: crmCtx,
      semanticSight: readerSearchOptionsFn(prisma, ID.biz, crmCtx),
      query: 'Tuesday handbook',
    });
    expect(retrieved.map((f: any) => f.id)).toEqual([`${P}tf_legacy_crm`]);

    const promptKept = await readersOwnPromptMemoryFn(
      prisma,
      ID.biz,
      ID.staffCrm,
      retrieved,
      15,
      undefined,
      'v91m_legacy',
      CRM_ONLY_SIGHT,
    );
    expect(promptKept.map((f: any) => f.id)).toEqual([`${P}tf_legacy_crm`]);

    // Legacy document embedding fails closed for both CRM-only AND revenue-without-expenses readers
    const crmSem = await semantic.search({
      businessId: ID.biz,
      query: 'handbook',
      limit: 10,
      minSimilarity: 0.1,
      visibleTo: readerSearchOptionsFn(prisma, ID.biz, crmCtx).visibleTo,
    });
    expect(crmSem).toEqual([]);
    const revSem = await semantic.search({
      businessId: ID.biz,
      query: 'handbook',
      limit: 10,
      minSimilarity: 0.1,
      visibleTo: readerSearchOptionsFn(prisma, ID.biz, revNoExpCtx).visibleTo,
    });
    expect(revSem).toEqual([]);

    // And in readersOwnPromptMemory directly, a legacy document fragment fails closed for restricted readers
    const docFrag = [
      {
        id: `${P}emb_legacy_doc`,
        sourceType: 'ai_memory_embedding' as const,
        entityType: null,
        title: 'Internal Handbook',
        content: 'Internal handbook section',
        metadata: { semanticSource: { sourceType: 'document', sourceId: `${ID.ksDoc}:0` } },
      },
    ];
    expect(await readersOwnPromptMemoryFn(prisma, ID.biz, ID.staffCrm, docFrag, 10)).toEqual([]);
    expect(await readersOwnPromptMemoryFn(prisma, ID.biz, ID.staffRev, docFrag, 10)).toEqual([]);
    expect((await readersOwnPromptMemoryFn(prisma, ID.biz, ID.owner, docFrag, 10)).map((f: any) => f.id)).toEqual([
      `${P}emb_legacy_doc`,
    ]);
  });

  it('6. MEMORY_CLASS_READ = OFF | SHADOW | ACTIVE preserves legacy in OFF/SHADOW and logs sanitized SHADOW diffs without content/keys/PII', async () => {
    const secretVal = 'TOP_SECRET_ZERO_KEYWORD_VALUE_991';
    const secretKey = 'SECRET_KEY_LABEL_991';
    await db.aiMemory.createMany({
      data: [
        {
          id: `${P}am_flag_gen`,
          businessId: ID.biz,
          category: 'goals',
          key: 'g1',
          value: 'Grow workshops',
          source: 'user',
          dataClass: 'GENERAL',
          moduleScope: [],
        },
        {
          id: `${P}am_flag_rev`,
          businessId: ID.biz,
          category: 'business_fact',
          key: secretKey,
          value: secretVal,
          source: 'inferred',
          dataClass: 'REVENUE',
          moduleScope: ['revenue'],
        },
      ],
    });
    const crmCtx = { reader: ID.staffCrm, sight: CRM_ONLY_SIGHT };

    process.env.MEMORY_CLASS_READ = 'OFF';
    const offRows = await aiMemory.getAll(ID.biz, crmCtx);
    expect(offRows.map((r: any) => r.id).sort()).toEqual([`${P}am_flag_gen`, `${P}am_flag_rev`]);

    process.env.MEMORY_CLASS_READ = 'SHADOW';
    const capturedLogs: string[] = [];
    const origWarn = aiMemory.logger.warn.bind(aiMemory.logger);
    aiMemory.logger.warn = (msg: string) => {
      capturedLogs.push(String(msg));
    };
    try {
      const shadowRows = await aiMemory.getAll(ID.biz, crmCtx);
      expect(shadowRows.map((r: any) => r.id).sort()).toEqual([`${P}am_flag_gen`, `${P}am_flag_rev`]);
      expect(capturedLogs.length).toBeGreaterThanOrEqual(1);
      const joined = capturedLogs.join('\n');
      expect(joined).toContain('memory_class_read_shadow_diff');
      expect(joined).toContain(`${P}am_flag_rev`);
      expect(joined).not.toContain(secretVal);
      expect(joined).not.toContain(secretKey);
    } finally {
      aiMemory.logger.warn = origWarn;
    }

    process.env.MEMORY_CLASS_READ = 'ACTIVE';
    const activeRows = await aiMemory.getAll(ID.biz, crmCtx);
    expect(activeRows.map((r: any) => r.id)).toEqual([`${P}am_flag_gen`]);
  });

  it('7. 0-vs-50 differential invariance on real Postgres across REVENUE, denied module_scope, and legacy NULL financial rows', async () => {
    const baseMs = Date.now() - 2 * 3600_000;
    const futureExpiry = new Date(Date.now() + 24 * 3600_000);
    const crmCtx = { reader: ID.staffCrm, sight: CRM_ONLY_SIGHT };

    // Seed 5 allowed GENERAL CRM rows across TemporalFlowMemory, AiMemory, Suggestions, and Embeddings
    for (let i = 0; i < 5; i++) {
      const ts = new Date(baseMs + i * 1000);
      await db.temporalFlowMemory.create({
        data: {
          id: `${P}tf_ok_${i}`,
          businessId: ID.biz,
          entityType: 'contact',
          entityId: `${P}c_ok_${i}`,
          type: 'summary',
          content: `Allowed CRM note ${i}`,
          sourceModule: 'crm',
          sourceEventIds: [],
          metadata: {},
          confidence: 0.8 + i * 0.02,
          dataClass: 'GENERAL',
          moduleScope: ['crm'],
          createdAt: ts,
          updatedAt: ts,
        },
      });
      await db.aiMemory.create({
        data: {
          id: `${P}am_ok_${i}`,
          businessId: ID.biz,
          category: 'goals',
          key: `goal_ok_${i}`,
          value: `Allowed CRM goal ${i}`,
          source: 'user',
          confidence: 0.8 + i * 0.02,
          dataClass: 'GENERAL',
          moduleScope: ['crm'],
          createdAt: ts,
          updatedAt: ts,
        },
      });
      await db.aiMemory.create({
        data: {
          id: `${P}sug_ok_${i}`,
          businessId: ID.biz,
          category: 'suggestion',
          key: `sug_ok_${i}`,
          value: JSON.stringify({
            id: `${P}sug_ok_${i}`,
            category: 'crm_followup',
            title: `CRM follow-up ${i}`,
            message: `Check in with contact ${i}`,
            actions: [],
            severity: 'info',
            createdAt: ts,
          }),
          source: 'key_ai',
          expiresAt: futureExpiry,
          dataClass: 'GENERAL',
          moduleScope: ['crm'],
          createdAt: ts,
          updatedAt: ts,
        },
      });
      await insertEmbeddingRow({
        id: `${P}emb_ok_${i}`,
        sourceType: 'memory',
        sourceId: `${P}am_ok_${i}`,
        content: `goals: goal_ok_${i} = Allowed CRM goal ${i}`,
        metadata: { category: 'goals', key: `goal_ok_${i}` },
        dataClass: 'GENERAL',
        moduleScope: ['crm'],
        createdAt: ts,
      });
    }

    const captureSurfaceSnapshot = async () => {
      const [tfList, tfStats, unified, suggestions, semHits] = await Promise.all([
        temporalMemory.findMany(ID.biz, { limit: 5 }, crmCtx),
        temporalMemory.getStats(ID.biz, crmCtx),
        unifiedRetrieval.retrieveContext(ID.biz, {
          limit: 10,
          boostRecency: false,
          sourceTypes: ['ai_memory', 'temporal_flow_memory'],
          readerContext: crmCtx,
        }),
        proactiveSuggestions.getPendingSuggestions(ID.biz, crmCtx),
        semantic.search({
          businessId: ID.biz,
          query: 'Allowed CRM goal',
          limit: 5,
          minSimilarity: 0.1,
          visibleTo: readerSearchOptionsFn(prisma, ID.biz, crmCtx).visibleTo,
        }),
      ]);
      return {
        tfIds: tfList.map((r: any) => r.id),
        tfStats,
        unifiedIds: unified.map((f: any) => f.id),
        suggestionIds: suggestions.map((s: any) => s.id),
        semIds: semHits.map((h: any) => h.id).sort(),
      };
    };

    const baseline = await captureSurfaceSnapshot();
    expect(baseline.tfIds).toHaveLength(5);
    expect(baseline.tfStats).toEqual({ total: 5, byType: { summary: 5 } });
    expect(baseline.unifiedIds).toHaveLength(10);
    expect(baseline.suggestionIds).toHaveLength(5);
    expect(baseline.semIds).toHaveLength(5);

    // Now inject 50 NEWER REVENUE rows + 50 NEWER denied module_scope=['expenses'] rows
    // + 50 NEWER legacy NULL financial rows across every store!
    const tfFlood: any[] = [];
    const amFlood: any[] = [];
    for (let i = 0; i < 50; i++) {
      const tsRev = new Date(baseMs + 3600_000 + i * 1000);
      const tsExp = new Date(baseMs + 4200_000 + i * 1000);
      const tsNull = new Date(baseMs + 4800_000 + i * 1000);

      tfFlood.push(
        {
          id: `${P}tf_rev_${i}`,
          businessId: ID.biz,
          entityType: 'contact',
          entityId: `${P}c_rev_${i}`,
          type: 'cadence',
          content: `Stealth revenue cadence ${i}`,
          sourceModule: 'crm',
          sourceEventIds: [],
          metadata: {},
          confidence: 0.99,
          dataClass: 'REVENUE',
          moduleScope: ['revenue'],
          createdAt: tsRev,
          updatedAt: tsRev,
        },
        {
          id: `${P}tf_exp_${i}`,
          businessId: ID.biz,
          entityType: 'contact',
          entityId: `${P}c_exp_${i}`,
          type: 'vendor_note',
          content: `Expense scope note ${i}`,
          sourceModule: 'expenses',
          sourceEventIds: [],
          metadata: {},
          confidence: 0.99,
          dataClass: 'GENERAL',
          moduleScope: ['expenses'],
          createdAt: tsExp,
          updatedAt: tsExp,
        },
        {
          id: `${P}tf_null_fin_${i}`,
          businessId: ID.biz,
          entityType: 'invoice',
          entityId: `${P}inv_${i}`,
          type: 'summary',
          content: `Invoice #${i} total $500`,
          sourceModule: 'commerce',
          sourceEventIds: [],
          metadata: {},
          confidence: 0.99,
          dataClass: null,
          moduleScope: [],
          createdAt: tsNull,
          updatedAt: tsNull,
        },
      );

      amFlood.push(
        {
          id: `${P}am_rev_${i}`,
          businessId: ID.biz,
          category: 'business_fact',
          key: `rev_k_${i}`,
          value: `Stealth cadence ${i}`,
          source: 'inferred',
          confidence: 1.0,
          dataClass: 'REVENUE',
          moduleScope: ['revenue'],
          createdAt: tsRev,
          updatedAt: tsRev,
        },
        {
          id: `${P}am_exp_${i}`,
          businessId: ID.biz,
          category: 'business_fact',
          key: `exp_k_${i}`,
          value: `General note in expenses module ${i}`,
          source: 'inferred',
          confidence: 1.0,
          dataClass: 'GENERAL',
          moduleScope: ['expenses'],
          createdAt: tsExp,
          updatedAt: tsExp,
        },
        {
          id: `${P}am_null_fin_${i}`,
          businessId: ID.biz,
          category: 'business_fact',
          key: `null_fin_${i}`,
          value: `Collected invoice $${100 + i}`,
          source: 'inferred',
          confidence: 1.0,
          dataClass: null,
          moduleScope: [],
          createdAt: tsNull,
          updatedAt: tsNull,
        },
        {
          id: `${P}sug_exp_${i}`,
          businessId: ID.biz,
          category: 'suggestion',
          key: `sug_exp_${i}`,
          value: JSON.stringify({
            id: `${P}sug_exp_${i}`,
            category: 'cost_pressure',
            title: `Review supplier ${i}`,
            message: `Check supplier bill ${i}`,
            actions: [],
            severity: 'warning',
            createdAt: tsExp,
          }),
          source: 'key_ai',
          expiresAt: futureExpiry,
          dataClass: 'GENERAL',
          moduleScope: ['expenses'],
          createdAt: tsExp,
          updatedAt: tsExp,
        },
      );
    }

    await db.temporalFlowMemory.createMany({ data: tfFlood });
    await db.aiMemory.createMany({ data: amFlood });
    await db.$executeRawUnsafe(
      `UPDATE temporal_flow_memories SET module_scope = NULL WHERE business_id = $1 AND data_class IS NULL`,
      ID.biz,
    );
    await db.$executeRawUnsafe(
      `UPDATE ai_memories SET module_scope = NULL WHERE business_id = $1 AND data_class IS NULL`,
      ID.biz,
    );

    // Also add 50 REVENUE + 50 denied-module embeddings
    for (let i = 0; i < 50; i++) {
      await insertEmbeddingRow({
        id: `${P}emb_rev_${i}`,
        sourceType: 'memory',
        sourceId: `${P}am_rev_${i}`,
        content: `business_fact: rev_k_${i} = Stealth cadence ${i}`,
        metadata: { category: 'business_fact', key: `rev_k_${i}` },
        dataClass: 'REVENUE',
        moduleScope: ['revenue'],
        createdAt: new Date(baseMs + 3600_000 + i * 1000),
      });
      await insertEmbeddingRow({
        id: `${P}emb_exp_${i}`,
        sourceType: 'memory',
        sourceId: `${P}am_exp_${i}`,
        content: `business_fact: exp_k_${i} = General note in expenses module ${i}`,
        metadata: { category: 'business_fact', key: `exp_k_${i}` },
        dataClass: 'GENERAL',
        moduleScope: ['expenses'],
        createdAt: new Date(baseMs + 4200_000 + i * 1000),
      });
    }

    const afterFlood = await captureSurfaceSnapshot();
    expect(afterFlood).toEqual(baseline);
  }, 60_000);
});
