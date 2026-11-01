/**
 * R0-09c-KEY-ACTOR-BINDING — KEY commands are attributed to the authenticated
 * member (REAL database). R0-09-ID-HARDEN review R09-ST-4 and CR-3; R0-34b
 * review ST-3. K2 Human Authority and the audit trail: an action names the
 * human who caused it.
 *
 * KeyCortexController is mounted at `/api/v1/cortex` behind AuthGuard and
 * BusinessGuard. At the base it took the ACTOR from the request, not from the
 * principal AuthGuard admitted:
 *   - POST execute and POST batch built the ConnectorCommand with
 *     `userId: dto.userId ?? 'system'`; POST query passed no actor at all and
 *     POST rollback named 'system'. So a STAFF member attributed a command to
 *     the OWNER, or to nobody;
 *   - POST sessions, POST chat, POST conscious/chat and POST feedback (body
 *     `userId`) and GET conscious/stream, chat/stream and stream (query
 *     `userId`, stream defaulting to 'key_user') handed the session, reasoning
 *     and learning services the request's user, so a member of A wrote a
 *     CortexSession under A attributed to a user outside A; GET sessions listed
 *     the sessions of whichever user the query named.
 * And SettingsAdapterService ran settings.update_business_profile and
 * settings.update_branding through IdentityService.updateBusiness with no owner
 * check, so a STAFF command changed the name, timezone, currency and branding
 * that PATCH /identity/businesses/:id refuses it (owner ruling D-11).
 *
 * Required, and pinned here: every handler takes the actor from req.user. A
 * body or query `userId` naming someone else is IGNORED (not refused): the
 * request runs as the authenticated member. With no authenticated user the
 * request is 401 and nothing reaches the executor (never 'system'). The settings
 * adapter applies IdentityService.assertBusinessOwner on the command's actor:
 * a STAFF or ADMIN command answers 200 with the adapter's failure shape
 * (`result.success: false`, the owner-only message) and leaves the Business row
 * byte-identical; the OWNER (membership or Business.ownerId) and SUPER_ADMIN
 * (the platform bypass BusinessGuard and the PATCH grant) succeed.
 *
 * Out of scope (V1-03-KEY-CORTEX-PRINCIPAL, blocked on D-17): who may change
 * autonomy tiers and the kill switch, and evaluateAction's proposedBy wiring
 * beyond receiving the authenticated id (the stand-in below only records it).
 *
 * WHAT IS REAL: PrismaService, AuthGuard, BusinessGuard, TenantInterceptor and
 * the Prisma tenant extension (the production pipeline, main.ts), the
 * production GlobalHttpExceptionFilter and ValidationPipe, KeyCortexController,
 * KeyCortexExecutorService, KeyCortexConnectorService (routing), the
 * SettingsAdapterService over the real IdentityService (assertBusinessOwner,
 * updateBusiness), KeyCortexCommandService.toConnectorCommand,
 * KeyCortexConversationService and KeyCortexSessionService (session rows) and
 * KeyCortexLearningService (feedback rows), against DATABASE_URL. Stand-ins:
 * identity attachment (a test middleware reads `x-k34c-user` and attaches the
 * seeded user row, as AuthMiddleware does after token verification); Redis (an
 * in-memory get/set/setex/del map, as in R0-34b); the autonomy orchestrator
 * (allows, recording the proposedBy it is handed; out of scope above); the
 * natural-language parser (KeyCortexCommandService.parseIntent answers one
 * settings intent at once, recording the user it is handed: no model call);
 * the reasoning engine and the consciousness pipeline (answer at once,
 * recording the user and session they are handed, exactly as R0-34b's suite
 * does); the blueprint mirror and the default-trigger seeder IdentityService
 * holds; the integration hub (records what settings.configure_integration
 * reaches; no provider is contacted); globalThis.fetch (recorded and refused);
 * and the collaborators the controller holds for its other routes (an
 * allow-listed mocker). Vitest's esbuild transform emits no parameter types,
 * so the suite writes the ones tsc
 * emits for the controller's constructor and for the handlers it drives
 * (key-cortex.controller.spec.ts checks them against tsc's own output).
 *
 * Every seeded row carries the `k34c_` prefix and is hard-deleted by raw SQL
 * with sqlLikePrefix() in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k34c_';
const HEADER = 'x-k34c-user';

const ID = {
  ownerA: `${P}ownerA`, // OWNER membership of bizA and Business.ownerId
  staffA: `${P}staffA`, // STAFF of bizA, role-default scopes (settings: none)
  adminA: `${P}adminA`, // ADMIN of bizA, explicitly granted settings: write
  outsider: `${P}outsider`, // OWNER of bizB, no membership of bizA
  superAdmin: `${P}super`, // role SUPER_ADMIN, no membership
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  sessionOwnerA: `${P}session_ownerA`,
  sessionStaffA: `${P}session_staffA`,
  sessionOutsiderB: `${P}session_outsiderB`,
};

/** What each seeded session holds, so a read of someone else's session is visible in the response body. */
const OWNER_PRIVATE = 'k34c OWNER private note';
const STAFF_NOTE = 'k34c STAFF own note';
const B_PRIVATE = 'k34c B private note';
const note = (id: string, content: string) => ({ id, role: 'user', content, timestamp: '2026-10-31T00:00:00.000Z', metadata: {} });

const A_PROFILE = { name: 'K34C Biz A', timezone: 'UTC', currency: 'USD' };
const A_BRANDING = { primaryColor: '#111111', logoUrl: 'https://k34c.test/logo-a.png' };
/** What a non-owner tries to write. */
const HIJACK = { name: `${P}hijacked name`, timezone: 'Pacific/Kiritimati', currency: 'JPY' };
const BRAND_HIJACK = { primaryColor: '#ff0000', logoUrl: 'https://k34c.test/hijack.png', emailSignature: 'k34c hijack' };
const OWNER_ONLY = /Only the business owner can edit the business profile/;

/** The controller's collaborators for its other routes; the routes under test reach none of them. */
const OFF_BOUNDARY = new Set([
  'KeyCortexVoiceService', 'KeyCortexPersonalityService', 'KeyCortexActionsService',
  'KeyCortexInsightService', 'KeyCortexMonitorV2Service', 'KeyCortexSandboxService', 'KeyCortexFlowStudioService',
  'KeyCortexEvolutionService', 'KeyCortexPhoneService', 'KeyCortexDocumentService', 'KeyAutonomySafetyService',
  'KeyCortexApprovalOrchestratorService', 'KeyCortexAwarenessService',
]);

interface CommandSeen { module: unknown; action: unknown; businessId: unknown; userId: unknown }

