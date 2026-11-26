/**
 * V1-88 / P131 (FU-PROPOSAL-MONEY-TAG; owner rulings D-238, D-227):
 * KEY proposal writers structurally tag `carriesMoney: boolean` at creation
 * from tool authority, input schema, writer provenance, and structured payload
 * fields — so proposal visibility stops depending on free-text heuristics alone.
 *
 * Contract proved here against real Postgres + real NestJS HTTP pipeline:
 *   1. Known-limitation money cases (deeply nested money payload, amount
 *      written in words, figure >3 words from money word, Unicode lookalikes,
 *      combining marks / NFD, HTML entities, separate currency field,
 *      `balance_900` under an id-named key, spaced 9+ word key, financial tool
 *      with crafted benign/decommission title, financial genome recommendation
 *      provenance) created through real writers are stamped `carriesMoney = true`
 *      and WITHHELD from a revenue-none reader (omitted from list, 404 on get,
 *      redacted on viewForReader), while visible to owner / revenue-read.
 *   2. Known over-hiding non-financial cases ("Spent 3 hours on outreach",
 *      "Meeting with Bill at 10am", `\trent` path segment, count keys ending in
 *      a digit, nested count keys, >50,000-char non-financial payload, and
 *      non-financial HUMAN_WORKFLOW approval) created through real writers are
 *      stamped `carriesMoney = false` and VISIBLE to a non-revenue reader with
 *      module read.
 *   3. Untagged legacy rows (`carriesMoney = null`) fail closed via the
 *      existing text/provenance heuristic backstop.
 *   4. Anti-spoofing & monotonicity: untrusted HTTP/payload `carriesMoney: false`
 *      cannot downgrade a financial proposal or financial tool.
 *   5. Cross-tenant isolation holds across businesses.
 *
 * Fixtures: prefix `v88p_` (registered in test/helpers/fixture-prefixes.json);
 * hard-deleted by raw SQL using `sqlLikePrefix(P)` in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v88p_';
const HEADER = 'x-test-user';

const ID = {
  ownerA: `${P}owner_a`,
  revReadA: `${P}rev_read_a`,
  revNoneA: `${P}rev_none_a`,
  ownerB: `${P}owner_b`,
  bizA: `${P}biz_a`,
  bizB: `${P}biz_b`,
  recFinA: `${P}rec_fin_a`,
  recOpsA: `${P}rec_ops_a`,
  legacyFin: `${P}legacy_fin`,
  legacyUnclassified: `${P}legacy_unclass`,
  legacyNonFin: `${P}legacy_nonfin`,
};

let db: any;
let app: any;
let proposals: any;
let orchestrator: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM key_action_proposals WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM genome_recommendations WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
  const { KeyCortexAuditService } = await import('../src/modules/key-cortex/key-cortex-audit.service');

  const moduleRef = await Test.createTestingModule({
    imports: [EventEmitterModule.forRoot()],
    controllers: [KeyActionProposalController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      KeyActionPolicyService,
      KeyActionProposalService,
      KeyCortexApprovalOrchestratorService,
      { provide: TemporalFlowService, useValue: { emit: async () => null } },
      { provide: KeyActionExecutorService, useValue: {} },
      { provide: KeyActionGenomePolicyService, useValue: {} },
      { provide: AutonomyOrchestratorService, useValue: {} },
      { provide: KeyActionBoundaryService, useValue: { governs: () => false, sealProposal: () => null } },
      { provide: KeyCortexAuditService, useValue: { emit: async () => null } },
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
  orchestrator = app.get(KeyCortexApprovalOrchestratorService);

  await cleanup();

  for (const [id, email] of [
    [ID.ownerA, `${P}owner_a@test.local`],
    [ID.revReadA, `${P}rev_read_a@test.local`],
    [ID.revNoneA, `${P}rev_none_a@test.local`],
    [ID.ownerB, `${P}owner_b@test.local`],
  ]) {
    await db.user.create({ data: { id, email, role: 'USER' } });
  }

  await db.business.createMany({
    data: [
      { id: ID.bizA, name: 'V88P Business A', ownerId: ID.ownerA, currency: 'TTD' },
      { id: ID.bizB, name: 'V88P Business B', ownerId: ID.ownerB, currency: 'USD' },
    ],
  });

  await db.membership.createMany({
    data: [
      { id: `${ID.ownerA}_m`, userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
      {
        id: `${ID.revReadA}_m`,
        userId: ID.revReadA,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: {
          revenue: 'read',
          crm: 'read',
          bookings: 'read',
          projects: 'read',
          operations: 'write',
          settings: 'read',
        },
      },
      {
        id: `${ID.revNoneA}_m`,
        userId: ID.revNoneA,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: {
          revenue: 'none',
          crm: 'read',
          bookings: 'read',
          projects: 'read',
          operations: 'write',
          settings: 'read',
        },
      },
      { id: `${ID.ownerB}_m`, userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
    ],
  });

  await db.genomeRecommendation.createMany({
    data: [
      {
        id: ID.recFinA,
        businessId: ID.bizA,
        domain: 'FINANCIAL',
        title: 'Tighten receivable terms',
        insight: 'Cash conversion cycle lengthened',
        diagnosis: 'Receivables aging rose',
        recommendation: 'Require upfront settlement',
        status: 'NEW',
      },
      {
        id: ID.recOpsA,
        businessId: ID.bizA,
        domain: 'OPERATIONS',
        title: 'Document onboarding checklist',
        insight: 'Handover steps vary per team member',
        diagnosis: 'Missing runbook',
        recommendation: 'Publish shared SOP',
        status: 'NEW',
      },
    ],
  });

  // Seed legacy pre-migration rows directly (leaving carries_money NULL when column exists)
  await db.keyActionProposal.createMany({
    data: [
      {
        id: ID.legacyFin,
        businessId: ID.bizA,
        sourceType: 'MANUAL',
        actionType: 'CREATE_TASK',
        module: 'crm',
        title: 'Legacy: chase the $4,000 invoice',
        status: 'PENDING',
        riskLevel: 'LOW',
        requiresApproval: true,
        payload: {},
      },
      {
        id: ID.legacyUnclassified,
        businessId: ID.bizA,
        sourceType: 'MANUAL',
        actionType: 'EXECUTE_TOOL',
        module: null,
        toolName: null,
        title: 'Legacy unclassified execution',
        status: 'PENDING',
        riskLevel: 'MEDIUM',
        requiresApproval: true,
        payload: {},
      },
      {
        id: ID.legacyNonFin,
        businessId: ID.bizA,
        sourceType: 'MANUAL',
        actionType: 'CREATE_TASK',
        module: 'crm',
        title: 'Legacy: call Kerry back Tuesday',
        status: 'PENDING',
        riskLevel: 'LOW',
        requiresApproval: true,
        payload: {},
      },
    ],
  });
}, 30_000);

afterAll(async () => {
  await cleanup();
  if (app) await app.close();
}, 30_000);

const listProposals = (bizId: string, userId: string) =>
  request(app.getHttpServer())
    .get(`/key-autonomy/businesses/${bizId}/actions/proposals`)
    .set(HEADER, userId);

const getProposal = (bizId: string, proposalId: string, userId: string) =>
  request(app.getHttpServer())
    .get(`/key-autonomy/businesses/${bizId}/actions/proposals/${proposalId}`)
    .set(HEADER, userId);

describe('FU-PROPOSAL-MONEY-TAG (V1-88, D-238, D-227)', () => {
  describe('1. Known-limitation money cases are structurally tagged carriesMoney=true and WITHHELD from revenue-none readers', () => {
    const moneyCases: Array<[string, () => Promise<any>]> = [
      [
        'deeply nested money payload (2+ levels deep, after first sibling field)',
        () =>
          proposals.create(ID.bizA, {
            sourceType: 'KEY_CORTEX',
            actionType: 'CREATE_TASK',
            module: 'crm',
            title: 'Follow up with client',
            payload: { total: { note: 'standard follow-up', nested: { val: 900 } } },
          }),
      ],
      [
        'amount written in words ("Total due is five hundred")',
        () =>
          proposals.create(ID.bizA, {
            sourceType: 'KEY_CORTEX',
            actionType: 'CREATE_TASK',
            module: 'crm',
            title: 'Total due is five hundred',
            summary: 'Confirm settlement by Friday',
          }),
      ],
      [
        'figure more than three words from a money word',
        () =>
          proposals.create(ID.bizA, {
            sourceType: 'KEY_CORTEX',
            actionType: 'CREATE_TASK',
            module: 'crm',
            title: 'The total for the spring event next Friday is 900',
          }),
      ],
      [
        'Unicode Cyrillic lookalike letters in money word',
        () =>
          proposals.create(ID.bizA, {
            sourceType: 'KEY_CORTEX',
            actionType: 'CREATE_TASK',
            module: 'crm',
            title: 'Follow up on \u0456nv\u043e\u0456ce 900',
          }),
      ],
      [
        'combining diacritical marks (NFD) splitting a money word',
        () =>
          proposals.create(ID.bizA, {
            sourceType: 'KEY_CORTEX',
            actionType: 'CREATE_TASK',
            module: 'crm',
            title: 'Check i\u0301nvoice 900 status',
          }),
      ],
      [
        'HTML numeric currency entity (&#36;500)',
        () =>
          proposals.create(ID.bizA, {
            sourceType: 'KEY_CORTEX',
            actionType: 'CREATE_TASK',
            module: 'crm',
            title: 'Collect &#36;500 from client',
          }),
      ],
      [
        'separate currency field beside plain value key',
        () =>
          proposals.create(ID.bizA, {
            sourceType: 'KEY_CORTEX',
            actionType: 'CREATE_TASK',
            module: 'crm',
            title: 'Confirm delivery details',
            payload: { currency: 'TTD', value: 500 },
          }),
      ],
      [
        'worded money token with digits under an id-named key (balance_900)',
        () =>
          proposals.create(ID.bizA, {
            sourceType: 'KEY_CORTEX',
            actionType: 'CREATE_TASK',
            module: 'crm',
            title: 'Check account reference',
            payload: { refId: 'balance_900' },
          }),
      ],
      [
        'spaced key of 9+ words carrying a figure',
        () =>
          proposals.create(ID.bizA, {
            sourceType: 'KEY_CORTEX',
            actionType: 'CREATE_TASK',
            module: 'crm',
            title: 'Client summary',
            payload: { 'total due for the main client for the spring event': 900 },
          }),
      ],
      [
        'financial tool (commerce_create_invoice) with crafted decommission wording via orchestrator',
        () =>
          orchestrator.propose({
            businessId: ID.bizA,
            userId: ID.ownerA,
            sourceType: 'KEY_CORTEX',
            actionType: 'EXECUTE_TOOL',
            module: 'commerce',
            toolName: 'commerce_create_invoice',
            title: 'Decommission the old tablet',
            parameters: { contactId: 'cnt_1' },
          }),
      ],
      [
        'non-revenue-module tool whose schema carries money (deals_create) with benign wording',
        () =>
          orchestrator.propose({
            businessId: ID.bizA,
            userId: ID.ownerA,
            sourceType: 'KEY_CORTEX',
            actionType: 'EXECUTE_TOOL',
            module: 'crm',
            toolName: 'deals_create',
            title: 'New onboarding opportunity',
            parameters: { contactId: 'cnt_1', title: 'Spring engagement' },
          }),
      ],
      [
        'genome-bridged proposal from a FINANCIAL recommendation with neutral title',
        () =>
          proposals.create(ID.bizA, {
            sourceType: 'GENOME_EVOLUTION',
            sourceId: ID.recFinA,
            actionType: 'CREATE_TASK',
            module: 'operations',
            title: 'Follow up with team',
            payload: { recommendationId: ID.recFinA },
          }),
      ],
    ];

    it.each(moneyCases)(
      '%s -> carriesMoney=true, withheld from revenue-none reader, visible to owner & revenue-read',
      async (_label, createFn) => {
        const created = await createFn();

        const [resNoneGet, resNoneList, resOwnerGet, resRevReadGet] = await Promise.all([
          getProposal(ID.bizA, created.id, ID.revNoneA),
          listProposals(ID.bizA, ID.revNoneA),
          getProposal(ID.bizA, created.id, ID.ownerA),
          getProposal(ID.bizA, created.id, ID.revReadA),
        ]);

        expect(resNoneGet.status).toBe(404);
        expect(resNoneList.status).toBe(200);
        expect((resNoneList.body as any[]).some((p) => p.id === created.id)).toBe(false);

        expect(created.carriesMoney).toBe(true);
        expect(resOwnerGet.status).toBe(200);
        expect(resOwnerGet.body.carriesMoney).toBe(true);
        expect(resRevReadGet.status).toBe(200);
        expect(resRevReadGet.body.carriesMoney).toBe(true);

        const redacted = await proposals.viewForReader(ID.bizA, created, { id: ID.revNoneA, role: 'USER' });
        expect(redacted).toEqual({ id: created.id, status: created.status });
      },
    );
  });

  describe('2. Known over-hiding non-financial cases are structurally tagged carriesMoney=false and VISIBLE to non-revenue readers', () => {
    const nonMoneyCases: Array<[string, () => Promise<any>]> = [
      [
        '"Spent 3 hours on outreach" on CRM CREATE_TASK',
        () =>
          proposals.create(ID.bizA, {
            sourceType: 'KEY_CORTEX',
            actionType: 'CREATE_TASK',
            module: 'crm',
            title: 'Spent 3 hours on outreach',
          }),
      ],
      [
        '"Meeting with Bill at 10am" on calendar_create_event',
        () =>
          orchestrator.propose({
            businessId: ID.bizA,
            userId: ID.ownerA,
            sourceType: 'KEY_CORTEX',
            actionType: 'EXECUTE_TOOL',
            module: 'bookings',
            toolName: 'calendar_create_event',
            title: 'Meeting with Bill at 10am',
            parameters: { title: 'Meeting with Bill at 10am', startAt: '2026-12-01T10:00:00Z' },
          }),
      ],
      [
        'Windows path segment containing \\trent',
        () =>
          proposals.create(ID.bizA, {
            sourceType: 'KEY_CORTEX',
            actionType: 'CREATE_TASK',
            module: 'crm',
            title: 'Review onboarding notes',
            summary: 'See C:\\trent\\notes.txt for the schedule',
          }),
      ],
      [
        'count keys ending in a digit (totalCount2, total_items_2)',
        () =>
          proposals.create(ID.bizA, {
            sourceType: 'KEY_CORTEX',
            actionType: 'CREATE_TASK',
            module: 'crm',
            title: 'Sync contact list',
            payload: { totalCount2: 5, total_items_2: 12 },
          }),
      ],
      [
        'nested count keys (stats.total.count)',
        () =>
          proposals.create(ID.bizA, {
            sourceType: 'KEY_CORTEX',
            actionType: 'CREATE_TASK',
            module: 'crm',
            title: 'Check sync stats',
            payload: { stats: { total: { count: 12, items: 5 } } },
          }),
      ],
      [
        'non-financial payload over 50,000 characters',
        () =>
          orchestrator.propose({
            businessId: ID.bizA,
            userId: ID.ownerA,
            sourceType: 'KEY_CORTEX',
            actionType: 'EXECUTE_TOOL',
            module: 'crm',
            toolName: 'crm_add_task',
            title: 'Long plain onboarding brief',
            summary: 'Follow up with the design team about the layout. '.repeat(1150),
            parameters: {
              contactId: 'cnt_plain_1',
              title: 'Long plain onboarding brief',
              notes: 'Coordinate launch checklist items with ops team. '.repeat(700),
            },
          }),
      ],
      [
        'non-financial HUMAN_WORKFLOW approval (task_completion) with "Spent 3 hours"',
        () =>
          orchestrator.propose({
            businessId: ID.bizA,
            userId: ID.ownerA,
            sourceType: 'HUMAN_WORKFLOW',
            actionType: 'REQUEST_APPROVAL',
            title: 'Spent 3 hours completing sprint tasks',
            affectedEntities: { requestType: 'task_completion', steps: [] },
          }),
      ],
    ];

    it.each(nonMoneyCases)(
      '%s -> carriesMoney=false and VISIBLE to revenue-none reader with module read',
      async (_label, createFn) => {
        const created = await createFn();

        const [resNoneGet, resNoneList] = await Promise.all([
          getProposal(ID.bizA, created.id, ID.revNoneA),
          listProposals(ID.bizA, ID.revNoneA),
        ]);

        expect(resNoneGet.status).toBe(200);
        expect(resNoneGet.body.id).toBe(created.id);
        expect(created.carriesMoney).toBe(false);
        expect(resNoneGet.body.carriesMoney).toBe(false);
        expect(resNoneList.status).toBe(200);
        expect((resNoneList.body as any[]).some((p) => p.id === created.id)).toBe(true);
      },
    );
  });

  describe('3. Untagged legacy rows (carriesMoney = null) fail closed via the text/provenance backstop', () => {
    it('withholds untagged financial and unclassified legacy rows while keeping clearly non-financial legacy rows visible', async () => {
      const [finRow, unclassRow, nonFinRow] = await Promise.all([
        proposals.get(ID.bizA, ID.legacyFin),
        proposals.get(ID.bizA, ID.legacyUnclassified),
        proposals.get(ID.bizA, ID.legacyNonFin),
      ]);
      expect(finRow.carriesMoney ?? null).toBeNull();
      expect(unclassRow.carriesMoney ?? null).toBeNull();
      expect(nonFinRow.carriesMoney ?? null).toBeNull();

      const [resFin, resUnclass, resNonFin, resList] = await Promise.all([
        getProposal(ID.bizA, ID.legacyFin, ID.revNoneA),
        getProposal(ID.bizA, ID.legacyUnclassified, ID.revNoneA),
        getProposal(ID.bizA, ID.legacyNonFin, ID.revNoneA),
        listProposals(ID.bizA, ID.revNoneA),
      ]);

      expect(resFin.status).toBe(404);
      expect(resUnclass.status).toBe(404);
      expect(resNonFin.status).toBe(200);
      expect(resList.status).toBe(200);
      const ids = new Set((resList.body as any[]).map((p) => p.id));
      expect(ids.has(ID.legacyFin)).toBe(false);
      expect(ids.has(ID.legacyUnclassified)).toBe(false);
      expect(ids.has(ID.legacyNonFin)).toBe(true);
    });
  });

  describe('4. Anti-spoofing and monotonicity', () => {
    it('untrusted HTTP POST cannot spoof carriesMoney=false via body or payload JSON', async () => {
      const postRes = await request(app.getHttpServer())
        .post(`/key-autonomy/businesses/${ID.bizA}/actions/proposals`)
        .set(HEADER, ID.revNoneA)
        .send({
          sourceType: 'MANUAL',
          actionType: 'CREATE_TASK',
          title: 'Follow up with client',
          carriesMoney: false,
          payload: { carriesMoney: false, currency: 'TTD', value: 500 },
        });
      expect(postRes.status).toBe(201);
      expect(postRes.body.carriesMoney).toBe(true);

      const resNoneGet = await getProposal(ID.bizA, postRes.body.id, ID.revNoneA);
      expect(resNoneGet.status).toBe(404);

      const resOwnerGet = await getProposal(ID.bizA, postRes.body.id, ID.ownerA);
      expect(resOwnerGet.status).toBe(200);
      expect(resOwnerGet.body.carriesMoney).toBe(true);
    });

    it('a financial tool cannot be downgraded to carriesMoney=false even if a caller passes carriesMoney=false', async () => {
      const created = await proposals.create(ID.bizA, {
        sourceType: 'KEY_CORTEX',
        actionType: 'EXECUTE_TOOL',
        module: 'commerce',
        toolName: 'commerce_create_invoice',
        title: 'Create customer record',
        carriesMoney: false,
      });
      expect(created.carriesMoney).toBe(true);
      const resNoneGet = await getProposal(ID.bizA, created.id, ID.revNoneA);
      expect(resNoneGet.status).toBe(404);
    });
  });

  describe('5. Cross-tenant isolation', () => {
    it('proposals in business B are never visible to business A users', async () => {
      const propB = await proposals.create(ID.bizB, {
        sourceType: 'KEY_CORTEX',
        actionType: 'CREATE_TASK',
        module: 'crm',
        title: 'Spent 3 hours on tenant B task',
      });
      expect(propB.carriesMoney).toBe(false);

      const [crossGet, crossList, ownListA] = await Promise.all([
        getProposal(ID.bizB, propB.id, ID.ownerA),
        listProposals(ID.bizB, ID.ownerA),
        listProposals(ID.bizA, ID.ownerA),
      ]);

      expect([403, 404]).toContain(crossGet.status);
      expect([403, 404]).toContain(crossList.status);
      expect(ownListA.status).toBe(200);
      expect((ownListA.body as any[]).some((p) => p.id === propB.id)).toBe(false);
    });
  });
});
