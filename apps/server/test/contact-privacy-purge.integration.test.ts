/**
 * V1-38-CT-PRIVACY-PURGE-STATUS (CF-48, CF-49, owner ruling D-25), REAL database.
 *
 * CF-48: the GDPR forget purge (ContactPrivacyService.purgeOne) called
 * tx.contact.delete, which the soft-delete extension turns into
 * `update { deletedAt }`. The contact row kept every personal field, the child
 * rows it relied on a cascade to remove stayed (the cascade never ran), and the
 * audit trail still recorded 'GDPR purge completed'. A hard delete could not
 * work either: invoices and bookings reference the contact with ON DELETE NO
 * ACTION, because they are financial records the business must keep.
 *
 * D-25 (2026-11-02): the purge is in v1. It erases the personal fields, keeps a
 * retained-basis audit row, and a ContactAuditEntry is mandatory for every purge.
 * So the purge anonymises the contact row in place (it stays soft-deleted, as
 * the anchor the retained invoices, quotes and bookings point at), erases the
 * personal child rows, scrubs the audit trail, and writes one forget_purged
 * entry that names the retained basis and the counts, all in one transaction.
 *
 * CF-49 (Shopify half): a Shopify customer sync overwrote an existing contact's
 * status with the non-canonical 'CUSTOMER' (or downgraded it to 'LEAD'). The
 * adapter now maps a new contact into CONTACT_STATUSES and never overwrites the
 * status of one that exists. The source-scan half is
 * src/modules/crm/contact-status-vocabulary.spec.ts.
 *
 * Nothing on the boundary is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, ContactPrivacyController/Service and ContactAuditService are
 * real against DATABASE_URL. Identity is attached from an `x-test-user` header
 * for seeded v38a_ users only (the step that needs Supabase). The Shopify HTTP
 * call is the only stand-in: its credentials lookup and request are stubbed on
 * the instance, so no provider traffic leaves the process.
 *
 * Fixtures: prefix `v38a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v38a_';
const ID = {
  owner: `${P}owner`, // OWNER of bizA
  ownerB: `${P}ownerB`, // OWNER of bizB only
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  subject: `${P}subject`, // bizA: the data subject who asks to be forgotten
  bystander: `${P}bystander`, // bizA: another contact the purge must not touch
  victim: `${P}victim`, // bizA: named by bizB's forged forget request
  forged: `${P}forgedReq`,
  svc: `${P}svc`,
  inv: `${P}inv`,
  quote: `${P}quote`,
  booking: `${P}booking`,
  cfDef: `${P}cfDef`,
  tag: `${P}tag`,
  shopClient: `${P}shopClient`, // bizA, CLIENT, also a Shopify customer
  shopProspect: `${P}shopProspect`, // bizA, PROSPECT, Shopify customer with no orders
};

/** Every personal value seeded on the subject. None may survive the purge anywhere. */
const PII = {
  firstName: 'V38A-Ada',
  lastName: 'V38A-Lovelace',
  displayName: 'V38A Ada L',
  email: `${P}ada@test.local`,
  emailNormalized: `${P}ada@test.local`,
  phone: '+1 868 555 0138',
  phoneNormalized: '+18685550138',
  secondaryEmail: `${P}ada.alt@test.local`,
  secondaryPhone: '+1 868 555 0139',
  whatsappNumber: '+18685550140',
  addressLine1: 'V38A 12 Analytical Engine Rd',
  addressLine2: 'V38A Apt 1',
  city: 'V38A-Port of Spain',
  state: 'V38A-Region',
  postalCode: 'V38A-0001',
  country: 'V38A-Land',
  companyName: 'V38A Engines Ltd',
  jobTitle: 'V38A Countess',
  department: 'V38A Mathematics',
  notesInternal: 'V38A private note about Ada',
};
const CHILD_SECRETS = {
  custom: 'V38A-custom-json-secret',
  tag: 'v38a-vip-tag',
  event: 'V38A-message-secret',
  note: 'V38A-note-secret',
  task: 'V38A-task-secret',
  media: 'V38A-ocr-secret',
  cf: 'V38A-custom-field-secret',
  auditIp: '203.0.113.38',
  auditAgent: 'V38A-agent',
};
const ALL_SECRETS = [...Object.values(PII), ...Object.values(CHILD_SECRETS)];

