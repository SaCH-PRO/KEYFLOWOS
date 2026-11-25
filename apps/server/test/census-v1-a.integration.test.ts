/**
 * P87 — V1-66 (SWP-CENSUS-V1-A, P0 launch-track, Journeys B/F/J):
 *
 * Real Postgres + real NestJS HTTP app (`AuthGuard`, `BusinessGuard`,
 * `ModuleScopeGuard`, `GlobalHttpExceptionFilter`) across all 6 controllers of
 * the V1-A REST scope census batch (47 open rows in REST-SCOPE-CENSUS-2026-11-13.md):
 *
 *   1. BookingsController         (24 open rows -> bookings:write)
 *   2. CalendarController         (2 open rows  -> bookings:write)
 *   3. CatalogController          (8 open rows  -> 4 products revenue:write, 4 services bookings:write)
 *   4. DocumentTemplateController (4 open rows  -> revenue:write)
 *   5. CommerceInsightsController (5 open rows  -> revenue:read)
 *   6. LeadFormsController        (4 open rows  -> crm:write)
 *
 * Proves:
 *   - [CV1A-01] RED-BEFORE: STAFF member with `none` on the required module is
 *               refused 403 on all 7 representative routes (all 6 controllers,
 *               including Catalog's product vs service split) with ZERO service calls.
 *   - [CV1A-02] RED-BEFORE: STAFF member with `read` scopes (default STAFF level)
 *               is refused 403 on all 6 write routes with ZERO service calls, while
 *               being admitted (2xx) on `CommerceInsightsController.captureMarginSnapshot`
 *               (`revenue:read`).
 *   - [CV1A-03] Control: OWNER succeeds (2xx) on all 7 representative routes,
 *               reaching each service once.
 *   - [CV1A-04] Control: STAFF member with explicit `write` scopes succeeds (2xx)
 *               on all 7 representative routes.
 *   - [CV1A-05] Tenant isolation & auth: cross-tenant OWNER refused 403 with ZERO
 *               service calls; unauthenticated refused 401.
 *   - [CV1A-06] Exhaustive metadata & guard-order verification across all 47 open
 *               rows: every single handler runs AuthGuard -> BusinessGuard ->
 *               ModuleScopeGuard and declares the exact `@RequireModuleScope(module, level)`.
 *
 * Fixtures use pre-allocated prefix `v66k_` and are hard-deleted with `sqlLikePrefix(P)`.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { INestApplication, Logger } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 90_000 });
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v66k_';
const HEADER = 'x-test-user-id';

const ID = {
  ownerA: `${P}ownerA`,
  staffNone: `${P}staffNone`,
  staffRead: `${P}staffRead`,
  staffWrite: `${P}staffWrite`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let app: INestApplication;
let controllersMap: Record<string, any> = {};
let MODULE_SCOPE_KEY_VAL: string;
const serviceCalls: Array<{ service: string; op: string }> = [];
/* eslint-enable @typescript-eslint/no-explicit-any */

function makeRecorder(service: string) {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return async () => {
          serviceCalls.push({ service, op: prop });
          return { ok: true, id: `${P}stub`, content: '{"title":"Consult"}' };
        };
      },
    },
  );
}

interface Probe {
  label: string;
  method: 'post' | 'patch' | 'delete';
  path: (bizId: string) => string;
  body: Record<string, unknown>;
  module: 'bookings' | 'revenue' | 'crm';
  level: 'read' | 'write';
}

