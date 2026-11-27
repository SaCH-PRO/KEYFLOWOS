/**
 * V1-09-KEY-COMMAND-GOVERNED review repairs (REAL database, through HTTP).
 *
 * POST /ai/businesses/:businessId/key/command with mode 'ask' and
 * GET /ai/businesses/:businessId/key/commands, on the real AiController with
 * its real AuthGuard, BusinessGuard and CrmRateLimitGuard. The 'ask' pipeline
 * behind it is real: KeyCommandService, KeyToolRegistryService (the legacy
 * reads), AiOversightService (policy reads and evaluate), KeyAutonomySafetyService
 * (the kill switch), TimelineService (the Activity ledger) and PrismaService,
 * against the database at DATABASE_URL. The only stand-ins are identity
 * attachment (a test middleware reads `x-v09a-user` and attaches the seeded
 * user row, as the Supabase-verifying AuthMiddleware would), the tool audit log
 * (a recorder), and the collaborators AiController and KeyToolRegistryService
 * hold for routes and tools this suite does not call (an allow-listed mocker;
 * any other missing token fails the compile).
 *
 *   SEC-V109-1  'ask' reads only what the asking member may read: crm/revenue
 *               module scope as ModuleScopeGuard computes it, contacts by the
 *               list route's visibility clause; and the KeyCommand row, which
 *               GET key/commands shows every member, keeps no member-scoped data.
 *   SEC-V109-2  a business's blockedModules / bare-name blockedTools stop the
 *               dotted legacy reads.
 *   SEC-V109-3  the Activity ledger entry matches the KeyCommand status and
 *               names the member who asked.
 *   CR-V109-1   ruling: an advisory business's 'ask' reads are refused, as
 *               oversight rules for every KEY surface (pinned here with the real
 *               oversight over an AutopilotSettings row at its default level 0).
 *
 * Every seeded row id starts with `v09a_` and is hard-deleted in beforeAll and
 * afterAll, matched through sqlLikePrefix() from test/helpers/sql-like.js.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v09a_';
const HEADER = 'x-v09a-user';
const ID = {
  owner: `${P}owner`,          // OWNER of every business below
  staffRead: `${P}staffRead`,  // STAFF, no scope map: role defaults (crm read, revenue read)
  staffNone: `${P}staffNone`,  // STAFF, explicit map { crm: none, revenue: none }
  biz: `${P}biz`,              // no AI policy rows: oversight's default ('assisted')
  bizBlocked: `${P}bizBlocked`, // AiMemory policy blocks the crm and commerce modules
  bizAdvisory: `${P}bizAdv`,   // AutopilotSettings at its schema default (level 0 = advisory)
  bizKill: `${P}bizKill`,      // autonomy kill switch on
  cTeam: `${P}cTeam`,          // TEAM contact, owned by the owner, stale
  cPrivate: `${P}cPrivate`,    // PRIVATE contact, owned by the owner, stale
};
const TEAM_EMAIL = `${P}team@test.local`;
const PRIVATE_EMAIL = `${P}private@test.local`;

/**
 * AiController's collaborators for routes this suite does not call, and
 * KeyToolRegistryService's for tools it does not call. Anything else that is
 * unresolved fails the compile.
 */
const OFF_BOUNDARY = new Set([
  'AiAdvisorService', 'AiUsageService', 'AiExecutionLogService', 'BusinessGraphService', 'IntentParserService',
  'PlannerService', 'AiMemoryService', 'StrategicIntelligenceService', 'ProAutoMonitorService',
  'ProfileIntelligenceService', 'WorkspaceRecommendationsService', 'ModelGatewayService', 'AutopilotRulesService',
  'AgentHealthService', 'JourneyOrchestratorService', 'MorningBriefingService', 'UnifiedInboxService',
  'GoalTrackerService', 'WorkloadAggregatorService', 'TaskPrioritizerService', 'CapacityInsightService',
  'TaskRebalancerService', 'KeyAgentConfigService', 'UndoService', 'ProactiveSuggestionService',
  'WorkflowTemplateService', 'KeyActionProposalService', 'KeyCortexApprovalOrchestratorService',
]);

let db: any;
let app: any;
let crm: { resolveCrmAccess: any; visibilityClause: any };
let prismaService: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM key_commands WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_shares WHERE contact_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_memories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM autopilot_settings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_autonomy_profiles WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best effort */ }
  }
}

function ask(actor: string, rawInput: string, businessId = ID.biz) {
  return request(app.getHttpServer())
    .post(`/ai/businesses/${businessId}/key/command`)
    .set(HEADER, actor)
    .send({ rawInput, mode: 'ask' });
}

function listCommands(actor: string, businessId = ID.biz) {
  return request(app.getHttpServer()).get(`/ai/businesses/${businessId}/key/commands`).set(HEADER, actor);
}

