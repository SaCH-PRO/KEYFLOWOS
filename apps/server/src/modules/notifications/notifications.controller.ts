import { Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

@Controller('notifications')
@UseGuards(AuthGuard, BusinessGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

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
}
