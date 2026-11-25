import { Inject, Injectable, forwardRef } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { LEVEL_RANK, defaultScopesForRole, rankOf } from '../../core/authority/module-vocabulary';
import { keyDisabled } from '../../core/config/env';
import { resolveCrmAccess, visibilityClause } from '../crm/crm-permissions.helper';
import { FinanceOverviewService } from '../finance/finance-overview.service';
import { SafeToSpendService } from '../finance/safe-to-spend.service';
import { ReadyToSendService } from '../commerce/ready-to-send.service';
import { CommerceService } from '../commerce/commerce.service';
import { OPEN_RECEIVABLE_STATUS_LIST } from '../commerce/commerce-stats.service';
import { appliedCreditsOf, balanceOfStoredRows, creditAwareBalance } from '../commerce/invoice-workflow.service';
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
  crmRead: boolean;
  revenueRead: boolean;
  revenueWrite: boolean;
  bookingsRead: boolean;
  storefrontRead: boolean;
  operationsRead: boolean;
  contactVisibility: Prisma.ContactWhereInput | null;
}

const NO_ACCESS: TodayMemberAccess = {
  authenticated: false,
  isSuperAdmin: false,
  crmRead: false,
  revenueRead: false,
  revenueWrite: false,
  bookingsRead: false,
  storefrontRead: false,
  operationsRead: false,
  contactVisibility: null,
};

const DEFAULT_TIMEZONE = 'America/Port_of_Spain';
const MAX_NEEDS_YOU = 5;
const FINANCIAL_APPROVAL_TYPES = new Set(['quote_discount', 'expense', 'refund', 'po']);
const FINANCIAL_PLAN_MODULES = new Set(['finance', 'commerce', 'revenue', 'expenses', 'payroll']);
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

function localDayBoundsUtc(now: Date, timeZone: string): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const year = num('year');
  const month = num('month');
  const day = num('day');
  const hour = num('hour') % 24;
  const minute = num('minute');
  const second = num('second');

  // Offset between local clock in `timeZone` and UTC at `now`
  const localAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMs = localAsUtcMs - Math.floor(now.getTime() / 1000) * 1000;

  const startMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - offsetMs;
  const endMs = Date.UTC(year, month - 1, day, 23, 59, 59, 999) - offsetMs;
  return { start: new Date(startMs), end: new Date(endMs) };
}

