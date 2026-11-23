/**
 * MEM-PATTERNS-SIGHT (P0; owner rulings D-257 (KEY's memory design, its scope fixes), D-100 (a member without revenue
 * read sees no money signal at all), D-234 (authorization follows the data's meaning; ambiguity fails closed), D-203 (the
 * support desk sees only the conversation in front of it); journey K).
 *
 * Found by the MEM-SEMANTIC-SIGHT security review: AiMemoryService.buildContextBlock / buildPromptSection put every
 * AiMemory 'patterns' row into the "USER PREFERENCES & MEMORY" section of every flow-chat prompt
 * (FlowOrchestratorService.chat and streamChat), whoever the turn is for. PatternDetectorService.scanBusiness writes
 * a row per repeat late payer ('N overdue invoices totaling X', 'Overdue: <total>'), so an overdue-invoice total reached
 * the customer-facing support desk (Chatwoot's turn: no member, no position) and a STAFF member whose revenue scope is
 * none.
 *
 * GREEN: the turn's patterns are read for the turn's reader and sight (turnMemorySight, as the perception block and the
 * semantic section read): a pattern stating money only for a member reader with revenue read, one stating an expense
 * only for a member reader with expenses read (the AiMemory-row rule MEM-SEMANTIC-SIGHT applies to a row's semantic
 * copy, semantic-memory-sight.ts), and no pattern at all for the support desk. The owner's prompt is unchanged.
 *
 * Every pattern is written by its real writer on the real database (PatternDetectorService.scanBusiness over real
 * invoices; AiMemoryService.upsert in the forms summarizePatterns and the delegation loop write). Every read goes through
 * the real route: AiFlowController behind its real guards, over the real FlowOrchestratorService.chat / streamChat and
 * the real AiMemoryService; the staff bridge's turn and the support desk's call chat() / streamChat() as their services do.
 *
 * Stand-ins: identity attachment (a middleware reads `x-v71v-user`), the model provider (records the system prompt), and
 * the orchestrator's other context reads (the semantic store answers nothing). globalThis.fetch is a tap that refuses and
 * records every outbound request: none is made.
 *
 * Fixture prefix v71v_ (MEM-PATTERNS-SIGHT), cleaned with sqlLikePrefix().
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v71v_';
const HEADER = 'x-v71v-user';

const ID = {
  owner: `${P}owner`,
  /** STAFF, explicit scope map: crm and operations read, revenue and expenses 'none'. */
  blind: `${P}blind`,
  /** STAFF, explicit scope map: revenue and expenses read. */
  revenue: `${P}revenue`,
  /** STAFF, explicit scope map: revenue read, expenses 'none'. */
  revnoexp: `${P}revnoexp`,
  /** A platform SUPER_ADMIN with no membership: BusinessGuard admits them; no member reader (memberless). */
  root: `${P}root`,
  biz: `${P}biz`,
  /** Another tenant, with its own owner and its own money pattern. */
  other: `${P}other`,
  otherBiz: `${P}biz2`,
  payer: `${P}payer`,
  otherPayer: `${P}payer2`,
  jobRole: `${P}jobrole`,
};
const m = (who: string) => `${P}m_${who.slice(P.length)}`;
const BLIND_SCOPES = {
  crm: 'read', bookings: 'read', projects: 'read', content: 'read', automations: 'read', storefront: 'read',
  analytics: 'read', operations: 'read', ai: 'read', team: 'read', expenses: 'none', revenue: 'none',
};
const REVENUE_SCOPES = { ...BLIND_SCOPES, revenue: 'read', expenses: 'read' };
const REVENUE_NO_EXPENSES_SCOPES = { ...BLIND_SCOPES, revenue: 'read' };

type Reader = 'owner' | 'blind' | 'revenue' | 'revnoexp' | 'root';

