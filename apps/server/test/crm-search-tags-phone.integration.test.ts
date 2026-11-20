/**
 * SWP-CRM-SEARCH (V1-63; browser sweep 2026-11-13 BUG-081 and BUG-083) — the Customers search
 * finds a contact by part of a tag in any case, reads a phone written in another spelling as the
 * same number, and treats '%' and '_' as the characters typed; the duplicate check reads phone
 * spellings the same way; a contact added today is not stale. Against a REAL database, through
 * the HTTP routes.
 *
 * BUG-081: tag a contact 'Christmas 2026', search 'christmas': 0 results. The list search
 * (GET /crm/businesses/:businessId/contacts?search=) matched tags only by exact, case-sensitive
 * element equality, and a hit of the full-text column (search_vector, filled by a trigger only
 * on databases that still carry it) replaced the field search instead of adding to it, so even
 * a fixed tag match vanished whenever a name matched too.
 *
 * BUG-083: import '868-555-0102', add the same person as '+1 868 555 0102': no duplicate
 * warning. The stored keys differ ('8685550102' and '+18685550102'); the search and
 * POST .../contacts/check-duplicates compared them as strings. The rule here is the one
 * samePhoneNumber (structure/position-holders.ts) already applies to staff phones: equal
 * digits, or a national number (7+ digits, written without '+') that the other spelling ends
 * with behind exactly a country calling code. Stored keys are left as they are (no backfill);
 * WA-E164-SERVER stores E.164 from the business's country.
 *
 * The duplicate check answers only contacts the member may open (SWP-CRM-SEARCH review
 * SEC-CRMS-1): POST .../contacts/check-duplicates names the holder it matched (id, name, email,
 * phone and keys), and the id is a working key, so a holder the member is denied on
 * GET contacts/:contactId (a 'my book' STAFF, or a view-all STAFF against another member's
 * PRIVATE row) is not matched there either, by the M7 rule rejectContactIdentityTaken applies. The
 * route read the whole tenant before (the exact key only); the reading of other spellings widened
 * what it handed out.
 *
 * Stale: GET ?staleDays=N (the Customers 'stale' filter sends 14) listed every contact with no
 * booking in the window, so a contact added a minute ago was "stale". A contact created inside
 * the window is not stale yet; one created before it, with no booking since, still is.
 *
 * Nothing on the HTTP or persistence path is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CrmRateLimitGuard, PlanLimitGuard, TeamAuditInterceptor, ValidationPipe,
 * GlobalHttpExceptionFilter, CrmController, CrmService and CrmStatsService are real against
 * DATABASE_URL. Identity attachment reads `x-test-user` and loads that seeded user row as
 * AuthMiddleware would after token verification; side channels off the contact write (timeline,
 * caches, flow) are recorders, and the plan limit allows, as in crm-contact-duplicate.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v63i_` prefix and is hard-deleted by raw
 * SQL (sqlLikePrefix) in beforeAll and afterAll. Cases tagged RED-BEFORE fail on the packet's
 * source base; CONTROL cases pass before and after.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v63i_';
const ID = {
  owner: `${P}owner`,         // OWNER of bizA
  staffOwned: `${P}staffOwn`, // STAFF of bizA, 'my book' (crm_view=owned)
  staffAll: `${P}staffAll`,   // STAFF of bizA, view-all (crm_view=all): every TEAM row, no other member's PRIVATE row
  ownerB: `${P}ownerB`,       // OWNER of bizB only
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  // Seeded directly (tags and names do not pass through any normalisation).
  noel: `${P}c_noel`,         // tag 'Christmas 2026'
  bride: `${P}c_bride`,       // tag 'Wedding'
  carol: `${P}c_carol`,       // first name 'Christmas', no tags (the full-text hit)
  elf: `${P}c_elf`,           // tag 'Christmas Elf', owned by the my-book STAFF
  promo: `${P}c_promo`,       // company '100% Juice', tag '50% off'
  abc: `${P}c_abc`,           // first name 'Tabcde' (a '_' reads as any one character)
  noelB: `${P}c_noelB`,       // bizB, tag 'Christmas 2026'
  old: `${P}c_old`,           // created 40 days ago, no booking: stale
  priv: `${P}c_priv`,         // PRIVATE, owned by the OWNER, phone '+1 868 555 0177'
  mine: `${P}c_mine`,         // owned by the my-book STAFF, phone '868-555-0144'
  // Stored before WA-E164-SERVER, the national way, as the write path stored them then (seeded:
  // the write path now stores E.164, and these cases are about a key stored another way).
  ravi: `${P}c_ravi`,         // bizA, TEAM, owned by the OWNER, phone '868-555-0101' (key '8685550101')
  raviB: `${P}c_bizBRavi`,    // bizB, the same number in another tenant (no id here contains another)
};

let db: any;
let app: any;
// Contacts created through POST (their phone keys come from the real write path), and the Ravis
// seeded as stored before WA-E164-SERVER (named the same way by the cases).
const viaApi: Record<string, string> = {};

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension). Contacts created through the
  // API have generated ids, so every table goes by business id.
  for (const sql of [
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
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

/** GET the list; answers the ids of this suite's contacts it returned, in no particular order. */
async function list(actor: string, businessId: string, query: Record<string, string>): Promise<string[]> {
  const res = await request(app.getHttpServer())
    .get(`/crm/businesses/${businessId}/contacts`)
    .query({ take: '100', ...query })
    .set('x-test-user', actor);
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  expect(Array.isArray(res.body.contacts)).toBe(true);
  const ids: string[] = res.body.contacts.map((c: { id: string }) => c.id);
  // Every row of the answer is a row of this business (the route is tenant-bound).
  for (const c of res.body.contacts as Array<{ businessId: string }>) expect(c.businessId).toBe(businessId);
  return ids;
}

