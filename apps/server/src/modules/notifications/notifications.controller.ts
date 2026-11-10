import { Body, Controller, Get, Inject, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import type { Notification } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { TransactionalEmailService, NotificationPreferences } from './transactional-email.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { resolveTimelineViewer, type TimelineViewer } from '../timeline/timeline-visibility';
import { briefingContactRule, type BriefingContactRule } from '../commerce/revenue-intelligence.controller';

/** The weekly financial briefing FinancialBriefingSchedulerService stores for the business: wholly revenue. */
export const WEEKLY_BRIEFING_TYPE = 'financial.weekly_briefing';

/**
 * W8-REVENUE-ACTIONS-SCOPE (TS-22c, D-63): the stored weekly briefing as a revenue reader is served
 * it, as POST commerce/businesses/:businessId/weekly-briefing answers it: a highlight, concern or open
 * finance action that names a contact the member may not open is dropped, and a summary (the body),
 * recommendation or outlook that names one is replaced by the same neutral line.
 */
function weeklyBriefingFor(notification: Notification, rule: BriefingContactRule): Notification {
  const shown = (item: unknown) => !(typeof item === 'string' && rule.namesHidden(item));
  const line = (text: unknown, neutral: string) => (shown(text) ? text : neutral);
  const data = notification.data;
  const stored = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  return {
    ...notification,
    body: line(notification.body, 'Your weekly financial briefing is ready.') as string | null,
    data: stored
      ? ({
          ...stored,
          highlights: Array.isArray(stored.highlights) ? stored.highlights.filter(shown) : stored.highlights,
          concerns: Array.isArray(stored.concerns) ? stored.concerns.filter(shown) : stored.concerns,
          recommendation: line(stored.recommendation, 'Follow up on outstanding invoices to maintain healthy cash flow.'),
          outlook: line(stored.outlook, 'Focus on collections and controlling expenses this week.'),
          openActions: Array.isArray(stored.openActions)
            ? stored.openActions.filter((a) => !(a && typeof a === 'object' && !shown((a as { title?: unknown }).title)))
            : stored.openActions,
        } as Notification['data'])
      : data,
  };
}

@Controller('notifications')
@UseGuards(AuthGuard, BusinessGuard)
export class NotificationsController {
  constructor(
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
    @Inject(TransactionalEmailService)
    private readonly transactionalEmail: TransactionalEmailService,
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  /** W8-REVENUE-ACTIONS-SCOPE (D-63): the types a member without revenue read is not served. */
  private withheldTypes(viewer: TimelineViewer): string[] | undefined {
    return viewer.readable.has('revenue') ? undefined : [WEEKLY_BRIEFING_TYPE];
  }

  /**
   * W8-REVENUE-ACTIONS-SCOPE (review SEC-W7BR-4; owner ruling D-63; TS-22c): the weekly financial
   * briefing is stored once for the business (last week's and this week's revenue, expenses and net,
   * receivables, the cash position, the open finance queue) and was served to every member, a
   * revenue-none member included, while POST weekly-briefing refuses them. A member without revenue
   * read is no longer served it (nor counted it as unread); a revenue reader is served it without
   * the lines naming a contact they may not open (briefingContactRule over the contacts the finance
   * queue names, open or resolved since: the briefing's model wrote from the queue's 'Slow payer:
   * <name>' items).
   */
  @Get('businesses/:businessId')
  async list(
    @Param('businessId') businessId: string,
    @Query('unreadOnly') unreadOnly: string | undefined,
    @Req() req: { user: { id: string } },
  ) {
    const viewer = await resolveTimelineViewer(this.prisma, businessId, req.user.id);
    const rows = await this.notifications.listForBusiness(businessId, {
      unreadOnly: unreadOnly === 'true',
      excludeTypes: this.withheldTypes(viewer),
    });
    if (!rows.some((n) => n.type === WEEKLY_BRIEFING_TYPE)) return rows;
    const queued = await this.prisma.client.financeActionItem.findMany({
      where: { businessId, entityType: { equals: 'contact', mode: 'insensitive' } },
      select: { entityId: true },
      distinct: ['entityId'],
    });
    const rule = await briefingContactRule(this.prisma, viewer, { id: { in: queued.map((item) => item.entityId) } });
    return rows.map((n) => (n.type === WEEKLY_BRIEFING_TYPE ? weeklyBriefingFor(n, rule) : n));
  }

  @Get('businesses/:businessId/unread-count')
  async unreadCount(@Param('businessId') businessId: string, @Req() req: { user: { id: string } }) {
    const viewer = await resolveTimelineViewer(this.prisma, businessId, req.user.id);
    const count = await this.notifications.unreadCount(businessId, { excludeTypes: this.withheldTypes(viewer) });
    return { count };
  }

  @Patch('businesses/:businessId/:id/read')
  markRead(@Param('id') id: string, @Param('businessId') businessId: string) {
    return this.notifications.markRead(id, businessId);
  }

  @Patch('businesses/:businessId/read-all')
  markAllRead(@Param('businessId') businessId: string) {
    return this.notifications.markAllRead(businessId);
  }

  @Get('businesses/:businessId/customer-preferences')
  getPreferences(@Param('businessId') businessId: string) {
    return this.transactionalEmail.getPreferences(businessId);
  }

  @Patch('businesses/:businessId/customer-preferences')
  updatePreferences(
    @Param('businessId') businessId: string,
    @Body() body: Partial<NotificationPreferences>,
  ) {
    return this.transactionalEmail.updatePreferences(businessId, body);
  }

  @Get('businesses/:businessId/customer-log')
  getCustomerLog(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
    @Query('type') type?: string,
  ) {
    return this.transactionalEmail.getNotificationLog(businessId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      type: type || undefined,
    });
  }
}
