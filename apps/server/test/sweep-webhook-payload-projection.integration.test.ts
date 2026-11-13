/**
 * SWEEP-P0-SCOPES round 1 class repair, CLASS A — an outbound webhook delivers no more than its
 * subscriber may read, for EVERY event the server sends, against a REAL database.
 *
 * The reviews found the class one family at a time. SV-1: booking.* delivered the booking's whole
 * Contact row (a PRIVATE contact's owner, internal note and money signals) to a bookings-read
 * member's URL; the repair projected booking.* only. RC-1: invoice.* still delivered it, because
 * InvoiceWorkflowService reads the invoice with include { contact: true, booking: true } and the
 * dispatcher passed payload.invoice through unchanged; a revenue-read member with crm none received
 * the 76-key Contact row the invoice routes answer as { firstName, lastName, email }.
 *
 * The rule this suite pins: the dispatcher (WebhookDispatcherService.dispatch, the one door every
 * delivery goes through) projects the WHOLE payload, recursively, whatever the family:
 *   - a person row (under contact, customer, client, lead, owner, member, user, staff, author, ...
 *     or any row carrying a Contact's or a User's own columns) is delivered as the fixed person
 *     view, its id, firstName, lastName, name and email, never a private CRM field, a money signal
 *     (D-100) or a credential;
 *   - a row of another module the subscriber's event does not read (a booking inside an invoice, an
 *     invoice inside a booking) is delivered as its id only;
 *   - a key that holds a credential or a contact's private field is never delivered, at any depth;
 *   - every family the dispatcher sends has a read rule (webhook-events.ts), so its subscriber was
 *     checked at create and re-enable.
 *
 * The events are not a hand list: they are the dispatcher's @OnEvent listeners, read from Nest's
 * metadata and from the source text (the two must agree), plus every event name the server source
 * emits whose family is a webhook family. One webhook is subscribed to all of them and each is
 * emitted through the real EventEmitter2 with a payload that embeds a PRIVATE contact, read whole
 * from the database, at every key a listener reads and a few more.
 *
 * Nothing on the delivery path is mocked except the network send itself (sendWithLogging is
 * spied, so nothing leaves the machine; every URL is in 203.0.113.0/24, TEST-NET-3).
 *
 * Requires DATABASE_URL. Every seeded row carries the `v99p_` prefix and is hard-deleted by raw SQL
 * (sqlLikePrefix) in beforeAll and afterAll. Cases tagged RED-BEFORE fail on the unmodified code.
 */
import 'reflect-metadata';
import path from 'path';
import { readFileSync, readdirSync } from 'fs';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v99p_';
const ID = { owner: `${P}owner`, bizA: `${P}bizA`, contact: `${P}c_private`, service: `${P}svc`, booking: `${P}bk`, invoice: `${P}inv`, order: `${P}ord` };
const SRC = path.resolve(__dirname, '../src');
const DISPATCHER_FILE = path.join(SRC, 'modules/webhooks/webhook-dispatcher.service.ts');

/** The fields a person row may be delivered with (the fixed view). */
const PERSON_VIEW = new Set(['id', 'firstName', 'lastName', 'name', 'email']);
/** The keys under which a payload carries a person row. */
const PERSON_KEYS = ['contact', 'contacts', 'customer', 'client', 'lead', 'owner', 'member', 'user', 'staff', 'author', 'createdBy', 'assignee'];
/** Named by the class finding: never in a delivery, at any depth. */
const NAMED_PRIVATE = ['visibility', 'ownerId', 'notesInternal', 'lifetimeValue', 'averageSpend', 'paymentReliability', 'riskFlags'];
/** Values seeded on the PRIVATE contact that must never leave. */
const SECRET_VALUES = ['Owner-only note: negotiating 40% discount', '98765.43', '4321.09', 'PRIVATE', 'poor_payment_history', '+18685550199', 'v99p_secret_token'];

let db: any;
let app: any;
let dispatcher: any;
let events: any;
let Prisma: any;
let WEBHOOK_EVENT_FAMILY_MODULES: Record<string, string> = {};

