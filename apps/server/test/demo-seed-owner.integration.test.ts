/**
 * PR196-SEED-DEMO-OWNER (V1-88, owner ruling D-84, 2026-11-09) — the demo
 * seed is OWNER only and audited, and there is no separate sample-contact
 * seeding route. REAL database.
 *
 * WHY: PR #196 added POST .../seed-sample-contact beside our POST .../seed-demo.
 * Its review (OK-6-1, OK-6-2, OK-6-4; verdicts real) found the sample route,
 * and our seed-demo route with it, guarded by AuthGuard and BusinessGuard only:
 *
 *   OK-6-1  any member (STAFF without a CRM scope, an ADMIN) and a SUPER_ADMIN
 *           who is not a member (BusinessGuard's platform bypass) writes the
 *           demo contact and a DRAFT demo invoice into a live business;
 *   OK-6-2  the contact write records no ContactAuditEntry (D-25: every
 *           contact write records one) and no actor: the seeder never learns
 *           who asked;
 *   OK-6-4  a unique violation on the seed answers 500. In ours the sample
 *           email is held by the partial live unique
 *           (contacts_business_id_email_normalized_live_key): when a live
 *           contact other than the demo contact holds it, every retry hits the
 *           same P2002 and the route answers 500 Internal server error.
 *
 * D-84: there is no separate sample-contact seeding route; the existing demo
 * seed is OWNER-only and audited. OWNER is D-11's owner (the OWNER membership
 * or the distinguished owner, Business.ownerId), with no platform bypass: a
 * SUPER_ADMIN who is not a member is refused, as on tenant invoice writes
 * (D-46; the seed writes a DRAFT invoice). The audit is written in the seed's
 * own transaction, so no seed commits without it: a ContactAuditEntry
 * 'created' on the demo contact with a USER actor naming the owner (D-25), and
 * a team_activity_logs row 'demo_data_seeded' naming the owner and the demo
 * contact and invoice (the actor row completion writes, R0-SEC-03). A repeated
 * seed answers the existing demo data and writes nothing; a seed that cannot
 * take the sample email answers 409 DEMO_SEED_CONFLICT and writes nothing;
 * neither is ever a 500.
 *
 * REVIEW REPAIR (SDO-SEC-1, CR-1): the seeder has a second door, onboarding
 * completion (POST .../complete seeds inside its own transaction). Before the
 * repair it ran the same contact create with no conflict handling: a live
 * non-demo contact holding the sample email (one any member with crm:write,
 * or an import, can write) made every owner's /complete answer 500 and roll
 * back, so the owner could never finish onboarding; and a seed-demo racing
 * /complete made /complete answer 500. Now both doors check the sample email
 * first (seed-demo answers 409; completion completes without demo data), and
 * both seeds take the business row lock first, so seed-demo and completion
 * queue instead of racing on the unique.
 *
 * COMPOSITION: the real OnboardingConciergeController (its class guards
 * AuthGuard and BusinessGuard, real), the real OnboardingConciergeService and
 * DemoDataSeederService over the real PrismaService, the production
 * TenantInterceptor (APP_INTERCEPTOR, as AppModule registers it: /complete
 * reads its actor from the tenant context it binds), and the production
 * GlobalHttpExceptionFilter (so an unmapped error is the 500 a client sees).
 * The concierge's AI, catalog, blueprint and state collaborators are stubs
 * (completion's genome recommendation and disclaimer read the blueprint stub,
 * which has none). The only stand-in on the boundary is identity
 * attachment: a test middleware reads `x-test-user` and attaches the seeded
 * user's { id, email, role } exactly as AuthMiddleware does after token
 * verification.
 *
 * FIXTURES: prefix `v88d_` (registered in test/helpers/fixture-prefixes.json).
 * Every row is hard-deleted by raw SQL in beforeAll and afterAll; the demo rows
 * the server mints (cuid ids) are reached through the fixture businesses. No
 * $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000 });

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v88d_';
const ID = {
  owner: `${P}owner`,       // OWNER membership and Business.ownerId of bizA, bizC and bizR
  admin: `${P}admin`,       // ADMIN of bizA, role-default scopes
  staff: `${P}staff`,       // STAFF of bizA, granted crm:write and settings:write
  platform: `${P}platform`, // SUPER_ADMIN, no membership anywhere
  outsider: `${P}outsider`, // OWNER of bizB only
  legacy: `${P}legacy`,     // Business.ownerId of bizL, no membership row (D-11's second arm)
  bizA: `${P}bizA`,         // the business the refusals and the owner's seed run on
  bizB: `${P}bizB`,         // the outsider's own business
  bizC: `${P}bizC`,         // a live non-demo contact already holds the sample email
  bizR: `${P}bizR`,         // three concurrent seeds
  bizL: `${P}bizL`,         // the distinguished owner without a membership row
  bizK: `${P}bizK`,         // completion while a live non-demo contact holds the sample email
  bizP: `${P}bizP`,         // seed-demo and /complete at once (seed-demo sent first)
  bizQ: `${P}bizQ`,         // /complete and seed-demo at once (/complete sent first)
  cTaken: `${P}cTaken`,     // the live contact of bizC holding the sample email
  cTakenK: `${P}cTakenK`,   // the live contact of bizK holding the sample email
};
const BUSINESSES = [ID.bizA, ID.bizB, ID.bizC, ID.bizR, ID.bizL, ID.bizK, ID.bizP, ID.bizQ];
/** The minimal profile completion requires (D-03): name, ISO currency, IANA timezone. */
const COMPLETABLE = { currency: 'TTD', timezone: 'America/Port_of_Spain' };
const SAMPLE_EMAIL = 'sample-client@example.com';
const OWNER_ONLY_CODE = 'DEMO_SEED_OWNER_ONLY';
const CONFLICT_CODE = 'DEMO_SEED_CONFLICT';
/** POST .../seed-demo and POST .../complete are plain Nest @Posts: success is 201. */
const SEED_OK = 201;
const COMPLETE_OK = 201;

