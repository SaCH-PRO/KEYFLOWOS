import { ForbiddenException, Injectable, Inject, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);
  private vapidReady = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {
    const vapidPublic = process.env.VAPID_PUBLIC_KEY?.trim();
    const vapidPrivate = process.env.VAPID_PRIVATE_KEY?.trim();
    const vapidSubject = process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@keyflowos.com';

    if (vapidPublic && vapidPrivate) {
      try {
        webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
        this.vapidReady = true;
      } catch (err: unknown) {
        this.logger.warn(
          `Invalid VAPID keys configured; push notifications disabled: ${err instanceof Error ? err.message : String(err)}`,
        );
        this.vapidReady = false;
      }
    } else {
      this.logger.warn('VAPID keys not configured. Push notifications will not work.');
    }
  }

  async subscribe(userId: string, businessId: string, subscription: webpush.PushSubscription) {
    const existing = await this.prisma.client.pushSubscription.findUnique({
      where: { endpoint: subscription.endpoint },
    });

    if (existing) {
      return this.prisma.client.pushSubscription.update({
        where: { id: existing.id },
        data: {
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          userId,
          businessId,
        },
      });
    }

    return this.prisma.client.pushSubscription.create({
      data: {
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userId,
        businessId,
      },
    });
  }

  /**
   * SWEEP-P0-FOLLOWUP (census owner question 3): a member's own device. An endpoint another member's subscription
   * already holds is not taken over (a browser endpoint is one device: it stays its subscriber's until they remove
   * it); the caller's own is refreshed.
   */
  async subscribeOwn(userId: string, businessId: string, subscription: webpush.PushSubscription) {
    const existing = await this.prisma.client.pushSubscription.findUnique({ where: { endpoint: subscription.endpoint }, select: { userId: true } });
    if (existing && existing.userId !== userId) throw new ForbiddenException('This device is subscribed by another member');
    return this.subscribe(userId, businessId, subscription);
  }

  /** SWEEP-P0-FOLLOWUP (census owner question 3): removes the caller's own subscription of that endpoint only. */
  async unsubscribeOwn(userId: string, endpoint: string) {
    return this.prisma.client.pushSubscription.deleteMany({ where: { endpoint, userId } });
  }

  async unsubscribe(endpoint: string) {
    return this.prisma.client.pushSubscription.deleteMany({
      where: { endpoint },
    });
  }

  protected sendPushNotification(
    subscription: webpush.PushSubscription,
    serializedPayload: string,
  ): Promise<unknown> {
    return webpush.sendNotification(subscription, serializedPayload);
  }

  async sendToUser(userId: string, payload: { title: string; body: string; icon?: string; url?: string }) {
    const subs = await this.prisma.client.pushSubscription.findMany({
      where: { userId },
    });

    const results = await Promise.allSettled(
      subs.map((sub) =>
        this.sendPushNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        ),
      ),
    );

    // Clean up expired subscriptions
    const expiredEndpoints: string[] = [];
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        const err = result.reason as webpush.WebPushError;
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          expiredEndpoints.push(subs[i].endpoint);
        }
      }
    });

    if (expiredEndpoints.length > 0) {
      await this.prisma.client.pushSubscription.deleteMany({
        where: { endpoint: { in: expiredEndpoints } },
      });
    }

    return { sent: results.filter((r) => r.status === 'fulfilled').length, failed: results.filter((r) => r.status === 'rejected').length };
  }

  async sendToBusiness(businessId: string, payload: { title: string; body: string; icon?: string; url?: string }) {
    const subs = await this.prisma.client.pushSubscription.findMany({
      where: { businessId },
    });

    const results = await Promise.allSettled(
      subs.map((sub) =>
        this.sendPushNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        ),
      ),
    );

    const expiredEndpoints: string[] = [];
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        const err = result.reason as webpush.WebPushError;
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          expiredEndpoints.push(subs[i].endpoint);
        }
      }
    });

    if (expiredEndpoints.length > 0) {
      await this.prisma.client.pushSubscription.deleteMany({
        where: { businessId, endpoint: { in: expiredEndpoints } },
      });
    }

    return { sent: results.filter((r) => r.status === 'fulfilled').length, failed: results.filter((r) => r.status === 'rejected').length };
  }

  /**
   * OWNER-ALERTS-SERVER (V1-65): tenant- and user-scoped web-push delivery for
   * business owners. Only queries PushSubscription rows belonging to both
   * `businessId` and `userIds`; skips delivery cleanly when VAPID keys are not
   * configured so callers can trigger email fallback; prunes 410/404 expired
   * subscriptions strictly within `businessId`.
   */
  async sendToBusinessUsers(
    businessId: string,
    userIds: string[],
    payload: { title: string; body: string; icon?: string; url?: string; tag?: string; data?: Record<string, unknown> },
  ): Promise<{ attempted: number; sent: number; failed: number }> {
    const uniqueUserIds = Array.from(new Set(userIds.filter((id) => typeof id === 'string' && id.trim().length > 0)));
    if (!businessId || uniqueUserIds.length === 0) {
      return { attempted: 0, sent: 0, failed: 0 };
    }

    const subs = await this.prisma.client.pushSubscription.findMany({
      where: { businessId, userId: { in: uniqueUserIds } },
    });
    if (subs.length === 0) {
      return { attempted: 0, sent: 0, failed: 0 };
    }
    if (!this.isConfigured()) {
      return { attempted: 0, sent: 0, failed: 0 };
    }

    const serialized = JSON.stringify(payload);
    const results = await Promise.allSettled(
      subs.map((sub) =>
        this.sendPushNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          serialized,
        ),
      ),
    );

    const expiredEndpoints: string[] = [];
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        const err = result.reason as webpush.WebPushError;
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          expiredEndpoints.push(subs[i].endpoint);
        }
      }
    });

    if (expiredEndpoints.length > 0) {
      await this.prisma.client.pushSubscription.deleteMany({
        where: { businessId, endpoint: { in: expiredEndpoints } },
      });
    }

    const sent = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    return { attempted: subs.length, sent, failed };
  }

  isConfigured(): boolean {
    return this.vapidReady && Boolean(process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim());
  }
}
