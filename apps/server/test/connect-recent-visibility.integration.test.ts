/**
 * W7-RECENT-CONTACTS-VISIBILITY (REAL database): the recently synced Google and
 * Outlook contacts lists follow the rule GET contacts/:contactId applies (the
 * crm read gate, then the CRM visibility clause). The Google Suite auth URL
 * keeps the Gmail owner rule of R0-CMF5 (D-11); owner ruling D-99 then made
 * every Google consent the owner's (review CR-RCV-1, [V93E-B01], landed by
 * W8-GOOGLE-CONSENT-OWNER).
 *
 * The defects (residuals W6-CONNECT-TAG-MERGE recorded):
 *   - GET /connect/businesses/:b/contacts/recent and .../outlook-contacts/recent
 *     (ConnectController, GoogleContactsSyncService.getRecent and
 *     OutlookContactsSyncService.getRecent) list every contact linked to the
 *     provider, with its name, email, phone, company, status and tags, to any
 *     member of the business. So a STAFF member saw the owner's PRIVATE
 *     contacts there, which GET /crm/businesses/:b/contacts/:id and the CRM
 *     list hide from them (CONTACTS-v1 RECORD VISIBILITY: PRIVATE and
 *     staff-owned records obey the member's CRM visibility on every read path;
 *     the clause D-37 and D-64 apply to KEY and to commerce);
 *   - POST /connect/google-suite/businesses/:b/auth-url applies the Gmail owner
 *     rule (GMAIL_OWNER_ONLY, D-11) only when the consent asks for gmail, so
 *     any member may start a Google connection for the business's calendar,
 *     drive, forms, contacts or business profile. The packet asked for the
 *     owner rule on every consent; review CR-RCV-1 found that recorded D-94
 *     names Google Analytics and Search Console only, that R0-CMF5 review 2
 *     (CMF5R-2) deliberately lets a non-owner connect every service but gmail
 *     (the web key-connect sign-in retries without gmail on GMAIL_OWNER_ONLY),
 *     and SEC-W7RCV-2 / CR-RCV-2 that GET /bookings/businesses/:b/calendar/
 *     auth-url and GET /drive/businesses/:b/auth-url give any member a Google
 *     consent URL anyway. So that change was held for an owner ruling; D-99
 *     settled it and W8-GOOGLE-CONSENT-OWNER landed it on this door and those
 *     two ([V93E-B01]; the bookings and drive doors in
 *     google-consent-owner.integration.test.ts).
 *
 * The contract proven here:
 *   - each recent list is refused (403) to a member GET contacts/:contactId
 *     refuses by its crm read gate (ModuleScopeGuard + RequireModuleScope('crm',
 *     'read'): a scope map with no crm key, or crm none, even with a contact
 *     shared to them; review SEC-W7RCV-1), and otherwise holds only the linked
 *     contacts the caller may open by that route's visibility rule
 *     (resolveCrmAccess + visibilityClause: a view-all member sees TEAM and
 *     SHARED contacts, their own and those shared with them; a member without
 *     view-all, crm_view owned, only their own and those shared with them); the
 *     owner and a SUPER_ADMIN see every linked contact, as before;
 *   - the Google Suite auth URL refuses a consent with gmail (or the default
 *     set) to anyone but the business owner (OWNER membership,
 *     Business.ownerId) or a SUPER_ADMIN: 403 GMAIL_OWNER_ONLY, no Google URL;
 *     since D-99 a consent without gmail is refused them the same way (403
 *     GOOGLE_CONNECT_OWNER_ONLY); the owner, the distinguished owner and a
 *     SUPER_ADMIN get a consent without gmail.
 *
 * Nothing on the authorization or persistence path is mocked: PrismaService,
 * the user, business, membership, contact, share and external mapping rows,
 * AuthGuard, BusinessGuard, ModuleScopeGuard, ConnectController,
 * GoogleContactsSyncService and
 * OutlookContactsSyncService (getRecent), GoogleSuiteController,
 * GoogleSuiteService (buildAuthUrl, with a fake OAuth client id and state
 * secret) and the commerce GmailService (the owner rule) are real against
 * DATABASE_URL. The stand-ins: identity attachment (a test middleware reads
 * `x-test-user`, loads that seeded user row and attaches `{ id, email, role }`
 * as AuthMiddleware would after Supabase token verification); the sync
 * services' CRM and audit collaborators, never reached by getRecent; the
 * connector registry and activity services, never reached by buildAuthUrl; and
 * the connect controller's other collaborators. No provider is called.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v93e_` prefix and is
 * hard-deleted by raw SQL in beforeAll and afterAll. No $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000 });

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v93e_';

const ID = {
  owner: `${P}owner`, // OWNER of biz
  staff: `${P}staff`, // STAFF, crm write (view-all): opens TEAM contacts, not the owner's PRIVATE ones
  admin: `${P}admin`, // ADMIN, role defaults (crm admin, view-all), not the owner
  mybook: `${P}mybook`, // STAFF, crm write with crm_view owned: their own book only
  nocrm: `${P}nocrm`, // STAFF, an explicit scope map with no crm key (bookings write): no CRM access (SEC-W7RCV-1)
  crmnone: `${P}crmnone`, // STAFF, crm none, with the owner's PRIVATE c_shared shared to them (SEC-W7RCV-1)
  superAdmin: `${P}super`, // SUPER_ADMIN, no membership
  distOwner: `${P}distowner`, // Business.ownerId of bizDist, no membership row
  stranger: `${P}stranger`, // no membership anywhere
  biz: `${P}biz`,
  bizDist: `${P}bizdist`,
};

/** The linked contacts of biz (each linked to Google Contacts and to Outlook Contacts). */
const C = {
  priv: `${P}c_priv`, // the owner's PRIVATE contact, shared with nobody
  team: `${P}c_team`, // the owner's TEAM contact
  shared: `${P}c_shared`, // the owner's PRIVATE contact, shared with mybook and with crmnone
  mine: `${P}c_mine`, // mybook's own PRIVATE contact
};
const ALL_LINKED = [C.mine, C.priv, C.shared, C.team].sort();

