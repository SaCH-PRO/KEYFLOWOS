/**
 * SWEEP-P0-FOLLOWUP — WH3-1 (round 3 recheck, CLASS A): an audience send through a channel connection is an export
 * of the business's contacts to the account a member binds, and no receiver rule applied to it; and census owner
 * question 16 (the marketing push's default segment), against a REAL database through the HTTP routes.
 *
 * WH3-1. The sending account of an audience send is a ChannelConnection (an EMAIL / Gmail mailbox or a WhatsApp
 * business account). A settings admin binds it with POST /communications/businesses/:b/connections (or
 * POST .../whatsapp/connect): only settings admin was checked, so an ADMIN whose map says crm none (D-114) bound
 * their own mailbox, and no binder was recorded. DeliveryQueueService then expanded the audience with no
 * visibility clause, so the owner's PRIVATE contacts were queued as deliveries from that account, and the routes
 * that start the send (POST .../content/:id/publish and /schedule) were membership-only. The rule now is the
 * integration pushes' (round 2, WHP-1 / WHP-2) and the Outlook push's (round 3, WPH2-1):
 *   - binding a messaging connection (EMAIL, GOOGLE, WHATSAPP) needs crm read beside settings admin
 *     (assertMayBindExport, CONNECTOR_EXPORT_READS.channel_messaging) and records the binder
 *     (providerMeta.boundBy, set by the server, never from the body);
 *   - publish and schedule need content write, and an audience send needs the sending member's crm read;
 *   - every queued recipient is a contact every receiver may open: the sending member and each account's binder
 *     (a connection with no recorded binder is read as a non-owner's: no PRIVATE contact), the same for KEY's
 *     broadcast and the cron digest (channelRecipients).
 *
 * Owner question 16 (answered by default): the marketing push's default segment counts a contact whose
 * doNotContact was never set (NULL) as may-contact; only the query changes.
 *
 * Nothing on the authorization or persistence path is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, the global ValidationPipe and GlobalHttpExceptionFilter, CommunicationsController,
 * ChannelConnectionService, DeliveryQueueService with the real AdapterRegistryService, CommunicationsService,
 * MarketingSyncController with the real KlaviyoConnector and ConnectorCredentialsService, against DATABASE_URL.
 * Every outbound fetch is recorded and refused, so no delivery reaches a provider.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v99b_` prefix and is hard-deleted by raw SQL (sqlLikePrefix)
 * in beforeAll and afterAll. Cases tagged RED-BEFORE fail on the unmodified code.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v99b_';
const ID = {
  owner: `${P}owner`,
  admin: `${P}admin`, // ADMIN, role defaults: settings admin, crm admin (opens TEAM and SHARED, not the owner's PRIVATE)
  staffDefault: `${P}staffDefault`, // STAFF, role defaults (content read, crm read)
  setAdminCrmNone: `${P}setAdminCrmNone`, // STAFF: settings admin, content write, crm none
  writer: `${P}writer`, // STAFF: content write, crm read
  bizA: `${P}bizA`,
  cPrivate: `${P}c_private`,
  cTeam: `${P}c_team`,
  cNullFlags: `${P}c_nullflags`,
  cDnc: `${P}c_dnc`,
  legacyConn: `${P}conn_legacy`,
  legacyDest: `${P}dest_legacy`,
};
const EVERY_MODULE_NONE = {
  settings: 'none', crm: 'none', revenue: 'none', bookings: 'none', projects: 'none', content: 'none', expenses: 'none', automations: 'none',
  storefront: 'none', ai: 'none', team: 'none', analytics: 'none', operations: 'none', connect: 'none',
};
const secret = (...parts: string[]) => parts.join('_');

const outbound: Array<{ url: string; body: string }> = [];
let db: any;
let app: any;
let moduleRef: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM delivery_events WHERE delivery_id IN (SELECT id FROM outbound_deliveries WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM outbound_deliveries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM outbound_variants WHERE content_id IN (SELECT id FROM outbound_content WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM outbound_content WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM channel_destinations WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM channel_connections WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM connector_statuses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

type Verb = 'get' | 'post' | 'put' | 'patch' | 'delete';
function send(verb: Verb, url: string, actor: string | undefined, body?: unknown) {
  let r = (request(app.getHttpServer()) as any)[verb](url);
  if (actor) r = r.set('x-test-user', actor);
  return body === undefined ? r : r.send(body);
}
const said = (res: any) => JSON.stringify(res.body ?? {});
const settle = () => new Promise((r) => setTimeout(r, 1200));
/** The contacts a content's queued deliveries go to. */
const queuedFor = async (contentId: string) =>
  (await db.outboundDelivery.findMany({ where: { contentId }, select: { contactId: true } })).map((d: any) => d.contactId).filter(Boolean).sort();