const PROBES: Probe[] = [
  {
    label: 'BookingsController.createService',
    method: 'post',
    path: (b) => `/bookings/businesses/${b}/services`,
    body: { name: 'Haircut', duration: 30, price: 120 },
    module: 'bookings',
    level: 'write',
  },
  {
    label: 'CalendarController.keyInterpretCalendar',
    method: 'post',
    path: (b) => `/calendar/businesses/${b}/key/interpret`,
    body: { intent: 'Book haircut tomorrow at 2pm' },
    module: 'bookings',
    level: 'write',
  },
  {
    label: 'CatalogController.createProduct',
    method: 'post',
    path: (b) => `/catalog/businesses/${b}/products`,
    body: { name: 'Cocoa Tin', price: 95 },
    module: 'revenue',
    level: 'write',
  },
  {
    label: 'CatalogController.createService',
    method: 'post',
    path: (b) => `/catalog/businesses/${b}/services`,
    body: { name: 'Massage', duration: 60, price: 250 },
    module: 'bookings',
    level: 'write',
  },
  {
    label: 'DocumentTemplateController.create',
    method: 'post',
    path: (b) => `/commerce/document-templates/businesses/${b}`,
    body: { type: 'INVOICE', name: 'Classic Invoice' },
    module: 'revenue',
    level: 'write',
  },
  {
    label: 'CommerceInsightsController.captureMarginSnapshot',
    method: 'post',
    path: (b) => `/commerce/businesses/${b}/products/${P}prod/insights/snapshot`,
    body: { reason: 'manual' },
    module: 'revenue',
    level: 'read',
  },
  {
    label: 'LeadFormsController.createForm',
    method: 'post',
    path: (b) => `/businesses/${b}/lead-forms`,
    body: { name: 'Contact Us', fields: [] },
    module: 'crm',
    level: 'write',
  },
];