let db: any;
let app: any;
let privacy: any; // the app's real ContactPrivacyService
let audit: any; // the app's real ContactAuditService
let shopify: any;
let ContactPrivacyServiceCtor: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM quotes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_forget_requests WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_export_jobs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_media WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_custom_field_values WHERE contact_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM custom_field_definitions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_tags WHERE contact_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM tags WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

/** The contact row as Postgres holds it (bypasses the soft-delete extension). */
async function rawContact(id: string): Promise<Record<string, unknown> | undefined> {
  const rows = await db.$queryRawUnsafe(
    `SELECT id, business_id, first_name, last_name, display_name, email, email_normalized, phone, phone_normalized,
            secondary_email, secondary_phone, whatsapp_number, address_line_1, address_line_2, city, state,
            postal_code, country, company_name, job_title, department, notes_internal, tags, custom, status,
            deleted_at, updated_at
       FROM contacts WHERE id = $1`,
    id,
  );
  return rows[0];
}

async function rawCount(table: string, column: string, value: string): Promise<number> {
  const rows = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${column} = $1`, value);
  return rows[0].n;
}

async function makeDue(contactId: string) {
  await db.$executeRawUnsafe(
    `UPDATE contact_forget_requests SET purge_at = now() - interval '1 minute' WHERE contact_id = $1`,
    contactId,
  );
}

function forget(actor: string, businessId: string, contactId: string) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${businessId}/contacts/${contactId}/forget`)
    .set('x-test-user', actor)
    .send({});
}