const connectionsOf = async () => db.channelConnection.findMany({ where: { businessId: ID.bizA }, orderBy: { createdAt: 'asc' } });

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    outbound.push({ url, body: typeof init?.body === 'string' ? init.body : '' });
    throw new Error(`v99b: no provider traffic (${url})`);
  }) as any);

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { CommunicationsController } = await import('../src/modules/communications/communications.controller');
  const { ChannelConnectionService } = await import('../src/modules/communications/channel-connection.service');
  const { OutboundContentService } = await import('../src/modules/communications/outbound-content.service');
  const { DeliveryQueueService } = await import('../src/modules/communications/delivery-queue.service');
  const { AdapterRegistryService } = await import('../src/modules/communications/adapters/adapter-registry.service');
  const { CommunicationsService } = await import('../src/modules/communications/communications.service');
  const { MarketingSyncController } = await import('../src/modules/email-marketing/marketing-sync.controller');
  const { KlaviyoConnector } = await import('../src/core/connectors/implementations/klaviyo.connector');
  const { MailchimpConnector } = await import('../src/core/connectors/implementations/mailchimp.connector');
  const { ConnectorCredentialsService } = await import('../src/core/connectors/connector-credentials.service');

  moduleRef = await Test.createTestingModule({
    controllers: [CommunicationsController, MarketingSyncController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      ChannelConnectionService,
      OutboundContentService,
      DeliveryQueueService,
      AdapterRegistryService,
      { provide: CommunicationsService, useFactory: (prisma: any, dq: any, oc: any) => new CommunicationsService(prisma, {} as any, dq, oc, {} as any, {} as any), inject: [PrismaService, DeliveryQueueService, OutboundContentService] },
      KlaviyoConnector,
      MailchimpConnector,
      ConnectorCredentialsService,
      { provide: EventEmitter2, useValue: { emit: () => true, emitAsync: async () => [], on: () => undefined } },
    ],
  })
    .useMocker(() => ({}))
    .compile();

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
  for (const id of [ID.owner, ID.admin, ID.staffDefault, ID.setAdminCrmNone, ID.writer]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V99B Biz A', ownerId: ID.owner } });
  const m = (user: string, role: string, permissionScopes?: unknown) =>
    db.membership.create({ data: { id: `${P}m_${user.slice(P.length)}`, userId: user, businessId: ID.bizA, role, permissionScopes: permissionScopes ?? undefined } });
  await m(ID.owner, 'OWNER');
  await m(ID.admin, 'ADMIN');
  await m(ID.staffDefault, 'STAFF');
  await m(ID.setAdminCrmNone, 'STAFF', { ...EVERY_MODULE_NONE, settings: 'admin', content: 'write' });
  await m(ID.writer, 'STAFF', { ...EVERY_MODULE_NONE, content: 'write', crm: 'read' });

  const contact = (id: string, extra: Record<string, unknown>) =>
    db.contact.create({ data: { id, businessId: ID.bizA, firstName: id.slice(P.length), lastName: 'Client', tags: ['vip'], ...extra } });
  await contact(ID.cPrivate, { email: `${P}private@client.example`, phone: '+18685551234', visibility: 'PRIVATE', ownerId: ID.owner, marketingOptIn: true, doNotContact: false });
  await contact(ID.cTeam, { email: `${P}team@client.example`, phone: '+18685550000', visibility: 'TEAM', marketingOptIn: true, doNotContact: false });
  await contact(ID.cNullFlags, { email: `${P}nullflags@client.example`, visibility: 'TEAM' });
  await contact(ID.cDnc, { email: `${P}dnc@client.example`, visibility: 'TEAM', doNotContact: true });

  // An EMAIL sender bound before binders were recorded (no providerMeta.boundBy): read as a non-owner's.
  await db.channelConnection.create({ data: { id: ID.legacyConn, businessId: ID.bizA, provider: 'EMAIL', label: 'Legacy sender', accountEmail: `${P}legacy@biz.example`, token: secret(P, 'legacy', 'mail') } });
  await db.channelDestination.create({ data: { id: ID.legacyDest, businessId: ID.bizA, connectionId: ID.legacyConn, platform: 'EMAIL', platformId: `${P}legacy@biz.example`, displayName: 'Legacy sender' } });
}, 180_000);

afterAll(async () => {
  await settle();
  vi.restoreAllMocks();
  if (app) await app.close();
  if (db) await cleanup();
});

