/**
 * P46 — V1-93 (WEDGE-WA-INBOUND-CAPTURE, server half, P0, D-263 wedge):
 * `POST /crm/businesses/:businessId/whatsapp/inbound-capture`
 *
 * Normalizes a pasted customer WhatsApp number under `Business.country`
 * (WA-E164-SERVER), finds an existing contact by E.164 (including legacy
 * national spellings and `whatsappNumber`-only rows) or creates one, saves
 * the pasted message verbatim as a plain-text `ContactNote`
 * (`source: 'whatsapp_inbound'`), and records a canonical
 * `communication.whatsapp` `ContactEvent` (aligned with `P41`
 * `FU-CONTACT-TIMELINE-CHANNELS`). Sends zero outbound messages and makes
 * zero KEY/AI calls.
 *
 * REAL Postgres database, REAL CrmController, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CrmRateLimitGuard, ValidationPipe, GlobalHttpExceptionFilter,
 * CrmService, CrmTimelineService, ContactAuditService, EntityResolutionService.
 * Fixtures use prefix `v93w_` and are hard-deleted with `sqlLikePrefix(P)`.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 90_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const savedMx = process.env.KF_DISABLE_MX;
process.env.KF_DISABLE_MX = '1';

const P = 'v93w_';
const HEADER = 'x-v93w-user';

const ID = {
  ownerA: `${P}ownerA`,
  staffRead: `${P}staffRead`,
  staffBook: `${P}staffBook`,
  ownerB: `${P}ownerB`,
  bizTT: `${P}bizTT`,
  bizGY: `${P}bizGY`,
  bizB: `${P}bizB`,
  contactLegacyGY: `${P}c_legacyGY`,
  contactWaOnlyTT: `${P}c_waOnlyTT`,
  contactPrivateTT: `${P}c_privTT`,
  contactForeignB: `${P}c_foreignB`,
};

let db: any;
let app: any;
let ipCounter = 10;

const emittedEvents: Array<{ name: string; payload: unknown }> = [];
const eventBus = {
  emit: (name: string, payload: unknown) => {
    emittedEvents.push({ name, payload });
    return true;
  },
  emitAsync: async (name: string, payload: unknown) => {
    emittedEvents.push({ name, payload });
    return [];
  },
  on: () => undefined,
  off: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
};

function nextIp() {
  ipCounter += 1;
  return `10.93.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_data_issues WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_notes WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort cleanup */
    }
  }
}

function capture(actor: string | null, businessId: string, body: Record<string, unknown>) {
  const req = request(app.getHttpServer())
    .post(`/crm/businesses/${businessId}/whatsapp/inbound-capture`)
    .set('x-forwarded-for', nextIp());
  if (actor) req.set(HEADER, actor);
  return req.send(body);
}

function listNotes(actor: string, businessId: string, contactId: string) {
  return request(app.getHttpServer())
    .get(`/crm/businesses/${businessId}/contacts/${contactId}/notes`)
    .set(HEADER, actor)
    .set('x-forwarded-for', nextIp());
}

