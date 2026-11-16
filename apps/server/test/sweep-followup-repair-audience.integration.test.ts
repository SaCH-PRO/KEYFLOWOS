/**
 * SWEEP-P0-FOLLOWUP repair round (review findings SEC-FU-1, SEC-FU-2, COR-1, COR-2, SEC-FU-3), against a REAL
 * database through the HTTP routes and KEY's real dispatcher.
 *
 * WH3-1 held an audience send through a messaging channel connection (an EMAIL / Gmail or WhatsApp account) to the
 * contacts every receiver may open: the sending member and the account's recorded binder (channelRecipients). The
 * review found five ways round it:
 *
 *   SEC-FU-1  POST communications .../connections/sync-from-social copied a social connection's token over the
 *             channel connection of the same provider, EMAIL, GOOGLE and WHATSAPP included, without the export
 *             binding check and without touching the recorded binder: a settings admin whose map says crm none swapped
 *             the owner-bound mailbox's token for their own while boundBy still named the owner (or created an EMAIL
 *             connection with no binder in a business that had none). A social connection is never a messaging
 *             account, so the sync no longer writes one.
 *   SEC-FU-2  the receiver rule ran when a delivery was queued, never when it was sent: a PATCH rebind after a send
 *             was scheduled, or a retry of a failed delivery, sent through the new binder's account to contacts that
 *             binder may not open; and retry / retry-all were membership-only. The rule now runs again for each
 *             delivery when it is sent (the connection's binder now), and retry and retry-all need content write.
 *   COR-1     KEY's comms_send_broadcast (FlowOrchestratorService.executeToolAction, the chat and proposal path) sent
 *             no member, so only the binder was checked and KEY was wider than the member's own HTTP publish (D-88).
 *   COR-2     any account field present in a PATCH body counted as a rebind, even unchanged: the web's sender form
 *             always sends {label, accountEmail}, so an ADMIN who renamed the owner's sender became its binder (the
 *             owner's PRIVATE contacts silently dropped), a settings admin with crm none could not rename it, and the
 *             refusal said "connecting channel_messaging". A rebind is now a change of the stored account only, and the
 *             refusal names the account plainly.
 *   SEC-FU-3  POST audience/expand (the read twin of the audience the sends guard) was membership-only and answered
 *             every matching contact, the owner's PRIVATE ones with email and phone included. It now needs crm read
 *             and answers only the contacts the member may open.
 *
 * Nothing on the authorization or persistence path is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, the global ValidationPipe and GlobalHttpExceptionFilter, CommunicationsController,
 * ChannelConnectionService, OutboundContentService, DeliveryQueueService (its own tick) with the real
 * AdapterRegistryService, CommunicationsService, and FlowOrchestratorService's dispatcher (executeToolAction),
 * against DATABASE_URL. Every outbound fetch is recorded and refused, so no delivery reaches a provider.
 *
 * The social connections SEC-FU-1 copies are seeded as rows: the route that writes them (SocialController manual
 * connect, which accepts any platform string) belongs to pkt/SWEEP-P0-SCOPES; the rows stand for whatever wrote them.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v99d_` prefix and is hard-deleted by raw SQL (sqlLikePrefix)
 * in beforeAll and afterAll. Cases tagged RED-BEFORE fail on the unrepaired code (651cf3cf3).
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v99d_';
const ID = {
  owner: `${P}owner`,
  admin: `${P}admin`, // ADMIN, role defaults: settings admin, crm admin (opens TEAM and SHARED, not the owner's PRIVATE)
  staffDefault: `${P}staffDefault`, // STAFF, role defaults (content read, crm read)
  setAdminCrmNone: `${P}setAdminCrmNone`, // STAFF: settings admin, content write, crm none
  writer: `${P}writer`, // STAFF: content write, crm read
  noneAll: `${P}noneAll`, // STAFF: every module none
  bizA: `${P}bizA`,
  bizC: `${P}bizC`, // a business with no EMAIL connection
  cPrivate: `${P}c_private`,
  cTeam: `${P}c_team`,
  cTeamC: `${P}c_teamC`,
};
const EVERY_MODULE_NONE = {
  settings: 'none', crm: 'none', revenue: 'none', bookings: 'none', projects: 'none', content: 'none', expenses: 'none', automations: 'none',
  storefront: 'none', ai: 'none', team: 'none', analytics: 'none', operations: 'none', connect: 'none',
};
const secret = (...parts: string[]) => parts.join('_');
const PRIVATE_EMAIL = `${P}private@client.example`;
const TEAM_EMAIL = `${P}team@client.example`;

const outbound: Array<{ url: string; body: string; auth: string }> = [];
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
    `DELETE FROM social_connections WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settle = () => sleep(1200);
const comms = (biz = ID.bizA) => `/communications/businesses/${biz}`;

/** The contacts a content's queued deliveries go to. */
const queuedFor = async (contentId: string) =>
  (await db.outboundDelivery.findMany({ where: { contentId }, select: { contactId: true } })).map((d: any) => d.contactId).filter(Boolean).sort();
