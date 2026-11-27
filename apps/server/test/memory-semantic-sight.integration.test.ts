/**
 * MEM-SEMANTIC-SIGHT (P0; owner rulings D-257 (KEY's memory design, its four scope fixes), D-234 (sales and money data
 * need revenue read; authorization follows provenance; ambiguity fails closed), D-227, D-238, D-100, D-128; journey K).
 *
 * Two surfaces served semantic memory (ai_memory_embeddings) to every reader with no reader projection: the flow chat's
 * "RELEVANT CONTEXT FROM MEMORY" section (FlowOrchestratorService.buildSemanticMemorySection, POST
 * /ai/businesses/:id/flow/chat and its stream) and GET /ai/businesses/:id/agent/memory/search (AuthGuard and
 * BusinessGuard only). A hit's text is whatever its source holds: a temporal-memory summary of an inbox thread about an
 * overdue invoice, a summary of payment events, a semantic copy of a document extraction, a knowledge-source chunk of a
 * statement. So an invoice amount reached a STAFF member whose revenue scope is none.
 *
 * GREEN: each hit is resolved to its source (sourceType, sourceId) and kept only when its source's rule admits the reader:
 * an AiMemory copy as its row (a document extraction needs a member reader with revenue read, MEM-DOC-EXTRACTION-SIGHT);
 * a temporal-memory summary by the modules of its entity, its source module and every source event, and revenue when a
 * source event or the summary's text is money (taint, design 8.2); a knowledge-source chunk needs a member reader with
 * revenue read (its source is unclassified: fail closed); a hit whose source cannot be resolved is served to nobody.
 * Withheld hits are dropped before the top-k cut: the blind reader's hits are identical whether the business holds 0 or
 * 20 revenue-derived hits ranked above theirs.
 *
 * And POST .../agent/memory/backfill (it copies every AiMemory row, document extractions included, into the semantic
 * store, spending the business's embedding credits) needs settings admin, as the connectors' backfills and the AI
 * preferences do (owners and admins by role defaults).
 *
 * Every write goes through its real writer on the real database: TemporalFlowService.emit and
 * TemporalFlowMemoryService.summarizeThread / summarizeContact (which embed through the real SemanticMemoryService),
 * AiMemoryService.upsert and SemanticMemoryService.backfillFromAiMemory, KnowledgeIngestionService.ingestText. Every read
 * goes through its real route: AgentController and AiFlowController behind their real guards, over the real
 * FlowOrchestratorService.chat / streamChat and the real SemanticMemoryService.
 *
 * Stand-ins: identity attachment (a middleware reads `x-v71u-user`), the embedding provider (a fixed vector per marker:
 * every query is e0, a revenue-derived hit is e0 (similarity 1, ranked first), the n-th ordinary hit has similarity
 * 0.95 - 0.01n), the model provider (records the system prompt), and the orchestrator's other context reads.
 * globalThis.fetch is a tap that refuses and records every outbound request: none is made.
 *
 * Fixture prefix v71u_ (MEM-SEMANTIC-SIGHT), cleaned with sqlLikePrefix().
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v71u_';
const HEADER = 'x-v71u-user';

const ID = {
  owner: `${P}owner`,
  /** STAFF, explicit scope map: crm and operations read, revenue and expenses 'none'. */
  blind: `${P}blind`,
  /** STAFF, explicit scope map: revenue and expenses read, crm and operations read. */
  revenue: `${P}revenue`,
  /** STAFF, explicit scope map: revenue read, expenses 'none' (review m4: an unclassified document is revenue and expenses). */
  revnoexp: `${P}revnoexp`,
  /** ADMIN by role defaults (settings admin). */
  admin: `${P}admin`,
  /** A platform SUPER_ADMIN with no membership: BusinessGuard admits them; no member reader (memberless). */
  root: `${P}root`,
  biz: `${P}biz`,
};
const m = (who: string) => `${P}m_${who.slice(P.length)}`;
const BLIND_SCOPES = {
  crm: 'read', bookings: 'read', projects: 'read', content: 'read', automations: 'read', storefront: 'read',
  analytics: 'read', operations: 'read', ai: 'read', team: 'read', expenses: 'none', revenue: 'none',
};
const REVENUE_SCOPES = { ...BLIND_SCOPES, revenue: 'read', expenses: 'read' };
const REVENUE_NO_EXPENSES_SCOPES = { ...BLIND_SCOPES, revenue: 'read' };

type Reader = 'owner' | 'blind' | 'revenue' | 'revnoexp' | 'root';
const BLIND_READERS: Reader[] = ['blind', 'root'];

/** Markers the stand-in embedding reads: a query, a revenue-derived source, a source that resolves to nothing. */
const QUERY = 'V71U-Q how is the business doing';
const REV = 'v71u-rev';
const ORPHAN = 'v71u-orphan';
const AMOUNT = '4812.37';
const okMarker = (n: number) => `V71U-OK-${n}`;

const saved = { fetch: globalThis.fetch };
/** Every text the stand-in embedding provider was handed. */
const embedCalls: string[] = [];
const outbound: string[] = [];

let db: any;
let prisma: any;
let http: any;
let semantic: any;
let memory: any;
let temporal: any;
let temporalMemory: any;
let knowledge: any;
let flow: { prompts: string[] };

