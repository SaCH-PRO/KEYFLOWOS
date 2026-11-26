/**
 * P109 — V1-64 (SWP-CENSUS-KEY-B, P1 launch-track, owner ruling B2 on #80 7179130521):
 *
 * Real Postgres + real NestJS HTTP app (`AuthGuard`, `BusinessGuard`,
 * `ModuleScopeGuard`, `CortexMemberAuthorityGuard`, `GlobalHttpExceptionFilter`)
 * across all 5 controllers of the KEY-B REST scope census batch (45 open rows in
 * REST-SCOPE-CENSUS-2026-11-13.md):
 *
 *   1. KeyActionProposalController (5 open  -> operations:write)
 *   2. KeyGenomeBridgeController   (1 open  -> ai:write; preserves requireBridgeRevenue)
 *   3. KeyCortexAuditController    (1 open  -> ai:write; method-level)
 *   4. KeyCortexGoalsController    (7 open  -> ai:write per Ruling B2)
 *   5. KeyCortexController         (31 open -> ai:write; method-level, preserving CortexMemberAuthorityGuard on approveAction & chat)
 *
 * Proves:
 *   - [CKEYB-01] RED-BEFORE KeyActionProposalController: STAFF with `none`, `read`, or wrong module (`ai:write`, `operations:none`)
 *                is refused 403 naming `operations` with ZERO service calls; STAFF with `operations:write`, OWNER, ADMIN succeed (201).
 *   - [CKEYB-02] RED-BEFORE KeyGenomeBridgeController: STAFF with `none`, `read`, or wrong module (`operations:write`, `ai:none`)
 *                is refused 403 naming `ai` with ZERO service calls; STAFF with `ai:write` + `revenue:none` succeeds (201) on a
 *                non-financial recommendation and is still refused 403 naming `revenue` on a FINANCIAL recommendation (requireBridgeRevenue intact);
 *                STAFF with `ai:write` + `revenue:write`, OWNER, ADMIN succeed (201) on the financial recommendation.
 *   - [CKEYB-03] RED-BEFORE KeyCortexAuditController: STAFF with `none`, `read`, or `ai:none` is refused 403 naming `ai`
 *                on POST /api/v1/cortex/eval/run with ZERO service calls; STAFF with `ai:write`, OWNER, ADMIN succeed (201).
 *   - [CKEYB-04] RED-BEFORE KeyCortexGoalsController (Ruling B2): STAFF with `none`, `read`, or `projects:write` + `ai:none`
 *                is refused 403 naming `ai` on POST /api/v1/cortex/goals with ZERO service calls; STAFF with `ai:write` + `projects:none`,
 *                OWNER, ADMIN succeed (201).
 *   - [CKEYB-05] RED-BEFORE KeyCortexController: STAFF with `none`, `read`, or `ai:none` is refused 403 naming `ai`
 *                on POST /api/v1/cortex/monitors and POST /api/v1/cortex/flows with ZERO service calls;
 *                STAFF with `ai:write`, OWNER, ADMIN succeed (201).
 *   - [CKEYB-06] Tenant isolation & auth: cross-tenant OWNER refused 403 with ZERO service calls; unauthenticated refused 401
 *                across all 5 controllers.
 *   - [CKEYB-07] Exhaustive metadata & guard-order verification across all 45 open rows (Ruling B2) and guard preservation
 *                on approveAction/chat + non-open write handlers untouched.
 *
 * Fixtures use pre-allocated prefix `v64l_` and are hard-deleted with `sqlLikePrefix(P)`.
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

const P = 'v64l_';
const HEADER = 'x-test-user-id';

const ID = {
  ownerA: `${P}ownerA`,
  adminA: `${P}adminA`,
  staffNone: `${P}staffNone`,
  staffRead: `${P}staffRead`,
  staffAiOnly: `${P}staffAiOnly`,
  staffOpsOnly: `${P}staffOpsOnly`,
  staffBothWrite: `${P}staffBothWrite`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  recOps: `${P}recOps`,
  recFin: `${P}recFin`,
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
          return { ok: true, success: true, id: `${P}stub` };
        };
      },
    },
  );
}

const EXPECTED_OPEN_SCOPES: Array<{
  controller: string;
  handler: string;
  module: 'operations' | 'ai';
  level: 'write';
  requiresCortexMember?: boolean;
}> = [
  // KeyActionProposalController (5 -> operations:write)
  { controller: 'KeyActionProposalController', handler: 'approve', module: 'operations', level: 'write' },
  { controller: 'KeyActionProposalController', handler: 'cancel', module: 'operations', level: 'write' },
  { controller: 'KeyActionProposalController', handler: 'create', module: 'operations', level: 'write' },
  { controller: 'KeyActionProposalController', handler: 'execute', module: 'operations', level: 'write' },
  { controller: 'KeyActionProposalController', handler: 'reject', module: 'operations', level: 'write' },

  // KeyGenomeBridgeController (1 -> ai:write)
  { controller: 'KeyGenomeBridgeController', handler: 'bridgeRecommendationAction', module: 'ai', level: 'write' },

  // KeyCortexAuditController (1 -> ai:write)
  { controller: 'KeyCortexAuditController', handler: 'runEval', module: 'ai', level: 'write' },

  // KeyCortexGoalsController (7 -> ai:write per Ruling B2)
  { controller: 'KeyCortexGoalsController', handler: 'createGoal', module: 'ai', level: 'write' },
  { controller: 'KeyCortexGoalsController', handler: 'createPlanFromCommand', module: 'ai', level: 'write' },
  { controller: 'KeyCortexGoalsController', handler: 'createPlanFromGoal', module: 'ai', level: 'write' },
  { controller: 'KeyCortexGoalsController', handler: 'createTriggerRule', module: 'ai', level: 'write' },
  { controller: 'KeyCortexGoalsController', handler: 'deleteGoal', module: 'ai', level: 'write' },
  { controller: 'KeyCortexGoalsController', handler: 'executePlan', module: 'ai', level: 'write' },
  { controller: 'KeyCortexGoalsController', handler: 'updateTriggerRule', module: 'ai', level: 'write' },

  // KeyCortexController (31 -> ai:write)
  { controller: 'KeyCortexController', handler: 'approveAction', module: 'ai', level: 'write', requiresCortexMember: true },
  { controller: 'KeyCortexController', handler: 'chat', module: 'ai', level: 'write', requiresCortexMember: true },
  { controller: 'KeyCortexController', handler: 'consciousChat', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'createMonitor', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'documentAsk', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'documentCompare', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'documentDelete', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'documentExtract', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'documentUpload', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'evolutionTune', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'flowApplyTemplate', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'flowCreate', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'flowDelete', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'flowGenerate', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'flowToggle', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'flowUpdate', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'listen', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'phoneAnalyze', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'phoneCall', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'phoneScript', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'recordFeedback', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'rollback', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'sandboxApply', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'sandboxAuto', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'sandboxExecute', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'sandboxExplain', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'sandboxGenerate', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'speak', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'switchPersonality', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'toggleMonitor', module: 'ai', level: 'write' },
  { controller: 'KeyCortexController', handler: 'updateMonitor', module: 'ai', level: 'write' },
];

async function cleanup() {
  if (!db) return;
  for (const sql of [
    `DELETE FROM genome_recommendations WHERE id LIKE ${sqlLikePrefix(P)}`,
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

function post(url: string, userId: string | null, body: Record<string, unknown>) {
  const req = request(app.getHttpServer()).post(url);
  if (userId) req.set(HEADER, userId);
  return req.send(body);
}

beforeAll(async () => {
  Logger.overrideLogger(false);
  const { db: prismaDb } = await import('@keyflow/db');
  db = prismaDb;

  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard, MODULE_SCOPE_KEY } = await import('../src/core/auth/module-scope.guard');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');

  const { KeyActionProposalController } = await import('../src/modules/key-autonomy/key-action-proposal.controller');
  const { KeyActionProposalService } = await import('../src/modules/key-autonomy/key-action-proposal.service');
  const { KeyGenomeBridgeController } = await import('../src/modules/key-autonomy/key-genome-bridge.controller');
  const { GenomeRecommendationActionBridgeService } = await import(
    '../src/modules/key-autonomy/genome-recommendation-action-bridge.service'
  );
  const { KeyAutonomySafetyService } = await import('../src/modules/key-autonomy/key-autonomy-safety.service');
  const { ComplianceMapService } = await import('../src/modules/key-autonomy/compliance-map.service');

  const { KeyCortexAuditController } = await import('../src/modules/key-cortex/key-cortex-audit.controller');
  const { EvalHarnessService } = await import('../src/modules/key-cortex/eval-harness.service');
  const { SelfAssessmentService } = await import('../src/modules/key-cortex/self-assessment.service');
  const { DigitalEmployeeAcceptanceService } = await import(
    '../src/modules/key-cortex/digital-employee-acceptance.service'
  );
  const { ValueLearningService } = await import('../src/modules/key-cortex/value-learning.service');

  const { KeyCortexGoalsController } = await import('../src/modules/key-cortex/key-cortex-goals.controller');
  const { KeyCortexPlannerService } = await import('../src/modules/key-cortex/key-cortex-planner.service');
  const { KeyCortexTriggerService } = await import('../src/modules/key-cortex/key-cortex-trigger.service');

  const {
    KeyCortexController,
    CortexMemberAuthorityGuard,
    CortexBusinessOwnerGuard,
    AutonomyProfileWriteGuard,
    AutonomyProfileAuditInterceptor,
  } = await import('../src/modules/key-cortex/key-cortex.controller');
  const { KeyCortexReasoningService } = await import('../src/modules/key-cortex/key-cortex-reasoning.service');
  const { KeyCortexConversationService } = await import('../src/modules/key-cortex/key-cortex-conversation.service');
  const { KeyCortexVoiceService } = await import('../src/modules/key-cortex/key-cortex-voice.service');
  const { KeyCortexPersonalityService } = await import('../src/modules/key-cortex/key-cortex-personality.service');
  const { KeyCortexActionsService } = await import('../src/modules/key-cortex/key-cortex-actions.service');
  const { KeyCortexContextService } = await import('../src/modules/key-cortex/key-cortex-context.service');
  const { KeyCortexConnectorService } = await import('../src/modules/key-cortex/key-cortex-connector.service');
  const { KeyCortexCommandService } = await import('../src/modules/key-cortex/key-cortex-command.service');
  const { KeyCortexExecutorService } = await import('../src/modules/key-cortex/key-cortex-executor.service');
  const { KeyCortexContextV2Service } = await import('../src/modules/key-cortex/key-cortex-context-v2.service');
  const { KeyCortexInsightService } = await import('../src/modules/key-cortex/key-cortex-insight.service');
  const { KeyCortexMonitorV2Service } = await import('../src/modules/key-cortex/key-cortex-monitor-v2.service');
  const { KeyCortexSandboxService } = await import('../src/modules/key-cortex/key-cortex-sandbox.service');
  const { KeyCortexFlowStudioService } = await import('../src/modules/key-cortex/key-cortex-flow-studio.service');
  const { KeyCortexEvolutionService } = await import('../src/modules/key-cortex/key-cortex-evolution.service');
  const { KeyCortexPhoneService } = await import('../src/modules/key-cortex/key-cortex-phone.service');
  const { KeyCortexDocumentService } = await import('../src/modules/key-cortex/key-cortex-document.service');
  const { KeyCortexLearningService } = await import('../src/modules/key-cortex/key-cortex-learning.service');
  const { KeyCortexApprovalOrchestratorService } = await import(
    '../src/modules/key-cortex/key-cortex-approval-orchestrator.service'
  );
  const { KeyCortexConsciousnessService } = await import('../src/modules/key-cortex/key-cortex-consciousness.service');
  const { KeyCortexSessionService } = await import('../src/modules/key-cortex/key-cortex-session.service');
  const { KeyCortexAwarenessService } = await import('../src/modules/key-cortex/key-cortex-awareness.service');

  MODULE_SCOPE_KEY_VAL = MODULE_SCOPE_KEY;
  controllersMap = {
    KeyActionProposalController,
    KeyGenomeBridgeController,
    KeyCortexAuditController,
    KeyCortexGoalsController,
    KeyCortexController,
  };

  await cleanup();

  await db.user.createMany({
    data: [
      { id: ID.ownerA, email: `${P}ownerA@test.local`, name: 'Owner A', role: 'USER' },
      { id: ID.adminA, email: `${P}adminA@test.local`, name: 'Admin A', role: 'USER' },
      { id: ID.staffNone, email: `${P}staffNone@test.local`, name: 'Staff None', role: 'USER' },
      { id: ID.staffRead, email: `${P}staffRead@test.local`, name: 'Staff Read', role: 'USER' },
      { id: ID.staffAiOnly, email: `${P}staffAiOnly@test.local`, name: 'Staff AI Only', role: 'USER' },
      { id: ID.staffOpsOnly, email: `${P}staffOpsOnly@test.local`, name: 'Staff Ops Only', role: 'USER' },
      { id: ID.staffBothWrite, email: `${P}staffBothWrite@test.local`, name: 'Staff Both Write', role: 'USER' },
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
        permissionScopes: { ai: 'none', operations: 'none', revenue: 'none', projects: 'none' },
      },
      {
        userId: ID.staffRead,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { ai: 'read', operations: 'read', revenue: 'read', projects: 'read' },
      },
      {
        userId: ID.staffAiOnly,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { ai: 'write', operations: 'none', revenue: 'none', projects: 'none' },
      },
      {
        userId: ID.staffOpsOnly,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { ai: 'none', operations: 'write', revenue: 'none', projects: 'write' },
      },
      {
        userId: ID.staffBothWrite,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { ai: 'write', operations: 'write', revenue: 'write', projects: 'none' },
      },
      { userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
    ],
  });

  await db.genomeRecommendation.createMany({
    data: [
      {
        id: ID.recOps,
        businessId: ID.bizA,
        domain: 'OPERATIONS',
        title: 'Standardize onboarding checklist',
        insight: 'Team handoffs lack a shared checklist',
        diagnosis: 'Intake steps vary across staff',
        recommendation: 'Publish a shared intake checklist for the operations team',
      },
      {
        id: ID.recFin,
        businessId: ID.bizA,
        domain: 'FINANCIAL',
        title: 'Recover TTD 14500 overdue receivables',
        insight: 'Four invoices remain unpaid past 30 days',
        diagnosis: 'Monthly billing follow-up is irregular',
        recommendation: 'Send reminders on overdue invoices totaling TTD 14500',
      },
    ],
  });

  const evalHarnessStub = {
    getSuiteNames: () => ['smoke'],
    runSuite: async (suite: string) => {
      serviceCalls.push({ service: 'EvalHarnessService', op: 'runSuite' });
      return { suite, assertions: [{ name: 'stub', status: 'PASS' }] };
    },
    runAll: async () => {
      serviceCalls.push({ service: 'EvalHarnessService', op: 'runAll' });
      return [{ suite: 'smoke', assertions: [{ name: 'stub', status: 'PASS' }] }];
    },
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [
      KeyActionProposalController,
      KeyGenomeBridgeController,
      KeyCortexAuditController,
      KeyCortexGoalsController,
      KeyCortexController,
    ],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CortexMemberAuthorityGuard,
      CortexBusinessOwnerGuard,
      AutonomyProfileWriteGuard,
      AutonomyProfileAuditInterceptor,
      { provide: KeyActionProposalService, useValue: makeRecorder('KeyActionProposalService') },
      { provide: KeyCortexApprovalOrchestratorService, useValue: makeRecorder('KeyCortexApprovalOrchestratorService') },
      { provide: GenomeRecommendationActionBridgeService, useValue: makeRecorder('GenomeRecommendationActionBridgeService') },
      { provide: KeyAutonomySafetyService, useValue: makeRecorder('KeyAutonomySafetyService') },
      { provide: ComplianceMapService, useValue: makeRecorder('ComplianceMapService') },
      { provide: EvalHarnessService, useValue: evalHarnessStub },
      { provide: SelfAssessmentService, useValue: makeRecorder('SelfAssessmentService') },
      { provide: DigitalEmployeeAcceptanceService, useValue: makeRecorder('DigitalEmployeeAcceptanceService') },
      { provide: ValueLearningService, useValue: makeRecorder('ValueLearningService') },
      { provide: KeyCortexPlannerService, useValue: makeRecorder('KeyCortexPlannerService') },
      { provide: KeyCortexTriggerService, useValue: makeRecorder('KeyCortexTriggerService') },
      { provide: KeyCortexReasoningService, useValue: makeRecorder('KeyCortexReasoningService') },
      { provide: KeyCortexConversationService, useValue: makeRecorder('KeyCortexConversationService') },
      { provide: KeyCortexVoiceService, useValue: makeRecorder('KeyCortexVoiceService') },
      { provide: KeyCortexPersonalityService, useValue: makeRecorder('KeyCortexPersonalityService') },
      { provide: KeyCortexActionsService, useValue: makeRecorder('KeyCortexActionsService') },
      { provide: KeyCortexContextService, useValue: makeRecorder('KeyCortexContextService') },
      { provide: KeyCortexConnectorService, useValue: makeRecorder('KeyCortexConnectorService') },
      { provide: KeyCortexCommandService, useValue: makeRecorder('KeyCortexCommandService') },
      { provide: KeyCortexExecutorService, useValue: makeRecorder('KeyCortexExecutorService') },
      { provide: KeyCortexContextV2Service, useValue: makeRecorder('KeyCortexContextV2Service') },
      { provide: KeyCortexInsightService, useValue: makeRecorder('KeyCortexInsightService') },
      { provide: KeyCortexMonitorV2Service, useValue: makeRecorder('KeyCortexMonitorV2Service') },
      { provide: KeyCortexSandboxService, useValue: makeRecorder('KeyCortexSandboxService') },
      { provide: KeyCortexFlowStudioService, useValue: makeRecorder('KeyCortexFlowStudioService') },
      { provide: KeyCortexEvolutionService, useValue: makeRecorder('KeyCortexEvolutionService') },
      { provide: KeyCortexPhoneService, useValue: makeRecorder('KeyCortexPhoneService') },
      { provide: KeyCortexDocumentService, useValue: makeRecorder('KeyCortexDocumentService') },
      { provide: KeyCortexLearningService, useValue: makeRecorder('KeyCortexLearningService') },
      { provide: KeyCortexConsciousnessService, useValue: makeRecorder('KeyCortexConsciousnessService') },
      { provide: KeyCortexSessionService, useValue: makeRecorder('KeyCortexSessionService') },
      { provide: KeyCortexAwarenessService, useValue: makeRecorder('KeyCortexAwarenessService') },
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
  await cleanup();
});

describe('P109 — SWP-CENSUS-KEY-B (5 controllers / 45 open rows, Ruling B2)', () => {
  it('[CKEYB-01] RED-BEFORE KeyActionProposalController (operations:write): denies none/read/ai-only with 403 and ZERO service calls; admits operations:write, OWNER, ADMIN', async () => {
    const url = `/key-autonomy/businesses/${ID.bizA}/actions/proposals`;
    const body = { sourceType: 'CHAT', actionType: 'SEND_EMAIL', title: 'Follow up lead' };

    for (const denied of [ID.staffNone, ID.staffRead, ID.staffAiOnly]) {
      serviceCalls.length = 0;
      const res = await post(url, denied, body);
      expect(res.status, `proposal.create (${denied}): ${JSON.stringify(res.body)}`).toBe(403);
      expect(JSON.stringify(res.body)).toMatch(/operations/i);
      expect(serviceCalls, `proposal.create (${denied}) must not invoke service`).toHaveLength(0);
    }

    for (const allowed of [ID.staffOpsOnly, ID.ownerA, ID.adminA]) {
      serviceCalls.length = 0;
      const res = await post(url, allowed, body);
      expect(res.status, `proposal.create (${allowed}): ${JSON.stringify(res.body)}`).toBe(201);
      expect(serviceCalls.some((c) => c.service === 'KeyCortexApprovalOrchestratorService' && c.op === 'propose')).toBe(
        true,
      );
    }
  });

  it('[CKEYB-02] RED-BEFORE KeyGenomeBridgeController (ai:write + requireBridgeRevenue): denies none/read/ops-only with 403 naming ai; preserves revenue:write on FINANCIAL recommendations', async () => {
    const opsUrl = `/business-genome/businesses/${ID.bizA}/key-genome/recommendations/${ID.recOps}/bridge-action`;
    const finUrl = `/business-genome/businesses/${ID.bizA}/key-genome/recommendations/${ID.recFin}/bridge-action`;
    const body = { actionKind: 'CREATE_TASK', confirmBridge: true };

    for (const denied of [ID.staffNone, ID.staffRead, ID.staffOpsOnly]) {
      serviceCalls.length = 0;
      const res = await post(opsUrl, denied, body);
      expect(res.status, `genomeBridge (${denied}): ${JSON.stringify(res.body)}`).toBe(403);
      expect(JSON.stringify(res.body)).toMatch(/\bai\b/i);
      expect(serviceCalls, `genomeBridge (${denied}) must not invoke service`).toHaveLength(0);
    }

    // ai:write without revenue:write succeeds on non-financial recommendation, but is refused on FINANCIAL recommendation
    serviceCalls.length = 0;
    const opsRes = await post(opsUrl, ID.staffAiOnly, body);
    expect(opsRes.status, `genomeBridge non-fin (staffAiOnly): ${JSON.stringify(opsRes.body)}`).toBe(201);
    expect(serviceCalls.some((c) => c.service === 'GenomeRecommendationActionBridgeService')).toBe(true);

    serviceCalls.length = 0;
    const finDenied = await post(finUrl, ID.staffAiOnly, body);
    expect(finDenied.status, `genomeBridge financial (staffAiOnly): ${JSON.stringify(finDenied.body)}`).toBe(403);
    expect(JSON.stringify(finDenied.body)).toMatch(/revenue/i);
    expect(serviceCalls, 'financial bridge must fail closed before bridgeService').toHaveLength(0);

    for (const allowed of [ID.staffBothWrite, ID.ownerA, ID.adminA]) {
      serviceCalls.length = 0;
      const res = await post(finUrl, allowed, body);
      expect(res.status, `genomeBridge financial (${allowed}): ${JSON.stringify(res.body)}`).toBe(201);
      expect(serviceCalls.some((c) => c.service === 'GenomeRecommendationActionBridgeService')).toBe(true);
    }
  });

  it('[CKEYB-03] RED-BEFORE KeyCortexAuditController (ai:write): denies none/read/ops-only with 403 and ZERO service calls; admits ai:write, OWNER, ADMIN', async () => {
    const url = '/api/v1/cortex/eval/run';
    const body = { businessId: ID.bizA, suite: 'smoke' };

    for (const denied of [ID.staffNone, ID.staffRead, ID.staffOpsOnly]) {
      serviceCalls.length = 0;
      const res = await post(url, denied, body);
      expect(res.status, `audit.runEval (${denied}): ${JSON.stringify(res.body)}`).toBe(403);
      expect(JSON.stringify(res.body)).toMatch(/\bai\b/i);
      expect(serviceCalls, `audit.runEval (${denied}) must not invoke service`).toHaveLength(0);
    }

    for (const allowed of [ID.staffAiOnly, ID.ownerA, ID.adminA]) {
      serviceCalls.length = 0;
      const res = await post(url, allowed, body);
      expect(res.status, `audit.runEval (${allowed}): ${JSON.stringify(res.body)}`).toBe(201);
      expect(serviceCalls.some((c) => c.service === 'EvalHarnessService' && c.op === 'runSuite')).toBe(true);
    }
  });

  it('[CKEYB-04] RED-BEFORE KeyCortexGoalsController (ai:write per Ruling B2): denies none/read/projects-write-without-ai with 403 and ZERO service calls; admits ai:write, OWNER, ADMIN', async () => {
    const url = '/api/v1/cortex/goals';
    const body = { businessId: ID.bizA, title: 'Ship launch milestone' };

    // staffOpsOnly holds projects:write + operations:write, ai:none — Ruling B2 requires ai:write!
    for (const denied of [ID.staffNone, ID.staffRead, ID.staffOpsOnly]) {
      serviceCalls.length = 0;
      const res = await post(url, denied, body);
      expect(res.status, `goals.createGoal (${denied}): ${JSON.stringify(res.body)}`).toBe(403);
      expect(JSON.stringify(res.body)).toMatch(/\bai\b/i);
      expect(serviceCalls, `goals.createGoal (${denied}) must not invoke service`).toHaveLength(0);
    }

    for (const allowed of [ID.staffAiOnly, ID.ownerA, ID.adminA]) {
      serviceCalls.length = 0;
      const res = await post(url, allowed, body);
      expect(res.status, `goals.createGoal (${allowed}): ${JSON.stringify(res.body)}`).toBe(201);
      expect(serviceCalls.some((c) => c.service === 'KeyCortexPlannerService' && c.op === 'createGoal')).toBe(true);
    }
  });

  it('[CKEYB-05] RED-BEFORE KeyCortexController (ai:write): denies none/read/ops-only with 403 and ZERO service calls; admits ai:write, OWNER, ADMIN', async () => {
    const probes = [
      {
        label: 'cortex.createMonitor',
        url: '/api/v1/cortex/monitors',
        body: { businessId: ID.bizA, description: 'Watch overdue invoices' },
        service: 'KeyCortexMonitorV2Service',
        op: 'createMonitor',
      },
      {
        label: 'cortex.flowCreate',
        url: '/api/v1/cortex/flows',
        body: {
          businessId: ID.bizA,
          name: 'Welcome flow',
          nodes: [{ id: 'n1', type: 'trigger' }],
          edges: [],
        },
        service: 'KeyCortexFlowStudioService',
        op: 'create',
      },
    ];

    for (const probe of probes) {
      for (const denied of [ID.staffNone, ID.staffRead, ID.staffOpsOnly]) {
        serviceCalls.length = 0;
        const res = await post(probe.url, denied, probe.body);
        expect(res.status, `${probe.label} (${denied}): ${JSON.stringify(res.body)}`).toBe(403);
        expect(JSON.stringify(res.body)).toMatch(/\bai\b/i);
        expect(serviceCalls, `${probe.label} (${denied}) must not invoke service`).toHaveLength(0);
      }

      for (const allowed of [ID.staffAiOnly, ID.ownerA, ID.adminA]) {
        serviceCalls.length = 0;
        const res = await post(probe.url, allowed, probe.body);
        expect(res.status, `${probe.label} (${allowed}): ${JSON.stringify(res.body)}`).toBe(201);
        expect(serviceCalls.some((c) => c.service === probe.service && c.op === probe.op)).toBe(true);
      }
    }
  });

  it('[CKEYB-06] Tenant isolation & auth: cross-tenant OWNER refused 403 with ZERO service calls; unauthenticated refused 401 across all 5 controllers', async () => {
    const probes = [
      {
        label: 'KeyActionProposalController.create',
        url: `/key-autonomy/businesses/${ID.bizA}/actions/proposals`,
        body: { sourceType: 'CHAT', actionType: 'SEND_EMAIL', title: 'Cross' },
      },
      {
        label: 'KeyGenomeBridgeController.bridgeRecommendationAction',
        url: `/business-genome/businesses/${ID.bizA}/key-genome/recommendations/${ID.recOps}/bridge-action`,
        body: { actionKind: 'CREATE_TASK', confirmBridge: true },
      },
      {
        label: 'KeyCortexAuditController.runEval',
        url: '/api/v1/cortex/eval/run',
        body: { businessId: ID.bizA, suite: 'smoke' },
      },
      {
        label: 'KeyCortexGoalsController.createGoal',
        url: '/api/v1/cortex/goals',
        body: { businessId: ID.bizA, title: 'Cross' },
      },
      {
        label: 'KeyCortexController.createMonitor',
        url: '/api/v1/cortex/monitors',
        body: { businessId: ID.bizA, description: 'Cross' },
      },
    ];

    for (const probe of probes) {
      serviceCalls.length = 0;
      const cross = await post(probe.url, ID.ownerB, probe.body);
      expect(cross.status, `${probe.label} (ownerB -> bizA): ${JSON.stringify(cross.body)}`).toBe(403);
      expect(serviceCalls, `${probe.label} cross-tenant must not invoke service`).toHaveLength(0);

      const unauth = await post(probe.url, null, probe.body);
      expect(unauth.status, `${probe.label} (unauth)`).toBe(401);
    }
  });

  it('[CKEYB-07] Exhaustive metadata & guard-order verification across all 45 open KEY-B rows (Ruling B2)', () => {
    expect(EXPECTED_OPEN_SCOPES).toHaveLength(45);

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

      if (row.requiresCortexMember) {
        expect(guardNames, `${row.controller}.${row.handler} must preserve CortexMemberAuthorityGuard`).toContain(
          'CortexMemberAuthorityGuard',
        );
      }

      const scope =
        Reflect.getMetadata(MODULE_SCOPE_KEY_VAL, handlerFn) ??
        Reflect.getMetadata(MODULE_SCOPE_KEY_VAL, ControllerCls);
      expect(scope, `${row.controller}.${row.handler} @RequireModuleScope`).toEqual({
        module: row.module,
        minLevel: row.level,
      });
    }

    // Confirm non-open KeyCortexController write rows were NOT inadvertently given ai:write
    const CortexCls = controllersMap.KeyCortexController;
    for (const nonOpen of [
      'createSession',
      'updateSession',
      'deleteSession',
      'executeCommand',
      'executeBatch',
      'queryModule',
      'flowExecute',
      'updateAutonomyProfile',
    ]) {
      const scope = Reflect.getMetadata(MODULE_SCOPE_KEY_VAL, CortexCls.prototype[nonOpen]);
      expect(scope, `KeyCortexController.${nonOpen} must remain untouched`).toBeUndefined();
    }
    expect(Reflect.getMetadata(MODULE_SCOPE_KEY_VAL, CortexCls.prototype.generateInsights)).toEqual({
      module: 'revenue',
      minLevel: 'read',
    });
    expect(Reflect.getMetadata(MODULE_SCOPE_KEY_VAL, CortexCls.prototype.findProfitOpportunities)).toEqual({
      module: 'revenue',
      minLevel: 'read',
    });
  });
});