async function newsletter(actor = ID.owner) {
  const res = await send('post', `/communications/businesses/${ID.bizA}/content`, actor, {
    contentType: 'email_newsletter', subject: 'Hello', body: 'News for you', contentMeta: { segmentTags: ['vip'] },
    variants: [{ platform: 'EMAIL', textBody: 'News for you' }],
  });
  expect(res.status, said(res)).toBe(201);
  return res.body.id as string;
}
async function bindEmail(actor: string, mailbox: string) {
  const res = await send('post', `/communications/businesses/${ID.bizA}/connections`, actor, {
    provider: 'EMAIL', label: mailbox, accountEmail: `${P}${mailbox}@biz.example`, token: secret(P, mailbox, 'oauth'),
    providerMeta: { boundBy: ID.owner },
  });
  return res;
}
const destinationOf = async (connectionId: string) => (await db.channelDestination.findFirst({ where: { connectionId } }))?.id as string;

describe('WH3-1: binding a messaging connection is binding an export account', () => {
  it('[SFA-WH31-BIND-01] RED-BEFORE: a settings admin whose map says crm none is refused 403 (it needs crm read) binding an EMAIL or WhatsApp sending account (connections, whatsapp/connect), and no connection is written', async () => {
    const before = (await connectionsOf()).length;
    const email = await bindEmail(ID.setAdminCrmNone, 'attacker');
    expect(email.status, said(email)).toBe(403);
    expect(said(email)).toMatch(/needs crm read access/);
    const wa = await send('post', `/communications/businesses/${ID.bizA}/connections`, ID.setAdminCrmNone, {
      provider: 'WHATSAPP', token: secret(P, 'binder', 'waba'), providerMeta: { phoneNumber: '+18685550777', phoneNumberId: `${P}binder_pnid` },
    });
    expect(wa.status, said(wa)).toBe(403);
    const connect = await send('post', `/communications/businesses/${ID.bizA}/whatsapp/connect`, ID.setAdminCrmNone, { accessToken: secret(P, 'binder', 'waba'), waBusinessAccountId: `${P}waba` });
    expect(connect.status, said(connect)).toBe(403);
    expect((await connectionsOf()).length).toBe(before);
    expect(outbound.filter((o) => o.url.includes(`${P}waba`))).toEqual([]);
  });

  it('[SFA-WH31-BIND-02] RED-BEFORE: a settings admin who reads crm binds the account and is recorded as its binder (providerMeta.boundBy), whatever the body names', async () => {
    const res = await bindEmail(ID.admin, 'adminbox');
    expect(res.status, said(res)).toBe(201);
    const row = await db.channelConnection.findFirst({ where: { businessId: ID.bizA, accountEmail: `${P}adminbox@biz.example` } });
    expect((row?.providerMeta as any)?.boundBy).toBe(ID.admin);
    expect(said(res)).not.toMatch(/adminbox_oauth/);
  });
});

