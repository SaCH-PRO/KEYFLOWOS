/**
 * V1-72 / P144 (RR-PRIVACY-DELETED-CONTACT-GATES; R35, R53; D-25, D-261, D-262),
 * REAL Postgres database.
 *
 * A soft-deleted or forget-pending contact must neither be exported nor receive
 * transactional email:
 *
 *   1. ContactPrivacyService.exportContact (and POST .../contacts/:id/export):
 *      - Refuses soft-deleted and forget-pending contacts with 409 ConflictException
 *        carrying error code `CONTACT_DELETED`, creating no ContactExportJob row,
 *        no `exported` audit entry, and uploading no storage objects.
 *      - Once restored (via cancelForget or restore), exportContact succeeds cleanly.
 *      - Missing or cross-tenant contacts still answer 404 NotFoundException (never
 *        leaking existence or deletion state across tenants).
 *
 *   2. TransactionalEmailService.send:
 *      - Refuses soft-deleted and forget-pending contacts (both when `contactId` is
 *        supplied and when only `recipientEmail` is supplied) with the existing
 *        suppressed result (`{ status: 'FAILED' }`), zero calls to the provider
 *        adapter, zero notification log rows, and an accurate redacted warn log.
 *      - Live contacts (`deletedAt: null, doNotContact: false`) still export and
 *        send cleanly.
 *      - Live `doNotContact: true` contacts remain suppressed with their exact
 *        existing reason.
 *      - Cross-tenant isolation: a soft-deleted contact in bizB never suppresses a
 *        live contact with the same email in bizA.
 *      - D-16 email reuse: a soft-deleted contact in bizA does not suppress a newly
 *        created live contact holding the same email in bizA.
 *
 * Fixtures: prefix `v72z_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL with sqlLikePrefix() in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v72z_';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  live: `${P}live`,
  dnc: `${P}dnc`,
  softDeleted: `${P}softDeleted`,
  forgetPending: `${P}forgetPending`,
  restorableForget: `${P}restorableForget`,
  restorableSoft: `${P}restorableSoft`,
  reusedOld: `${P}reusedOld`,
  reusedLive: `${P}reusedLive`,
  crossTenantA: `${P}crossTenantA`,
  bizBLive: `${P}bizBLive`,
  bizBDeleted: `${P}bizBDeleted`,
};

const EMAIL = {
  live: `${P}live@test.local`,
  dnc: `${P}dnc@test.local`,
  softDeleted: `${P}soft-deleted@test.local`,
  forgetPending: `${P}forget-pending@test.local`,
  restorableForget: `${P}restorable-forget@test.local`,
  restorableSoft: `${P}restorable-soft@test.local`,
  reused: `${P}reused@test.local`,
  crossTenant: `${P}cross-tenant@test.local`,
  bizBLive: `${P}bizb-live@test.local`,
};

const INVOICE_TEMPLATE_DATA = {
  invoiceNumber: `${P}INV-001`,
  total: 120,
  currency: 'TTD',
  dueDate: '2026-12-31',
  invoiceUrl: `https://example.invalid/pay/${P}inv-001`,
  items: [{ description: `${P}Service`, quantity: 1, unitPrice: 120, total: 120 }],
};

let db: any;
let app: any;
let privacy: any;
let emailService: any;

const s3Send = vi.fn(async () => ({}));
const gmailGetStatus = vi.fn(async () => ({ connected: true, email: `${P}sender@test.local` }));
const gmailSendEmail = vi.fn(async () => ({ messageId: `${P}gmail_msg_1` }));
let warnSpy: ReturnType<typeof vi.spyOn>;

async function cleanup() {
  for (const sql of [
    `DELETE FROM customer_notification_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM idempotency_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_forget_requests WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_export_jobs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort */
    }
  }
}

