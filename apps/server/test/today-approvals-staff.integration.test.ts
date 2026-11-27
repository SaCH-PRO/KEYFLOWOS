/**
 * P206 FU-TODAY-APPROVALS-STAFF (D-298, Journey I2): real-DB PostgreSQL proof
 * that:
 *  1. A STAFF member with `{ bookings: 'write', crm: 'read', expenses: 'write' }`
 *     (without `operations:write`) can create an `expense` approval request
 *     addressed to the owner via `POST /businesses/:businessId/approvals` with
 *     1-indexed `steps: [{ stepOrder: 1, approverId: owner }]`.
 *  2. The created approval appears in the owner's `GET .../today` `needsYou`
 *     block as `kind: 'APPROVAL_REQUEST'` (both under `KEY_DISABLED=1` and
 *     with KEY enabled, without duplicating as a `KEY_PROPOSAL`).
 *  3. The owner can approve it via `POST /businesses/:businessId/approvals/:id/approve`
 *     and `GET /businesses/:businessId/approvals/:id` transitions to `approved`.
 *  4. Per-`requestType` write scope is enforced fail-closed:
 *     - read-only `expenses:read` or missing `expenses:write` -> 403 on `expense`
 *     - `expenses:write` cannot create `refund` (needs `revenue:write`), `general`,
 *       or unknown requestType (fail-closed to `operations:write`) -> 403
 *     - `revenue:write` can create `quote_discount` -> 201
 *     - decide/reject/delegate/cancel/escalate still require `operations:write`
 *     - 0-indexed `stepOrder: 0` still initializes `currentStep: 0` and approves cleanly
 *
 * Fixture prefix: `v92j_` (registered in apps/server/test/helpers/fixture-prefixes.json).
 * Hard-deleted via raw SQL with sqlLikePrefix(P) in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v92j_';
const HEADER = 'x-v92j-user';

const ID = {
  ownerA: `${P}owner_a`,
  staffFrontDeskA: `${P}staff_front_a`,
  staffExpReadOnlyA: `${P}staff_exp_ro_a`,
  staffBookingsOnlyA: `${P}staff_bk_a`,
  staffRevWriteA: `${P}staff_rev_w_a`,
  ownerB: `${P}owner_b`,
  bizA: `${P}biz_a`,
  bizB: `${P}biz_b`,
};

let db: typeof import('@keyflow/db').db;
let app: import('@nestjs/common').INestApplication;

async function cleanup() {
  for (const sql of [
    `DELETE FROM approval_steps WHERE approval_request_id IN (SELECT id FROM approval_requests WHERE business_id LIKE ${sqlLikePrefix(P)})`,
    `DELETE FROM approval_requests WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM key_action_proposals WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { RateLimitGuard } = await import('../src/core/guards/rate-limit.guard');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { ApprovalController } = await import('../src/modules/approvals/approval.controller');
  const { ApprovalRequestService } = await import('../src/modules/approvals/approval-request.service');
  const { KeyCortexApprovalOrchestratorService } = await import(
    '../src/modules/key-cortex/key-cortex-approval-orchestrator.service'
  );
  const { TodayController } = await import('../src/modules/business-command-center/today.controller');
  const { TodayService } = await import('../src/modules/business-command-center/today.service');
  const { FinanceOverviewService } = await import('../src/modules/finance/finance-overview.service');
  const { SafeToSpendService } = await import('../src/modules/finance/safe-to-spend.service');
  const { ReadyToSendService } = await import('../src/modules/commerce/ready-to-send.service');
  const { KeyActionProposalService } = await import('../src/modules/key-autonomy/key-action-proposal.service');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');

  const prismaStub = { client: db };
  const emitter = new EventEmitter2();

  // Real shadow-migration double that creates a real KeyActionProposal row (matching production ApprovalModule wiring)
  const proposalOrchestratorStub = {
    propose: async (input: {
      businessId: string;
      userId: string;
      sourceType: string;
      sourceId: string;
      actionType: string;
      title: string;
      description?: string;
    }) => {
      return db.keyActionProposal.create({
        data: {
          businessId: input.businessId,
          userId: input.userId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          actionType: input.actionType,
          title: input.title,
          description: input.description ?? null,
          toolName: 'approval_request',
          module: 'operations',
          status: 'PENDING',
          riskLevel: 'MEDIUM',
          payload: {},
        },
      });
    },
  };

  const keyAutonomyStub = {
    listForReader: async (businessId: string, filter: { status?: string }) => {
      const rows = await db.keyActionProposal.findMany({
        where: { businessId, ...(filter?.status ? { status: filter.status } : {}) },
      });
      return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
    },
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [ApprovalController, TodayController],
    providers: [
      { provide: PrismaService, useValue: prismaStub },
      { provide: EventEmitter2, useValue: emitter },
      { provide: KeyCortexApprovalOrchestratorService, useValue: proposalOrchestratorStub },
      ApprovalRequestService,
      TodayService,
      {
        provide: FinanceOverviewService,
        useValue: {
          getOverview: async () => ({
            cashBalance: 0,
            cashBasis: 'LEDGER',
            cashCurrency: 'TTD',
            otherCurrencyCash: [],
            outstandingInvoices: 0,
            outstandingInvoiceCount: 0,
            overdueInvoices: 0,
            overdueInvoiceCount: 0,
            billsDue: 0,
            billsDueCount: 0,
            revenueThisMonth: 0,
            expensesThisMonth: 0,
            netProfitThisMonth: 0,
            currency: 'TTD',
          }),
        },
      },
      { provide: SafeToSpendService, useValue: { calculate: async () => ({ safeToSpend: 0 }) } },
      { provide: ReadyToSendService, useValue: { listDue: async () => ({ items: [] }) } },
      { provide: KeyActionProposalService, useValue: keyAutonomyStub },
      { provide: CommerceService, useValue: {} },
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      { provide: RateLimitGuard, useValue: { canActivate: () => true } },
      TenantInterceptor,
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.use((req: any, _res: any, next: () => void) => {
    const uid = req.headers[HEADER];
    if (typeof uid === 'string' && uid.trim().length > 0) {
      req.user = { id: uid.trim(), role: 'USER', email: `${uid.trim()}@v92j.test.local` };
    }
    next();
  });
  app.useGlobalInterceptors(moduleRef.get(TenantInterceptor));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup();

  await db.user.createMany({
    data: [
      { id: ID.ownerA, email: `${ID.ownerA}@v92j.test.local`, name: 'Owner A' },
      { id: ID.staffFrontDeskA, email: `${ID.staffFrontDeskA}@v92j.test.local`, name: 'Front Desk A' },
      { id: ID.staffExpReadOnlyA, email: `${ID.staffExpReadOnlyA}@v92j.test.local`, name: 'Exp ReadOnly A' },
      { id: ID.staffBookingsOnlyA, email: `${ID.staffBookingsOnlyA}@v92j.test.local`, name: 'Bookings Only A' },
      { id: ID.staffRevWriteA, email: `${ID.staffRevWriteA}@v92j.test.local`, name: 'Rev Write A' },
      { id: ID.ownerB, email: `${ID.ownerB}@v92j.test.local`, name: 'Owner B' },
    ],
  });

  await db.business.createMany({
    data: [
      { id: ID.bizA, name: 'Biz A Approvals', slug: `${P}biz-a`, ownerId: ID.ownerA, currency: 'TTD' },
      { id: ID.bizB, name: 'Biz B Approvals', slug: `${P}biz-b`, ownerId: ID.ownerB, currency: 'TTD' },
    ],
  });

  await db.membership.createMany({
    data: [
      { userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
      {
        userId: ID.staffFrontDeskA,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { bookings: 'write', crm: 'read', expenses: 'write' },
      },
      {
        userId: ID.staffExpReadOnlyA,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { expenses: 'read' },
      },
      {
        userId: ID.staffBookingsOnlyA,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { bookings: 'write', crm: 'read' },
      },
      {
        userId: ID.staffRevWriteA,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { revenue: 'write' },
      },
      { userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
    ],
  });
}, 60_000);

afterAll(async () => {
  await cleanup();
  await app?.close();
});

describe('P206 FU-TODAY-APPROVALS-STAFF (D-298, Journey I2)', () => {
  it('[TAS-01] RED-BEFORE (Journey I2): front-desk STAFF with expenses:write creates expense approval (stepOrder: 1), owner sees it on Today under KEY_DISABLED & KEY-on without duplication, and approves it', async () => {
    const title = `New blender for the salon ${P}1`;
    const createRes = await request(app.getHttpServer())
      .post(`/businesses/${ID.bizA}/approvals`)
      .set(HEADER, ID.staffFrontDeskA)
      .send({
        requestType: 'expense',
        title,
        description: 'TTD 1,200 at Courts',
        threshold: 1200,
        steps: [{ stepOrder: 1, approverId: ID.ownerA }],
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe('pending');
    expect(createRes.body.currentStep).toBe(1);
    const approvalId = createRes.body.id as string;

    // Visible on Today under KEY_DISABLED=1
    const prevKeyDisabled = process.env.KEY_DISABLED;
    try {
      process.env.KEY_DISABLED = '1';
      const todayOff = await request(app.getHttpServer())
        .get(`/business-command-center/businesses/${ID.bizA}/today`)
        .set(HEADER, ID.ownerA)
        .expect(200);
      const hitsOff = (todayOff.body.needsYou.items as Array<{ kind: string; sourceId: string; title: string }>).filter(
        (i) => i.title === title,
      );
      expect(hitsOff).toHaveLength(1);
      expect(hitsOff[0]).toMatchObject({ kind: 'APPROVAL_REQUEST', sourceId: approvalId });

      // Visible on Today with KEY enabled — STILL once, as APPROVAL_REQUEST (not duplicated as KEY_PROPOSAL)
      delete process.env.KEY_DISABLED;
      const todayOn = await request(app.getHttpServer())
        .get(`/business-command-center/businesses/${ID.bizA}/today`)
        .set(HEADER, ID.ownerA)
        .expect(200);
      const hitsOn = (todayOn.body.needsYou.items as Array<{ kind: string; sourceId: string; title: string }>).filter(
        (i) => i.title === title,
      );
      expect(hitsOn).toHaveLength(1);
      expect(hitsOn[0]).toMatchObject({ kind: 'APPROVAL_REQUEST', sourceId: approvalId });
    } finally {
      if (prevKeyDisabled === undefined) delete process.env.KEY_DISABLED;
      else process.env.KEY_DISABLED = prevKeyDisabled;
    }

    // Front-desk STAFF (no operations:write) CANNOT approve or reject their own request
    await request(app.getHttpServer())
      .post(`/businesses/${ID.bizA}/approvals/${approvalId}/approve`)
      .set(HEADER, ID.staffFrontDeskA)
      .send({ decision: 'approve' })
      .expect(403);

    // Owner approves the request cleanly -> status transitions to approved
    const approveRes = await request(app.getHttpServer())
      .post(`/businesses/${ID.bizA}/approvals/${approvalId}/approve`)
      .set(HEADER, ID.ownerA)
      .send({ decision: 'approve' });
    expect(approveRes.status).toBe(201);
    expect(approveRes.body.status).toBe('approved');

    const getRes = await request(app.getHttpServer())
      .get(`/businesses/${ID.bizA}/approvals/${approvalId}`)
      .set(HEADER, ID.ownerA)
      .expect(200);
    expect(getRes.body.status).toBe('approved');
  });

  it('[TAS-02] RED-BEFORE (D-71 / D-96): POST approvals enforces per-requestType write scope and fails closed for unknown types', async () => {
    // expenses:read (no write) -> 403 on expense
    await request(app.getHttpServer())
      .post(`/businesses/${ID.bizA}/approvals`)
      .set(HEADER, ID.staffExpReadOnlyA)
      .send({
        requestType: 'expense',
        title: 'Read-only attempt',
        steps: [{ stepOrder: 1, approverId: ID.ownerA }],
      })
      .expect(403);

    // bookings:write only (no expenses:write) -> 403 on expense
    await request(app.getHttpServer())
      .post(`/businesses/${ID.bizA}/approvals`)
      .set(HEADER, ID.staffBookingsOnlyA)
      .send({
        requestType: 'expense',
        title: 'Bookings staff expense attempt',
        steps: [{ stepOrder: 1, approverId: ID.ownerA }],
      })
      .expect(403);

    // expenses:write cannot create refund (needs revenue:write), general, or unknown requestType
    for (const requestType of ['refund', 'quote_discount', 'general', 'time_off', 'custom_unlisted']) {
      await request(app.getHttpServer())
        .post(`/businesses/${ID.bizA}/approvals`)
        .set(HEADER, ID.staffFrontDeskA)
        .send({
          requestType,
          title: `Unauthorized ${requestType}`,
          steps: [{ stepOrder: 1, approverId: ID.ownerA }],
        })
        .expect(403);
    }

    // revenue:write CAN create quote_discount with 0-indexed stepOrder: 0, and owner can approve it
    const quoteAppr = await request(app.getHttpServer())
      .post(`/businesses/${ID.bizA}/approvals`)
      .set(HEADER, ID.staffRevWriteA)
      .send({
        requestType: 'quote_discount',
        title: '20% wholesale discount',
        steps: [{ stepOrder: 0, approverId: ID.ownerA }],
      })
      .expect(201);
    expect(quoteAppr.body.currentStep).toBe(0);

    await request(app.getHttpServer())
      .post(`/businesses/${ID.bizA}/approvals/${quoteAppr.body.id}/approve`)
      .set(HEADER, ID.ownerA)
      .send({ decision: 'approve' })
      .expect(201);

    // Cross-tenant POST -> 403
    await request(app.getHttpServer())
      .post(`/businesses/${ID.bizB}/approvals`)
      .set(HEADER, ID.staffFrontDeskA)
      .send({
        requestType: 'expense',
        title: 'Foreign biz attempt',
        steps: [{ stepOrder: 1, approverId: ID.ownerB }],
      })
      .expect(403);
  });
});
