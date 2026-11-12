import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { LEVEL_RANK, defaultScopesForRole, rankOf } from '../../core/authority/module-vocabulary';
import { CashPositionService, otherCurrencyCash } from '../finance/cash-position.service';
import { getBusinessFinancialSnapshotRevision } from '../finance/finance-accounting.util';
import { normalizeCurrency } from '../finance/posting.service';

export interface GraphEntityLink {
  fromType: string;
  fromId: string;
  toType: string;
  toId: string;
  relation: string;
  meta?: Record<string, any>;
}

export interface GraphContactSummary {
  id: string;
  name: string;
  email: string | null;
  status: string;
  revenue: number;
  invoiceIds: string[];
  bookingIds: string[];
  projectIds: string[];
}

export interface GraphInvoiceSummary {
  id: string;
  number: string | null;
  status: string;
  total: number;
  dueDate: string | null;
  contactId: string | null;
  contactName: string | null;
}

export interface GraphProductSummary {
  id: string;
  name: string;
  price: number;
  category: string;
  isActive: boolean;
  serviceId: string | null;
  storefrontListed: boolean;
}

export interface BusinessGraphSnapshot {
  businessId: string;
  timestamp: Date;
  business: {
    name: string;
    industry: string | null;
    archetype: string | null;
    revenueModel: string | null;
    currency: string;
    stage: string | null;
    teamSize: string | null;
  };
  contacts: {
    total: number;
    byStatus: Record<string, number>;
    recentCount: number;
    staleLeadCount: number;
    topClients: Array<{ id: string; name: string; revenue: number }>;
  };
  revenue: {
    totalCollected: number;
    outstandingAmount: number;
    outstandingCount: number;
    overdueCount: number;
    overdueAmount: number;
    monthlyRevenue: number;
    averageInvoiceValue: number;
  };
  bookings: {
    upcomingCount: number;
    completedThisMonth: number;
    cancelledThisMonth: number;
    utilizationRate: number;
  };
  expenses: {
    totalThisMonth: number;
    topCategories: Array<{ name: string; amount: number }>;
    budgetUtilization: number;
  };
  projects: {
    activeCount: number;
    overdueTaskCount: number;
    completionRate: number;
  };
  content: {
    draftPostCount: number;
    scheduledPostCount: number;
    draftCampaignCount: number;
  };
  automations: {
    activeCount: number;
    disabledCount: number;
    totalRuns: number;
  };
  storefront: {
    activeProductCount: number;
    averagePrice: number;
  };
  /**
   * PR195-PORT (owner PR #195 part 4): treasury sight. Present only in a
   * snapshot projected for a viewer with revenue read (D-57: the safe-to-spend
   * read, which carries these same figures). Cash is the ledger cash position
   * (V1-34); every amount is in the business currency and an amount in another
   * currency is named in otherCurrencies, never added or converted (D-13).
   */
  treasury?: {
    currency: string;
    cashBalance: number;
    cashBasis: 'ledger';
    unpaidBillsAmount: number;
    unpaidBillsCount: number;
    committedPayrollAmount: number;
    committedPayrollRuns: number;
    otherCurrencies: Array<{ currency: string; cash: number; unpaidBills: number; committedPayroll: number }>;
  };
  /** PR195-PORT: open deals. Present only for a viewer with crm read (GET crm deals). */
  pipeline?: {
    currency: string;
    openDealCount: number;
    openPipelineValue: number;
    otherCurrencies: Array<{ currency: string; value: number }>;
  };
  /** PR195-PORT: open support tickets. Present only for a viewer with operations read (KEY's helpdesk tools). */
  support?: {
    openTicketCount: number;
  };
  momentumScore: number;
  healthIndicators: Array<{ area: string; status: 'good' | 'warning' | 'critical'; detail: string }>;
  links: GraphEntityLink[];
  entities: {
    topContacts: GraphContactSummary[];
    overdueInvoices: GraphInvoiceSummary[];
    catalogProducts: GraphProductSummary[];
  };
}

const CACHE_TTL_MS = 120_000;

/** The health-indicator area of the treasury alerts, shown only with treasury sight. */
const TREASURY_AREA = 'treasury';

/** Rows read per page by readAll (the client caps an unbounded findMany at 1000 rows). */
const PAGE_SIZE = 1000;

/** The support ticket statuses that are open work (schema: OPEN, IN_PROGRESS, WAITING; legacy lower-case rows too). */
const OPEN_TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING', 'open', 'in_progress', 'waiting'];

