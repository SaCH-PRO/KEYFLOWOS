/**
 * SWEEP-P0-SCOPES round 3 class repair — CLASS A (an outbound send carries no more than its receiver
 * may read) and CLASS B (no member route writes, lifts or binds a provider credential without settings
 * admin or the owner rule), against a REAL database through the HTTP routes and the real event bus.
 *
 * CLASS A, WPH2-1 (the Outlook contacts push): every contact.updated reached
 * ContactSyncService.onContactUpdated -> pushLocalChange -> OutlookContactsSyncService.pushContact,
 * which PATCHed the contact's name, email, phone, company and job title to the Microsoft account in
 * the stored msContacts token. That account is whoever completed the Outlook consent, a settings
 * admin since SV-3, an ADMIN whose explicit map says crm none included (D-114). The callback recorded
 * no binder and the push checked no receiver: the owner's PRIVATE contacts, mapped by the owner's
 * routine sync, went to the binder's mailbox with every later edit. The census pinned the push as
 * safe (OUTBOUND_DESTINATIONS), so CEN-11 could not see it. The rule pinned here is the export
 * receiver rule webhooks and the integration pushes apply (round 2):
 *   - starting the Outlook consent needs, beside settings admin, crm read (assertMayBindExport,
 *     CONNECTOR_EXPORT_READS outlook_contacts); the signed state names the member who starts it;
 *   - the callback records that member as the account's binder (ConnectorStatus metadata.boundBy);
 *   - a push sends only a contact the binder may open (crm visibility: a PRIVATE contact only to its
 *     owner, an explicit share or the business owner); an account bound before binders were recorded
 *     is read as a non-owner's (TEAM and SHARED only); a binder who may no longer read crm stops it;
 *   - the sync links (and writes from the mailbox) only a contact the binder may open.
 *
 * CLASS A, WPH2-2 (a Drive share of a stored business file): POST .../files/:fileId/share ran
 * AuthGuard and BusinessGuard only and POSTed a Drive permission with the owner's Drive token (D-99),
 * any type ('anyone' included) and any role, so a STAFF member with every module none handed the
 * business's invoice PDF to an account of their own or to the public. The file ids were listed by the
 * open GET .../generated-documents. Now:
 *   - a share is the owner's (assertGoogleConnectOwner, D-99: every Google connection, and what it
 *     grants with the owner's token, is the owner's);
 *   - GET generated-documents lists a tracked document only to a member who reads its module
 *     (revenue for invoice, quote, payment, journal and report; expenses for expense).
 *
 * CLASS B, CB-1 (a lift of the admin's 'Disabled'): POST .../connections/:id/health-check ran
 * AuthGuard and BusinessGuard only and recomputed ChannelConnection.healthState from the token
 * facts, so any member lifted the 'Disabled' a settings admin had set (PATCH connections/:id, settings
 * admin since SV-2) back to 'Connected', and DeliveryQueueService sent from the sender again. Now the
 * route needs settings admin, and a health check keeps an admin's 'Disabled' (only PATCH lifts it).
 *
 * Nothing on the authorization or persistence path is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, the global ValidationPipe and GlobalHttpExceptionFilter, MicrosoftOAuthController
 * with MicrosoftOAuthService, GoogleDriveController with GoogleDriveService and
 * GeneratedDocumentService, CommunicationsController with ChannelConnectionService, and
 * ContactSyncService with OutlookContactsSyncService behind a real EventEmitter2, against
 * DATABASE_URL. The stand-ins: identity attachment (`x-test-user`, as AuthMiddleware attaches it); the
 * collaborators no case reaches (content, delivery and AI services, email, Google Contacts push);
 * CrmService's edit and create doors for the sync's own principals (the owner, who may edit every
 * contact: what is pinned is the binder rule the sync adds); and every outbound fetch, which is
 * recorded and answered locally (the Microsoft token exchange, Graph and Drive), so nothing leaves the
 * machine: a recorded request is what the server tried to send.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v99z_` prefix and is hard-deleted by raw SQL
 * (sqlLikePrefix) in beforeAll and afterAll. Cases tagged RED-BEFORE fail on the unmodified code.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v99z_';
const ID = {
  owner: `${P}owner`, // OWNER of bizA (its recorded owner)
  admin: `${P}admin`, // ADMIN of bizA, role defaults (settings admin, crm admin with view all, revenue admin)
  msAdmin: `${P}msAdmin`, // ADMIN, explicit { settings: admin, every other module none } (D-114)
  staffNone: `${P}staffNone`, // STAFF, explicit: every module none, settings none
  staffSetWrite: `${P}staffSetWrite`, // STAFF, explicit { settings: write }
  adminSetNone: `${P}adminSetNone`, // ADMIN, explicit { settings: none }
  adminArray: `${P}adminArray`, // ADMIN, stored scopes [] (every module none, SV-4)
  revReader: `${P}revReader`, // STAFF, explicit { revenue: read, expenses: none }
  bizA: `${P}bizA`,
  cPrivate: `${P}c_private`, // PRIVATE, owned by the owner
  cTeam: `${P}c_team`, // TEAM, owned by the owner
  conn: `${P}conn_email`,
  dest: `${P}dest_email`,
};
const EVERY_MODULE_NONE = {
  crm: 'none', revenue: 'none', bookings: 'none', projects: 'none', content: 'none', expenses: 'none', automations: 'none',
  storefront: 'none', ai: 'none', team: 'none', analytics: 'none', operations: 'none', connect: 'none',
};
const MICROSOFT_ENV: Record<string, string> = {
  MICROSOFT_CLIENT_ID: `${P}dummy-client-id`,
  MICROSOFT_CLIENT_SECRET: `${P}dummy-client-secret`,
  MICROSOFT_REDIRECT_URI: 'http://localhost:3000/api/connect/microsoft/callback',
  MICROSOFT_STATE_SECRET: `${P}dummy-state-secret-0123456789abcdef`,
  APP_URL: 'http://localhost:3000',
};
const PRIVATE_EMAIL = 'paula.private@client.example';
const TEAM_EMAIL = 'tom.team@client.example';

interface Outbound { url: string; method: string; headers: Record<string, string>; body: string }
const outbound: Outbound[] = [];
/** What the Graph delta page answers (the binder's mailbox), set per case. */
let mailbox: Array<Record<string, unknown>> = [];
let db: any;
let app: any;
let events: any;
let outlookSync: any;
const savedEnv: Record<string, string | undefined> = {};

