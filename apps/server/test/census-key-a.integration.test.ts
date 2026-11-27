/**
 * SWP-CENSUS-KEY-A (V1-64, P1 launch-track, prefix `v64k_`):
 *
 * Applies `ModuleScopeGuard` + `@RequireModuleScope` across all 55 open write
 * routes of the 6 named KEY/AI controllers in `docs/reconstruction/REST-SCOPE-CENSUS-2026-11-13.md`:
 *   - AiController (36: 33 `ai:write`, 3 `settings:write` — governance/routing/agent-config)
 *   - AgentController (6: `ai:write`)
 *   - OutputTemplateController (6: `settings:write`)
 *   - BookingsAiController (4: `bookings:read`)
 *   - BlueprintOnboardingController (2: `settings:write`)
 *   - GraphActionsController (1: `planAction`, `ai:write`)
 *
 * REAL Postgres (DATABASE_URL), REAL NestJS HTTP app (`supertest`), REAL AuthGuard,
 * REAL BusinessGuard, REAL ModuleScopeGuard, REAL Reflector, REAL ValidationPipe,
 * REAL GlobalHttpExceptionFilter, and all 6 REAL controllers.
 *
 *   [V64K-01] RED-BEFORE: default STAFF (ai:none, settings:none) gets 403 before any service
 *             call across representative routes of AiController, AgentController,
 *             OutputTemplateController, GraphActionsController, and BlueprintOnboardingController;
 *             STAFF with bookings:none gets 403 across all 4 BookingsAiController routes.
 *   [V64K-02] RED-BEFORE: explicit scope grants (ai:write, settings:write, bookings:read) and
 *             default OWNER pass ModuleScopeGuard; insufficient read-only scopes (ai:read,
 *             settings:read) and D-140 restricted OWNER ({ ai:'read', settings:'read', bookings:'none' })
 *             are refused 403 with zero service invocations.
 *   [V64K-03] RED-BEFORE: exhaustive metadata + census proof across ALL 55 methods of the 6
 *             controllers — every method carries ModuleScopeGuard + exact @RequireModuleScope
 *             and 0 open rows remain for these 6 controllers in REST-SCOPE-CENSUS-2026-11-13.md.
 *   [V64K-04] CONTROLS: cross-tenant OWNER gets 403, unauthenticated gets 401, and
 *             AiController.updateRoutingConfig still refuses non-SUPER_ADMIN OWNER with 403.
 *
 * FIXTURES: prefix `v64k_` (test/helpers/fixture-prefixes.json), cleaned in beforeAll and afterAll.
 */
import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v64k_';
const HEADER = 'x-v64k-user';

const ID = {
  ownerA: `${P}ownerA`,
  ownerRestricted: `${P}ownerRestr`,
  ownerB: `${P}ownerB`,
  staffDefault: `${P}staffDef`,
  staffAiRead: `${P}staffAiRead`,
  staffAiWrite: `${P}staffAiWrite`,
  staffSettingsRead: `${P}staffSetRead`,
  staffSettingsWrite: `${P}staffSetWrite`,
  staffBookingsNone: `${P}staffBkNone`,
  staffBookingsRead: `${P}staffBkRead`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
};

