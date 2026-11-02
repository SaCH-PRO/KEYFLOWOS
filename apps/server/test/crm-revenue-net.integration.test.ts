/**
 * V1-29e-CRM-REVENUE-NET — the CRM contact revenue summary nets refunds (REAL database).
 *
 * Verification finding VR-02 (verify-money, int/trial-I bf5ca9fe): GET
 * /crm/businesses/:b/contacts/:c/revenue-summary (CrmRevenueService
 * .getContactRevenueSummary, shown on the contact insight card and the contact
 * money page) summed the SUCCESSFUL Payment rows alone. Before V1-29 the
 * manual refund flipped its original to REFUNDED, so the base read a refunded
 * payment as no revenue. Under D-14 the original stays SUCCESSFUL beside a
 * separate negative REFUNDED row, so the same reader counted refunded money as
 * lifetime revenue, named a refunded payment as the last payment and counted
 * it as a reliable payment: a regression of the V1-29 refund convention that
 * V1-29b-REFUND-READERS did not reach.
 *
 * Contract pinned here: lifetimeRevenue, lastPaymentAmount and
 * paymentReliability read through the shared balance contract
 * (balanceOfStoredRows / CASH_NET_PAYMENT_WHERE), over the contact's own-tenant
 * rows only.
 *
 *   VR-B1   SUCCESSFUL 100 and its manual refund -100 -> lifetimeRevenue 0, no last payment,
 *           paymentReliability null (the base read of the flipped row)
 *   VR-B2   60 + 40 paid, the 40 refunded -> lifetimeRevenue 60, last payment the 60 (its date)
 *   CRN-03  a provider partial refund (100 paid, -40 linked) -> 60, last payment 60 (what is left)
 *   CRN-04  a refund that links to no payment (a PayPal webhook row without a capture id, written
 *           before V1-29c) covering the payment on its invoice -> 0, no last payment
 *   CRN-05  a FAILED attempt and a PENDING row beside a refunded payment -> the refunded payment is
 *           neither revenue, nor the last payment, nor a reliable payment (80, 80, 0.5)
 *   CRN-06  paid, fully refunded, paid again -> 100 received, the last payment the new 100
 *   CRN-07  a legacy positive REFUNDED row (flipped before V1-29) reads as the base read it:
 *           60 paid beside a flipped 40 -> 60 / 60 / 1; a flipped row alone -> 0 / null / null
 *   CRN-08  own-tenant rows only: another tenant's SUCCESSFUL and REFUNDED rows on this contact's
 *           invoice do not move the figures; the other tenant is refused on this tenant's path and
 *           reads nothing of this contact on its own path
 *   CRN-09  contract binding: for every seeded contact lifetimeRevenue is balanceOfStoredRows(...)
 *           .net over the contact's own-tenant rows
 *
 * Nothing on the HTTP or authorization path is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, CrmRateLimitGuard, CrmController and CrmRevenueService are real against the
 * database at DATABASE_URL. Identity attachment is the one stand-in: a test middleware reads
 * `x-v29e-user`, loads that seeded user row and attaches `{ id, email, role }` exactly as the
 * Supabase-verifying AuthMiddleware would. The controller's other collaborators are stubs the
 * revenue-summary route never calls.
 *
 * Payment rows are written as their writers write them: the manual refund (markPaymentRefunded)
 * as a negative REFUNDED row with reference = the original's providerPaymentId, the provider
 * refund door the same, the pre-V1-29c PayPal webhook with no reference, and the pre-V1-29
 * manual refund as the original flipped to REFUNDED with its positive amount.
 *
 * Fixtures: prefix `v29e_` (registered in test/helpers/fixture-prefixes.json), written literally
 * in every globally unique column; hard-deleted by raw SQL (patterns built by sqlLikePrefix) in
 * dependency order in beforeAll and afterAll; no $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v29e_';
const HEADER = 'x-v29e-user';

const ID = {
  ownerA: `${P}ownerA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  // one contact (and one invoice) per case so figures never bleed between cases
  cB1: `${P}cB1`,
  cB2: `${P}cB2`,
  cPartial: `${P}cPartial`,
  cUnlinked: `${P}cUnlinked`,
  cMixed: `${P}cMixed`,
  cResettle: `${P}cResettle`,
  cLegacy: `${P}cLegacy`,
  cLegacyOnly: `${P}cLegacyOnly`,
  cTenant: `${P}cTenant`,
  cNone: `${P}cNone`,
};

const CONTACTS = [
  ID.cB1, ID.cB2, ID.cPartial, ID.cUnlinked, ID.cMixed, ID.cResettle, ID.cLegacy, ID.cLegacyOnly, ID.cTenant, ID.cNone,
];

const invoiceOf = (contactId: string) => `${contactId}_inv`;

/** Minute `n` of the fixture day: the order the rows were written in. */
const at = (n: number) => new Date(Date.UTC(2026, 9, 1, 10, n, 0));

