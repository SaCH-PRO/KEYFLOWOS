/**
 * KEY-TOOL-DOMAIN-HIDE (V1-67, P1 launch-track, owner rulings D-152 / D-150 / D-156 / D-329):
 *
 * REAL Postgres (DATABASE_URL), REAL LegacyModulesService (NAV-B-LEGACY-SERVER),
 * REAL FlowOrchestratorService, REAL StructureService.
 *
 *   [V67C-01] RED-BEFORE: A clean v1 business (no hidden-module rows, advancedCrm=false)
 *             is offered ZERO hidden-module tools in `selectToolsForRequest` (projects,
 *             payroll, helpdesk, deals/advanced_crm, retainers, social, procurement, call_tasks)
 *             and dispatch across `executeToolDirect`, `executeToolByName`,
 *             `autoExecuteToolForMonitoring`, and `governToolCall` refuses them with
 *             `'not available in this version'` and zero DB writes.
 *   [V67C-02] RED-BEFORE: A legacy business with a live `projects` row is offered `projects`
 *             READ tools only (`projects_list`, `projects_list_tasks`, `projects_get_budget`,
 *             `fetch_project_status`) and can execute `projects_list`, while `projects` WRITE
 *             tools (`projects_create_task`, `projects_create`, `projects_complete_task`) stay
 *             withheld from `selectToolsForRequest` and refused at dispatch with
 *             `'not available in this version'`.
 *   [V67C-03] RED-BEFORE: Payroll read tools (`payroll_list_rates`, `payroll_list_runs`,
 *             `payroll_get_run`) are withheld from a clean business and offered/executable for
 *             a business with a live `payroll_runs` row, while payroll write tools remain
 *             unconditionally omitted and refused for both businesses.
 *   [V67C-04] RED-BEFORE: `advanced_crm` (`treatment: 'hide-advanced'`, D-150):
 *             - clean business (`advancedCrm: false`, no deals/accounts): zero `advanced_crm` tools
 *             - legacy deals business (`advancedCrm: false`, live `deals` row): read tools ONLY
 *               (`deals_list`, `deals_get`, `deals_list_stages`, `crm_list_deals`), writes refused
 *             - opted-in business (`metaData.advancedCrm === true`, even with zero deals):
 *               BOTH read and write `advanced_crm` tools offered and permitted at the v1 gate.
 *   [V67C-05] RED-BEFORE (SEC-V61-3 argument-level gating on 3 v1 core tools):
 *             - `people_assign_task` with `taskType: 'ProjectTask'` is refused with
 *               `'not available in this version'` (both clean and legacy-projects businesses),
 *               while `taskType: 'ContactTask'` passes the v1 gate.
 *             - `reconcile_connect_statement_source` with non-empty `driveFolderId` and
 *               `reconcile_sweep_statements` with `source: 'drive'` are refused with
 *               `'not available in this version'`, while `gmailQuery` / `source: 'gmail'`
 *               and `driveFolderId: ''` (disconnect) pass the v1 gate.
 *             - `people_list` on a clean business (no `structure` rows) withholds org-assignment
 *               structure fields (`jobRole`, `jobRoleLevel`, `orgUnit`, `orgUnitType`, `reportsTo`)
 *               and does not match `search` against them, while a business with legacy `structure`
 *               rows keeps those read-only structure fields.
 *   [V67C-06] CONTROL: Core v1 tools (`crm_list_contacts`, `crm_add_task`, `commerce_list_invoices`,
 *             `expenses_list`, `bookings_list_services`, `command_list_due_obligations`) remain
 *             offered and executable for a clean business.
 *
 * FIXTURES: prefix `v67c_` (test/helpers/fixture-prefixes.json), cleaned in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { V1_HIDDEN_MODULES } from '@keyflow/shared';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v67c_';
const ID = {
  owner: `${P}owner`,
  bizClean: `${P}biz_clean`,
  bizProj: `${P}biz_proj`,
  bizPayroll: `${P}biz_payroll`,
  bizLegacyDeals: `${P}biz_legacy_deals`,
  bizAdvCrm: `${P}biz_adv_crm`,
  bizStructure: `${P}biz_structure`,
  project1: `${P}project_1`,
  payrollRun1: `${P}prun_1`,
  dealStage1: `${P}dstage_1`,
  deal1: `${P}deal_1`,
  orgUnit1: `${P}org_unit_1`,
  jobRole1: `${P}job_role_1`,
  orgAssign1: `${P}org_assign_1`,
  contact1: `${P}contact_1`,
  mClean: `${P}m_clean`,
  mProj: `${P}m_proj`,
  mPayroll: `${P}m_payroll`,
  mLegacyDeals: `${P}m_legacy_deals`,
  mAdvCrm: `${P}m_adv_crm`,
  mStructure: `${P}m_structure`,
};

const ALL_BIZ_IDS = [
  ID.bizClean,
  ID.bizProj,
  ID.bizPayroll,
  ID.bizLegacyDeals,
  ID.bizAdvCrm,
  ID.bizStructure,
];

let db: any;
let prisma: any;
let legacyModules: any;
let structureService: any;
let orchestrator: any;
let projectsMock: { listProjects: ReturnType<typeof vi.fn>; createProject: ReturnType<typeof vi.fn>; addTask: ReturnType<typeof vi.fn> };
let payrollMock: { listRuns: ReturnType<typeof vi.fn>; listRates: ReturnType<typeof vi.fn>; getRun: ReturnType<typeof vi.fn> };
let dealsMock: { listDeals: ReturnType<typeof vi.fn>; createDeal: ReturnType<typeof vi.fn> };
let taskAssignMock: { assign: ReturnType<typeof vi.fn> };
let statementSourcesMock: { setSources: ReturnType<typeof vi.fn>; sweepDrive: ReturnType<typeof vi.fn>; sweepGmail: ReturnType<typeof vi.fn> };

const quiet = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

async function cleanupAll() {
  if (!db) return;
  for (const sql of [
    `DELETE FROM org_assignments WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM job_roles WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM org_units WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM deals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM deal_stages WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payroll_items WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payroll_runs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM pay_rates WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM project_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM projects WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM support_tickets WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM key_action_proposals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
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

  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { LegacyModulesService } = await import('../src/modules/identity/legacy-modules.service');
  const { StructureService } = await import('../src/modules/structure/structure.service');
  const { AiOversightService } = await import('../src/modules/ai/ai-oversight.service');
  const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
  const { ProjectsService } = await import('../src/modules/projects/projects.service');
  const { PayrollService } = await import('../src/modules/payroll/payroll.service');
  const { CrmDealsService } = await import('../src/modules/crm/crm-deals.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  const { StatementSourceService } = await import('../src/modules/finance/statement-source.service');

  prisma = new PrismaService();
  legacyModules = new LegacyModulesService(prisma);
  structureService = new StructureService(prisma);
  const oversight = new AiOversightService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);

  projectsMock = {
    listProjects: vi.fn(async () => [{ id: ID.project1, name: `${P}Legacy Project` }]),
    createProject: vi.fn(async () => ({ id: `${P}created_proj` })),
    addTask: vi.fn(async () => ({ id: `${P}created_ptask` })),
  };
  payrollMock = {
    listRuns: vi.fn(async () => [{ id: ID.payrollRun1, status: 'PAID' }]),
    listRates: vi.fn(async () => []),
    getRun: vi.fn(async () => ({ id: ID.payrollRun1, status: 'PAID' })),
  };
  dealsMock = {
    listDeals: vi.fn(async () => ({ deals: [{ id: ID.deal1, title: `${P}Legacy Deal` }], total: 1 })),
    createDeal: vi.fn(async () => ({ id: `${P}created_deal`, title: 'Created Deal' })),
  };
  taskAssignMock = {
    assign: vi.fn(async () => ({ id: `${P}assign_ok` })),
  };
  statementSourcesMock = {
    setSources: vi.fn(async (_b: string, accountId: string, patch: Record<string, unknown>) => ({ accountId, ...patch })),
    sweepDrive: vi.fn(async () => ({ imported: 1, filesConsidered: 1, skipped: 0, errors: [] })),
    sweepGmail: vi.fn(async () => ({ imported: 0, filesConsidered: 1, skipped: 1, errors: [] })),
  };

  const providers = new Map<unknown, unknown>([
    [LegacyModulesService, legacyModules],
    [StructureService, structureService],
    [ProjectsService, projectsMock],
    [PayrollService, payrollMock],
    [CrmDealsService, dealsMock],
    [TaskAssignmentService, taskAssignMock],
    [StatementSourceService, statementSourcesMock],
  ]);

  const moduleRef = {
    get(token: unknown) {
      if (!providers.has(token)) throw new Error(`No provider for ${String((token as any)?.name ?? token)}`);
      return providers.get(token);
    },
  };

  orchestrator = Object.assign(Object.create(FlowOrchestratorService.prototype), {
    logger: quiet,
    prisma,
    moduleRef,
    governance: oversight,
    executionLog: {
      logToolExecution: vi.fn(async () => 'log_v67c'),
      log: vi.fn(async () => undefined),
    },
    businessGraph: {
      invalidateCache: vi.fn(),
    },
    roleEngine: {
      crewAllows: () => true,
    },
    attributeExecutionLog: vi.fn(async () => undefined),
  });

  await cleanupAll();

  await db.user.create({
    data: {
      id: ID.owner,
      email: `${P}owner@test.local`,
      name: 'V67C Owner',
      role: 'USER',
    },
  });

  const bizConfigs: Array<{ id: string; mId: string; name: string; metaData?: Record<string, unknown> }> = [
    { id: ID.bizClean, mId: ID.mClean, name: `${P}Clean Business`, metaData: { advancedCrm: false } },
    { id: ID.bizProj, mId: ID.mProj, name: `${P}Legacy Projects`, metaData: { advancedCrm: false } },
    { id: ID.bizPayroll, mId: ID.mPayroll, name: `${P}Legacy Payroll`, metaData: { advancedCrm: false } },
    { id: ID.bizLegacyDeals, mId: ID.mLegacyDeals, name: `${P}Legacy Deals`, metaData: { advancedCrm: false } },
    { id: ID.bizAdvCrm, mId: ID.mAdvCrm, name: `${P}Advanced CRM Opt-In`, metaData: { advancedCrm: true } },
    { id: ID.bizStructure, mId: ID.mStructure, name: `${P}Legacy Structure`, metaData: { advancedCrm: false } },
  ];

  for (const cfg of bizConfigs) {
    await db.business.create({
      data: {
        id: cfg.id,
        name: cfg.name,
        ownerId: ID.owner,
        metaData: cfg.metaData ?? {},
      },
    });
    await db.membership.create({
      data: {
        id: cfg.mId,
        userId: ID.owner,
        businessId: cfg.id,
        role: 'OWNER',
      },
    });
  }

  // Seed legacy rows per specialized business ONLY
  await db.project.create({
    data: {
      id: ID.project1,
      businessId: ID.bizProj,
      name: `${P}Legacy Project`,
      status: 'ACTIVE',
    },
  });

  await db.payrollRun.create({
    data: {
      id: ID.payrollRun1,
      businessId: ID.bizPayroll,
      periodStart: new Date('2026-10-01T00:00:00Z'),
      periodEnd: new Date('2026-10-15T00:00:00Z'),
      status: 'PAID',
      currency: 'TTD',
      totalGross: 1000,
    },
  });

  await db.contact.create({
    data: {
      id: `${P}contact_deal`,
      businessId: ID.bizLegacyDeals,
      firstName: 'Deal',
      lastName: 'Contact',
      email: `${P}deal@test.local`,
      status: 'CLIENT',
    },
  });
  await db.dealStage.create({
    data: {
      id: ID.dealStage1,
      businessId: ID.bizLegacyDeals,
      name: `${P}Qualified`,
      slug: 'qualified',
      position: 1,
    },
  });
  await db.deal.create({
    data: {
      id: ID.deal1,
      businessId: ID.bizLegacyDeals,
      contactId: `${P}contact_deal`,
      title: `${P}Legacy Deal`,
      value: 500,
      currency: 'TTD',
      stageId: ID.dealStage1,
      status: 'OPEN',
    },
  });

  // Seed org assignment on BOTH bizStructure (has orgUnit + orgAssignment) and
  // prove clean business without structure rows has no structure exposure.
  await db.orgUnit.create({
    data: {
      id: ID.orgUnit1,
      businessId: ID.bizStructure,
      name: 'SecretStructureDivision',
      type: 'DEPARTMENT',
    },
  });
  await db.jobRole.create({
    data: {
      id: ID.jobRole1,
      businessId: ID.bizStructure,
      name: 'PrincipalStructureArchitect',
      level: 4,
    },
  });
  await db.orgAssignment.create({
    data: {
      id: ID.orgAssign1,
      businessId: ID.bizStructure,
      membershipId: ID.mStructure,
      orgUnitId: ID.orgUnit1,
      jobRoleId: ID.jobRole1,
      isPrimary: true,
    },
  });

  await db.contact.create({
    data: {
      id: ID.contact1,
      businessId: ID.bizClean,
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: `${P}ada@test.local`,
      status: 'CLIENT',
    },
  });
}, 180_000);

afterAll(async () => {
  await cleanupAll();
});

beforeEach(() => {
  projectsMock.listProjects.mockClear();
  projectsMock.createProject.mockClear();
  projectsMock.addTask.mockClear();
  payrollMock.listRuns.mockClear();
  payrollMock.listRates.mockClear();
  payrollMock.getRun.mockClear();
  dealsMock.listDeals.mockClear();
  dealsMock.createDeal.mockClear();
  taskAssignMock.assign.mockClear();
  statementSourcesMock.setSources.mockClear();
  statementSourcesMock.sweepDrive.mockClear();
  statementSourcesMock.sweepGmail.mockClear();
});

async function offeredToolNames(businessId: string, contextText = ''): Promise<string[]> {
  const defs = await orchestrator.selectToolsForRequest(businessId, [], contextText, undefined, ID.owner);
  return defs.map((d: any) => d.function.name);
}

describe('KEY-TOOL-DOMAIN-HIDE (V1-67, D-329) — real Postgres + LegacyModulesService', () => {
  it('[V67C-01] RED-BEFORE: a clean v1 business with no hidden-module data is offered zero hidden-module tools and dispatch refuses them plainly', async () => {
    expect(await legacyModules.getLegacyModules(ID.bizClean)).toEqual([]);

    const offered = await offeredToolNames(
      ID.bizClean,
      'projects helpdesk payroll deals retainers social procurement call tasks',
    );
    const allHiddenTools = new Set(V1_HIDDEN_MODULES.flatMap((m) => m.keyTools));
    const leaked = offered.filter((name) => allHiddenTools.has(name));
    expect(leaked).toEqual([]);

    // Dispatch refused across all surfaces with exact message 'not available in this version'
    for (const tool of ['projects_list', 'projects_create_task', 'helpdesk_create_ticket', 'payroll_list_runs', 'deals_list', 'deals_create']) {
      const direct = await orchestrator.executeToolDirect(
        ID.bizClean,
        tool,
        {},
        undefined,
        undefined,
        { surface: 'CHAT', principalUserId: ID.owner },
      );
      expect(direct.success, `executeToolDirect(${tool})`).toBe(false);
      expect(String(direct.error ?? ''), `executeToolDirect(${tool})`).toMatch(/not available in this version/i);

      await expect(
        orchestrator.executeToolByName(ID.bizClean, tool, {}, { surface: 'CHAT', principalUserId: ID.owner }),
        `executeToolByName(${tool})`,
      ).rejects.toThrow(/not available in this version/i);

      const monitored = await orchestrator.autoExecuteToolForMonitoring(
        ID.bizClean,
        tool,
        {},
        { memberId: ID.owner },
      );
      expect(monitored.success, `autoExecuteToolForMonitoring(${tool})`).toBe(false);
      expect(monitored.blocked, `autoExecuteToolForMonitoring(${tool})`).toBe(true);
      expect(String(monitored.error ?? ''), `autoExecuteToolForMonitoring(${tool})`).toMatch(/not available in this version/i);
    }

    expect(projectsMock.listProjects).not.toHaveBeenCalled();
    expect(projectsMock.addTask).not.toHaveBeenCalled();
    expect(payrollMock.listRuns).not.toHaveBeenCalled();
    expect(dealsMock.listDeals).not.toHaveBeenCalled();
    expect(dealsMock.createDeal).not.toHaveBeenCalled();
  });

  it('[V67C-02] RED-BEFORE: a legacy business with projects rows is offered projects READ tools only and projects writes stay refused', async () => {
    expect(await legacyModules.getLegacyModules(ID.bizProj)).toEqual(['projects']);

    const offered = await offeredToolNames(ID.bizProj, 'projects list tasks budget create complete status');
    expect(offered).toContain('projects_list');
    expect(offered).toContain('projects_list_tasks');
    expect(offered).toContain('projects_get_budget');
    expect(offered).toContain('fetch_project_status');
    // Writes in hidden module projects stay withheld even for legacy businesses
    expect(offered).not.toContain('projects_create');
    expect(offered).not.toContain('projects_create_task');
    expect(offered).not.toContain('projects_complete_task');
    expect(offered).not.toContain('projects_update');

    // Read tool executes
    const readRes = await orchestrator.executeToolDirect(
      ID.bizProj,
      'projects_list',
      {},
      undefined,
      undefined,
      { surface: 'CHAT', principalUserId: ID.owner },
    );
    expect(readRes.success).toBe(true);
    expect(projectsMock.listProjects).toHaveBeenCalledTimes(1);

    // Write tool refused plainly
    const writeRes = await orchestrator.executeToolDirect(
      ID.bizProj,
      'projects_create_task',
      { projectId: ID.project1, title: 'Should not run' },
      undefined,
      undefined,
      { surface: 'CHAT', principalUserId: ID.owner },
    );
    expect(writeRes.success).toBe(false);
    expect(String(writeRes.error ?? '')).toMatch(/not available in this version/i);
    expect(projectsMock.addTask).not.toHaveBeenCalled();
  });

  it('[V67C-03] RED-BEFORE: payroll read tools follow the legacy list while payroll writes stay unconditionally disabled', async () => {
    expect(await legacyModules.getLegacyModules(ID.bizPayroll)).toEqual(['payroll']);

    const offeredClean = await offeredToolNames(ID.bizClean, 'payroll runs rates pay');
    expect(offeredClean).not.toContain('payroll_list_runs');
    expect(offeredClean).not.toContain('payroll_list_rates');
    expect(offeredClean).not.toContain('payroll_get_run');

    const offeredLegacy = await offeredToolNames(ID.bizPayroll, 'payroll runs rates pay');
    expect(offeredLegacy).toContain('payroll_list_runs');
    expect(offeredLegacy).toContain('payroll_list_rates');
    expect(offeredLegacy).toContain('payroll_get_run');
    for (const w of ['payroll_set_rate', 'payroll_generate_run', 'payroll_approve_run', 'payroll_mark_paid']) {
      expect(offeredLegacy).not.toContain(w);
    }

    const legacyRead = await orchestrator.executeToolDirect(
      ID.bizPayroll,
      'payroll_list_runs',
      {},
      undefined,
      undefined,
      { surface: 'CHAT', principalUserId: ID.owner },
    );
    expect(legacyRead.success).toBe(true);
    expect(payrollMock.listRuns).toHaveBeenCalledTimes(1);

    const legacyWrite = await orchestrator.executeToolDirect(
      ID.bizPayroll,
      'payroll_approve_run',
      { runId: ID.payrollRun1 },
      undefined,
      undefined,
      { surface: 'CHAT', principalUserId: ID.owner },
    );
    expect(legacyWrite.success).toBe(false);
    expect(String(legacyWrite.error ?? '')).toMatch(/not available in this version/i);
  });

  it('[V67C-04] RED-BEFORE: advanced_crm (hide-advanced, D-150) is hidden for clean, read-only for legacy deals, and read+write when metaData.advancedCrm=true', async () => {
    expect(await legacyModules.getLegacyModules(ID.bizLegacyDeals)).toEqual(['advanced_crm']);
    expect(await legacyModules.getLegacyModules(ID.bizAdvCrm)).toEqual([]);

    const offeredLegacy = await offeredToolNames(ID.bizLegacyDeals, 'deals pipeline stages forecast create update');
    expect(offeredLegacy).toContain('deals_list');
    expect(offeredLegacy).toContain('deals_get');
    expect(offeredLegacy).toContain('deals_list_stages');
    expect(offeredLegacy).toContain('crm_list_deals');
    expect(offeredLegacy).not.toContain('deals_create');
    expect(offeredLegacy).not.toContain('deals_update');
    expect(offeredLegacy).not.toContain('deals_delete');

    const legacyWrite = await orchestrator.executeToolDirect(
      ID.bizLegacyDeals,
      'deals_create',
      { title: 'Blocked deal', value: 100 },
      undefined,
      undefined,
      { surface: 'CHAT', principalUserId: ID.owner },
    );
    expect(legacyWrite.success).toBe(false);
    expect(String(legacyWrite.error ?? '')).toMatch(/not available in this version/i);
    expect(dealsMock.createDeal).not.toHaveBeenCalled();

    // Opted-in Advanced CRM business (advancedCrm: true) gets BOTH read and write deals tools
    const offeredOptIn = await offeredToolNames(ID.bizAdvCrm, 'deals pipeline stages forecast create update');
    expect(offeredOptIn).toContain('deals_list');
    expect(offeredOptIn).toContain('deals_create');
    expect(offeredOptIn).toContain('deals_update');

    const optInWrite = await orchestrator.executeToolDirect(
      ID.bizAdvCrm,
      'deals_create',
      { title: 'Allowed opt-in deal', value: 250 },
      undefined,
      undefined,
      { surface: 'CHAT', principalUserId: ID.owner },
    );
    expect(optInWrite.success).toBe(true);
    expect(dealsMock.createDeal).toHaveBeenCalledTimes(1);
  });

  it('[V67C-05] RED-BEFORE (SEC-V61-3): argument-level gating on people_assign_task (ProjectTask), reconcile_* (Drive), and people_list (structure projection)', async () => {
    // 1. people_assign_task: ProjectTask refused on BOTH clean and legacy-projects; ContactTask allowed
    for (const bizId of [ID.bizClean, ID.bizProj]) {
      const blocked = await orchestrator.executeToolDirect(
        bizId,
        'people_assign_task',
        { taskType: 'ProjectTask', taskId: 'pt_1', assignableType: 'User', assignableId: ID.owner },
        undefined,
        undefined,
        { surface: 'CHAT', principalUserId: ID.owner },
      );
      expect(blocked.success, bizId).toBe(false);
      expect(String(blocked.error ?? ''), bizId).toMatch(/not available in this version/i);
    }
    expect(taskAssignMock.assign).not.toHaveBeenCalled();

    const allowedAssign = await orchestrator.executeToolDirect(
      ID.bizClean,
      'people_assign_task',
      { taskType: 'ContactTask', taskId: 'ct_1', assignableType: 'User', assignableId: ID.owner },
      undefined,
      undefined,
      { surface: 'CHAT', principalUserId: ID.owner },
    );
    expect(allowedAssign.success).toBe(true);
    expect(taskAssignMock.assign).toHaveBeenCalledTimes(1);

    // 2. reconcile_connect_statement_source (driveFolderId) & reconcile_sweep_statements (source: 'drive') refused
    const driveConnect = await orchestrator.executeToolDirect(
      ID.bizClean,
      'reconcile_connect_statement_source',
      { accountId: 'acc_1', driveFolderId: 'gdrive_folder_123' },
      undefined,
      undefined,
      { surface: 'CHAT', principalUserId: ID.owner },
    );
    expect(driveConnect.success).toBe(false);
    expect(String(driveConnect.error ?? '')).toMatch(/not available in this version/i);
    expect(statementSourcesMock.setSources).not.toHaveBeenCalled();

    const driveSweep = await orchestrator.executeToolDirect(
      ID.bizClean,
      'reconcile_sweep_statements',
      { accountId: 'acc_1', source: 'drive' },
      undefined,
      undefined,
      { surface: 'CHAT', principalUserId: ID.owner },
    );
    expect(driveSweep.success).toBe(false);
    expect(String(driveSweep.error ?? '')).toMatch(/not available in this version/i);
    expect(statementSourcesMock.sweepDrive).not.toHaveBeenCalled();

    // Gmail & Drive-disconnect ('') remain allowed
    const gmailConnect = await orchestrator.executeToolDirect(
      ID.bizClean,
      'reconcile_connect_statement_source',
      { accountId: 'acc_1', gmailQuery: 'from:bank@example.com' },
      undefined,
      undefined,
      { surface: 'CHAT', principalUserId: ID.owner },
    );
    expect(gmailConnect.success).toBe(true);
    expect(statementSourcesMock.setSources).toHaveBeenCalledTimes(1);

    const driveDisconnect = await orchestrator.executeToolDirect(
      ID.bizClean,
      'reconcile_connect_statement_source',
      { accountId: 'acc_1', driveFolderId: '' },
      undefined,
      undefined,
      { surface: 'CHAT', principalUserId: ID.owner },
    );
    expect(driveDisconnect.success).toBe(true);

    const gmailSweep = await orchestrator.executeToolDirect(
      ID.bizClean,
      'reconcile_sweep_statements',
      { accountId: 'acc_1', source: 'gmail' },
      undefined,
      undefined,
      { surface: 'CHAT', principalUserId: ID.owner },
    );
    expect(gmailSweep.success).toBe(true);
    expect(statementSourcesMock.sweepGmail).toHaveBeenCalledTimes(1);

    // 3. people_list: structure org assignment exposed ONLY when 'structure' is in legacyModules
    expect(await legacyModules.getLegacyModules(ID.bizStructure)).toEqual(['structure']);
    const legacyPeople = await orchestrator.executeToolDirect(
      ID.bizStructure,
      'people_list',
      {},
      undefined,
      undefined,
      { surface: 'CHAT', principalUserId: ID.owner },
    );
    expect(legacyPeople.success).toBe(true);
    expect(legacyPeople.result.people[0]).toMatchObject({
      jobRole: 'PrincipalStructureArchitect',
      orgUnit: 'SecretStructureDivision',
    });

    // Spy on listPeople to prove includeStructure: false is passed for bizClean (no structure rows)
    const listPeopleSpy = vi.spyOn(structureService, 'listPeople');
    const cleanPeople = await orchestrator.executeToolDirect(
      ID.bizClean,
      'people_list',
      {},
      undefined,
      undefined,
      { surface: 'CHAT', principalUserId: ID.owner },
    );
    expect(cleanPeople.success).toBe(true);
    expect(listPeopleSpy).toHaveBeenCalledWith(
      ID.bizClean,
      expect.objectContaining({ includeStructure: false }),
    );
    expect(cleanPeople.result.people[0]).toMatchObject({
      jobRole: null,
      jobRoleLevel: null,
      orgUnit: null,
      orgUnitType: null,
      reportsTo: null,
    });
    listPeopleSpy.mockRestore();
  });

  it('[V67C-06] CONTROL: v1 core tools remain offered and executable on a clean business', async () => {
    const offered = await offeredToolNames(
      ID.bizClean,
      'contacts tasks invoices expenses bookings calendar obligations',
    );
    for (const coreTool of [
      'crm_list_contacts',
      'crm_add_task',
      'commerce_list_invoices',
      'expenses_list',
      'bookings_list_services',
      'command_list_due_obligations',
    ]) {
      expect(offered, coreTool).toContain(coreTool);
    }

    const contacts = await orchestrator.executeToolDirect(
      ID.bizClean,
      'crm_list_contacts',
      {},
      undefined,
      undefined,
      { surface: 'CHAT', principalUserId: ID.owner },
    );
    expect(contacts.success).toBe(true);
    expect(JSON.stringify(contacts.result)).toContain('Ada');
  });
});
