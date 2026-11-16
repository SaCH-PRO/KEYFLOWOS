/**
 * W1F-PERCEPTION-MODULE-SCOPE (V1-70; wave 1 review SEC-W11FPS-3; owner rulings D-202 `bridgememory` and D-203
 * `supportdesk`; module scopes D-71/D-146, D-57; D-73/D-88: the staff bridge's holder grants nothing).
 *
 * KEY's "WHAT YOU HAVE OBSERVED" block (FlowOrchestratorService.buildPerceptionSection, on POST
 * /ai/businesses/:id/flow/chat and its stream) and the memory block of POST /cortex/chat (buildMemoryContext and the
 * pipeline's own read) render rows of the business-wide event stores, business_events and cognitive_events. The bus
 * writes there every domain event EventEmitterFlowBridgeService forwards (expense.*, bill.*, budget.*, payment.*,
 * invoice.*, revenue_action.*, ...), each carrying its figures, and the watchers and the ledger write there too.
 *
 * At the base (16fff2a3) those stores were read business-wide for every reader:
 *  - SEC-W11FPS-3: a STAFF member whose expenses and revenue scopes are 'none' (REST refuses them every expense and
 *    money route) read an owner's expense amount, a Stripe payment, an invoice total and a revenue action's amount at
 *    risk in their KEY prompt; a non-member SUPER_ADMIN read them too.
 *  - D-203 (`supportdesk`, "only the conversation in front of it"): the customer-facing Chatwoot desk (chat() with no
 *    member and no staff position) perceived the business events, money included.
 *  - D-202 (`bridgememory`, "give them their own history too, only their own"): a staff member texting KEY over the
 *    WhatsApp/SMS bridge got none of their own KEY history; the bridge passes no member, so no reader.
 *
 * Every case drives the real writers (the expenses and bills routes through the real ExpensesService, StripeConnector,
 * BusinessEventService, InvoiceOverdueWatcherService, KeyCortexAuditService) through the real EventEmitter2, the real
 * EventEmitterFlowBridgeService and the real KeyCortexEventBusService with its cognitive store, then reads each prompt
 * over HTTP: the real AiFlowController behind the real AuthGuard, BusinessGuard and CrmRateLimitGuard, and the bridge
 * through the real WhatsApp Twilio webhook, WhatsAppService, StaffChatBridgeService and StructureService, over the real
 * FlowOrchestratorService and UnifiedMemoryRetrievalService. Three domain events have no service writer reachable here
 * and are emitted through the real EventEmitter2 with the payload their writer emits (invoice.created as
 * CommerceService.createInvoice, revenue_action.created as RevenueActionService.upsertAction, contact.created as the
 * CRM); budget.* has no emitter in the codebase at all, but the bridge forwards it, so it is emitted the same way.
 *
 * Stand-ins: identity attachment (a middleware reads `x-v70c-user`), the model provider (aiUsage records the system
 * prompt it is handed), the other context reads of the prompt, and the semantic store (answers nothing; no query is
 * passed to the perception read, so it is never asked). Every case taps fetch and asserts no outbound request.
 *
 * Fixture prefix v70c_ (V1-70, W1F-PERCEPTION-MODULE-SCOPE), cleaned with sqlLikePrefix().
 */
import 'reflect-metadata';
import path from 'path';
import { createHmac } from 'crypto';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v70c_';
const HEADER = 'x-v70c-user';

const ID = {
  owner: `${P}owner`,
  /** STAFF, explicit scope map: expenses and revenue 'none' (REST refuses them every expense and money route). */
  blind: `${P}blind`,
  /** STAFF, explicit scope map: revenue read, expenses 'none'. */
  revenue: `${P}revenue`,
  /** STAFF on role defaults: reads revenue and expenses (the control). */
  staff: `${P}staff`,
  /** A platform SUPER_ADMIN with no membership: BusinessGuard admits them; they are nobody's reader. */
  admin: `${P}admin`,
  biz: `${P}biz`,
  unit: `${P}unit`,
  role: `${P}role`,
  /** The blind member's staff position (membership-backed): its verified holder is the blind member. */
  posBlind: `${P}pos_blind`,
  /** A contact-only staff position: no holder. */
  posContact: `${P}pos_contact`,
  /** The customer of the invoice the overdue watcher finds. */
  customer: `${P}customer`,
};
const m = (who: string) => `${P}m_${who.slice(P.length)}`;
const BLIND_SCOPES = {
  crm: 'read', bookings: 'read', projects: 'read', content: 'read', automations: 'read', storefront: 'read',
  analytics: 'read', operations: 'read', expenses: 'none', revenue: 'none',
};
const REVENUE_SCOPES = { crm: 'read', operations: 'read', revenue: 'read', expenses: 'none' };
const PHONE = { blind: '+18685557001', contact: '+18685557002' };
const PNID = '990000007001';
const HOST = 'api.v70c.test';
/** The Twilio auth token the webhook verifies under, built at run time (no literal secret in the suite). */
const TWILIO_TOKEN = ['v70c', 'twilio', String(process.pid), String(Date.now())].join('-');
/** A business-wide fact (AiMemory): not an event, so no module scope applies to it. */
const FACT = 'V70C-FACT: we open at nine';
const TURN = 'v70c: how are we doing this month?';

const saved = { token: process.env.TWILIO_AUTH_TOKEN, fetch: globalThis.fetch };
const outbound: string[] = [];

