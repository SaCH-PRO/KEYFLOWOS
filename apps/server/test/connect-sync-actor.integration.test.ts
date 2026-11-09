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
 *     bound to the request, as V1-89 reads it). A configuration that records no
 *     member (saved before W6, or never saved) is the system's, and runs as the
 *     business owner (D-93's convention: Business.ownerId, read when it runs);
 *   - an existing contact is written only when the CRM's own write door lets
 *     that member write it (CrmService.assertCanEditContact for a sync,
 *     CrmService.bulkUpdateContacts' tag merge for a backfill: the GET detail
 *     visibility clause plus the member's edit scope). A contact they cannot
 *     open, or may not edit, is left exactly as it is and reported skipped;
 *   - every contact the sync or backfill writes (updated, created, deleted,
 *     tags merged) carries that member as the actor: a ContactAuditEntry with
 *     { type: USER, id }, and on the backfill's CRM doors the ContactEvent too.
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

/** What the stubbed provider APIs answer with on the next sync. */
let peopleConnections: Array<Record<string, unknown>> = [];
let graphContacts: Array<Record<string, unknown>> = [];
const outbound: string[] = [];
const fetchStub = vi.fn(async (url: string) => {
  const target = String(url);
  outbound.push(target);
  const body = target.startsWith('https://people.googleapis.com/')
    ? { connections: peopleConnections }
    : target.startsWith('https://graph.microsoft.com/')
      ? { value: graphContacts }
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

  it('SEC-D92R-2: a sync whose rules a crm write STAFF member saved leaves the owner\'s PRIVATE contact that member cannot open unchanged and reports it skipped; the TEAM contact it writes and the contact it creates record that member as the actor', async () => {
    const { priv, team } = await reseed(biz);
    await agent().put(rulesUrl).set('x-test-user', ID.staff).send({ defaultTags: ['synced'] }).expect(200);
    remote([['Renamed', EMAIL.priv], ['Renamed', EMAIL.team], ['Newcomer', EMAIL.fresh]]);

    const res = await agent().post(syncUrl).set('x-test-user', ID.staff);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ imported: 1, updated: 1, skipped: 1 }));

    // The PRIVATE contact is exactly as it was, and the sync did not link it.
    expect(await contactRow(priv.id)).toEqual(expect.objectContaining({ firstName: 'Private', tags: ['vip'], status: 'CLIENT' }));
    expect(await db.contactExternalMapping.count({ where: { contactId: priv.id } })).toBe(0);
    expect(await audits(priv.id)).toEqual([]);

    // The TEAM contact is written, and the configuring member is its actor.
    expect(await contactRow(team.id)).toEqual(expect.objectContaining({ firstName: 'Renamed', tags: ['old'] }));
    expect(await audits(team.id)).toEqual([{ action: 'updated', actor: asUser(ID.staff) }]);

    // So is the contact the sync creates.
    const created = await db.contact.findFirst({ where: { businessId: biz, emailNormalized: EMAIL.fresh } });
    expect(created).toEqual(expect.objectContaining({ firstName: 'Newcomer', source, tags: ['synced'] }));
    expect(await audits(created.id)).toEqual([{ action: 'created', actor: asUser(ID.staff) }]);
    expect(outbound.every((u) => u.startsWith('https://people.googleapis.com/') || u.startsWith('https://graph.microsoft.com/'))).toBe(true);
  });

  it('SEC-D92R-2: the configuring member is the member who saved the rules, whoever runs the sync: the owner running a sync a crm write STAFF member configured still leaves the PRIVATE contact unchanged', async () => {
    const { priv, team } = await reseed(biz);
    await agent().put(rulesUrl).set('x-test-user', ID.staff).send({ defaultTags: [] }).expect(200);
    remote([['Renamed', EMAIL.priv], ['Renamed', EMAIL.team]]);

    const res = await agent().post(syncUrl).set('x-test-user', ID.owner);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ updated: 1, skipped: 1 }));
    expect(await contactRow(priv.id)).toEqual(expect.objectContaining({ firstName: 'Private' }));
    expect(await audits(team.id)).toEqual([{ action: 'updated', actor: asUser(ID.staff) }]);
  });

  it('SEC-D92R-2: a sync whose rules a crm read STAFF member saved writes no existing contact (that member may edit none, the CRM edit rule) and reports both skipped', async () => {
    const { priv, team } = await reseed(biz);
    await agent().put(rulesUrl).set('x-test-user', ID.reader).send({ defaultTags: [] }).expect(200);
    remote([['Renamed', EMAIL.priv], ['Renamed', EMAIL.team]]);

    const res = await agent().post(syncUrl).set('x-test-user', ID.reader);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ updated: 0, skipped: 2 }));
    expect(await contactRow(priv.id)).toEqual(expect.objectContaining({ firstName: 'Private' }));
    expect(await contactRow(team.id)).toEqual(expect.objectContaining({ firstName: 'Team' }));
    expect(await audits(priv.id)).toEqual([]);
    expect(await audits(team.id)).toEqual([]);
  });

  it('D-93: a sync whose rules record no configuring member (never saved, or saved before W6) runs as the business owner: the owner\'s PRIVATE contact is written, and the owner is the recorded actor', async () => {
    const { priv, team } = await reseed(biz);
    remote([['Renamed', EMAIL.priv], ['Renamed', EMAIL.team]]);

    const res = await agent().post(syncUrl).set('x-test-user', ID.staff);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ updated: 2, skipped: 0 }));
    expect(await contactRow(priv.id)).toEqual(expect.objectContaining({ firstName: 'Renamed', tags: ['vip'] }));
    expect(await audits(priv.id)).toEqual([{ action: 'updated', actor: asUser(ID.owner) }]);
    expect(await audits(team.id)).toEqual([{ action: 'updated', actor: asUser(ID.owner) }]);
  });
});