async function rawCount(table: string, column: string, value: string): Promise<number> {
  const rows = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE ${column} = $1`,
    value,
  );
  return rows[0].n;
}

async function rawExportAuditCount(contactId: string): Promise<number> {
  const rows = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM contact_audit_entries WHERE contact_id = $1 AND action = 'exported'`,
    contactId,
  );
  return rows[0].n;
}

async function rawNotifCountByEmail(businessId: string, email: string): Promise<number> {
  const rows = await db.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM customer_notification_logs WHERE business_id = $1 AND lower(recipient_email) = lower($2)`,
    businessId,
    email,
  );
  return rows[0].n;
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
  const { TransactionalEmailService } = await import('../src/modules/notifications/transactional-email.service');
  const { GmailService } = await import('../src/modules/commerce/gmail.service');

  const moduleRef = await Test.createTestingModule({
    controllers: [ContactPrivacyController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      ContactAuditService,
      ContactPrivacyService,
      TransactionalEmailService,
      {
        provide: GmailService,
        useValue: {
          getGmailStatus: gmailGetStatus,
          sendEmail: gmailSendEmail,
        },
      },
    ],
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
  emailService = app.get(TransactionalEmailService);

  // Stub only the external S3 client boundary; all DB & service logic is real.
  (privacy as any).s3Client = { client: { send: s3Send }, bucket: `${P}bucket` };
  warnSpy = vi.spyOn((emailService as any).logger, 'warn').mockImplementation(() => {});

  await cleanup();

  await db.user.create({ data: { id: ID.ownerA, email: `${P}ownerA@test.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.ownerB, email: `${P}ownerB@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: `${P}Biz A`, slug: `${P}biz-a`, ownerId: ID.ownerA } });
  await db.business.create({ data: { id: ID.bizB, name: `${P}Biz B`, slug: `${P}biz-b`, ownerId: ID.ownerB } });
  await db.membership.create({ data: { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' } });

  // Seed contacts in bizA
  await db.contact.create({
    data: {
      id: ID.live,
      businessId: ID.bizA,
      firstName: 'Live',
      lastName: 'Contact',
      email: EMAIL.live,
      emailNormalized: EMAIL.live,
      doNotContact: false,
    },
  });

  await db.contact.create({
    data: {
      id: ID.dnc,
      businessId: ID.bizA,
      firstName: 'DoNot',
      lastName: 'Contact',
      email: EMAIL.dnc,
      emailNormalized: EMAIL.dnc,
      doNotContact: true,
    },
  });

  await db.contact.create({
    data: {
      id: ID.softDeleted,
      businessId: ID.bizA,
      firstName: 'Soft',
      lastName: 'Deleted',
      email: EMAIL.softDeleted,
      emailNormalized: EMAIL.softDeleted,
      doNotContact: false,
    },
  });
  await db.contact.delete({ where: { id: ID.softDeleted } });

  await db.contact.create({
    data: {
      id: ID.forgetPending,
      businessId: ID.bizA,
      firstName: 'Forget',
      lastName: 'Pending',
      email: EMAIL.forgetPending,
      emailNormalized: EMAIL.forgetPending,
      doNotContact: false,
    },
  });
  await privacy.requestForget({
    businessId: ID.bizA,
    contactId: ID.forgetPending,
    reason: 'GDPR erasure test',
    actor: { type: 'USER', id: ID.ownerA, label: `${P}ownerA@test.local` },
  });

  await db.contact.create({
    data: {
      id: ID.restorableForget,
      businessId: ID.bizA,
      firstName: 'Restorable',
      lastName: 'Forget',
      email: EMAIL.restorableForget,
      emailNormalized: EMAIL.restorableForget,
      doNotContact: false,
    },
  });

  await db.contact.create({
    data: {
      id: ID.restorableSoft,
      businessId: ID.bizA,
      firstName: 'Restorable',
      lastName: 'Soft',
      email: EMAIL.restorableSoft,
      emailNormalized: EMAIL.restorableSoft,
      doNotContact: false,
    },
  });
  await db.contact.delete({ where: { id: ID.restorableSoft } });

  // D-16 email reuse: old soft-deleted contact + new live contact sharing EMAIL.reused in bizA
  await db.contact.create({
    data: {
      id: ID.reusedOld,
      businessId: ID.bizA,
      firstName: 'Reused',
      lastName: 'Old',
      email: EMAIL.reused,
      emailNormalized: EMAIL.reused,
      doNotContact: false,
    },
  });
  await db.contact.delete({ where: { id: ID.reusedOld } });
  await db.contact.create({
    data: {
      id: ID.reusedLive,
      businessId: ID.bizA,
      firstName: 'Reused',
      lastName: 'Live',
      email: EMAIL.reused,
      emailNormalized: EMAIL.reused,
      doNotContact: false,
    },
  });

  // Cross-tenant contacts: same email live in bizA, soft-deleted in bizB
  await db.contact.create({
    data: {
      id: ID.crossTenantA,
      businessId: ID.bizA,
      firstName: 'Cross',
      lastName: 'TenantA',
      email: EMAIL.crossTenant,
      emailNormalized: EMAIL.crossTenant,
      doNotContact: false,
    },
  });
  await db.contact.create({
    data: {
      id: ID.bizBDeleted,
      businessId: ID.bizB,
      firstName: 'Cross',
      lastName: 'TenantBDeleted',
      email: EMAIL.crossTenant,
      emailNormalized: EMAIL.crossTenant,
      doNotContact: false,
    },
  });
  await db.contact.delete({ where: { id: ID.bizBDeleted } });

  await db.contact.create({
    data: {
      id: ID.bizBLive,
      businessId: ID.bizB,
      firstName: 'BizB',
      lastName: 'Live',
      email: EMAIL.bizBLive,
      emailNormalized: EMAIL.bizBLive,
      doNotContact: false,
    },
  });
}, 60_000);

afterAll(async () => {
  warnSpy?.mockRestore();
  await cleanup();
  if (app) await app.close();
}, 30_000);

beforeEach(() => {
  s3Send.mockClear();
  gmailGetStatus.mockClear();
  gmailSendEmail.mockClear();
  warnSpy.mockClear();
});

describe('RR-PRIVACY-DELETED-CONTACT-GATES — exportContact gates (R35)', () => {
  it('refuses a soft-deleted contact with 409 CONTACT_DELETED, no export job row, and no storage upload', async () => {
    let caught: unknown;
    try {
      await privacy.exportContact({
        businessId: ID.bizA,
        contactId: ID.softDeleted,
        actor: { type: 'USER', id: ID.ownerA, label: `${P}ownerA@test.local` },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConflictException);
    expect((caught as ConflictException).getStatus()).toBe(409);
    expect((caught as ConflictException).getResponse()).toMatchObject({ code: 'CONTACT_DELETED' });

    const httpRes = await request(app.getHttpServer())
      .post(`/crm/businesses/${ID.bizA}/contacts/${ID.softDeleted}/export`)
      .set('x-test-user', ID.ownerA)
      .send({});
    expect(httpRes.status).toBe(409);
    expect(httpRes.body).toMatchObject({ code: 'CONTACT_DELETED' });

    expect(s3Send).not.toHaveBeenCalled();
    expect(await rawCount('contact_export_jobs', 'contact_id', ID.softDeleted)).toBe(0);
    expect(await rawExportAuditCount(ID.softDeleted)).toBe(0);
  });

  it('refuses a forget-pending contact with 409 CONTACT_DELETED, no export job row, and no storage upload', async () => {
    let caught: unknown;
    try {
      await privacy.exportContact({
        businessId: ID.bizA,
        contactId: ID.forgetPending,
        actor: { type: 'USER', id: ID.ownerA, label: `${P}ownerA@test.local` },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConflictException);
    expect((caught as ConflictException).getStatus()).toBe(409);
    expect((caught as ConflictException).getResponse()).toMatchObject({ code: 'CONTACT_DELETED' });

    const httpRes = await request(app.getHttpServer())
      .post(`/crm/businesses/${ID.bizA}/contacts/${ID.forgetPending}/export`)
      .set('x-test-user', ID.ownerA)
      .send({});
    expect(httpRes.status).toBe(409);
    expect(httpRes.body).toMatchObject({ code: 'CONTACT_DELETED' });

    expect(s3Send).not.toHaveBeenCalled();
    expect(await rawCount('contact_export_jobs', 'contact_id', ID.forgetPending)).toBe(0);
    expect(await rawExportAuditCount(ID.forgetPending)).toBe(0);
  });

  it('allows export again once a forget-pending contact is restored via cancelForget or a soft-deleted contact is restored', async () => {
    await privacy.requestForget({
      businessId: ID.bizA,
      contactId: ID.restorableForget,
      reason: 'temporary forget',
      actor: { type: 'USER', id: ID.ownerA, label: `${P}ownerA@test.local` },
    });

    await expect(
      privacy.exportContact({ businessId: ID.bizA, contactId: ID.restorableForget }),
    ).rejects.toMatchObject({ status: 409, response: { code: 'CONTACT_DELETED' } });
    expect(s3Send).not.toHaveBeenCalled();

    await privacy.cancelForget({
      businessId: ID.bizA,
      contactId: ID.restorableForget,
      actor: { type: 'USER', id: ID.ownerA, label: `${P}ownerA@test.local` },
    });

    const exportedAfterCancel = await privacy.exportContact({
      businessId: ID.bizA,
      contactId: ID.restorableForget,
      actor: { type: 'USER', id: ID.ownerA, label: `${P}ownerA@test.local` },
    });
    expect(exportedAfterCancel.jobId).toBeTruthy();
    expect(exportedAfterCancel.token).toBeTruthy();
    expect(s3Send).toHaveBeenCalledTimes(2);
    expect(await rawCount('contact_export_jobs', 'contact_id', ID.restorableForget)).toBe(1);

    // Direct soft-delete restore control
    s3Send.mockClear();
    await expect(
      privacy.exportContact({ businessId: ID.bizA, contactId: ID.restorableSoft }),
    ).rejects.toMatchObject({ status: 409, response: { code: 'CONTACT_DELETED' } });
    expect(s3Send).not.toHaveBeenCalled();

    await db.$executeRawUnsafe(`UPDATE contacts SET deleted_at = NULL WHERE id = $1`, ID.restorableSoft);
    const exportedAfterRestore = await privacy.exportContact({
      businessId: ID.bizA,
      contactId: ID.restorableSoft,
    });
    expect(exportedAfterRestore.jobId).toBeTruthy();
    expect(s3Send).toHaveBeenCalledTimes(2);
    expect(await rawCount('contact_export_jobs', 'contact_id', ID.restorableSoft)).toBe(1);
  });
});

describe('RR-PRIVACY-DELETED-CONTACT-GATES — TransactionalEmailService.send gates (R53)', () => {
  it('suppresses transactional email to a soft-deleted contact (both by contactId and email-only) with zero provider calls', async () => {
    const byId = await emailService.send({
      businessId: ID.bizA,
      type: 'invoice_sent',
      recipientEmail: EMAIL.softDeleted,
      recipientName: 'Soft Deleted',
      contactId: ID.softDeleted,
      templateData: INVOICE_TEMPLATE_DATA,
    });
    expect(byId).toEqual({ status: 'FAILED' });
    expect(gmailSendEmail).not.toHaveBeenCalled();
    expect(await rawNotifCountByEmail(ID.bizA, EMAIL.softDeleted)).toBe(0);
    const idWarns = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(idWarns.some((w: string) => w.includes(ID.softDeleted) && w.includes('deleted'))).toBe(true);
    expect(idWarns.some((w: string) => w.includes(EMAIL.softDeleted))).toBe(false);

    warnSpy.mockClear();
    const byEmail = await emailService.send({
      businessId: ID.bizA,
      type: 'invoice_sent',
      recipientEmail: EMAIL.softDeleted,
      recipientName: 'Soft Deleted',
      templateData: INVOICE_TEMPLATE_DATA,
    });
    expect(byEmail).toEqual({ status: 'FAILED' });
    expect(gmailSendEmail).not.toHaveBeenCalled();
    expect(await rawNotifCountByEmail(ID.bizA, EMAIL.softDeleted)).toBe(0);
    const emailWarns = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(emailWarns.some((w: string) => w.includes(ID.softDeleted) && w.includes('deleted'))).toBe(true);
    expect(emailWarns.some((w: string) => w.includes(EMAIL.softDeleted))).toBe(false);
  });

  it('suppresses transactional email to a forget-pending contact (both by contactId and email-only) with zero provider calls', async () => {
    const byId = await emailService.send({
      businessId: ID.bizA,
      type: 'invoice_sent',
      recipientEmail: EMAIL.forgetPending,
      recipientName: 'Forget Pending',
      contactId: ID.forgetPending,
      templateData: INVOICE_TEMPLATE_DATA,
    });
    expect(byId).toEqual({ status: 'FAILED' });
    expect(gmailSendEmail).not.toHaveBeenCalled();
    expect(await rawNotifCountByEmail(ID.bizA, EMAIL.forgetPending)).toBe(0);

    const byEmail = await emailService.send({
      businessId: ID.bizA,
      type: 'invoice_sent',
      recipientEmail: EMAIL.forgetPending,
      recipientName: 'Forget Pending',
      templateData: INVOICE_TEMPLATE_DATA,
    });
    expect(byEmail).toEqual({ status: 'FAILED' });
    expect(gmailSendEmail).not.toHaveBeenCalled();
    expect(await rawNotifCountByEmail(ID.bizA, EMAIL.forgetPending)).toBe(0);
    const warns = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(warns.some((w: string) => w.includes(ID.forgetPending) && w.includes('deleted'))).toBe(true);
    expect(warns.some((w: string) => w.includes(EMAIL.forgetPending))).toBe(false);
  });
});

describe('RR-PRIVACY-DELETED-CONTACT-GATES — negative controls & cross-tenant isolation', () => {
  it('live contact exports and sends transactional email cleanly', async () => {
    const exported = await privacy.exportContact({
      businessId: ID.bizA,
      contactId: ID.live,
      actor: { type: 'USER', id: ID.ownerA, label: `${P}ownerA@test.local` },
    });
    expect(exported.jobId).toBeTruthy();
    expect(exported.token).toBeTruthy();
    expect(s3Send).toHaveBeenCalledTimes(2);
    expect(await rawCount('contact_export_jobs', 'contact_id', ID.live)).toBe(1);

    const sentById = await emailService.send({
      businessId: ID.bizA,
      type: 'invoice_sent',
      recipientEmail: EMAIL.live,
      recipientName: 'Live Contact',
      contactId: ID.live,
      templateData: INVOICE_TEMPLATE_DATA,
    });
    expect(sentById).toEqual({ status: 'SENT', messageId: `${P}gmail_msg_1` });
    expect(gmailSendEmail).toHaveBeenCalledTimes(1);

    gmailSendEmail.mockClear();
    const sentByEmail = await emailService.send({
      businessId: ID.bizA,
      type: 'invoice_sent',
      recipientEmail: EMAIL.live,
      recipientName: 'Live Contact',
      templateData: INVOICE_TEMPLATE_DATA,
    });
    expect(sentByEmail).toEqual({ status: 'SENT', messageId: `${P}gmail_msg_1` });
    expect(gmailSendEmail).toHaveBeenCalledTimes(1);
  });

  it('live doNotContact contact remains suppressed with its exact existing reason', async () => {
    const res = await emailService.send({
      businessId: ID.bizA,
      type: 'invoice_sent',
      recipientEmail: EMAIL.dnc,
      recipientName: 'DoNot Contact',
      contactId: ID.dnc,
      templateData: INVOICE_TEMPLATE_DATA,
    });
    expect(res).toEqual({ status: 'FAILED' });
    expect(gmailSendEmail).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      `[notify] refusing invoice_sent: contact ${ID.dnc} is marked do-not-contact`,
    );
  });

  it('D-16 email reuse: a soft-deleted contact does not block a newly created live contact sharing that email', async () => {
    const oldBlocked = await emailService.send({
      businessId: ID.bizA,
      type: 'invoice_sent',
      recipientEmail: EMAIL.reused,
      recipientName: 'Reused Old',
      contactId: ID.reusedOld,
      templateData: INVOICE_TEMPLATE_DATA,
    });
    expect(oldBlocked).toEqual({ status: 'FAILED' });
    expect(gmailSendEmail).not.toHaveBeenCalled();

    const liveById = await emailService.send({
      businessId: ID.bizA,
      type: 'invoice_sent',
      recipientEmail: EMAIL.reused,
      recipientName: 'Reused Live',
      contactId: ID.reusedLive,
      templateData: INVOICE_TEMPLATE_DATA,
    });
    expect(liveById).toEqual({ status: 'SENT', messageId: `${P}gmail_msg_1` });
    expect(gmailSendEmail).toHaveBeenCalledTimes(1);

    gmailSendEmail.mockClear();
    const liveByEmail = await emailService.send({
      businessId: ID.bizA,
      type: 'invoice_sent',
      recipientEmail: EMAIL.reused,
      recipientName: 'Reused Live',
      templateData: INVOICE_TEMPLATE_DATA,
    });
    expect(liveByEmail).toEqual({ status: 'SENT', messageId: `${P}gmail_msg_1` });
    expect(gmailSendEmail).toHaveBeenCalledTimes(1);
  });

  it('cross-tenant isolation: bizB soft-deleted contact does not affect bizA email, and bizB contacts cannot be exported from bizA (404)', async () => {
    // Email to live bizA contact succeeds despite bizB having a soft-deleted contact with the same email
    const sentById = await emailService.send({
      businessId: ID.bizA,
      type: 'invoice_sent',
      recipientEmail: EMAIL.crossTenant,
      recipientName: 'Cross TenantA',
      contactId: ID.crossTenantA,
      templateData: INVOICE_TEMPLATE_DATA,
    });
    expect(sentById).toEqual({ status: 'SENT', messageId: `${P}gmail_msg_1` });
    expect(gmailSendEmail).toHaveBeenCalledTimes(1);

    gmailSendEmail.mockClear();
    const sentByEmail = await emailService.send({
      businessId: ID.bizA,
      type: 'invoice_sent',
      recipientEmail: EMAIL.crossTenant,
      recipientName: 'Cross TenantA',
      templateData: INVOICE_TEMPLATE_DATA,
    });
    expect(sentByEmail).toEqual({ status: 'SENT', messageId: `${P}gmail_msg_1` });
    expect(gmailSendEmail).toHaveBeenCalledTimes(1);

    // Foreign live and soft-deleted bizB contacts must both return 404 (never 409) from bizA
    await expect(
      privacy.exportContact({ businessId: ID.bizA, contactId: ID.bizBLive }),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      privacy.exportContact({ businessId: ID.bizA, contactId: ID.bizBDeleted }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const httpForeign = await request(app.getHttpServer())
      .post(`/crm/businesses/${ID.bizA}/contacts/${ID.bizBDeleted}/export`)
      .set('x-test-user', ID.ownerA)
      .send({});
    expect(httpForeign.status).toBe(404);
    expect(s3Send).not.toHaveBeenCalled();
    expect(await rawCount('contact_export_jobs', 'contact_id', ID.bizBDeleted)).toBe(0);
    expect(await rawCount('contact_export_jobs', 'contact_id', ID.bizBLive)).toBe(0);
  });
});