const USERS = [ID.owner, ID.staff, ID.admin, ID.mybook, ID.nocrm, ID.crmnone, ID.superAdmin, ID.distOwner, ID.stranger];

/** The members of biz and the SUPER_ADMIN: each meets GET contacts/:contactId's crm read gate (A06). */
const GATED = [ID.owner, ID.staff, ID.admin, ID.mybook, ID.nocrm, ID.crmnone, ID.superAdmin];

/** The ConnectController handler of each recent list. */
const RECENT_HANDLER: Record<string, string> = { contacts: 'getContactsRecent', 'outlook-contacts': 'getOutlookRecent' };

// Obviously fake OAuth configuration (no real client id or secret).
const OAUTH_ENV: Record<string, string> = {
  GOOGLE_CLIENT_ID: `${P}fake-client-id`,
  GOOGLE_CLIENT_SECRET: `${P}fake-client-secret`,
  GOOGLE_STATE_SECRET: `${P}fake-state-secret`,
  GOOGLE_SUITE_REDIRECT_URI: 'http://localhost:3001/api/connect/google-suite/callback',
};
const OAUTH_KEYS = [...Object.keys(OAUTH_ENV), 'GOOGLE_REDIRECT_URI'];
const savedEnv: Record<string, string | undefined> = {};

let db: any;
let app: any;
let prismaService: any;
let ConnectControllerClass: any;
let CrmControllerClass: any;
let ModuleScopeGuardClass: any;
let ReflectorClass: any;
let GUARDS_METADATA_KEY: string;
let MODULE_SCOPE_METADATA_KEY: string;

