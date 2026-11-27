/**
 * V1-73 (RR-FORGET-CANCEL-KEEPS-PRIOR-DELETE; R54), REAL Postgres database + real HTTP.
 *
 * Cancelling a forget request must restore `deletedAt: null` ONLY when the forget
 * request itself caused the soft delete:
 *   - If a contact was already soft-deleted before `requestForget`, `requestForget`
 *     preserves the earlier `deletedAt` and records provenance (`deletedByForget: false`)
 *     atomically in its `forget_requested` audit entry.
 *   - `cancelForget` closes the forget request (`status = 'cancelled'`) while leaving
 *     the earlier `deletedAt` untouched and reporting `{ ok: true, restored: false, priorSoftDeletePreserved: true }`.
 *   - Negative control: a live contact that undergoes `requestForget` -> `cancelForget`
 *     comes back live (`deletedAt: null`) with `{ ok: true }`.
 *   - D-16 identity reuse: cancelling a forget request on an already soft-deleted contact
 *     whose email was taken by a new live contact succeeds without 409 because it does not
 *     un-delete the contact.
 *   - Re-forget after deliberate restore: once a human deliberately restores the contact,
 *     a subsequent `requestForget` -> `cancelForget` restores it to live.
 *   - Concurrent `requestForget` on a live contact, already-purged refusal (`contactId: null` +
 *     `contactHash`), merged-duplicate refusal (`mergedIntoId != null`), cross-tenant isolation
 *     on both `requestForget` and `cancelForget`, STAFF visibility/delete-scope on soft-deleted
 *     contacts, and `forget_requested`/`forget_cancelled` audit payload verification.
 *
 * Fixtures: prefix `v73a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted via raw SQL + sqlLikePrefix() in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v73a_';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  staffDelNone: `${P}staffDelNone`,
  staffDelOwned: `${P}staffDelOwned`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  priorDeleted: `${P}priorDeleted`,
  priorDeletedHttp: `${P}priorDeletedHttp`,
  liveContact: `${P}liveContact`,
  reusedDeleted: `${P}reusedDeleted`,
  reusedLive: `${P}reusedLive`,
  cycleContact: `${P}cycleContact`,
  concurrentLive: `${P}concurrentLive`,
  purgedContact: `${P}purgedContact`,
  mergedPrimary: `${P}mergedPrimary`,
  mergedDup: `${P}mergedDup`,
  staffPrivateDeleted: `${P}staffPrivDel`,
  staffTeamDeleted: `${P}staffTeamDel`,
};

const EMAIL = {
  ownerA: `${P}ownerA@test.local`,
  ownerB: `${P}ownerB@test.local`,
  staffDelNone: `${P}staffDelNone@test.local`,
  staffDelOwned: `${P}staffDelOwned@test.local`,
  priorDeleted: `${P}prior-deleted@test.local`,
  priorDeletedHttp: `${P}prior-deleted-http@test.local`,
  liveContact: `${P}live-contact@test.local`,
  reused: `${P}reused@test.local`,
  cycleContact: `${P}cycle-contact@test.local`,
  concurrentLive: `${P}concurrent-live@test.local`,
  mergedPrimary: `${P}merged-primary@test.local`,
  mergedDup: `${P}merged-dup@test.local`,
  staffPrivateDeleted: `${P}staff-priv-del@test.local`,
  staffTeamDeleted: `${P}staff-team-del@test.local`,
};

let db: any;
let app: any;
let privacy: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_forget_requests WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_export_jobs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

async function rawDeletedAt(contactId: string): Promise<Date | null> {
  const rows = await db.$queryRawUnsafe(
    `SELECT deleted_at AS "deletedAt" FROM contacts WHERE id = $1`,
    contactId,
  );
  return rows[0]?.deletedAt ?? null;
}

async function rawForgetStatus(contactId: string): Promise<string | null> {
  const rows = await db.$queryRawUnsafe(
    `SELECT status FROM contact_forget_requests WHERE contact_id = $1`,
    contactId,
  );
  return rows[0]?.status ?? null;
}

beforeAll(async () => {
  process.env.DISABLE_FORGET_SCHEDULER = 'true';

  const dbPkg = await import('@keyflow/db');
  db = dbPkg.db;

  const { Test } = await import('@nestjs/testing');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { ContactAuditService } = await import('../src/modules/crm/privacy/contact-audit.service');
  const { ContactPrivacyService } = await import('../src/modules/crm/privacy/contact-privacy.service');
  const { ContactPrivacyController } = await import('../src/modules/crm/privacy/contact-privacy.controller');

  await cleanup();

  const prismaStub = { client: db };

  const moduleRef = await Test.createTestingModule({
    controllers: [ContactPrivacyController],
    providers: [
      { provide: PrismaService, useValue: prismaStub },
      ContactAuditService,
      ContactPrivacyService,
      BusinessGuard,
      ModuleScopeGuard,
    ],
  })
    .overrideGuard(AuthGuard)
    .useValue({
      canActivate(ctx: any) {
        const req = ctx.switchToHttp().getRequest();
        const userId = req.headers['x-test-user'];
        if (!userId) return false;
        req.user = { id: String(userId), email: `${P}${String(userId).slice(P.length)}@test.local` };
        return true;
      },
    })
    .compile();

  app = moduleRef.createNestApplication();
  await app.init();

  privacy = moduleRef.get(ContactPrivacyService);

  await db.user.createMany({
    data: [
      { id: ID.ownerA, email: EMAIL.ownerA, name: 'Owner A', role: 'USER' },
      { id: ID.ownerB, email: EMAIL.ownerB, name: 'Owner B', role: 'USER' },
      { id: ID.staffDelNone, email: EMAIL.staffDelNone, name: 'Staff Del None', role: 'USER' },
      { id: ID.staffDelOwned, email: EMAIL.staffDelOwned, name: 'Staff Del Owned', role: 'USER' },
    ],
  });
  await db.business.createMany({
    data: [
      { id: ID.bizA, name: `${P}Biz A`, slug: `${P}biz-a`, ownerId: ID.ownerA, forgetGraceDays: 30 },
      { id: ID.bizB, name: `${P}Biz B`, slug: `${P}biz-b`, ownerId: ID.ownerB, forgetGraceDays: 30 },
    ],
  });
  await db.membership.createMany({
    data: [
      { userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
      { userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
      {
        userId: ID.staffDelNone,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { crm: 'write', crm_view: 'all', crm_delete: 'none' },
      },
      {
        userId: ID.staffDelOwned,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { crm: 'write', crm_view: 'all', crm_delete: 'owned' },
      },
    ],
  });
}, 60_000);

afterAll(async () => {
  try {
    await app?.close();
  } finally {
    if (db) await cleanup();
  }
}, 60_000);

describe('V1-73 (RR-FORGET-CANCEL-KEEPS-PRIOR-DELETE): cancelling a forget request restores only what the forget request deleted', () => {
  it('[V73A-01] RED-BEFORE: soft-deleted contact -> requestForget -> cancelForget keeps the contact soft-deleted at its original deletedAt', async () => {
    const priorDeletedAt = new Date('2026-01-15T09:30:00.000Z');
    await db.contact.create({
      data: {
        id: ID.priorDeleted,
        businessId: ID.bizA,
        ownerId: ID.ownerA,
        visibility: 'TEAM',
        firstName: 'Prior',
        lastName: 'Deleted',
        email: EMAIL.priorDeleted,
        emailNormalized: EMAIL.priorDeleted,
        deletedAt: priorDeletedAt,
      },
    });

    await privacy.requestForget({
      businessId: ID.bizA,
      contactId: ID.priorDeleted,
      reason: 'GDPR request on trashed contact',
      actor: { type: 'USER', id: ID.ownerA, label: EMAIL.ownerA },
    });

    // requestForget must not overwrite the earlier deletedAt
    const afterRequest = await rawDeletedAt(ID.priorDeleted);
    expect(afterRequest?.toISOString()).toBe(priorDeletedAt.toISOString());

    const cancelRes = await privacy.cancelForget({
      businessId: ID.bizA,
      contactId: ID.priorDeleted,
      actor: { type: 'USER', id: ID.ownerA, label: EMAIL.ownerA },
    });

    expect(cancelRes).toMatchObject({
      ok: true,
      restored: false,
      priorSoftDeletePreserved: true,
    });
    expect(await rawForgetStatus(ID.priorDeleted)).toBe('cancelled');

    const afterCancel = await rawDeletedAt(ID.priorDeleted);
    expect(afterCancel).not.toBeNull();
    expect(afterCancel?.toISOString()).toBe(priorDeletedAt.toISOString());
  });

  it('[V73A-02] HTTP path: OWNER opens and cancels a forget request on an already soft-deleted contact while preserving its prior deletedAt', async () => {
    const priorDeletedAt = new Date('2026-02-10T14:00:00.000Z');
    await db.contact.create({
      data: {
        id: ID.priorDeletedHttp,
        businessId: ID.bizA,
        ownerId: ID.ownerA,
        visibility: 'TEAM',
        firstName: 'PriorHttp',
        lastName: 'Deleted',
        email: EMAIL.priorDeletedHttp,
        emailNormalized: EMAIL.priorDeletedHttp,
        deletedAt: priorDeletedAt,
      },
    });

    await request(app.getHttpServer())
      .post(`/crm/businesses/${ID.bizA}/contacts/${ID.priorDeletedHttp}/forget`)
      .set('x-test-user', ID.ownerA)
      .send({ reason: 'HTTP GDPR request' })
      .expect(201);

    expect((await rawDeletedAt(ID.priorDeletedHttp))?.toISOString()).toBe(priorDeletedAt.toISOString());

    const cancelHttp = await request(app.getHttpServer())
      .post(`/crm/businesses/${ID.bizA}/contacts/${ID.priorDeletedHttp}/forget/cancel`)
      .set('x-test-user', ID.ownerA)
      .send({})
      .expect(201);

    expect(cancelHttp.body).toMatchObject({
      ok: true,
      restored: false,
      priorSoftDeletePreserved: true,
    });
    expect((await rawDeletedAt(ID.priorDeletedHttp))?.toISOString()).toBe(priorDeletedAt.toISOString());
  });

  it('[V73A-03] NEGATIVE CONTROL: a live contact undergoing requestForget -> cancelForget comes back live as today', async () => {
    await db.contact.create({
      data: {
        id: ID.liveContact,
        businessId: ID.bizA,
        ownerId: ID.ownerA,
        visibility: 'TEAM',
        firstName: 'Live',
        lastName: 'Contact',
        email: EMAIL.liveContact,
        emailNormalized: EMAIL.liveContact,
      },
    });

    await privacy.requestForget({
      businessId: ID.bizA,
      contactId: ID.liveContact,
      reason: 'Accidental forget',
      actor: { type: 'USER', id: ID.ownerA, label: EMAIL.ownerA },
    });
    expect(await rawDeletedAt(ID.liveContact)).not.toBeNull();

    const cancelRes = await privacy.cancelForget({
      businessId: ID.bizA,
      contactId: ID.liveContact,
      actor: { type: 'USER', id: ID.ownerA, label: EMAIL.ownerA },
    });

    expect(cancelRes).toEqual({ ok: true });
    expect(await rawForgetStatus(ID.liveContact)).toBe('cancelled');
    expect(await rawDeletedAt(ID.liveContact)).toBeNull();
  });

  it('[V73A-04] D-16 identity reuse: cancelling a forget request on a previously soft-deleted contact whose email is now held by a live contact succeeds without 409', async () => {
    const priorDeletedAt = new Date('2026-03-01T08:00:00.000Z');
    await db.contact.create({
      data: {
        id: ID.reusedDeleted,
        businessId: ID.bizA,
        ownerId: ID.ownerA,
        visibility: 'TEAM',
        firstName: 'Old',
        lastName: 'Holder',
        email: EMAIL.reused,
        emailNormalized: EMAIL.reused,
        deletedAt: priorDeletedAt,
      },
    });
    await db.contact.create({
      data: {
        id: ID.reusedLive,
        businessId: ID.bizA,
        ownerId: ID.ownerA,
        visibility: 'TEAM',
        firstName: 'New',
        lastName: 'Holder',
        email: EMAIL.reused,
        emailNormalized: EMAIL.reused,
      },
    });

    await privacy.requestForget({
      businessId: ID.bizA,
      contactId: ID.reusedDeleted,
      actor: { type: 'USER', id: ID.ownerA, label: EMAIL.ownerA },
    });

    const cancelRes = await privacy.cancelForget({
      businessId: ID.bizA,
      contactId: ID.reusedDeleted,
      actor: { type: 'USER', id: ID.ownerA, label: EMAIL.ownerA },
    });
    expect(cancelRes).toMatchObject({ ok: true, restored: false, priorSoftDeletePreserved: true });
    expect((await rawDeletedAt(ID.reusedDeleted))?.toISOString()).toBe(priorDeletedAt.toISOString());
    expect(await rawDeletedAt(ID.reusedLive)).toBeNull();
  });

  it('[V73A-05] deliberate restore then second forget -> cancel restores the contact to live, and cross-tenant forget is refused 404', async () => {
    const priorDeletedAt = new Date('2026-04-05T11:00:00.000Z');
    await db.contact.create({
      data: {
        id: ID.cycleContact,
        businessId: ID.bizA,
        ownerId: ID.ownerA,
        visibility: 'TEAM',
        firstName: 'Cycle',
        lastName: 'Contact',
        email: EMAIL.cycleContact,
        emailNormalized: EMAIL.cycleContact,
        deletedAt: priorDeletedAt,
      },
    });

    // Cross-tenant attempt on bizA's soft-deleted contact must be refused 404
    await expect(
      privacy.requestForget({
        businessId: ID.bizB,
        contactId: ID.cycleContact,
        actor: { type: 'USER', id: ID.ownerB, label: EMAIL.ownerB },
      }),
    ).rejects.toThrow(/Contact not found/i);

    // Cycle 1: already soft-deleted -> forget -> cancel keeps it deleted
    await privacy.requestForget({
      businessId: ID.bizA,
      contactId: ID.cycleContact,
      actor: { type: 'USER', id: ID.ownerA, label: EMAIL.ownerA },
    });
    const c1 = await privacy.cancelForget({
      businessId: ID.bizA,
      contactId: ID.cycleContact,
      actor: { type: 'USER', id: ID.ownerA, label: EMAIL.ownerA },
    });
    expect(c1).toMatchObject({ ok: true, restored: false, priorSoftDeletePreserved: true });
    expect((await rawDeletedAt(ID.cycleContact))?.toISOString()).toBe(priorDeletedAt.toISOString());

    // Human deliberately restores the contact
    await db.contact.updateMany({
      where: { id: ID.cycleContact, businessId: ID.bizA },
      data: { deletedAt: null },
    });
    expect(await rawDeletedAt(ID.cycleContact)).toBeNull();

    // Cycle 2: now live -> forget -> cancel restores it back to live
    await privacy.requestForget({
      businessId: ID.bizA,
      contactId: ID.cycleContact,
      actor: { type: 'USER', id: ID.ownerA, label: EMAIL.ownerA },
    });
    expect(await rawDeletedAt(ID.cycleContact)).not.toBeNull();

    const c2 = await privacy.cancelForget({
      businessId: ID.bizA,
      contactId: ID.cycleContact,
      actor: { type: 'USER', id: ID.ownerA, label: EMAIL.ownerA },
    });
    expect(c2).toEqual({ ok: true });
    expect(await rawDeletedAt(ID.cycleContact)).toBeNull();
  });

  it('[V73A-06] R1 MAJOR-1: concurrent requestForget calls on a live contact write one deletedByForget=true audit row and cancelForget restores the contact to live', async () => {
    await db.contact.create({
      data: {
        id: ID.concurrentLive,
        businessId: ID.bizA,
        ownerId: ID.ownerA,
        visibility: 'TEAM',
        firstName: 'Concurrent',
        lastName: 'Live',
        email: EMAIL.concurrentLive,
        emailNormalized: EMAIL.concurrentLive,
      },
    });

    const [r1, r2] = await Promise.all([
      privacy.requestForget({
        businessId: ID.bizA,
        contactId: ID.concurrentLive,
        reason: 'Call 1',
        actor: { type: 'USER', id: ID.ownerA, label: EMAIL.ownerA },
      }),
      privacy.requestForget({
        businessId: ID.bizA,
        contactId: ID.concurrentLive,
        reason: 'Call 2',
        actor: { type: 'USER', id: ID.ownerA, label: EMAIL.ownerA },
      }),
    ]);
    expect(r1.id).toBe(r2.id);

    const audits = await db.contactAuditEntry.findMany({
      where: { businessId: ID.bizA, contactId: ID.concurrentLive, action: 'forget_requested' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].entityId).toBe(r1.id);
    expect(audits[0].after).toMatchObject({ deletedByForget: true });

    const cancelled = await privacy.cancelForget({
      businessId: ID.bizA,
      contactId: ID.concurrentLive,
      actor: { type: 'USER', id: ID.ownerA, label: EMAIL.ownerA },
    });
    expect(cancelled).toEqual({ ok: true });
    expect(await rawDeletedAt(ID.concurrentLive)).toBeNull();
  });

  it('[V73A-07] R1 MAJOR-2: already-purged contact (contactForgetRequest.contactId=null, status=purged) is refused on both service and HTTP forget', async () => {
    const purgedAt = new Date('2026-01-01T00:00:00.000Z');
    await db.contact.create({
      data: {
        id: ID.purgedContact,
        businessId: ID.bizA,
        ownerId: ID.ownerA,
        visibility: 'TEAM',
        firstName: 'Deleted',
        lastName: 'Contact',
        deletedAt: purgedAt,
      },
    });
    const { ContactAuditService } = await import('../src/modules/crm/privacy/contact-audit.service');
    const auditSvc = new ContactAuditService({ client: db } as any);
    await db.contactForgetRequest.create({
      data: {
        businessId: ID.bizA,
        contactId: null,
        contactHash: auditSvc.hashContact(ID.bizA, ID.purgedContact),
        status: 'purged',
        purgeAt: purgedAt,
        purgedAt,
      },
    });

    await expect(
      privacy.requestForget({
        businessId: ID.bizA,
        contactId: ID.purgedContact,
        actor: { type: 'USER', id: ID.ownerA, label: EMAIL.ownerA },
      }),
    ).rejects.toThrow(/already been purged/i);

    await request(app.getHttpServer())
      .post(`/crm/businesses/${ID.bizA}/contacts/${ID.purgedContact}/forget`)
      .set('x-test-user', ID.ownerA)
      .send({ reason: 'Should fail' })
      .expect(400);

    expect(await rawForgetStatus(ID.purgedContact)).toBeNull();
  });

  it('[V73A-08] R1 MAJOR-3: merged duplicate (mergedIntoId != null) cannot be independently forgotten via service or HTTP', async () => {
    await db.contact.create({
      data: {
        id: ID.mergedPrimary,
        businessId: ID.bizA,
        ownerId: ID.ownerA,
        visibility: 'TEAM',
        firstName: 'Primary',
        lastName: 'Row',
        email: EMAIL.mergedPrimary,
        emailNormalized: EMAIL.mergedPrimary,
      },
    });
    await db.contact.create({
      data: {
        id: ID.mergedDup,
        businessId: ID.bizA,
        ownerId: ID.ownerA,
        visibility: 'TEAM',
        firstName: 'Duplicate',
        lastName: 'Row',
        email: EMAIL.mergedDup,
        emailNormalized: EMAIL.mergedDup,
        mergedIntoId: ID.mergedPrimary,
        deletedAt: new Date('2026-02-01T00:00:00.000Z'),
      },
    });

    await expect(
      privacy.requestForget({
        businessId: ID.bizA,
        contactId: ID.mergedDup,
        actor: { type: 'USER', id: ID.ownerA, label: EMAIL.ownerA },
      }),
    ).rejects.toThrow(/Contact not found/i);

    await request(app.getHttpServer())
      .post(`/crm/businesses/${ID.bizA}/contacts/${ID.mergedDup}/forget`)
      .set('x-test-user', ID.ownerA)
      .send({})
      .expect(404);
  });

  it('[V73A-09] R1 MINOR-4/5: cross-tenant cancelForget refused 404, STAFF visibility & delete-scope hold on soft-deleted contacts, and audit entries carry provenance', async () => {
    const priorDeletedAt = new Date('2026-03-15T10:00:00.000Z');
    await db.contact.createMany({
      data: [
        {
          id: ID.staffPrivateDeleted,
          businessId: ID.bizA,
          ownerId: ID.ownerA,
          visibility: 'PRIVATE',
          firstName: 'Hidden',
          lastName: 'Deleted',
          email: EMAIL.staffPrivateDeleted,
          emailNormalized: EMAIL.staffPrivateDeleted,
          deletedAt: priorDeletedAt,
        },
        {
          id: ID.staffTeamDeleted,
          businessId: ID.bizA,
          ownerId: ID.ownerA,
          visibility: 'TEAM',
          firstName: 'Team',
          lastName: 'Deleted',
          email: EMAIL.staffTeamDeleted,
          emailNormalized: EMAIL.staffTeamDeleted,
          deletedAt: priorDeletedAt,
        },
      ],
    });

    // Hidden soft-deleted PRIVATE contact -> 404 for STAFF (no existence oracle)
    await request(app.getHttpServer())
      .post(`/crm/businesses/${ID.bizA}/contacts/${ID.staffPrivateDeleted}/forget`)
      .set('x-test-user', ID.staffDelOwned)
      .send({})
      .expect(404);

    // Visible soft-deleted TEAM contact -> 403 for crm_delete='none' and crm_delete='owned' (owned by ownerA)
    await request(app.getHttpServer())
      .post(`/crm/businesses/${ID.bizA}/contacts/${ID.staffTeamDeleted}/forget`)
      .set('x-test-user', ID.staffDelNone)
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .post(`/crm/businesses/${ID.bizA}/contacts/${ID.staffTeamDeleted}/forget`)
      .set('x-test-user', ID.staffDelOwned)
      .send({})
      .expect(403);

    // Owner opens forget -> cross-tenant bizB cancelForget refused 404 -> owner cancels and audit trail carries full provenance
    const reqRow = await privacy.requestForget({
      businessId: ID.bizA,
      contactId: ID.staffTeamDeleted,
      actor: { type: 'USER', id: ID.ownerA, label: EMAIL.ownerA },
    });
    await expect(
      privacy.cancelForget({
        businessId: ID.bizB,
        contactId: ID.staffTeamDeleted,
        actor: { type: 'USER', id: ID.ownerB, label: EMAIL.ownerB },
      }),
    ).rejects.toThrow(/Forget request not found/i);

    const cancelRes = await privacy.cancelForget({
      businessId: ID.bizA,
      contactId: ID.staffTeamDeleted,
      actor: { type: 'USER', id: ID.ownerA, label: EMAIL.ownerA },
    });
    expect(cancelRes).toEqual({ ok: true, restored: false, priorSoftDeletePreserved: true });

    const reqAudit = await db.contactAuditEntry.findFirst({
      where: { businessId: ID.bizA, contactId: ID.staffTeamDeleted, action: 'forget_requested' },
    });
    expect(reqAudit?.entityId).toBe(reqRow.id);
    expect(reqAudit?.after).toMatchObject({
      deletedByForget: false,
      priorDeletedAt: priorDeletedAt.toISOString(),
    });
    const cancelAudit = await db.contactAuditEntry.findFirst({
      where: { businessId: ID.bizA, contactId: ID.staffTeamDeleted, action: 'forget_cancelled' },
    });
    expect(cancelAudit?.entityId).toBe(reqRow.id);
    expect(cancelAudit?.after).toMatchObject({
      restored: false,
      priorSoftDeletePreserved: true,
    });
  });
});
