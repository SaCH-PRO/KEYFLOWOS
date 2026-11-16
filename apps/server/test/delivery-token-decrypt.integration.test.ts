/**
 * FU-DELIVERY-TOKEN-DECRYPT (V1-71): a queued Gmail or WhatsApp send goes out under the token the connection was
 * saved with, never the stored ciphertext. Against a REAL database, through the HTTP routes and the delivery queue's
 * own tick.
 *
 * ChannelConnection.token is encrypted at rest by the Prisma token-encryption extension
 * (packages/db/src/middleware/token-encryption.ts), which decrypts only the TOP-LEVEL rows of a query on an encrypted
 * model. DeliveryQueueService.claimDeliveries reads the sending account as a NESTED include
 * (outboundDelivery -> destination -> connection), which the extension never sees, so the Gmail and WhatsApp adapters
 * put the stored 'enc:v1:...' value in the Authorization header and the provider refused every queued send. The same
 * nested read backs the manual retry and retry-all decisions (DeliveryQueueService.retry / retryAllFailed).
 *
 * Nothing on the authorization, persistence or send path is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, the global ValidationPipe and GlobalHttpExceptionFilter, CommunicationsController,
 * ChannelConnectionService, OutboundContentService, DeliveryQueueService (its own tick) with the real
 * AdapterRegistryService and its Gmail and WhatsApp adapters. Every outbound fetch goes to a tap that records the
 * request and answers it itself (a provider-shaped 200, or a 503 when a case asks for a transient failure), so no
 * request reaches a provider.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v71b_` prefix and is hard-deleted by raw SQL (sqlLikePrefix)
 * in beforeAll and afterAll. The plaintext tokens are built at run time from fragments. Cases tagged RED-BEFORE fail
 * on the unrepaired code (c80841dc2): the tapped bearer is 'enc:v1:...'.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v71b_';
const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  cVip: `${P}c_vip`,
};
const VIP_EMAIL = `${P}vip@client.example`;
const VIP_PHONE = '+18685557101';
const PHONE_NUMBER_ID = `${P}pnid`;
/** A secret built from fragments at run time, so no secret-shaped literal sits in the source. */
const secret = (...parts: string[]) => parts.join('_');
const CIPHER_PREFIX = ['enc', 'v1', ''].join(':');

type Tapped = { url: string; method: string; auth: string; body: string };
const outbound: Tapped[] = [];
/** Sends the tap answers with a 503 (transient), counted down per send. */
let transientFailures = 0;
let sendCount = 0;
/** Every HTTP response body and every log line the suite produced. */
const responses: string[] = [];
const logLines: string[] = [];
/** The plaintext tokens connections were saved with in this run (DTD-04 searches for each). */
const plaintexts: string[] = [];