async function purgedEntries(businessId: string, contactId: string) {
  return db.contactAuditEntry.findMany({
    where: { businessId, contactHash: audit.hashContact(businessId, contactId), action: 'forget_purged' },
  });
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { ContactPrivacyController } = await import('../src/modules/crm/privacy/contact-privacy.controller');
  const { ContactPrivacyService } = await import('../src/modules/crm/privacy/contact-privacy.service');
  const { ContactAuditService } = await import('../src/modules/crm/privacy/contact-audit.service');
  const { ShopifyService } = await import('../src/modules/shopify/shopify.service');
  ContactPrivacyServiceCtor = ContactPrivacyService;

  const moduleRef = await Test.createTestingModule({
    controllers: [ContactPrivacyController],
    providers: [PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard, ContactAuditService, ContactPrivacyService],
  }).compile();
  app = moduleRef.createNestApplication();
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  await app.init();
  privacy = app.get(ContactPrivacyService);
  audit = app.get(ContactAuditService);

  shopify = new ShopifyService(new PrismaService() as any, { emit: () => true } as any, {} as any);
  // The only stand-in: no Shopify credentials or HTTP. Each case sets the payload.
  vi.spyOn(shopify, 'getCredentials').mockResolvedValue({ shopDomain: 'v38a-shop.invalid', accessToken: 'v38a-not-a-token', apiVersion: '2024-04' });

  await cleanup(); // in case a prior run aborted

  for (const id of [ID.owner, ID.ownerB]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V38A Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V38A Biz B', ownerId: ID.ownerB } });
  await db.membership.create({ data: { id: `${P}m_owner`, userId: ID.owner, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });

  // ---- the data subject, with every kind of personal and retained row -------
  await db.contact.create({
    data: {
      id: ID.subject,
      businessId: ID.bizA,
      ...PII,
      status: 'CLIENT',
      tags: [CHILD_SECRETS.tag],
      custom: { note: CHILD_SECRETS.custom },
      ownerId: ID.owner,
    },
  });
  await db.contactEvent.create({ data: { id: `${P}event`, businessId: ID.bizA, contactId: ID.subject, type: 'v38a.message', data: { body: CHILD_SECRETS.event } } });
  await db.contactNote.create({ data: { id: `${P}note`, businessId: ID.bizA, contactId: ID.subject, body: CHILD_SECRETS.note } });
  await db.contactTask.create({ data: { id: `${P}task`, businessId: ID.bizA, contactId: ID.subject, title: CHILD_SECRETS.task } });
  await db.contactMedia.create({ data: { id: `${P}media`, businessId: ID.bizA, contactId: ID.subject, type: 'image', url: 'https://v38a.invalid/ada.png', ocrText: CHILD_SECRETS.media } });
  await db.customFieldDefinition.create({ data: { id: ID.cfDef, businessId: ID.bizA, name: `${P}favourite`, label: 'Favourite', type: 'TEXT' } });
  await db.contactCustomFieldValue.create({ data: { id: `${P}cfv`, contactId: ID.subject, definitionId: ID.cfDef, value: CHILD_SECRETS.cf } });
  await db.tag.create({ data: { id: ID.tag, businessId: ID.bizA, name: 'v38a-segment' } });
  await db.contactTag.create({ data: { contactId: ID.subject, tagId: ID.tag } });
  await db.contactAuditEntry.create({
    data: {
      id: `${P}audit_created`,
      businessId: ID.bizA,
      contactId: ID.subject,
      contactHash: audit.hashContact(ID.bizA, ID.subject),
      action: 'created',
      actor: { type: 'USER', id: ID.owner, label: `${P}owner@test.local` },
      after: { email: PII.email, firstName: PII.firstName },
      changedFields: ['email', 'firstName'],
      ip: CHILD_SECRETS.auditIp,
      userAgent: CHILD_SECRETS.auditAgent,
    },
  });
  // Financial records with a retention basis.
  await db.service.create({ data: { id: ID.svc, businessId: ID.bizA, name: 'V38A Consult', duration: 60, price: 0 } });
  await db.invoice.create({ data: { id: ID.inv, businessId: ID.bizA, contactId: ID.subject, invoiceNumber: `${P}INV-1`, total: 120 } });
  await db.quote.create({ data: { id: ID.quote, businessId: ID.bizA, contactId: ID.subject, quoteNumber: `${P}Q-1`, total: 80 } });
  const start = new Date(Date.now() - 7 * 86_400_000);
  await db.booking.create({ data: { id: ID.booking, businessId: ID.bizA, contactId: ID.subject, serviceId: ID.svc, startTime: start, endTime: new Date(start.getTime() + 3_600_000) } });

  // ---- contacts the purge must not touch ------------------------------------
  await db.contact.create({ data: { id: ID.bystander, businessId: ID.bizA, firstName: 'V38A-Bystander', email: `${P}bystander@test.local` } });
  await db.contactNote.create({ data: { id: `${P}note_bystander`, businessId: ID.bizA, contactId: ID.bystander, body: 'V38A-bystander-note' } });
  await db.contact.create({ data: { id: ID.victim, businessId: ID.bizA, firstName: 'V38A-Victim', email: `${P}victim@test.local` } });

  // ---- Shopify customers that already exist as contacts ---------------------
  await db.contact.create({ data: { id: ID.shopClient, businessId: ID.bizA, firstName: 'V38A-Client', email: `${P}client@test.local`, status: 'CLIENT' } });
  await db.contact.create({ data: { id: ID.shopProspect, businessId: ID.bizA, firstName: 'V38A-Prospect', email: `${P}prospect@test.local`, status: 'PROSPECT' } });
}, 120_000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (app) await app.close();
  if (db) await cleanup();
});