function search(actor: string, businessId: string, term: string) {
  return list(actor, businessId, { search: term });
}

function checkDuplicates(actor: string, businessId: string, contacts: Array<Record<string, string>>) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${businessId}/contacts/check-duplicates`)
    .set('x-test-user', actor)
    .send({ contacts });
}

const sorted = (ids: string[]) => [...ids].sort();

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

  // ---- the real HTTP path (wired before any row is seeded) ---------------
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
      // Side channels off the contact write; the claims here are the reads.
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
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup(); // in case a prior run aborted

  // ---- identities, tenants, memberships ----------------------------------
  for (const suffix of ['owner', 'staffOwn', 'staffAll', 'ownerB']) {
    await db.user.create({ data: { id: `${P}${suffix}`, email: `${P}${suffix}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V63I Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V63I Biz B', ownerId: ID.ownerB } });
  await db.membership.create({ data: { id: `${P}m_owner_bizA`, userId: ID.owner, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({
    data: {
      id: `${P}m_staff_bizA`, userId: ID.staffOwned, businessId: ID.bizA, role: 'STAFF',
      permissionScopes: { crm: 'write', crm_view: 'owned', crm_edit: 'owned' },
    },
  });
  await db.membership.create({
    data: {
      id: `${P}m_staffAll_bizA`, userId: ID.staffAll, businessId: ID.bizA, role: 'STAFF',
      permissionScopes: { crm: 'write', crm_view: 'all', crm_edit: 'owned' },
    },
  });
  await db.membership.create({ data: { id: `${P}m_ownerB_bizB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });

  // ---- contacts seeded directly (tags, names, created_at) ----------------
  const seed = (id: string, businessId: string, data: Record<string, unknown>) =>
    db.contact.create({ data: { id, businessId, lastName: `${P}seed`, ...data } });
  await seed(ID.noel, ID.bizA, { firstName: 'Noel', tags: ['Christmas 2026'] });
  await seed(ID.bride, ID.bizA, { firstName: 'Bride', tags: ['Wedding'] });
  await seed(ID.carol, ID.bizA, { firstName: 'Christmas', tags: [] });
  await seed(ID.elf, ID.bizA, { firstName: 'Elf', tags: ['Christmas Elf'], ownerId: ID.staffOwned });
  await seed(ID.promo, ID.bizA, { firstName: 'Promo', companyName: '100% Juice', tags: ['50% off'] });
  await seed(ID.abc, ID.bizA, { firstName: 'Tabcde', tags: [] });
  await seed(ID.noelB, ID.bizB, { firstName: 'Noel', tags: ['Christmas 2026'] });
  await seed(ID.old, ID.bizA, { firstName: 'Olden', tags: [] });
  await db.$executeRawUnsafe(`UPDATE contacts SET created_at = now() - interval '40 days' WHERE id = '${ID.old}'`);
  // The keys are the ones normalizePhone / normalizeEmail store for these spellings (asserted below).
  await seed(ID.priv, ID.bizA, {
    firstName: 'Priya', lastName: 'Private', visibility: 'PRIVATE', ownerId: ID.owner,
    phone: '+1 868 555 0177', phoneNormalized: '+18685550177',
    email: `${P}priya.private@example.test`, emailNormalized: `${P}priya.private@example.test`,
  });
  await seed(ID.mine, ID.bizA, {
    firstName: 'Mina', ownerId: ID.staffOwned, phone: '868-555-0144', phoneNormalized: '8685550144',
  });

  // ---- contacts created through the API (phone keys from the write path) --
  const created = async (key: string, actor: string, businessId: string, body: Record<string, unknown>) => {
    const res = await post(actor, businessId, { lastName: `${P}api`, ...body });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    viaApi[key] = res.body.id;
  };
  // Ravi came in through a CSV import before WA-E164-SERVER, written the national way: the key
  // that write stored ('8685550101'; the write path now stores E.164, so he is seeded as stored).
  await seed(ID.ravi, ID.bizA, {
    firstName: 'Ravi', ownerId: ID.owner, phone: '868-555-0101', phoneNormalized: '8685550101',
  });
  viaApi.ravi = ID.ravi;
  // Asha was added by hand with the country code.
  await created('asha', ID.owner, ID.bizA, { firstName: 'Asha', phone: '+1 868 555 0102' });
  // Another tenant holds Ravi's number too, stored the same way.
  await seed(ID.raviB, ID.bizB, {
    firstName: 'Ravi', ownerId: ID.ownerB, phone: '868-555-0101', phoneNormalized: '8685550101',
  });
  viaApi.raviB = ID.raviB;
  // Added a minute ago, no bookings yet.
  await created('fresh', ID.owner, ID.bizA, { firstName: 'Fresh' });
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('fixture sanity (real rows)', () => {
  it('stored the phone keys the write path produces for each spelling, and the seeded tags as written', async () => {
    const keys = await db.contact.findMany({
      where: { id: { in: [viaApi.ravi, viaApi.asha, viaApi.raviB] } },
      select: { id: true, phone: true, phoneNormalized: true },
    });
    const byId = new Map(keys.map((k: any) => [k.id, k]));
    // The two spellings of one number are two different keys: this is the premise of BUG-083.
    // Ravi (and raviB) hold the national key a write stored before WA-E164-SERVER (no backfill in
    // v1); a number typed with its country code keeps its spelling and its key is already E.164
    // (Asha, through the write path).
    expect(byId.get(viaApi.ravi)).toMatchObject({ phone: '868-555-0101', phoneNormalized: '8685550101' });
    expect(byId.get(viaApi.asha)).toMatchObject({ phone: '+1 868 555 0102', phoneNormalized: '+18685550102' });
    expect(byId.get(viaApi.raviB)).toMatchObject({ phoneNormalized: '8685550101' });
    expect(await db.contact.findUnique({ where: { id: ID.mine }, select: { phoneNormalized: true } }))
      .toEqual({ phoneNormalized: '8685550144' });
    expect((await db.contact.findUnique({ where: { id: ID.noel } })).tags).toEqual(['Christmas 2026']);
    const { normalizePhone, normalizeEmail } = await import('../src/modules/crm/crm-duplicate.util');
    expect(normalizePhone('+1 868 555 0177')).toBe('+18685550177');
    expect(normalizePhone('868-555-0144')).toBe('8685550144');
    expect(normalizeEmail(`${P}priya.private@example.test`)).toBe(`${P}priya.private@example.test`);
    // Ravi came in through the OWNER's POST: a TEAM row no 'my book' STAFF owns.
    expect(await db.contact.findUnique({ where: { id: viaApi.ravi }, select: { visibility: true, ownerId: true } }))
      .toMatchObject({ visibility: 'TEAM' });
  });
});

describe('BUG-081 — searching by tag is case-insensitive and partial', () => {
  it("RED-BEFORE: 'christmas' finds the contact tagged 'Christmas 2026' (and the one named Christmas, and nothing outside the tenant)", async () => {
    const ids = await search(ID.owner, ID.bizA, 'christmas');
    expect(ids).toContain(ID.noel);
    expect(ids).toContain(ID.carol);
    expect(ids).toContain(ID.elf); // the OWNER reads every row of the book
    expect(ids).not.toContain(ID.noelB);
    expect(ids).not.toContain(ID.bride);
  });

  it("RED-BEFORE: 'WEDDING' finds the contact tagged 'Wedding' (case of the whole tag)", async () => {
    expect(await search(ID.owner, ID.bizA, 'WEDDING')).toEqual([ID.bride]);
  });

  it("RED-BEFORE: '2026' (part of the tag) finds the contact tagged 'Christmas 2026'", async () => {
    expect(await search(ID.owner, ID.bizA, '2026')).toEqual([ID.noel]);
  });

  it("CONTROL: the exact tag as written still finds it, and a word no tag or field holds finds nothing", async () => {
    expect(await search(ID.owner, ID.bizA, 'Wedding')).toEqual([ID.bride]);
    expect(await search(ID.owner, ID.bizA, 'birthday')).toEqual([]);
  });

  it("RED-BEFORE: a my-book STAFF searching 'christmas' gets the tagged contact of their own book, and only that (the tag match does not widen what they may see)", async () => {
    expect(await search(ID.staffOwned, ID.bizA, 'christmas')).toEqual([ID.elf]);
  });

  it("CONTROL: the other tenant's search finds its own tagged contact, never bizA's", async () => {
    expect(await search(ID.ownerB, ID.bizB, 'Christmas 2026')).toEqual([ID.noelB]);
  });

  it('CONTROL: the tags= filter keeps matching whole tags exactly', async () => {
    expect(await list(ID.owner, ID.bizA, { tags: 'Wedding' })).toEqual([ID.bride]);
    expect(await list(ID.owner, ID.bizA, { tags: 'wedding' })).toEqual([]);
  });

  describe('on a database that still carries the full-text trigger (search_vector filled)', () => {
    beforeAll(async () => {
      // No migration in packages/db/prisma/migrations installs the trigger, so a fresh database
      // leaves search_vector NULL; an older database built from migrations-archived fills it.
      // Fill it for the contact named Christmas, as that trigger would.
      await db.$executeRawUnsafe(
        `UPDATE contacts SET search_vector = to_tsvector('english', 'Christmas ${P}seed') WHERE id = '${ID.carol}'`,
      );
    });
    afterAll(async () => {
      await db.$executeRawUnsafe(`UPDATE contacts SET search_vector = NULL WHERE id = '${ID.carol}'`);
    });

    it("RED-BEFORE: a full-text hit on a name does not hide the tag matches: 'christmas' finds Christmas and Noel", async () => {
      const ids = await search(ID.owner, ID.bizA, 'christmas');
      expect(ids).toContain(ID.carol);
      expect(ids).toContain(ID.noel);
      expect(ids).not.toContain(ID.noelB);
    });
  });
});

describe("search treats '%' and '_' as the characters typed", () => {
  it("RED-BEFORE: '%' finds only the contact whose company and tag hold a '%'", async () => {
    expect(await search(ID.owner, ID.bizA, '%')).toEqual([ID.promo]);
  });

  it("RED-BEFORE: '% off' (part of the tag '50% off') finds the tagged contact, and nothing else", async () => {
    expect(await search(ID.owner, ID.bizA, '% off')).toEqual([ID.promo]);
  });

  it("RED-BEFORE: 'a_c' does not find 'Tabcde' ('_' is an underscore, not any one character)", async () => {
    expect(await search(ID.owner, ID.bizA, 'a_c')).toEqual([]);
  });

  it("CONTROL: 'abc' finds 'Tabcde'", async () => {
    expect(await search(ID.owner, ID.bizA, 'abc')).toEqual([ID.abc]);
  });
});

describe('BUG-083 — a phone written another way is the same number (search)', () => {
  it("RED-BEFORE: '+1 868 555 0101' finds Ravi, saved as '868-555-0101'", async () => {
    expect(await search(ID.owner, ID.bizA, '+1 868 555 0101')).toEqual([viaApi.ravi]);
  });

  it("RED-BEFORE: '1 868 555 0101' (the country code without '+') finds Ravi too", async () => {
    expect(await search(ID.owner, ID.bizA, '1 868 555 0101')).toEqual([viaApi.ravi]);
  });

  it("CONTROL: '868-555-0102' finds Asha, saved as '+1 868 555 0102'; '(868) 555-0101' finds Ravi", async () => {
    expect(await search(ID.owner, ID.bizA, '868-555-0102')).toEqual([viaApi.asha]);
    expect(await search(ID.owner, ID.bizA, '(868) 555-0101')).toEqual([viaApi.ravi]);
  });

  it("RED-BEFORE: the other tenant's search for '+1 868 555 0101' finds its own Ravi only", async () => {
    expect(await search(ID.ownerB, ID.bizB, '+1 868 555 0101')).toEqual([viaApi.raviB]);
  });
});

describe('BUG-083 — POST .../contacts/check-duplicates reads phone spellings as one number', () => {
  it("RED-BEFORE: '+1 868 555 0101', '1 (868) 555-0101' match Ravi ('868-555-0101') and '868-555-0102' matches Asha ('+1 868 555 0102'); the exact spelling still matches; another number does not", async () => {
    const res = await checkDuplicates(ID.owner, ID.bizA, [
      { firstName: 'Ravi', phone: '+1 868 555 0101' },
      { firstName: 'Asha', phone: '868-555-0102' },
      { firstName: 'Ravi', phone: '1 (868) 555-0101' },
      { firstName: 'Ravi', phone: '868-555-0101' },
      { firstName: 'Zed', phone: '+1 868 555 0199' },
    ]);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body.total).toBe(5);
    const byIndex = new Map<number, any>(res.body.duplicates.map((d: any) => [d.importIndex, d]));
    expect(byIndex.get(0)).toMatchObject({ matchField: 'phone', existingContact: { id: viaApi.ravi } });
    expect(byIndex.get(1)).toMatchObject({ matchField: 'phone', existingContact: { id: viaApi.asha } });
    expect(byIndex.get(2)).toMatchObject({ matchField: 'phone', existingContact: { id: viaApi.ravi } });
    expect(byIndex.get(3)).toMatchObject({ matchField: 'phone', existingContact: { id: viaApi.ravi } });
    expect(byIndex.has(4)).toBe(false);
    expect(res.body.duplicateCount).toBe(4);
    expect(res.body.newCount).toBe(1);
  });

  it("RED-BEFORE (WA-E164-SERVER review COR-E164-5): a phone is read under the business's country, as POST .../contacts and the import read it: in bizA (no country: Trinidad and Tobago) the local '555-0101' is Ravi's +1 868 555 0101; digits in front that are no country calling code ('+999 868 555 0101') or another country's code ('+44 868 555 0101', '+592 555 0101') do not make another number the same", async () => {
    const res = await checkDuplicates(ID.owner, ID.bizA, [
      { phone: '555-0101' },
      { phone: '+999 868 555 0101' },
      { phone: '+44 868 555 0101' },
      { phone: '+592 555 0101' },
    ]);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body.duplicates).toHaveLength(1);
    expect(res.body.duplicates[0]).toMatchObject({ importIndex: 0, matchField: 'phone', existingContact: { id: viaApi.ravi } });
    expect(res.body.newCount).toBe(3);
  });

  it("RED-BEFORE: in bizB, '+1 868 555 0101' matches bizB's own Ravi, never bizA's contacts", async () => {
    const res = await checkDuplicates(ID.ownerB, ID.bizB, [
      { firstName: 'Ravi', phone: '+1 868 555 0101' },
      { firstName: 'Asha', phone: '+1 868 555 0102' },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.duplicates).toHaveLength(1);
    expect(res.body.duplicates[0]).toMatchObject({ importIndex: 0, matchField: 'phone', existingContact: { id: viaApi.raviB } });
    expect(JSON.stringify(res.body)).not.toContain(viaApi.ravi);
    expect(JSON.stringify(res.body)).not.toContain(viaApi.asha);
  });
});

describe('SEC-CRMS-1 — check-duplicates answers only contacts the member may open (M7)', () => {
  function detail(actor: string, contactId: string) {
    return request(app.getHttpServer())
      .get(`/crm/businesses/${ID.bizA}/contacts/${contactId}`)
      .set('x-test-user', actor);
  }

  /** Nothing of a hidden holder in the answer: its id, its name, its stored keys. */
  function expectNoTraceOf(body: unknown, ...needles: string[]) {
    const text = JSON.stringify(body);
    for (const needle of needles) expect(text, `the answer names ${needle}`).not.toContain(needle);
  }

  it("CONTROL: the premise: GET detail refuses the my-book STAFF Ravi and Priya (404) and opens their own Mina; the view-all STAFF opens Ravi, not Priya", async () => {
    expect((await detail(ID.staffOwned, viaApi.ravi)).status).toBe(404);
    expect((await detail(ID.staffOwned, ID.priv)).status).toBe(404);
    expect((await detail(ID.staffOwned, ID.mine)).status).toBe(200);
    expect((await detail(ID.staffAll, viaApi.ravi)).status).toBe(200);
    expect((await detail(ID.staffAll, ID.priv)).status).toBe(404);
  });

  it("RED-BEFORE: a my-book STAFF gets no duplicate for Ravi (any spelling, the exact one too) or Priya (phone or email); their own Mina is still matched", async () => {
    const res = await checkDuplicates(ID.staffOwned, ID.bizA, [
      { phone: '+1 868 555 0101' },
      { phone: '868-555-0101' },
      { email: `${P}PRIYA.private@example.test` },
      { phone: '868-555-0177' },
      { phone: '+1 868 555 0144' },
    ]);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body.total).toBe(5);
    expect(res.body.duplicates).toHaveLength(1);
    expect(res.body.duplicates[0]).toMatchObject({ importIndex: 4, matchField: 'phone', existingContact: { id: ID.mine, firstName: 'Mina' } });
    expect(res.body.duplicateCount).toBe(1);
    expect(res.body.newCount).toBe(4);
    expectNoTraceOf(res.body, viaApi.ravi, ID.priv, 'Ravi', 'Priya', 'Private', '8685550101', '+18685550177');
  });

  it("RED-BEFORE: a view-all STAFF gets no duplicate for another member's PRIVATE Priya (phone in any spelling, or email); the TEAM row Ravi is still matched", async () => {
    const res = await checkDuplicates(ID.staffAll, ID.bizA, [
      { phone: '868-555-0177' },
      { phone: '1 868 555 0177' },
      { phone: '+1 868 555 0177' },
      { email: `${P}priya.private@example.test` },
      { phone: '+1 868 555 0101' },
    ]);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body.duplicates).toHaveLength(1);
    expect(res.body.duplicates[0]).toMatchObject({ importIndex: 4, matchField: 'phone', existingContact: { id: viaApi.ravi } });
    expect(res.body.duplicateCount).toBe(1);
    expect(res.body.newCount).toBe(4);
    expectNoTraceOf(res.body, ID.priv, 'Priya', 'Private', 'priya.private', '+18685550177');
  });

  it('CONTROL: the OWNER, who opens every row, still gets Priya for her phone in another spelling and for her email', async () => {
    const res = await checkDuplicates(ID.owner, ID.bizA, [
      { phone: '868-555-0177' },
      { email: `${P}priya.private@example.test` },
    ]);
    expect(res.status).toBe(201);
    const byIndex = new Map<number, any>(res.body.duplicates.map((d: any) => [d.importIndex, d]));
    expect(byIndex.get(0)).toMatchObject({ matchField: 'phone', existingContact: { id: ID.priv } });
    expect(byIndex.get(1)).toMatchObject({ matchField: 'email', existingContact: { id: ID.priv } });
  });

  it('CONTROL: the list search stays bound by the same rule (the my-book STAFF finds Mina, not Ravi; the view-all STAFF does not find Priya)', async () => {
    expect(await search(ID.staffOwned, ID.bizA, '+1 868 555 0101')).toEqual([]);
    expect(await search(ID.staffOwned, ID.bizA, '+1 868 555 0144')).toEqual([ID.mine]);
    expect(await search(ID.staffAll, ID.bizA, '868-555-0177')).toEqual([]);
  });
});

describe('a contact added today is not stale (GET ?staleDays=)', () => {
  it("RED-BEFORE: the Customers 'stale' filter (staleDays=14) does not list a contact created a minute ago", async () => {
    const ids = await list(ID.owner, ID.bizA, { staleDays: '14' });
    expect(ids).not.toContain(viaApi.fresh);
    expect(ids).not.toContain(viaApi.ravi);
  });

  it('CONTROL: a contact created 40 days ago with no booking since is stale', async () => {
    expect(await list(ID.owner, ID.bizA, { staleDays: '14' })).toContain(ID.old);
    expect(await list(ID.owner, ID.bizA, { staleDays: '30' })).toContain(ID.old);
  });

  it('CONTROL: a contact created a minute ago is in no at-risk segment (relationshipHealth=AT_RISK)', async () => {
    expect(await list(ID.owner, ID.bizA, { relationshipHealth: 'AT_RISK' })).not.toContain(viaApi.fresh);
  });
});
