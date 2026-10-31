/**
 * KF-REVENUE-AUTH-PROJECTION-001 — L1 mocked-HTTP layer of the negative-control
 * matrix (docs/reconstruction/product/evidence/REVENUE-AUTH-NEGATIVE-CONTROLS-001.md,
 * revision 2, §1 and §5.4).
 *
 * Real CommerceController and PaymentsController, real AuthGuard, BusinessGuard,
 * ModuleScopeGuard and PublicRateLimitGuard with their lookups mocked (an
 * in-memory Prisma stand-in and an in-memory Redis stand-in), and a mocked
 * CommerceService / PaymentsService / receipt builder. This layer proves
 * routing, guard admission, decorator metadata and what the controller forwards
 * to the service. It never proves persistence or disclosure — that is the L2
 * file, test/revenue-authorization.integration.test.ts.
 *
 * Cases are grouped into the matrix's three lists. List A must fail on main
 * b1948d27; List B passes before and after; List C asserts decorator metadata
 * that is absent on main.
 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommerceController } from '../src/modules/commerce/commerce.controller';
import { CommerceService } from '../src/modules/commerce/commerce.service';
import { InvoiceReceiptBuilderService } from '../src/modules/commerce/invoice-receipt-builder.service';
import { GmailService } from '../src/modules/commerce/gmail.service';
import { CommerceVisionService } from '../src/modules/commerce/commerce-vision.service';
import { StoreReadinessService } from '../src/modules/commerce/store-readiness.service';
import { PaymentEvidenceService } from '../src/modules/commerce/payment-evidence.service';
import { TimeEntryService } from '../src/modules/time-tracking/time-entry.service';
import { SubscriptionsService } from '../src/modules/subscriptions/subscriptions.service';
import { PlanLimitGuard } from '../src/modules/subscriptions/plan-limit.guard';
import { PaymentsController } from '../src/modules/payments/payments.controller';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { BusinessGuard } from '../src/core/auth/business.guard';
import { ModuleScopeGuard, MODULE_SCOPE_KEY } from '../src/core/auth/module-scope.guard';
import { PublicRateLimitGuard, PUBLIC_RATE_LIMIT_KEY } from '../src/core/guards/public-rate-limit.guard';
import { REDIS_CLIENT } from '../src/core/redis/redis.constants';
import { TeamAuditInterceptor } from '../src/core/interceptors/team-audit.interceptor';
import { GlobalHttpExceptionFilter } from '../src/core/filters/http-exception.filter';

const P = 'rva_';
const ID = {
  ownerA: `${P}ownerA`,
  staffWriteA: `${P}staffWriteA`,
  staffReadA: `${P}staffReadA`,
  staffNoneA: `${P}staffNoneA`,
  staffDefaultA: `${P}staffDefaultA`,
  noMember: `${P}noMember`,
  ownerB: `${P}ownerB`,
  superAdmin: `${P}superAdmin`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  inv: `${P}invMut_l1`,
};

interface UserSeed { id: string; role: string }
interface MembershipSeed { userId: string; businessId: string; role: string; permissionScopes?: Record<string, string> | null }
interface BusinessSeed { id: string; ownerId: string }

const USERS: Record<string, UserSeed> = {
  [ID.ownerA]: { id: ID.ownerA, role: 'USER' },
  [ID.staffWriteA]: { id: ID.staffWriteA, role: 'USER' },
  [ID.staffReadA]: { id: ID.staffReadA, role: 'USER' },
  [ID.staffNoneA]: { id: ID.staffNoneA, role: 'USER' },
  [ID.staffDefaultA]: { id: ID.staffDefaultA, role: 'USER' },
  [ID.noMember]: { id: ID.noMember, role: 'USER' },
  [ID.ownerB]: { id: ID.ownerB, role: 'USER' },
  [ID.superAdmin]: { id: ID.superAdmin, role: 'SUPER_ADMIN' },
};

/** The two lookups the real guards make, answered from in-memory seeds. */
class GuardPrismaMock {
  memberships: MembershipSeed[] = [
    { userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
    { userId: ID.staffWriteA, businessId: ID.bizA, role: 'STAFF', permissionScopes: { revenue: 'write' } },
    { userId: ID.staffReadA, businessId: ID.bizA, role: 'STAFF', permissionScopes: { revenue: 'read' } },
    { userId: ID.staffNoneA, businessId: ID.bizA, role: 'STAFF', permissionScopes: { revenue: 'none', crm: 'read' } },
    { userId: ID.staffDefaultA, businessId: ID.bizA, role: 'STAFF' },
    { userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
  ];
  businesses: BusinessSeed[] = [
    { id: ID.bizA, ownerId: ID.ownerA },
    { id: ID.bizB, ownerId: ID.ownerB },
  ];
  client: any;

  constructor() {
    const self = this;
    self.client = {
      business: {
        // BusinessGuard: findFirst({ where: { id, OR: [{ ownerId }, { members: { some: { userId } } }] } })
        findFirst: vi.fn(({ where }: any) => {
          const biz = self.businesses.find((b) => b.id === where.id);
          if (!biz) return Promise.resolve(null);
          const userId = where.OR?.[0]?.ownerId ?? where.OR?.[1]?.members?.some?.userId;
          const isOwner = biz.ownerId === userId;
          const isMember = self.memberships.some((m) => m.businessId === biz.id && m.userId === userId);
          return Promise.resolve(isOwner || isMember ? biz : null);
        }),
        findUnique: vi.fn(() => Promise.resolve(null)),
      },
      membership: {
        // ModuleScopeGuard: findUnique({ where: { userId_businessId } })
        findUnique: vi.fn(({ where }: any) => {
          const c = where.userId_businessId;
          if (!c) return Promise.resolve(null);
          const match = self.memberships.find((m) => m.userId === c.userId && m.businessId === c.businessId);
          return Promise.resolve(match ? { ...match, permissionScopes: match.permissionScopes ?? null } : null);
        }),
      },
      invoice: {
        findUnique: vi.fn(() => Promise.resolve({ businessId: ID.bizA })),
      },
    };
  }
}

/** Minimal ioredis stand-in for the sorted-set sliding window the guard uses. */
class RedisMock {
  zsets = new Map<string, Array<{ score: number; member: string }>>();
  pipeline() {
    const ops: Array<() => [null, number]> = [];
    const self = this;
    const chain = {
      zremrangebyscore(key: string, min: number, max: number) {
        ops.push(() => {
          const rows = self.zsets.get(key) ?? [];
          const kept = rows.filter((r) => r.score < min || r.score > max);
          self.zsets.set(key, kept);
          return [null, rows.length - kept.length];
        });
        return chain;
      },
      zcard(key: string) {
        ops.push(() => [null, (self.zsets.get(key) ?? []).length]);
        return chain;
      },
      async exec() {
        return ops.map((f) => f());
      },
    };
    return chain;
  }
  async zadd(key: string, score: number, member: string) {
    const rows = this.zsets.get(key) ?? [];
    rows.push({ score, member });
    this.zsets.set(key, rows);
    return 1;
  }
  async pexpire() {
    return 1;
  }
  reset() {
    this.zsets.clear();
  }
}

const commerceMock = {
  markInvoicePaid: vi.fn(),
  markInvoicePaymentFailed: vi.fn(),
  updateInvoiceStatus: vi.fn(),
  getInvoiceWithBusiness: vi.fn(),
  getInvoicePublicView: vi.fn(),
};

const receiptsMock = {
  buildReceipt: vi.fn(),
};

const paymentsMock = {
  getInvoicePaymentStatus: vi.fn(),
  getAvailableGateways: vi.fn(),
};

describe('Commerce authorization e2e (L1: real guards, mocked service)', () => {
  let app: INestApplication;
  let prisma: GuardPrismaMock;
  let redis: RedisMock;

  const agent = () => request(app.getHttpServer());
  const withActor = (req: request.Test, actor: string | null) => (actor ? req.set('x-rva-user', actor) : req);
  const markPaid = (actor: string | null, body: Record<string, unknown>) =>
    withActor(agent().patch(`/commerce/invoices/${ID.inv}/paid`), actor).send(body);
  const markFailed = (actor: string | null, body: Record<string, unknown>) =>
    withActor(agent().patch(`/commerce/invoices/${ID.inv}/payment-failed`), actor).send(body);
  const setStatus = (actor: string | null, pathStatus: string, body: Record<string, unknown>) =>
    withActor(agent().patch(`/commerce/invoices/${ID.inv}/status/${pathStatus}`), actor).send(body);
  const receipt = (actor: string | null, businessId?: string) =>
    withActor(
      agent().get(businessId ? `/commerce/invoices/${ID.inv}/receipt?businessId=${businessId}` : `/commerce/invoices/${ID.inv}/receipt`),
      actor,
    );

  beforeAll(async () => {
    prisma = new GuardPrismaMock();
    redis = new RedisMock();

    const moduleRef = await Test.createTestingModule({
      controllers: [CommerceController, PaymentsController],
      providers: [
        AuthGuard,
        BusinessGuard,
        ModuleScopeGuard,
        PublicRateLimitGuard,
        PlanLimitGuard,
        TeamAuditInterceptor,
        { provide: PrismaService, useValue: prisma },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: CommerceService, useValue: commerceMock },
        { provide: InvoiceReceiptBuilderService, useValue: receiptsMock },
        { provide: PaymentsService, useValue: paymentsMock },
        { provide: SubscriptionsService, useValue: { checkLimit: vi.fn().mockResolvedValue({ allowed: true }) } },
        { provide: TimeEntryService, useValue: {} },
        { provide: GmailService, useValue: {} },
        { provide: CommerceVisionService, useValue: {} },
        { provide: StoreReadinessService, useValue: {} },
        { provide: PaymentEvidenceService, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Identity attachment only; no guard is overridden.
    app.use((req: any, _res: any, next: any) => {
      const header = req.headers['x-rva-user'];
      const user = typeof header === 'string' ? USERS[header] : undefined;
      if (user) req.user = { id: user.id, role: user.role };
      next();
    });
    app.useGlobalFilters(new GlobalHttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    redis.reset();
    commerceMock.markInvoicePaid.mockResolvedValue({ id: ID.inv, status: 'PAID' });
    commerceMock.markInvoicePaymentFailed.mockResolvedValue({ id: ID.inv, status: 'FAILED' });
    commerceMock.updateInvoiceStatus.mockResolvedValue({ id: ID.inv, status: 'SENT' });
    receiptsMock.buildReceipt.mockResolvedValue({ invoiceNumber: 'RVA-SENT', status: 'SENT' });
    paymentsMock.getInvoicePaymentStatus.mockResolvedValue({ status: 'SENT', paid: 40, remaining: 60, currency: 'TTD', lastPaymentAt: null });
  });

  // -------------------------------------------------------------------------
  describe('List A: pre-fix failures', () => {
    it('RA-G1-01: path paid with body SENT is refused with 400 before the service is called', async () => {
      const res = await setStatus(ID.ownerA, 'paid', { businessId: ID.bizA, status: 'SENT' });
      expect(res.status).toBe(400);
      expect(commerceMock.updateInvoiceStatus).not.toHaveBeenCalled();
    });

    it('RA-G1-02: every path value outside the DTO set is refused with 400 before the service is called', async () => {
      for (const value of ['partially_paid', 'pending', 'failed', 'draft', 'PAID', 'Paid', 'void%20']) {
        const res = await setStatus(ID.ownerA, value, { businessId: ID.bizA, status: 'SENT' });
        expect(res.status, `path ${value}`).toBe(400);
      }
      expect(commerceMock.updateInvoiceStatus).not.toHaveBeenCalled();
    });

    it('RA-G1-04: two legal values that disagree -> 400 status mismatch; the guard passed on the body businessId', async () => {
      const res = await setStatus(ID.ownerA, 'void', { businessId: ID.bizA, status: 'SENT' });
      expect(res.status).toBe(400);
      expect(res.status).not.toBe(403);
      expect(JSON.stringify(res.body)).toMatch(/status mismatch/i);
      expect(prisma.client.business.findFirst).toHaveBeenCalled();
      expect(commerceMock.updateInvoiceStatus).not.toHaveBeenCalled();
    });

    it('RA-G4-01: revenue:read is refused mark-paid by ModuleScopeGuard (403 Insufficient permissions)', async () => {
      const res = await markPaid(ID.staffReadA, { businessId: ID.bizA });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Insufficient permissions/);
      expect(commerceMock.markInvoicePaid).not.toHaveBeenCalled();
    });

    it('RA-G4-02: explicit revenue:none is refused mark-paid', async () => {
      const res = await markPaid(ID.staffNoneA, { businessId: ID.bizA });
      expect(res.status).toBe(403);
      expect(commerceMock.markInvoicePaid).not.toHaveBeenCalled();
    });

    it('RA-G4-03: STAFF default (read) is refused mark-paid', async () => {
      const res = await markPaid(ID.staffDefaultA, { businessId: ID.bizA });
      expect(res.status).toBe(403);
      expect(commerceMock.markInvoicePaid).not.toHaveBeenCalled();
    });

    it('RA-G4-05: revenue:read is refused payment-failed', async () => {
      const res = await markFailed(ID.staffReadA, { businessId: ID.bizA, reason: 'x' });
      expect(res.status).toBe(403);
      expect(commerceMock.markInvoicePaymentFailed).not.toHaveBeenCalled();
    });

    it('RA-G4-06: revenue:read is refused send / overdue / void', async () => {
      const res = await setStatus(ID.staffReadA, 'sent', { businessId: ID.bizA, status: 'SENT' });
      expect(res.status).toBe(403);
      expect(commerceMock.updateInvoiceStatus).not.toHaveBeenCalled();
    });

    it('RA-G4-12 / RA-G16-03: the controller forwards the guard-validated tenant to the service on all three routes', async () => {
      await markPaid(ID.ownerA, { businessId: ID.bizA }).expect(200);
      expect(commerceMock.markInvoicePaid).toHaveBeenCalledWith(ID.inv, ID.ownerA, ID.bizA);

      await markFailed(ID.ownerA, { businessId: ID.bizA, reason: 'x' }).expect(200);
      expect(commerceMock.markInvoicePaymentFailed).toHaveBeenCalledWith(ID.inv, ID.ownerA, 'x', ID.bizA);

      await setStatus(ID.ownerA, 'sent', { businessId: ID.bizA, status: 'SENT' }).expect(200);
      expect(commerceMock.updateInvoiceStatus).toHaveBeenCalledWith(
        expect.objectContaining({ invoiceId: ID.inv, status: 'SENT', actorId: ID.ownerA, businessId: ID.bizA }),
      );
    });

    it('RA-G7-01 (L1 half): the controller forwards the guard tenant to buildReceipt', async () => {
      await receipt(ID.ownerA, ID.bizA).expect(200);
      expect(receiptsMock.buildReceipt).toHaveBeenCalledWith(ID.inv, ID.bizA);
    });

    it('RA-G7-04: explicit revenue:none is refused a receipt at the guard (403 Insufficient permissions)', async () => {
      const res = await receipt(ID.staffNoneA, ID.bizA);
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Insufficient permissions/);
      expect(receiptsMock.buildReceipt).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('List B: regression controls', () => {
    it('RA-G4-04: write scope is admitted to mark paid', async () => {
      await markPaid(ID.staffWriteA, { businessId: ID.bizA }).expect(200);
      expect(commerceMock.markInvoicePaid).toHaveBeenCalledTimes(1);
    });

    it('RA-G4-10: a non-member is refused at BusinessGuard (403 No access to this business) on all three routes', async () => {
      for (const call of [
        () => markPaid(ID.noMember, { businessId: ID.bizA }),
        () => markFailed(ID.noMember, { businessId: ID.bizA }),
        () => setStatus(ID.noMember, 'void', { businessId: ID.bizA, status: 'VOID' }),
      ]) {
        const res = await call();
        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/No access to this business/);
      }
      expect(commerceMock.markInvoicePaid).not.toHaveBeenCalled();
      expect(commerceMock.markInvoicePaymentFailed).not.toHaveBeenCalled();
      expect(commerceMock.updateInvoiceStatus).not.toHaveBeenCalled();
    });

    it('RA-G4-11: a missing businessId is refused, not defaulted (403 businessId is required)', async () => {
      const res = await markPaid(ID.ownerA, {});
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/businessId is required/);
      expect(commerceMock.markInvoicePaid).not.toHaveBeenCalled();
    });

    it('RA-G4-13 (L1 guard half): SUPER_ADMIN passes both guards without a membership and reaches the service', async () => {
      // The tenant-forwarding half of this call is RA-G4-12 (List A).
      await markPaid(ID.superAdmin, { businessId: ID.bizA }).expect(200);
      expect(commerceMock.markInvoicePaid).toHaveBeenCalledTimes(1);
      expect(commerceMock.markInvoicePaid.mock.calls[0]!.slice(0, 2)).toEqual([ID.inv, ID.superAdmin]);
    });

    it('RA-G7-03: revenue:read (explicit and STAFF default) is admitted to the receipt route', async () => {
      for (const actor of [ID.staffReadA, ID.staffDefaultA]) {
        await receipt(actor, ID.bizA).expect(200);
      }
      expect(receiptsMock.buildReceipt).toHaveBeenCalledTimes(2);
    });

    it('RA-G7-05: an unauthenticated receipt is refused (401) before any lookup', async () => {
      const res = await receipt(null);
      expect(res.status).toBe(401);
      expect(receiptsMock.buildReceipt).not.toHaveBeenCalled();
    });

    it('RA-G7-07: a non-member with the right tenant id is refused at BusinessGuard (403 No access)', async () => {
      const res = await receipt(ID.noMember, ID.bizA);
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/No access to this business/);
      expect(receiptsMock.buildReceipt).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('List C: post-fix acceptance', () => {
    it('RA-G4-01/05/06 (L1 metadata half): the three bare-id mutation handlers require revenue:write', () => {
      for (const handler of ['markInvoicePaid', 'markInvoicePaymentFailed', 'updateInvoiceStatus'] as const) {
        const meta = Reflect.getMetadata(MODULE_SCOPE_KEY, CommerceController.prototype[handler]);
        expect(meta, handler).toEqual({ module: 'revenue', minLevel: 'write' });
      }
    });

    it('RA-G7-03 (L1 metadata half): the receipt handler carries { module: revenue, minLevel: read }', () => {
      const meta = Reflect.getMetadata(MODULE_SCOPE_KEY, CommerceController.prototype.getReceipt);
      expect(meta).toEqual({ module: 'revenue', minLevel: 'read' });
    });

    it('RA-G5-06 (L1 half): the public status handler carries @PublicRateLimit(20, 60000) and the guard enforces it', async () => {
      const meta = Reflect.getMetadata(PUBLIC_RATE_LIMIT_KEY, PaymentsController.prototype.getInvoicePaymentStatus);
      expect(meta).toEqual({ limit: 20, windowMs: 60_000 });

      for (let i = 1; i <= 20; i += 1) {
        const res = await agent().get(`/payments/invoice/${ID.inv}/status`);
        expect(res.status, `request ${i}`).toBe(200);
      }
      const blocked = await agent().get(`/payments/invoice/${ID.inv}/status`);
      expect(blocked.status).toBe(429);
    });
  });
});
