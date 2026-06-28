import { Injectable } from '@nestjs/common';
import { ConnectorCommand, ConnectorResult } from '../key-cortex-connector.types';
import { connectorOk, connectorFail } from '../key-cortex-connector.utils';
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

  async execute(command: ConnectorCommand): Promise<ConnectorResult> {
    const start = Date.now();
    switch (command.action) {
      case 'send_notification': {
        const notification = await this.sendNotification({
          businessId: command.businessId,
          userId: command.parameters.userId as string,
          title: command.parameters.title as string,
          body: command.parameters.body as string,
          actionUrl: command.parameters.actionUrl as string,
          priority: (command.parameters.priority as string) || 'normal',
        });
        return connectorOk(command, start, notification);
      }
      case 'create_alert': {
        const alert = await this.createAlert({
          businessId: command.businessId,
          title: command.parameters.title as string,
          description: command.parameters.description as string,
          severity: (command.parameters.severity as string) || 'info',
          entityType: command.parameters.entityType as string,
          entityId: command.parameters.entityId as string,
        });
        return connectorOk(command, start, alert);
      }
      case 'dismiss_alert': {
        const dismissed = await this.dismissAlert({
          businessId: command.businessId,
          alertId: command.parameters.alertId as string,
          notes: command.parameters.notes as string,
        });
        return connectorOk(command, start, dismissed);
      }
      case 'send_digest': {
        const digest = await this.sendDigest({
          businessId: command.businessId,
          userId: command.parameters.userId as string,
          period: command.parameters.period as string,
          sections: command.parameters.sections as string[],
        });
        return connectorOk(command, start, digest);
      }
      case 'update_preferences': {
        const prefs = await this.updatePreferences({
          businessId: command.businessId,
          userId: command.parameters.userId as string,
          channel: command.parameters.channel as string,
          enabled: command.parameters.enabled as boolean,
          categories: command.parameters.categories as string[],
        });
        return connectorOk(command, start, prefs);
      }
      case 'broadcast_alert': {
        const broadcast = await this.broadcastAlert({
          businessId: command.businessId,
          title: command.parameters.title as string,
          body: command.parameters.body as string,
          severity: (command.parameters.severity as string) || 'info',
        });
        return connectorOk(command, start, broadcast);
      }
      default:
        return connectorFail(command, start, `Unknown notifications action: ${command.action}`);
    }
  }
}