let db: any;
let app: any;
let moduleRef: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM delivery_events WHERE delivery_id IN (SELECT id FROM outbound_deliveries WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM outbound_deliveries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM campaign_contacts WHERE campaign_id IN (SELECT id FROM campaigns WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM campaigns WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM outbound_variants WHERE content_id IN (SELECT id FROM outbound_content WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM outbound_content WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM channel_destinations WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM channel_connections WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

type Verb = 'get' | 'post' | 'put' | 'patch' | 'delete';
async function send(verb: Verb, url: string, actor: string | undefined, body?: unknown) {
  let r = (request(app.getHttpServer()) as any)[verb](url);
  if (actor) r = r.set('x-test-user', actor);
  const res = await (body === undefined ? r : r.send(body));
  responses.push(`${verb.toUpperCase()} ${url} -> ${res.status} ${res.text ?? ''}`);
  return res;
}
const said = (res: any) => JSON.stringify(res.body ?? {});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const comms = `/communications/businesses/${ID.biz}`;

/** One run of the delivery queue's own tick (after any tick a publish or retry started has finished). */
async function runTick() {
  const { DeliveryQueueService } = await import('../src/modules/communications/delivery-queue.service');
  const dq: any = moduleRef.get(DeliveryQueueService);
  await sleep(1200);
  for (let i = 0; i < 50 && dq.processing; i++) await sleep(100);
  await dq.tick();
}

const gmailSends = () => outbound.filter((o) => o.url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
const whatsappSends = () => outbound.filter((o) => o.url === `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`);
/** The MIME of a tapped Gmail send (base64url `raw` in the JSON body). */
const mimeOf = (o: Tapped) => Buffer.from(String(JSON.parse(o.body).raw ?? '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const deliveriesOf = (contentId: string) => db.outboundDelivery.findMany({ where: { contentId }, orderBy: { createdAt: 'asc' } });
const storedToken = async (connectionId: string): Promise<string> =>
  ((await db.$queryRawUnsafe('SELECT token FROM channel_connections WHERE id = $1', connectionId)) as Array<{ token: string }>)[0]?.token;

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const tapped: Tapped = {
      url,
      method: String(init?.method ?? 'GET'),
      auth: String(headers.Authorization ?? headers.authorization ?? ''),
      body: typeof init?.body === 'string' ? init.body : '',
    };
    outbound.push(tapped);
    const isGmail = url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
    const isWhatsApp = url.startsWith('https://graph.facebook.com/v19.0/') && url.endsWith('/messages');
    if (!isGmail && !isWhatsApp) throw new Error(`v71b: no provider traffic (${url})`);
    if (transientFailures > 0) {
      transientFailures -= 1;
      return new Response(isGmail ? 'temporarily unavailable' : JSON.stringify({ error: { message: 'temporarily unavailable' } }), { status: 503 });
    }
    sendCount += 1;
    return new Response(
      JSON.stringify(isGmail ? { id: `${P}gmail_${sendCount}` } : { messages: [{ id: `${P}wamid_${sendCount}` }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as any);

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe, Logger } = await import('@nestjs/common');
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

  // Every log line, through the Nest logger (instance and static) and the console, is recorded (DTD-04).
  const record = (args: unknown[]) =>
    logLines.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack ?? ''}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  for (const level of ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const) {
    if (typeof (Logger.prototype as any)[level] === 'function') {
      const original = (Logger.prototype as any)[level];
      vi.spyOn(Logger.prototype as any, level).mockImplementation(function (this: unknown, ...args: unknown[]) { record(args); return original.apply(this, args); });
    }
    if (typeof (Logger as any)[level] === 'function') {
      const original = (Logger as any)[level];
      vi.spyOn(Logger as any, level).mockImplementation((...args: unknown[]) => { record(args); return original.apply(Logger, args); });
    }
  }
  for (const level of ['log', 'error', 'warn', 'info', 'debug'] as const) {
    const original = console[level];
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { record(args); return original.apply(console, args as any); });
  }

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
  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'V71B Biz', ownerId: ID.owner } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' } });
  await db.contact.create({
    data: {
      id: ID.cVip, businessId: ID.biz, firstName: 'Vip', lastName: 'Client', tags: ['vip'],
      email: VIP_EMAIL, phone: VIP_PHONE, visibility: 'TEAM', marketingOptIn: true, doNotContact: false,
    },
  });
}, 180_000);

afterAll(async () => {
  await sleep(1200);
  vi.restoreAllMocks();
  if (app) await app.close();
  if (db) await cleanup();
});

/** A Gmail sending account the owner binds through POST connections; the token is stored encrypted. */
async function bindGmail(mailbox: string) {
  const token = secret(P, mailbox, 'oauth', String(Date.now()));
  plaintexts.push(token);
  const res = await send('post', `${comms}/connections`, ID.owner, {
    provider: 'EMAIL', label: mailbox, accountEmail: `${P}${mailbox}@biz.example`, token,
  });
  expect(res.status, said(res)).toBe(201);
  const id = res.body.id as string;
  const dest = (await db.channelDestination.findFirst({ where: { connectionId: id } }))?.id as string;
  expect(dest, 'the EMAIL connection has its sending destination').toBeTruthy();
  return { id, dest, token };
}

/** A WhatsApp sending account the owner binds through POST connections (phone number given, so nothing is discovered over the network). */
async function bindWhatsApp() {
  const token = secret(P, 'waba', 'access', String(Date.now()));
  plaintexts.push(token);
  const res = await send('post', `${comms}/connections`, ID.owner, {
    provider: 'WHATSAPP', label: 'V71B WhatsApp', token,
    providerMeta: { phoneNumber: '+18685550071', phoneNumberId: PHONE_NUMBER_ID },
  });
  expect(res.status, said(res)).toBe(201);
  const id = res.body.id as string;
  const dest = (await db.channelDestination.findFirst({ where: { connectionId: id } }))?.id as string;
  expect(dest, 'the WHATSAPP connection has its phone-number destination').toBeTruthy();
  return { id, dest, token };
}

async function newsletter(subject: string) {
  const res = await send('post', `${comms}/content`, ID.owner, {
    contentType: 'email_newsletter', subject, body: `News: ${subject}`, contentMeta: { segmentTags: ['vip'] },
    variants: [{ platform: 'EMAIL', textBody: `News: ${subject}` }],
  });
  expect(res.status, said(res)).toBe(201);
  return res.body.id as string;
}

async function whatsappMessage(text: string) {
  const res = await send('post', `${comms}/content`, ID.owner, {
    contentType: 'whatsapp_message', body: text, contentMeta: { segmentTags: ['vip'] },
    variants: [{ platform: 'WHATSAPP', textBody: text }],
  });
  expect(res.status, said(res)).toBe(201);
  return res.body.id as string;
}

async function publish(contentId: string, dest: string) {
  const res = await send('post', `${comms}/content/${contentId}/publish`, ID.owner, { destinationIds: [dest] });
  expect(res.status, said(res)).toBe(201);
  expect(res.body.queued, said(res)).toBe(1);
  return res;
}

describe('a queued send goes out under the token the connection was saved with', () => {
  it('[DTD-01] RED-BEFORE: the owner binds a Gmail account (stored encrypted) and publishes a newsletter; the queued send goes out with Authorization "Bearer <the saved token>", not the stored ciphertext, and the delivery is Published', async () => {
    const gmail = await bindGmail('mailbox');
    const stored = await storedToken(gmail.id);
    expect(stored.startsWith(CIPHER_PREFIX), 'characterisation: the token is encrypted at rest').toBe(true);
    expect(stored).not.toBe(gmail.token);

    const contentId = await newsletter('Gmail send');
    const before = gmailSends().length;
    await publish(contentId, gmail.dest);
    await runTick();

    const sends = gmailSends().slice(before);
    expect(sends.length, 'one Gmail send was tapped').toBe(1);
    expect(mimeOf(sends[0])).toContain(`To: ${VIP_EMAIL}`);
    expect(sends[0].auth.startsWith(`Bearer ${CIPHER_PREFIX}`), 'the stored ciphertext went out as the bearer').toBe(false);
    expect(sends[0].auth, 'the bearer is the token the connection was saved with').toBe(`Bearer ${gmail.token}`);
    const [delivery] = await deliveriesOf(contentId);
    expect(delivery.status, `${delivery.errorCode}: ${delivery.errorMessage}`).toBe('Published');
  });

  it('[DTD-02] RED-BEFORE: the owner binds a WhatsApp account (stored encrypted) and publishes a WhatsApp message; the queued send goes to the phone number id with Authorization "Bearer <the saved token>", and the delivery is Published', async () => {
    const wa = await bindWhatsApp();
    const stored = await storedToken(wa.id);
    expect(stored.startsWith(CIPHER_PREFIX), 'characterisation: the token is encrypted at rest').toBe(true);

    const contentId = await whatsappMessage('Your order is ready');
    const before = whatsappSends().length;
    await publish(contentId, wa.dest);
    await runTick();

    const sends = whatsappSends().slice(before);
    expect(sends.length, 'one WhatsApp send was tapped').toBe(1);
    expect(JSON.parse(sends[0].body).to).toBe(VIP_PHONE);
    expect(sends[0].auth.startsWith(`Bearer ${CIPHER_PREFIX}`), 'the stored ciphertext went out as the bearer').toBe(false);
    expect(sends[0].auth, 'the bearer is the token the connection was saved with').toBe(`Bearer ${wa.token}`);
    const [delivery] = await deliveriesOf(contentId);
    expect(delivery.status, `${delivery.errorCode}: ${delivery.errorMessage}`).toBe('Published');
  });
});

describe('every way a delivery is claimed again sends the saved token', () => {
  it('[DTD-03] RED-BEFORE: a Gmail send the provider answers 503 goes RetryPending; when its retry is due the queue claims it again (processRetryDeliveries) and the second send carries the saved token too', async () => {
    const gmail = await bindGmail('retrybox');
    const contentId = await newsletter('Transient');
    const before = gmailSends().length;
    transientFailures = 1;
    await publish(contentId, gmail.dest);
    await runTick();
    const [pending] = await deliveriesOf(contentId);
    expect(pending.status, `${pending.errorCode}: ${pending.errorMessage}`).toBe('RetryPending');

    await db.outboundDelivery.update({ where: { id: pending.id }, data: { nextRetryAt: new Date(Date.now() - 1000) } });
    await runTick();

    const sends = gmailSends().slice(before);
    expect(sends.length, 'the first send and its retry were tapped').toBe(2);
    for (const s of sends) expect(s.auth).toBe(`Bearer ${gmail.token}`);
    const [done] = await deliveriesOf(contentId);
    expect(done.status, `${done.errorCode}: ${done.errorMessage}`).toBe('Published');
  });

  it('[DTD-04] RED-BEFORE: a failed Gmail and a failed WhatsApp delivery re-sent by the owner (POST deliveries/:id/retry, POST content/:id/retry-all) go out under the saved tokens', async () => {
    const gmail = await bindGmail('manualbox');
    const wa = await bindWhatsApp();
    const mailId = await newsletter('Manual retry');
    const waId = await whatsappMessage('Manual retry');
    transientFailures = 0;
    const gBefore = gmailSends().length;
    const wBefore = whatsappSends().length;
    await publish(mailId, gmail.dest);
    await publish(waId, wa.dest);
    await runTick();
    const [mail] = await deliveriesOf(mailId);
    const [wam] = await deliveriesOf(waId);
    // Both went out once; mark them failed as a provider error would have.
    for (const d of [mail, wam]) {
      await db.outboundDelivery.update({ where: { id: d.id }, data: { status: 'Failed', errorCode: 'EMAIL_ERROR', errorMessage: 'provider error' } });
    }

    const retry = await send('post', `${comms}/deliveries/${mail.id}/retry`, ID.owner, {});
    expect(retry.status, said(retry)).toBe(201);
    const retryAll = await send('post', `${comms}/content/${waId}/retry-all`, ID.owner, {});
    expect([200, 201], said(retryAll)).toContain(retryAll.status);
    expect(retryAll.body.retried, said(retryAll)).toBe(1);
    await runTick();

    const g = gmailSends().slice(gBefore);
    const w = whatsappSends().slice(wBefore);
    expect(g.length, 'the Gmail send and its manual retry').toBe(2);
    expect(w.length, 'the WhatsApp send and its retry-all').toBe(2);
    for (const s of g) expect(s.auth).toBe(`Bearer ${gmail.token}`);
    for (const s of w) expect(s.auth).toBe(`Bearer ${wa.token}`);
    expect((await deliveriesOf(mailId))[0].status).toBe('Published');
    expect((await deliveriesOf(waId))[0].status).toBe('Published');
  });

  it('[DTD-05] control: a connection whose token predates encryption (stored as plaintext) still sends with that token', async () => {
    const gmail = await bindGmail('legacybox');
    const legacy = secret(P, 'legacy', 'plain', String(Date.now()));
    await db.$executeRawUnsafe('UPDATE channel_connections SET token = $1 WHERE id = $2', legacy, gmail.id);
    const contentId = await newsletter('Legacy');
    const before = gmailSends().length;
    await publish(contentId, gmail.dest);
    await runTick();
    const sends = gmailSends().slice(before);
    expect(sends.length).toBe(1);
    expect(sends[0].auth).toBe(`Bearer ${legacy}`);
  });
});

describe('the decrypted token stays on the wire to the provider', () => {
  it('[DTD-06] no HTTP response, log line, database row of the business (any table with a business_id, and the delivery events) or connection read carries a saved plaintext token; the connection rows still hold ciphertext', async () => {
    expect(plaintexts.length, 'the cases above saved tokens').toBeGreaterThanOrEqual(5);

    // The reads a member makes after the sends: connections, destinations, a content's delivery summary and a
    // delivery's events. (GET deliveries, the delivery log, answers 500 on this base for a reason of its own: it
    // selects ChannelDestination.label, which is not a column. Recorded as an open issue, not part of this packet.)
    const anyDelivery = await db.outboundDelivery.findFirst({ where: { businessId: ID.biz } });
    const reads = [
      await send('get', `${comms}/connections`, ID.owner),
      await send('get', `${comms}/destinations`, ID.owner),
      await send('get', `${comms}/content/${anyDelivery.contentId}/delivery-summary`, ID.owner),
      await send('get', `${comms}/deliveries/${anyDelivery.id}/events`, ID.owner),
    ];
    for (const r of reads) expect(r.status, said(r)).toBe(200);

    for (const token of plaintexts) {
      expect(responses.filter((r) => r.includes(token)), 'an HTTP response carried a plaintext token').toEqual([]);
      expect(logLines.filter((l) => l.includes(token)), 'a log line carried a plaintext token').toEqual([]);
    }
    for (const r of reads) expect(r.text).not.toContain(CIPHER_PREFIX);

    // Every row of the business, in every table with a business_id column, and every delivery event.
    const tables = (await db.$queryRawUnsafe(
      "SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'business_id' AND data_type IN ('text', 'character varying')",
    )) as Array<{ table_name: string }>;
    expect(tables.length, 'the table scan found the business tables').toBeGreaterThan(50);
    const carriers: string[] = [];
    for (const token of plaintexts) {
      // The DTD-05 connection was given a plaintext token on purpose; the saved tokens are what is searched for.
      for (const { table_name } of tables) {
        const [{ n }] = (await db.$queryRawUnsafe(
          `SELECT count(*)::int AS n FROM "${table_name}" t WHERE t.business_id LIKE ${sqlLikePrefix(P)} AND strpos(row_to_json(t)::text, $1) > 0`,
          token,
        )) as Array<{ n: number }>;
        if (n > 0) carriers.push(`${table_name}: ${n}`);
      }
      const [{ n: ev }] = (await db.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM delivery_events e JOIN outbound_deliveries d ON d.id = e.delivery_id WHERE d.business_id LIKE ${sqlLikePrefix(P)} AND strpos(row_to_json(e)::text, $1) > 0`,
        token,
      )) as Array<{ n: number }>;
      if (ev > 0) carriers.push(`delivery_events: ${ev}`);
    }
    expect(carriers, 'a stored row carries a plaintext token').toEqual([]);

    const stored = (await db.$queryRawUnsafe(
      `SELECT id, token FROM channel_connections WHERE business_id LIKE ${sqlLikePrefix(P)} ORDER BY id`,
    )) as Array<{ id: string; token: string }>;
    const encrypted = stored.filter((c) => c.token.startsWith(CIPHER_PREFIX));
    expect(encrypted.length, 'every connection bound through the route holds ciphertext (the DTD-05 legacy row aside)').toBe(stored.length - 1);
  });
});
