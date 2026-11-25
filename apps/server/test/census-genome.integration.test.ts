/**
 * P84 — V1-64 (SWP-CENSUS-GENOME, P1 launch-track, Journey J, unblocks SWP-CENSUS-V1-A P0):
 *
 * Real Postgres + real NestJS HTTP app (`AuthGuard`, `BusinessGuard`,
 * `ModuleScopeGuard`, `GlobalHttpExceptionFilter`) across all 9 controllers of
 * the Genome / Genesis / Blueprint / KeyflowCommand / Momentum /
 * GrowthIntelligence batch (64 open write rows in REST-SCOPE-CENSUS-2026-11-13.md):
 *
 *   1. BlueprintController             (4 open rows -> settings:write)
 *   2. BusinessGenesisController       (5 open rows -> settings:write)
 *   3. GenomeChatController            (2 open rows -> settings:write)
 *   4. ConstitutionVersionController   (2 open rows -> settings:write)
 *   5. GenomeEvolutionController       (5 open rows -> settings:write)
 *   6. KeyGenomeController             (35 open rows -> settings:write)
 *   7. GrowthIntelligenceController    (4 open rows -> analytics:write)
 *   8. KeyflowCommandController        (6 open rows -> ai:write)
 *   9. MomentumController              (1 open row  -> crm:write)
 *
 * Proves:
 *   - [CG-01] RED-BEFORE: STAFF member with `none` on the required module is
 *             refused 403 (`Insufficient permissions: <module> requires write
 *             access (you have none)`) on one representative open write route
 *             per controller, with ZERO service calls.
 *   - [CG-02] RED-BEFORE: STAFF member with `read` on the required module is
 *             refused 403 (`... (you have read)`) on all 9 controllers, with
 *             ZERO service calls.
 *   - [CG-03] Control: OWNER succeeds (2xx) on all 9 controllers, reaching
 *             each service once.
 *   - [CG-04] Control: STAFF member with explicit `write` on each required
 *             module succeeds (2xx) on all 9 controllers.
 *   - [CG-05] Tenant isolation & auth: cross-tenant OWNER refused 403 with ZERO
 *             service calls; unauthenticated refused 401.
 *   - [CG-06] Exhaustive metadata check across all 64 open rows: every single
 *             handler runs AuthGuard -> BusinessGuard -> ModuleScopeGuard and
 *             declares the exact `@RequireModuleScope(<module>, 'write')`.
 *
 * Fixtures use pre-allocated prefix `v64m_` and are hard-deleted with `sqlLikePrefix(P)`.
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

const P = 'v64m_';
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
          return { ok: true, service, op: prop };
        };
      },
    },
  );
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort cleanup */
    }
  }
}

interface RepresentativeDoor {
  controller: string;
  handler: string;
  module: 'settings' | 'analytics' | 'ai' | 'crm';
  method: 'post' | 'patch';
  url: (bizId: string) => string;
  body: Record<string, unknown>;
}