function formatCustomerName(contact: { firstName?: string | null; lastName?: string | null } | null | undefined): string | null {
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
        crmRead: true,
        revenueRead: true,
        revenueWrite: true,
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

    const scopes: Record<string, string> =
      membership.permissionScopes && typeof membership.permissionScopes === 'object'
        ? (membership.permissionScopes as Record<string, string>)
        : defaultScopesForRole(membership.role);

    const hasLevel = (mod: string, min: 'read' | 'write') => rankOf(scopes[mod] || 'none') >= LEVEL_RANK[min];

    return {
      authenticated: true,
      isSuperAdmin: false,
      crmRead: hasLevel('crm', 'read'),
      revenueRead: hasLevel('revenue', 'read'),
      revenueWrite: hasLevel('revenue', 'write'),
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
      this.loadClaims(businessId, access),
      this.loadAcceptedQuotes(businessId, access),
      this.loadKeyProposals(businessId, access, reader),
      this.loadApprovalRequests(businessId, access),
      this.loadPlanSteps(businessId, access),
      this.loadTodayBookings(businessId, access, dayStart, dayEnd),
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

  private async loadClaims(businessId: string, access: TodayMemberAccess): Promise<TodayNeedsYouItem[]> {
    if (!access.revenueWrite || !this.commerce) return [];
    const claims = await this.commerce.listPaymentClaims(businessId);
    return claims.map((c) => ({
      id: `claim:${c.id}`,
      kind: 'CLAIM' as const,
      sourceId: c.id,
      title: `${c.customerName ?? 'Customer'} reported payment for ${c.invoiceNumber}`,
      summary: `${c.currency} ${c.amount.toFixed(2)} via ${c.method.replace(/_/g, ' ')}`,
      contactId: c.contactId ?? null,
      customerName: c.customerName ?? null,
      amount: c.amount,
      currency: c.currency,
      createdAt: c.createdAt,
      href: `/app/commerce/invoices?invoiceId=${encodeURIComponent(c.invoiceId)}`,
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
    }));
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
      ...(access.contactVisibility ? { contact: access.contactVisibility } : {}),
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
        contact: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ acceptedAt: 'desc' }, { id: 'desc' }],
      take: 25,
    });

    const todayItems: TodayAcceptedQuoteItem[] = [];
    const needsYouItems: TodayNeedsYouItem[] = [];
    for (const q of quotes) {
      const customerName = formatCustomerName(q.contact);
      const acceptedIso = q.acceptedAt ? q.acceptedAt.toISOString() : q.createdAt.toISOString();
      todayItems.push({
        id: q.id,
        quoteNumber: q.quoteNumber,
        total: Number(q.total),
        currency: q.currency || 'TTD',
        acceptedAt: q.acceptedAt ? q.acceptedAt.toISOString() : null,
        customerName,
        contactId: q.contactId,
      });
      needsYouItems.push({
        id: `quote:${q.id}`,
        kind: 'ACCEPTED_QUOTE',
        sourceId: q.id,
        title: `${customerName ? `${customerName} accepted` : 'Accepted'} Quote ${q.quoteNumber}: Convert to invoice`,
        summary: `${q.currency || 'TTD'} ${Number(q.total).toFixed(2)}`,
        contactId: q.contactId,
        customerName,
        amount: Number(q.total),
        currency: q.currency || 'TTD',
        createdAt: acceptedIso,
        href: `/app/commerce?tab=quotes&quoteId=${encodeURIComponent(q.id)}`,
        actions: [
          {
            label: 'Convert to invoice',
            actionType: 'CONVERT',
            method: 'POST',
            endpoint: `/commerce/businesses/${businessId}/quotes/${q.id}/convert`,
            href: `/app/commerce?tab=quotes&quoteId=${encodeURIComponent(q.id)}`,
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
            endpoint: `/key-autonomy/businesses/${businessId}/proposals/${p.id}/approve`,
          },
          {
            label: 'Reject',
            actionType: 'REJECT',
            method: 'POST',
            endpoint: `/key-autonomy/businesses/${businessId}/proposals/${p.id}/reject`,
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
            endpoint: `/key-autonomy/businesses/${businessId}/proposals/${p.id}/execute`,
          },
        ],
      });
    }
    return items;
  }

  private async loadApprovalRequests(
    businessId: string,
    access: TodayMemberAccess,
  ): Promise<TodayNeedsYouItem[]> {
    if (!access.operationsRead && !access.revenueWrite) return [];
    const rows = await this.prisma.client.approvalRequest.findMany({
      where: { businessId, status: 'pending', migratedToProposalId: null },
      select: {
        id: true,
        requestType: true,
        title: true,
        description: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 25,
    });
    return rows
      .filter((r) => {
        if (FINANCIAL_APPROVAL_TYPES.has(r.requestType)) return access.revenueRead;
        return access.operationsRead;
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
  ): Promise<TodayNeedsYouItem[]> {
    if (!access.operationsRead || keyDisabled()) return [];
    const steps = await this.prisma.client.aiPlanStep.findMany({
      where: {
        requiresApproval: true,
        status: 'pending',
        plan: { businessId },
      },
      select: {
        id: true,
        planId: true,
        action: true,
        description: true,
        module: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 25,
    });
    return steps
      .filter((s) => {
        const mod = (s.module || '').toLowerCase();
        if (FINANCIAL_PLAN_MODULES.has(mod)) return access.revenueRead;
        return true;
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
        actions: [{ label: 'Review', actionType: 'OPEN' as const, href: `/app/plans/${encodeURIComponent(s.planId)}` }],
      }));
  }

  private async loadTodayBookings(
    businessId: string,
    access: TodayMemberAccess,
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
        contact: { select: { firstName: true, lastName: true } },
        service: { select: { name: true } },
      },
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      take: 50,
    });
    return rows.map((b) => ({
      id: b.id,
      startTime: b.startTime.toISOString(),
      endTime: b.endTime.toISOString(),
      status: b.status,
      serviceName: b.service?.name ?? null,
      customerName: formatCustomerName(b.contact),
      contactId: access.crmRead ? b.contactId : null,
    }));
  }

  private async loadTodayInvoices(
    businessId: string,
    access: TodayMemberAccess,
    dayEnd: Date,
    now: Date,
  ): Promise<TodayInvoiceItem[]> {
    if (!access.revenueRead) return [];
    const rows = await this.prisma.client.invoice.findMany({
      where: {
        businessId,
        deletedAt: null,
        status: { in: OPEN_RECEIVABLE_STATUS_LIST },
        OR: [{ status: 'OVERDUE' }, { dueDate: { lte: dayEnd } }],
        ...(access.contactVisibility ? { contact: access.contactVisibility } : {}),
      },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        dueDate: true,
        total: true,
        currency: true,
        contactId: true,
        contact: { select: { firstName: true, lastName: true } },
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
      const remaining = Math.min(balance.remaining, balance.total);
      if (remaining <= 0) continue;

      const isOverdue =
        inv.status === 'OVERDUE' || (inv.dueDate !== null && inv.dueDate.getTime() < now.getTime());

      items.push({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        status: inv.status,
        dueDate: inv.dueDate ? inv.dueDate.toISOString() : null,
        remaining,
        total: Number(inv.total),
        currency: inv.currency || 'TTD',
        customerName: formatCustomerName(inv.contact),
        contactId: inv.contactId,
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
        ...(access.contactVisibility ? { contact: access.contactVisibility } : {}),
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
      total: Number(o.total),
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
    return result.items.map((item) => ({
      kind: item.kind,
      id: item.id,
      contactId: item.contactId,
      customerName: item.customerName,
      whatsappUrl: item.whatsappUrl,
      messageText: item.messageText,
      dueAt: item.dueAt,
      reference: item.reference,
      ...(item.amountDue !== undefined ? { amountDue: item.amountDue } : {}),
      ...(item.currency !== undefined ? { currency: item.currency } : {}),
      ...(item.serviceName !== undefined ? { serviceName: item.serviceName } : {}),
    }));
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
        href: '/app/settings/business',
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
