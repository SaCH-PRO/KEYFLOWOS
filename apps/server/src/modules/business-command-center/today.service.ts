import { Inject, Injectable, forwardRef } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { LEVEL_RANK, memberModuleLevel, rankOf } from '../../core/authority/module-vocabulary';
import { keyDisabled } from '../../core/config/env';
import { graphPlanReadScope } from '../ai/graph-actions.controller';
import {
  type CrmAccess,
  contactVisibilityFilter,
  resolveCrmAccess,
  visibilityClause,
} from '../crm/crm-permissions.helper';
import { FinanceOverviewService } from '../finance/finance-overview.service';
import { SafeToSpendService } from '../finance/safe-to-spend.service';
import { ReadyToSendService } from '../commerce/ready-to-send.service';
import { CommerceService } from '../commerce/commerce.service';
import { OPEN_RECEIVABLE_STATUS_LIST } from '../commerce/commerce-stats.service';
import { appliedCreditsOf, balanceOfStoredRows, creditAwareBalance } from '../commerce/invoice-workflow.service';
import { roundMoney } from '../commerce/money';
import { KeyActionProposalService } from '../key-autonomy/key-action-proposal.service';
import type {
  TodayAcceptedQuoteItem,
  TodayAggregateResponse,
  TodayBookingItem,
  TodayGetSetUpBlock,
  TodayInvoiceItem,
  TodayNeedsYouItem,
  TodayNeedsYouKind,
  TodayOrderItem,
  TodayPulse,
  TodayReminderItem,
  TodayTaskItem,
} from './business-command-center.types';

export interface TodayReader {
  id?: string;
  role?: string;
}

interface TodayMemberAccess {
  authenticated: boolean;
  isSuperAdmin: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  crmAccess: CrmAccess | null;
  /** True when non-owner/non-superadmin has explicit `crm_view: 'owned'` ("my book" restriction). */
  crmBookRestricted: boolean;
  crmRead: boolean;
  revenueRead: boolean;
  revenueWrite: boolean;
  expensesRead: boolean;
  contentRead: boolean;
  bookingsRead: boolean;
  storefrontRead: boolean;
  operationsRead: boolean;
  contactVisibility: Prisma.ContactWhereInput | null;
}

const NO_ACCESS: TodayMemberAccess = {
  authenticated: false,
  isSuperAdmin: false,
  isOwner: false,
  isAdmin: false,
  crmAccess: null,
  crmBookRestricted: false,
  crmRead: false,
  revenueRead: false,
  revenueWrite: false,
  expensesRead: false,
  contentRead: false,
  bookingsRead: false,
  storefrontRead: false,
  operationsRead: false,
  contactVisibility: null,
};

const DEFAULT_TIMEZONE = 'America/Port_of_Spain';
const MAX_NEEDS_YOU = 5;

/**
 * Lowercase allowlist mapping ApprovalRequest.requestType to the module read scope
 * required to view it on Today (D-96 / D-57). Unknown request types fail closed
 * (visible only to OWNER / SUPER_ADMIN).
 */
const APPROVAL_TYPE_SCOPE: Readonly<Record<string, 'revenueRead' | 'expensesRead' | 'contentRead' | 'operationsRead'>> =
  {
    quote_discount: 'revenueRead',
    refund: 'revenueRead',
    expense: 'expensesRead',
    po: 'expensesRead',
    content_delivery: 'contentRead',
    task_completion: 'operationsRead',
    evidence_verification: 'operationsRead',
    time_off: 'operationsRead',
    general: 'operationsRead',
  };

const CLOSED_ORDER_STATUSES = [
  'shipped',
  'delivered',
  'completed',
  'cancelled',
  'refunded',
  'SHIPPED',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
];

const NEEDS_YOU_PRIORITY: Record<TodayNeedsYouKind, number> = {
  CLAIM: 100,
  ACCEPTED_QUOTE: 90,
  APPROVAL_REQUEST: 80,
  KEY_PROPOSAL: 70,
  PLAN_STEP: 60,
};

function resolveValidTimeZone(raw: string | null | undefined): string {
  const candidate = raw?.trim() || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date(0));
    return candidate;
  } catch {
    return 'UTC';
  }
}

function zonedDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: num('year'),
    month: num('month'),
    day: num('day'),
    hour: num('hour') % 24,
    minute: num('minute'),
    second: num('second'),
  };
}

/**
 * Computes midnight (00:00:00.000) of the given calendar date `(year, month, day)` in `timeZone`
 * using two offset-refinement passes so spring-forward and fall-back DST boundaries stay exact.
 */
