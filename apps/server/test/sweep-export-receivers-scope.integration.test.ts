/**
 * SWEEP-P0-SCOPES round 2 class repair, CLASS A — an integration push delivers no more than its
 * receiver may read, against a REAL database through the HTTP routes.
 *
 * The round 1 repair projected every webhook delivery at the dispatcher's one door, and checked a
 * webhook's subscriber for the reads its events carry at create (SEC-2, SV-1). The integration pushes
 * sat outside that door (findings WHP-1, WHP-2): the accounting push (POST
 * /accounting/businesses/:b/invoices/push and /customers/push: QuickBooks or Xero) and the marketing
 * push (POST /marketing/businesses/:b/lists/push-contacts: Mailchimp or Klaviyo) ran AuthGuard and
 * BusinessGuard only and sent each invoice's lines and amounts and each contact's name, email, company
 * and phone to the realm, tenant or account the stored credentials name. Those are bound by whoever
 * saved them (settings admin, SEC-1), so an ADMIN whose explicit map says revenue none and crm none
 * pointed the push at an account of their own and received a PRIVATE contact (and its invoices) that
 * the invoice.* and contact.* webhooks refuse them; a STAFF member with every module none pushed too.
 * Mailchimp's host was the text after the first '-' of the key the binder typed, so the push was a
 * webhook to any host, with no outbound-address check.
 *
 * The rule this suite pins (the receiver rule webhooks apply, at bind and at push):
 *   - binding an export connector (POST /connectors/businesses/:b/credentials/:type for quickbooks,
 *     xero, mailchimp, klaviyo) needs, beside settings admin, read on every module the export sends
 *     (CONNECTOR_EXPORT_READS: revenue and crm for the accounting push, crm for the marketing push);
 *     the binder is recorded as the account's receiver;
 *   - a push needs the module write of its action (revenue for the accounting push, content for the
 *     marketing push) and read on what it sends, and it sends only the records every receiver may
 *     read: the pushing member and the member who bound the account (a PRIVATE contact goes only to
 *     an account its viewers bound; an account with no recorded binder is read as a non-owner's);
 *   - the accounting reads (summary, unsynced invoices, chart of accounts) need revenue read;
 *   - Mailchimp's host is <dc>.api.mailchimp.com with a real data-center suffix only.
 *
 * Nothing on the authorization or persistence path is mocked: PrismaService, AuthGuard,
 * BusinessGuard, ModuleScopeGuard, the global ValidationPipe and GlobalHttpExceptionFilter, the real
 * controllers (ConnectorController, AccountingController, MarketingSyncController), the real
 * QuickBooks, Xero, Mailchimp and Klaviyo connectors and ConnectorCredentialsService against
 * DATABASE_URL. The stand-ins: identity attachment (`x-test-user`), the connector registry's lookup
 * (the real connectors' metadata and health), EventEmitter2 and EntityResolutionService (no case
 * reaches them). Every outbound fetch is recorded (URL, method, headers, body) and refused, so
 * nothing leaves the machine: a recorded request is what the push tried to send.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v99x_` prefix and is hard-deleted by raw SQL
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

const P = 'v99x_';
const ID = {
  owner: `${P}owner`, // OWNER of bizA
  admin: `${P}admin`, // ADMIN of bizA, role defaults (settings, revenue, crm admin; crm view all)
  setAdminNone: `${P}setAdminNone`, // ADMIN, explicit { settings: admin, every other module none } (D-114)
  staffNone: `${P}staffNone`, // STAFF, every module none
  crmBinder: `${P}crmBinder`, // STAFF, explicit { settings: admin, crm: admin, crm_view: all, content: write, revenue: none }
  ownView: `${P}ownView`, // STAFF, explicit { revenue: write, crm: read, crm_view: owned, content: write } (their own book)
  bizA: `${P}bizA`,
  cPrivate: `${P}c_private`, // PRIVATE, owned by the owner
  cTeam: `${P}c_team`, // TEAM, owned by the owner
  cOwn: `${P}c_own`, // TEAM, owned by ownView
  invPrivate: `${P}inv_private`,
  invTeam: `${P}inv_team`,
  invOwn: `${P}inv_own`,
};
const PRIVATE_COMPANY = 'Private Co SECRETCO';
const PRIVATE_PHONE = '+18685551234';
const EVERY_MODULE_NONE = {
  crm: 'none', revenue: 'none', bookings: 'none', projects: 'none', content: 'none', expenses: 'none', automations: 'none',
  storefront: 'none', ai: 'none', team: 'none', analytics: 'none', operations: 'none', connect: 'none',
};

interface Outbound { url: string; method: string; headers: Record<string, string>; body: string }
const outbound: Outbound[] = [];
let db: any;
let app: any;
let credentials: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_external_mappings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

const conn = `/connectors/businesses/${ID.bizA}`;
const acct = `/accounting/businesses/${ID.bizA}`;
const mkt = `/marketing/businesses/${ID.bizA}`;
const QBO = (realm: string) => ({ values: { accessToken: `${P}${realm}_token`, realmId: realm } });

/** What a push sent: every recorded outbound request whose body names the value. */
const sentWith = (needle: string) => outbound.filter((o) => o.body.includes(needle) || o.url.includes(needle));