/**
 * PR195-PORT: which of the KEY standing context's money and work figures a
 * viewer may see, by the rule the head applies to the equivalent REST read:
 *   - treasury (ledger cash, unpaid bills, committed payroll, the treasury
 *     alert): revenue read, the safe-to-spend gate (D-57) that serves the same
 *     cash, bills and payroll reserve;
 *   - pipeline (open deals and their value): crm read (GET crm deals);
 *   - support (open tickets): operations read, KEY's helpdesk tools (the
 *     stricter of the two head rules: the REST ticket list checks membership
 *     only).
 */
export interface KeyContextSight {
  treasury: boolean;
  pipeline: boolean;
  support: boolean;
}

const NO_SIGHT: KeyContextSight = { treasury: false, pipeline: false, support: false };

/**
 * PR195-PORT: `userId`'s KeyContextSight in `businessId`, read as ModuleScopeGuard
 * reads a membership: its explicit permissionScopes map (a key it lacks is none),
 * else its role's defaults. No viewer, or no membership (a platform SUPER_ADMIN
 * who is not a member included), sees none of them. An OWNER membership with an
 * explicit map is bound by it (D-140); the recorded owner field grants nothing
 * (D-125).
 */
export async function keyContextSight(
  prisma: PrismaService,
  businessId: string,
  userId: string | null | undefined,
): Promise<KeyContextSight> {
  if (!userId) return NO_SIGHT;
  const membership = await prisma.client.membership.findUnique({
    where: { userId_businessId: { userId, businessId } },
    select: { role: true, permissionScopes: true },
  });
  if (!membership) return NO_SIGHT;
  const scopes: Record<string, string> =
    membership.permissionScopes && typeof membership.permissionScopes === 'object' && !Array.isArray(membership.permissionScopes)
      ? (membership.permissionScopes as Record<string, string>)
      : defaultScopesForRole(membership.role);
  const reads = (module: string) => rankOf(scopes[module] || 'none') >= LEVEL_RANK.read;
  return { treasury: reads('revenue'), pipeline: reads('crm'), support: reads('operations') };
}