function zonedMidnightUtc(year: number, month: number, day: number, timeZone: string): Date {
  const targetLocalMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  let guess = targetLocalMs;
  for (let i = 0; i < 2; i++) {
    const gp = zonedDateParts(new Date(guess), timeZone);
    const guessLocalMs = Date.UTC(gp.year, gp.month - 1, gp.day, gp.hour, gp.minute, gp.second, 0);
    const diff = targetLocalMs - guessLocalMs;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

function localDayBoundsUtc(now: Date, timeZone: string): { start: Date; end: Date } {
  const p = zonedDateParts(now, timeZone);
  const start = zonedMidnightUtc(p.year, p.month, p.day, timeZone);
  const nextDayStart = zonedMidnightUtc(p.year, p.month, p.day + 1, timeZone);
  return { start, end: new Date(nextDayStart.getTime() - 1) };
}

function formatCustomerName(
  contact: { firstName?: string | null; lastName?: string | null } | null | undefined,
): string | null {
  if (!contact) return null;
  const joined = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
  return joined.length > 0 ? joined : null;
}

function parseMetaData(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function nonBlankString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

function hasConfiguredBusinessHours(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const entries = Object.values(raw as Record<string, unknown>);
  if (entries.length === 0) return false;
  return entries.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const h = entry as { enabled?: unknown; closed?: unknown; open?: unknown };
    if (h.enabled === true) return true;
    if (h.closed === false) return true;
    return typeof h.open === 'string' && h.open.trim().length > 0 && h.closed !== true;
  });
}

function hasConfiguredPaymentMethod(meta: Record<string, unknown>): boolean {
  if (meta.paymentMethodsConfigured === true) return true;
  // Flat keys written by `/app/settings/business?tab=payments` (`PaymentsTab`)
  if (meta.bankTransferEnabled === true || meta.cashEnabled === true) return true;
  if (nonBlankString(meta.wipayAccountNumber) && nonBlankString(meta.wipayApiKey)) return true;
  if (nonBlankString(meta.paypalClientId) && nonBlankString(meta.paypalClientSecret)) return true;
  if (nonBlankString(meta.stripePublishableKey) && nonBlankString(meta.stripeSecretKey)) return true;

  const paymentConfig = parseMetaData(meta.paymentConfig);
  const providers = ['wipay', 'paypal', 'stripe', 'googlepay', 'cash', 'bankTransfer'];
  return providers.some((key) => {
    const cfg = paymentConfig[key];
    return Boolean(cfg && typeof cfg === 'object' && (cfg as { enabled?: unknown }).enabled === true);
  });
}

@Injectable()
export class TodayService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FinanceOverviewService) private readonly financeOverview: FinanceOverviewService,
    @Inject(SafeToSpendService) private readonly safeToSpend: SafeToSpendService,
    @Inject(ReadyToSendService) private readonly readyToSend: ReadyToSendService,
    @Inject(forwardRef(() => KeyActionProposalService))
    private readonly keyAutonomy: KeyActionProposalService,
    @Inject(forwardRef(() => CommerceService))
    private readonly commerce: CommerceService,
  ) {}

  private async resolveAccess(businessId: string, reader: TodayReader | null): Promise<TodayMemberAccess> {
    if (!reader?.id) return NO_ACCESS;
    const crm = await resolveCrmAccess(this.prisma, businessId, reader.id);
    if (crm.isSuperAdmin || reader.role === 'SUPER_ADMIN') {
      return {
        authenticated: true,
        isSuperAdmin: true,
        isOwner: false,
        isAdmin: false,
        crmAccess: crm,
        crmBookRestricted: false,
        crmRead: true,
        revenueRead: true,
        revenueWrite: true,
        expensesRead: true,
        contentRead: true,
        bookingsRead: true,
        storefrontRead: true,
        operationsRead: true,
        contactVisibility: null,
      };
    }

    const membership = await this.prisma.client.membership.findUnique({
      where: { userId_businessId: { userId: reader.id, businessId } },
      select: { role: true, permissionScopes: true },
    });
    if (!membership) return NO_ACCESS;

    // D-71: read scopes through canonical `memberModuleLevel` (handles null, object map, and array shapes).
    const hasLevel = (mod: string, min: 'read' | 'write') =>
      rankOf(memberModuleLevel(membership, mod)) >= LEVEL_RANK[min];

    const rawScopes =
      membership.permissionScopes &&
      typeof membership.permissionScopes === 'object' &&
      !Array.isArray(membership.permissionScopes)
        ? (membership.permissionScopes as Record<string, unknown>)
        : null;
    const isOwner = membership.role === 'OWNER';
    const crmBookRestricted = !isOwner && rawScopes?.crm_view === 'owned';

    return {
      authenticated: true,
      isSuperAdmin: false,
      isOwner,
      isAdmin: membership.role === 'ADMIN',
      crmAccess: crm,
      crmBookRestricted,
      crmRead: hasLevel('crm', 'read'),
      revenueRead: hasLevel('revenue', 'read'),
      revenueWrite: hasLevel('revenue', 'write'),
      expensesRead: hasLevel('expenses', 'read'),
      contentRead: hasLevel('content', 'read'),
      bookingsRead: hasLevel('bookings', 'read'),
      storefrontRead: hasLevel('storefront', 'read'),
      operationsRead: hasLevel('operations', 'read'),
      contactVisibility: visibilityClause(crm, reader.id) as Prisma.ContactWhereInput | null,
    };
  }

  async getToday(businessId: string, reader: TodayReader | null): Promise<TodayAggregateResponse> {
    const now = new Date();
    const [access, business, productCount, serviceCount] = await Promise.all([
      this.resolveAccess(businessId, reader),
      this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: {
          id: true,
          timezone: true,
          currency: true,
          slug: true,
          storeEnabled: true,
          businessHours: true,
          metaData: true,
        },
      }),
      this.prisma.client.product.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.service.count({ where: { businessId, deletedAt: null } }),
    ]);

    const timezone = resolveValidTimeZone(business?.timezone);
    const { start: dayStart, end: dayEnd } = localDayBoundsUtc(now, timezone);

    const [
      claims,
      acceptedQuotes,
      keyProposals,
      approvalRequests,
      planSteps,
      bookings,
      invoices,
      tasks,
      orders,
      reminders,
      pulse,
    ] = await Promise.all([
      this.loadClaims(businessId, access, reader),
      this.loadAcceptedQuotes(businessId, access),
      this.loadKeyProposals(businessId, access, reader),
      this.loadApprovalRequests(businessId, access, reader),
      this.loadPlanSteps(businessId, access, reader),
      this.loadTodayBookings(businessId, access, reader, dayStart, dayEnd),
      this.loadTodayInvoices(businessId, access, dayEnd, now),
      this.loadTodayTasks(businessId, access, dayEnd),
      this.loadOrdersToFulfil(businessId, access),
      this.loadReminders(businessId, access, reader),
      this.loadPulse(businessId, access),
    ]);

    const allNeedsYou: TodayNeedsYouItem[] = [
      ...claims,
      ...acceptedQuotes.needsYouItems,
      ...approvalRequests,
      ...keyProposals,
      ...planSteps,
    ];

    allNeedsYou.sort((a, b) => {
      const pDiff = NEEDS_YOU_PRIORITY[b.kind] - NEEDS_YOU_PRIORITY[a.kind];
      if (pDiff !== 0) return pDiff;
      const tDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (tDiff !== 0) return tDiff;
      return b.id.localeCompare(a.id);
    });

    const getSetUp = this.buildGetSetUp(business, productCount, serviceCount);

    const counts = {
      bookings: bookings.length,
      invoices: invoices.length,
      acceptedQuotes: acceptedQuotes.todayItems.length,
      tasks: tasks.length,
      orders: orders.length,
      reminders: reminders.length,
      total:
        bookings.length +
        invoices.length +
        acceptedQuotes.todayItems.length +
        tasks.length +
        orders.length +
        reminders.length,
    };

    return {
      businessId,
      generatedAt: now.toISOString(),
      timezone,
      needsYou: {
        items: allNeedsYou.slice(0, MAX_NEEDS_YOU),
        totalCount: allNeedsYou.length,
        hasMore: allNeedsYou.length > MAX_NEEDS_YOU,
      },
      today: {
        bookings,
        invoices,
        acceptedQuotes: acceptedQuotes.todayItems,
        tasks,
        orders,
        reminders,
        counts,
      },
      pulseStatus: access.revenueRead ? 'OK' : 'RESTRICTED',
      pulse,
      getSetUp,
    };
  }

  private async loadClaims(
    businessId: string,
    access: TodayMemberAccess,
    reader: TodayReader | null,
  ): Promise<TodayNeedsYouItem[]> {
    if (!access.revenueWrite || !this.commerce) return [];
    const claims = await this.commerce.listPaymentClaims(businessId);
    if (claims.length === 0) return [];

    const contactIds = claims.map((c) => c.contactId).filter((id): id is string => typeof id === 'string' && id.length > 0);
    // D-63 / M7: check live tenant ownership + contactVisibility for all claim contacts.
    const liveContactIds = new Set<string>();
    if (contactIds.length > 0) {
      const liveRows = await this.prisma.client.contact.findMany({
        where: { businessId, deletedAt: null, id: { in: [...new Set(contactIds)] } },
        select: { id: true },
      });
      for (const r of liveRows) liveContactIds.add(r.id);
    }

    const canOpenContact =
      access.contactVisibility && access.crmAccess && reader?.id
        ? await contactVisibilityFilter(this.prisma, businessId, access.crmAccess, reader.id, contactIds)
        : null;

    const items: TodayNeedsYouItem[] = [];
    for (const c of claims) {
      const isLive = Boolean(c.contactId && liveContactIds.has(c.contactId));
      // If a live contact exists on this claim and is outside the viewer's CRM visibility (PRIVATE or crm_view='owned'),
      // hide the claim (matches loadTodayInvoices & loadAcceptedQuotes under D-63).
      if (isLive && c.contactId && canOpenContact && !canOpenContact(c.contactId)) {
        continue;
      }
      const customerName = isLive ? (c.customerName ?? null) : null;
      const contactId = isLive && access.crmRead ? (c.contactId ?? null) : null;
      items.push({
        id: `claim:${c.id}`,
        kind: 'CLAIM' as const,
        sourceId: c.id,
        title: `${customerName ?? 'Customer'} reported payment for ${c.invoiceNumber}`,
        summary: `${c.currency} ${c.amount.toFixed(2)} via ${c.method.replace(/_/g, ' ')}`,
        contactId,
        customerName,
        amount: c.amount,
        currency: c.currency,
        createdAt: c.createdAt,
        href: `/app/commerce/invoices/${encodeURIComponent(c.invoiceId)}`,
        actions: [
          {
            label: 'Confirm',
            actionType: 'CONFIRM' as const,
            method: 'POST' as const,
            endpoint: `/commerce/businesses/${businessId}/claims/${c.id}/confirm`,
          },
          {
            label: 'Not yet',
            actionType: 'DISMISS' as const,
            method: 'POST' as const,
            endpoint: `/commerce/businesses/${businessId}/claims/${c.id}/dismiss`,
          },
        ],
      });
    }
    return items;
  }

  private async loadAcceptedQuotes(
    businessId: string,
    access: TodayMemberAccess,
  ): Promise<{ needsYouItems: TodayNeedsYouItem[]; todayItems: TodayAcceptedQuoteItem[] }> {
    if (!access.revenueRead) return { needsYouItems: [], todayItems: [] };
    const where: Prisma.QuoteWhereInput = {
      businessId,
      deletedAt: null,
      status: 'ACCEPTED',
      invoiceId: null,
      invoice: { is: null },
      ...(access.contactVisibility
        ? { contact: { businessId, deletedAt: null, AND: [access.contactVisibility] } }
        : {}),
    };
    const quotes = await this.prisma.client.quote.findMany({
      where,
      select: {
        id: true,
        quoteNumber: true,
        total: true,
        currency: true,
        acceptedAt: true,
        createdAt: true,
        contactId: true,
        contact: { select: { businessId: true, deletedAt: true, firstName: true, lastName: true } },
      },
      orderBy: [{ acceptedAt: 'desc' }, { id: 'desc' }],
      take: 25,
    });

    const todayItems: TodayAcceptedQuoteItem[] = [];
    const needsYouItems: TodayNeedsYouItem[] = [];
    for (const q of quotes) {
      const liveContact = q.contact && q.contact.businessId === businessId && q.contact.deletedAt === null ? q.contact : null;
      const customerName = formatCustomerName(liveContact);
      const visibleContactId = liveContact && access.crmRead ? q.contactId : null;
      const acceptedIso = q.acceptedAt ? q.acceptedAt.toISOString() : q.createdAt.toISOString();
      // P214 (FU-TODAY-QUOTE-HREF / COR-3): commerce/page.tsx reads `tab=quotes` + `recordType=quote&recordId=<id>`
      // (and strips recordType/recordId on drawer close); it does not read `quoteId`.
      const quoteHref = `/app/commerce?tab=quotes&recordType=quote&recordId=${encodeURIComponent(q.id)}`;
      todayItems.push({
        id: q.id,
        quoteNumber: q.quoteNumber,
        total: Number(q.total),
        currency: q.currency || 'TTD',
        acceptedAt: q.acceptedAt ? q.acceptedAt.toISOString() : null,
        customerName,
        contactId: visibleContactId,
      });
      needsYouItems.push({
        id: `quote:${q.id}`,
        kind: 'ACCEPTED_QUOTE',
        sourceId: q.id,
        title: `${customerName ? `${customerName} accepted` : 'Accepted'} Quote ${q.quoteNumber}: Convert to invoice`,
        summary: `${q.currency || 'TTD'} ${Number(q.total).toFixed(2)}`,
        contactId: visibleContactId,
        customerName,
        amount: Number(q.total),
        currency: q.currency || 'TTD',
        createdAt: acceptedIso,
        href: quoteHref,
        actions: access.revenueWrite
          ? [
              {
                label: 'Convert to invoice',
                actionType: 'CONVERT',
                method: 'POST',
                endpoint: `/commerce/businesses/${businessId}/quotes/${q.id}/convert`,
                href: quoteHref,
              },
            ]
          : [
              {
                label: 'View quote',
                actionType: 'OPEN',
                href: quoteHref,
              },
            ],
      });
    }
    return { needsYouItems, todayItems };
  }

  private async loadKeyProposals(
    businessId: string,
    access: TodayMemberAccess,
    reader: TodayReader | null,
  ): Promise<TodayNeedsYouItem[]> {
    if (!access.authenticated || keyDisabled()) return [];
    const [pending, approved] = await Promise.all([
      this.keyAutonomy.listForReader(businessId, { status: 'PENDING' }, reader),
      this.keyAutonomy.listForReader(businessId, { status: 'APPROVED' }, reader),
    ]);

    const items: TodayNeedsYouItem[] = [];
    for (const p of pending) {
      const createdAt = typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString();
      items.push({
        id: `proposal:${p.id}`,
        kind: 'KEY_PROPOSAL',
        sourceId: p.id,
        title: p.title,
        summary: p.description || 'KEY action awaiting approval',
        contactId: null,
        customerName: null,
        createdAt,
        href: '/app/key-autonomy',
        actions: [
          {
            label: 'Approve',
            actionType: 'APPROVE',
            method: 'POST',
            endpoint: `/key-autonomy/businesses/${businessId}/actions/proposals/${p.id}/approve`,
          },
          {
            label: 'Reject',
            actionType: 'REJECT',
            method: 'POST',
            endpoint: `/key-autonomy/businesses/${businessId}/actions/proposals/${p.id}/reject`,
          },
        ],
      });
    }
    for (const p of approved) {
      const createdAt = typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString();
      items.push({
        id: `proposal:${p.id}`,
        kind: 'KEY_PROPOSAL',
        sourceId: p.id,
        title: p.title,
        summary: p.description || 'Approved KEY action ready to run',
        contactId: null,
        customerName: null,
        createdAt,
        href: '/app/key-autonomy',
        actions: [
          {
            label: 'Run',
            actionType: 'EXECUTE',
            method: 'POST',
            endpoint: `/key-autonomy/businesses/${businessId}/actions/proposals/${p.id}/execute`,
          },
        ],
      });
    }
    return items;
  }

  private async loadApprovalRequests(
    businessId: string,
    access: TodayMemberAccess,
    reader: TodayReader | null,
  ): Promise<TodayNeedsYouItem[]> {
    if (!access.authenticated || !reader?.id) return [];
    const canSeeAllBusinessApprovals = access.isOwner || access.isAdmin || access.isSuperAdmin;
    const rows = await this.prisma.client.approvalRequest.findMany({
      where: {
        businessId,
        status: 'pending',
        migratedToProposalId: null,
        ...(!canSeeAllBusinessApprovals
          ? {
              steps: {
                some: {
                  status: 'pending',
                  OR: [{ approverId: reader.id }, { delegatedTo: reader.id }],
                },
              },
            }
          : {}),
      },
      select: {
        id: true,
        requestType: true,
        title: true,
        description: true,
        currentStep: true,
        createdAt: true,
        steps: {
          select: {
            stepOrder: true,
            status: true,
            approverId: true,
            delegatedTo: true,
          },
          orderBy: [{ stepOrder: 'asc' }, { id: 'asc' }],
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 25,
    });
    return rows
      .filter((r) => {
        if (!canSeeAllBusinessApprovals) {
          const currentStep = r.steps.find((s) => s.stepOrder === r.currentStep && s.status === 'pending');
          if (!currentStep || (currentStep.approverId !== reader.id && currentStep.delegatedTo !== reader.id)) {
            return false;
          }
        }
        const normalizedType = (r.requestType || '').trim().toLowerCase();
        const requiredScope = Object.prototype.hasOwnProperty.call(APPROVAL_TYPE_SCOPE, normalizedType)
          ? APPROVAL_TYPE_SCOPE[normalizedType]
          : null;
        if (!requiredScope) {
          // Fail closed for unknown approval types.
          return access.isOwner || access.isSuperAdmin;
        }
        return access[requiredScope];
      })
      .map((r) => ({
        id: `approval:${r.id}`,
        kind: 'APPROVAL_REQUEST' as const,
        sourceId: r.id,
        title: r.title,
        summary: r.description || `Pending ${r.requestType.replace(/_/g, ' ')} request`,
        contactId: null,
        customerName: null,
        createdAt: r.createdAt.toISOString(),
        href: '/app/governance-flow',
        actions: [{ label: 'Review', actionType: 'OPEN' as const, href: '/app/governance-flow' }],
      }));
  }

  private async loadPlanSteps(
    businessId: string,
    access: TodayMemberAccess,
    reader: TodayReader | null,
  ): Promise<TodayNeedsYouItem[]> {
    if (!access.authenticated || !reader?.id || keyDisabled()) return [];
    // D-74 / SEC-R3a-1: reuse canonical graphPlanReadScope for plan ownership & per-step module authority.
    const mayRead = await graphPlanReadScope(this.prisma, businessId, {
      id: reader.id,
      role: reader.role,
    });
    const steps = await this.prisma.client.aiPlanStep.findMany({
      where: {
        requiresApproval: true,
        status: { in: ['pending', 'awaiting_approval'] },
        plan: {
          businessId,
          status: { in: ['draft', 'pending', 'running', 'awaiting_approval'] },
          ...(!mayRead.seesEveryPlan ? { userId: reader.id } : {}),
        },
      },
      select: {
        id: true,
        planId: true,
        action: true,
        description: true,
        module: true,
        toolName: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 25,
    });
    return steps
      .filter((s) => {
        if (s.toolName) return mayRead.step(s.toolName);
        if (s.module) return mayRead.cortexStep(s.module);
        return false;
      })
      .map((s) => ({
        id: `plan-step:${s.id}`,
        kind: 'PLAN_STEP' as const,
        sourceId: s.id,
        title: s.action,
        summary: s.description || 'Plan step awaiting approval',
        contactId: null,
        customerName: null,
        createdAt: s.createdAt.toISOString(),
        href: `/app/plans/${encodeURIComponent(s.planId)}`,
        actions: [
          {
            label: 'Review',
            actionType: 'OPEN' as const,
            href: `/app/plans/${encodeURIComponent(s.planId)}`,
          },
        ],
      }));
  }

  private async loadTodayBookings(
    businessId: string,
    access: TodayMemberAccess,
    reader: TodayReader | null,
    dayStart: Date,
    dayEnd: Date,
  ): Promise<TodayBookingItem[]> {
    if (!access.bookingsRead) return [];
    const rows = await this.prisma.client.booking.findMany({
      where: {
        businessId,
        deletedAt: null,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        startTime: { gte: dayStart, lte: dayEnd },
      },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        status: true,
        contactId: true,
        contact: {
          select: {
            id: true,
            businessId: true,
            deletedAt: true,
            visibility: true,
            ownerId: true,
            firstName: true,
            lastName: true,
          },
        },
        service: { select: { name: true } },
      },
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      take: 50,
    });

    const canViewAll = access.isOwner || access.isSuperAdmin;
    const readerId = reader?.id ?? null;

    // If explicitly restricted to "my book" (`crm_view: 'owned'`), run canonical contactVisibilityFilter.
    const bookFilter =
      !canViewAll && access.crmBookRestricted && access.crmAccess && readerId
        ? await contactVisibilityFilter(
            this.prisma,
            businessId,
            access.crmAccess,
            readerId,
            rows.map((r) => r.contactId),
          )
        : null;

    // For non-owner callers without `crm_view: 'owned'`, enforce PRIVATE contact hiding (R28-ST-01 / M7).
    const sharedPrivateIds = new Set<string>();
    if (!canViewAll && !bookFilter && readerId) {
      const unownedPrivateIds = rows
        .map((r) => r.contact)
        .filter(
          (c): c is NonNullable<(typeof rows)[number]['contact']> =>
            Boolean(c && c.businessId === businessId && c.deletedAt === null && c.visibility === 'PRIVATE' && c.ownerId !== readerId),
        )
        .map((c) => c.id);
      if (unownedPrivateIds.length > 0) {
        const shares = await this.prisma.client.contactShare.findMany({
          where: { userId: readerId, contactId: { in: [...new Set(unownedPrivateIds)] } },
          select: { contactId: true },
        });
        for (const s of shares) sharedPrivateIds.add(s.contactId);
      }
    }

    return rows.map((b) => {
      const c = b.contact;
      let contactVisible = Boolean(c && c.businessId === businessId && c.deletedAt === null);
      if (contactVisible && c && !canViewAll) {
        if (bookFilter) {
          contactVisible = bookFilter(c.id);
        } else if (c.visibility === 'PRIVATE') {
          contactVisible = Boolean(readerId && (c.ownerId === readerId || sharedPrivateIds.has(c.id)));
        }
      }
      return {
        id: b.id,
        startTime: b.startTime.toISOString(),
        endTime: b.endTime.toISOString(),
        status: b.status,
        serviceName: b.service?.name ?? null,
        customerName: contactVisible ? formatCustomerName(c) : null,
        contactId: contactVisible && access.crmRead ? b.contactId : null,
      };
    });
  }

  private async loadTodayInvoices(
    businessId: string,
    access: TodayMemberAccess,
    dayEnd: Date,
    now: Date,
  ): Promise<TodayInvoiceItem[]> {
    if (!access.revenueRead) return [];
    const where: Prisma.InvoiceWhereInput = {
      businessId,
      deletedAt: null,
      status: { in: OPEN_RECEIVABLE_STATUS_LIST },
      AND: [
        { OR: [{ status: 'OVERDUE' }, { dueDate: { lte: dayEnd } }] },
        ...(access.contactVisibility
          ? [{ contact: { businessId, deletedAt: null, AND: [access.contactVisibility] } }]
          : []),
      ],
    };
    const rows = await this.prisma.client.invoice.findMany({
      where,
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        dueDate: true,
        total: true,
        currency: true,
        contactId: true,
        contact: { select: { businessId: true, deletedAt: true, firstName: true, lastName: true } },
        payments: { where: { businessId }, select: { amount: true, status: true } },
      },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      take: 50,
    });

    const items: TodayInvoiceItem[] = [];
    for (const inv of rows) {
      const credited = await appliedCreditsOf(this.prisma.client as unknown as Prisma.TransactionClient, {
        id: inv.id,
        businessId,
        status: inv.status,
      });
      const balance = creditAwareBalance(
        balanceOfStoredRows(Number(inv.total), inv.payments, inv.currency),
        credited,
      );
      // D-250: cap remaining at net-of-credits total (matches CommerceStatsService).
      const netCap = Math.max(0, roundMoney(balance.total - balance.credited));
      const remaining = Math.min(balance.remaining, netCap);
      if (remaining <= 0) continue;

      const isOverdue =
        inv.status === 'OVERDUE' || (inv.dueDate !== null && inv.dueDate.getTime() < now.getTime());
      const liveContact =
        inv.contact && inv.contact.businessId === businessId && inv.contact.deletedAt === null ? inv.contact : null;

      items.push({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        status: inv.status,
        dueDate: inv.dueDate ? inv.dueDate.toISOString() : null,
        remaining,
        total: Number(inv.total),
        currency: inv.currency || 'TTD',
        customerName: formatCustomerName(liveContact),
        contactId: liveContact && access.crmRead ? inv.contactId : null,
        isOverdue,
      });
    }
    return items;
  }

  private async loadTodayTasks(
    businessId: string,
    access: TodayMemberAccess,
    dayEnd: Date,
  ): Promise<TodayTaskItem[]> {
    if (!access.crmRead) return [];
    const rows = await this.prisma.client.contactTask.findMany({
      where: {
        businessId,
        deletedAt: null,
        status: 'OPEN',
        dueDate: { lte: dayEnd },
        contact: {
          businessId,
          deletedAt: null,
          ...(access.contactVisibility ? { AND: [access.contactVisibility] } : {}),
        },
      },
      select: {
        id: true,
        title: true,
        dueDate: true,
        priority: true,
        contactId: true,
        contact: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      take: 50,
    });
    return rows.map((t) => ({
      id: t.id,
      title: t.title,
      dueDate: t.dueDate ? t.dueDate.toISOString() : null,
      priority: t.priority,
      contactId: t.contactId,
      customerName: formatCustomerName(t.contact),
    }));
  }

  private async loadOrdersToFulfil(
    businessId: string,
    access: TodayMemberAccess,
  ): Promise<TodayOrderItem[]> {
    if (!access.storefrontRead) return [];
    const rows = await this.prisma.client.marketplaceOrder.findMany({
      where: {
        businessId,
        paymentStatus: 'PAID',
        status: { notIn: CLOSED_ORDER_STATUSES },
      },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        total: true,
        currency: true,
        customerName: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    return rows.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      // D-57 / D-100 / D-234: withhold PAID order monetary totals below revenue:read.
      total: access.revenueRead ? Number(o.total) : null,
      currency: o.currency || 'TTD',
      customerName: o.customerName || null,
      createdAt: o.createdAt.toISOString(),
    }));
  }

  private async loadReminders(
    businessId: string,
    access: TodayMemberAccess,
    reader: TodayReader | null,
  ): Promise<TodayReminderItem[]> {
    if (!access.authenticated) return [];
    const result = await this.readyToSend.listDue(businessId, reader);
    if (result.items.length === 0) return [];

    // M7 / D-63: ReadyToSendService already hides PRIVATE/soft-deleted/cross-tenant contacts,
    // and here we also enforce `crm_view: 'owned'` (for all reminders) and `contactVisibility` (for invoice reminders).
    const needVisFilter =
      !access.isOwner &&
      !access.isSuperAdmin &&
      Boolean(access.crmAccess && reader?.id) &&
      (access.crmBookRestricted || Boolean(access.contactVisibility));
    const canOpenContact =
      needVisFilter && access.crmAccess && reader?.id
        ? await contactVisibilityFilter(
            this.prisma,
            businessId,
            access.crmAccess,
            reader.id,
            result.items.map((item) => item.contactId),
          )
        : null;

    const filtered: TodayReminderItem[] = [];
    for (const item of result.items) {
      if (canOpenContact) {
        const mustRestrict = access.crmBookRestricted || item.kind === 'invoice';
        if (mustRestrict && (!item.contactId || !canOpenContact(item.contactId))) {
          continue;
        }
      }
      filtered.push({
        kind: item.kind,
        id: item.id,
        contactId: access.crmRead ? item.contactId : null,
        customerName: item.customerName,
        whatsappUrl: item.whatsappUrl,
        messageText: item.messageText,
        dueAt: item.dueAt,
        reference: item.reference,
        ...(item.amountDue !== undefined ? { amountDue: item.amountDue } : {}),
        ...(item.currency !== undefined ? { currency: item.currency } : {}),
        ...(item.serviceName !== undefined ? { serviceName: item.serviceName } : {}),
      });
    }
    return filtered;
  }

  private async loadPulse(
    businessId: string,
    access: TodayMemberAccess,
  ): Promise<TodayPulse | null> {
    // D-57: Pulse is gated strictly on revenue:read.
    if (!access.revenueRead) return null;
    // Run overview before safeToSpend: both invoke FinancialAccountSeederService.ensureDefaults
    // on a fresh business, which races on (business_id, name) if called concurrently.
    // Pass null viewer: loadPulse reads only the business headline scalars (never overview.actions).
    const overview = await this.financeOverview.getOverview(businessId, null);
    const sts = await this.safeToSpend.calculate(businessId);
    return {
      cash: overview.cashBalance,
      cashBasis: overview.cashBasis,
      cashCurrency: overview.cashCurrency,
      otherCurrencyCash: overview.otherCurrencyCash,
      owedToYou: overview.outstandingInvoices,
      owedCount: overview.outstandingInvoiceCount,
      overdueAmount: overview.overdueInvoices,
      overdueCount: overview.overdueInvoiceCount,
      youOwe: overview.billsDue,
      youOweCount: overview.billsDueCount,
      monthRevenue: overview.revenueThisMonth,
      monthExpenses: overview.expensesThisMonth,
      monthProfit: overview.netProfitThisMonth,
      safeToSpend: sts.safeToSpend,
      currency: overview.currency,
    };
  }

  private buildGetSetUp(
    business: {
      slug: string | null;
      storeEnabled: boolean;
      businessHours: unknown;
      metaData: unknown;
    } | null,
    productCount: number,
    serviceCount: number,
  ): TodayGetSetUpBlock {
    const meta = parseMetaData(business?.metaData);
    const steps: TodayGetSetUpBlock['steps'] = [
      {
        key: 'catalog',
        label: 'Add a product or service',
        done: productCount > 0 || serviceCount > 0,
        href: '/app/settings/catalog',
      },
      {
        key: 'hours',
        label: 'Set your business hours',
        done: hasConfiguredBusinessHours(business?.businessHours),
        href: '/app/profile',
      },
      {
        key: 'payments',
        label: 'Set up a payment method',
        done: hasConfiguredPaymentMethod(meta),
        href: '/app/settings/business?tab=payments',
      },
      {
        key: 'share_link',
        label: 'Share your booking or store link',
        done: Boolean(business?.slug && business.slug.trim().length > 0 && business.storeEnabled),
        href: '/app/store',
      },
    ];
    return {
      complete: steps.every((s) => s.done),
      steps,
    };
  }
}