const DOORS: RepresentativeDoor[] = [
  {
    controller: 'BlueprintController',
    handler: 'update',
    module: 'settings',
    method: 'patch',
    url: (b) => `/blueprint/businesses/${b}`,
    body: { identity: { businessName: 'Test Studio' } },
  },
  {
    controller: 'BusinessGenesisController',
    handler: 'analyzeIdea',
    module: 'settings',
    method: 'post',
    url: (b) => `/business-genesis/businesses/${b}/analyze-idea`,
    body: { idea: 'Artisanal cocoa cafe in Port of Spain' },
  },
  {
    controller: 'GenomeChatController',
    handler: 'applyUpdates',
    module: 'settings',
    method: 'post',
    url: (b) => `/genome-chat/businesses/${b}/apply-updates`,
    body: { updates: [] },
  },
  {
    controller: 'ConstitutionVersionController',
    handler: 'generate',
    module: 'settings',
    method: 'post',
    url: (b) => `/business-genome/businesses/${b}/constitution/generate`,
    body: { reason: 'Initial setup' },
  },
  {
    controller: 'GenomeEvolutionController',
    handler: 'create',
    module: 'settings',
    method: 'post',
    url: (b) => `/business-genome/businesses/${b}/evolution-proposals`,
    body: { section: 'OPERATIONS', title: 'Update hours', rationale: 'Seasonal shift' },
  },
  {
    controller: 'KeyGenomeController',
    handler: 'createExperiment',
    module: 'settings',
    method: 'post',
    url: (b) => `/business-genome/businesses/${b}/key-genome/experiments`,
    body: { title: 'Weekend pickup test', domain: 'OPERATIONS' },
  },
  {
    controller: 'GrowthIntelligenceController',
    handler: 'regenerate',
    module: 'analytics',
    method: 'post',
    url: (b) => `/growth-intelligence/businesses/${b}/insights/regenerate`,
    body: {},
  },
  {
    controller: 'KeyflowCommandController',
    handler: 'createNote',
    module: 'ai',
    method: 'post',
    url: (b) => `/keyflow/businesses/${b}/notes`,
    body: { title: 'Standup note', content: 'Check stock levels' },
  },
  {
    controller: 'MomentumController',
    handler: 'runDailySweep',
    module: 'crm',
    method: 'post',
    url: (b) => `/momentum/businesses/${b}/sweep`,
    body: {},
  },
];

const EXPECTED_OPEN_SCOPES: Record<string, { module: string; handlers: string[] }> = {
  BlueprintController: {
    module: 'settings',
    handlers: ['inferFromEvents', 'inferFromOnboarding', 'update', 'updateDnaSection'],
  },
  BusinessGenesisController: {
    module: 'settings',
    handlers: [
      'analyzeIdea',
      'generateDocumentPack',
      'generateMarketStrategy',
      'generateRiskRegister',
      'generateRoadmap',
    ],
  },
  GenomeChatController: {
    module: 'settings',
    handlers: ['applyUpdates', 'sendMessage'],
  },
  ConstitutionVersionController: {
    module: 'settings',
    handlers: ['archive', 'generate'],
  },
  GenomeEvolutionController: {
    module: 'settings',
    handlers: ['approve', 'create', 'edit', 'generateFromTemporalFlow', 'reject'],
  },
  KeyGenomeController: {
    module: 'settings',
    handlers: [
      'accept',
      'acceptRecommendation',
      'applyRecommendation',
      'cancelExperiment',
      'completeExperiment',
      'computeDepartment',
      'computeDepartments',
      'computeMarketingGrowthSnapshot',
      'computeOperationsSnapshot',
      'createContentStrategy',
      'createExperiment',
      'createGrowthChannel',
      'deleteContentStrategy',
      'deleteDeliveryCapability',
      'deleteGrowthChannel',
      'deleteOperationalProcess',
      'dismissRecommendation',
      'escalateRecommendation',
      'generateMarketingGrowthRecommendations',
      'generateMarketingGrowthSignals',
      'generateOperationsRecommendations',
      'generateOperationsSignals',
      'generateRecommendations',
      'ignoreRecommendation',
      'merge',
      'reject',
      'review',
      'seedDepartments',
      'setOutcomeLearningWindow',
      'startExperiment',
      'trackRecommendationOutcome',
      'updateContentStrategy',
      'updateGrowthChannel',
      'upsertDeliveryCapability',
      'upsertOperationalProcess',
    ],
  },
  GrowthIntelligenceController: {
    module: 'analytics',
    handlers: ['backfill', 'recomputeAttribution', 'regenerate', 'updateInsight'],
  },
  KeyflowCommandController: {
    module: 'ai',
    handlers: ['createNote', 'deleteNote', 'generateBrief', 'transcribe', 'tts', 'updateNote'],
  },
  MomentumController: {
    module: 'crm',
    handlers: ['runDailySweep'],
  },
};

