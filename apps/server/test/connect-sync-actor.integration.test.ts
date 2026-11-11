/**
 * W6-CONNECT-TAG-MERGE (W5-D92-RESIDUALS review SEC-D92R-2; owner ruling D-93):
 * a contact sync or a connector form backfill writes an existing contact only
 * as the member who configured it may, and records that member as the actor
 * (REAL database).
 *
 * The defect: the Google Contacts and Outlook Contacts syncs and the connector
 * form (Typeform, Jotform, webhook form) backfill write onto contacts that
 * already exist in the CRM (the sync overwrites the name, email, phone and
 * company of a contact it matches; an Outlook tombstone soft-deletes one; the
 * backfill merges the mapping's tags into the contact a submission is linked
 * to) straight through Prisma, with no actor and no visibility check. So a sync
 * or a form mapping a STAFF member configured rewrote the owner's PRIVATE
 * contacts, which that member cannot open, and no trace said who did it.
 *
 * The contract proven here:
 *   - the configuring member is the member who saved the configuration: PUT
 *     contacts/mapping-rules and outlook-contacts/mapping-rules (the controller
 *     passes its caller), POST connector-forms/:source/:externalFormId/mapping
 *     (whose handler does not pass its caller: the member the TenantInterceptor
 *     bound to the request, as V1-89 reads it);
 *   - the actor of a run is the member whose request starts it (review repair
 *     SEC-W6CTM-2); only a run no request starts (a system run) runs as the
 *     configuring member, else, for a configuration that records none (saved
 *     before W6, or never saved), as the business owner (D-93: Business.ownerId,
 *     read when it runs). Every write must be allowed for the actor and for the
 *     configuring member, whose configuration bounds every run;
 *   - an existing contact is written only when the CRM's own write door lets
 *     those members write it (CrmService.assertCanEditContact for a sync,
 *     CrmService.bulkUpdateContacts' tag merge for a backfill: the GET detail
 *     visibility clause plus the member's edit scope); an Outlook tombstone
 *     deletes one only through CrmService.softDeleteContact (delete scope,
 *     SEC-W6CTM-1); a contact is created only when CrmService's create check
 *     admits them (SEC-W6CTM-3). A contact they cannot open, or may not
 *     write, is left exactly as it is and reported skipped, and the provider
 *     sync token stays where it was so a later run reads it again (CR-CTM-3);
 *   - a tombstone or a form submission linked to no live contact of the
 *     business is applied without writing a contact (CR-CTM-2, CR-CTM-1);
 *   - every contact the sync or backfill writes (updated, created, deleted,
 *     tags merged) carries the actor: a ContactAuditEntry with
 *     { type: USER, id }, and on the CRM doors the ContactEvent too.
 *
 * W10-GOOGLE-DOORS-REST (owner ruling D-99): a Google Contacts sync is started
 * only by the business owner (POST contacts/sync answers anyone else 403
 * GOOGLE_CONNECT_OWNER_ONLY). The five Google Contacts cases a STAFF member
 * started (SEC-D92R-2 x2, SEC-W6CTM-2 x2, CR-CTM-3) are re-pointed: the
 * configuring member's bound is proven with the owner starting the Google run,
 * and the starting member's own bound (SEC-W6CTM-2) on the Outlook source, where
 * a STAFF member still starts it (the Google start is refused and writes
 * nothing). See the note in the sync describe.
 *
 * Nothing on the authorization or persistence path is mocked: PrismaService,
 * the user, business, membership and contact rows, AuthGuard, BusinessGuard,
 * the TenantInterceptor, ConnectController, GoogleContactsSyncService,
 * OutlookContactsSyncService, ConnectorFormMappingService, CrmService,
 * CrmTimelineService and ContactAuditService are real against DATABASE_URL.
 * The stand-ins: identity attachment (a test middleware reads `x-test-user`,
 * loads that seeded user row and attaches `{ id, email, role }` as
 * AuthMiddleware would after Supabase token verification); the provider APIs
 * (People API, Microsoft Graph: a stubbed fetch, no network) and the OAuth
 * token helpers (a fake token); CrmTimelineService's and CrmService's side
 * channels (activity ledger, evidence, task assignment, stats/flow caches,
 * subscriptions, list/entity-resolution/custom-field collaborators), never on
 * the path asserted here; and the connect controller's other collaborators.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v92f_` prefix (rows the
 * routes create are deleted by their business id) and is hard-deleted by raw
 * SQL in beforeAll and afterAll. No $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
import { trackAsyncWrites } from './helpers/async-writes.js';

vi.setConfig({ testTimeout: 60_000 });

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v92f_';

const ID = {
  owner: `${P}owner`, // OWNER of every business here
  staff: `${P}staff`, // STAFF, crm write: opens TEAM contacts, not the owner's PRIVATE ones
  reader: `${P}reader`, // STAFF, crm read: opens TEAM contacts, may edit none
  noDelete: `${P}nodelete`, // STAFF in bizO only, crm write with crm_delete none (the Outlook tombstone cases)
  bizG: `${P}bizG`, // Google Contacts
  bizO: `${P}bizO`, // Outlook Contacts
  bizF: `${P}bizF`, // connector form (Typeform)
};

const EMAIL = {
  priv: `${P}priv@test.local`,
  team: `${P}team@test.local`,
  fresh: `${P}fresh@test.local`,
};

let db: any;
let app: any;
let asyncWrites: ReturnType<typeof trackAsyncWrites> | undefined;
/**
 * The services themselves, for a run with no request member (a system run,
 * D-93): called outside any request, no TenantInterceptor binds a member.
 */
