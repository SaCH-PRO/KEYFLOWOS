import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Post, Req, UseGuards,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { visibilityClause } from '../crm/crm-permissions.helper';
import { contactWhereBase } from '../crm/crm.helpers';
import { resolveTimelineViewer, type TimelineViewer } from '../timeline/timeline-visibility';
import { RevenueForecastService } from './revenue-forecast.service';
import { SlowPayerDetector, SlowPayerReport } from './slow-payer-detector.service';
import { PricingSignalsService } from './pricing-signals.service';
import { RevenueBriefingService, RevenueBriefingChase, RevenueBriefingSnapshot } from './revenue-briefing.service';

/**
 * W7-BRIEFINGS-REST (review SEC-W6BS-1; owner ruling D-63, as W5/W6 applied it to the morning and
 * end-of-day briefings): which contacts a briefing may name to a member. A contact-bearing item (a
 * slow payer, a chase bound to a contact) is served only for a contact the member may open: crm read
 * and the rule GET contacts/:contactId applies (the tenant predicate, deletedAt null, visibilityClause
 * M7). A briefing's prose is written by a model from contact names, so a line that names a contact the
 * member may not open is withheld too: `namesHidden` matches, as whole words and case-folded, the full
 * name (first and last name, any run of spaces between), the display name and the email of each
 * contact the briefing draws on (`drawsOn`) that the member may not open.
 * A member visibilityClause does not restrict (the OWNER, a SUPER_ADMIN) with crm read opens every one.
 *
 * Review CR-W7BR-1: a hidden contact's bare first or last name is not matched on its own. It is often
 * a common word ('Chase', 'Will', 'Cash'), and matching it withheld every line using that word from
 * every restricted member: each 'Chase <invoice>' item of the revenue briefing, a weekly summary
 * saying 'you will improve cash flow'. A contact with a single name is matched by it (it is the full name).
 */
export interface BriefingContactRule {
  /** Whether the member may open this contact. */
  opens(contactId: string | null | undefined): boolean;
  /** Whether this text names a contact the briefing draws on that the member may not open. */
  namesHidden(text: string | null | undefined): boolean;
}

const OPENS_EVERY_CONTACT: BriefingContactRule = { opens: () => true, namesHidden: () => false };

