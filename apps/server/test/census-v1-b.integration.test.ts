/**
 * P90 — V1-66 (SWP-CENSUS-V1-B, P0 launch-track, Journeys B/F/J, owner ruling A1 on #80):
 *
 * Real Postgres + real NestJS HTTP app (`AuthGuard`, `BusinessGuard`,
 * `ModuleScopeGuard`, `GlobalHttpExceptionFilter`) across all 8 controllers of
 * the V1-B REST scope census batch (46 open rows in REST-SCOPE-CENSUS-2026-11-13.md):
 *
 *   1. ActionsController             (3 open  -> sendReceipt revenue:write; remindContact/bookingFollowup crm:write)
 *   2. ApprovalController            (6 open  -> operations:write)
 *   3. ConnectorController           (5 open  -> settings:admin, per D-181 & owner ruling A1)
 *   4. IdentityController            (3 open  -> settings:write)
 *   5. OnboardingConciergeController (7 open  -> settings:write)
 *   6. PublicPresenceController      (1 open  -> content:write)
 *   7. PresenceController            (7 open  -> content:write)
 *   8. SiteController                (14 open -> 11 storefront:write, 3 content:write)
 *
 * Proves:
 *   - [CV1B-01] RED-BEFORE: STAFF member with `none` scopes is refused 403 on all 11
 *               representative routes across all 8 controllers with ZERO service calls.
 *   - [CV1B-02] RED-BEFORE: STAFF member with `read` scopes is refused 403 on all 11
 *               representative routes with ZERO service calls.
 *   - [CV1B-03] RED-BEFORE: STAFF member with explicit `write` scopes (NOT `admin`)
 *               succeeds (2xx) on all 9 `:write` routes and is refused 403 on both
 *               ConnectorController `settings:admin` routes (D-181) with ZERO service calls.
 *   - [CV1B-04] Control: OWNER and ADMIN (holding `admin` scopes) succeed (2xx) on all
 *               11 representative routes.
 *   - [CV1B-05] Tenant isolation & auth: cross-tenant OWNER refused 403 with ZERO
 *               service calls; unauthenticated refused 401.
 *   - [CV1B-06] Exhaustive metadata & guard-order verification across all 46 open rows:
 *               every single handler runs AuthGuard -> BusinessGuard -> ModuleScopeGuard
 *               and declares the exact `@RequireModuleScope(module, level)`.
 *
 * Fixtures use pre-allocated prefix `v66l_` and are hard-deleted with `sqlLikePrefix(P)`.
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

const P = 'v66l_';
const HEADER = 'x-test-user-id';

const ID = {
  ownerA: `${P}ownerA`,
  adminA: `${P}adminA`,
  staffNone: `${P}staffNone`,
  staffRead: `${P}staffRead`,
  staffWrite: `${P}staffWrite`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  invoiceA: `${P}invoiceA`,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let app: INestApplication;
let redisClientRef: any;
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
          return { ok: true, success: true, id: `${P}stub` };
        };
      },
    },
  );
}

interface Probe {
  label: string;
  method: 'post' | 'patch' | 'put' | 'delete';
  path: (bizId: string) => string;
  body: (bizId: string) => Record<string, unknown>;
  module: 'revenue' | 'crm' | 'operations' | 'settings' | 'content' | 'storefront';
  level: 'write' | 'admin';
  /** ActionsController uses Prisma directly, not a mocked service recorder. */
  directPrisma?: boolean;
}

