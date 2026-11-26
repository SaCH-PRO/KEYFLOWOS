/**
 * MEM-CLASS-BACKFILL (P133, V1-91, D-257, D-254): Real-DB Postgres integration
 * proof for the legacy memory-classification backfill command.
 *
 * Proves:
 *   1. Dry-run is the default (writes 0 rows to Postgres) and emits ONLY counts
 *      per table, per data_class, and per businessId (tenant) — ZERO memory
 *      content, titles, summaries, values, or PII.
 *   2. `--apply` classifies legacy rows (`data_class IS NULL`) across all 3
 *      tables (`ai_memories`, `temporal_flow_memories`, `ai_memory_embeddings`)
 *      using the exact canonical P125 provenance classifiers:
 *        - revenue/financial provenance -> REVENUE + ['revenue']
 *        - general/tone/goal/clean-booking provenance -> GENERAL
 *        - secret/credential provenance -> SECRET_BEARING + ['ai', 'settings']
 *        - personal provenance -> PERSONAL
 *        - insufficient/missing provenance -> UNCLASSIFIED
 *      while NEVER overwriting or downgrading already-classified rows.
 *   3. Strict tenant isolation: linked-source resolution for
 *      `ai_memory_embeddings` and `temporal_flow_memories` is strictly scoped
 *      to the row's own `business_id` and NEVER reads another tenant's rows.
 *   4. Idempotency: a second `--apply` run scans and updates 0 rows.
 *   5. Resumable cursor: an interrupted `--apply` (`batchSize: 1, maxBatches: 1`)
 *      returns a cursor that cleanly resumes remaining batches to completion
 *      with 0 duplicates and every legacy row classified.
 *   6. Single-tenant (`--business-id`) and single-table (`--table`) scoping.
 *   7. CLI default dry-run execution (both in-process `main()` and spawned CLI)
 *      mutates nothing and leaks zero memory content to stdout.
 *
 * Fixture prefix `v91e_` (registered in test/helpers/fixture-prefixes.json),
 * hard-deleted ONLY via raw SQL + `sqlLikePrefix(P)`.
 */
import 'reflect-metadata';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const execFileAsync = promisify(execFile);

const P = 'v91e_';
const ID = {
  ownerA: `${P}owner_a`,
  ownerB: `${P}owner_b`,
  bizA: `${P}biz_a`,
  bizB: `${P}biz_b`,
  // Tenant A ai_memories
  memARevDoc: `${P}mem_a_01_rev_doc`,
  memARevPat: `${P}mem_a_02_rev_pat`,
  memAGenTone: `${P}mem_a_03_gen_tone`,
  memASecret: `${P}mem_a_04_secret`,
  memAPersonal: `${P}mem_a_05_personal`,
  memAUnclass: `${P}mem_a_06_unclass`,
  memAStamped: `${P}mem_a_99_stamped`,
  // Tenant B ai_memories
  memBSecret: `${P}mem_b_01_secret`,
  memBGenGoals: `${P}mem_b_02_gen_goals`,
  // Tenant A temporal_flow_events
  evAPay: `${P}ev_a_pay`,
  evAWa: `${P}ev_a_wa`,
  evABook: `${P}ev_a_book`,
  // Tenant B temporal_flow_events
  evBPay: `${P}ev_b_pay`,
  // Tenant A temporal_flow_memories
  tfmARev: `${P}tfm_a_01_rev`,
  tfmAGen: `${P}tfm_a_02_gen`,
  tfmAOpaque: `${P}tfm_a_03_opaque`,
  tfmAMissingEv: `${P}tfm_a_04_missing_ev`,
  tfmAXtenant: `${P}tfm_a_05_xtenant`,
  tfmAStamped: `${P}tfm_a_99_stamped`,
  // Tenant B temporal_flow_memories
  tfmBRev: `${P}tfm_b_01_rev`,
  // Tenant A ai_memory_embeddings
  embAMemRev: `${P}emb_a_01_mem_rev`,
  embAMemGen: `${P}emb_a_02_mem_gen`,
  embAMemSec: `${P}emb_a_03_mem_sec`,
  embATfmRev: `${P}emb_a_04_tfm_rev`,
  embAEvGen: `${P}emb_a_05_ev_gen`,
  embADoc: `${P}emb_a_06_doc`,
  embAConv: `${P}emb_a_07_conv`,
  embAXtenant: `${P}emb_a_08_xtenant`,
  embAStamped: `${P}emb_a_99_stamped`,
  // Tenant B ai_memory_embeddings
  embBMissing: `${P}emb_b_01_missing`,
};

