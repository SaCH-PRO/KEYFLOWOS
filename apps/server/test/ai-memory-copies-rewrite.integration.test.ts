/**
 * FU-MEMORY-COPIES-REWRITE (V1-71, owner ruling D-221): an AI memory rewritten in place drops the semantic copies of
 * its old value, at rest, and is copied again with its new value when the embedding path is on; a cleanup command
 * removes the stale copies left before this packet (REAL database).
 *
 * The finding (W1F-MEMORY-COPIES review follow-up): an AiMemory row has semantic copies in ai_memory_embeddings
 * (source_type 'memory', source_id the row's id; POST .../agent/memory/backfill writes `<category>: <key> = <value>`,
 * UnifiedMemoryWriterService.store with indexSemantic writes the value). Every writer upserts a row on business,
 * category and key, so a rewrite keeps the row's id. W1F-MEMORY-COPIES stopped serving a copy that no longer holds
 * what its row holds (search and KEY's memory block), but the copy stayed in the table: after the owner PUT a new
 * value, ai_memory_embeddings still held the old text, and the rewritten row had no copy of its new value until a
 * member ran the backfill again. Now:
 *
 *   1. Every AiMemory upsert that can rewrite a row goes through one door (upsertAiMemoryDroppingStaleCopies in
 *      ai-memory.service.ts): the row, then the deletion of its copies that do not hold what it now holds, in one
 *      transaction. AiMemoryService.upsert (PUT .../ai/memory and .../ai/memory/bulk, the KEY writers through
 *      UnifiedMemoryWriterService, approval signals, pattern summaries), the proactive suggestions and the
 *      consolidation's promotion all write through it. The settings rows (the gateway's
 *      preferences and routing table, the governance autonomy settings) are named exceptions (V71I-09).
 *   2. AiMemoryService.upsert copies a rewritten row again when its rewrite dropped copies: one copy per form it had
 *      (the backfill's and the writer's), of the new value, through SemanticMemoryService (which writes a copy only
 *      while the row holds what it copies). When the embedding path is off (no OpenAI key, KEY_DISABLED: the provider
 *      refusal comes before any client, credit or provider call) the rewrite still succeeds and the old copies are
 *      still gone; a row that had no copy gets none.
 *   3. apps/server/scripts/cleanup-stale-memory-copies.ts (pnpm cleanup:memory-copies): dry run by default, it lists
 *      the stale copies (a copy whose row is gone from its business, or that holds a value its row no longer holds)
 *      by copy id and reason, never their content; --apply deletes exactly those; --business=<id> scopes it.
 *
 * WHAT IS REAL: the database (PrismaService, the Prisma client, pgvector); the HTTP routes on the real AiController
 * (GET/PUT .../ai/memory, PUT .../ai/memory/bulk) behind its real AuthGuard, BusinessGuard and CrmRateLimitGuard, and
 * on the real AgentController (POST .../agent/memory/backfill, GET .../agent/memory/search) behind AuthGuard and
 * BusinessGuard; AiMemoryService (wired with SemanticMemoryService, as AiModule wires it), SemanticMemoryService,
 * UnifiedMemoryWriterService, MemoryConsolidationService, KEY's memory block
 * (KeyCortexPromptContextService.buildMemoryContext over UnifiedMemoryRetrievalService), the cleanup script's main()
 * and its package.json command; with the embedding path off, the real AiUsageService.trackEmbedding (no OpenAI key,
 * or KEY_DISABLED).
 * Stand-ins: identity attachment (a middleware reads `x-v71i-user` and attaches the seeded user, as the
 * Supabase-verifying AuthMiddleware would); the embedding provider while the path is on (one fixed unit vector, so
 * every copy matches every query; it records every embedded text and may hold one back to open a race); the
 * controllers' collaborators for routes no case calls. globalThis.fetch is a tap that refuses and records every
 * outbound request: none is made.
 *
 * Review repair (FU-MEMORY-COPIES-REWRITE review, all minor):
 *   - COR-V71I-1 (V71I-10): a second rewrite that lands while the first one's re-copy is being embedded finds no copy to
 *     drop and starts no re-copy, and the first re-copy is refused (the row holds another value): the row was left with
 *     no copy. The re-copy now copies what the row holds when its insert is refused.
 *   - COR-V71I-3 (V71I-06, V71I-15): every writer through the door re-copies a row it rewrote, not only
 *     AiMemoryService.upsert (the consolidation's promotion, the proactive suggestions).
 *   - COR-V71I-4 (V71I-11): the re-copy runs after the rewrite answers; the answer does not wait on the embedding
 *     provider. KEY's writer indexing a row whose re-copy is in flight waits for it and adds no duplicate.
 *   - SEC-FUMCR-1, SEC-FUMCR-2, COR-V71I-2 (V71I-12, V71I-13, V71I-14): a settings row (ModelGatewayService's
 *     ai_preferences, holding the BYOK provider keys as ciphertext; its routing table; the governance autonomy
 *     settings) is configuration, not memory. No member reads it through the AI memory routes or KEY's memory block,
 *     no copy of it is made (the backfill does not send it to the embedding provider), none made before is served, and
 *     the cleanup command deletes those (reason settings_row). Its writers stay outside the door (V71I-09): with no
 *     copy, a rotation of the owner's key leaves nothing of the old ciphertext in ai_memory_embeddings.
 *   - The harness: V71I-05's lock waits are the ones its own transactions block (pg_blocking_pids), not any statement
 *     of the database waiting on a lock (a parallel suite's DELETE on ai_memory_embeddings satisfied the old check and
 *     let the held backfill write before the rewrite: 'the held backfill wrote nothing: expected 1 to be +0'); every
 *     case waits for the re-copies to finish (settle) before it reads the copies.
 *
 * Every seeded row carries the `v71i_` prefix (users, businesses, memory keys, cognition functions, copy ids) and is
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll; ai_memory_embeddings rows go with their
 * business. The cleanup command is only ever applied with --business=<a v71i_ business>.
 */
import 'reflect-metadata';
import path from 'path';
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'fs';
import { randomBytes } from 'node:crypto';
import * as ts from 'typescript';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v71i_';

const ID = {
  /** The business owner (OWNER membership, D-104). */
  owner: `${P}owner`,
  /** A STAFF member of ID.biz. */
  member: `${P}member`,
  biz: `${P}biz`,
  /** A second business of ID.owner: a rewrite or a cleanup in ID.biz leaves its rows and copies alone. */
  other: `${P}biz_other`,
};

/** Every embedding is this one vector, so every copy matches any query at similarity 1. */
const UNIT_VECTOR = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
const VECTOR_LITERAL = `[${UNIT_VECTOR.join(',')}]`;
const QUESTION = 'what should I know about this business?';
const SERVER_DIR = path.resolve(__dirname, '..');

let db: any;
let prisma: any;
let moduleRef: any;
const realFetch = globalThis.fetch;
const outbound: string[] = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM ai_memory_embeddings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_memories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM cognition_memories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_execution_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_usage_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** The businesses' AI memory and its copies, emptied between cases (the users, businesses and memberships stay). */
async function resetMemory() {
  for (const table of ['ai_memory_embeddings', 'ai_memories', 'cognition_memories']) {
    await db.$executeRawUnsafe(`DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const tenant = await import('../src/core/tenant/tenant-context');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });
  const { Test } = await import('@nestjs/testing');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  moduleRef = await Test.createTestingModule({ providers: [PrismaService] }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);

  globalThis.fetch = (async (input: unknown) => {
    outbound.push(String(input));
    throw new Error('v71i: no outbound traffic in this suite');
  }) as typeof fetch;

  await cleanup(); // in case a prior run aborted
  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.member, email: `${P}member@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'V71I Memory Rewrite Biz', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.other, name: 'V71I Other Biz', ownerId: ID.owner } });
  await db.membership.create({ data: { userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await db.membership.create({ data: { userId: ID.member, businessId: ID.biz, role: 'STAFF' } });
  await db.membership.create({ data: { userId: ID.owner, businessId: ID.other, role: 'OWNER' } });
}, 120_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  if (db) await cleanup();
  if (moduleRef) await moduleRef.close();
  const dbMod = await import('@keyflow/db');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: () => undefined });
  expect(outbound, 'no outbound request in this suite').toEqual([]);
});

