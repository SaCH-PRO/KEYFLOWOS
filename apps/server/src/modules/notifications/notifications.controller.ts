import { Body, Controller, Get, Inject, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import type { Notification } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { TransactionalEmailService, NotificationPreferences } from './transactional-email.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard, RequireModuleScope } from '../../core/auth/module-scope.guard';
import { PrismaService } from '../../core/prisma/prisma.service';
import { assertBusinessOwnerMember, isBusinessOwnerMember } from '../../core/auth/business-owner';
import { resolveTimelineViewer, type TimelineViewer } from '../timeline/timeline-visibility';
import { briefingContactRule, type BriefingContactRule } from '../commerce/revenue-intelligence.controller';

/**
 * OWNER-ALERTS-WEB repair round 1 (SEC-OAW-1; orchestrator ruling: fail closed until the owner rules): the business
 * owner's alerts (OwnerAlertsListener: a new booking, a payment, an "I've paid" claim) are the owner's to change, under
 * the one owner rule (assertBusinessOwnerMember: an OWNER membership, a co-owner included, with BusinessGuard's
 * SUPER_ADMIN bypass). Settings write alone does not change them.
 */
export const OWNER_ALERT_KEYS = ['owner_alert_bookings', 'owner_alert_payments', 'owner_alert_claims'] as const;
export const OWNER_ALERTS_OWNER_ONLY = {
  code: 'OWNER_ALERTS_OWNER_ONLY',
  message: 'Only the business owner can change the owner\'s alerts (bookings, payments, "I\'ve paid" claims).',
};

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
@UseGuards(AuthGuard, BusinessGuard, ModuleScopeGuard)
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

  /**
   * W8-REVENUE-ACTIONS-SCOPE review SEC-W8RA-3 (D-63): the read flag is the business's, so a member
   * who is not served the weekly briefing (no revenue read) no longer marks it read for the OWNER and
   * the revenue readers: read-all leaves it as it is, and :id/read on its id answers as on a missing
   * id ({ count: 0 }), as complete, dismiss and snooze refuse a revenue action withheld from them.
   */
  @Patch('businesses/:businessId/:id/read')
  async markRead(@Param('id') id: string, @Param('businessId') businessId: string, @Req() req: { user: { id: string } }) {
    const viewer = await resolveTimelineViewer(this.prisma, businessId, req.user.id);
    return this.notifications.markRead(id, businessId, { excludeTypes: this.withheldTypes(viewer) });
  }

  @Patch('businesses/:businessId/read-all')
  async markAllRead(@Param('businessId') businessId: string, @Req() req: { user: { id: string } }) {
    const viewer = await resolveTimelineViewer(this.prisma, businessId, req.user.id);
    return this.notifications.markAllRead(businessId, { excludeTypes: this.withheldTypes(viewer) });
  }

  // FU-NOTIFICATIONS-PREFS-GUARD (P30): customer-email settings and log belong
  // to Settings -> Notifications and require settings read/write authority.
  @Get('businesses/:businessId/customer-preferences')
  @RequireModuleScope('settings', 'read')
  getPreferences(@Param('businessId') businessId: string) {
    return this.transactionalEmail.getPreferences(businessId);
  }

  @Patch('businesses/:businessId/customer-preferences')
  @RequireModuleScope('settings', 'write')
  async updatePreferences(
    @Param('businessId') businessId: string,
    @Body() body: Partial<NotificationPreferences>,
    @Req() req: { user?: { id?: string; role?: string } },
  ) {
    // SEC-OAW-1: a body carrying any owner alert key, whatever its value, is the owner's to send. Anyone else is
    // refused whole, before anything is read or written (the customer-email keys in the same body included).
    const touchesOwnerAlerts =
      !!body && typeof body === 'object' && OWNER_ALERT_KEYS.some((key) => Object.prototype.hasOwnProperty.call(body, key));
    if (touchesOwnerAlerts) await assertBusinessOwnerMember(this.prisma, businessId, req.user, OWNER_ALERTS_OWNER_ONLY);
    return this.transactionalEmail.updatePreferences(businessId, body);
  }

  /**
   * OWNER-ALERTS-WEB repair round 1: the business owner's alerts as Settings > Notifications > Owner alerts shows them
   * (the flat owner_alert_<category> keys, absent = on, as resolveOwnerAlertPreferences reads them), and whether the
   * caller may change them (the owner rule of updatePreferences above), so the page shows them read-only to everyone
   * else. Settings read, as GET customer-preferences.
   */
  @Get('businesses/:businessId/owner-alerts')
  @RequireModuleScope('settings', 'read')
  async getOwnerAlerts(@Param('businessId') businessId: string, @Req() req: { user?: { id?: string; role?: string } }) {
    const prefs = (await this.transactionalEmail.getPreferences(businessId)) as Record<string, unknown>;
    const canChange =
      req.user?.role === 'SUPER_ADMIN' || (await isBusinessOwnerMember(this.prisma.client, businessId, req.user?.id));
    return {
      bookings: prefs.owner_alert_bookings !== false,
      payments: prefs.owner_alert_payments !== false,
      claims: prefs.owner_alert_claims !== false,
      canChange,
    };
  }

  @Get('businesses/:businessId/customer-log')
  @RequireModuleScope('settings', 'read')
  getCustomerLog(
    @Param('businessId') businessId: string,
    @Query('limit') limit?: string,
    @Query('type') type?: string,
  ) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : Number.NaN;
    return this.transactionalEmail.getNotificationLog(businessId, {
      limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined,
      type: type || undefined,
    });
  }
}