describe('WH3-1: an audience send queues only the contacts every receiver may open', () => {
  it('[SFA-WH31-PUB-01] RED-BEFORE: publish needs content write (STAFF on role defaults: 403), and an audience send needs the sending member\'s crm read (content write, crm none: 403); nothing is queued', async () => {
    const adminConn = (await connectionsOf()).find((c: any) => c.accountEmail === `${P}adminbox@biz.example`);
    const dest = await destinationOf(adminConn.id);
    const contentId = await newsletter();
    const staff = await send('post', `/communications/businesses/${ID.bizA}/content/${contentId}/publish`, ID.staffDefault, { destinationIds: [dest] });
    expect(staff.status, said(staff)).toBe(403);
    expect(said(staff)).toMatch(/content requires write/);
    const crmNone = await send('post', `/communications/businesses/${ID.bizA}/content/${contentId}/publish`, ID.setAdminCrmNone, { destinationIds: [dest] });
    expect(crmNone.status, said(crmNone)).toBe(403);
    expect(said(crmNone)).toMatch(/needs crm read access/);
    const sched = await send('post', `/communications/businesses/${ID.bizA}/content/${contentId}/schedule`, ID.staffDefault, { destinationIds: [dest], scheduledAt: '2031-01-01T10:00:00' });
    expect(sched.status, said(sched)).toBe(403);
    expect(await queuedFor(contentId)).toEqual([]);
  });

  it('[SFA-WH31-PUB-02] RED-BEFORE: the owner\'s newsletter through an ADMIN-bound mailbox is queued to the TEAM contact and not to the owner\'s PRIVATE contact (the binder may not open it); through a mailbox with no recorded binder too', async () => {
    const adminConn = (await connectionsOf()).find((c: any) => c.accountEmail === `${P}adminbox@biz.example`);
    for (const dest of [await destinationOf(adminConn.id), ID.legacyDest]) {
      const contentId = await newsletter();
      const res = await send('post', `/communications/businesses/${ID.bizA}/content/${contentId}/publish`, ID.owner, { destinationIds: [dest] });
      expect(res.status, said(res)).toBe(201);
      const queued = await queuedFor(contentId);
      expect(queued, dest).toContain(ID.cTeam);
      expect(queued, dest).not.toContain(ID.cPrivate);
      await settle();
    }
    expect(outbound.filter((o) => o.body.includes(`${P}private@client.example`) || o.body.includes(Buffer.from(`${P}private@client.example`).toString('base64')))).toEqual([]);
  });

  it('[SFA-WH31-PUB-03] control: through a mailbox the owner bound, the owner\'s newsletter reaches the PRIVATE contact (the owner opens every contact); a writer with crm read sends to what both the writer and the binder open', async () => {
    const own = await bindEmail(ID.owner, 'ownerbox');
    expect(own.status, said(own)).toBe(201);
    const ownerConn = (await connectionsOf()).find((c: any) => c.accountEmail === `${P}ownerbox@biz.example`);
    const dest = await destinationOf(ownerConn.id);
    const contentId = await newsletter();
    const res = await send('post', `/communications/businesses/${ID.bizA}/content/${contentId}/publish`, ID.owner, { destinationIds: [dest] });
    expect(res.status, said(res)).toBe(201);
    expect(await queuedFor(contentId)).toEqual([ID.cPrivate, ID.cTeam].sort());
    await settle();
    const byWriter = await newsletter();
    const w = await send('post', `/communications/businesses/${ID.bizA}/content/${byWriter}/publish`, ID.writer, { destinationIds: [dest] });
    expect(w.status, said(w)).toBe(201);
    expect(await queuedFor(byWriter)).toEqual([ID.cTeam]);
    await settle();
  });

  it('[SFA-WH31-SCHED-01] RED-BEFORE: a scheduled send through the ADMIN-bound mailbox queues the TEAM contact and not the PRIVATE one', async () => {
    const adminConn = (await connectionsOf()).find((c: any) => c.accountEmail === `${P}adminbox@biz.example`);
    const contentId = await newsletter();
    const res = await send('post', `/communications/businesses/${ID.bizA}/content/${contentId}/schedule`, ID.owner, { destinationIds: [await destinationOf(adminConn.id)], scheduledAt: '2031-01-01T10:00:00' });
    expect(res.status, said(res)).toBe(201);
    const queued = await queuedFor(contentId);
    expect(queued).toContain(ID.cTeam);
    expect(queued).not.toContain(ID.cPrivate);
  });

  it('[SFA-WH31-BCAST-01] RED-BEFORE: KEY\'s broadcast and the cron digest (CommunicationsService.sendBroadcast, no member) through the first active email account queue no contact its binder may not open', async () => {
    // only the ADMIN-bound mailbox stays active for this case
    await db.channelDestination.updateMany({ where: { businessId: ID.bizA, NOT: { connection: { accountEmail: `${P}adminbox@biz.example` } } }, data: { isActive: false } });
    try {
      const { CommunicationsService } = await import('../src/modules/communications/communications.service');
      const comms = moduleRef.get(CommunicationsService);
      const result = await comms.sendBroadcast({ businessId: ID.bizA, segment: 'vip', channel: 'email', body: 'Digest' });
      expect(result.success, JSON.stringify(result)).toBe(true);
      const queued = await queuedFor(result.contentId);
      expect(queued).toContain(ID.cTeam);
      expect(queued).not.toContain(ID.cPrivate);
    } finally {
      await db.channelDestination.updateMany({ where: { businessId: ID.bizA }, data: { isActive: true } });
      await settle();
    }
  });
});

describe('Owner question 16: the marketing push\'s default segment counts a contact whose doNotContact was never set as may-contact', () => {
  it('[SFA-Q16-01] RED-BEFORE: the owner\'s default-segment push to Klaviyo selects the contact with no doNotContact set and still not the one marked do-not-contact', async () => {
    const { ConnectorCredentialsService } = await import('../src/core/connectors/connector-credentials.service');
    await moduleRef.get(ConnectorCredentialsService).setCredentials(ID.bizA, 'klaviyo', { apiKey: secret('pk', P, 'owner') }, { boundBy: ID.owner });
    const res = await send('post', `/marketing/businesses/${ID.bizA}/lists/push-contacts`, ID.owner, { provider: 'klaviyo', listId: `${P}LIST` });
    expect([200, 201], said(res)).toContain(res.status);
    // total = every contact the default segment selected (the owner opens every contact)
    expect(res.body.total, said(res)).toBe(3);
    const sent = outbound.filter((o) => o.url.includes('klaviyo.com')).map((o) => o.body).join('\n');
    expect(sent).not.toContain(`${P}dnc@client.example`);
  });
});