let db: any;
let app: any;
let executor: any;
let connector: any;
let settingsAdapter: any;
/** Every ConnectorCommand the real connector routed (what an adapter receives). */
const connectorCommands: CommandSeen[] = [];
/** Every batch the real executor was handed, as its commands. */
const batches: CommandSeen[][] = [];
/** Every command the real executor was asked to roll back. */
const rollbacks: CommandSeen[] = [];
/** Every verdict request the autonomy orchestrator stand-in received. */
const autonomyCalls: Array<{ businessId: unknown; actionType: unknown; proposedBy: unknown }> = [];
/** Every natural-language parse, with the user it was handed. */
const parseCalls: Array<{ text: unknown; businessId: unknown; userId: unknown }> = [];
/** Every query the reasoning engine was handed (chat, chat/stream, stream). */
const reasoningCalls: Array<{ method: string; businessId: unknown; userId: unknown; sessionId?: unknown }> = [];
/** Every session the consciousness pipeline was handed (conscious/chat, conscious/stream). */
const consciousCalls: Array<{ sessionId: unknown; businessId: unknown; userId: unknown }> = [];
/** Every call the integration hub stand-in received (settings.configure_integration). */
const integrationCalls: unknown[][] = [];
/** Every globalThis.fetch the process attempted during the suite (refused). */
const outbound: string[] = [];
const cache = new Map<string, string>();

const seen = (c: any): CommandSeen => ({ module: c?.module, action: c?.action, businessId: c?.businessId, userId: c?.userId });

/** Redis's get/set/setex/del over a map (TTL ignored), as in key-cortex-tenant-binding. */
function inMemoryRedis(store: Map<string, string>) {
  const io = () => new Promise<void>((r) => setImmediate(r));
  return new Proxy({}, {
    get: (_target, prop) => {
      if (prop === 'then') return undefined;
      if (prop === 'get') return async (key: string) => { await io(); return store.get(key) ?? null; };
      if (prop === 'set') return async (key: string, value: unknown) => { await io(); store.set(key, String(value)); return 'OK'; };
      if (prop === 'setex') return async (key: string, _ttl: number, value: unknown) => { await io(); store.set(key, String(value)); return 'OK'; };
      if (prop === 'del') return async (...keys: string[]) => { await io(); return keys.flat().filter((k) => store.delete(k)).length; };
      return async () => null;
    },
  });
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM cognition_memories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM cortex_sessions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_execution_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** The Business row exactly as Postgres stores it, so "unchanged" means byte-identical. */
async function businessRowText(id: string): Promise<string> {
  const rows = await db.$queryRawUnsafe('SELECT row_to_json(b)::text AS j FROM businesses b WHERE b.id = $1', id);
  expect(rows.length, `business ${id} exists`).toBe(1);
  return rows[0].j as string;
}

function post(path: string, user: string | undefined, body: Record<string, unknown>) {
  let req = request(app.getHttpServer()).post(`/api/v1/cortex/${path}`);
  if (user) req = req.set(HEADER, user);
  return req.send(body);
}

/** Collect a streamed (text/event-stream) response as text until it ends. */
function collectText(res: any, cb: (err: Error | null, body: string) => void) {
  let data = '';
  res.setEncoding('utf8');
  res.on('data', (chunk: string) => { data += chunk; });
  res.on('end', () => cb(null, data));
}

function sse(path: string, user: string, query: Record<string, string>) {
  return request(app.getHttpServer())
    .get(`/api/v1/cortex/${path}`)
    .set(HEADER, user)
    .query(query)
    .buffer(true)
    .parse(collectText);
}

const structured = (action: string, parameters: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  businessId: ID.bizA, command: '', module: 'settings', action, parameters, ...extra,
});

/**
 * The commands the connector routed since `from`: the settings command itself,
 * then at most the compensating command the executor tries after a failure
 * (rollbackOnFailure: `revert_<action>`, which the adapter does not know), all
 * for `userId`.
 */