let systemRun: {
  contacts: { sync(businessId: string): Promise<Record<string, unknown>> };
  'outlook-contacts': { sync(businessId: string): Promise<Record<string, unknown>> };
  forms: { backfill(businessId: string, source: string, leadFormId: string): Promise<Record<string, unknown>> };
};

/** What the stubbed provider APIs answer with on the next sync. */
let peopleConnections: Array<Record<string, unknown>> = [];
let graphContacts: Array<Record<string, unknown>> = [];
/** The People API's nextSyncToken and Graph's @odata.deltaLink on the next sync (none unless a case sets them). */
let peopleNextSyncToken: string | undefined;
let graphDeltaLink: string | undefined;
const outbound: string[] = [];
const fetchStub = vi.fn(async (url: string) => {
  const target = String(url);
  outbound.push(target);
  const body = target.startsWith('https://people.googleapis.com/')
    ? { connections: peopleConnections, ...(peopleNextSyncToken ? { nextSyncToken: peopleNextSyncToken } : {}) }
    : target.startsWith('https://graph.microsoft.com/')
      ? { value: graphContacts, ...(graphDeltaLink ? { '@odata.deltaLink': graphDeltaLink } : {}) }
      : null;
  if (!body) throw new Error(`unexpected outbound request: ${target}`);
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
});

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension), children first.
  for (const sql of [
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_external_mappings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_sync_audits WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM lead_form_submissions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM lead_forms WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM connector_statuses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_shares WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/**
 * A fresh start for one business: everything an earlier case wrote under it is
 * removed, and its two contacts are seeded again: the owner's PRIVATE contact
 * (which crm write and crm read STAFF members cannot open) and the owner's TEAM
 * contact (which both can open).
 */
async function reseed(businessId: string) {
  for (const table of [
    'contact_audit_entries', 'contact_events', 'activities', 'contact_external_mappings', 'contact_sync_audits',
    'lead_form_submissions', 'lead_forms', 'connector_statuses', 'contacts',
  ]) {
    await db.$executeRawUnsafe(`DELETE FROM ${table} WHERE business_id = $1`, businessId);
  }
  // A sync token or delta link an earlier case's sync stored, and its provider answer.
  await db.$executeRawUnsafe(`UPDATE businesses SET contacts_sync_token = NULL, ms_contacts_delta_link = NULL WHERE id = $1`, businessId);
  peopleNextSyncToken = undefined;
  graphDeltaLink = undefined;
  const priv = await db.contact.create({
    data: {
      id: `${businessId}_priv`, businessId, firstName: 'Private', lastName: 'Person', visibility: 'PRIVATE', ownerId: ID.owner,
      email: EMAIL.priv, emailNormalized: EMAIL.priv, tags: ['vip'], status: 'CLIENT',
    },
  });
  const team = await db.contact.create({
    data: {
      id: `${businessId}_team`, businessId, firstName: 'Team', lastName: 'Person', visibility: 'TEAM', ownerId: ID.owner,
      email: EMAIL.team, emailNormalized: EMAIL.team, tags: ['old'], status: 'CLIENT',
    },
  });
  return { priv, team };
}

function contactRow(id: string) {
  return db.contact.findUnique({ where: { id } });
}

/** The live and trashed row alike (the soft-delete extension hides a trashed row from findUnique). */
async function rawContact(id: string): Promise<{ first_name: string | null; deleted_at: Date | null; tags: string[] } | undefined> {
  const rows = await db.$queryRawUnsafe(`SELECT first_name, deleted_at, tags FROM contacts WHERE id = $1`, id);
  return rows[0];
}

async function audits(contactId: string) {
  if (asyncWrites) await asyncWrites.drain();
  const rows = await db.contactAuditEntry.findMany({ where: { contactId }, orderBy: { createdAt: 'asc' } });
  return rows.map((r: any) => ({ action: r.action, actor: r.actor }));
}

async function events(contactId: string, type: string) {
  const rows = await db.contactEvent.findMany({ where: { contactId, type }, orderBy: { createdAt: 'asc' } });
  return rows.map((r: any) => ({ actorType: r.actorType, actorId: r.actorId }));
}

const asUser = (id: string) => ({ type: 'USER', id });

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { EntityResolutionService } = await import('../src/core/connectors/entity-resolution.service');
  const { ConnectController } = await import('../src/modules/connect/connect.controller');
  const { GoogleContactsSyncService } = await import('../src/modules/connect/google-contacts-sync.service');
  const { OutlookContactsSyncService } = await import('../src/modules/connect/outlook-contacts-sync.service');
  const { ConnectorFormMappingService } = await import('../src/modules/connect/connector-form-mapping.service');
  const { GoogleFormsMappingService } = await import('../src/modules/connect/google-forms-mapping.service');
  const { GoogleFormsService } = await import('../src/modules/connect/google-forms.service');
  const { ContactSyncService } = await import('../src/modules/connect/contact-sync.service');
  const { SignatureParserService } = await import('../src/modules/connect/signature-parser.service');
  const { GoogleBusinessProfileService } = await import('../src/modules/connect/google-business-profile.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
  const { CrmStatsService } = await import('../src/modules/crm/crm-stats.service');
  const { CrmListsService } = await import('../src/modules/crm/crm-lists.service');
  const { CrmFlowService } = await import('../src/modules/crm/crm-flow.service');
  const { ContactAuditService } = await import('../src/modules/crm/privacy/contact-audit.service');
  const { ContactCustomFieldValueService } = await import('../src/modules/crm/contact-custom-field-value.service');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');

  // ---- the real HTTP path (wired before any row is seeded, so a wiring
  // fault is reported as itself and not as a seeding failure) -------------
  const moduleRef = await Test.createTestingModule({
    controllers: [ConnectController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      // The two sync services are built by a factory over the same real
      // PrismaService, CrmService and ContactAuditService the container holds:
      // their constructors on the packet's base carry no @Inject, which this
      // transform (no decorator metadata) cannot resolve, so the suite runs the
      // same code path before and after the fix.
      {
        provide: GoogleContactsSyncService,
        useFactory: (prisma: unknown, crm: unknown, audit: unknown) =>
          new (GoogleContactsSyncService as any)(prisma, crm, audit),
        inject: [PrismaService, CrmService, ContactAuditService],
      },
      {
        provide: OutlookContactsSyncService,
        useFactory: (prisma: unknown, crm: unknown, audit: unknown) =>
          new (OutlookContactsSyncService as any)(prisma, crm, audit),
        inject: [PrismaService, CrmService, ContactAuditService],
      },
      ConnectorFormMappingService,
      CrmService,
      CrmTimelineService,
      ContactAuditService,
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      // CrmTimelineService's side channels (the ContactEvent row is the real write).
      { provide: TimelineService, useValue: { recordEvent: async () => undefined } },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      // CrmService's collaborators off the paths asserted here.
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CrmStatsService, useValue: { invalidateCache: () => undefined } },
      { provide: CrmListsService, useValue: {} },
      { provide: CrmFlowService, useValue: { invalidateCache: () => undefined } },
      { provide: EntityResolutionService, useValue: {} },
      { provide: ContactCustomFieldValueService, useValue: {} },
      // The connect controller's other collaborators (routes not used here).
      { provide: GoogleFormsMappingService, useValue: {} },
      { provide: GoogleFormsService, useValue: {} },
      { provide: ContactSyncService, useValue: {} },
      { provide: SignatureParserService, useValue: {} },
      { provide: GoogleBusinessProfileService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only, for seeded v92f_ users. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  // The global interceptor that binds the request's member and verified tenant (app.module.ts).
  app.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
  await app.init();

  // The OAuth token helpers read and refresh tokens on the business row; the
  // syncs under test only need a token to send to the stubbed provider API.
  (app.get(GoogleContactsSyncService) as any).tokens = { getValidAccessToken: async () => 'fake-access-token' };
  (app.get(OutlookContactsSyncService) as any).tokens = { getValidAccessToken: async () => 'fake-access-token' };
  systemRun = {
    contacts: app.get(GoogleContactsSyncService),
    'outlook-contacts': app.get(OutlookContactsSyncService),
    forms: app.get(ConnectorFormMappingService),
  };
  vi.stubGlobal('fetch', fetchStub);

  // The ContactAuditEntry writes CrmService starts are fire-and-forget (DEC-CONTACTS-002).
  asyncWrites = trackAsyncWrites([[ContactAuditService.prototype, 'write']]);

  await cleanup(); // in case a prior run aborted

  for (const name of ['owner', 'staff', 'reader']) {
    await db.user.create({ data: { id: `${P}${name}`, email: `${P}${name}@test.local`, role: 'USER' } });
  }
  for (const biz of [ID.bizG, ID.bizO, ID.bizF]) {
    await db.business.create({ data: { id: biz, name: `V92F ${biz}`, ownerId: ID.owner } });
    await db.membership.create({ data: { id: `${P}m_owner_${biz}`, userId: ID.owner, businessId: biz, role: 'OWNER' } });
    await db.membership.create({ data: { id: `${P}m_staff_${biz}`, userId: ID.staff, businessId: biz, role: 'STAFF', permissionScopes: { crm: 'write' } } });
    await db.membership.create({ data: { id: `${P}m_reader_${biz}`, userId: ID.reader, businessId: biz, role: 'STAFF', permissionScopes: { crm: 'read' } } });
  }
}, 120_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  if (asyncWrites) await asyncWrites.drain();
  asyncWrites?.restore();
  if (app) await app.close();
  if (db) await cleanup();
});

const agent = () => request(app.getHttpServer());

describe('fixture sanity (real rows)', () => {
  it('seeded three businesses, each with an owner, a crm write STAFF member and a crm read STAFF member; the STAFF members cannot open the owner\'s PRIVATE contact', async () => {
    // The GET contacts/:contactId rule (assertContactVisible).
    const { assertContactVisible } = await import('../src/modules/crm/crm-permissions.helper');
    const prisma = { client: db } as any;
    for (const biz of [ID.bizG, ID.bizO, ID.bizF]) {
      expect(await db.membership.count({ where: { businessId: biz } })).toBe(3);
      const { priv, team } = await reseed(biz);
      for (const member of [ID.staff, ID.reader]) {
        await expect(assertContactVisible(prisma, biz, priv.id, member)).rejects.toThrow('Contact not found');
        await expect(assertContactVisible(prisma, biz, team.id, member)).resolves.toBeTruthy();
      }
      await expect(assertContactVisible(prisma, biz, priv.id, ID.owner)).resolves.toBeTruthy();
    }
  });
});

describe.each([
  ['Google Contacts', 'contacts', 'google_contacts', ID.bizG],
  ['Outlook Contacts', 'outlook-contacts', 'outlook_contacts', ID.bizO],
])('W6-CONNECT-TAG-MERGE (SEC-D92R-2, D-93): the %s sync', (_label, route, source, biz) => {
  const rulesUrl = `/connect/businesses/${biz}/${route}/mapping-rules`;
  const syncUrl = `/connect/businesses/${biz}/${route}/sync`;

  /**
   * W10-GOOGLE-DOORS-REST (owner ruling D-99): every Google connection is
   * started, synced and disconnected only by the business owner, so POST
   * contacts/sync (the Google Contacts sync) answers anyone else 403
   * GOOGLE_CONNECT_OWNER_ONLY before anything runs
   * (google-consent-owner.integration.test.ts [V94D-T05]); the Outlook Contacts
   * sync (a Microsoft connection) stays a member's. D-99 supersedes the five
   * cases below in which a STAFF member started the Google sync. Where what a
   * case proves is the configuring member's bound (SEC-D92R-2, CR-CTM-3), it
   * holds whoever starts the run, so the Google run is started by the owner.
   * Where it is the starting member's own bound (SEC-W6CTM-2 x2), it needs a
   * starter who is not the owner, so it is proven on the Outlook source; on the
   * Google source that member's start is refused and writes nothing.
   */
  const google = route === 'contacts';
  /** Who starts a run the case has `member` start: the owner on the Google Contacts source (D-99). */
  const starter = (member: string) => (google ? ID.owner : member);
  /** D-99 on the Google Contacts source: `member`'s start is refused before anything runs. */
  async function expectGoogleStartRefused(member: string) {
    outbound.length = 0;
    const res = await agent().post(syncUrl).set('x-test-user', member);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.code).toBe('GOOGLE_CONNECT_OWNER_ONLY');
    expect(outbound).toEqual([]);
  }

  /** The provider answers with these people (first name, email). */
  function remote(people: Array<[string, string]>) {
    peopleConnections = people.map(([first, email], i) => ({
      resourceName: `people/${P}${i}`,
      names: [{ givenName: first }],
      emailAddresses: [{ value: email }],
    }));
    graphContacts = people.map(([first, email], i) => ({
      id: `${P}graph${i}`,
      givenName: first,
      emailAddresses: [{ address: email }],
    }));
  }

  it('SEC-D92R-2 (D-99): a sync whose rules a crm write STAFF member saved leaves the owner\'s PRIVATE contact that member cannot open unchanged and reports it skipped; the TEAM contact it writes and the contact it creates record the member who started the run as the actor (that STAFF member on the Outlook source; the owner on the Google Contacts source, whose sync only the owner starts)', async () => {
    const { priv, team } = await reseed(biz);
    await agent().put(rulesUrl).set('x-test-user', ID.staff).send({ defaultTags: ['synced'] }).expect(200);
    remote([['Renamed', EMAIL.priv], ['Renamed', EMAIL.team], ['Newcomer', EMAIL.fresh]]);

    // D-99 (W10-GOOGLE-DOORS-REST): the owner starts the Google Contacts run.
    const runner = starter(ID.staff);
    const res = await agent().post(syncUrl).set('x-test-user', runner);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ imported: 1, updated: 1, skipped: 1 }));

    // The PRIVATE contact is exactly as it was, and the sync did not link it.
    expect(await contactRow(priv.id)).toEqual(expect.objectContaining({ firstName: 'Private', tags: ['vip'], status: 'CLIENT' }));
    expect(await db.contactExternalMapping.count({ where: { contactId: priv.id } })).toBe(0);
    expect(await audits(priv.id)).toEqual([]);

    // The TEAM contact is written, and the member who started the run is its actor.
    expect(await contactRow(team.id)).toEqual(expect.objectContaining({ firstName: 'Renamed', tags: ['old'] }));
    expect(await audits(team.id)).toEqual([{ action: 'updated', actor: asUser(runner) }]);

    // So is the contact the sync creates.
    const created = await db.contact.findFirst({ where: { businessId: biz, emailNormalized: EMAIL.fresh } });
    expect(created).toEqual(expect.objectContaining({ firstName: 'Newcomer', source, tags: ['synced'] }));
    expect(await audits(created.id)).toEqual([{ action: 'created', actor: asUser(runner) }]);
    expect(outbound.every((u) => u.startsWith('https://people.googleapis.com/') || u.startsWith('https://graph.microsoft.com/'))).toBe(true);
  });

  it('SEC-D92R-2, SEC-W6CTM-2: the configuring member bounds every run, whoever starts it: the owner running a sync a crm write STAFF member configured still leaves the PRIVATE contact unchanged, and the owner, who ran it, is the recorded actor of the TEAM contact it writes', async () => {
    const { priv, team } = await reseed(biz);
    await agent().put(rulesUrl).set('x-test-user', ID.staff).send({ defaultTags: [] }).expect(200);
    remote([['Renamed', EMAIL.priv], ['Renamed', EMAIL.team]]);

    const res = await agent().post(syncUrl).set('x-test-user', ID.owner);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ updated: 1, skipped: 1 }));
    expect(await contactRow(priv.id)).toEqual(expect.objectContaining({ firstName: 'Private' }));
    expect(await audits(team.id)).toEqual([{ action: 'updated', actor: asUser(ID.owner) }]);
  });

  it('SEC-D92R-2 (D-99): a sync whose rules a crm read STAFF member saved writes no existing contact (that member may edit none, the CRM edit rule) and reports both skipped, whoever starts it (that member on the Outlook source; the owner on the Google Contacts source, whose sync only the owner starts)', async () => {
    const { priv, team } = await reseed(biz);
    await agent().put(rulesUrl).set('x-test-user', ID.reader).send({ defaultTags: [] }).expect(200);
    remote([['Renamed', EMAIL.priv], ['Renamed', EMAIL.team]]);

    // D-99 (W10-GOOGLE-DOORS-REST): the owner starts the Google Contacts run.
    const res = await agent().post(syncUrl).set('x-test-user', starter(ID.reader));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ updated: 0, skipped: 2 }));
    expect(await contactRow(priv.id)).toEqual(expect.objectContaining({ firstName: 'Private' }));
    expect(await contactRow(team.id)).toEqual(expect.objectContaining({ firstName: 'Team' }));
    expect(await audits(priv.id)).toEqual([]);
    expect(await audits(team.id)).toEqual([]);
  });

  it('SEC-W6CTM-2 (D-93, D-99): a sync whose rules record no configuring member runs as the member who starts it, not as the owner: a crm write STAFF member\'s run of the Outlook source leaves the owner\'s PRIVATE contact unchanged and unlinked, and names that member on the TEAM contact it writes; on the Google Contacts source, whose sync only the owner starts, that member\'s start is refused 403 GOOGLE_CONNECT_OWNER_ONLY and changes, links and audits nothing', async () => {
    const { priv, team } = await reseed(biz);
    remote([['Renamed', EMAIL.priv], ['Renamed', EMAIL.team]]);

    if (google) {
      // D-99 (W10-GOOGLE-DOORS-REST): the starting member's bound is proven on the Outlook source.
      await expectGoogleStartRefused(ID.staff);
      for (const contact of [priv, team]) {
        expect(await contactRow(contact.id)).toEqual(expect.objectContaining({ firstName: contact.firstName, tags: contact.tags }));
        expect(await audits(contact.id)).toEqual([]);
      }
      expect(await db.contactExternalMapping.count({ where: { businessId: biz } })).toBe(0);
      return;
    }
    const res = await agent().post(syncUrl).set('x-test-user', ID.staff);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ updated: 1, skipped: 1 }));
    expect(await contactRow(priv.id)).toEqual(expect.objectContaining({ firstName: 'Private', tags: ['vip'] }));
    expect(await db.contactExternalMapping.count({ where: { contactId: priv.id } })).toBe(0);
    expect(await audits(priv.id)).toEqual([]);
    expect(await contactRow(team.id)).toEqual(expect.objectContaining({ firstName: 'Renamed' }));
    expect(await audits(team.id)).toEqual([{ action: 'updated', actor: asUser(ID.staff) }]);
  });

  it('SEC-W6CTM-2 (D-99): the member who starts a sync must be allowed each write as well: a member who may edit and create no contact (crm read) running a sync the owner configured changes, links and creates nothing, and no audit entry names anyone (on the Outlook source by its run; on the Google Contacts source, whose sync only the owner starts, because that member\'s start is refused 403 GOOGLE_CONNECT_OWNER_ONLY)', async () => {
    const { priv, team } = await reseed(biz);
    await agent().put(rulesUrl).set('x-test-user', ID.owner).send({ defaultTags: ['synced'] }).expect(200);
    remote([['AttackerName', EMAIL.priv], ['AttackerName', EMAIL.team], ['Newcomer', EMAIL.fresh]]);

    if (google) {
      // D-99 (W10-GOOGLE-DOORS-REST): the starting member's bound is proven on the Outlook source.
      await expectGoogleStartRefused(ID.reader);
    } else {
      const res = await agent().post(syncUrl).set('x-test-user', ID.reader);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body).toEqual(expect.objectContaining({ imported: 0, updated: 0, skipped: 3 }));
    }
    expect(await contactRow(priv.id)).toEqual(expect.objectContaining({ firstName: 'Private' }));
    expect(await contactRow(team.id)).toEqual(expect.objectContaining({ firstName: 'Team' }));
    expect(await db.contact.count({ where: { businessId: biz, emailNormalized: EMAIL.fresh } })).toBe(0);
    expect(await db.contactExternalMapping.count({ where: { businessId: biz } })).toBe(0);
    expect(await audits(priv.id)).toEqual([]);
    expect(await audits(team.id)).toEqual([]);
  });

  it('D-93: a sync with no request member (a system run) whose rules record no configuring member runs as the business owner: the owner\'s PRIVATE contact is written, and the owner is the recorded actor', async () => {
    const { priv, team } = await reseed(biz);
    remote([['Renamed', EMAIL.priv], ['Renamed', EMAIL.team]]);

    const out = await systemRun[route as 'contacts' | 'outlook-contacts'].sync(biz);
    expect(out).toEqual(expect.objectContaining({ updated: 2, skipped: 0 }));
    expect(await contactRow(priv.id)).toEqual(expect.objectContaining({ firstName: 'Renamed', tags: ['vip'] }));
    expect(await audits(priv.id)).toEqual([{ action: 'updated', actor: asUser(ID.owner) }]);
    expect(await audits(team.id)).toEqual([{ action: 'updated', actor: asUser(ID.owner) }]);
  });

  it('SEC-W6CTM-3: a sync creates no contact the CRM create door refuses: rules a crm read STAFF member saved create nothing, even when the owner runs the sync, and the new person is reported skipped', async () => {
    await reseed(biz);
    await agent().put(rulesUrl).set('x-test-user', ID.reader).send({ defaultTags: ['synced'] }).expect(200);
    remote([['Newcomer', EMAIL.fresh]]);

    const res = await agent().post(syncUrl).set('x-test-user', ID.owner);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ imported: 0, skipped: 1 }));
    expect(await db.contact.count({ where: { businessId: biz, emailNormalized: EMAIL.fresh } })).toBe(0);
    if (asyncWrites) await asyncWrites.drain();
    expect(await db.contactAuditEntry.count({ where: { businessId: biz } })).toBe(0);
  });

  it('CR-CTM-3 (D-99): a sync that skips a person its members may not write keeps the provider\'s sync token where it was, so a later run whose members may write them applies them (the provider sends a person again only from the earlier token); the first run, bounded by the crm write STAFF member who configured it, is started by that member on the Outlook source and by the owner on the Google Contacts source, whose sync only the owner starts', async () => {
    const { priv } = await reseed(biz);
    const tokenAfterRun1 = route === 'contacts'
      ? `${P}tok-after-run-1`
      : `https://graph.microsoft.com/v1.0/me/contacts/delta?$deltatoken=${P}after-run-1`;
    const storedToken = async () => {
      const row = await db.business.findUnique({ where: { id: biz }, select: { contactsSyncToken: true, msContactsDeltaLink: true } });
      return route === 'contacts' ? row.contactsSyncToken : row.msContactsDeltaLink;
    };
    await agent().put(rulesUrl).set('x-test-user', ID.staff).send({ defaultTags: [] }).expect(200);
    remote([['Renamed', EMAIL.priv]]);
    peopleNextSyncToken = `${P}tok-after-run-1`;
    graphDeltaLink = `https://graph.microsoft.com/v1.0/me/contacts/delta?$deltatoken=${P}after-run-1`;

    // D-99 (W10-GOOGLE-DOORS-REST): the owner starts the Google Contacts run; the configuring member still bounds it.
    const run1 = await agent().post(syncUrl).set('x-test-user', starter(ID.staff));
    expect(run1.status, JSON.stringify(run1.body)).toBe(201);
    expect(run1.body).toEqual(expect.objectContaining({ updated: 0, skipped: 1 }));
    expect(await storedToken()).toBeNull();

    // The owner takes the rules over and runs the sync: it reads from where run 1 started.
    await agent().put(rulesUrl).set('x-test-user', ID.owner).send({ defaultTags: [] }).expect(200);
    outbound.length = 0;
    const run2 = await agent().post(syncUrl).set('x-test-user', ID.owner);
    expect(run2.status, JSON.stringify(run2.body)).toBe(201);
    expect(outbound.length).toBeGreaterThan(0);
    expect(outbound.some((u) => u.includes(`${P}tok-after-run-1`) || u.includes(`${P}after-run-1`))).toBe(false);
    expect(run2.body).toEqual(expect.objectContaining({ updated: 1, skipped: 0 }));
    expect(await contactRow(priv.id)).toEqual(expect.objectContaining({ firstName: 'Renamed' }));
    expect(await db.contactExternalMapping.count({ where: { contactId: priv.id } })).toBe(1);
    // A run that skipped no one advances the token as before.
    expect(await storedToken()).toBe(tokenAfterRun1);
  });
});