let db: any;
let app: any;
let storedBalanceFn: (total: number, rows: Array<{ amount: number; status: string }>, currency?: string) => any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)} OR invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoice_items WHERE invoice_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contact_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function summary(actor: string, contactId: string, businessId = ID.bizA) {
  return request(app.getHttpServer())
    .get(`/crm/businesses/${businessId}/contacts/${contactId}/revenue-summary`)
    .set(HEADER, actor);
}

/** The three figures VR-02 is about, plus the last payment's date. */
async function figures(contactId: string) {
  const res = await summary(ID.ownerA, contactId);
  expect(res.status, `revenue-summary of ${contactId}: ${JSON.stringify(res.body)}`).toBe(200);
  const b = res.body;
  return {
    lifetimeRevenue: b.lifetimeRevenue,
    lastPaymentAmount: b.lastPaymentAmount,
    lastPaymentAt: b.lastPaymentAt,
    paymentReliability: b.paymentReliability,
  };
}

type Row = {
  key: string;
  contactId: string;
  amount: number;
  status: 'SUCCESSFUL' | 'REFUNDED' | 'FAILED' | 'PENDING';
  minute: number;
  provider?: string;
  reference?: string | null;
  businessId?: string;
};

/** providerPaymentId of a seeded row (prefixed: the column is globally unique). */
const ppid = (key: string) => `${P}ppid_${key}`;

async function row(r: Row) {
  return db.payment.create({
    data: {
      id: `${P}pay_${r.key}`,
      amount: r.amount,
      currency: 'TTD',
      status: r.status,
      provider: r.provider ?? 'cash',
      method: 'cash',
      providerPaymentId: `${P}ppid_${r.key}`,
      reference: r.reference ?? null,
      businessId: r.businessId ?? ID.bizA,
      invoiceId: invoiceOf(r.contactId),
      createdAt: at(r.minute),
    },
  });
}

/** A manual refund as markPaymentRefunded writes it since V1-29 (D-14): a separate negative row linked by reference. */
function refundOf(key: string, original: Row, amount: number, minute: number, businessId?: string): Row {
  return {
    key,
    contactId: original.contactId,
    amount: -amount,
    status: 'REFUNDED',
    minute,
    provider: original.provider,
    reference: ppid(original.key),
    businessId,
  };
}

const ROWS: Row[] = [];
function seedRow(r: Row): Row {
  ROWS.push(r);
  return r;
}

// VR-B1: the verifier's rows [[SUCCESSFUL, 100], [REFUNDED, -100]]
const b1Paid = seedRow({ key: 'b1_s100', contactId: ID.cB1, amount: 100, status: 'SUCCESSFUL', minute: 1 });
seedRow(refundOf('b1_r100', b1Paid, 100, 2));

// VR-B2: 60 + 40 paid, the 40 refunded
seedRow({ key: 'b2_s60', contactId: ID.cB2, amount: 60, status: 'SUCCESSFUL', minute: 1 });
const b2Forty = seedRow({ key: 'b2_s40', contactId: ID.cB2, amount: 40, status: 'SUCCESSFUL', minute: 2 });
seedRow(refundOf('b2_r40', b2Forty, 40, 3));