describe('GDPR forget purge is honest (CF-48, D-25)', () => {
  it('the owner requests the forget: the contact is soft-deleted and a request is open', async () => {
    const res = await forget(ID.owner, ID.bizA, ID.subject);
    expect(res.status).toBe(201);
    const req = await db.contactForgetRequest.findUnique({ where: { contactId: ID.subject } });
    expect(req).toMatchObject({ businessId: ID.bizA, status: 'requested' });
    expect((await rawContact(ID.subject))!.deleted_at).toBeInstanceOf(Date);
  });

  it('the purge audit is mandatory: when it cannot be written, nothing is erased', async () => {
    await makeDue(ID.subject);
    // The same service over a client whose transaction cannot write a ContactAuditEntry.
    const failing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== '$transaction') return Reflect.get(target, prop, receiver);
        return (fn: (tx: any) => Promise<unknown>, opts?: unknown) =>
          target.$transaction(
            (tx: any) =>
              fn(new Proxy(tx, {
                get(t, p, r) {
                  const v = Reflect.get(t, p, r);
                  if (p !== 'contactAuditEntry') return v;
                  return new Proxy(v, {
                    get(m, q, rr) {
                      if (q === 'create') return async () => { throw new Error('v38a: audit write refused'); };
                      return Reflect.get(m, q, rr);
                    },
                  });
                },
              })),
            opts,
          );
      },
    });
    const svc = new ContactPrivacyServiceCtor({ client: failing } as any, audit);
    await svc.runPurgeCycle();

    const row = await rawContact(ID.subject);
    expect(row!.first_name).toBe(PII.firstName);
    expect(row!.email).toBe(PII.email);
    expect(await rawCount('contact_notes', 'contact_id', ID.subject)).toBe(1);
    expect((await db.contactForgetRequest.findUnique({ where: { contactId: ID.subject } }))?.status).toBe('requested');
    expect(await purgedEntries(ID.bizA, ID.subject)).toHaveLength(0);
  });

  it('after the purge the contact row holds no personal data and stays deleted', async () => {
    await privacy.runPurgeCycle();
    const row = await rawContact(ID.subject);
    expect(row, 'the row is kept as the anchor of the retained records').toBeDefined();
    expect(row!.deleted_at).toBeInstanceOf(Date);
    for (const col of [
      'first_name', 'last_name', 'display_name', 'email', 'email_normalized', 'phone', 'phone_normalized',
      'secondary_email', 'secondary_phone', 'whatsapp_number', 'address_line_1', 'address_line_2', 'city',
      'state', 'postal_code', 'country', 'company_name', 'job_title', 'department', 'notes_internal',
    ]) {
      expect(row![col], `contacts.${col}`).toBeNull();
    }
    expect(row!.tags).toEqual([]);
    const text = JSON.stringify(row);
    for (const secret of ALL_SECRETS) expect(text, `contact row still holds ${secret}`).not.toContain(secret);
  });

  it('invoices, quotes and bookings are intact and still reference the contact', async () => {
    const inv = await db.$queryRawUnsafe(`SELECT contact_id, total, deleted_at FROM invoices WHERE id = $1`, ID.inv);
    const quote = await db.$queryRawUnsafe(`SELECT contact_id, total, deleted_at FROM quotes WHERE id = $1`, ID.quote);
    const booking = await db.$queryRawUnsafe(`SELECT contact_id, deleted_at FROM bookings WHERE id = $1`, ID.booking);
    expect(inv).toEqual([{ contact_id: ID.subject, total: 120, deleted_at: null }]);
    expect(quote).toEqual([{ contact_id: ID.subject, total: 80, deleted_at: null }]);
    expect(booking).toEqual([{ contact_id: ID.subject, deleted_at: null }]);
  });

  it("the subject's personal child rows are erased; the bystander's are not", async () => {
    expect(await rawCount('contact_events', 'contact_id', ID.subject)).toBe(0);
    expect(await rawCount('contact_notes', 'contact_id', ID.subject)).toBe(0);
    expect(await rawCount('contact_tasks', 'contact_id', ID.subject)).toBe(0);
    expect(await rawCount('contact_media', 'contact_id', ID.subject)).toBe(0);
    expect(await rawCount('contact_custom_field_values', 'contact_id', ID.subject)).toBe(0);
    expect(await rawCount('contact_tags', 'contact_id', ID.subject)).toBe(0);
    expect(await rawCount('contact_notes', 'contact_id', ID.bystander)).toBe(1);
    const bystander = await rawContact(ID.bystander);
    expect(bystander).toMatchObject({ first_name: 'V38A-Bystander', email: `${P}bystander@test.local`, deleted_at: null });
  });

  it('one forget_purged audit names the retained basis and the counts; no audit row keeps personal data', async () => {
    const entries = await purgedEntries(ID.bizA, ID.subject);
    expect(entries).toHaveLength(1);
    const [e] = entries;
    expect(e.contactId).toBeNull();
    expect(typeof e.after?.retainedBasis).toBe('string');
    expect(e.after.retainedBasis.length).toBeGreaterThan(0);
    expect(e.after.retained).toMatchObject({ invoices: 1, quotes: 1, bookings: 1 });
    expect(e.after.erased).toMatchObject({ events: 1, notes: 1, tasks: 1, media: 1, customFieldValues: 1, contactTags: 1 });
    expect(e.reason).toMatch(/retain/i);

    const trail = await db.contactAuditEntry.findMany({
      where: { businessId: ID.bizA, contactHash: audit.hashContact(ID.bizA, ID.subject) },
    });
    expect(trail.length).toBeGreaterThanOrEqual(3); // created, forget_requested, forget_purged
    expect(trail.filter((t: any) => t.contactId !== null)).toEqual([]);
    const text = JSON.stringify(trail);
    for (const secret of ALL_SECRETS) expect(text, `audit trail still holds ${secret}`).not.toContain(secret);
  });

  it('the forget request is closed as purged and detached from the contact', async () => {
    const reqs = await db.contactForgetRequest.findMany({ where: { businessId: ID.bizA, contactHash: audit.hashContact(ID.bizA, ID.subject) } });
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ status: 'purged', contactId: null });
    expect(reqs[0].purgedAt).toBeInstanceOf(Date);
  });

  it('a second purge cycle is a no-op', async () => {
    const before = await rawContact(ID.subject);
    const reqBefore = await db.contactForgetRequest.findMany({ where: { businessId: ID.bizA, contactHash: audit.hashContact(ID.bizA, ID.subject) } });
    await privacy.runPurgeCycle();
    expect(await rawContact(ID.subject)).toEqual(before);
    expect(await purgedEntries(ID.bizA, ID.subject)).toHaveLength(1);
    const reqAfter = await db.contactForgetRequest.findMany({ where: { businessId: ID.bizA, contactHash: audit.hashContact(ID.bizA, ID.subject) } });
    expect(reqAfter).toEqual(reqBefore);
    expect(await rawCount('invoices', 'contact_id', ID.subject)).toBe(1);
  });
});

