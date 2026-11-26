/**
 * NAV-B-LEGACY-SERVER (V1-67, P118): per-business live server read of which
 * hidden v1 modules this business already has data in — REAL Postgres
 * (`DATABASE_URL`), REAL `IdentityController`, `AuthGuard`, `BusinessGuard`,
 * `LegacyModulesService`, and `packages/shared/src/v1-modules.ts`.
 *
 * Route: `GET /identity/businesses/:businessId/legacy-modules`
 *   - Guarded by `AuthGuard` + `BusinessGuard` (any live member; membership
 *     read of module key strings only — ZERO counts, ZERO names, ZERO amounts,
 *     ZERO credentials, ZERO writes).
 *   - Runs read-only `EXISTS` queries over the exact `V1_HIDDEN_MODULES` list
 *     (`packages/shared/src/v1-modules.ts`, formatVersion 2, including
 *     `ai_goals` + `business_goals` -> `goals` and
 *     `staff_performance_snapshots` -> `performance`).
 *   - Returns sorted unique module key strings `string[]`.
 *
 * Cases:
 *   LM-01  Business with live project + payroll run -> exact sorted
 *          `['payroll', 'projects']` and ZERO counts/names/amounts/canaries.
 *   LM-02  Business with no hidden-module data (including non-qualifying
 *          rows: disabled delegation loop, v1 site draft, Gmail/disconnected
 *          connector) -> `[]`.
 *   LM-03  formatVersion 2 parity: `ai_goals`, `staff_performance_snapshots`,
 *          `org_assignments`, and `businesses.meta_data.whatsapp` ->
 *          `['goals', 'performance', 'structure', 'whatsapp']` with ZERO
 *          credential/title leakage; `business_goals` alone -> `['goals']`.
 *   LM-04  Soft-deleted rows in soft-deleted tables (`projects`,
 *          `support_tickets`, `automations`) do NOT count -> `[]`.
 *   LM-05  Cross-tenant isolation: another tenant's rows NEVER count for this
 *          business.
 *   LM-06  Non-member / outsider and another tenant's owner -> `403`, never
 *          leaks module keys.
 *   LM-07  Unauthenticated caller -> `401`, never leaks module keys.
 *   LM-08  Restricted STAFF member with all module scopes `'none'` (including
 *          `revenue: 'none'`, `operations: 'none'`, `projects: 'none'`) ->
 *          admitted `200` with exact sorted keys and zero counts/amounts.
 *   LM-09  Read-only guarantee: handler executes ZERO writes (no mutating
 *          Prisma model calls, no DML/DDL SQL, byte-identical business row).
 *   LM-10  Soft-deleted business -> member refused `403`; SUPER_ADMIN gets
 *          `[]` (soft-deleted business never counts as live usage).
 *
 * FIXTURES: prefix `v67b_` (registered in `test/helpers/fixture-prefixes.json`),
 * cleaned via raw SQL with `sqlLikePrefix(P)` in `beforeAll` and `afterAll`.
 */
import 'reflect-metadata';
import path from 'path';
import { existsSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v67b_';
const HEADER = 'x-v67b-user';

const ID = {
  owner: `${P}owner`,
  staffRestricted: `${P}staffRestricted`,
  outsider: `${P}outsider`,
  ownerOther: `${P}ownerOther`,
  superAdmin: `${P}superAdmin`,

  bizUsed: `${P}bizUsed`,
  bizEmpty: `${P}bizEmpty`,
  bizV2: `${P}bizV2`,
  bizLegacyGoal: `${P}bizLegacyGoal`,
  bizSoftDel: `${P}bizSoftDel`,
  bizOther: `${P}bizOther`,
  bizGone: `${P}bizGone`,

  membershipV2: `${P}m_owner_bizV2`,
  orgUnitV2: `${P}unitV2`,
  jobRoleV2: `${P}roleV2`,
  assignmentV2: `${P}asgV2`,
};

const CANARY = {
  bizUsedName: 'v67b Canary Bakery',
  projectName: 'v67b Canary Kitchen Refit',
  payrollGross: '54321.11',
  budgetAmount: 98765.43,
  goalTitle: 'v67b Canary Grow Repeat Customers',
  legacyGoalTitle: 'v67b Canary Legacy Quarterly Target',
  contractTitle: 'v67b Canary Lease Agreement',
  waSid: ['v67b', 'sid', 'canary', '8a1f'].join('-'),
  waToken: ['v67b', 'tok', 'canary', '4d9e'].join('-'),
  waFrom: '+18685550167',
};

const MUTATING_PRISMA_METHODS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

const WRITE_SQL_RE = /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|MERGE|COPY)\b/i;

