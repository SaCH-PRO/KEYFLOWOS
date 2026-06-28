import { Injectable } from '@nestjs/common';
import { NotificationsService } from '../../notifications/notifications.service';

/**
 * Typed adapter that exposes the notification methods expected by
 * KeyCortexConnectorService.  Delegates to NotificationsService where a
 * real implementation exists; otherwise returns a typed placeholder.
 */
@Injectable()
export class NotificationsAdapterService {
  constructor(private readonly notifications: NotificationsService) {}

  async sendNotification(input: {
    businessId: string;
    userId?: string;
    title: string;
    body?: string;
    actionUrl?: string;
    priority?: string;
  }) {
    return this.notifications.create({
      businessId: input.businessId,
      type: input.priority?.toUpperCase() ?? 'INFO',
      title: input.title,
      body: input.body,
      data: { actionUrl: input.actionUrl, userId: input.userId },
    });
  }

  async createAlert(input: {
    businessId: string;
    title: string;
    description?: string;
    severity?: string;
    entityType?: string;
    entityId?: string;
  }) {
    return this.notifications.create({
      businessId: input.businessId,
      type: input.severity?.toUpperCase() ?? 'ALERT',
      title: input.title,
      body: input.description,
      data: { entityType: input.entityType, entityId: input.entityId },
    });
  }

  async dismissAlert(input: {
    businessId: string;
    alertId: string;
    notes?: string;
  }) {
    return this.notifications.markRead(input.alertId, input.businessId);
  }

  async sendDigest(input: {
    businessId: string;
    userId?: string;
    period?: string;
    sections?: string[];
  }) {
    return this.notifications.create({
      businessId: input.businessId,
      type: 'DIGEST',
      title: `Digest — ${input.period ?? 'daily'}`,
      body: (input.sections ?? []).join('\n'),
      data: { period: input.period, userId: input.userId },
    });
  }

  async updatePreferences(input: {
    businessId: string;
    userId?: string;
    channel?: string;
    enabled?: boolean;
    categories?: string[];
  }) {
    return {
      businessId: input.businessId,
      userId: input.userId,
      channel: input.channel,
      enabled: input.enabled,
      categories: input.categories,
      updated: true,
    };
  }

  async broadcastAlert(input: {
    businessId: string;
    title: string;
    body?: string;
    severity?: string;
  }) {
    return this.notifications.create({
      businessId: input.businessId,
      type: input.severity?.toUpperCase() ?? 'BROADCAST',
      title: input.title,
      body: input.body,
    });
  }

  async getAlerts(input: { businessId: string; acknowledged?: boolean }) {
    return this.notifications.listForBusiness(input.businessId, {
      unreadOnly: input.acknowledged === false,
      limit: 50,
    });
  }
}
