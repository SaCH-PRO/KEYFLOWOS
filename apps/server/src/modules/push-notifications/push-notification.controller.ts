import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Inject,
  BadRequestException,
} from '@nestjs/common';
import { BusinessGuard } from '../../core/auth/business.guard';
import { RequireModuleScope } from '../../core/auth/module-scope.guard';
import { PushNotificationService } from './push-notification.service';

interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

@Controller('api/businesses/:businessId/push')
@UseGuards(BusinessGuard)
export class PushNotificationController {
  constructor(
    @Inject(PushNotificationService) private readonly push: PushNotificationService,
  ) {}

  @Post('subscribe')
  @RequireModuleScope('settings')
  async subscribe(
    @Param('businessId') businessId: string,
    @Body() body: { userId: string; subscription: PushSubscriptionInput },
  ) {
    if (!body.subscription?.endpoint || !body.subscription?.keys?.p256dh || !body.subscription?.keys?.auth) {
      throw new BadRequestException('Invalid subscription payload');
    }
    return this.push.subscribe(body.userId, businessId, body.subscription as any);
  }

  @Post('unsubscribe')
  @RequireModuleScope('settings')
  async unsubscribe(@Body() body: { endpoint: string }) {
    if (!body.endpoint) throw new BadRequestException('Endpoint required');
    return this.push.unsubscribe(body.endpoint);
  }

  @Post('test')
  @RequireModuleScope('settings')
  async sendTest(
    @Param('businessId') businessId: string,
    @Body() body: { title?: string; body?: string },
  ) {
    return this.push.sendToBusiness(businessId, {
      title: body.title || 'Test Notification',
      body: body.body || 'Push notifications are working!',
      icon: '/icons/icon-192x192.png',
      url: '/app',
    });
  }

  @Get('config')
  @RequireModuleScope('settings')
  getConfig() {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY || null,
      enabled: this.push.isConfigured(),
    };
  }
}
