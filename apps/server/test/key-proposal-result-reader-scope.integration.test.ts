/**
 * W11-PROPOSAL-RESULT-READER-SCOPE (SEC-SR-2; D-238):
 * An approved KEY proposal's stored `executionResult` is projected for the
 * member who reads it over REST (`GET .../actions/proposals`,
 * `GET .../actions/proposals/:id`, and `viewForReader` after actions).
 *
 * Simplest correct rule:
 *   - Financial proposals (including any whose `executionResult` contains
 *     finance genome rows, money text, or provenance references to FINANCIAL
 *     genome recommendations/signals) remain withheld from readers without
 *     `revenue:read` (omitted from list, 404 on get, redacted on viewForReader).
 *   - For any proposal returned with a non-null `executionResult`, the reader
 *     keeps `executionResult` only when they may read what the run produced:
 *       1. `SUPER_ADMIN` or `OWNER`, or
 *       2. every canonical module required by the proposal's tool/module has
 *          at least `read` access for this reader (and no referenced finance
 *          genome row is present without `revenue:read`), or
 *       3. when no canonical module is declared on the proposal, the reader is
 *          the run's member (`executedBy === reader.id`) and no finance rows
 *          are present without `revenue:read`.
 *     Otherwise `executionResult` is withheld (`null`).
 *
 * Fixtures: prefix `v64a_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL in dependency order in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v64a_';
const HEADER = 'x-test-user';

const ID = {
  owner: `${P}owner`,
  staffRevRead: `${P}staff_rev_read`,
  staffRevNone: `${P}staff_rev_none`,
  staffCrmNone: `${P}staff_crm_none`,
  staffOther: `${P}staff_other`,
  biz: `${P}biz`,
  sigFin: `${P}sig_fin`,
  sigOps: `${P}sig_ops`,
  recFin: `${P}rec_fin`,
  recOps: `${P}rec_ops`,
  propFinGenome: `${P}prop_fin_genome`,
  propFinRefById: `${P}prop_fin_ref_id`,
  propCrmExec: `${P}prop_crm_exec`,
  propSettingsGenome: `${P}prop_settings_genome`,
  propSelfRun: `${P}prop_self_run`,
};

let db: any;
let app: any;
let proposals: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM key_action_proposals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM genome_recommendations WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM genome_signals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

beforeAll(async () => {
  const { db: prismaClient } = await import('@keyflow/db');
  db = prismaClient;

  const { Test } = await import('@nestjs/testing');
  const { EventEmitterModule } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { KeyActionProposalController } = await import('../src/modules/key-autonomy/key-action-proposal.controller');
  const { KeyActionProposalService } = await import('../src/modules/key-autonomy/key-action-proposal.service');
  const { KeyActionPolicyService } = await import('../src/modules/key-autonomy/key-action-policy.service');
  const { KeyActionExecutorService } = await import('../src/modules/key-autonomy/key-action-executor.service');
  const { KeyActionGenomePolicyService } = await import('../src/modules/key-autonomy/key-action-genome-policy.service');
  const { AutonomyOrchestratorService } = await import('../src/modules/key-autonomy/autonomy-orchestrator.service');
  const { KeyActionBoundaryService } = await import('../src/modules/key-autonomy/action-boundary/key-action-boundary.service');
  const { TemporalFlowService } = await import('../src/modules/temporal-flow/temporal-flow.service');
  const { KeyCortexApprovalOrchestratorService } = await import(
    '../src/modules/key-cortex/key-cortex-approval-orchestrator.service'
  );

  const moduleRef = await Test.createTestingModule({
    imports: [EventEmitterModule.forRoot()],
    controllers: [KeyActionProposalController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      KeyActionProposalService,
      { provide: TemporalFlowService, useValue: { emit: async () => null } },
      { provide: KeyActionPolicyService, useValue: {} },
      { provide: KeyActionExecutorService, useValue: {} },
      { provide: KeyActionGenomePolicyService, useValue: {} },
      { provide: AutonomyOrchestratorService, useValue: {} },
      { provide: KeyActionBoundaryService, useValue: {} },
      { provide: KeyCortexApprovalOrchestratorService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.use(async (req: any, _res: any, next: () => void) => {
    const uid = req.headers[HEADER] as string | undefined;
    if (uid) {
      const user = await db.user.findUnique({ where: { id: uid }, select: { id: true, email: true, role: true } });
      if (user) req.user = user;
    }
    next();
  });
  await app.init();
  proposals = app.get(KeyActionProposalService);

  await cleanup();

  for (const [id, email] of [
    [ID.owner, `${P}owner@test.local`],
    [ID.staffRevRead, `${P}rev_read@test.local`],
    [ID.staffRevNone, `${P}rev_none@test.local`],
    [ID.staffCrmNone, `${P}crm_none@test.local`],
    [ID.staffOther, `${P}other@test.local`],
  ]) {
    await db.user.create({ data: { id, email, role: 'USER' } });
  }

  await db.business.create({
    data: { id: ID.biz, name: 'V64A Proposal Scope', ownerId: ID.owner, currency: 'TTD' },
  });

  await db.membership.createMany({
    data: [
      { id: `${ID.owner}_m`, userId: ID.owner, businessId: ID.biz, role: 'OWNER' },
      {
        id: `${ID.staffRevRead}_m`,
        userId: ID.staffRevRead,
        businessId: ID.biz,
        role: 'STAFF',
        permissionScopes: { revenue: 'read', crm: 'read', settings: 'read', operations: 'read', bookings: 'none' },
      },
      {
        id: `${ID.staffRevNone}_m`,
        userId: ID.staffRevNone,
        businessId: ID.biz,
        role: 'STAFF',
        permissionScopes: { revenue: 'none', crm: 'read', settings: 'read', operations: 'read', bookings: 'none' },
      },
      {
        id: `${ID.staffCrmNone}_m`,
        userId: ID.staffCrmNone,
        businessId: ID.biz,
        role: 'STAFF',
        permissionScopes: { revenue: 'read', crm: 'none', settings: 'none', bookings: 'none' },
      },
      {
        id: `${ID.staffOther}_m`,
        userId: ID.staffOther,
        businessId: ID.biz,
        role: 'STAFF',
        permissionScopes: { revenue: 'none', crm: 'none', settings: 'none', bookings: 'none' },
      },
    ],
  });

  // Seed real finance & operations genome rows as key-genome-finance-scope does.
  await db.genomeSignal.createMany({
    data: [
      {
        id: ID.sigFin,
        businessId: ID.biz,
        sourceModule: 'finance',
        sourceEntityType: 'FINANCE_GENOME',
        signalType: 'RISK_PATTERN',
        section: 'FINANCIAL',
        domain: 'finance',
        field: 'LOW_RUNWAY',
        reason: 'Runway is 0.8 months — critically low.',
        confidence: 0.95,
        status: 'NEW',
      },
      {
        id: ID.sigOps,
        businessId: ID.biz,
        sourceModule: 'operations',
        sourceEntityType: 'OPERATIONS_GENOME',
        signalType: 'RISK_PATTERN',
        section: 'OPERATIONS',
        domain: 'operations',
        field: 'DELIVERY_DELAY',
        reason: 'Delivery lead time rose by 2 days.',
        confidence: 0.9,
        status: 'NEW',
      },
    ],
  });

  await db.genomeRecommendation.createMany({
    data: [
      {
        id: ID.recFin,
        businessId: ID.biz,
        domain: 'FINANCIAL',
        title: 'Reduce monthly burn immediately',
        insight: 'Cash reserves cover 0.8 months at current burn.',
        diagnosis: 'Cash reserves cover 0.8 months at current burn.',
        recommendation: 'Cut costs or raise prices.',
        expectedGainScore: 95,
        riskLevel: 'HIGH',
        status: 'ACTIVE',
      },
      {
        id: ID.recOps,
        businessId: ID.biz,
        domain: 'OPERATIONS',
        title: 'Standardize dispatch checklist',
        insight: 'Two shipments missed handoff cutoffs.',
        diagnosis: 'Two shipments missed handoff cutoffs.',
        recommendation: 'Document dispatch steps.',
        expectedGainScore: 55,
        riskLevel: 'MEDIUM',
        status: 'ACTIVE',
      },
    ],
  });

  const now = new Date();
  await db.keyActionProposal.createMany({
    data: [
      // 1. Owner-run genome proposal whose executionResult holds real finance genome rows.
      {
        id: ID.propFinGenome,
        businessId: ID.biz,
        userId: ID.owner,
        sourceType: 'KEY_CHAT',
        title: 'Inspect workspace signals',
        actionType: 'EXECUTE_TOOL',
        toolName: 'key_genome.list_signals',
        module: 'settings',
        riskLevel: 'LOW',
        status: 'EXECUTED',
        approvedBy: ID.owner,
        approvedAt: now,
        executedBy: ID.owner,
        executedAt: now,
        executionResult: {
          signals: [
            { id: ID.sigFin, domain: 'FINANCIAL', reason: 'Runway is 0.8 months — critically low.' },
            { id: ID.sigOps, domain: 'OPERATIONS', reason: 'Delivery lead time rose by 2 days.' },
          ],
          recommendations: [
            { id: ID.recFin, domain: 'FINANCIAL', title: 'Reduce monthly burn immediately' },
          ],
        },
      },
      // 2. Owner-run non-financial-titled proposal whose executionResult references a FINANCIAL genome row by ID only.
      {
        id: ID.propFinRefById,
        businessId: ID.biz,
        userId: ID.owner,
        sourceType: 'KEY_CHAT',
        title: 'Sync workspace items',
        actionType: 'OPEN_GENOME',
        module: 'operations',
        riskLevel: 'LOW',
        status: 'EXECUTED',
        approvedBy: ID.owner,
        approvedAt: now,
        executedBy: ID.owner,
        executedAt: now,
        executionResult: {
          recommendationId: ID.recFin,
          signalId: ID.sigFin,
          synced: true,
        },
      },
      // 3. Owner-run CRM proposal with non-financial executionResult (requires crm:read).
      {
        id: ID.propCrmExec,
        businessId: ID.biz,
        userId: ID.owner,
        sourceType: 'KEY_CHAT',
        title: 'Follow up with Kerry',
        actionType: 'CREATE_TASK',
        module: 'crm',
        riskLevel: 'LOW',
        status: 'EXECUTED',
        approvedBy: ID.owner,
        approvedAt: now,
        executedBy: ID.owner,
        executedAt: now,
        executionResult: {
          contactName: 'Kerry VIP',
          phone: '+18685550199',
        },
      },
      // 4. Owner-run key_genome proposal with non-financial OPERATIONS signals (requires settings:read).
      {
        id: ID.propSettingsGenome,
        businessId: ID.biz,
        userId: ID.owner,
        sourceType: 'KEY_CHAT',
        title: 'Review operations checklist signals',
        actionType: 'EXECUTE_TOOL',
        toolName: 'key_genome.list_signals',
        module: 'settings',
        riskLevel: 'LOW',
        status: 'EXECUTED',
        approvedBy: ID.owner,
        approvedAt: now,
        executedBy: ID.owner,
        executedAt: now,
        executionResult: {
          signals: [{ id: ID.sigOps, domain: 'OPERATIONS', reason: 'Delivery lead time rose by 2 days.' }],
        },
      },
      // 5. Proposal run by staffRevNone with no canonical module declared (run's member control + fail-closed for others).
      {
        id: ID.propSelfRun,
        businessId: ID.biz,
        userId: ID.staffRevNone,
        sourceType: 'KEY_CHAT',
        title: 'Open workspace checklist',
        actionType: 'OPEN',
        module: null,
        toolName: null,
        riskLevel: 'LOW',
        status: 'EXECUTED',
        approvedBy: ID.owner,
        approvedAt: now,
        executedBy: ID.staffRevNone,
        executedAt: now,
        executionResult: {
          checklist: ['confirm-handoff', 'verify-notes'],
        },
      },
    ],
  });
}, 30_000);

afterAll(async () => {
  await cleanup();
  await app?.close();
});

const getList = (userId: string) =>
  request(app.getHttpServer())
    .get(`/key-autonomy/businesses/${ID.biz}/actions/proposals`)
    .set(HEADER, userId);

const getOne = (userId: string, proposalId: string) =>
  request(app.getHttpServer())
    .get(`/key-autonomy/businesses/${ID.biz}/actions/proposals/${proposalId}`)
    .set(HEADER, userId);

describe('W11-PROPOSAL-RESULT-READER-SCOPE (SEC-SR-2; real Postgres)', () => {
  it('PRS-01: owner-run proposal whose executionResult holds finance genome rows is withheld from revenue:none, while owner and revenue:read+settings:read read it whole', async () => {
    const revNoneList = await getList(ID.staffRevNone).expect(200);
    expect(revNoneList.body.find((p: any) => p.id === ID.propFinGenome)).toBeUndefined();
    expect(JSON.stringify(revNoneList.body)).not.toContain('Runway is 0.8');
    expect(JSON.stringify(revNoneList.body)).not.toContain('Reduce monthly burn');

    await getOne(ID.staffRevNone, ID.propFinGenome).expect(404);

    // Controls: owner and revenue:read + settings:read member read executionResult whole.
    for (const uid of [ID.owner, ID.staffRevRead]) {
      const res = await getOne(uid, ID.propFinGenome).expect(200);
      expect(res.body.executionResult?.signals?.map((s: any) => s.id)).toEqual([ID.sigFin, ID.sigOps]);
      expect(res.body.executionResult?.recommendations?.map((r: any) => r.id)).toEqual([ID.recFin]);
    }
  });

  it('PRS-02 (RED-BEFORE): owner-run proposal whose executionResult references a FINANCIAL genome recommendation/signal by ID only is withheld from revenue:none, while owner and revenue:read read it whole', async () => {
    const revNoneList = await getList(ID.staffRevNone).expect(200);
    const revNoneItem = revNoneList.body.find((p: any) => p.id === ID.propFinRefById);
    if (revNoneItem) {
      expect(revNoneItem.executionResult).toBeNull();
    }
    expect(JSON.stringify(revNoneList.body)).not.toContain(ID.recFin);
    expect(JSON.stringify(revNoneList.body)).not.toContain(ID.sigFin);

    const revNoneGet = await getOne(ID.staffRevNone, ID.propFinRefById);
    expect([200, 404]).toContain(revNoneGet.status);
    if (revNoneGet.status === 200) {
      expect(revNoneGet.body.executionResult).toBeNull();
    }
    expect(JSON.stringify(revNoneGet.body)).not.toContain(ID.recFin);
    expect(JSON.stringify(revNoneGet.body)).not.toContain(ID.sigFin);

    // Controls: owner and revenue:read member read executionResult whole.
    for (const uid of [ID.owner, ID.staffRevRead]) {
      const res = await getOne(uid, ID.propFinRefById).expect(200);
      expect(res.body.executionResult).toEqual({
        recommendationId: ID.recFin,
        signalId: ID.sigFin,
        synced: true,
      });
    }
  });

  it('PRS-03 (RED-BEFORE): owner-run CRM proposal withholds executionResult from a crm:none reader (even with revenue:read), while owner and crm:read read it whole', async () => {
    const crmNoneList = await getList(ID.staffCrmNone).expect(200);
    const listed = crmNoneList.body.find((p: any) => p.id === ID.propCrmExec);
    expect(listed).toBeDefined();
    expect(listed.executionResult).toBeNull();
    expect(JSON.stringify(listed)).not.toContain('Kerry VIP');
    expect(JSON.stringify(listed)).not.toContain('+18685550199');

    const crmNoneGet = await getOne(ID.staffCrmNone, ID.propCrmExec).expect(200);
    expect(crmNoneGet.body.executionResult).toBeNull();
    expect(JSON.stringify(crmNoneGet.body)).not.toContain('Kerry VIP');

    // Controls: owner and crm:read member (even revenue:none) read executionResult whole.
    for (const uid of [ID.owner, ID.staffRevNone]) {
      const res = await getOne(uid, ID.propCrmExec).expect(200);
      expect(res.body.executionResult).toEqual({ contactName: 'Kerry VIP', phone: '+18685550199' });
    }
  });

  it('PRS-04 (RED-BEFORE): owner-run key_genome.list_signals proposal (settings:read tool) withholds executionResult from a settings:none reader (even with revenue:read), while owner and settings:read read it whole', async () => {
    const noSettingsList = await getList(ID.staffCrmNone).expect(200);
    const listed = noSettingsList.body.find((p: any) => p.id === ID.propSettingsGenome);
    expect(listed).toBeDefined();
    expect(listed.executionResult).toBeNull();
    expect(JSON.stringify(listed)).not.toContain('Delivery lead time');

    const noSettingsGet = await getOne(ID.staffCrmNone, ID.propSettingsGenome).expect(200);
    expect(noSettingsGet.body.executionResult).toBeNull();

    // Controls: owner and settings:read member read executionResult whole.
    for (const uid of [ID.owner, ID.staffRevNone]) {
      const res = await getOne(uid, ID.propSettingsGenome).expect(200);
      expect(res.body.executionResult?.signals?.map((s: any) => s.id)).toEqual([ID.sigOps]);
    }
  });

  it("PRS-05 (RED-BEFORE): unclassified-module proposal's executionResult is readable by the run's member (executedBy) and the owner, and withheld from other staff", async () => {
    // Run's member reads it whole.
    const selfGet = await getOne(ID.staffRevNone, ID.propSelfRun).expect(200);
    expect(selfGet.body.executionResult).toEqual({ checklist: ['confirm-handoff', 'verify-notes'] });

    // Owner reads it whole.
    const ownerGet = await getOne(ID.owner, ID.propSelfRun).expect(200);
    expect(ownerGet.body.executionResult).toEqual({ checklist: ['confirm-handoff', 'verify-notes'] });

    // Another staff member (neither executedBy nor owner) gets executionResult withheld.
    const otherGet = await getOne(ID.staffOther, ID.propSelfRun).expect(200);
    expect(otherGet.body.executionResult).toBeNull();
    expect(JSON.stringify(otherGet.body)).not.toContain('confirm-handoff');
  });

  it('PRS-06 (RED-BEFORE): viewForReader applies the same executionResult projection after actions', async () => {
    const crmProp = await proposals.get(ID.biz, ID.propCrmExec);
    const crmForBlind = await proposals.viewForReader(ID.biz, crmProp, { id: ID.staffCrmNone, role: 'USER' });
    expect((crmForBlind as any).executionResult).toBeNull();

    const crmForReader = await proposals.viewForReader(ID.biz, crmProp, { id: ID.staffRevNone, role: 'USER' });
    expect((crmForReader as any).executionResult).toEqual({ contactName: 'Kerry VIP', phone: '+18685550199' });

    const finProp = await proposals.get(ID.biz, ID.propFinGenome);
    const finForRevNone = await proposals.viewForReader(ID.biz, finProp, { id: ID.staffRevNone, role: 'USER' });
    expect((finForRevNone as any).executionResult).toBeUndefined();
    expect(JSON.stringify(finForRevNone)).not.toContain('Runway is 0.8');

    const finForOwner = await proposals.viewForReader(ID.biz, finProp, { id: ID.owner, role: 'USER' });
    expect((finForOwner as any).executionResult?.recommendations?.[0]?.id).toBe(ID.recFin);
  });
});