const emailOf = (id: string) => `${id}@test.local`;

let db: any;
let app: any;

async function cleanup() {
  const biz = `business_id LIKE ${sqlLikePrefix(P)}`;
  for (const sql of [
    `DELETE FROM contact_audit_entries WHERE ${biz}`,
    `DELETE FROM team_activity_logs WHERE ${biz}`,
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE ${biz})`,
    `DELETE FROM invoices WHERE ${biz}`,
    `DELETE FROM contacts WHERE ${biz}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** Remove every row a seed can write on one fixture business (demo contact, invoice, audit, activity). */
async function resetDemoRows(businessId: string) {
  await db.$executeRawUnsafe('DELETE FROM contact_audit_entries WHERE business_id = $1', businessId);
  await db.$executeRawUnsafe('DELETE FROM team_activity_logs WHERE business_id = $1', businessId);
  await db.$executeRawUnsafe('DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id = $1)', businessId);
  await db.$executeRawUnsafe('DELETE FROM invoices WHERE business_id = $1', businessId);
  await db.$executeRawUnsafe("DELETE FROM contacts WHERE business_id = $1 AND source = 'demo'", businessId);
}

/** Everything a seed writes on a business, counted on the real rows. */
async function seedFootprint(businessId: string) {
  const [demoContacts, invoices, audits, activities] = await Promise.all([
    db.contact.findMany({ where: { businessId, source: 'demo' }, select: { id: true, deletedAt: true } }),
    db.invoice.findMany({ where: { businessId }, select: { id: true, contactId: true, status: true, invoiceNumber: true, currency: true } }),
    db.contactAuditEntry.findMany({ where: { businessId } }),
    db.teamActivityLog.findMany({ where: { businessId } }),
  ]);
  return { demoContacts, invoices, audits, activities };
}

async function expectNothingWritten(businessId: string, label: string) {
  const f = await seedFootprint(businessId);
  expect(f.demoContacts, `${label}: demo contacts`).toEqual([]);
  expect(f.invoices, `${label}: invoices`).toEqual([]);
  expect(f.audits, `${label}: contact audit entries`).toEqual([]);
  expect(f.activities, `${label}: team activity rows`).toEqual([]);
}

function seed(actor: string | null, businessId: string) {
  const req = request(app.getHttpServer()).post(`/onboarding-concierge/businesses/${businessId}/seed-demo`);
  return actor ? req.set('x-test-user', actor) : req;
}

function complete(actor: string, businessId: string) {
  return request(app.getHttpServer()).post(`/onboarding-concierge/businesses/${businessId}/complete`).set('x-test-user', actor);
}

async function completionState(businessId: string) {
  return db.business.findUnique({ where: { id: businessId }, select: { onboardingComplete: true, onboardingCompletedAt: true } });
}

function expectOwnerOnlyRefusal(res: { status: number; body: any }, label: string) {
  expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(403);
  expect(res.body?.code, `${label}: refusal code`).toBe(OWNER_ONLY_CODE);
  for (const key of ['contactId', 'invoiceId', 'invoiceNumber']) expect(res.body, `${label}: ${key}`).not.toHaveProperty(key);
}

/** The owner's seed on a fresh business: one live demo contact, one DRAFT invoice for it, and the audit naming `actor`. */
async function expectSeededAndAudited(businessId: string, actor: string, body: any, currency: string) {
  const f = await seedFootprint(businessId);
  expect(f.demoContacts, 'exactly one demo contact').toHaveLength(1);
  const contactId = f.demoContacts[0].id;
  expect(f.demoContacts[0].deletedAt).toBeNull();
  expect(f.invoices, 'exactly one demo invoice').toHaveLength(1);
  expect(f.invoices[0]).toMatchObject({ contactId, status: 'DRAFT', currency });
  expect(body).toMatchObject({ contactId, invoiceId: f.invoices[0].id, invoiceNumber: f.invoices[0].invoiceNumber, alreadySeeded: false });

  // D-25: the contact write records a ContactAuditEntry naming the owner.
  const created = f.audits.filter((a: any) => a.action === 'created');
  expect(created, `contact audit entries: ${JSON.stringify(f.audits)}`).toHaveLength(1);
  expect(created[0]).toMatchObject({ contactId, entityType: 'contact', entityId: contactId });
  expect(created[0].actor).toEqual({ type: 'USER', id: actor });
  expect(created[0].contactHash).toMatch(/^sha256:[0-9a-f]{64}$/);

  // The actor row: who seeded, and what.
  expect(f.activities, `team activity rows: ${JSON.stringify(f.activities)}`).toHaveLength(1);
  expect(f.activities[0]).toMatchObject({ userId: actor, action: 'demo_data_seeded', entityType: 'business', entityId: businessId });
  expect(f.activities[0].meta).toEqual({ demoContactId: contactId, demoInvoiceId: f.invoices[0].id, demoInvoiceNumber: f.invoices[0].invoiceNumber });
  return { contactId, invoiceId: f.invoices[0].id };
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { OnboardingConciergeController } = await import('../src/modules/onboarding-concierge/onboarding-concierge.controller');
  const { OnboardingConciergeService } = await import('../src/modules/onboarding-concierge/onboarding-concierge.service');
  const { OnboardingStateService } = await import('../src/modules/onboarding-concierge/onboarding-state.service');
  const { DemoDataSeederService } = await import('../src/modules/onboarding-concierge/demo-data-seeder.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');
  const { BlueprintService } = await import('../src/modules/blueprint/blueprint.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { APP_INTERCEPTOR } = await import('@nestjs/core');

  const moduleRef = await Test.createTestingModule({
    controllers: [OnboardingConciergeController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      OnboardingConciergeService,
      DemoDataSeederService,
      { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
      // Not on the seed-demo path: no AI, catalog or wizard-state call.
      { provide: AiUsageService, useValue: {} },
      { provide: CatalogService, useValue: {} },
      { provide: OnboardingStateService, useValue: {} },
      // Completion reads the blueprint for its genome recommendation (advice;
      // unavailable reads as null) and the disclaimer (no blueprint, none
      // recorded). Neither touches the seed.
      {
        provide: BlueprintService,
        useValue: {
          calculateGenomeIntegrity: async () => { throw new Error('no genome on this path'); },
          getBlueprint: async () => null,
        },
      },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  // Identity attachment only, as AuthMiddleware attaches it from the User row.
  // No guard is overridden.
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

  await cleanup(); // in case a prior run aborted

  for (const id of [ID.owner, ID.admin, ID.staff, ID.platform, ID.outsider, ID.legacy]) {
    await db.user.create({ data: { id, email: emailOf(id), name: id, role: id === ID.platform ? 'SUPER_ADMIN' : 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: `${ID.bizA}-name`, ownerId: ID.owner, currency: 'USD' } });
  await db.business.create({ data: { id: ID.bizB, name: `${ID.bizB}-name`, ownerId: ID.outsider } });
  await db.business.create({ data: { id: ID.bizC, name: `${ID.bizC}-name`, ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizR, name: `${ID.bizR}-name`, ownerId: ID.owner, currency: 'TTD' } });
  await db.business.create({ data: { id: ID.bizL, name: `${ID.bizL}-name`, ownerId: ID.legacy, currency: 'TTD' } });
  for (const id of [ID.bizK, ID.bizP, ID.bizQ]) {
    await db.business.create({ data: { id, name: `${id}-name`, ownerId: ID.owner, ...COMPLETABLE } });
  }

  const m = (userId: string, businessId: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({
      data: { id: `${P}m_${userId.slice(P.length)}_${businessId.slice(P.length)}`, userId, businessId, role, permissionScopes: permissionScopes ?? undefined },
    });
  await m(ID.owner, ID.bizA, 'OWNER');
  await m(ID.admin, ID.bizA, 'ADMIN');
  await m(ID.staff, ID.bizA, 'STAFF', { crm: 'write', revenue: 'write', settings: 'write' });
  await m(ID.outsider, ID.bizB, 'OWNER');
  await m(ID.owner, ID.bizC, 'OWNER');
  await m(ID.owner, ID.bizR, 'OWNER');
  await m(ID.owner, ID.bizK, 'OWNER');
  await m(ID.staff, ID.bizK, 'STAFF', { crm: 'write' });
  await m(ID.owner, ID.bizP, 'OWNER');
  await m(ID.owner, ID.bizQ, 'OWNER');

  // bizC: a live contact that is not the demo contact already holds the
  // sample email (one the owner added, imported, or re-labelled from the
  // demo contact). The live partial unique reserves the email for it.
  await db.contact.create({
    data: { id: ID.cTaken, businessId: ID.bizC, firstName: 'Taken', email: SAMPLE_EMAIL, emailNormalized: SAMPLE_EMAIL, source: 'manual' },
  });
  // bizK: the same, written as the STAFF member's CRM create would write it
  // (crm:write is all it takes), before the owner finishes onboarding.
  await db.contact.create({
    data: { id: ID.cTakenK, businessId: ID.bizK, firstName: 'Taken', email: SAMPLE_EMAIL, emailNormalized: SAMPLE_EMAIL, source: 'manual' },
  });
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
}, 60_000);

describe('PR196-SEED-DEMO-OWNER fixture sanity (real rows)', () => {
  it('[SD-X01] eight tenants, six users, ten memberships; the SUPER_ADMIN and the legacy owner hold no membership; completion has not run', async () => {
    expect(await db.business.count({ where: { id: { startsWith: P } } })).toBe(8);
    expect(await db.user.count({ where: { id: { startsWith: P } } })).toBe(6);
    expect(await db.membership.count({ where: { id: { startsWith: P } } })).toBe(10);
    for (const biz of [ID.bizK, ID.bizP, ID.bizQ]) {
      expect(await completionState(biz), biz).toEqual({ onboardingComplete: false, onboardingCompletedAt: null });
    }
    expect(await db.membership.count({ where: { userId: { in: [ID.platform, ID.legacy] } } })).toBe(0);
    for (const biz of BUSINESSES) {
      const f = await seedFootprint(biz);
      expect(f.demoContacts.length + f.invoices.length + f.audits.length + f.activities.length, biz).toBe(0);
    }
  });
});

describe('seed-demo is OWNER only (D-84, D-11; review OK-6-1)', () => {
  it('[SD-01] RED-BEFORE: an ADMIN member (role defaults) is refused 403 DEMO_SEED_OWNER_ONLY and nothing is written', async () => {
    await resetDemoRows(ID.bizA);
    const res = await seed(ID.admin, ID.bizA);
    await expectNothingWritten(ID.bizA, 'ADMIN seed');
    expectOwnerOnlyRefusal(res, 'ADMIN seed');
  });

  it('[SD-02] RED-BEFORE: a STAFF member granted crm:write, revenue:write and settings:write is refused 403 (owner only, regardless of granted scopes) and nothing is written', async () => {
    await resetDemoRows(ID.bizA);
    const res = await seed(ID.staff, ID.bizA);
    await expectNothingWritten(ID.bizA, 'STAFF seed');
    expectOwnerOnlyRefusal(res, 'STAFF seed');
  });

  it('[SD-03] RED-BEFORE: a SUPER_ADMIN who is not a member passes BusinessGuard but is refused 403 by the owner check (no platform bypass, D-46) and nothing is written', async () => {
    await resetDemoRows(ID.bizA);
    const res = await seed(ID.platform, ID.bizA);
    await expectNothingWritten(ID.bizA, 'SUPER_ADMIN seed');
    expectOwnerOnlyRefusal(res, 'SUPER_ADMIN seed');
  });

  it('[SD-04] control: the owner of another business is refused by BusinessGuard (403) and nothing is written on either business', async () => {
    await resetDemoRows(ID.bizA);
    const res = await seed(ID.outsider, ID.bizA);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    await expectNothingWritten(ID.bizA, 'outsider seed');
    await expectNothingWritten(ID.bizB, 'outsider seed (own business)');
  });

  it('[SD-05] control: an unauthenticated call is refused 401 and nothing is written', async () => {
    await resetDemoRows(ID.bizA);
    const res = await seed(null, ID.bizA);
    expect(res.status, JSON.stringify(res.body)).toBe(401);
    await expectNothingWritten(ID.bizA, 'anonymous seed');
  });
});

describe('the owner seeds, and the seed is audited in its own transaction (D-84, D-25; review OK-6-2)', () => {
  it('[SD-06] RED-BEFORE: the OWNER seeds (201): one live demo contact, one DRAFT invoice in the business currency, a ContactAuditEntry created with a USER actor naming the owner, and a demo_data_seeded activity row naming the owner', async () => {
    await resetDemoRows(ID.bizA);
    const res = await seed(ID.owner, ID.bizA);
    expect(res.status, JSON.stringify(res.body)).toBe(SEED_OK);
    await expectSeededAndAudited(ID.bizA, ID.owner, res.body, 'USD');
  });

  it('[SD-07] RED-BEFORE: a repeated seed by the owner is idempotent: 201 with the same ids and alreadySeeded true; still one contact, one invoice, one audit entry and one activity row', async () => {
    const before = await seedFootprint(ID.bizA);
    expect(before.demoContacts, 'SD-06 left one demo contact').toHaveLength(1);
    const res = await seed(ID.owner, ID.bizA);
    expect(res.status, JSON.stringify(res.body)).toBe(SEED_OK);
    expect(res.body).toEqual({
      contactId: before.demoContacts[0].id,
      invoiceId: before.invoices[0].id,
      invoiceNumber: before.invoices[0].invoiceNumber,
      alreadySeeded: true,
    });
    const after = await seedFootprint(ID.bizA);
    expect(after.demoContacts).toHaveLength(1);
    expect(after.invoices).toHaveLength(1);
    expect(after.audits, 'no second audit entry for a seed that wrote nothing').toHaveLength(1);
    expect(after.activities, 'no second activity row for a seed that wrote nothing').toHaveLength(1);
  });

  it('[SD-08] owner ruling D-104 (W10-OWNER-MEMBERSHIP; was: seeds, and the audit names them): the distinguished owner (Business.ownerId, no membership row) is refused by BusinessGuard (403) and nothing is written', async () => {
    await resetDemoRows(ID.bizL);
    const res = await seed(ID.legacy, ID.bizL);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(JSON.stringify(res.body)).toContain('No access to this business');
    await expectNothingWritten(ID.bizL, 'refused seed');
  });
});

describe('a seed never answers 500 on a unique violation (review OK-6-4)', () => {
  it('[SD-09] RED-BEFORE: when a live non-demo contact holds the sample email, the owner\'s seed answers 409 DEMO_SEED_CONFLICT (not 500) and writes nothing; the holder is untouched', async () => {
    await resetDemoRows(ID.bizC);
    const res = await seed(ID.owner, ID.bizC);
    expect(res.status, JSON.stringify(res.body)).not.toBe(500);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body?.code).toBe(CONFLICT_CODE);
    await expectNothingWritten(ID.bizC, 'conflicting seed');
    const holder = await db.contact.findUnique({ where: { id: ID.cTaken }, select: { source: true, emailNormalized: true, deletedAt: true } });
    expect(holder).toEqual({ source: 'manual', emailNormalized: SAMPLE_EMAIL, deletedAt: null });
  });

  it('[SD-10] RED-BEFORE: three concurrent seeds by the owner all answer 201 with the same ids (never 500); exactly one contact, one invoice, one audit entry and one activity row', async () => {
    await resetDemoRows(ID.bizR);
    const results = await Promise.all([seed(ID.owner, ID.bizR), seed(ID.owner, ID.bizR), seed(ID.owner, ID.bizR)]);
    const statuses = results.map((r) => r.status);
    expect(statuses, JSON.stringify(results.map((r) => r.body))).not.toContain(500);
    expect(statuses).toEqual([SEED_OK, SEED_OK, SEED_OK]);
    const f = await seedFootprint(ID.bizR);
    expect(f.demoContacts).toHaveLength(1);
    expect(f.invoices).toHaveLength(1);
    expect(f.audits.filter((a: any) => a.action === 'created')).toHaveLength(1);
    expect(f.activities).toHaveLength(1);
    expect(new Set(results.map((r) => r.body.contactId))).toEqual(new Set([f.demoContacts[0].id]));
    expect(results.filter((r) => r.body.alreadySeeded === false), 'exactly one call wrote the seed').toHaveLength(1);
  });
});

describe('the completion door never answers 500 on the sample email either (review SDO-SEC-1, CR-1)', () => {
  it('[SD-12] RED-BEFORE: when a live non-demo contact holds the sample email, the owner\'s /complete completes (201, demoData null) without demo data, and a retry answers alreadyComplete; the holder is untouched', async () => {
    const res = await complete(ID.owner, ID.bizK);
    expect(res.status, JSON.stringify(res.body)).not.toBe(500);
    expect(res.status, JSON.stringify(res.body)).toBe(COMPLETE_OK);
    expect(res.body).toMatchObject({ complete: true, demoData: null });

    const state = await completionState(ID.bizK);
    expect(state?.onboardingComplete).toBe(true);
    expect(state?.onboardingCompletedAt).toBeInstanceOf(Date);

    const f = await seedFootprint(ID.bizK);
    expect(f.demoContacts, 'no demo contact').toEqual([]);
    expect(f.invoices, 'no demo invoice').toEqual([]);
    expect(f.audits, 'no contact audit entry').toEqual([]);
    const completed = f.activities.filter((a: any) => a.action === 'onboarding_completed');
    expect(completed, JSON.stringify(f.activities)).toHaveLength(1);
    expect(completed[0]).toMatchObject({ userId: ID.owner, entityId: ID.bizK });
    expect(completed[0].meta).toEqual({ demoContactId: null, demoInvoiceId: null, demoInvoiceNumber: null });
    expect(f.activities.filter((a: any) => a.action === 'demo_data_seeded')).toEqual([]);

    const holder = await db.contact.findUnique({ where: { id: ID.cTakenK }, select: { source: true, emailNormalized: true, deletedAt: true } });
    expect(holder).toEqual({ source: 'manual', emailNormalized: SAMPLE_EMAIL, deletedAt: null });

    const again = await complete(ID.owner, ID.bizK);
    expect(again.status, JSON.stringify(again.body)).toBe(COMPLETE_OK);
    expect(again.body).toEqual({ complete: true, alreadyComplete: true });
  });

  it('[SD-13] control: on that business seed-demo still answers 409 DEMO_SEED_CONFLICT (one rule on both doors) and writes nothing', async () => {
    const res = await seed(ID.owner, ID.bizK);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body?.code).toBe(CONFLICT_CODE);
    const f = await seedFootprint(ID.bizK);
    expect(f.demoContacts).toEqual([]);
    expect(f.invoices).toEqual([]);
    expect(f.audits).toEqual([]);
  });

  // Before the repair, seed-demo first made /complete 500 (its insert waited
  // on seed-demo's and then hit P2002 in the completion transaction, which has
  // no retry); /complete first passed (seed-demo's own retry read
  // completion's rows), so SD-15 is the control.
  for (const [label, tag, biz, order] of [
    ['SD-14', 'RED-BEFORE', ID.bizP, 'seed-demo first'],
    ['SD-15', 'control', ID.bizQ, '/complete first'],
  ] as const) {
    it(`[${label}] ${tag}: seed-demo and /complete by the owner at once (${order}) both answer 201 (never 500) and name the one demo contact and invoice; the business is complete`, async () => {
      const calls = order === 'seed-demo first'
        ? [seed(ID.owner, biz), complete(ID.owner, biz)]
        : [complete(ID.owner, biz), seed(ID.owner, biz)];
      const results = await Promise.all(calls);
      const [seeded, completed] = order === 'seed-demo first' ? results : [results[1], results[0]];
      expect(results.map((r) => r.status), JSON.stringify(results.map((r) => r.body))).not.toContain(500);
      expect(seeded.status, JSON.stringify(seeded.body)).toBe(SEED_OK);
      expect(completed.status, JSON.stringify(completed.body)).toBe(COMPLETE_OK);

      const f = await seedFootprint(biz);
      expect(f.demoContacts, 'exactly one demo contact').toHaveLength(1);
      expect(f.invoices, 'exactly one demo invoice').toHaveLength(1);
      const ids = { contactId: f.demoContacts[0].id, invoiceId: f.invoices[0].id, invoiceNumber: f.invoices[0].invoiceNumber };
      expect(seeded.body).toMatchObject(ids);
      expect(completed.body).toMatchObject({ complete: true, demoData: ids });
      expect(f.activities.filter((a: any) => a.action === 'onboarding_completed')).toHaveLength(1);
      // The seed-demo call wrote the demo data exactly when it ran first (its
      // audit and actor row with it); otherwise it answered completion's rows.
      const seedWrote = seeded.body.alreadySeeded === false;
      expect(f.activities.filter((a: any) => a.action === 'demo_data_seeded')).toHaveLength(seedWrote ? 1 : 0);
      expect(f.audits.filter((a: any) => a.action === 'created')).toHaveLength(seedWrote ? 1 : 0);

      const state = await completionState(biz);
      expect(state?.onboardingComplete).toBe(true);
      expect(state?.onboardingCompletedAt).toBeInstanceOf(Date);
    });
  }
});

describe('there is no separate sample-contact seeding route (D-84)', () => {
  it('[SD-11] POST .../seed-sample-contact does not exist (404) and writes nothing, for the owner', async () => {
    await resetDemoRows(ID.bizA);
    const res = await request(app.getHttpServer())
      .post(`/onboarding-concierge/businesses/${ID.bizA}/seed-sample-contact`)
      .set('x-test-user', ID.owner);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    await expectNothingWritten(ID.bizA, 'seed-sample-contact');
  });
});
