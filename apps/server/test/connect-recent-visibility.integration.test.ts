/**
 * W7-RECENT-CONTACTS-VISIBILITY (REAL database): the recently synced Google and
 * Outlook contacts lists follow the CRM visibility clause, and the Google Suite
 * auth URL follows the business owner rule (owner ruling D-94).
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
 *   - POST /connect/google-suite/businesses/:b/auth-url applied the Gmail owner
 *     rule (GMAIL_OWNER_ONLY, D-11) only when the consent asked for gmail, so
 *     any member could start a Google connection for the business's calendar,
 *     drive, forms, contacts or business profile. D-94 makes connecting the
 *     business's Google integrations the owner's alone (as Gmail): anyone else
 *     gets 403.
 *
 * The contract proven here:
 *   - each recent list holds only the linked contacts the caller may open by the
 *     rule GET contacts/:contactId applies (resolveCrmAccess + visibilityClause:
 *     a view-all member sees TEAM and SHARED contacts, their own and those
 *     shared with them; a member without view-all, crm_view owned, only their
 *     own and those shared with them); the owner and a SUPER_ADMIN see every
 *     linked contact, as before;
 *   - the Google Suite auth URL, for any set of services, is refused to anyone
 *     but the business owner (OWNER membership, Business.ownerId) or a
 *     SUPER_ADMIN: 403 GMAIL_OWNER_ONLY, no Google URL.
 *
 * Nothing on the authorization or persistence path is mocked: PrismaService,
 * the user, business, membership, contact, share and external mapping rows,
 * AuthGuard, BusinessGuard, ConnectController, GoogleContactsSyncService and
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
  shared: `${P}c_shared`, // the owner's PRIVATE contact, shared with mybook
  mine: `${P}c_mine`, // mybook's own PRIVATE contact
};
const ALL_LINKED = [C.mine, C.priv, C.shared, C.team].sort();

const USERS = [ID.owner, ID.staff, ID.admin, ID.mybook, ID.superAdmin, ID.distOwner, ID.stranger];

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
  const { ConnectController } = await import('../src/modules/connect/connect.controller');
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
  it('[V93E-X01] seeded one business with an owner, a view-all STAFF member, an ADMIN and a STAFF member without view-all, and four contacts each linked to Google and Outlook Contacts; by the GET contacts/:contactId rule the STAFF member and the ADMIN cannot open the owner\'s PRIVATE contacts, and the member without view-all opens only their own and the one shared with them', async () => {
    const { assertContactVisible } = await import('../src/modules/crm/crm-permissions.helper');
    const prisma = { client: db } as any;
    expect(await db.membership.count({ where: { businessId: ID.biz } })).toBe(4);
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
});

describe('W7-RECENT-CONTACTS-VISIBILITY (D-94): starting a Google Suite connection is OWNER only, whatever services it asks for', () => {
  it('[V93E-B01] RED-BEFORE: a crm write STAFF member and an ADMIN asking for a consent without gmail (calendar; contacts; drive, forms and business profile) are refused 403 GMAIL_OWNER_ONLY, no Google URL', async () => {
    for (const member of [ID.staff, ID.admin]) {
      for (const services of NON_GMAIL_CONSENTS) {
        expectOwnerOnly(await suiteAuthUrl(ID.biz, member, { services }));
      }
    }
  });

  it('[V93E-B02] control: a consent with gmail, or the default set (which includes gmail), is refused to the same members the same way (R0-CMF5, D-11)', async () => {
    for (const member of [ID.staff, ID.admin]) {
      expectOwnerOnly(await suiteAuthUrl(ID.biz, member, { services: ['gmail'] }));
      expectOwnerOnly(await suiteAuthUrl(ID.biz, member, {}));
    }
  });

  it('[V93E-B03] control: the owner, the distinguished owner (Business.ownerId, no membership row) and a SUPER_ADMIN with no membership get the Google URL for a consent without gmail; its state names them, the business and the services', async () => {
    for (const services of NON_GMAIL_CONSENTS) {
      expectAuthUrl(await suiteAuthUrl(ID.biz, ID.owner, { services }), ID.biz, ID.owner, services);
      expectAuthUrl(await suiteAuthUrl(ID.bizDist, ID.distOwner, { services }), ID.bizDist, ID.distOwner, services);
      expectAuthUrl(await suiteAuthUrl(ID.biz, ID.superAdmin, { services }), ID.biz, ID.superAdmin, services);
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
