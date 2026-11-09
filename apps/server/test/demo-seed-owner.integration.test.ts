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
 * COMPOSITION: the real OnboardingConciergeController (its class guards
 * AuthGuard and BusinessGuard, real), the real OnboardingConciergeService and
 * DemoDataSeederService over the real PrismaService, and the production
 * GlobalHttpExceptionFilter (so an unmapped error is the 500 a client sees).
 * The concierge's AI, catalog, blueprint and state collaborators are stubs the
 * seed route never calls. The only stand-in on the boundary is identity
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
  cTaken: `${P}cTaken`,     // the live contact of bizC holding the sample email
};
const BUSINESSES = [ID.bizA, ID.bizB, ID.bizC, ID.bizR, ID.bizL];
const SAMPLE_EMAIL = 'sample-client@example.com';
const OWNER_ONLY_CODE = 'DEMO_SEED_OWNER_ONLY';
const CONFLICT_CODE = 'DEMO_SEED_CONFLICT';
/** POST .../seed-demo is a plain Nest @Post: success is 201. */
const SEED_OK = 201;

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

  const moduleRef = await Test.createTestingModule({
    controllers: [OnboardingConciergeController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      OnboardingConciergeService,
      DemoDataSeederService,
      // Not on the seed-demo path: no AI, catalog, blueprint or wizard-state call.
      { provide: AiUsageService, useValue: {} },
      { provide: CatalogService, useValue: {} },
      { provide: BlueprintService, useValue: {} },
      { provide: OnboardingStateService, useValue: {} },
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

  // bizC: a live contact that is not the demo contact already holds the
  // sample email (one the owner added, imported, or re-labelled from the
  // demo contact). The live partial unique reserves the email for it.
  await db.contact.create({
    data: { id: ID.cTaken, businessId: ID.bizC, firstName: 'Taken', email: SAMPLE_EMAIL, emailNormalized: SAMPLE_EMAIL, source: 'manual' },
  });
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
}, 60_000);

describe('PR196-SEED-DEMO-OWNER fixture sanity (real rows)', () => {
  it('[SD-X01] five tenants, six users, six memberships; the SUPER_ADMIN and the legacy owner hold no membership', async () => {
    expect(await db.business.count({ where: { id: { startsWith: P } } })).toBe(5);
    expect(await db.user.count({ where: { id: { startsWith: P } } })).toBe(6);
    expect(await db.membership.count({ where: { id: { startsWith: P } } })).toBe(6);
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

  it('[SD-08] RED-BEFORE: the distinguished owner (Business.ownerId, no membership row) seeds, and the audit names them', async () => {
    await resetDemoRows(ID.bizL);
    const res = await seed(ID.legacy, ID.bizL);
    expect(res.status, JSON.stringify(res.body)).toBe(SEED_OK);
    await expectSeededAndAudited(ID.bizL, ID.legacy, res.body, 'TTD');
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
