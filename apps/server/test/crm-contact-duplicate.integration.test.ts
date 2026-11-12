/**
 * R0-D7-CONTACT-EMAIL-409 — duplicate contact identity inside a tenant (REAL database).
 *
 * The Contact table carries two tenant-scoped uniques, on
 * (business_id, email_normalized) and (business_id, phone_normalized); since
 * V1-17 they cover live (not soft-deleted) rows only, see the last block.
 * Before R0-D7 a second contact with an email (or phone) already held in
 * the same business hit the index inside CrmService.createContact's
 * transaction and the Prisma P2002 surfaced as an opaque 500 — seen by the
 * Release 0 journey harness (D7) and by CONTACTS lane packet BP-04. The
 * contract proven here: POST/PATCH that would violate one of those uniques
 * answers 409 with `code: contact_email_taken` (or `contact_phone_taken`) and
 * the id of the tenant's existing live holder when the actor could open that
 * holder through GET detail (the id is a working key, so it is bounded by the
 * same M7 visibility the list and detail routes apply; otherwise it is null
 * and the body reads the same); the tenant keeps exactly the contacts it had;
 * a different tenant may hold the same email or phone, because the uniqueness
 * is per business; a member of another tenant is refused by the guards.
 *
 * Nothing on the HTTP or persistence path is mocked: PrismaService, the user,
 * business and membership rows, AuthGuard, BusinessGuard, ModuleScopeGuard,
 * CrmRateLimitGuard, PlanLimitGuard, TeamAuditInterceptor, the global
 * ValidationPipe and GlobalHttpExceptionFilter exactly as app-bootstrap
 * registers them, CrmService and ContactAuditService are all real against the
 * database at DATABASE_URL. The stand-ins: identity attachment (a test
 * middleware reads `x-test-user`, loads that seeded user row and attaches
 * `{ id, email, role }` exactly as AuthMiddleware would after Supabase token
 * verification), the timeline/cache/flow collaborators (recorders — they are
 * side channels off the write, not the write itself) and the plan limit (a
 * stub that allows). Everything after identity attachment is the production
 * code path.
 *
 * Body shape note: GlobalHttpExceptionFilter keeps `code` at the top level and
 * moves every other structured field of a thrown HttpException body under
 * `details`, so on the wire the existing id is `body.details.existingContactId`.
 *
 * Requires DATABASE_URL. Every seeded row carries the `tcd_` prefix (contacts
 * created through the API are deleted by their business id) and is hard-deleted
 * by raw SQL in beforeAll and afterAll.
 *
 * Cases tagged NEGATIVE CONTROL are the pre-fix failing controls: on the
 * packet's source base they answer 500 instead of 409.
 *
 * V1-17-DM-CONTACT-PARTIAL-UNIQUE (D-16) replaces those two full uniques with
 * SQL-only partial unique indexes over live rows (`WHERE deleted_at IS NULL`,
 * migration 20261101000000_contact_partial_identity_uniques), so a soft-deleted
 * contact no longer keeps its email or phone reserved. Its cases are the last
 * block of this file; its NEGATIVE CONTROL cases fail on the V1-08 head, where
 * re-adding the customer of a soft-deleted contact answers 409 with
 * existingContactId null.
 *
 * FOLLOW3-D8-PRIVACY-CANCEL-409 (V1-17 review CR-1 / V117-ST-2): a GDPR forget
 * soft-deletes its contact for the grace period, so under D-16 another live
 * contact can take its email or phone. POST .../contacts/:id/forget/cancel
 * then meets the partial unique when it un-deletes the contact. The last block
 * drives that through the real ContactPrivacyController and
 * ContactPrivacyService; its NEGATIVE CONTROL cases answer 500 on the packet's
 * source base (the P2002 reaches GlobalHttpExceptionFilter) and 409
 * contact_email_taken / contact_phone_taken after it, with the holder bounded
 * by the actor's visibility exactly as revertMerge answers.
 */
import 'reflect-metadata';
import fs from 'fs';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'tcd_';
const ID = {
  owner: `${P}owner`,     // OWNER of bizA
  other: `${P}other`,     // OWNER of bizB only
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
};

const EMAIL = `${P}ada@test.local`;
const PHONE = '+1 868 555 0100';          // normalizes to +18685550100
const PHONE_VARIANT = '+1 (868) 555-0100'; // same digits, different punctuation

let db: any;
let app: any;
let crm: any; // the real CrmService, for the service-level variants

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension). Contacts are
  // created through the API with generated ids, so they go by business id.
  for (const sql of [
    `DELETE FROM contact_audit_entries WHERE business_id LIKE '${P}%'`,
    `DELETE FROM contact_forget_requests WHERE business_id LIKE '${P}%'`,
    `DELETE FROM contact_events WHERE business_id LIKE '${P}%'`,
    `DELETE FROM merge_operations WHERE business_id LIKE '${P}%'`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE '${P}%'`,
    `DELETE FROM contacts WHERE business_id LIKE '${P}%'`,
    `DELETE FROM memberships WHERE id LIKE '${P}%'`,
    `DELETE FROM businesses WHERE id LIKE '${P}%'`,
    `DELETE FROM users WHERE id LIKE '${P}%'`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function post(actor: string, businessId: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${businessId}/contacts`)
    .set('x-test-user', actor)
    .send(body);
}

function patch(actor: string, businessId: string, contactId: string, body: Record<string, unknown>) {
  return request(app.getHttpServer())
    .patch(`/crm/businesses/${businessId}/contacts/${contactId}`)
    .set('x-test-user', actor)
    .send(body);
}

/** Live (not soft-deleted) contacts of a tenant, read straight from the database. */
function liveCount(businessId: string): Promise<number> {
  return db.contact.count({ where: { businessId, deletedAt: null } });
}

