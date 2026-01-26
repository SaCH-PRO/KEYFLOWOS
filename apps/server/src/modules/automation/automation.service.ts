import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmService } from '../crm/crm.service';

type AutomationEvent =
  | { type: 'contact.stage_changed'; businessId: string; contactId: string; from?: string | null; to: string }
  | { type: 'contact.created'; businessId: string; contactId: string }
  | { type: 'contact.updated'; businessId: string; contactId: string }
  | { type: 'contact.merged'; businessId: string; contactId: string; duplicateId: string }
  | { type: 'invoice.paid'; businessId: string; contactId: string; invoiceId: string; total?: number; currency?: string }
  | { type: 'invoice.overdue'; businessId: string; contactId: string; invoiceId: string; total?: number; currency?: string }
  | { type: 'invoice.sent'; businessId: string; contactId: string; invoiceId: string; total?: number; currency?: string }
  | { type: 'booking.created'; businessId: string; contactId: string; bookingId: string; status?: string }
  | { type: 'booking.confirmed'; businessId: string; contactId: string; bookingId: string; status?: string }
  | { type: 'booking.status_changed'; businessId: string; contactId: string; bookingId: string; status: string };

type AutomationAction =
  | { kind: 'CREATE_TASK'; title: string; dueInDays?: number; priority?: string }
  | { kind: 'TAG_CONTACT'; tag: string }
  | { kind: 'LOG_EVENT'; eventType: string; data?: any };

type StoredAutomationAction = AutomationAction & { enabled?: boolean };

const DEFAULT_RULES: { match: AutomationEvent['type']; actions: AutomationAction[] }[] = [
  {
    match: 'contact.stage_changed',
    actions: [
      { kind: 'CREATE_TASK', title: 'Follow up after stage change', dueInDays: 2, priority: 'HIGH' },
      { kind: 'TAG_CONTACT', tag: 'stage-changed' },
    ],
  },
  {
    match: 'invoice.overdue',
    actions: [
      { kind: 'CREATE_TASK', title: 'Collect overdue invoice', priority: 'HIGH', dueInDays: 1 },
      { kind: 'TAG_CONTACT', tag: 'overdue' },
    ],
  },
  {
    match: 'invoice.paid',
    actions: [{ kind: 'CREATE_TASK', title: 'Send thank-you note', dueInDays: 1 }],
  },
  {
    match: 'booking.status_changed',
    actions: [{ kind: 'LOG_EVENT', eventType: 'booking.status.followup' }],
  },
];

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);
  private readonly recent: { at: Date; event: string; contactId: string; businessId: string }[] = [];

  constructor(
    private readonly crm: CrmService,
    private readonly prisma: PrismaService,
  ) {}

  health() {
    return { status: 'ok', recent: this.recent.slice(-10) };
  }

  async handle(event: AutomationEvent) {
    const rules = DEFAULT_RULES.filter((r) => r.match === event.type);
    const dynamicActions = await this.loadDynamicActions(event.businessId, event.type);
    const actions = [
      ...rules.flatMap((rule) => rule.actions),
      ...dynamicActions,
    ];
    if (actions.length === 0) return;

    for (const action of actions) {
      await this.runAction(event, action);
    }
    this.recent.push({ at: new Date(), event: event.type, contactId: event.contactId, businessId: event.businessId });
    if (this.recent.length > 50) this.recent.shift();
  }

  private async runAction(event: AutomationEvent, action: AutomationAction) {
    switch (action.kind) {
      case 'CREATE_TASK': {
        const due = action.dueInDays ? new Date(Date.now() + action.dueInDays * 86400000).toISOString() : undefined;
        await this.crm.addTask({
          businessId: event.businessId,
          contactId: event.contactId,
          title: action.title,
          priority: action.priority ?? 'NORMAL',
          dueDate: due,
          source: 'automation',
        });
        break;
      }
      case 'TAG_CONTACT': {
        const tags = await this.crmMergeTag(event.businessId, event.contactId, action.tag);
        await this.crm.updateContact({
          businessId: event.businessId,
          contactId: event.contactId,
          tags,
        });
        break;
      }
      case 'LOG_EVENT': {
        await this.crm.logContactEvent({
          businessId: event.businessId,
          contactId: event.contactId,
          type: action.eventType,
          data: { trigger: event },
          source: 'automation',
          actorType: 'SYSTEM',
        });
        break;
      }
      default:
        this.logger.warn(`Unhandled automation action ${JSON.stringify(action)}`);
    }
  }

  async listAutomations(businessId: string) {
    return this.prisma.client.automation.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAutomation(input: { businessId: string; name: string; trigger: string; actionData?: any }) {
    return this.prisma.client.automation.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        trigger: input.trigger,
        actionData: input.actionData ?? {},
      },
    });
  }

  async updateAutomation(input: {
    businessId: string;
    automationId: string;
    name?: string;
    trigger?: string;
    actionData?: any;
  }) {
    return this.prisma.client.automation.update({
      where: { id: input.automationId },
      data: {
        name: input.name ?? undefined,
        trigger: input.trigger ?? undefined,
        actionData: input.actionData ?? undefined,
      },
    });
  }

  async deleteAutomation(input: { businessId: string; automationId: string }) {
    await this.prisma.client.automation.delete({
      where: { id: input.automationId },
    });
    return { success: true, id: input.automationId };
  }

  private async loadDynamicActions(businessId: string, trigger: string): Promise<AutomationAction[]> {
    const automations = await this.prisma.client.automation.findMany({
      where: { businessId, trigger },
      orderBy: { createdAt: 'asc' },
    });
    if (!automations.length) return [];
    const actions: AutomationAction[] = [];
    for (const automation of automations) {
      const parsed = this.parseActionData(automation.actionData);
      actions.push(...parsed);
    }
    return actions;
  }

  private parseActionData(actionData: unknown): AutomationAction[] {
    if (!actionData || typeof actionData !== 'object') return [];
    if (Array.isArray(actionData)) {
      return actionData.filter((action): action is AutomationAction => this.isValidAction(action));
    }
    const record = actionData as Record<string, unknown>;
    if (Array.isArray(record.actions)) {
      return record.actions.filter((action): action is AutomationAction => this.isValidAction(action));
    }
    if (this.isValidAction(record)) return [record];
    return [];
  }

  private isValidAction(action: unknown): action is StoredAutomationAction {
    if (!action || typeof action !== 'object') return false;
    const record = action as Record<string, unknown>;
    if (record.enabled === false) return false;
    if (record.kind === 'CREATE_TASK') {
      return typeof record.title === 'string' && record.title.trim().length > 0;
    }
    if (record.kind === 'TAG_CONTACT') {
      return typeof record.tag === 'string' && record.tag.trim().length > 0;
    }
    if (record.kind === 'LOG_EVENT') {
      return typeof record.eventType === 'string' && record.eventType.trim().length > 0;
    }
    return false;
  }

  // Helper to avoid duplicating tags; this uses a placeholder fetch due to limited scope
  private async crmMergeTag(businessId: string, contactId: string, tag: string): Promise<string[]> {
    try {
      const contact = await this.crm.contactDetail({ businessId, contactId });
      const tags = new Set<string>(contact.contact?.tags ?? []);
      tags.add(tag);
      return Array.from(tags);
    } catch (e) {
      this.logger.warn(`Failed to merge tag for contact ${contactId}: ${e}`);
      return [tag];
    }
  }
}