const deliveryFor = (contentId: string, contactId: string) => db.outboundDelivery.findFirst({ where: { contentId, contactId } });
const connection = (id: string) => db.channelConnection.findUnique({ where: { id } });
const binderOf = async (id: string) => ((await connection(id))?.providerMeta as any)?.boundBy;

/** The MIME of every Gmail send the tap recorded (the raw message is base64url in the JSON body). */
function gmailMessages(): string[] {
  return outbound
    .filter((o) => o.url.includes('gmail.googleapis.com'))
    .map((o) => {
      try {
        const raw = String(JSON.parse(o.body).raw ?? '');
        return Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      } catch {
        return o.body;
      }
    });
}
const mailedTo = (email: string) => gmailMessages().some((m) => m.includes(`To: ${email}`));

/** One run of the delivery queue's own tick (after any tick a publish started has finished). */
async function runTick() {
  const { DeliveryQueueService } = await import('../src/modules/communications/delivery-queue.service');
  const dq: any = moduleRef.get(DeliveryQueueService);
  await settle();
  for (let i = 0; i < 50 && dq.processing; i++) await sleep(100);
  await dq.tick();
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    outbound.push({ url, body: typeof init?.body === 'string' ? init.body : '', auth: String(headers.Authorization ?? headers.authorization ?? '') });
    throw new Error(`v99d: no provider traffic (${url})`);
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

  moduleRef = await Test.createTestingModule({
    controllers: [CommunicationsController],
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
  for (const id of [ID.owner, ID.admin, ID.staffDefault, ID.setAdminCrmNone, ID.writer, ID.noneAll]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V99D Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizC, name: 'V99D Biz C', ownerId: ID.owner } });
  const m = (biz: string, user: string, role: string, permissionScopes?: unknown) =>
    db.membership.create({ data: { id: `${P}m_${biz.slice(P.length)}_${user.slice(P.length)}`, userId: user, businessId: biz, role, permissionScopes: permissionScopes ?? undefined } });
  await m(ID.bizA, ID.owner, 'OWNER');
  await m(ID.bizA, ID.admin, 'ADMIN');
  await m(ID.bizA, ID.staffDefault, 'STAFF');
  await m(ID.bizA, ID.setAdminCrmNone, 'STAFF', { ...EVERY_MODULE_NONE, settings: 'admin', content: 'write' });
  await m(ID.bizA, ID.writer, 'STAFF', { ...EVERY_MODULE_NONE, content: 'write', crm: 'read' });
  await m(ID.bizA, ID.noneAll, 'STAFF', { ...EVERY_MODULE_NONE });
  await m(ID.bizC, ID.owner, 'OWNER');
  await m(ID.bizC, ID.setAdminCrmNone, 'STAFF', { ...EVERY_MODULE_NONE, settings: 'admin', content: 'write' });

  const contact = (id: string, biz: string, extra: Record<string, unknown>) =>
    db.contact.create({ data: { id, businessId: biz, firstName: id.slice(P.length), lastName: 'Client', tags: ['vip'], marketingOptIn: true, doNotContact: false, ...extra } });
  await contact(ID.cPrivate, ID.bizA, { email: PRIVATE_EMAIL, phone: '+18685551234', visibility: 'PRIVATE', ownerId: ID.owner });
  await contact(ID.cTeam, ID.bizA, { email: TEAM_EMAIL, phone: '+18685550000', visibility: 'TEAM' });
  await contact(ID.cTeamC, ID.bizC, { email: `${P}teamc@client.example`, visibility: 'TEAM' });
}, 180_000);