const PROBES: Probe[] = [
  {
    label: 'ActionsController.sendReceipt',
    method: 'post',
    path: () => '/actions/send-receipt',
    body: (b) => ({ businessId: b, invoiceId: ID.invoiceA }),
    module: 'revenue',
    level: 'write',
    directPrisma: true,
  },
  {
    label: 'ActionsController.remindContact',
    method: 'post',
    path: () => '/actions/remind-contact',
    body: (b) => ({ businessId: b, contactId: ID.contactA }),
    module: 'crm',
    level: 'write',
    directPrisma: true,
  },
  {
    label: 'ApprovalController.create',
    method: 'post',
    path: (b) => `/businesses/${b}/approvals`,
    body: () => ({ requestType: 'EXPENSE', title: 'Approve equipment' }),
    module: 'operations',
    level: 'write',
  },
  {
    label: 'ConnectorController.test',
    method: 'post',
    path: (b) => `/connectors/businesses/${b}/test/typeform`,
    body: () => ({}),
    module: 'settings',
    level: 'admin',
  },
  {
    label: 'ConnectorController.updateInboxConfig',
    method: 'patch',
    path: (b) => `/connectors/businesses/${b}/inbox-config/typeform`,
    body: () => ({ intakeEnabled: true }),
    module: 'settings',
    level: 'admin',
    directPrisma: true,
  },
  {
    label: 'IdentityController.upsertGuidanceSubProfile',
    method: 'patch',
    path: (b) => `/identity/businesses/${b}/guidance/founder`,
    body: () => ({ data: { bio: 'Founder' } }),
    module: 'settings',
    level: 'write',
  },
  {
    label: 'OnboardingConciergeController.saveOnboardingStep',
    method: 'post',
    path: (b) => `/onboarding-concierge/businesses/${b}/onboarding-step`,
    body: () => ({ step: 'configure' }),
    module: 'settings',
    level: 'write',
  },
  {
    label: 'PublicPresenceController.runAggregator',
    method: 'post',
    path: (b) => `/businesses/${b}/presence/aggregate`,
    body: () => ({}),
    module: 'content',
    level: 'write',
  },
  {
    label: 'PresenceController.saveDraft',
    method: 'put',
    path: (b) => `/site/presence/businesses/${b}/draft`,
    body: () => ({ payload: { headline: 'Fresh Look' } }),
    module: 'content',
    level: 'write',
  },
  {
    label: 'SiteController.createPromoCode',
    method: 'post',
    path: (b) => `/site/businesses/${b}/promo-codes`,
    body: () => ({ code: 'SAVE10', type: 'PERCENT', value: 10 }),
    module: 'storefront',
    level: 'write',
  },
  {
    label: 'SiteController.generateCaseStudy',
    method: 'post',
    path: (b) => `/site/businesses/${b}/case-studies/generate`,
    body: () => ({ title: 'Client Win' }),
    module: 'content',
    level: 'write',
  },
];

