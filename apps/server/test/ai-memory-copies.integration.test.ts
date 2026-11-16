/**
 * W1F-MEMORY-COPIES (V1-70): every deletion of an AiMemory row also removes its semantic copies in
 * ai_memory_embeddings, a backfill cannot write a copy of a row that is gone, and memory consolidation's
 * promotion cuts on a code point and runs after the withdrawal (REAL database).
 *
 * The W11-MEMORY-PROMOTE-SCOPE review residuals (wave 1), each reproduced here on the real database:
 *
 *   1. An AiMemory row has semantic copies in ai_memory_embeddings (source_type 'memory', source_id the row's id):
 *      POST /ai/businesses/:id/agent/memory/backfill (SemanticMemoryService.backfillFromAiMemory, which any member may
 *      send) writes one per row, UnifiedMemoryWriterService.store writes one with indexSemantic. Every member reads
 *      them back: GET .../agent/memory/search, and KEY's memory block as [ai_memory_embedding]
 *      (UnifiedMemoryRetrievalService.loadSemanticMemory, through buildMemoryContext and chatMemoryFragments). Only the
 *      consolidation's withdrawal removed a row's copies. Every other deletion left them, served:
 *        - AiMemoryService.remove (DELETE /ai/businesses/:id/ai/memory/:category/:key), and
 *          UnifiedMemoryWriterService.remove, which calls it (KeyCortexDocumentService.deleteDocument);
 *        - AiMemoryService.removeCategory;
 *        - ProactiveSuggestionService.dismissSuggestion's deleteMany (POST .../ai/suggestions/:id/dismiss);
 *        - MemoryConsolidationService.resolveConflicts' delete.
 *      SemanticMemoryService.deleteForSource had no caller. Every deletion now goes through one door
 *      (deleteAiMemoriesWithCopies in ai-memory.service.ts): the rows, then their copies, in one transaction.
 *      A static case holds every AiMemory delete in apps/server/src to that door (resolveConflicts' delete cannot be
 *      reached on a real database: ai_memories is unique on business, category and key, so its groups hold one row).
 *      Copies an earlier deletion left behind (existing data) are not served: search serves a 'memory' copy only
 *      while its row is still served (it exists in the business and has not expired).
 *   2. The backfill race: backfillFromAiMemory read the rows, made each copy's embedding (a provider call), then
 *      inserted the copy whatever had happened to the row since. A row deleted in between (a member's DELETE, the
 *      consolidation's withdrawal) got a copy written after it was gone, served to every member. The copy is now
 *      inserted only while its row still holds what was read, under a lock on the row: a deletion that has deleted
 *      the row but not committed holds the insert until it commits, and then nothing is inserted.
 *   3. promoteFacts cut a recommendation at 500 UTF-16 units. An emoji across the cut left a lone surrogate,
 *      Prisma refused the write, and run() stopped before withdrawMemberPromotions, so a member's leaked promotion
 *      stayed served. The cut is now on a code point, and the withdrawal runs first.
 *
 * The packet's review repair (wave 1 review of W1F-MEMORY-COPIES):
 *   4. SEC-W1FMC-1: a row rewritten in place keeps its id (PUT .../ai/memory with the same category and key, a document
 *      extracted again, a promotion into the same key), so a copy of its old value still named a live row and search
 *      served it to every member, as did KEY's memory block. And UnifiedMemoryWriterService.store's own copy (made
 *      after its write, a provider call later) was inserted whatever the row held by then. A copy is now served, and
 *      written, only while it holds what its row holds (V70B-13, V70B-14).
 *   5. COR-W1FMC-1 / SEC-W1FMC-2: the door read the rows it deletes with findMany, which @keyflow/db caps at 1000
 *      (defaultTakeExtension, inside a transaction too), and deleted only those: a deletion matching more left the rest,
 *      served with their copies. The door now deletes every matching row (V70B-12).
 *
 * WHAT IS REAL: the database (PrismaService, the Prisma client, pgvector), the HTTP routes on the real AiController
 * (GET/PUT/DELETE .../ai/memory, POST .../ai/suggestions/refresh and .../dismiss) behind its real AuthGuard,
 * BusinessGuard and CrmRateLimitGuard, and on the real AgentController (POST .../agent/memory/backfill, GET
 * .../agent/memory/search) behind AuthGuard and BusinessGuard; AiMemoryService, SemanticMemoryService,
 * ProactiveSuggestionService, UnifiedMemoryWriterService, MemoryConsolidationService, and the memory block
 * (KeyCortexPromptContextService.buildMemoryContext over UnifiedMemoryRetrievalService).
 * Stand-ins: identity attachment (a middleware reads `x-v70b-user` and attaches the seeded user, as the
 * Supabase-verifying AuthMiddleware would); the embedding provider (AiUsageService.trackEmbedding answers one fixed
 * unit vector, so every copy matches every query; it may hold one text back to open a race); the suggestion scan's
 * insight source (ProAutoMonitorService.scanInsights) and autonomy mode; the controllers' collaborators for routes
 * no case calls. globalThis.fetch is a tap that refuses and records every outbound request: none is made.
 *
 * Every seeded row carries the `v70b_` prefix (users, businesses, memory keys, cognition sessions and functions) and
 * is hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll; ai_memory_embeddings rows go with
 * their business.
 */
import 'reflect-metadata';
import path from 'path';
import { readdirSync, readFileSync, statSync } from 'fs';
import * as ts from 'typescript';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v70b_';

const ID = {
  /** The business owner (OWNER membership, D-104). */
  owner: `${P}owner`,
  /** A STAFF member of ID.biz. */
  member: `${P}member`,
  biz: `${P}biz`,
  /** A second business of ID.owner: a deletion in ID.biz leaves its rows and copies alone. */
  other: `${P}biz_other`,
};

