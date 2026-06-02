import { Injectable, Inject, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {
    const vapidPublic = process.env.VAPID_PUBLIC_KEY;
    const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
    const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@keyflowos.com';

    if (vapidPublic && vapidPrivate) {
      webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
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

  async unsubscribe(endpoint: string) {
    return this.prisma.client.pushSubscription.deleteMany({
      where: { endpoint },
    });
  }

  async sendToUser(userId: string, payload: { title: string; body: string; icon?: string; url?: string }) {
    const subs = await this.prisma.client.pushSubscription.findMany({
      where: { userId },
    });

    const results = await Promise.allSettled(
      subs.map((sub) =>
        webpush.sendNotification(
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
        webpush.sendNotification(
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
        where: { endpoint: { in: expiredEndpoints } },
      });
    }

    return { sent: results.filter((r) => r.status === 'fulfilled').length, failed: results.filter((r) => r.status === 'rejected').length };
  }

  isConfigured(): boolean {
    return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  }
}
