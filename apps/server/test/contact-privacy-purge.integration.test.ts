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
 * Review repairs (V1-38 repair): a duplicate merged into the subject is erased
 * with it and the merges cannot be undone (SEC-V138-1); cancel and purge share
 * one claim (SEC-V138-2); the forget reason, data issues, external mappings,
 * CRM activities and tasks and relationship notes are erased and the audit
 * claims only what it counted (SEC-V138-3, CR-2); a failed export bundle
 * deletion is logged and recorded by key (SEC-V138-4); a contact the pre-D-25
 * purge closed but left intact is erased on the next cycle (CR-3); Shopify
 * maps an existing legacy 'CUSTOMER' into the vocabulary (CR-1). The merge
 * and undo run through the real CrmController in their own Nest app.
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
  // ---- review repairs (V1-38 repair) ----
  mPrimary: `${P}mPrimary`, // bizA: forgotten after mDup (itself holding mDup2) was merged into it
  mDup: `${P}mDup`,
  mDup2: `${P}mDup2`,
  race: `${P}race`, // bizA: a cancel racing the purge
  regrace: `${P}regrace`, // bizA: cancelled and re-requested between the due read and the claim
  leftover: `${P}leftover`, // bizA: records hanging off the contact that the purge must erase
  bundle: `${P}bundle`, // bizA: an export bundle the storage refuses to delete
  legacy: `${P}legacy`, // bizA: 'purged' by the pre-D-25 code, row intact
  legacyReq: `${P}legacyReq`,
  shopLegacy: `${P}shopLegacy`, // bizA: holds the legacy 'CUSTOMER' status
  shopOrderLegacy: `${P}shopOrderLegacy`,
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
    `DELETE FROM merge_operations WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_data_issues WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_external_mappings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM crm_activities WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM crm_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_relationships WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

// ---------------------------------------------------------------------------
// Review repairs (V1-38 repair): SEC-V138-1..4, CR-2, CR-3.
// ---------------------------------------------------------------------------

/** Every audit row of a contact, by its hash (the purge keeps them, hash-anchored). */
async function trailOf(businessId: string, contactId: string) {
  return db.contactAuditEntry.findMany({ where: { businessId, contactHash: audit.hashContact(businessId, contactId) } });
}

/** The soft-delete extension hides the request's contact; requests are read by hash. */
async function requestsOf(businessId: string, contactId: string) {
  return db.contactForgetRequest.findMany({ where: { businessId, contactHash: audit.hashContact(businessId, contactId) } });
}

/** The same service over a client whose contactForgetRequest[method] runs `between` after it reads. */
function serviceInterleaving(method: 'findUnique' | 'findMany', between: () => Promise<unknown>) {
  const interleaved = new Proxy(db, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop !== 'contactForgetRequest') return value;
      return new Proxy(value, {
        get(model, q, r) {
          if (q !== method) return Reflect.get(model, q, r);
          return async (args: unknown) => {
            const out = await model[method](args);
            await between();
            return out;
          };
        },
      });
    },
  });
  return new ContactPrivacyServiceCtor({ client: interleaved } as any, audit);
}

describe('a duplicate merged into the subject is the same person and is erased with it (SEC-V138-1)', () => {
  let crmApp: any;
  const PRIMARY_PII = { firstName: 'V38A-Primary-Ada', email: `${P}ada.primary@test.local` };
  const DUP_PII = { firstName: 'V38A-Dup-Ada', email: `${P}ada.work@test.local`, phone: '+1 868 555 0191', addressLine1: 'V38A-Dup 12 Engine Rd' };
  const DUP2_PII = { firstName: 'V38A-Dup2-Ada', email: `${P}ada.home@test.local`, phone: '+1 868 555 0192', city: 'V38A-Dup2-City' };
  const SECRETS = [...Object.values(PRIMARY_PII), ...Object.values(DUP_PII), ...Object.values(DUP2_PII), '+18685550191', '+18685550192'];
  const merges: string[] = [];

  beforeAll(async () => {
    const { Test } = await import('@nestjs/testing');
    const { ValidationPipe } = await import('@nestjs/common');
    const { EventEmitter2 } = await import('@nestjs/event-emitter');
    const { PrismaService } = await import('../src/core/prisma/prisma.service');
    const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
    const { AuthGuard } = await import('../src/core/auth/auth.guard');
    const { BusinessGuard } = await import('../src/core/auth/business.guard');
    const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
    const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
    const { EntityResolutionService } = await import('../src/core/connectors/entity-resolution.service');
    const { CrmController } = await import('../src/modules/crm/crm.controller');
    const { CrmService } = await import('../src/modules/crm/crm.service');
    const { CrmStatsService } = await import('../src/modules/crm/crm-stats.service');
    const { CrmTimelineService } = await import('../src/modules/crm/crm-timeline.service');
    const { CrmCacheService } = await import('../src/modules/crm/crm-cache.service');
    const { CrmListsService } = await import('../src/modules/crm/crm-lists.service');
    const { CrmFlowService } = await import('../src/modules/crm/crm-flow.service');
    const { ContactAuditService } = await import('../src/modules/crm/privacy/contact-audit.service');
    const { ContactCustomFieldValueService } = await import('../src/modules/crm/contact-custom-field-value.service');
    const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
    const { FeatureFlagGuard } = await import('../src/modules/crm/guards/feature-flag.guard');
    const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
    const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
    const { CrmImportService } = await import('../src/modules/crm/crm-import.service');
    const { CrmPlaybookService } = await import('../src/modules/crm/crm-playbook.service');
    const { CrmActionsService } = await import('../src/modules/crm/crm-actions.service');
    const { CrmRevenueService } = await import('../src/modules/crm/crm-revenue.service');
    const { CrmJourneyService } = await import('../src/modules/crm/crm-journey.service');
    const { CrmDuplicateDetectionService } = await import('../src/modules/crm/crm-duplicate-detection.service');
    const { CrmDataQualityService } = await import('../src/modules/crm/crm-data-quality.service');
    const { CrmSavedViewsService } = await import('../src/modules/crm/crm-saved-views.service');
    const { CrmRelationshipHealthService } = await import('../src/modules/crm/crm-relationship-health.service');
    const { CrmCommunicationService } = await import('../src/modules/crm/crm-communication.service');
    const { BestChannelService } = await import('../src/modules/crm/best-channel.service');
    const { ConversationAiService } = await import('../src/modules/crm/conversation-ai.service');
    const { CrmNetworkService } = await import('../src/modules/crm/crm-network.service');
    const { ContactInsightService } = await import('../src/modules/crm/contact-insight.service');

    // The real merge and undo path (CrmController -> CrmService.mergeContacts /
    // revertMerge) with its guards; only the side channels are stubbed, as in
    // crm-contact-duplicate.integration.test.ts.
    const moduleRef = await Test.createTestingModule({
      controllers: [CrmController],
      providers: [
        PrismaService, AuthGuard, BusinessGuard, ModuleScopeGuard, CrmRateLimitGuard, FeatureFlagGuard, PlanLimitGuard,
        TeamAuditInterceptor, CrmStatsService, CrmService, ContactAuditService,
        { provide: EventEmitter2, useValue: new EventEmitter2() },
        { provide: CrmTimelineService, useValue: { logEvent: async () => undefined } },
        { provide: CrmCacheService, useValue: { invalidate: async () => undefined } },
        { provide: CrmFlowService, useValue: { invalidateCache: () => undefined } },
        { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
        { provide: CrmListsService, useValue: {} },
        { provide: EntityResolutionService, useValue: {} },
        { provide: ContactCustomFieldValueService, useValue: {} },
        { provide: CrmImportService, useValue: {} },
        { provide: CrmPlaybookService, useValue: {} },
        { provide: CrmActionsService, useValue: {} },
        { provide: CrmRevenueService, useValue: {} },
        { provide: CrmJourneyService, useValue: {} },
        { provide: CrmDuplicateDetectionService, useValue: {} },
        { provide: CrmDataQualityService, useValue: {} },
        { provide: CrmSavedViewsService, useValue: {} },
        { provide: CrmRelationshipHealthService, useValue: {} },
        { provide: CrmCommunicationService, useValue: {} },
        { provide: BestChannelService, useValue: {} },
        { provide: ConversationAiService, useValue: {} },
        { provide: CrmNetworkService, useValue: {} },
        { provide: ContactInsightService, useValue: {} },
      ],
    }).compile();
    crmApp = moduleRef.createNestApplication();
    crmApp.use(async (req: any, _res: any, next: any) => {
      const header = req.headers['x-test-user'];
      const id = typeof header === 'string' ? header : undefined;
      if (id && id.startsWith(P)) {
        const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
        if (user) req.user = { id: user.id, email: user.email, role: user.role };
      }
      next();
    });
    crmApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    crmApp.useGlobalFilters(new GlobalHttpExceptionFilter());
    await crmApp.init();
  }, 120_000);

  afterAll(async () => {
    if (crmApp) await crmApp.close();
  });

  const merge = (primaryId: string, duplicateId: string) =>
    request(crmApp.getHttpServer())
      .post(`/crm/businesses/${ID.bizA}/contacts/${primaryId}/merge/${duplicateId}`)
      .set('x-test-user', ID.owner)
      .send({});
  const revert = (mergeId: string) =>
    request(crmApp.getHttpServer())
      .post(`/crm/businesses/${ID.bizA}/duplicates/merges/${mergeId}/revert`)
      .set('x-test-user', ID.owner)
      .send({});

  it('merge mDup2 into mDup and mDup into the subject, forget and purge the subject: every merged row, snapshot and audit row is erased', async () => {
    await db.contact.create({ data: { id: ID.mPrimary, businessId: ID.bizA, ...PRIMARY_PII } });
    await db.contact.create({ data: { id: ID.mDup, businessId: ID.bizA, ...DUP_PII } });
    await db.contact.create({ data: { id: ID.mDup2, businessId: ID.bizA, ...DUP2_PII } });
    const inner = await merge(ID.mDup, ID.mDup2);
    expect(inner.status).toBe(201);
    const outer = await merge(ID.mPrimary, ID.mDup);
    expect(outer.status).toBe(201);
    merges.push(inner.body.mergeId, outer.body.mergeId);

    // The 'merged' audit rows are fire-and-forget (DEC-CONTACTS-002): wait for
    // them, so the purge meets the duplicates' PII in their `before`.
    const ids = [ID.mPrimary, ID.mDup, ID.mDup2];
    for (let i = 0; i < 50; i++) {
      const n = await db.contactAuditEntry.count({ where: { businessId: ID.bizA, action: 'merged', contactId: { in: ids } } });
      if (n >= 4) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    // Pre-condition: the merged duplicates hold their PII, soft-deleted.
    expect(await rawContact(ID.mDup)).toMatchObject({ first_name: DUP_PII.firstName, email: DUP_PII.email });
    expect((await rawContact(ID.mDup2))!.first_name).toBe(DUP2_PII.firstName);
    const before = JSON.stringify(await db.$queryRawUnsafe(`SELECT duplicate_snapshot, resolved_fields FROM merge_operations WHERE id = $1`, outer.body.mergeId));
    expect(before).toContain(DUP_PII.email);

    expect((await forget(ID.owner, ID.bizA, ID.mPrimary)).status).toBe(201);
    await makeDue(ID.mPrimary);
    await privacy.runPurgeCycle();

    for (const id of ids) {
      const row = await rawContact(id);
      expect(row!.deleted_at, `${id} deleted`).toBeInstanceOf(Date);
      for (const col of ['first_name', 'email', 'email_normalized', 'phone', 'phone_normalized', 'address_line_1', 'city']) {
        expect(row![col], `${id}.${col}`).toBeNull();
      }
      const text = JSON.stringify(row);
      for (const secret of SECRETS) expect(text, `${id} still holds ${secret}`).not.toContain(secret);
    }

    const ops = await db.$queryRawUnsafe(
      `SELECT duplicate_snapshot, resolved_fields, field_overrides, repointed_counts, expires_at <= now() AS closed
         FROM merge_operations WHERE id = ANY($1::text[])`,
      merges,
    );
    expect(ops).toHaveLength(2);
    for (const op of ops) {
      expect(op.closed, 'the undo window is closed').toBe(true);
      expect(op.resolved_fields).toBeNull();
      expect(JSON.stringify(op.repointed_counts ?? {})).not.toContain('_deletedSnapshots');
      const text = JSON.stringify(op);
      for (const secret of SECRETS) expect(text, `merge operation still holds ${secret}`).not.toContain(secret);
    }

    for (const id of ids) {
      const trail = await trailOf(ID.bizA, id);
      expect(trail.length, `${id} keeps its audit rows`).toBeGreaterThan(0);
      expect(trail.filter((t: any) => t.contactId !== null)).toEqual([]);
      const text = JSON.stringify(trail);
      for (const secret of SECRETS) expect(text, `${id} audit trail still holds ${secret}`).not.toContain(secret);
    }

    const [entry] = await purgedEntries(ID.bizA, ID.mPrimary);
    expect(entry.after.erased).toMatchObject({ mergedDuplicates: 2, mergeOperationsScrubbed: 2 });
  });

  it('neither merge can be undone to bring the forgotten person back', async () => {
    for (const mergeId of merges) {
      const res = await revert(mergeId);
      expect(res.status, `revert ${mergeId}`).toBe(400);
    }
    for (const id of [ID.mDup, ID.mDup2]) {
      const row = await rawContact(id);
      expect(row).toMatchObject({ first_name: null, email: null });
      expect(row!.deleted_at).toBeInstanceOf(Date);
    }
    const reverted = await db.$queryRawUnsafe(`SELECT reverted_at FROM merge_operations WHERE id = ANY($1::text[])`, merges);
    expect(reverted).toEqual([{ reverted_at: null }, { reverted_at: null }]);
  });
});

describe('cancel and purge are bound to one claim (SEC-V138-2)', () => {
  it('a cancel that read the request before the purge committed is refused, and the purge stands', async () => {
    await db.contact.create({ data: { id: ID.race, businessId: ID.bizA, firstName: 'V38A-Race', email: `${P}race@test.local` } });
    await privacy.requestForget({ businessId: ID.bizA, contactId: ID.race });
    await makeDue(ID.race);

    // cancelForget reads 'requested', then the scheduled purge commits, then
    // the cancel's transaction runs.
    const svc = serviceInterleaving('findUnique', () => privacy.runPurgeCycle());
    await expect(svc.cancelForget({ businessId: ID.bizA, contactId: ID.race })).rejects.toThrow(/no longer open/);

    const row = await rawContact(ID.race);
    expect(row!.deleted_at, 'the anonymised row stays deleted').toBeInstanceOf(Date);
    expect(row).toMatchObject({ first_name: null, email: null });
    const reqs = await requestsOf(ID.bizA, ID.race);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ status: 'purged', contactId: null, cancelledAt: null });
    const actions = (await trailOf(ID.bizA, ID.race)).map((t: any) => t.action);
    expect(actions).toContain('forget_purged');
    expect(actions).not.toContain('forget_cancelled');
  });

  it('a request cancelled and filed again after the due list was read keeps its new grace period', async () => {
    await db.contact.create({ data: { id: ID.regrace, businessId: ID.bizA, firstName: 'V38A-Regrace', email: `${P}regrace@test.local` } });
    await privacy.requestForget({ businessId: ID.bizA, contactId: ID.regrace });
    await makeDue(ID.regrace);

    const svc = serviceInterleaving('findMany', async () => {
      await privacy.cancelForget({ businessId: ID.bizA, contactId: ID.regrace });
      await privacy.requestForget({ businessId: ID.bizA, contactId: ID.regrace }); // a fresh grace period
    });
    await svc.runPurgeCycle();

    expect((await rawContact(ID.regrace))!.first_name).toBe('V38A-Regrace');
    const req = await db.contactForgetRequest.findUnique({ where: { contactId: ID.regrace } });
    expect(req).toMatchObject({ status: 'requested', purgedAt: null });
    expect(req.purgeAt.getTime()).toBeGreaterThan(Date.now());
    expect(await purgedEntries(ID.bizA, ID.regrace)).toHaveLength(0);
  });
});

describe('the purge erases the records hanging off the contact and says exactly what it swept (SEC-V138-3, CR-2)', () => {
  const L = {
    name: 'V38A Grace Hopper',
    email: `${P}hopper@test.local`,
    phone: '+18685550177',
    shopifyId: `${P}shopify-777`,
    activity: 'V38A-activity: called Grace Hopper about her order',
    task: 'V38A-task: ring Grace Hopper back',
    taskBody: 'V38A-task-body: Grace Hopper prefers mornings',
    relation: 'V38A-relation: Grace Hopper was referred by the bystander',
  };

  it('the forget reason, data-issue fix values, external ids, CRM activities and tasks and relationship notes are gone', async () => {
    await db.contact.create({ data: { id: ID.leftover, businessId: ID.bizA, firstName: 'V38A-Hopper', email: L.email, phone: L.phone } });
    await db.contactDataIssue.create({ data: { businessId: ID.bizA, contactId: ID.leftover, kind: 'invalid_phone', message: 'reformat', recommendedFix: { action: 'replace_phone', value: L.phone } } });
    await db.contactExternalMapping.create({ data: { businessId: ID.bizA, contactId: ID.leftover, source: 'shopify', externalId: L.shopifyId } });
    await db.crmActivity.create({ data: { businessId: ID.bizA, contactId: ID.leftover, type: 'call', description: L.activity } });
    await db.crmTask.create({ data: { businessId: ID.bizA, contactId: ID.leftover, title: L.task, description: L.taskBody } });
    await db.contactRelationship.create({ data: { businessId: ID.bizA, fromContactId: ID.leftover, toContactId: ID.bystander, type: 'referred_by', note: L.relation } });
    await privacy.requestForget({ businessId: ID.bizA, contactId: ID.leftover, reason: `${L.name} (${L.email}) asked by phone ${L.phone}` });
    await makeDue(ID.leftover);
    await privacy.runPurgeCycle();

    // The reason is readable by any member through privacy-settings.
    const settings = await request(app.getHttpServer())
      .get(`/crm/businesses/${ID.bizA}/privacy-settings`)
      .set('x-test-user', ID.owner);
    expect(settings.status).toBe(200);
    expect(settings.body.recentForget.length).toBeGreaterThan(0);
    const settingsText = JSON.stringify(settings.body);
    for (const secret of Object.values(L)) expect(settingsText, `privacy-settings still shows ${secret}`).not.toContain(secret);

    expect(await rawCount('contact_data_issues', 'contact_id', ID.leftover)).toBe(0);
    expect(await rawCount('contact_external_mappings', 'contact_id', ID.leftover)).toBe(0);
    expect(await rawCount('crm_activities', 'contact_id', ID.leftover)).toBe(0);
    expect(await rawCount('crm_tasks', 'contact_id', ID.leftover)).toBe(0);
    expect(await rawCount('contact_relationships', 'from_contact_id', ID.leftover)).toBe(0);
    const leftovers = await db.$queryRawUnsafe(
      `SELECT 'issue' AS t, recommended_fix::text AS v FROM contact_data_issues WHERE business_id = $1
       UNION ALL SELECT 'mapping', external_id FROM contact_external_mappings WHERE business_id = $1
       UNION ALL SELECT 'activity', description FROM crm_activities WHERE business_id = $1
       UNION ALL SELECT 'task', title || ' ' || coalesce(description, '') FROM crm_tasks WHERE business_id = $1
       UNION ALL SELECT 'relation', note FROM contact_relationships WHERE business_id = $1
       UNION ALL SELECT 'request', reason FROM contact_forget_requests WHERE business_id = $1`,
      ID.bizA,
    );
    const leftText = JSON.stringify(leftovers);
    for (const secret of Object.values(L)) expect(leftText, `a record still holds ${secret}`).not.toContain(secret);
    // The other end of the relationship is untouched.
    expect(await rawContact(ID.bystander)).toMatchObject({ first_name: 'V38A-Bystander', deleted_at: null });

    const [entry] = await purgedEntries(ID.bizA, ID.leftover);
    expect(entry.after.erased).toMatchObject({ dataIssues: 1, externalMappings: 1, crmActivities: 1, crmTasks: 1, relationships: 1 });
    expect(typeof entry.after.notSwept).toBe('string');
    expect(entry.reason).toMatch(/retain/i);
    expect(entry.reason, 'the entry claims only what it counted').not.toMatch(/personal data erased/i);
    const trailText = JSON.stringify(await trailOf(ID.bizA, ID.leftover));
    for (const secret of Object.values(L)) expect(trailText, `audit trail still holds ${secret}`).not.toContain(secret);
  });
});

describe('an export bundle the storage refuses to delete is never silent (SEC-V138-4)', () => {
  it('the failed keys are logged and recorded in a forget_storage_cleanup_failed entry naming the request', async () => {
    const keys = [
      `private/contact-exports/${ID.bizA}/${ID.bundle}/1.json`,
      `private/contact-exports/${ID.bizA}/${ID.bundle}/1.zip`,
    ];
    await db.contact.create({ data: { id: ID.bundle, businessId: ID.bizA, firstName: 'V38A-Bundle', email: `${P}bundle@test.local` } });
    await db.contactExportJob.create({
      data: { businessId: ID.bizA, contactId: ID.bundle, token: `${P}tok_bundle`, jsonKey: keys[0], zipKey: keys[1], expiresAt: new Date(Date.now() + 86_400_000) },
    });
    const req = await privacy.requestForget({ businessId: ID.bizA, contactId: ID.bundle });
    await makeDue(ID.bundle);

    const send = vi.fn(async () => { throw new Error('v38a: AccessDenied'); });
    const s3 = vi.spyOn(privacy as any, 's3').mockReturnValue({ client: { send }, bucket: 'v38a-bucket' });
    const warn = vi.spyOn((privacy as any).logger, 'warn');
    try {
      await privacy.runPurgeCycle();
    } finally {
      s3.mockRestore();
    }
    const warned = warn.mock.calls.map((c: any[]) => String(c[0]));
    warn.mockRestore();

    expect(send).toHaveBeenCalledTimes(2);
    expect(warned.some((w: string) => w.includes(req.id) && keys.every((k) => w.includes(k)))).toBe(true);
    expect(await rawCount('contact_export_jobs', 'contact_id', ID.bundle)).toBe(0);
    const failed = await db.contactAuditEntry.findMany({
      where: { businessId: ID.bizA, contactHash: audit.hashContact(ID.bizA, ID.bundle), action: 'forget_storage_cleanup_failed' },
    });
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ entityId: req.id, contactId: null });
    expect([...failed[0].after.failedKeys].sort()).toEqual([...keys].sort());
    const [entry] = await purgedEntries(ID.bizA, ID.bundle);
    expect(entry.after.erased.exportJobs).toBe(1);
    expect(entry.after.exportBundleObjects).toBe(2);
  });
});

describe('a contact the pre-D-25 purge closed but left intact is erased (CR-3)', () => {
  const OLD = { firstName: 'V38A-OldPurged', email: `${P}oldpurged@test.local`, phone: '+18685550150', note: 'V38A-oldpurged-note' };
  const oldPurgedAt = new Date(Date.now() - 30 * 86_400_000);

  it('the next cycle erases the row and its child rows and records a repair entry; the old entry is kept', async () => {
    // The legacy state: soft-deleted with every personal field, request
    // 'purged' and detached, a 'GDPR purge completed' entry naming no request.
    await db.contact.create({ data: { id: ID.legacy, businessId: ID.bizA, firstName: OLD.firstName, email: OLD.email, phone: OLD.phone } });
    await db.contactNote.create({ data: { id: `${P}note_legacy`, businessId: ID.bizA, contactId: ID.legacy, body: OLD.note } });
    await db.$executeRawUnsafe(`UPDATE contacts SET deleted_at = $2 WHERE id = $1`, ID.legacy, oldPurgedAt);
    const hash = audit.hashContact(ID.bizA, ID.legacy);
    await db.contactForgetRequest.create({
      data: { id: ID.legacyReq, businessId: ID.bizA, contactId: null, contactHash: hash, status: 'purged', reason: `${OLD.firstName} asked`, purgeAt: oldPurgedAt, purgedAt: oldPurgedAt },
    });
    await db.contactAuditEntry.create({
      data: { businessId: ID.bizA, contactId: null, contactHash: hash, action: 'forget_purged', entityType: 'contact', actor: { type: 'SYSTEM', label: 'forget-purge' }, after: { notes: 1 }, reason: 'GDPR purge completed', changedFields: [] },
    });

    await privacy.runPurgeCycle();

    const row = await rawContact(ID.legacy);
    expect(row).toMatchObject({ first_name: null, email: null, phone: null });
    expect(row!.deleted_at).toBeInstanceOf(Date);
    expect(await rawCount('contact_notes', 'contact_id', ID.legacy)).toBe(0);
    const req = await db.contactForgetRequest.findUnique({ where: { id: ID.legacyReq } });
    expect(req).toMatchObject({ status: 'purged', contactId: null, reason: null });

    const entries = await purgedEntries(ID.bizA, ID.legacy);
    expect(entries).toHaveLength(2);
    const old = entries.find((e: any) => e.entityId === null);
    const repair = entries.find((e: any) => e.entityId === ID.legacyReq);
    expect(old.reason).toBe('GDPR purge completed');
    expect(repair.reason).toMatch(/repair/i);
    expect(repair.after.legacyRepairOf).toEqual({ previousPurgedAt: oldPurgedAt.toISOString() });
    expect(repair.after.erased).toMatchObject({ notes: 1 });
    const text = JSON.stringify(await trailOf(ID.bizA, ID.legacy));
    for (const secret of Object.values(OLD)) expect(text).not.toContain(secret);
  });

  it('the repair is a one-off: a further cycle writes nothing', async () => {
    await privacy.runPurgeCycle();
    expect(await purgedEntries(ID.bizA, ID.legacy)).toHaveLength(2);
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

  it("an existing contact holding the legacy 'CUSTOMER' is mapped into the vocabulary by a customer sync (CR-1)", async () => {
    await db.contact.create({ data: { id: ID.shopLegacy, businessId: ID.bizA, firstName: 'V38A-Legacy', email: `${P}legacy.buyer@test.local`, status: 'CUSTOMER' } });
    vi.spyOn(shopify, 'shopifyRequest').mockResolvedValueOnce({ customers: [customer(38006, `${P}legacy.buyer@test.local`, 3)] });
    expect(await shopify.syncCustomers(ID.bizA)).toEqual({ imported: 0, updated: 1 });
    expect((await rawContact(ID.shopLegacy))!.status).toBe('CLIENT');
  });

  it("an order from an existing contact holding 'CUSTOMER' maps it to CLIENT; a PROSPECT's status is left alone (CR-1)", async () => {
    await db.contact.create({ data: { id: ID.shopOrderLegacy, businessId: ID.bizA, firstName: 'V38A-LegacyOrder', email: `${P}legacy.order@test.local`, status: 'CUSTOMER' } });
    const order = (id: number, email: string, customerId: number) => ({
      id, name: `${P}${id}`, email, financial_status: 'paid', fulfillment_status: null,
      total_price: '25.00', currency: 'TTD', created_at: new Date().toISOString(), line_items: [],
      customer: { id: customerId, email, first_name: 'V38A', last_name: `Order${id}` },
    });
    vi.spyOn(shopify, 'shopifyRequest').mockResolvedValueOnce({
      orders: [order(38101, `${P}legacy.order@test.local`, 38007), order(38102, `${P}prospect@test.local`, 38002)],
    });
    await shopify.syncOrders(ID.bizA);
    expect((await rawContact(ID.shopOrderLegacy))!.status).toBe('CLIENT');
    expect((await rawContact(ID.shopProspect))!.status).toBe('PROSPECT');
  });

  it('no contact in the fixture business holds a status outside CONTACT_STATUSES', async () => {
    const rows = await db.$queryRawUnsafe(
      `SELECT DISTINCT status FROM contacts WHERE business_id = $1 AND status NOT IN ('LEAD', 'PROSPECT', 'CLIENT', 'LOST')`,
      ID.bizA,
    );
    expect(rows).toEqual([]);
  });
});