afterAll(async () => {
  await settle();
  vi.restoreAllMocks();
  if (app) await app.close();
  if (db) await cleanup();
});

/** A sending account the member binds through POST connections (the route under WH3-1's binding rule). */
async function bindEmail(actor: string, mailbox: string, biz = ID.bizA) {
  const res = await send('post', `${comms(biz)}/connections`, actor, {
    provider: 'EMAIL', label: mailbox, accountEmail: `${P}${mailbox}@biz.example`, token: secret(P, mailbox, 'oauth'),
  });
  expect(res.status, said(res)).toBe(201);
  const id = res.body.id as string;
  const dest = (await db.channelDestination.findFirst({ where: { connectionId: id } }))?.id as string;
  expect(dest, 'the EMAIL connection has its sending destination').toBeTruthy();
  return { id, dest };
}
async function newsletter(actor = ID.owner) {
  const res = await send('post', `${comms()}/content`, actor, {
    contentType: 'email_newsletter', subject: 'Hello', body: 'News for you', contentMeta: { segmentTags: ['vip'] },
    variants: [{ platform: 'EMAIL', textBody: 'News for you' }],
  });
  expect(res.status, said(res)).toBe(201);
  return res.body.id as string;
}
const seedSocial = (biz: string, platform: string, token: string, extra: Record<string, unknown> = {}) =>
  db.socialConnection.create({ data: { id: `${P}sc_${biz.slice(P.length)}_${platform.toLowerCase()}`, businessId: biz, platform, token, accountName: `${platform} account`, status: 'CONNECTED', ...extra } });

describe('SEC-FU-1: sync-from-social is no door to a messaging sending account', () => {
  it('[SFR-SYNC-01] RED-BEFORE: with social EMAIL, GOOGLE and WHATSAPP connections holding another account\'s token, POST sync-from-social (by a settings admin whose map says crm none, and by the owner) leaves the owner-bound EMAIL connection\'s token and binder as they were and creates no GOOGLE or WHATSAPP connection; a LINKEDIN page still syncs', async () => {
    const owned = await bindEmail(ID.owner, 'syncbox');
    const before = await connection(owned.id);
    expect((before?.providerMeta as any)?.boundBy).toBe(ID.owner);
    const attackerToken = secret(P, 'attacker', 'mail');
    await seedSocial(ID.bizA, 'EMAIL', attackerToken);
    await seedSocial(ID.bizA, 'GOOGLE', secret(P, 'attacker', 'google'));
    await seedSocial(ID.bizA, 'WHATSAPP', secret(P, 'attacker', 'waba'));
    await seedSocial(ID.bizA, 'LINKEDIN', secret(P, 'owner', 'li'), { platformId: `${P}li_page` });

    for (const actor of [ID.setAdminCrmNone, ID.owner]) {
      const res = await send('post', `${comms()}/connections/sync-from-social`, actor, {});
      expect([200, 201], `${actor}: ${said(res)}`).toContain(res.status);
      const after = await connection(owned.id);
      expect(after?.token, `${actor}: the owner-bound mailbox keeps its token`).toBe(before?.token);
      expect(after?.token).not.toBe(attackerToken);
      expect((after?.providerMeta as any)?.boundBy, actor).toBe(ID.owner);
      const messaging = await db.channelConnection.findMany({ where: { businessId: ID.bizA, provider: { in: ['EMAIL', 'GOOGLE', 'WHATSAPP'] } }, select: { id: true } });
      expect(messaging.map((c: any) => c.id), `${actor}: no messaging connection is created or written by the sync`).toEqual([owned.id]);
      expect(said(res)).not.toContain(attackerToken);
    }
    // control: a social page still syncs (its connection and its destination)
    const li = await db.channelConnection.findFirst({ where: { businessId: ID.bizA, provider: 'LINKEDIN' }, include: { destinations: true } });
    expect(li?.destinations?.length, 'the LinkedIn page syncs').toBe(1);
  });

  it('[SFR-SYNC-02] RED-BEFORE: in a business with no EMAIL connection, a settings admin whose map says crm none cannot make one from a social EMAIL connection (sync-from-social creates no channel connection with an unknown binder for a destination to be added to)', async () => {
    await seedSocial(ID.bizC, 'EMAIL', secret(P, 'attacker', 'mailc'));
    const res = await send('post', `${comms(ID.bizC)}/connections/sync-from-social`, ID.setAdminCrmNone, {});
    expect([200, 201], said(res)).toContain(res.status);
    expect(await db.channelConnection.count({ where: { businessId: ID.bizC } })).toBe(0);
  });
});