let db: any;
let app: any;
let recording = false;
let recordedSql: string[] = [];
let recordedMutations: string[] = [];

function wrapTxOrClient(target: any): any {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);
      if (prop === '$transaction' && typeof value === 'function') {
        return (arg: any, options?: any) => {
          if (typeof arg === 'function') {
            return value.call(obj, (tx: any) => arg(wrapTxOrClient(tx)), options);
          }
          return value.call(obj, arg, options);
        };
      }
      if (
        (prop === '$queryRawUnsafe' || prop === '$executeRawUnsafe') &&
        typeof value === 'function'
      ) {
        return (sql: string, ...values: unknown[]) => {
          if (recording) recordedSql.push(String(sql));
          return value.call(obj, sql, ...values);
        };
      }
      if ((prop === '$queryRaw' || prop === '$executeRaw') && typeof value === 'function') {
        return (strings: TemplateStringsArray | { strings?: readonly string[] }, ...values: unknown[]) => {
          if (recording) {
            const text = Array.isArray(strings)
              ? strings.join(' ? ')
              : Array.isArray(strings?.strings)
                ? strings.strings.join(' ? ')
                : String(strings);
            recordedSql.push(text);
          }
          return value.call(obj, strings, ...values);
        };
      }
      if (value && typeof value === 'object' && typeof prop === 'string' && !prop.startsWith('$') && !prop.startsWith('_')) {
        return new Proxy(value, {
          get(delegate, method, dReceiver) {
            const fn = Reflect.get(delegate, method, dReceiver);
            if (typeof fn === 'function' && typeof method === 'string' && MUTATING_PRISMA_METHODS.has(method)) {
              return (...args: unknown[]) => {
                if (recording) recordedMutations.push(`${prop}.${method}`);
                return fn.apply(delegate, args);
              };
            }
            return fn;
          },
        });
      }
      return value;
    },
  });
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM staff_performance_snapshots WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM org_assignments WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM job_roles WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM org_units WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_goals WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM business_goals WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM projects WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM payroll_runs WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contracts WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM support_tickets WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM automations WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM delegation_loops WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM site_page_drafts WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM connector_statuses WHERE id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
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

async function businessRowText(id: string): Promise<string> {
  const rows = await db.$queryRawUnsafe('SELECT row_to_json(b)::text AS j FROM businesses b WHERE b.id = $1', id);
  expect(rows.length, `business ${id} exists`).toBe(1);
  return rows[0].j as string;
}

function getLegacyModules(businessId: string, actor?: string) {
  const req = request(app.getHttpServer()).get(`/identity/businesses/${businessId}/legacy-modules`);
  return actor ? req.set(HEADER, actor) : req;
}