let db: any;
let prisma: any;
let http: any;
let hooks: any;
let events: any;
let flow: {
  orchestrator: any;
  prompts: string[];
  warnings: string[];
  snapshotViewers: Array<string | null | undefined>;
  toolSelectionUsers: Array<string | undefined>;
  savedHistories: unknown[][];
  retrievals: { count: number };
};
let stripe: any;
let audit: any;
let businessEvents: any;
let watcher: any;
let promptContextFor: (userId: string | undefined) => Promise<string>;
let pipelinePromptFor: (userId: string | undefined, path: 'processQuery' | 'streamQuery') => Promise<string>;

async function cleanup() {
  const byBiz = (table: string) => `DELETE FROM ${table} WHERE business_id LIKE ${sqlLikePrefix(P)}`;
  for (const sql of [
    byBiz('business_events'),
    byBiz('cognitive_events'),
    byBiz('cortex_action_logs'),
    byBiz('ai_execution_logs'),
    byBiz('cognition_memories'),
    byBiz('ai_memories'),
    byBiz('connector_statuses'),
    byBiz('whatsapp_messages'),
    byBiz('whatsapp_contacts'),
    byBiz('webhook_delivery_logs'),
    byBiz('webhook_events'),
    byBiz('team_activity_logs'),
    byBiz('ledger_entries'),
    byBiz('financial_transactions'),
    byBiz('financial_accounts'),
    byBiz('accounting_periods'),
    byBiz('expenses'),
    byBiz('expense_categories'),
    byBiz('chart_of_accounts'),
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    byBiz('invoices'),
    byBiz('contacts'),
    byBiz('org_assignments'),
    byBiz('job_roles'),
    byBiz('org_units'),
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

/** Removes what one case wrote to the stores perception reads. */
async function clearPerceivedStores() {
  for (const table of ['business_events', 'cognitive_events', 'cortex_action_logs', 'ai_execution_logs', 'cognition_memories']) {
    await db.$executeRawUnsafe(`DELETE FROM ${table} WHERE business_id = $1`, ID.biz);
  }
}

/** The fragment lines of a prompt's "WHAT YOU HAVE OBSERVED" block (a fragment's content may run on below its line). */
function observed(prompt: string): string[] {
  const at = prompt.indexOf('WHAT YOU HAVE OBSERVED');
  return at < 0 ? [] : prompt.slice(at).split('\n').filter((l) => l.startsWith('- ['));
}

/** The lines of a perception block, or of a numbered memory block, that render an event of one of `types`. */
function eventLines(prompt: string, types: readonly string[]): string[] {
  return prompt
    .split('\n')
    .filter((l) => types.some((t) => new RegExp(`^(- |\\d+\\. )\\[(business_event|cognitive_event)\\] ${t.replace(/\./g, '\\.')}: `).test(l)));
}

/** Waits until the stores hold the rows a writer's events land in (the bus persists without being awaited). */
async function waitForRows(types: readonly string[], business: number, cognitive: number) {
  await vi.waitFor(
    async () => {
      expect(await db.businessEvent.count({ where: { businessId: ID.biz, eventType: { in: [...types] } } })).toBe(business);
      expect(await db.cognitiveEvent.count({ where: { businessId: ID.biz, eventType: { in: [...types] } } })).toBe(cognitive);
    },
    { timeout: 10_000, interval: 100 },
  );
}

/** One turn of `userId` over POST .../flow/chat or .../flow/chat/stream: the system prompt the model was handed. */
let ip = 0;
async function turn(userId: string, path: 'chat' | 'stream'): Promise<string> {
  flow.prompts.length = 0;
  ip += 1;
  const req = request(http.getHttpServer())
    .post(`/ai/businesses/${ID.biz}/flow/chat${path === 'stream' ? '/stream' : ''}`)
    .set(HEADER, userId)
    .set('x-forwarded-for', `10.70.3.${ip % 250}`)
    .send({ message: TURN });
  if (path === 'chat') {
    const res = await req;
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
  } else {
    const res = await req.buffer(true).parse((r: any, cb: any) => {
      let text = '';
      r.setEncoding('utf8');
      r.on('data', (c: string) => {
        text += c;
      });
      r.on('end', () => cb(null, text));
    });
    const chunks = String(res.body)
      .split('\n')
      .filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]')
      .map((l) => JSON.parse(l.slice('data: '.length)));
    expect(chunks.filter((c: any) => c.type === 'error'), String(res.body).slice(0, 400)).toEqual([]);
  }
  expect(flow.prompts, `one model call for ${userId} (${path})`).toHaveLength(1);
  return flow.prompts[0];
}

/** The Chatwoot support desk's turn, as chatwoot.service.ts calls chat() (no member, no staff position), or streamChat(). */
async function deskTurn(path: 'chat' | 'stream'): Promise<string> {
  flow.prompts.length = 0;
  const desk = { route: '/app/helpdesk', surface: 'helpdesk' };
  if (path === 'chat') {
    await flow.orchestrator.chat(ID.biz, TURN, [], undefined, desk, undefined, undefined, `${P}desk_conv`);
  } else {
    for await (const chunk of flow.orchestrator.streamChat(ID.biz, TURN, [], desk, undefined, undefined, `${P}desk_conv`)) {
      expect((chunk as { type: string }).type, JSON.stringify(chunk).slice(0, 400)).not.toBe('error');
    }
  }
  expect(flow.prompts, `one model call for the support desk (${path})`).toHaveLength(1);
  return flow.prompts[0];
}

const twilioSignature = (url: string, params: Record<string, string>) =>
  createHmac('sha1', TWILIO_TOKEN)
    .update(Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url))
    .digest('base64');

/** A staff message texted to KEY over WhatsApp: a Twilio-signed POST to the business's own webhook route. */
let sid = 0;
async function bridgeTurn(phone: string): Promise<string> {
  flow.prompts.length = 0;
  sid += 1;
  const params = { From: `whatsapp:${phone}`, Body: TURN, SmsMessageSid: `SMv70c${process.pid}x${sid}` };
  const urlPath = `/whatsapp/webhook/${ID.biz}`;
  const res = await request(hooks.getHttpServer())
    .post(urlPath)
    .set('host', HOST)
    .set('x-twilio-signature', twilioSignature(`http://${HOST}${urlPath}`, params))
    .type('form')
    .send(params);
  expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
  expect(flow.prompts, `one model call for the staff message from ${phone}`).toHaveLength(1);
  return flow.prompts[0];
}

const agent = () => request(http.getHttpServer());

beforeAll(async () => {
  process.env.TWILIO_AUTH_TOKEN = TWILIO_TOKEN;
  globalThis.fetch = (async (input: unknown) => {
    outbound.push(String(input));
    throw new Error('v70c: no outbound traffic in this suite');
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
  const { configureNestApp } = await import('../src/app-bootstrap');
  const { AiFlowController } = await import('../src/modules/ai/flow.controller');
  const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
  const { AiOversightService } = await import('../src/modules/ai/ai-oversight.service');
  const { RoleEngineService } = await import('../src/modules/ai/role-engine.service');
  const { JobRolePolicyService } = await import('../src/modules/structure/job-role-policy.service');
  const { StructureService } = await import('../src/modules/structure/structure.service');
  const { StaffChatBridgeService } = await import('../src/modules/structure/staff-chat-bridge.service');
  const { WhatsAppService } = await import('../src/modules/whatsapp/whatsapp.service');
  const { WhatsAppController } = await import('../src/modules/whatsapp/whatsapp.controller');
  const { WebhookIngressLoggerService } = await import('../src/core/connectors/webhook-ingress-logger.service');
  const { KeyActionBoundaryService } = await import('../src/modules/key-autonomy/action-boundary/key-action-boundary.service');
  const { UnifiedMemoryRetrievalService } = await import('../src/modules/key-cortex/unified-memory-retrieval.service');
  const { KeyCortexEventBusService } = await import('../src/modules/key-cortex/key-cortex-event-bus.service');
  const { CognitiveEventBusService } = await import('../src/modules/key-cortex/cognitive-event-bus.service');
  const { EventEmitterFlowBridgeService } = await import('../src/modules/key-cortex/event-emitter-flow-bridge.service');
  const { KeyCortexAuditService } = await import('../src/modules/key-cortex/key-cortex-audit.service');
  const { InvoiceOverdueWatcherService } = await import('../src/modules/key-cortex/watchers/invoice-overdue-watcher.service');
  const { BusinessEventService } = await import('../src/modules/business-events/business-event.service');
  const { StripeConnector } = await import('../src/core/connectors/implementations/stripe.connector');
  const { ExpensesController } = await import('../src/modules/expenses/expenses.controller');
  const { BillsController } = await import('../src/modules/expenses/bills.controller');
  const { ExpensesService } = await import('../src/modules/expenses/expenses.service');
  const { RecurringExpenseService } = await import('../src/modules/expenses/recurring-expense.service');
  const { ExpensePostingService } = await import('../src/modules/finance/expense-posting.service');
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { AccountingPeriodService } = await import('../src/modules/finance/accounting-period.service');
  const { ChartOfAccountsSeederService } = await import('../src/modules/finance/chart-of-accounts-seeder.service');
  const { LedgerBalanceService } = await import('../src/modules/finance/ledger-balance.service');
  const { CashPositionService } = await import('../src/modules/finance/cash-position.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { DocumentIntelligenceService } = await import('../src/modules/ai/document-intelligence.service');

  prisma = new PrismaService();

  // The app's event path: domain events -> EventEmitterFlowBridgeService -> KEY bus -> business_events + cognitive_events.
  events = new EventEmitter2();
  const bus = new KeyCortexEventBusService(prisma, new CognitiveEventBusService(prisma));
  new EventEmitterFlowBridgeService(events, bus).onModuleInit();
  businessEvents = new BusinessEventService(prisma, events);
  audit = new KeyCortexAuditService(businessEvents);
  watcher = new InvoiceOverdueWatcherService(prisma, bus);
  stripe = new StripeConnector(prisma, events, { resolveContact: async () => ({ contactId: null }) } as any);

  // The flow orchestrator: the real chat(), streamChat() and buildPerceptionSection over the real memory stores.
  const prompts: string[] = [];
  const warnings: string[] = [];
  const snapshotViewers: Array<string | null | undefined> = [];
  const toolSelectionUsers: Array<string | undefined> = [];
  const savedHistories: unknown[][] = [];
  const retrievals = { count: 0 };
  const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2, estimatedCost: 0 };
  type GatewayRequest = { messages: Array<{ role: string; content: unknown }> };
  const record = (req: GatewayRequest) =>
    prompts.push(req.messages.filter((x) => x.role === 'system').map((x) => String(x.content ?? '')).join('\n'));
  const aiUsage = {
    checkRateLimit() {},
    async checkCredits() {
      return { allowed: true };
    },
    async trackAndComplete(_businessId: string, _userId: unknown, _task: string, req: GatewayRequest) {
      record(req);
      return { content: 'v70c: noted.', toolCalls: [], usage };
    },
    async *trackAndStream(_businessId: string, _userId: unknown, _task: string, req: GatewayRequest) {
      record(req);
      yield { type: 'content_delta', content: 'v70c: noted.' };
    },
  };
  const recorder = { emit() { return true; }, async recordEvent() { return undefined; }, async create() { return undefined; } };
  const roleEngine = new RoleEngineService(prisma, {} as any, recorder as any);
  const jobRolePolicy = new JobRolePolicyService();
  const unified = new UnifiedMemoryRetrievalService(prisma, { search: async () => [] } as any);
  const realRetrieve = unified.retrieveContext.bind(unified);
  unified.retrieveContext = (async (...args: Parameters<typeof realRetrieve>) => {
    retrievals.count += 1;
    return realRetrieve(...args);
  }) as typeof unified.retrieveContext;
  const providers = new Map<unknown, unknown>();
  const moduleRef = {
    get(token: any) {
      if (!providers.has(token)) throw new Error(`v70c: no provider for ${token?.name ?? String(token)}`);
      return providers.get(token);
    },
  };
  providers.set(KeyActionBoundaryService, new KeyActionBoundaryService(prisma, moduleRef as any));
  providers.set(JobRolePolicyService, jobRolePolicy);
  providers.set(UnifiedMemoryRetrievalService, unified);
  const orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    logger: { log() {}, debug() {}, verbose() {}, error() {}, warn: (x: unknown) => warnings.push(String(x)) },
    prisma,
    moduleRef,
    aiUsage,
    roleEngine,
    governance: new AiOversightService(prisma, {} as any, {} as any, roleEngine, {} as any, jobRolePolicy),
    executionLog: { logToolExecution: async () => undefined, log: async () => undefined },
    businessGraph: {
      invalidateCache() {},
      getSnapshot: async (_businessId: string, _force: boolean, opts?: { viewerId?: string | null }) => {
        snapshotViewers.push(opts?.viewerId);
        return { business: { name: 'V70C Biz' } };
      },
      buildContextString: () => '',
    },
    memory: { buildContextBlock: async () => ({}), buildPromptSection: () => '' },
    semanticMemory: { search: async () => [] },
    genomeFacts: { listTopFacts: async () => [] },
    buildAttachmentContext: async () => '',
    buildBlueprintSection: async () => '',
    buildOnboardingDirective: async () => '',
    getTriage: () => null,
    getConversationHistory: async () => [],
    saveConversationHistory: async (...args: unknown[]) => {
      savedHistories.push(args);
    },
    enforceDoNotSay: async () => undefined,
  });
  const realSelect = FlowOrchestratorService.prototype['selectToolsForRequest' as keyof typeof FlowOrchestratorService.prototype] as any;
  orchestrator.selectToolsForRequest = function (...args: unknown[]) {
    toolSelectionUsers.push(args[4] as string | undefined);
    return realSelect.apply(this, args);
  };
  flow = { orchestrator, prompts, warnings, snapshotViewers, toolSelectionUsers, savedHistories, retrievals };

  // App 1: the flow chat routes and the expense and bill routes, behind their real guards.
  const testing = await Test.createTestingModule({
    controllers: [AiFlowController, ExpensesController, BillsController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      TeamAuditInterceptor,
      { provide: FlowOrchestratorService, useValue: orchestrator },
      ExpensesService,
      RecurringExpenseService,
      ExpensePostingService,
      PostingService,
      AccountingPeriodService,
      ChartOfAccountsSeederService,
      LedgerBalanceService,
      CashPositionService,
      { provide: EventEmitter2, useValue: events },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
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
  const coa = testing.get(ChartOfAccountsSeederService);

  // App 2: the WhatsApp webhook, the staff bridge in front of the same orchestrator.
  const structure = new StructureService(prisma);
  const oversight = new AiOversightService(prisma, { log: async () => undefined } as any, { recordApprovalSignal: async () => undefined } as any, {} as any, {} as any, jobRolePolicy);
  const bridgeRef = {
    get: (token: unknown) =>
      token === JobRolePolicyService ? jobRolePolicy : token === AiOversightService ? oversight : token === FlowOrchestratorService ? orchestrator : undefined,
  };
  const bridge = new StaffChatBridgeService(structure, prisma, bridgeRef as any);
  const whatsapp = new WhatsAppService(prisma, { emit: () => true } as any, { resolveContact: async () => ({ contactId: null }) } as any, {} as any, bridge);
  const hooksModule = await Test.createTestingModule({
    controllers: [WhatsAppController],
    providers: [
      { provide: WhatsAppService, useValue: whatsapp },
      { provide: PrismaService, useValue: prisma },
      { provide: WebhookIngressLoggerService, useValue: new WebhookIngressLoggerService(prisma) },
      { provide: AuthGuard, useValue: { canActivate: () => false } },
      { provide: BusinessGuard, useValue: { canActivate: () => false } },
    ],
  }).compile();
  hooks = hooksModule.createNestApplication({ rawBody: true });
  configureNestApp(hooks);
  await hooks.init();

  // POST /cortex/chat's two memory reads, over the same stores: buildMemoryContext and the pipeline's own.
  const { KeyCortexPromptContextService } = await import('../src/modules/key-cortex/key-cortex-prompt-context.service');
  const { KeyCortexLearningService } = await import('../src/modules/key-cortex/key-cortex-learning.service');
  const { KeyCortexQueryPipelineService } = await import('../src/modules/key-cortex/key-cortex-query-pipeline.service');
  const { KeyCortexMemoryRetrievalService } = await import('../src/modules/key-cortex/key-cortex-memory-retrieval.service');
  promptContextFor = async (userId) => {
    // Positionally, as Nest constructs it: context service, unified memory, learning service, prisma.
    const promptContext = new (KeyCortexPromptContextService as any)(
      {} as any,
      new UnifiedMemoryRetrievalService(prisma, { search: async () => [] } as any),
      new KeyCortexLearningService(prisma),
      prisma,
    );
    const session = { id: `${P}sess_mem`, businessId: ID.biz, userId, messages: [] } as any;
    return (await promptContext.buildMemoryContext(ID.biz, session, userId)).aiMemory ?? '';
  };
  pipelinePromptFor = async (userId, path) => {
    const prompts2: string[] = [];
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
          prompts2.push(systemPrompt);
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
      new KeyCortexMemoryRetrievalService(new UnifiedMemoryRetrievalService(prisma, { search: async () => [] } as any)),
      { route: async () => route } as any,
    );
    const query = { text: 'what happened lately', businessId: ID.biz, userId } as any;
    const flags = { integrationV2Enabled: false, genomeV3Enabled: false };
    if (path === 'processQuery') await pipeline.processQuery(query, flags);
    else for await (const chunk of pipeline.streamQuery(query, flags)) void chunk;
    expect(prompts2, path).toHaveLength(1);
    return prompts2[0];
  };

  await cleanup();
  for (const [id, role] of [
    [ID.owner, 'USER'],
    [ID.blind, 'USER'],
    [ID.revenue, 'USER'],
    [ID.staff, 'USER'],
    [ID.admin, 'SUPER_ADMIN'],
  ] as const) {
    await db.user.create({ data: { id, email: `${id}@${P}test.local`, role } });
  }
  await db.business.create({
    data: { id: ID.biz, name: 'V70C Biz', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD', metaData: { whatsapp: { provider: 'mock', phoneNumberId: PNID } } },
  });
  for (const [userId, role, extra] of [
    [ID.owner, 'OWNER', { maxApprovalTier: 4 }],
    [ID.blind, 'STAFF', { permissionScopes: BLIND_SCOPES, maxApprovalTier: 0 }],
    [ID.revenue, 'STAFF', { permissionScopes: REVENUE_SCOPES, maxApprovalTier: 0 }],
    [ID.staff, 'STAFF', { maxApprovalTier: 0 }],
  ] as const) {
    await db.membership.create({ data: { id: m(userId), userId, businessId: ID.biz, role, ...extra } });
  }
  await coa.ensureDefaults(ID.biz);
  await db.orgUnit.create({ data: { id: ID.unit, businessId: ID.biz, name: 'V70C HQ' } });
  await db.jobRole.create({ data: { id: ID.role, businessId: ID.biz, name: 'V70C Staff', permissions: BLIND_SCOPES, defaultApprovalTier: 0 } });
  await db.orgAssignment.create({
    data: { id: ID.posBlind, businessId: ID.biz, orgUnitId: ID.unit, jobRoleId: ID.role, contactPhone: PHONE.blind, membershipId: m(ID.blind), userId: ID.blind, isContactOnly: false },
  });
  await db.orgAssignment.create({
    data: { id: ID.posContact, businessId: ID.biz, orgUnitId: ID.unit, jobRoleId: ID.role, contactPhone: PHONE.contact, isContactOnly: true, contactName: 'V70C contractor' },
  });
  await db.contact.create({ data: { id: ID.customer, businessId: ID.biz, firstName: 'V70C-CUSTOMER', lastName: 'Payer' } });
  await db.aiMemory.create({ data: { businessId: ID.biz, category: 'fact', key: `${P}fact`, value: FACT } });
}, 180_000);

afterAll(async () => {
  globalThis.fetch = saved.fetch;
  if (saved.token === undefined) delete process.env.TWILIO_AUTH_TOKEN;
  else process.env.TWILIO_AUTH_TOKEN = saved.token;
  if (http) await http.close();
  if (hooks) await hooks.close();
  if (db) await cleanup();
});

type Reader = 'blind' | 'revenue' | 'staff' | 'owner' | 'admin';
const READERS: Reader[] = ['blind', 'revenue', 'staff', 'owner', 'admin'];
const PATHS = ['chat', 'stream'] as const;

/**
 * The money families the bridge forwards, each written by its real writer. `module`: the module whose read scope the
 * reader needs (D-57: the Books and money at revenue read; expenses at expenses read, D-146). `business`/`cognitive`:
 * the rows its events land in.
 */
const MONEY: Array<{
  name: string;
  module: 'expenses' | 'revenue';
  types: string[];
  markers: string[];
  business: number;
  cognitive: number;
  write: () => Promise<void>;
}> = [
  {
    name: 'an expense the owner records over POST /expenses/businesses/:id/expenses (expense.created)',
    module: 'expenses',
    types: ['expense.created'],
    markers: ['7777.77', 'V70C-EXP-DRAW'],
    business: 1,
    cognitive: 1,
    write: async () => {
      const res = await agent().post(`/expenses/businesses/${ID.biz}/expenses`).set(HEADER, ID.owner)
        .send({ description: 'V70C-EXP-DRAW owner salary draw', amount: 7777.77, paymentMethod: 'cash' });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    },
  },
  {
    name: 'a bill the owner records over POST /finance/businesses/:id/bills (bill.created and expense.created)',
    module: 'expenses',
    types: ['bill.created', 'expense.created'],
    markers: ['6543.21', 'V70C-BILL-RENT'],
    business: 2,
    cognitive: 2,
    write: async () => {
      const res = await agent().post(`/finance/businesses/${ID.biz}/bills`).set(HEADER, ID.owner)
        .send({ description: 'V70C-BILL-RENT warehouse rent', amount: 6543.21, vendor: 'V70C Landlord' });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    },
  },
  {
    name: 'a budget alert forwarded by the bridge (budget.*; no domain emitter yet)',
    module: 'expenses',
    types: ['budget.threshold_reached'],
    markers: ['5555.55', 'V70C-BUDGET-PAYROLL'],
    business: 1,
    cognitive: 1,
    write: async () => {
      events.emit('budget.threshold_reached', {
        businessId: ID.biz,
        budget: { id: `${P}budget_1`, name: 'V70C-BUDGET-PAYROLL', amount: 5555.55, spent: 5600.01 },
      });
    },
  },
  {
    name: 'a Stripe payment (StripeConnector.emitPaymentReceived: payment.received)',
    module: 'revenue',
    types: ['payment.received'],
    markers: ['4321.09'],
    business: 1,
    cognitive: 1,
    write: async () => {
      await stripe.emitPaymentReceived(ID.biz, { amount: 4321.09, currency: 'TTD', invoiceId: `${P}inv_paid`, externalId: `${P}pi_1` });
    },
  },
  {
    name: 'an invoice, as CommerceService.createInvoice emits it (invoice.created)',
    module: 'revenue',
    types: ['invoice.created'],
    markers: ['8800.88', 'V70C-INV-0007'],
    business: 1,
    cognitive: 1,
    write: async () => {
      events.emit('invoice.created', {
        invoice: { id: `${P}inv_7`, businessId: ID.biz, invoiceNumber: 'V70C-INV-0007', total: 8800.88, currency: 'TTD', status: 'DRAFT' },
        businessId: ID.biz,
        source: 'manual',
        quoteId: null,
      });
    },
  },
  {
    name: 'a revenue action, as RevenueActionService.upsertAction emits it (revenue_action.created)',
    module: 'revenue',
    types: ['revenue_action.created'],
    markers: ['3210.98'],
    business: 1,
    cognitive: 1,
    write: async () => {
      events.emit('revenue_action.created', {
        businessId: ID.biz,
        actionId: `${P}ra_1`,
        type: 'OVERDUE_INVOICE',
        priority: 'HIGH',
        relatedType: 'invoice',
        relatedId: `${P}inv_ra`,
        amountAtRisk: 3210.98,
      });
    },
  },
  {
    name: 'an overdue invoice on the ledger (BusinessEventService: invoice.overdue) and its bridged copies',
    module: 'revenue',
    types: ['invoice.overdue'],
    markers: ['9100.5', 'V70C-INV-OVERDUE-0042'],
    business: 2,
    cognitive: 1,
    write: async () => {
      await businessEvents.emit({
        businessId: ID.biz,
        eventType: 'invoice.overdue',
        subjectType: 'invoice',
        subjectId: `${P}inv_42`,
        actorType: 'system',
        actorId: 'invoice_overdue_watcher',
        action: 'OVERDUE',
        source: 'worker',
        after: { number: 'V70C-INV-OVERDUE-0042', total: 9100.5, daysOverdue: 21 },
      });
    },
  },
  {
    name: "the overdue watcher's finding (InvoiceOverdueWatcherService.scan: proactive.invoice_overdue)",
    module: 'revenue',
    types: ['proactive.invoice_overdue'],
    markers: ['1234.56', 'V70C-INV-WATCH-0099'],
    business: 1,
    cognitive: 1,
    write: async () => {
      await db.invoice.create({
        data: { id: `${P}inv_99`, businessId: ID.biz, contactId: ID.customer, invoiceNumber: 'V70C-INV-WATCH-0099', total: 1234.56, status: 'SENT', dueDate: new Date(Date.now() - 9 * 86_400_000) },
      });
      try {
        expect(await watcher.scan(ID.biz)).toBe(1);
      } finally {
        await db.invoice.delete({ where: { id: `${P}inv_99` } });
      }
    },
  },
];

/** Who may read each module, by their membership (ModuleScopeGuard's reading); the SUPER_ADMIN has none here. */
const READS: Record<Reader, Record<'expenses' | 'revenue' | 'crm', boolean>> = {
  blind: { expenses: false, revenue: false, crm: true },
  revenue: { expenses: false, revenue: true, crm: true },
  staff: { expenses: true, revenue: true, crm: true },
  owner: { expenses: true, revenue: true, crm: true },
  admin: { expenses: false, revenue: false, crm: false },
};

describe('W1F-PERCEPTION-MODULE-SCOPE (SEC-W11FPS-3, D-71/D-146, D-57): perception follows module scopes', () => {
  it('premise: REST refuses the blind and the revenue-only member the expense routes, and lets the role-default STAFF member read them', async () => {
    for (const [who, status] of [[ID.blind, 403], [ID.revenue, 403], [ID.staff, 200], [ID.owner, 200]] as const) {
      const res = await agent().get(`/expenses/businesses/${ID.biz}/expenses`).set(HEADER, who);
      expect(res.status, `${who}: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(status);
    }
  });

  for (const family of MONEY) {
    it(`${family.name}: reaches the perception block over POST .../flow/chat and its stream only of a member who may read ${family.module} (the owner, the role-default STAFF member${family.module === 'revenue' ? ', the revenue-only member' : ''}); never a member whose ${family.module} scope is none, nor a SUPER_ADMIN who is no member; POST /cortex/chat's memory reads (buildMemoryContext, processQuery, streamQuery) follow the same rule`, async () => {
      await clearPerceivedStores();
      await family.write();
      await waitForRows(family.types, family.business, family.cognitive);
      try {
        for (const path of PATHS) {
          for (const reader of READERS) {
            const prompt = await turn(ID[reader], path);
            const label = `${reader} (${path})`;
            const lines = eventLines(prompt, family.types);
            if (READS[reader][family.module]) {
              // Control: the event renders, from both business-wide stores.
              expect(lines.some((l) => l.startsWith('- [business_event] ')), `${label}: ${observed(prompt).join(' | ')}`).toBe(true);
              expect(lines.some((l) => l.startsWith('- [cognitive_event] ')), `${label}: ${observed(prompt).join(' | ')}`).toBe(true);
            } else {
              expect(lines, label).toEqual([]);
              for (const marker of family.markers) expect(prompt, `${label}: ${marker}`).not.toContain(marker);
            }
            expect(prompt, label).toContain(FACT);
          }
        }
        // POST /cortex/chat: buildMemoryContext's block and the pipeline's own read, for a member who may not read the
        // module and for the role-default STAFF member who may (control).
        for (const reader of ['blind', 'staff'] as const) {
          const visible = READS[reader][family.module];
          const reads = [
            ['buildMemoryContext', await promptContextFor(ID[reader])],
            ['processQuery', await pipelinePromptFor(ID[reader], 'processQuery')],
            ['streamQuery', await pipelinePromptFor(ID[reader], 'streamQuery')],
          ] as const;
          for (const [label, block] of reads) {
            const lines = eventLines(block, family.types);
            if (visible) {
              expect(lines.length, `${reader} ${label}`).toBeGreaterThan(0);
            } else {
              expect(lines, `${reader} ${label}`).toEqual([]);
              for (const marker of family.markers) expect(block, `${reader} ${label}: ${marker}`).not.toContain(marker);
            }
          }
        }
        expect(flow.warnings.filter((w) => w.includes('perception'))).toEqual([]);
        expect(outbound, 'no outbound request').toEqual([]);
      } finally {
        await clearPerceivedStores();
      }
    }, 120_000);
  }

  it('a CRM event (contact.created) reaches every member who may read crm, the blind member included, and no SUPER_ADMIN who is no member; a GOVERNANCE_DECISION proposal (KeyCortexAuditService, and its bridged copies) stays business-wide: every reader gets it', async () => {
    await clearPerceivedStores();
    events.emit('contact.created', {
      contact: { id: `${P}contact_new`, businessId: ID.biz, firstName: 'V70C-CONTACT-ADA', lastName: 'Lovelace' },
      businessId: ID.biz,
    });
    await waitForRows(['contact.created'], 1, 1);
    try {
      for (const path of PATHS) {
        for (const reader of READERS) {
          const prompt = await turn(ID[reader], path);
          const lines = eventLines(prompt, ['contact.created']);
          if (READS[reader].crm) expect(lines.length, `${reader} (${path})`).toBe(2);
          else expect(lines, `${reader} (${path})`).toEqual([]);
        }
      }
    } finally {
      await clearPerceivedStores();
    }

    await audit.emit(
      'GOVERNANCE_DECISION',
      'propose',
      'key_action_proposal',
      `${P}proposal_1`,
      { businessId: ID.biz, actorType: 'ai', actorId: 'key_ai', source: 'ai', proposalId: `${P}proposal_1`, metadata: { toolName: 'v70c_tool', title: 'V70C-PROPOSAL' } },
      undefined,
      { status: 'PENDING', riskLevel: 'MEDIUM' },
    );
    await waitForRows(['GOVERNANCE_DECISION'], 2, 1);
    try {
      for (const path of PATHS) {
        for (const reader of READERS) {
          const prompt = await turn(ID[reader], path);
          expect(eventLines(prompt, ['GOVERNANCE_DECISION']).length, `${reader} (${path}): ${observed(prompt).join(' | ')}`).toBe(3);
        }
      }
      expect(outbound, 'no outbound request').toEqual([]);
    } finally {
      await clearPerceivedStores();
    }
  }, 120_000);
});

describe('W1F-PERCEPTION-MODULE-SCOPE, owner ruling D-203 (`supportdesk`): the Chatwoot support desk perceives only the conversation in front of it', () => {
  it("the desk's chat() and streamChat() (no member, no staff position) render no perception block and read no memory store at all, while the business holds money events, a CRM event, a proposal and a fact that an in-app member perceives (control)", async () => {
    await clearPerceivedStores();
    await MONEY[0].write();
    await MONEY[3].write();
    events.emit('contact.created', { contact: { id: `${P}contact_desk`, businessId: ID.biz, firstName: 'V70C-CONTACT-DESK' }, businessId: ID.biz });
    await audit.emit('GOVERNANCE_DECISION', 'propose', 'key_action_proposal', `${P}proposal_desk`, { businessId: ID.biz, proposalId: `${P}proposal_desk` }, undefined, { status: 'PENDING', riskLevel: 'LOW' });
    await waitForRows(['expense.created', 'payment.received', 'contact.created', 'GOVERNANCE_DECISION'], 5, 4);
    try {
      // Control: the owner in the app perceives the business.
      const owner = await turn(ID.owner, 'chat');
      expect(owner).toContain('WHAT YOU HAVE OBSERVED');
      expect(owner).toContain(FACT);

      for (const path of PATHS) {
        const before = flow.retrievals.count;
        const desk = await deskTurn(path);
        expect(flow.retrievals.count - before, `the desk (${path}) reads no memory store`).toBe(0);
        expect(desk, path).not.toContain('WHAT YOU HAVE OBSERVED');
        expect(observed(desk), path).toEqual([]);
        for (const marker of ['7777.77', 'V70C-EXP-DRAW', '4321.09', 'V70C-CONTACT-DESK', 'GOVERNANCE_DECISION', FACT]) {
          expect(desk, `${path}: ${marker}`).not.toContain(marker);
        }
      }
      expect(flow.warnings.filter((w) => w.includes('perception'))).toEqual([]);
      expect(outbound, 'no outbound request').toEqual([]);
    } finally {
      await clearPerceivedStores();
    }
  }, 120_000);
});

describe("W1F-PERCEPTION-MODULE-SCOPE, owner ruling D-202 (`bridgememory`): a staff member texting KEY perceives their own history, only their own, as their own scopes allow; the holder still grants nothing (D-73/D-88)", () => {
  const SAID = { owner: 'V70C-OWNER-SAID', blind: 'V70C-BLIND-SAID' };

  async function seedHistories() {
    for (const who of ['owner', 'blind'] as const) {
      await db.cortexActionLog.create({
        data: { businessId: ID.biz, userId: ID[who], sessionId: `${P}sess_${who}`, actionType: `v70c.${who}_action`, status: 'success', description: `v70c: the ${who}'s own episode` },
      });
      await db.aiExecutionLog.create({ data: { businessId: ID.biz, userId: ID[who], action: `v70c.${who}_exec`, success: true, rationale: `v70c: the ${who} asked` } });
      await db.cognitionMemory.create({
        data: { businessId: ID.biz, userId: ID[who], sessionId: `${P}sess_cog_${who}`, query: `${SAID[who]} typed: what did we sell?`, recommendation: `${SAID[who]} KEY answered`, userResponse: 'no_action', confidence: 0.9 },
      });
    }
  }

  it("the blind member's WhatsApp message (the real Twilio webhook, WhatsAppService, StaffChatBridgeService, the position's verified holder) perceives their own CortexActionLog, AiExecutionLog and cognition rows, as they do in the app (control), and not the owner's; no money event their scopes refuse; and the turn still names no member: the standing context has no viewer, the tool menu no user, and the conversation is saved for no one", async () => {
    await clearPerceivedStores();
    await seedHistories();
    await MONEY[0].write();
    await MONEY[3].write();
    await waitForRows(['expense.created', 'payment.received'], 2, 2);
    try {
      // Control: the same member in the app.
      const inApp = await turn(ID.blind, 'chat');
      for (const own of ['v70c.blind_action', 'v70c.blind_exec', `${SAID.blind} typed`]) expect(inApp, `in app: ${own}`).toContain(own);

      flow.snapshotViewers.length = 0;
      flow.toolSelectionUsers.length = 0;
      flow.savedHistories.length = 0;
      const texted = await bridgeTurn(PHONE.blind);
      for (const own of ['v70c.blind_action', 'v70c.blind_exec', `${SAID.blind} typed`]) expect(texted, `bridge: ${own}`).toContain(own);
      for (const other of ['v70c.owner_action', 'v70c.owner_exec', SAID.owner]) expect(texted, `bridge: ${other}`).not.toContain(other);
      expect(eventLines(texted, ['expense.created', 'payment.received']), 'bridge: money events').toEqual([]);
      for (const marker of ['7777.77', 'V70C-EXP-DRAW', '4321.09']) expect(texted, `bridge: ${marker}`).not.toContain(marker);
      expect(texted).toContain(FACT);

      // D-73/D-88: the holder is the perception reader only. The turn has no principal.
      expect(flow.snapshotViewers, 'the standing context is read for no viewer').toEqual([null]);
      expect(flow.toolSelectionUsers, 'the tool menu is chosen for no user').toEqual([undefined]);
      // saveConversationHistory(businessId, sessionId, messages, userId): the conversation's owner.
      expect(flow.savedHistories.map((args) => args[3]), 'the conversation is saved for no one').toEqual([undefined]);
      expect(flow.warnings.filter((w) => w.includes('perception'))).toEqual([]);
      expect(outbound, 'no outbound request').toEqual([]);
    } finally {
      await clearPerceivedStores();
    }
  }, 120_000);

  it("a contact-only position's message (no holder) perceives nobody's history, no money event and no CRM event (no member, so no module scope), and still the business-wide proposal and fact", async () => {
    await clearPerceivedStores();
    await seedHistories();
    await MONEY[3].write();
    events.emit('contact.created', { contact: { id: `${P}contact_bridge`, businessId: ID.biz, firstName: 'V70C-CONTACT-BRIDGE' }, businessId: ID.biz });
    await audit.emit('GOVERNANCE_DECISION', 'propose', 'key_action_proposal', `${P}proposal_bridge`, { businessId: ID.biz, proposalId: `${P}proposal_bridge` }, undefined, { status: 'PENDING', riskLevel: 'LOW' });
    await waitForRows(['payment.received', 'contact.created', 'GOVERNANCE_DECISION'], 4, 3);
    try {
      const texted = await bridgeTurn(PHONE.contact);
      for (const other of ['v70c.owner_', 'v70c.blind_', SAID.owner, SAID.blind]) expect(texted, other).not.toContain(other);
      expect(observed(texted).filter((l) => /^- \[(cognition_memory|cortex_action_log|ai_execution_log)\]/.test(l))).toEqual([]);
      expect(eventLines(texted, ['payment.received', 'contact.created'])).toEqual([]);
      expect(texted).not.toContain('4321.09');
      expect(texted).not.toContain('V70C-CONTACT-BRIDGE');
      expect(eventLines(texted, ['GOVERNANCE_DECISION']).length, observed(texted).join(' | ')).toBe(3);
      expect(texted).toContain(FACT);
      expect(outbound, 'no outbound request').toEqual([]);
    } finally {
      await clearPerceivedStores();
    }
  }, 120_000);
});