const EXPECTED_OPEN_SCOPES: Array<{
  controller: string;
  handler: string;
  module: string;
  level: 'write' | 'admin';
}> = [
  // ActionsController (3)
  { controller: 'ActionsController', handler: 'bookingFollowup', module: 'crm', level: 'write' },
  { controller: 'ActionsController', handler: 'remindContact', module: 'crm', level: 'write' },
  { controller: 'ActionsController', handler: 'sendReceipt', module: 'revenue', level: 'write' },

  // ApprovalController (6 -> operations:write)
  { controller: 'ApprovalController', handler: 'approve', module: 'operations', level: 'write' },
  { controller: 'ApprovalController', handler: 'cancel', module: 'operations', level: 'write' },
  { controller: 'ApprovalController', handler: 'create', module: 'operations', level: 'write' },
  { controller: 'ApprovalController', handler: 'delegate', module: 'operations', level: 'write' },
  { controller: 'ApprovalController', handler: 'escalate', module: 'operations', level: 'write' },
  { controller: 'ApprovalController', handler: 'reject', module: 'operations', level: 'write' },

  // ConnectorController (5 -> settings:admin, D-181)
  { controller: 'ConnectorController', handler: 'runHealthCheck', module: 'settings', level: 'admin' },
  { controller: 'ConnectorController', handler: 'smoke', module: 'settings', level: 'admin' },
  { controller: 'ConnectorController', handler: 'sync', module: 'settings', level: 'admin' },
  { controller: 'ConnectorController', handler: 'test', module: 'settings', level: 'admin' },
  { controller: 'ConnectorController', handler: 'updateInboxConfig', module: 'settings', level: 'admin' },

  // IdentityController (3 -> settings:write)
  { controller: 'IdentityController', handler: 'generateField', module: 'settings', level: 'write' },
  { controller: 'IdentityController', handler: 'generateProfile', module: 'settings', level: 'write' },
  { controller: 'IdentityController', handler: 'upsertGuidanceSubProfile', module: 'settings', level: 'write' },

  // OnboardingConciergeController (7 -> settings:write)
  { controller: 'OnboardingConciergeController', handler: 'chat', module: 'settings', level: 'write' },
  { controller: 'OnboardingConciergeController', handler: 'detectBusinessType', module: 'settings', level: 'write' },
  { controller: 'OnboardingConciergeController', handler: 'dismiss', module: 'settings', level: 'write' },
  { controller: 'OnboardingConciergeController', handler: 'markComplete', module: 'settings', level: 'write' },
  { controller: 'OnboardingConciergeController', handler: 'resume', module: 'settings', level: 'write' },
  { controller: 'OnboardingConciergeController', handler: 'saveOnboardingStep', module: 'settings', level: 'write' },
  { controller: 'OnboardingConciergeController', handler: 'snoozeNudge', module: 'settings', level: 'write' },

  // PublicPresenceController (1 -> content:write)
  { controller: 'PublicPresenceController', handler: 'runAggregator', module: 'content', level: 'write' },

  // PresenceController (7 -> content:write)
  { controller: 'PresenceController', handler: 'createPreview', module: 'content', level: 'write' },
  { controller: 'PresenceController', handler: 'delegateInsight', module: 'content', level: 'write' },
  { controller: 'PresenceController', handler: 'publish', module: 'content', level: 'write' },
  { controller: 'PresenceController', handler: 'regenerateInsights', module: 'content', level: 'write' },
  { controller: 'PresenceController', handler: 'saveDraft', module: 'content', level: 'write' },
  { controller: 'PresenceController', handler: 'syncActionCards', module: 'content', level: 'write' },
  { controller: 'PresenceController', handler: 'unpublish', module: 'content', level: 'write' },

  // SiteController (14 -> 11 storefront:write, 3 content:write)
  { controller: 'SiteController', handler: 'aggregateConversionFunnel', module: 'storefront', level: 'write' },
  { controller: 'SiteController', handler: 'createPromoCode', module: 'storefront', level: 'write' },
  { controller: 'SiteController', handler: 'deletePromoCode', module: 'storefront', level: 'write' },
  { controller: 'SiteController', handler: 'detectAbandonedCarts', module: 'storefront', level: 'write' },
  { controller: 'SiteController', handler: 'generateCaseStudy', module: 'content', level: 'write' },
  { controller: 'SiteController', handler: 'getAiConversionAdvice', module: 'storefront', level: 'write' },
  { controller: 'SiteController', handler: 'moderateReview', module: 'storefront', level: 'write' },
  { controller: 'SiteController', handler: 'publishCaseStudy', module: 'content', level: 'write' },
  { controller: 'SiteController', handler: 'unpublishCaseStudy', module: 'content', level: 'write' },
  { controller: 'SiteController', handler: 'updateIntakeStatus', module: 'storefront', level: 'write' },
  { controller: 'SiteController', handler: 'updateOrderStatus', module: 'storefront', level: 'write' },
  { controller: 'SiteController', handler: 'updatePromoCode', module: 'storefront', level: 'write' },
  { controller: 'SiteController', handler: 'updateQualificationConfig', module: 'storefront', level: 'write' },
  { controller: 'SiteController', handler: 'updateStorefrontConfig', module: 'storefront', level: 'write' },
];