beforeAll(async () => {
  expect(process.env.DATABASE_URL ?? '', 'DATABASE_URL must name the test database').not.toBe('');
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { OptionalAuthGuard } = await import('../src/core/auth/optional-auth.guard');
  const { SupabaseAdminService } = await import('../src/core/auth/supabase-admin.service');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { IdentityController } = await import('../src/modules/identity/identity.controller');
  const { IdentityService } = await import('../src/modules/identity/identity.service');
  const { IdentitySignupService } = await import('../src/modules/identity/identity-signup.service');
  const { BusinessContextService } = await import('../src/modules/identity/business-context.service');
  const { AuthSecurityService } = await import('../src/modules/identity/auth-security.service');
  const { IdentityPasswordService } = await import('../src/modules/identity/identity-password.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');

  const legacySvcPath = path.resolve(__dirname, '../src/modules/identity/legacy-modules.service.ts');
  const legacyProviders: any[] = [];
  if (existsSync(legacySvcPath)) {
    const mod = await import(legacySvcPath);
    if (mod.LegacyModulesService) {
      legacyProviders.push(mod.LegacyModulesService);
    }
  }

  const recordingPrisma = { client: wrapTxOrClient(db) };

  const moduleRef = await Test.createTestingModule({
    controllers: [IdentityController],
    providers: [
      { provide: PrismaService, useValue: recordingPrisma },
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      OptionalAuthGuard,
      ...legacyProviders,
      // Collaborators not on the legacy-modules read path.
      { provide: IdentityService, useValue: {} },
      { provide: IdentitySignupService, useValue: {} },
      { provide: BusinessContextService, useValue: {} },
      { provide: AiUsageService, useValue: {} },
      { provide: AuthSecurityService, useValue: {} },
      { provide: IdentityPasswordService, useValue: {} },
      { provide: SupabaseAdminService, useValue: {} },
      { provide: REDIS_CLIENT, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    if (typeof header === 'string' && header.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id: header }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup();

  // Seed users
  for (const [id, role] of [
    [ID.owner, 'USER'],
    [ID.staffRestricted, 'USER'],
    [ID.outsider, 'USER'],
    [ID.ownerOther, 'USER'],
    [ID.superAdmin, 'SUPER_ADMIN'],
  ] as const) {
    await db.user.create({
      data: { id, email: `${P}${id.slice(P.length)}@v67b.test.local`, name: `${id} Name`, role },
    });
  }

  // Seed businesses
  const whatsappConfig = {
    provider: 'twilio',
    accountSid: CANARY.waSid,
    authToken: CANARY.waToken,
    fromNumber: CANARY.waFrom,
  };

  await db.business.create({
    data: { id: ID.bizUsed, name: CANARY.bizUsedName, ownerId: ID.owner, slug: `${P}used` },
  });
  await db.business.create({
    data: { id: ID.bizEmpty, name: `${P}Empty Business`, ownerId: ID.owner, slug: `${P}empty`, metaData: { other: 'ok' } },
  });
  await db.business.create({
    data: { id: ID.bizV2, name: `${P}V2 Business`, ownerId: ID.owner, slug: `${P}v2`, metaData: { whatsapp: whatsappConfig } },
  });
  await db.business.create({
    data: { id: ID.bizLegacyGoal, name: `${P}Legacy Goal Business`, ownerId: ID.owner, slug: `${P}legacy-goal` },
  });
  await db.business.create({
    data: { id: ID.bizSoftDel, name: `${P}Soft Deleted Rows Business`, ownerId: ID.owner, slug: `${P}soft-del` },
  });
  await db.business.create({
    data: { id: ID.bizOther, name: `${P}Other Tenant Business`, ownerId: ID.ownerOther, slug: `${P}other` },
  });
  await db.business.create({
    data: {
      id: ID.bizGone,
      name: `${P}Closed Business`,
      ownerId: ID.owner,
      slug: `${P}gone`,
      metaData: { whatsapp: whatsappConfig },
      deletedAt: new Date(),
    },
  });

  // Seed memberships
  const allNoneScopes = {
    crm: 'none',
    revenue: 'none',
    bookings: 'none',
    projects: 'none',
    content: 'none',
    expenses: 'none',
    automations: 'none',
    storefront: 'none',
    settings: 'none',
    ai: 'none',
    team: 'none',
    analytics: 'none',
    operations: 'none',
    connect: 'none',
  };

  for (const m of [
    { id: `${P}m_owner_used`, userId: ID.owner, businessId: ID.bizUsed, role: 'OWNER' },
    { id: `${P}m_staff_used`, userId: ID.staffRestricted, businessId: ID.bizUsed, role: 'STAFF', permissionScopes: allNoneScopes },
    { id: `${P}m_owner_empty`, userId: ID.owner, businessId: ID.bizEmpty, role: 'OWNER' },
    { id: ID.membershipV2, userId: ID.owner, businessId: ID.bizV2, role: 'OWNER' },
    { id: `${P}m_owner_legacyGoal`, userId: ID.owner, businessId: ID.bizLegacyGoal, role: 'OWNER' },
    { id: `${P}m_owner_softDel`, userId: ID.owner, businessId: ID.bizSoftDel, role: 'OWNER' },
    { id: `${P}m_other_other`, userId: ID.ownerOther, businessId: ID.bizOther, role: 'OWNER' },
    { id: `${P}m_owner_gone`, userId: ID.owner, businessId: ID.bizGone, role: 'OWNER' },
  ]) {
    await db.membership.create({ data: m });
  }

  // bizUsed: live project + live payroll run -> ['payroll', 'projects']
  await db.project.create({
    data: {
      id: `${P}projUsed1`,
      businessId: ID.bizUsed,
      name: CANARY.projectName,
      budgetAmount: CANARY.budgetAmount,
    },
  });
  await db.payrollRun.create({
    data: {
      id: `${P}runUsed1`,
      businessId: ID.bizUsed,
      status: 'DRAFT',
      periodStart: new Date('2026-10-01T00:00:00.000Z'),
      periodEnd: new Date('2026-10-31T00:00:00.000Z'),
      totalGross: CANARY.payrollGross,
      currency: 'TTD',
    },
  });

  // bizEmpty: ONLY non-qualifying rows that must NOT trigger any hidden module
  await db.delegationLoop.create({
    data: { id: `${P}loopEmpty1`, businessId: ID.bizEmpty, loopType: `${P}loop`, name: `${P}Disabled Loop`, enabled: false },
  });
  await db.sitePageDraft.create({
    data: { id: `${P}draftEmpty1`, businessId: ID.bizEmpty, version: 1, payload: { title: `${P}Unsaved` } },
  });
  await db.connectorStatus.create({
    data: { id: `${P}connEmptyGmail`, businessId: ID.bizEmpty, connectorType: 'gmail', status: 'connected' },
  });
  await db.connectorStatus.create({
    data: { id: `${P}connEmptyQbOff`, businessId: ID.bizEmpty, connectorType: 'quickbooks', status: 'disconnected' },
  });

  // bizV2: ai_goals + staff_performance_snapshots (+ structure prereqs) + whatsapp meta_data
  await db.aiGoal.create({
    data: { id: `${P}aiGoalV2`, businessId: ID.bizV2, title: CANARY.goalTitle },
  });
  await db.orgUnit.create({
    data: { id: ID.orgUnitV2, businessId: ID.bizV2, name: `${P}Unit V2` },
  });
  await db.jobRole.create({
    data: { id: ID.jobRoleV2, businessId: ID.bizV2, name: `${P}Role V2` },
  });
  await db.orgAssignment.create({
    data: {
      id: ID.assignmentV2,
      businessId: ID.bizV2,
      orgUnitId: ID.orgUnitV2,
      jobRoleId: ID.jobRoleV2,
      membershipId: ID.membershipV2,
      userId: ID.owner,
    },
  });
  await db.staffPerformanceSnapshot.create({
    data: {
      id: `${P}snapV2`,
      businessId: ID.bizV2,
      assignmentId: ID.assignmentV2,
      periodStart: new Date('2026-10-01T00:00:00.000Z'),
      periodEnd: new Date('2026-11-01T00:00:00.000Z'),
    },
  });

  // bizLegacyGoal: business_goals only -> ['goals']
  await db.businessGoal.create({
    data: { id: `${P}bizGoal1`, businessId: ID.bizLegacyGoal, title: CANARY.legacyGoalTitle, category: 'revenue' },
  });

  // bizSoftDel: ONLY soft-deleted rows in soft-deleted tables -> []
  await db.project.create({
    data: { id: `${P}projSoft1`, businessId: ID.bizSoftDel, name: `${P}Deleted Project`, deletedAt: new Date() },
  });
  await db.supportTicket.create({
    data: { id: `${P}ticketSoft1`, businessId: ID.bizSoftDel, title: `${P}Deleted Ticket`, deletedAt: new Date() },
  });
  await db.automation.create({
    data: { id: `${P}autoSoft1`, businessId: ID.bizSoftDel, name: `${P}Deleted Auto`, trigger: 'invoice.paid', deletedAt: new Date() },
  });

  // bizOther: separate tenant with contracts only -> ['contracts']
  await db.contract.create({
    data: { id: `${P}conOther1`, businessId: ID.bizOther, title: CANARY.contractTitle, contractValue: 4444.44 },
  });

  // bizGone: soft-deleted business with a payroll run + whatsapp meta_data -> never counts
  await db.payrollRun.create({
    data: {
      id: `${P}runGone1`,
      businessId: ID.bizGone,
      status: 'DRAFT',
      periodStart: new Date('2026-10-01T00:00:00.000Z'),
      periodEnd: new Date('2026-10-31T00:00:00.000Z'),
      totalGross: '1234.00',
      currency: 'TTD',
    },
  });
});

afterAll(async () => {
  await app?.close();
  await cleanup();
});

describe('NAV-B-LEGACY-SERVER: GET /identity/businesses/:businessId/legacy-modules', () => {
  it('LM-01 business with projects and payroll runs returns exact sorted ["payroll","projects"] and zero counts/names/amounts', async () => {
    const res = await getLegacyModules(ID.bizUsed, ID.owner);
    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual(['payroll', 'projects']);
    expect(Array.isArray(res.body)).toBe(true);
    for (const item of res.body) {
      expect(typeof item).toBe('string');
    }
    for (const canary of [
      CANARY.bizUsedName,
      CANARY.projectName,
      CANARY.payrollGross,
      String(CANARY.budgetAmount),
      'Canary',
      'count',
      'total',
    ]) {
      expect(res.text).not.toContain(canary);
    }
  });

  it('LM-02 business with no qualifying hidden-module data returns []', async () => {
    const res = await getLegacyModules(ID.bizEmpty, ID.owner);
    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('LM-03 formatVersion 2: ai_goals + business_goals -> goals, staff_performance_snapshots -> performance, whatsapp meta_data -> whatsapp (no secret leakage)', async () => {
    const resV2 = await getLegacyModules(ID.bizV2, ID.owner);
    expect(resV2.status, resV2.text).toBe(200);
    expect(resV2.body).toEqual(['goals', 'performance', 'structure', 'whatsapp']);
    for (const secret of [CANARY.waSid, CANARY.waToken, CANARY.waFrom, CANARY.goalTitle]) {
      expect(resV2.text).not.toContain(secret);
    }

    const resLegacyGoal = await getLegacyModules(ID.bizLegacyGoal, ID.owner);
    expect(resLegacyGoal.status, resLegacyGoal.text).toBe(200);
    expect(resLegacyGoal.body).toEqual(['goals']);
    expect(resLegacyGoal.text).not.toContain(CANARY.legacyGoalTitle);
  });

  it('LM-04 soft-deleted rows in soft-deleted tables do NOT count', async () => {
    const res = await getLegacyModules(ID.bizSoftDel, ID.owner);
    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('LM-05 cross-tenant isolation: another tenant rows never count for this business', async () => {
    const resOther = await getLegacyModules(ID.bizOther, ID.ownerOther);
    expect(resOther.status, resOther.text).toBe(200);
    expect(resOther.body).toEqual(['contracts']);
    expect(resOther.text).not.toContain(CANARY.contractTitle);

    const resEmpty = await getLegacyModules(ID.bizEmpty, ID.owner);
    expect(resEmpty.status, resEmpty.text).toBe(200);
    expect(resEmpty.body).toEqual([]);
  });

  it('LM-06 non-member / outsider and another tenant owner are refused 403 without leaking keys', async () => {
    for (const [label, actor] of [
      ['outsider', ID.outsider],
      ['other-tenant-owner', ID.ownerOther],
    ] as const) {
      const res = await getLegacyModules(ID.bizUsed, actor);
      expect(res.status, `${label}: ${res.text}`).toBe(403);
      expect(res.text).not.toContain('payroll');
      expect(res.text).not.toContain('projects');
    }
  });

  it('LM-07 unauthenticated caller is refused 401 without leaking keys', async () => {
    const res = await getLegacyModules(ID.bizUsed);
    expect(res.status, res.text).toBe(401);
    expect(res.text).not.toContain('payroll');
    expect(res.text).not.toContain('projects');
  });

  it('LM-08 restricted STAFF member (all module scopes none) is admitted 200 with exact sorted module keys only', async () => {
    const res = await getLegacyModules(ID.bizUsed, ID.staffRestricted);
    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual(['payroll', 'projects']);
    expect(res.text).not.toContain(CANARY.payrollGross);
    expect(res.text).not.toContain(CANARY.projectName);
  });

  it('LM-09 read-only guarantee: handler executes zero writes and leaves the business row byte-identical', async () => {
    const before = await businessRowText(ID.bizUsed);
    recordedSql = [];
    recordedMutations = [];
    recording = true;
    try {
      const res = await getLegacyModules(ID.bizUsed, ID.owner);
      expect(res.status, res.text).toBe(200);
      expect(res.body).toEqual(['payroll', 'projects']);
    } finally {
      recording = false;
    }

    expect(recordedMutations, 'no mutating Prisma model calls').toEqual([]);
    const writeSql = recordedSql.filter((sql) => WRITE_SQL_RE.test(sql));
    expect(writeSql, 'no DML/DDL SQL statements').toEqual([]);
    expect(recordedSql.some((sql) => /\bSELECT\b/i.test(sql)), 'at least one SELECT query ran').toBe(true);
    expect(await businessRowText(ID.bizUsed)).toBe(before);
  });

  it('LM-10 soft-deleted business is refused 403 for a member and answers [] for SUPER_ADMIN', async () => {
    const memberRes = await getLegacyModules(ID.bizGone, ID.owner);
    expect(memberRes.status, memberRes.text).toBe(403);
    expect(memberRes.text).not.toContain('payroll');
    expect(memberRes.text).not.toContain('whatsapp');

    const superRes = await getLegacyModules(ID.bizGone, ID.superAdmin);
    expect(superRes.status, superRes.text).toBe(200);
    expect(superRes.body).toEqual([]);
  });
});
