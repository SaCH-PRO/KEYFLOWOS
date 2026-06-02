import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface TriggerMatch {
  triggerId: string;
  actions: Record<string, unknown>[];
  channel: string;
  eventType: string;
}

/**
 * Event-driven automation triggers.
 *
 * - Defines trigger rules: WHEN event X on channel Y, DO actions Z
   - Supports system triggers (seeded) and user-defined triggers
   - Evaluates conditions against event payload
 */
@Injectable()
export class TriggerDefinitionService {
  private readonly logger = new Logger(TriggerDefinitionService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async seedSystemTriggers(businessId: string) {
    const systemTriggers = [
      {
        channel: 'whatsapp',
        eventType: 'inbound_message',
        name: 'Auto-reply to off-hours WhatsApp',
        condition: { hour: { gte: 18 }, or: { hour: { lte: 8 } } },
        actions: [{ type: 'auto_reply', template: 'off_hours_ack' }],
        enabled: true,
        isSystem: true,
      },
      {
        channel: 'email',
        eventType: 'inbound_message',
        name: 'Flag urgent email for review',
        condition: { subjectContains: ['urgent', 'asap', 'complaint'] },
        actions: [{ type: 'create_command', priority: 'HIGH' }, { type: 'notify_owner' }],
        enabled: true,
        isSystem: true,
      },
      {
        channel: 'sms',
        eventType: 'inbound_message',
        name: 'SMS booking request → create lead',
        condition: { bodyContains: ['book', 'appointment', 'schedule'] },
        actions: [{ type: 'create_command', commandType: 'lead' }, { type: 'draft_reply' }],
        enabled: true,
        isSystem: true,
      },
      {
        channel: 'form',
        eventType: 'submission',
        name: 'New website form → notify + create lead',
        condition: { always: true },
        actions: [{ type: 'create_command', commandType: 'lead' }, { type: 'notify_owner' }],
        enabled: true,
        isSystem: true,
      },
      {
        channel: 'call',
        eventType: 'missed_call',
        name: 'Missed call → create callback command',
        condition: { always: true },
        actions: [{ type: 'create_command', commandType: 'call_back' }, { type: 'send_sms', template: 'missed_call' }],
        enabled: true,
        isSystem: true,
      },
    ];

    for (const t of systemTriggers) {
      const exists = await this.prisma.client.triggerDefinition.findFirst({
        where: {
          businessId,
          channel: t.channel ?? 'unknown',
          eventType: t.eventType,
          name: t.name,
        },
      });

      if (!exists) {
        await this.prisma.client.triggerDefinition.create({
          data: {
            businessId,
            ...t,
            condition: t.condition as Record<string, unknown>,
            actions: t.actions as unknown as Record<string, unknown>[],
          },
        });
        this.logger.log(`Seeded trigger: ${t.name} for ${businessId}`);
      }
    }
  }

  async listTriggers(businessId: string, filters?: { enabled?: boolean; channel?: string }) {
    const where: Record<string, unknown> = { businessId };
    if (filters?.enabled !== undefined) where.enabled = filters.enabled;
    if (filters?.channel) where.channel = filters.channel;

    return this.prisma.client.triggerDefinition.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async createTrigger(
    businessId: string,
    input: {
      channel: string;
      eventType: string;
      name: string;
      condition: Record<string, unknown>;
      actions: Record<string, unknown>[];
      enabled?: boolean;
    },
  ) {
    return this.prisma.client.triggerDefinition.create({
      data: {
        businessId,
        channel: input.channel,
        eventType: input.eventType,
        name: input.name,
        condition: input.condition,
        actions: input.actions,
        enabled: input.enabled ?? true,
        isSystem: false,
      },
    });
  }

  async toggleTrigger(triggerId: string, enabled: boolean) {
    return this.prisma.client.triggerDefinition.update({
      where: { id: triggerId },
      data: { enabled },
    });
  }

  async evaluateTriggers(
    businessId: string,
    channel: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<TriggerMatch[]> {
    const triggers = await this.prisma.client.triggerDefinition.findMany({
      where: { businessId, channel, eventType, enabled: true },
    });

    const matches: TriggerMatch[] = [];

    for (const t of triggers) {
      const condition = t.condition as Record<string, unknown>;
      if (this.matchesCondition(condition, payload)) {
        matches.push({
          triggerId: t.id,
          actions: t.actions as Record<string, unknown>[],
          channel: t.channel ?? 'unknown',
          eventType: t.eventType ?? 'unknown',
        });
      }
    }

    return matches;
  }

  private matchesCondition(
    condition: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): boolean {
    // Simple condition evaluator
    if (condition.always === true) return true;

    // hour-based condition
    if (condition.hour) {
      const hour = new Date().getHours();
      const hourCond = condition.hour as Record<string, number>;
      if (hourCond.gte !== undefined && hour < hourCond.gte) return false;
      if (hourCond.lte !== undefined && hour > hourCond.lte) return false;
    }

    // or condition
    if (condition.or) {
      const orCond = condition.or as Record<string, unknown>;
      return this.matchesCondition(orCond, payload);
    }

    // subjectContains
    if (condition.subjectContains) {
      const subject = (payload.subject as string)?.toLowerCase() ?? '';
      const keywords = condition.subjectContains as string[];
      if (!keywords.some((k) => subject.includes(k.toLowerCase()))) return false;
    }

    // bodyContains
    if (condition.bodyContains) {
      const body = (payload.body as string)?.toLowerCase() ?? '';
      const keywords = condition.bodyContains as string[];
      if (!keywords.some((k) => body.includes(k.toLowerCase()))) return false;
    }

    return true;
  }
}