async function commandRow(id: string) {
  return db.keyCommand.findUnique({ where: { id } });
}

/** recordEvent is not awaited by the service: wait for the ledger row of this command. */
async function ledgerRow(commandId: string) {
  for (let i = 0; i < 40; i++) {
    const row = await db.activity.findFirst({ where: { entityType: 'key_command', entityId: commandId } });
    if (row) return row;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

beforeAll(async () => {
  db = (await import('@keyflow/db')).db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { AiController } = await import('../src/modules/ai/ai.controller');
  const { AiOversightService } = await import('../src/modules/ai/ai-oversight.service');
  const { KeyCommandService } = await import('../src/modules/ai/key-command.service');
  const { KeyCortexToolRegistryService } = await import('../src/modules/key-cortex/key-cortex-tool-registry.service');
  const { KeyAutonomySafetyService } = await import('../src/modules/key-autonomy/key-autonomy-safety.service');
  const { recommendStaleFollowUps, summarizePaidRevenue } = await import('../src/modules/ai/legacy-promoted-tools.helper');
  crm = await import('../src/modules/crm/crm-permissions.helper');

  const moduleRef = await Test.createTestingModule({
    controllers: [AiController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      CrmRateLimitGuard,
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      { provide: TimelineService, useFactory: (prisma: any) => new TimelineService(prisma), inject: [PrismaService] },
      {
        provide: AiOversightService,
        // evaluate() with no role or position reads only the business policy rows.
        useFactory: (prisma: any) => new AiOversightService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any),
        inject: [PrismaService],
      },
      { provide: KeyAutonomySafetyService, useFactory: (prisma: any) => new KeyAutonomySafetyService(prisma), inject: [PrismaService] },
      {
        provide: KeyCortexToolRegistryService,
        // P160 (RR-LEGACY-FALLBACK-REMOVE): canonical registry serving the promoted FLOW_TOOLS reads over real PrismaService.
        useFactory: (prisma: any) => {
          const tools = new Map<string, any>([
            [
              'commerce_summarize_revenue',
              {
                name: 'commerce_summarize_revenue',
                module: 'read',
                riskTier: 1,
                requiresApproval: false,
                handler: async (ctx: any) => ({ success: true, data: await summarizePaidRevenue(prisma, ctx.businessId) }),
              },
            ],
            [
              'crm_recommend_follow_ups',
              {
                name: 'crm_recommend_follow_ups',
                module: 'read',
                riskTier: 1,
                requiresApproval: false,
                handler: async (ctx: any, input: any) => {
                  const access = ctx.userId ? await crm.resolveCrmAccess(prisma, ctx.businessId, ctx.userId) : null;
                  const vis = access && ctx.userId ? crm.visibilityClause(access, ctx.userId) : null;
                  return { success: true, data: await recommendStaleFollowUps(prisma, ctx.businessId, input?.daysStale, input?.limit, vis) };
                },
              },
            ],
          ]);
          return {
            getTool: (name: string) => tools.get(name),
            execute: async (name: string, ctx: any, input: any) => {
              const t = tools.get(name);
              if (!t) return { success: false, error: `Unknown tool: ${name}` };
              return t.handler(ctx, input);
            },
          };
        },
        inject: [PrismaService],
      },
      {
        provide: KeyCommandService,
        useFactory: (prisma: any, timeline: any, canonical: any, oversight: any, safety: any) =>
          new KeyCommandService(prisma, timeline, {} as any, canonical, oversight, safety),
        inject: [PrismaService, TimelineService, KeyCortexToolRegistryService, AiOversightService, KeyAutonomySafetyService],
      },
    ],
  })
    .useMocker((token: any) => {
      const name = typeof token === 'function' ? token.name : String(token);
      return OFF_BOUNDARY.has(name) ? {} : undefined;
    })
    .compile();
  prismaService = moduleRef.get(PrismaService);

  app = moduleRef.createNestApplication();
  // Identity attachment only, for seeded v09a_ users. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup();

  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.staffRead, email: `${P}staffRead@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.staffNone, email: `${P}staffNone@test.local`, role: 'USER' } });
  for (const id of [ID.biz, ID.bizBlocked, ID.bizAdvisory, ID.bizKill]) {
    await db.business.create({ data: { id, name: `V09A ${id}`, ownerId: ID.owner, currency: 'TTD' } });
    await db.membership.create({ data: { id: `${id}_m_owner`, userId: ID.owner, businessId: id, role: 'OWNER' } });
  }
  await db.membership.create({ data: { id: `${P}m_staffRead`, userId: ID.staffRead, businessId: ID.biz, role: 'STAFF' } });
  await db.membership.create({
    data: { id: `${P}m_staffNone`, userId: ID.staffNone, businessId: ID.biz, role: 'STAFF', permissionScopes: { crm: 'none', revenue: 'none' } },
  });

  const stale = new Date(Date.now() - 60 * 86400000);
  for (const businessId of [ID.biz, ID.bizBlocked]) {
    const suffix = businessId === ID.biz ? '' : '_b';
    await db.contact.create({
      data: {
        id: `${ID.cTeam}${suffix}`, businessId, firstName: 'Team', lastName: 'Contact', email: TEAM_EMAIL,
        visibility: 'TEAM', ownerId: ID.owner, status: 'ACTIVE', lastInteractionAt: stale,
      },
    });
    await db.contact.create({
      data: {
        id: `${ID.cPrivate}${suffix}`, businessId, firstName: 'Private', lastName: 'Contact', email: PRIVATE_EMAIL,
        visibility: 'PRIVATE', ownerId: ID.owner, status: 'ACTIVE', lastInteractionAt: stale,
      },
    });
  }

  // P160 (RR-LEGACY-FALLBACK-REMOVE): pin module block (crm) and bare-tool-name block on summarizeRevenue.
  const blockedPolicy = JSON.stringify({ blockedModules: ['crm'], blockedTools: ['summarizeRevenue'] });
  await db.aiMemory.create({
    data: { businessId: ID.bizBlocked, category: 'settings', key: 'autonomy', source: 'user', value: blockedPolicy },
  });
  // The schema default autonomyLevel is 0, which oversight reads as 'advisory'.
  await db.autopilotSettings.create({ data: { businessId: ID.bizAdvisory } });
  await db.businessAutonomyProfile.create({ data: { businessId: ID.bizKill, globalKillSwitch: true } });
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('fixture sanity (real rows)', () => {
  it("the contacts list route's clause hides the owner's PRIVATE contact from staffRead and everything from staffNone", async () => {
    for (const actor of [ID.staffRead, ID.staffNone]) {
      const access = await crm.resolveCrmAccess(prismaService, ID.biz, actor);
      const clause = crm.visibilityClause(access, actor);
      const visible = await db.contact.findMany({
        where: { businessId: ID.biz, id: { in: [ID.cTeam, ID.cPrivate] }, ...(clause ? { AND: [clause] } : {}) },
        select: { id: true },
      });
      expect(visible.map((c: any) => c.id), actor).toEqual(actor === ID.staffRead ? [ID.cTeam] : []);
    }
  });
});

describe("SEC-V109-1 'ask' reads only what the asking member may read", () => {
  it('a STAFF member with crm none gets no follow-up list, and nothing ran', async () => {
    const res = await ask(ID.staffNone, 'who should I follow up with?');

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.results[0]).toMatchObject({ success: false, notExecuted: true, tool: 'crm_recommend_follow_ups' });
    expect(JSON.stringify(res.body)).not.toContain(PRIVATE_EMAIL);
    expect(JSON.stringify(res.body)).not.toContain(TEAM_EMAIL);
    expect((await commandRow(res.body.commandId)).status).toBe('REJECTED');
  });

  it("a STAFF member with crm read gets the TEAM contact and not the owner's PRIVATE one", async () => {
    const res = await ask(ID.staffRead, 'who should I follow up with?');

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.results[0]).toMatchObject({ success: true });
    const ids = res.body.results[0].data.contacts.map((c: any) => c.id);
    expect(ids).toContain(ID.cTeam);
    expect(ids).not.toContain(ID.cPrivate);
    expect(JSON.stringify(res.body)).not.toContain(PRIVATE_EMAIL);
  });

  it('the OWNER gets both contacts (control)', async () => {
    const res = await ask(ID.owner, 'follow up');

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const ids = res.body.results[0].data.contacts.map((c: any) => c.id);
    expect(ids).toEqual(expect.arrayContaining([ID.cTeam, ID.cPrivate]));
    expect((await commandRow(res.body.commandId)).status).toBe('EXECUTED');
  });

  it("GET key/commands shows other members no contact from the owner's ask: the row keeps the outcome without the data", async () => {
    const owned = await ask(ID.owner, 'follow up');
    expect(JSON.stringify(owned.body)).toContain(PRIVATE_EMAIL);

    const row = await commandRow(owned.body.commandId);
    expect(row.executionResult.outputs[0]).toMatchObject({ success: true, tool: 'crm_recommend_follow_ups', dataWithheld: true });
    expect(JSON.stringify(row.executionResult)).not.toContain(PRIVATE_EMAIL);

    const listed = await listCommands(ID.staffNone);
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    // V1-09b-KEY-COMMANDS-READ-SCOPE: a member lists only its own rows, so the
    // owner's row is not listed to staffNone at all (it was, data withheld).
    expect(listed.body.map((c: any) => c.id)).not.toContain(owned.body.commandId);
    expect(JSON.stringify(listed.body)).not.toContain(PRIVATE_EMAIL);
    expect(JSON.stringify(listed.body)).not.toContain(TEAM_EMAIL);
  });

  it('a STAFF member with revenue none gets no revenue summary; one with role-default scopes does (control)', async () => {
    const refused = await ask(ID.staffNone, 'how much revenue did we make?');
    expect(refused.body.results[0]).toMatchObject({ success: false, notExecuted: true, tool: 'commerce_summarize_revenue' });
    expect(refused.body.results[0].error).toMatch(/revenue requires read access/);
    expect(refused.body.results[0]).not.toHaveProperty('data');

    const answered = await ask(ID.staffRead, 'how much revenue did we make?');
    expect(answered.body.results[0]).toMatchObject({ success: true, data: { totalRevenue: 0, paidInvoiceCount: 0 } });
  });
});

describe("SEC-V109-2 a business's module and tool blocks stop the promoted 'ask' reads", () => {
  it('blockedModules crm stops the follow-up list and blockedTools summarizeRevenue stops the revenue summary', async () => {
    const followUps = await ask(ID.owner, 'follow up', ID.bizBlocked);
    expect(followUps.body.results[0]).toMatchObject({ success: false, notExecuted: true });
    expect(followUps.body.results[0].error).toContain('Module "crm" is blocked');
    expect(JSON.stringify(followUps.body)).not.toContain(PRIVATE_EMAIL);
    expect((await commandRow(followUps.body.commandId)).status).toBe('REJECTED');

    const revenue = await ask(ID.owner, 'how much revenue', ID.bizBlocked);
    expect(revenue.body.results[0]).toMatchObject({ success: false, notExecuted: true });
    expect(revenue.body.results[0].error).toContain('Tool "summarizeRevenue" is blocked');
  });

  it('hidden-v1 obsolete reads (message intake, drive intake) fail closed without executing', async () => {
    const messages = await ask(ID.owner, 'check messages in my inbox', ID.bizBlocked);
    expect(messages.body.results[0]).toMatchObject({ success: false, notExecuted: true, tool: 'messages.listMessageIntake' });
    expect(messages.body.results[0].error).toMatch(/obsolete/i);

    const drive = await ask(ID.owner, 'what did key find in drive intake?', ID.bizBlocked);
    expect(drive.body.results[0]).toMatchObject({ success: false, notExecuted: true, tool: 'connect.listDriveIntake' });
    expect(drive.body.results[0].error).toMatch(/obsolete/i);
  });
});

describe('CR-V109-1 ruling: an advisory business answers no ask read (oversight governs reads)', () => {
  it('AutopilotSettings at its default level 0 (advisory): the revenue read is refused and nothing ran', async () => {
    const res = await ask(ID.owner, 'what is my revenue', ID.bizAdvisory);

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.results[0]).toMatchObject({ success: false, notExecuted: true, tool: 'commerce_summarize_revenue' });
    expect(res.body.results[0].error).toMatch(/advisory mode/);
    expect((await commandRow(res.body.commandId)).status).toBe('REJECTED');
  });
});

describe('SEC-V109-3 the Activity ledger matches the KeyCommand status and names who asked', () => {
  it('a kill-switch refusal is recorded as refused (CANCELLED), not failed, with the asking member', async () => {
    const res = await ask(ID.owner, 'how much revenue', ID.bizKill);
    expect(res.body.results[0]).toMatchObject({ success: false, notExecuted: true });
    expect(res.body.results[0].error).toMatch(/kill switch/i);
    expect((await commandRow(res.body.commandId)).status).toBe('REJECTED');

    const row = await ledgerRow(res.body.commandId);
    expect(row).toMatchObject({ businessId: ID.bizKill, action: 'command.refused', status: 'CANCELLED', actorType: 'AI', actorId: ID.owner });
    expect(row.title).not.toMatch(/failed/i);
    expect(row.data.results[0]).toMatchObject({ tool: 'commerce_summarize_revenue', notExecuted: true });
  });

  it("'scan drive' (retired as OBSOLETE in P160, hidden v1 module D-152) is recorded as refused (CANCELLED)", async () => {
    const res = await ask(ID.staffRead, 'scan drive');
    expect((await commandRow(res.body.commandId)).status).toBe('REJECTED');

    const row = await ledgerRow(res.body.commandId);
    expect(row).toMatchObject({ action: 'command.refused', status: 'CANCELLED', actorId: ID.staffRead });
  });

  it('an executed ask is recorded as executed (COMPLETED), with the asking member', async () => {
    const res = await ask(ID.staffRead, 'how much revenue');
    expect((await commandRow(res.body.commandId)).status).toBe('EXECUTED');

    const row = await ledgerRow(res.body.commandId);
    expect(row).toMatchObject({ action: 'command.executed', status: 'COMPLETED', actorId: ID.staffRead });
  });
});
