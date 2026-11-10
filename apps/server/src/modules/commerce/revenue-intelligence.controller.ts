import {
  Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Post, Req, UseGuards,
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
 * member may not open is withheld too: `namesHidden` matches, as a whole word and case-folded, the
 * names and email of the contacts the briefing draws on (`drawsOn`) that the member may not open.
 * A member visibilityClause does not restrict (the OWNER, a SUPER_ADMIN) with crm read opens every one.
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
    for (const name of [c.displayName, `${c.firstName ?? ''} ${c.lastName ?? ''}`, c.firstName, c.lastName, c.email]) {
      const trimmed = (name ?? '').trim();
      if (trimmed.length >= 2) names.add(trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
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
 * member may not open is refused as absent (404 'Contact not found', D-64).
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
    // D-63 / D-64: a chase may name only a live contact of this business that the member may open;
    // any other is refused exactly as an absent one.
    const contactId = body.chase.contactId;
    if (contactId !== undefined && contactId !== null) {
      if (typeof contactId !== 'string') throw new NotFoundException('Contact not found');
      const viewer = await resolveTimelineViewer(this.prisma, businessId, req.user.id);
      const [rule, exists] = await Promise.all([
        briefingContactRule(this.prisma, viewer, { id: contactId }),
        this.prisma.client.contact.findFirst({ where: { ...contactWhereBase(businessId), id: contactId }, select: { id: true } }),
      ]);
      if (!exists || !rule.opens(contactId)) throw new NotFoundException('Contact not found');
    }
    return this.briefing.delegateChase(businessId, body.chase);
  }
}