describe('SEC-FU-2: the receiver rule holds when a delivery is sent, and a re-send needs content write', () => {
  it('[SFR-SEND-01] RED-BEFORE: the owner schedules a newsletter through the owner-bound mailbox; an ADMIN (who may not open the owner\'s PRIVATE contacts) then rebinds it with PATCH; when the send runs, the PRIVATE delivery fails visibly and nothing is mailed to it, while the TEAM delivery is sent', async () => {
    const { id, dest } = await bindEmail(ID.owner, 'schedbox');
    const contentId = await newsletter();
    const sched = await send('post', `${comms()}/content/${contentId}/schedule`, ID.owner, { destinationIds: [dest], scheduledAt: '2031-01-01T10:00:00' });
    expect(sched.status, said(sched)).toBe(201);
    expect(await queuedFor(contentId)).toEqual([ID.cPrivate, ID.cTeam].sort());

    const rebind = await send('patch', `${comms()}/connections/${id}`, ID.admin, { token: secret(P, 'admin', 'swap'), accountEmail: `${P}adminsched@biz.example` });
    expect(rebind.status, said(rebind)).toBe(200);
    expect(await binderOf(id)).toBe(ID.admin);

    await db.outboundDelivery.updateMany({ where: { contentId }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    await runTick();

    expect(mailedTo(PRIVATE_EMAIL), 'nothing is mailed to the PRIVATE contact through the ADMIN-bound account').toBe(false);
    const priv = await deliveryFor(contentId, ID.cPrivate);
    expect(priv?.status).toBe('Failed');
    expect(priv?.errorCode).toBe('RECEIVER_MAY_NOT_OPEN');
    expect(String(priv?.errorMessage ?? '')).toMatch(/sending account/);
    expect(mailedTo(TEAM_EMAIL), 'control: the TEAM delivery is sent').toBe(true);
  });

  it('[SFR-SEND-02] RED-BEFORE: retry and retry-all need content write (STAFF on role defaults: 403, the delivery stays failed); a writer\'s retry of the PRIVATE delivery after the account was rebound to the ADMIN fails it at send and mails nothing to it', async () => {
    const { id, dest } = await bindEmail(ID.owner, 'retrybox');
    const contentId = await newsletter();
    const sched = await send('post', `${comms()}/content/${contentId}/schedule`, ID.owner, { destinationIds: [dest], scheduledAt: '2031-01-01T10:00:00' });
    expect(sched.status, said(sched)).toBe(201);
    const priv = await deliveryFor(contentId, ID.cPrivate);
    await db.outboundDelivery.update({ where: { id: priv.id }, data: { status: 'Failed', errorCode: 'EMAIL_ERROR', errorMessage: 'provider error' } });
    const rebind = await send('patch', `${comms()}/connections/${id}`, ID.admin, { token: secret(P, 'admin', 'retry'), accountEmail: `${P}adminretry@biz.example` });
    expect(rebind.status, said(rebind)).toBe(200);

    const staff = await send('post', `${comms()}/deliveries/${priv.id}/retry`, ID.staffDefault, {});
    expect(staff.status, said(staff)).toBe(403);
    expect(said(staff)).toMatch(/content requires write/);
    const staffAll = await send('post', `${comms()}/content/${contentId}/retry-all`, ID.staffDefault, {});
    expect(staffAll.status, said(staffAll)).toBe(403);
    expect((await deliveryFor(contentId, ID.cPrivate))?.status).toBe('Failed');
    expect((await deliveryFor(contentId, ID.cPrivate))?.errorCode).toBe('EMAIL_ERROR');

    const writer = await send('post', `${comms()}/deliveries/${priv.id}/retry`, ID.writer, {});
    expect(writer.status, said(writer)).toBe(201);
    await runTick();
    expect(mailedTo(PRIVATE_EMAIL), 'nothing is mailed to the PRIVATE contact through the ADMIN-bound account').toBe(false);
    const after = await deliveryFor(contentId, ID.cPrivate);
    expect(after?.status).toBe('Failed');
    expect(after?.errorCode).toBe('RECEIVER_MAY_NOT_OPEN');
  });
});

describe('COR-1: KEY\'s broadcast is held to the member it runs for', () => {
  it('[SFR-KEY-01] RED-BEFORE: through the owner-bound mailbox, KEY\'s comms_send_broadcast for the ADMIN or the writer (a chat turn\'s principal, an approved proposal\'s member) queues only the TEAM contact, as that member\'s own HTTP publish does; for the owner it queues both', async () => {
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { CommunicationsService } = await import('../src/modules/communications/communications.service');
    const { FlowOrchestratorService } = await import('../src/modules/ai/flow-orchestrator.service');
    const commsSvc = moduleRef.get(CommunicationsService);
    const dispatcher = Object.assign(Object.create(FlowOrchestratorService.prototype), {
      prisma: moduleRef.get(PrismaService),
      moduleRef: { get: (token: unknown) => (token === CommunicationsService ? commsSvc : undefined) },
    });
    const { id: keyConn, dest } = await bindEmail(ID.owner, 'keybox');
    // the owner-bound mailbox is the only active sending account for this case
    await db.channelDestination.updateMany({ where: { businessId: ID.bizA, NOT: { connectionId: keyConn } }, data: { isActive: false } });
    try {
      for (const member of [ID.admin, ID.writer]) {
        const viaHttp = await newsletter();
        const res = await send('post', `/communications/businesses/${ID.bizA}/content/${viaHttp}/publish`, member, { destinationIds: [dest] });
        expect(res.status, `${member}: ${said(res)}`).toBe(201);
        expect(await queuedFor(viaHttp), `${member} over HTTP`).toEqual([ID.cTeam]);
        for (const action of [{ surface: 'CHAT', principalUserId: member }, { surface: 'PROPOSAL', onBehalfOfUserId: member }]) {
          const result = await dispatcher.executeToolAction(ID.bizA, 'comms_send_broadcast', { segment: 'vip', channel: 'email', body: 'Hello from KEY' }, action);
          expect(result?.success, JSON.stringify(result)).toBe(true);
          expect(await queuedFor(result.contentId), `${member} through KEY (${action.surface})`).toEqual([ID.cTeam]);
        }
      }
      const forOwner = await dispatcher.executeToolAction(ID.bizA, 'comms_send_broadcast', { segment: 'vip', channel: 'email', body: 'Hello from KEY' }, { surface: 'CHAT', principalUserId: ID.owner });
      expect(await queuedFor(forOwner.contentId), 'control: the owner opens every contact').toEqual([ID.cPrivate, ID.cTeam].sort());
    } finally {
      await db.channelDestination.updateMany({ where: { businessId: ID.bizA }, data: { isActive: true } });
      await settle();
    }
  });
});

describe('COR-2: only a change of the stored account rebinds a sending account', () => {
  it('[SFR-REL-01] RED-BEFORE: renaming the owner\'s sender with the body the web form sends ({label, accountEmail} unchanged) binds nothing: a settings admin whose map says crm none may rename it, an ADMIN who renames it does not become its binder, and the owner\'s newsletter still reaches the owner\'s PRIVATE contact; a changed mailbox is refused in plain words', async () => {
    const { id, dest } = await bindEmail(ID.owner, 'relbox');
    const url = `${comms()}/connections/${id}`;
    const mailbox = `${P}relbox@biz.example`;

    const crmNone = await send('patch', url, ID.setAdminCrmNone, { label: 'Shop Team', accountEmail: mailbox });
    expect(crmNone.status, said(crmNone)).toBe(200);
    expect(await binderOf(id)).toBe(ID.owner);
    const adminRename = await send('patch', url, ID.admin, { label: 'Shop Team 2', accountEmail: mailbox });
    expect(adminRename.status, said(adminRename)).toBe(200);
    expect(await binderOf(id), 'an ADMIN who renames the sender is not its binder').toBe(ID.owner);
    // the stored provider meta sent back (and a boundBy the body names, which the server never stores) binds nothing either
    const metaEcho = await send('patch', url, ID.setAdminCrmNone, { label: 'Shop Team 3', accountEmail: mailbox, providerMeta: { boundBy: ID.setAdminCrmNone } });
    expect(metaEcho.status, said(metaEcho)).toBe(200);
    expect(await binderOf(id)).toBe(ID.owner);
    expect((await connection(id))?.label).toBe('Shop Team 3');

    const contentId = await newsletter();
    const pub = await send('post', `${comms()}/content/${contentId}/publish`, ID.owner, { destinationIds: [dest] });
    expect(pub.status, said(pub)).toBe(201);
    expect(await queuedFor(contentId), 'the owner\'s newsletter still reaches the PRIVATE contact').toEqual([ID.cPrivate, ID.cTeam].sort());

    const moved = await send('patch', url, ID.setAdminCrmNone, { label: 'Shop Team', accountEmail: `${P}elsewhere@biz.example` });
    expect(moved.status, said(moved)).toBe(403);
    expect(said(moved)).toMatch(/email or WhatsApp sending account/);
    expect(said(moved)).not.toMatch(/channel_messaging/);
    expect((await connection(id))?.accountEmail).toBe(mailbox);
    expect(await binderOf(id)).toBe(ID.owner);
    await settle();
  });
});

describe('SEC-FU-3: the audience preview is a read of the business\'s contacts', () => {
  it('[SFR-AUD-01] RED-BEFORE: POST audience/expand needs crm read (every module none: 403) and answers only the contacts the member may open (a writer and an ADMIN see the TEAM contact, not the owner\'s PRIVATE one; the owner sees both)', async () => {
    const body = { segmentTags: ['vip'], channel: 'email' };
    const none = await send('post', `${comms()}/audience/expand`, ID.noneAll, body);
    expect(none.status, said(none)).toBe(403);
    expect(said(none)).not.toContain(PRIVATE_EMAIL);
    for (const member of [ID.writer, ID.admin]) {
      const res = await send('post', `${comms()}/audience/expand`, member, body);
      expect([200, 201], `${member}: ${said(res)}`).toContain(res.status);
      const ids = (res.body.contacts ?? []).map((c: any) => c.id);
      expect(ids, member).toContain(ID.cTeam);
      expect(ids, member).not.toContain(ID.cPrivate);
      expect(said(res), member).not.toContain(PRIVATE_EMAIL);
    }
    const owner = await send('post', `${comms()}/audience/expand`, ID.owner, body);
    expect([200, 201], said(owner)).toContain(owner.status);
    expect((owner.body.contacts ?? []).map((c: any) => c.id).sort()).toEqual([ID.cPrivate, ID.cTeam].sort());
  });
});