async function cleanup() {
  for (const sql of [
    `DELETE FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM webhooks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/** The events the dispatcher listens to, from Nest's @OnEvent metadata on its prototype. */
function dispatcherEventsFromMetadata(cls: any, metadataKey: string): string[] {
  const out = new Set<string>();
  for (const name of Object.getOwnPropertyNames(cls.prototype)) {
    const fn = cls.prototype[name];
    if (typeof fn !== 'function') continue;
    const meta = Reflect.getMetadata(metadataKey, fn) as Array<{ event: string | string[] }> | undefined;
    for (const m of meta ?? []) for (const e of [m.event].flat()) out.add(String(e));
  }
  return [...out].sort();
}

/** The same, read from the source text. */
function dispatcherEventsFromSource(): string[] {
  const text = readFileSync(DISPATCHER_FILE, 'utf8');
  return [...new Set([...text.matchAll(/@OnEvent\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]))].sort();
}

/** Every literal event name the server source emits (emit / emitAsync), any module. */
function emittedEventNames(): string[] {
  const out = new Set<string>();
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\.emit(?:Async)?\(\s*['"]([a-z_]+\.[a-z_.]+)['"]/g)) out.add(m[1]);
  }
  return [...out].sort();
}

/** The rows a webhook delivers whole (the subjects of the dispatcher's families and their own lines). */
const DELIVERED_MODELS = ['Invoice', 'InvoiceItem', 'Booking', 'Service', 'MarketplaceOrder', 'MarketplaceOrderItem', 'Shipment', 'Product', 'SocialPost'];

/**
 * The Contact's columns (the Prisma datamodel) outside the person view that no delivered row has:
 * a delivery key that names one can only be a contact's (visibility, ownerId, notesInternal, the
 * money signals, the lead score, the phone, the address, ...).
 */
function contactOnlyKeys(): string[] {
  const models: Array<{ name: string; fields: Array<{ name: string; kind: string }> }> = Prisma.dmmf.datamodel.models;
  const contact = models.find((m) => m.name === 'Contact')!;
  const delivered = new Set(models.filter((m) => DELIVERED_MODELS.includes(m.name)).flatMap((m) => m.fields.filter((f) => f.kind === 'scalar').map((f) => f.name)));
  return contact.fields.filter((f) => f.kind === 'scalar' && !delivered.has(f.name) && !PERSON_VIEW.has(f.name)).map((f) => f.name);
}

/** Every [path, object] in a delivery body. */
function objectsIn(value: unknown, at = 'body', out: Array<[string, Record<string, unknown>]> = []) {
  if (Array.isArray(value)) value.forEach((v, i) => objectsIn(v, `${at}[${i}]`, out));
  else if (value && typeof value === 'object') {
    out.push([at, value as Record<string, unknown>]);
    for (const [k, v] of Object.entries(value)) objectsIn(v, `${at}.${k}`, out);
  }
  return out;
}

/** The leaks in one delivery body, as readable lines. */
function leaksIn(body: unknown, privateKeys: string[]): string[] {
  const problems: string[] = [];
  const text = JSON.stringify(body);
  for (const v of SECRET_VALUES) if (text.includes(v)) problems.push(`carries the value ${v}`);
  for (const [at, obj] of objectsIn(body)) {
    for (const key of Object.keys(obj)) {
      if (NAMED_PRIVATE.includes(key) || privateKeys.includes(key)) problems.push(`${at}.${key} is a contact's private field`);
      if (/password|secret|token|apikey|credential|encrypted/i.test(key)) problems.push(`${at}.${key} names a credential`);
    }
    const last = at.replace(/\[\d+\]$/, '').split('.').pop() ?? '';
    if (PERSON_KEYS.includes(last)) {
      const extra = Object.keys(obj).filter((k) => !PERSON_VIEW.has(k));
      if (extra.length) problems.push(`${at} (a person row) carries ${extra.join(', ')}`);
    }
  }
  return problems;
}

async function capture(run: () => Promise<void>) {
  const sent: Array<{ webhookId: string; event: string; body: any }> = [];
  const spy = vi.spyOn(dispatcher as any, 'sendWithLogging').mockImplementation((async (wh: any, event: string, _ts: string, body: string) => {
    sent.push({ webhookId: wh.id, event, body: JSON.parse(body) });
    return { status: 'success' } as any;
  }) as any);
  try {
    await run();
    // Listeners run as the emitter calls them; give any async listener a turn to settle.
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    spy.mockRestore();
  }
  return sent;
}