describe("another tenant's forget request is rejected", () => {
  it("bizB's owner cannot request the forget of a bizA contact through either business", async () => {
    expect((await forget(ID.ownerB, ID.bizB, ID.victim)).status).toBe(404);
    expect((await forget(ID.ownerB, ID.bizA, ID.victim)).status).toBe(403);
    expect(await db.contactForgetRequest.findUnique({ where: { contactId: ID.victim } })).toBeNull();
    expect((await rawContact(ID.victim))!.deleted_at).toBeNull();
  });

  it('a forget request filed under bizB naming a bizA contact is refused by the purge', async () => {
    await db.contactForgetRequest.create({
      data: {
        id: ID.forged,
        businessId: ID.bizB,
        contactId: ID.victim,
        contactHash: audit.hashContact(ID.bizB, ID.victim),
        status: 'requested',
        purgeAt: new Date(Date.now() - 60_000),
      },
    });
    await privacy.runPurgeCycle();

    const victim = await rawContact(ID.victim);
    expect(victim).toMatchObject({ first_name: 'V38A-Victim', email: `${P}victim@test.local`, deleted_at: null });
    const forged = await db.contactForgetRequest.findUnique({ where: { id: ID.forged } });
    expect(forged).toMatchObject({ status: 'requested', contactId: ID.victim, purgedAt: null });
    expect(await purgedEntries(ID.bizB, ID.victim)).toHaveLength(0);
    expect(await purgedEntries(ID.bizA, ID.victim)).toHaveLength(0);
  });
});