const EXPECTED_OPEN_SCOPES: Array<{ controller: string; handler: string; module: string; level: 'read' | 'write' }> = [
  // BookingsController (24 -> bookings:write)
  { controller: 'BookingsController', handler: 'addToWaitlist', module: 'bookings', level: 'write' },
  { controller: 'BookingsController', handler: 'batchServices', module: 'bookings', level: 'write' },
  { controller: 'BookingsController', handler: 'cancelWaitlistEntry', module: 'bookings', level: 'write' },
  { controller: 'BookingsController', handler: 'convertWaitlistEntry', module: 'bookings', level: 'write' },
  { controller: 'BookingsController', handler: 'createBooking', module: 'bookings', level: 'write' },
  { controller: 'BookingsController', handler: 'createExternalCalendarEvent', module: 'bookings', level: 'write' },
  { controller: 'BookingsController', handler: 'createInvoiceFromBooking', module: 'bookings', level: 'write' },
  { controller: 'BookingsController', handler: 'createService', module: 'bookings', level: 'write' },
  { controller: 'BookingsController', handler: 'createStaff', module: 'bookings', level: 'write' },
  { controller: 'BookingsController', handler: 'deleteExternalCalendarEvent', module: 'bookings', level: 'write' },
  { controller: 'BookingsController', handler: 'deleteService', module: 'bookings', level: 'write' },
  { controller: 'BookingsController', handler: 'deleteStaff', module: 'bookings', level: 'write' },
  { controller: 'BookingsController', handler: 'offerWaitlistSlot', module: 'bookings', level: 'write' },
  { controller: 'BookingsController', handler: 'rescheduleBooking', module: 'bookings', level: 'write' },
  { controller: 'BookingsController', handler: 'resolveCalendarConflict', module: 'bookings', level: 'write' },
  { controller: 'BookingsController', handler: 'scanCalendarConflicts', module: 'bookings', level: 'write' },
  { controller: 'BookingsController', handler: 'setStaffAvailability', module: 'bookings', level: 'write' },
  { controller: 'BookingsController', handler: 'syncBookingToCalendar', module: 'bookings', level: 'write' },
  { controller: 'BookingsController', handler: 'updateBooking', module: 'bookings', level: 'write' },
  { controller: 'BookingsController', handler: 'updateBookingNotes', module: 'bookings', level: 'write' },
  { controller: 'BookingsController', handler: 'updateBookingStatus', module: 'bookings', level: 'write' },
  { controller: 'BookingsController', handler: 'updateExternalCalendarEvent', module: 'bookings', level: 'write' },
  { controller: 'BookingsController', handler: 'updateReminderSettings', module: 'bookings', level: 'write' },
  { controller: 'BookingsController', handler: 'updateService', module: 'bookings', level: 'write' },
  // CalendarController (2 -> bookings:write)
  { controller: 'CalendarController', handler: 'keyExecuteCalendar', module: 'bookings', level: 'write' },
  { controller: 'CalendarController', handler: 'keyInterpretCalendar', module: 'bookings', level: 'write' },
  // CatalogController (8 -> 4 products revenue:write, 4 services bookings:write)
  { controller: 'CatalogController', handler: 'createProduct', module: 'revenue', level: 'write' },
  { controller: 'CatalogController', handler: 'bulkUpdateProducts', module: 'revenue', level: 'write' },
  { controller: 'CatalogController', handler: 'updateProduct', module: 'revenue', level: 'write' },
  { controller: 'CatalogController', handler: 'deleteProduct', module: 'revenue', level: 'write' },
  { controller: 'CatalogController', handler: 'createService', module: 'bookings', level: 'write' },
  { controller: 'CatalogController', handler: 'updateService', module: 'bookings', level: 'write' },
  { controller: 'CatalogController', handler: 'deleteService', module: 'bookings', level: 'write' },
  { controller: 'CatalogController', handler: 'batchServices', module: 'bookings', level: 'write' },
  // DocumentTemplateController (4 -> revenue:write)
  { controller: 'DocumentTemplateController', handler: 'create', module: 'revenue', level: 'write' },
  { controller: 'DocumentTemplateController', handler: 'update', module: 'revenue', level: 'write' },
  { controller: 'DocumentTemplateController', handler: 'delete', module: 'revenue', level: 'write' },
  { controller: 'DocumentTemplateController', handler: 'setDefault', module: 'revenue', level: 'write' },
  // CommerceInsightsController (5 -> revenue:read)
  { controller: 'CommerceInsightsController', handler: 'captureMarginSnapshot', module: 'revenue', level: 'read' },
  { controller: 'CommerceInsightsController', handler: 'identifyOpportunities', module: 'revenue', level: 'read' },
  { controller: 'CommerceInsightsController', handler: 'recommendFulfillmentStrategy', module: 'revenue', level: 'read' },
  { controller: 'CommerceInsightsController', handler: 'recommendPricing', module: 'revenue', level: 'read' },
  { controller: 'CommerceInsightsController', handler: 'rewriteProductCopy', module: 'revenue', level: 'read' },
  // LeadFormsController (4 -> crm:write)
  { controller: 'LeadFormsController', handler: 'createForm', module: 'crm', level: 'write' },
  { controller: 'LeadFormsController', handler: 'updateForm', module: 'crm', level: 'write' },
  { controller: 'LeadFormsController', handler: 'deleteForm', module: 'crm', level: 'write' },
  { controller: 'LeadFormsController', handler: 'toggleActive', module: 'crm', level: 'write' },
];