/** Distinct content/PII sentinels that MUST NEVER appear in any report or stdout. */
const CONTENT_SENTINELS = [
  'V91E-SENTINEL-DOC-VENDOR',
  'V91E-SENTINEL-OVERDUE-PAT',
  'V91E-SENTINEL-TONE-TEXT',
  'V91E-SENTINEL-BYOK-SECRET',
  'V91E-SENTINEL-PERSONAL-PREF',
  'V91E-SENTINEL-OPAQUE-NOTE',
  'V91E-SENTINEL-ALREADY-STAMPED',
  'V91E-SENTINEL-B-BYOK',
  'V91E-SENTINEL-B-GOAL',
  'V91E-SENTINEL-EV-PAY',
  'V91E-SENTINEL-EV-WA',
  'V91E-SENTINEL-EV-BOOK',
  'V91E-SENTINEL-B-PAY',
  'V91E-SENTINEL-TFM-REV',
  'V91E-SENTINEL-TFM-GEN',
  'V91E-SENTINEL-TFM-OPAQUE',
  'V91E-SENTINEL-TFM-MISSING',
  'V91E-SENTINEL-TFM-XTENANT',
  'V91E-SENTINEL-TFM-STAMPED',
  'V91E-SENTINEL-B-TFM-REV',
  'V91E-SENTINEL-EMB-MEM-REV',
  'V91E-SENTINEL-EMB-MEM-GEN',
  'V91E-SENTINEL-EMB-MEM-SEC',
  'V91E-SENTINEL-EMB-TFM-REV',
  'V91E-SENTINEL-EMB-EV-GEN',
  'V91E-SENTINEL-EMB-DOC',
  'V91E-SENTINEL-EMB-CONV',
  'V91E-SENTINEL-EMB-XTENANT',
  'V91E-SENTINEL-EMB-STAMPED',
  'V91E-SENTINEL-B-EMB-ORPHAN',
];

const ZERO_VECTOR = `[${Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0)).join(',')}]`;

let db: any;