describe('Shopify maps into the canonical status vocabulary and never overwrites it (CF-49)', () => {
  const customer = (id: number, email: string, orders: number) => ({
    id, email, first_name: 'V38A', last_name: `Shopper${id}`, orders_count: orders, total_spent: String(orders * 10), created_at: new Date().toISOString(),
  });

  it('a customer sync of an existing CLIENT with orders leaves CLIENT unchanged', async () => {
    vi.spyOn(shopify, 'shopifyRequest').mockResolvedValueOnce({ customers: [customer(38001, `${P}client@test.local`, 2)] });
    const out = await shopify.syncCustomers(ID.bizA);
    expect(out).toEqual({ imported: 0, updated: 1 });
    expect((await rawContact(ID.shopClient))!.status).toBe('CLIENT');
  });

  it('a customer sync of an existing PROSPECT with no orders does not overwrite it with LEAD', async () => {
    vi.spyOn(shopify, 'shopifyRequest').mockResolvedValueOnce({ customers: [customer(38002, `${P}prospect@test.local`, 0)] });
    await shopify.syncCustomers(ID.bizA);
    expect((await rawContact(ID.shopProspect))!.status).toBe('PROSPECT');
  });

  it('a new Shopify customer is created as CLIENT with orders and LEAD without', async () => {
    vi.spyOn(shopify, 'shopifyRequest').mockResolvedValueOnce({
      customers: [customer(38003, `${P}newbuyer@test.local`, 1), customer(38004, `${P}newlead@test.local`, 0)],
    });
    const out = await shopify.syncCustomers(ID.bizA);
    expect(out).toEqual({ imported: 2, updated: 0 });
    const rows = await db.$queryRawUnsafe(
      `SELECT email, status FROM contacts WHERE business_id = $1 AND email IN ($2, $3) ORDER BY email`,
      ID.bizA, `${P}newbuyer@test.local`, `${P}newlead@test.local`,
    );
    expect(rows).toEqual([
      { email: `${P}newbuyer@test.local`, status: 'CLIENT' },
      { email: `${P}newlead@test.local`, status: 'LEAD' },
    ]);
  });

  it('an order from an unknown Shopify customer creates the contact as CLIENT', async () => {
    vi.spyOn(shopify, 'shopifyRequest').mockResolvedValueOnce({
      orders: [{
        id: 38100, name: `${P}1001`, email: `${P}orderbuyer@test.local`, financial_status: 'paid', fulfillment_status: null,
        total_price: '25.00', currency: 'TTD', created_at: new Date().toISOString(), line_items: [],
        customer: { id: 38005, email: `${P}orderbuyer@test.local`, first_name: 'V38A', last_name: 'OrderBuyer' },
      }],
    });
    await shopify.syncOrders(ID.bizA);
    const rows = await db.$queryRawUnsafe(`SELECT status FROM contacts WHERE business_id = $1 AND email = $2`, ID.bizA, `${P}orderbuyer@test.local`);
    expect(rows).toEqual([{ status: 'CLIENT' }]);
  });

  it('no contact in the fixture business holds a status outside CONTACT_STATUSES', async () => {
    const rows = await db.$queryRawUnsafe(
      `SELECT DISTINCT status FROM contacts WHERE business_id = $1 AND status NOT IN ('LEAD', 'PROSPECT', 'CLIENT', 'LOST')`,
      ID.bizA,
    );
    expect(rows).toEqual([]);
  });
});