async function cleanup() {
  for (const sql of [
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

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard, MODULE_SCOPE_KEY } = await import('../src/core/auth/module-scope.guard');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { HoneypotGuard } = await import('../src/core/guards/honeypot.guard');
  const { FeatureFlagGuard } = await import('../src/modules/crm/guards/feature-flag.guard');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');

  const { BookingsController } = await import('../src/modules/bookings/bookings.controller');
  const { BookingsService } = await import('../src/modules/bookings/bookings.service');
  const { BookingWaitlistService } = await import('../src/modules/bookings/booking-waitlist.service');
  const { CalendarService } = await import('../src/modules/bookings/calendar.service');
  const { BookingOptimizerService } = await import('../src/modules/bookings/booking-optimizer.service');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { CatalogService } = await import('../src/modules/catalog/catalog.service');

  const { CalendarController } = await import('../src/modules/calendar/calendar.controller');
  const { CalendarQueryService } = await import('../src/modules/calendar/calendar-query.service');
  const { CalendarSyncService } = await import('../src/modules/calendar/calendar-sync.service');
  const { CalendarConflictService } = await import('../src/modules/calendar/calendar-conflict.service');
  const { CalendarInsightService } = await import('../src/modules/calendar/calendar-insight.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { GoogleCalendarTemporalSyncService } = await import('../src/modules/calendar/connectors/google-calendar-temporal-sync.service');

  const { CatalogController } = await import('../src/modules/catalog/catalog.controller');

  const { DocumentTemplateController } = await import('../src/modules/commerce/document-template/document-template.controller');
  const { DocumentTemplateService } = await import('../src/modules/commerce/document-template/document-template.service');

  const { CommerceInsightsController } = await import('../src/modules/commerce/commerce-insights.controller');
  const { LandedCostEngine } = await import('../src/modules/commerce/landed-cost-engine.service');
  const { MarginAnalysisService } = await import('../src/modules/commerce/margin-analysis.service');
  const { SourceRiskService } = await import('../src/modules/commerce/source-risk.service');
  const { InventoryRiskService } = await import('../src/modules/commerce/inventory-risk.service');
  const { CommerceIntelligenceService } = await import('../src/modules/commerce/commerce-intelligence.service');
  const { MarginSnapshotSchedulerService } = await import('../src/modules/commerce/margin-snapshot-scheduler.service');

  const { LeadFormsController } = await import('../src/modules/lead-forms/lead-forms.controller');
  const { LeadFormsService } = await import('../src/modules/lead-forms/lead-forms.service');

  MODULE_SCOPE_KEY_VAL = MODULE_SCOPE_KEY;
  controllersMap = {
    BookingsController,
    CalendarController,
    CatalogController,
    DocumentTemplateController,
    CommerceInsightsController,
    LeadFormsController,
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [
      BookingsController,
      CalendarController,
      CatalogController,
      DocumentTemplateController,
      CommerceInsightsController,
      LeadFormsController,
    ],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      { provide: BookingsService, useValue: makeRecorder('BookingsService') },
      { provide: BookingWaitlistService, useValue: makeRecorder('BookingWaitlistService') },
      { provide: CalendarService, useValue: makeRecorder('CalendarService') },
      { provide: BookingOptimizerService, useValue: makeRecorder('BookingOptimizerService') },
      { provide: SubscriptionsService, useValue: makeRecorder('SubscriptionsService') },
      { provide: CatalogService, useValue: makeRecorder('CatalogService') },
      { provide: CalendarQueryService, useValue: makeRecorder('CalendarQueryService') },
      { provide: CalendarSyncService, useValue: makeRecorder('CalendarSyncService') },
      { provide: CalendarConflictService, useValue: makeRecorder('CalendarConflictService') },
      { provide: CalendarInsightService, useValue: makeRecorder('CalendarInsightService') },
      { provide: AiUsageService, useValue: makeRecorder('AiUsageService') },
      { provide: GoogleCalendarTemporalSyncService, useValue: makeRecorder('GoogleCalendarTemporalSyncService') },
      { provide: DocumentTemplateService, useValue: makeRecorder('DocumentTemplateService') },
      { provide: LandedCostEngine, useValue: makeRecorder('LandedCostEngine') },
      { provide: MarginAnalysisService, useValue: makeRecorder('MarginAnalysisService') },
      { provide: SourceRiskService, useValue: makeRecorder('SourceRiskService') },
      { provide: InventoryRiskService, useValue: makeRecorder('InventoryRiskService') },
      { provide: CommerceIntelligenceService, useValue: makeRecorder('CommerceIntelligenceService') },
      { provide: MarginSnapshotSchedulerService, useValue: makeRecorder('MarginSnapshotSchedulerService') },
      { provide: LeadFormsService, useValue: makeRecorder('LeadFormsService') },
    ],
  })
    .overrideGuard(PublicRateLimitGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(HoneypotGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(FeatureFlagGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(PlanLimitGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(CrmRateLimitGuard)
    .useValue({ canActivate: () => true })
    .compile();

  app = moduleRef.createNestApplication({ logger: false });
  Logger.overrideLogger(false);
  app.use(async (req: any, _res: any, next: any) => {
    const id = typeof req.headers[HEADER] === 'string' ? req.headers[HEADER] : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup();

  for (const [id, email] of [
    [ID.ownerA, `${P}owner-a@test.local`],
    [ID.staffNone, `${P}staff-none@test.local`],
    [ID.staffRead, `${P}staff-read@test.local`],
    [ID.staffWrite, `${P}staff-write@test.local`],
    [ID.ownerB, `${P}owner-b@test.local`],
  ] as const) {
    await db.user.create({ data: { id, email, role: 'USER' } });
  }

  await db.business.create({
    data: { id: ID.bizA, name: 'V66K Biz A', slug: `${P}biz-a`, ownerId: ID.ownerA, currency: 'TTD' },
  });
  await db.business.create({
    data: { id: ID.bizB, name: 'V66K Biz B', slug: `${P}biz-b`, ownerId: ID.ownerB, currency: 'TTD' },
  });

  await db.membership.createMany({
    data: [
      { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
      {
        id: `${P}m_staffNone`,
        userId: ID.staffNone,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { bookings: 'none', revenue: 'none', crm: 'none' },
      },
      {
        id: `${P}m_staffRead`,
        userId: ID.staffRead,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { bookings: 'read', revenue: 'read', crm: 'read' },
      },
      {
        id: `${P}m_staffWrite`,
        userId: ID.staffWrite,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { bookings: 'write', revenue: 'write', crm: 'write' },
      },
      { id: `${P}m_ownerB`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
    ],
  });
});

beforeEach(() => {
  serviceCalls.length = 0;
});

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

function sendProbe(probe: Probe, bizId: string, actorId?: string) {
  const req = request(app.getHttpServer())[probe.method](probe.path(bizId));
  if (actorId) req.set(HEADER, actorId);
  return req.send(probe.body);
}

describe('P87 — SWP-CENSUS-V1-A (6 controllers, 47 open rows)', () => {
  it('[CV1A-01] RED-BEFORE: STAFF member with module=none is refused 403 on all 7 representative routes with ZERO service calls', async () => {
    for (const probe of PROBES) {
      serviceCalls.length = 0;
      const res = await sendProbe(probe, ID.bizA, ID.staffNone);
      expect(res.status, `${probe.label} expected 403 for module=none, got ${res.status}`).toBe(403);
      expect(String(res.body?.message ?? '')).toContain(probe.module);
      expect(serviceCalls, `${probe.label} must not invoke service when refused`).toHaveLength(0);
    }
  });

  it('[CV1A-02] RED-BEFORE: STAFF member with read scopes is refused 403 on all 6 write routes with ZERO service calls and admitted on revenue:read insights', async () => {
    for (const probe of PROBES) {
      serviceCalls.length = 0;
      const res = await sendProbe(probe, ID.bizA, ID.staffRead);
      if (probe.level === 'write') {
        expect(res.status, `${probe.label} expected 403 for module=read, got ${res.status}`).toBe(403);
        expect(String(res.body?.message ?? '')).toContain(probe.module);
        expect(serviceCalls, `${probe.label} must not invoke service when refused`).toHaveLength(0);
      } else {
        expect(res.status, `${probe.label} expected 2xx for revenue=read, got ${res.status}`).toBeGreaterThanOrEqual(200);
        expect(res.status).toBeLessThan(300);
        expect(serviceCalls.length, `${probe.label} must invoke service for revenue=read`).toBeGreaterThan(0);
      }
    }
  });

  it('[CV1A-03] Control: OWNER succeeds (2xx) on all 7 representative routes', async () => {
    for (const probe of PROBES) {
      serviceCalls.length = 0;
      const res = await sendProbe(probe, ID.bizA, ID.ownerA);
      expect(res.status, `${probe.label} expected 2xx for OWNER, got ${res.status}`).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(300);
      expect(serviceCalls.length, `${probe.label} must invoke service for OWNER`).toBeGreaterThan(0);
    }
  });

  it('[CV1A-04] Control: STAFF member with explicit write scopes succeeds (2xx) on all 7 representative routes', async () => {
    for (const probe of PROBES) {
      serviceCalls.length = 0;
      const res = await sendProbe(probe, ID.bizA, ID.staffWrite);
      expect(res.status, `${probe.label} expected 2xx for STAFF write, got ${res.status}`).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(300);
      expect(serviceCalls.length, `${probe.label} must invoke service for STAFF write`).toBeGreaterThan(0);
    }
  });

  it('[CV1A-05] Tenant isolation & auth: cross-tenant OWNER refused 403 (0 service calls); unauthenticated refused 401', async () => {
    for (const probe of PROBES) {
      serviceCalls.length = 0;
      const foreign = await sendProbe(probe, ID.bizA, ID.ownerB);
      expect(foreign.status, `${probe.label} cross-tenant expected 403`).toBe(403);
      expect(serviceCalls).toHaveLength(0);

      const anon = await sendProbe(probe, ID.bizA);
      expect(anon.status, `${probe.label} unauthenticated expected 401`).toBe(401);
      expect(serviceCalls).toHaveLength(0);
    }
  });

  it('[CV1A-06] Exhaustive metadata check across all 47 open rows: every handler enforces AuthGuard -> BusinessGuard -> ModuleScopeGuard with exact scope', () => {
    expect(EXPECTED_OPEN_SCOPES).toHaveLength(47);
    const failures: string[] = [];

    for (const entry of EXPECTED_OPEN_SCOPES) {
      const Ctor = controllersMap[entry.controller];
      if (!Ctor) {
        failures.push(`${entry.controller}.${entry.handler}: controller not loaded`);
        continue;
      }
      const fn = Ctor.prototype[entry.handler];
      if (typeof fn !== 'function') {
        failures.push(`${entry.controller}.${entry.handler}: handler method missing`);
        continue;
      }

      const classGuards: Array<{ name?: string }> = Reflect.getMetadata(GUARDS_METADATA, Ctor) ?? [];
      const methodGuards: Array<{ name?: string }> = Reflect.getMetadata(GUARDS_METADATA, fn) ?? [];
      const guardNames = [...classGuards, ...methodGuards].map((g) => (typeof g === 'function' ? g.name : g?.constructor?.name ?? ''));

      const authIdx = guardNames.indexOf('AuthGuard');
      const bizIdx = guardNames.indexOf('BusinessGuard');
      const scopeIdx = guardNames.indexOf('ModuleScopeGuard');

      if (authIdx < 0 || bizIdx < 0 || scopeIdx < 0) {
        failures.push(`${entry.controller}.${entry.handler}: missing guard in [${guardNames.join(', ')}]`);
      } else if (!(authIdx < bizIdx && bizIdx < scopeIdx)) {
        failures.push(`${entry.controller}.${entry.handler}: bad guard order [${guardNames.join(', ')}]`);
      }

      const scope = Reflect.getMetadata(MODULE_SCOPE_KEY_VAL, fn) as { module: string; minLevel: string } | undefined;
      if (!scope || scope.module !== entry.module || scope.minLevel !== entry.level) {
        failures.push(
          `${entry.controller}.${entry.handler}: expected ${entry.module}:${entry.level}, got ${scope ? `${scope.module}:${scope.minLevel}` : 'none'}`,
        );
      }
    }

    expect(failures).toEqual([]);
  });
});