function listEvents(actor: string, businessId: string, contactId: string) {
  return request(app.getHttpServer())
    .get(`/crm/businesses/${businessId}/contacts/${contactId}/events`)
    .set(HEADER, actor)
    .set('x-forwarded-for', nextIp());
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

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
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
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
  const { TimelineService } = await import('../src/modules/timeline/timeline.service');
  const { EvidenceService } = await import('../src/modules/evidence/evidence.service');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');

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
      { provide: EventEmitter2, useValue: eventBus },
      { provide: TimelineService, useValue: { recordEvent: async () => null } },
      { provide: EvidenceService, useValue: { record: async () => null } },
      { provide: TaskAssignmentService, useValue: {} },
      { provide: CrmCacheService, useValue: { invalidate: async () => undefined } },
      { provide: CrmFlowService, useValue: { invalidateCache: () => undefined } },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CrmImportService, useValue: {} },
      { provide: AiUsageService, useValue: {} },
      { provide: CrmListsService, useValue: {} },
      { provide: ContactCustomFieldValueService, useValue: {} },
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
    const header = req.headers[HEADER];
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

  for (const [key, id] of [
    ['ownerA', ID.ownerA],
    ['staffRead', ID.staffRead],
    ['staffBook', ID.staffBook],
    ['ownerB', ID.ownerB],
  ] as const) {
    await db.user.create({ data: { id, email: `${P}${key}@test.local`, role: 'USER' } });
  }

  await db.business.create({ data: { id: ID.bizTT, name: 'V93W TT Shop', ownerId: ID.ownerA, currency: 'TTD', country: null } });
  await db.business.create({ data: { id: ID.bizGY, name: 'V93W GY Shop', ownerId: ID.ownerA, currency: 'GYD', country: 'Guyana' } });
  await db.business.create({ data: { id: ID.bizB, name: 'V93W Other Biz', ownerId: ID.ownerB, currency: 'TTD', country: 'TT' } });

  await db.membership.createMany({
    data: [
      { id: `${P}m_ownerTT`, userId: ID.ownerA, businessId: ID.bizTT, role: 'OWNER' },
      { id: `${P}m_ownerGY`, userId: ID.ownerA, businessId: ID.bizGY, role: 'OWNER' },
      { id: `${P}m_readTT`, userId: ID.staffRead, businessId: ID.bizTT, role: 'STAFF', permissionScopes: { crm: 'read' } },
      {
        id: `${P}m_bookTT`,
        userId: ID.staffBook,
        businessId: ID.bizTT,
        role: 'STAFF',
        permissionScopes: { crm: 'write', crm_view: 'owned', crm_edit: 'owned' },
      },
      { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
    ],
  });

  // Legacy Guyana contact stored before E.164 under local spelling
  await db.contact.create({
    data: {
      id: ID.contactLegacyGY,
      businessId: ID.bizGY,
      firstName: 'Devon',
      lastName: 'Persaud',
      phone: '600-8811',
      phoneNormalized: '6008811',
      status: 'LEAD',
    },
  });

  // TT contact holding WhatsApp number only with separator inside last 4 digits (SEC/COR-WAIC-1)
  await db.contact.create({
    data: {
      id: ID.contactWaOnlyTT,
      businessId: ID.bizTT,
      firstName: 'Maya',
      lastName: 'Ali',
      phone: null,
      phoneNormalized: null,
      whatsappNumber: '+1 868 712 49 02',
      status: 'LEAD',
    },
  });

  // Owner-owned PRIVATE contact in bizTT (invisible to staffBook), whatsappNumber-only with separator inside last 4 digits
  await db.contact.create({
    data: {
      id: ID.contactPrivateTT,
      businessId: ID.bizTT,
      firstName: 'Private',
      lastName: 'VIP',
      phone: null,
      phoneNormalized: null,
      whatsappNumber: '+1 868 712 49 03',
      ownerId: ID.ownerA,
      visibility: 'PRIVATE',
      status: 'CLIENT',
    },
  });

  // Foreign business contact
  await db.contact.create({
    data: {
      id: ID.contactForeignB,
      businessId: ID.bizB,
      firstName: 'Foreign',
      lastName: 'Client',
      phone: '+18687124999',
      phoneNormalized: '+18687124999',
      status: 'LEAD',
    },
  });
}, 90_000);

beforeEach(() => {
  emittedEvents.length = 0;
});

afterAll(async () => {
  await cleanup();
  await app?.close();
  if (savedMx === undefined) delete process.env.KF_DISABLE_MX;
  else process.env.KF_DISABLE_MX = savedMx;
}, 30_000);