let contactRow: any;
let ownerRow: any;

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  Prisma = (await import('@prisma/client')).Prisma;

  const { Test } = await import('@nestjs/testing');
  const { EventEmitterModule, EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { WebhookDispatcherService } = await import('../src/modules/webhooks/webhook-dispatcher.service');
  WEBHOOK_EVENT_FAMILY_MODULES = (await import('../src/modules/webhooks/webhook-events')).WEBHOOK_EVENT_FAMILY_MODULES as Record<string, string>;

  const moduleRef = await Test.createTestingModule({
    imports: [EventEmitterModule.forRoot({ wildcard: false })],
    providers: [PrismaService, WebhookDispatcherService],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  dispatcher = moduleRef.get(WebhookDispatcherService);
  events = moduleRef.get(EventEmitter2);

  await cleanup();
  ownerRow = await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'V99P Biz A', ownerId: ID.owner } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.bizA, role: 'OWNER' } });
  contactRow = await db.contact.create({
    data: {
      id: ID.contact,
      businessId: ID.bizA,
      firstName: 'Private',
      lastName: 'Client',
      email: `${P}private@client.example`,
      phone: '+18685550199',
      visibility: 'PRIVATE',
      ownerId: ID.owner,
      notesInternal: 'Owner-only note: negotiating 40% discount',
      lifetimeValue: 98765.43,
      averageSpend: 4321.09,
      paymentReliability: 37,
      riskFlags: ['poor_payment_history'],
      leadScore: 91,
    },
  });
  await db.service.create({ data: { id: ID.service, businessId: ID.bizA, name: `${P}Consult`, duration: 60, price: 250 } });
  const startTime = new Date(Date.UTC(2031, 5, 1, 14, 0, 0));
  await db.booking.create({ data: { id: ID.booking, businessId: ID.bizA, contactId: ID.contact, serviceId: ID.service, startTime, endTime: new Date(startTime.getTime() + 3_600_000), notes: `${P}booking note` } });
  await db.invoice.create({
    data: {
      id: ID.invoice,
      businessId: ID.bizA,
      contactId: ID.contact,
      invoiceNumber: `${P}INV-1`,
      status: 'SENT',
      subtotal: 250,
      total: 250,
      currency: 'TTD',
      issueDate: new Date(),
      items: { create: [{ id: `${P}item`, description: 'Consult', quantity: 1, unitPrice: 250, total: 250 }] },
    },
  });
  await db.booking.update({ where: { id: ID.booking }, data: { invoiceId: ID.invoice } });
  await db.marketplaceOrder.create({
    data: { id: ID.order, businessId: ID.bizA, orderNumber: `${P}ORD-1`, status: 'shipped', type: 'STANDARD', customerName: 'Private Client', customerEmail: `${P}private@client.example`, subtotal: 250, shippingFee: 0, taxAmount: 0, dutyAmount: 0, discountAmount: 0, total: 250, currency: 'TTD', paymentStatus: 'PAID' },
  });
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

/** A payload that embeds the PRIVATE contact (read whole, as the services read it) wherever a listener might look. */
async function poisoned(eventName: string) {
  const contact = await db.contact.findUnique({ where: { id: ID.contact } });
  const booking = await db.booking.findUnique({ where: { id: ID.booking }, include: { contact: true, service: true, invoice: true } });
  // As InvoiceWorkflowService reads it (RC-1): include { items, contact: true, booking: true }.
  const invoice = await db.invoice.findUnique({ where: { id: ID.invoice }, include: { items: true, contact: true, booking: true } });
  const order = await db.marketplaceOrder.findUnique({ where: { id: ID.order }, include: { items: true } });
  const owner = { ...ownerRow, passwordHash: 'v99p_secret_token' };
  return {
    businessId: ID.bizA,
    eventName,
    contact,
    duplicateId: `${P}c_dup`,
    fromStatus: 'LEAD',
    toStatus: 'CUSTOMER',
    status: 'SENT',
    previousStatus: 'PAID',
    invoice: { ...invoice, customer: contact },
    booking: { ...booking, staff: { id: `${P}staff`, name: 'Staff One', email: `${P}staff@test.local`, accessToken: 'v99p_secret_token' } },
    order: { ...order, contact, customer: contact, metadata: { checkoutToken: 'v99p_secret_token' } },
    post: { id: `${P}post`, content: 'Hello', status: 'PUBLISHED', author: contact, owner },
    quote: { id: `${P}quote`, total: 10, contact },
    lead: contact,
    client: contact,
    member: owner,
    nested: { deeper: { contacts: [contact, contact] } },
  };
}