// CRN-03: a Stripe partial refund through the provider refund door (linked by reference)
const partialPaid = seedRow({ key: 'pt_s100', contactId: ID.cPartial, amount: 100, status: 'SUCCESSFUL', minute: 1, provider: 'stripe' });
seedRow(refundOf('pt_r40', partialPaid, 40, 2));

// CRN-04: a PayPal refund written before V1-29c with no capture id: no reference, links to nothing
seedRow({ key: 'ul_s100', contactId: ID.cUnlinked, amount: 100, status: 'SUCCESSFUL', minute: 1, provider: 'paypal' });
seedRow({ key: 'ul_r100', contactId: ID.cUnlinked, amount: -100, status: 'REFUNDED', minute: 2, provider: 'paypal', reference: null });

// CRN-05: 80 paid, a failed attempt, a pending row, then 100 paid and refunded
seedRow({ key: 'mx_s80', contactId: ID.cMixed, amount: 80, status: 'SUCCESSFUL', minute: 1 });
seedRow({ key: 'mx_f50', contactId: ID.cMixed, amount: 50, status: 'FAILED', minute: 2, provider: 'stripe' });
seedRow({ key: 'mx_p20', contactId: ID.cMixed, amount: 20, status: 'PENDING', minute: 3, provider: 'stripe' });
const mixedPaid = seedRow({ key: 'mx_s100', contactId: ID.cMixed, amount: 100, status: 'SUCCESSFUL', minute: 4 });
seedRow(refundOf('mx_r100', mixedPaid, 100, 5));

// CRN-06: paid, fully refunded, paid again
const resettlePaid = seedRow({ key: 'rs_s100a', contactId: ID.cResettle, amount: 100, status: 'SUCCESSFUL', minute: 1 });
seedRow(refundOf('rs_r100', resettlePaid, 100, 2));
seedRow({ key: 'rs_s100b', contactId: ID.cResettle, amount: 100, status: 'SUCCESSFUL', minute: 3 });

// CRN-07: rows the manual refund flipped to REFUNDED before V1-29 (positive amount, no SUCCESSFUL twin)
seedRow({ key: 'lg_s60', contactId: ID.cLegacy, amount: 60, status: 'SUCCESSFUL', minute: 1 });
seedRow({ key: 'lg_flip40', contactId: ID.cLegacy, amount: 40, status: 'REFUNDED', minute: 2 });
seedRow({ key: 'lo_flip100', contactId: ID.cLegacyOnly, amount: 100, status: 'REFUNDED', minute: 1 });