async function cleanup() {
  const byBiz = (table: string) => `DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`;
  for (const sql of [
    byBiz('ai_memory_embeddings'),
    byBiz('ai_memories'),
    byBiz('temporal_flow_memories'),
    byBiz('temporal_flow_events'),
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

async function resetFixtureMemoryRows() {
  const byBiz = (table: string) => `DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`;
  for (const sql of [
    byBiz('ai_memory_embeddings'),
    byBiz('ai_memories'),
    byBiz('temporal_flow_memories'),
    byBiz('temporal_flow_events'),
  ]) {
    await db.$executeRawUnsafe(sql);
  }
}

async function seedLegacyFixtures() {
  // 1. ai_memories (Tenant A: 6 legacy NULL + 1 already-stamped; Tenant B: 2 legacy NULL)
  const insertAiMemory = async (row: {
    id: string;
    businessId: string;
    category: string;
    key: string;
    value: string;
    source?: string;
    dataClass?: string | null;
    moduleScope?: string[] | null;
  }) => {
    await db.$executeRawUnsafe(
      `INSERT INTO ai_memories (id, business_id, category, key, value, confidence, source, data_class, module_scope, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 1.0, $6, $7, $8::text[], NOW(), NOW())`,
      row.id,
      row.businessId,
      row.category,
      row.key,
      row.value,
      row.source ?? 'user',
      row.dataClass ?? null,
      row.moduleScope ?? null,
    );
  };

  await insertAiMemory({
    id: ID.memARevDoc,
    businessId: ID.bizA,
    category: 'document_extraction',
    key: 'doc_rev_1',
    value: '{"vendor":"V91E-SENTINEL-DOC-VENDOR","total":1500}',
    source: 'role_engine',
  });
  await insertAiMemory({
    id: ID.memARevPat,
    businessId: ID.bizA,
    category: 'patterns',
    key: 'pattern_overdue_invoice_1',
    value: 'V91E-SENTINEL-OVERDUE-PAT 3 overdue invoices totaling $4,200',
    source: 'pattern_analysis',
  });
  await insertAiMemory({
    id: ID.memAGenTone,
    businessId: ID.bizA,
    category: 'tone',
    key: 'preferred',
    value: 'V91E-SENTINEL-TONE-TEXT warm and concise',
    source: 'user',
  });
  await insertAiMemory({
    id: ID.memASecret,
    businessId: ID.bizA,
    category: 'settings',
    key: 'ai_preferences',
    value: '{"byokOpenai":"enc:V91E-SENTINEL-BYOK-SECRET"}',
    source: 'system',
  });
  await insertAiMemory({
    id: ID.memAPersonal,
    businessId: ID.bizA,
    category: 'user_preference',
    key: 'digest_time',
    value: 'V91E-SENTINEL-PERSONAL-PREF 08:00',
    source: 'user',
  });
  await insertAiMemory({
    id: ID.memAUnclass,
    businessId: ID.bizA,
    category: 'legacy_opaque_bucket',
    key: 'misc_note',
    value: 'V91E-SENTINEL-OPAQUE-NOTE check lobby signage',
    source: 'legacy',
  });
  await insertAiMemory({
    id: ID.memAStamped,
    businessId: ID.bizA,
    category: 'tone',
    key: 'already_classified',
    value: 'V91E-SENTINEL-ALREADY-STAMPED',
    source: 'user',
    dataClass: 'REVENUE',
    moduleScope: ['revenue'],
  });
  await insertAiMemory({
    id: ID.memBSecret,
    businessId: ID.bizB,
    category: 'settings',
    key: 'ai_preferences',
    value: '{"byokOpenai":"enc:V91E-SENTINEL-B-BYOK"}',
    source: 'system',
  });
  await insertAiMemory({
    id: ID.memBGenGoals,
    businessId: ID.bizB,
    category: 'goals',
    key: 'team_focus',
    value: 'V91E-SENTINEL-B-GOAL improve support turnaround',
    source: 'user',
  });

  // 2. temporal_flow_events (source events for Tenant A & Tenant B)
  const insertEvent = async (row: {
    id: string;
    businessId: string;
    source: string;
    type: string;
    module: string | null;
    entityType: string | null;
    title: string;
  }) => {
    await db.$executeRawUnsafe(
      `INSERT INTO temporal_flow_events (id, business_id, source, type, module, entity_type, title, occurred_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW())`,
      row.id,
      row.businessId,
      row.source,
      row.type,
      row.module,
      row.entityType,
      row.title,
    );
  };

  await insertEvent({
    id: ID.evAPay,
    businessId: ID.bizA,
    source: 'payments',
    type: 'payment.received',
    module: 'revenue',
    entityType: 'payment',
    title: 'V91E-SENTINEL-EV-PAY Payment received $500',
  });
  await insertEvent({
    id: ID.evAWa,
    businessId: ID.bizA,
    source: 'whatsapp',
    type: 'key_inbox.message_received',
    module: 'operations',
    entityType: 'thread',
    title: 'V91E-SENTINEL-EV-WA Customer greeting',
  });
  await insertEvent({
    id: ID.evABook,
    businessId: ID.bizA,
    source: 'calendar',
    type: 'booking.confirmed',
    module: 'bookings',
    entityType: 'booking',
    title: 'V91E-SENTINEL-EV-BOOK Booking confirmed Tuesday',
  });
  await insertEvent({
    id: ID.evBPay,
    businessId: ID.bizB,
    source: 'payments',
    type: 'payment.received',
    module: 'revenue',
    entityType: 'payment',
    title: 'V91E-SENTINEL-B-PAY Payment received $9,999',
  });

  // 3. temporal_flow_memories (Tenant A: 5 legacy NULL + 1 already-stamped; Tenant B: 1 legacy NULL)
  const insertTfm = async (row: {
    id: string;
    businessId: string;
    entityType: string;
    entityId: string | null;
    type: string;
    content: string;
    sourceEventIds: string[];
    sourceModule: string;
    metadata?: Record<string, unknown>;
    dataClass?: string | null;
    moduleScope?: string[] | null;
  }) => {
    await db.$executeRawUnsafe(
      `INSERT INTO temporal_flow_memories
         (id, business_id, entity_type, entity_id, type, content, source_event_ids, source_module, metadata, confidence, data_class, module_scope, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8, $9::jsonb, 0.8, $10, $11::text[], NOW(), NOW())`,
      row.id,
      row.businessId,
      row.entityType,
      row.entityId,
      row.type,
      row.content,
      row.sourceEventIds,
      row.sourceModule,
      JSON.stringify(row.metadata ?? {}),
      row.dataClass ?? null,
      row.moduleScope ?? null,
    );
  };

  await insertTfm({
    id: ID.tfmARev,
    businessId: ID.bizA,
    entityType: 'thread',
    entityId: 'thread_rev',
    type: 'summary',
    content: 'V91E-SENTINEL-TFM-REV Thread activity summary',
    sourceEventIds: [ID.evAWa, ID.evAPay],
    sourceModule: 'key_inbox',
  });
  await insertTfm({
    id: ID.tfmAGen,
    businessId: ID.bizA,
    entityType: 'thread',
    entityId: 'thread_book',
    type: 'summary',
    content: 'V91E-SENTINEL-TFM-GEN Thread activity summary',
    sourceEventIds: [ID.evABook],
    sourceModule: 'key_inbox',
  });
  await insertTfm({
    id: ID.tfmAOpaque,
    businessId: ID.bizA,
    entityType: 'business',
    entityId: 'lobby_note',
    type: 'insight',
    content: 'V91E-SENTINEL-TFM-OPAQUE Remember lobby signage',
    sourceEventIds: [],
    sourceModule: 'key_cortex',
  });
  await insertTfm({
    id: ID.tfmAMissingEv,
    businessId: ID.bizA,
    entityType: 'thread',
    entityId: 'thread_missing',
    type: 'summary',
    content: 'V91E-SENTINEL-TFM-MISSING Orphaned summary',
    sourceEventIds: [`${P}ev_nonexistent`],
    sourceModule: 'key_inbox',
  });
  await insertTfm({
    id: ID.tfmAXtenant,
    businessId: ID.bizA,
    entityType: 'thread',
    entityId: 'thread_xtenant',
    type: 'summary',
    content: 'V91E-SENTINEL-TFM-XTENANT Cross tenant probe',
    sourceEventIds: [ID.evBPay], // Owned by Tenant B!
    sourceModule: 'key_inbox',
  });
  await insertTfm({
    id: ID.tfmAStamped,
    businessId: ID.bizA,
    entityType: 'thread',
    entityId: 'thread_stamped',
    type: 'summary',
    content: 'V91E-SENTINEL-TFM-STAMPED',
    sourceEventIds: [ID.evABook],
    sourceModule: 'key_inbox',
    dataClass: 'REVENUE',
    moduleScope: ['revenue'],
  });
  await insertTfm({
    id: ID.tfmBRev,
    businessId: ID.bizB,
    entityType: 'thread',
    entityId: 'thread_b_rev',
    type: 'summary',
    content: 'V91E-SENTINEL-B-TFM-REV tenant B summary',
    sourceEventIds: [ID.evBPay],
    sourceModule: 'key_inbox',
  });

  // 4. ai_memory_embeddings (Tenant A: 8 legacy NULL + 1 already-stamped; Tenant B: 1 legacy NULL)
  const insertEmbedding = async (row: {
    id: string;
    businessId: string;
    sourceType: string;
    sourceId: string;
    content: string;
    metadata?: Record<string, unknown>;
    dataClass?: string | null;
    moduleScope?: string[] | null;
  }) => {
    await db.$executeRawUnsafe(
      `INSERT INTO ai_memory_embeddings
         (id, business_id, content, source_type, source_id, embedding, metadata, data_class, module_scope, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7::jsonb, $8, $9::text[], NOW())`,
      row.id,
      row.businessId,
      row.content,
      row.sourceType,
      row.sourceId,
      ZERO_VECTOR,
      JSON.stringify(row.metadata ?? {}),
      row.dataClass ?? null,
      row.moduleScope ?? null,
    );
  };

  await insertEmbedding({
    id: ID.embAMemRev,
    businessId: ID.bizA,
    sourceType: 'memory',
    sourceId: ID.memARevDoc,
    content: 'V91E-SENTINEL-EMB-MEM-REV plain text copy',
  });
  await insertEmbedding({
    id: ID.embAMemGen,
    businessId: ID.bizA,
    sourceType: 'memory',
    sourceId: ID.memAGenTone,
    content: 'V91E-SENTINEL-EMB-MEM-GEN warm and concise',
  });
  await insertEmbedding({
    id: ID.embAMemSec,
    businessId: ID.bizA,
    sourceType: 'memory',
    sourceId: ID.memASecret,
    content: 'V91E-SENTINEL-EMB-MEM-SEC legacy copy',
  });
  await insertEmbedding({
    id: ID.embATfmRev,
    businessId: ID.bizA,
    sourceType: 'temporal_memory',
    sourceId: ID.tfmARev,
    content: 'V91E-SENTINEL-EMB-TFM-REV summary copy',
  });
  await insertEmbedding({
    id: ID.embAEvGen,
    businessId: ID.bizA,
    sourceType: 'event',
    sourceId: ID.evABook,
    content: 'V91E-SENTINEL-EMB-EV-GEN booking confirmed',
  });
  await insertEmbedding({
    id: ID.embADoc,
    businessId: ID.bizA,
    sourceType: 'document',
    sourceId: `${P}doc_a:0`,
    content: 'V91E-SENTINEL-EMB-DOC company handbook page 1',
  });
  await insertEmbedding({
    id: ID.embAConv,
    businessId: ID.bizA,
    sourceType: 'conversation',
    sourceId: `${P}conv_a_1`,
    content: 'V91E-SENTINEL-EMB-CONV user asked about hours',
  });
  await insertEmbedding({
    id: ID.embAXtenant,
    businessId: ID.bizA,
    sourceType: 'memory',
    sourceId: ID.memBSecret, // Owned by Tenant B!
    content: 'V91E-SENTINEL-EMB-XTENANT benign text',
  });
  await insertEmbedding({
    id: ID.embAStamped,
    businessId: ID.bizA,
    sourceType: 'memory',
    sourceId: ID.memAGenTone,
    content: 'V91E-SENTINEL-EMB-STAMPED',
    dataClass: 'SECRET_BEARING',
    moduleScope: ['settings'],
  });
  await insertEmbedding({
    id: ID.embBMissing,
    businessId: ID.bizB,
    sourceType: 'memory',
    sourceId: `${P}nonexistent_b`,
    content: 'V91E-SENTINEL-B-EMB-ORPHAN plain text',
  });
}

async function readRow(table: 'ai_memories' | 'temporal_flow_memories' | 'ai_memory_embeddings', id: string) {
  const rows = (await db.$queryRawUnsafe(
    `SELECT id, business_id, data_class, module_scope FROM ${table} WHERE id = $1`,
    id,
  )) as Array<{ id: string; business_id: string; data_class: string | null; module_scope: string[] | null }>;
  return rows[0] ?? null;
}

async function countNullRows(table: 'ai_memories' | 'temporal_flow_memories' | 'ai_memory_embeddings', businessIds: string[]) {
  const rows = (await db.$queryRawUnsafe(
    `SELECT count(*)::int AS cnt FROM ${table} WHERE business_id = ANY($1::text[]) AND data_class IS NULL`,
    businessIds,
  )) as Array<{ cnt: number }>;
  return Number(rows[0]?.cnt ?? 0);
}

function assertZeroContentLeaked(serialized: string) {
  for (const sentinel of CONTENT_SENTINELS) {
    expect(serialized, `leaked memory content sentinel ${sentinel}`).not.toContain(sentinel);
  }
}

async function loadBackfillModule() {
  return import('../scripts/memory-class-backfill');
}

describe('MEM-CLASS-BACKFILL (P133, V1-91, D-257, D-254): legacy memory classification backfill', () => {
  beforeAll(async () => {
    const dbMod = await import('@keyflow/db');
    db = dbMod.db;
    await cleanup();

    await db.user.create({
      data: { id: ID.ownerA, email: `${P}owner_a@test.local`, name: 'V91E Owner A' },
    });
    await db.user.create({
      data: { id: ID.ownerB, email: `${P}owner_b@test.local`, name: 'V91E Owner B' },
    });
    await db.business.create({
      data: { id: ID.bizA, name: 'V91E Tenant A', slug: `${P}biz-a`, ownerId: ID.ownerA },
    });
    await db.business.create({
      data: { id: ID.bizB, name: 'V91E Tenant B', slug: `${P}biz-b`, ownerId: ID.ownerB },
    });
    await db.membership.create({
      data: { id: `${P}m_owner_a`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
    });
    await db.membership.create({
      data: { id: `${P}m_owner_b`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
    });
  }, 60_000);

  beforeEach(async () => {
    await resetFixtureMemoryRows();
    await seedLegacyFixtures();
  });

  afterAll(async () => {
    await cleanup();
  });

  it('MCB-01: dry-run (default) writes 0 rows, reports accurate counts per table/class/tenant, and leaks ZERO content', async () => {
    const { runMemoryClassBackfill } = await loadBackfillModule();

    const report = await runMemoryClassBackfill(db, {
      businessIds: [ID.bizA, ID.bizB],
    });

    expect(report.mode).toBe('dry-run');
    expect(report.completed).toBe(true);
    expect(report.totals.scanned).toBe(23);
    expect(report.totals.updated).toBe(0);

    // Table counts (excluding already-stamped rows)
    expect(report.tables.ai_memories.scanned).toBe(8);
    expect(report.tables.ai_memories.updated).toBe(0);
    expect(report.tables.ai_memories.byClass).toEqual({
      GENERAL: 2,
      REVENUE: 2,
      PERSONAL: 1,
      SECRET_BEARING: 2,
      UNCLASSIFIED: 1,
    });
    expect(report.tables.ai_memories.byTenant[ID.bizA]).toEqual({
      GENERAL: 1,
      REVENUE: 2,
      PERSONAL: 1,
      SECRET_BEARING: 1,
      UNCLASSIFIED: 1,
    });
    expect(report.tables.ai_memories.byTenant[ID.bizB]).toEqual({
      GENERAL: 1,
      REVENUE: 0,
      PERSONAL: 0,
      SECRET_BEARING: 1,
      UNCLASSIFIED: 0,
    });

    expect(report.tables.temporal_flow_memories.scanned).toBe(6);
    expect(report.tables.temporal_flow_memories.updated).toBe(0);
    expect(report.tables.temporal_flow_memories.byClass).toEqual({
      GENERAL: 1,
      REVENUE: 2,
      PERSONAL: 0,
      SECRET_BEARING: 0,
      UNCLASSIFIED: 3,
    });

    expect(report.tables.ai_memory_embeddings.scanned).toBe(9);
    expect(report.tables.ai_memory_embeddings.updated).toBe(0);
    expect(report.tables.ai_memory_embeddings.byClass).toEqual({
      GENERAL: 2,
      REVENUE: 2,
      PERSONAL: 1,
      SECRET_BEARING: 1,
      UNCLASSIFIED: 3,
    });

    // Zero writes occurred in Postgres
    expect(await countNullRows('ai_memories', [ID.bizA, ID.bizB])).toBe(8);
    expect(await countNullRows('temporal_flow_memories', [ID.bizA, ID.bizB])).toBe(6);
    expect(await countNullRows('ai_memory_embeddings', [ID.bizA, ID.bizB])).toBe(9);

    // Zero content / PII leaked in serialized report
    assertZeroContentLeaked(JSON.stringify(report));
  });

  it('MCB-02: --apply classifies every legacy row accurately across all 3 tables, preserves already-stamped rows, and enforces strict tenant isolation', async () => {
    const { runMemoryClassBackfill } = await loadBackfillModule();

    const report = await runMemoryClassBackfill(db, {
      apply: true,
      businessIds: [ID.bizA, ID.bizB],
    });

    expect(report.mode).toBe('apply');
    expect(report.completed).toBe(true);
    expect(report.totals.scanned).toBe(23);
    expect(report.totals.updated).toBe(23);
    assertZeroContentLeaked(JSON.stringify(report));

    // Zero NULL data_class rows left in either tenant
    expect(await countNullRows('ai_memories', [ID.bizA, ID.bizB])).toBe(0);
    expect(await countNullRows('temporal_flow_memories', [ID.bizA, ID.bizB])).toBe(0);
    expect(await countNullRows('ai_memory_embeddings', [ID.bizA, ID.bizB])).toBe(0);

    // Verify ai_memories classifications
    expect(await readRow('ai_memories', ID.memARevDoc)).toMatchObject({
      data_class: 'REVENUE',
      module_scope: ['revenue'],
    });
    expect(await readRow('ai_memories', ID.memARevPat)).toMatchObject({
      data_class: 'REVENUE',
      module_scope: ['revenue'],
    });
    expect(await readRow('ai_memories', ID.memAGenTone)).toMatchObject({
      data_class: 'GENERAL',
      module_scope: [],
    });
    expect(await readRow('ai_memories', ID.memASecret)).toMatchObject({
      data_class: 'SECRET_BEARING',
      module_scope: ['ai', 'settings'],
    });
    expect(await readRow('ai_memories', ID.memAPersonal)).toMatchObject({
      data_class: 'PERSONAL',
      module_scope: [],
    });
    expect(await readRow('ai_memories', ID.memAUnclass)).toMatchObject({
      data_class: 'UNCLASSIFIED',
      module_scope: [],
    });
    // Already-classified row NEVER downgraded or overwritten
    expect(await readRow('ai_memories', ID.memAStamped)).toMatchObject({
      data_class: 'REVENUE',
      module_scope: ['revenue'],
    });
    expect(await readRow('ai_memories', ID.memBSecret)).toMatchObject({
      data_class: 'SECRET_BEARING',
      module_scope: ['ai', 'settings'],
    });
    expect(await readRow('ai_memories', ID.memBGenGoals)).toMatchObject({
      data_class: 'GENERAL',
      module_scope: [],
    });

    // Verify temporal_flow_memories classifications + cross-tenant isolation
    expect(await readRow('temporal_flow_memories', ID.tfmARev)).toMatchObject({
      data_class: 'REVENUE',
      module_scope: ['operations', 'revenue'],
    });
    expect(await readRow('temporal_flow_memories', ID.tfmAGen)).toMatchObject({
      data_class: 'GENERAL',
      module_scope: ['bookings', 'operations'],
    });
    expect(await readRow('temporal_flow_memories', ID.tfmAOpaque)).toMatchObject({
      data_class: 'UNCLASSIFIED',
      module_scope: [],
    });
    expect(await readRow('temporal_flow_memories', ID.tfmAMissingEv)).toMatchObject({
      data_class: 'UNCLASSIFIED',
      module_scope: ['operations'],
    });
    // Cross-tenant event reference MUST NOT read Tenant B's payment event
    expect(await readRow('temporal_flow_memories', ID.tfmAXtenant)).toMatchObject({
      data_class: 'UNCLASSIFIED',
      module_scope: ['operations'],
    });
    expect(await readRow('temporal_flow_memories', ID.tfmAStamped)).toMatchObject({
      data_class: 'REVENUE',
      module_scope: ['revenue'],
    });
    expect(await readRow('temporal_flow_memories', ID.tfmBRev)).toMatchObject({
      data_class: 'REVENUE',
      module_scope: ['operations', 'revenue'],
    });

    // Verify ai_memory_embeddings classifications + cross-tenant isolation
    expect(await readRow('ai_memory_embeddings', ID.embAMemRev)).toMatchObject({
      data_class: 'REVENUE',
      module_scope: ['revenue'],
    });
    expect(await readRow('ai_memory_embeddings', ID.embAMemGen)).toMatchObject({
      data_class: 'GENERAL',
      module_scope: [],
    });
    expect(await readRow('ai_memory_embeddings', ID.embAMemSec)).toMatchObject({
      data_class: 'SECRET_BEARING',
      module_scope: ['ai', 'settings'],
    });
    expect(await readRow('ai_memory_embeddings', ID.embATfmRev)).toMatchObject({
      data_class: 'REVENUE',
      module_scope: ['operations', 'revenue'],
    });
    expect(await readRow('ai_memory_embeddings', ID.embAEvGen)).toMatchObject({
      data_class: 'GENERAL',
      module_scope: ['bookings'],
    });
    expect(await readRow('ai_memory_embeddings', ID.embADoc)).toMatchObject({
      data_class: 'UNCLASSIFIED',
      module_scope: ['expenses', 'revenue'],
    });
    expect(await readRow('ai_memory_embeddings', ID.embAConv)).toMatchObject({
      data_class: 'PERSONAL',
      module_scope: [],
    });
    // Cross-tenant memory reference MUST NOT read Tenant B's SECRET_BEARING row
    expect(await readRow('ai_memory_embeddings', ID.embAXtenant)).toMatchObject({
      data_class: 'UNCLASSIFIED',
      module_scope: [],
    });
    expect(await readRow('ai_memory_embeddings', ID.embAStamped)).toMatchObject({
      data_class: 'SECRET_BEARING',
      module_scope: ['settings'],
    });
    expect(await readRow('ai_memory_embeddings', ID.embBMissing)).toMatchObject({
      data_class: 'UNCLASSIFIED',
      module_scope: [],
    });
  });

  it('MCB-03: --apply is strictly idempotent on a second run (updates 0 rows)', async () => {
    const { runMemoryClassBackfill } = await loadBackfillModule();

    const first = await runMemoryClassBackfill(db, {
      apply: true,
      businessIds: [ID.bizA, ID.bizB],
    });
    expect(first.totals.updated).toBe(23);

    const second = await runMemoryClassBackfill(db, {
      apply: true,
      businessIds: [ID.bizA, ID.bizB],
    });
    expect(second.mode).toBe('apply');
    expect(second.completed).toBe(true);
    expect(second.totals.scanned).toBe(0);
    expect(second.totals.updated).toBe(0);
    expect(second.tables.ai_memories.updated).toBe(0);
    expect(second.tables.temporal_flow_memories.updated).toBe(0);
    expect(second.tables.ai_memory_embeddings.updated).toBe(0);
  });

  it('MCB-04: interrupted --apply resumes cleanly via cursor with 0 duplicates until all rows are classified', async () => {
    const { runMemoryClassBackfill } = await loadBackfillModule();

    // Simulate interruption after 1 batch of size 1
    const step1 = await runMemoryClassBackfill(db, {
      apply: true,
      businessIds: [ID.bizA, ID.bizB],
      batchSize: 1,
      maxBatches: 1,
    });
    expect(step1.completed).toBe(false);
    expect(step1.totals.updated).toBe(1);
    expect(step1.nextCursor.ai_memories).toBeTruthy();

    // Simulate a second partial chunk (batchSize 2, maxBatches 2)
    const step2 = await runMemoryClassBackfill(db, {
      apply: true,
      businessIds: [ID.bizA, ID.bizB],
      batchSize: 2,
      maxBatches: 2,
      cursor: step1.nextCursor,
    });
    expect(step2.completed).toBe(false);
    expect(step2.totals.updated).toBe(4);
    expect(step2.nextCursor.ai_memories).not.toBe(step1.nextCursor.ai_memories);

    // Resume to completion with batchSize 3
    const finalStep = await runMemoryClassBackfill(db, {
      apply: true,
      businessIds: [ID.bizA, ID.bizB],
      batchSize: 3,
      cursor: step2.nextCursor,
    });
    expect(finalStep.completed).toBe(true);

    // Exact sum of updated rows across all chunks = 23 (zero duplicates!)
    expect(step1.totals.updated + step2.totals.updated + finalStep.totals.updated).toBe(23);
    expect(await countNullRows('ai_memories', [ID.bizA, ID.bizB])).toBe(0);
    expect(await countNullRows('temporal_flow_memories', [ID.bizA, ID.bizB])).toBe(0);
    expect(await countNullRows('ai_memory_embeddings', [ID.bizA, ID.bizB])).toBe(0);

    // Spot-check classifications match single-shot apply
    expect(await readRow('ai_memories', ID.memASecret)).toMatchObject({
      data_class: 'SECRET_BEARING',
      module_scope: ['ai', 'settings'],
    });
    expect(await readRow('temporal_flow_memories', ID.tfmARev)).toMatchObject({
      data_class: 'REVENUE',
      module_scope: ['operations', 'revenue'],
    });
    expect(await readRow('ai_memory_embeddings', ID.embAXtenant)).toMatchObject({
      data_class: 'UNCLASSIFIED',
      module_scope: [],
    });
  });

  it('MCB-05: supports single-tenant (--business-id) and single-table (--table) filtering', async () => {
    const { runMemoryClassBackfill } = await loadBackfillModule();

    // Single-table filter on Tenant A only
    const stepTable = await runMemoryClassBackfill(db, {
      apply: true,
      businessId: ID.bizA,
      tables: ['ai_memories'],
    });
    expect(stepTable.completed).toBe(true);
    expect(stepTable.totals.updated).toBe(6);

    // Tenant A ai_memories updated; Tenant A other tables & ALL Tenant B rows remain NULL
    expect(await countNullRows('ai_memories', [ID.bizA])).toBe(0);
    expect(await countNullRows('temporal_flow_memories', [ID.bizA])).toBe(5);
    expect(await countNullRows('ai_memory_embeddings', [ID.bizA])).toBe(8);
    expect(await countNullRows('ai_memories', [ID.bizB])).toBe(2);
    expect(await countNullRows('temporal_flow_memories', [ID.bizB])).toBe(1);
    expect(await countNullRows('ai_memory_embeddings', [ID.bizB])).toBe(1);
  });

  it('MCB-06: CLI defaults to dry-run without --apply, writes nothing, emits JSON counts with zero content, and rejects bad args', async () => {
    const { main } = await loadBackfillModule();

    // In-process CLI invocation without --apply
    const lines: string[] = [];
    const errors: string[] = [];
    const code = await main(['--business-id', ID.bizA, '--business-id', ID.bizB], {
      db,
      log: (...args: unknown[]) => lines.push(args.map(String).join(' ')),
      error: (...args: unknown[]) => errors.push(args.map(String).join(' ')),
    });
    expect(code).toBe(0);
    expect(errors).toEqual([]);
    const stdout = lines.join('\n');
    assertZeroContentLeaked(stdout);
    const parsed = JSON.parse(stdout);
    expect(parsed.mode).toBe('dry-run');
    expect(parsed.totals.scanned).toBe(23);
    expect(parsed.totals.updated).toBe(0);

    // Verify Postgres untouched
    expect(await countNullRows('ai_memories', [ID.bizA, ID.bizB])).toBe(8);
    expect(await countNullRows('temporal_flow_memories', [ID.bizA, ID.bizB])).toBe(6);
    expect(await countNullRows('ai_memory_embeddings', [ID.bizA, ID.bizB])).toBe(9);

    // Bad argument exits 2
    const badErrors: string[] = [];
    const badCode = await main(['--definitely-not-a-flag'], {
      db,
      log: () => undefined,
      error: (...args: unknown[]) => badErrors.push(args.map(String).join(' ')),
    });
    expect(badCode).toBe(2);
    expect(badErrors.length).toBeGreaterThan(0);

    // Real spawned CLI dry-run via tsx (proves entrypoint + require.main guard + scripts/tsconfig.json)
    const serverDir = path.resolve(__dirname, '..');
    const tsxBin = path.resolve(serverDir, 'node_modules/.bin/tsx');
    const { stdout: cliOut, stderr: cliErr } = await execFileAsync(
      tsxBin,
      [
        '--tsconfig',
        'scripts/tsconfig.json',
        'scripts/memory-class-backfill.ts',
        '--business-id',
        ID.bizA,
        '--business-id',
        ID.bizB,
      ],
      { cwd: serverDir, env: process.env, timeout: 30_000 },
    );
    expect(cliErr.trim()).toBe('');
    assertZeroContentLeaked(cliOut);
    const cliReport = JSON.parse(cliOut);
    expect(cliReport.mode).toBe('dry-run');
    expect(cliReport.totals.scanned).toBe(23);
    expect(cliReport.totals.updated).toBe(0);

    // Still zero DB mutations after spawned CLI dry-run
    expect(await countNullRows('ai_memories', [ID.bizA, ID.bizB])).toBe(8);
    expect(await countNullRows('temporal_flow_memories', [ID.bizA, ID.bizB])).toBe(6);
    expect(await countNullRows('ai_memory_embeddings', [ID.bizA, ID.bizB])).toBe(9);
  });
});
