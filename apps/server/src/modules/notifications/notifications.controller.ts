import { Body, Controller, Get, Inject, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { TransactionalEmailService, NotificationPreferences } from './transactional-email.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

@Controller('notifications')
@UseGuards(AuthGuard, BusinessGuard)
export class NotificationsController {
  constructor(
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
    @Inject(TransactionalEmailService)
    private readonly transactionalEmail: TransactionalEmailService,
  ) {}

  @Get('businesses/:businessId')
  list(
    @Param('businessId') businessId: string,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return this.notifications.listForBusiness(businessId, {
      unreadOnly: unreadOnly === 'true',
    });
  }

  @Get('businesses/:businessId/unread-count')
  async unreadCount(@Param('businessId') businessId: string) {
    const count = await this.notifications.unreadCount(businessId);
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