function callDoor(door: RepresentativeDoor, bizId: string, actorId?: string) {
  const agent = request(app.getHttpServer());
  const req = door.method === 'patch' ? agent.patch(door.url(bizId)) : agent.post(door.url(bizId));
  if (actorId) req.set(HEADER, actorId);
  return req.send(door.body);
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard, MODULE_SCOPE_KEY } = await import('../src/core/auth/module-scope.guard');
  const { GenomeGateGuard } = await import('../src/core/auth/genome-gate.guard');
  const { RateLimitGuard } = await import('../src/core/guards/rate-limit.guard');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');

  const { BlueprintController } = await import('../src/modules/blueprint/blueprint.controller');
  const { BlueprintService } = await import('../src/modules/blueprint/blueprint.service');
  const { BusinessGenesisController } = await import('../src/modules/business-genesis/business-genesis.controller');
  const { BusinessGenesisService } = await import('../src/modules/business-genesis/business-genesis.service');
  const { GenesisMarketStrategyService } = await import('../src/modules/business-genesis/genesis-market-strategy.service');
  const { GenomeChatController } = await import('../src/modules/business-genesis/genome-chat.controller');
  const { GenomeChatService } = await import('../src/modules/business-genesis/genome-chat.service');
  const { ConstitutionVersionController } = await import('../src/modules/business-genome/constitution-version.controller');
  const { ConstitutionVersionService } = await import('../src/modules/business-genome/constitution-version.service');
  const { GenomeEvolutionController } = await import('../src/modules/business-genome/genome-evolution.controller');
  const { GenomeEvolutionService } = await import('../src/modules/business-genome/genome-evolution.service');
  const { KeyGenomeController } = await import('../src/modules/business-genome/key-genome/key-genome.controller');
  const { GenomeSignalService } = await import('../src/modules/business-genome/key-genome/genome-signal.service');
  const { GenomeRecommendationService } = await import('../src/modules/business-genome/key-genome/genome-recommendation.service');
  const { GenomeExperimentService } = await import('../src/modules/business-genome/key-genome/genome-experiment.service');
  const { KeyGenomeGovernanceService } = await import('../src/modules/business-genome/key-genome/key-genome-governance.service');
  const { GenomeMemoryService } = await import('../src/modules/business-genome/key-genome/genome-memory.service');
  const { GenomeDepartmentService } = await import('../src/modules/business-genome/key-genome/genome-department.service');
  const { DepartmentReadinessService } = await import('../src/modules/business-genome/key-genome/department-readiness.service');
  const { GenomeFinancialMetricService } = await import('../src/modules/business-genome/key-genome/genome-financial-metric.service');
  const { FinanceGenomeService } = await import('../src/modules/business-genome/key-genome/finance-genome.service');
  const { GenomeCustomerSegmentService } = await import('../src/modules/business-genome/key-genome/genome-customer-segment.service');
  const { GenomeSalesMotionService } = await import('../src/modules/business-genome/key-genome/genome-sales-motion.service');
  const { CustomerSalesGenomeService } = await import('../src/modules/business-genome/key-genome/customer-sales-genome.service');
  const { GenomeOperationalProcessService } = await import('../src/modules/business-genome/key-genome/genome-operational-process.service');
  const { GenomeDeliveryCapabilityService } = await import('../src/modules/business-genome/key-genome/genome-delivery-capability.service');
  const { OperationsGenomeService } = await import('../src/modules/business-genome/key-genome/operations-genome.service');
  const { GenomeGrowthChannelService } = await import('../src/modules/business-genome/key-genome/genome-growth-channel.service');
  const { GenomeContentStrategyService } = await import('../src/modules/business-genome/key-genome/genome-content-strategy.service');
  const { MarketingGenomeService } = await import('../src/modules/business-genome/key-genome/marketing-genome.service');
  const { GenomeCrossDomainService } = await import('../src/modules/business-genome/key-genome/genome-cross-domain.service');
  const { GenomeRecommendationRankerService } = await import('../src/modules/business-genome/key-genome/genome-recommendation-ranker.service');
  const { GenomeOpportunityDetectorService } = await import('../src/modules/business-genome/key-genome/genome-opportunity-detector.service');
  const { GenomeAutonomyGateService } = await import('../src/modules/business-genome/key-genome/genome-autonomy-gate.service');
  const { GenomeRecommendationOutcomeService } = await import('../src/modules/business-genome/key-genome/genome-recommendation-outcome.service');
  const { GrowthIntelligenceController } = await import('../src/modules/growth-intelligence/growth-intelligence.controller');
  const { GrowthIntelligenceService } = await import('../src/modules/growth-intelligence/growth-intelligence.service');
  const { CustomerJourneyService } = await import('../src/modules/growth-intelligence/customer-journey.service');
  const { AttributionService } = await import('../src/modules/growth-intelligence/attribution.service');
  const { KeyflowCommandController } = await import('../src/modules/keyflow-command/keyflow-command.controller');
  const { KeyflowCommandService } = await import('../src/modules/keyflow-command/keyflow-command.service');
  const { KeyflowNotesService } = await import('../src/modules/keyflow-command/keyflow-notes.service');
  const { KeyflowVoiceService } = await import('../src/modules/keyflow-command/keyflow-voice.service');
  const { MomentumController } = await import('../src/modules/momentum/momentum.controller');
  const { ClientMomentumService } = await import('../src/modules/momentum/client-momentum.service');
  const { MomentumAiService } = await import('../src/modules/momentum/momentum-ai.service');

  MODULE_SCOPE_KEY_VAL = MODULE_SCOPE_KEY;
  controllersMap = {
    BlueprintController,
    BusinessGenesisController,
    GenomeChatController,
    ConstitutionVersionController,
    GenomeEvolutionController,
    KeyGenomeController,
    GrowthIntelligenceController,
    KeyflowCommandController,
    MomentumController,
  };

  const allow = { canActivate: () => true };

  const moduleRef = await Test.createTestingModule({
    controllers: Object.values(controllersMap),
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      { provide: BlueprintService, useValue: makeRecorder('BlueprintService') },
      { provide: BusinessGenesisService, useValue: makeRecorder('BusinessGenesisService') },
      { provide: GenesisMarketStrategyService, useValue: makeRecorder('GenesisMarketStrategyService') },
      { provide: GenomeChatService, useValue: makeRecorder('GenomeChatService') },
      { provide: ConstitutionVersionService, useValue: makeRecorder('ConstitutionVersionService') },
      { provide: GenomeEvolutionService, useValue: makeRecorder('GenomeEvolutionService') },
      { provide: GenomeSignalService, useValue: makeRecorder('GenomeSignalService') },
      { provide: GenomeRecommendationService, useValue: makeRecorder('GenomeRecommendationService') },
      { provide: GenomeExperimentService, useValue: makeRecorder('GenomeExperimentService') },
      { provide: KeyGenomeGovernanceService, useValue: makeRecorder('KeyGenomeGovernanceService') },
      { provide: GenomeMemoryService, useValue: makeRecorder('GenomeMemoryService') },
      { provide: GenomeDepartmentService, useValue: makeRecorder('GenomeDepartmentService') },
      { provide: DepartmentReadinessService, useValue: makeRecorder('DepartmentReadinessService') },
      { provide: GenomeFinancialMetricService, useValue: makeRecorder('GenomeFinancialMetricService') },
      { provide: FinanceGenomeService, useValue: makeRecorder('FinanceGenomeService') },
      { provide: GenomeCustomerSegmentService, useValue: makeRecorder('GenomeCustomerSegmentService') },
      { provide: GenomeSalesMotionService, useValue: makeRecorder('GenomeSalesMotionService') },
      { provide: CustomerSalesGenomeService, useValue: makeRecorder('CustomerSalesGenomeService') },
      { provide: GenomeOperationalProcessService, useValue: makeRecorder('GenomeOperationalProcessService') },
      { provide: GenomeDeliveryCapabilityService, useValue: makeRecorder('GenomeDeliveryCapabilityService') },
      { provide: OperationsGenomeService, useValue: makeRecorder('OperationsGenomeService') },
      { provide: GenomeGrowthChannelService, useValue: makeRecorder('GenomeGrowthChannelService') },
      { provide: GenomeContentStrategyService, useValue: makeRecorder('GenomeContentStrategyService') },
      { provide: MarketingGenomeService, useValue: makeRecorder('MarketingGenomeService') },
      { provide: GenomeCrossDomainService, useValue: makeRecorder('GenomeCrossDomainService') },
      { provide: GenomeRecommendationRankerService, useValue: makeRecorder('GenomeRecommendationRankerService') },
      { provide: GenomeOpportunityDetectorService, useValue: makeRecorder('GenomeOpportunityDetectorService') },
      { provide: GenomeAutonomyGateService, useValue: makeRecorder('GenomeAutonomyGateService') },
      { provide: GenomeRecommendationOutcomeService, useValue: makeRecorder('GenomeRecommendationOutcomeService') },
      { provide: GrowthIntelligenceService, useValue: makeRecorder('GrowthIntelligenceService') },
      { provide: CustomerJourneyService, useValue: makeRecorder('CustomerJourneyService') },
      { provide: AttributionService, useValue: makeRecorder('AttributionService') },
      { provide: KeyflowCommandService, useValue: makeRecorder('KeyflowCommandService') },
      { provide: KeyflowNotesService, useValue: makeRecorder('KeyflowNotesService') },
      { provide: KeyflowVoiceService, useValue: makeRecorder('KeyflowVoiceService') },
      { provide: ClientMomentumService, useValue: makeRecorder('ClientMomentumService') },
      { provide: MomentumAiService, useValue: makeRecorder('MomentumAiService') },
    ],
  })
    .overrideGuard(GenomeGateGuard)
    .useValue(allow)
    .overrideGuard(RateLimitGuard)
    .useValue(allow)
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

  await db.business.createMany({
    data: [
      { id: ID.bizA, name: 'V64M Genome Shop A', slug: `${P}biz-a`, ownerId: ID.ownerA, currency: 'TTD' },
      { id: ID.bizB, name: 'V64M Genome Shop B', slug: `${P}biz-b`, ownerId: ID.ownerB, currency: 'TTD' },
    ],
  });

  await db.membership.createMany({
    data: [
      { id: `${P}m_ownerA`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
      {
        id: `${P}m_none`,
        userId: ID.staffNone,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { settings: 'none', analytics: 'none', ai: 'none', crm: 'none' },
      },
      {
        id: `${P}m_read`,
        userId: ID.staffRead,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { settings: 'read', analytics: 'read', ai: 'read', crm: 'read' },
      },
      {
        id: `${P}m_write`,
        userId: ID.staffWrite,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { settings: 'write', analytics: 'write', ai: 'write', crm: 'write' },
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

describe('P84 — SWP-CENSUS-GENOME (9 controllers, 64 open write rows)', () => {
  it('[CG-01] RED-BEFORE: STAFF member with module=none is refused 403 on all 9 controllers with ZERO service calls', async () => {
    for (const door of DOORS) {
      serviceCalls.length = 0;
      const res = await callDoor(door, ID.bizA, ID.staffNone);
      expect(res.status, `${door.controller}.${door.handler} as staffNone: ${JSON.stringify(res.body)}`).toBe(403);
      expect(String(res.body?.message ?? '')).toContain(
        `Insufficient permissions: ${door.module} requires write access (you have none)`,
      );
      expect(serviceCalls, `${door.controller}.${door.handler} must not run service`).toEqual([]);
    }
  });

  it('[CG-02] RED-BEFORE: STAFF member with module=read is refused 403 on all 9 controllers with ZERO service calls', async () => {
    for (const door of DOORS) {
      serviceCalls.length = 0;
      const res = await callDoor(door, ID.bizA, ID.staffRead);
      expect(res.status, `${door.controller}.${door.handler} as staffRead: ${JSON.stringify(res.body)}`).toBe(403);
      expect(String(res.body?.message ?? '')).toContain(
        `Insufficient permissions: ${door.module} requires write access (you have read)`,
      );
      expect(serviceCalls, `${door.controller}.${door.handler} must not run service`).toEqual([]);
    }
  });

  it('[CG-03] control: OWNER succeeds (2xx) on all 9 controllers and reaches each service once', async () => {
    for (const door of DOORS) {
      serviceCalls.length = 0;
      const res = await callDoor(door, ID.bizA, ID.ownerA);
      expect(res.status, `${door.controller}.${door.handler} as ownerA: ${JSON.stringify(res.body)}`).toBeGreaterThanOrEqual(200);
      expect(res.status, `${door.controller}.${door.handler} as ownerA`).toBeLessThan(300);
      expect(serviceCalls.length, `${door.controller}.${door.handler} reached service`).toBeGreaterThanOrEqual(1);
    }
  });

  it('[CG-04] control: STAFF with explicit write scope succeeds (2xx) on all 9 controllers', async () => {
    for (const door of DOORS) {
      serviceCalls.length = 0;
      const res = await callDoor(door, ID.bizA, ID.staffWrite);
      expect(res.status, `${door.controller}.${door.handler} as staffWrite: ${JSON.stringify(res.body)}`).toBeGreaterThanOrEqual(200);
      expect(res.status, `${door.controller}.${door.handler} as staffWrite`).toBeLessThan(300);
      expect(serviceCalls.length, `${door.controller}.${door.handler} reached service`).toBeGreaterThanOrEqual(1);
    }
  });

  it('[CG-05] cross-tenant OWNER is refused 403 with zero service calls; unauthenticated is refused 401', async () => {
    for (const door of DOORS) {
      serviceCalls.length = 0;
      const unauth = await callDoor(door, ID.bizA);
      expect(unauth.status, `${door.controller}.${door.handler} unauth`).toBe(401);
      const foreign = await callDoor(door, ID.bizA, ID.ownerB);
      expect(foreign.status, `${door.controller}.${door.handler} cross-tenant`).toBe(403);
      expect(serviceCalls, `${door.controller}.${door.handler} no service call`).toEqual([]);
    }
  });

  it('[CG-06] all 64 previously-open handlers carry AuthGuard -> BusinessGuard -> ModuleScopeGuard and exact @RequireModuleScope(module, write)', () => {
    const problems: string[] = [];
    let totalChecked = 0;
    for (const [ctrlName, { module: expectedModule, handlers }] of Object.entries(EXPECTED_OPEN_SCOPES)) {
      const cls = controllersMap[ctrlName];
      const classGuards: Array<{ name?: string }> = Reflect.getMetadata(GUARDS_METADATA, cls) ?? [];
      for (const handler of handlers) {
        totalChecked += 1;
        const fn = cls.prototype[handler];
        if (typeof fn !== 'function') {
          problems.push(`${ctrlName}.${handler} missing on prototype`);
          continue;
        }
        const methodGuards: Array<{ name?: string }> = Reflect.getMetadata(GUARDS_METADATA, fn) ?? [];
        const guardNames = [...classGuards, ...methodGuards].map((g) => (typeof g === 'function' ? g.name : String(g)));
        for (const required of ['AuthGuard', 'BusinessGuard', 'ModuleScopeGuard']) {
          if (!guardNames.includes(required)) {
            problems.push(`${ctrlName}.${handler} missing guard ${required}`);
          }
        }
        const bizIdx = guardNames.indexOf('BusinessGuard');
        const scopeIdx = guardNames.indexOf('ModuleScopeGuard');
        if (bizIdx >= 0 && scopeIdx >= 0 && scopeIdx < bizIdx) {
          problems.push(`${ctrlName}.${handler} runs ModuleScopeGuard before BusinessGuard`);
        }
        const scope = Reflect.getMetadata(MODULE_SCOPE_KEY_VAL, fn);
        if (scope?.module !== expectedModule || scope?.minLevel !== 'write') {
          problems.push(
            `${ctrlName}.${handler} requires ${scope ? `${scope.module}:${scope.minLevel}` : 'none'}, expected ${expectedModule}:write`,
          );
        }
      }
    }
    expect(totalChecked).toBe(64);
    expect(problems).toEqual([]);
  });
});