export async function briefingContactRule(
  prisma: PrismaService,
  viewer: TimelineViewer,
  drawsOn: Prisma.ContactWhereInput,
): Promise<BriefingContactRule> {
  const readsCrm = viewer.readable.has('crm');
  const clause = readsCrm ? visibilityClause(viewer.crmAccess, viewer.userId) : null;
  if (readsCrm && !clause) return OPENS_EVERY_CONTACT;
  const candidates = await prisma.client.contact.findMany({
    where: { AND: [contactWhereBase(viewer.businessId), drawsOn] },
    select: { id: true, firstName: true, lastName: true, displayName: true, email: true },
  });
  const open = new Set<string>();
  if (readsCrm && candidates.length > 0) {
    const visible = await prisma.client.contact.findMany({
      where: { AND: [contactWhereBase(viewer.businessId), { id: { in: candidates.map((c) => c.id) } }, clause as Prisma.ContactWhereInput] },
      select: { id: true },
    });
    for (const row of visible) open.add(row.id);
  }
  const names = new Set<string>();
  for (const c of candidates) {
    if (open.has(c.id)) continue;
    // CR-W7BR-1: the full name, display name and email, never a bare first or last name on its own.
    for (const name of [c.displayName, `${c.firstName ?? ''} ${c.lastName ?? ''}`, c.email]) {
      const words = (name ?? '').trim().split(/\s+/).filter((w) => w.length > 0);
      if (words.join(' ').length < 2) continue;
      names.add(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'));
    }
  }
  const hidden = names.size > 0 ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${[...names].join('|')})(?![\\p{L}\\p{N}])`, 'iu') : null;
  return {
    opens: (contactId) => typeof contactId === 'string' && open.has(contactId),
    namesHidden: (text) => !!hidden && typeof text === 'string' && hidden.test(text),
  };
}

/** The slow-payer report a member is served: the slow payers they may open (D-63). */
function slowPayersFor(report: SlowPayerReport, rule: BriefingContactRule): SlowPayerReport {
  return { ...report, slowPayers: report.slowPayers.filter((s) => rule.opens(s.contactId)) };
}

/** The open invoices and pending quotes the revenue briefing names their contacts from (RevenueBriefingService.generate). */
const BRIEFING_OPEN_INVOICE: Prisma.InvoiceWhereInput = { deletedAt: null, status: { in: ['SENT', 'OVERDUE', 'PARTIALLY_PAID'] } };
const BRIEFING_PENDING_QUOTE: Prisma.QuoteWhereInput = { deletedAt: null, status: { in: ['SENT', 'ACCEPTED'] }, invoiceId: null };
const BRIEFING_HEADLINE = 'Here is your revenue briefing.';

/**
 * W7-BRIEFINGS-REST (review SEC-W6BS-1; owner ruling D-63): every route here reads or acts on the
 * business's revenue (the forecast, slow payers and what they owe, pricing and margins, the revenue
 * briefing and its chases), and served it to every member (a membership check only). Each route now
 * needs revenue read (ModuleScopeGuard), and the slow payers, the briefing's chases and its prose are
 * served only for the contacts the member may open (briefingContactRule). The briefing is still
 * generated and cached for the business; what each member is served is filtered from it.
 * POST briefing/delegate-chase writes a revenue action from a chase the client sends; it takes revenue
 * read as the revenue-action routes beside it take no module scope, and a chase naming a contact the
 * member may not open is refused as absent (404 'Contact not found', D-64). Review SEC-W7BR-1: the
 * chase's contact is the one of the invoice or quote it names (chaseBinding), never the client's
 * word alone, and a chase may not rewrite one already bound to a contact the member may not open.
 */
@Controller('commerce/businesses/:businessId/revenue-intelligence')
@UseGuards(AuthGuard, BusinessGuard)
export class RevenueIntelligenceController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RevenueForecastService) private readonly forecast: RevenueForecastService,
    @Inject(SlowPayerDetector) private readonly slowPayer: SlowPayerDetector,
    @Inject(PricingSignalsService) private readonly pricing: PricingSignalsService,
    @Inject(RevenueBriefingService) private readonly briefing: RevenueBriefingService,
  ) {}

  private async ensureAccess(userId: string, businessId: string) {
    const biz = await this.prisma.client.business.findFirst({
      where: { id: businessId, OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
      select: { id: true },
    });
    if (!biz) throw new ForbiddenException('No access to this business');
  }

  /** The revenue briefing as `userId` may read it (D-63): the chases, slow payers and lines of the contacts they may open. */
  private async briefingFor(snapshot: RevenueBriefingSnapshot, businessId: string, userId: string): Promise<RevenueBriefingSnapshot> {
    const viewer = await resolveTimelineViewer(this.prisma, businessId, userId);
    const named = [
      ...snapshot.slowPayers.slowPayers.map((s) => s.contactId),
      ...snapshot.briefing.whatToChase.map((c) => c.contactId).filter((id): id is string => typeof id === 'string'),
    ];
    const rule = await briefingContactRule(this.prisma, viewer, {
      OR: [{ id: { in: named } }, { invoices: { some: BRIEFING_OPEN_INVOICE } }, { quotes: { some: BRIEFING_PENDING_QUOTE } }],
    });
    const shown = (text: string) => !rule.namesHidden(text);
    const b = snapshot.briefing;
    return {
      ...snapshot,
      briefing: {
        ...b,
        headline: shown(b.headline) ? b.headline : BRIEFING_HEADLINE,
        whatChanged: b.whatChanged.filter(shown),
        whatsAtRisk: b.whatsAtRisk.filter(shown),
        whatToChase: b.whatToChase.filter((c) => (c.contactId ? rule.opens(c.contactId) : true) && shown(c.title) && shown(c.detail)),
        whatToPlan: b.whatToPlan.filter(shown),
      },
      slowPayers: slowPayersFor(snapshot.slowPayers, rule),
    };
  }

  @Get('forecast')
  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  async getForecast(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.forecast.compute(businessId);
  }

  @Get('slow-payers')
  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  async getSlowPayers(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    const report = await this.slowPayer.detect(businessId);
    // Best-effort sync (don't block the response on it).
    void this.slowPayer.syncContactTags(businessId, report).catch(() => {});
    void this.slowPayer.syncRevenueActions(businessId, report).catch(() => {});
    const viewer = await resolveTimelineViewer(this.prisma, businessId, req.user.id);
    const rule = await briefingContactRule(this.prisma, viewer, { id: { in: report.slowPayers.map((s) => s.contactId) } });
    return slowPayersFor(report, rule);
  }

  @Get('pricing-signals')
  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  async getPricingSignals(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.pricing.detect(businessId);
  }

  @Get('briefing')
  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  async getBriefing(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    return this.briefingFor(await this.briefing.getOrGenerate(businessId), businessId, req.user.id);
  }

  @Post('briefing/regenerate')
  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  async regenerateBriefing(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    this.briefing.invalidate(businessId);
    return this.briefingFor(await this.briefing.generate(businessId), businessId, req.user.id);
  }

  @Post('briefing/delegate-chase')
  @UseGuards(ModuleScopeGuard)
  @RequireModuleScope('revenue', 'read')
  async delegateChase(
    @Param('businessId') businessId: string,
    @Body() body: { chase: RevenueBriefingChase },
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    if (!body?.chase?.title) {
      return { created: false, error: 'Missing chase' };
    }
    const chase = body.chase;
    if (typeof chase.title !== 'string') throw new BadRequestException('A chase has a title');
    const named = chase.contactId;
    if (named !== undefined && named !== null && typeof named !== 'string') throw new NotFoundException('Contact not found');
    // SEC-W7BR-1: the invoice or quote the chase is about, and so its contact, read from this business's records.
    const { relatedType, relatedId, contactId } = await this.chaseBinding(businessId, chase.relatedType, chase.relatedId, named ?? null);
    // D-63 / D-64: a chase may name only a live contact of this business that the member may open,
    // and may not rewrite a delegated chase bound to a contact the member may not open (the writer
    // upserts on the chase's key); either is refused exactly as an absent contact.
    const key = relatedType && relatedId ? { relatedType, relatedId } : briefingChaseKey(chase.title);
    const existing = await this.prisma.client.revenueAction.findUnique({
      where: { businessId_type_relatedType_relatedId: { businessId, type: 'CHASE_FROM_BRIEFING', ...key } },
      select: { contactId: true },
    });
    const bound = [contactId, existing?.contactId].filter((id): id is string => typeof id === 'string');
    if (bound.length > 0) {
      const viewer = await resolveTimelineViewer(this.prisma, businessId, req.user.id);
      const [rule, live] = await Promise.all([
        briefingContactRule(this.prisma, viewer, { id: { in: bound } }),
        contactId
          ? this.prisma.client.contact.findFirst({ where: { ...contactWhereBase(businessId), id: contactId }, select: { id: true } })
          : Promise.resolve(null),
      ]);
      if ((contactId && !live) || !bound.every((id) => rule.opens(id))) throw new NotFoundException('Contact not found');
    }
    return this.briefing.delegateChase(businessId, { ...chase, contactId, relatedType, relatedId });
  }

  /**
   * W7-BRIEFINGS-REST review SEC-W7BR-1 (D-63, D-64): what a delegated chase is bound to. The writer
   * (RevenueActionService.createFromBriefing) upserts on (business, CHASE_FROM_BRIEFING, relatedType,
   * relatedId) and on an existing row rewrites its title, detail, amount and contact, so the relation
   * and the contact were both the client's: a member refused a contact could name its invoice alone
   * and so create, rewrite or unbind (contactId null) a chase on it. The briefing binds a chase to an
   * invoice or a quote (RevenueBriefingService) or to nothing, so only those are taken: the invoice or
   * quote must be a live one of this business (else 404, as absent), its contact is the chase's, and a
   * body naming another contact is refused (400). A chase bound to nothing names at most the contact
   * the body names.
   */
  private async chaseBinding(
    businessId: string,
    relatedType: unknown,
    relatedId: unknown,
    named: string | null,
  ): Promise<{ relatedType: string | null; relatedId: string | null; contactId: string | null }> {
    if (relatedType === undefined || relatedType === null) {
      if (relatedId !== undefined && relatedId !== null) throw new BadRequestException('A chase relates to an invoice or a quote');
      return { relatedType: null, relatedId: null, contactId: named };
    }
    if ((relatedType !== 'invoice' && relatedType !== 'quote') || typeof relatedId !== 'string' || relatedId.length === 0) {
      throw new BadRequestException('A chase relates to an invoice or a quote');
    }
    const record = relatedType === 'invoice'
      ? await this.prisma.client.invoice.findFirst({ where: { id: relatedId, businessId, deletedAt: null }, select: { contactId: true } })
      : await this.prisma.client.quote.findFirst({ where: { id: relatedId, businessId, deletedAt: null }, select: { contactId: true } });
    if (!record) throw new NotFoundException(relatedType === 'invoice' ? 'Invoice not found' : 'Quote not found');
    const contactId = record.contactId ?? null;
    if (named !== null && named !== contactId) throw new BadRequestException(`The chase names another contact than its ${relatedType}'s`);
    return { relatedType, relatedId, contactId };
  }
}

/**
 * The key RevenueActionService.createFromBriefing gives a chase bound to no invoice or quote
 * (relatedType 'briefing', relatedId from its title), so delegate-chase can see the row it would
 * rewrite. TS-20d writes through the real writer and fails if the two drift apart.
 */
function briefingChaseKey(title: string): { relatedType: string; relatedId: string } {
  return { relatedType: 'briefing', relatedId: `briefing:${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80)}` };
}
