/**
 * FU-MERGE-CONTACTS-UNIQUE (P112; owner ruling D-221) — merging two contacts no longer fails when
 * the primary lacks the duplicate's email or phone, and an existing-email or existing-phone conflict
 * with a third live contact still refuses cleanly (409, nothing written).
 *
 * Found by TOF-CONTACT-AUDIT-AWAIT: CrmService.mergeContacts updated the primary contact with the
 * duplicate's email / phone BEFORE soft-deleting the duplicate inside the transaction, so the live
 * partial unique indexes (`contacts_business_id_email_normalized_live_key` and
 * `contacts_business_id_phone_normalized_live_key`, D-16) refused the update with P2002 and the
 * route answered 500. In addition, fieldOverrides on `email` or `phone` did not recompute
 * `emailNormalized` / `phoneNormalized`, and mergeContacts did not map identity P2002 /
 * ContactPhoneHeldError conflicts to 409 via rejectContactIdentityTaken.
 *
 * Against a REAL Postgres database, through the real HTTP route
 * `POST /crm/businesses/:businessId/contacts/:contactId/merge/:duplicateId`.
 *
 * Fixture prefix: `v71h_`. Cleaned up with raw SQL using `sqlLikePrefix(P)`.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { CONTACT_EVENT } from '@keyflow/shared';
import { sqlLikePrefix } from './helpers/sql-like.js';
import { trackAsyncWrites } from './helpers/async-writes.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v71h_';
const ID = {
  owner: `${P}owner`,
  staffOwned: `${P}staffOwned`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
};

const C = {
  // bizA — happy-path merges (5 merge calls total, well under 10/min rate limit)
  ePrimary: `${P}a_e_pri`,
  eDup: `${P}a_e_dup`,
  eDupNote: `${P}a_e_dup_note`,
  eDupTask: `${P}a_e_dup_task`,

  pPrimary: `${P}a_p_pri`,
  pDup: `${P}a_p_dup`,

  bPrimary: `${P}a_b_pri`,
  bDup: `${P}a_b_dup`,

  oPrimary: `${P}a_o_pri`,
  oDup: `${P}a_o_dup`,

  ctrlPrimary: `${P}a_ctrl_pri`,
  ctrlDup: `${P}a_ctrl_dup`,

  // bizB — conflict & negative controls (5 merge calls total, well under 10/min rate limit)
  cPrimary: `${P}b_c_pri`,
  cDup: `${P}b_c_dup`,
  cDupNote: `${P}b_c_dup_note`,
  cThird: `${P}b_c_third`,

  p3Primary: `${P}b_p3_pri`,
  p3Dup: `${P}b_p3_dup`,
  p3Third: `${P}b_p3_third`,
};

const EMAIL = {
  eDup: `${P}dup-email@example.test`,
  bDup: `${P}both-dup@example.test`,
  oPri: `${P}override-pri@example.test`,
  oDup: `${P}override-dup@example.test`,
  oDupUpper: `${P}OVERRIDE-DUP@example.test`,
  ctrlPri: `${P}ctrl-pri@example.test`,
  ctrlDup: `${P}ctrl-dup@example.test`,
  cDup: `${P}conflict-dup@example.test`,
  cThird: `${P}third-live@example.test`,
  cThirdUpper: `${P}THIRD-LIVE@example.test`,
};

const PHONE = {
  pDup: '+18687180101',
  bDup: '+18687180102',
  oPri: '+18687180103',
  oDup: '+18687180104',
  ctrlPri: '+18687180105',
  ctrlDup: '+18687180106',
  p3Third: '+18687180199',
  p3ThirdLocal: '868-718-0199',
};

let db: any;
let app: any;
let asyncWrites: ReturnType<typeof trackAsyncWrites> | undefined;
const mergedEvents: Array<{ businessId: string; primaryId: string; duplicateId: string }> = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_tasks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_data_issues WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM merge_operations WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function mergeReq(
  businessId: string,
  primaryId: string,
  duplicateId: string,
  body: Record<string, unknown> = {},
  actor: string = ID.owner,
) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${businessId}/contacts/${primaryId}/merge/${duplicateId}`)
    .set('x-test-user', actor)
    .send(body);
}

function createContactReq(businessId: string, body: Record<string, unknown>, actor: string = ID.owner) {
  return request(app.getHttpServer())
    .post(`/crm/businesses/${businessId}/contacts`)
    .set('x-test-user', actor)
    .send(body);
}

async function storedContact(id: string) {
  const rows = await db.$queryRawUnsafe(
    `SELECT id, business_id, email, email_normalized, phone, phone_normalized,
            job_title, deleted_at, merged_into_id, last_merge_id
       FROM contacts WHERE id = $1`,
    id,
  );
  return rows[0] ?? null;
}

async function auditsOf(businessId: string, contactId: string) {
  return db.contactAuditEntry.findMany({
    where: { businessId, contactId },
    orderBy: { createdAt: 'asc' },
  });
}

async function mergeEventsOf(businessId: string, contactId: string) {
  return db.contactEvent.findMany({
    where: { businessId, contactId, type: CONTACT_EVENT.CONTACT_MERGED },
    orderBy: { createdAt: 'asc' },
  });
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe, Logger } = await import('@nestjs/common');
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
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
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

  Logger.overrideLogger(['error']);

  asyncWrites = trackAsyncWrites([
    [TeamAuditInterceptor.prototype, 'record'],
  ]);

  const events = new EventEmitter2();
  events.on('contact.merged', (payload: { businessId?: string; contact?: { id: string }; duplicateId?: string }) => {
    if (payload?.businessId?.startsWith(P)) {
      mergedEvents.push({
        businessId: payload.businessId,
        primaryId: payload.contact?.id ?? '',
        duplicateId: payload.duplicateId ?? '',
      });
    }
  });

  const moduleRef = await Test.createTestingModule({
    controllers: [CrmController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      FeatureFlagGuard,
      PlanLimitGuard,
      TeamAuditInterceptor,
      CrmStatsService,
      CrmService,
      CrmTimelineService,
      ContactAuditService,
      EntityResolutionService,
      { provide: EventEmitter2, useValue: events },
      { provide: TimelineService, useValue: { recordEvent: async () => undefined } },
      { provide: EvidenceService, useValue: {} },
      { provide: TaskAssignmentService, useValue: {} },
      { provide: CrmCacheService, useValue: { invalidate: async () => undefined } },
      { provide: CrmFlowService, useValue: { invalidateCache: () => undefined } },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CrmListsService, useValue: {} },
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
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup();

  // ---- Users, businesses, memberships ------------------------------------
  await db.user.create({ data: { id: ID.owner, email: `${P}owner@example.test`, role: 'USER' } });
  await db.user.create({ data: { id: ID.staffOwned, email: `${P}staff-owned@example.test`, role: 'USER' } });

  await db.business.create({ data: { id: ID.bizA, name: 'V71H Biz A', ownerId: ID.owner, country: 'Trinidad and Tobago' } });
  await db.business.create({ data: { id: ID.bizB, name: 'V71H Biz B', ownerId: ID.owner, country: 'Trinidad and Tobago' } });

  await db.membership.create({ data: { id: `${P}m_owner_a`, userId: ID.owner, businessId: ID.bizA, role: 'OWNER' } });
  await db.membership.create({ data: { id: `${P}m_owner_b`, userId: ID.owner, businessId: ID.bizB, role: 'OWNER' } });
  await db.membership.create({
    data: {
      id: `${P}m_staff_b`,
      userId: ID.staffOwned,
      businessId: ID.bizB,
      role: 'STAFF',
      permissionScopes: { crm: 'write', crm_view: 'owned' },
    },
  });

  // ---- bizA contacts -----------------------------------------------------
  // 1. Primary lacks email, duplicate has email (+ note + task to verify atomic repoint)
  await db.contact.create({ data: { id: C.ePrimary, businessId: ID.bizA, firstName: 'Elena', lastName: `${P}seed` } });
  await db.contact.create({
    data: {
      id: C.eDup,
      businessId: ID.bizA,
      firstName: 'Elena',
      lastName: `${P}seed`,
      email: EMAIL.eDup,
      emailNormalized: EMAIL.eDup,
    },
  });
  await db.contactNote.create({ data: { id: C.eDupNote, businessId: ID.bizA, contactId: C.eDup, body: `${P}dup note` } });
  await db.contactTask.create({ data: { id: C.eDupTask, businessId: ID.bizA, contactId: C.eDup, title: `${P}dup task` } });

  // 2. Primary lacks phone, duplicate has phone
  await db.contact.create({ data: { id: C.pPrimary, businessId: ID.bizA, firstName: 'Paulo', lastName: `${P}seed` } });
  await db.contact.create({
    data: {
      id: C.pDup,
      businessId: ID.bizA,
      firstName: 'Paulo',
      lastName: `${P}seed`,
      phone: PHONE.pDup,
      phoneNormalized: PHONE.pDup,
    },
  });

  // 3. Primary lacks both email and phone, duplicate has both
  await db.contact.create({ data: { id: C.bPrimary, businessId: ID.bizA, firstName: 'Bianca', lastName: `${P}seed` } });
  await db.contact.create({
    data: {
      id: C.bDup,
      businessId: ID.bizA,
      firstName: 'Bianca',
      lastName: `${P}seed`,
      email: EMAIL.bDup,
      emailNormalized: EMAIL.bDup,
      phone: PHONE.bDup,
      phoneNormalized: PHONE.bDup,
    },
  });

  // 4. Both have distinct email and phone; fieldOverrides chooses duplicate's email & phone
  await db.contact.create({
    data: {
      id: C.oPrimary,
      businessId: ID.bizA,
      firstName: 'Omar',
      lastName: `${P}seed`,
      email: EMAIL.oPri,
      emailNormalized: EMAIL.oPri,
      phone: PHONE.oPri,
      phoneNormalized: PHONE.oPri,
    },
  });
  await db.contact.create({
    data: {
      id: C.oDup,
      businessId: ID.bizA,
      firstName: 'Omar',
      lastName: `${P}seed`,
      email: EMAIL.oDup,
      emailNormalized: EMAIL.oDup,
      phone: PHONE.oDup,
      phoneNormalized: PHONE.oDup,
    },
  });

  // 5. Control: both have distinct email & phone, no override -> primary keeps its own
  await db.contact.create({
    data: {
      id: C.ctrlPrimary,
      businessId: ID.bizA,
      firstName: 'Cara',
      lastName: `${P}seed`,
      email: EMAIL.ctrlPri,
      emailNormalized: EMAIL.ctrlPri,
      phone: PHONE.ctrlPri,
      phoneNormalized: PHONE.ctrlPri,
    },
  });
  await db.contact.create({
    data: {
      id: C.ctrlDup,
      businessId: ID.bizA,
      firstName: 'Cara',
      lastName: `${P}seed`,
      email: EMAIL.ctrlDup,
      emailNormalized: EMAIL.ctrlDup,
      phone: PHONE.ctrlDup,
      phoneNormalized: PHONE.ctrlDup,
      jobTitle: 'Director',
    },
  });

  // ---- bizB contacts (conflicts & negative controls) ---------------------
  // 6. Email conflict with a third live contact
  await db.contact.create({ data: { id: C.cPrimary, businessId: ID.bizB, firstName: 'Nora', lastName: `${P}seed` } });
  await db.contact.create({
    data: {
      id: C.cDup,
      businessId: ID.bizB,
      firstName: 'Nora',
      lastName: `${P}seed`,
      email: EMAIL.cDup,
      emailNormalized: EMAIL.cDup,
    },
  });
  await db.contactNote.create({ data: { id: C.cDupNote, businessId: ID.bizB, contactId: C.cDup, body: `${P}stays on dup` } });
  await db.contact.create({
    data: {
      id: C.cThird,
      businessId: ID.bizB,
      firstName: 'Third',
      lastName: `${P}seed`,
      email: EMAIL.cThird,
      emailNormalized: EMAIL.cThird,
    },
  });

  // 7. Phone conflict with a third live contact (owned by owner, invisible to staffOwned)
  await db.contact.create({
    data: { id: C.p3Primary, businessId: ID.bizB, firstName: 'Sora', lastName: `${P}seed`, ownerId: ID.staffOwned },
  });
  await db.contact.create({
    data: { id: C.p3Dup, businessId: ID.bizB, firstName: 'Sora', lastName: `${P}seed`, ownerId: ID.staffOwned },
  });
  await db.contact.create({
    data: {
      id: C.p3Third,
      businessId: ID.bizB,
      firstName: 'HiddenHolder',
      lastName: `${P}seed`,
      ownerId: ID.owner,
      phone: PHONE.p3Third,
      phoneNormalized: PHONE.p3Third,
    },
  });
}, 120_000);

afterAll(async () => {
  await asyncWrites?.drain().catch(() => undefined);
  if (app) await app.close();
  if (db) await cleanup();
  asyncWrites?.restore();
});

describe('fixture sanity (real Postgres partial unique indexes)', () => {
  it('both live-row partial unique indexes exist on contacts (D-16)', async () => {
    const rows: Array<{ indexname: string; indexdef: string }> = await db.$queryRawUnsafe(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'contacts'
          AND indexname IN (
            'contacts_business_id_email_normalized_live_key',
            'contacts_business_id_phone_normalized_live_key'
          )
        ORDER BY indexname`,
    );
    expect(rows.map((r) => r.indexname)).toEqual([
      'contacts_business_id_email_normalized_live_key',
      'contacts_business_id_phone_normalized_live_key',
    ]);
    for (const row of rows) {
      expect(row.indexdef).toMatch(/WHERE\s*\(?deleted_at IS NULL\)?/i);
    }
  });
});

describe('FU-MERGE-CONTACTS-UNIQUE: merging duplicate email/phone into primary succeeds atomically', () => {
  it('RED-BEFORE: primary lacks email, duplicate has email -> 201, primary carries email/emailNormalized, duplicate soft-deleted, relations repointed, both audit rows & merge event written once', async () => {
    const eventsBefore = mergedEvents.filter((e) => e.businessId === ID.bizA && e.primaryId === C.ePrimary).length;

    const res = await mergeReq(ID.bizA, C.ePrimary, C.eDup);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body).toMatchObject({
      id: C.ePrimary,
      email: EMAIL.eDup,
      emailNormalized: EMAIL.eDup,
    });
    expect(res.body.mergeId).toBeTruthy();

    const pri = await storedContact(C.ePrimary);
    const dup = await storedContact(C.eDup);
    expect(pri).toMatchObject({
      email: EMAIL.eDup,
      email_normalized: EMAIL.eDup,
      deleted_at: null,
      last_merge_id: res.body.mergeId,
    });
    expect(dup.deleted_at).not.toBeNull();
    expect(dup).toMatchObject({
      merged_into_id: C.ePrimary,
      last_merge_id: res.body.mergeId,
    });

    // Related rows atomically repointed to primary
    const note = await db.contactNote.findUnique({ where: { id: C.eDupNote } });
    const task = await db.contactTask.findUnique({ where: { id: C.eDupTask } });
    expect(note?.contactId).toBe(C.ePrimary);
    expect(task?.contactId).toBe(C.ePrimary);

    // Both audit rows written once, naming the owner
    const priAudits = await auditsOf(ID.bizA, C.ePrimary);
    const dupAudits = await auditsOf(ID.bizA, C.eDup);
    expect(priAudits).toHaveLength(1);
    expect(dupAudits).toHaveLength(1);
    expect(priAudits[0]).toMatchObject({ action: 'merged', actor: { type: 'USER', id: ID.owner } });
    expect(dupAudits[0]).toMatchObject({ action: 'merged', actor: { type: 'USER', id: ID.owner } });

    // Merge ContactEvent + domain event emitted once
    const contactEvents = await mergeEventsOf(ID.bizA, C.ePrimary);
    expect(contactEvents).toHaveLength(1);
    expect(mergedEvents.filter((e) => e.businessId === ID.bizA && e.primaryId === C.ePrimary)).toHaveLength(eventsBefore + 1);

    // Subsequent duplicate detection sees primary holding the email
    const dupCreate = await createContactReq(ID.bizA, { firstName: 'Other', lastName: `${P}probe`, email: EMAIL.eDup });
    expect(dupCreate.status).toBe(409);
    expect(dupCreate.body).toMatchObject({ code: 'contact_email_taken', details: { existingContactId: C.ePrimary } });
  });

  it('RED-BEFORE: primary lacks phone, duplicate has phone -> 201, primary carries phone/phoneNormalized, duplicate soft-deleted, both audit rows & merge event written once', async () => {
    const res = await mergeReq(ID.bizA, C.pPrimary, C.pDup);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body).toMatchObject({
      id: C.pPrimary,
      phone: PHONE.pDup,
      phoneNormalized: PHONE.pDup,
    });

    const pri = await storedContact(C.pPrimary);
    const dup = await storedContact(C.pDup);
    expect(pri).toMatchObject({
      phone: PHONE.pDup,
      phone_normalized: PHONE.pDup,
      deleted_at: null,
      last_merge_id: res.body.mergeId,
    });
    expect(dup.deleted_at).not.toBeNull();
    expect(dup).toMatchObject({ merged_into_id: C.pPrimary, last_merge_id: res.body.mergeId });

    expect(await auditsOf(ID.bizA, C.pPrimary)).toHaveLength(1);
    expect(await auditsOf(ID.bizA, C.pDup)).toHaveLength(1);
    expect(await mergeEventsOf(ID.bizA, C.pPrimary)).toHaveLength(1);
  });

  it('RED-BEFORE: primary lacks both email and phone, duplicate has both -> 201, primary carries both, duplicate soft-deleted', async () => {
    const res = await mergeReq(ID.bizA, C.bPrimary, C.bDup);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);

    const pri = await storedContact(C.bPrimary);
    const dup = await storedContact(C.bDup);
    expect(pri).toMatchObject({
      email: EMAIL.bDup,
      email_normalized: EMAIL.bDup,
      phone: PHONE.bDup,
      phone_normalized: PHONE.bDup,
      deleted_at: null,
    });
    expect(dup.deleted_at).not.toBeNull();
    expect(await auditsOf(ID.bizA, C.bPrimary)).toHaveLength(1);
    expect(await auditsOf(ID.bizA, C.bDup)).toHaveLength(1);
    expect(await mergeEventsOf(ID.bizA, C.bPrimary)).toHaveLength(1);
  });

  it('RED-BEFORE: both contacts have email & phone, fieldOverrides picks duplicate email & phone -> 201 and primary normalized keys match chosen values', async () => {
    const res = await mergeReq(ID.bizA, C.oPrimary, C.oDup, {
      fieldOverrides: { email: EMAIL.oDupUpper, phone: PHONE.oDup },
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);

    const pri = await storedContact(C.oPrimary);
    const dup = await storedContact(C.oDup);
    expect(pri).toMatchObject({
      email: EMAIL.oDupUpper,
      email_normalized: EMAIL.oDup,
      phone: PHONE.oDup,
      phone_normalized: PHONE.oDup,
      deleted_at: null,
    });
    expect(dup.deleted_at).not.toBeNull();
    expect(await auditsOf(ID.bizA, C.oPrimary)).toHaveLength(1);
    expect(await auditsOf(ID.bizA, C.oDup)).toHaveLength(1);
    expect(await mergeEventsOf(ID.bizA, C.oPrimary)).toHaveLength(1);
  });

  it('CONTROL: primary already has distinct email & phone, no override -> 201, primary keeps its own email & phone and fills empty fields', async () => {
    const res = await mergeReq(ID.bizA, C.ctrlPrimary, C.ctrlDup);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);

    const pri = await storedContact(C.ctrlPrimary);
    const dup = await storedContact(C.ctrlDup);
    expect(pri).toMatchObject({
      email: EMAIL.ctrlPri,
      email_normalized: EMAIL.ctrlPri,
      phone: PHONE.ctrlPri,
      phone_normalized: PHONE.ctrlPri,
      job_title: 'Director',
      deleted_at: null,
    });
    expect(dup.deleted_at).not.toBeNull();
  });
});

describe('FU-MERGE-CONTACTS-UNIQUE: existing-identity conflicts refuse cleanly (409, nothing written)', () => {
  it('RED-BEFORE: email held by a third live contact -> 409 contact_email_taken, duplicate stays live, note not repointed, zero mergeOp/audit/event rows', async () => {
    const mergedBefore = mergedEvents.filter((e) => e.businessId === ID.bizB).length;

    const res = await mergeReq(ID.bizB, C.cPrimary, C.cDup, {
      fieldOverrides: { email: EMAIL.cThirdUpper },
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(409);
    expect(res.body).toMatchObject({
      code: 'contact_email_taken',
      details: { existingContactId: C.cThird },
    });

    // Full rollback: nothing written
    const pri = await storedContact(C.cPrimary);
    const dup = await storedContact(C.cDup);
    expect(pri).toMatchObject({ email: null, email_normalized: null, deleted_at: null, last_merge_id: null });
    expect(dup).toMatchObject({ email: EMAIL.cDup, email_normalized: EMAIL.cDup, deleted_at: null, merged_into_id: null, last_merge_id: null });

    const note = await db.contactNote.findUnique({ where: { id: C.cDupNote } });
    expect(note?.contactId).toBe(C.cDup);

    expect(await db.mergeOperation.count({ where: { businessId: ID.bizB } })).toBe(0);
    expect(await db.contactAuditEntry.count({ where: { businessId: ID.bizB } })).toBe(0);
    expect(await db.contactEvent.count({ where: { businessId: ID.bizB } })).toBe(0);
    expect(mergedEvents.filter((e) => e.businessId === ID.bizB)).toHaveLength(mergedBefore);
  });

  it('RED-BEFORE: phone held by a third live contact -> 409 contact_phone_taken (visibility-bounded existingContactId), nothing written', async () => {
    // 1. Owned-scope staff cannot see p3Third (owned by owner): 409 with existingContactId: null
    const staffRes = await mergeReq(
      ID.bizB,
      C.p3Primary,
      C.p3Dup,
      { fieldOverrides: { phone: PHONE.p3ThirdLocal } },
      ID.staffOwned,
    );
    expect(staffRes.status, JSON.stringify(staffRes.body).slice(0, 300)).toBe(409);
    expect(staffRes.body).toMatchObject({
      code: 'contact_phone_taken',
      details: { existingContactId: null },
    });

    // 2. Owner sees p3Third: 409 naming p3Third
    const ownerRes = await mergeReq(
      ID.bizB,
      C.p3Primary,
      C.p3Dup,
      { fieldOverrides: { phone: PHONE.p3ThirdLocal } },
      ID.owner,
    );
    expect(ownerRes.status, JSON.stringify(ownerRes.body).slice(0, 300)).toBe(409);
    expect(ownerRes.body).toMatchObject({
      code: 'contact_phone_taken',
      details: { existingContactId: C.p3Third },
    });

    // Nothing written across both refused merges
    expect(await storedContact(C.p3Primary)).toMatchObject({ phone: null, phone_normalized: null, deleted_at: null, last_merge_id: null });
    expect(await storedContact(C.p3Dup)).toMatchObject({ deleted_at: null, merged_into_id: null, last_merge_id: null });
    expect(await db.mergeOperation.count({ where: { businessId: ID.bizB } })).toBe(0);
    expect(await db.contactAuditEntry.count({ where: { businessId: ID.bizB } })).toBe(0);
    expect(await db.contactEvent.count({ where: { businessId: ID.bizB } })).toBe(0);
  });

  it('CONTROL: self-merge (400) and cross-tenant merge (404) are refused with nothing written', async () => {
    const mergeOpsBefore = await db.mergeOperation.count({ where: { businessId: ID.bizB } });
    const auditsBefore = await db.contactAuditEntry.count({ where: { businessId: ID.bizB } });

    const selfRes = await mergeReq(ID.bizB, C.cPrimary, C.cPrimary);
    expect(selfRes.status).toBe(400);

    const crossRes = await mergeReq(ID.bizB, C.cPrimary, C.ePrimary);
    expect(crossRes.status).toBe(404);

    expect(await db.mergeOperation.count({ where: { businessId: ID.bizB } })).toBe(mergeOpsBefore);
    expect(await db.contactAuditEntry.count({ where: { businessId: ID.bizB } })).toBe(auditsBefore);
  });
});