function expectRouted(from: number, action: string, userId: string) {
  const routed = connectorCommands.slice(from);
  expect(routed.length, JSON.stringify(routed)).toBeGreaterThanOrEqual(1);
  expect(routed.length, JSON.stringify(routed)).toBeLessThanOrEqual(2);
  expect(routed[0]).toEqual({ module: 'settings', action, businessId: ID.bizA, userId });
  for (const c of routed.slice(1)) expect(c).toEqual({ module: 'settings', action: `revert_${action}`, businessId: ID.bizA, userId });
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const tenant = await import('../src/core/tenant/tenant-context');
  // As main.ts does before the app serves: the extension reads the ambient
  // tenant that TenantInterceptor installs.
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { APP_INTERCEPTOR } = await import('@nestjs/core');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { IdentityService } = await import('../src/modules/identity/identity.service');
  const { SettingsAdapterService } = await import('../src/modules/key-cortex/adapters/settings-adapter.service');
  const controllerModule: any = await import('../src/modules/key-cortex/key-cortex.controller');
  const { KeyCortexController } = controllerModule;
  const { KeyCortexReasoningService } = await import('../src/modules/key-cortex/key-cortex-reasoning.service');
  const { KeyCortexConversationService } = await import('../src/modules/key-cortex/key-cortex-conversation.service');
  const { KeyCortexVoiceService } = await import('../src/modules/key-cortex/key-cortex-voice.service');
  const { KeyCortexPersonalityService } = await import('../src/modules/key-cortex/key-cortex-personality.service');
  const { KeyCortexActionsService } = await import('../src/modules/key-cortex/key-cortex-actions.service');
  const { KeyCortexContextService } = await import('../src/modules/key-cortex/key-cortex-context.service');
  const { KeyCortexConnectorService } = await import('../src/modules/key-cortex/key-cortex-connector.service');
  const { KeyCortexCommandService } = await import('../src/modules/key-cortex/key-cortex-command.service');
  const { KeyCortexExecutorService } = await import('../src/modules/key-cortex/key-cortex-executor.service');
  const { KeyCortexContextV2Service } = await import('../src/modules/key-cortex/key-cortex-context-v2.service');
  const { KeyCortexInsightService } = await import('../src/modules/key-cortex/key-cortex-insight.service');
  const { KeyCortexMonitorV2Service } = await import('../src/modules/key-cortex/key-cortex-monitor-v2.service');
  const { KeyCortexSandboxService } = await import('../src/modules/key-cortex/key-cortex-sandbox.service');
  const { KeyCortexFlowStudioService } = await import('../src/modules/key-cortex/key-cortex-flow-studio.service');
  const { KeyCortexEvolutionService } = await import('../src/modules/key-cortex/key-cortex-evolution.service');
  const { KeyCortexPhoneService } = await import('../src/modules/key-cortex/key-cortex-phone.service');
  const { KeyCortexDocumentService } = await import('../src/modules/key-cortex/key-cortex-document.service');
  const { KeyCortexLearningService } = await import('../src/modules/key-cortex/key-cortex-learning.service');
  const { KeyAutonomySafetyService } = await import('../src/modules/key-autonomy/key-autonomy-safety.service');
  const { KeyCortexApprovalOrchestratorService } = await import('../src/modules/key-cortex/key-cortex-approval-orchestrator.service');
  const { KeyCortexConsciousnessService } = await import('../src/modules/key-cortex/key-cortex-consciousness.service');
  const { KeyCortexSessionService } = await import('../src/modules/key-cortex/key-cortex-session.service');
  const { KeyCortexAwarenessService } = await import('../src/modules/key-cortex/key-cortex-awareness.service');

  // The production build (tsc, emitDecoratorMetadata) records the constructor
  // parameter types Nest injects by; vitest's esbuild transform does not. This
  // writes exactly what tsc emits (and leaves the class alone if it is there),
  // as key-cortex-tenant-binding does.
  if (!Reflect.getMetadata('design:paramtypes', KeyCortexController)) {
    Reflect.defineMetadata('design:paramtypes', [
      KeyCortexReasoningService, KeyCortexConversationService, KeyCortexVoiceService, KeyCortexPersonalityService,
      KeyCortexActionsService, KeyCortexContextService, KeyCortexConnectorService, KeyCortexCommandService,
      KeyCortexExecutorService, KeyCortexContextV2Service, KeyCortexInsightService, KeyCortexMonitorV2Service,
      KeyCortexSandboxService, KeyCortexFlowStudioService, KeyCortexEvolutionService, KeyCortexPhoneService,
      KeyCortexDocumentService, KeyCortexLearningService, KeyAutonomySafetyService, KeyCortexApprovalOrchestratorService,
      KeyCortexConsciousnessService, KeyCortexSessionService, KeyCortexAwarenessService,
    ], KeyCortexController);
  }
  // The handler parameter types the ValidationPipe reads, for the handlers this
  // suite drives: the body class, then the principal (an interface, emitted as
  // Object). A DTO class the controller does not export is left unwritten, so
  // that body reaches the handler unvalidated here.
  const emitHandler = (method: string, types: unknown[]) => {
    if (types.some((t) => t === undefined)) return;
    if (!Reflect.getMetadata('design:paramtypes', KeyCortexController.prototype, method)) {
      Reflect.defineMetadata('design:paramtypes', types, KeyCortexController.prototype, method);
    }
  };
  emitHandler('executeCommand', [controllerModule.ExecuteCommandDto, Object]);
  emitHandler('executeBatch', [controllerModule.ExecuteBatchDto, Object]);
  emitHandler('queryModule', [controllerModule.QueryModuleDto, Object]);
  emitHandler('rollback', [controllerModule.RollbackDto, Object]);
  emitHandler('createSession', [controllerModule.CreateSessionDto, Object]);
  emitHandler('chat', [controllerModule.ChatQueryDto, Object]);
  emitHandler('recordFeedback', [controllerModule.FeedbackDto, Object]);
  emitHandler('consciousChat', [controllerModule.ConsciousChatDto, Object]);
  emitHandler('consciousStream', [controllerModule.ConsciousChatDto, String, Object]);

  // Stand-ins (see the header).
  const autonomy = {
    evaluateAction: async (businessId: unknown, actionType: unknown, _params: unknown, opts?: { proposedBy?: unknown }) => {
      autonomyCalls.push({ businessId, actionType, proposedBy: opts?.proposedBy });
      return { allowed: true, requiresApproval: false };
    },
  };
  const legacyGateOff = { checkGate: async () => { throw new Error('k34c: the legacy autonomy gate is off this path'); } };
  const events = { emit: () => true };
  const registry = { getAllCapabilities: () => [], getCapabilities: () => [], formatCapabilitiesForPrompt: () => '' };
  const blueprint = { inferFromOnboarding: async () => undefined };
  const defaultTriggers = { seedForBusiness: async () => 0 };
  // Records what settings.configure_integration reaches (no provider is contacted).
  const integrationsOff = {
    createConnection: async (...args: unknown[]) => { integrationCalls.push(['createConnection', ...args.slice(0, 2)]); return { id: `${P}conn` }; },
    disconnect: async (...args: unknown[]) => { integrationCalls.push(['disconnect', ...args.slice(0, 2)]); return undefined; },
  };
  const reasoning = {
    processQuery: async (q: any) => {
      reasoningCalls.push({ method: 'processQuery', businessId: q?.businessId, userId: q?.userId, sessionId: q?.sessionId });
      return { text: 'k34c answer' };
    },
    streamQuery: async function* (q: any) {
      reasoningCalls.push({ method: 'streamQuery', businessId: q?.businessId, userId: q?.userId, sessionId: q?.sessionId });
      yield { type: 'text_delta', content: 'k34c answer' };
      yield { type: 'done' };
    },
  };
  const consciousness = {
    processConsciously: async (_text: string, session: any, onPhase?: (p: unknown) => void) => {
      consciousCalls.push({ sessionId: session?.id, businessId: session?.businessId, userId: session?.userId });
      onPhase?.({ phase: 'k34c', summary: 'k34c phase' });
      return { text: 'k34c answer', meta: {} };
    },
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [KeyCortexController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      {
        provide: IdentityService,
        useFactory: (prisma: any) => new IdentityService(prisma, blueprint as any, defaultTriggers as any),
        inject: [PrismaService],
      },
      {
        provide: SettingsAdapterService,
        useFactory: (identity: any, prisma: any) => new SettingsAdapterService(identity, integrationsOff as any, prisma),
        inject: [IdentityService, PrismaService],
      },
      {
        // registry, context assembly, the 16 adapters ahead of settings (all off this path), settings, bridge.
        provide: KeyCortexConnectorService,
        useFactory: (settings: any) => new (KeyCortexConnectorService as any)(
          registry, {}, ...Array.from({ length: 16 }, () => ({})), settings, {},
        ),
        inject: [SettingsAdapterService],
      },
      {
        provide: KeyCortexExecutorService,
        useFactory: (conn: any, prisma: any) => new KeyCortexExecutorService(
          conn, prisma, events as any, legacyGateOff as any, autonomy as any, undefined, undefined,
        ),
        inject: [KeyCortexConnectorService, PrismaService],
      },
      {
        provide: KeyCortexCommandService,
        useFactory: (conn: any) => new KeyCortexCommandService({} as any, conn, {} as any),
        inject: [KeyCortexConnectorService],
      },
      { provide: KeyCortexContextV2Service, useValue: { getFullContext: async () => ({}) } },
      { provide: KeyCortexContextService, useValue: { buildContextSnapshot: async () => ({ k34c: true }) } },
      {
        provide: KeyCortexConversationService,
        useFactory: (prisma: any) => new KeyCortexConversationService(prisma, inMemoryRedis(cache) as any),
        inject: [PrismaService],
      },
      {
        provide: KeyCortexSessionService,
        useFactory: (prisma: any) => new KeyCortexSessionService(prisma, inMemoryRedis(cache) as any),
        inject: [PrismaService],
      },
      {
        provide: KeyCortexLearningService,
        useFactory: (prisma: any) => new KeyCortexLearningService(prisma),
        inject: [PrismaService],
      },
      { provide: KeyCortexReasoningService, useValue: reasoning },
      { provide: KeyCortexConsciousnessService, useValue: consciousness },
      // Installed globally in production (app.module.ts).
      { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
    ],
  })
    .useMocker((token: any) => {
      const name = typeof token === 'function' ? token.name : String(token);
      return OFF_BOUNDARY.has(name) ? {} : undefined;
    })
    .compile();

  executor = moduleRef.get(KeyCortexExecutorService);
  connector = moduleRef.get(KeyCortexConnectorService);
  settingsAdapter = moduleRef.get(SettingsAdapterService);
  const command = moduleRef.get(KeyCortexCommandService);

  // Record (and call through) what the real services are handed.
  const connectorExecute = connector.execute.bind(connector);
  vi.spyOn(connector, 'execute').mockImplementation(async (c: any) => {
    connectorCommands.push(seen(c));
    return connectorExecute(c);
  });
  const executeBatch = executor.executeBatch.bind(executor);
  vi.spyOn(executor, 'executeBatch').mockImplementation(async (cmds: any[], opts: any) => {
    batches.push(cmds.map(seen));
    return executeBatch(cmds, opts);
  });
  const rollback = executor.rollback.bind(executor);
  vi.spyOn(executor, 'rollback').mockImplementation(async (result: any) => {
    rollbacks.push(seen(result?.command));
    return rollback(result);
  });
  // The parser answers one settings intent at once (no model call), recording the user it was handed.
  vi.spyOn(command, 'parseIntent').mockImplementation(async (text: string, ctx: any) => {
    parseCalls.push({ text, businessId: ctx?.businessId, userId: ctx?.userId });
    return [{
      intent: 'update_business_profile', confidence: 0.9, module: 'settings', action: 'update_business_profile',
      parameters: { ...HIJACK }, requiresApproval: false, naturalLanguage: text,
    }] as any;
  });

  app = moduleRef.createNestApplication();
  // Identity attachment only, for seeded k34c_ users. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  // Same filter and pipe as app-bootstrap.ts, so status codes and bodies are the production ones.
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup(); // in case a prior run aborted

  for (const [id, role] of [
    [ID.ownerA, 'USER'],
    [ID.staffA, 'USER'],
    [ID.adminA, 'USER'],
    [ID.outsider, 'USER'],
    [ID.superAdmin, 'SUPER_ADMIN'],
  ] as const) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role } });
  }
  await db.business.create({ data: { id: ID.bizA, ownerId: ID.ownerA, ...A_PROFILE, ...A_BRANDING } });
  await db.business.create({ data: { id: ID.bizB, name: 'K34C Biz B', ownerId: ID.outsider } });
  await db.membership.create({ data: { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_staffA`, userId: ID.staffA, businessId: ID.bizA, role: 'STAFF' } });
  await db.membership.create({ data: { id: `${P}m_adminA`, userId: ID.adminA, businessId: ID.bizA, role: 'ADMIN', permissionScopes: { settings: 'write' } } });
  await db.membership.create({ data: { id: `${P}m_outsider`, userId: ID.outsider, businessId: ID.bizB, role: 'OWNER' } });
  await db.cortexSession.create({ data: { id: ID.sessionOwnerA, businessId: ID.bizA, userId: ID.ownerA, title: 'k34c owner session', messages: [note(`${P}msg_owner`, OWNER_PRIVATE)] } });
  await db.cortexSession.create({ data: { id: ID.sessionStaffA, businessId: ID.bizA, userId: ID.staffA, title: 'k34c staff session', messages: [note(`${P}msg_staff`, STAFF_NOTE)] } });
  await db.cortexSession.create({ data: { id: ID.sessionOutsiderB, businessId: ID.bizB, userId: ID.outsider, title: 'k34c B session', messages: [note(`${P}msg_b`, B_PRIVATE)] } });

  // No case below may reach a real provider: every global fetch is recorded and refused.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
    outbound.push(typeof input === 'string' ? input : String(input?.url ?? input));
    throw new Error('k34c: outbound traffic is refused in this suite');
  });
}, 180_000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (executor?.approvalCleanupInterval) clearInterval(executor.approvalCleanupInterval);
  if (app) await app.close();
  if (db) await cleanup();
  const dbMod = await import('@keyflow/db');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: () => undefined });
});

describe('fixture sanity (real rows)', () => {
  it('A has an OWNER (membership and Business.ownerId), a STAFF member and an ADMIN granted settings:write; the outsider owns B with no membership of A', async () => {
    const roles = await db.membership.findMany({ where: { businessId: ID.bizA }, select: { userId: true, role: true } });
    expect(Object.fromEntries(roles.map((m: any) => [m.userId, m.role]))).toEqual({ [ID.ownerA]: 'OWNER', [ID.staffA]: 'STAFF', [ID.adminA]: 'ADMIN' });
    expect(await db.business.findUnique({ where: { id: ID.bizA } })).toMatchObject({ ownerId: ID.ownerA, ...A_PROFILE, ...A_BRANDING });
    expect(await db.membership.count({ where: { userId: ID.outsider, businessId: ID.bizA } })).toBe(0);
    expect(await db.cortexSession.count({ where: { businessId: ID.bizA } })).toBe(2);
  });

  it('the real connector routes settings commands to the real settings adapter', () => {
    expect(connector.adapterMap.settings).toBe(settingsAdapter);
  });
});

describe('POST execute attributes the command to the authenticated member, never to a body userId or to system (review R09-ST-4)', () => {
  it("RED-BEFORE: a STAFF member naming the OWNER as body userId (settings.update_business_profile): 200, the command names the STAFF member, the adapter refuses, and the profile is byte-identical", async () => {
    const before = await businessRowText(ID.bizA);
    const from = { connector: connectorCommands.length, autonomy: autonomyCalls.length };
    const res = await post('execute', ID.staffA, structured('update_business_profile', HIJACK, { userId: ID.ownerA }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expectRouted(from.connector, 'update_business_profile', ID.staffA);
    expect(autonomyCalls.slice(from.autonomy).map((c) => c.proposedBy)).toEqual([ID.staffA]);
    expect(res.body.result).toMatchObject({ success: false });
    expect(String(res.body.result.error)).toMatch(OWNER_ONLY);
    expect(await businessRowText(ID.bizA)).toBe(before);
  });

  it("RED-BEFORE: a STAFF member sending no userId runs as that member, never as 'system': 200, the command names the STAFF member", async () => {
    const before = await businessRowText(ID.bizA);
    const from = connectorCommands.length;
    const res = await post('execute', ID.staffA, structured('update_business_profile', HIJACK));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expectRouted(from, 'update_business_profile', ID.staffA);
    expect(String(res.body.result.error)).toMatch(OWNER_ONLY);
    expect(await businessRowText(ID.bizA)).toBe(before);
  });

  it('RED-BEFORE: the natural-language path parses and builds the command for the STAFF member, not the body userId, and the profile is unchanged', async () => {
    const before = await businessRowText(ID.bizA);
    const from = { parse: parseCalls.length, connector: connectorCommands.length };
    const res = await post('execute', ID.staffA, { businessId: ID.bizA, command: 'rename the business (k34c)', userId: ID.ownerA });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(parseCalls.slice(from.parse).map((c) => c.userId)).toEqual([ID.staffA]);
    expectRouted(from.connector, 'update_business_profile', ID.staffA);
    expect(String(res.body.result.error)).toMatch(OWNER_ONLY);
    expect(await businessRowText(ID.bizA)).toBe(before);
  });

  it('RED-BEFORE: POST query (a direct module query) names the STAFF member, so settings.update_business_profile is refused and the profile is unchanged', async () => {
    const before = await businessRowText(ID.bizA);
    const from = connectorCommands.length;
    const res = await post('query', ID.staffA, { businessId: ID.bizA, module: 'settings', query: 'update_business_profile', parameters: HIJACK });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(connectorCommands.slice(from).map((c) => c.userId)).toEqual([ID.staffA]);
    expect(res.body).toMatchObject({ success: false });
    expect(String(res.body.error)).toMatch(OWNER_ONLY);
    expect(await businessRowText(ID.bizA)).toBe(before);
  });

  it("RED-BEFORE: POST rollback names the authenticated member, never 'system'", async () => {
    const from = rollbacks.length;
    const res = await post('rollback', ID.staffA, { businessId: ID.bizA, correlationId: `${P}corr`, reason: 'k34c' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(rollbacks.slice(from).map((c) => c.userId)).toEqual([ID.staffA]);
  });
});

describe('POST batch attributes every command to the authenticated member (review R09-ST-4)', () => {
  it('RED-BEFORE: a structured and a natural command in one batch, the body naming the OWNER, both name the STAFF member and the profile is unchanged', async () => {
    const before = await businessRowText(ID.bizA);
    const from = { batches: batches.length, parse: parseCalls.length, connector: connectorCommands.length };
    const res = await post('batch', ID.staffA, {
      businessId: ID.bizA,
      userId: ID.ownerA,
      commands: [
        { type: 'structured', module: 'settings', action: 'update_branding', parameters: BRAND_HIJACK },
        { type: 'natural', command: 'rename the business (k34c batch)' },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(batches.slice(from.batches).map((b) => b.map((c) => c.userId))).toEqual([[ID.staffA, ID.staffA]]);
    expect(parseCalls.slice(from.parse).map((c) => c.userId)).toEqual([ID.staffA]);
    // The executor stops a batch at its first failure, so the refused first command is the only one routed.
    const routed = connectorCommands.slice(from.connector);
    expect(routed.length).toBeGreaterThanOrEqual(1);
    for (const c of routed) expect(c.userId).toBe(ID.staffA);
    expect(res.body.summary).toMatchObject({ succeeded: 0 });
    expect(await businessRowText(ID.bizA)).toBe(before);
  });
});

describe('with no authenticated user the KEY command routes answer 401 and nothing reaches the executor', () => {
  it('execute, batch, query and rollback without an identity: 401, no command routed, batched or rolled back', async () => {
    const from = { connector: connectorCommands.length, batches: batches.length, rollbacks: rollbacks.length };
    for (const [path, body] of [
      ['execute', structured('update_business_profile', HIJACK, { userId: ID.ownerA })],
      ['batch', { businessId: ID.bizA, userId: ID.ownerA, commands: [{ type: 'structured', module: 'settings', action: 'update_business_profile', parameters: HIJACK }] }],
      ['query', { businessId: ID.bizA, module: 'settings', query: 'update_business_profile', parameters: HIJACK }],
      ['rollback', { businessId: ID.bizA, correlationId: `${P}corr` }],
    ] as const) {
      const res = await post(path, undefined, body as Record<string, unknown>);
      expect(res.status, `${path} ${JSON.stringify(res.body)}`).toBe(401);
    }
    expect(connectorCommands.length).toBe(from.connector);
    expect(batches.length).toBe(from.batches);
    expect(rollbacks.length).toBe(from.rollbacks);
  });

  it("a member of B only naming A (the OWNER's id in the body) is refused 403 by BusinessGuard and nothing runs", async () => {
    const before = await businessRowText(ID.bizA);
    const from = connectorCommands.length;
    const res = await post('execute', ID.outsider, structured('update_business_profile', HIJACK, { userId: ID.ownerA }));
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(connectorCommands.length).toBe(from);
    expect(await businessRowText(ID.bizA)).toBe(before);
  });
});

describe('the KEY settings adapter applies the D-11 owner rule on the command actor (review CR-3)', () => {
  it("RED-BEFORE: a STAFF member's own settings.update_business_profile answers 200 with the adapter's failure shape; name, timezone and currency unchanged", async () => {
    const before = await businessRowText(ID.bizA);
    const res = await post('execute', ID.staffA, structured('update_business_profile', HIJACK, { userId: ID.staffA }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toMatchObject({ success: false, command: { module: 'settings', action: 'update_business_profile', userId: ID.staffA } });
    expect(String(res.body.result.error)).toMatch(OWNER_ONLY);
    expect(await businessRowText(ID.bizA)).toBe(before);
  });

  it("RED-BEFORE: a STAFF member's settings.update_branding is refused the same way; primaryColor, logoUrl and the email signature unchanged", async () => {
    const before = await businessRowText(ID.bizA);
    const res = await post('execute', ID.staffA, structured('update_branding', BRAND_HIJACK, { userId: ID.staffA }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toMatchObject({ success: false });
    expect(String(res.body.result.error)).toMatch(OWNER_ONLY);
    expect(await businessRowText(ID.bizA)).toBe(before);
  });

  it('RED-BEFORE: an ADMIN granted settings:write is refused too: the profile is owner-only, not scope-gated', async () => {
    const before = await businessRowText(ID.bizA);
    for (const [action, parameters] of [['update_business_profile', HIJACK], ['update_branding', BRAND_HIJACK]] as const) {
      const res = await post('execute', ID.adminA, structured(action, parameters, { userId: ID.adminA }));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(String(res.body.result.error), action).toMatch(OWNER_ONLY);
    }
    expect(await businessRowText(ID.bizA)).toBe(before);
  });

  it("the OWNER's update_business_profile and update_branding succeed: 200, success, the row changes, and each command names the OWNER", async () => {
    const from = connectorCommands.length;
    const profile = { name: 'K34C Biz A (renamed by the owner)', timezone: 'America/New_York', currency: 'EUR' };
    const res = await post('execute', ID.ownerA, structured('update_business_profile', profile, { userId: ID.ownerA }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result, JSON.stringify(res.body.result)).toMatchObject({ success: true, data: { id: ID.bizA, ...profile } });

    const brand = await post('execute', ID.ownerA, structured('update_branding', { primaryColor: '#222222', logoUrl: 'https://k34c.test/logo-a2.png' }, { userId: ID.ownerA }));
    expect(brand.status, JSON.stringify(brand.body)).toBe(200);
    expect(brand.body.result).toMatchObject({ success: true });

    expect(await db.business.findUnique({ where: { id: ID.bizA } })).toMatchObject({ ...profile, primaryColor: '#222222', logoUrl: 'https://k34c.test/logo-a2.png' });
    expect(connectorCommands.slice(from).map((c) => c.userId)).toEqual([ID.ownerA, ID.ownerA]);
  });

  it('SUPER_ADMIN keeps the platform bypass PATCH /identity/businesses/:id grants it: its update_business_profile succeeds', async () => {
    const res = await post('execute', ID.superAdmin, structured('update_business_profile', { timezone: 'Europe/London' }, { userId: ID.superAdmin }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result, JSON.stringify(res.body.result)).toMatchObject({ success: true });
    expect(await db.business.findUnique({ where: { id: ID.bizA } })).toMatchObject({ timezone: 'Europe/London' });
  });
});

describe('the session and reasoning routes act for the authenticated member, never the request userId (review R09-ST-4 siblings, R0-34b review ST-3)', () => {
  const sessionsOf = (userId: string) => db.cortexSession.count({ where: { businessId: ID.bizA, userId } });

  it('RED-BEFORE: GET conscious/stream with ?userId=<outsider> writes the CortexSession under A attributed to the STAFF member, none to the outsider', async () => {
    const staffBefore = await sessionsOf(ID.staffA);
    const from = consciousCalls.length;
    const res = await sse('conscious/stream', ID.staffA, { businessId: ID.bizA, text: 'Hello from k34c', userId: ID.outsider });
    expect(res.status, String(res.body)).toBe(200);
    expect(String(res.body)).toContain('k34c answer');
    expect(consciousCalls.slice(from).map((c) => c.userId)).toEqual([ID.staffA]);
    expect(await sessionsOf(ID.staffA)).toBe(staffBefore + 1);
    expect(await sessionsOf(ID.outsider)).toBe(0);
  });

  it('RED-BEFORE: POST conscious/chat with body userId <outsider>: the session written is the STAFF member\'s', async () => {
    const staffBefore = await sessionsOf(ID.staffA);
    const from = consciousCalls.length;
    const res = await post('conscious/chat', ID.staffA, { businessId: ID.bizA, text: 'Hello from k34c', userId: ID.outsider });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(consciousCalls.slice(from).map((c) => c.userId)).toEqual([ID.staffA]);
    expect(await sessionsOf(ID.staffA)).toBe(staffBefore + 1);
    expect(await sessionsOf(ID.outsider)).toBe(0);
  });

  it("RED-BEFORE: POST sessions with body userId <outsider>: the session created is the STAFF member's", async () => {
    const res = await post('sessions', ID.staffA, { businessId: ID.bizA, userId: ID.outsider, title: 'k34c created' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = await db.cortexSession.findUnique({ where: { id: res.body.id } });
    expect(row).toMatchObject({ businessId: ID.bizA, userId: ID.staffA });
    expect(await sessionsOf(ID.outsider)).toBe(0);
  });

  it("RED-BEFORE: POST chat, GET chat/stream and GET stream hand the reasoning engine the STAFF member, never the request userId or 'key_user'", async () => {
    const from = reasoningCalls.length;
    const chat = await post('chat', ID.staffA, { businessId: ID.bizA, text: 'Hello from k34c', userId: ID.outsider });
    expect(chat.status, JSON.stringify(chat.body)).toBe(200);
    const chatStream = await sse('chat/stream', ID.staffA, { businessId: ID.bizA, text: 'Hello from k34c', userId: ID.outsider });
    expect(chatStream.status, String(chatStream.body)).toBe(200);
    const stream = await sse('stream', ID.staffA, { businessId: ID.bizA, message: 'Hello from k34c', userId: ID.outsider });
    expect(stream.status, String(stream.body)).toBe(200);
    const streamNoUser = await sse('stream', ID.staffA, { businessId: ID.bizA, message: 'Hello from k34c' });
    expect(streamNoUser.status, String(streamNoUser.body)).toBe(200);
    expect(reasoningCalls.slice(from)).toEqual([
      { method: 'processQuery', businessId: ID.bizA, userId: ID.staffA },
      { method: 'streamQuery', businessId: ID.bizA, userId: ID.staffA },
      { method: 'streamQuery', businessId: ID.bizA, userId: ID.staffA },
      { method: 'streamQuery', businessId: ID.bizA, userId: ID.staffA },
    ]);
  });

  it("RED-BEFORE: GET sessions?userId=<OWNER> lists the STAFF member's own sessions, never the OWNER's", async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/cortex/sessions')
      .set(HEADER, ID.staffA)
      .query({ businessId: ID.bizA, userId: ID.ownerA });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const ids = res.body.map((s: any) => s.id);
    expect(ids).toContain(ID.sessionStaffA);
    expect(ids).not.toContain(ID.sessionOwnerA);
    for (const s of res.body) expect(s.userId, s.id).toBe(ID.staffA);
  });

  it('RED-BEFORE: POST feedback with body userId <outsider> records the feedback as the STAFF member\'s', async () => {
    const sessionId = `${P}feedback_session`;
    const res = await post('feedback', ID.staffA, { businessId: ID.bizA, sessionId, userId: ID.outsider, userResponse: 'accepted' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = await db.cognitionMemory.findMany({ where: { businessId: ID.bizA, sessionId }, select: { userId: true } });
    expect(rows).toEqual([{ userId: ID.staffA }]);
  });
});

/**
 * R0-09c review ST-1..ST-4: a session is the member's who opened it (POST
 * sessions and the session services create it for the authenticated actor, and
 * GET sessions lists only the actor's own). The handlers that take a client
 * session id checked no owner, and GET/PATCH/DELETE sessions/:id and
 * personalities/switch no tenant either, while the session services read the
 * Redis entry before the tenant-scoped database. So a member of B read A's
 * cached conversation, a STAFF member read, renamed and archived the OWNER's,
 * ran the reasoning engine and the conscious pipeline on it (the pipeline then
 * acting as the OWNER), got it from GET messages as the business's newest
 * session, and rewrote the OWNER's feedback on it.
 */
describe("a session id names one of the caller's own sessions (review ST-1, ST-2, ST-3, ST-4)", () => {
  const sessionRow = (id: string) => db.cortexSession.findUnique({ where: { id }, select: { title: true, status: true, userId: true, messages: true } });
  const getAs = (user: string, path: string, query: Record<string, string>) =>
    request(app.getHttpServer()).get(`/api/v1/cortex/${path}`).set(HEADER, user).query(query);

  it("RED-BEFORE: GET sessions/:id naming A's session from B, with A's session cached by its owner's own traffic, is 404 and returns none of its messages (review ST-1)", async () => {
    // The OWNER reads its own session: the cache now holds it, as in production.
    const warm = await getAs(ID.ownerA, 'messages', { businessId: ID.bizA, sessionId: ID.sessionOwnerA });
    expect(warm.status, JSON.stringify(warm.body)).toBe(200);
    expect(JSON.stringify(warm.body)).toContain(OWNER_PRIVATE);
    expect(cache.has(`cortex:session:${ID.sessionOwnerA}`)).toBe(true);

    const res = await getAs(ID.outsider, `sessions/${ID.sessionOwnerA}`, { businessId: ID.bizB });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(OWNER_PRIVATE);
  });

  it("RED-BEFORE: GET, PATCH and DELETE sessions/:id naming the OWNER's session are 404 for a STAFF member, and the session is unchanged (review ST-3)", async () => {
    const before = await sessionRow(ID.sessionOwnerA);
    const read = await getAs(ID.staffA, `sessions/${ID.sessionOwnerA}`, { businessId: ID.bizA });
    expect(read.status, JSON.stringify(read.body)).toBe(404);
    expect(JSON.stringify(read.body)).not.toContain(OWNER_PRIVATE);

    const patch = await request(app.getHttpServer())
      .patch(`/api/v1/cortex/sessions/${ID.sessionOwnerA}`).set(HEADER, ID.staffA).query({ businessId: ID.bizA }).send({ title: `${P}hijacked title` });
    expect(patch.status, JSON.stringify(patch.body)).toBe(404);
    const del = await request(app.getHttpServer())
      .delete(`/api/v1/cortex/sessions/${ID.sessionOwnerA}`).set(HEADER, ID.staffA).query({ businessId: ID.bizA });
    expect(del.status, JSON.stringify(del.body)).toBe(404);

    expect(await sessionRow(ID.sessionOwnerA)).toEqual(before);
    expect(before).toMatchObject({ title: 'k34c owner session', status: 'active', userId: ID.ownerA });
  });

  it("the OWNER reads and renames its own session, and a STAFF member archives its own (positive control)", async () => {
    const read = await getAs(ID.ownerA, `sessions/${ID.sessionOwnerA}`, { businessId: ID.bizA });
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body).toMatchObject({ id: ID.sessionOwnerA, userId: ID.ownerA });
    expect(JSON.stringify(read.body)).toContain(OWNER_PRIVATE);

    const renamed = await request(app.getHttpServer())
      .patch(`/api/v1/cortex/sessions/${ID.sessionOwnerA}`).set(HEADER, ID.ownerA).query({ businessId: ID.bizA }).send({ title: 'k34c owner session' });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);

    const created = await post('sessions', ID.staffA, { businessId: ID.bizA, title: 'k34c staff throwaway' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const del = await request(app.getHttpServer())
      .delete(`/api/v1/cortex/sessions/${created.body.id}`).set(HEADER, ID.staffA).query({ businessId: ID.bizA });
    expect(del.status, JSON.stringify(del.body)).toBe(204);
    expect(await sessionRow(created.body.id)).toMatchObject({ status: 'archived', userId: ID.staffA });
  });

  it("RED-BEFORE: GET messages with no sessionId gives a STAFF member its own newest session, never the OWNER's newer one (review ST-3)", async () => {
    const soon = Date.now() + 86_400_000;
    await db.cortexSession.update({ where: { id: ID.sessionStaffA }, data: { lastAccessedAt: new Date(soon) } });
    await db.cortexSession.update({ where: { id: ID.sessionOwnerA }, data: { lastAccessedAt: new Date(soon + 60_000) } });

    const res = await getAs(ID.staffA, 'messages', { businessId: ID.bizA });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(OWNER_PRIVATE);
    expect(res.body.messages.map((m: any) => m.content)).toEqual([STAFF_NOTE]);
  });

  it("RED-BEFORE: a STAFF member naming the OWNER's session on POST chat, POST conscious/chat, GET chat/stream, GET stream and GET conscious/stream is refused, and neither the reasoning engine nor the conscious pipeline is handed that session or acts as the OWNER (review ST-2)", async () => {
    const before = await sessionRow(ID.sessionOwnerA);
    const from = { reasoning: reasoningCalls.length, conscious: consciousCalls.length };
    const body = { businessId: ID.bizA, text: 'Hello from k34c', sessionId: ID.sessionOwnerA };

    const chat = await post('chat', ID.staffA, body);
    expect(chat.status, JSON.stringify(chat.body)).toBe(404);
    const conscious = await post('conscious/chat', ID.staffA, body);
    expect(conscious.status, JSON.stringify(conscious.body)).toBe(404);
    // Under the production TenantInterceptor an SSE handler runs once the stream is subscribed: the refusal is an error event.
    for (const [path, query] of [
      ['chat/stream', { businessId: ID.bizA, text: 'Hello from k34c', sessionId: ID.sessionOwnerA }],
      ['conscious/stream', { businessId: ID.bizA, text: 'Hello from k34c', sessionId: ID.sessionOwnerA }],
    ] as const) {
      const res = await sse(path, ID.staffA, query);
      expect(res.status, `${path} ${String(res.body)}`).toBe(200);
      expect(String(res.body), path).toMatch(/event: error\n(?:id: [^\n]*\n)?data: [^\n]*Session not found/);
      expect(String(res.body), path).not.toContain('k34c answer');
    }
    const stream = await sse('stream', ID.staffA, { businessId: ID.bizA, message: 'Hello from k34c', sessionId: ID.sessionOwnerA });
    expect(stream.status).toBe(200);
    expect(String(stream.body)).toMatch(/"type":"error"[^\n]*"content":"Session not found"/);

    expect(reasoningCalls.slice(from.reasoning), 'queries handed to the reasoning engine').toEqual([]);
    expect(consciousCalls.slice(from.conscious), 'sessions handed to the conscious pipeline').toEqual([]);
    expect(await sessionRow(ID.sessionOwnerA)).toEqual(before);
  });

  it("a STAFF member naming its own session runs chat and the conscious pipeline on it, as itself (positive control)", async () => {
    const from = { reasoning: reasoningCalls.length, conscious: consciousCalls.length };
    const body = { businessId: ID.bizA, text: 'Hello from k34c', sessionId: ID.sessionStaffA };
    expect((await post('chat', ID.staffA, body)).status).toBe(200);
    expect((await post('conscious/chat', ID.staffA, body)).status).toBe(200);
    expect(reasoningCalls.slice(from.reasoning)).toEqual([{ method: 'processQuery', businessId: ID.bizA, userId: ID.staffA, sessionId: ID.sessionStaffA }]);
    expect(consciousCalls.slice(from.conscious)).toEqual([{ sessionId: ID.sessionStaffA, businessId: ID.bizA, userId: ID.staffA }]);
  });

  it("RED-BEFORE: feedback from a STAFF member on the OWNER's session is 404 and the OWNER's cognition memory is unchanged; the OWNER's own feedback updates it (review ST-4)", async () => {
    const memoryId = `${P}cm_owner`;
    await db.cognitionMemory.create({
      data: {
        id: memoryId, businessId: ID.bizA, userId: ID.ownerA, sessionId: ID.sessionOwnerA,
        query: 'k34c owner question', recommendation: 'k34c recommendation', userResponse: 'accepted', confidence: 0.7,
      },
    });
    const rowsOf = () => db.cognitionMemory.findMany({ where: { sessionId: ID.sessionOwnerA }, select: { id: true, userId: true, userResponse: true } });

    const staff = await post('feedback', ID.staffA, { businessId: ID.bizA, sessionId: ID.sessionOwnerA, userResponse: 'rejected' });
    expect(staff.status, JSON.stringify(staff.body)).toBe(404);
    expect(await rowsOf()).toEqual([{ id: memoryId, userId: ID.ownerA, userResponse: 'accepted' }]);

    const owner = await post('feedback', ID.ownerA, { businessId: ID.bizA, sessionId: ID.sessionOwnerA, userResponse: 'modified' });
    expect(owner.status, JSON.stringify(owner.body)).toBe(200);
    expect(await rowsOf()).toEqual([{ id: memoryId, userId: ID.ownerA, userResponse: 'modified' }]);
  });

  it("RED-BEFORE: POST personalities/switch naming the OWNER's session is 404 for a STAFF member and for a member of B, and returns none of its messages (review ST-1)", async () => {
    for (const [user, businessId] of [[ID.staffA, ID.bizA], [ID.outsider, ID.bizB]] as const) {
      const res = await post('personalities/switch', user, { businessId, sessionId: ID.sessionOwnerA, persona: 'jarvis' });
      expect(res.status, `${user} ${JSON.stringify(res.body)}`).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain(OWNER_PRIVATE);
    }
  });
});

/**
 * R0-09c review CR-1 and ST-6. Binding the real actor let settings commands run
 * as the OWNER that used to run as 'system' and fail IdentityService's team
 * check. remove_team_member and update_role looked their target up with
 * membership.findFirst({ where: { userId: parameters.userId, businessId } }):
 * with no parameters.userId, Prisma drops the key and the lookup returns
 * whichever membership Postgres reads first. The executor compensates a failed
 * add_team_member with exactly such a remove_team_member (the add's {email,
 * role}). And settings.configure_integration checked no authority at all, while
 * the HTTP routes need connect:write (connect is 'none' for every role by
 * default).
 */
describe('the settings adapter: team commands name their target member, integrations need connect:write (review CR-1, ST-6)', () => {
  const members = async () =>
    ((await db.$queryRawUnsafe('SELECT id, role FROM memberships WHERE business_id = $1 ORDER BY id', ID.bizA)) as any[]).map((r) => `${r.id}:${r.role}`);

  it("RED-BEFORE: a failed add_team_member is compensated with a remove_team_member naming no member, which is refused: no membership is deleted, even when the OWNER row is not the first Postgres reads (review CR-1)", async () => {
    // A write to the OWNER membership row moves its tuple, so it is no longer the first one a scan returns.
    await db.$executeRawUnsafe('UPDATE memberships SET daily_capacity_hours = 8 WHERE id = $1', `${P}m_ownerA`);
    const before = await members();
    expect(before).toHaveLength(3);
    const from = connectorCommands.length;
    const res = await post('execute', ID.ownerA, structured('add_team_member', { email: `${P}staffA@test.local`, role: 'STAFF' }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result).toMatchObject({ success: false });
    for (const c of connectorCommands.slice(from)) expect(c.userId).toBe(ID.ownerA);
    expect(await members()).toEqual(before);
  });

  it('RED-BEFORE: update_role and remove_team_member with no target member change no membership (review CR-1)', async () => {
    const before = await members();
    for (const [action, parameters] of [['update_role', { role: 'STAFF' }], ['remove_team_member', {}]] as const) {
      const res = await post('execute', ID.ownerA, structured(action, parameters));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.result, action).toMatchObject({ success: false });
      expect(String(res.body.result.error), action).toContain('needs parameters.userId');
    }
    expect(await members()).toEqual(before);
  });

  it("RED-BEFORE: settings.configure_integration from a STAFF member, an ADMIN granted settings:write and the OWNER (none holds connect:write) is refused, connect and disconnect alike, and the integration hub is not called (review ST-6)", async () => {
    const from = integrationCalls.length;
    for (const actor of [ID.staffA, ID.adminA, ID.ownerA]) {
      for (const enabled of [false, true]) {
        const res = await post('execute', actor, structured('configure_integration', { integration: 'stripe', enabled }));
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.result, `${actor} enabled=${enabled}`).toMatchObject({ success: false });
        expect(String(res.body.result.error)).toMatch(/connect requires write access/);
      }
    }
    expect(integrationCalls.slice(from)).toEqual([]);
  });

  it("SUPER_ADMIN's settings.configure_integration reaches the integration hub (ModuleScopeGuard's platform bypass)", async () => {
    const from = integrationCalls.length;
    for (const enabled of [false, true]) {
      const res = await post('execute', ID.superAdmin, structured('configure_integration', { integration: 'stripe', enabled }));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.result, JSON.stringify(res.body.result)).toMatchObject({ success: true });
    }
    expect(integrationCalls.slice(from)).toEqual([['disconnect', ID.bizA, 'stripe'], ['createConnection', ID.bizA, 'stripe']]);
  });
});

describe('open review hand-offs outside this write set (review ST-5 / CR-2, ST-7)', () => {
  it.todo("review ST-5 / CR-2: KEY plans do not act for the authenticated member. POST /api/v1/cortex/plans and goals/:id/plans hand the planner dto.userId (key-cortex-goals.controller.ts), the planner builds every step's ConnectorCommand as plan.userId ?? 'key_cortex' (key-cortex-planner.service.ts buildCommand), and POST plans/:id/execute takes no actor, so a STAFF member naming the OWNER's id runs KEY commands as the OWNER (settings.update_business_profile then passes the owner rule). Fix, in those two files: the goals controller takes the actor from @CurrentUser() for plan creation and execution, and the planner never runs a member's plan as 'key_cortex'");
  it.todo("review ST-7: the execute audit record is never written. KeyCortexExecutorService.logExecution (key-cortex-executor.service.ts) writes fields AiExecutionLog does not have (Prisma: Unknown argument `traceId`) and its call is fire-and-forget, so no ai_execution_logs row carries the actor this packet binds. Fix, in that file: map the record onto AiExecutionLog's columns (userId, module, action, inputSummary, outputSummary, success, errorMessage, durationMs); then this suite asserts one row per execute naming the authenticated member");
});

describe('nothing left the process (suite-wide)', () => {
  it('no global fetch was sent', () => {
    expect(outbound).toEqual([]);
  });
});
