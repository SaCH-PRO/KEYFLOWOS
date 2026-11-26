/**
 * FU-TIMELINE-CALLERS-SCOPE (P122, V1-86 R1 Review Regressions; REAL database):
 * Proves all R1 security & correctness fixes against real PostgreSQL:
 *
 *   R1-01 (R1-SEC-01 / R1-COR-01): PATCH /temporal-flow/businesses/:businessId/:eventId/resolve
 *         refuses financial key_action_proposal events (BUSINESS_WIDE module) for bookings-only
 *         members with { count: 0 } and zero DB mutation; owner resolves them ({ count: 1 }).
 *   R1-02 (R1-SEC-02): temporal_flow.create_event & temporal_flow.set_reminder refuse missing/blank
 *         ctx.userId (reader === null) AND restricted members ({ ai: 'write', revenue: 'none',
 *         operations: 'none', bookings: 'none', storefront: 'none' }) attempting to emit
 *         invoice.paid / key_inbox.message_received / booking.created / key_cortex events with 0
 *         rows inserted; owner/authorized writer succeeds.
 *   R1-03 (R1-SEC-03): findGenomeSignals(biz, undefined, null) and
 *         findGenomeSignals(biz, undefined, { id: bookingsOnly }) WITHOUT explicit readerFilter
 *         auto-derive readerFilter and fail closed (withholding operations & revenue signals).
 *   R1-04 (R1-SEC-03 / R1-SEC-04 / R1-COR-02): markResolved(biz, eventId, undefined, null) and
 *         markResolved(biz, eventId, undefined, { id: bookingsOnly }) WITHOUT explicit writerFilter
 *         fail closed ({ count: 0 }) on revenue/operations events, refuse HIDDEN events even for
 *         owners when scoped, and close the check-then-write TOCTOU window.
 *   R1-05 (R1-SEC-05 / R1-SEC-06 / R1-SEC-07): getState(biz) without reader omits metadata;
 *         generateFromTemporalFlow(biz, '') and generateFromTemporalFlow(biz, '   ') fail closed;
 *         soft-deleted and banned SUPER_ADMIN users fail isSuperAdmin.
 *
 * Requires DATABASE_URL. Prefix `v86r_` cleaned up via raw SQL + sqlLikePrefix(P).
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 60_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v86r_';

const ID = {
  owner: `${P}owner`,
  bookingsOnly: `${P}bookings`, // STAFF: bookings:write, ai:write, settings:write (NO operations, NO revenue)
  aiWriteOnly: `${P}aiwrite`, // STAFF: ai:write, revenue:none, operations:none, bookings:none, storefront:none
  deletedSuper: `${P}delsuper`, // SUPER_ADMIN with deletedAt set
  bannedSuper: `${P}bansuper`, // SUPER_ADMIN with bannedAt set
  biz: `${P}biz`,
  propFin: `${P}prop_fin`,
};

const USERS = [ID.owner, ID.bookingsOnly, ID.aiWriteOnly, ID.deletedSuper, ID.bannedSuper];

const EV = {
  proposalFin: `${P}ev_prop_fin`,
  inbox: `${P}ev_inbox`,
  invoiceOverdue: `${P}ev_inv_overdue`,
  hiddenManual: `${P}ev_hidden_manual`,
  waLead1: `${P}ev_wa1`,
  waLead2: `${P}ev_wa2`,
  waLead3: `${P}ev_wa3`,
  paid1: `${P}ev_paid1`,
  paid2: `${P}ev_paid2`,
  paid3: `${P}ev_paid3`,
  booking1: `${P}ev_book1`,
  booking2: `${P}ev_book2`,
  booking3: `${P}ev_book3`,
  booking4: `${P}ev_book4`,
  booking5: `${P}ev_book5`,
};

const NOW = Date.now();
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000);

let db: any;
let app: any;
let temporalService: any;
let organAdapter: any;
let genomeEvolution: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM genome_evolution_proposals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM key_action_proposals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM temporal_flow_memories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM temporal_flow_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)}`,
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

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { Logger } = await import('@nestjs/common');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TemporalFlowController } = await import('../src/modules/temporal-flow/temporal-flow.controller');
  const { TemporalFlowService } = await import('../src/modules/temporal-flow/temporal-flow.service');
  const { TemporalFlowMemoryService } = await import('../src/modules/temporal-flow/temporal-flow-memory.service');
  const { TemporalFlowMemoryQueueService } = await import('../src/modules/temporal-flow/temporal-flow-memory.queue.service');
  const { TemporalFlowGenomeBridgeService } = await import('../src/modules/temporal-flow/temporal-flow-genome-bridge.service');
  const { SemanticMemoryService } = await import('../src/modules/ai/semantic-memory.service');
  const { TemporalFlowAdapterService } = await import('../src/modules/key-cortex/organs/temporal-flow-adapter.service');
  const { KeyCortexEventBusService } = await import('../src/modules/key-cortex/key-cortex-event-bus.service');
  const { GenomeEvolutionService } = await import('../src/modules/business-genome/genome-evolution.service');
  const { BlueprintService } = await import('../src/modules/blueprint/blueprint.service');

  Logger.overrideLogger(false);

  const moduleRef = await Test.createTestingModule({
    controllers: [TemporalFlowController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      TemporalFlowService,
      TemporalFlowMemoryService,
      TemporalFlowAdapterService,
      GenomeEvolutionService,
      { provide: SemanticMemoryService, useValue: { search: async () => [], store: async () => undefined } },
      { provide: TemporalFlowMemoryQueueService, useValue: { enqueue: async () => ({ queued: true }) } },
      { provide: TemporalFlowGenomeBridgeService, useValue: {} },
      { provide: KeyCortexEventBusService, useValue: { publish: async () => undefined, subscribe: () => () => undefined } },
      {
        provide: BlueprintService,
        useValue: {
          updateDnaSection: async () => undefined,
          calculateGenomeIntegrity: async () => ({ genomeIntegrity: 80, threePillarMinimumMet: true }),
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
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  temporalService = moduleRef.get(TemporalFlowService);
  organAdapter = moduleRef.get(TemporalFlowAdapterService);
  genomeEvolution = moduleRef.get(GenomeEvolutionService);

  await cleanup();

  for (const id of USERS) {
    await db.user.create({
      data: {
        id,
        email: `${P}${id.slice(P.length)}@example.test`,
        name: id,
        role: id === ID.deletedSuper || id === ID.bannedSuper ? 'SUPER_ADMIN' : 'USER',
        deletedAt: id === ID.deletedSuper ? new Date() : null,
        bannedAt: id === ID.bannedSuper ? new Date() : null,
      },
    });
  }

  await db.business.create({
    data: { id: ID.biz, name: `${P}Biz`, slug: `${P}biz`, ownerId: ID.owner },
  });

  await db.membership.createMany({
    data: [
      { id: `${P}m_owner`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' },
      {
        id: `${P}m_bookings`,
        userId: ID.bookingsOnly,
        businessId: ID.biz,
        role: 'STAFF',
        permissionScopes: { bookings: 'write', ai: 'write', settings: 'write' },
      },
      {
        id: `${P}m_aiwrite`,
        userId: ID.aiWriteOnly,
        businessId: ID.biz,
        role: 'STAFF',
        permissionScopes: { ai: 'write', revenue: 'none', operations: 'none', bookings: 'none', storefront: 'none' },
      },
    ],
  });

  await db.keyActionProposal.create({
    data: {
      id: ID.propFin,
      businessId: ID.biz,
      sourceType: 'KEY_CHAT',
      title: 'Send invoice $4,200',
      actionType: 'SEND_INVOICE',
      payload: { amount: 4200, currency: 'TTD' },
      status: 'PENDING',
    },
  });

  const events = [
    {
      id: EV.proposalFin,
      source: 'KEY',
      type: 'key.action.proposed',
      module: 'key-autonomy',
      entityType: 'key_action_proposal',
      entityId: ID.propFin,
      title: `${P}Financial proposal $4,200`,
      status: 'ACTION_REQUIRED',
      importance: 'CRITICAL',
      visibility: 'USER',
      occurredAt: at(1),
    },
    {
      id: EV.inbox,
      source: 'key_inbox',
      type: 'key_inbox.message_analyzed',
      module: 'key_inbox',
      title: `${P}Inbox secret`,
      status: 'ACTION_REQUIRED',
      importance: 'CRITICAL',
      visibility: 'USER',
      occurredAt: at(2),
    },
    {
      id: EV.invoiceOverdue,
      source: 'APP',
      type: 'invoice.overdue',
      module: null,
      title: `${P}Overdue INV-100`,
      status: 'ACTION_REQUIRED',
      importance: 'CRITICAL',
      visibility: 'USER',
      occurredAt: at(3),
    },
    {
      id: EV.hiddenManual,
      source: 'MANUAL',
      type: 'manual.event',
      module: null,
      title: `${P}Hidden note`,
      status: 'RECORDED',
      importance: 'NORMAL',
      visibility: 'HIDDEN',
      occurredAt: at(4),
    },
    { id: EV.waLead1, source: 'WHATSAPP', type: 'whatsapp.lead.created', module: 'key_inbox', title: `${P}wa1`, occurredAt: at(5) },
    { id: EV.waLead2, source: 'WHATSAPP', type: 'whatsapp.lead.created', module: 'key_inbox', title: `${P}wa2`, occurredAt: at(6) },
    { id: EV.waLead3, source: 'WHATSAPP', type: 'whatsapp.lead.created', module: 'key_inbox', title: `${P}wa3`, occurredAt: at(7) },
    { id: EV.paid1, source: 'APP', type: 'invoice.paid', module: 'revenue', title: `${P}paid1`, occurredAt: at(8) },
    { id: EV.paid2, source: 'APP', type: 'invoice.paid', module: 'revenue', title: `${P}paid2`, occurredAt: at(9) },
    { id: EV.paid3, source: 'APP', type: 'invoice.paid', module: 'revenue', title: `${P}paid3`, occurredAt: at(10) },
    { id: EV.booking1, source: 'APP', type: 'booking.created', module: 'bookings', title: `${P}book1`, occurredAt: at(11) },
    { id: EV.booking2, source: 'APP', type: 'booking.created', module: 'bookings', title: `${P}book2`, occurredAt: at(12) },
    { id: EV.booking3, source: 'APP', type: 'booking.created', module: 'bookings', title: `${P}book3`, occurredAt: at(13) },
    { id: EV.booking4, source: 'APP', type: 'booking.created', module: 'bookings', title: `${P}book4`, occurredAt: at(14) },
    { id: EV.booking5, source: 'APP', type: 'booking.created', module: 'bookings', title: `${P}book5`, occurredAt: at(15) },
  ];

  for (const e of events) {
    await db.temporalFlowEvent.create({
      data: {
        businessId: ID.biz,
        visibility: 'USER',
        status: 'RECORDED',
        importance: 'NORMAL',
        payload: {},
        ...e,
      },
    });
  }
}, 120_000);

afterAll(async () => {
  await cleanup();
  await app?.close();
}, 60_000);

describe('P122 R1 review regressions (FU-TIMELINE-CALLERS-SCOPE)', () => {
  it('R1-01 (R1-SEC-01 / R1-COR-01): PATCH /temporal-flow/businesses/:b/:id/resolve refuses financial proposal event for bookings-only member and allows owner', async () => {
    const restricted = await request(app.getHttpServer())
      .patch(`/temporal-flow/businesses/${ID.biz}/${EV.proposalFin}/resolve`)
      .set('x-test-user', ID.bookingsOnly);
    expect(restricted.status).toBe(200);
    expect(restricted.body).toEqual({ count: 0 });

    const stillOpen = await db.temporalFlowEvent.findUnique({ where: { id: EV.proposalFin } });
    expect(stillOpen.status).toBe('ACTION_REQUIRED');
    expect(stillOpen.completedAt).toBeNull();

    const ownerRes = await request(app.getHttpServer())
      .patch(`/temporal-flow/businesses/${ID.biz}/${EV.proposalFin}/resolve`)
      .set('x-test-user', ID.owner);
    expect(ownerRes.status).toBe(200);
    expect(ownerRes.body).toEqual({ count: 1 });

    const resolved = await db.temporalFlowEvent.findUnique({ where: { id: EV.proposalFin } });
    expect(resolved.status).toBe('RESOLVED');
  });

  it('R1-02 (R1-SEC-02): temporal_flow.create_event & set_reminder refuse missing/blank userId and restricted writers attempting module-owned creates; owner succeeds', async () => {
    const beforeCount = await db.temporalFlowEvent.count({ where: { businessId: ID.biz } });

    // Missing or whitespace userId (even with auditUserId: owner) must be refused with 0 rows inserted
    for (const ctx of [
      { businessId: ID.biz, auditUserId: ID.owner },
      { businessId: ID.biz, userId: '   ', auditUserId: ID.owner },
    ]) {
      const createRes = await organAdapter.executeTool('temporal_flow.create_event', ctx, {
        title: `${P}forged_no_user`,
        type: 'note',
      });
      expect(createRes.success).toBe(false);

      const remRes = await organAdapter.executeTool('temporal_flow.set_reminder', ctx, {
        title: `${P}forged_rem_no_user`,
        reminderAt: new Date(Date.now() + 60_000).toISOString(),
      });
      expect(remRes.success).toBe(false);
    }

    // Restricted member ({ ai: 'write', revenue: 'none', operations: 'none', bookings: 'none', storefront: 'none' })
    for (const forgedType of ['invoice.paid', 'key_inbox.message_received', 'booking.created', 'note']) {
      const res = await organAdapter.executeTool(
        'temporal_flow.create_event',
        { businessId: ID.biz, userId: ID.aiWriteOnly },
        { title: `${P}forged_${forgedType}`, type: forgedType },
      );
      expect(res.success, `forged type ${forgedType}`).toBe(false);
    }
    const forgedRem = await organAdapter.executeTool(
      'temporal_flow.set_reminder',
      { businessId: ID.biz, userId: ID.aiWriteOnly },
      { title: `${P}forged_rem`, reminderAt: new Date(Date.now() + 60_000).toISOString() },
    );
    expect(forgedRem.success).toBe(false);

    const afterRefusalsCount = await db.temporalFlowEvent.count({ where: { businessId: ID.biz } });
    expect(afterRefusalsCount).toBe(beforeCount);

    // Owner succeeds on both create_event and set_reminder
    const ownerCreate = await organAdapter.executeTool(
      'temporal_flow.create_event',
      { businessId: ID.biz, userId: ID.owner },
      { title: `${P}owner_note`, type: 'note' },
    );
    expect(ownerCreate.success).toBe(true);
    expect(ownerCreate.data.eventId).toBeTruthy();

    const ownerRem = await organAdapter.executeTool(
      'temporal_flow.set_reminder',
      { businessId: ID.biz, userId: ID.owner },
      { title: `${P}owner_rem`, reminderAt: new Date(Date.now() + 60_000).toISOString() },
    );
    expect(ownerRem.success).toBe(true);
    expect(ownerRem.data.eventId).toBeTruthy();
  });

  it('R1-03 (R1-SEC-03): findGenomeSignals auto-derives readerFilter when reader is passed without readerFilter', async () => {
    const nullSignals = await temporalService.findGenomeSignals(ID.biz, undefined, null);
    expect(nullSignals).toEqual([]);

    const bookingsSignals = await temporalService.findGenomeSignals(ID.biz, undefined, { id: ID.bookingsOnly });
    expect(bookingsSignals.map((s: any) => s.section)).toEqual(['operations']);

    const ownerSignals = await temporalService.findGenomeSignals(ID.biz, undefined, { id: ID.owner });
    expect(ownerSignals.map((s: any) => s.section).sort()).toEqual(['marketing', 'operations', 'sales']);
  });

  it('R1-04 (R1-SEC-03 / R1-SEC-04 / R1-COR-02): markResolved auto-derives writerFilter, excludes HIDDEN events when scoped, and refuses withheld rows', async () => {
    // Omitting writerFilter while passing reader = null or bookingsOnly must STILL fail closed
    const nullInbox = await temporalService.markResolved(ID.biz, EV.inbox, undefined, null);
    expect(nullInbox).toEqual({ count: 0 });

    const bookingsInbox = await temporalService.markResolved(ID.biz, EV.inbox, undefined, { id: ID.bookingsOnly });
    expect(bookingsInbox).toEqual({ count: 0 });

    const bookingsInvoice = await temporalService.markResolved(ID.biz, EV.invoiceOverdue, undefined, { id: ID.bookingsOnly });
    expect(bookingsInvoice).toEqual({ count: 0 });

    // HIDDEN event is excluded whenever scoped (even for owner!)
    const hiddenOwner = await temporalService.markResolved(ID.biz, EV.hiddenManual, undefined, { id: ID.owner });
    expect(hiddenOwner).toEqual({ count: 0 });
    const hiddenRow = await db.temporalFlowEvent.findUnique({ where: { id: EV.hiddenManual } });
    expect(hiddenRow.status).toBe('RECORDED');

    // Verify withheld rows remain untouched
    for (const id of [EV.inbox, EV.invoiceOverdue]) {
      const row = await db.temporalFlowEvent.findUnique({ where: { id } });
      expect(row.status).toBe('ACTION_REQUIRED');
    }
  });

  it('R1-05 (R1-SEC-05 / R1-SEC-06 / R1-SEC-07): getState omits metadata without reader, blank createdBy fails closed, and soft-deleted/banned SUPER_ADMIN fail isSuperAdmin', async () => {
    // R1-SEC-05: getState(biz) without reader omits metadata
    const sysState = await organAdapter.getState(ID.biz);
    expect(sysState).toEqual({ healthy: true, status: 'Timeline active' });
    expect('metadata' in sysState).toBe(false);

    // R1-SEC-07: empty/whitespace createdBy fails closed (creates 0 proposals)
    const emptyCreated = await genomeEvolution.generateFromTemporalFlow(ID.biz, '');
    expect(emptyCreated).toEqual([]);
    const wsCreated = await genomeEvolution.generateFromTemporalFlow(ID.biz, '   ');
    expect(wsCreated).toEqual([]);

    // R1-SEC-06: soft-deleted and banned SUPER_ADMIN fail isSuperAdmin (do NOT get owner-level visibility)
    for (const badSuperId of [ID.deletedSuper, ID.bannedSuper]) {
      const res = await organAdapter.executeTool(
        'temporal_flow.list_events',
        { businessId: ID.biz, userId: badSuperId },
        { limit: 100 },
      );
      expect(res.success).toBe(true);
      const ids = res.data.events.map((e: any) => e.id);
      expect(ids).not.toContain(EV.inbox);
      expect(ids).not.toContain(EV.invoiceOverdue);
      expect(ids).not.toContain(EV.proposalFin);
    }
  });
});
