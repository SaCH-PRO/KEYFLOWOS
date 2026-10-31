/**
 * R0-12-CT-TENANT-ROUTES — contact custom-field values and flow-run steps are
 * bound to the path tenant (REAL database).
 *
 * M14 (Release 0 step 6): two reads on models that carry no businessId and so
 * sit outside the tenant extension.
 *
 *   GET /crm/businesses/:businessId/contacts/:contactId/custom-field-values
 *     ContactCustomFieldValue has no businessId (schema.prisma:2674) and the
 *     service queried by contactId only, so a member of A passing A's guards
 *     read B's values by naming B's contact id under A's path.
 *
 *   GET /api/flows/businesses/:businessId/flows/:flowId/runs/:runId/steps
 *     FlowRunStep has no businessId (schema.prisma:11543) and the runner
 *     queried by runId only, so the same member read B's run steps.
 *
 * The fix binds each read through the owning relation (the contact, the run)
 * to the path tenant, with no schema change: a foreign or absent parent
 * answers 404 with no rows, and A's own reads answer 200.
 *
 * Nothing on the authorization boundary is mocked: PrismaService, the user,
 * business, membership, contact, definition, value, flow, version, run and
 * step rows, AuthGuard, BusinessGuard, ModuleScopeGuard, CrmRateLimitGuard,
 * ContactCustomFieldValueService and FlowRunnerService are all real against
 * the database at DATABASE_URL. The only stand-in is identity attachment: a
 * test middleware reads `x-test-user`, loads that seeded user row and
 * attaches `{ id, email, role }` exactly as the Supabase-verifying
 * AuthMiddleware would after token verification. Collaborators the two routes
 * never call are empty stubs.
 *
 * Every seeded row has the `k12a_` prefix (ids, emails, definition names) and
 * is hard-deleted by raw SQL in beforeAll and afterAll. No $transaction wraps
 * the suite.
 *
 * Cases tagged RED-BEFORE fail on the packet source (c2f6f46d): they answer
 * 200 with B's rows.
 *
 * Review repair (R012-SEC-01): the values route also applies the actor's CRM
 * visibility, with the predicate the contact detail route applies
 * (CrmStatsService.assertContact: tenant row AND
 * visibilityClause(resolveCrmAccess(...))). Two STAFF members of A (view-all
 * and crm_view=owned) exercise it. Cases tagged RED-BEFORE-REPAIR fail on the
 * first packet fix (83cb76c5, tenant-only binding): they answer 200 with the
 * values of a contact the member may not see. V08 checks, actor by contact,
 * that the values route answers 200 exactly when the real detail-route
 * resolver finds the contact.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k12a_';
const ID = {
  // identities
  ownerA: `${P}ownerA`,   // OWNER of bizA
  ownerB: `${P}ownerB`,   // OWNER of bizB
  staffAll: `${P}staffAll`,     // STAFF of bizA, { crm: 'read' } (view-all)
  staffOwned: `${P}staffOwned`, // STAFF of bizA, { crm: 'read', crm_view: 'owned' }
  // tenants
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  // contacts
  cA: `${P}cA`,
  cB: `${P}cB`,
  // contacts of A with record visibility (review repair R012-SEC-01)
  cPrivA: `${P}cPrivA`,               // PRIVATE, owned by ownerA, not shared
  cTeamA: `${P}cTeamA`,               // TEAM, owned by ownerA
  cOwnedByStaff: `${P}cOwnedByStaff`, // PRIVATE, owned by staffOwned
  cPrivShared: `${P}cPrivShared`,     // PRIVATE, owned by ownerA, shared to staffAll
  shareToStaffAll: `${P}shareToStaffAll`,
  // custom-field definitions and values
  defA: `${P}defA`,
  defB: `${P}defB`,
  valA: `${P}valA`,
  valB: `${P}valB`,
  valPrivA: `${P}valPrivA`,
  valTeamA: `${P}valTeamA`,
  valOwnedByStaff: `${P}valOwnedByStaff`,
  valPrivShared: `${P}valPrivShared`,
  // flows, versions, runs, steps
  flowA: `${P}flowA`,
  flowA2: `${P}flowA2`,   // a second flow of A, with no runs
  flowB: `${P}flowB`,
  verA: `${P}verA`,
  verA2: `${P}verA2`,
  verB: `${P}verB`,
  runA: `${P}runA`,
  runB: `${P}runB`,
  stepA: `${P}stepA`,
  stepB: `${P}stepB`,
};

const A_VALUE = 'k12a-A-own-cfv-3b10';
const B_VALUE = 'k12a-B-secret-cfv-91c2';
const A_STEP = 'k12a-A-own-step-0f44';
const B_STEP = 'k12a-B-secret-step-5d7e';
const PRIV_A = 'k12a-A-PRIVATE-owner-only-7731';
const TEAM_A = 'k12a-A-TEAM-owner-4410';
const OWNED_BY_STAFF = 'k12a-A-PRIVATE-staff-owned-2e09';
const PRIV_SHARED = 'k12a-A-PRIVATE-shared-to-staff-6c58';
/** Every seeded ContactCustomFieldValue row (both tenants). */
const SEEDED_VALUES = 6;