describe('CLASS A: every event the server delivers is derived from the source and has a read rule', () => {
  it('[WPP-01] the dispatcher\'s listeners, read from Nest\'s @OnEvent metadata, are the ones its source declares, and there are many (guards the guard)', async () => {
    const { WebhookDispatcherService } = await import('../src/modules/webhooks/webhook-dispatcher.service');
    const { EVENT_LISTENER_METADATA } = await import('@nestjs/event-emitter/dist/constants');
    const fromMeta = dispatcherEventsFromMetadata(WebhookDispatcherService, EVENT_LISTENER_METADATA);
    expect(fromMeta).toEqual(dispatcherEventsFromSource());
    expect(fromMeta.length).toBeGreaterThanOrEqual(16);
    expect(fromMeta).toEqual(expect.arrayContaining(['contact.created', 'invoice.paid', 'invoice.sent', 'booking.created', 'store_order.created', 'post.published']));
  });

  it('[WPP-02] every family the dispatcher delivers maps to the module its subscriber must read (webhook-events.ts), so the create and re-enable checks cover it', () => {
    const families = [...new Set(dispatcherEventsFromSource().map((e) => e.slice(0, e.indexOf('.'))))];
    const unmapped = families.filter((f) => !Object.prototype.hasOwnProperty.call(WEBHOOK_EVENT_FAMILY_MODULES, f));
    expect(unmapped).toEqual([]);
  });
});