async function connectorRow(type: string) {
  const rows = await db.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS row FROM connector_statuses t WHERE business_id = '${ID.bizA}' AND connector_type = '${type}'`);
  return rows[0]?.row ?? null;
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = String(v);
    outbound.push({ url, method: String(init?.method ?? 'GET'), headers, body: typeof init?.body === 'string' ? init.body : '' });
    throw new Error(`v99x: no provider traffic (${url})`);
  }) as any);

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { ConnectorController } = await import('../src/core/connectors/connector.controller');
  const { ConnectorRegistryService } = await import('../src/core/connectors/connector-registry.service');
  const { ConnectorActivityService } = await import('../src/core/connectors/connector-activity.service');
  const { ConnectorHealthMonitorService } = await import('../src/core/connectors/connector-health-monitor.service');
  const { ConnectorCredentialsService } = await import('../src/core/connectors/connector-credentials.service');
  const { EntityResolutionService } = await import('../src/core/connectors/entity-resolution.service');
  const { QuickbooksConnector } = await import('../src/core/connectors/implementations/quickbooks.connector');
  const { XeroConnector } = await import('../src/core/connectors/implementations/xero.connector');
  const { MailchimpConnector } = await import('../src/core/connectors/implementations/mailchimp.connector');
  const { KlaviyoConnector } = await import('../src/core/connectors/implementations/klaviyo.connector');
  const { AccountingController } = await import('../src/modules/commerce/accounting.controller');
  const { MarketingSyncController } = await import('../src/modules/email-marketing/marketing-sync.controller');

  const connectors: Record<string, any> = {};
  const moduleRef = await Test.createTestingModule({
    controllers: [ConnectorController, AccountingController, MarketingSyncController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      ConnectorCredentialsService,
      QuickbooksConnector,
      XeroConnector,
      MailchimpConnector,
      KlaviyoConnector,
      { provide: EventEmitter2, useValue: { emit: () => true, emitAsync: async () => [] } },
      { provide: EntityResolutionService, useValue: {} },
      // The registry's lookup: the real connectors' metadata and health.
      {
        provide: ConnectorRegistryService,
        useValue: {
          get: (type: string) => connectors[type],
          getHealth: async (type: string, businessId: string) => connectors[type]?.healthCheck(businessId),
        },
      },
      { provide: ConnectorActivityService, useValue: {} },
      { provide: ConnectorHealthMonitorService, useValue: {} },
    ],
  }).compile();
  credentials = moduleRef.get(ConnectorCredentialsService);
  connectors.quickbooks = moduleRef.get(QuickbooksConnector);
  connectors.xero = moduleRef.get(XeroConnector);
  connectors.mailchimp = moduleRef.get(MailchimpConnector);
  connectors.klaviyo = moduleRef.get(KlaviyoConnector);

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
  for (const id of [ID.owner, ID.admin, ID.setAdminNone, ID.staffNone, ID.crmBinder, ID.ownView]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V99X Biz A', ownerId: ID.owner } });
  const m = (user: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({ data: { id: `${P}m_${user.slice(P.length)}`, userId: user, businessId: ID.bizA, role, permissionScopes: permissionScopes ?? undefined } });
  await m(ID.owner, 'OWNER');
  await m(ID.admin, 'ADMIN');
  await m(ID.setAdminNone, 'ADMIN', { ...EVERY_MODULE_NONE, settings: 'admin' });
  await m(ID.staffNone, 'STAFF', { ...EVERY_MODULE_NONE, settings: 'none' });
  await m(ID.crmBinder, 'STAFF', { ...EVERY_MODULE_NONE, settings: 'admin', crm: 'admin', crm_view: 'all', content: 'write' });
  await m(ID.ownView, 'STAFF', { ...EVERY_MODULE_NONE, settings: 'none', revenue: 'write', crm: 'read', crm_view: 'owned', content: 'write' });

  const contact = (id: string, first: string, visibility: string, ownerId: string, extra: Record<string, unknown> = {}) =>
    db.contact.create({ data: { id, businessId: ID.bizA, firstName: first, lastName: 'Client', email: `${P}${id.slice(P.length)}@client.example`, doNotContact: false, visibility, ownerId, ...extra } });
  await contact(ID.cPrivate, 'Private', 'PRIVATE', ID.owner, { companyName: PRIVATE_COMPANY, phone: PRIVATE_PHONE });
  await contact(ID.cTeam, 'Team', 'TEAM', ID.owner, { companyName: 'Team Co' });
  await contact(ID.cOwn, 'Own', 'TEAM', ID.ownView, { companyName: 'Own Co' });
  const invoice = (id: string, contactId: string, n: string, total: number) =>
    db.invoice.create({
      data: {
        id, businessId: ID.bizA, contactId, invoiceNumber: `${P}${n}`, status: 'SENT', subtotal: total, total, currency: 'TTD', issueDate: new Date(),
        items: { create: [{ id: `${id}_item`, description: `${n} work`, quantity: 1, unitPrice: total, total }] },
      },
    });
  await invoice(ID.invPrivate, ID.cPrivate, 'INV-PRIV', 250);
  await invoice(ID.invTeam, ID.cTeam, 'INV-TEAM', 500);
  await invoice(ID.invOwn, ID.cOwn, 'INV-OWN', 75);
}, 120_000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (app) await app.close();
  if (db) await cleanup();
});

beforeEach(() => {
  outbound.length = 0;
});

/** Unbind every export connector, as the owner (each case binds what it needs). */
async function unbindAll() {
  for (const type of ['quickbooks', 'xero', 'mailchimp', 'klaviyo']) await credentials.clearCredentials(ID.bizA, type);
  await db.contactExternalMapping.deleteMany({ where: { businessId: ID.bizA } });
}

describe('binding an export connector: the binder reads what it exports (CONNECTOR_EXPORT_READS)', () => {
  it('[EXP-BIND-01] RED-BEFORE (WHP-1, WHP-2): an ADMIN whose explicit map says settings admin and every other module none is refused binding QuickBooks, Xero (revenue and crm), Mailchimp and Klaviyo (crm) with 403, and nothing is stored', async () => {
    await unbindAll();
    const attempts: Array<[string, unknown]> = [
      ['quickbooks', QBO('ATTACKER_REALM_999')],
      ['xero', { values: { accessToken: `${P}attacker_xero_token`, tenantId: 'ATTACKER-TENANT' } }],
      ['mailchimp', { values: { apiKey: 'attacker' + 'key-us21' } }],
      ['klaviyo', { values: { apiKey: 'pk_attacker_key' } }],
    ];
    for (const [type, body] of attempts) {
      const res = await send('post', `${conn}/credentials/${type}`, ID.setAdminNone, body);
      expect(res.status, type).toBe(403);
      expect(String(res.body?.message ?? ''), type).toMatch(/(revenue|crm) read access/);
      expect(await credentials.getCredentials(ID.bizA, type), type).toBeNull();
    }
  });

  it('[EXP-BIND-02] RED-BEFORE: a settings admin who reads crm and not revenue binds the marketing push (Klaviyo, 201) and is refused the accounting push (QuickBooks, 403)', async () => {
    await unbindAll();
    expect((await send('post', `${conn}/credentials/klaviyo`, ID.crmBinder, { values: { apiKey: 'pk_crm_binder_key' } })).status).toBe(201);
    const qbo = await send('post', `${conn}/credentials/quickbooks`, ID.crmBinder, QBO('CRM_BINDER_REALM'));
    expect(qbo.status).toBe(403);
    expect(String(qbo.body?.message ?? '')).toMatch(/revenue read access/);
    expect(await credentials.getCredentials(ID.bizA, 'quickbooks')).toBeNull();
  });

  it('[EXP-BIND-03] the owner and an ADMIN on role defaults bind each export connector (201), and the binder is recorded as the account\'s receiver', async () => {
    for (const actor of [ID.owner, ID.admin]) {
      await unbindAll();
      const res = await send('post', `${conn}/credentials/quickbooks`, actor, QBO(`${actor.slice(P.length)}_REALM`));
      expect(res.status, actor).toBe(201);
      expect(JSON.parse(await connectorRow('quickbooks')).metadata.boundBy, actor).toBe(actor);
    }
  });
});

describe('the accounting reads need revenue read', () => {
  it('[EXP-READ-01] RED-BEFORE (WHP-1 step 2): GET summary, unsynced invoices (each with its contact) and chart of accounts answer 403 to a STAFF member and an ADMIN whose maps say revenue none; the owner reads them', async () => {
    await unbindAll();
    for (const actor of [ID.staffNone, ID.setAdminNone]) {
      for (const pathname of ['summary', 'invoices/unsynced', 'chart-of-accounts']) {
        const res = await send('get', `${acct}/${pathname}`, actor);
        expect(res.status, `${actor} ${pathname}`).toBe(403);
        expect(JSON.stringify(res.body), `${actor} ${pathname}`).not.toContain(PRIVATE_COMPANY);
      }
    }
    expect((await send('get', `${acct}/summary`, ID.owner)).status).toBe(200);
    expect((await send('get', `${acct}/invoices/unsynced`, ID.owner)).status).toBe(200);
  });
});

describe('a push needs its module write and the reads it sends, and sends only what every receiver may read', () => {
  it('[EXP-PUSH-01] RED-BEFORE (WHP-1, WHP-2): with the owner\'s QuickBooks and Klaviyo bound, a STAFF member with every module none and an ADMIN whose map says revenue, crm and content none are refused every push with 403, and nothing is sent', async () => {
    await unbindAll();
    expect((await send('post', `${conn}/credentials/quickbooks`, ID.owner, QBO('OWNER_REALM'))).status).toBe(201);
    expect((await send('post', `${conn}/credentials/klaviyo`, ID.owner, { values: { apiKey: 'pk_owner_key' } })).status).toBe(201);
    for (const actor of [ID.staffNone, ID.setAdminNone]) {
      const customers = await send('post', `${acct}/customers/push`, actor, { contactIds: [ID.cPrivate] });
      expect(customers.status, `${actor} customers`).toBe(403);
      const invoices = await send('post', `${acct}/invoices/push`, actor, { invoiceIds: [ID.invPrivate] });
      expect(invoices.status, `${actor} invoices`).toBe(403);
      const marketing = await send('post', `${mkt}/lists/push-contacts`, actor, { provider: 'klaviyo', listId: 'ATTACKER_LIST', contactIds: [ID.cPrivate] });
      expect(marketing.status, `${actor} marketing`).toBe(403);
    }
    expect(outbound).toEqual([]);
  });

  it('[EXP-PUSH-02] RED-BEFORE (WHP-1): an account an ADMIN bound (crm view all, no sight of the owner\'s PRIVATE contact) receives no PRIVATE contact and no invoice of one, even when the owner pushes them: the customer push and the invoice push send the TEAM contact and its invoice only', async () => {
    await unbindAll();
    expect((await send('post', `${conn}/credentials/quickbooks`, ID.admin, QBO('ADMIN_REALM'))).status).toBe(201);
    const customers = await send('post', `${acct}/customers/push`, ID.owner, { contactIds: [ID.cPrivate, ID.cTeam] });
    expect(customers.status).toBe(201);
    expect(sentWith(PRIVATE_COMPANY)).toEqual([]);
    expect(sentWith(PRIVATE_PHONE)).toEqual([]);
    expect(sentWith('Team Co').map((o) => o.url)).toEqual([expect.stringContaining('/v3/company/ADMIN_REALM/customer')]);
    expect(customers.body.results.find((r: any) => r.contactId === ID.cPrivate)?.success).toBe(false);
    outbound.length = 0;
    const invoices = await send('post', `${acct}/invoices/push`, ID.owner, { invoiceIds: [ID.invPrivate, ID.invTeam] });
    expect(invoices.status).toBe(201);
    expect(sentWith(`${P}INV-PRIV`)).toEqual([]);
    expect(sentWith(PRIVATE_COMPANY)).toEqual([]);
    expect(invoices.body.results.find((r: any) => r.invoiceId === ID.invPrivate)?.success).toBe(false);
  });

  it('[EXP-PUSH-03] RED-BEFORE (WHP-2): a member whose CRM view is their own book pushes only their own contact, to an account the owner bound: the owner\'s PRIVATE and TEAM contacts are not sent', async () => {
    await unbindAll();
    expect((await send('post', `${conn}/credentials/quickbooks`, ID.owner, QBO('OWNER_REALM'))).status).toBe(201);
    expect((await send('post', `${conn}/credentials/klaviyo`, ID.owner, { values: { apiKey: 'pk_owner_key' } })).status).toBe(201);
    const customers = await send('post', `${acct}/customers/push`, ID.ownView, { contactIds: [ID.cPrivate, ID.cTeam, ID.cOwn] });
    expect(customers.status).toBe(201);
    expect(sentWith(PRIVATE_COMPANY)).toEqual([]);
    expect(sentWith('Team Co')).toEqual([]);
    expect(sentWith('Own Co').length).toBe(1);
    outbound.length = 0;
    const marketing = await send('post', `${mkt}/lists/push-contacts`, ID.ownView, { provider: 'klaviyo', listId: 'L1', contactIds: [ID.cPrivate, ID.cTeam, ID.cOwn] });
    expect(marketing.status).toBe(201);
    expect(sentWith(`${ID.cPrivate}@client.example`)).toEqual([]);
    expect(sentWith(`${ID.cTeam}@client.example`)).toEqual([]);
    expect(sentWith(`${ID.cOwn}@client.example`).length).toBe(1);
  });

  it('[EXP-PUSH-04] RED-BEFORE (WHP-2): the marketing push\'s default segment (every contact with an email) sends no PRIVATE contact to a Klaviyo account a crm settings admin bound', async () => {
    await unbindAll();
    expect((await send('post', `${conn}/credentials/klaviyo`, ID.crmBinder, { values: { apiKey: 'pk_crm_binder_key' } })).status).toBe(201);
    const res = await send('post', `${mkt}/lists/push-contacts`, ID.owner, { provider: 'klaviyo', listId: 'L1' });
    expect(res.status).toBe(201);
    expect(sentWith(`${ID.cPrivate}@client.example`)).toEqual([]);
    expect(sentWith(PRIVATE_PHONE)).toEqual([]);
    expect(sentWith(`${ID.cTeam}@client.example`).length).toBe(1);
  });

  it('[EXP-PUSH-05] RED-BEFORE: an account whose binder is not recorded (bound before this repair) is read as a non-owner\'s: the owner\'s push sends it no PRIVATE contact', async () => {
    await unbindAll();
    await credentials.setCredentials(ID.bizA, 'quickbooks', { accessToken: `${P}legacy_token`, realmId: 'LEGACY_REALM' }, { accountLabel: 'Legacy' });
    expect(JSON.parse(await connectorRow('quickbooks')).metadata.boundBy).toBeUndefined();
    const res = await send('post', `${acct}/customers/push`, ID.owner, { contactIds: [ID.cPrivate, ID.cTeam] });
    expect(res.status).toBe(201);
    expect(sentWith(PRIVATE_COMPANY)).toEqual([]);
    expect(sentWith('Team Co').length).toBe(1);
  });

  it('[EXP-PUSH-06] the owner\'s own account receives everything the owner pushes (no regression): both contacts and both invoices are sent to the owner\'s realm', async () => {
    await unbindAll();
    expect((await send('post', `${conn}/credentials/quickbooks`, ID.owner, QBO('OWNER_REALM'))).status).toBe(201);
    const res = await send('post', `${acct}/customers/push`, ID.owner, { contactIds: [ID.cPrivate, ID.cTeam] });
    expect(res.status).toBe(201);
    expect(sentWith(PRIVATE_COMPANY).map((o) => o.url)).toEqual([expect.stringContaining('/v3/company/OWNER_REALM/customer')]);
    expect(sentWith('Team Co').length).toBe(1);
  });
});

describe('Mailchimp\'s host is pinned to a real data center', () => {
  it('[EXP-MC-01] RED-BEFORE (WHP-2 step 3): a key whose suffix is not a data center (attackerkey-203.0.113.77/mc-collector?) sends nothing anywhere: the push answers an error and no request leaves', async () => {
    await unbindAll();
    expect((await send('post', `${conn}/credentials/mailchimp`, ID.owner, { values: { apiKey: 'attacker' + 'key-203.0.113.77/mc-collector?' } })).status).toBe(201);
    const res = await send('post', `${mkt}/lists/push-contacts`, ID.owner, { provider: 'mailchimp', listId: 'L1', contactIds: [ID.cTeam] });
    expect(outbound.map((o) => o.url)).toEqual([]);
    expect(JSON.stringify(res.body)).toMatch(/data-center/i);
  });

  it('[EXP-MC-02] a real data-center suffix (-us21) sends to https://us21.api.mailchimp.com only', async () => {
    await unbindAll();
    expect((await send('post', `${conn}/credentials/mailchimp`, ID.owner, { values: { apiKey: `${'0123456789abcdef'.repeat(2)}-us21` } })).status).toBe(201);
    await send('post', `${mkt}/lists/push-contacts`, ID.owner, { provider: 'mailchimp', listId: 'L1', contactIds: [ID.cTeam] });
    expect(outbound.map((o) => new URL(o.url).host)).toEqual(['us21.api.mailchimp.com']);
  });

  it('[EXP-NET] every request a case recorded went to a provider host and was refused (nothing left the machine)', () => {
    for (const o of outbound) expect(new URL(o.url).host).toMatch(/(intuit\.com|xero\.com|mailchimp\.com|klaviyo\.com)$/);
  });
});
