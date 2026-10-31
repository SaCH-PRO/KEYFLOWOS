/**
 * R0-D7-CONTACT-EMAIL-409 — duplicate contact identity inside a tenant (REAL database).
 *
 * The Contact table carries two tenant-scoped uniques (schema.prisma):
 *   @@unique([businessId, emailNormalized])
 *   @@unique([businessId, phoneNormalized])
 * Before this packet a second contact with an email (or phone) already held in
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
 */
import 'reflect-metadata';
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
    `DELETE FROM contact_events WHERE business_id LIKE '${P}%'`,
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

  // ---- the real HTTP path (wired before any row is seeded, so a wiring
  // fault is reported as itself and not as a seeding failure) -------------
  const moduleRef = await Test.createTestingModule({
    controllers: [CrmController],
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

describe('a soft-deleted holder still occupies the unique (characterized, not a product decision)', () => {
  // The unique index is on (business_id, email_normalized) with no deleted_at
  // term, so a soft-deleted contact keeps its email reserved. The API answers
  // 409 with the same code; the existing id is null because the holder is not
  // a live contact and the detail route would answer 404 for it. Whether a
  // deleted holder should be restored or released is a separate decision; this
  // pins what the API does today so that decision starts from evidence.
  //
  // The GDPR forget flow soft-deletes a contact for its grace period, so the
  // body must not say that the holder is deleted: it reads exactly like the
  // live-holder 409 (same code, same message), only the id is null.
  const GONE_EMAIL = `${P}gone@test.local`;

  it('creating with the email of a soft-deleted contact answers 409 contact_email_taken with existingContactId null, and the body does not say the holder is deleted', async () => {
    const created = await post(ID.owner, ID.bizA, { firstName: `${P}Gone`, email: GONE_EMAIL });
    expect(created.status).toBe(201);
    await db.contact.delete({ where: { id: created.body.id } }); // soft-delete extension: sets deleted_at
    const raw = await db.$queryRawUnsafe(`SELECT deleted_at FROM contacts WHERE id = '${created.body.id}'`);
    expect(raw[0].deleted_at).not.toBeNull();

    const res = await post(ID.owner, ID.bizA, { firstName: `${P}Gone2`, email: GONE_EMAIL });
    expect(res.status).toBe(409);
    expectTaken(res.body, 'contact_email_taken', null);
    expect(await db.contact.count({ where: { businessId: ID.bizA, emailNormalized: GONE_EMAIL, deletedAt: null } })).toBe(0);

    const live = await post(ID.owner, ID.bizA, { firstName: `${P}Gone3`, email: EMAIL });
    expect(live.status).toBe(409);
    expect(live.body.details.existingContactId).toBeTruthy();
    expect(res.body.code).toBe(live.body.code);
    expect(res.body.message).toBe(live.body.message);
    expect(JSON.stringify(res.body)).not.toMatch(/delet/i);
  });
});