/** A 409 must name the field, carry the holder's id, and carry no record. */
function expectTaken(body: any, code: 'contact_email_taken' | 'contact_phone_taken', existingContactId: string | null) {
  expect(body.statusCode).toBe(409);
  expect(body.code).toBe(code);
  expect(body.details).toEqual({ existingContactId });
  expect(typeof body.message).toBe('string');
  for (const key of ['contact', 'id', 'email', 'phone', 'firstName']) {
    expect(body).not.toHaveProperty(key);
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { EntityResolutionService } = await import('../src/core/connectors/entity-resolution.service');
  const { CrmController } = await import('../src/modules/crm/crm.controller');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { CrmStatsService } = await import('../src/modules/crm/crm-stats.service');
  const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
  const { CrmCacheService } = await import('../src/modules/crm/crm-cache.service');
  const { CrmListsService } = await import('../src/modules/crm/crm-lists.service');
  const { CrmFlowService } = await import('../src/modules/crm/crm-flow.service');
  const { ContactAuditService } = await import('../src/modules/crm/privacy/contact-audit.service');
  const { ContactCustomFieldValueService } = await import('../src/modules/crm/contact-custom-field-value.service');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { FeatureFlagGuard } = await import('../src/modules/crm/guards/feature-flag.guard');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { CrmImportService } = await import('../src/modules/crm/crm-import.service');
  const { CrmPlaybookService } = await import('../src/modules/crm/crm-playbook.service');
  const { CrmActionsService } = await import('../src/modules/crm/crm-actions.service');
  const { CrmRevenueService } = await import('../src/modules/crm/crm-revenue.service');
  const { CrmJourneyService } = await import('../src/modules/crm/crm-journey.service');
  const { CrmDuplicateDetectionService } = await import('../src/modules/crm/crm-duplicate-detection.service');
  const { CrmDataQualityService } = await import('../src/modules/crm/crm-data-quality.service');
  const { CrmSavedViewsService } = await import('../src/modules/crm/crm-saved-views.service');
  const { CrmRelationshipHealthService } = await import('../src/modules/crm/crm-relationship-health.service');
  const { CrmCommunicationService } = await import('../src/modules/crm/crm-communication.service');
  const { BestChannelService } = await import('../src/modules/crm/best-channel.service');
  const { ConversationAiService } = await import('../src/modules/crm/conversation-ai.service');
  const { CrmNetworkService } = await import('../src/modules/crm/crm-network.service');
  const { ContactInsightService } = await import('../src/modules/crm/contact-insight.service');
  const { ContactPrivacyController } = await import('../src/modules/crm/privacy/contact-privacy.controller');
  const { ContactPrivacyService } = await import('../src/modules/crm/privacy/contact-privacy.service');

  // ---- the real HTTP path (wired before any row is seeded, so a wiring
  // fault is reported as itself and not as a seeding failure) -------------
  const moduleRef = await Test.createTestingModule({
    controllers: [CrmController, ContactPrivacyController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      FeatureFlagGuard,
      PlanLimitGuard,
      TeamAuditInterceptor,
      CrmStatsService,
      CrmService,
      ContactAuditService,
      // The forget / forget-cancel routes of the last block (FOLLOW3-D8). Its
      // purge scheduler stays off under NODE_ENV=test; nothing of it is stubbed.
      ContactPrivacyService,
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      // Side channels off the contact write: the timeline row, the stats and
      // flow caches. The claim under test is the write and its answer; these
      // record that they were reached and nothing more.
      { provide: CrmTimelineService, useValue: { logEvent: async () => undefined } },
      { provide: CrmCacheService, useValue: { invalidate: async () => undefined } },
      { provide: CrmFlowService, useValue: { invalidateCache: () => undefined } },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CrmListsService, useValue: {} },
      { provide: EntityResolutionService, useValue: {} },
      { provide: ContactCustomFieldValueService, useValue: {} },
      { provide: CrmImportService, useValue: {} },
      { provide: CrmPlaybookService, useValue: {} },
      { provide: CrmActionsService, useValue: {} },
      { provide: CrmRevenueService, useValue: {} },
      { provide: CrmJourneyService, useValue: {} },
      { provide: CrmDuplicateDetectionService, useValue: {} },
      { provide: CrmDataQualityService, useValue: {} },
      { provide: CrmSavedViewsService, useValue: {} },
      { provide: CrmRelationshipHealthService, useValue: {} },
      { provide: CrmCommunicationService, useValue: {} },
      { provide: BestChannelService, useValue: {} },
      { provide: ConversationAiService, useValue: {} },
      { provide: CrmNetworkService, useValue: {} },
      { provide: ContactInsightService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only. The real AuthMiddleware attaches
  // `{ id, email, role }` from the User row after Supabase verifies the token;
  // this does the same from a header, for seeded tcd_ users only. No guard is
  // overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  // The same pipe and filter app-bootstrap.ts registers, so the asserted
  // status and body shape are the ones the deployed API answers with.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();
  crm = app.get(CrmService);

  await cleanup(); // in case a prior run aborted

  // ---- identities, tenants, memberships ----------------------------------
  await db.user.create({ data: { id: ID.owner, email: `${ID.owner}@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.other, email: `${ID.other}@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'TCD Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'TCD Biz B', ownerId: ID.other } });
  await db.membership.create({ data: { id: `${P}m_owner_bizA`, userId: ID.owner, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_other_bizB`, userId: ID.other, businessId: ID.bizB, role: 'OWNER' } });
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('fixture sanity (real rows)', () => {
  it('seeded two tenants with one owner each and no contacts', async () => {
    expect(await db.membership.count({ where: { businessId: ID.bizA } })).toBe(1);
    expect(await db.membership.count({ where: { businessId: ID.bizB } })).toBe(1);
    expect(await liveCount(ID.bizA)).toBe(0);
    expect(await liveCount(ID.bizB)).toBe(0);
  });
});

describe('POST /crm/businesses/:businessId/contacts — email already held in the tenant', () => {
  let adaId: string;

  it('the first contact with the email is created and persisted with the normalized email', async () => {
    const res = await post(ID.owner, ID.bizA, { firstName: `${P}Ada`, lastName: 'Lovelace', email: EMAIL, phone: PHONE });
    expect(res.status).toBe(201);
    adaId = res.body.id;
    expect(adaId).toBeTruthy();
    const row = await db.contact.findUnique({ where: { id: adaId } });
    expect(row).toMatchObject({
      businessId: ID.bizA,
      email: EMAIL,
      emailNormalized: EMAIL.toLowerCase(),
      phone: PHONE,
      phoneNormalized: '+18685550100',
      deletedAt: null,
    });
    expect(await liveCount(ID.bizA)).toBe(1);
  });

  it('NEGATIVE CONTROL — the same email again answers 409 contact_email_taken with the existing id; the tenant still has exactly one contact', async () => {
    const res = await post(ID.owner, ID.bizA, { firstName: `${P}Ada2`, email: EMAIL });
    expect(res.status).toBe(409);
    expectTaken(res.body, 'contact_email_taken', adaId);
    expect(await liveCount(ID.bizA)).toBe(1);
  });

  it('a case variant of the email is the same identity: 409 contact_email_taken with the existing id, still one contact', async () => {
    const variant = `${P.toUpperCase()}Ada@TEST.Local`;
    expect(variant.toLowerCase()).toBe(EMAIL);
    const res = await post(ID.owner, ID.bizA, { firstName: `${P}Ada3`, email: variant });
    expect(res.status).toBe(409);
    expectTaken(res.body, 'contact_email_taken', adaId);
    expect(await liveCount(ID.bizA)).toBe(1);
  });

  it('a whitespace-padded email passes the DTO (observed: @IsEmail accepts surrounding whitespace) and the service trims it to the same identity: 409 contact_email_taken with the existing id, still one contact', async () => {
    const res = await post(ID.owner, ID.bizA, { firstName: `${P}Ada4`, email: `  ${EMAIL}  ` });
    expect(res.status).toBe(409);
    expectTaken(res.body, 'contact_email_taken', adaId);
    expect(await liveCount(ID.bizA)).toBe(1);
  });

  it('the service trims and lowercases before writing: a padded, upper-cased email is refused as 409 contact_email_taken with the existing id', async () => {
    let caught: any;
    try {
      await crm.createContact({ businessId: ID.bizA, firstName: `${P}Ada5`, email: `  ${EMAIL.toUpperCase()}  ` });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeTruthy();
    expect(caught.getStatus?.()).toBe(409);
    expect(caught.getResponse?.()).toMatchObject({ code: 'contact_email_taken', existingContactId: adaId });
    expect(await liveCount(ID.bizA)).toBe(1);
  });

  it('a different tenant may create the same email (uniqueness is per business); both tenants keep their own single row', async () => {
    const res = await post(ID.other, ID.bizB, { firstName: `${P}AdaB`, email: EMAIL });
    expect(res.status).toBe(201);
    expect(res.body.id).not.toBe(adaId);
    expect(await db.contact.findUnique({ where: { id: res.body.id } })).toMatchObject({ businessId: ID.bizB, emailNormalized: EMAIL });
    expect(await liveCount(ID.bizA)).toBe(1);
    expect(await liveCount(ID.bizB)).toBe(1);
  });

  it("a member of another tenant cannot use the conflict to probe for the email: bizB's owner posting into bizA is refused by the guards (403) with no existing id", async () => {
    const res = await post(ID.other, ID.bizA, { firstName: `${P}Probe`, email: EMAIL });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(adaId);
    expect(res.body).not.toHaveProperty('details');
    expect(await liveCount(ID.bizA)).toBe(1);
  });

  it('contacts without an email or phone do not collide with each other (NULL is not a duplicate)', async () => {
    const first = await post(ID.owner, ID.bizA, { firstName: `${P}NoIdentity1` });
    const second = await post(ID.owner, ID.bizA, { firstName: `${P}NoIdentity2` });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await liveCount(ID.bizA)).toBe(3);
    // Leave the tenant as the later cases expect it.
    await db.$executeRawUnsafe(`DELETE FROM contacts WHERE id IN ('${first.body.id}', '${second.body.id}')`);
    expect(await liveCount(ID.bizA)).toBe(1);
  });
});

describe("the holder id in a 409 is bounded by the actor's CRM visibility (within-tenant control)", () => {
  // The id in a 409 is a working key (it opens the contact's notes and events
  // routes), so it is disclosed only when the actor could open the holder
  // through GET detail. Two STAFF members of bizA with crm write: s1 is
  // 'my book' (crm_view=owned, crm_edit=owned), s2 is view-all. Ada is turned
  // PRIVATE and owned by the owner for this block; a TEAM contact Tom is added.
  // GET detail is the oracle in every case: whichever row a member cannot open,
  // the 409 names no id for; whichever they can, it does.
  const STAFF_OWNED = `${P}staffOwned`;
  const STAFF_ALL = `${P}staffAll`;
  const TOM_EMAIL = `${P}tom@test.local`;
  const MINE_EMAIL = `${P}mine@test.local`;
  let adaId: string;
  let tomId: string;
  const created: string[] = [];

  function get(actor: string, businessId: string, contactId: string) {
    return request(app.getHttpServer())
      .get(`/crm/businesses/${businessId}/contacts/${contactId}`)
      .set('x-test-user', actor);
  }

  beforeAll(async () => {
    const ada = await db.contact.findFirst({ where: { businessId: ID.bizA, emailNormalized: EMAIL }, select: { id: true } });
    adaId = ada.id;
    await db.user.create({ data: { id: STAFF_OWNED, email: `${STAFF_OWNED}@test.local`, role: 'USER' } });
    await db.user.create({ data: { id: STAFF_ALL, email: `${STAFF_ALL}@test.local`, role: 'USER' } });
    await db.membership.create({ data: { id: `${P}m_staffOwned_bizA`, userId: STAFF_OWNED, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'write', crm_view: 'owned', crm_edit: 'owned' } } });
    await db.membership.create({ data: { id: `${P}m_staffAll_bizA`, userId: STAFF_ALL, businessId: ID.bizA, role: 'STAFF', permissionScopes: { crm: 'write' } } });
    await db.contact.update({ where: { id: adaId }, data: { visibility: 'PRIVATE', ownerId: ID.owner } });
    const tom = await post(ID.owner, ID.bizA, { firstName: `${P}Tom`, email: TOM_EMAIL });
    expect(tom.status).toBe(201);
    tomId = tom.body.id;
    created.push(tomId);
    expect(await db.contact.findUnique({ where: { id: tomId }, select: { visibility: true } })).toEqual({ visibility: 'TEAM' });
    expect(await liveCount(ID.bizA)).toBe(2);
  });

  afterAll(async () => {
    // Leave the tenant as the later cases expect it: Ada alone, TEAM, unowned.
    if (created.length) await db.$executeRawUnsafe(`DELETE FROM contacts WHERE id IN (${created.map((id) => `'${id}'`).join(',')})`);
    await db.contact.update({ where: { id: adaId }, data: { visibility: 'TEAM', ownerId: null } });
    await db.$executeRawUnsafe(`DELETE FROM memberships WHERE id IN ('${P}m_staffOwned_bizA', '${P}m_staffAll_bizA')`);
    await db.$executeRawUnsafe(`DELETE FROM users WHERE id IN ('${STAFF_OWNED}', '${STAFF_ALL}')`);
    expect(await liveCount(ID.bizA)).toBe(1);
  });

  it('CONTROL — neither STAFF member can open the PRIVATE holder (404, nothing disclosed); the view-all member opens the TEAM contact, the my-book member does not', async () => {
    for (const actor of [STAFF_OWNED, STAFF_ALL]) {
      const res = await get(actor, ID.bizA, adaId);
      expect(res.status).toBe(404);
      // The filter echoes the request path, which is the caller's own input;
      // nothing of the row itself may appear.
      expect(res.body.path).toBe(`/crm/businesses/${ID.bizA}/contacts/${adaId}`);
      expect(JSON.stringify({ ...res.body, path: undefined })).not.toContain(adaId);
      expect(res.body).not.toHaveProperty('details');
    }
    expect((await get(STAFF_ALL, ID.bizA, tomId)).status).toBe(200);
    expect((await get(STAFF_OWNED, ID.bizA, tomId)).status).toBe(404);
    expect((await get(ID.owner, ID.bizA, adaId)).status).toBe(200);
  });

  it("NEGATIVE CONTROL — a my-book STAFF posting the PRIVATE holder's email gets 409 contact_email_taken with existingContactId null and the id nowhere in the body", async () => {
    const res = await post(STAFF_OWNED, ID.bizA, { firstName: `${P}Probe1`, email: EMAIL });
    expect(res.status).toBe(409);
    expectTaken(res.body, 'contact_email_taken', null);
    expect(JSON.stringify(res.body)).not.toContain(adaId);
    expect(await liveCount(ID.bizA)).toBe(2);
  });

  it("NEGATIVE CONTROL — a view-all STAFF posting a variant of the PRIVATE holder's phone gets 409 contact_phone_taken with existingContactId null", async () => {
    const res = await post(STAFF_ALL, ID.bizA, { firstName: `${P}Probe2`, phone: PHONE_VARIANT });
    expect(res.status).toBe(409);
    expectTaken(res.body, 'contact_phone_taken', null);
    expect(JSON.stringify(res.body)).not.toContain(adaId);
    expect(await liveCount(ID.bizA)).toBe(2);
  });

  it("NEGATIVE CONTROL — a my-book STAFF patching a contact they own onto the PRIVATE holder's email gets 409 with existingContactId null, and their row is unchanged", async () => {
    const mine = await post(STAFF_OWNED, ID.bizA, { firstName: `${P}Mine`, email: MINE_EMAIL, ownerId: STAFF_OWNED });
    expect(mine.status).toBe(201);
    created.push(mine.body.id);
    expect(await db.contact.findUnique({ where: { id: mine.body.id }, select: { ownerId: true } })).toEqual({ ownerId: STAFF_OWNED });
    expect((await get(STAFF_OWNED, ID.bizA, mine.body.id)).status).toBe(200);

    const res = await patch(STAFF_OWNED, ID.bizA, mine.body.id, { email: EMAIL });
    expect(res.status).toBe(409);
    expectTaken(res.body, 'contact_email_taken', null);
    expect(JSON.stringify(res.body)).not.toContain(adaId);
    expect(await db.contact.findUnique({ where: { id: mine.body.id } })).toMatchObject({ emailNormalized: MINE_EMAIL });
  });

  it('the hidden-holder 409 reads exactly like the visible-holder 409 apart from the id: same code, same message', async () => {
    const hidden = await post(STAFF_OWNED, ID.bizA, { firstName: `${P}Probe3`, email: EMAIL });
    const visible = await post(ID.owner, ID.bizA, { firstName: `${P}Probe4`, email: EMAIL });
    expect(hidden.status).toBe(409);
    expect(visible.status).toBe(409);
    expect(visible.body.details).toEqual({ existingContactId: adaId });
    expect(hidden.body.details).toEqual({ existingContactId: null });
    expect(hidden.body.code).toBe(visible.body.code);
    expect(hidden.body.message).toBe(visible.body.message);
  });

  it("positive control — the TEAM contact's email: the view-all STAFF is told the id (they can open it), the my-book STAFF is not, the owner is", async () => {
    const all = await post(STAFF_ALL, ID.bizA, { firstName: `${P}Probe5`, email: TOM_EMAIL });
    expect(all.status).toBe(409);
    expectTaken(all.body, 'contact_email_taken', tomId);

    const owned = await post(STAFF_OWNED, ID.bizA, { firstName: `${P}Probe6`, email: TOM_EMAIL });
    expect(owned.status).toBe(409);
    expectTaken(owned.body, 'contact_email_taken', null);

    const owner = await post(ID.owner, ID.bizA, { firstName: `${P}Probe7`, email: TOM_EMAIL });
    expect(owner.status).toBe(409);
    expectTaken(owner.body, 'contact_email_taken', tomId);
    expect(await liveCount(ID.bizA)).toBe(3);
  });

  it('service callers with no actor (internal jobs) are tenant-scoped only and still receive the holder id', async () => {
    let caught: any;
    try {
      await crm.createContact({ businessId: ID.bizA, firstName: `${P}Probe8`, email: EMAIL });
    } catch (err) {
      caught = err;
    }
    expect(caught?.getStatus?.()).toBe(409);
    expect(caught.getResponse?.()).toMatchObject({ code: 'contact_email_taken', existingContactId: adaId });
  });
});

describe('POST /crm/businesses/:businessId/contacts — phone already held in the tenant (schema has @@unique([businessId, phoneNormalized]))', () => {
  it('NEGATIVE CONTROL — a punctuation variant of an existing phone answers 409 contact_phone_taken with the existing id; still one contact', async () => {
    const ada = await db.contact.findFirst({ where: { businessId: ID.bizA, emailNormalized: EMAIL }, select: { id: true } });
    expect(ada).toBeTruthy();
    const res = await post(ID.owner, ID.bizA, { firstName: `${P}Phone2`, phone: PHONE_VARIANT });
    expect(res.status).toBe(409);
    expectTaken(res.body, 'contact_phone_taken', ada.id);
    expect(await liveCount(ID.bizA)).toBe(1);
  });

  it('a different tenant may hold the same phone', async () => {
    const res = await post(ID.other, ID.bizB, { firstName: `${P}PhoneB`, phone: PHONE });
    expect(res.status).toBe(201);
    expect(await liveCount(ID.bizB)).toBe(2);
    await db.$executeRawUnsafe(`DELETE FROM contacts WHERE id = '${res.body.id}'`);
  });
});

describe('PATCH /crm/businesses/:businessId/contacts/:contactId — updating onto a taken identity', () => {
  const BOB_EMAIL = `${P}bob@test.local`;
  const BOB_PHONE = '+18685550199';
  let adaId: string;
  let bobId: string;

  beforeAll(async () => {
    const ada = await db.contact.findFirst({ where: { businessId: ID.bizA, emailNormalized: EMAIL }, select: { id: true } });
    adaId = ada.id;
    const res = await post(ID.owner, ID.bizA, { firstName: `${P}Bob`, email: BOB_EMAIL, phone: BOB_PHONE });
    expect(res.status).toBe(201);
    bobId = res.body.id;
    expect(await liveCount(ID.bizA)).toBe(2);
  });

  it("NEGATIVE CONTROL — changing Bob's email to Ada's answers 409 contact_email_taken with Ada's id, and Bob's row is unchanged", async () => {
    const res = await patch(ID.owner, ID.bizA, bobId, { email: EMAIL.toUpperCase() });
    expect(res.status).toBe(409);
    expectTaken(res.body, 'contact_email_taken', adaId);
    const bob = await db.contact.findUnique({ where: { id: bobId } });
    expect(bob).toMatchObject({ email: BOB_EMAIL, emailNormalized: BOB_EMAIL, phone: BOB_PHONE });
    expect(await liveCount(ID.bizA)).toBe(2);
  });

  it("changing Bob's phone to a variant of Ada's answers 409 contact_phone_taken with Ada's id, and Bob's row is unchanged", async () => {
    const res = await patch(ID.owner, ID.bizA, bobId, { phone: PHONE_VARIANT });
    expect(res.status).toBe(409);
    expectTaken(res.body, 'contact_phone_taken', adaId);
    const bob = await db.contact.findUnique({ where: { id: bobId } });
    expect(bob).toMatchObject({ phone: BOB_PHONE, phoneNormalized: BOB_PHONE });
  });

  it('re-submitting a contact with its own email and phone is not a conflict (200)', async () => {
    const res = await patch(ID.owner, ID.bizA, bobId, { email: BOB_EMAIL, phone: BOB_PHONE, lastName: 'Builder' });
    expect(res.status).toBe(200);
    expect(await db.contact.findUnique({ where: { id: bobId } })).toMatchObject({ lastName: 'Builder', emailNormalized: BOB_EMAIL });
  });

  it('an unknown contact id under the tenant path stays 404, not 409', async () => {
    const res = await patch(ID.owner, ID.bizA, `${P}nope`, { email: EMAIL });
    expect(res.status).toBe(404);
  });
});


describe('V1-17 — a soft-deleted contact releases its email and phone: the identity uniques cover live contacts only (D-16)', () => {
  // D-16 (BUILD-MAP-001 section (g)) authorizes replacing the two full uniques
  // with SQL-only partial unique indexes over live rows. Until then the index
  // had no deleted_at term, so a soft-deleted contact (DELETE, the duplicate of
  // a merge, a GDPR forget in its grace period) kept its email and phone
  // reserved and the business could not add that customer again: the API
  // answered 409 with existingContactId null (M12). Now the deleted row keeps
  // its data and the slot is free; two live contacts still cannot share an
  // email or phone in one business, and the database, not a read-then-write,
  // still decides that. bizC is a tenant of its own so that the controller's
  // per-tenant rate-limit bucket for bizA stays below its ceiling.
  const BIZ = `${P}bizC`;
  const EMAIL_INDEX = 'contacts_business_id_email_normalized_live_key';
  const PHONE_INDEX = 'contacts_business_id_phone_normalized_live_key';
  const MIGRATION = '20261101000000_contact_partial_identity_uniques';
  const GONE_EMAIL = `${P}gone@test.local`;
  const GONE_PHONE = '+1 868 555 0177';
  const GONE_PHONE_VARIANT = '+1 (868) 555-0177';
  const GONE_PHONE_NORMALIZED = '+18685550177';
  let goneId: string; // created, then soft-deleted through DELETE
  let againId: string; // the same customer added again by email
  let phoneAgainId: string; // the same customer added again by phone

  function del(actor: string, businessId: string, contactId: string) {
    return request(app.getHttpServer())
      .delete(`/crm/businesses/${businessId}/contacts/${contactId}`)
      .set('x-test-user', actor);
  }

  /** The row as stored, read past the soft-delete extension. */
  async function stored(id: string): Promise<{ deleted_at: Date | null; email_normalized: string | null; phone_normalized: string | null }> {
    const rows = await db.$queryRawUnsafe(`SELECT deleted_at, email_normalized, phone_normalized FROM contacts WHERE id = '${id}'`);
    return rows[0];
  }

  function liveWith(where: Record<string, unknown>): Promise<number> {
    return db.contact.count({ where: { businessId: BIZ, deletedAt: null, ...where } });
  }

  /** The ContactAuditEntry write is fire-and-forget (DEC-CONTACTS-002): wait for it to land. */
  async function auditEntries(contactId: string, action: string, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const rows = await db.contactAuditEntry.findMany({ where: { businessId: BIZ, contactId, action } });
      if (rows.length > 0 || Date.now() > deadline) return rows;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  function p2002(target: unknown) {
    return Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target } });
  }

  async function mapped(err: unknown, identity: { emailNormalized?: string | null; phoneNormalized?: string | null }) {
    try {
      await crm.rejectContactIdentityTaken(err, BIZ, identity);
    } catch (thrown) {
      return thrown as any;
    }
    return undefined;
  }

  beforeAll(async () => {
    await db.business.create({ data: { id: BIZ, name: 'TCD Biz C', ownerId: ID.owner } });
    await db.membership.create({ data: { id: `${P}m_owner_bizC`, userId: ID.owner, businessId: BIZ, role: 'OWNER' } });
  });

  it('the database holds each identity unique as a partial index over live rows, and no full unique on either column pair remains', async () => {
    const rows: Array<{ indexname: string; indexdef: string }> = await db.$queryRawUnsafe(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'contacts' AND indexdef LIKE 'CREATE UNIQUE INDEX%'`,
    );
    for (const [column, name] of [['email_normalized', EMAIL_INDEX], ['phone_normalized', PHONE_INDEX]]) {
      const onPair = rows.filter((r) => r.indexdef.includes(`(business_id, ${column})`));
      expect(onPair.map((r) => r.indexname)).toEqual([name]);
      expect(onPair[0].indexdef).toMatch(/ WHERE \(deleted_at IS NULL\)$/);
    }
  });

  it('NEGATIVE CONTROL — after DELETE soft-deletes a contact, POST of the same customer (a case variant of the email) answers 201; the new contact is live and the deleted one keeps its row and identity', async () => {
    const gone = await post(ID.owner, BIZ, { firstName: `${P}Gone`, email: GONE_EMAIL, phone: GONE_PHONE });
    expect(gone.status).toBe(201);
    goneId = gone.body.id;
    expect((await del(ID.owner, BIZ, goneId)).status).toBe(200);
    expect((await stored(goneId)).deleted_at).not.toBeNull();

    const again = await post(ID.owner, BIZ, { firstName: `${P}Again`, email: GONE_EMAIL.toUpperCase() });
    expect(again.status).toBe(201);
    expect(again.body).not.toHaveProperty('code');
    againId = again.body.id;
    expect(againId).toBeTruthy();
    expect(againId).not.toBe(goneId);
    expect(await db.contact.findUnique({ where: { id: againId } })).toMatchObject({ businessId: BIZ, emailNormalized: GONE_EMAIL, deletedAt: null });

    const old = await stored(goneId);
    expect(old.deleted_at).not.toBeNull();
    expect(old).toMatchObject({ email_normalized: GONE_EMAIL, phone_normalized: GONE_PHONE_NORMALIZED });
    expect(await liveWith({ emailNormalized: GONE_EMAIL })).toBe(1);
  });

  it("NEGATIVE CONTROL — the soft-deleted contact's phone is free too: POST with a punctuation variant answers 201 and the new contact is live", async () => {
    const res = await post(ID.owner, BIZ, { firstName: `${P}PhoneAgain`, phone: GONE_PHONE_VARIANT });
    expect(res.status).toBe(201);
    phoneAgainId = res.body.id;
    expect(phoneAgainId).toBeTruthy();
    expect(await db.contact.findUnique({ where: { id: phoneAgainId } })).toMatchObject({ phoneNormalized: GONE_PHONE_NORMALIZED, deletedAt: null });
    expect((await stored(goneId)).deleted_at).not.toBeNull();
    expect(await liveWith({ phoneNormalized: GONE_PHONE_NORMALIZED })).toBe(1);
  });

  it('a contact added again is recorded like any create (D-25): one ContactAuditEntry "created" naming the owner', async () => {
    for (const id of [againId, phoneAgainId]) {
      expect(id).toBeTruthy();
      const rows = await auditEntries(id, 'created');
      expect(rows).toHaveLength(1);
      expect(rows[0].actor).toEqual({ type: 'USER', id: ID.owner });
    }
  });

  it('two live contacts still cannot share an identity: another POST of the email answers 409 contact_email_taken naming the live contact, of the phone 409 contact_phone_taken naming the live contact, never 500', async () => {
    const email = await post(ID.owner, BIZ, { firstName: `${P}Dup1`, email: GONE_EMAIL });
    expect(email.status).toBe(409);
    expectTaken(email.body, 'contact_email_taken', againId);
    const phone = await post(ID.owner, BIZ, { firstName: `${P}Dup2`, phone: GONE_PHONE });
    expect(phone.status).toBe(409);
    expectTaken(phone.body, 'contact_phone_taken', phoneAgainId);
    expect(await liveWith({ emailNormalized: GONE_EMAIL })).toBe(1);
    expect(await liveWith({ phoneNormalized: GONE_PHONE_NORMALIZED })).toBe(1);
  });

  it("NEGATIVE CONTROL — PATCH of a live contact onto a soft-deleted contact's email and phone answers 200 and the live contact takes them", async () => {
    const LEFT_EMAIL = `${P}left@test.local`;
    const LEFT_PHONE = '+18685550188';
    const left = await post(ID.owner, BIZ, { firstName: `${P}Left`, email: LEFT_EMAIL, phone: LEFT_PHONE });
    const stay = await post(ID.owner, BIZ, { firstName: `${P}Stay`, email: `${P}stay@test.local` });
    expect(left.status).toBe(201);
    expect(stay.status).toBe(201);
    expect((await del(ID.owner, BIZ, left.body.id)).status).toBe(200);

    const res = await patch(ID.owner, BIZ, stay.body.id, { email: LEFT_EMAIL, phone: LEFT_PHONE });
    expect(res.status).toBe(200);
    expect(await db.contact.findUnique({ where: { id: stay.body.id } })).toMatchObject({ emailNormalized: LEFT_EMAIL, phoneNormalized: LEFT_PHONE, deletedAt: null });
    const old = await stored(left.body.id);
    expect(old.deleted_at).not.toBeNull();
    expect(old.email_normalized).toBe(LEFT_EMAIL);
  });

  it('two concurrent POSTs of one new email: exactly one 201 and one 409 contact_email_taken naming the winner (the database decides, not a read-then-write)', async () => {
    const RACE_EMAIL = `${P}race@test.local`;
    const [a, b] = await Promise.all([
      post(ID.owner, BIZ, { firstName: `${P}Race1`, email: RACE_EMAIL }),
      post(ID.owner, BIZ, { firstName: `${P}Race2`, email: RACE_EMAIL }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const winner = a.status === 201 ? a : b;
    const loser = a.status === 201 ? b : a;
    expectTaken(loser.body, 'contact_email_taken', winner.body.id);
    expect(await liveWith({ emailNormalized: RACE_EMAIL })).toBe(1);
  });

  it('the database refuses a second live holder: un-deleting the old contact while others hold its email and phone is a P2002, the row stays deleted, and rejectContactIdentityTaken maps that real error to 409 naming the live holder', async () => {
    let caught: any;
    try {
      await db.contact.update({ where: { id: goneId }, data: { deletedAt: null } });
    } catch (err) {
      caught = err;
    }
    expect(caught?.code).toBe('P2002');
    expect((await stored(goneId)).deleted_at).not.toBeNull();
    expect(await liveWith({ emailNormalized: GONE_EMAIL })).toBe(1);
    expect(await liveWith({ phoneNormalized: GONE_PHONE_NORMALIZED })).toBe(1);

    const thrown = await mapped(caught, { emailNormalized: GONE_EMAIL, phoneNormalized: GONE_PHONE_NORMALIZED });
    expect(thrown?.getStatus?.()).toBe(409);
    const body = thrown.getResponse();
    // Postgres reports whichever of the two indexes it checked first.
    const expected = body.code === 'contact_email_taken' ? againId : phoneAgainId;
    expect(['contact_email_taken', 'contact_phone_taken']).toContain(body.code);
    expect(body.existingContactId).toBe(expected);
  });

  it('NEGATIVE CONTROL — a P2002 whose meta.target names a partial index instead of the column list still maps to 409 (email and phone); any other unique violation is rethrown untouched', async () => {
    for (const target of [EMAIL_INDEX, [EMAIL_INDEX]]) {
      const thrown = await mapped(p2002(target), { emailNormalized: GONE_EMAIL, phoneNormalized: null });
      expect(thrown?.getStatus?.()).toBe(409);
      expect(thrown.getResponse()).toMatchObject({ code: 'contact_email_taken', existingContactId: againId });
    }
    for (const target of [PHONE_INDEX, [PHONE_INDEX]]) {
      const thrown = await mapped(p2002(target), { emailNormalized: null, phoneNormalized: GONE_PHONE_NORMALIZED });
      expect(thrown?.getStatus?.()).toBe(409);
      expect(thrown.getResponse()).toMatchObject({ code: 'contact_phone_taken', existingContactId: phoneAgainId });
    }
    for (const target of ['contacts_pkey', ['id'], undefined]) {
      const other = p2002(target);
      expect(await mapped(other, { emailNormalized: GONE_EMAIL, phoneNormalized: GONE_PHONE_NORMALIZED })).toBe(other);
    }
  });

  it('DRIFT GUARD — schema.prisma declares no unique on either pair and names both SQL-only indexes, the migrate-dev rule and the db-push ban at the Contact model; the migration creates exactly those partial indexes, drops the full ones and states the same rules', () => {
    const root = path.resolve(__dirname, '../../..');
    const schema = fs.readFileSync(path.join(root, 'packages/db/prisma/schema.prisma'), 'utf8');
    const model = schema.match(/\nmodel Contact \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(model).toContain('@@map("contacts")');
    const declarations = model.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
    expect(declarations).toContain('@@index([businessId])');
    expect(declarations).not.toMatch(/@@unique\(\[businessId, (emailNormalized|phoneNormalized)\]/);
    expect(declarations).not.toMatch(/(emailNormalized|phoneNormalized)\s+String\?[^\n]*@unique/);
    // `prisma db push` would drop the full uniques on an unmigrated database
    // and create neither partial index (review V117-ST-1 / CR-5), so the guard
    // names it beside `migrate dev` and points at `migrate deploy`.
    for (const text of [EMAIL_INDEX, PHONE_INDEX, MIGRATION, 'migrate dev', '--create-only', 'db push', 'migrate deploy']) {
      expect(model).toContain(text);
    }

    const sql = fs.readFileSync(path.join(root, 'packages/db/prisma/migrations', MIGRATION, 'migration.sql'), 'utf8');
    for (const [name, column] of [[EMAIL_INDEX, 'email_normalized'], [PHONE_INDEX, 'phone_normalized']]) {
      expect(sql).toMatch(new RegExp(`CREATE UNIQUE INDEX "${name}"\\s+ON "contacts" \\("business_id", "${column}"\\)\\s+WHERE "deleted_at" IS NULL;`));
    }
    for (const full of ['contacts_business_id_email_normalized_key', 'contacts_business_id_phone_normalized_key']) {
      expect(sql).toContain(`DROP INDEX IF EXISTS "${full}";`);
    }
    for (const text of ['migrate dev', '--create-only', 'db push', 'migrate deploy']) {
      expect(sql).toContain(text);
    }
  });
});

describe('V1-17 review repairs — un-deleting a contact whose email or phone a live contact now holds (CR-4, V117-ST-3, CR-1, V117-ST-2)', () => {
  // D-16 frees a soft-deleted contact's email and phone, so during a merge's
  // 24h undo window (and a GDPR forget's grace period) another live contact can
  // take them. Restoring the deleted row is then refused by the partial unique
  // (P2002). revertMerge must answer that like every identity conflict, 409
  // contact_email_taken / contact_phone_taken with the holder bounded by the
  // actor's visibility, and never hand the client Prisma's message (it names
  // the server's file path, source lines and the column list). bizD is a tenant
  // of its own so the per-tenant rate-limit buckets of the blocks above stay
  // below their ceilings.
  const BIZ = `${P}bizD`;
  const STAFF_BOOK = `${P}staffBookD`; // crm write, 'my book' (crm_view owned)
  const P_EMAIL = `${P}keep@test.local`;
  const P_PHONE = '+18685550201';
  const D_EMAIL = `${P}merged@test.local`;
  const D_PHONE = '+1 868 555 0202';
  const D_PHONE_VARIANT = '+1 (868) 555-0202';
  const D_PHONE_NORMALIZED = '+18685550202';
  const LEAK = /invocation|prisma|unique constraint|\.ts\b|email_normalized|phone_normalized|business_id|node_modules/i;
  let primaryId: string;
  let duplicateId: string;
  let mergeId: string;
  let emailHolderId: string;

  function del(actor: string, contactId: string) {
    return request(app.getHttpServer())
      .delete(`/crm/businesses/${BIZ}/contacts/${contactId}`)
      .set('x-test-user', actor);
  }

  function merge(actor: string, keepId: string, dropId: string) {
    return request(app.getHttpServer())
      .post(`/crm/businesses/${BIZ}/contacts/${keepId}/merge/${dropId}`)
      .set('x-test-user', actor)
      .send({});
  }

  function revert(actor: string, id: string) {
    return request(app.getHttpServer())
      .post(`/crm/businesses/${BIZ}/duplicates/merges/${id}/revert`)
      .set('x-test-user', actor)
      .send({});
  }

  async function stored(id: string): Promise<{ deleted_at: Date | null; merged_into_id: string | null; email_normalized: string | null; phone_normalized: string | null }> {
    const rows = await db.$queryRawUnsafe(`SELECT deleted_at, merged_into_id, email_normalized, phone_normalized FROM contacts WHERE id = '${id}'`);
    return rows[0];
  }

  async function revertedAt(id: string): Promise<Date | null> {
    const rows = await db.$queryRawUnsafe(`SELECT reverted_at FROM merge_operations WHERE id = '${id}'`);
    return rows[0].reverted_at;
  }

  function liveWith(where: Record<string, unknown>): Promise<number> {
    return db.contact.count({ where: { businessId: BIZ, deletedAt: null, ...where } });
  }

  beforeAll(async () => {
    await db.business.create({ data: { id: BIZ, name: 'TCD Biz D', ownerId: ID.owner } });
    await db.membership.create({ data: { id: `${P}m_owner_bizD`, userId: ID.owner, businessId: BIZ, role: 'OWNER' } });
    await db.user.create({ data: { id: STAFF_BOOK, email: `${STAFF_BOOK}@test.local`, role: 'USER' } });
    await db.membership.create({ data: { id: `${P}m_staffBook_bizD`, userId: STAFF_BOOK, businessId: BIZ, role: 'STAFF', permissionScopes: { crm: 'write', crm_view: 'owned', crm_edit: 'owned' } } });

    const keep = await post(ID.owner, BIZ, { firstName: `${P}Keep`, email: P_EMAIL, phone: P_PHONE });
    const drop = await post(ID.owner, BIZ, { firstName: `${P}Merged`, email: D_EMAIL, phone: D_PHONE });
    expect(keep.status).toBe(201);
    expect(drop.status).toBe(201);
    primaryId = keep.body.id;
    duplicateId = drop.body.id;
    const merged = await merge(ID.owner, primaryId, duplicateId);
    expect(merged.status).toBe(201);
    mergeId = merged.body.mergeId;
    expect(mergeId).toBeTruthy();
    expect(await stored(duplicateId)).toMatchObject({ merged_into_id: primaryId, email_normalized: D_EMAIL, phone_normalized: D_PHONE_NORMALIZED });
    expect((await stored(duplicateId)).deleted_at).not.toBeNull();
  });

  it("NEGATIVE CONTROL — within the undo window another contact takes the merged duplicate's email (201), and the revert answers 409 contact_email_taken naming that live contact, with no database text in the body; nothing is restored and the merge stays revertable", async () => {
    const taker = await post(ID.owner, BIZ, { firstName: `${P}Taker`, email: D_EMAIL.toUpperCase() });
    expect(taker.status).toBe(201);
    emailHolderId = taker.body.id;

    const res = await revert(ID.owner, mergeId);
    expect(res.status).toBe(409);
    expectTaken(res.body, 'contact_email_taken', emailHolderId);
    expect(JSON.stringify(res.body)).not.toMatch(LEAK);

    const dup = await stored(duplicateId);
    expect(dup.deleted_at).not.toBeNull();
    expect(dup.merged_into_id).toBe(primaryId);
    expect(await revertedAt(mergeId)).toBeNull();
    expect(await liveWith({ emailNormalized: D_EMAIL })).toBe(1);
  });

  it("the revert's holder id is bounded by the actor's CRM visibility: a 'my book' STAFF who cannot open the holder gets the same 409 with existingContactId null and the id nowhere in the body", async () => {
    const hidden = await revert(STAFF_BOOK, mergeId);
    expect(hidden.status).toBe(409);
    expectTaken(hidden.body, 'contact_email_taken', null);
    expect(JSON.stringify(hidden.body)).not.toContain(emailHolderId);
    expect(JSON.stringify(hidden.body)).not.toMatch(LEAK);
    expect(await revertedAt(mergeId)).toBeNull();
  });

  it("NEGATIVE CONTROL — the same for the phone: once the email is free again but a live contact holds a punctuation variant of the duplicate's phone, the revert answers 409 contact_phone_taken naming it", async () => {
    expect((await del(ID.owner, emailHolderId)).status).toBe(200);
    const taker = await post(ID.owner, BIZ, { firstName: `${P}PhoneTaker`, phone: D_PHONE_VARIANT });
    expect(taker.status).toBe(201);

    const res = await revert(ID.owner, mergeId);
    expect(res.status).toBe(409);
    expectTaken(res.body, 'contact_phone_taken', taker.body.id);
    expect(JSON.stringify(res.body)).not.toMatch(LEAK);
    expect((await stored(duplicateId)).deleted_at).not.toBeNull();
    expect(await revertedAt(mergeId)).toBeNull();

    expect((await del(ID.owner, taker.body.id)).status).toBe(200);
  });

  it('positive control — with both values free again the same revert succeeds: the duplicate is live with its email and phone, the merge is stamped reverted, and a second revert is refused 400', async () => {
    const res = await revert(ID.owner, mergeId);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ mergeId, primaryId, duplicateId });
    const dup = await stored(duplicateId);
    expect(dup).toMatchObject({ deleted_at: null, merged_into_id: null, email_normalized: D_EMAIL, phone_normalized: D_PHONE_NORMALIZED });
    expect(await revertedAt(mergeId)).not.toBeNull();
    expect(await liveWith({ emailNormalized: D_EMAIL })).toBe(1);

    const again = await revert(ID.owner, mergeId);
    expect(again.status).toBe(400);
  });

  it('NEGATIVE CONTROL — a restore that fails for any other reason answers 400 "Failed to restore duplicate contact" with no database text, and the merge stays unreverted', async () => {
    const keep = await post(ID.owner, BIZ, { firstName: `${P}Keep2`, email: `${P}keep2@test.local` });
    const drop = await post(ID.owner, BIZ, { firstName: `${P}Merged2`, email: `${P}merged2@test.local` });
    expect(keep.status).toBe(201);
    expect(drop.status).toBe(201);
    const merged = await merge(ID.owner, keep.body.id, drop.body.id);
    expect(merged.status).toBe(201);
    // The duplicate the operation names no longer exists, so the un-delete
    // fails with a Prisma P2025 rather than a unique violation.
    await db.$executeRawUnsafe(`UPDATE merge_operations SET duplicate_id = '${P}no_such_contact' WHERE id = '${merged.body.mergeId}'`);

    const res = await revert(ID.owner, merged.body.mergeId);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Failed to restore duplicate contact');
    expect(JSON.stringify(res.body)).not.toMatch(LEAK);
    expect(JSON.stringify(res.body)).not.toMatch(/not found|record/i);
    expect(await revertedAt(merged.body.mergeId)).toBeNull();
  });

  // CR-1 / V117-ST-2 (the same un-delete in ContactPrivacyService.cancelForget)
  // is the next block (FOLLOW3-D8-PRIVACY-CANCEL-409).
});

describe('V1-17 review repairs CR-1 / V117-ST-2 (FOLLOW3-D8) — cancelling a GDPR forget whose email or phone a live contact now holds answers 409, not 500', () => {
  // A forget soft-deletes its contact for the grace period (D-25) and D-16
  // frees a soft-deleted contact's email and phone, so another live contact
  // can take them before the operator cancels. ContactPrivacyService.cancelForget
  // un-deletes the contact inside the transaction that marks the request
  // 'cancelled'; the partial unique refuses that (P2002) and the transaction
  // rolls back. Before FOLLOW3-D8 the P2002 reached GlobalHttpExceptionFilter
  // as a 500 with no reason, while the request stayed 'requested' and the
  // purge would later erase the contact the operator tried to keep. The answer
  // now is the one every identity conflict gives (revertMerge included): 409
  // contact_email_taken / contact_phone_taken with the live holder's id when
  // the actor may open it on GET detail, null otherwise, and no database text.
  //
  // X is owned by STAFF_BOOK, a 'my book' member (crm write, crm_view owned),
  // so the cancel route's FOLLOW3-D3 visibility gate (includeDeleted) lets that
  // member reach the service; the holders are unowned TEAM contacts the member
  // cannot open. bizE is a tenant of its own so the per-tenant rate-limit
  // buckets of the blocks above stay below their ceilings.
  const BIZ = `${P}bizE`;
  const STAFF_BOOK = `${P}staffBookE`;
  const X_EMAIL = `${P}forgotten@test.local`;
  const X_PHONE = '+1 868 555 0301';
  const X_PHONE_VARIANT = '+1 (868) 555-0301';
  const X_PHONE_NORMALIZED = '+18685550301';
  const LEAK = /invocation|prisma|unique constraint|\.ts\b|email_normalized|phone_normalized|business_id|node_modules/i;
  let xId: string; // the forgotten contact
  let emailHolderId: string; // Y: a live contact that took X's email
  let phoneHolderId: string; // Z: a live contact that took X's phone

  function route(contactId: string, suffix: string) {
    return `/crm/businesses/${BIZ}/contacts/${contactId}${suffix}`;
  }

  function forget(actor: string, contactId: string) {
    return request(app.getHttpServer()).post(route(contactId, '/forget')).set('x-test-user', actor).send({ reason: 'tcd test' });
  }

  function cancel(actor: string, contactId: string) {
    return request(app.getHttpServer()).post(route(contactId, '/forget/cancel')).set('x-test-user', actor).send({});
  }

  function get(actor: string, contactId: string) {
    return request(app.getHttpServer()).get(route(contactId, '')).set('x-test-user', actor);
  }

  function del(actor: string, contactId: string) {
    return request(app.getHttpServer()).delete(route(contactId, '')).set('x-test-user', actor);
  }

  /** The row as stored, read past the soft-delete extension. */
  async function deletedAt(id: string): Promise<Date | null> {
    const rows = await db.$queryRawUnsafe(`SELECT deleted_at FROM contacts WHERE id = '${id}'`);
    return rows[0].deleted_at;
  }

  function forgetRequests(contactId: string): Promise<Array<{ status: string; cancelled_at: Date | null }>> {
    return db.$queryRawUnsafe(`SELECT status, cancelled_at FROM contact_forget_requests WHERE contact_id = '${contactId}'`);
  }

  function cancelledEntries(contactId: string): Promise<Array<{ actor: unknown }>> {
    return db.$queryRawUnsafe(
      `SELECT actor FROM contact_audit_entries WHERE business_id = '${BIZ}' AND contact_id = '${contactId}' AND action = 'forget_cancelled'`,
    );
  }

  /** X stays exactly as the forget left it: deleted, one request still 'requested', no forget_cancelled entry. */
  async function expectStillForgotten() {
    expect(await deletedAt(xId)).not.toBeNull();
    expect(await forgetRequests(xId)).toEqual([{ status: 'requested', cancelled_at: null }]);
    expect(await cancelledEntries(xId)).toEqual([]);
  }

  beforeAll(async () => {
    await db.business.create({ data: { id: BIZ, name: 'TCD Biz E', ownerId: ID.owner } });
    await db.membership.create({ data: { id: `${P}m_owner_bizE`, userId: ID.owner, businessId: BIZ, role: 'OWNER' } });
    await db.user.create({ data: { id: STAFF_BOOK, email: `${STAFF_BOOK}@test.local`, role: 'USER' } });
    await db.membership.create({ data: { id: `${P}m_staffBook_bizE`, userId: STAFF_BOOK, businessId: BIZ, role: 'STAFF', permissionScopes: { crm: 'write', crm_view: 'owned', crm_edit: 'owned' } } });

    const x = await post(ID.owner, BIZ, { firstName: `${P}Forgotten`, email: X_EMAIL, phone: X_PHONE, ownerId: STAFF_BOOK });
    expect(x.status).toBe(201);
    xId = x.body.id;
    expect(await db.contact.findUnique({ where: { id: xId }, select: { ownerId: true } })).toEqual({ ownerId: STAFF_BOOK });
    const forgot = await forget(ID.owner, xId);
    expect(forgot.status).toBe(201);
    expect(await deletedAt(xId)).not.toBeNull();
    expect(await forgetRequests(xId)).toEqual([{ status: 'requested', cancelled_at: null }]);
  });

  it("NEGATIVE CONTROL (PF-01) — a live contact takes the forgotten contact's email (201), and the OWNER's forget/cancel answers 409 contact_email_taken naming it, with no database text; the contact stays deleted, the request stays 'requested' and no forget_cancelled entry is written", async () => {
    const y = await post(ID.owner, BIZ, { firstName: `${P}EmailTaker`, email: X_EMAIL.toUpperCase() });
    expect(y.status).toBe(201);
    emailHolderId = y.body.id;

    const res = await cancel(ID.owner, xId);
    expect(res.status).toBe(409);
    expectTaken(res.body, 'contact_email_taken', emailHolderId);
    expect(JSON.stringify(res.body)).not.toMatch(LEAK);
    await expectStillForgotten();
  });

  it("NEGATIVE CONTROL (PF-01) — the holder id is bounded by the actor's CRM visibility: the 'my book' STAFF who owns the forgotten contact reaches the service, but cannot open the holder (GET 404), so the same 409 carries existingContactId null and the id nowhere in the body", async () => {
    expect((await get(STAFF_BOOK, emailHolderId)).status).toBe(404);
    expect((await get(ID.owner, emailHolderId)).status).toBe(200);

    const res = await cancel(STAFF_BOOK, xId);
    expect(res.status).toBe(409);
    expectTaken(res.body, 'contact_email_taken', null);
    expect(JSON.stringify(res.body)).not.toContain(emailHolderId);
    expect(JSON.stringify(res.body)).not.toMatch(LEAK);
    await expectStillForgotten();
  });

  it("NEGATIVE CONTROL (PF-03) — the phone variant: once the email is free again (DELETE of its holder) but a live contact holds a punctuation variant of the forgotten contact's phone, the cancel answers 409 contact_phone_taken naming it for the OWNER and null for the STAFF", async () => {
    expect((await del(ID.owner, emailHolderId)).status).toBe(200);
    const z = await post(ID.owner, BIZ, { firstName: `${P}PhoneTaker`, phone: X_PHONE_VARIANT });
    expect(z.status).toBe(201);
    phoneHolderId = z.body.id;
    expect(await db.contact.findUnique({ where: { id: phoneHolderId }, select: { phoneNormalized: true } })).toEqual({ phoneNormalized: X_PHONE_NORMALIZED });

    const owner = await cancel(ID.owner, xId);
    expect(owner.status).toBe(409);
    expectTaken(owner.body, 'contact_phone_taken', phoneHolderId);
    expect(JSON.stringify(owner.body)).not.toMatch(LEAK);

    const staff = await cancel(STAFF_BOOK, xId);
    expect(staff.status).toBe(409);
    expectTaken(staff.body, 'contact_phone_taken', null);
    expect(JSON.stringify(staff.body)).not.toContain(phoneHolderId);
    await expectStillForgotten();
  });

  it("PF-02 — with both values free again (the phone holder's phone changed by PATCH) the same cancel succeeds: the contact is live with its email and phone, the request is 'cancelled', one forget_cancelled entry names the actor, and a second cancel is refused 400", async () => {
    const moved = await patch(ID.owner, BIZ, phoneHolderId, { phone: '+18685550399' });
    expect(moved.status).toBe(200);

    // The cancel route is a Nest @Post with no @HttpCode, so success is 201.
    const res = await cancel(ID.owner, xId);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
    expect(await deletedAt(xId)).toBeNull();
    expect(await db.contact.findUnique({ where: { id: xId }, select: { emailNormalized: true, phoneNormalized: true } }))
      .toEqual({ emailNormalized: X_EMAIL, phoneNormalized: X_PHONE_NORMALIZED });
    const requests = await forgetRequests(xId);
    expect(requests).toHaveLength(1);
    expect(requests[0].status).toBe('cancelled');
    expect(requests[0].cancelled_at).not.toBeNull();
    const entries = await cancelledEntries(xId);
    expect(entries).toHaveLength(1);
    expect(entries[0].actor).toMatchObject({ type: 'USER', id: ID.owner });

    const again = await cancel(ID.owner, xId);
    expect(again.status).toBe(400);
  });

  it("CONTROL (PF-04) — two concurrent POST .../forget on one live contact never answer 5xx: each is 2xx or 404 'Contact not found' (the live-only visibility check, when the other forget committed first), at least one is 2xx, and exactly one ContactForgetRequest row is left, 'requested' (the native upsert on the unique contactId); a later forget answers 404 the same way", async () => {
    const w = await post(ID.owner, BIZ, { firstName: `${P}Twice`, email: `${P}twice@test.local` });
    expect(w.status).toBe(201);
    const [a, b] = await Promise.all([forget(ID.owner, w.body.id), forget(ID.owner, w.body.id)]);
    // Which outcome the second call gets depends on whether it passes the
    // controller's live-only assertContactVisible before or after the first
    // forget's transaction commits: before, both reach the service and the
    // upsert keeps one row (2xx twice); after, the contact is soft-deleted and
    // the second call is a 404. Both orders are correct; a 5xx never is.
    const isOkOrGone = (res: { status: number; body?: { message?: unknown } }) =>
      (res.status >= 200 && res.status < 300) ||
      (res.status === 404 && res.body?.message === 'Contact not found');
    for (const res of [a, b]) {
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(500);
      expect(isOkOrGone(res), JSON.stringify(res.body)).toBe(true);
    }
    expect([a, b].some((res) => res.status >= 200 && res.status < 300), JSON.stringify([a.body, b.body])).toBe(true);
    expect(await forgetRequests(w.body.id)).toEqual([{ status: 'requested', cancelled_at: null }]);
    expect(await deletedAt(w.body.id)).not.toBeNull();

    // Deterministic cover of the 404 branch: once a forget has committed, a
    // further forget is refused by the live-only check, and nothing changes.
    const late = await forget(ID.owner, w.body.id);
    expect(late.status, JSON.stringify(late.body)).toBe(404);
    expect(late.body.message).toBe('Contact not found');
    expect(await forgetRequests(w.body.id)).toEqual([{ status: 'requested', cancelled_at: null }]);
  });
});
