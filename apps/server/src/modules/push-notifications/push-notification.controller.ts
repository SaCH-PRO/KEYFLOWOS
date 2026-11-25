import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  UseGuards,
  Inject,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { BusinessGuard } from '../../core/auth/business.guard';
import { RateLimit } from '../../core/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../../core/guards/rate-limit.guard';
import { PushNotificationService } from './push-notification.service';

interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** The member a request acts for (AuthMiddleware attaches it; BusinessGuard requires it). */
type MemberRequest = { user?: { id?: string } };

const callerOf = (req: MemberRequest): string => {
  const id = req.user?.id;
  if (!id) throw new UnauthorizedException('Authentication required');
  return id;
};

/**
 * SWEEP-P0-FOLLOWUP (REST scope census owner question 3, answered by default): these are the member's own device
 * routes, open to every member, so the unenforced `@RequireModuleScope('settings')` (no ModuleScopeGuard ran it;
 * enforcing it would refuse every STAFF member their own push) is dropped. They were not the member's own, though:
 * subscribe stored the device under the user id the body named and unsubscribe removed any endpoint, so a member
 * could register their browser for the owner's pushes (the owner alerts, D-154) or remove the owner's device.
 * Now a subscription is the caller's (PushNotificationService.subscribeOwn), unsubscribe removes only the caller's
 * own, and the test push goes to the caller's own devices in `:businessId` under a rate limit (P71 / MIN-4).
 */
@Controller('api/businesses/:businessId/push')
@UseGuards(BusinessGuard)
export class PushNotificationController {
  constructor(
    @Inject(PushNotificationService) private readonly push: PushNotificationService,
  ) {}

  @Post('subscribe')
  async subscribe(
    @Param('businessId') businessId: string,
    @Body() body: { userId?: string; subscription?: PushSubscriptionInput },
    @Req() req: MemberRequest,
  ) {
    if (
      typeof body?.subscription?.endpoint !== 'string' ||
      typeof body?.subscription?.keys?.p256dh !== 'string' ||
      typeof body?.subscription?.keys?.auth !== 'string'
    ) {
      throw new BadRequestException('Invalid subscription payload');
    }
    return this.push.subscribeOwn(callerOf(req), businessId, {
      endpoint: body.subscription.endpoint,
      keys: {
        p256dh: body.subscription.keys.p256dh,
        auth: body.subscription.keys.auth,
      },
    });
  }

  @Post('unsubscribe')
  async unsubscribe(@Body() body: { endpoint?: string }, @Req() req: MemberRequest) {
    if (typeof body?.endpoint !== 'string' || !body.endpoint.trim()) {
      throw new BadRequestException('Endpoint required');
    }
    return this.push.unsubscribeOwn(callerOf(req), body.endpoint);
  }

  @Post('test')
  @UseGuards(RateLimitGuard)
  @RateLimit(5, 60_000)
  async sendTest(
    @Param('businessId') businessId: string,
    @Body() body: { title?: string; body?: string },
    @Req() req: MemberRequest,
  ) {
    const title =
      typeof body?.title === 'string' && body.title.trim().length > 0
        ? body.title.trim().slice(0, 120)
        : 'Test Notification';
    const message =
      typeof body?.body === 'string' && body.body.trim().length > 0
        ? body.body.trim().slice(0, 300)
        : 'Push notifications are working!';
    return this.push.sendToBusinessUsers(businessId, [callerOf(req)], {
      title,
      body: message,
      icon: '/icons/icon-192x192.png',
      url: '/app',
    });
  }

  @Get('config')
  getConfig() {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY || null,
      enabled: this.push.isConfigured(),
    };
  }
}