// CRN-08: the contact's own 100, and rows of tenant B on the same invoice (a foreign 30 paid and a
// foreign refund of 100 linked to A's payment): neither is A's money
const tenantPaid = seedRow({ key: 'tn_s100', contactId: ID.cTenant, amount: 100, status: 'SUCCESSFUL', minute: 1 });
seedRow({ key: 'tn_fs30', contactId: ID.cTenant, amount: 30, status: 'SUCCESSFUL', minute: 2, businessId: ID.bizB });
seedRow(refundOf('tn_fr100', tenantPaid, 100, 3, ID.bizB));

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  ({ balanceOfStoredRows: storedBalanceFn } = await import('../src/modules/commerce/invoice-workflow.service'));

  const { Test } = await import('@nestjs/testing');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
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

  // ---- the real HTTP path (wired before any row is seeded, so a wiring
  // fault is reported as itself and not as a seeding failure) -------------
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
      // The reader under test, over the real Prisma.
      CrmRevenueService,
      // Every other collaborator is a stub the revenue-summary route never calls.
      { provide: CrmStatsService, useValue: {} },
      { provide: CrmService, useValue: {} },
      { provide: CrmTimelineService, useValue: {} },
      { provide: CrmCacheService, useValue: {} },
      { provide: EventEmitter2, useValue: {} },
      { provide: SubscriptionsService, useValue: { checkLimit: async () => ({ allowed: true }) } },
      { provide: CrmListsService, useValue: {} },
      { provide: CrmFlowService, useValue: {} },
      { provide: EntityResolutionService, useValue: {} },
      { provide: ContactAuditService, useValue: {} },
      { provide: ContactCustomFieldValueService, useValue: {} },
      { provide: CrmImportService, useValue: {} },
      { provide: CrmPlaybookService, useValue: {} },
      { provide: CrmActionsService, useValue: {} },
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
  // Identity attachment only, for seeded v29e_ users. No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  await app.init();

  await cleanup(); // in case a prior run aborted

  for (const [user, biz, name, email] of [
    [ID.ownerA, ID.bizA, 'V29E Biz A', `${P}owner_a@test.local`],
    [ID.ownerB, ID.bizB, 'V29E Biz B', `${P}owner_b@test.local`],
  ] as const) {
    await db.user.create({ data: { id: user, email, role: 'USER' } });
    await db.business.create({ data: { id: biz, name, ownerId: user, currency: 'TTD' } });
    await db.membership.create({ data: { id: `${user}_m`, userId: user, businessId: biz, role: 'OWNER' } });
  }

  let n = 0;
  for (const contactId of CONTACTS) {
    n += 1;
    await db.contact.create({
      data: { id: contactId, businessId: ID.bizA, firstName: 'V29e', lastName: contactId.slice(P.length), email: `${P}${n}@test.local` },
    });
    await db.invoice.create({
      data: {
        id: invoiceOf(contactId),
        invoiceNumber: `V29E-${String(n).padStart(3, '0')}`,
        status: 'SENT',
        subtotal: 200,
        total: 200,
        currency: 'TTD',
        businessId: ID.bizA,
        contactId,
        createdAt: at(0),
      },
    });
  }
  for (const r of ROWS) await row(r);
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('fixture sanity (real rows)', () => {
  it('seeded every payment row as its writer writes it', async () => {
    const rows = await db.payment.findMany({ where: { invoiceId: { in: CONTACTS.map(invoiceOf) } } });
    expect(rows).toHaveLength(ROWS.length);
    // the D-14 refund rows are negative REFUNDED rows linked to a SUCCESSFUL original that stays SUCCESSFUL
    const b1 = rows.filter((r: any) => r.invoiceId === invoiceOf(ID.cB1));
    expect(b1.map((r: any) => [r.status, r.amount]).sort()).toEqual([['REFUNDED', -100], ['SUCCESSFUL', 100]]);
    expect(b1.find((r: any) => r.status === 'REFUNDED').reference).toBe(ppid(b1Paid.key));
    // the foreign rows are tenant B's
    const foreign = rows.filter((r: any) => r.businessId === ID.bizB).map((r: any) => r.amount).sort();
    expect(foreign).toEqual([-100, 30]);
  });
});