describe('W6-CONNECT-TAG-MERGE (SEC-D92R-2): an Outlook tombstone', () => {
  const biz = ID.bizO;
  const rulesUrl = `/connect/businesses/${biz}/outlook-contacts/mapping-rules`;
  const syncUrl = `/connect/businesses/${biz}/outlook-contacts/sync`;

  beforeAll(async () => {
    // SEC-W6CTM-1: a STAFF member who may edit every contact but delete none
    // (crm write, crm_delete none), in this business only.
    await db.user.create({ data: { id: ID.noDelete, email: `${P}nodelete@test.local`, role: 'USER' } });
    await db.membership.create({
      data: { id: `${P}m_nodelete_${biz}`, userId: ID.noDelete, businessId: biz, role: 'STAFF', permissionScopes: { crm: 'write', crm_delete: 'none' } },
    });
  });

  /** A live TEAM contact `ownerId` owns. */
  function ownedContact(suffix: string, ownerId: string) {
    const email = `${P}${suffix}@test.local`;
    return db.contact.create({
      data: { id: `${biz}_${suffix}`, businessId: biz, firstName: 'Owned', visibility: 'TEAM', ownerId, email, emailNormalized: email, status: 'CLIENT' },
    });
  }

  /** Link each contact to a Graph id and have Graph answer with a tombstone for each. */
  async function tombstones(contactIds: string[]) {
    for (const contactId of contactIds) {
      await db.contactExternalMapping.create({
        data: { id: `${P}map_${contactId}`, businessId: biz, contactId, source: 'outlook_contacts', externalId: `${P}graph_${contactId}` },
      });
    }
    graphContacts = contactIds.map((contactId) => ({ id: `${P}graph_${contactId}`, '@removed': { reason: 'deleted' } }));
  }

  it('SEC-W6CTM-1: a tombstone deletes a linked contact only through the CRM delete door for the member who runs the sync (delete scope plus visibility): a crm write STAFF member (delete scope owned) deletes the TEAM contact they own, while the owner\'s TEAM contact they may edit but not delete and the owner\'s PRIVATE contact they cannot open stay live and linked, reported skipped', async () => {
    const { priv, team } = await reseed(biz);
    const own = await ownedContact('own', ID.staff);
    await agent().put(rulesUrl).set('x-test-user', ID.staff).send({ defaultTags: [] }).expect(200);
    await tombstones([priv.id, team.id, own.id]);

    const res = await agent().post(syncUrl).set('x-test-user', ID.staff);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ deleted: 1, skipped: 2 }));
    for (const kept of [priv.id, team.id]) {
      expect((await rawContact(kept))?.deleted_at, kept).toBeNull();
      expect(await db.contactExternalMapping.count({ where: { contactId: kept } }), kept).toBe(1);
      expect(await audits(kept), kept).toEqual([]);
      expect(await events(kept, 'contact.deleted'), kept).toEqual([]);
    }
    expect((await rawContact(own.id))?.deleted_at).toBeInstanceOf(Date);
    expect(await db.contactExternalMapping.count({ where: { contactId: own.id } })).toBe(0);
    expect(await audits(own.id)).toEqual([{ action: 'deleted', actor: asUser(ID.staff) }]);
    expect(await events(own.id, 'contact.deleted')).toEqual([{ actorType: 'USER', actorId: ID.staff }]);
  });

  it('SEC-W6CTM-1: a member whose delete scope is none (crm write, crm_delete none) deletes no contact through a tombstone, not even one they own, as DELETE contacts/:id refuses them', async () => {
    await reseed(biz);
    const own = await ownedContact('nodel', ID.noDelete);
    await agent().put(rulesUrl).set('x-test-user', ID.noDelete).send({ defaultTags: [] }).expect(200);
    await tombstones([own.id]);

    const res = await agent().post(syncUrl).set('x-test-user', ID.noDelete);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ deleted: 0, skipped: 1 }));
    expect((await rawContact(own.id))?.deleted_at).toBeNull();
    expect(await audits(own.id)).toEqual([]);
  });

  it('D-93: a tombstone in a system run of rules no member saved deletes the owner\'s PRIVATE contact as the business owner', async () => {
    const { priv } = await reseed(biz);
    await tombstones([priv.id]);

    const out = await systemRun['outlook-contacts'].sync(biz);
    expect(out).toEqual(expect.objectContaining({ deleted: 1, skipped: 0 }));
    expect((await rawContact(priv.id))?.deleted_at).toBeInstanceOf(Date);
    expect(await audits(priv.id)).toEqual([{ action: 'deleted', actor: asUser(ID.owner) }]);
  });

  it('CR-CTM-2: a tombstone for a contact already in the trash drops its link and counts it deleted without writing the contact (its trash date stays), so a contact restored from the trash is not left linked to a removed Outlook contact', async () => {
    const { team } = await reseed(biz);
    const trashedAt = new Date('2026-01-02T03:04:05.000Z');
    await db.$executeRawUnsafe(`UPDATE contacts SET deleted_at = $2 WHERE id = $1`, team.id, trashedAt);
    await tombstones([team.id]);

    const res = await agent().post(syncUrl).set('x-test-user', ID.owner);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ deleted: 1, skipped: 0 }));
    expect(await db.contactExternalMapping.count({ where: { contactId: team.id } })).toBe(0);
    expect((await rawContact(team.id))?.deleted_at?.toISOString()).toBe(trashedAt.toISOString());
    expect(await audits(team.id)).toEqual([]);
  });
});