async function cleanup() {
  if (!db) return;
  await db.connectorStatus.deleteMany({ where: { businessId: { startsWith: P } } }).catch(() => {});
  for (const sql of [
    `DELETE FROM invoices WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE user_id LIKE ${sqlLikePrefix(P)} OR business_id LIKE ${sqlLikePrefix(P)}`,
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

async function callProbe(probe: Probe, userId: string | null, bizId = ID.bizA) {
  const agent = request(app.getHttpServer());
  const req =
    probe.method === 'post'
      ? agent.post(probe.path(bizId))
      : probe.method === 'patch'
        ? agent.patch(probe.path(bizId))
        : probe.method === 'put'
          ? agent.put(probe.path(bizId))
          : agent.delete(probe.path(bizId));
  if (userId) req.set(HEADER, userId);
  return req.send(probe.body(bizId));
}

beforeAll(async () => {
  Logger.overrideLogger(false);
  const { db: prismaDb } = await import('@keyflow/db');
  db = prismaDb;

  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard, MODULE_SCOPE_KEY } = await import('../src/core/auth/module-scope.guard');
  const { RateLimitGuard } = await import('../src/core/guards/rate-limit.guard');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');

  const { ActionsController } = await import('../src/modules/actions/actions.controller');
  const { ApprovalController } = await import('../src/modules/approvals/approval.controller');
  const { ApprovalRequestService } = await import('../src/modules/approvals/approval-request.service');
  const { ConnectorController } = await import('../src/core/connectors/connector.controller');
  const { ConnectorRegistryService } = await import('../src/core/connectors/connector-registry.service');
  const { ConnectorActivityService } = await import('../src/core/connectors/connector-activity.service');
  const { ConnectorHealthMonitorService } = await import('../src/core/connectors/connector-health-monitor.service');
  const { ConnectorCredentialsService } = await import('../src/core/connectors/connector-credentials.service');
  const { IdentityController } = await import('../src/modules/identity/identity.controller');
  const { IdentityService } = await import('../src/modules/identity/identity.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { BusinessContextService } = await import('../src/modules/identity/business-context.service');
  const { IdentitySignupService } = await import('../src/modules/identity/identity-signup.service');
  const { AuthSecurityService } = await import('../src/modules/identity/auth-security.service');
  const { IdentityPasswordService } = await import('../src/modules/identity/identity-password.service');
  const { SupabaseAdminService } = await import('../src/core/auth/supabase-admin.service');
  const { OnboardingConciergeController } = await import('../src/modules/onboarding-concierge/onboarding-concierge.controller');
  const { OnboardingConciergeService } = await import('../src/modules/onboarding-concierge/onboarding-concierge.service');
  const { OnboardingStateService } = await import('../src/modules/onboarding-concierge/onboarding-state.service');
  const { DemoDataSeederService } = await import('../src/modules/onboarding-concierge/demo-data-seeder.service');
  const { PublicPresenceController } = await import('../src/modules/public-events/presence.controller');
  const { PublicEventsIngestService } = await import('../src/modules/public-events/public-events.ingest.service');
  const { PresenceStatsService } = await import('../src/modules/public-events/presence-stats.service');
  const { PresenceController } = await import('../src/modules/site/presence/presence.controller');
  const { PresenceService } = await import('../src/modules/site/presence/presence.service');
  const { PresenceOverviewService } = await import('../src/modules/site/presence/presence-overview.service');
  const { StorefrontIntelligenceService } = await import('../src/modules/site/presence/storefront-intelligence.service');
  const { SiteController } = await import('../src/modules/site/site.controller');
  const { SiteService } = await import('../src/modules/site/site.service');
  const { StoreOrderService } = await import('../src/modules/site/store-order.service');
  const { PromoCodeService } = await import('../src/modules/site/promo-code.service');
  const { IntakeService } = await import('../src/modules/site/intake.service');
  const { QualificationService } = await import('../src/modules/site/qualification.service');
  const { CustomerReferralService } = await import('../src/modules/site/customer-referral.service');
  const { CaseStudyService } = await import('../src/modules/site/case-study.service');
  const { PaymentsService } = await import('../src/modules/payments/payments.service');
  const { StorefrontConversionService } = await import('../src/modules/site/storefront-conversion.service');

  MODULE_SCOPE_KEY_VAL = MODULE_SCOPE_KEY;
  controllersMap = {
    ActionsController,
    ApprovalController,
    ConnectorController,
    IdentityController,
    OnboardingConciergeController,
    PublicPresenceController,
    PresenceController,
    SiteController,
  };

  await cleanup();

  await db.user.createMany({
    data: [
      { id: ID.ownerA, email: `${P}ownerA@test.local`, name: 'Owner A', role: 'USER' },
      { id: ID.adminA, email: `${P}adminA@test.local`, name: 'Admin A', role: 'USER' },
      { id: ID.staffNone, email: `${P}staffNone@test.local`, name: 'Staff None', role: 'USER' },
      { id: ID.staffRead, email: `${P}staffRead@test.local`, name: 'Staff Read', role: 'USER' },
      { id: ID.staffWrite, email: `${P}staffWrite@test.local`, name: 'Staff Write', role: 'USER' },
      { id: ID.ownerB, email: `${P}ownerB@test.local`, name: 'Owner B', role: 'USER' },
    ],
  });

  await db.business.createMany({
    data: [
      { id: ID.bizA, name: 'Biz A', slug: `${P}biza`, ownerId: ID.ownerA, currency: 'TTD' },
      { id: ID.bizB, name: 'Biz B', slug: `${P}bizb`, ownerId: ID.ownerB, currency: 'TTD' },
    ],
  });

  await db.membership.createMany({
    data: [
      { userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
      { userId: ID.adminA, businessId: ID.bizA, role: 'ADMIN' },
      {
        userId: ID.staffNone,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: {
          revenue: 'none',
          crm: 'none',
          operations: 'none',
          settings: 'none',
          content: 'none',
          storefront: 'none',
        },
      },
      {
        userId: ID.staffRead,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: {
          revenue: 'read',
          crm: 'read',
          operations: 'read',
          settings: 'read',
          content: 'read',
          storefront: 'read',
        },
      },
      {
        userId: ID.staffWrite,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: {
          revenue: 'write',
          crm: 'write',
          operations: 'write',
          settings: 'write',
          content: 'write',
          storefront: 'write',
        },
      },
      { userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
    ],
  });

  await db.contact.create({
    data: {
      id: ID.contactA,
      businessId: ID.bizA,
      firstName: 'Kesia',
      lastName: 'Charles',
      email: `${P}kesia@test.local`,
    },
  });

  await db.invoice.create({
    data: {
      id: ID.invoiceA,
      businessId: ID.bizA,
      contactId: ID.contactA,
      invoiceNumber: `${P}INV-001`,
      status: 'SENT',
      subtotal: 100,
      total: 100,
      currency: 'TTD',
    },
  });

  const IORedis = (await import('ioredis')).default;
  const redisClient = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
  });
  redisClientRef = redisClient;

  const moduleRef = await Test.createTestingModule({
    controllers: [
      ActionsController,
      ApprovalController,
      ConnectorController,
      IdentityController,
      OnboardingConciergeController,
      PublicPresenceController,
      PresenceController,
      SiteController,
    ],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      RateLimitGuard,
      PublicRateLimitGuard,
      { provide: REDIS_CLIENT, useValue: redisClient },
      { provide: ApprovalRequestService, useValue: makeRecorder('ApprovalRequestService') },
      { provide: ConnectorRegistryService, useValue: makeRecorder('ConnectorRegistryService') },
      { provide: ConnectorActivityService, useValue: makeRecorder('ConnectorActivityService') },
      { provide: ConnectorHealthMonitorService, useValue: makeRecorder('ConnectorHealthMonitorService') },
      { provide: ConnectorCredentialsService, useValue: makeRecorder('ConnectorCredentialsService') },
      { provide: IdentityService, useValue: makeRecorder('IdentityService') },
      { provide: AiUsageService, useValue: makeRecorder('AiUsageService') },
      { provide: BusinessContextService, useValue: makeRecorder('BusinessContextService') },
      { provide: IdentitySignupService, useValue: makeRecorder('IdentitySignupService') },
      { provide: AuthSecurityService, useValue: makeRecorder('AuthSecurityService') },
      { provide: IdentityPasswordService, useValue: makeRecorder('IdentityPasswordService') },
      { provide: SupabaseAdminService, useValue: makeRecorder('SupabaseAdminService') },
      { provide: OnboardingConciergeService, useValue: makeRecorder('OnboardingConciergeService') },
      { provide: OnboardingStateService, useValue: makeRecorder('OnboardingStateService') },
      { provide: DemoDataSeederService, useValue: makeRecorder('DemoDataSeederService') },
      { provide: PublicEventsIngestService, useValue: makeRecorder('PublicEventsIngestService') },
      { provide: PresenceStatsService, useValue: makeRecorder('PresenceStatsService') },
      { provide: PresenceService, useValue: makeRecorder('PresenceService') },
      { provide: PresenceOverviewService, useValue: makeRecorder('PresenceOverviewService') },
      { provide: StorefrontIntelligenceService, useValue: makeRecorder('StorefrontIntelligenceService') },
      { provide: SiteService, useValue: makeRecorder('SiteService') },
      { provide: StoreOrderService, useValue: makeRecorder('StoreOrderService') },
      { provide: PromoCodeService, useValue: makeRecorder('PromoCodeService') },
      { provide: IntakeService, useValue: makeRecorder('IntakeService') },
      { provide: QualificationService, useValue: makeRecorder('QualificationService') },
      { provide: CustomerReferralService, useValue: makeRecorder('CustomerReferralService') },
      { provide: CaseStudyService, useValue: makeRecorder('CaseStudyService') },
      { provide: PaymentsService, useValue: makeRecorder('PaymentsService') },
      { provide: StorefrontConversionService, useValue: makeRecorder('StorefrontConversionService') },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.use((req: any, _res: any, next: any) => {
    const uid = req.headers[HEADER];
    if (typeof uid === 'string' && uid.startsWith(P)) {
      req.user = { id: uid, email: `${P}req_${uid}@test.local`, role: 'USER' };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();
});

beforeEach(() => {
  serviceCalls.length = 0;
});

afterAll(async () => {
  if (app) await app.close();
  if (redisClientRef) await redisClientRef.quit().catch(() => {});
  await cleanup();
});

describe('P90 — SWP-CENSUS-V1-B (8 controllers / 46 open rows)', () => {
  it('[CV1B-01] RED-BEFORE: STAFF with `none` scopes is refused 403 on all 11 probes across all 8 controllers with ZERO service calls', async () => {
    for (const probe of PROBES) {
      serviceCalls.length = 0;
      const res = await callProbe(probe, ID.staffNone);
      expect(res.status, `${probe.label} (staffNone): ${JSON.stringify(res.body)}`).toBe(403);
      expect(JSON.stringify(res.body), `${probe.label} refusal names ${probe.module}`).toMatch(
        new RegExp(probe.module, 'i'),
      );
      expect(serviceCalls, `${probe.label} must not invoke service on 403`).toHaveLength(0);
    }
  });

  it('[CV1B-02] RED-BEFORE: STAFF with `read` scopes is refused 403 on all 11 write/admin probes with ZERO service calls', async () => {
    for (const probe of PROBES) {
      serviceCalls.length = 0;
      const res = await callProbe(probe, ID.staffRead);
      expect(res.status, `${probe.label} (staffRead): ${JSON.stringify(res.body)}`).toBe(403);
      expect(serviceCalls, `${probe.label} must not invoke service on 403`).toHaveLength(0);
    }
  });

  it('[CV1B-03] RED-BEFORE: STAFF with `write` scopes succeeds (2xx) on all 9 :write probes and is refused 403 on both ConnectorController settings:admin probes (D-181)', async () => {
    for (const probe of PROBES) {
      serviceCalls.length = 0;
      const res = await callProbe(probe, ID.staffWrite);
      if (probe.level === 'admin') {
        expect(res.status, `${probe.label} (staffWrite must be refused admin): ${JSON.stringify(res.body)}`).toBe(403);
        expect(JSON.stringify(res.body), `${probe.label} refusal names admin`).toMatch(/admin/i);
        expect(serviceCalls, `${probe.label} must not invoke service on 403`).toHaveLength(0);
      } else {
        expect(res.status, `${probe.label} (staffWrite): ${JSON.stringify(res.body)}`).toBeGreaterThanOrEqual(200);
        expect(res.status, `${probe.label} (staffWrite)`).toBeLessThan(300);
        if (!probe.directPrisma) {
          expect(serviceCalls.length, `${probe.label} should invoke service`).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it('[CV1B-04] Control: OWNER and ADMIN (settings:admin) succeed (2xx) on all 11 probes', async () => {
    for (const actorId of [ID.ownerA, ID.adminA]) {
      for (const probe of PROBES) {
        serviceCalls.length = 0;
        const res = await callProbe(probe, actorId);
        expect(res.status, `${probe.label} (${actorId}): ${JSON.stringify(res.body)}`).toBeGreaterThanOrEqual(200);
        expect(res.status, `${probe.label} (${actorId})`).toBeLessThan(300);
        if (!probe.directPrisma) {
          expect(serviceCalls.length, `${probe.label} (${actorId}) should invoke service`).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it('[CV1B-05] Tenant isolation & auth: cross-tenant OWNER refused 403 with ZERO service calls; unauthenticated refused 401', async () => {
    for (const probe of PROBES) {
      serviceCalls.length = 0;
      const cross = await callProbe(probe, ID.ownerB, ID.bizA);
      expect(cross.status, `${probe.label} (ownerB -> bizA): ${JSON.stringify(cross.body)}`).toBe(403);
      expect(serviceCalls, `${probe.label} cross-tenant must not invoke service`).toHaveLength(0);

      const unauth = await callProbe(probe, null, ID.bizA);
      expect(unauth.status, `${probe.label} (unauth)`).toBe(401);
    }
  });

  it('[CV1B-06] Exhaustive metadata & guard-order verification across all 46 open V1-B rows', () => {
    expect(EXPECTED_OPEN_SCOPES).toHaveLength(46);

    for (const row of EXPECTED_OPEN_SCOPES) {
      const ControllerCls = controllersMap[row.controller];
      expect(ControllerCls, `controller class ${row.controller}`).toBeDefined();
      const handlerFn = ControllerCls.prototype[row.handler];
      expect(typeof handlerFn, `${row.controller}.${row.handler}`).toBe('function');

      const classGuards: Array<{ name?: string }> = Reflect.getMetadata(GUARDS_METADATA, ControllerCls) ?? [];
      const methodGuards: Array<{ name?: string }> = Reflect.getMetadata(GUARDS_METADATA, handlerFn) ?? [];
      const guardNames = [...classGuards, ...methodGuards].map((g) => g?.name ?? String(g));

      const authIdx = guardNames.indexOf('AuthGuard');
      const bizIdx = guardNames.indexOf('BusinessGuard');
      const scopeIdx = guardNames.indexOf('ModuleScopeGuard');
      expect(authIdx, `${row.controller}.${row.handler} missing AuthGuard`).toBeGreaterThanOrEqual(0);
      expect(bizIdx, `${row.controller}.${row.handler} missing BusinessGuard`).toBeGreaterThan(authIdx);
      expect(scopeIdx, `${row.controller}.${row.handler} missing ModuleScopeGuard`).toBeGreaterThan(bizIdx);

      const scope =
        Reflect.getMetadata(MODULE_SCOPE_KEY_VAL, handlerFn) ??
        Reflect.getMetadata(MODULE_SCOPE_KEY_VAL, ControllerCls);
      expect(scope, `${row.controller}.${row.handler} @RequireModuleScope`).toEqual({
        module: row.module,
        minLevel: row.level,
      });
    }
  });
});