// Every table a seeded row lives in, parents last (cleanup order).
const TABLES = [
  'contact_custom_field_values',
  'custom_field_definitions',
  'contact_shares',
  'flow_run_steps',
  'flow_runs',
  'flow_versions',
  'automation_flows',
  'contacts',
  'memberships',
  'businesses',
  'users',
];

let db: any;
let app: any;
let stateBefore: string;
/** The real CrmStatsService, for its contact detail resolver (assertContact). */
let crmStats: any;

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension) by prefix.
  for (const table of TABLES) {
    try { await db.$executeRawUnsafe(`DELETE FROM ${table} WHERE id LIKE ${sqlLikePrefix(P)}`); } catch { /* best-effort */ }
  }
}

/** Every seeded row of both tenants, serialized by the database. */
async function tenantState(): Promise<string> {
  const out: Record<string, string[]> = {};
  for (const table of TABLES) {
    const rows: Array<{ j: string }> = await db.$queryRawUnsafe(
      `SELECT row_to_json(t)::text AS j FROM ${table} t WHERE id LIKE ${sqlLikePrefix(P)} ORDER BY id`,
    );
    out[table] = rows.map((r) => r.j);
  }
  return JSON.stringify(out);
}

function values(actor: string, businessId: string, contactId: string) {
  return request(app.getHttpServer())
    .get(`/crm/businesses/${businessId}/contacts/${contactId}/custom-field-values`)
    .set('x-test-user', actor);
}

function steps(actor: string, businessId: string, flowId: string, runId: string) {
  return request(app.getHttpServer())
    .get(`/api/flows/businesses/${businessId}/flows/${flowId}/runs/${runId}/steps`)
    .set('x-test-user', actor);
}