beforeEach(async () => {
  await resetMemory();
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** One embedding call the stand-in provider holds back until `release()`. */
function hold(match: string) {
  let reachedFn: () => void = () => undefined;
  let releaseFn: () => void = () => undefined;
  const reached = new Promise<void>((resolve) => (reachedFn = resolve));
  const released = new Promise<void>((resolve) => (releaseFn = resolve));
  let armed = true;
  return {
    reached,
    release: () => releaseFn(),
    arm: async (text: string) => {
      if (armed && text.includes(match)) {
        armed = false;
        reachedFn();
        await released;
      }
    },
  };
}

/**
 * Waits for the re-copies the rewrites so far started (review COR-V71I-4: a rewrite answers before its re-copy has
 * run; SemanticMemoryService.recopiesSettled). Before the review repair the re-copy ran inside the rewrite, so there
 * is nothing to wait for; V71I-11 asserts the method exists.
 */
async function settle(semantic: unknown): Promise<void> {
  const settled = (semantic as { recopiesSettled?: () => Promise<void> }).recopiesSettled;
  if (typeof settled === 'function') await settled.call(semantic);
}

/** The embedding path: on (the stand-in provider), off for want of an OpenAI key, or off by KEY_DISABLED. */
type EmbeddingPath = 'on' | 'no_key' | 'key_disabled';
const PATH_ENV = ['AI_INTEGRATIONS_OPENAI_API_KEY', 'OPENAI_API_KEY', 'KEY_DISABLED'] as const;

/**
 * The HTTP routes, the real services behind them and the embedding path. AiMemoryService is wired with the
 * SemanticMemoryService, as AiModule wires it. `path.current` switches the embedding path: 'on' answers the stand-in
 * vector; 'no_key' and 'key_disabled' go to the real AiUsageService.trackEmbedding with no OpenAI key in the
 * environment (and KEY_DISABLED set for the second), which refuses before any client, credit or provider call.
 */
async function memoryApp() {
  const { Test } = await import('@nestjs/testing');
  const { default: request } = await import('supertest');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { AiController } = await import('../src/modules/ai/ai.controller');
  const { AgentController } = await import('../src/modules/ai/agent.controller');
  const { AiMemoryService } = await import('../src/modules/ai/ai-memory.service');
  const { SemanticMemoryService } = await import('../src/modules/ai/semantic-memory.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { ProactiveSuggestionService } = await import('../src/modules/ai/proactive-suggestion.service');
  const { UnifiedMemoryWriterService } = await import('../src/modules/key-cortex/unified-memory-writer.service');

  const holds: Array<ReturnType<typeof hold>> = [];
  const embedded: string[] = [];
  const embeddingPath = { current: 'on' as EmbeddingPath };
  // The real usage service for the 'off' paths: its first line is the key check (and KEY_DISABLED's before it).
  const realUsage = new AiUsageService(prisma, {} as any, {} as any, {} as any);
  const savedEnv: Partial<Record<(typeof PATH_ENV)[number], string | undefined>> = {};
  for (const name of PATH_ENV) savedEnv[name] = process.env[name];
  const usage = {
    trackEmbedding: async (businessId: string, userId: string | undefined, feature: string, texts: string[], model?: string) => {
      if (embeddingPath.current !== 'on') {
        for (const name of PATH_ENV) delete process.env[name];
        if (embeddingPath.current === 'key_disabled') process.env.KEY_DISABLED = '1';
        try {
          return await realUsage.trackEmbedding(businessId, userId, feature, texts, model);
        } finally {
          for (const name of PATH_ENV) {
            if (savedEnv[name] === undefined) delete process.env[name];
            else process.env[name] = savedEnv[name];
          }
        }
      }
      for (const text of texts) {
        embedded.push(text);
        for (const h of holds) await h.arm(text);
      }
      return texts.map(() => UNIT_VECTOR);
    },
  };
  const semantic = new SemanticMemoryService(prisma, new EventEmitter2(), usage as any);
  // getAll, upsert and remove read and write the database (and the copies through `semantic`); the execution log and
  // the blueprint serve other methods.
  const memory = new (AiMemoryService as any)(prisma, {} as any, {} as any, semantic);
  const writer = new UnifiedMemoryWriterService(memory, semantic);
  // Positionally, as Nest constructs it (the re-copier last, as AiModule provides it).
  const suggestions = new (ProactiveSuggestionService as any)(prisma, {} as any, {} as any, new EventEmitter2(), semantic);

  const OFF_ROUTE = new Set([
    // AiController's collaborators no case calls.
    'AiAdvisorService', 'AiUsageService', 'AiExecutionLogService', 'AiOversightService', 'BusinessGraphService',
    'IntentParserService', 'PlannerService', 'StrategicIntelligenceService', 'ProAutoMonitorService',
    'ProfileIntelligenceService', 'WorkspaceRecommendationsService', 'ModelGatewayService', 'KeyCommandService',
    'AutopilotRulesService', 'AgentHealthService', 'JourneyOrchestratorService', 'MorningBriefingService',
    'UnifiedInboxService', 'GoalTrackerService', 'WorkloadAggregatorService', 'TaskPrioritizerService',
    'CapacityInsightService', 'TaskRebalancerService', 'KeyAgentConfigService', 'UndoService',
    'WorkflowTemplateService', 'KeyActionProposalService', 'KeyCortexApprovalOrchestratorService',
    // AgentController's.
    'AgentStateMachineService', 'AgentBusService', 'PatternDetectorService', 'CalendarIntelligenceService',
    'DocumentIntelligenceService',
  ]);
  const ref = await Test.createTestingModule({
    controllers: [AiController, AgentController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      CrmRateLimitGuard,
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      { provide: AiMemoryService, useValue: memory },
      { provide: SemanticMemoryService, useValue: semantic },
      { provide: ProactiveSuggestionService, useValue: suggestions },
    ],
  })
    .useMocker((token: any) => (OFF_ROUTE.has(typeof token === 'function' ? token.name : String(token)) ? {} : undefined))
    .compile();
  const http = ref.createNestApplication();
  http.use(async (req: any, _res: any, next: any) => {
    const id = req.headers['x-v71i-user'];
    if (typeof id === 'string' && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  http.useGlobalFilters(new GlobalHttpExceptionFilter());
  await http.init();
  const server = http.getHttpServer();

  type Entry = { category: string; key: string; value: string; confidence?: number };
  const api = {
    /** PUT /ai/businesses/:id/ai/memory: the row the route answers. */
    put: async (userId: string, entry: Entry, businessId = ID.biz) => {
      const res = await request(server).put(`/ai/businesses/${businessId}/ai/memory`).set('x-v71i-user', userId).send(entry);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.memory as { id: string; category: string; key: string; value: string; confidence: number };
    },
    /** PUT /ai/businesses/:id/ai/memory/bulk: the rows the route answers. */
    putBulk: async (userId: string, entries: Entry[], businessId = ID.biz) => {
      const res = await request(server).put(`/ai/businesses/${businessId}/ai/memory/bulk`).set('x-v71i-user', userId).send({ entries });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.memories as Array<{ id: string; value: string }>;
    },
    /** GET /ai/businesses/:id/ai/memory: every value the route answers that member. */
    memories: async (userId: string, businessId = ID.biz) => {
      const res = await request(server).get(`/ai/businesses/${businessId}/ai/memory`).set('x-v71i-user', userId);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return (res.body.memories as Array<{ value: string }>).map((m) => m.value).join('\n');
    },
    /** GET /ai/businesses/:id/ai/memory[?category=]: the rows the route answers that member. */
    memoryRows: async (userId: string, category?: string, businessId = ID.biz) => {
      const req = request(server).get(`/ai/businesses/${businessId}/ai/memory`).set('x-v71i-user', userId);
      const res = category === undefined ? await req : await req.query({ category });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.memories as Array<{ id: string; category: string; key: string; value: string }>;
    },
    /** POST .../agent/memory/backfill: the number of copies the route says it wrote. */
    backfill: async (userId: string, businessId = ID.biz) => {
      const res = await request(server).post(`/ai/businesses/${businessId}/agent/memory/backfill`).set('x-v71i-user', userId);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.backfilled as number;
    },
    /** GET .../agent/memory/search: the route's answer (status and body). */
    searchRaw: async (userId: string, q = QUESTION, businessId = ID.biz) =>
      request(server).get(`/ai/businesses/${businessId}/agent/memory/search`).query({ q, limit: '50' }).set('x-v71i-user', userId),
    /** GET .../agent/memory/search: the contents the route answers that member, one per line. */
    search: async (userId: string, q = QUESTION, businessId = ID.biz) => {
      const res = await api.searchRaw(userId, q, businessId);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return (res.body.results as Array<{ content: string }>).map((r) => r.content).join('\n');
    },
    /** GET .../agent/memory/search: the copy ids the route answers that member. */
    searchIds: async (userId: string, businessId = ID.biz) => {
      const res = await api.searchRaw(userId, QUESTION, businessId);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return (res.body.results as Array<{ id: string }>).map((r) => r.id).sort();
    },
  };
  return {
    api,
    semantic,
    memory,
    writer,
    embedded,
    embeddingPath,
    /** Hold the embedding call of the first text that contains `match`. */
    holdEmbedding: (match: string) => {
      const h = hold(match);
      holds.push(h);
      return h;
    },
    close: async () => {
      await settle(semantic);
      realUsage.onModuleDestroy();
      await http.close();
    },
  };
}

/**
 * KEY's memory block for `userId` (buildMemoryContext over the real stores), asked QUESTION so its semantic search
 * runs: the whole block, and its lines of the business's semantic copies ([ai_memory_embedding]).
 */
async function memoryBlockFor(userId: string, semantic: unknown, businessId = ID.biz): Promise<{ block: string; copies: string }> {
  const { UnifiedMemoryRetrievalService } = await import('../src/modules/key-cortex/unified-memory-retrieval.service');
  const { KeyCortexPromptContextService } = await import('../src/modules/key-cortex/key-cortex-prompt-context.service');
  const { KeyCortexLearningService } = await import('../src/modules/key-cortex/key-cortex-learning.service');
  const unified = new UnifiedMemoryRetrievalService(prisma, semantic as any);
  // Positionally, as Nest constructs it: context service, unified memory, learning service, prisma.
  const promptContext = new (KeyCortexPromptContextService as any)({} as any, unified, new KeyCortexLearningService(prisma), prisma);
  const session = {
    id: `${P}sess_block_${userId}`,
    businessId,
    userId,
    messages: [{ role: 'user', content: QUESTION, timestamp: new Date() }],
  } as any;
  const memory = await promptContext.buildMemoryContext(businessId, session, userId);
  const block: string = memory.aiMemory ?? '';
  return {
    block,
    copies: block
      .split('\n')
      .filter((l) => l.includes('[ai_memory_embedding]'))
      .join('\n'),
  };
}

/** The contents of the copies whose source_id names `rowId` (any business), in code-unit order. */
const copiesOf = async (rowId: string): Promise<string[]> =>
  (await db.$queryRawUnsafe(`SELECT content FROM ai_memory_embeddings WHERE source_type = 'memory' AND source_id = $1`, rowId))
    .map((r: { content: string }) => r.content)
    .sort();

/** The ids of the copies whose source_id names `rowId`, in order. */
const copyIdsOf = async (rowId: string): Promise<string[]> =>
  (await db.$queryRawUnsafe(`SELECT id FROM ai_memory_embeddings WHERE source_type = 'memory' AND source_id = $1`, rowId))
    .map((r: { id: string }) => r.id)
    .sort();

/** The ids of a business's 'memory' copies, in order. */
const memoryCopyIds = async (businessId = ID.biz): Promise<string[]> =>
  (await db.$queryRawUnsafe(`SELECT id FROM ai_memory_embeddings WHERE business_id = $1 AND source_type = 'memory'`, businessId))
    .map((r: { id: string }) => r.id)
    .sort();

/** How many rows of ai_memory_embeddings (any source type, any v71i_ business) hold `text` anywhere in their content. */
const atRest = async (text: string): Promise<number> =>
  Number(
    (
      await db.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM ai_memory_embeddings WHERE business_id LIKE ${sqlLikePrefix(P)} AND strpos(content, $1) > 0`,
        text,
      )
    )[0].n,
  );

/** The content backfillFromAiMemory writes for a row. */
const backfillCopy = (category: string, key: string, value: string) => `${category}: ${key} = ${value}`;

/** Writes a copy straight into the table (what an earlier writer left), with the stand-in vector. */
async function seedCopy(id: string, businessId: string, content: string, sourceId: string, sourceType = 'memory') {
  await db.$executeRawUnsafe(
    `INSERT INTO ai_memory_embeddings (id, business_id, content, source_type, source_id, embedding, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::vector, '{}'::jsonb, NOW())`,
    id,
    businessId,
    content,
    sourceType,
    sourceId,
    VECTOR_LITERAL,
  );
}

/** A statement waiting on a lock: its backend, its text and the backends it waits on (pg_blocking_pids). */
type LockWait = { pid: number; query: string; blockers: number[] };

/**
 * The statements waiting on a lock right now, in this database, with the backends blocking each. Other suites run in
 * parallel against the same database, so a case names the waits it means by who blocks them, not by their text alone.
 */
const lockWaits = async (): Promise<LockWait[]> =>
  (
    await db.$queryRawUnsafe(
      `SELECT pid, query, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
    )
  ).map((r: { pid: number; query: string; blockers: number[] | null }) => ({
    pid: Number(r.pid),
    query: r.query,
    blockers: (r.blockers ?? []).map(Number),
  }));

/** The first wait `pred` holds over, once one is there; null once `settled` has settled first or after `ms`. */
async function untilLockWait(pred: (wait: LockWait) => boolean, settled: { done: boolean }, ms = 8_000): Promise<LockWait | null> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const found = (await lockWaits()).find(pred);
    if (found) return found;
    if (settled.done) return null;
    await new Promise((r) => setTimeout(r, 25));
  }
  return null;
}

const track = <T>(p: Promise<T>) => {
  const state = { done: false };
  const tracked = p.finally(() => {
    state.done = true;
  });
  return { promise: tracked, state };
};

// ---------------------------------------------------------------------------
// 1. A rewrite drops the copies of the old value and copies the new one
// ---------------------------------------------------------------------------

describe('FU-MEMORY-COPIES-REWRITE: a row rewritten in place drops the copies of its old value', () => {
  it("V71I-01 after the owner PUTs a new value (PUT /ai/businesses/:id/ai/memory, the same row), ai_memory_embeddings holds no copy of the old text; the row is copied again with the new value in each form it had (the backfill's and the writer's), so the STAFF member's search and memory block serve only the new value; another row's copy and the other business's row of the same key are untouched", async () => {
    const app = await memoryApp();
    try {
      const OLD = 'V71I-01-OLD-SECRET: the owner is selling the second shop in March';
      const NEW = 'V71I-01-NEW: the owner is keeping both shops';
      const KEEP = 'V71I-01-KEEP: open Saturdays until noon';
      const OTHER = 'V71I-01-OTHER-BIZ: a goal of the other business';
      const KEY = `${P}goal`;
      const row = await app.api.put(ID.owner, { category: 'goals', key: KEY, value: OLD });
      const keep = await app.api.put(ID.owner, { category: 'priorities', key: `${P}keep`, value: KEEP });
      const other = await app.api.put(ID.owner, { category: 'goals', key: KEY, value: OLD }, ID.other);
      // The row's two copies: KEY's writer indexes it (its copy is the value), and the owner backfills (MEM-SEMANTIC-SIGHT: settings admin).
      await app.writer.store(ID.biz, 'goals' as any, KEY, OLD, { indexSemantic: true, source: 'explicit' });
      expect(await app.api.backfill(ID.owner)).toBe(2);
      expect(await app.api.backfill(ID.owner, ID.other)).toBe(1);
      expect(await copiesOf(row.id)).toEqual([backfillCopy('goals', KEY, OLD), OLD].sort());
      expect(await atRest('V71I-01-OLD-SECRET'), 'before the rewrite: both copies, and the other business\'s').toBe(3);
      const keepIds = await copyIdsOf(keep.id);
      const otherIds = await copyIdsOf(other.id);
      expect(await app.api.search(ID.member), 'before the rewrite').toContain('V71I-01-OLD-SECRET');

      const embeddedBefore = app.embedded.length;
      const rewritten = await app.api.put(ID.owner, { category: 'goals', key: KEY, value: NEW });
      expect(rewritten.id, 'the same row, rewritten in place').toBe(row.id);
      expect(rewritten.value).toBe(NEW);
      await settle(app.semantic);

      // At rest: no copy of the old text in this business (the other business's row was not rewritten).
      expect(await copiesOf(row.id), "the row's copies: one per form, of the new value").toEqual([backfillCopy('goals', KEY, NEW), NEW].sort());
      expect(await atRest('V71I-01-OLD-SECRET'), 'copies of the old value left (only the other business\'s)').toBe(1);
      expect(
        (await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ai_memory_embeddings WHERE business_id = $1 AND strpos(content, $2) > 0`, ID.biz, 'V71I-01-OLD'))[0].n,
        'copies of the old value in the rewritten business',
      ).toBe(0);
      expect(app.embedded.slice(embeddedBefore), 'one embedding per form the row had').toEqual(
        expect.arrayContaining([backfillCopy('goals', KEY, NEW), NEW]),
      );
      expect(app.embedded.length - embeddedBefore).toBe(2);
      expect(await copyIdsOf(keep.id), "another row's copy is untouched").toEqual(keepIds);
      expect(await copyIdsOf(other.id), "the other business's copy of the same key is untouched").toEqual(otherIds);

      for (const userId of [ID.member, ID.owner]) {
        const search = await app.api.search(userId);
        expect(search, `${userId}: search after the rewrite`).not.toContain('V71I-01-OLD');
        expect(search, `${userId}: search after the rewrite`).toContain(backfillCopy('goals', KEY, NEW));
        expect(search).toContain(KEEP);
      }
      const { block, copies } = await memoryBlockFor(ID.member, app.semantic);
      expect(block, 'the memory block after the rewrite').not.toContain('V71I-01-OLD');
      expect(copies, "the memory block's semantic copies").toContain('V71I-01-NEW');
      const memories = await app.api.memories(ID.member);
      expect(memories).toContain(NEW);
      expect(memories).not.toContain('V71I-01-OLD');
      expect(await app.api.search(ID.owner, QUESTION, ID.other), 'the other business still serves its own row').toContain(OLD);
    } finally {
      await app.close();
    }
  }, 60_000);

  it('V71I-02 PUT /ai/businesses/:id/ai/memory/bulk: each rewritten row drops its old copies and is copied again with its new value; a row the bulk writes with the same value (a new confidence) keeps its copy, and is not embedded again', async () => {
    const app = await memoryApp();
    try {
      const a = await app.api.put(ID.owner, { category: 'priorities', key: `${P}a`, value: 'V71I-02-OLD-A: chase the overdue invoices' });
      const b = await app.api.put(ID.owner, { category: 'bottlenecks', key: `${P}b`, value: 'V71I-02-OLD-B: one van for three crews' });
      const SAME = 'V71I-02-SAME: quotes go out within a day';
      const c = await app.api.put(ID.owner, { category: 'priorities', key: `${P}c`, value: SAME, confidence: 0.9 });
      expect(await app.api.backfill(ID.owner)).toBe(3);
      const cIds = await copyIdsOf(c.id);
      expect(cIds).toHaveLength(1);

      const embeddedBefore = app.embedded.length;
      const rows = await app.api.putBulk(ID.owner, [
        { category: 'priorities', key: `${P}a`, value: 'V71I-02-NEW-A: invoices are current' },
        { category: 'bottlenecks', key: `${P}b`, value: 'V71I-02-NEW-B: a second van arrived' },
        { category: 'priorities', key: `${P}c`, value: SAME, confidence: 0.5 },
      ]);
      expect(rows.map((r) => r.id)).toEqual([a.id, b.id, c.id]);
      await settle(app.semantic);

      expect(await atRest('V71I-02-OLD'), 'copies of the old values left').toBe(0);
      expect(await copiesOf(a.id)).toEqual([backfillCopy('priorities', `${P}a`, 'V71I-02-NEW-A: invoices are current')]);
      expect(await copiesOf(b.id)).toEqual([backfillCopy('bottlenecks', `${P}b`, 'V71I-02-NEW-B: a second van arrived')]);
      expect(await copyIdsOf(c.id), 'the row whose value did not change keeps its copy').toEqual(cIds);
      expect(app.embedded.slice(embeddedBefore).sort(), 'only the rewritten rows are embedded').toEqual(
        [
          backfillCopy('priorities', `${P}a`, 'V71I-02-NEW-A: invoices are current'),
          backfillCopy('bottlenecks', `${P}b`, 'V71I-02-NEW-B: a second van arrived'),
        ].sort(),
      );
      const search = await app.api.search(ID.member);
      expect(search).not.toContain('V71I-02-OLD');
      expect(search).toContain('V71I-02-NEW-A');
      expect(search).toContain('V71I-02-NEW-B');
      expect(search).toContain(SAME);
    } finally {
      await app.close();
    }
  }, 60_000);

  it('V71I-03 with the embedding path off (the real AiUsageService with no OpenAI key, then with KEY_DISABLED), the rewrite still answers 200 with the new value and still drops the copies of the old value; nothing is embedded and no copy of the new value is written; the memory block serves only the new value; once the path is on, the next backfill copies the new value', async () => {
    for (const mode of ['no_key', 'key_disabled'] as const) {
      await resetMemory();
      const app = await memoryApp();
      try {
        const MARK = `V71I-03-${mode}`;
        const OLD = `${MARK}-OLD: the owner draws 4000 a month`;
        const NEW = `${MARK}-NEW: the owner draws a salary`;
        const KEY = `${P}draw_${mode}`;
        const row = await app.api.put(ID.owner, { category: 'goals', key: KEY, value: OLD });
        expect(await app.api.backfill(ID.owner)).toBe(1);
        expect(await atRest(`${MARK}-OLD`)).toBe(1);

        app.embeddingPath.current = mode;
        const embeddedBefore = app.embedded.length;
        const rewritten = await app.api.put(ID.owner, { category: 'goals', key: KEY, value: NEW });
        expect(rewritten.id).toBe(row.id);
        expect(rewritten.value).toBe(NEW);
        await settle(app.semantic); // before the path is switched back on: the re-copy saw it off
        expect(await atRest(`${MARK}-OLD`), `${mode}: the old copy at rest`).toBe(0);
        expect(await copiesOf(row.id), `${mode}: no copy of the new value without the embedding path`).toEqual([]);
        expect(app.embedded.length, `${mode}: nothing reached the stand-in provider`).toBe(embeddedBefore);
        // Search needs an embedding of the question: with the path off it answers the provider 503, as before.
        const refused = await app.api.searchRaw(ID.member);
        expect(refused.status, JSON.stringify(refused.body)).toBe(503);
        expect(refused.body.code).toBe('provider_not_configured');
        // KEY's memory block goes on without the semantic part, and its rows serve the new value only.
        const { block } = await memoryBlockFor(ID.member, app.semantic);
        expect(block).not.toContain(`${MARK}-OLD`);
        expect(block).toContain(`${MARK}-NEW`);
        expect(await app.api.memories(ID.member)).not.toContain(`${MARK}-OLD`);

        app.embeddingPath.current = 'on';
        expect(await app.api.backfill(ID.owner)).toBe(1);
        expect(await copiesOf(row.id)).toEqual([backfillCopy('goals', KEY, NEW)]);
        const search = await app.api.search(ID.member);
        expect(search).toContain(`${MARK}-NEW`);
        expect(search).not.toContain(`${MARK}-OLD`);
      } finally {
        app.embeddingPath.current = 'on';
        await app.close();
      }
    }
  }, 90_000);

  it("V71I-04 KEY's writer (UnifiedMemoryWriterService.storeDocumentExtraction) re-extracting a document rewrites its row: the copies of the old extraction are dropped and the row is copied again once per form it had, with no duplicate of the writer's own copy and no second embedding of it; a re-extraction without indexSemantic re-copies the forms the row had too", async () => {
    const app = await memoryApp();
    try {
      const DOC = `${P}doc_payroll`;
      const OLD = 'V71I-04-OLD-EXTRACT: payroll total 18400 for March';
      const NEW = 'V71I-04-NEW-EXTRACT: payroll total withheld';
      const NEWER = 'V71I-04-NEWER-EXTRACT: payroll reviewed by the accountant';
      await app.writer.storeDocumentExtraction(ID.biz, DOC, OLD, { indexSemantic: true });
      const row = await db.aiMemory.findFirstOrThrow({ where: { businessId: ID.biz, category: 'document_extraction', key: DOC } });
      expect(await app.api.backfill(ID.owner)).toBe(1);
      expect(await copiesOf(row.id)).toEqual([backfillCopy('document_extraction', DOC, OLD), OLD].sort());

      let embeddedBefore = app.embedded.length;
      await app.writer.storeDocumentExtraction(ID.biz, DOC, NEW, { indexSemantic: true });
      await settle(app.semantic);
      expect(await copiesOf(row.id), 'one copy per form, of the new extraction').toEqual([backfillCopy('document_extraction', DOC, NEW), NEW].sort());
      expect(app.embedded.length - embeddedBefore, 'one embedding per form: the writer finds its copy already made').toBe(2);
      expect(await atRest('V71I-04-OLD')).toBe(0);

      embeddedBefore = app.embedded.length;
      await app.writer.storeDocumentExtraction(ID.biz, DOC, NEWER);
      await settle(app.semantic);
      expect(await copiesOf(row.id)).toEqual([backfillCopy('document_extraction', DOC, NEWER), NEWER].sort());
      expect(app.embedded.length - embeddedBefore).toBe(2);
      expect(await atRest('V71I-04-NEW-EXTRACT')).toBe(0);

      const search = await app.api.search(ID.member);
      expect(search).toContain('V71I-04-NEWER');
      expect(search).not.toContain('V71I-04-OLD');
      expect(search).not.toContain('V71I-04-NEW-EXTRACT');
      expect((await memoryBlockFor(ID.member, app.semantic)).block).not.toContain('V71I-04-OLD');
    } finally {
      await app.close();
    }
  }, 60_000);

  it("V71I-05 a backfill that read the old value and writes its copy while the owner's rewrite has rewritten the row but not yet committed waits for the rewrite and then writes nothing; the rewrite's copy deletion waits on, and deletes, the row's existing copy: no copy of the old value survives the rewrite", async () => {
    const app = await memoryApp();
    // The rewrite's transaction rewrites the row, then deletes its stale copies. A test transaction holds a lock on the
    // row's one existing copy, so the rewrite's copy deletion waits on it with the row rewritten and not committed: the
    // window in which the held backfill's write runs here. The write must wait on the rewritten row's lock and, once
    // the rewrite commits, insert nothing (a write that read the row as it was would commit a copy of the old value
    // that the rewrite's deletion, its snapshot taken, never sees).
    let releaseLock: () => void = () => undefined;
    const lockReleased = new Promise<void>((resolve) => (releaseLock = resolve));
    let lockTx: Promise<unknown> | undefined;
    try {
      const OLD = 'V71I-05-OLD: the owner is buying out the partner';
      const NEW = 'V71I-05-NEW: the partnership continues';
      const KEY = `${P}race`;
      const row = await app.api.put(ID.owner, { category: 'goals', key: KEY, value: OLD });
      expect(await app.api.backfill(ID.owner)).toBe(1);
      const [existing] = await copyIdsOf(row.id);
      expect(existing).toBeDefined();

      // A second backfill reads the row and is held before it writes the copy.
      const held = app.holdEmbedding('V71I-05-OLD');
      const backfill = track(app.api.backfill(ID.owner));
      await held.reached;

      let locked: (pid: number) => void = () => undefined;
      const lockTaken = new Promise<number>((resolve) => (locked = resolve));
      lockTx = db.$transaction(
        async (tx: any) => {
          await tx.$queryRawUnsafe(`SELECT id FROM ai_memory_embeddings WHERE id = $1 FOR UPDATE`, existing);
          const [{ pid }] = await tx.$queryRawUnsafe(`SELECT pg_backend_pid() AS pid`);
          locked(Number(pid));
          await lockReleased;
        },
        { timeout: 30_000, maxWait: 10_000 },
      );
      const lockPid = await lockTaken;

      // The owner's rewrite: its deletion of the old copy waits on the held lock (this case's lock, not another
      // suite's), the row rewritten and not committed.
      const rewrite = track(app.api.put(ID.owner, { category: 'goals', key: KEY, value: NEW }));
      const deletion = await untilLockWait(
        (w) => /delete/i.test(w.query) && w.query.includes('ai_memory_embeddings') && w.blockers.includes(lockPid),
        rewrite.state,
      );

      // The held backfill writes its copy of the old value now: it must wait on the rewritten row, that is on the
      // rewrite's transaction.
      held.release();
      const write = deletion
        ? await untilLockWait(
            (w) => /insert/i.test(w.query) && w.query.includes('ai_memory_embeddings') && w.blockers.includes(deletion.pid),
            backfill.state,
          )
        : null;
      const deletionWaits = deletion !== null;
      const writeWaits = write !== null;

      releaseLock();
      await lockTx;
      expect((await rewrite.promise).value).toBe(NEW);
      const written = await backfill.promise;
      await settle(app.semantic);

      expect(await atRest('V71I-05-OLD'), 'no copy of the old value survives the rewrite').toBe(0);
      expect(await copiesOf(row.id), 'the rewrite copied the new value').toEqual([backfillCopy('goals', KEY, NEW)]);
      expect(written, 'the held backfill wrote nothing').toBe(0);
      expect(await app.api.search(ID.member)).not.toContain('V71I-05-OLD');
      expect(deletionWaits, "the rewrite's copy deletion waited on the held copy").toBe(true);
      expect(writeWaits, "the backfill's write waited on the rewritten row").toBe(true);
    } finally {
      releaseLock();
      if (lockTx) await lockTx.catch(() => undefined);
      await app.close();
    }
  }, 60_000);

  it("V71I-06 the in-place writers outside AiMemoryService drop the copies of the old value too, and copy the row again with its new value (review COR-V71I-3): memory consolidation promoting a changed member-less recommendation into learning:learned:<fn> (the same row); search serves the new value with no backfill run; a promotion that does not change the value keeps the copy and embeds nothing", async () => {
    const app = await memoryApp();
    try {
      const { MemoryConsolidationService } = await import('../src/modules/key-cortex/memory-consolidation.service');
      const fn = `${P}fn_followup`;
      const cognition = await db.cognitionMemory.create({
        data: { businessId: ID.biz, roleId: 'key_cortex', functionId: fn, query: 'what next?', recommendation: 'V71I-06-OLD-PROMOTED: call the Arima leads first', userResponse: 'accepted', confidence: 0.95 },
      });
      // Positionally, as Nest constructs it, with the re-copier KeyCortexModule provides (AiModule's
      // SemanticMemoryService) last.
      const consolidation = new (MemoryConsolidationService as any)(prisma, undefined, app.semantic);
      await consolidation.run(ID.biz);
      const promoted = await db.aiMemory.findFirstOrThrow({ where: { businessId: ID.biz, category: 'learning', key: `learned:${fn}` } });
      expect(await app.api.backfill(ID.owner)).toBe(1);
      expect(await atRest('V71I-06-OLD')).toBe(1);

      // The same recommendation promoted again: the value does not change, the copy stays, nothing is embedded.
      const promotedCopy = await copyIdsOf(promoted.id);
      let embeddedBefore = app.embedded.length;
      await consolidation.run(ID.biz);
      await settle(app.semantic);
      expect(await copyIdsOf(promoted.id)).toEqual(promotedCopy);
      expect(app.embedded.length).toBe(embeddedBefore);

      await db.cognitionMemory.update({ where: { id: cognition.id }, data: { recommendation: 'V71I-06-NEW-PROMOTED: call the Chaguanas leads first' } });
      await consolidation.run(ID.biz);
      await settle(app.semantic);
      const promotedNow = await db.aiMemory.findUniqueOrThrow({ where: { id: promoted.id } });
      expect(promotedNow.value).toContain('V71I-06-NEW-PROMOTED');

      expect(await atRest('V71I-06-OLD'), 'copies of the old values left').toBe(0);
      // The row is copied again, in the form it had (the backfill's), with its new value: no backfill needed.
      expect(await copiesOf(promoted.id), 'the promoted row, copied again').toEqual([backfillCopy('learning', `learned:${fn}`, promotedNow.value)]);
      embeddedBefore = app.embedded.length;
      const memberSearch = await app.api.search(ID.member);
      expect(memberSearch).not.toContain('V71I-06-OLD');
      expect(memberSearch, 'served with no backfill run').toContain('V71I-06-NEW-PROMOTED');
      expect(app.embedded.length - embeddedBefore, 'only the question').toBe(1);

      embeddedBefore = app.embedded.length;
      const ownerSearch = await app.api.search(ID.owner);
      expect(ownerSearch).not.toContain('V71I-06-OLD');
      expect(ownerSearch, 'owner sees promoted learning copy with no backfill run').toContain('V71I-06-NEW-PROMOTED');
      expect(app.embedded.length - embeddedBefore, 'only the question').toBe(1);
    } finally {
      await app.close();
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 1b. Review repair: the re-copy (COR-V71I-1, COR-V71I-4)
// ---------------------------------------------------------------------------

describe('FU-MEMORY-COPIES-REWRITE review repair: the re-copy of a rewritten row', () => {
  it("V71I-10 (COR-V71I-1) two rewrites of one row close together leave it copied with the value it holds: the second lands while the first one's re-copy is being embedded (it finds no copy to drop, so it starts no re-copy), the first re-copy's insert is refused (the row holds another value) and it copies what the row holds now; no copy of either earlier value remains, and search and KEY's memory block serve the last value", async () => {
    const app = await memoryApp();
    let held: ReturnType<typeof hold> | undefined;
    try {
      const KEY = `${P}twice`;
      const V0 = 'V71I-10-V0: the owner opens on Sundays';
      const V1 = 'V71I-10-V1: the owner opens on Saturdays';
      const V2 = 'V71I-10-V2: the owner closes on weekends';
      const row = await app.api.put(ID.owner, { category: 'goals', key: KEY, value: V0 });
      expect(await app.api.backfill(ID.owner)).toBe(1);

      // The first rewrite's re-copy is held while it embeds its copy of V1.
      held = app.holdEmbedding('V71I-10-V1');
      const first = track(app.api.put(ID.owner, { category: 'goals', key: KEY, value: V1 }));
      await held.reached;
      expect(await atRest('V71I-10-V0'), 'the first rewrite dropped the copy of V0').toBe(0);

      // The second rewrite (the owner's here; KEY's writers go through the same door) finds no copy to drop.
      const second = await app.api.put(ID.owner, { category: 'goals', key: KEY, value: V2 });
      expect(second.id).toBe(row.id);
      expect(second.value).toBe(V2);

      held.release();
      expect((await first.promise).value).toBe(V1);
      await settle(app.semantic);

      expect(await copiesOf(row.id), 'one copy, in the form the row had, of the value it holds').toEqual([backfillCopy('goals', KEY, V2)]);
      expect(await atRest('V71I-10-V0')).toBe(0);
      expect(await atRest('V71I-10-V1')).toBe(0);
      const search = await app.api.search(ID.member);
      expect(search).toContain(backfillCopy('goals', KEY, V2));
      expect(search).not.toContain('V71I-10-V1');
      expect((await memoryBlockFor(ID.member, app.semantic)).copies, "KEY's memory block's semantic copies").toContain('V71I-10-V2');
    } finally {
      held?.release();
      await app.close();
    }
  }, 60_000);

  it("V71I-11 (COR-V71I-4) the rewrite answers without waiting on its re-copy: with the re-copy's embedding held, PUT .../ai/memory answers 200 with the new value and the old copies already gone; the copies of the new value are written once the embedding returns, each form embedded once; KEY's writer indexing the row meanwhile waits for that re-copy and adds no duplicate", async () => {
    const app = await memoryApp();
    let held: ReturnType<typeof hold> | undefined;
    let rewrite: { promise: Promise<any>; state: { done: boolean } } | undefined;
    try {
      const KEY = `${P}slow`;
      const OLD = 'V71I-11-OLD: the van is leased';
      const NEW = 'V71I-11-NEW: the van is owned';
      const row = await app.api.put(ID.owner, { category: 'goals', key: KEY, value: OLD });
      await app.writer.store(ID.biz, 'goals' as any, KEY, OLD, { indexSemantic: true, source: 'explicit' });
      expect(await app.api.backfill(ID.owner)).toBe(1);
      expect(await copiesOf(row.id)).toEqual([backfillCopy('goals', KEY, OLD), OLD].sort());

      // The re-copy's first embedding (a form of the new value) is held: a slow provider.
      held = app.holdEmbedding('V71I-11-NEW');
      rewrite = track(app.api.put(ID.owner, { category: 'goals', key: KEY, value: NEW }));
      await held.reached;
      const answered = await Promise.race([
        rewrite.promise.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3_000)),
      ]);
      expect(answered, 'the PUT answered while its re-copy was embedding').toBe(true);
      const rewritten = await rewrite.promise;
      expect(rewritten.id).toBe(row.id);
      expect(rewritten.value).toBe(NEW);
      expect(await atRest('V71I-11-OLD'), 'the old copies were dropped before the answer').toBe(0);
      expect(await copiesOf(row.id), 'no copy of the new value yet').toEqual([]);

      // KEY's writer indexes the row now (its copy is the value form): it waits for the row's re-copy.
      const indexed = track(app.writer.store(ID.biz, 'goals' as any, KEY, NEW, { indexSemantic: true, source: 'explicit' }));
      await new Promise((r) => setTimeout(r, 300));
      expect(indexed.state.done, "KEY's writer waits for the row's re-copy in flight").toBe(false);

      held.release();
      await indexed.promise;
      await settle(app.semantic);
      expect(await copiesOf(row.id), 'one copy per form of the new value, no duplicate').toEqual([backfillCopy('goals', KEY, NEW), NEW].sort());
      expect(app.embedded.filter((t) => t.includes('V71I-11-NEW')).sort(), 'each form embedded once').toEqual([backfillCopy('goals', KEY, NEW), NEW].sort());
      expect(await app.api.search(ID.member)).not.toContain('V71I-11-OLD');
      expect(typeof (app.semantic as any).recopiesSettled, 'SemanticMemoryService.recopiesSettled (the harness waits on it)').toBe('function');
    } finally {
      held?.release();
      if (rewrite) await rewrite.promise.catch(() => undefined);
      await app.close();
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 1c. Review repair: a settings row is configuration, not memory (SEC-FUMCR-1, SEC-FUMCR-2, COR-V71I-2)
// ---------------------------------------------------------------------------

/**
 * The real ModelGatewayService (its updatePreferences writes settings / ai_preferences, encrypting each BYOK key with
 * AES-256-GCM under a key derived from BYOK_ENCRYPTION_SECRET), with a secret built at runtime for its construction
 * and restored right after. Its collaborators serve other methods.
 */
async function byokGateway(): Promise<{ updatePreferences: (businessId: string, updates: Record<string, unknown>) => Promise<unknown> }> {
  const { ModelGatewayService } = await import('../src/modules/ai/model-gateway.service');
  const saved = process.env.BYOK_ENCRYPTION_SECRET;
  process.env.BYOK_ENCRYPTION_SECRET = [P, 'enc', randomBytes(12).toString('hex')].join('-');
  try {
    return new (ModelGatewayService as any)(prisma, {} as any, {} as any);
  } finally {
    if (saved === undefined) delete process.env.BYOK_ENCRYPTION_SECRET;
    else process.env.BYOK_ENCRYPTION_SECRET = saved;
  }
}

/** A BYOK key for the owner to set, built at runtime. */
const byokKey = (tag: string) => [P, 'byok', tag, randomBytes(8).toString('hex')].join('-');

/** The owner's AI preferences row (settings / ai_preferences) and the OpenAI key's ciphertext it stores. */
async function preferencesRow(businessId = ID.biz): Promise<{ row: { id: string; value: string }; ciphertext: string }> {
  const row = await db.aiMemory.findUniqueOrThrow({
    where: { businessId_category_key: { businessId, category: 'settings', key: 'ai_preferences' } },
  });
  return { row, ciphertext: JSON.parse(row.value).byokOpenai as string };
}

describe('FU-MEMORY-COPIES-REWRITE review repair: a settings row is configuration, not memory', () => {
  it("V71I-12 (SEC-FUMCR-2) the owner's AI preferences row (settings / ai_preferences, the BYOK keys as ciphertext, written by the real ModelGatewayService.updatePreferences) is read by no AI memory reader: GET /ai/businesses/:id/ai/memory lists it to neither the STAFF member nor the owner, ?category=settings answers none, and KEY's memory block holds none of it; the business's memory rows are still served", async () => {
    const app = await memoryApp();
    try {
      const gateway = await byokGateway();
      const key = byokKey('first');
      await gateway.updatePreferences(ID.biz, { byokOpenai: key });
      const { row: settings, ciphertext } = await preferencesRow();
      expect(ciphertext).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
      expect(settings.value, 'the key is stored as ciphertext').not.toContain(key);
      const GOAL = 'V71I-12-GOAL: open a second shop in the spring';
      await app.api.put(ID.owner, { category: 'goals', key: `${P}goal12`, value: GOAL });

      for (const userId of [ID.member, ID.owner]) {
        const rows = await app.api.memoryRows(userId);
        expect(rows.map((r) => r.value), `${userId}: GET .../ai/memory serves the memory rows`).toContain(GOAL);
        expect(rows.filter((r) => r.category === 'settings'), `${userId}: GET .../ai/memory lists no settings row`).toEqual([]);
        expect(JSON.stringify(rows), `${userId}: GET .../ai/memory`).not.toContain(ciphertext);
        expect(await app.api.memoryRows(userId, 'settings'), `${userId}: GET .../ai/memory?category=settings`).toEqual([]);
      }
      const { block } = await memoryBlockFor(ID.member, app.semantic);
      expect(block, "KEY's memory block serves the memory rows").toContain('V71I-12-GOAL');
      expect(block, "KEY's memory block").not.toContain(ciphertext);
      expect(block, "KEY's memory block").not.toContain('ai_preferences');
    } finally {
      await app.close();
    }
  }, 60_000);

  it("V71I-13 (SEC-FUMCR-1, SEC-FUMCR-2, COR-V71I-2) no copy of a settings row is made or served: the owner's backfill copies the memory rows and not the preferences row (the embedding provider is never sent its ciphertext); SemanticMemoryService.store of it embeds and writes nothing; a copy of it a backfill made before this repair, holding what the row holds, is not served by search or KEY's memory block", async () => {
    const app = await memoryApp();
    try {
      const gateway = await byokGateway();
      await gateway.updatePreferences(ID.biz, { byokOpenai: byokKey('first') });
      const { row: settings, ciphertext } = await preferencesRow();
      const GOAL = 'V71I-13-GOAL: hire a second technician';
      const goal = await app.api.put(ID.owner, { category: 'goals', key: `${P}goal13`, value: GOAL });

      let embeddedBefore = app.embedded.length;
      expect(await app.api.backfill(ID.owner), 'the backfill copies the memory row only').toBe(1);
      expect(app.embedded.slice(embeddedBefore), 'what the backfill sent the embedding provider').toEqual([backfillCopy('goals', `${P}goal13`, GOAL)]);
      expect(await copiesOf(settings.id), 'no copy of the settings row').toEqual([]);
      expect(await copiesOf(goal.id)).toEqual([backfillCopy('goals', `${P}goal13`, GOAL)]);

      // The other writer of copies (KEY's, UnifiedMemoryWriterService through store) makes none either, in either form.
      embeddedBefore = app.embedded.length;
      for (const content of [settings.value, backfillCopy('settings', 'ai_preferences', settings.value)]) {
        await app.semantic.store({ businessId: ID.biz, content, sourceType: 'memory', sourceId: settings.id, metadata: {} });
      }
      expect(await copiesOf(settings.id), 'store writes no copy of a settings row').toEqual([]);
      expect(app.embedded.slice(embeddedBefore), 'store sends the provider nothing of it').toEqual([]);
      expect(await atRest(ciphertext)).toBe(0);

      // A copy a backfill made before this repair, holding what the row holds.
      await seedCopy(`${P}e13_settings`, ID.biz, backfillCopy('settings', 'ai_preferences', settings.value), settings.id);
      for (const userId of [ID.member, ID.owner]) {
        const search = await app.api.search(userId);
        expect(search, `${userId}: search serves the memory rows`).toContain('V71I-13-GOAL');
        expect(search, `${userId}: search`).not.toContain(ciphertext);
      }
      const { block } = await memoryBlockFor(ID.member, app.semantic);
      expect(block, "KEY's memory block").not.toContain(ciphertext);
    } finally {
      await app.close();
    }
  }, 60_000);

  it("V71I-14 (SEC-FUMCR-1) after the owner rotates the BYOK key (the real ModelGatewayService.updatePreferences, a writer outside the door) the cleanup command leaves no copy of the old or the new ciphertext at rest: its dry run lists the preferences row's copies made before this repair (reason settings_row, no content) and its stale set is exactly the 'memory' copies search does not serve; --apply deletes them and keeps the memory row's copy", async () => {
    const app = await memoryApp();
    try {
      const gateway = await byokGateway();
      await gateway.updatePreferences(ID.biz, { byokOpenai: byokKey('first') });
      const first = await preferencesRow();
      const GOAL = 'V71I-14-GOAL: quote within a day';
      const goal = await app.api.put(ID.owner, { category: 'goals', key: `${P}goal14`, value: GOAL });
      await seedCopy(`${P}e14_goal`, ID.biz, backfillCopy('goals', `${P}goal14`, GOAL), goal.id);
      // Copies a backfill made before this repair: of the preferences with the first key, and, after the rotation,
      // with the second (each held what the row held when it was made).
      await seedCopy(`${P}e14_settings_first`, ID.biz, backfillCopy('settings', 'ai_preferences', first.row.value), first.row.id);
      await gateway.updatePreferences(ID.biz, { byokOpenai: byokKey('second') });
      const second = await preferencesRow();
      expect(second.row.id, 'the same row, rewritten in place').toBe(first.row.id);
      expect(second.ciphertext).not.toBe(first.ciphertext);
      await seedCopy(`${P}e14_settings_second`, ID.biz, backfillCopy('settings', 'ai_preferences', second.row.value), second.row.id);
      expect(await atRest(first.ciphertext)).toBe(1);
      expect(await atRest(second.ciphertext)).toBe(1);

      const { main } = await import('../scripts/cleanup-stale-memory-copies');
      const out: string[] = [];
      const err: string[] = [];
      const log = (...a: unknown[]) => out.push(a.join(' '));
      const error = (...a: unknown[]) => err.push(a.join(' '));
      expect(await main([`--business=${ID.biz}`], { db, log, error }), err.join('\n')).toBe(0);
      const dry = out.join('\n');
      expect(dry).toMatch(/stale_settings_row\s+2\b/);
      expect(dry).toMatch(/would_delete\s+2\b/);
      expect(dry).toMatch(new RegExp(`${P}e14_settings_first\\s+settings_row`));
      expect(dry).toMatch(new RegExp(`${P}e14_settings_second\\s+settings_row`));
      expect(dry).not.toContain(`${P}e14_goal`);
      expect(dry, 'no content is printed').not.toContain(first.ciphertext);
      expect(dry, 'no content is printed').not.toContain(second.ciphertext);

      // The script's stale set is exactly what search does not serve.
      const served = await app.api.searchIds(ID.member);
      expect(served).toEqual([`${P}e14_goal`]);
      expect((await memoryCopyIds()).filter((id) => !served.includes(id))).toEqual([`${P}e14_settings_first`, `${P}e14_settings_second`].sort());

      out.length = 0;
      expect(await main(['--apply', `--business=${ID.biz}`], { db, log, error }), err.join('\n')).toBe(0);
      expect(out.join('\n')).toMatch(/deleted\s+2\b/);
      expect(await atRest(first.ciphertext), 'the old key\'s ciphertext at rest').toBe(0);
      expect(await atRest(second.ciphertext), 'the new key\'s ciphertext at rest').toBe(0);
      expect(await memoryCopyIds()).toEqual([`${P}e14_goal`]);
      expect(await app.api.searchIds(ID.member)).toEqual(served);
    } finally {
      await app.close();
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 2. The cleanup command: stale copies left before this packet
// ---------------------------------------------------------------------------

/**
 * What a business holds after years of the old writers: valid copies, copies of values their rows no longer hold,
 * copies whose row is gone (or is another business's), an expired row's copy, and a document chunk.
 */
async function seedHistory(app: Awaited<ReturnType<typeof memoryApp>>, tag: string) {
  const live = await app.api.put(ID.owner, { category: 'priorities', key: `${P}${tag}_live`, value: `${tag}-LIVE: wholesale on Tuesdays` });
  const rewritten = await db.aiMemory.create({
    data: { businessId: ID.biz, category: 'goals', key: `${P}${tag}_rewritten`, value: `${tag}-NOW: keep both shops`, source: 'user' },
  });
  const expired = await db.aiMemory.create({
    data: {
      businessId: ID.biz,
      category: 'patterns',
      key: `${P}${tag}_expired`,
      value: `${tag}-EXPIRED: peak hour 3PM last month`,
      source: 'pattern_analysis',
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
  });
  const otherRow = await db.aiMemory.create({
    data: { businessId: ID.other, category: 'goals', key: `${P}${tag}_other`, value: `${tag}-OTHER-ROW: a goal of the other business`, source: 'user' },
  });
  const valid = {
    liveEntry: `${P}${tag}_e_live_entry`,
    liveValue: `${P}${tag}_e_live_value`,
    rewrittenNow: `${P}${tag}_e_now`,
    expired: `${P}${tag}_e_expired`,
    document: `${P}${tag}_e_document`,
  };
  const stale = {
    rewrittenOldEntry: `${P}${tag}_e_old_entry`,
    rewrittenOldValue: `${P}${tag}_e_old_value`,
    orphan: `${P}${tag}_e_orphan`,
    otherBusinessRow: `${P}${tag}_e_other_row`,
  };
  await seedCopy(valid.liveEntry, ID.biz, backfillCopy('priorities', `${P}${tag}_live`, `${tag}-LIVE: wholesale on Tuesdays`), live.id);
  await seedCopy(valid.liveValue, ID.biz, `${tag}-LIVE: wholesale on Tuesdays`, live.id);
  await seedCopy(valid.rewrittenNow, ID.biz, backfillCopy('goals', `${P}${tag}_rewritten`, `${tag}-NOW: keep both shops`), rewritten.id);
  await seedCopy(valid.expired, ID.biz, backfillCopy('patterns', `${P}${tag}_expired`, `${tag}-EXPIRED: peak hour 3PM last month`), expired.id);
  await seedCopy(valid.document, ID.biz, `${tag}-DOCUMENT: [price list chunk 1/1] delivery is free over 500`, `${P}${tag}_knowledge:0`, 'document');
  await seedCopy(stale.rewrittenOldEntry, ID.biz, backfillCopy('goals', `${P}${tag}_rewritten`, `${tag}-STALE-OLD: selling the second shop`), rewritten.id);
  await seedCopy(stale.rewrittenOldValue, ID.biz, `${tag}-STALE-OLD: selling the second shop`, rewritten.id);
  await seedCopy(stale.orphan, ID.biz, backfillCopy('goals', `${P}${tag}_gone`, `${tag}-STALE-ORPHAN: a goal deleted last year`), `${P}${tag}_mem_gone`);
  // A copy in this business naming the other business's row: its row is not in this business.
  await seedCopy(stale.otherBusinessRow, ID.biz, backfillCopy('goals', `${P}${tag}_other`, `${tag}-OTHER-ROW: a goal of the other business`), otherRow.id);
  // The other business's own stale copy: a run scoped to ID.biz leaves it.
  const otherStale = `${P}${tag}_e_other_biz_orphan`;
  await seedCopy(otherStale, ID.other, backfillCopy('goals', `${P}${tag}_gone`, `${tag}-OTHER-BIZ-ORPHAN: deleted`), `${P}${tag}_mem_gone_other`);
  return { valid, stale, otherStale, rows: { live, rewritten, expired } };
}

describe('FU-MEMORY-COPIES-REWRITE: the cleanup command removes the stale copies left before this packet', () => {
  it("V71I-07 main(): the dry run (the default) lists every stale copy of the business by id and reason (row_gone, value_rewritten) and its counts, prints no copy's content, and deletes nothing; its stale set is exactly the 'memory' copies search does not serve, less the expired row's; --apply deletes exactly those, leaves the valid copies, the expired row's copy, the document chunk and the other business's copies; a second --apply deletes nothing; bad arguments exit 2", async () => {
    const app = await memoryApp();
    try {
      const { main } = await import('../scripts/cleanup-stale-memory-copies');
      const seeded = await seedHistory(app, 'V71I-07');
      const staleIds = Object.values(seeded.stale).sort();
      const before = await memoryCopyIds();

      // What search serves: the valid copies of live, non-expired rows (and the document chunk).
      const served = await app.api.searchIds(ID.member);
      const memoryServed = served.filter((id) => id !== seeded.valid.document);
      expect(memoryServed).toEqual([seeded.valid.liveEntry, seeded.valid.liveValue, seeded.valid.rewrittenNow].sort());

      const out: string[] = [];
      const err: string[] = [];
      const log = (...a: unknown[]) => out.push(a.join(' '));
      const error = (...a: unknown[]) => err.push(a.join(' '));
      expect(await main([`--business=${ID.biz}`], { db, log, error }), err.join('\n')).toBe(0);
      const dry = out.join('\n');
      expect(dry).toMatch(/DRY RUN/);
      expect(dry).toMatch(/stale_row_gone\s+2\b/);
      expect(dry).toMatch(/stale_value_rewritten\s+2\b/);
      expect(dry).toMatch(/would_delete\s+4\b/);
      for (const id of [seeded.stale.orphan, seeded.stale.otherBusinessRow]) expect(dry).toMatch(new RegExp(`${id}\\s+row_gone`));
      for (const id of [seeded.stale.rewrittenOldEntry, seeded.stale.rewrittenOldValue]) expect(dry).toMatch(new RegExp(`${id}\\s+value_rewritten`));
      for (const id of Object.values(seeded.valid)) expect(dry).not.toContain(id);
      expect(dry, 'no content is printed').not.toMatch(/V71I-07-/);
      expect(await memoryCopyIds(), 'the dry run deletes nothing').toEqual(before);

      // The script's stale set is the complement of what search serves, less the expired row's copy (search hides it
      // while its row is expired; it still holds what its row holds, so it is not stale).
      const listed = staleIds.filter((id) => dry.includes(id));
      expect(listed).toEqual(staleIds);
      expect(before.filter((id) => !memoryServed.includes(id) && id !== seeded.valid.expired).sort()).toEqual(staleIds);

      out.length = 0;
      expect(await main(['--apply', `--business=${ID.biz}`], { db, log, error }), err.join('\n')).toBe(0);
      expect(out.join('\n')).toMatch(/deleted\s+4\b/);
      expect(out.join('\n')).not.toMatch(/V71I-07-/);
      expect(await memoryCopyIds()).toEqual(
        [seeded.valid.liveEntry, seeded.valid.liveValue, seeded.valid.rewrittenNow, seeded.valid.expired].sort(),
      );
      expect(await atRest('V71I-07-STALE')).toBe(0);
      expect(await atRest('V71I-07-DOCUMENT'), 'the document chunk').toBe(1);
      expect(await memoryCopyIds(ID.other), "the other business's stale copy is outside the run").toEqual([seeded.otherStale]);
      expect(await app.api.searchIds(ID.member)).toEqual(served);

      out.length = 0;
      expect(await main(['--apply', `--business=${ID.biz}`], { db, log, error })).toBe(0);
      expect(out.join('\n')).toMatch(/deleted\s+0\b/);
      out.length = 0;
      expect(await main([`--business=${ID.biz}`], { db, log, error })).toBe(0);
      expect(out.join('\n')).toMatch(/would_delete\s+0\b/);

      err.length = 0;
      expect(await main(['--bogus'], { db, log, error })).toBe(2);
      expect(await main(['--business='], { db, log, error })).toBe(2);
      expect(err.join('\n')).toMatch(/Bad arguments/);
    } finally {
      await app.close();
    }
  }, 60_000);

  it('V71I-08 `pnpm cleanup:memory-copies` (the package.json command, run as pnpm runs it from apps/server with only DATABASE_URL): the dry run exits 0 listing the stale copies, then `--apply` removes them; the database URL is never printed', async () => {
    const app = await memoryApp();
    try {
      const seeded = await seedHistory(app, 'V71I-08');
      const scripts: Record<string, string> = JSON.parse(readFileSync(path.join(SERVER_DIR, 'package.json'), 'utf8')).scripts;
      const command = scripts['cleanup:memory-copies'];
      expect(command, 'apps/server/package.json has a cleanup:memory-copies script').toBeTruthy();
      const DATABASE_URL = process.env.DATABASE_URL ?? '';
      const env: NodeJS.ProcessEnv = {
        PATH: [path.join(SERVER_DIR, 'node_modules', '.bin'), path.join(SERVER_DIR, '..', '..', 'node_modules', '.bin'), process.env.PATH ?? ''].join(':'),
        HOME: process.env.HOME ?? '/tmp',
        TMPDIR: process.env.TMPDIR ?? '/tmp',
        DATABASE_URL,
      };
      const run = (args: string) =>
        new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
          const child = spawn('sh', ['-c', `${command} ${args}`], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
          let out = '';
          let err = '';
          const timer = setTimeout(() => child.kill('SIGKILL'), 110_000);
          child.stdout.setEncoding('utf8').on('data', (s: string) => (out += s));
          child.stderr.setEncoding('utf8').on('data', (s: string) => (err += s));
          child.once('error', reject);
          child.once('close', (code) => {
            clearTimeout(timer);
            resolve({ code, out, err });
          });
        });

      const dry = await run(`--business=${ID.biz}`);
      const dryAll = `${dry.out}\n${dry.err}`;
      expect(dry.code, dryAll).toBe(0);
      expect(dry.out, dryAll).toMatch(/DRY RUN/);
      expect(dry.out).toMatch(/would_delete\s+4\b/);
      for (const id of Object.values(seeded.stale)) expect(dry.out).toContain(id);
      expect(dryAll).not.toMatch(/TypeError|Cannot read properties of undefined/);
      if (DATABASE_URL) expect(dryAll).not.toContain(DATABASE_URL);
      expect(await atRest('V71I-08-STALE'), 'the dry run deletes nothing').toBe(3);

      const applied = await run(`--apply --business=${ID.biz}`);
      const appliedAll = `${applied.out}\n${applied.err}`;
      expect(applied.code, appliedAll).toBe(0);
      expect(applied.out).toMatch(/deleted\s+4\b/);
      if (DATABASE_URL) expect(appliedAll).not.toContain(DATABASE_URL);
      expect(await atRest('V71I-08-STALE')).toBe(0);
      expect(await atRest('V71I-08-OTHER-ROW'), "the copy naming the other business's row").toBe(0);
      expect(await memoryCopyIds(ID.other)).toEqual([seeded.otherStale]);
    } finally {
      await app.close();
    }
  }, 180_000);
});

// ---------------------------------------------------------------------------
// 3. Static: every AiMemory rewrite goes through the door
// ---------------------------------------------------------------------------

const SRC = path.resolve(__dirname, '../src');
/** The door every AiMemory upsert goes through, and the file it lives in. */
const DOOR = { file: 'modules/ai/ai-memory.service.ts', fn: 'upsertAiMemoryDroppingStaleCopies' };
/**
 * The named exceptions: the settings rows (configuration JSON, not memory). ModelGatewayService's two writes are
 * pinned by model-gateway.service.spec.ts, a suite the Release 0 manifest optional-services-fail-visibly binds (every
 * case required), which mocks the client's aiMemory.upsert; AiOversightService's by ai-oversight-fails-closed.spec.ts.
 * A settings row has no semantic copy for a rewrite to leave behind (review SEC-FUMCR-1, COR-V71I-2: no copy of it is
 * made or served, V71I-13; the cleanup command deletes the ones made before, V71I-14).
 */
const SETTINGS_WRITERS: Record<string, string[]> = {
  'modules/ai/model-gateway.service.ts': ['updatePreferences', 'updateRoutingConfig'],
  'modules/ai/ai-oversight.service.ts': ['updateAutonomySettings'],
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      out.push(...sourceFiles(full));
    } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Every AiMemory write that can rewrite a row in production source: `<client>.aiMemory.upsert|update|updateMany(...)` and raw `UPDATE ai_memories` / `INSERT INTO ai_memories`. */
function aiMemoryRewrites(): Array<{ site: string; file: string; fn: string | undefined }> {
  const out: Array<{ site: string; file: string; fn: string | undefined }> = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('aiMemory') && !/ai_memories/i.test(text)) continue;
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const enclosing = (node: ts.Node): string | undefined => {
      for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
        if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name && ts.isIdentifier(n.name)) return n.name.text;
      }
      return undefined;
    };
    const site = (node: ts.Node, what: string) => `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${what}`;
    const visit = (node: ts.Node) => {
      // `this.aiMemory` is an injected AiMemoryService (UnifiedMemoryWriterService's), whose upsert writes through the
      // door; a Prisma delegate is reached through a client (`this.prisma.client.aiMemory`, `tx.aiMemory`).
      const isModel =
        ((ts.isPropertyAccessExpression(node) && node.name.text === 'aiMemory') ||
          (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === 'aiMemory')) &&
        node.expression.kind !== ts.SyntaxKind.ThisKeyword;
      if (isModel) {
        const member = node.parent;
        const method =
          member && ts.isPropertyAccessExpression(member) && member.expression === node
            ? member.name.text
            : member && ts.isElementAccessExpression(member) && member.expression === node && ts.isStringLiteralLike(member.argumentExpression)
              ? member.argumentExpression.text
              : undefined;
        if (method === 'upsert' || method === 'update' || method === 'updateMany') {
          out.push({ site: site(node, `aiMemory.${method}`), file: rel, fn: enclosing(node) });
        }
      }
      if ((ts.isStringLiteralLike(node) || ts.isTemplateLiteral(node)) && /(update\s+"?(public"?\."?)?ai_memories\b|insert\s+into\s+"?(public"?\."?)?ai_memories\b)/i.test(node.getText(sf))) {
        out.push({ site: site(node, 'raw ai_memories write'), file: rel, fn: undefined });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

describe('FU-MEMORY-COPIES-REWRITE static: every AiMemory rewrite in apps/server/src goes through upsertAiMemoryDroppingStaleCopies', () => {
  it('V71I-09 finds the door (the scan is not empty) and no AiMemory upsert or update outside it but the named settings writers, each of which is still there: AiMemoryService.upsert, ProactiveSuggestionService and MemoryConsolidationService.promoteFacts write through it', () => {
    const writes = aiMemoryRewrites();
    const inDoor = writes.filter((w) => w.file === DOOR.file && w.fn === DOOR.fn);
    expect(inDoor.length, 'the door writes AiMemory rows').toBeGreaterThan(0);
    const settings = writes.filter((w) => (SETTINGS_WRITERS[w.file] ?? []).includes(w.fn ?? ''));
    const outside = writes.filter((w) => !inDoor.includes(w) && !settings.includes(w));
    expect(outside.map((w) => w.site)).toEqual([]);
    // The exceptions are exact: each named writer still writes (one upsert each), so the list cannot outlive them.
    const named = Object.entries(SETTINGS_WRITERS).flatMap(([file, fns]) => fns.map((fn) => `${file} ${fn}`)).sort();
    expect(settings.map((w) => `${w.file} ${w.fn}`).sort()).toEqual(named);
  });
});

/** Every call of the door in production source: its site, its enclosing function and how many arguments it passes. */
function doorCalls(): Array<{ site: string; fn: string | undefined; args: ts.NodeArray<ts.Expression> }> {
  const out: Array<{ site: string; fn: string | undefined; args: ts.NodeArray<ts.Expression> }> = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes(DOOR.fn)) continue;
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const enclosing = (node: ts.Node): string | undefined => {
      for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
        if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name && ts.isIdentifier(n.name)) return n.name.text;
      }
      return undefined;
    };
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
        if (name === DOOR.fn) {
          out.push({ site: `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`, fn: enclosing(node), args: node.arguments });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

describe('FU-MEMORY-COPIES-REWRITE review repair, static: every writer through the door copies the row it rewrote again', () => {
  it('V71I-15 (COR-V71I-3) every call of upsertAiMemoryDroppingStaleCopies in apps/server/src passes it the re-copier (its fifth argument, not undefined): AiMemoryService.upsert, ProactiveSuggestionService.generateSuggestions and blockCategory, and MemoryConsolidationService.promoteFacts (applyTuningAdjustment deleted in RR-SELFTUNE-CANDIDATE-ONLY)', () => {
    const calls = doorCalls();
    expect(calls.map((c) => c.fn).sort()).toEqual(
      expect.arrayContaining(['blockCategory', 'generateSuggestions', 'promoteFacts', 'upsert']),
    );
    expect(calls.map((c) => c.fn)).not.toContain('applyTuningAdjustment');
    const withoutRecopier = calls.filter((c) => {
      const recopier = c.args[4];
      return !recopier || recopier.kind === ts.SyntaxKind.UndefinedKeyword || (ts.isIdentifier(recopier) && recopier.text === 'undefined');
    });
    expect(withoutRecopier.map((c) => `${c.site} ${c.fn}`), 'door calls that do not pass the re-copier').toEqual([]);
  });
});