async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_sync_audits WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_external_mappings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM generated_documents WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM channel_destinations WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM channel_connections WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM connector_statuses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

type Verb = 'get' | 'post' | 'patch' | 'delete';
function send(verb: Verb, url: string, actor: string | undefined, body?: unknown) {
  let r = (request(app.getHttpServer()) as any)[verb](url);
  if (actor) r = r.set('x-test-user', actor);
  return body === undefined ? r : r.send(body);
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The tap: every outbound request is recorded and answered here; nothing leaves the machine. */
async function tap(input: any, init?: any): Promise<Response> {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = String(v);
  const method = String(init?.method ?? 'GET');
  outbound.push({ url, method, headers, body: typeof init?.body === 'string' ? init.body : init?.body ? String(init.body) : '' });
  if (url.startsWith('https://login.microsoftonline.com/') && url.endsWith('/oauth2/v2.0/token')) {
    return json(200, { access_token: `${P}ms_access_of_binder`, refresh_token: `${P}ms_refresh_of_binder`, expires_in: 3600 });
  }
  if (url === 'https://graph.microsoft.com/v1.0/me') return json(200, { mail: 'binder.mailbox@test.local' });
  if (url.startsWith('https://graph.microsoft.com/v1.0/me/contacts?$top=1')) return json(200, { value: [] });
  if (url.startsWith('https://graph.microsoft.com/v1.0/me/contacts/delta')) {
    return json(200, { value: mailbox, '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/contacts/delta?$deltatoken=v99z' });
  }
  if (url.startsWith('https://graph.microsoft.com/v1.0/me/contacts/')) return json(200, {});
  if (url.startsWith('https://www.googleapis.com/drive/v3/files/') && url.includes('/permissions')) return json(200, { id: `${P}perm` });
  throw new Error(`v99z: no provider traffic (${method} ${url})`);
}

const graphWrites = () => outbound.filter((o) => o.url.startsWith('https://graph.microsoft.com/v1.0/me/contacts/') && o.method !== 'GET');
const driveGrants = () => outbound.filter((o) => o.url.includes('googleapis.com/drive/v3/files/') && o.url.includes('/permissions'));

async function connectorMeta(type: string): Promise<Record<string, unknown>> {
  const row = await db.connectorStatus.findUnique({ where: { businessId_connectorType: { businessId: ID.bizA, connectorType: type } }, select: { metadata: true } });
  return (row?.metadata as Record<string, unknown>) ?? {};
}

/** Binds Outlook as `actor` through the real routes: the consent URL, then the public callback with the state it signed. */
async function bindOutlookAs(actor: string) {
  const start = await send('get', `/connect/microsoft/businesses/${ID.bizA}/auth-url`, actor);
  expect(start.status, `${actor} starts the Outlook consent: ${JSON.stringify(start.body)}`).toBe(200);
  const state = new URL(start.body.authUrl).searchParams.get('state');
  const done = await send('get', `/connect/microsoft/callback?code=${P}code&state=${encodeURIComponent(state ?? '')}`, undefined);
  expect(done.status).toBe(302);
  expect(done.headers.location).toContain('microsoft=connected');
}

beforeAll(async () => {
  for (const [k, v] of Object.entries(MICROSOFT_ENV)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
  vi.spyOn(globalThis, 'fetch').mockImplementation(tap as any);
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { Logger, ValidationPipe } = await import('@nestjs/common');
  const { EventEmitterModule, EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { MicrosoftOAuthController } = await import('../src/modules/connect/microsoft-oauth.controller');
  const { MicrosoftOAuthService } = await import('../src/modules/connect/microsoft-oauth.service');
  const { ConnectorActivityService } = await import('../src/core/connectors/connector-activity.service');
  const { ContactSyncService } = await import('../src/modules/connect/contact-sync.service');
  const { OutlookContactsSyncService } = await import('../src/modules/connect/outlook-contacts-sync.service');
  const { GoogleContactsSyncService } = await import('../src/modules/connect/google-contacts-sync.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { ContactAuditService } = await import('../src/modules/crm/privacy/contact-audit.service');
  const { GoogleDriveController } = await import('../src/modules/google-drive/google-drive.controller');
  const { GoogleDriveService } = await import('../src/modules/google-drive/google-drive.service');
  const { GeneratedDocumentService } = await import('../src/modules/google-drive/generated-document.service');
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { CommunicationsController } = await import('../src/modules/communications/communications.controller');
  const { ChannelConnectionService } = await import('../src/modules/communications/channel-connection.service');
  const { OutboundContentService } = await import('../src/modules/communications/outbound-content.service');
  const { DeliveryQueueService } = await import('../src/modules/communications/delivery-queue.service');
  const { ContentAiService } = await import('../src/modules/communications/content-ai.service');

  Logger.overrideLogger(false);
  const moduleRef = await Test.createTestingModule({
    imports: [EventEmitterModule.forRoot({ wildcard: false })],
    controllers: [MicrosoftOAuthController, GoogleDriveController, CommunicationsController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      MicrosoftOAuthService,
      { provide: ConnectorActivityService, useValue: { record: async () => undefined } },
      // ContactSyncService injects by constructor type only, which this test build does not emit: the same three collaborators, given by hand.
      {
        provide: ContactSyncService,
        useFactory: (prisma: unknown, google: unknown, outlook: unknown) => new (ContactSyncService as any)(prisma, google, outlook),
        inject: [PrismaService, GoogleContactsSyncService, OutlookContactsSyncService],
      },
      OutlookContactsSyncService,
      { provide: GoogleContactsSyncService, useValue: { pushContact: async () => null, sync: async () => ({}) } },
      // The sync's own principals (the owner) may edit and create every contact; the binder rule is what is pinned.
      {
        provide: CrmService,
        useValue: {
          assertCanEditContact: async (businessId: string, contactId: string) => ({ reachableWhere: { id: contactId, businessId } }),
          assertCanCreateContacts: async () => undefined,
        },
      },
      { provide: ContactAuditService, useValue: { write: async () => undefined } },
      GoogleDriveService,
      GeneratedDocumentService,
      { provide: TransactionalEmailService, useValue: {} },
      ChannelConnectionService,
      { provide: OutboundContentService, useValue: {} },
      { provide: DeliveryQueueService, useValue: {} },
      { provide: ContentAiService, useValue: {} },
    ],
  }).compile();
  events = moduleRef.get(EventEmitter2);
  outlookSync = moduleRef.get(OutlookContactsSyncService);

  app = moduleRef.createNestApplication({ logger: false });
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup();
  for (const id of [ID.owner, ID.admin, ID.msAdmin, ID.staffNone, ID.staffSetWrite, ID.adminSetNone, ID.adminArray, ID.revReader]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V99Z Biz A', ownerId: ID.owner } });
  const member = (userId: string, role: string, permissionScopes?: unknown) =>
    db.membership.create({ data: { id: `${P}m_${userId.slice(P.length)}`, userId, businessId: ID.bizA, role, ...(permissionScopes !== undefined ? { permissionScopes } : {}) } });
  await member(ID.owner, 'OWNER');
  await member(ID.admin, 'ADMIN');
  await member(ID.msAdmin, 'ADMIN', { ...EVERY_MODULE_NONE, settings: 'admin' });
  await member(ID.staffNone, 'STAFF', { ...EVERY_MODULE_NONE, settings: 'none' });
  await member(ID.staffSetWrite, 'STAFF', { settings: 'write' });
  await member(ID.adminSetNone, 'ADMIN', { settings: 'none' });
  await member(ID.adminArray, 'ADMIN', []);
  await member(ID.revReader, 'STAFF', { ...EVERY_MODULE_NONE, settings: 'none', revenue: 'read', expenses: 'none' });
  await db.contact.create({
    data: {
      id: ID.cPrivate, businessId: ID.bizA, firstName: 'Paula', lastName: 'Private', email: PRIVATE_EMAIL, emailNormalized: PRIVATE_EMAIL,
      phone: '+18685550101', visibility: 'PRIVATE', ownerId: ID.owner, companyName: 'Paula Holdings',
    },
  });
  await db.contact.create({
    data: { id: ID.cTeam, businessId: ID.bizA, firstName: 'Tom', lastName: 'Team', email: TEAM_EMAIL, emailNormalized: TEAM_EMAIL, visibility: 'TEAM', ownerId: ID.owner },
  });
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

beforeEach(() => {
  outbound.length = 0;
  mailbox = [];
});

// ── CLASS A, WPH2-1: the Outlook contacts push ─────────────────────────────────────────────────

describe('CLASS A (WPH2-1): the Outlook account receives only what its binder may open', () => {
  async function resetOutlook() {
    await db.contactExternalMapping.deleteMany({ where: { businessId: ID.bizA } });
    await db.connectorStatus.deleteMany({ where: { businessId: ID.bizA, connectorType: 'outlook_contacts' } });
    await db.business.update({
      where: { id: ID.bizA },
      data: { msContactsAccessToken: null, msContactsRefreshToken: null, msContactsTokenExpiry: null, msContactsEmail: null, msContactsDeltaLink: null },
    });
  }
  async function mapBoth() {
    await db.contactExternalMapping.create({ data: { businessId: ID.bizA, contactId: ID.cPrivate, source: 'outlook_contacts', externalId: `${P}AAMk-paula` } });
    await db.contactExternalMapping.create({ data: { businessId: ID.bizA, contactId: ID.cTeam, source: 'outlook_contacts', externalId: `${P}AAMk-tom` } });
  }
  async function pushBoth() {
    await events.emitAsync('contact.updated', { businessId: ID.bizA, contact: { id: ID.cPrivate } });
    await events.emitAsync('contact.updated', { businessId: ID.bizA, contact: { id: ID.cTeam } });
  }

  it('[R3O-01] RED-BEFORE: an ADMIN whose map says crm none (settings admin, D-114) may not start the Outlook consent: the account receives contacts; 403 names the crm read, and no state is signed', async () => {
    await resetOutlook();
    const res = await send('get', `/connect/microsoft/businesses/${ID.bizA}/auth-url`, ID.msAdmin);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/crm read access \(you have none\)/);
    // staffNone is refused by settings admin first, as SV-3 pinned
    const staff = await send('get', `/connect/microsoft/businesses/${ID.bizA}/auth-url`, ID.staffNone);
    expect(staff.status).toBe(403);
    expect(JSON.stringify(staff.body)).toMatch(/settings requires admin/);
  });

  it('[R3O-02] RED-BEFORE: the callback records the member who started the consent as the account\'s binder (ConnectorStatus metadata.boundBy); the stored tokens are the binder\'s', async () => {
    await resetOutlook();
    await bindOutlookAs(ID.admin);
    const biz = await db.business.findUnique({ where: { id: ID.bizA }, select: { msContactsAccessToken: true, msContactsEmail: true } });
    expect(biz.msContactsAccessToken).toBe(`${P}ms_access_of_binder`);
    expect(biz.msContactsEmail).toBe('binder.mailbox@test.local');
    expect((await connectorMeta('outlook_contacts')).boundBy).toBe(ID.admin);
  });

  it('[R3O-03] RED-BEFORE: an edit of the owner\'s PRIVATE contact is not pushed to an account an ADMIN bound (view all opens TEAM, never another member\'s PRIVATE); the TEAM contact\'s edit is (control)', async () => {
    await resetOutlook();
    await bindOutlookAs(ID.admin);
    await mapBoth();
    outbound.length = 0;
    await pushBoth();
    const writes = graphWrites();
    expect(writes.map((w) => w.url).filter((u) => u.includes('AAMk-paula'))).toEqual([]);
    expect(JSON.stringify(writes)).not.toContain(PRIVATE_EMAIL);
    expect(writes.filter((w) => w.url.endsWith(`${P}AAMk-tom`) && w.method === 'PATCH').length).toBe(1);
    expect(writes.find((w) => w.url.endsWith(`${P}AAMk-tom`))?.headers.authorization).toBe(`Bearer ${P}ms_access_of_binder`);
  });

  it('[R3O-04] RED-BEFORE: an account bound before binders were recorded (no boundBy) is read as a non-owner\'s: the PRIVATE contact is not pushed, the TEAM contact is', async () => {
    await resetOutlook();
    await db.business.update({
      where: { id: ID.bizA },
      data: { msContactsAccessToken: `${P}ms_access_legacy`, msContactsRefreshToken: `${P}ms_refresh_legacy`, msContactsTokenExpiry: new Date(Date.now() + 3_600_000), msContactsEmail: 'legacy@test.local' },
    });
    await db.connectorStatus.create({ data: { businessId: ID.bizA, connectorType: 'outlook_contacts', status: 'connected' } });
    await mapBoth();
    await pushBoth();
    const writes = graphWrites();
    expect(writes.filter((w) => w.url.includes('AAMk-paula'))).toEqual([]);
    expect(writes.filter((w) => w.url.endsWith(`${P}AAMk-tom`)).length).toBe(1);
  });

  it('[R3O-05] RED-BEFORE: a binder who may no longer read crm (their map narrowed after binding) receives nothing', async () => {
    await resetOutlook();
    await bindOutlookAs(ID.admin);
    await mapBoth();
    await db.membership.update({ where: { userId_businessId: { userId: ID.admin, businessId: ID.bizA } }, data: { permissionScopes: { ...EVERY_MODULE_NONE, settings: 'admin' } } });
    try {
      outbound.length = 0;
      await pushBoth();
      expect(graphWrites()).toEqual([]);
    } finally {
      await db.membership.update({ where: { userId_businessId: { userId: ID.admin, businessId: ID.bizA } }, data: { permissionScopes: null } });
    }
  });

  it('[R3O-06] RED-BEFORE: the owner\'s routine sync does not link (or write from the mailbox into) a contact the binder may not open: the owner\'s PRIVATE contact stays unlinked and unchanged; the TEAM contact is linked', async () => {
    await resetOutlook();
    await bindOutlookAs(ID.admin);
    mailbox = [
      { id: `${P}AAMk-admin-paula`, givenName: 'Paula', surname: 'Private', emailAddresses: [{ address: PRIVATE_EMAIL }], companyName: 'Changed In Mailbox', lastModifiedDateTime: new Date(Date.now() + 60_000).toISOString() },
      { id: `${P}AAMk-admin-tom`, givenName: 'Tom', surname: 'Team', emailAddresses: [{ address: TEAM_EMAIL }], lastModifiedDateTime: new Date(Date.now() + 60_000).toISOString() },
    ];
    // the owner's routine sync: a run no member's request starts runs as the business owner (D-93, syncPrincipals), who may edit every contact
    await outlookSync.sync(ID.bizA);
    const maps = await db.contactExternalMapping.findMany({ where: { businessId: ID.bizA, source: 'outlook_contacts' }, select: { contactId: true, externalId: true } });
    expect(maps.map((m: any) => m.contactId)).not.toContain(ID.cPrivate);
    expect(maps.map((m: any) => m.contactId)).toContain(ID.cTeam);
    const paula = await db.contact.findUnique({ where: { id: ID.cPrivate }, select: { companyName: true } });
    expect(paula.companyName).toBe('Paula Holdings');
  });

  it('[R3O-07] the rule is the binder\'s view, not a ban (control): an account the owner bound (the owner opens every contact) receives the PRIVATE contact\'s edit and the TEAM contact\'s', async () => {
    await resetOutlook();
    await bindOutlookAs(ID.owner);
    expect((await connectorMeta('outlook_contacts')).boundBy).toBe(ID.owner);
    await mapBoth();
    outbound.length = 0;
    await pushBoth();
    expect(graphWrites().filter((w) => w.url.endsWith(`${P}AAMk-paula`) && w.method === 'PATCH').length).toBe(1);
    expect(graphWrites().filter((w) => w.url.endsWith(`${P}AAMk-tom`) && w.method === 'PATCH').length).toBe(1);
  });
});

// ── CLASS A, WPH2-2: a Drive share hands out a stored business file ────────────────────────────

describe('CLASS A (WPH2-2): a Drive share and the tracked documents list', () => {
  beforeAll(async () => {
    await db.business.update({
      where: { id: ID.bizA },
      data: { driveAccessToken: `${P}drive_access_of_owner`, driveRefreshToken: `${P}drive_refresh_of_owner`, driveTokenExpiry: new Date(Date.now() + 3_600_000), driveEmail: 'owner@test.local' },
    });
    await db.generatedDocument.createMany({
      data: [
        { id: `${P}gd_inv`, businessId: ID.bizA, entityType: 'invoice', entityId: `${P}inv1`, driveFileId: `${P}drive-file-INV-0001`, fileName: 'Invoice-INV-0001-Private-Client.pdf', mimeType: 'application/pdf', folderPath: 'Revenue/Invoices' },
        { id: `${P}gd_exp`, businessId: ID.bizA, entityType: 'expense', entityId: `${P}exp1`, driveFileId: `${P}drive-file-EXP-0001`, fileName: 'Expense-EXP-0001.pdf', mimeType: 'application/pdf', folderPath: 'Expenses' },
      ],
    });
  });

  const share = (actor: string, body: unknown) => send('post', `/drive/businesses/${ID.bizA}/files/${P}drive-file-INV-0001/share`, actor, body);

  it('[R3D-01] RED-BEFORE: a member who is not the owner may not share a file with the owner\'s Drive token, to the public or to an account of their own: 403 GOOGLE_CONNECT_OWNER_ONLY and nothing is sent to Drive (STAFF none, a settings admin ADMIN, a revenue reader)', async () => {
    for (const actor of [ID.staffNone, ID.admin, ID.revReader, ID.msAdmin]) {
      for (const body of [{ type: 'anyone', role: 'reader' }, { type: 'user', role: 'writer', emailAddress: 'staffnone.personal@attacker.example', sendNotification: false }]) {
        const res = await share(actor, body);
        expect(res.status, `${actor} ${JSON.stringify(body)}: ${JSON.stringify(res.body)}`).toBe(403);
        expect(JSON.stringify(res.body)).toMatch(/GOOGLE_CONNECT_OWNER_ONLY|owner/i);
      }
    }
    expect(driveGrants()).toEqual([]);
  });

  it('[R3D-02] the owner shares (control): the grant is sent with the owner\'s token', async () => {
    const res = await share(ID.owner, { type: 'user', role: 'reader', emailAddress: 'accountant@firm.example' });
    expect(res.status).toBe(201);
    expect(driveGrants().length).toBe(1);
    expect(driveGrants()[0].headers.authorization).toBe(`Bearer ${P}drive_access_of_owner`);
  });

  it('[R3D-03] RED-BEFORE: GET generated-documents lists a tracked document only to a member who reads its module: STAFF none sees none (and 403 when asking for invoices), a revenue reader sees the invoice and not the expense, the owner sees both', async () => {
    const none = await send('get', `/drive/businesses/${ID.bizA}/generated-documents`, ID.staffNone);
    expect(none.status).toBe(200);
    expect(none.body.map((d: any) => d.driveFileId)).toEqual([]);
    const asked = await send('get', `/drive/businesses/${ID.bizA}/generated-documents?entityType=invoice`, ID.staffNone);
    expect(asked.status).toBe(403);
    expect(JSON.stringify(asked.body)).toMatch(/revenue read access \(you have none\)/);
    const rev = await send('get', `/drive/businesses/${ID.bizA}/generated-documents`, ID.revReader);
    expect(rev.status).toBe(200);
    expect(rev.body.map((d: any) => d.entityType).sort()).toEqual(['invoice']);
    const owner = await send('get', `/drive/businesses/${ID.bizA}/generated-documents`, ID.owner);
    expect(owner.body.map((d: any) => d.entityType).sort()).toEqual(['expense', 'invoice']);
  });
});

// ── CLASS B, CB-1: the health check lifts an admin's 'Disabled' ─────────────────────────────────

describe('CLASS B (CB-1): a channel connection health check', () => {
  async function seedDisabled() {
    await db.channelDestination.deleteMany({ where: { businessId: ID.bizA } });
    await db.channelConnection.deleteMany({ where: { businessId: ID.bizA } });
    await db.channelConnection.create({
      data: { id: ID.conn, businessId: ID.bizA, provider: 'EMAIL', label: 'Owner sender', accountEmail: 'owner-sender@biz-a.example', token: `${P}sender_token`, healthState: 'Disabled', healthMessage: 'Sending paused by the owner' },
    });
    await db.channelDestination.create({ data: { id: ID.dest, connectionId: ID.conn, businessId: ID.bizA, platform: 'EMAIL', platformId: 'owner-sender@biz-a.example' } });
  }
  const check = (actor: string) => send('post', `/communications/businesses/${ID.bizA}/connections/${ID.conn}/health-check`, actor, {});

  it('[R3H-01] RED-BEFORE: a member without settings admin may not run it (STAFF none, STAFF settings write, ADMIN settings none, ADMIN []): 403 and the admin\'s Disabled stays', async () => {
    await seedDisabled();
    for (const actor of [ID.staffNone, ID.staffSetWrite, ID.adminSetNone, ID.adminArray, ID.revReader]) {
      const res = await check(actor);
      expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(JSON.stringify(res.body)).toMatch(/settings requires admin access/);
      const row = await db.channelConnection.findUnique({ where: { id: ID.conn }, select: { healthState: true, healthMessage: true } });
      expect(row).toEqual({ healthState: 'Disabled', healthMessage: 'Sending paused by the owner' });
    }
  });

  it('[R3H-02] RED-BEFORE: a settings admin\'s health check keeps an admin\'s Disabled (only PATCH connections/:id lifts it)', async () => {
    await seedDisabled();
    const res = await check(ID.admin);
    expect(res.status).toBe(201);
    expect(res.body.healthState).toBe('Disabled');
    const row = await db.channelConnection.findUnique({ where: { id: ID.conn }, select: { healthState: true } });
    expect(row.healthState).toBe('Disabled');
  });

  it('[R3H-03] a settings admin\'s health check still recomputes every other state from the token facts (control): Error -> Connected', async () => {
    await seedDisabled();
    await db.channelConnection.update({ where: { id: ID.conn }, data: { healthState: 'Error', healthMessage: 'stale' } });
    const res = await check(ID.owner);
    expect(res.status).toBe(201);
    expect(res.body.healthState).toBe('Connected');
    expect((await db.channelConnection.findUnique({ where: { id: ID.conn }, select: { healthState: true } })).healthState).toBe('Connected');
  });
});