describe('CLASS A: one choke point projects every delivery (RC-1 and its siblings)', () => {
  it('[WPP-03] RED-BEFORE: a webhook subscribed to every event the dispatcher delivers and every webhook-family event the server emits receives, for each one, no contact row beyond { id, firstName, lastName, email }, no private CRM field or money signal of a PRIVATE contact, and no credential, wherever the payload carries them', async () => {
    const dispatched = dispatcherEventsFromSource();
    const emitted = emittedEventNames().filter((e) => Object.prototype.hasOwnProperty.call(WEBHOOK_EVENT_FAMILY_MODULES, e.slice(0, e.indexOf('.'))));
    const all = [...new Set([...dispatched, ...emitted])].sort();
    expect(emitted.length, 'the source scan sees the emitters (guards the guard)').toBeGreaterThan(20);
    const wh = await db.webhook.create({ data: { id: `${P}wh_all`, businessId: ID.bizA, name: `${P}every event`, url: 'https://203.0.113.90/v99p-all', events: all, secret: `${P}whsecret_${'a'.repeat(40)}`, isActive: true } });
    const privateKeys = contactOnlyKeys();
    expect(privateKeys, 'the datamodel scan sees the contact columns (guards the guard)').toEqual(expect.arrayContaining(['notesInternal', 'lifetimeValue', 'paymentReliability']));

    const sent = await capture(async () => {
      for (const name of all) await events.emitAsync(name, await poisoned(name));
    });
    const mine = sent.filter((s) => s.webhookId === wh.id);
    // every event the dispatcher listens to was delivered (store_order.paid: the seeded order is stored PAID)
    expect([...new Set(mine.map((s) => s.event))].sort()).toEqual(dispatched);
    const problems = mine.flatMap((s) => leaksIn(s.body, privateKeys).map((p) => `${s.event}: ${p}`));
    expect(problems).toEqual([]);
    await db.webhook.delete({ where: { id: wh.id } });
  });

  it('[WPP-04] RED-BEFORE (RC-1): invoice.sent, invoice.paid, invoice.overdue and invoice.reopened deliver the invoice\'s contact as the invoice routes answer it ({ firstName, lastName, email } and its id), and the booking inside the invoice (bookings, which a revenue-read subscriber was not checked for) as its id only', async () => {
    const wh = await db.webhook.create({ data: { id: `${P}wh_inv`, businessId: ID.bizA, name: `${P}invoices`, url: 'https://203.0.113.91/v99p-inv', events: ['invoice.sent', 'invoice.paid', 'invoice.overdue', 'invoice.reopened'], secret: `${P}whsecret_${'b'.repeat(40)}`, isActive: true } });
    const invoice = await db.invoice.findUnique({ where: { id: ID.invoice }, include: { items: true, contact: true, booking: true } });
    expect(invoice.contact.notesInternal, 'the stand-in reads the contact whole, as InvoiceWorkflowService does').toContain('Owner-only note');
    const sent = await capture(async () => {
      await events.emitAsync('invoice.sent', { invoice, businessId: ID.bizA, status: 'SENT' });
      await events.emitAsync('invoice.paid', { invoice, businessId: ID.bizA, eventName: 'invoice.paid' });
      await events.emitAsync('invoice.overdue', { invoice, businessId: ID.bizA, status: 'OVERDUE' });
      await events.emitAsync('invoice.reopened', { invoice, businessId: ID.bizA, status: 'SENT', previousStatus: 'PAID' });
    });
    const mine = sent.filter((s) => s.webhookId === wh.id);
    expect(mine.map((s) => s.event).sort()).toEqual(['invoice.overdue', 'invoice.paid', 'invoice.reopened', 'invoice.sent']);
    for (const d of mine) {
      expect(d.body.data.invoice.contact, d.event).toEqual({ id: ID.contact, firstName: 'Private', lastName: 'Client', email: `${P}private@client.example` });
      expect(d.body.data.invoice.booking, d.event).toEqual({ id: ID.booking });
      expect(d.body.data.invoice.id, d.event).toBe(ID.invoice);
      expect(d.body.data.invoice.total, d.event).toBe(250);
      expect(d.body.data.invoice.items?.[0]?.description, d.event).toBe('Consult');
      expect(leaksIn(d.body, contactOnlyKeys()), d.event).toEqual([]);
    }
    await db.webhook.delete({ where: { id: wh.id } });
  });

  it('[WPP-05] RED-BEFORE: a booking event delivers the booking\'s invoice (revenue, which a bookings-read subscriber was not checked for) as its id only, its staff member as the person view, and the booking\'s own fields as the bookings routes answer them', async () => {
    const wh = await db.webhook.create({ data: { id: `${P}wh_bk`, businessId: ID.bizA, name: `${P}bookings`, url: 'https://203.0.113.92/v99p-bk', events: ['booking.created', 'booking.completed'], secret: `${P}whsecret_${'c'.repeat(40)}`, isActive: true } });
    const booking = await db.booking.findUnique({ where: { id: ID.booking }, include: { contact: true, service: true, invoice: true } });
    expect(booking.invoice?.id).toBe(ID.invoice);
    const staff = { id: `${P}staff`, name: 'Staff One', email: `${P}staff@test.local`, phone: '+18685550100', userId: ID.owner };
    const sent = await capture(async () => {
      await events.emitAsync('booking.created', { booking: { ...booking, staff }, contact: booking.contact, businessId: ID.bizA });
      await events.emitAsync('booking.completed', { booking: { ...booking, staff }, contact: booking.contact, businessId: ID.bizA });
    });
    const mine = sent.filter((s) => s.webhookId === wh.id);
    expect(mine.map((s) => s.event).sort()).toEqual(['booking.completed', 'booking.created']);
    for (const d of mine) {
      expect(d.body.data.booking.invoice, d.event).toEqual({ id: ID.invoice });
      expect(d.body.data.booking.staff, d.event).toEqual({ id: `${P}staff`, name: 'Staff One', email: `${P}staff@test.local` });
      expect(d.body.data.booking.contact, d.event).toEqual({ id: ID.contact, firstName: 'Private', lastName: 'Client', email: `${P}private@client.example` });
      expect(d.body.data.booking.notes, d.event).toBe(`${P}booking note`);
      expect(d.body.data.booking.service?.name, d.event).toBe(`${P}Consult`);
    }
    await db.webhook.delete({ where: { id: wh.id } });
  });

  it('[WPP-06] RED-BEFORE: a contact event delivers the contact as the fixed person view too (the subject row, not only an embedded one): no phone, owner, visibility, internal note, money signal or lead score', async () => {
    const wh = await db.webhook.create({ data: { id: `${P}wh_ct`, businessId: ID.bizA, name: `${P}contacts`, url: 'https://203.0.113.93/v99p-ct', events: ['contact.created', 'contact.updated', 'contact.merged'], secret: `${P}whsecret_${'d'.repeat(40)}`, isActive: true } });
    const contact = await db.contact.findUnique({ where: { id: ID.contact } });
    const sent = await capture(async () => {
      await events.emitAsync('contact.created', { contact, businessId: ID.bizA });
      await events.emitAsync('contact.updated', { contact, businessId: ID.bizA, fromStatus: 'LEAD', toStatus: 'CUSTOMER' });
      await events.emitAsync('contact.merged', { contact, businessId: ID.bizA, duplicateId: `${P}c_dup` });
    });
    const mine = sent.filter((s) => s.webhookId === wh.id);
    expect(mine.map((s) => s.event).sort()).toEqual(['contact.created', 'contact.merged', 'contact.updated']);
    for (const d of mine) {
      expect(d.body.data.contact, d.event).toEqual({ id: ID.contact, firstName: 'Private', lastName: 'Client', email: `${P}private@client.example` });
      expect(leaksIn(d.body, contactOnlyKeys()), d.event).toEqual([]);
    }
    expect(mine.find((d) => d.event === 'contact.updated')?.body.data).toMatchObject({ fromStatus: 'LEAD', toStatus: 'CUSTOMER' });
    expect(mine.find((d) => d.event === 'contact.merged')?.body.data.mergedContactId).toBe(`${P}c_dup`);
    await db.webhook.delete({ where: { id: wh.id } });
  });
  it('[WPP-07] RED-BEFORE (round 2, WHP-3): the event record\'s own JSON columns are delivered as read: a store order\'s shipping and billing address that names its recipient keeps its street, city and phone (only a person row is the person view; an address is not one)', async () => {
    const wh = await db.webhook.create({ data: { id: `${P}wh_ord`, businessId: ID.bizA, name: `${P}orders`, url: 'https://203.0.113.94/v99p-ord', events: ['store_order.created', 'store_order.shipped'], secret: `${P}whsecret_${'e'.repeat(40)}`, isActive: true } });
    const shippingAddress = { street: '1 Private Lane', city: 'POS', firstName: 'Private', lastName: 'Client', phone: '+18685551234' };
    const billingAddress = { line1: '2 Billing Road', city: 'San Fernando', firstName: 'Bill', lastName: 'Payer', postalCode: '00000' };
    const order = { ...(await db.marketplaceOrder.findUnique({ where: { id: ID.order }, include: { items: true } })), shippingAddress, billingAddress, metadata: { giftNote: 'For Private Client', recipient: { firstName: 'Private', lastName: 'Client', phone: '+18685551234' } } };
    const sent = await capture(async () => {
      await events.emitAsync('store_order.created', { order, businessId: ID.bizA });
      await events.emitAsync('store_order.shipped', { order, businessId: ID.bizA });
    });
    const mine = sent.filter((s) => s.webhookId === wh.id);
    expect(mine.map((s) => s.event).sort()).toEqual(['store_order.created', 'store_order.shipped']);
    for (const d of mine) {
      expect(d.body.data.order.shippingAddress, d.event).toEqual(shippingAddress);
      expect(d.body.data.order.billingAddress, d.event).toEqual(billingAddress);
      expect(d.body.data.order.metadata.giftNote, d.event).toBe('For Private Client');
      // a person key inside the record is still the person view
      expect(d.body.data.order.metadata.recipient, d.event).toEqual({ firstName: 'Private', lastName: 'Client' });
    }
    await db.webhook.delete({ where: { id: wh.id } });
  });

  it('[WPP-08] (round 2) a Contact row under a key that is not a person key (read whole, as an include reads it) is still the person view: the Contact-only columns mark it', async () => {
    const wh = await db.webhook.create({ data: { id: `${P}wh_ord2`, businessId: ID.bizA, name: `${P}orders2`, url: 'https://203.0.113.95/v99p-ord2', events: ['store_order.delivered'], secret: `${P}whsecret_${'f'.repeat(40)}`, isActive: true } });
    const contact = await db.contact.findUnique({ where: { id: ID.contact } });
    const order = { ...(await db.marketplaceOrder.findUnique({ where: { id: ID.order } })), buyerRecord: contact, linkedRows: [contact] };
    const sent = await capture(async () => {
      await events.emitAsync('store_order.delivered', { order, businessId: ID.bizA });
    });
    const mine = sent.filter((s) => s.webhookId === wh.id);
    expect(mine.length).toBe(1);
    expect(mine[0].body.data.order.buyerRecord).toEqual({ id: ID.contact, firstName: 'Private', lastName: 'Client', email: `${P}private@client.example` });
    expect(mine[0].body.data.order.linkedRows).toEqual([{ id: ID.contact, firstName: 'Private', lastName: 'Client', email: `${P}private@client.example` }]);
    expect(leaksIn(mine[0].body, contactOnlyKeys())).toEqual([]);
    await db.webhook.delete({ where: { id: wh.id } });
  });
});