/** Every embedding is this one vector, so every copy matches any query at similarity 1. */
const UNIT_VECTOR = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
const QUESTION = 'what should I know about this business?';

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
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** The business's AI memory and its copies, emptied between cases (the users, businesses and memberships stay). */
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
    throw new Error('v70b: no outbound traffic in this suite');
  }) as typeof fetch;

  await cleanup(); // in case a prior run aborted
  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.member, email: `${P}member@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'V70B Memory Copies Biz', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.other, name: 'V70B Other Biz', ownerId: ID.owner } });
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
interface Hold {
  /** The embedded text that is held (the first that contains it). */
  match: string;
  reached: Promise<void>;
  release: () => void;
}
function hold(match: string): Hold & { arm: (text: string) => Promise<void> } {
  let reachedFn: () => void = () => undefined;
  let releaseFn: () => void = () => undefined;
  const reached = new Promise<void>((resolve) => (reachedFn = resolve));
  const released = new Promise<void>((resolve) => (releaseFn = resolve));
  let armed = true;
  return {
    match,
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
 * The HTTP routes, the real services behind them and the embedding stand-in. `holds` may name texts whose embedding
 * call waits until released (the window between a backfill's read of a row and its write of the row's copy).
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
  const { ProactiveSuggestionService } = await import('../src/modules/ai/proactive-suggestion.service');
  const { UnifiedMemoryWriterService } = await import('../src/modules/key-cortex/unified-memory-writer.service');

  const holds: Array<ReturnType<typeof hold>> = [];
  const embedded: string[] = [];
  const usage = {
    trackEmbedding: async (_businessId: string, _userId: unknown, _operation: string, texts: string[]) => {
      for (const text of texts) {
        embedded.push(text);
        for (const h of holds) await h.arm(text);
      }
      return texts.map(() => UNIT_VECTOR);
    },
  };
  const semantic = new SemanticMemoryService(prisma, new EventEmitter2(), usage as any);
  // getAll, upsert, remove and removeCategory read and write the database only; the execution log and the
  // blueprint serve other methods.
  const memory = new AiMemoryService(prisma, {} as any, {} as any);
  const writer = new UnifiedMemoryWriterService(memory, semantic);
  // The suggestion scan: one stale-leads insight, in a mode that suggests (generateSuggestions writes the row).
  const insightText = { current: 'V70B-SUGGESTION: nobody has called these leads' };
  const monitor = {
    scanInsights: async () => [
      {
        id: `${P}insight`,
        category: 'stale_leads',
        severity: 'warning',
        title: 'Stale leads',
        description: insightText.current,
        riskTier: 1,
        module: 'crm',
        timestamp: new Date().toISOString(),
      },
    ],
  };
  const governance = { getAutonomySettings: async () => ({ mode: 'pro_auto' }) };
  const suggestions = new ProactiveSuggestionService(prisma, monitor as any, governance as any, new EventEmitter2());

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
    const id = req.headers['x-v70b-user'];
    if (typeof id === 'string' && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  http.useGlobalFilters(new GlobalHttpExceptionFilter());
  await http.init();
  const server = http.getHttpServer();

  const api = {
    /** PUT /ai/businesses/:id/ai/memory: the row the route answers. */
    put: async (userId: string, entry: { category: string; key: string; value: string }, businessId = ID.biz) => {
      const res = await request(server).put(`/ai/businesses/${businessId}/ai/memory`).set('x-v70b-user', userId).send(entry);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.memory as { id: string; category: string; key: string; value: string };
    },
    /** DELETE /ai/businesses/:id/ai/memory/:category/:key: the route's `deleted`. */
    del: async (userId: string, category: string, key: string, businessId = ID.biz) => {
      const res = await request(server)
        .delete(`/ai/businesses/${businessId}/ai/memory/${encodeURIComponent(category)}/${encodeURIComponent(key)}`)
        .set('x-v70b-user', userId);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.deleted as boolean;
    },
    /** GET /ai/businesses/:id/ai/memory: every value the route answers that member. */
    memories: async (userId: string, businessId = ID.biz) => {
      const res = await request(server).get(`/ai/businesses/${businessId}/ai/memory`).set('x-v70b-user', userId);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return (res.body.memories as Array<{ value: string }>).map((m) => m.value).join('\n');
    },
    /** POST .../agent/memory/backfill: the number of copies the route says it wrote. */
    backfill: async (userId: string, businessId = ID.biz) => {
      const res = await request(server).post(`/ai/businesses/${businessId}/agent/memory/backfill`).set('x-v70b-user', userId);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.backfilled as number;
    },
    /** GET .../agent/memory/search: the contents the route answers that member, one per line. */
    search: async (userId: string, q = QUESTION, businessId = ID.biz) => {
      const res = await request(server)
        .get(`/ai/businesses/${businessId}/agent/memory/search`)
        .query({ q, limit: '50' })
        .set('x-v70b-user', userId);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return (res.body.results as Array<{ content: string }>).map((r) => r.content).join('\n');
    },
    /** POST .../ai/suggestions/refresh: the suggestions the scan wrote. */
    refreshSuggestions: async (userId: string) => {
      const res = await request(server).post(`/ai/businesses/${ID.biz}/ai/suggestions/refresh`).set('x-v70b-user', userId);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.suggestions as Array<{ id: string; message: string }>;
    },
    /** POST .../ai/suggestions/:id/dismiss. */
    dismiss: async (userId: string, suggestionId: string) => {
      const res = await request(server)
        .post(`/ai/businesses/${ID.biz}/ai/suggestions/${encodeURIComponent(suggestionId)}/dismiss`)
        .set('x-v70b-user', userId);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body).toEqual({ dismissed: true });
    },
  };
  return {
    api,
    semantic,
    memory,
    writer,
    embedded,
    /** Hold the embedding call of the first text that contains `match` (one backfill's write of that copy). */
    holdEmbedding: (match: string) => {
      const h = hold(match);
      holds.push(h);
      return h;
    },
    close: () => http.close(),
  };
}

/**
 * The memory block KEY's chat renders for `userId` (buildMemoryContext over the real stores), asked `QUESTION` so its
 * semantic search runs: the fragment lines of the business's semantic copies ([ai_memory_embedding]).
 */
async function semanticBlockFor(userId: string, semantic: unknown, businessId = ID.biz): Promise<string> {
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
  return block
    .split('\n')
    .filter((l) => l.includes('[ai_memory_embedding]'))
    .join('\n');
}

/** The contents of the copies whose source_id names `rowId` (any business), in code-unit order (not the database collation's). */
const copiesOf = async (rowId: string): Promise<string[]> =>
  (
    await db.$queryRawUnsafe(
      `SELECT content FROM ai_memory_embeddings WHERE source_type = 'memory' AND source_id = $1`,
      rowId,
    )
  )
    .map((r: { content: string }) => r.content)
    .sort();

/** The distinct contents of a business's 'memory' copies, in code-unit order. */
const memoryCopies = async (businessId = ID.biz): Promise<string[]> =>
  (
    await db.$queryRawUnsafe(
      `SELECT DISTINCT content FROM ai_memory_embeddings WHERE business_id = $1 AND source_type = 'memory'`,
      businessId,
    )
  )
    .map((r: { content: string }) => r.content)
    .sort();

/** The content backfillFromAiMemory writes for a row. */
const backfillCopy = (category: string, key: string, value: string) => `${category}: ${key} = ${value}`;

/** The statements waiting on a lock right now, in this database. */
const lockWaits = async (): Promise<string[]> =>
  (
    await db.$queryRawUnsafe(
      `SELECT query FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
    )
  ).map((r: { query: string }) => r.query);