const DIM = 1536;
const unit = (i: number) => Array.from({ length: DIM }, (_, k) => (k === i ? 1 : 0));
/** The stand-in embedding: e0 for a query and a revenue-derived or orphan source; cos 0.95 - 0.01n for okMarker(n). */
function embed(text: string): number[] {
  const t = text.toLowerCase();
  if (t.includes('v71u-q') || t.includes(REV) || t.includes(ORPHAN)) return unit(0);
  const ok = /v71u-ok-(\d+)/.exec(t);
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
    byBiz('team_activity_logs'),
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

/** Three inbox events on a thread (enough for the summary's confidence to reach the embedding threshold). */
async function inboxThread(threadId: string, title: string, extra: Record<string, unknown> = {}) {
  for (let i = 0; i < 3; i++) {
    await temporal.emit({
      businessId: ID.biz,
      source: 'key_inbox',
      type: 'key_inbox.message_received',
      module: 'key_inbox',
      title,
      threadId,
      importance: 'CRITICAL',
      genomeImpactPotential: true,
      ...extra,
    });
  }
}

/** The ordinary memory every reader with crm and operations read may see: a fact's copy and six inbox thread summaries. */
async function seedOrdinary() {
  await memory.upsert(ID.biz, { category: 'fact', key: `${P}fact`, value: `${okMarker(0)} we open at nine`, source: 'user' });
  await semantic.backfillFromAiMemory(ID.biz);
  for (let n = 1; n <= 6; n++) {
    await inboxThread(`${P}th_ok_${n}`, `${okMarker(n)} customer asked about opening hours`);
    await temporalMemory.summarizeThread(ID.biz, `${P}th_ok_${n}`);
  }
}

/**
 * `perKind` revenue-derived hits of each kind, all ranked above every ordinary hit: an inbox thread about an overdue
 * invoice (money by its text), a contact's payment events (money by its source events, not its text), a document
 * extraction's semantic copy, a knowledge-source chunk of a statement. And two hits whose source resolves to nothing: a
 * temporal summary whose row is gone, and an 'event' copy (no source of that type exists).
 */
async function seedRevenue(perKind: number) {
  for (let i = 0; i < perKind; i++) {
    await inboxThread(`${P}th_rev_${i}`, `${REV} Invoice INV-${i} for TTD ${AMOUNT} is overdue`);
    await temporalMemory.summarizeThread(ID.biz, `${P}th_rev_${i}`);

    const contactId = `${P}ct_rev_${i}`;
    for (let k = 0; k < 3; k++) {
      await temporal.emit({
        businessId: ID.biz, source: `${REV}_gw`, type: 'payment.received', module: 'payments', title: 'settled',
        contactId, importance: 'CRITICAL', genomeImpactPotential: true,
      });
    }
    await temporalMemory.summarizeContact(ID.biz, contactId);

    await memory.upsert(ID.biz, {
      category: 'document_extraction', key: `${P}doc_${i}`, value: JSON.stringify({ note: REV, total: Number(AMOUNT) }), source: 'inferred',
    });

    const ksTitle = `${REV} statement ${i}`;
    const ksContent = `Balance owed TTD ${AMOUNT}`;
    const sourceId = await knowledge.ingestText({ businessId: ID.biz, title: ksTitle, sourceType: 'document', content: ksContent });
    await semantic.store({
      businessId: ID.biz,
      content: `[${ksTitle} chunk 1/1]\n${ksContent}`,
      sourceType: 'document',
      sourceId: `${sourceId}:0`,
      metadata: { knowledgeSourceId: sourceId, title: ksTitle, sourceType: 'document', chunkIndex: 0 },
    });
  }
  // The backfill copies every row again: the fact's copy is dropped first, so the fact keeps exactly one (the blind
  // readers' hits then differ only if a withheld hit changed them).
  await db.aiMemoryEmbedding.deleteMany({ where: { businessId: ID.biz, sourceType: 'memory' } });
  await semantic.backfillFromAiMemory(ID.biz);
  expect(await db.aiMemoryEmbedding.count({ where: { businessId: ID.biz, content: { contains: 'V71U-OK-0' } } })).toBe(1);

  // Unresolvable sources.
  const orphanEvents = `${P}th_orphan`;
  await inboxThread(orphanEvents, `${ORPHAN} note`);
  const orphan = await temporalMemory.summarizeThread(ID.biz, orphanEvents);
  await db.temporalFlowMemory.delete({ where: { id: orphan.id } });
  await semantic.store({ businessId: ID.biz, content: `${ORPHAN} event copy`, sourceType: 'event', sourceId: `${P}ev_none` });

  const copies = await db.aiMemoryEmbedding.findMany({ where: { businessId: ID.biz }, select: { sourceType: true, content: true } });
  const rev = copies.filter((c: any) => c.content.toLowerCase().includes(REV));
  expect(rev.filter((c: any) => c.sourceType === 'temporal_memory'), 'premise: the summaries were embedded').toHaveLength(2 * perKind);
  expect(rev.filter((c: any) => c.sourceType === 'memory'), 'premise: the extractions were copied').toHaveLength(perKind);
  expect(rev.filter((c: any) => c.sourceType === 'document'), 'premise: the chunks were embedded').toHaveLength(perKind);
  expect(copies.filter((c: any) => c.content.toLowerCase().includes(ORPHAN))).toHaveLength(2);
}

/** Removes everything but the members: memory, copies, temporal rows, knowledge sources. */
async function clearMemory() {
  for (const table of ['ai_memory_embeddings', 'ai_memories', 'temporal_flow_memories', 'temporal_flow_events', 'knowledge_sources']) {
    await db.$executeRawUnsafe(`DELETE FROM ${table} WHERE business_id = $1`, ID.biz);
  }
}

const agent = () => request(http.getHttpServer());
let ip = 0;
const nextIp = () => `10.74.6.${(ip += 1) % 250}`;

/** GET .../agent/memory/search for `reader`: the hits' contents, in order. */
async function searchFor(reader: Reader, limit = 5): Promise<string[]> {
  const res = await agent()
    .get(`/ai/businesses/${ID.biz}/agent/memory/search`)
    .query({ q: QUERY, limit: String(limit) })
    .set(HEADER, ID[reader]);
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  return res.body.results.map((r: any) => String(r.content));
}

/** The "RELEVANT CONTEXT FROM MEMORY" section of the system prompt `reader`'s turn was handed (chat or stream). */
function semanticSection(prompt: string): string {
  const at = prompt.indexOf('RELEVANT CONTEXT FROM MEMORY:');
  if (at < 0) return '';
  const rest = prompt.slice(at);
  const lines = rest.split('\n');
  const out = [lines[0]];
  for (const line of lines.slice(1)) {
    if (!line.startsWith('- ')) break;
    out.push(line);
  }
  return out.join('\n');
}

async function chatSectionFor(reader: Reader): Promise<string> {
  flow.prompts.length = 0;
  const res = await agent()
    .post(`/ai/businesses/${ID.biz}/flow/chat`)
    .set(HEADER, ID[reader])
    .set('x-forwarded-for', nextIp())
    .send({ message: QUERY, history: [{ role: 'user', content: QUERY }] });
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  expect(flow.prompts, `one model call for ${reader}`).toHaveLength(1);
  return semanticSection(flow.prompts[0]);
}

async function streamSectionFor(reader: Reader): Promise<string> {
  flow.prompts.length = 0;
  const res = await agent()
    .post(`/ai/businesses/${ID.biz}/flow/chat/stream`)
    .set(HEADER, ID[reader])
    .set('x-forwarded-for', nextIp())
    .send({ message: QUERY })
    .buffer(true)
    .parse((r: any, cb: any) => {
      let text = '';
      r.setEncoding('utf8');
      r.on('data', (c: string) => { text += c; });
      r.on('end', () => cb(null, text));
    });
  expect(res.status).toBe(201);
  expect(flow.prompts, `one model call for ${reader}: ${String(res.body).slice(0, 300)}`).toHaveLength(1);
  return semanticSection(flow.prompts[0]);
}

async function everythingFor(reader: Reader) {
  return { search: await searchFor(reader), wide: await searchFor(reader, 50), chat: await chatSectionFor(reader), stream: await streamSectionFor(reader) };
}

beforeAll(async () => {
  globalThis.fetch = (async (input: unknown) => {
    outbound.push(String(input));
    throw new Error('v71u: no outbound traffic in this suite');
  }) as typeof fetch;

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { AiFlowController } = await import('../src/modules/ai/flow.controller');
  const { AgentController } = await import('../src/modules/ai/agent.controller');
  const { AiMemoryService } = await import('../src/modules/ai/ai-memory.service');
  const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
  const { AiOversightService } = await import('../src/modules/ai/ai-oversight.service');
  const { RoleEngineService } = await import('../src/modules/ai/role-engine.service');
  const { JobRolePolicyService } = await import('../src/modules/structure/job-role-policy.service');
  const { KeyActionBoundaryService } = await import('../src/modules/key-autonomy/action-boundary/key-action-boundary.service');
  const { UnifiedMemoryRetrievalService } = await import('../src/modules/key-cortex/unified-memory-retrieval.service');
  const { KnowledgeIngestionService } = await import('../src/modules/key-cortex/knowledge-ingestion.service');
  const { SemanticMemoryService } = await import('../src/modules/ai/semantic-memory.service');
  const { TemporalFlowService } = await import('../src/modules/temporal-flow/temporal-flow.service');
  const { TemporalFlowMemoryService } = await import('../src/modules/temporal-flow/temporal-flow-memory.service');
  const { AgentStateMachineService } = await import('../src/modules/ai/agent-state-machine.service');
  const { AgentBusService } = await import('../src/modules/ai/agent-bus.service');
  const { PatternDetectorService } = await import('../src/modules/ai/pattern-detector.service');
  const { UndoService } = await import('../src/modules/ai/undo.service');
  const { CalendarIntelligenceService } = await import('../src/modules/ai/calendar-intelligence.service');
  const { DocumentIntelligenceService } = await import('../src/modules/ai/document-intelligence.service');

  prisma = new PrismaService();
  semantic = new SemanticMemoryService(prisma, new EventEmitter2(), {
    trackEmbedding: async (_b: string, _u: unknown, _o: string, texts: string[]) => {
      embedCalls.push(...texts);
      return texts.map(embed);
    },
  } as any);
  memory = new AiMemoryService(prisma, {} as any, { getBlueprint: async () => null } as any, semantic);
  temporalMemory = new TemporalFlowMemoryService(prisma, semantic);
  temporal = new TemporalFlowService(prisma, temporalMemory, semantic);
  knowledge = new KnowledgeIngestionService(prisma);

  // The flow orchestrator: the real chat() and streamChat() with the real semantic store; the other context reads answer
  // nothing (the perception block's unified read has a semantic store that answers nothing, so only the section under
  // test carries semantic hits).
  const prompts: string[] = [];
  const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2, estimatedCost: 0 };
  type GatewayRequest = { messages: Array<{ role: string; content: unknown }> };
  const systemOf = (req: GatewayRequest) => req.messages.filter((x) => x.role === 'system').map((x) => String(x.content ?? '')).join('\n');
  const aiUsage = {
    checkRateLimit() {},
    async checkCredits() {
      return { allowed: true };
    },
    async trackAndComplete(_businessId: string, _userId: unknown, _task: string, req: GatewayRequest) {
      prompts.push(systemOf(req));
      return { content: 'v71u: noted.', toolCalls: [], usage };
    },
    async *trackAndStream(_businessId: string, _userId: unknown, _task: string, req: GatewayRequest) {
      prompts.push(systemOf(req));
      yield { type: 'content_delta', content: 'v71u: noted.' };
      yield { type: 'usage', usage };
    },
  };
  const recorder = { emit() { return true; }, async recordEvent() { return undefined; }, async create() { return undefined; } };
  const roleEngine = new RoleEngineService(prisma, {} as any, recorder as any);
  const jobRolePolicy = new JobRolePolicyService();
  const unified = new UnifiedMemoryRetrievalService(prisma, { search: async () => [] } as any);
  const providers = new Map<unknown, unknown>();
  const moduleRef = {
    get(token: any) {
      if (!providers.has(token)) throw new Error(`v71u: no provider for ${token?.name ?? String(token)}`);
      return providers.get(token);
    },
  };
  providers.set(KeyActionBoundaryService, new KeyActionBoundaryService(prisma, moduleRef as any));
  providers.set(JobRolePolicyService, jobRolePolicy);
  providers.set(UnifiedMemoryRetrievalService, unified);
  const orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    logger: { log() {}, debug() {}, verbose() {}, error() {}, warn() {} },
    prisma,
    moduleRef,
    aiUsage,
    roleEngine,
    governance: new AiOversightService(prisma, {} as any, {} as any, roleEngine, {} as any, jobRolePolicy),
    executionLog: { logToolExecution: async () => undefined, log: async () => undefined },
    businessGraph: {
      invalidateCache() {},
      getSnapshot: async () => ({ business: { name: 'V71U Biz' } }),
      buildContextString: () => '',
    },
    memory: { buildContextBlock: async () => ({}), buildPromptSection: () => '' },
    semanticMemory: semantic,
    genomeFacts: { listTopFacts: async () => [] },
    buildAttachmentContext: async () => '',
    buildBlueprintSection: async () => '',
    buildOnboardingDirective: async () => '',
    getTriage: () => null,
    getConversationHistory: async () => [],
    saveConversationHistory: async () => undefined,
    enforceDoNotSay: async () => undefined,
  });
  flow = { prompts };

  const testing = await Test.createTestingModule({
    controllers: [AiFlowController, AgentController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      TeamAuditInterceptor,
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      { provide: FlowOrchestratorService, useValue: orchestrator },
      { provide: SemanticMemoryService, useValue: semantic },
      // AgentController's collaborators no case calls.
      { provide: AgentStateMachineService, useValue: {} },
      { provide: AgentBusService, useValue: {} },
      { provide: PatternDetectorService, useValue: {} },
      { provide: UndoService, useValue: {} },
      { provide: CalendarIntelligenceService, useValue: {} },
      { provide: DocumentIntelligenceService, useValue: {} },
    ],
  }).compile();
  http = testing.createNestApplication();
  http.getHttpAdapter().getInstance().set('trust proxy', true);
  http.use(async (req: any, _res: any, next: any) => {
    const id = req.headers[HEADER];
    if (typeof id === 'string' && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  http.useGlobalInterceptors(new TenantInterceptor(prisma));
  http.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  http.useGlobalFilters(new GlobalHttpExceptionFilter());
  await http.init();

  await cleanup();
  for (const [id, role] of [
    [ID.owner, 'USER'],
    [ID.blind, 'USER'],
    [ID.revenue, 'USER'],
    [ID.revnoexp, 'USER'],
    [ID.admin, 'USER'],
    [ID.root, 'SUPER_ADMIN'],
  ] as const) {
    await db.user.create({ data: { id, email: `${id}@${P}test.local`, role } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'V71U Biz', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD' } });
  for (const [userId, role, extra] of [
    [ID.owner, 'OWNER', { maxApprovalTier: 4 }],
    [ID.blind, 'STAFF', { permissionScopes: BLIND_SCOPES, maxApprovalTier: 0 }],
    [ID.revenue, 'STAFF', { permissionScopes: REVENUE_SCOPES, maxApprovalTier: 0 }],
    [ID.revnoexp, 'STAFF', { permissionScopes: REVENUE_NO_EXPENSES_SCOPES, maxApprovalTier: 0 }],
    [ID.admin, 'ADMIN', { maxApprovalTier: 3 }],
  ] as const) {
    await db.membership.create({ data: { id: m(userId), userId, businessId: ID.biz, role, ...extra } });
  }
}, 180_000);

afterAll(async () => {
  globalThis.fetch = saved.fetch;
  if (http) await http.close();
  if (db) await cleanup();
});

const lower = (x: unknown) => (typeof x === 'string' ? x : JSON.stringify(x)).toLowerCase();

describe('MEM-SEMANTIC-SIGHT (D-234, D-257): semantic memory reaches a reader only as its source allows, filtered before the top-k cut', () => {
  it('V71U-01 RED: a revenue-derived semantic hit (an invoice amount) reaches the revenue reader and the owner, and neither the blind STAFF member nor the memberless SUPER_ADMIN, on GET .../agent/memory/search and the flow chat (chat and stream)', async () => {
    await clearMemory();
    try {
      await seedOrdinary();
      await seedRevenue(1);
      // The blind readers first: their failure is the packet's claim.
      for (const reader of [...BLIND_READERS, 'owner', 'revenue'] as Reader[]) {
        const seen = await everythingFor(reader);
        for (const [surface, value] of Object.entries(seen)) {
          const text = lower(value);
          const label = `${reader} ${surface}: ${text.slice(0, 600)}`;
          if (reader === 'owner' || reader === 'revenue') {
            expect(text, label).toContain(REV);
            expect(text, label).toContain(AMOUNT);
          } else {
            expect(text, label).not.toContain(REV);
            expect(text, label).not.toContain(AMOUNT);
          }
          // An unresolvable source is served to nobody.
          expect(text, `${label}: orphan`).not.toContain(ORPHAN);
        }
      }
      expect(outbound, 'no outbound request').toEqual([]);
    } finally {
      await clearMemory();
    }
  }, 240_000);

  it("V71U-02 RED: each source's rule: the revenue reader and the owner get the inbox thread's summary, the payment contact's summary, the extraction's copy and the statement's chunk; the blind member gets the ordinary inbox summaries and the fact's copy; the memberless SUPER_ADMIN the fact's copy only", async () => {
    await clearMemory();
    try {
      await seedOrdinary();
      await seedRevenue(1);
      const kinds = (hits: string[]) => ({
        thread: hits.some((h) => h.includes('Invoice INV-0')),
        contact: hits.some((h) => h.startsWith('contact:summary') && h.toLowerCase().includes(REV)),
        extraction: hits.some((h) => h.startsWith('document_extraction: ')),
        chunk: hits.some((h) => h.includes('statement 0 chunk')),
        fact: hits.some((h) => h.includes(okMarker(0))),
        ordinary: hits.filter((h) => /V71U-OK-[1-6]/.test(h)).length,
      });
      const all = { thread: true, contact: true, extraction: true, chunk: true, fact: true, ordinary: 6 };
      expect(kinds(await searchFor('owner', 50)), 'owner').toEqual(all);
      expect(kinds(await searchFor('revenue', 50)), 'revenue').toEqual(all);
      expect(kinds(await searchFor('blind', 50)), 'blind').toEqual({ thread: false, contact: false, extraction: false, chunk: false, fact: true, ordinary: 6 });
      expect(kinds(await searchFor('root', 50)), 'root').toEqual({ thread: false, contact: false, extraction: false, chunk: false, fact: true, ordinary: 0 });
    } finally {
      await clearMemory();
    }
  }, 240_000);

  it('V71U-03 RED: differential: the blind STAFF member and the memberless SUPER_ADMIN are handed identical hits (search at 5 and at 50, chat and stream sections) whether the business holds 0 or 20 revenue-derived hits ranked above theirs; and the top 5 stay full', async () => {
    await clearMemory();
    try {
      await seedOrdinary();
      const before: Record<string, unknown> = {};
      for (const reader of BLIND_READERS) before[reader] = await everythingFor(reader);
      expect((before.blind as any).search, 'the blind top 5 is full').toHaveLength(5);
      await seedRevenue(5);
      // Control: the revenue reader's top 5 are all revenue-derived (the withheld hits do rank first).
      const revenueTop = await searchFor('revenue');
      expect(revenueTop.every((h) => h.toLowerCase().includes(REV) || /4812/.test(h)), JSON.stringify(revenueTop)).toBe(true);
      for (const reader of BLIND_READERS) {
        const after = await everythingFor(reader);
        expect(after, reader).toEqual(before[reader]);
      }
      expect(outbound, 'no outbound request').toEqual([]);
    } finally {
      await clearMemory();
    }
  }, 300_000);

  it('V71U-04 RED: a turn that names no member (the support desk: no user, no position) gets no semantic section at all (D-203: the support desk sees only the conversation in front of it, as its perception block reads nothing): not even the business-wide fact copy', async () => {
    await clearMemory();
    try {
      await seedOrdinary();
      await seedRevenue(1);
      flow.prompts.length = 0;
      const orchestrator = http.get((await import('../src/modules/ai/flow-orchestrator.service')).FlowOrchestratorService);
      await orchestrator.chat(ID.biz, QUERY, [{ role: 'user', content: QUERY }]);
      expect(flow.prompts).toHaveLength(1);
      expect(flow.prompts[0]).not.toContain('RELEVANT CONTEXT FROM MEMORY');
      for (const marker of [REV, AMOUNT, ORPHAN, 'v71u-ok-']) expect(lower(flow.prompts[0]), marker).not.toContain(marker);
      // Control: a member's turn over the same memory does carry the section (the fact copy).
      expect(lower(await chatSectionFor('blind'))).toContain(okMarker(0).toLowerCase());
    } finally {
      await clearMemory();
    }
  }, 240_000);

  it('V71U-05 RED: POST .../agent/memory/backfill needs settings admin: the owner and an ADMIN run it; a STAFF member (with or without revenue read) is refused 403 and nothing is copied', async () => {
    await clearMemory();
    try {
      await memory.upsert(ID.biz, { category: 'fact', key: `${P}fact`, value: `${okMarker(0)} we open at nine`, source: 'user' });
      const run = (who: string) => agent().post(`/ai/businesses/${ID.biz}/agent/memory/backfill`).set(HEADER, who).set('x-forwarded-for', nextIp());
      for (const who of [ID.blind, ID.revenue]) {
        const res = await run(who);
        expect(res.status, `${who}: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(403);
      }
      expect(await db.aiMemoryEmbedding.count({ where: { businessId: ID.biz } })).toBe(0);
      for (const who of [ID.owner, ID.admin]) {
        await db.aiMemoryEmbedding.deleteMany({ where: { businessId: ID.biz } });
        const res = await run(who);
        expect(res.status, `${who}: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(201);
        expect(res.body, who).toEqual({ backfilled: 1 });
      }
    } finally {
      await clearMemory();
    }
  }, 120_000);
  it('V71U-06 (review m1, m3; coverage of the paging): the differential holds across pages: with 120 withheld hits ranked above theirs (more than any first page), the blind and memberless readers are handed exactly what they were with none, and no hit twice', async () => {
    await clearMemory();
    try {
      await seedOrdinary();
      const before: Record<string, unknown> = {};
      for (const reader of BLIND_READERS) before[reader] = await everythingFor(reader);
      // 120 copies whose source resolves to nothing (served to nobody), all at similarity 1.
      for (let i = 0; i < 120; i++) {
        await semantic.store({ businessId: ID.biz, content: `${ORPHAN} event copy ${i}`, sourceType: 'event', sourceId: `${P}ev_none_${i}` });
      }
      for (const reader of BLIND_READERS) expect(await everythingFor(reader), reader).toEqual(before[reader]);
      const ids = (await semantic.search({
        businessId: ID.biz, query: QUERY, limit: 50, visibleTo: async (hits: any[]) => hits.map(() => true),
      })).map((h: any) => h.id);
      expect(new Set(ids).size, 'no hit twice').toBe(ids.length);
    } finally {
      await clearMemory();
    }
  }, 300_000);

  it('V71U-07 RED (security review 2, correctness m5): a temporal summary rewritten in place keeps its old copy in the semantic store; that copy, made from payment events and no longer what the row holds, reaches no reader; the copy of what the row holds now does', async () => {
    await clearMemory();
    try {
      const pay = [];
      for (let k = 0; k < 3; k++) {
        pay.push((await temporal.emit({ businessId: ID.biz, source: 'gw', type: 'payment.received', module: 'payments', title: 'settled' })).id);
      }
      const inbox = [];
      for (let k = 0; k < 3; k++) {
        inbox.push((await temporal.emit({ businessId: ID.biz, source: 'key_inbox', type: 'key_inbox.message_received', module: 'key_inbox', title: 'hello' })).id);
      }
      const base = { businessId: ID.biz, entityType: 'contact', entityId: `${P}ct_stale`, type: 'summary', sourceModule: 'key_inbox', confidence: 0.9 };
      await temporalMemory.createMemory({ ...base, content: `${REV} 3 settled this week`, sourceEventIds: pay });
      await temporalMemory.createMemory({ ...base, content: `${okMarker(7)} quiet this week`, sourceEventIds: inbox });
      expect(await db.aiMemoryEmbedding.count({ where: { businessId: ID.biz, sourceType: 'temporal_memory' } }), 'premise: both copies stay').toBe(2);
      for (const reader of ['owner', 'revenue', 'blind'] as Reader[]) {
        const hits = (await searchFor(reader, 50)).join('\n').toLowerCase();
        expect(hits, `${reader}: the stale copy`).not.toContain(REV);
        // P125 R1-SEC-02 + P137 MEM-CLASS-READ: rewriting a REVENUE temporal row in place monotonically
        // preserves data_class=REVENUE & module_scope=['crm','operations','revenue'], so only readers
        // with revenue:read see the rewritten copy; blind readers see neither stale nor rewritten copy.
        if (reader === 'blind') {
          expect(hits, `${reader}: monotonic REVENUE taint`).not.toContain(okMarker(7).toLowerCase());
        } else {
          expect(hits, `${reader}: the current copy`).toContain(okMarker(7).toLowerCase());
        }
      }
    } finally {
      await clearMemory();
    }
  }, 120_000);

  it('V71U-08 RED (security review 3, correctness m5): a channel summary counts more events than it records as its source (summarizeChannel keeps 20 of up to 200): its provenance is incomplete and it needs every module, so payment events outside the 20 recorded do not reach the blind member; the owner keeps it', async () => {
    await clearMemory();
    try {
      // The channel's name carries the ranking marker (the stand-in embedding reads it); it names no module.
      const channel = `${okMarker(8)}-ch`;
      const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
      for (let k = 0; k < 5; k++) {
        await temporal.emit({ businessId: ID.biz, source: channel, type: 'payment.received', module: 'payments', title: 'settled', occurredAt: at(600 + k) });
      }
      for (let k = 0; k < 20; k++) {
        await temporal.emit({ businessId: ID.biz, source: channel, type: 'key_inbox.message_received', module: 'key_inbox', title: 'hi', occurredAt: at(k) });
      }
      const row = await temporalMemory.summarizeChannel(ID.biz, channel);
      expect(row.sourceEventIds, 'premise: only the 20 latest are recorded').toHaveLength(20);
      expect(await db.aiMemoryEmbedding.count({ where: { businessId: ID.biz, sourceType: 'temporal_memory' } }), 'premise: embedded').toBe(1);
      expect((await searchFor('blind', 50)).join('\n')).not.toContain(channel);
      expect((await searchFor('owner', 50)).join('\n')).toContain(channel);
    } finally {
      await clearMemory();
    }
  }, 120_000);

  it('V71U-09 RED (security review 4, correctness m4): a knowledge-source chunk is an unclassified document: it needs revenue and expenses read (as a document event does), so a member with revenue read and expenses none does not get it; the revenue-and-expenses reader does', async () => {
    await clearMemory();
    try {
      const ksTitle = `${REV} vendor bills`;
      const ksContent = 'Bill from V71U Supplies';
      const sourceId = await knowledge.ingestText({ businessId: ID.biz, title: ksTitle, sourceType: 'document', content: ksContent });
      await semantic.store({
        businessId: ID.biz,
        content: `[${ksTitle} chunk 1/1]\n${ksContent}`,
        sourceType: 'document',
        sourceId: `${sourceId}:0`,
        metadata: { knowledgeSourceId: sourceId, title: ksTitle, sourceType: 'document', chunkIndex: 0 },
      });
      expect((await searchFor('revnoexp', 50)).join('\n').toLowerCase()).not.toContain(REV);
      expect((await searchFor('revenue', 50)).join('\n').toLowerCase()).toContain(REV);
    } finally {
      await clearMemory();
    }
  }, 120_000);
  it('V71U-10 RED (security re-review MAJOR-1; D-234 meaning, D-100): an AiMemory copy whose row states money (a pattern row totalling overdue invoices) reaches only a member with revenue read: not the blind member, not the memberless SUPER_ADMIN, on search or in the flow chat; the owner and the revenue reader get it', async () => {
    await clearMemory();
    try {
      await memory.upsert(ID.biz, { category: 'patterns', key: `${P}overdue`, value: `${okMarker(9)} 3 overdue invoices totaling TTD ${AMOUNT}`, source: 'pattern_analysis' });
      await semantic.backfillFromAiMemory(ID.biz);
      for (const reader of ['blind', 'root'] as Reader[]) {
        expect((await searchFor(reader, 50)).join('\n'), reader).not.toContain(AMOUNT);
        expect(await chatSectionFor(reader), `${reader} chat`).not.toContain(AMOUNT);
      }
      for (const reader of ['owner', 'revenue'] as Reader[]) expect((await searchFor(reader, 50)).join('\n'), reader).toContain(AMOUNT);
    } finally {
      await clearMemory();
    }
  }, 120_000);

  it("V71U-11 RED (security re-review MINOR-1): an insight KEY stored (store_memory: entity 'business', source module key_cortex, its key chosen by the model, no source events) has no recorded provenance: it needs every module, so a key that names a module (crm_followups) does not admit the blind member; the owner gets it", async () => {
    await clearMemory();
    try {
      await temporalMemory.createMemory({
        businessId: ID.biz, entityType: 'business', entityId: 'crm_followups', type: 'insight', sourceModule: 'key_cortex',
        content: `${okMarker(10)} follow up with the Smiths`, sourceEventIds: [], confidence: 0.9,
      });
      expect((await searchFor('blind', 50)).join('\n')).not.toContain(okMarker(10));
      expect((await searchFor('owner', 50)).join('\n')).toContain(okMarker(10));
    } finally {
      await clearMemory();
    }
  }, 120_000);

  it('V71U-12 RED (correctness re-review MINOR-1): a source read that fails does not leave the read to page on to lower-ranked hits: the projection raises, and the search answers nothing', async () => {
    const { semanticHitsVisibleTo } = await import('../src/modules/ai/semantic-memory-sight');
    const failing = { client: new Proxy({}, { get: () => ({ findMany: async () => { throw new Error('v71u: read failed'); } }) }) };
    await expect(
      semanticHitsVisibleTo(failing as any, ID.biz, { reader: ID.owner, sight: () => true }, [{ sourceType: 'temporal_memory', sourceId: 'x', content: 'y' }]),
    ).rejects.toThrow('v71u: read failed');
  });
  it("V71U-13 RED (security review round 3, MINOR-1; D-234 sales volume): a contact summary made from sales events (type sale.completed, module storefront) is sales-derived: it needs revenue read, though its text and module names state no money; the blind member (storefront and crm read) does not get it, the owner does", async () => {
    await clearMemory();
    try {
      const contactId = `${P}ct_sales`;
      const channel = `${okMarker(11)}-store`;
      for (let k = 0; k < 3; k++) {
        await temporal.emit({
          businessId: ID.biz, source: channel, type: 'sale.completed', module: 'storefront', title: 'Completed',
          contactId, importance: 'CRITICAL', genomeImpactPotential: true,
        });
      }
      await temporalMemory.summarizeContact(ID.biz, contactId);
      expect(await db.aiMemoryEmbedding.count({ where: { businessId: ID.biz, sourceType: 'temporal_memory' } }), 'premise: embedded').toBe(1);
      expect((await searchFor('blind', 50)).join('\n')).not.toContain(channel);
      expect((await searchFor('owner', 50)).join('\n')).toContain(channel);
    } finally {
      await clearMemory();
    }
  }, 120_000);

  it('V71U-14 (correctness review round 3, MINOR-3; coverage): end to end, a projection that raises on a later page leaves the search answering nothing, never that page or the next', async () => {
    await clearMemory();
    try {
      for (let i = 0; i < 60; i++) {
        await semantic.store({ businessId: ID.biz, content: `${okMarker(1)} hit ${i}`, sourceType: 'event', sourceId: `${P}ev_${i}` });
      }
      let pages = 0;
      const hits = await semantic.search({
        businessId: ID.biz, query: QUERY, limit: 5,
        visibleTo: async (page: any[]) => {
          pages += 1;
          if (pages === 1) return page.map(() => false);
          throw new Error('v71u: read failed');
        },
      });
      expect(pages, 'a second page was read').toBe(2);
      expect(hits).toEqual([]);
    } finally {
      await clearMemory();
    }
  }, 120_000);
  it('V71U-15 RED (orchestrator acceptance, security MINOR-2; D-146): an AiMemory row stating an expense needs expenses read: a member with revenue read and expenses none is not handed "expense: rent TTD 4,000"; the revenue-and-expenses reader is', async () => {
    await clearMemory();
    try {
      await memory.upsert(ID.biz, { category: 'business_fact', key: `${P}rent`, value: `${okMarker(12)} expense: rent TTD 4,000`, source: 'user' });
      await semantic.backfillFromAiMemory(ID.biz);
      expect((await searchFor('revnoexp', 50)).join('\n')).not.toContain('rent TTD 4,000');
      expect((await searchFor('revenue', 50)).join('\n')).toContain('rent TTD 4,000');
      expect((await searchFor('owner', 50)).join('\n')).toContain('rent TTD 4,000');
    } finally {
      await clearMemory();
    }
  }, 120_000);

  it('V71U-16 RED (orchestrator acceptance, security MINOR-3): GET .../agent/memory/search refuses a query over 500 characters with 400, before any embedding; 500 characters are served', async () => {
    const calls = embedCalls.length;
    const long = await agent().get(`/ai/businesses/${ID.biz}/agent/memory/search`).query({ q: 'x'.repeat(501) }).set(HEADER, ID.owner);
    expect(long.status, JSON.stringify(long.body).slice(0, 200)).toBe(400);
    expect(embedCalls.length, 'no embedding for a refused query').toBe(calls);
    const ok = await agent().get(`/ai/businesses/${ID.biz}/agent/memory/search`).query({ q: 'x'.repeat(500) }).set(HEADER, ID.owner);
    expect(ok.status).toBe(200);
    expect(embedCalls.length, 'a 500-character query is embedded').toBe(calls + 1);
    // Delta review MINOR-1: a repeated q (parsed to an array) is refused; a bracketed q (an array under the extended
    // query parser, another key under the simple one) is refused or answers nothing. Neither is embedded.
    const repeated = await agent().get(`/ai/businesses/${ID.biz}/agent/memory/search?q=${'x'.repeat(501)}&q=y`).set(HEADER, ID.owner);
    expect(repeated.status, JSON.stringify(repeated.body).slice(0, 160)).toBe(400);
    const bracketed = await agent().get(`/ai/businesses/${ID.biz}/agent/memory/search?q[]=${'x'.repeat(501)}`).set(HEADER, ID.owner);
    expect(bracketed.status === 400 || (bracketed.status === 200 && bracketed.body.results.length === 0), JSON.stringify(bracketed.body).slice(0, 160)).toBe(true);
    expect(embedCalls.length, 'no embedding for a refused array query').toBe(calls + 1);
  });

  it.each([
    ['we spent TTD 4,000 on fuel', 'business_fact', 'fuel'],
    ['monthly costs TTD 12,000', 'business_fact', 'costs'],
    ['the lease is TTD 5,000', 'business_fact', 'lease'],
    ['TTD 900 on the account', 'business_fact', 'rentExpense'],
  ])('V71U-18 RED (delta review MINOR-1/2): an expense stated as %s (key %s / %s) needs expenses read: the revenue-only member does not get it, the revenue-and-expenses reader does', async (value, category, key) => {
    await clearMemory();
    try {
      await memory.upsert(ID.biz, { category, key: `${P}${key}`, value: `${okMarker(13)} ${value}`, source: 'user' });
      await semantic.backfillFromAiMemory(ID.biz);
      expect((await searchFor('revnoexp', 50)).join('\n')).not.toContain(okMarker(13));
      expect((await searchFor('revenue', 50)).join('\n')).toContain(okMarker(13));
    } finally {
      await clearMemory();
    }
  }, 120_000);

  it("V71U-19 RED (delta review MINOR-3): a temporal summary whose entity, source module and events name no module needs every module even when its text names an expense or money (text taint is added on top of the fail-closed fallback, not instead of it)", async () => {
    const { temporalMemoryModulesOf } = await import('../src/modules/ai/semantic-memory-sight');
    const { EVENT_MODULES } = await import('../src/modules/key-cortex/key-cortex-prompt-context.service');
    for (const content of ['the supplier called about the shipment', 'paid TTD 900']) {
      const row = { id: 'x', entityType: 'thing', entityId: null, type: 'summary', sourceModule: 'misc', sourceEventIds: [], content, metadata: {} };
      expect([...temporalMemoryModulesOf(row, new Map())].sort(), content).toEqual([...EVENT_MODULES].sort());
    }
  });

  it('V71U-17 (orchestrator acceptance, correctness m-1; owner parity): for live sources the owner and a reader of every module are handed exactly the hits, in the same order and number, that the unprojected read serves; only the copies whose source is gone or stale (here: a deleted summary and an event copy with no source) are now withheld, for everyone', async () => {
    await clearMemory();
    try {
      await seedOrdinary();
      await seedRevenue(2);
      const unprojected = (await semantic.search({ businessId: ID.biz, query: QUERY, limit: 50, includeDocumentExtractionCopies: true }))
        .map((h: any) => String(h.content));
      const live = unprojected.filter((c) => !c.toLowerCase().includes(ORPHAN));
      expect(unprojected.length - live.length, 'premise: the two unresolvable copies are in the unprojected read').toBe(2);
      expect(await searchFor('owner', 50)).toEqual(live);
      expect(await searchFor('revenue', 50)).toEqual(live);
      expect(await searchFor('owner', 5)).toEqual(live.slice(0, 5));
    } finally {
      await clearMemory();
    }
  }, 240_000);
  it('V71U-20 RED (Codex P2 on #226): a copy deleted above the read position between two pages does not make the next-ranked visible hit go missing: the filtered read keeps its place by rank (similarity, then id), not by row offset', async () => {
    await clearMemory();
    try {
      // 50 withheld copies ranked first (similarity 1), then 5 visible ones (0.94 down to 0.90).
      for (let i = 0; i < 50; i++) {
        await semantic.store({ businessId: ID.biz, content: `${ORPHAN} withheld ${i}`, sourceType: 'event', sourceId: `${P}w_${i}` });
      }
      for (let n = 1; n <= 5; n++) {
        await semantic.store({ businessId: ID.biz, content: `${okMarker(n)} visible`, sourceType: 'event', sourceId: `${P}v_${n}` });
      }
      let pages = 0;
      const hits = await semantic.search({
        businessId: ID.biz, query: QUERY, limit: 5,
        visibleTo: async (page: any[]) => {
          pages += 1;
          // Between the first and the second page another writer deletes one copy the first page already read.
          if (pages === 1) await db.aiMemoryEmbedding.delete({ where: { id: page[0].id } });
          return page.map((h: any) => h.content.includes('visible'));
        },
      });
      expect(pages, 'premise: the first page (50 rows) held only withheld copies').toBeGreaterThan(1);
      expect(hits.map((h: any) => h.content)).toEqual([1, 2, 3, 4, 5].map((n) => `${okMarker(n)} visible`));
    } finally {
      await clearMemory();
    }
  }, 120_000);

  it('V71U-21 (Codex P2 on #226; coverage): a copy inserted above the read position between two pages neither repeats a hit nor drops one', async () => {
    await clearMemory();
    try {
      for (let i = 0; i < 50; i++) {
        await semantic.store({ businessId: ID.biz, content: `${ORPHAN} withheld ${i}`, sourceType: 'event', sourceId: `${P}w_${i}` });
      }
      for (let n = 1; n <= 5; n++) {
        await semantic.store({ businessId: ID.biz, content: `${okMarker(n)} visible`, sourceType: 'event', sourceId: `${P}v_${n}` });
      }
      let pages = 0;
      const hits = await semantic.search({
        businessId: ID.biz, query: QUERY, limit: 5,
        visibleTo: async (page: any[]) => {
          pages += 1;
          if (pages === 1) await semantic.store({ businessId: ID.biz, content: `${ORPHAN} late`, sourceType: 'event', sourceId: `${P}w_late` });
          return page.map((h: any) => h.content.includes('visible'));
        },
      });
      expect(hits.map((h: any) => h.content)).toEqual([1, 2, 3, 4, 5].map((n) => `${okMarker(n)} visible`));
    } finally {
      await clearMemory();
    }
  }, 120_000);
});