describe('W6-CONNECT-TAG-MERGE (SEC-D92R-2): an Outlook tombstone', () => {
  const biz = ID.bizO;

  it('SEC-D92R-2: a tombstone for a contact the configuring crm write STAFF member cannot open does not delete it and is reported skipped; one for a contact they may edit deletes it with that member recorded as the actor', async () => {
    const { priv, team } = await reseed(biz);
    await agent().put(`/connect/businesses/${biz}/outlook-contacts/mapping-rules`).set('x-test-user', ID.staff).send({ defaultTags: [] }).expect(200);
    for (const [contactId, externalId] of [[priv.id, `${P}graph-priv`], [team.id, `${P}graph-team`]]) {
      await db.contactExternalMapping.create({ data: { id: `${P}map_${contactId}`, businessId: biz, contactId, source: 'outlook_contacts', externalId } });
    }
    graphContacts = [
      { id: `${P}graph-priv`, '@removed': { reason: 'deleted' } },
      { id: `${P}graph-team`, '@removed': { reason: 'deleted' } },
    ];

    const res = await agent().post(`/connect/businesses/${biz}/outlook-contacts/sync`).set('x-test-user', ID.staff);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ deleted: 1, skipped: 1 }));
    expect((await rawContact(priv.id))?.deleted_at).toBeNull();
    expect(await db.contactExternalMapping.count({ where: { contactId: priv.id } })).toBe(1);
    expect(await audits(priv.id)).toEqual([]);
    expect((await rawContact(team.id))?.deleted_at).toBeInstanceOf(Date);
    expect(await audits(team.id)).toEqual([{ action: 'deleted', actor: asUser(ID.staff) }]);
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

  it('D-93: a backfill of a mapping that records no configuring member (saved before W6) runs as the business owner: the owner\'s PRIVATE contact gains the tags, and the owner is the recorded actor', async () => {
    const { priv, team } = await reseed(biz);
    const form = await seedForm(priv, team);
    await db.connectorStatus.create({
      data: {
        id: `${P}cs_typeform`,
        businessId: biz,
        connectorType: 'typeform',
        status: 'connected',
        metadata: { formMappings: { 'form-ext': { formId: 'form-ext', fieldMappings, defaultTags: ['web'], autoCreate: false } } },
      },
    });

    const res = await agent().post(`/connect/businesses/${biz}/connector-forms/typeform/${form.id}/backfill`).set('x-test-user', ID.staff);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ responsesProcessed: 3, responsesSkipped: 0, errors: [] }));
    expect(await contactRow(priv.id)).toEqual(expect.objectContaining({ tags: ['vip', 'web', 'hot'] }));
    expect(await events(priv.id, 'bulk.updated')).toEqual([{ actorType: 'USER', actorId: ID.owner }]);
    expect(await audits(priv.id)).toEqual([{ action: 'bulk_updated', actor: asUser(ID.owner) }]);
    expect(await audits(team.id)).toEqual([{ action: 'bulk_updated', actor: asUser(ID.owner) }]);
  });
});