describe('W6-CONNECT-TAG-MERGE (SEC-D92R-2, D-93): the connector form backfill', () => {
  const biz = ID.bizF;
  const mappingUrl = `/connect/businesses/${biz}/connector-forms/typeform/form-ext/mapping`;
  const fieldMappings = [
    { questionId: 'q-email', crmField: 'email' },
    { questionId: 'q-tag', crmField: 'tag' },
  ];

  /** The Typeform lead form and three submissions: linked to the PRIVATE contact, linked to the TEAM contact, and a new person. */
  async function seedForm(priv: { id: string }, team: { id: string }) {
    const form = await db.leadForm.create({
      data: { id: `${P}form`, businessId: biz, name: 'Intake', fields: [], embedCode: 'typeform:form-ext' },
    });
    const submission = (suffix: string, data: Record<string, string>, contactId: string | null) =>
      db.leadFormSubmission.create({ data: { id: `${P}sub_${suffix}`, businessId: biz, formId: form.id, data, contactId } });
    await submission('priv', { 'q-email': EMAIL.priv, 'q-tag': 'hot' }, priv.id);
    await submission('team', { 'q-email': EMAIL.team, 'q-tag': 'hot' }, team.id);
    await submission('fresh', { 'q-email': EMAIL.fresh, 'q-tag': 'hot' }, null);
    return form;
  }

  it('SEC-D92R-2: a backfill whose mapping a crm write STAFF member saved leaves the tags of the owner\'s PRIVATE contact a submission is linked to unchanged and reports it skipped; the TEAM contact gains the tags and the contact it creates, each with that member recorded as the actor', async () => {
    const { priv, team } = await reseed(biz);
    const form = await seedForm(priv, team);
    await agent().post(mappingUrl).set('x-test-user', ID.staff).send({ fieldMappings, defaultTags: ['web'] }).expect(201);

    const res = await agent().post(`/connect/businesses/${biz}/connector-forms/typeform/${form.id}/backfill`).set('x-test-user', ID.staff);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({ responsesProcessed: 2, responsesSkipped: 1, contactsCreated: 1, errors: [] });

    expect(await contactRow(priv.id)).toEqual(expect.objectContaining({ tags: ['vip'], status: 'CLIENT' }));
    expect(await events(priv.id, 'bulk.updated')).toEqual([]);
    expect(await audits(priv.id)).toEqual([]);

    expect(await contactRow(team.id)).toEqual(expect.objectContaining({ tags: ['old', 'web', 'hot'], status: 'CLIENT' }));
    expect(await events(team.id, 'bulk.updated')).toEqual([{ actorType: 'USER', actorId: ID.staff }]);
    expect(await audits(team.id)).toEqual([{ action: 'bulk_updated', actor: asUser(ID.staff) }]);

    const created = await db.contact.findFirst({ where: { businessId: biz, emailNormalized: EMAIL.fresh } });
    expect(created).toEqual(expect.objectContaining({ source: 'connector_form', tags: ['web', 'hot'] }));
    expect(await events(created.id, 'contact.created')).toEqual([{ actorType: 'USER', actorId: ID.staff }]);
    expect(await audits(created.id)).toEqual([{ action: 'created', actor: asUser(ID.staff) }]);

    // The skipped submission is not marked processed: it stays pending.
    const listed = await agent().get(`/connect/businesses/${biz}/connector-forms/typeform`).set('x-test-user', ID.staff);
    expect(listed.body).toEqual([expect.objectContaining({ leadFormId: form.id, submissionCount: 3, processedCount: 2, pendingCount: 1 })]);
  });

  it('SEC-D92R-2: a backfill whose mapping a crm read STAFF member saved merges tags into no contact (that member may edit none, the CRM edit rule) and reports each linked submission skipped', async () => {
    const { priv, team } = await reseed(biz);
    const form = await seedForm(priv, team);
    await agent().post(mappingUrl).set('x-test-user', ID.reader).send({ fieldMappings, defaultTags: ['web'], autoCreate: false }).expect(201);

    const res = await agent().post(`/connect/businesses/${biz}/connector-forms/typeform/${form.id}/backfill`).set('x-test-user', ID.owner);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ responsesSkipped: 2, contactsCreated: 0, errors: [] }));
    expect(await contactRow(priv.id)).toEqual(expect.objectContaining({ tags: ['vip'] }));
    expect(await contactRow(team.id)).toEqual(expect.objectContaining({ tags: ['old'] }));
    expect(await audits(team.id)).toEqual([]);
  });

  /** A mapping saved before W6: it records no configuring member. */
  function legacyMapping(extra: Record<string, unknown> = {}) {
    return db.connectorStatus.create({
      data: {
        id: `${P}cs_typeform`,
        businessId: biz,
        connectorType: 'typeform',
        status: 'connected',
        metadata: { formMappings: { 'form-ext': { formId: 'form-ext', fieldMappings, defaultTags: ['web'], autoCreate: false, ...extra } } },
      },
    });
  }

  it('SEC-W6CTM-2 (D-93): a backfill of a mapping that records no configuring member runs as the member who starts it, not as the owner: a crm write STAFF member\'s run leaves the owner\'s PRIVATE contact\'s tags unchanged (its submission stays pending) and merges into the TEAM contact as that member', async () => {
    const { priv, team } = await reseed(biz);
    const form = await seedForm(priv, team);
    await legacyMapping();

    const res = await agent().post(`/connect/businesses/${biz}/connector-forms/typeform/${form.id}/backfill`).set('x-test-user', ID.staff);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({ responsesProcessed: 2, responsesSkipped: 1, contactsCreated: 0, errors: [] });
    expect(await contactRow(priv.id)).toEqual(expect.objectContaining({ tags: ['vip'] }));
    expect(await audits(priv.id)).toEqual([]);
    expect(await contactRow(team.id)).toEqual(expect.objectContaining({ tags: ['old', 'web', 'hot'] }));
    expect(await events(team.id, 'bulk.updated')).toEqual([{ actorType: 'USER', actorId: ID.staff }]);
    expect(await audits(team.id)).toEqual([{ action: 'bulk_updated', actor: asUser(ID.staff) }]);
  });

  it('D-93: a backfill with no request member (a system run) of a mapping that records no configuring member runs as the business owner: the owner\'s PRIVATE contact gains the tags, and the owner is the recorded actor', async () => {
    const { priv, team } = await reseed(biz);
    const form = await seedForm(priv, team);
    await legacyMapping();

    const out = await systemRun.forms.backfill(biz, 'typeform', form.id);
    expect(out).toEqual(expect.objectContaining({ responsesProcessed: 3, responsesSkipped: 0, errors: [] }));
    expect(await contactRow(priv.id)).toEqual(expect.objectContaining({ tags: ['vip', 'web', 'hot'] }));
    expect(await events(priv.id, 'bulk.updated')).toEqual([{ actorType: 'USER', actorId: ID.owner }]);
    expect(await audits(priv.id)).toEqual([{ action: 'bulk_updated', actor: asUser(ID.owner) }]);
    expect(await audits(team.id)).toEqual([{ action: 'bulk_updated', actor: asUser(ID.owner) }]);
  });

  it('CR-CTM-1: a backfill marks a submission linked to a trashed contact processed without writing that contact (it is no live contact of this business), so a later backfill does not report it again and the form shows nothing pending', async () => {
    const { priv, team } = await reseed(biz);
    const form = await seedForm(priv, team);
    await legacyMapping();
    await db.$executeRawUnsafe(`UPDATE contacts SET deleted_at = now() WHERE id = $1`, team.id);

    const res = await agent().post(`/connect/businesses/${biz}/connector-forms/typeform/${form.id}/backfill`).set('x-test-user', ID.owner);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({ responsesProcessed: 3, responsesSkipped: 0, contactsCreated: 0, errors: [] });
    expect((await rawContact(team.id))?.tags).toEqual(['old']);
    expect(await audits(team.id)).toEqual([]);

    const listed = await agent().get(`/connect/businesses/${biz}/connector-forms/typeform`).set('x-test-user', ID.owner);
    expect(listed.body).toEqual([expect.objectContaining({ leadFormId: form.id, submissionCount: 3, processedCount: 3, pendingCount: 0 })]);
  });

  it('SEC-W6CTM-3: a backfill creates no contact the CRM create door refuses: a mapping a crm read STAFF member saved creates nothing, even when the owner runs it, and the new person\'s submission stays pending', async () => {
    const { priv, team } = await reseed(biz);
    const form = await seedForm(priv, team);
    await agent().post(mappingUrl).set('x-test-user', ID.reader).send({ fieldMappings, defaultTags: ['web'], autoCreate: true }).expect(201);

    const res = await agent().post(`/connect/businesses/${biz}/connector-forms/typeform/${form.id}/backfill`).set('x-test-user', ID.owner);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({ responsesProcessed: 0, responsesSkipped: 3, contactsCreated: 0, errors: [] });
    expect(await db.contact.count({ where: { businessId: biz, emailNormalized: EMAIL.fresh } })).toBe(0);
    if (asyncWrites) await asyncWrites.drain();
    expect(await db.contactAuditEntry.count({ where: { businessId: biz } })).toBe(0);

    const listed = await agent().get(`/connect/businesses/${biz}/connector-forms/typeform`).set('x-test-user', ID.owner);
    expect(listed.body).toEqual([expect.objectContaining({ processedCount: 0, pendingCount: 3 })]);
  });
});