/** A denied read carries no rows and nothing of B. */
function expectNoRows(body: unknown, marker: string) {
  expect(JSON.stringify(body ?? {})).not.toContain(marker);
  expect(Array.isArray(body)).toBe(false);
  expect(body).not.toHaveProperty('items');
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { CrmCustomFieldsController } = await import('../src/modules/crm/crm-custom-fields.controller');
  const { CustomFieldDefinitionService } = await import('../src/modules/crm/custom-field-definition.service');
  const { ContactCustomFieldValueService } = await import('../src/modules/crm/contact-custom-field-value.service');
  const { FlowController } = await import('../src/modules/flow/flow.controller');
  const { FlowService } = await import('../src/modules/flow/flow.service');
  const { ActivityService } = await import('../src/modules/flow/activity.service');
  const { CrossModuleAgentService } = await import('../src/modules/flow/cross-module-agent.service');
  const { FlowEngineService } = await import('../src/modules/flow/flow-engine.service');
  const { FlowRunnerService } = await import('../src/modules/flow/flow-runner.service');
  const { FlowTemplateService } = await import('../src/modules/flow/flow-template.service');
  const { FlowActionRegistry } = await import('../src/modules/flow/flow-action.registry');
  const { RealtimeService } = await import('../src/modules/realtime/realtime.service');
  const { CrmStatsService } = await import('../src/modules/crm/crm-stats.service');

  // FlowController (its last three collaborators) and
  // ContactCustomFieldValueService take collaborators by type, with no
  // @Inject token. The production build (tsc, emitDecoratorMetadata) emits
  // these exact lists; the test transform does not, so they are declared here.
  Reflect.defineMetadata('design:paramtypes', [
    FlowService, ActivityService, CrossModuleAgentService, PrismaService,
    FlowEngineService, FlowRunnerService, FlowTemplateService,
  ], FlowController);
  Reflect.defineMetadata('design:paramtypes', [PrismaService], ContactCustomFieldValueService);

  // ---- the real HTTP path (wired before any row is seeded) --------------
  const moduleRef = await Test.createTestingModule({
    controllers: [CrmCustomFieldsController, FlowController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      ContactCustomFieldValueService,
      FlowRunnerService,
      // Collaborators the two routes under test never call.
      { provide: CustomFieldDefinitionService, useValue: {} },
      { provide: FlowService, useValue: {} },
      { provide: ActivityService, useValue: {} },
      { provide: CrossModuleAgentService, useValue: {} },
      { provide: FlowEngineService, useValue: {} },
      { provide: FlowTemplateService, useValue: {} },
      { provide: FlowActionRegistry, useValue: {} },
      { provide: RealtimeService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only, for seeded k12a_ users. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  await app.init();
  // The contact detail route's resolver reads only Prisma; assertContact never
  // touches the timeline or the cache.
  crmStats = new CrmStatsService(app.get(PrismaService), {} as any, {} as any);

  await cleanup(); // in case a prior run aborted

  // ---- identities, tenants, memberships ---------------------------------
  for (const id of [ID.ownerA, ID.ownerB, ID.staffAll, ID.staffOwned]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'K12A Biz A', ownerId: ID.ownerA } });
  await db.business.create({ data: { id: ID.bizB, name: 'K12A Biz B', ownerId: ID.ownerB } });
  await db.membership.create({ data: { id: `${P}m_A`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_B`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_staffAll`, userId: ID.staffAll, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'read' } } });
  await db.membership.create({ data: { id: `${P}m_staffOwned`, userId: ID.staffOwned, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'read', crm_view: 'owned' } } });

  // ---- contacts and custom-field values ---------------------------------
  await db.contact.create({ data: { id: ID.cA, businessId: ID.bizA, firstName: ID.cA } });
  await db.contact.create({ data: { id: ID.cB, businessId: ID.bizB, firstName: ID.cB } });
  await db.customFieldDefinition.create({ data: { id: ID.defA, businessId: ID.bizA, name: `${P}tierA`, label: 'Tier', type: 'TEXT' } });
  await db.customFieldDefinition.create({ data: { id: ID.defB, businessId: ID.bizB, name: `${P}tierB`, label: 'Tier', type: 'TEXT' } });
  await db.contactCustomFieldValue.create({ data: { id: ID.valA, contactId: ID.cA, definitionId: ID.defA, value: { marker: A_VALUE } } });
  await db.contactCustomFieldValue.create({ data: { id: ID.valB, contactId: ID.cB, definitionId: ID.defB, value: { marker: B_VALUE } } });

  // ---- contacts of A with record visibility, and their values -----------
  const contact = async (id: string, visibility: string, ownerId: string) =>
    db.contact.create({ data: { id, businessId: ID.bizA, firstName: id, visibility, ownerId } });
  await contact(ID.cPrivA, 'PRIVATE', ID.ownerA);
  await contact(ID.cTeamA, 'TEAM', ID.ownerA);
  await contact(ID.cOwnedByStaff, 'PRIVATE', ID.staffOwned);
  await contact(ID.cPrivShared, 'PRIVATE', ID.ownerA);
  await db.contactShare.create({ data: { id: ID.shareToStaffAll, businessId: ID.bizA, contactId: ID.cPrivShared, userId: ID.staffAll, createdBy: ID.ownerA } });
  const value = async (id: string, contactId: string, marker: string) =>
    db.contactCustomFieldValue.create({ data: { id, contactId, definitionId: ID.defA, value: { marker } } });
  await value(ID.valPrivA, ID.cPrivA, PRIV_A);
  await value(ID.valTeamA, ID.cTeamA, TEAM_A);
  await value(ID.valOwnedByStaff, ID.cOwnedByStaff, OWNED_BY_STAFF);
  await value(ID.valPrivShared, ID.cPrivShared, PRIV_SHARED);

  // ---- flows, versions, runs and steps ----------------------------------
  const flow = async (id: string, businessId: string) =>
    db.automationFlow.create({ data: { id, businessId, name: id, category: 'test', status: 'ACTIVE' } });
  const version = async (id: string, flowId: string) =>
    db.flowVersion.create({ data: { id, flowId, version: 1, nodes: [], edges: [], status: 'PUBLISHED' } });
  await flow(ID.flowA, ID.bizA);
  await flow(ID.flowA2, ID.bizA);
  await flow(ID.flowB, ID.bizB);
  await version(ID.verA, ID.flowA);
  await version(ID.verA2, ID.flowA2);
  await version(ID.verB, ID.flowB);
  await db.flowRun.create({ data: { id: ID.runA, businessId: ID.bizA, flowId: ID.flowA, flowVersionId: ID.verA, status: 'COMPLETED' } });
  await db.flowRun.create({ data: { id: ID.runB, businessId: ID.bizB, flowId: ID.flowB, flowVersionId: ID.verB, status: 'COMPLETED' } });
  await db.flowRunStep.create({ data: { id: ID.stepA, runId: ID.runA, nodeId: 'n1', nodeType: 'action', status: 'COMPLETED', output: { marker: A_STEP } } });
  await db.flowRunStep.create({ data: { id: ID.stepB, runId: ID.runB, nodeId: 'n1', nodeType: 'action', status: 'COMPLETED', output: { marker: B_STEP } } });

  stateBefore = await tenantState();
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('R0-12 fixture sanity (real rows)', () => {
  it('[R0-12-X01] seeded both tenants with a contact value and a run step each', async () => {
    expect(await db.contactCustomFieldValue.count({ where: { contactId: { in: [ID.cA, ID.cB] } } })).toBe(2);
    expect(await db.flowRunStep.count({ where: { runId: { in: [ID.runA, ID.runB] } } })).toBe(2);
    expect((await db.contact.findUnique({ where: { id: ID.cB } })).businessId).toBe(ID.bizB);
    expect((await db.flowRun.findUnique({ where: { id: ID.runB } })).businessId).toBe(ID.bizB);
  });
});

describe('R0-12 contact custom-field values are bound to the path tenant', () => {
  it("[R0-12-C01] RED-BEFORE: a member of A naming B's contact under A's path is not found (404) and gets none of B's values", async () => {
    const res = await values(ID.ownerA, ID.bizA, ID.cB);
    expectNoRows(res.body, B_VALUE);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Contact not found');
  });

  it("[R0-12-C02] B's contact and an absent contact answer identically under A's path (no existence oracle)", async () => {
    const foreign = await values(ID.ownerA, ID.bizA, ID.cB);
    const absent = await values(ID.ownerA, ID.bizA, `${P}does-not-exist`);
    expect(absent.status).toBe(404);
    expect(foreign.status).toBe(absent.status);
    expect(foreign.body).toEqual(absent.body);
  });

  it("[R0-12-C03] a member of A on B's path is refused by the business guard (403)", async () => {
    const res = await values(ID.ownerA, ID.bizB, ID.cB);
    expect(res.status).toBe(403);
    expectNoRows(res.body, B_VALUE);
  });

  it("[R0-12-C04] positive control: A reads its own contact's values on its own path (200)", async () => {
    const res = await values(ID.ownerA, ID.bizA, ID.cA);
    expect(res.status).toBe(200);
    expect(res.body.map((v: any) => v.id)).toEqual([ID.valA]);
    expect(res.body[0].value).toEqual({ marker: A_VALUE });
    expect(res.body[0].definition.id).toBe(ID.defA);
  });

  it("[R0-12-C05] positive control: B reads its own contact's values on its own path (200), so the denial is not vacuous", async () => {
    const res = await values(ID.ownerB, ID.bizB, ID.cB);
    expect(res.status).toBe(200);
    expect(res.body.map((v: any) => v.id)).toEqual([ID.valB]);
    expect(res.body[0].value).toEqual({ marker: B_VALUE });
  });
});

describe("R0-12 contact custom-field values follow the actor's CRM visibility", () => {
  it("[R0-12-V01] RED-BEFORE-REPAIR: a STAFF view-all member naming the owner's PRIVATE contact is not found (404) and gets none of its values", async () => {
    const res = await values(ID.staffAll, ID.bizA, ID.cPrivA);
    expectNoRows(res.body, PRIV_A);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Contact not found');
  });

  it("[R0-12-V02] RED-BEFORE-REPAIR: a STAFF crm_view=owned member naming the owner's TEAM contact is not found (404) and gets none of its values", async () => {
    const res = await values(ID.staffOwned, ID.bizA, ID.cTeamA);
    expectNoRows(res.body, TEAM_A);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Contact not found');
  });

  it('[R0-12-V03] a contact the member may not see and an absent contact answer identically (no existence oracle)', async () => {
    const absent = await values(ID.staffAll, ID.bizA, `${P}does-not-exist`);
    const hidden = await values(ID.staffAll, ID.bizA, ID.cPrivA);
    const hiddenTeam = await values(ID.staffOwned, ID.bizA, ID.cTeamA);
    expect(absent.status).toBe(404);
    expect(hidden.status).toBe(absent.status);
    expect(hidden.body).toEqual(absent.body);
    expect(hiddenTeam.status).toBe(absent.status);
    expect(hiddenTeam.body).toEqual(absent.body);
  });

  it("[R0-12-V04] positive control: a STAFF view-all member reads the owner's TEAM contact's values (200)", async () => {
    const res = await values(ID.staffAll, ID.bizA, ID.cTeamA);
    expect(res.status).toBe(200);
    expect(res.body.map((v: any) => v.id)).toEqual([ID.valTeamA]);
    expect(res.body[0].value).toEqual({ marker: TEAM_A });
  });

  it('[R0-12-V05] positive control: a STAFF view-all member reads a PRIVATE contact explicitly shared to them (200)', async () => {
    const res = await values(ID.staffAll, ID.bizA, ID.cPrivShared);
    expect(res.status).toBe(200);
    expect(res.body.map((v: any) => v.id)).toEqual([ID.valPrivShared]);
    expect(res.body[0].value).toEqual({ marker: PRIV_SHARED });
  });

  it('[R0-12-V06] positive control: a STAFF crm_view=owned member reads the PRIVATE contact they own (200)', async () => {
    const res = await values(ID.staffOwned, ID.bizA, ID.cOwnedByStaff);
    expect(res.status).toBe(200);
    expect(res.body.map((v: any) => v.id)).toEqual([ID.valOwnedByStaff]);
    expect(res.body[0].value).toEqual({ marker: OWNED_BY_STAFF });
  });

  it("[R0-12-V07] positive control: the OWNER reads the PRIVATE and TEAM contacts' values (200), so the STAFF denials are not vacuous", async () => {
    const priv = await values(ID.ownerA, ID.bizA, ID.cPrivA);
    expect(priv.status).toBe(200);
    expect(priv.body.map((v: any) => v.id)).toEqual([ID.valPrivA]);
    expect(priv.body[0].value).toEqual({ marker: PRIV_A });
    const team = await values(ID.ownerA, ID.bizA, ID.cTeamA);
    expect(team.status).toBe(200);
    expect(team.body.map((v: any) => v.id)).toEqual([ID.valTeamA]);
  });

  it('[R0-12-V08] for every actor and contact of A, the values route answers 200 exactly when the contact detail resolver finds the contact', async () => {
    const actors = [ID.ownerA, ID.staffAll, ID.staffOwned];
    const contacts = [ID.cA, ID.cPrivA, ID.cTeamA, ID.cOwnedByStaff, ID.cPrivShared];
    const rows: string[] = [];
    const mismatched: string[] = [];
    for (const actor of actors) {
      for (const contactId of contacts) {
        // The real resolver behind GET /crm/businesses/:businessId/contacts/:contactId.
        const detail: number = await crmStats.assertContact(ID.bizA, contactId, actor).then(
          () => 200,
          (err: any) => (typeof err?.getStatus === 'function' ? err.getStatus() : 500),
        );
        const res = await values(actor, ID.bizA, contactId);
        const row = `${actor} ${contactId} detail=${detail} values=${res.status}`;
        rows.push(row);
        if (detail !== res.status) mismatched.push(row);
      }
    }
    expect(mismatched).toEqual([]);
    // The matrix is not degenerate: each STAFF member is both admitted and refused.
    expect(rows).toContain(`${ID.staffAll} ${ID.cPrivA} detail=404 values=404`);
    expect(rows).toContain(`${ID.staffAll} ${ID.cPrivShared} detail=200 values=200`);
    expect(rows).toContain(`${ID.staffOwned} ${ID.cTeamA} detail=404 values=404`);
    expect(rows).toContain(`${ID.staffOwned} ${ID.cOwnedByStaff} detail=200 values=200`);
  });
});

describe('R0-12 flow-run steps are bound to the path tenant', () => {
  it("[R0-12-F01] RED-BEFORE: a member of A naming B's flow and run under A's path is not found (404) and gets none of B's steps", async () => {
    const res = await steps(ID.ownerA, ID.bizA, ID.flowB, ID.runB);
    expectNoRows(res.body, B_STEP);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Flow run not found');
  });

  it("[R0-12-F02] RED-BEFORE: B's run under A's own flow is not found (404) and gets none of B's steps", async () => {
    const res = await steps(ID.ownerA, ID.bizA, ID.flowA, ID.runB);
    expectNoRows(res.body, B_STEP);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Flow run not found');
  });

  it("[R0-12-F03] B's run and an absent run answer identically under A's path (no existence oracle)", async () => {
    const foreign = await steps(ID.ownerA, ID.bizA, ID.flowA, ID.runB);
    const absent = await steps(ID.ownerA, ID.bizA, ID.flowA, `${P}does-not-exist`);
    expect(absent.status).toBe(404);
    expect(foreign.status).toBe(absent.status);
    expect(foreign.body).toEqual(absent.body);
  });

  it("[R0-12-F04] A's run under another of A's flows is not found (404): the run is bound to the path flow too", async () => {
    const res = await steps(ID.ownerA, ID.bizA, ID.flowA2, ID.runA);
    expect(res.status).toBe(404);
    expectNoRows(res.body, A_STEP);
  });

  it("[R0-12-F05] a member of A on B's path is refused by the business guard (403)", async () => {
    const res = await steps(ID.ownerA, ID.bizB, ID.flowB, ID.runB);
    expect(res.status).toBe(403);
    expectNoRows(res.body, B_STEP);
  });

  it('[R0-12-F06] positive control: A reads its own run steps on its own path (200)', async () => {
    const res = await steps(ID.ownerA, ID.bizA, ID.flowA, ID.runA);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items.map((s: any) => s.id)).toEqual([ID.stepA]);
    expect(res.body.items[0].output).toEqual({ marker: A_STEP });
  });

  it('[R0-12-F07] positive control: B reads its own run steps on its own path (200), so the denial is not vacuous', async () => {
    const res = await steps(ID.ownerB, ID.bizB, ID.flowB, ID.runB);
    expect(res.status).toBe(200);
    expect(res.body.items.map((s: any) => s.id)).toEqual([ID.stepB]);
    expect(res.body.items[0].output).toEqual({ marker: B_STEP });
  });
});

describe('R0-12 tenant state after the attempts', () => {
  it('[R0-12-S01] every seeded row of both tenants is byte-identical after the cross-tenant attempts', async () => {
    // Attempt each cross-tenant read once more right before the comparison.
    await values(ID.ownerA, ID.bizA, ID.cB);
    await steps(ID.ownerA, ID.bizA, ID.flowB, ID.runB);
    await steps(ID.ownerA, ID.bizA, ID.flowA, ID.runB);
    await values(ID.staffAll, ID.bizA, ID.cPrivA);
    await values(ID.staffOwned, ID.bizA, ID.cTeamA);
    const after = await tenantState();
    expect(after).toBe(stateBefore);
    expect(JSON.parse(after).contact_custom_field_values).toHaveLength(SEEDED_VALUES);
    expect(JSON.parse(after).flow_run_steps).toHaveLength(2);
  });
});