describe('P46 (WEDGE-WA-INBOUND-CAPTURE, server half): POST /crm/businesses/:businessId/whatsapp/inbound-capture', () => {
  it('WAIC-01 RED-BEFORE: normalizes local TT number to E.164, creates contact, saves plain-text note verbatim and canonical communication.whatsapp event', async () => {
    const rawMsg = 'Hi! Need a quote for <b>3 cakes</b> & delivery <script>alert(1)</script> on Friday.';
    const res = await capture(ID.ownerA, ID.bizTT, {
      phone: '712-4901',
      message: `  ${rawMsg}  `,
      firstName: 'Kerry',
      lastName: 'Singh',
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.created).toBe(true);
    expect(res.body.normalizedPhone).toBe('+18687124901');
    expect(res.body.contact).toMatchObject({
      businessId: ID.bizTT,
      firstName: 'Kerry',
      lastName: 'Singh',
      phone: '+18687124901',
      whatsappNumber: '+18687124901',
    });
    expect(res.body.note).toMatchObject({
      contactId: res.body.contact.id,
      body: rawMsg,
      source: 'whatsapp_inbound',
    });
    expect(res.body.event).toMatchObject({
      contactId: res.body.contact.id,
      type: 'communication.whatsapp',
      source: 'whatsapp_inbound',
      actorType: 'USER',
      actorId: ID.ownerA,
      data: {
        channel: 'whatsapp',
        direction: 'inbound',
        source: 'pasted_whatsapp',
        body: rawMsg,
        senderPhone: '+18687124901',
        noteId: res.body.note.id,
      },
    });

    // Persisted and readable on the contact timeline (notes + events)
    const notesRes = await listNotes(ID.ownerA, ID.bizTT, res.body.contact.id);
    expect(notesRes.status).toBe(200);
    expect(notesRes.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: res.body.note.id, body: rawMsg, source: 'whatsapp_inbound' }),
      ]),
    );

    const eventsRes = await listEvents(ID.ownerA, ID.bizTT, res.body.contact.id);
    expect(eventsRes.status).toBe(200);
    expect(eventsRes.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: res.body.event.id,
          type: 'communication.whatsapp',
          data: expect.objectContaining({
            channel: 'whatsapp',
            direction: 'inbound',
            source: 'pasted_whatsapp',
            body: rawMsg,
            senderPhone: '+18687124901',
            noteId: res.body.note.id,
          }),
        }),
      ]),
    );

    // No outbound WhatsApp send or KEY invocation event
    expect(emittedEvents.some((e) => e.name.includes('whatsapp.send') || e.name.includes('outbound') || e.name.startsWith('ai.'))).toBe(false);
  });

  it('WAIC-02 RED-BEFORE: normalizes under Business.country (Guyana +592) and matches existing legacy-formatted customer without duplication', async () => {
    const beforeCount = await db.contact.count({ where: { businessId: ID.bizGY, deletedAt: null } });

    const res = await capture(ID.ownerA, ID.bizGY, {
      phone: '+592 600-8811',
      message: 'Confirming Tuesday 10am appointment',
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.created).toBe(false);
    expect(res.body.normalizedPhone).toBe('+5926008811');
    expect(res.body.contact.id).toBe(ID.contactLegacyGY);

    const afterCount = await db.contact.count({ where: { businessId: ID.bizGY, deletedAt: null } });
    expect(afterCount).toBe(beforeCount);
  });

  it('WAIC-03 RED-BEFORE: matches existing customer by formatted whatsappNumber (separator inside last 4 digits) when phone is blank, and supports explicit visible contactId', async () => {
    const beforeCount = await db.contact.count({ where: { businessId: ID.bizTT, deletedAt: null } });

    const res = await capture(ID.ownerA, ID.bizTT, {
      phone: '(868) 712-4902',
      message: 'Is my order ready for pickup?',
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.created).toBe(false);
    expect(res.body.contact.id).toBe(ID.contactWaOnlyTT);

    const explicit = await capture(ID.ownerA, ID.bizTT, {
      phone: '(868) 712-4902',
      message: 'Follow-up message via explicit contactId',
      contactId: ID.contactWaOnlyTT,
    });
    expect(explicit.status, JSON.stringify(explicit.body)).toBe(201);
    expect(explicit.body.created).toBe(false);
    expect(explicit.body.contact.id).toBe(ID.contactWaOnlyTT);

    const afterCount = await db.contact.count({ where: { businessId: ID.bizTT, deletedAt: null } });
    expect(afterCount).toBe(beforeCount);
  });

  it('WAIC-04 RED-BEFORE: refuses unparseable phone, blank message, and over-cap message (>10000 chars) with 400 and zero writes', async () => {
    const beforeNotes = await db.contactNote.count({ where: { businessId: ID.bizTT } });

    const badPhone = await capture(ID.ownerA, ID.bizTT, { phone: 'not-a-number', message: 'Hello' });
    expect(badPhone.status).toBe(400);

    const blankMsg = await capture(ID.ownerA, ID.bizTT, { phone: '712-4955', message: '    \n\t  ' });
    expect(blankMsg.status).toBe(400);

    const tooLong = await capture(ID.ownerA, ID.bizTT, { phone: '712-4955', message: 'a'.repeat(10001) });
    expect(tooLong.status).toBe(400);

    const afterNotes = await db.contactNote.count({ where: { businessId: ID.bizTT } });
    expect(afterNotes).toBe(beforeNotes);
  });

  it('WAIC-05 RED-BEFORE: enforces AuthGuard (401), crm:write scope (403), and tenant isolation (403/404)', async () => {
    const anon = await capture(null, ID.bizTT, { phone: '712-4966', message: 'Hello' });
    expect(anon.status).toBe(401);

    const readOnly = await capture(ID.staffRead, ID.bizTT, { phone: '712-4966', message: 'Hello' });
    expect(readOnly.status).toBe(403);

    const foreignBiz = await capture(ID.ownerB, ID.bizTT, { phone: '712-4966', message: 'Hello' });
    expect(foreignBiz.status).toBe(403);

    // Passing another business's contactId inside bizTT must answer 404 and write nothing to bizB
    const crossContact = await capture(ID.ownerA, ID.bizTT, {
      phone: '712-4999',
      message: 'Should not land on bizB',
      contactId: ID.contactForeignB,
    });
    expect(crossContact.status).toBe(404);
    const foreignNotes = await db.contactNote.count({ where: { contactId: ID.contactForeignB } });
    expect(foreignNotes).toBe(0);
  });

  it('WAIC-06 RED-BEFORE: respects M7 member visibility — refuses invisible formatted whatsappNumber holder without leaking id, refuses invisible contactId with 404, and assigns new contact to owned-book member', async () => {
    // Invisible existing formatted whatsappNumber holder (owned by ownerA, PRIVATE): refused 409 without leaking holder id
    const hiddenHolder = await capture(ID.staffBook, ID.bizTT, {
      phone: '712-4903',
      message: 'Trying to reach private VIP',
    });
    expect(hiddenHolder.status).toBe(409);
    expect(JSON.stringify(hiddenHolder.body)).not.toContain(ID.contactPrivateTT);
    const privNotes = await db.contactNote.count({ where: { contactId: ID.contactPrivateTT } });
    expect(privNotes).toBe(0);

    // Invisible explicit contactId -> 404
    const hiddenById = await capture(ID.staffBook, ID.bizTT, {
      phone: '712-4903',
      message: 'Explicit hidden id',
      contactId: ID.contactPrivateTT,
    });
    expect(hiddenById.status).toBe(404);
    expect(await db.contactNote.count({ where: { contactId: ID.contactPrivateTT } })).toBe(0);

    // Brand-new phone created by staffBook -> owned by staffBook so staffBook can open notes & events
    const ownNew = await capture(ID.staffBook, ID.bizTT, {
      phone: '712-4977',
      message: 'Hi, looking for a booking next week',
      firstName: 'Ravi',
    });
    expect(ownNew.status, JSON.stringify(ownNew.body)).toBe(201);
    expect(ownNew.body.created).toBe(true);

    const stored = await db.contact.findUnique({ where: { id: ownNew.body.contact.id }, select: { ownerId: true } });
    expect(stored?.ownerId).toBe(ID.staffBook);

    const ownNotes = await listNotes(ID.staffBook, ID.bizTT, ownNew.body.contact.id);
    expect(ownNotes.status).toBe(200);
    expect(ownNotes.body).toHaveLength(1);
  });
});