/** Resolves true once `pred` holds over the statements waiting on a lock, false once `settled` has settled first or after `ms`. */
async function untilLockWait(pred: (query: string) => boolean, settled: { done: boolean }, ms = 8_000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if ((await lockWaits()).some(pred)) return true;
    if (settled.done) return false;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

const track = <T>(p: Promise<T>) => {
  const state = { done: false };
  const tracked = p.finally(() => {
    state.done = true;
  });
  return { promise: tracked, state };
};

// ---------------------------------------------------------------------------
// 1. Every deletion removes its copies
// ---------------------------------------------------------------------------

describe('W1F-MEMORY-COPIES: every AiMemory deletion removes its semantic copies', () => {
  it("V70B-01 DELETE /ai/businesses/:id/ai/memory/:category/:key removes the row's copies: the STAFF member's search and memory block stop serving the deleted value; another row's copy and another business's row of the same key keep theirs", async () => {
    const app = await memoryApp();
    try {
      const SECRET = 'V70B-01-SECRET: the owner is selling the second shop in March';
      const KEEP = 'V70B-01-KEEP: open Saturdays until noon';
      const OTHER = 'V70B-01-OTHER-BIZ: a goal of the other business';
      const secret = await app.api.put(ID.owner, { category: 'goals', key: `${P}goal_private`, value: SECRET });
      const keep = await app.api.put(ID.owner, { category: 'priorities', key: `${P}keep`, value: KEEP });
      // The same category and key in another business of the owner's.
      const other = await app.api.put(ID.owner, { category: 'goals', key: `${P}goal_private`, value: OTHER }, ID.other);

      // The STAFF member backfills the business's semantic memory; the owner backfills the other business's.
      expect(await app.api.backfill(ID.member)).toBe(2);
      expect(await app.api.backfill(ID.owner, ID.other)).toBe(1);
      expect(await copiesOf(secret.id)).toEqual([backfillCopy('goals', `${P}goal_private`, SECRET)]);
      expect(await app.api.search(ID.member), 'before the delete').toContain('V70B-01-SECRET');
      expect(await semanticBlockFor(ID.member, app.semantic), 'before the delete').toContain('V70B-01-SECRET');

      expect(await app.api.del(ID.owner, 'goals', `${P}goal_private`)).toBe(true);

      expect(await db.aiMemory.count({ where: { id: secret.id } })).toBe(0);
      expect(await copiesOf(secret.id), "the deleted row's copies").toEqual([]);
      expect(await copiesOf(keep.id), "another row's copy").toEqual([backfillCopy('priorities', `${P}keep`, KEEP)]);
      expect(await copiesOf(other.id), "the other business's copy of the same key").toEqual([
        backfillCopy('goals', `${P}goal_private`, OTHER),
      ]);
      const staffSearch = await app.api.search(ID.member);
      expect(staffSearch).not.toContain('V70B-01-SECRET');
      expect(staffSearch).toContain(KEEP);
      const staffBlock = await semanticBlockFor(ID.member, app.semantic);
      expect(staffBlock).not.toContain('V70B-01-SECRET');
      expect(staffBlock).toContain(KEEP);
      expect(await app.api.search(ID.owner, QUESTION, ID.other)).toContain(OTHER);
      expect(await app.api.memories(ID.member)).not.toContain('V70B-01-SECRET');

      // Deleting it again deletes nothing, and says so.
      expect(await app.api.del(ID.owner, 'goals', `${P}goal_private`)).toBe(false);
    } finally {
      await app.close();
    }
  }, 60_000);

  it("V70B-02 POST /ai/businesses/:id/ai/suggestions/:id/dismiss removes the suggestion row's copies: the dismissed suggestion is no longer served by search or the memory block", async () => {
    const app = await memoryApp();
    try {
      const [suggestion] = await app.api.refreshSuggestions(ID.owner);
      expect(suggestion?.message).toBe('V70B-SUGGESTION: nobody has called these leads');
      const rows = await db.aiMemory.findMany({ where: { businessId: ID.biz, category: 'suggestion' }, select: { id: true } });
      expect(rows).toHaveLength(1);
      const keep = await app.api.put(ID.owner, { category: 'priorities', key: `${P}keep`, value: 'V70B-02-KEEP: call back within a day' });

      expect(await app.api.backfill(ID.member)).toBe(2);
      expect((await copiesOf(rows[0].id)).join('\n')).toContain('V70B-SUGGESTION');
      expect(await app.api.search(ID.member), 'before the dismissal').toContain('V70B-SUGGESTION');

      await app.api.dismiss(ID.owner, suggestion.id);

      expect(await db.aiMemory.count({ where: { businessId: ID.biz, category: 'suggestion' } })).toBe(0);
      expect(await copiesOf(rows[0].id), "the dismissed suggestion's copies").toEqual([]);
      expect(await copiesOf(keep.id)).toHaveLength(1);
      expect(await app.api.search(ID.member)).not.toContain('V70B-SUGGESTION');
      expect(await semanticBlockFor(ID.member, app.semantic)).not.toContain('V70B-SUGGESTION');
    } finally {
      await app.close();
    }
  }, 60_000);

  it("V70B-03 AiMemoryService.removeCategory and UnifiedMemoryWriterService.remove (the real writer over the real memory service) remove their rows' copies: the writer's own copy (indexSemantic) and the backfill's; the rows of other categories keep theirs", async () => {
    const app = await memoryApp();
    try {
      const DOC = `${P}doc_payroll`;
      const EXTRACT = 'V70B-03-EXTRACT: payroll total 18400 for March';
      const PRIORITY_A = 'V70B-03-PRIORITY-A: chase the overdue invoices';
      const PRIORITY_B = 'V70B-03-PRIORITY-B: hire a second cashier';
      const KEEP = 'V70B-03-KEEP: the business tone is warm';
      // The writer stores the extraction and indexes it (its own copy: content the value).
      await app.writer.storeDocumentExtraction(ID.biz, DOC, EXTRACT, { indexSemantic: true });
      const a = await app.api.put(ID.owner, { category: 'priorities', key: `${P}priority_a`, value: PRIORITY_A });
      const b = await app.api.put(ID.owner, { category: 'priorities', key: `${P}priority_b`, value: PRIORITY_B });
      const keep = await app.api.put(ID.owner, { category: 'tone', key: 'preferred', value: KEEP });
      const extraction = await db.aiMemory.findFirstOrThrow({ where: { businessId: ID.biz, category: 'document_extraction', key: DOC } });
      expect(await copiesOf(extraction.id)).toEqual([EXTRACT]);

      expect(await app.api.backfill(ID.member)).toBe(4);
      expect(await copiesOf(extraction.id)).toEqual([backfillCopy('document_extraction', DOC, EXTRACT), EXTRACT].sort());
      const before = await app.api.search(ID.member);
      expect(before).toContain('V70B-03-EXTRACT');
      expect(before).toContain('V70B-03-PRIORITY-A');

      // KeyCortexDocumentService.deleteDocument's removal of a document's extraction.
      expect(await app.writer.remove(ID.biz, 'document_extraction', DOC)).toBe(true);
      expect(await copiesOf(extraction.id), "the extraction's copies").toEqual([]);

      expect(await app.memory.removeCategory(ID.biz, 'priorities')).toBe(2);
      expect(await copiesOf(a.id), "a removed category's copies").toEqual([]);
      expect(await copiesOf(b.id), "a removed category's copies").toEqual([]);
      expect(await copiesOf(keep.id), "another category's copy").toEqual([backfillCopy('tone', 'preferred', KEEP)]);

      const after = await app.api.search(ID.member);
      expect(after).not.toContain('V70B-03-EXTRACT');
      expect(after).not.toContain('V70B-03-PRIORITY');
      expect(after).toContain(KEEP);
      const block = await semanticBlockFor(ID.member, app.semantic);
      expect(block).not.toContain('V70B-03-EXTRACT');
      expect(block).not.toContain('V70B-03-PRIORITY');
    } finally {
      await app.close();
    }
  }, 60_000);

  it('V70B-04 existing data: a copy an earlier deletion left behind, and a copy of a row that has expired, are not served by search or the memory block; a live row\'s copy and a document chunk (not an AiMemory copy) still are', async () => {
    const app = await memoryApp();
    try {
      const LIVE = 'V70B-04-LIVE: the business sells wholesale on Tuesdays';
      const live = await app.api.put(ID.owner, { category: 'priorities', key: `${P}live`, value: LIVE });
      // A row that expired yesterday (a suggestion's 24 hours, a pattern's 7 days): no AiMemory reader serves it.
      const expired = await db.aiMemory.create({
        data: {
          businessId: ID.biz,
          category: 'patterns',
          key: `${P}expired`,
          value: 'V70B-04-EXPIRED: peak hour 3PM last month',
          source: 'pattern_analysis',
          expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      });
      expect(await app.api.backfill(ID.member)).toBe(2);
      expect(await copiesOf(expired.id)).toHaveLength(1);
      // What a deletion before this packet left: a copy whose row is gone.
      const vector = `[${UNIT_VECTOR.join(',')}]`;
      await db.$executeRawUnsafe(
        `INSERT INTO ai_memory_embeddings (id, business_id, content, source_type, source_id, embedding, metadata, created_at)
         VALUES ($1, $2, $3, 'memory', $4, $5::vector, '{}'::jsonb, NOW())`,
        `${P}emb_orphan`,
        ID.biz,
        backfillCopy('goals', `${P}gone`, 'V70B-04-ORPHAN: the owner deleted this goal last week'),
        `${P}mem_gone`,
        vector,
      );
      // A document chunk (KnowledgeIngestionService's copy of a knowledge source), not a copy of an AiMemory row.
      await db.$executeRawUnsafe(
        `INSERT INTO ai_memory_embeddings (id, business_id, content, source_type, source_id, embedding, metadata, created_at)
         VALUES ($1, $2, $3, 'document', $4, $5::vector, '{}'::jsonb, NOW())`,
        `${P}emb_doc`,
        ID.biz,
        'V70B-04-DOCUMENT: [price list chunk 1/1] delivery is free over 500',
        `${P}knowledge_1:0`,
        vector,
      );

      const search = await app.api.search(ID.member);
      expect(search).not.toContain('V70B-04-ORPHAN');
      expect(search).not.toContain('V70B-04-EXPIRED');
      expect(search).toContain(LIVE);
      expect(search).toContain('V70B-04-DOCUMENT');
      const block = await semanticBlockFor(ID.member, app.semantic);
      expect(block).not.toContain('V70B-04-ORPHAN');
      expect(block).not.toContain('V70B-04-EXPIRED');
      expect(block).toContain(LIVE);
      expect(await copiesOf(live.id)).toHaveLength(1);
    } finally {
      await app.close();
    }
  }, 60_000);

  it("V70B-12 a deletion matching more rows than @keyflow/db's 1000-row findMany cap (AiMemoryService.removeCategory of 1005 rows) deletes every one with its copies and answers 1005: GET .../ai/memory and search serve none of them; another category's row and the other business's row of the category keep theirs (COR-W1FMC-1, SEC-W1FMC-2)", async () => {
    const app = await memoryApp();
    try {
      const N = 1005;
      const KEEP = 'V70B-12-KEEP: the business tone is warm';
      const OTHER = 'V70B-12-OTHER-BIZ: a pattern of the other business';
      await db.aiMemory.createMany({
        data: Array.from({ length: N }, (_, i) => ({
          businessId: ID.biz,
          category: 'patterns',
          key: `${P}pattern_${String(i).padStart(4, '0')}`,
          value: `V70B-12-PATTERN ${i}: peak hour ${i % 24}`,
          source: 'pattern_analysis',
          confidence: 0.8,
        })),
      });
      const keep = await app.api.put(ID.owner, { category: 'priorities', key: `${P}keep`, value: KEEP });
      const other = await app.api.put(ID.owner, { category: 'patterns', key: `${P}pattern_other`, value: OTHER }, ID.other);
      // What backfills wrote over time (one backfill copies at most 500 rows): one copy of every row, in the backfill's
      // form, in both businesses.
      await db.$executeRawUnsafe(
        `INSERT INTO ai_memory_embeddings (id, business_id, content, source_type, source_id, embedding, metadata, created_at)
         SELECT $1 || 'emb_' || id, business_id, category || ': ' || key || ' = ' || value, 'memory', id, $2::vector, '{}'::jsonb, NOW()
         FROM ai_memories WHERE business_id IN ($3, $4)`,
        P,
        `[${UNIT_VECTOR.join(',')}]`,
        ID.biz,
        ID.other,
      );
      expect(await db.aiMemoryEmbedding.count({ where: { businessId: ID.biz, sourceType: 'memory' } })).toBe(N + 1);
      expect(await app.api.search(ID.member), 'before the deletion').toContain('V70B-12-PATTERN');

      expect(await app.memory.removeCategory(ID.biz, 'patterns'), 'every matching row').toBe(N);

      expect(await db.aiMemory.count({ where: { businessId: ID.biz, category: 'patterns' } }), 'rows left').toBe(0);
      expect(await memoryCopies(), "the business's copies left").toEqual([backfillCopy('priorities', `${P}keep`, KEEP)]);
      expect(await copiesOf(keep.id)).toHaveLength(1);
      expect(await copiesOf(other.id), "the other business's row of the category").toEqual([
        backfillCopy('patterns', `${P}pattern_other`, OTHER),
      ]);
      expect(await app.api.memories(ID.member)).not.toContain('V70B-12-PATTERN');
      const search = await app.api.search(ID.member);
      expect(search).not.toContain('V70B-12-PATTERN');
      expect(search).toContain(KEEP);
      expect(await semanticBlockFor(ID.member, app.semantic)).not.toContain('V70B-12-PATTERN');
      expect(await app.api.search(ID.owner, QUESTION, ID.other)).toContain(OTHER);
    } finally {
      await app.close();
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// 2. The backfill race
// ---------------------------------------------------------------------------

describe('W1F-MEMORY-COPIES: a backfill cannot write a copy of a row that is gone', () => {
  it("V70B-05 a backfill that read a row before the owner's DELETE writes no copy of it after: nothing is served, and the backfill counts only the copies it wrote", async () => {
    const app = await memoryApp();
    try {
      const RACE = 'V70B-05-RACE: the owner is closing the branch in Arima';
      const KEEP = 'V70B-05-KEEP: the business opens at eight';
      const race = await app.api.put(ID.owner, { category: 'goals', key: `${P}race`, value: RACE });
      const keep = await app.api.put(ID.owner, { category: 'priorities', key: `${P}keep`, value: KEEP });

      const held = app.holdEmbedding('V70B-05-RACE');
      const backfill = app.api.backfill(ID.member);
      await held.reached; // the backfill has read both rows; the race row's copy is not written yet
      expect(await app.api.del(ID.owner, 'goals', `${P}race`)).toBe(true);
      held.release();

      expect(await backfill, 'the backfill counts only the copies it wrote').toBe(1);
      expect(await copiesOf(race.id), 'no copy of the deleted row').toEqual([]);
      expect(await memoryCopies()).toEqual([backfillCopy('priorities', `${P}keep`, KEEP)]);
      expect(await copiesOf(keep.id)).toHaveLength(1);
      expect(await app.api.search(ID.member)).not.toContain('V70B-05-RACE');
      expect(await semanticBlockFor(ID.member, app.semantic)).not.toContain('V70B-05-RACE');
    } finally {
      await app.close();
    }
  }, 60_000);

  it('V70B-06 a backfill that read a row before PUT /ai/businesses/:id/ai/memory rewrote it writes no copy of the old value after: only the value the row holds is copied (by the next backfill)', async () => {
    const app = await memoryApp();
    try {
      const OLD = 'V70B-06-OLD: quote every job in USD';
      const NEW = 'V70B-06-NEW: quote every job in TTD';
      const row = await app.api.put(ID.owner, { category: 'preferences', key: `${P}currency`, value: OLD });

      const held = app.holdEmbedding('V70B-06-OLD');
      const backfill = app.api.backfill(ID.member);
      await held.reached;
      const rewritten = await app.api.put(ID.owner, { category: 'preferences', key: `${P}currency`, value: NEW });
      expect(rewritten.id).toBe(row.id); // the same row, rewritten in place
      held.release();

      expect(await backfill).toBe(0);
      expect(await copiesOf(row.id), 'no copy of the value the row no longer holds').toEqual([]);
      expect(await app.api.search(ID.member)).not.toContain('V70B-06-OLD');

      // Control: the next backfill copies what the row holds.
      expect(await app.api.backfill(ID.member)).toBe(1);
      expect(await copiesOf(row.id)).toEqual([backfillCopy('preferences', `${P}currency`, NEW)]);
      expect(await app.api.search(ID.member)).toContain('V70B-06-NEW');
    } finally {
      await app.close();
    }
  }, 60_000);

  it("V70B-07 a backfill's write that runs while the owner's DELETE has deleted the row but not yet committed waits for the deletion and then writes nothing: no copy survives the deletion", async () => {
    const app = await memoryApp();
    // The deletion's transaction deletes the row, then its copies. A test transaction holds a lock on the row's one
    // existing copy, so the deletion's copy delete waits on it with the row deleted and not committed: the window in
    // which the backfill's write runs here. The write must wait on the deleted row's lock and, once the deletion
    // commits, insert nothing (a write that read the row as still there would commit a copy the deletion's copy
    // delete, its snapshot already taken, never sees).
    let releaseLock: () => void = () => undefined;
    const lockReleased = new Promise<void>((resolve) => (releaseLock = resolve));
    let lockTx: Promise<unknown> | undefined;
    try {
      const RACE = 'V70B-07-RACE: the owner is buying out the partner';
      const race = await app.api.put(ID.owner, { category: 'goals', key: `${P}race_locked`, value: RACE });
      expect(await app.api.backfill(ID.member)).toBe(1);
      const [existing] = await db.aiMemoryEmbedding.findMany({ where: { businessId: ID.biz, sourceId: race.id }, select: { id: true } });
      expect(existing).toBeDefined();

      // A second backfill reads the row and is held before it writes the copy.
      const held = app.holdEmbedding('V70B-07-RACE');
      const backfill = track(app.api.backfill(ID.member));
      await held.reached;

      // Hold the existing copy's row lock.
      let locked: () => void = () => undefined;
      const lockTaken = new Promise<void>((resolve) => (locked = resolve));
      lockTx = db.$transaction(
        async (tx: any) => {
          await tx.$queryRawUnsafe(`SELECT id FROM ai_memory_embeddings WHERE id = $1 FOR UPDATE`, existing.id);
          locked();
          await lockReleased;
        },
        { timeout: 30_000, maxWait: 10_000 },
      );
      await lockTaken;

      // The owner's DELETE: its deletion of the copies waits on the held lock, the row deleted and not committed.
      const deletion = track(app.api.del(ID.owner, 'goals', `${P}race_locked`));
      const deletionWaits = await untilLockWait((q) => /delete/i.test(q) && q.includes('ai_memory_embeddings'), deletion.state);

      // The backfill writes the copy now: it must wait on the deleted row (it may not read it as still there).
      held.release();
      const writeWaits = await untilLockWait((q) => /insert/i.test(q) && q.includes('ai_memory_embeddings'), backfill.state);

      releaseLock();
      await lockTx;
      expect(await deletion.promise).toBe(true);
      const written = await backfill.promise;

      expect(await db.aiMemory.count({ where: { id: race.id } })).toBe(0);
      expect(await copiesOf(race.id), 'no copy survives the deletion').toEqual([]);
      expect(await app.api.search(ID.member)).not.toContain('V70B-07-RACE');
      expect(written, 'the held backfill wrote nothing').toBe(0);
      // How it got there: the deletion did delete its copies (and waited for the held one), and the write waited.
      expect(deletionWaits, "the deletion's copy delete waited on the held copy").toBe(true);
      expect(writeWaits, "the backfill's write waited on the deleted row").toBe(true);
    } finally {
      releaseLock();
      if (lockTx) await lockTx.catch(() => undefined);
      await app.close();
    }
  }, 60_000);

  it('V70B-08 a backfill racing the consolidation\'s withdrawal of a member\'s leaked promotion writes no copy of it after the withdrawal (W11-MEMORY-PROMOTE-SCOPE residual): the owner\'s answer is never served to the STAFF member', async () => {
    const app = await memoryApp();
    try {
      const { MemoryConsolidationService } = await import('../src/modules/key-cortex/memory-consolidation.service');
      const LEAK = 'V70B-08-LEAK: net profit 61200 after the owner draws salary';
      const fn = `${P}fn_leak`;
      // The owner's accepted cognition row and what the base's nightly promotion wrote from it.
      await db.cognitionMemory.create({
        data: { businessId: ID.biz, userId: ID.owner, sessionId: `${P}sess_leak`, functionId: fn, query: 'how are we doing?', recommendation: LEAK, userResponse: 'accepted', confidence: 0.95 },
      });
      const leaked = await db.aiMemory.create({
        data: { businessId: ID.biz, category: 'learning', key: `learned:${fn}`, value: LEAK, source: 'key_cortex_learning', confidence: 0.95 },
      });

      const held = app.holdEmbedding('V70B-08-LEAK');
      const backfill = app.api.backfill(ID.member);
      await held.reached;
      const result = await new MemoryConsolidationService(prisma).run(ID.biz);
      expect(result.withdrawn).toBe(1);
      held.release();

      expect(await backfill).toBe(0);
      expect(await copiesOf(leaked.id), 'no copy after the withdrawal').toEqual([]);
      expect(await memoryCopies()).toEqual([]);
      expect(await app.api.search(ID.member)).not.toContain('V70B-08-LEAK');
      expect(await semanticBlockFor(ID.member, app.semantic)).not.toContain('V70B-08-LEAK');
    } finally {
      await app.close();
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 2b. A row rewritten in place (review SEC-W1FMC-1)
// ---------------------------------------------------------------------------

describe('W1F-MEMORY-COPIES: a row rewritten in place serves only the value it holds now', () => {
  it("V70B-13 a row rewritten in place (PUT .../ai/memory with the same category and key: the same row, a new value; a document extracted again) stops serving the copies of its old value: the STAFF member's search and memory block serve only what the rows hold now (the backfill's copy and the writer's own copy alike); the next backfill's copies of the new values are served (SEC-W1FMC-1)", async () => {
    const app = await memoryApp();
    try {
      const OLD = 'V70B-13-OLD-SECRET: the owner is selling the second shop in March';
      const NEW = 'V70B-13-NEW: (removed)';
      const DOC = `${P}doc_rewritten`;
      const OLD_EXTRACT = 'V70B-13-OLD-EXTRACT: payroll total 18400 for March';
      const NEW_EXTRACT = 'V70B-13-NEW-EXTRACT: payroll total withheld';
      const row = await app.api.put(ID.owner, { category: 'goals', key: `${P}goal`, value: OLD });
      // The writer stores a document's extraction and indexes it (its own copy: content the value).
      await app.writer.storeDocumentExtraction(ID.biz, DOC, OLD_EXTRACT, { indexSemantic: true });
      const extraction = await db.aiMemory.findFirstOrThrow({ where: { businessId: ID.biz, category: 'document_extraction', key: DOC } });
      expect(await app.api.backfill(ID.member)).toBe(2);
      expect(await copiesOf(row.id)).toEqual([backfillCopy('goals', `${P}goal`, OLD)]);
      expect(await copiesOf(extraction.id)).toEqual([backfillCopy('document_extraction', DOC, OLD_EXTRACT), OLD_EXTRACT].sort());
      const before = await app.api.search(ID.member);
      expect(before, 'before the rewrite').toContain('V70B-13-OLD-SECRET');
      expect(before, 'before the rewrite').toContain('V70B-13-OLD-EXTRACT');

      // The owner rewrites the goal; the document is extracted again (not indexed this time).
      const rewritten = await app.api.put(ID.owner, { category: 'goals', key: `${P}goal`, value: NEW });
      expect(rewritten.id, 'the same row, rewritten in place').toBe(row.id);
      await app.writer.storeDocumentExtraction(ID.biz, DOC, NEW_EXTRACT);
      expect((await db.aiMemory.findUniqueOrThrow({ where: { id: extraction.id } })).value).toBe(NEW_EXTRACT);

      const memories = await app.api.memories(ID.member);
      expect(memories).toContain(NEW);
      expect(memories).not.toContain('V70B-13-OLD');
      for (const userId of [ID.member, ID.owner]) {
        expect(await app.api.search(userId), `${userId}: search after the rewrite`).not.toContain('V70B-13-OLD');
        expect(await semanticBlockFor(userId, app.semantic), `${userId}: memory block after the rewrite`).not.toContain('V70B-13-OLD');
      }

      // The next backfill copies what the rows hold, and those copies are served.
      expect(await app.api.backfill(ID.member)).toBe(2);
      const after = await app.api.search(ID.member);
      expect(after).toContain(backfillCopy('goals', `${P}goal`, NEW));
      expect(after).toContain(backfillCopy('document_extraction', DOC, NEW_EXTRACT));
      expect(after).not.toContain('V70B-13-OLD');
      expect(await semanticBlockFor(ID.member, app.semantic)).toContain('V70B-13-NEW-EXTRACT');
    } finally {
      await app.close();
    }
  }, 60_000);

  it("V70B-14 the writer's own copy (UnifiedMemoryWriterService.store with indexSemantic) of a value its row no longer holds is not written: an extraction whose embedding call is held while the document is extracted again writes no copy of its old value after; only the new value's copy is served (SEC-W1FMC-1)", async () => {
    const app = await memoryApp();
    try {
      const DOC = `${P}doc_raced`;
      const OLD = 'V70B-14-WRITER-OLD: payroll 18400';
      const NEW = 'V70B-14-WRITER-NEW: payroll withheld';
      const held = app.holdEmbedding('V70B-14-WRITER-OLD');
      const first = app.writer.storeDocumentExtraction(ID.biz, DOC, OLD, { indexSemantic: true });
      await held.reached; // the row holds OLD; the first extraction's copy is not written yet
      // The document is extracted again, and indexed: the row now holds NEW, with its copy.
      await app.writer.storeDocumentExtraction(ID.biz, DOC, NEW, { indexSemantic: true });
      held.release();
      expect((await first).value, 'the first extraction answers what it wrote').toBe(OLD);

      const row = await db.aiMemory.findFirstOrThrow({ where: { businessId: ID.biz, category: 'document_extraction', key: DOC } });
      expect(row.value).toBe(NEW);
      expect(await copiesOf(row.id), 'only the value the row holds is copied').toEqual([NEW]);
      const search = await app.api.search(ID.member);
      expect(search).not.toContain('V70B-14-WRITER-OLD');
      expect(search).toContain(NEW);
      expect(await semanticBlockFor(ID.member, app.semantic)).not.toContain('V70B-14-WRITER-OLD');
    } finally {
      await app.close();
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 3. Promotion: a code-point cut, and the withdrawal first
// ---------------------------------------------------------------------------

describe('W1F-MEMORY-COPIES: memory consolidation promotes on a code point and withdraws first', () => {
  const EMOJI = '\u{1F9FE}'; // 🧾, two UTF-16 units
  const cognition = (userId: string | null, functionId: string, recommendation: string, confidence = 1) => ({
    businessId: ID.biz,
    ...(userId ? { userId, sessionId: `${P}sess_${functionId}` } : { roleId: 'key_cortex' }),
    functionId,
    query: `${functionId}: what next?`,
    recommendation,
    userResponse: 'accepted',
    confidence,
  });
  /** What the base's nightly promotion wrote from a member's row (the leak an earlier run left). */
  const leakedPromotion = (functionId: string, value: string) => ({
    businessId: ID.biz,
    category: 'learning',
    key: `learned:${functionId}`,
    value,
    source: 'key_cortex_learning',
    confidence: 0.95,
  });
  const hasLoneSurrogate = (s: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

  it("V70B-09 a member-less recommendation with an emoji across the 500-unit cut is promoted cut before the emoji, and the same run withdraws a member's leaked promotion: run() completes and the STAFF member no longer reads the owner's answer", async () => {
    const { MemoryConsolidationService } = await import('../src/modules/key-cortex/memory-consolidation.service');
    const app = await memoryApp();
    try {
      const ACROSS = `${'a'.repeat(499)}${EMOJI} and the rest of the recommendation`; // the emoji at units 499-500
      const INSIDE = `${'b'.repeat(498)}${EMOJI} and more`; // the emoji at units 498-499, inside the cut
      const LEAK = 'V70B-09-LEAK: the owner plans to cut the delivery staff';
      await db.cognitionMemory.createMany({
        data: [
          cognition(null, `${P}fn_across`, ACROSS),
          // A member's whole answer of the same function that equals the member-less row's cut: the promoted value is
          // still the member-less row's, so it is not withdrawn (the withdrawal reads a 499-unit value as a cut too).
          cognition(ID.member, `${P}fn_across`, 'a'.repeat(499), 0.95),
          cognition(null, `${P}fn_inside`, INSIDE),
          cognition(ID.owner, `${P}fn_leak9`, LEAK, 0.95),
        ],
      });
      await db.aiMemory.create({ data: leakedPromotion(`${P}fn_leak9`, LEAK) });
      expect(await app.api.memories(ID.member), 'before the run').toContain('V70B-09-LEAK');

      const consolidation = new MemoryConsolidationService(prisma);
      const result = await consolidation.run(ID.biz);
      expect(result).toMatchObject({ promoted: 2, withdrawn: 1 });

      const learned = await db.aiMemory.findMany({
        where: { businessId: ID.biz, category: 'learning' },
        select: { key: true, value: true },
        orderBy: { key: 'asc' },
      });
      expect(learned.map((l: { key: string }) => l.key)).toEqual([`learned:${P}fn_across`, `learned:${P}fn_inside`]);
      const across = learned.find((l: { key: string }) => l.key === `learned:${P}fn_across`)!.value;
      const inside = learned.find((l: { key: string }) => l.key === `learned:${P}fn_inside`)!.value;
      expect(across).toBe('a'.repeat(499));
      expect(inside).toBe(`${'b'.repeat(498)}${EMOJI}`);
      expect(hasLoneSurrogate(across) || hasLoneSurrogate(inside)).toBe(false);
      expect(await app.api.memories(ID.member)).not.toContain('V70B-09-LEAK');

      // The next run keeps the member-less promotions as they are (their cut values are not taken for a member's, also
      // where a member's whole answer equals the cut).
      const again = await consolidation.run(ID.biz);
      expect(again).toMatchObject({ promoted: 2, withdrawn: 0 });
      expect(
        (await db.aiMemory.findMany({ where: { businessId: ID.biz, category: 'learning' }, select: { value: true }, orderBy: { key: 'asc' } })).map(
          (l: { value: string }) => l.value,
        ),
      ).toEqual(['a'.repeat(499), `${'b'.repeat(498)}${EMOJI}`]);
    } finally {
      await app.close();
    }
  }, 60_000);

  it("V70B-10 the withdrawal runs before the promotion: a run whose promotion fails has already withdrawn a member's leaked promotion and its copy", async () => {
    const { MemoryConsolidationService } = await import('../src/modules/key-cortex/memory-consolidation.service');
    const app = await memoryApp();
    try {
      const LEAK = 'V70B-10-LEAK: the owner is borrowing against the van';
      await db.cognitionMemory.createMany({
        data: [cognition(ID.owner, `${P}fn_leak10`, LEAK, 0.95), cognition(null, `${P}fn_nobody10`, 'crm.v70b_follow_up')],
      });
      const leaked = await db.aiMemory.create({ data: leakedPromotion(`${P}fn_leak10`, LEAK) });
      expect(await app.api.backfill(ID.member)).toBe(1);
      expect(await copiesOf(leaked.id)).toHaveLength(1);

      // The promotion's write fails (any refusal of the database: here a stand-in for aiMemory.upsert). Every other
      // call is the real client's.
      const refusingClient = new Proxy(prisma.client, {
        get(target: any, prop: string | symbol) {
          const value = Reflect.get(target, prop);
          if (prop !== 'aiMemory') return typeof value === 'function' ? value.bind(target) : value;
          return new Proxy(value, {
            get(model: any, method: string | symbol) {
              if (method === 'upsert') return async () => { throw new Error('v70b: the promotion write is refused'); };
              const m = Reflect.get(model, method);
              return typeof m === 'function' ? m.bind(model) : m;
            },
          });
        },
      });
      const consolidation = new MemoryConsolidationService({ client: refusingClient } as any);
      await expect(consolidation.run(ID.biz)).rejects.toThrow('v70b: the promotion write is refused');

      expect(await db.aiMemory.count({ where: { id: leaked.id } }), 'withdrawn before the promotion ran').toBe(0);
      expect(await copiesOf(leaked.id), "the leaked promotion's copy").toEqual([]);
      expect(await app.api.memories(ID.member)).not.toContain('V70B-10-LEAK');
      expect(await app.api.search(ID.member)).not.toContain('V70B-10-LEAK');
    } finally {
      await app.close();
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 4. Static: every AiMemory deletion goes through the door
// ---------------------------------------------------------------------------

const SRC = path.resolve(__dirname, '../src');
/** The door every AiMemory deletion goes through, and the file it lives in. */
const DOOR = { file: 'modules/ai/ai-memory.service.ts', fn: 'deleteAiMemoriesWithCopies' };

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

/** Every AiMemory deletion in production source: `<client>.aiMemory.delete|deleteMany(...)` and raw `DELETE FROM ai_memories`. */
function aiMemoryDeletions(): Array<{ site: string; inDoor: boolean }> {
  const out: Array<{ site: string; inDoor: boolean }> = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('aiMemory') && !/ai_memories/i.test(text)) continue;
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const enclosingFunction = (node: ts.Node): string | undefined => {
      for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
        if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
      }
      return undefined;
    };
    const site = (node: ts.Node, what: string) => `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${what}`;
    const visit = (node: ts.Node) => {
      const isModel =
        (ts.isPropertyAccessExpression(node) && node.name.text === 'aiMemory') ||
        (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === 'aiMemory');
      if (isModel) {
        const member = node.parent;
        const method =
          member && ts.isPropertyAccessExpression(member) && member.expression === node
            ? member.name.text
            : member && ts.isElementAccessExpression(member) && member.expression === node && ts.isStringLiteralLike(member.argumentExpression)
              ? member.argumentExpression.text
              : undefined;
        if (method === 'delete' || method === 'deleteMany') {
          out.push({ site: site(node, `aiMemory.${method}`), inDoor: rel === DOOR.file && enclosingFunction(node) === DOOR.fn });
        }
      }
      if ((ts.isStringLiteralLike(node) || ts.isTemplateLiteral(node)) && /delete\s+from\s+"?(public"?\."?)?ai_memories\b/i.test(node.getText(sf))) {
        out.push({ site: site(node, 'DELETE FROM ai_memories'), inDoor: false });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

describe('W1F-MEMORY-COPIES static: every AiMemory deletion in apps/server/src goes through deleteAiMemoriesWithCopies', () => {
  it('V70B-11 finds the door (the scan is not empty) and no AiMemory delete outside it: AiMemoryService.remove and removeCategory, ProactiveSuggestionService.dismissSuggestion, and MemoryConsolidationService.resolveConflicts and withdrawMemberPromotions all delete through it', () => {
    const deletions = aiMemoryDeletions();
    expect(deletions.filter((d) => d.inDoor).length, 'the door deletes AiMemory rows').toBeGreaterThan(0);
    expect(deletions.filter((d) => !d.inDoor).map((d) => d.site)).toEqual([]);
  });
});
