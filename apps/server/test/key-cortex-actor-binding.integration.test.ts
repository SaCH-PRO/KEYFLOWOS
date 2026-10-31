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
 * holds; globalThis.fetch (recorded and refused); and the collaborators the
 * controller holds for its other routes (an allow-listed mocker). Vitest's
 * esbuild transform emits no parameter types, so the suite writes the ones tsc
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
};

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
const reasoningCalls: Array<{ method: string; businessId: unknown; userId: unknown }> = [];
/** Every session the consciousness pipeline was handed (conscious/chat, conscious/stream). */
const consciousCalls: Array<{ sessionId: unknown; businessId: unknown; userId: unknown }> = [];
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
  const integrationsOff = {
    createConnection: async () => { throw new Error('k34c: integrations are off this path'); },
    disconnect: async () => { throw new Error('k34c: integrations are off this path'); },
  };
  const reasoning = {
    processQuery: async (q: any) => {
      reasoningCalls.push({ method: 'processQuery', businessId: q?.businessId, userId: q?.userId });
      return { text: 'k34c answer' };
    },
    streamQuery: async function* (q: any) {
      reasoningCalls.push({ method: 'streamQuery', businessId: q?.businessId, userId: q?.userId });
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
  await db.cortexSession.create({ data: { id: ID.sessionOwnerA, businessId: ID.bizA, userId: ID.ownerA, title: 'k34c owner session', messages: [] } });
  await db.cortexSession.create({ data: { id: ID.sessionStaffA, businessId: ID.bizA, userId: ID.staffA, title: 'k34c staff session', messages: [] } });

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

describe('nothing left the process (suite-wide)', () => {
  it('no global fetch was sent', () => {
    expect(outbound).toEqual([]);
  });
});