async function cleanup() {
  // Hard-delete via raw SQL (bypasses the soft-delete extension), children first.
  for (const sql of [
    `DELETE FROM contact_external_mappings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_shares WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

beforeAll(async () => {
  for (const key of OAUTH_KEYS) savedEnv[key] = process.env[key];
  delete process.env.GOOGLE_REDIRECT_URI;
  Object.assign(process.env, OAUTH_ENV);

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard, MODULE_SCOPE_KEY } = await import('../src/core/auth/module-scope.guard');
  const { Reflector } = await import('@nestjs/core');
  const { GUARDS_METADATA } = await import('@nestjs/common/constants');
  const { ConnectController } = await import('../src/modules/connect/connect.controller');
  // Imported for its handler metadata only (the crm read gate of GET contacts/:contactId).
  const { CrmController } = await import('../src/modules/crm/crm.controller');
  ConnectControllerClass = ConnectController;
  CrmControllerClass = CrmController;
  ModuleScopeGuardClass = ModuleScopeGuard;
  ReflectorClass = Reflector;
  GUARDS_METADATA_KEY = GUARDS_METADATA;
  MODULE_SCOPE_METADATA_KEY = MODULE_SCOPE_KEY;
  const { GoogleContactsSyncService } = await import('../src/modules/connect/google-contacts-sync.service');
  const { OutlookContactsSyncService } = await import('../src/modules/connect/outlook-contacts-sync.service');
  const { ConnectorFormMappingService } = await import('../src/modules/connect/connector-form-mapping.service');
  const { GoogleFormsMappingService } = await import('../src/modules/connect/google-forms-mapping.service');
  const { GoogleFormsService } = await import('../src/modules/connect/google-forms.service');
  const { ContactSyncService } = await import('../src/modules/connect/contact-sync.service');
  const { SignatureParserService } = await import('../src/modules/connect/signature-parser.service');
  const { GoogleBusinessProfileService } = await import('../src/modules/connect/google-business-profile.service');
  const { GoogleSuiteController } = await import('../src/core/connectors/google-suite.controller');
  const { GoogleSuiteService } = await import('../src/core/connectors/google-suite.service');
  const { ConnectorRegistryService } = await import('../src/core/connectors/connector-registry.service');
  const { ConnectorActivityService } = await import('../src/core/connectors/connector-activity.service');
  const { GmailService } = await import('../src/modules/commerce/gmail.service');

  // ---- the real HTTP path (wired before any row is seeded, so a wiring
  // fault is reported as itself and not as a seeding failure) -------------
  const moduleRef = await Test.createTestingModule({
    controllers: [ConnectController, GoogleSuiteController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      // The two sync services over the real PrismaService (getRecent reads
      // through it only); their CRM and audit collaborators are never reached.
      {
        provide: GoogleContactsSyncService,
        useFactory: (prisma: unknown) => new (GoogleContactsSyncService as any)(prisma, {}, {}),
        inject: [PrismaService],
      },
      {
        provide: OutlookContactsSyncService,
        useFactory: (prisma: unknown) => new (OutlookContactsSyncService as any)(prisma, {}, {}),
        inject: [PrismaService],
      },
      // The connect controller's other collaborators (routes not used here).
      { provide: ConnectorFormMappingService, useValue: {} },
      { provide: GoogleFormsMappingService, useValue: {} },
      { provide: GoogleFormsService, useValue: {} },
      { provide: ContactSyncService, useValue: {} },
      { provide: SignatureParserService, useValue: {} },
      { provide: GoogleBusinessProfileService, useValue: {} },
      // The Google Suite connect: real controller, GoogleSuiteService and the
      // commerce GmailService it resolves for the owner rule (no GmailConnector:
      // it is @Optional). The registry and activity services are never reached.
      GoogleSuiteService,
      GmailService,
      { provide: ConnectorRegistryService, useValue: {} },
      { provide: ConnectorActivityService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  prismaService = moduleRef.get(PrismaService);
  // Identity attachment only, for seeded v93e_ users. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  // Same filter and pipe as app-bootstrap.ts, so status codes and bodies are the production ones.
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup(); // in case a prior run aborted

  for (const id of USERS) {
    // User.email is globally unique: the literal starts with the suite prefix (ids are `${P}<name>`).
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: id === ID.superAdmin ? 'SUPER_ADMIN' : 'USER' } });
  }
  await db.business.create({ data: { id: ID.biz, name: 'V93E Biz', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizDist, name: 'V93E Dist Biz', ownerId: ID.distOwner } });
  const memberships: Array<[string, string, Record<string, string> | null]> = [
    [ID.owner, 'OWNER', null],
    [ID.staff, 'STAFF', { crm: 'write' }],
    [ID.admin, 'ADMIN', null],
    [ID.mybook, 'STAFF', { crm: 'write', crm_view: 'owned' }],
    [ID.nocrm, 'STAFF', { bookings: 'write' }],
    [ID.crmnone, 'STAFF', { crm: 'none' }],
  ];
  for (const [userId, role, permissionScopes] of memberships) {
    await db.membership.create({
      data: { id: `${P}m_${userId}`, userId, businessId: ID.biz, role, ...(permissionScopes ? { permissionScopes } : {}) },
    });
  }

  const contacts: Array<[string, string, 'PRIVATE' | 'TEAM', string]> = [
    [C.priv, 'Private', 'PRIVATE', ID.owner],
    [C.team, 'Team', 'TEAM', ID.owner],
    [C.shared, 'Shared', 'PRIVATE', ID.owner],
    [C.mine, 'Mine', 'PRIVATE', ID.mybook],
  ];
  for (const [id, firstName, visibility, ownerId] of contacts) {
    const email = `${id}@test.local`;
    await db.contact.create({
      data: { id, businessId: ID.biz, firstName, lastName: 'Linked', visibility, ownerId, email, emailNormalized: email, status: 'CLIENT', tags: ['synced'] },
    });
    for (const source of ['google_contacts', 'outlook_contacts']) {
      await db.contactExternalMapping.create({
        data: { id: `${P}map_${source}_${id}`, businessId: ID.biz, contactId: id, source, externalId: `${P}ext_${source}_${id}` },
      });
    }
  }
  await db.contactShare.create({
    data: { id: `${P}share_${C.shared}`, businessId: ID.biz, contactId: C.shared, userId: ID.mybook, createdBy: ID.owner },
  });
  await db.contactShare.create({
    data: { id: `${P}share_crmnone_${C.shared}`, businessId: ID.biz, contactId: C.shared, userId: ID.crmnone, createdBy: ID.owner },
  });
}, 120_000);

afterAll(async () => {
  if (db) await cleanup();
  if (app) await app.close();
  for (const key of OAUTH_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const agent = () => request(app.getHttpServer());

function as(req: any, actor: string | undefined) {
  return actor ? req.set('x-test-user', actor) : req;
}

/** The ids a recent list answers with, sorted. */
async function recentIds(route: string, actor: string | undefined): Promise<{ status: number; ids: string[]; body: any }> {
  const res = await as(agent().get(`/connect/businesses/${ID.biz}/${route}/recent`), actor);
  const ids = Array.isArray(res.body) ? res.body.map((row: { id: string }) => row.id).sort() : [];
  return { status: res.status, ids, body: res.body };
}

/**
 * Whether the real ModuleScopeGuard admits `actor` to GET
 * /crm/businesses/:b/contacts/:contactId: the guard evaluated on
 * CrmController.getContactDetail's own handler metadata (its
 * RequireModuleScope), for the request that route would get.
 */
async function contactDetailGateAdmits(actor: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: actor }, select: { id: true, email: true, role: true } });
  const req = { user: { id: user.id, email: user.email, role: user.role }, params: { businessId: ID.biz, contactId: C.team }, query: {}, body: {} };
  const context = {
    getHandler: () => CrmControllerClass.prototype.getContactDetail,
    getClass: () => CrmControllerClass,
    switchToHttp: () => ({ getRequest: () => req }),
  };
  const guard = new ModuleScopeGuardClass(prismaService, new ReflectorClass());
  try {
    return (await guard.canActivate(context)) === true;
  } catch {
    return false;
  }
}

function suiteAuthUrl(businessId: string, actor: string | undefined, body: Record<string, unknown>) {
  return as(agent().post(`/connect/google-suite/businesses/${businessId}/auth-url`), actor).send(body);
}

function expectOwnerOnly(res: { status: number; body: any }) {
  expect(res.status, JSON.stringify(res.body)).toBe(403);
  expect(res.body.code).toBe('GMAIL_OWNER_ONLY');
  expect(JSON.stringify(res.body)).not.toContain('accounts.google.com');
}

function expectAuthUrl(res: { status: number; body: any }, businessId: string, userId: string, services: string[]) {
  expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
  expect(res.body.services).toEqual(services);
  const url = new URL(res.body.authUrl);
  expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  // GoogleSuiteService.signState: base64 of `${JSON payload}.${hex HMAC}`.
  const decoded = Buffer.from(String(url.searchParams.get('state')), 'base64').toString('utf8');
  const claims = JSON.parse(decoded.slice(0, decoded.lastIndexOf('.')));
  expect(claims).toMatchObject({ businessId, userId, services, purpose: 'google-suite' });
}

const NON_GMAIL_CONSENTS: string[][] = [['calendar'], ['contacts'], ['drive', 'forms', 'business_profile']];

describe('W7-RECENT-CONTACTS-VISIBILITY fixture sanity (real rows)', () => {
  it('[V93E-X01] seeded one business with an owner, a view-all STAFF member, an ADMIN, a STAFF member without view-all and two STAFF members without CRM access (a scope map with no crm key; crm none with a contact shared to them), and four contacts each linked to Google and Outlook Contacts; by the GET contacts/:contactId visibility rule the STAFF member and the ADMIN cannot open the owner\'s PRIVATE contacts and the member without view-all opens only their own and the one shared with them; the two members without CRM access pass that visibility rule for the TEAM contact or the one shared with them, but the route\'s crm read gate (ModuleScopeGuard) refuses them (SEC-W7RCV-1)', async () => {
    const { assertContactVisible } = await import('../src/modules/crm/crm-permissions.helper');
    const prisma = { client: db } as any;
    expect(await db.membership.count({ where: { businessId: ID.biz } })).toBe(6);
    for (const source of ['google_contacts', 'outlook_contacts']) {
      expect(await db.contactExternalMapping.count({ where: { businessId: ID.biz, source } })).toBe(4);
    }
    const opens = async (member: string) => {
      const visible: string[] = [];
      for (const id of ALL_LINKED) {
        try { await assertContactVisible(prisma, ID.biz, id, member); visible.push(id); } catch { /* hidden */ }
      }
      return visible.sort();
    };
    expect(await opens(ID.owner)).toEqual(ALL_LINKED);
    expect(await opens(ID.staff)).toEqual([C.team]);
    expect(await opens(ID.admin)).toEqual([C.team]);
    expect(await opens(ID.mybook)).toEqual([C.mine, C.shared].sort());
    // resolveCrmAccess reads an absent crm key as read (view-all) for STAFF,
    // and crm none as "my book": the visibility rule alone would list these.
    expect(await opens(ID.nocrm)).toEqual([C.team]);
    expect(await opens(ID.crmnone)).toEqual([C.shared]);
    // GET contacts/:contactId's gate reads both maps as crm none: refused.
    expect(Reflect.getMetadata(MODULE_SCOPE_METADATA_KEY, CrmControllerClass.prototype.getContactDetail)).toEqual({ module: 'crm', minLevel: 'read' });
    for (const member of [ID.nocrm, ID.crmnone]) expect(await contactDetailGateAdmits(member), member).toBe(false);
    for (const member of [ID.owner, ID.staff, ID.admin, ID.mybook, ID.superAdmin]) expect(await contactDetailGateAdmits(member), member).toBe(true);
  });
});

describe.each([
  ['Google Contacts', 'contacts'],
  ['Outlook Contacts', 'outlook-contacts'],
])('W7-RECENT-CONTACTS-VISIBILITY (CRM visibility clause, as D-37 and D-64 apply it): the recently synced %s list', (_label, route) => {
  it('[V93E-A01] RED-BEFORE: a crm write STAFF member and an ADMIN (view-all, not the owner) are listed no PRIVATE linked contact they cannot open: only the owner\'s TEAM contact', async () => {
    for (const member of [ID.staff, ID.admin]) {
      const res = await recentIds(route, member);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.ids).toEqual([C.team]);
      expect(JSON.stringify(res.body)).not.toContain(`${C.priv}@test.local`);
    }
  });

  it('[V93E-A02] RED-BEFORE: a STAFF member without view-all (crm_view owned) is listed only their own book: the contact they own and the owner\'s PRIVATE contact shared with them; not the owner\'s TEAM or unshared PRIVATE contact', async () => {
    const res = await recentIds(route, ID.mybook);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.ids).toEqual([C.mine, C.shared].sort());
  });

  it('[V93E-A03] control: the owner and a SUPER_ADMIN with no membership are listed every linked contact, each with its external id and sync times', async () => {
    for (const actor of [ID.owner, ID.superAdmin]) {
      const res = await recentIds(route, actor);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.ids).toEqual(ALL_LINKED);
      const source = route === 'contacts' ? 'google_contacts' : 'outlook_contacts';
      const priv = res.body.find((row: { id: string }) => row.id === C.priv);
      expect(priv).toEqual(expect.objectContaining({ firstName: 'Private', externalId: `${P}ext_${source}_${C.priv}` }));
      expect(priv.syncedAt).toBeTruthy();
      expect(priv.firstSyncedAt).toBeTruthy();
    }
  });

  it('[V93E-A04] control: a user with no membership is refused by BusinessGuard (403) and an unauthenticated request by AuthGuard (401); neither is listed a contact', async () => {
    const stranger = await recentIds(route, ID.stranger);
    expect(stranger.status, JSON.stringify(stranger.body)).toBe(403);
    expect(stranger.ids).toEqual([]);
    const anonymous = await recentIds(route, undefined);
    expect(anonymous.status, JSON.stringify(anonymous.body)).toBe(401);
    expect(anonymous.ids).toEqual([]);
  });

  it('[V93E-A05] RED-BEFORE (SEC-W7RCV-1): a STAFF member whose scope map has no crm key (bookings write only) and a STAFF member with crm none (the owner\'s PRIVATE contact shared with them) are refused the list 403 by the crm read gate GET contacts/:contactId applies (ModuleScopeGuard, crm read); no contact is listed', async () => {
    for (const member of [ID.nocrm, ID.crmnone]) {
      const res = await recentIds(route, member);
      expect(res.status, `${member} ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.ids).toEqual([]);
      for (const id of ALL_LINKED) expect(JSON.stringify(res.body)).not.toContain(id);
    }
  });

  it('[V93E-A06] RED-BEFORE (SEC-W7RCV-1) parity: the list carries GET contacts/:contactId\'s crm read gate (ModuleScopeGuard with the same RequireModuleScope on the handler), and for every member and the SUPER_ADMIN it answers 200 exactly when the real ModuleScopeGuard admits them to GET /crm/businesses/:b/contacts/:contactId and 403 exactly when it refuses them', async () => {
    const handler = ConnectControllerClass.prototype[RECENT_HANDLER[route]];
    expect(Reflect.getMetadata(GUARDS_METADATA_KEY, handler) ?? []).toContain(ModuleScopeGuardClass);
    expect(Reflect.getMetadata(MODULE_SCOPE_METADATA_KEY, handler)).toEqual(
      Reflect.getMetadata(MODULE_SCOPE_METADATA_KEY, CrmControllerClass.prototype.getContactDetail),
    );
    for (const member of GATED) {
      const admits = await contactDetailGateAdmits(member);
      const res = await recentIds(route, member);
      expect(res.status, `${member} ${JSON.stringify(res.body)}`).toBe(admits ? 200 : 403);
    }
  });
});