const EXPECTED_SCOPES: Record<string, Record<string, { module: string; minLevel: string }>> = {
  AiController: {
    assignThreadRole: { module: 'ai', minLevel: 'write' },
    blockSuggestionCategory: { module: 'ai', minLevel: 'write' },
    chat: { module: 'ai', minLevel: 'write' },
    createGoal: { module: 'ai', minLevel: 'write' },
    createPlan: { module: 'ai', minLevel: 'write' },
    deleteGoal: { module: 'ai', minLevel: 'write' },
    deleteMemory: { module: 'ai', minLevel: 'write' },
    dismissSuggestion: { module: 'ai', minLevel: 'write' },
    executeAllBriefingCards: { module: 'ai', minLevel: 'write' },
    executeKeyCommand: { module: 'ai', minLevel: 'write' },
    generateBusinessModel: { module: 'ai', minLevel: 'write' },
    instantiateWorkflow: { module: 'ai', minLevel: 'write' },
    parseIntent: { module: 'ai', minLevel: 'write' },
    profileChat: { module: 'ai', minLevel: 'write' },
    profileConfirm: { module: 'ai', minLevel: 'write' },
    profileReset: { module: 'ai', minLevel: 'write' },
    rebalance: { module: 'ai', minLevel: 'write' },
    refreshSuggestions: { module: 'ai', minLevel: 'write' },
    replyToThread: { module: 'ai', minLevel: 'write' },
    resolveApproval: { module: 'ai', minLevel: 'write' },
    resolveApprovalsBatch: { module: 'ai', minLevel: 'write' },
    resolveThread: { module: 'ai', minLevel: 'write' },
    seoScore: { module: 'ai', minLevel: 'write' },
    simulate: { module: 'ai', minLevel: 'write' },
    skipBriefing: { module: 'ai', minLevel: 'write' },
    summarizePatterns: { module: 'ai', minLevel: 'write' },
    undoPlanStep: { module: 'ai', minLevel: 'write' },
    updateAgentConfig: { module: 'settings', minLevel: 'write' },
    updateAutopilotRule: { module: 'ai', minLevel: 'write' },
    updateBusinessPlan: { module: 'ai', minLevel: 'write' },
    updateGoal: { module: 'ai', minLevel: 'write' },
    updateGoalProgress: { module: 'ai', minLevel: 'write' },
    updateGovernanceSettings: { module: 'settings', minLevel: 'write' },
    updateRoutingConfig: { module: 'settings', minLevel: 'write' },
    upsertMemory: { module: 'ai', minLevel: 'write' },
    upsertMemoryBulk: { module: 'ai', minLevel: 'write' },
  },
  AgentController: {
    createAgentTrigger: { module: 'ai', minLevel: 'write' },
    markMessageProcessed: { module: 'ai', minLevel: 'write' },
    processDocument: { module: 'ai', minLevel: 'write' },
    triggerPatternScan: { module: 'ai', minLevel: 'write' },
    undoAction: { module: 'ai', minLevel: 'write' },
    updateAgentTrigger: { module: 'ai', minLevel: 'write' },
  },
  OutputTemplateController: {
    create: { module: 'settings', minLevel: 'write' },
    preview: { module: 'settings', minLevel: 'write' },
    remove: { module: 'settings', minLevel: 'write' },
    resetCategory: { module: 'settings', minLevel: 'write' },
    setDefault: { module: 'settings', minLevel: 'write' },
    update: { module: 'settings', minLevel: 'write' },
  },
  BookingsAiController: {
    aiNoShowPredictor: { module: 'bookings', minLevel: 'read' },
    aiRevenueInsights: { module: 'bookings', minLevel: 'read' },
    aiScheduleOptimizer: { module: 'bookings', minLevel: 'read' },
    aiSearch: { module: 'bookings', minLevel: 'read' },
  },
  BlueprintOnboardingController: {
    onboardingChat: { module: 'settings', minLevel: 'write' },
    onboardingReset: { module: 'settings', minLevel: 'write' },
  },
  GraphActionsController: {
    planAction: { module: 'ai', minLevel: 'write' },
  },
};

let db: any;
let app: any;
let controllersMap: Record<string, any> = {};
let ModuleScopeGuardCls: any;
let MODULE_SCOPE_KEY: string;
const serviceCalls: string[] = [];

function recordingStub(label: string) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return undefined;
        return (..._args: unknown[]) => {
          serviceCalls.push(`${label}.${String(prop)}`);
          return Promise.resolve({ ok: true, id: `${P}stub`, messages: [], steps: [] });
        };
      },
    },
  );
}

