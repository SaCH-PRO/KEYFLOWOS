import { describe, it, expect, vi } from 'vitest';
import type { PrismaService } from '../../core/prisma/prisma.service';
import type { FinanceOverviewService } from '../finance/finance-overview.service';
import type { SafeToSpendService } from '../finance/safe-to-spend.service';
import type { ReadyToSendService } from '../commerce/ready-to-send.service';
import type { KeyActionProposalService } from '../key-autonomy/key-action-proposal.service';
import type { CommerceService } from '../commerce/commerce.service';
import { TodayService } from './today.service';

interface MockQuoteRow {
  id: string;
  quoteNumber: string;
  total: number;
  currency: string;
  acceptedAt: Date | null;
  createdAt: Date;
  contactId: string | null;
  contact: {
    businessId: string;
    deletedAt: Date | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
}

interface BuildHarnessOptions {
  membership: { role: string; permissionScopes: unknown } | null;
  quotes?: MockQuoteRow[];
  userRole?: string;
}

const BIZ_ID = 'biz_tqh_1';
const USER_ID = 'usr_tqh_1';

function buildHarness(opts: BuildHarnessOptions) {
  const quoteFindMany = vi.fn().mockResolvedValue(opts.quotes ?? []);

  const prisma = {
    client: {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: USER_ID, role: opts.userRole ?? 'USER' }),
      },
      membership: {
        findUnique: vi.fn().mockResolvedValue(opts.membership),
      },
      business: {
        findUnique: vi.fn().mockResolvedValue({
          id: BIZ_ID,
          timezone: 'America/Port_of_Spain',
          currency: 'TTD',
          slug: 'maria-studio',
          storeEnabled: true,
          businessHours: { mon: { open: '09:00', close: '17:00', closed: false } },
          metaData: { bankTransferEnabled: true },
        }),
      },
      product: { count: vi.fn().mockResolvedValue(1) },
      service: { count: vi.fn().mockResolvedValue(1) },
      quote: { findMany: quoteFindMany },
      approvalRequest: { findMany: vi.fn().mockResolvedValue([]) },
      aiPlanStep: { findMany: vi.fn().mockResolvedValue([]) },
      booking: { findMany: vi.fn().mockResolvedValue([]) },
      invoice: { findMany: vi.fn().mockResolvedValue([]) },
      contactTask: { findMany: vi.fn().mockResolvedValue([]) },
      marketplaceOrder: { findMany: vi.fn().mockResolvedValue([]) },
      contact: { findMany: vi.fn().mockResolvedValue([]) },
    },
  } as unknown as PrismaService;

  const financeOverview = {
    getOverview: vi.fn().mockResolvedValue({
      cashBalance: 1000,
      cashBasis: 'ledger',
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
  } as unknown as FinanceOverviewService;

  const safeToSpend = {
    calculate: vi.fn().mockResolvedValue({ safeToSpend: 1000 }),
  } as unknown as SafeToSpendService;

  const readyToSend = {
    listDue: vi.fn().mockResolvedValue({ items: [] }),
  } as unknown as ReadyToSendService;

  const keyAutonomy = {
    listForReader: vi.fn().mockResolvedValue([]),
  } as unknown as KeyActionProposalService;

  const commerce = {
    listPaymentClaims: vi.fn().mockResolvedValue([]),
  } as unknown as CommerceService;

  const service = new TodayService(
    prisma,
    financeOverview,
    safeToSpend,
    readyToSend,
    keyAutonomy,
    commerce,
  );

  return { service, quoteFindMany };
}

function makeAcceptedQuote(id: string): MockQuoteRow {
  const acceptedAt = new Date('2026-11-26T15:00:00.000Z');
  return {
    id,
    quoteNumber: 'QUO-0042',
    total: 650,
    currency: 'TTD',
    acceptedAt,
    createdAt: acceptedAt,
    contactId: 'ct_maria_1',
    contact: {
      businessId: BIZ_ID,
      deletedAt: null,
      firstName: 'Maria',
      lastName: 'Lopez',
    },
  };
}

describe('P214 FU-TODAY-QUOTE-HREF — TodayService accepted-quote href matches Commerce page query params', () => {
  it('emits /app/commerce?tab=quotes&recordType=quote&recordId=<id> (never quoteId=) on item and CONVERT action for revenue:write readers', async () => {
    const quoteId = 'q_accepted_1';
    const { service } = buildHarness({
      membership: { role: 'OWNER', permissionScopes: null },
      quotes: [makeAcceptedQuote(quoteId)],
    });

    const result = await service.getToday(BIZ_ID, { id: USER_ID, role: 'USER' });
    const item = result.needsYou.items.find((entry) => entry.kind === 'ACCEPTED_QUOTE');

    expect(item).toBeDefined();
    const expectedHref = `/app/commerce?tab=quotes&recordType=quote&recordId=${encodeURIComponent(quoteId)}`;
    expect(item?.href).toBe(expectedHref);
    expect(item?.href).not.toContain('quoteId=');

    const parsed = new URL(item!.href, 'http://localhost');
    expect(parsed.pathname).toBe('/app/commerce');
    expect(parsed.searchParams.get('tab')).toBe('quotes');
    expect(parsed.searchParams.get('recordType')).toBe('quote');
    expect(parsed.searchParams.get('recordId')).toBe(quoteId);
    expect(parsed.searchParams.get('quoteId')).toBeNull();

    expect(item?.actions).toHaveLength(1);
    expect(item?.actions[0].actionType).toBe('CONVERT');
    expect(item?.actions[0].href).toBe(expectedHref);
  });

  it('emits /app/commerce?tab=quotes&recordType=quote&recordId=<id> on item and View quote OPEN action for revenue:read-only readers', async () => {
    const quoteId = 'q_readonly_2';
    const { service } = buildHarness({
      membership: { role: 'STAFF', permissionScopes: { revenue: 'read' } },
      quotes: [makeAcceptedQuote(quoteId)],
    });

    const result = await service.getToday(BIZ_ID, { id: USER_ID, role: 'USER' });
    const item = result.needsYou.items.find((entry) => entry.kind === 'ACCEPTED_QUOTE');

    expect(item).toBeDefined();
    const expectedHref = `/app/commerce?tab=quotes&recordType=quote&recordId=${encodeURIComponent(quoteId)}`;
    expect(item?.href).toBe(expectedHref);
    expect(item?.actions).toEqual([
      {
        label: 'View quote',
        actionType: 'OPEN',
        href: expectedHref,
      },
    ]);
  });

  it('URL-encodes special characters in quote IDs without injecting query params or fragments', async () => {
    const specialId = 'q/1?a=b&c=d#frag 100%';
    const { service } = buildHarness({
      membership: { role: 'OWNER', permissionScopes: null },
      quotes: [makeAcceptedQuote(specialId)],
    });

    const result = await service.getToday(BIZ_ID, { id: USER_ID, role: 'USER' });
    const item = result.needsYou.items.find((entry) => entry.kind === 'ACCEPTED_QUOTE');

    expect(item).toBeDefined();
    const expectedHref = `/app/commerce?tab=quotes&recordType=quote&recordId=${encodeURIComponent(specialId)}`;
    expect(item?.href).toBe(expectedHref);
    expect(item?.actions[0].href).toBe(expectedHref);

    const parsed = new URL(item!.href, 'http://localhost');
    expect(parsed.pathname).toBe('/app/commerce');
    expect(parsed.hash).toBe('');
    expect(parsed.searchParams.get('tab')).toBe('quotes');
    expect(parsed.searchParams.get('recordType')).toBe('quote');
    expect(parsed.searchParams.get('recordId')).toBe(specialId);
    expect(parsed.searchParams.get('a')).toBeNull();
    expect(parsed.searchParams.get('c')).toBeNull();
  });

  it('withholds accepted-quote items and skips quote reads for non-revenue readers', async () => {
    const { service, quoteFindMany } = buildHarness({
      membership: { role: 'STAFF', permissionScopes: { bookings: 'read' } },
      quotes: [makeAcceptedQuote('q_hidden_3')],
    });

    const result = await service.getToday(BIZ_ID, { id: USER_ID, role: 'USER' });

    expect(result.needsYou.items.some((entry) => entry.kind === 'ACCEPTED_QUOTE')).toBe(false);
    expect(result.today.acceptedQuotes).toEqual([]);
    expect(quoteFindMany).not.toHaveBeenCalled();
  });

  it('withholds accepted-quote items fail-closed when reader is unauthenticated', async () => {
    const { service, quoteFindMany } = buildHarness({
      membership: { role: 'OWNER', permissionScopes: null },
      quotes: [makeAcceptedQuote('q_unauth_4')],
    });

    const result = await service.getToday(BIZ_ID, null);

    expect(result.needsYou.items.some((entry) => entry.kind === 'ACCEPTED_QUOTE')).toBe(false);
    expect(result.today.acceptedQuotes).toEqual([]);
    expect(quoteFindMany).not.toHaveBeenCalled();
  });
});
