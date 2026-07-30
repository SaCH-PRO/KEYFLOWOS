import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CommandService } from '../command/command.service';

export interface ActionContext {
  businessId: string;
  flowId: string;
  runId: string;
  contactId?: string | null;
  userId?: string | null;
  input: Record<string, unknown>;
  test?: boolean;
}

export type ActionExecutor = (ctx: ActionContext, config: Record<string, unknown>) => Promise<Record<string, unknown>>;

@Injectable()
export class FlowActionRegistry {
  private readonly logger = new Logger(FlowActionRegistry.name);
  private actions = new Map<string, ActionExecutor>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommandService) private readonly commands: CommandService,
  ) {
    this.registerBuiltins();
  }

  register(type: string, executor: ActionExecutor) {
    this.actions.set(type, executor);
  }

  get(type: string): ActionExecutor | undefined {
    return this.actions.get(type);
  }

  private registerBuiltins() {
    this.register('create_command_item', async (ctx, config) => {
      const title = typeof config.title === 'string' && config.title.trim()
        ? config.title.trim()
        : 'Flow command';
      const item = await this.commands.create(ctx.businessId, {
        sourceModule: 'FLOW',
        sourceType: typeof config.sourceType === 'string' ? config.sourceType : 'AUTOMATION',
        sourceId: ctx.runId,
        title,
        description: typeof config.description === 'string' ? config.description : undefined,
        category: typeof config.category === 'string' ? config.category : 'SYSTEM',
        actionType: typeof config.actionType === 'string' ? config.actionType : 'AUTOMATION',
        status: 'OPEN',
        priority: typeof config.priority === 'number' ? config.priority : 50,
        urgency: typeof config.urgency === 'number' ? config.urgency : 50,
        impactScore: typeof config.impactScore === 'number' ? config.impactScore : 0,
        riskTier: typeof config.riskTier === 'number' ? config.riskTier : 1,
        requiresApproval: config.requiresApproval === true,
        recommendedBy: 'KEY',
        ownerType: typeof config.ownerType === 'string' ? config.ownerType : undefined,
        ownerId: typeof config.ownerId === 'string' ? config.ownerId : undefined,
        executionPayload: config,
      });
      return { commandItemId: item.id };
    });

    this.register('draft_message', async (ctx, config) => {
      const channel = typeof config.channel === 'string' ? config.channel : 'whatsapp';
      const purpose = typeof config.purpose === 'string' ? config.purpose : 'reply';
      const body = typeof config.body === 'string' ? config.body : '';
      const requiresApproval = config.requiresApproval !== false;
      const riskTier = typeof config.riskTier === 'number' ? config.riskTier : 2;

      const draft = await this.prisma.client.responseDraft.create({
        data: {
          businessId: ctx.businessId,
          contactId: ctx.contactId ?? null,
          channel,
          purpose,
          body,
          status: requiresApproval ? 'PENDING_APPROVAL' : 'APPROVED',
          requiresApproval,
          riskTier,
          createdBy: 'KEY',
          evidence: [{ source: 'flow', runId: ctx.runId, nodeId: ctx.input.nodeId }],
        },
      });
      return { draftId: draft.id, status: draft.status };
    });

    this.register('notify_user', async (ctx, config) => {
      const message = typeof config.message === 'string' ? config.message : 'Flow notification';
      const title = typeof config.title === 'string' ? config.title : 'Automation';
      const item = await this.commands.create(ctx.businessId, {
        sourceModule: 'FLOW',
        sourceType: 'NOTIFICATION',
        sourceId: ctx.runId,
        title,
        description: message,
        category: 'SYSTEM',
        actionType: 'NOTIFY',
        status: 'OPEN',
        priority: typeof config.priority === 'number' ? config.priority : 40,
        urgency: typeof config.urgency === 'number' ? config.urgency : 40,
        riskTier: 1,
        requiresApproval: false,
        recommendedBy: 'KEY',
      });
      return { notificationId: item.id };
    });

    this.register('create_task', async (ctx, config) => {
      const title = typeof config.title === 'string' && config.title.trim()
        ? config.title.trim()
        : 'Flow task';
      const item = await this.commands.create(ctx.businessId, {
        sourceModule: 'FLOW',
        sourceType: 'TASK',
        sourceId: ctx.runId,
        title,
        description: typeof config.description === 'string' ? config.description : undefined,
        category: typeof config.category === 'string' ? config.category : 'SYSTEM',
        actionType: typeof config.actionType === 'string' ? config.actionType : 'TASK',
        status: 'OPEN',
        priority: typeof config.priority === 'number' ? config.priority : 50,
        urgency: typeof config.urgency === 'number' ? config.urgency : 50,
        impactScore: typeof config.impactScore === 'number' ? config.impactScore : 0,
        riskTier: typeof config.riskTier === 'number' ? config.riskTier : 1,
        requiresApproval: config.requiresApproval === true,
        recommendedBy: 'KEY',
        ownerType: typeof config.ownerType === 'string' ? config.ownerType : undefined,
        ownerId: typeof config.ownerId === 'string' ? config.ownerId : undefined,
        dueAt: typeof config.dueAt === 'string' ? new Date(config.dueAt) : undefined,
        executionPayload: config,
      });
      return { taskId: item.id };
    });

    this.register('send_message', async (ctx, config) => {
      const requiresApproval = config.requiresApproval !== false;
      const riskTier = typeof config.riskTier === 'number' ? config.riskTier : 3;
      const body = typeof config.body === 'string' ? config.body : '';
      const channel = typeof config.channel === 'string' ? config.channel : 'whatsapp';

      if (requiresApproval) {
        const draft = await this.prisma.client.responseDraft.create({
          data: {
            businessId: ctx.businessId,
            contactId: ctx.contactId ?? null,
            channel,
            purpose: 'follow_up',
            body,
            status: 'PENDING_APPROVAL',
            requiresApproval: true,
            riskTier,
            createdBy: 'KEY',
            evidence: [{ source: 'flow', runId: ctx.runId, nodeId: ctx.input.nodeId, requiresApproval: true }],
          },
        });
        return { draftId: draft.id, sent: false, awaitingApproval: true };
      }

      return { sent: true, channel, body, direct: true };
    });

    this.register('create_contact', async (ctx, config) => {
      const data = config.contactData;
      if (!data || typeof data !== 'object') {
        throw new Error('create_contact action requires contactData object');
      }
      const contactData = data as Record<string, unknown>;
      const phone = typeof contactData.phone === 'string' ? contactData.phone : null;
      const email = typeof contactData.email === 'string' ? contactData.email : null;

      // Check for duplicates
      if (email || phone) {
        const existing = await this.prisma.client.contact.findFirst({
          where: {
            businessId: ctx.businessId,
            OR: [
              ...(email ? [{ email }] : []),
              ...(phone ? [{ phone }] : []),
            ],
            deletedAt: null,
          },
          select: { id: true },
        });
        if (existing) {
          return { contactId: existing.id, created: false, duplicate: true };
        }
      }

      const contact = await this.prisma.client.contact.create({
        data: {
          businessId: ctx.businessId,
          firstName: typeof contactData.firstName === 'string' ? contactData.firstName
            : typeof contactData.name === 'string' ? contactData.name : 'New',
          lastName: typeof contactData.lastName === 'string' ? contactData.lastName : 'Contact',
          email,
          phone,
          companyName: typeof contactData.company === 'string' ? contactData.company : null,
          tags: Array.isArray(contactData.tags) ? contactData.tags as string[] : [],
          source: 'flow_automation',
          status: 'LEAD',
        },
      });
      return { contactId: contact.id, created: true };
    });
  }
}