describe('W7-RECENT-CONTACTS-VISIBILITY: starting a Google Suite connection keeps the Gmail owner rule (R0-CMF5, D-11); since owner ruling D-99 (W8-GOOGLE-CONSENT-OWNER) every other Google consent is the owner\'s too (CR-RCV-1)', () => {
  // Review CR-RCV-1, SEC-W7RCV-2 and CR-RCV-2, held for an owner ruling in W7:
  // owner ruling D-99 (W8-GOOGLE-CONSENT-OWNER) makes every Google connection
  // of a business (Calendar, Drive, Contacts, Gmail, Analytics, Search
  // Console) the business owner's to start, sync and disconnect. A consent
  // with gmail keeps its GMAIL_OWNER_ONLY refusal (R0-CMF5, B02); one without
  // gmail is refused GOOGLE_CONNECT_OWNER_ONLY. The bookings calendar and
  // drive consent URLs follow the same rule (google-consent-owner, V94D-A01,
  // V94D-B01). The web key-connect sign-in (core-channels-section.tsx) still
  // retries without gmail on GMAIL_OWNER_ONLY; the retry is now refused too and
  // its message is shown (web follow-up recorded by W8-GOOGLE-CONSENT-OWNER).
  it('[V93E-B01] RED-BEFORE (D-99, W8-GOOGLE-CONSENT-OWNER; CR-RCV-1): a crm write STAFF member and an ADMIN asking for a consent without gmail (calendar; contacts; drive, forms and business profile) are refused 403 GOOGLE_CONNECT_OWNER_ONLY, no Google URL', async () => {
    for (const member of [ID.staff, ID.admin]) {
      for (const services of NON_GMAIL_CONSENTS) {
        const res = await suiteAuthUrl(ID.biz, member, { services });
        expect(res.status, `${member} ${services.join(',')} ${JSON.stringify(res.body)}`).toBe(403);
        expect(res.body.code).toBe('GOOGLE_CONNECT_OWNER_ONLY');
        expect(JSON.stringify(res.body)).not.toContain('accounts.google.com');
      }
    }
  });

  it('[V93E-B02] control: a consent with gmail, or the default set (which includes gmail), is refused to the same members the same way (R0-CMF5, D-11)', async () => {
    for (const member of [ID.staff, ID.admin]) {
      expectOwnerOnly(await suiteAuthUrl(ID.biz, member, { services: ['gmail'] }));
      expectOwnerOnly(await suiteAuthUrl(ID.biz, member, {}));
    }
  });

  it('[V93E-B03] control: the owner and a SUPER_ADMIN with no membership get the Google URL for a consent without gmail; its state names them, the business and the services; the distinguished owner (Business.ownerId, no membership row) is refused by BusinessGuard (owner ruling D-104: 403, no URL)', async () => {
    for (const services of NON_GMAIL_CONSENTS) {
      expectAuthUrl(await suiteAuthUrl(ID.biz, ID.owner, { services }), ID.biz, ID.owner, services);
      expectAuthUrl(await suiteAuthUrl(ID.biz, ID.superAdmin, { services }), ID.biz, ID.superAdmin, services);
      const refused = await suiteAuthUrl(ID.bizDist, ID.distOwner, { services });
      expect(refused.status, JSON.stringify(refused.body)).toBe(403);
      expect(JSON.stringify(refused.body)).toContain('No access to this business');
      expect(JSON.stringify(refused.body)).not.toContain('accounts.google.com');
    }
  });

  it('[V93E-B04] control: a user with no membership is refused by BusinessGuard (403) and an unauthenticated request by AuthGuard (401); neither gets a URL', async () => {
    const stranger = await suiteAuthUrl(ID.biz, ID.stranger, { services: ['calendar'] });
    expect(stranger.status, JSON.stringify(stranger.body)).toBe(403);
    expect(JSON.stringify(stranger.body)).not.toContain('accounts.google.com');
    const anonymous = await suiteAuthUrl(ID.biz, undefined, { services: ['calendar'] });
    expect(anonymous.status, JSON.stringify(anonymous.body)).toBe(401);
    expect(JSON.stringify(anonymous.body)).not.toContain('accounts.google.com');
  });
});
