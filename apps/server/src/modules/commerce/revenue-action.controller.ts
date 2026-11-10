import {
  Body, Controller, ForbiddenException, Get, HttpException, HttpStatus,
  Inject, NotFoundException, Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { visibilityClause } from '../crm/crm-permissions.helper';
import { resolveTimelineViewer, type TimelineViewer } from '../timeline/timeline-visibility';
import { briefingContactRule } from './revenue-intelligence.controller';
import { RevenueActionService } from './revenue-action.service';

/**
 * W8-REVENUE-ACTIONS-SCOPE (TS-22, D-63): how many queued actions a list or the overview's top
 * scans to fill a member's page past the actions withheld from them.
 */
export const REVENUE_ACTION_SCAN_LIMIT = 1000;

/** The fields of a revenue action the D-63 rule reads. */
type ScopedAction = {
  contactId: string | null;
  relatedType: string | null;
  relatedId: string | null;
  title: string;
  detail: string | null;
  recommendation: Prisma.JsonValue | null;
};

/**
 * The contacts an action names by id (TS-22, D-63): its contactId, and its relatedId when it is
 * related to a contact (relatedType 'contact', case-folded). SlowPayerDetector's SLOW_PAYER rows
 * carry both; the FIN8 FIN_SLOW_PAYER mirror (FinanceIntelligenceService) carries no contactId.
 */
function actionContacts(row: Pick<ScopedAction, 'contactId' | 'relatedType' | 'relatedId'>): string[] {
  const out: string[] = [];
  if (typeof row.contactId === 'string' && row.contactId.length > 0) out.push(row.contactId);
  const related = typeof row.relatedType === 'string' ? row.relatedType.trim().toLowerCase() : '';
  if (related === 'contact' && typeof row.relatedId === 'string' && row.relatedId.length > 0 && row.relatedId !== row.contactId) {
    out.push(row.relatedId);
  }
  return out;
}

/** Every text an action is served with: its title, detail and each string of its recommendation (its draft included). */
function actionTexts(row: Pick<ScopedAction, 'title' | 'detail' | 'recommendation'>): string[] {
  const out: string[] = [row.title, row.detail ?? ''];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(row.recommendation);
  return out;
}

/**
 * W8-REVENUE-ACTIONS-SCOPE (review SEC-W7BR-4; owner ruling D-63; TS-22): the revenue-action queue
 * (its amounts at risk, the overview's collected, outstanding and overdue figures and revenue pulse,
 * and the chases and slow payers it names) is revenue, and was served to every member (AuthGuard +
 * BusinessGuard only), so what the briefings withhold was served one route over. Every route now
 * needs revenue read (ModuleScopeGuard, refused before any action or figure is read); the writes keep
 * that level, as POST revenue-intelligence/briefing/delegate-chase beside them does. The briefings'
 * rule then applies to the queue: an action is served (listed, in the overview's top, or acted on)
 * only when every contact it names by id (actionContacts) is one the member may open, and none of its
 * texts names one they may not (briefingContactRule: crm read and visibilityClause; a hidden contact's
 * full name, display name or email, matched over the contacts the business's actions name). An action
 * the member may not be served is refused as absent on complete, dismiss and snooze (404 'action not
 * found', the answer for an id that is no action of the business; D-64's absent refusal).
 */
@Controller('commerce/businesses/:businessId/revenue-actions')
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
export class RevenueActionController {
  constructor(
    @Inject(RevenueActionService) private readonly service: RevenueActionService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private async ensureAccess(userId: string, businessId: string) {
    const biz = await this.prisma.client.business.findFirst({
      where: { id: businessId, OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
      select: { id: true },
    });
    if (!biz) throw new ForbiddenException('No access to this business');
  }

  /** Whether the member opens every contact of the business (crm read, and visibilityClause does not restrict them). */
  private opensEveryContact(viewer: TimelineViewer): boolean {
    return viewer.readable.has('crm') && !visibilityClause(viewer.crmAccess, viewer.userId);
  }

  /** The actions of `rows` the member may be served (TS-22, D-63), in order. */
  private async servedTo<T extends ScopedAction>(viewer: TimelineViewer, rows: T[]): Promise<T[]> {
    if (rows.length === 0 || this.opensEveryContact(viewer)) return rows;
    // The contacts the business's actions name: an action's own ids are judged, and its texts are
    // matched against the names of every one of them the member may not open.
    const [byContact, byRelation] = await Promise.all([
      this.prisma.client.revenueAction.findMany({
        where: { businessId: viewer.businessId, contactId: { not: null } },
        select: { contactId: true },
        distinct: ['contactId'],
      }),
      this.prisma.client.revenueAction.findMany({
        where: { businessId: viewer.businessId, relatedType: { equals: 'contact', mode: 'insensitive' }, relatedId: { not: null } },
        select: { relatedId: true },
        distinct: ['relatedId'],
      }),
    ]);
    const named = new Set<string>(rows.flatMap(actionContacts));
    for (const r of byContact) if (r.contactId) named.add(r.contactId);
    for (const r of byRelation) if (r.relatedId) named.add(r.relatedId);
    const rule = await briefingContactRule(this.prisma, viewer, { id: { in: [...named] } });
    return rows.filter(
      (row) => actionContacts(row).every((id) => rule.opens(id)) && !actionTexts(row).some((text) => rule.namesHidden(text)),
    );
  }

  /** A page of the queue as the member may be served it, filled past the actions withheld (TS-22). */
  private async page(businessId: string, userId: string, status: string, limit: number) {
    const viewer = await resolveTimelineViewer(this.prisma, businessId, userId);
    if (this.opensEveryContact(viewer)) return this.service.list(businessId, { status, limit });
    const scanned = await this.service.list(businessId, { status, limit: REVENUE_ACTION_SCAN_LIMIT });
    return (await this.servedTo(viewer, scanned)).slice(0, limit);
  }

  /**
   * TS-22 (D-63, D-64): an action the member may not be served is absent to them. An id that is no
   * action of the business is left to the service, which answers the same 404.
   */
  private async ensureServed(businessId: string, id: string, userId: string) {
    const row = await this.prisma.client.revenueAction.findFirst({
      where: { id, businessId },
      select: { contactId: true, relatedType: true, relatedId: true, title: true, detail: true, recommendation: true },
    });
    if (!row) return;
    const viewer = await resolveTimelineViewer(this.prisma, businessId, userId);
    if ((await this.servedTo(viewer, [row])).length === 0) throw new NotFoundException('action not found');
  }

  @RequireModuleScope('revenue', 'read')
  @Get()
  async list(
    @Param('businessId') businessId: string,
    @Query('status') status: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    const items = await this.page(
      businessId,
      req.user.id,
      status ?? 'PENDING',
      limit ? Math.max(1, Math.min(200, parseInt(limit, 10) || 50)) : 50,
    );
    return { items };
  }

  @RequireModuleScope('revenue', 'read')
  @Get('overview')
  async overview(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    const [kpis, pulse, top] = await Promise.all([
      this.service.overviewKpis(businessId),
      this.service.revenuePulse(businessId),
      // RevenueActionService.topPriority's page (PENDING, five), as the member may be served it.
      this.page(businessId, req.user.id, 'PENDING', 5),
    ]);
    return { kpis, pulse, top };
  }

  @RequireModuleScope('revenue', 'read')
  @Post('reconcile')
  async reconcile(@Param('businessId') businessId: string, @Req() req: any) {
    await this.ensureAccess(req.user.id, businessId);
    const created = await this.service.reconcileBusiness(businessId);
    return { created };
  }

  @RequireModuleScope('revenue', 'read')
  @Post(':id/complete')
  async complete(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { resolution?: string } | undefined,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    await this.ensureServed(businessId, id, req.user.id);
    try {
      return await this.service.complete(businessId, id, req.user.id, body?.resolution ?? null);
    } catch (e) {
      throw new NotFoundException((e as Error).message);
    }
  }

  @RequireModuleScope('revenue', 'read')
  @Post(':id/dismiss')
  async dismiss(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { resolution?: string } | undefined,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    await this.ensureServed(businessId, id, req.user.id);
    try {
      return await this.service.dismiss(businessId, id, req.user.id, body?.resolution ?? null);
    } catch (e) {
      throw new NotFoundException((e as Error).message);
    }
  }

  @RequireModuleScope('revenue', 'read')
  @Post(':id/snooze')
  async snooze(
    @Param('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { until?: string; hours?: number } | undefined,
    @Req() req: any,
  ) {
    await this.ensureAccess(req.user.id, businessId);
    await this.ensureServed(businessId, id, req.user.id);
    let until: Date;
    if (body?.until) {
      until = new Date(body.until);
      if (Number.isNaN(until.getTime())) {
        throw new HttpException('Invalid `until` timestamp', HttpStatus.BAD_REQUEST);
      }
    } else {
      const hours = Math.max(1, Math.min(24 * 30, body?.hours ?? 24));
      until = new Date(Date.now() + hours * 3600_000);
    }
    try {
      return await this.service.snooze(businessId, id, until, req.user.id);
    } catch (e) {
      throw new NotFoundException((e as Error).message);
    }
  }
}