describe('VR-02: the contact revenue summary nets refunds (V1-29e-CRM-REVENUE-NET)', () => {
  it('VR-B1: SUCCESSFUL 100 and its manual refund -100 -> lifetimeRevenue 0, no last payment, paymentReliability null', async () => {
    // RED-BEFORE (int/trial-I bf5ca9fe): lifetimeRevenue 100, lastPaymentAmount 100, paymentReliability 1.
    expect(await figures(ID.cB1)).toEqual({
      lifetimeRevenue: 0,
      lastPaymentAmount: null,
      lastPaymentAt: null,
      paymentReliability: null,
    });
  });

  it('VR-B2: 60 + 40 paid, the 40 refunded -> lifetimeRevenue 60, the last payment is the 60', async () => {
    // RED-BEFORE: lifetimeRevenue 100, lastPaymentAmount 40 (the refunded payment).
    expect(await figures(ID.cB2)).toEqual({
      lifetimeRevenue: 60,
      lastPaymentAmount: 60,
      lastPaymentAt: at(1).toISOString(),
      paymentReliability: 1,
    });
  });

  it('CRN-03: a provider partial refund (100 paid, 40 refunded) -> 60 received, the last payment is what is left of it (60)', async () => {
    expect(await figures(ID.cPartial)).toEqual({
      lifetimeRevenue: 60,
      lastPaymentAmount: 60,
      lastPaymentAt: at(1).toISOString(),
      paymentReliability: 1,
    });
  });

  it('CRN-04: a refund row that links to no payment (pre-V1-29c PayPal, no reference) covering the payment -> 0, no last payment', async () => {
    expect(await figures(ID.cUnlinked)).toEqual({
      lifetimeRevenue: 0,
      lastPaymentAmount: null,
      lastPaymentAt: null,
      paymentReliability: null,
    });
  });

  it('CRN-05: beside a FAILED attempt and a PENDING row, a refunded payment is neither revenue, the last payment, nor a reliable payment', async () => {
    // RED-BEFORE: lifetimeRevenue 180, lastPaymentAmount 100, paymentReliability 2/3.
    expect(await figures(ID.cMixed)).toEqual({
      lifetimeRevenue: 80,
      lastPaymentAmount: 80,
      lastPaymentAt: at(1).toISOString(),
      paymentReliability: 0.5,
    });
  });

  it('CRN-06: paid, fully refunded, paid again -> 100 received, the last payment is the new 100', async () => {
    expect(await figures(ID.cResettle)).toEqual({
      lifetimeRevenue: 100,
      lastPaymentAmount: 100,
      lastPaymentAt: at(3).toISOString(),
      paymentReliability: 1,
    });
  });

  it('CRN-07: a legacy positive REFUNDED row (flipped before V1-29) reads as the base read it', async () => {
    // Base read: the flipped row is no payment and no revenue; the SUCCESSFUL 60 beside it is.
    expect(await figures(ID.cLegacy)).toEqual({
      lifetimeRevenue: 60,
      lastPaymentAmount: 60,
      lastPaymentAt: at(1).toISOString(),
      paymentReliability: 1,
    });
    expect(await figures(ID.cLegacyOnly)).toEqual({
      lifetimeRevenue: 0,
      lastPaymentAmount: null,
      lastPaymentAt: null,
      paymentReliability: null,
    });
  });

  it("CRN-08: own-tenant rows only: tenant B's rows on the contact's invoice do not move A's figures", async () => {
    // Tenant B's 30 is not A's revenue, and B's refund row of A's payment is not A's refund.
    expect(await figures(ID.cTenant)).toEqual({
      lifetimeRevenue: 100,
      lastPaymentAmount: 100,
      lastPaymentAt: at(1).toISOString(),
      paymentReliability: 1,
    });
  });

  it("CRN-08: tenant B is refused on A's path and reads nothing of A's contact on its own path", async () => {
    const refused = await summary(ID.ownerB, ID.cTenant, ID.bizA);
    expect(refused.status).toBe(403);
    expect(refused.body).not.toHaveProperty('lifetimeRevenue');
    const own = await summary(ID.ownerB, ID.cTenant, ID.bizB);
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({
      lifetimeRevenue: 0,
      outstandingBalance: 0,
      openInvoices: 0,
      lastPaymentAmount: null,
      lastPaymentAt: null,
      paymentReliability: null,
    });
  });

  it('CRN-09: for every seeded contact lifetimeRevenue is balanceOfStoredRows(...).net over its own-tenant rows', async () => {
    for (const contactId of CONTACTS) {
      const rows = await db.payment.findMany({
        where: { businessId: ID.bizA, invoiceId: invoiceOf(contactId) },
        select: { amount: true, status: true },
      });
      const expected = storedBalanceFn(0, rows, 'TTD').net;
      const got = await figures(contactId);
      expect(got.lifetimeRevenue, `contact ${contactId}`).toBe(expected);
    }
  });

  it('a contact with no payment rows reads no revenue and no last payment', async () => {
    expect(await figures(ID.cNone)).toEqual({
      lifetimeRevenue: 0,
      lastPaymentAmount: null,
      lastPaymentAt: null,
      paymentReliability: null,
    });
  });
});