/** A money figure as the context string says it: the currency code and two decimals. */
function money(currency: string, amount: number): string {
  return `${currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const toCents = (value: unknown) => Math.round(Number(value ?? 0) * 100);
const fromCents = (cents: number) => cents / 100;

/** Every row of a paged read (cursor on id), past the client's 1000-row cap. */
async function readAll<T>(page: (cursor: string | undefined) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const rows = (await page(cursor)) ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    const last = (rows[rows.length - 1] as { id?: string }).id;
    if (!last) break;
    cursor = last;
  }
  return out;
}

/** Sum `rows` in cents per normalized currency, `fallback` for a row with none. */
function centsByCurrency<T>(rows: T[], amount: (r: T) => unknown, currency: (r: T) => string | null | undefined, fallback: string) {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const code = normalizeCurrency(currency(r)) || fallback;
    totals.set(code, (totals.get(code) ?? 0) + toCents(amount(r)));
  }
  return totals;
}

@Injectable()
export class BusinessGraphService {
  private readonly logger = new Logger(BusinessGraphService.name);
  /** The full snapshot per business (sections every viewer may not see included); never served as is. */
  private readonly cache = new Map<string, { data: BusinessGraphSnapshot; expiresAt: number; revision: number }>();
  private readonly cashPosition: CashPositionService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    // PR195-PORT: the ledger cash position (V1-34). Optional so hand-built
    // instances keep constructing; they read the same ledger through their own.
    @Optional() @Inject(CashPositionService) cashPosition?: CashPositionService | null,
  ) {
    this.cashPosition = cashPosition ?? new CashPositionService(prisma);
  }

  /**
   * The business snapshot. With no `opts.viewerId` it is the shared snapshot
   * every caller has always read (REST graph routes, the control tower, the
   * other KEY services): it carries no treasury, pipeline or support figures
   * and no treasury alert. With `opts.viewerId` (KEY chat for the member
   * talking to it) it carries those of them the member may read
   * (keyContextSight). PR195-PORT (owner PR #195 part 4).
   *
   * Cached for two minutes per business, and assembled afresh once a ledger
   * posting, a payroll run or a cash account changed the business's financial
   * snapshot revision (finance-accounting.util.ts).
   */
  async getSnapshot(
    businessId: string,
    forceRefresh = false,
    opts: { viewerId?: string | null } = {},
  ): Promise<BusinessGraphSnapshot> {
    const full = await this.fullSnapshot(businessId, forceRefresh);
    const sight = opts.viewerId ? await keyContextSight(this.prisma, businessId, opts.viewerId) : NO_SIGHT;
    return this.project(full, sight);
  }

  /** getSnapshot projected for `viewerId` (no viewer: the shared snapshot). PR195-PORT. */
  async getSnapshotForViewer(
    businessId: string,
    viewerId: string | null | undefined,
    forceRefresh = false,
  ): Promise<BusinessGraphSnapshot> {
    return this.getSnapshot(businessId, forceRefresh, { viewerId: viewerId ?? null });
  }

  invalidateCache(businessId: string): void {
    this.cache.delete(businessId);
  }

  private async fullSnapshot(businessId: string, forceRefresh: boolean): Promise<BusinessGraphSnapshot> {
    const revision = getBusinessFinancialSnapshotRevision(businessId);
    if (!forceRefresh) {
      const cached = this.cache.get(businessId);
      if (cached && cached.expiresAt > Date.now() && cached.revision === revision) {
        return cached.data;
      }
    }
    const snapshot = await this.assembleSnapshot(businessId);
    this.cache.set(businessId, { data: snapshot, expiresAt: Date.now() + CACHE_TTL_MS, revision });
    return snapshot;
  }

  /** A copy of `full` holding only the sections `sight` allows; the cached object is never changed. */
  private project(full: BusinessGraphSnapshot, sight: KeyContextSight): BusinessGraphSnapshot {
    const { treasury, pipeline, support, healthIndicators, ...rest } = full;
    return {
      ...rest,
      ...(sight.treasury && treasury ? { treasury } : {}),
      ...(sight.pipeline && pipeline ? { pipeline } : {}),
      ...(sight.support && support ? { support } : {}),
      healthIndicators: sight.treasury ? healthIndicators : healthIndicators.filter((h) => h.area !== TREASURY_AREA),
    };
  }

  private async assembleSnapshot(businessId: string): Promise<BusinessGraphSnapshot> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const db = this.prisma.client;

    const [
      business,
      contactTotal,
      contactsByStatus,
      recentContactCount,
      staleLeadCount,
      paidInvoicesTotal,
      outstandingInvoices,
      overdueInvoices,
      monthlyPaid,
      invoiceCount,
      upcomingBookings,
      completedBookingsMonth,
      cancelledBookingsMonth,
      totalBookingsMonth,
      expensesMonth,
      expensesByCategory,
      totalBudget,
      activeProjects,
      overdueProjectTasks,
      completedProjectTasks,
      totalProjectTasks,
      draftPosts,
      scheduledPosts,
      draftCampaigns,
      activeAutomations,
      disabledAutomations,
      automationRuns,
      activeProducts,
      avgProductPrice,
    ] = await Promise.all([
      db.business.findUnique({
        where: { id: businessId },
        select: { name: true, industry: true, archetype: true, revenueModel: true, currency: true, businessStage: true, teamSize: true },
      }),
      db.contact.count({ where: { businessId, deletedAt: null } }),
      db.contact.groupBy({ by: ['status'], where: { businessId, deletedAt: null }, _count: true }),
      db.contact.count({ where: { businessId, deletedAt: null, createdAt: { gte: sevenDaysAgo } } }),
      db.contact.count({ where: { businessId, deletedAt: null, status: 'LEAD', updatedAt: { lt: sevenDaysAgo } } }),
      db.invoice.aggregate({ where: { businessId, deletedAt: null, status: 'PAID' }, _sum: { total: true } }),
      db.invoice.aggregate({ where: { businessId, deletedAt: null, status: { in: ['SENT', 'DRAFT'] } }, _sum: { total: true }, _count: true }),
      db.invoice.aggregate({ where: { businessId, deletedAt: null, status: { in: ['SENT', 'DRAFT'] }, dueDate: { lt: now } }, _sum: { total: true }, _count: true }),
      db.invoice.aggregate({ where: { businessId, deletedAt: null, status: 'PAID', paidAt: { gte: startOfMonth } }, _sum: { total: true } }),
      db.invoice.count({ where: { businessId, deletedAt: null, status: 'PAID' } }),
      db.booking.count({ where: { businessId, deletedAt: null, startTime: { gte: now }, status: { in: ['PENDING', 'CONFIRMED'] } } }),
      db.booking.count({ where: { businessId, deletedAt: null, status: 'COMPLETED', startTime: { gte: startOfMonth } } }),
      db.booking.count({ where: { businessId, deletedAt: null, status: 'CANCELLED', startTime: { gte: startOfMonth } } }),
      db.booking.count({ where: { businessId, deletedAt: null, startTime: { gte: startOfMonth } } }),
      db.expense.aggregate({ where: { businessId, deletedAt: null, date: { gte: startOfMonth } }, _sum: { amount: true } }),
      db.expense.groupBy({
        by: ['categoryId'],
        where: { businessId, deletedAt: null, date: { gte: startOfMonth } },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 5,
      }),
      db.expenseBudget.aggregate({ where: { businessId }, _sum: { amount: true } }),
      db.project.count({ where: { businessId, deletedAt: null, status: { in: ['ACTIVE', 'IN_PROGRESS'] } } }),
      db.projectTask.count({ where: { businessId, deletedAt: null, isCompleted: false, dueDate: { lt: now } } }),
      db.projectTask.count({ where: { businessId, deletedAt: null, isCompleted: true } }),
      db.projectTask.count({ where: { businessId, deletedAt: null } }),
      db.socialPost.count({ where: { businessId, deletedAt: null, status: 'DRAFT' } }),
      db.socialPost.count({ where: { businessId, deletedAt: null, status: 'SCHEDULED' } }),
      db.emailCampaign.count({ where: { businessId, deletedAt: null, status: 'DRAFT' } }),
      db.automation.count({ where: { businessId, deletedAt: null, enabled: true } }),
      db.automation.count({ where: { businessId, deletedAt: null, enabled: false } }),
      db.automation.aggregate({ where: { businessId, deletedAt: null }, _sum: { runCount: true } }),
      db.product.count({ where: { businessId, deletedAt: null, isActive: true } }),
      db.product.aggregate({ where: { businessId, deletedAt: null, isActive: true }, _avg: { price: true } }),
    ]);

    // PR195-PORT (owner PR #195 part 4): treasury, pipeline and support figures.
    // Computed for the cache; served only to a viewer who may read them (project).
    const sight = await this.assembleSight(businessId, business?.currency);

    const statusMap: Record<string, number> = {};
    for (const s of contactsByStatus) {
      statusMap[s.status] = s._count;
    }

    const totalRevenue = paidInvoicesTotal._sum.total ?? 0;
    const outstandingAmt = outstandingInvoices._sum.total ?? 0;
    const overdueAmt = overdueInvoices._sum.total ?? 0;
    const monthlyRev = monthlyPaid._sum.total ?? 0;
    const avgInvoice = invoiceCount > 0 ? totalRevenue / invoiceCount : 0;
    const totalExpMonth = expensesMonth._sum.amount ?? 0;
    const totalBudgetAmt = totalBudget._sum.amount ?? 0;
    const budgetUtil = totalBudgetAmt > 0 ? (totalExpMonth / totalBudgetAmt) * 100 : 0;
    const utilizationRate = totalBookingsMonth > 0
      ? (completedBookingsMonth / totalBookingsMonth) * 100
      : 0;
    const taskCompletionRate = totalProjectTasks > 0
      ? (completedProjectTasks / totalProjectTasks) * 100
      : 0;

    const categoryNames = await this.resolveCategoryNames(businessId, expensesByCategory.map(e => e.categoryId).filter(Boolean) as string[]);
    const topCategories = expensesByCategory.map(e => ({
      name: (e.categoryId && categoryNames[e.categoryId]) || 'Uncategorized',
      amount: e._sum.amount ?? 0,
    }));

    const healthIndicators = this.computeHealthIndicators({
      overdueCount: overdueInvoices._count ?? 0,
      overdueAmt,
      staleLeadCount,
      overdueTaskCount: overdueProjectTasks,
      cancelledBookings: cancelledBookingsMonth,
      totalBookingsMonth,
      budgetUtil,
      totalExpMonth,
      monthlyRev,
    });
    healthIndicators.push(...this.treasuryIndicators(sight.treasury));

    const momentumSignals = [
      contactTotal > 0 ? 1 : 0,
      monthlyRev > 0 ? 1 : 0,
      (overdueInvoices._count ?? 0) === 0 ? 1 : 0,
      activeProjects > 0 ? 1 : 0,
      activeAutomations > 0 ? 1 : 0,
      recentContactCount > 0 ? 1 : 0,
      staleLeadCount === 0 ? 1 : 0,
    ];
    const momentumScore = Math.round((momentumSignals.reduce((a, b) => a + b, 0) / momentumSignals.length) * 100);

    const snapshot: BusinessGraphSnapshot = {
      businessId,
      timestamp: now,
      business: {
        name: business?.name ?? '',
        industry: business?.industry ?? null,
        archetype: business?.archetype ?? null,
        revenueModel: business?.revenueModel ?? null,
        currency: business?.currency ?? 'TTD',
        stage: business?.businessStage ?? null,
        teamSize: business?.teamSize ?? null,
      },
      contacts: {
        total: contactTotal,
        byStatus: statusMap,
        recentCount: recentContactCount,
        staleLeadCount,
        topClients: [],
      },
      revenue: {
        totalCollected: totalRevenue,
        outstandingAmount: outstandingAmt,
        outstandingCount: outstandingInvoices._count ?? 0,
        overdueCount: overdueInvoices._count ?? 0,
        overdueAmount: overdueAmt,
        monthlyRevenue: monthlyRev,
        averageInvoiceValue: Math.round(avgInvoice * 100) / 100,
      },
      bookings: {
        upcomingCount: upcomingBookings,
        completedThisMonth: completedBookingsMonth,
        cancelledThisMonth: cancelledBookingsMonth,
        utilizationRate: Math.round(utilizationRate * 10) / 10,
      },
      expenses: {
        totalThisMonth: totalExpMonth,
        topCategories,
        budgetUtilization: Math.round(budgetUtil * 10) / 10,
      },
      projects: {
        activeCount: activeProjects,
        overdueTaskCount: overdueProjectTasks,
        completionRate: Math.round(taskCompletionRate * 10) / 10,
      },
      content: {
        draftPostCount: draftPosts,
        scheduledPostCount: scheduledPosts,
        draftCampaignCount: draftCampaigns,
      },
      automations: {
        activeCount: activeAutomations,
        disabledCount: disabledAutomations,
        totalRuns: automationRuns._sum.runCount ?? 0,
      },
      storefront: {
        activeProductCount: activeProducts,
        averagePrice: Math.round((avgProductPrice._avg.price ?? 0) * 100) / 100,
      },
      treasury: sight.treasury,
      pipeline: sight.pipeline,
      support: sight.support,
      momentumScore,
      healthIndicators,
      links: [],
      entities: {
        topContacts: [],
        overdueInvoices: [],
        catalogProducts: [],
      },
    };

    await this.assembleEntityLinks(businessId, snapshot);

    return snapshot;
  }

  private async assembleEntityLinks(businessId: string, snapshot: BusinessGraphSnapshot): Promise<void> {
    const db = this.prisma.client;
    const now = new Date();
    const links: GraphEntityLink[] = [];

    const [topContacts, overdueInvs, catalogProducts, contactProjects] = await Promise.all([
      db.contact.findMany({
        where: { businessId, deletedAt: null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          status: true,
          invoices: { select: { id: true, total: true, status: true }, where: { deletedAt: null }, take: 20 },
          bookings: { select: { id: true }, where: { deletedAt: null }, take: 20 },
        },
        orderBy: { updatedAt: 'desc' },
        take: 25,
      }),
      db.invoice.findMany({
        where: { businessId, deletedAt: null, status: { in: ['SENT', 'DRAFT'] }, dueDate: { lt: now } },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          total: true,
          dueDate: true,
          contactId: true,
          contact: { select: { firstName: true, lastName: true } },
        },
        orderBy: { dueDate: 'asc' },
        take: 20,
      }),
      db.product.findMany({
        where: { businessId, deletedAt: null },
        select: {
          id: true,
          name: true,
          price: true,
          category: true,
          isActive: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      db.project.findMany({
        where: { businessId, deletedAt: null, contactId: { not: null } },
        select: { id: true, contactId: true },
        take: 100,
      }),
    ]);

    const projectsByContact = new Map<string, string[]>();
    for (const p of contactProjects) {
      if (!p.contactId) continue;
      const list = projectsByContact.get(p.contactId) || [];
      list.push(p.id);
      projectsByContact.set(p.contactId, list);
    }

    const services = await db.service.findMany({
      where: { businessId, deletedAt: null },
      select: { id: true, name: true },
    });
    const serviceByName = new Map(services.map(s => [s.name.toLowerCase(), s.id]));

    const contactSummaries: GraphContactSummary[] = topContacts.map(c => {
      const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown';
      const revenue = c.invoices
        .filter(inv => inv.status === 'PAID')
        .reduce((sum, inv) => sum + (Number(inv.total) || 0), 0);
      const invoiceIds = c.invoices.map(inv => inv.id);
      const bookingIds = c.bookings.map(b => b.id);
      const projectIds = projectsByContact.get(c.id) || [];

      for (const invId of invoiceIds) {
        links.push({ fromType: 'contact', fromId: c.id, toType: 'invoice', toId: invId, relation: 'has_invoice' });
      }
      for (const bId of bookingIds) {
        links.push({ fromType: 'contact', fromId: c.id, toType: 'booking', toId: bId, relation: 'has_booking' });
      }
      for (const pId of projectIds) {
        links.push({ fromType: 'contact', fromId: c.id, toType: 'project', toId: pId, relation: 'has_project' });
      }

      return { id: c.id, name, email: c.email, status: c.status, revenue, invoiceIds, bookingIds, projectIds };
    });

    contactSummaries.sort((a, b) => b.revenue - a.revenue);
    snapshot.contacts.topClients = contactSummaries
      .filter(c => c.revenue > 0)
      .slice(0, 10)
      .map(c => ({ id: c.id, name: c.name, revenue: c.revenue }));

    const invoiceSummaries: GraphInvoiceSummary[] = overdueInvs.map(inv => {
      const contactName = inv.contact
        ? [inv.contact.firstName, inv.contact.lastName].filter(Boolean).join(' ') || null
        : null;
      if (inv.contactId) {
        links.push({ fromType: 'invoice', fromId: inv.id, toType: 'contact', toId: inv.contactId, relation: 'billed_to' });
      }
      return {
        id: inv.id,
        number: inv.invoiceNumber,
        status: inv.status,
        total: Number(inv.total) || 0,
        dueDate: inv.dueDate?.toISOString() ?? null,
        contactId: inv.contactId,
        contactName,
      };
    });

    const productSummaries: GraphProductSummary[] = catalogProducts.map(p => {
      const matchedServiceId = serviceByName.get(p.name.toLowerCase()) ?? null;
      if (matchedServiceId) {
        links.push({ fromType: 'product', fromId: p.id, toType: 'service', toId: matchedServiceId, relation: 'listed_as_service' });
      }
      return {
        id: p.id,
        name: p.name,
        price: Number(p.price) || 0,
        category: p.category,
        isActive: p.isActive,
        serviceId: matchedServiceId,
        storefrontListed: matchedServiceId !== null,
      };
    });

    snapshot.links = links;
    snapshot.entities = {
      topContacts: contactSummaries.slice(0, 15),
      overdueInvoices: invoiceSummaries,
      catalogProducts: productSummaries,
    };
  }

  private async resolveCategoryNames(businessId: string, categoryIds: string[]): Promise<Record<string, string>> {
    if (categoryIds.length === 0) return {};
    const categories = await this.prisma.client.expenseCategory.findMany({
      where: { id: { in: categoryIds }, businessId },
      select: { id: true, name: true },
    });
    const map: Record<string, string> = {};
    for (const c of categories) map[c.id] = c.name;
    return map;
  }

  /**
   * PR195-PORT (owner PR #195 part 4): the treasury, pipeline and support
   * figures, on the head's rules. Cash is CashPositionService's ledger cash
   * (V1-34). Bills (live BILL expenses), committed payroll (DRAFT and APPROVED
   * runs) and open deals are summed in the business currency; an amount in any
   * other currency is named apart in otherCurrencies, never added or converted
   * (D-13, V1-37c, D-107/D-135). Counts include every currency. Every read is
   * of this business only; lists are read in full past the client's row cap.
   */
  private async assembleSight(
    businessId: string,
    businessCurrency: string | null | undefined,
  ): Promise<Required<Pick<BusinessGraphSnapshot, 'treasury' | 'pipeline' | 'support'>>> {
    const db = this.prisma.client;
    const [cash, bills, runs, deals, openTicketCount] = await Promise.all([
      this.cashPosition.getCashPosition(businessId),
      readAll((cursor) => db.expense.findMany({
        where: { businessId, deletedAt: null, status: 'BILL' },
        select: { id: true, amount: true, currency: true },
        orderBy: { id: 'asc' },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })),
      readAll((cursor) => db.payrollRun.findMany({
        where: { businessId, status: { in: ['DRAFT', 'APPROVED'] } },
        select: { id: true, totalGross: true, currency: true },
        orderBy: { id: 'asc' },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })),
      readAll((cursor) => db.deal.findMany({
        where: { businessId, deletedAt: null, status: 'OPEN' },
        select: { id: true, value: true, currency: true },
        orderBy: { id: 'asc' },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })),
      db.supportTicket.count({ where: { businessId, deletedAt: null, status: { in: OPEN_TICKET_STATUSES } } }),
    ]);

    // The cash position labels its business currency; it is the one every figure here is in.
    const currency = cash.currency || normalizeCurrency(businessCurrency) || 'TTD';
    const billCents = centsByCurrency(bills, (b) => b.amount, (b) => b.currency, currency);
    const payrollCents = centsByCurrency(runs, (r) => r.totalGross, (r) => r.currency, currency);
    const dealCents = centsByCurrency(deals, (d) => d.value ?? 0, (d) => d.currency, currency);

    const otherCash = new Map(otherCurrencyCash(cash).map((o) => [o.currency, o.amount]));
    const otherCodes = [...new Set([...otherCash.keys(), ...billCents.keys(), ...payrollCents.keys()])]
      .filter((code) => code !== currency)
      .sort();
    const otherTreasury = otherCodes
      .map((code) => ({
        currency: code,
        cash: otherCash.get(code) ?? 0,
        unpaidBills: fromCents(billCents.get(code) ?? 0),
        committedPayroll: fromCents(payrollCents.get(code) ?? 0),
      }))
      .filter((o) => o.cash !== 0 || o.unpaidBills !== 0 || o.committedPayroll !== 0);
    const otherDeals = [...dealCents.entries()]
      .filter(([code, cents]) => code !== currency && cents !== 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, cents]) => ({ currency: code, value: fromCents(cents) }));

    return {
      treasury: {
        currency,
        cashBalance: cash.cashBalance,
        cashBasis: 'ledger',
        unpaidBillsAmount: fromCents(billCents.get(currency) ?? 0),
        unpaidBillsCount: bills.length,
        committedPayrollAmount: fromCents(payrollCents.get(currency) ?? 0),
        committedPayrollRuns: runs.length,
        otherCurrencies: otherTreasury,
      },
      pipeline: {
        currency,
        openDealCount: deals.length,
        openPipelineValue: fromCents(dealCents.get(currency) ?? 0),
        otherCurrencies: otherDeals,
      },
      support: { openTicketCount },
    };
  }

  /**
   * PR195-PORT: the treasury alerts (area 'treasury', shown only with treasury
   * sight). Critical when the business-currency bills and committed payroll
   * exceed the ledger cash (the PR's alert, on ledger cash); a warning naming
   * the currencies held apart, so a figure that leaves them out is never silent
   * (D-107's rule for the runway alarm).
   */
  private treasuryIndicators(t: NonNullable<BusinessGraphSnapshot['treasury']>): BusinessGraphSnapshot['healthIndicators'] {
    const out: BusinessGraphSnapshot['healthIndicators'] = [];
    const obligations = fromCents(toCents(t.unpaidBillsAmount) + toCents(t.committedPayrollAmount));
    if (obligations > 0 && obligations > t.cashBalance) {
      out.push({
        area: TREASURY_AREA,
        status: 'critical',
        detail: `Committed bills and payroll (${money(t.currency, obligations)}) exceed ledger cash (${money(t.currency, t.cashBalance)})`,
      });
    }
    if (t.otherCurrencies.length > 0) {
      out.push({
        area: TREASURY_AREA,
        status: 'warning',
        detail: `Amounts in ${t.otherCurrencies.map((o) => o.currency).join(', ')} are held apart from the ${t.currency} figures, never converted (D-13)`,
      });
    }
    return out;
  }

  private computeHealthIndicators(data: {
    overdueCount: number;
    overdueAmt: number;
    staleLeadCount: number;
    overdueTaskCount: number;
    cancelledBookings: number;
    totalBookingsMonth: number;
    budgetUtil: number;
    totalExpMonth: number;
    monthlyRev: number;
  }): BusinessGraphSnapshot['healthIndicators'] {
    const indicators: BusinessGraphSnapshot['healthIndicators'] = [];

    if (data.overdueCount > 0) {
      indicators.push({
        area: 'revenue',
        status: data.overdueCount > 5 ? 'critical' : 'warning',
        detail: `${data.overdueCount} overdue invoice(s) totaling $${data.overdueAmt.toLocaleString()}`,
      });
    } else {
      indicators.push({ area: 'revenue', status: 'good', detail: 'No overdue invoices' });
    }

    if (data.staleLeadCount > 0) {
      indicators.push({
        area: 'crm',
        status: data.staleLeadCount > 10 ? 'critical' : 'warning',
        detail: `${data.staleLeadCount} stale lead(s) with no activity in 7+ days`,
      });
    }

    if (data.overdueTaskCount > 0) {
      indicators.push({
        area: 'projects',
        status: data.overdueTaskCount > 5 ? 'critical' : 'warning',
        detail: `${data.overdueTaskCount} overdue project task(s)`,
      });
    }

    if (data.totalBookingsMonth > 0) {
      const cancelRate = (data.cancelledBookings / data.totalBookingsMonth) * 100;
      if (cancelRate > 20) {
        indicators.push({
          area: 'bookings',
          status: 'warning',
          detail: `${cancelRate.toFixed(0)}% cancellation rate this month`,
        });
      }
    }

    if (data.budgetUtil > 90) {
      indicators.push({
        area: 'expenses',
        status: data.budgetUtil > 100 ? 'critical' : 'warning',
        detail: `Budget utilization at ${data.budgetUtil.toFixed(0)}%`,
      });
    }

    if (data.monthlyRev > 0 && data.totalExpMonth > data.monthlyRev * 0.9) {
      indicators.push({
        area: 'profitability',
        status: data.totalExpMonth > data.monthlyRev ? 'critical' : 'warning',
        detail: `Expenses consuming ${((data.totalExpMonth / data.monthlyRev) * 100).toFixed(0)}% of revenue`,
      });
    }

    return indicators;
  }

  private treasuryLine(t: NonNullable<BusinessGraphSnapshot['treasury']>): string {
    const runs = `${t.committedPayrollRuns} run${t.committedPayrollRuns === 1 ? '' : 's'}`;
    const line =
      `Cash & Obligations: ${money(t.currency, t.cashBalance)} cash (ledger), ` +
      `${money(t.currency, t.unpaidBillsAmount)} unpaid bills (${t.unpaidBillsCount}), ` +
      `${money(t.currency, t.committedPayrollAmount)} committed payroll (${runs})`;
    if (t.otherCurrencies.length === 0) return line;
    const apart = t.otherCurrencies
      .flatMap((o) => [
        o.cash !== 0 ? `${money(o.currency, o.cash)} cash` : null,
        o.unpaidBills !== 0 ? `${money(o.currency, o.unpaidBills)} unpaid bills` : null,
        o.committedPayroll !== 0 ? `${money(o.currency, o.committedPayroll)} committed payroll` : null,
      ])
      .filter(Boolean)
      .join(', ');
    return `${line}; held apart, not converted: ${apart}`;
  }

  private pipelineLine(p: NonNullable<BusinessGraphSnapshot['pipeline']>): string {
    const deals = `${p.openDealCount} open deal${p.openDealCount === 1 ? '' : 's'}`;
    const apart = p.otherCurrencies.map((o) => money(o.currency, o.value)).join(', ');
    return `Pipeline: ${deals} (${money(p.currency, p.openPipelineValue)}${apart ? `; held apart, not converted: ${apart}` : ''})`;
  }

  buildContextString(snapshot: BusinessGraphSnapshot): string {
    const b = snapshot.business;
    const parts: string[] = [
      `Business: ${b.name}`,
      b.industry ? `Industry: ${b.industry}` : null,
      b.archetype ? `Type: ${b.archetype}` : null,
      `Currency: ${b.currency}`,
      `Contacts: ${snapshot.contacts.total} total (${snapshot.contacts.staleLeadCount} stale leads)`,
      `Revenue: $${snapshot.revenue.totalCollected.toLocaleString()} collected, $${snapshot.revenue.monthlyRevenue.toLocaleString()} this month`,
      `Outstanding: $${snapshot.revenue.outstandingAmount.toLocaleString()} (${snapshot.revenue.outstandingCount} invoices, ${snapshot.revenue.overdueCount} overdue)`,
      // PR195-PORT: present only in a snapshot projected for a viewer who may read them (getSnapshot).
      snapshot.treasury ? this.treasuryLine(snapshot.treasury) : null,
      snapshot.pipeline ? this.pipelineLine(snapshot.pipeline) : null,
      `Bookings: ${snapshot.bookings.upcomingCount} upcoming, ${snapshot.bookings.completedThisMonth} completed this month`,
      `Expenses: $${snapshot.expenses.totalThisMonth.toLocaleString()} this month`,
      `Projects: ${snapshot.projects.activeCount} active, ${snapshot.projects.overdueTaskCount} overdue tasks`,
      snapshot.support
        ? `Support: ${snapshot.support.openTicketCount} open ticket${snapshot.support.openTicketCount === 1 ? '' : 's'}`
        : null,
      `Content: ${snapshot.content.draftPostCount} draft posts, ${snapshot.content.scheduledPostCount} scheduled, ${snapshot.content.draftCampaignCount} draft campaigns`,
      `Automations: ${snapshot.automations.activeCount} active flows`,
      `Store: ${snapshot.storefront.activeProductCount} active products`,
      `Momentum: ${snapshot.momentumScore}/100`,
    ].filter(Boolean) as string[];

    if (snapshot.healthIndicators.length > 0) {
      parts.push('Health Alerts: ' + snapshot.healthIndicators
        .filter(h => h.status !== 'good')
        .map(h => `[${h.status.toUpperCase()}] ${h.detail}`)
        .join('; '));
    }

    return parts.join('\n');
  }
}