/** The two overdue invoices of one payer: 4000 + 3341 = 7341, the total PatternDetectorService states. */
const TOTAL = '7341';
const OTHER_TOTAL = '9157';
/** The non-money patterns: summarizePatterns' peak hour, and a booking-free operations note. */
const PEAK = 'Peak activity hour: 9AM';
const OPS = 'Most active day: Tuesday';
/** An expense-stating pattern (no money figure): needs expenses read. */
const EXPENSE = 'Rent and supplier bills cluster at the start of each month';
const QUERY = 'V71V how is the business doing';

const saved = { fetch: globalThis.fetch };
const outbound: string[] = [];

let db: any;
let prisma: any;
let http: any;
let memory: any;
let detector: any;
let orchestrator: any;
let jobRolePolicy: any;
let flow: { prompts: string[] };

async function cleanup() {
  const byBiz = (table: string) => `DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`;
  for (const sql of [
    byBiz('ai_memory_embeddings'),
    byBiz('ai_memories'),
    byBiz('invoices'),
    byBiz('contacts'),
    byBiz('job_roles'),
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

async function clearPatterns() {
  for (const table of ['ai_memory_embeddings', 'ai_memories', 'invoices']) {
    await db.$executeRawUnsafe(`DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  }
}

const DAY = 24 * 60 * 60 * 1000;
/** Two overdue invoices of `contactId` (created this week, due last week) totalling `a + b`. */
async function overdueInvoices(businessId: string, contactId: string, a: number, b: number) {
  for (const [n, total] of [[1, a], [2, b]] as const) {
    await db.invoice.create({
      data: {
        id: `${contactId}_inv${n}`, invoiceNumber: `${contactId}-${n}`, businessId, contactId, total, subtotal: total,
        status: 'SENT', dueDate: new Date(Date.now() - 3 * DAY), currency: 'TTD',
      },
    });
  }
}

/** The money pattern, by its real writer: PatternDetectorService.scanBusiness over two overdue invoices of one payer. */
async function seedMoneyPattern() {
  await overdueInvoices(ID.biz, ID.payer, 4000, 3341);
  const scan = await detector.scanBusiness(ID.biz);
  const overdue = scan.patterns.filter((p: any) => p.category === 'overdue_invoice_cluster');
  expect(overdue, 'premise: the detector found the repeat late payer').toHaveLength(1);
  expect(overdue[0].description, 'premise: the pattern states the total').toContain(`totaling ${TOTAL}`);
  const rows = await db.aiMemory.findMany({ where: { businessId: ID.biz, category: 'patterns', key: { startsWith: 'pattern_overdue_invoice_cluster' } } });
  expect(rows, 'premise: the detector stored the pattern').toHaveLength(1);
}

/** `n` more money patterns (the delegation loop's and detector's forms), so the differential has N > 1. */
async function seedMoreMoneyPatterns(n: number) {
  for (let i = 0; i < n; i++) {
    await memory.upsert(ID.biz, {
      category: 'patterns',
      key: `pattern_revenue_drop_${P}${i}`,
      value: JSON.stringify({ category: 'revenue_drop', title: `Revenue dropped ${10 + i}% vs last week`, description: `This week's revenue (${TOTAL}) is lower` }),
      confidence: 0.9,
      source: 'pattern_analysis',
    });
  }
}

/** The non-money patterns, in summarizePatterns' form. */
async function seedPlainPatterns() {
  for (const value of [PEAK, OPS]) {
    await memory.upsert(ID.biz, { category: 'patterns', key: value.split(':')[0].trim().toLowerCase().replace(/\s+/g, '_'), value, confidence: 0.8, source: 'pattern_analysis' });
  }
}

const agent = () => request(http.getHttpServer());
let ip = 0;
const nextIp = () => `10.74.7.${(ip += 1) % 250}`;

/** The "USER PREFERENCES & MEMORY" section of a system prompt ('' when it has none). */
function memorySection(prompt: string): string {
  const at = prompt.indexOf('USER PREFERENCES & MEMORY:');
  if (at < 0) return '';
  const lines = prompt.slice(at).split('\n');
  const out = [lines[0]];
  for (const line of lines.slice(1)) {
    if (!line.startsWith('- ')) break;
    out.push(line);
  }
  return out.join('\n');
}

function onePrompt(label: string): string {
  expect(flow.prompts, `one model call for ${label}`).toHaveLength(1);
  return flow.prompts[0];
}

async function chatPromptFor(reader: Reader): Promise<string> {
  flow.prompts.length = 0;
  const res = await agent()
    .post(`/ai/businesses/${ID.biz}/flow/chat`)
    .set(HEADER, ID[reader])
    .set('x-forwarded-for', nextIp())
    .send({ message: QUERY, history: [{ role: 'user', content: QUERY }] });
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  return onePrompt(`${reader} chat`);
}

async function streamPromptFor(reader: Reader): Promise<string> {
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
  return onePrompt(`${reader} stream: ${String(res.body).slice(0, 300)}`);
}

/** The support desk's turn, as chatwoot.service.ts calls chat() (no member, no staff position), or streamChat(). */
async function deskPrompt(stream: boolean): Promise<string> {
  flow.prompts.length = 0;
  if (stream) {
    for await (const _chunk of orchestrator.streamChat(ID.biz, QUERY, [])) { /* drain */ }
  } else {
    await orchestrator.chat(ID.biz, QUERY, [{ role: 'user', content: QUERY }]);
  }
  return onePrompt(`support desk ${stream ? 'stream' : 'chat'}`);
}

/** A staff position's turn, as StaffChatBridgeService calls chat() / streamChat(): no member, the position's envelope. */
async function positionPrompt(position: Record<string, unknown>, stream: boolean): Promise<string> {
  const server = { jobRoleEnvelope: jobRolePolicy.envelopeForPosition(position) };
  flow.prompts.length = 0;
  if (stream) {
    for await (const _chunk of orchestrator.streamChat(ID.biz, QUERY, [], undefined, undefined, undefined, undefined, undefined, server)) { /* drain */ }
  } else {
    await orchestrator.chat(ID.biz, QUERY, [{ role: 'user', content: QUERY }], undefined, undefined, undefined, undefined, undefined, undefined, server);
  }
  return onePrompt(`position ${stream ? 'stream' : 'chat'}`);
}

/** Every memory section a member reader's turns carry: chat and stream. */
async function sectionsFor(reader: Reader) {
  return { chat: memorySection(await chatPromptFor(reader)), stream: memorySection(await streamPromptFor(reader)) };
}
async function deskSections() {
  return { chat: memorySection(await deskPrompt(false)), stream: memorySection(await deskPrompt(true)) };
}

const lower = (x: unknown) => (typeof x === 'string' ? x : JSON.stringify(x)).toLowerCase();
const statesMoney = (text: string) => text.includes(TOTAL) || /overdue|revenue dropped/i.test(text);
/**
 * Security review round 1 (F1): the whole system prompt, not only the memory section, may carry a pattern (the
 * perception block renders AiMemory rows as `[ai_memory]` fragments). The prompt's own instructions may use the word
 * "overdue", so the whole prompt is checked for the patterns' own text.
 */
const MONEY_MARKERS = [`totaling ${TOTAL}`, 'Repeat late payer', 'Revenue dropped', `revenue (${TOTAL})`, 'overdue_invoice_cluster', 'revenue_drop'];
const promptStatesMoney = (prompt: string) => MONEY_MARKERS.filter((marker) => prompt.includes(marker));
/** A prompt with its clock readings masked (the 0-vs-N differential compares two turns taken moments apart). */
const masked = (prompt: string) => prompt.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<ts>').replace(/\b\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM|am|pm)?/g, '<clock>');

beforeAll(async () => {
  globalThis.fetch = (async (input: unknown) => {
    outbound.push(String(input));
    throw new Error('v71v: no outbound traffic in this suite');
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
  const { AiMemoryService } = await import('../src/modules/ai/ai-memory.service');
  const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
  const { AiOversightService } = await import('../src/modules/ai/ai-oversight.service');
  const { RoleEngineService } = await import('../src/modules/ai/role-engine.service');
  const { JobRolePolicyService } = await import('../src/modules/structure/job-role-policy.service');
  const { KeyActionBoundaryService } = await import('../src/modules/key-autonomy/action-boundary/key-action-boundary.service');
  const { UnifiedMemoryRetrievalService } = await import('../src/modules/key-cortex/unified-memory-retrieval.service');
  const { PatternDetectorService } = await import('../src/modules/ai/pattern-detector.service');

  prisma = new PrismaService();
  memory = new AiMemoryService(prisma, {} as any, { getBlueprint: async () => null } as any);
  // The model gateway and usage are never reached: detectAiPatterns needs two tickets or bookings, and none exist.
  detector = new PatternDetectorService(prisma, new EventEmitter2(), {} as any, memory, {} as any);

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
      return { content: 'v71v: noted.', toolCalls: [], usage };
    },
    async *trackAndStream(_businessId: string, _userId: unknown, _task: string, req: GatewayRequest) {
      prompts.push(systemOf(req));
      yield { type: 'content_delta', content: 'v71v: noted.' };
      yield { type: 'usage', usage };
    },
  };
  const recorder = { emit() { return true; }, async recordEvent() { return undefined; }, async create() { return undefined; } };
  const roleEngine = new RoleEngineService(prisma, {} as any, recorder as any);
  jobRolePolicy = new JobRolePolicyService();
  const unified = new UnifiedMemoryRetrievalService(prisma, { search: async () => [] } as any);
  const providers = new Map<unknown, unknown>();
  const moduleRef = {
    get(token: any) {
      if (!providers.has(token)) throw new Error(`v71v: no provider for ${token?.name ?? String(token)}`);
      return providers.get(token);
    },
  };
  providers.set(KeyActionBoundaryService, new KeyActionBoundaryService(prisma, moduleRef as any));
  providers.set(JobRolePolicyService, jobRolePolicy);
  providers.set(UnifiedMemoryRetrievalService, unified);
  orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    logger: { log() {}, debug() {}, verbose() {}, error() {}, warn() {} },
    prisma,
    moduleRef,
    aiUsage,
    roleEngine,
    governance: new AiOversightService(prisma, {} as any, {} as any, roleEngine, {} as any, jobRolePolicy),
    executionLog: { logToolExecution: async () => undefined, log: async () => undefined },
    businessGraph: {
      invalidateCache() {},
      getSnapshot: async () => ({ business: { name: 'V71V Biz' } }),
      buildContextString: () => '',
    },
    // The real memory service under test.
    memory,
    semanticMemory: { search: async () => [] },
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
    controllers: [AiFlowController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      TeamAuditInterceptor,
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      { provide: FlowOrchestratorService, useValue: orchestrator },
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
    [ID.root, 'SUPER_ADMIN'],
    [ID.other, 'USER'],
  ] as const) {
    await db.user.create({ data: { id, email: `${id}@${P}test.local`, role } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'V71V Biz', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.otherBiz, name: 'V71V Other', slug: `${P}biz2`, ownerId: ID.other, currency: 'TTD' } });
  for (const [userId, businessId, role, extra] of [
    [ID.owner, ID.biz, 'OWNER', { maxApprovalTier: 4 }],
    [ID.blind, ID.biz, 'STAFF', { permissionScopes: BLIND_SCOPES, maxApprovalTier: 0 }],
    [ID.revenue, ID.biz, 'STAFF', { permissionScopes: REVENUE_SCOPES, maxApprovalTier: 0 }],
    [ID.revnoexp, ID.biz, 'STAFF', { permissionScopes: REVENUE_NO_EXPENSES_SCOPES, maxApprovalTier: 0 }],
    [ID.other, ID.otherBiz, 'OWNER', { maxApprovalTier: 4 }],
  ] as const) {
    await db.membership.create({ data: { id: m(userId), userId, businessId, role, ...extra } });
  }
  await db.contact.create({ data: { id: ID.payer, businessId: ID.biz, firstName: 'V71V', lastName: 'Payer' } });
  await db.contact.create({ data: { id: ID.otherPayer, businessId: ID.otherBiz, firstName: 'V71V', lastName: 'Other payer' } });
}, 180_000);

afterAll(async () => {
  globalThis.fetch = saved.fetch;
  if (http) await http.close();
  if (db) await cleanup();
});

describe('MEM-PATTERNS-SIGHT (D-257, D-100, D-234, D-203): flow-chat behavioural patterns state money only to revenue readers, and nothing to the support desk', () => {
  it('V71V-01 RED: the overdue-invoice total the pattern detector stored reaches the owner and the revenue reader, and neither the support desk (chat and stream), the revenue-none STAFF member nor the memberless SUPER_ADMIN (chat and stream)', async () => {
    await clearPatterns();
    try {
      await seedPlainPatterns();
      await seedMoneyPattern();
      // The support desk first, then the blind readers: their failure is the packet's claim.
      const desk = await deskSections();
      for (const [surface, text] of Object.entries(desk)) {
        expect(text, `support desk ${surface}: ${text}`).not.toContain(TOTAL);
        expect(lower(text), `support desk ${surface}`).not.toContain('overdue');
      }
      for (const reader of ['blind', 'root', 'owner', 'revenue'] as Reader[]) {
        for (const [surface, text] of Object.entries(await sectionsFor(reader))) {
          const label = `${reader} ${surface}: ${text.slice(0, 600)}`;
          if (reader === 'owner' || reader === 'revenue') {
            expect(text, label).toContain(`totaling ${TOTAL}`);
            expect(text, label).toContain('Overdue: 4000');
          } else {
            expect(statesMoney(text), label).toBe(false);
            // The non-money patterns still reach a member reader (and the memberless SUPER_ADMIN, as a business-wide row).
            expect(text, label).toContain(PEAK);
          }
        }
      }
      expect(outbound, 'no outbound request').toEqual([]);
    } finally {
      await clearPatterns();
    }
  }, 240_000);

  it('V71V-02 RED: differential: the support desk and the revenue-none STAFF member get identical memory sections (chat and stream) whether the business holds 0 or N money patterns; the support desk gets no pattern at all, even a non-money one', async () => {
    await clearPatterns();
    try {
      await seedPlainPatterns();
      const before = { desk: await deskSections(), blind: await sectionsFor('blind'), root: await sectionsFor('root') };
      // D-203: the support desk sees only the conversation in front of it: no behavioural pattern at all.
      for (const text of Object.values(before.desk)) {
        expect(text, `desk: ${text}`).not.toContain(PEAK);
        expect(text, `desk: ${text}`).not.toContain(OPS);
      }
      expect(before.blind.chat, 'control: the blind member does get the non-money patterns').toContain(PEAK);
      await seedMoneyPattern();
      await seedMoreMoneyPatterns(4);
      // Control: the money patterns do reach the revenue reader.
      const revenue = await sectionsFor('revenue');
      expect(revenue.chat).toContain(`totaling ${TOTAL}`);
      expect(revenue.chat).toContain('Revenue dropped 13%');
      const after = { desk: await deskSections(), blind: await sectionsFor('blind'), root: await sectionsFor('root') };
      expect(after).toEqual(before);
      expect(outbound, 'no outbound request').toEqual([]);
    } finally {
      await clearPatterns();
    }
  }, 300_000);

  it("V71V-03 owner parity: the owner's memory section, chat and stream, is exactly what the unscoped builder renders over the same rows (money and non-money patterns alike)", async () => {
    await clearPatterns();
    try {
      await seedPlainPatterns();
      await seedMoneyPattern();
      await seedMoreMoneyPatterns(2);
      await memory.upsert(ID.biz, { category: 'patterns', key: 'expense_cycle', value: EXPENSE, confidence: 0.8, source: 'pattern_analysis' });
      await memory.upsert(ID.biz, { category: 'goals', key: 'north_star', value: 'Open a second location', source: 'user' });
      const unscoped = memory.buildPromptSection(await memory.buildContextBlock(ID.biz)).trim();
      expect(unscoped).toContain(`totaling ${TOTAL}`);
      expect(unscoped).toContain(EXPENSE);
      const owner = await sectionsFor('owner');
      expect(owner.chat).toBe(unscoped);
      expect(owner.stream).toBe(unscoped);
    } finally {
      await clearPatterns();
    }
  }, 240_000);

  it('V71V-04 RED: an expense-stating pattern reaches a member reader with expenses read only: the revenue-and-expenses reader gets it; the revenue-only reader, the blind member and the support desk do not', async () => {
    await clearPatterns();
    try {
      await seedPlainPatterns();
      await memory.upsert(ID.biz, { category: 'patterns', key: 'expense_cycle', value: EXPENSE, confidence: 0.8, source: 'pattern_analysis' });
      expect((await sectionsFor('revenue')).chat, 'revenue + expenses').toContain(EXPENSE);
      for (const reader of ['revnoexp', 'blind', 'root'] as Reader[]) {
        const seen = await sectionsFor(reader);
        for (const [surface, text] of Object.entries(seen)) {
          expect(text, `${reader} ${surface}`).not.toContain(EXPENSE);
          expect(text, `${reader} ${surface}: control`).toContain(PEAK);
        }
      }
      for (const text of Object.values(await deskSections())) expect(text).not.toContain(EXPENSE);
    } finally {
      await clearPatterns();
    }
  }, 240_000);

  it("V71V-05 RED: the staff bridge's turn: a contact-only position (no member reader), even one whose JobRole grants revenue read, gets the non-money patterns and no money pattern; a position held by the revenue member texting from their own phone gets the money pattern (control)", async () => {
    await clearPatterns();
    try {
      await seedPlainPatterns();
      await seedMoneyPattern();
      const jobRole = { id: ID.jobRole, name: 'V71V Staff', permissions: REVENUE_SCOPES };
      const contactOnly = { businessId: ID.biz, jobRole, membershipId: null, userId: null, membership: null, phoneMembers: [] };
      for (const stream of [false, true]) {
        const text = memorySection(await positionPrompt(contactOnly, stream));
        expect(statesMoney(text), `contact-only position ${stream ? 'stream' : 'chat'}: ${text}`).toBe(false);
        expect(text, 'control: the non-money pattern').toContain(PEAK);
      }
      const membership = await db.membership.findUnique({ where: { id: m(ID.revenue) }, include: { user: true } });
      const held = { businessId: ID.biz, jobRole, membershipId: membership.id, userId: ID.revenue, membership, phoneMembers: [membership] };
      expect(memorySection(await positionPrompt(held, false)), 'held by the revenue member').toContain(`totaling ${TOTAL}`);
    } finally {
      await clearPatterns();
    }
  }, 240_000);

  it("V71V-06 cross-tenant: another business's money pattern never reaches this business's owner, and this business's never reaches the other owner's turn", async () => {
    await clearPatterns();
    try {
      await seedMoneyPattern();
      await overdueInvoices(ID.otherBiz, ID.otherPayer, 5000, 4157);
      const scan = await detector.scanBusiness(ID.otherBiz);
      expect(scan.patterns.some((p: any) => p.description.includes(`totaling ${OTHER_TOTAL}`)), 'premise').toBe(true);
      const owner = await sectionsFor('owner');
      expect(owner.chat).toContain(`totaling ${TOTAL}`);
      expect(owner.chat).not.toContain(`totaling ${OTHER_TOTAL}`);
      expect(owner.chat).not.toContain('Overdue: 5000');
      flow.prompts.length = 0;
      const res = await agent()
        .post(`/ai/businesses/${ID.otherBiz}/flow/chat`)
        .set(HEADER, ID.other)
        .set('x-forwarded-for', nextIp())
        .send({ message: QUERY, history: [{ role: 'user', content: QUERY }] });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
      const other = memorySection(onePrompt('other owner'));
      expect(other).toContain(`totaling ${OTHER_TOTAL}`);
      expect(other).not.toContain(`totaling ${TOTAL}`);
      expect(other).not.toContain('Overdue: 4000');
      // A member of this business asking on the other business's route is refused by BusinessGuard.
      const crossed = await agent()
        .post(`/ai/businesses/${ID.otherBiz}/flow/chat`)
        .set(HEADER, ID.revenue)
        .set('x-forwarded-for', nextIp())
        .send({ message: QUERY, history: [{ role: 'user', content: QUERY }] });
      expect(crossed.status).toBe(403);
    } finally {
      await clearPatterns();
    }
  }, 240_000);

  it('V71V-07 RED (correctness review COR-MPS-2): the revenue-none STAFF member alone: neither the memory section nor any other part of the chat and stream prompts carries the overdue-invoice total; the owner\'s does (control)', async () => {
    await clearPatterns();
    try {
      await seedPlainPatterns();
      await seedMoneyPattern();
      const prompts = { chat: await chatPromptFor('blind'), stream: await streamPromptFor('blind') };
      for (const [surface, prompt] of Object.entries(prompts)) {
        expect(statesMoney(memorySection(prompt)), `blind ${surface} section`).toBe(false);
        expect(promptStatesMoney(prompt), `blind ${surface} prompt`).toEqual([]);
      }
      expect(promptStatesMoney(await chatPromptFor('owner')), 'owner control').toContain(`totaling ${TOTAL}`);
    } finally {
      await clearPatterns();
    }
  }, 240_000);

  it('V71V-08 RED (security review F1): the whole system prompt, the perception block included: no money pattern for the revenue-none member, the memberless SUPER_ADMIN or a contact-only position, no expense pattern for the revenue-only member, and nothing for the support desk; each prompt is identical (clock masked) with 0 or N money and expense patterns', async () => {
    await clearPatterns();
    try {
      await seedPlainPatterns();
      const contactOnly = {
        businessId: ID.biz, jobRole: { id: ID.jobRole, name: 'V71V Staff', permissions: REVENUE_SCOPES }, membershipId: null, userId: null, membership: null, phoneMembers: [],
      };
      const all = async () => ({
        blind: [await chatPromptFor('blind'), await streamPromptFor('blind')],
        root: [await chatPromptFor('root'), await streamPromptFor('root')],
        position: [await positionPrompt(contactOnly, false), await positionPrompt(contactOnly, true)],
        desk: [await deskPrompt(false), await deskPrompt(true)],
        revnoexp: [await chatPromptFor('revnoexp'), await streamPromptFor('revnoexp')],
      });
      const before = await all();
      // Control: the perception block is live in this harness (it renders the non-money patterns as ai_memory fragments).
      expect(before.blind[0], 'control: perception block').toContain('[ai_memory] patterns');
      await seedMoneyPattern();
      await seedMoreMoneyPatterns(4);
      await memory.upsert(ID.biz, { category: 'patterns', key: 'expense_cycle', value: EXPENSE, confidence: 0.8, source: 'pattern_analysis' });
      // Control: the revenue-and-expenses reader's whole prompt carries both.
      const revenue = await chatPromptFor('revenue');
      expect(promptStatesMoney(revenue).length, 'control: money reaches the revenue reader').toBeGreaterThan(0);
      expect(revenue, 'control: the expense reaches the revenue-and-expenses reader').toContain(EXPENSE);
      const after = await all();
      for (const [who, prompts] of Object.entries(after)) {
        prompts.forEach((prompt, i) => {
          const label = `${who} ${i ? 'stream' : 'chat'}`;
          if (who !== 'revnoexp') expect(promptStatesMoney(prompt), label).toEqual([]);
          expect(prompt, `${label}: expense`).not.toContain(EXPENSE);
          expect(masked(prompt), `${label}: differential`).toBe(masked((before as any)[who][i]));
        });
      }
      expect(outbound, 'no outbound request').toEqual([]);
    } finally {
      await clearPatterns();
    }
  }, 300_000);
});