async function cleanup() {
  if (!db) return;
  for (const sql of [
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort */
    }
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { Reflector } = await import('@nestjs/core');
  const { Logger, ValidationPipe } = await import('@nestjs/common');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const scopeMod = await import('../src/core/auth/module-scope.guard');
  ModuleScopeGuardCls = scopeMod.ModuleScopeGuard;
  MODULE_SCOPE_KEY = scopeMod.MODULE_SCOPE_KEY;
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { FeatureFlagGuard } = await import('../src/modules/crm/guards/feature-flag.guard');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');

  const { AiController } = await import('../src/modules/ai/ai.controller');
  const { AgentController } = await import('../src/modules/ai/agent.controller');
  const { OutputTemplateController } = await import('../src/modules/ai/output-template.controller');
  const { BookingsAiController } = await import('../src/modules/bookings/bookings-ai.controller');
  const { BlueprintOnboardingController } = await import('../src/modules/ai/blueprint-onboarding.controller');
  const { GraphActionsController } = await import('../src/modules/ai/graph-actions.controller');

  controllersMap = {
    AiController,
    AgentController,
    OutputTemplateController,
    BookingsAiController,
    BlueprintOnboardingController,
    GraphActionsController,
  };

  const allow = { canActivate: () => true };

  const mod = await Test.createTestingModule({
    controllers: [
      AiController,
      AgentController,
      OutputTemplateController,
      BookingsAiController,
      BlueprintOnboardingController,
      GraphActionsController,
    ],
    providers: [
      Reflector,
      { provide: PrismaService, useValue: { client: db } },
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuardCls,
    ],
  })
    .useMocker((token) => {
      const name = typeof token === 'function' ? token.name : String(token);
      return recordingStub(name);
    })
    .overrideGuard(CrmRateLimitGuard)
    .useValue(allow)
    .overrideGuard(FeatureFlagGuard)
    .useValue(allow)
    .overrideGuard(PlanLimitGuard)
    .useValue(allow)
    .compile();

  app = mod.createNestApplication({ logger: false });
  Logger.overrideLogger(false);
  app.use(async (req: any, _res: any, next: any) => {
    const uid = req.headers[HEADER];
    if (typeof uid === 'string' && uid.startsWith(P)) {
      const u = await db.user.findUnique({ where: { id: uid }, select: { id: true, email: true, role: true } });
      if (u) req.user = { id: u.id, email: u.email, role: u.role };
    }
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup();

  for (const [key, uid] of Object.entries(ID)) {
    if (key.startsWith('biz')) continue;
    await db.user.create({
      data: { id: uid, email: `${P}${key}@v64k.test.local`, name: `${key} User`, role: 'USER' },
    });
  }

  await db.business.create({
    data: { id: ID.bizA, name: `${P}Biz A`, ownerId: ID.ownerA, slug: `${P}biz-a`, currency: 'TTD' },
  });
  await db.business.create({
    data: { id: ID.bizB, name: `${P}Biz B`, ownerId: ID.ownerB, slug: `${P}biz-b`, currency: 'TTD' },
  });

  const memberships: Array<{ id: string; userId: string; businessId: string; role: string; permissionScopes?: any }> = [
    { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
    {
      id: `${P}m_ownerRestr`,
      userId: ID.ownerRestricted,
      businessId: ID.bizA,
      role: 'OWNER',
      permissionScopes: { ai: 'read', settings: 'read', bookings: 'none' },
    },
    { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
    { id: `${P}m_staffDef`, userId: ID.staffDefault, businessId: ID.bizA, role: 'STAFF' },
    {
      id: `${P}m_staffAiRead`,
      userId: ID.staffAiRead,
      businessId: ID.bizA,
      role: 'STAFF',
      permissionScopes: { ai: 'read' },
    },
    {
      id: `${P}m_staffAiWrite`,
      userId: ID.staffAiWrite,
      businessId: ID.bizA,
      role: 'STAFF',
      permissionScopes: { ai: 'write' },
    },
    {
      id: `${P}m_staffSetRead`,
      userId: ID.staffSettingsRead,
      businessId: ID.bizA,
      role: 'STAFF',
      permissionScopes: { settings: 'read' },
    },
    {
      id: `${P}m_staffSetWrite`,
      userId: ID.staffSettingsWrite,
      businessId: ID.bizA,
      role: 'STAFF',
      permissionScopes: { settings: 'write' },
    },
    {
      id: `${P}m_staffBkNone`,
      userId: ID.staffBookingsNone,
      businessId: ID.bizA,
      role: 'STAFF',
      permissionScopes: { bookings: 'none' },
    },
    {
      id: `${P}m_staffBkRead`,
      userId: ID.staffBookingsRead,
      businessId: ID.bizA,
      role: 'STAFF',
      permissionScopes: { bookings: 'read' },
    },
  ];
  for (const m of memberships) {
    await db.membership.create({ data: m });
  }
});

beforeEach(() => {
  serviceCalls.length = 0;
});

afterAll(async () => {
  await app?.close();
  await cleanup();
});

const agent = () => request(app.getHttpServer());

function sendReq(method: 'post' | 'put' | 'delete', url: string, actor?: string, body?: Record<string, unknown>) {
  let req = agent()[method](url);
  if (actor) req = req.set(HEADER, actor);
  if (body) req = req.send(body);
  return req;
}

const AI_WRITE_PROBES: ReadonlyArray<{ label: string; method: 'post' | 'put' | 'delete'; url: string; body?: Record<string, unknown> }> = [
  { label: 'AiController.chat', method: 'post', url: `/ai/businesses/${ID.bizA}/ai/chat`, body: { message: 'hello' } },
  { label: 'AiController.executeKeyCommand', method: 'post', url: `/ai/businesses/${ID.bizA}/key/command`, body: { prompt: 'list contacts', mode: 'ask' } },
  { label: 'AiController.createGoal', method: 'post', url: `/ai/businesses/${ID.bizA}/goals`, body: { title: 'Grow revenue', targetValue: 100 } },
  { label: 'AgentController.createAgentTrigger', method: 'post', url: `/ai/businesses/${ID.bizA}/agent/triggers`, body: { name: 't1', event: 'invoice.paid' } },
  { label: 'AgentController.undoAction', method: 'post', url: `/ai/businesses/${ID.bizA}/agent/undo/${P}u1`, body: {} },
  { label: 'GraphActionsController.planAction', method: 'post', url: `/actions/businesses/${ID.bizA}/plan`, body: { input: 'create invoice' } },
];

const SETTINGS_WRITE_PROBES: ReadonlyArray<{ label: string; method: 'post' | 'put' | 'delete'; url: string; body?: Record<string, unknown> }> = [
  { label: 'AiController.updateGovernanceSettings', method: 'put', url: `/ai/businesses/${ID.bizA}/ai/governance`, body: { mode: 'assisted' } },
  { label: 'AiController.updateAgentConfig', method: 'put', url: `/ai/businesses/${ID.bizA}/ai/agent-config`, body: { enabled: true } },
  { label: 'OutputTemplateController.create', method: 'post', url: `/api/ai/businesses/${ID.bizA}/output-templates`, body: { name: 'Default', category: 'email', tone: 'professional' } },
  { label: 'BlueprintOnboardingController.onboardingChat', method: 'post', url: `/blueprint/businesses/${ID.bizA}/onboarding-chat`, body: { message: 'We run a bakery' } },
  { label: 'BlueprintOnboardingController.onboardingReset', method: 'post', url: `/blueprint/businesses/${ID.bizA}/onboarding-reset`, body: {} },
];

const BOOKINGS_READ_PROBES: ReadonlyArray<{ label: string; method: 'post'; url: string; body?: Record<string, unknown> }> = [
  { label: 'BookingsAiController.aiSearch', method: 'post', url: `/bookings/businesses/${ID.bizA}/ai-search`, body: { query: 'tomorrow' } },
  { label: 'BookingsAiController.aiScheduleOptimizer', method: 'post', url: `/bookings/businesses/${ID.bizA}/ai-schedule-optimizer`, body: {} },
  { label: 'BookingsAiController.aiNoShowPredictor', method: 'post', url: `/bookings/businesses/${ID.bizA}/ai-no-show-predictor`, body: {} },
  { label: 'BookingsAiController.aiRevenueInsights', method: 'post', url: `/bookings/businesses/${ID.bizA}/ai-revenue-insights`, body: {} },
];

describe('SWP-CENSUS-KEY-A (V1-64): ModuleScopeGuard enforcement across all 6 KEY/AI controllers', () => {
  it('[V64K-01] RED-BEFORE: default STAFF gets 403 on ai:write and settings:write routes; bookings:none STAFF gets 403 on BookingsAiController; zero service calls', async () => {
    for (const p of [...AI_WRITE_PROBES, ...SETTINGS_WRITE_PROBES]) {
      const res = await sendReq(p.method, p.url, ID.staffDefault, p.body);
      expect(res.status, `${p.label} default STAFF: ${res.text}`).toBe(403);
    }
    for (const p of BOOKINGS_READ_PROBES) {
      const res = await sendReq(p.method, p.url, ID.staffBookingsNone, p.body);
      expect(res.status, `${p.label} bookings:none STAFF: ${res.text}`).toBe(403);
    }
    expect(serviceCalls, 'zero service methods called on 403 refusals').toEqual([]);
  });

  it('[V64K-02] RED-BEFORE: read-only scopes and D-140 restricted OWNER get 403; explicit granted scopes and default OWNER pass', async () => {
    for (const p of AI_WRITE_PROBES) {
      const readRes = await sendReq(p.method, p.url, ID.staffAiRead, p.body);
      expect(readRes.status, `${p.label} ai:read: ${readRes.text}`).toBe(403);
      const restrRes = await sendReq(p.method, p.url, ID.ownerRestricted, p.body);
      expect(restrRes.status, `${p.label} restricted OWNER: ${restrRes.text}`).toBe(403);
    }
    for (const p of SETTINGS_WRITE_PROBES) {
      const readRes = await sendReq(p.method, p.url, ID.staffSettingsRead, p.body);
      expect(readRes.status, `${p.label} settings:read: ${readRes.text}`).toBe(403);
      const restrRes = await sendReq(p.method, p.url, ID.ownerRestricted, p.body);
      expect(restrRes.status, `${p.label} restricted OWNER: ${restrRes.text}`).toBe(403);
    }
    for (const p of BOOKINGS_READ_PROBES) {
      const restrRes = await sendReq(p.method, p.url, ID.ownerRestricted, p.body);
      expect(restrRes.status, `${p.label} restricted OWNER: ${restrRes.text}`).toBe(403);
    }
    expect(serviceCalls, 'zero service calls for insufficient scopes').toEqual([]);

    // Granted scopes pass guard cleanly (not 403)
    for (const p of AI_WRITE_PROBES) {
      const staffRes = await sendReq(p.method, p.url, ID.staffAiWrite, p.body);
      expect(staffRes.status, `${p.label} ai:write STAFF: ${staffRes.text}`).toBeLessThan(300);
      const ownerRes = await sendReq(p.method, p.url, ID.ownerA, p.body);
      expect(ownerRes.status, `${p.label} OWNER: ${ownerRes.text}`).toBeLessThan(300);
    }
    for (const p of SETTINGS_WRITE_PROBES) {
      const staffRes = await sendReq(p.method, p.url, ID.staffSettingsWrite, p.body);
      expect(staffRes.status, `${p.label} settings:write STAFF: ${staffRes.text}`).toBeLessThan(300);
      const ownerRes = await sendReq(p.method, p.url, ID.ownerA, p.body);
      expect(ownerRes.status, `${p.label} OWNER: ${ownerRes.text}`).toBeLessThan(300);
    }
    for (const p of BOOKINGS_READ_PROBES) {
      const staffRes = await sendReq(p.method, p.url, ID.staffBookingsRead, p.body);
      expect(staffRes.status, `${p.label} bookings:read STAFF: ${staffRes.text}`).toBeLessThan(300);
      const ownerRes = await sendReq(p.method, p.url, ID.ownerA, p.body);
      expect(ownerRes.status, `${p.label} OWNER: ${ownerRes.text}`).toBeLessThan(300);
    }
  });

  it('[V64K-03] RED-BEFORE: all 55 target methods carry ModuleScopeGuard + exact @RequireModuleScope and 0 open census rows remain for these 6 controllers', () => {
    let checked = 0;
    const missing: string[] = [];

    for (const [ctrlName, methods] of Object.entries(EXPECTED_SCOPES)) {
      const Ctrl = controllersMap[ctrlName];
      const classGuards: unknown[] = Reflect.getMetadata('__guards__', Ctrl) ?? [];
      for (const [methodName, expected] of Object.entries(methods)) {
        checked += 1;
        const handler = Ctrl.prototype[methodName];
        if (!handler) {
          missing.push(`${ctrlName}.${methodName}: handler missing`);
          continue;
        }
        const methodGuards: unknown[] = Reflect.getMetadata('__guards__', handler) ?? [];
        const allGuards = [...classGuards, ...methodGuards];
        if (!allGuards.includes(ModuleScopeGuardCls)) {
          missing.push(`${ctrlName}.${methodName}: missing ModuleScopeGuard`);
        }
        const scope = Reflect.getMetadata(MODULE_SCOPE_KEY, handler) ?? Reflect.getMetadata(MODULE_SCOPE_KEY, Ctrl);
        if (!scope || scope.module !== expected.module || scope.minLevel !== expected.minLevel) {
          missing.push(
            `${ctrlName}.${methodName}: expected ${expected.module}:${expected.minLevel}, got ${JSON.stringify(scope)}`,
          );
        }
      }
    }

    expect(checked).toBe(55);
    expect(missing).toEqual([]);

    const censusPath = path.resolve(__dirname, '../../../docs/reconstruction/REST-SCOPE-CENSUS-2026-11-13.md');
    const census = fs.readFileSync(censusPath, 'utf8');
    const openRows = census
      .split(/\r?\n/)
      .filter((line) => /\|\s*open\s*\|/.test(line))
      .filter((line) =>
        /^\| `(AiController|AgentController|OutputTemplateController|BookingsAiController|BlueprintOnboardingController|GraphActionsController)\./.test(
          line,
        ),
      );
    expect(openRows, 'zero open census rows remaining for SWP-CENSUS-KEY-A controllers').toEqual([]);
  });

  it('[V64K-04] CONTROLS: cross-tenant OWNER gets 403, unauthenticated gets 401, and updateRoutingConfig stays SUPER_ADMIN-only', async () => {
    const crossTenant = await sendReq('post', `/ai/businesses/${ID.bizA}/ai/chat`, ID.ownerB, { message: 'cross' });
    expect(crossTenant.status).toBe(403);

    const unauth = await sendReq('post', `/ai/businesses/${ID.bizA}/ai/chat`, undefined, { message: 'anon' });
    expect(unauth.status).toBe(401);

    const routingOwner = await sendReq('put', `/ai/businesses/${ID.bizA}/ai/routing-config`, ID.ownerA, {});
    expect(routingOwner.status).toBe(403);
    expect(serviceCalls).toEqual([]);
  });
});
