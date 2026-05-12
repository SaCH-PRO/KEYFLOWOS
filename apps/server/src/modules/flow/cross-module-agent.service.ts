import { Inject, Injectable, Logger, Optional, NotFoundException, BadRequestException, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ActivityService } from './activity.service';
import { CrmService } from '../crm/crm.service';
import { GmailService } from '../commerce/gmail.service';
import { TransactionalEmailService } from '../notifications/transactional-email.service';
import {
  QuoteSentPayload,
  QuoteConvertedPayload,
  ProductCreatedPayload,
  ProductUpdatedPayload,
  CampaignSentPayload,
  LeadFormSubmittedPayload,
  BookingCompletedPayload,
  BookingCancelledPayload,
  BookingRescheduledPayload,
} from '../../core/event-bus/events.types';

export interface WorkflowDefinition {
  key: string;
  name: string;
  description: string;
  category: string;
  triggerEvent: string;
  defaultEnabled: boolean;
  configSchema: { key: string; label: string; type: string; default: any }[];
}

export const WORKFLOW_DEFINITIONS: WorkflowDefinition[] = [
  {
    key: 'quote_followup',
    name: 'Quote Follow-Up Reminders',
    description: 'When a quote is sent, schedule checks at Day 3 and Day 7. If still unconverted, create follow-up tasks and optionally send a reminder email.',
    category: 'Commerce',
    triggerEvent: 'quote.sent',
    defaultEnabled: true,
    configSchema: [
      { key: 'firstFollowUpDays', label: 'First follow-up (days)', type: 'number', default: 3 },
      { key: 'secondFollowUpDays', label: 'Alert follow-up (days)', type: 'number', default: 7 },
      { key: 'autoSendEmail', label: 'Auto-send follow-up email (requires Gmail)', type: 'boolean', default: false },
    ],
  },
  {
    key: 'lead_form_pipeline',
    name: 'Lead Form → CRM → Campaign',
    description: 'Auto-create CRM contact from lead form submissions, tag with form name, and enroll in welcome campaign.',
    category: 'Marketing',
    triggerEvent: 'lead_form.submitted',
    defaultEnabled: true,
    configSchema: [
      { key: 'autoEnrollCampaign', label: 'Auto-enroll in welcome campaign', type: 'boolean', default: true },
      { key: 'defaultTag', label: 'Default tag for leads', type: 'string', default: 'lead-form' },
    ],
  },
  {
    key: 'booking_completed_followup',
    name: 'Post-Booking Feedback Request',
    description: 'After a booking is completed, schedule a follow-up review request and suggest rebooking.',
    category: 'Bookings',
    triggerEvent: 'booking.completed',
    defaultEnabled: true,
    configSchema: [
      { key: 'followUpDelayDays', label: 'Feedback request delay (days)', type: 'number', default: 1 },
    ],
  },
  {
    key: 'booking_cancelled_reengagement',
    name: 'Cancelled Booking Re-engagement',
    description: 'When a booking is cancelled, trigger a re-engagement outreach to the contact.',
    category: 'Bookings',
    triggerEvent: 'booking.cancelled',
    defaultEnabled: true,
    configSchema: [],
  },
  {
    key: 'booking_rescheduled_tracking',
    name: 'Reschedule Reliability Tracking',
    description: 'When a booking is rescheduled, log the event and update contact tracking.',
    category: 'Bookings',
    triggerEvent: 'booking.rescheduled',
    defaultEnabled: true,
    configSchema: [],
  },
  {
    key: 'new_product_marketing',
    name: 'New Product Marketing Suggestions',
    description: 'When a new product is created, generate marketing suggestions and notify the user.',
    category: 'Commerce',
    triggerEvent: 'product.created',
    defaultEnabled: true,
    configSchema: [],
  },
  {
    key: 'quote_conversion_tracking',
    name: 'Quote Conversion Tracking',
    description: 'When a quote is converted to an invoice, log the conversion and cancel outstanding follow-up tasks.',
    category: 'Commerce',
    triggerEvent: 'quote.converted',
    defaultEnabled: true,
    configSchema: [],
  },
  {
    key: 'product_update_tracking',
    name: 'Product Update Tracker',
    description: 'When a product is updated, log the change and notify you of potential storefront or campaign impacts.',
    category: 'Commerce',
    triggerEvent: 'product.updated',
    defaultEnabled: true,
    configSchema: [],
  },
  {
    key: 'campaign_engagement_scoring',
    name: 'Campaign Engagement Scoring',
    description: 'When a campaign is sent, update contact engagement scores for recipients.',
    category: 'Marketing',
    triggerEvent: 'campaign.sent',
    defaultEnabled: true,
    configSchema: [],
  },
  {
    key: 'store_order_crm_sync',
    name: 'Store Order → CRM Sync',
    description: 'When a store order is placed or paid, automatically find or create the customer in your CRM and log the order event to their timeline.',
    category: 'Commerce',
    triggerEvent: 'store_order.created',
    defaultEnabled: true,
    configSchema: [
      { key: 'createContactOnOrder', label: 'Auto-create CRM contact from order', type: 'boolean', default: true },
    ],
  },
  {
    key: 'store_order_revenue',
    name: 'Store Order → Revenue Record',
    description: 'When a store order is paid, automatically create an invoice in the Revenue module to keep your financials up to date.',
    category: 'Commerce',
    triggerEvent: 'store_order.paid',
    defaultEnabled: true,
    configSchema: [],
  },
  {
    key: 'store_order_refund_expense',
    name: 'Order Refund → Expense Tracking',
    description: 'When an order is refunded, record the refund amount as an expense so your P&L stays accurate.',
    category: 'Commerce',
    triggerEvent: 'store_order.refunded',
    defaultEnabled: true,
    configSchema: [],
  },
  {
    key: 'post_purchase_review_request',
    name: 'Post-Purchase Review Request',
    description: 'Three days after order delivery, send the customer a review request email and create a follow-up task in your CRM.',
    category: 'Commerce',
    triggerEvent: 'store_order.delivered',
    defaultEnabled: true,
    configSchema: [
      { key: 'reviewDelayDays', label: 'Days to wait before requesting review', type: 'number', default: 3 },
    ],
  },
  {
    key: 'post_purchase_reorder_prompt',
    name: 'Post-Purchase Reorder Prompt',
    description: '30 days after order delivery, automatically send a reorder prompt email and create a follow-up CRM task to re-engage the customer.',
    category: 'Commerce',
    triggerEvent: 'store_order.delivered',
    defaultEnabled: true,
    configSchema: [
      { key: 'reorderDelayDays', label: 'Days to wait before prompting reorder', type: 'number', default: 30 },
    ],
  },
  {
    key: 'inventory_low_alert',
    name: 'Low Stock Alert',
    description: 'When product inventory drops below the reorder threshold, send an in-app alert so you can restock in time.',
    category: 'Commerce',
    triggerEvent: 'inventory.low',
    defaultEnabled: true,
    configSchema: [],
  },
  {
    key: 'inventory_out_alert',
    name: 'Out of Stock Alert',
    description: 'When a product goes completely out of stock, trigger an immediate alert.',
    category: 'Commerce',
    triggerEvent: 'inventory.out',
    defaultEnabled: true,
    configSchema: [],
  },
  {
    key: 'purchase_order_expense',
    name: 'Purchase Order → Expense Record',
    description: 'When a purchase order is received, automatically log the sourcing cost as an expense.',
    category: 'Commerce',
    triggerEvent: 'purchaseOrder.received',
    defaultEnabled: true,
    configSchema: [],
  },
  {
    key: 'preorder_delay_notice',
    name: 'Pre-order Delay Notification',
    description: 'When a pre-order expected date is pushed back, automatically notify the customer by email.',
    category: 'Commerce',
    triggerEvent: 'preorder.delayed',
    defaultEnabled: true,
    configSchema: [],
  },
];

@Injectable()
export class CrossModuleAgentService implements OnModuleDestroy {
  private readonly logger = new Logger(CrossModuleAgentService.name);
  private jobPollerInterval: NodeJS.Timeout | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(CrmService) private readonly crm: CrmService,
    @Optional() @Inject(GmailService) private readonly gmail: GmailService | null,
    @Inject(TransactionalEmailService) private readonly emailService: TransactionalEmailService,
  ) {
    this.logger.log('CrossModuleAgentService initialized');
    this.startJobPoller();
  }

  onModuleDestroy() {
    if (this.jobPollerInterval) {
      clearInterval(this.jobPollerInterval);
      this.jobPollerInterval = null;
    }
  }

  private startJobPoller() {
    const POLL_INTERVAL_MS = 60_000;
    this.jobPollerInterval = setInterval(() => {
      this.processScheduledJobs().catch((e) =>
        this.logger.error(`[CrossModule] Job poller error: ${(e as Error).message}`),
      );
    }, POLL_INTERVAL_MS);
    this.logger.log('[CrossModule] Scheduled job poller started (60s interval)');
  }

  private async processScheduledJobs() {
    const dueJobs = await this.prisma.client.scheduledAgentJob.findMany({
      where: {
        status: 'PENDING',
        scheduledFor: { lte: new Date() },
      },
      take: 50,
      orderBy: { scheduledFor: 'asc' },
    });

    for (const job of dueJobs) {
      try {
        await this.executeScheduledJob(job);
        await this.prisma.client.scheduledAgentJob.update({
          where: { id: job.id },
          data: { status: 'COMPLETED', executedAt: new Date() },
        });
      } catch (e) {
        this.logger.error(`[CrossModule] Failed to execute job ${job.id}: ${(e as Error).message}`);
        await this.prisma.client.scheduledAgentJob.update({
          where: { id: job.id },
          data: { status: 'FAILED' },
        }).catch(() => {});
      }
    }
  }

  private async executeScheduledJob(job: { id: string; businessId: string; jobType: string; entityId: string; checkpoint: string; payload: any }) {
    if (job.jobType === 'quote_followup') {
      await this.executeQuoteFollowUpJob(job);
    } else if (job.jobType === 'post_purchase_review_request') {
      await this.executePostPurchaseReviewRequestJob(job);
    } else if (job.jobType === 'post_purchase_reorder_prompt') {
      await this.executePostPurchaseReorderPromptJob(job);
    } else {
      this.logger.warn(`[CrossModule] Unknown job type: ${job.jobType}`);
    }
  }

  private async executePostPurchaseReviewRequestJob(job: { businessId: string; entityId: string; payload: any }) {
    const { businessId, entityId: orderId, payload } = job;
    const p = payload as {
      contactId?: string;
      orderNumber?: string;
      orderId: string;
      customerEmail?: string;
      customerName?: string;
      currency?: string;
      total?: number;
      productNames?: string[];
    };

    if (p.customerEmail) {
      const productNames = p.productNames ?? [];

      await this.emailService.send({
        businessId,
        type: 'review_request',
        recipientEmail: p.customerEmail,
        recipientName: p.customerName ?? 'Customer',
        templateData: {
          customerName: p.customerName ?? 'Customer',
          orderNumber: p.orderNumber ?? p.orderId,
          productNames,
        },
        dedupeKey: `review-request-${orderId}`,
      });

      this.logger.log(`[CrossModule] Sent review request email for order ${p.orderNumber ?? orderId} to ${p.customerEmail}`);
    }

    if (p.contactId) {
      const reviewTitle = `Request product review for order ${p.orderNumber ?? orderId}`;
      const existingReviewTask = await this.prisma.client.contactTask.findFirst({
        where: { businessId, contactId: p.contactId, title: reviewTitle },
        select: { id: true },
      }).catch(() => null);
      if (!existingReviewTask) {
        await this.crm.addTask({
          businessId,
          contactId: p.contactId,
          title: reviewTitle,
          priority: 'NORMAL',
          dueDate: new Date().toISOString(),
          source: 'cross-module-agent',
        });
      }
    }
  }

  private async executePostPurchaseReorderPromptJob(job: { businessId: string; entityId: string; payload: any }) {
    const { businessId, entityId: orderId, payload } = job;
    const p = payload as {
      contactId?: string;
      orderNumber?: string;
      orderId: string;
      customerEmail?: string;
      customerName?: string;
      deliveredAt?: string;
      productNames?: string[];
    };

    if (p.customerEmail) {
      let daysSincePurchase: number | undefined;
      if (p.deliveredAt) {
        const delivered = new Date(p.deliveredAt);
        daysSincePurchase = Math.round((Date.now() - delivered.getTime()) / (1000 * 60 * 60 * 24));
      }

      await this.emailService.send({
        businessId,
        type: 'reorder_prompt',
        recipientEmail: p.customerEmail,
        recipientName: p.customerName ?? 'Customer',
        templateData: {
          customerName: p.customerName ?? 'Customer',
          orderNumber: p.orderNumber ?? p.orderId,
          productNames: p.productNames ?? [],
          daysSincePurchase,
        },
        dedupeKey: `reorder-prompt-${orderId}`,
      });

      this.logger.log(`[CrossModule] Sent reorder prompt email for order ${p.orderNumber ?? orderId} to ${p.customerEmail}`);
    }

    if (p.contactId) {
      const reorderTitle = `Follow up for reorder — order ${p.orderNumber ?? orderId}`;
      const existingReorderTask = await this.prisma.client.contactTask.findFirst({
        where: { businessId, contactId: p.contactId, title: reorderTitle },
        select: { id: true },
      }).catch(() => null);
      if (!existingReorderTask) {
        await this.crm.addTask({
          businessId,
          contactId: p.contactId,
          title: reorderTitle,
          priority: 'NORMAL',
          dueDate: new Date().toISOString(),
          source: 'cross-module-agent',
        });
      }
    }
  }

  private async executeQuoteFollowUpJob(job: { businessId: string; entityId: string; checkpoint: string; payload: any }) {
    const { businessId, entityId: quoteId, checkpoint, payload } = job;
    const p = payload as { contactId: string; quoteRef: string; days: number; autoSendEmail: boolean; contactName: string; contactEmail: string | null };

    const quote = await this.prisma.client.quote.findFirst({
      where: { id: quoteId, businessId },
      select: { status: true },
    });

    if (!quote || quote.status === 'CONVERTED' || quote.status === 'ACCEPTED') {
      this.logger.log(`[CrossModule] Quote ${p.quoteRef} already converted/accepted, skipping ${checkpoint} follow-up`);
      return;
    }

    const isFirst = checkpoint === 'day_first';
    const priority = isFirst ? 'HIGH' : 'URGENT';
    const titlePrefix = isFirst ? 'Follow up on' : 'ALERT:';
    const titleSuffix = isFirst ? `still unconverted after ${p.days} days` : `unconverted after ${p.days} days — review needed`;

    await this.crm.addTask({
      businessId,
      contactId: p.contactId,
      title: `${titlePrefix} quote ${p.quoteRef} — ${titleSuffix}`,
      priority,
      dueDate: new Date().toISOString(),
      source: 'cross-module-agent',
    });

    if (isFirst && p.autoSendEmail && this.gmail && p.contactEmail) {
      try {
        await this.gmail.sendEmail({
          businessId,
          to: p.contactEmail,
          subject: `Following up on your quote ${p.quoteRef}`,
          htmlBody: `<p>Hi ${p.contactName},</p><p>Just following up on the quote we sent you (${p.quoteRef}). Please let us know if you have any questions or would like to proceed.</p><p>Best regards</p>`,
        });
        this.logger.log(`[CrossModule] Sent follow-up email for quote ${p.quoteRef} to ${p.contactEmail}`);
      } catch (e) {
        this.logger.warn(`[CrossModule] Failed to send follow-up email: ${(e as Error).message}`);
      }
    }

    await this.activity.log({
      businessId,
      module: 'agent',
      action: isFirst ? 'quote_followup_day_first' : 'quote_followup_day_second',
      entityType: 'quote',
      entityId: quoteId,
      title: `Day ${p.days} quote follow-up executed`,
      detail: `Follow-up task created for quote ${p.quoteRef}${isFirst && p.autoSendEmail && p.contactEmail ? ', reminder email sent' : ''}. Quote status: ${quote.status}.`,
      icon: isFirst ? 'Clock' : 'AlertTriangle',
      tone: isFirst ? 'info' : 'warning',
      contactId: p.contactId,
      data: { quoteId, checkpoint, contactName: p.contactName, emailSent: !!(isFirst && p.autoSendEmail && p.contactEmail) },
    });

    await this.createNotification({
      businessId,
      type: isFirst ? 'agent.quote_followup_triggered' : 'agent.quote_followup_alert',
      title: `Quote ${p.quoteRef} — Day ${p.days} ${isFirst ? 'Follow-Up' : 'Alert'}`,
      body: isFirst
        ? `Quote still unconverted. Follow-up task created${p.autoSendEmail && p.contactEmail ? ' and reminder email sent' : ''}.`
        : `Quote still unconverted after ${p.days} days. Urgent review needed.`,
      data: { quoteId, contactId: p.contactId },
    }).catch(() => {});

    await this.recordWorkflowRun(businessId, 'quote_followup');
  }

  private async isWorkflowEnabled(businessId: string, workflowKey: string): Promise<{ enabled: boolean; config: any }> {
    const record = await this.prisma.client.crossModuleWorkflow.findUnique({
      where: { businessId_workflowKey: { businessId, workflowKey } },
    });

    if (!record) {
      const def = WORKFLOW_DEFINITIONS.find((d) => d.key === workflowKey);
      return { enabled: def?.defaultEnabled ?? false, config: {} };
    }

    return { enabled: record.enabled, config: record.config ?? {} };
  }

  private async recordWorkflowRun(businessId: string, workflowKey: string) {
    await this.prisma.client.crossModuleWorkflow.upsert({
      where: { businessId_workflowKey: { businessId, workflowKey } },
      update: { lastRunAt: new Date(), runCount: { increment: 1 } },
      create: { businessId, workflowKey, enabled: true, lastRunAt: new Date(), runCount: 1 },
    }).catch((e) => this.logger.warn(`Failed to record workflow run: ${e}`));
  }

  private async createNotification(input: {
    businessId: string;
    type: string;
    title: string;
    body?: string;
    data?: Record<string, unknown>;
  }) {
    return this.prisma.client.notification.create({
      data: {
        businessId: input.businessId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data ?? undefined,
      },
    });
  }

  async listWorkflows(businessId: string) {
    const records = await this.prisma.client.crossModuleWorkflow.findMany({
      where: { businessId },
    });

    const recordMap = new Map(records.map((r) => [r.workflowKey, r]));

    return WORKFLOW_DEFINITIONS.map((def) => {
      const record = recordMap.get(def.key);
      return {
        key: def.key,
        name: def.name,
        description: def.description,
        category: def.category,
        triggerEvent: def.triggerEvent,
        enabled: record ? record.enabled : def.defaultEnabled,
        config: record?.config ?? Object.fromEntries(def.configSchema.map((c) => [c.key, c.default])),
        configSchema: def.configSchema,
        lastRunAt: record?.lastRunAt ?? null,
        runCount: record?.runCount ?? 0,
      };
    });
  }

  async updateWorkflow(businessId: string, workflowKey: string, updates: { enabled?: boolean; config?: any }) {
    const def = WORKFLOW_DEFINITIONS.find((d) => d.key === workflowKey);
    if (!def) throw new NotFoundException(`Unknown workflow: ${workflowKey}`);

    if (updates.config && def.configSchema.length > 0) {
      for (const field of def.configSchema) {
        if (field.key in updates.config) {
          const val = updates.config[field.key];
          if (field.type === 'number' && (typeof val !== 'number' || val < 0)) {
            throw new BadRequestException(`Config "${field.key}" must be a non-negative number`);
          }
          if (field.type === 'boolean' && typeof val !== 'boolean') {
            throw new BadRequestException(`Config "${field.key}" must be a boolean`);
          }
          if (field.type === 'string' && typeof val !== 'string') {
            throw new BadRequestException(`Config "${field.key}" must be a string`);
          }
        }
      }
    }

    const record = await this.prisma.client.crossModuleWorkflow.upsert({
      where: { businessId_workflowKey: { businessId, workflowKey } },
      update: {
        ...(updates.enabled !== undefined && { enabled: updates.enabled }),
        ...(updates.config !== undefined && { config: updates.config }),
      },
      create: {
        businessId,
        workflowKey,
        enabled: updates.enabled ?? def.defaultEnabled,
        config: updates.config ?? {},
      },
    });

    await this.activity.log({
      businessId,
      module: 'agent',
      action: updates.enabled !== undefined ? (updates.enabled ? 'enabled' : 'disabled') : 'configured',
      entityType: 'workflow',
      entityId: workflowKey,
      title: `Cross-module workflow "${def.name}" ${updates.enabled !== undefined ? (updates.enabled ? 'enabled' : 'disabled') : 'updated'}`,
      icon: 'Settings',
      tone: 'info',
    });

    return record;
  }

  @OnEvent('quote.sent')
  async handleQuoteSent(payload: QuoteSentPayload) {
    try {
      const { enabled, config } = await this.isWorkflowEnabled(payload.businessId, 'quote_followup');
      if (!enabled) return;

      const contactId = payload.quote.contactId;
      if (!contactId) return;

      const quoteId = payload.quote.id;
      const quoteRef = payload.quote.quoteNumber ?? quoteId.slice(-6).toUpperCase();
      const firstDays = config.firstFollowUpDays ?? 3;
      const secondDays = config.secondFollowUpDays ?? 7;
      const autoSendEmail = config.autoSendEmail ?? false;
      const contactName = payload.quote.contact?.firstName ?? 'contact';
      const contactEmail = payload.quote.contact?.email ?? null;

      this.logger.log(`[CrossModule] quote.sent → scheduling Day ${firstDays} and Day ${secondDays} conversion checks for quote ${quoteRef}`);

      const now = new Date();
      const jobPayload = { contactId, quoteRef, autoSendEmail, contactName, contactEmail };

      await this.prisma.client.scheduledAgentJob.upsert({
        where: { businessId_entityId_checkpoint: { businessId: payload.businessId, entityId: quoteId, checkpoint: 'day_first' } },
        update: {
          status: 'PENDING',
          scheduledFor: new Date(now.getTime() + firstDays * 86400000),
          payload: { ...jobPayload, days: firstDays },
          executedAt: null,
        },
        create: {
          businessId: payload.businessId,
          jobType: 'quote_followup',
          entityId: quoteId,
          checkpoint: 'day_first',
          scheduledFor: new Date(now.getTime() + firstDays * 86400000),
          payload: { ...jobPayload, days: firstDays },
        },
      });

      await this.prisma.client.scheduledAgentJob.upsert({
        where: { businessId_entityId_checkpoint: { businessId: payload.businessId, entityId: quoteId, checkpoint: 'day_second' } },
        update: {
          status: 'PENDING',
          scheduledFor: new Date(now.getTime() + secondDays * 86400000),
          payload: { ...jobPayload, days: secondDays },
          executedAt: null,
        },
        create: {
          businessId: payload.businessId,
          jobType: 'quote_followup',
          entityId: quoteId,
          checkpoint: 'day_second',
          scheduledFor: new Date(now.getTime() + secondDays * 86400000),
          payload: { ...jobPayload, days: secondDays },
        },
      });

      await this.activity.log({
        businessId: payload.businessId,
        module: 'agent',
        action: 'quote_followup_scheduled',
        entityType: 'quote',
        entityId: quoteId,
        title: 'Quote follow-up checks scheduled',
        detail: `Day ${firstDays} and Day ${secondDays} conversion checks queued${autoSendEmail ? ' (auto-email enabled)' : ''}`,
        icon: 'Clock',
        tone: 'info',
        contactId,
        data: { quoteId, firstDays, secondDays, autoSendEmail },
      });
    } catch (e) {
      this.logger.error(`[CrossModule] quote.sent handler failed: ${(e as Error).message}`, (e as Error).stack);
    }
  }

  @OnEvent('quote.converted')
  async handleQuoteConverted(payload: QuoteConvertedPayload) {
    try {
      const { enabled } = await this.isWorkflowEnabled(payload.businessId, 'quote_conversion_tracking');
      if (!enabled) return;

      this.logger.log(`[CrossModule] quote.converted → quote ${payload.quote.id} converted to invoice`);

      const quoteId = payload.quote.id;
      const contactId = payload.quote.contactId;
      const quoteRef = payload.quote.quoteNumber ?? quoteId.slice(-6).toUpperCase();

      const cancelledJobs = await this.prisma.client.scheduledAgentJob.updateMany({
        where: {
          businessId: payload.businessId,
          entityId: quoteId,
          jobType: 'quote_followup',
          status: 'PENDING',
        },
        data: { status: 'CANCELLED' },
      });
      if (cancelledJobs.count > 0) {
        this.logger.log(`[CrossModule] Cancelled ${cancelledJobs.count} pending follow-up jobs for converted quote ${quoteRef}`);
      }

      if (contactId) {
        try {
          const pendingTasks = await this.prisma.client.contactTask.findMany({
            where: {
              businessId: payload.businessId,
              contactId,
              status: 'OPEN',
              source: 'cross-module-agent',
              title: { contains: quoteRef },
            },
          });

          for (const task of pendingTasks) {
            await this.crm.completeTask({ businessId: payload.businessId, taskId: task.id });
          }

          if (pendingTasks.length > 0) {
            this.logger.log(`[CrossModule] Completed ${pendingTasks.length} follow-up tasks for converted quote ${quoteRef}`);
          }
        } catch (e) {
          this.logger.warn(`[CrossModule] Failed to complete follow-up tasks on conversion: ${(e as Error).message}`);
        }
      }

      await this.activity.log({
        businessId: payload.businessId,
        module: 'agent',
        action: 'quote_converted',
        entityType: 'quote',
        entityId: payload.quote.id,
        title: 'Quote converted to invoice',
        detail: `Invoice ${payload.invoice.invoiceNumber ?? payload.invoice.id.slice(-6).toUpperCase()} created`,
        icon: 'CheckCircle',
        tone: 'success',
        contactId: contactId ?? undefined,
        data: { quoteId: payload.quote.id, invoiceId: payload.invoice.id },
      });

      await this.createNotification({
        businessId: payload.businessId,
        type: 'agent.quote_converted',
        title: 'Quote Converted',
        body: `Quote converted to invoice ${payload.invoice.invoiceNumber ?? payload.invoice.id.slice(-6).toUpperCase()}`,
        data: { quoteId: payload.quote.id, invoiceId: payload.invoice.id },
      }).catch((e) => this.logger.error('Failed to create notification', e));

      await this.recordWorkflowRun(payload.businessId, 'quote_conversion_tracking');
    } catch (e) {
      this.logger.error(`[CrossModule] quote.converted handler failed: ${(e as Error).message}`, (e as Error).stack);
    }
  }

  @OnEvent('lead_form.submitted')
  async handleLeadFormSubmitted(payload: LeadFormSubmittedPayload) {
    try {
      await this._handleLeadFormSubmitted(payload);
    } catch (e) {
      this.logger.error(`[CrossModule] lead_form.submitted handler failed: ${(e as Error).message}`, (e as Error).stack);
    }
  }

  private async _handleLeadFormSubmitted(payload: LeadFormSubmittedPayload) {
    const { enabled, config } = await this.isWorkflowEnabled(payload.businessId, 'lead_form_pipeline');
    if (!enabled) return;

    this.logger.log(`[CrossModule] lead_form.submitted → processing submission for business ${payload.businessId}`);

    const submission = payload.submission;
    const form = payload.form;

    const contactData = {
      firstName: submission.firstName || submission.first_name || submission.name?.split(' ')[0] || null,
      lastName: submission.lastName || submission.last_name || submission.name?.split(' ').slice(1).join(' ') || null,
      email: submission.email || null,
      phone: submission.phone || submission.telephone || null,
      companyName: submission.company || submission.companyName || null,
      source: 'lead_form',
      sourceDetail: form.name || form.title || 'Lead Form',
      tags: [config.defaultTag ?? 'lead-form', `form:${form.name || form.id}`].filter(Boolean),
    };

    let contact;
    try {
      contact = await this.crm.findOrCreateContact(payload.businessId, contactData);
    } catch (e) {
      this.logger.error(`[CrossModule] Failed to find/create contact from lead form: ${(e as Error).message}`);
      return;
    }

    if (!contact) return;

    await this.createNotification({
      businessId: payload.businessId,
      type: 'agent.lead_form_processed',
      title: 'Lead Form Submission Processed',
      body: `${contact.firstName ?? ''} ${contact.lastName ?? ''} from "${form.name ?? 'form'}" added to CRM.`.trim(),
      data: { contactId: contact.id, formId: form.id },
    }).catch((e) => this.logger.error('Failed to create notification', e));

    await this.activity.log({
      businessId: payload.businessId,
      module: 'agent',
      action: 'lead_form_processed',
      entityType: 'contact',
      entityId: contact.id,
      title: 'Lead form submission → CRM contact',
      detail: `Contact created/updated from "${form.name ?? 'form'}" submission`,
      icon: 'UserPlus',
      tone: 'success',
      contactId: contact.id,
      data: { formId: form.id, formName: form.name },
    });

    if (config.autoEnrollCampaign) {
      try {
        const welcomeCampaign = await this.prisma.client.emailCampaign.findFirst({
          where: {
            businessId: payload.businessId,
            deletedAt: null,
            status: 'DRAFT',
            name: { contains: 'welcome', mode: 'insensitive' },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (welcomeCampaign && contact.email) {
          const alreadyEnrolled = await this.prisma.client.emailCampaignContact.findFirst({
            where: { campaignId: welcomeCampaign.id, contactId: contact.id },
          });

          if (!alreadyEnrolled) {
            await this.prisma.client.emailCampaignContact.create({
              data: {
                campaignId: welcomeCampaign.id,
                contactId: contact.id,
                email: contact.email,
                businessId: payload.businessId,
                status: 'PENDING',
              },
            });

            await this.activity.log({
              businessId: payload.businessId,
              module: 'agent',
              action: 'campaign_enrollment_completed',
              entityType: 'campaign',
              entityId: welcomeCampaign.id,
              title: 'Contact enrolled in welcome campaign',
              detail: `${contact.firstName ?? ''} ${contact.lastName ?? ''} added to "${welcomeCampaign.name}"`.trim(),
              icon: 'Mail',
              tone: 'success',
              contactId: contact.id,
            });
          }
        } else if (welcomeCampaign && !contact.email) {
          await this.activity.log({
            businessId: payload.businessId,
            module: 'agent',
            action: 'campaign_enrollment_skipped',
            entityType: 'campaign',
            entityId: welcomeCampaign.id,
            title: 'Campaign enrollment skipped — no email',
            detail: `Contact from lead form has no email for campaign "${welcomeCampaign.name}"`,
            icon: 'Mail',
            tone: 'warning',
            contactId: contact.id,
          });
        }
      } catch (e) {
        this.logger.warn(`[CrossModule] Failed to enroll in welcome campaign: ${(e as Error).message}`);
      }
    }

    await this.recordWorkflowRun(payload.businessId, 'lead_form_pipeline');
  }

  @OnEvent('booking.completed')
  async handleBookingCompleted(payload: BookingCompletedPayload) {
    try {
      await this._handleBookingCompleted(payload);
    } catch (e) {
      this.logger.error(`[CrossModule] booking.completed handler failed: ${(e as Error).message}`, (e as Error).stack);
    }
  }

  private async _handleBookingCompleted(payload: BookingCompletedPayload) {
    const { enabled, config } = await this.isWorkflowEnabled(payload.businessId, 'booking_completed_followup');
    if (!enabled) return;

    const contactId = payload.contact?.id || payload.booking.contactId;
    if (!contactId) return;

    this.logger.log(`[CrossModule] booking.completed → scheduling follow-up for booking ${payload.booking.id}`);

    const delayDays = config.followUpDelayDays ?? 1;

    await this.crm.addTask({
      businessId: payload.businessId,
      contactId,
      title: `Request feedback/review for completed booking`,
      priority: 'NORMAL',
      dueDate: new Date(Date.now() + delayDays * 86400000).toISOString(),
      source: 'cross-module-agent',
    });

    const pastBookingsCount = await this.prisma.client.booking.count({
      where: {
        businessId: payload.businessId,
        contactId,
        status: 'COMPLETED',
        deletedAt: null,
      },
    });

    if (pastBookingsCount >= 2) {
      await this.crm.addTask({
        businessId: payload.businessId,
        contactId,
        title: `Suggest rebooking — returning client (${pastBookingsCount} visits)`,
        priority: 'NORMAL',
        dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
        source: 'cross-module-agent',
      });
    }

    await this.createNotification({
      businessId: payload.businessId,
      type: 'agent.booking_followup_created',
      title: 'Booking Follow-Up Created',
      body: `Feedback request task created for completed booking.${pastBookingsCount >= 2 ? ` Rebooking suggestion added (${pastBookingsCount} past visits).` : ''}`,
      data: { bookingId: payload.booking.id, contactId, pastBookingsCount },
    }).catch((e) => this.logger.error('Failed to create notification', e));

    await this.activity.log({
      businessId: payload.businessId,
      module: 'agent',
      action: 'booking_followup_created',
      entityType: 'booking',
      entityId: payload.booking.id,
      title: 'Post-booking follow-up created',
      detail: `Feedback request scheduled${pastBookingsCount >= 2 ? ', rebooking suggested' : ''}`,
      icon: 'Star',
      tone: 'info',
      contactId,
      data: { bookingId: payload.booking.id, pastBookingsCount },
    });

    await this.recordWorkflowRun(payload.businessId, 'booking_completed_followup');
  }

  @OnEvent('booking.cancelled')
  async handleBookingCancelled(payload: BookingCancelledPayload) {
    try {
      await this._handleBookingCancelled(payload);
    } catch (e) {
      this.logger.error(`[CrossModule] booking.cancelled handler failed: ${(e as Error).message}`, (e as Error).stack);
    }
  }

  private async _handleBookingCancelled(payload: BookingCancelledPayload) {
    const { enabled } = await this.isWorkflowEnabled(payload.businessId, 'booking_cancelled_reengagement');
    if (!enabled) return;

    const contactId = payload.contact?.id || payload.booking.contactId;
    if (!contactId) return;

    this.logger.log(`[CrossModule] booking.cancelled → creating re-engagement for contact ${contactId}`);

    await this.crm.addTask({
      businessId: payload.businessId,
      contactId,
      title: `Re-engage client after cancelled booking — offer alternative time or incentive`,
      priority: 'HIGH',
      dueDate: new Date(Date.now() + 1 * 86400000).toISOString(),
      source: 'cross-module-agent',
    });

    try {
      const contact = await this.crm.contactDetail({ businessId: payload.businessId, contactId });
      const existingTags = contact.contact?.tags ?? [];
      const tags = [...new Set([...existingTags, 'cancelled-booking'])];
      await this.crm.updateContact({ businessId: payload.businessId, contactId, tags });
    } catch (e) {
      this.logger.warn(`[CrossModule] Failed to tag cancelled contact: ${(e as Error).message}`);
    }

    await this.createNotification({
      businessId: payload.businessId,
      type: 'agent.booking_cancelled_reengagement',
      title: 'Booking Cancellation — Re-engagement Created',
      body: `A re-engagement task has been created after a booking cancellation.`,
      data: { bookingId: payload.booking.id, contactId },
    }).catch((e) => this.logger.error('Failed to create notification', e));

    await this.activity.log({
      businessId: payload.businessId,
      module: 'agent',
      action: 'booking_reengagement_created',
      entityType: 'booking',
      entityId: payload.booking.id,
      title: 'Cancelled booking re-engagement created',
      detail: 'Re-engagement task and tag applied',
      icon: 'RefreshCw',
      tone: 'warning',
      contactId,
      data: { bookingId: payload.booking.id },
    });

    await this.recordWorkflowRun(payload.businessId, 'booking_cancelled_reengagement');
  }

  @OnEvent('booking.rescheduled')
  async handleBookingRescheduled(payload: BookingRescheduledPayload) {
    try {
      await this._handleBookingRescheduled(payload);
    } catch (e) {
      this.logger.error(`[CrossModule] booking.rescheduled handler failed: ${(e as Error).message}`, (e as Error).stack);
    }
  }

  private async _handleBookingRescheduled(payload: BookingRescheduledPayload) {
    const { enabled } = await this.isWorkflowEnabled(payload.businessId, 'booking_rescheduled_tracking');
    if (!enabled) return;

    const contactId = payload.contact?.id || payload.booking.contactId;
    if (!contactId) return;

    this.logger.log(`[CrossModule] booking.rescheduled → tracking for contact ${contactId}`);

    await this.crm.logContactEvent({
      businessId: payload.businessId,
      contactId,
      type: 'booking.rescheduled',
      data: {
        bookingId: payload.booking.id,
        previousStartTime: payload.previousStartTime,
        previousEndTime: payload.previousEndTime,
        newStartTime: payload.booking.startTime,
        newEndTime: payload.booking.endTime,
      },
      source: 'cross-module-agent',
      actorType: 'SYSTEM',
    });

    try {
      const contact = await this.crm.contactDetail({ businessId: payload.businessId, contactId });
      const existingTags = contact.contact?.tags ?? [];
      const tags = [...new Set([...existingTags, 'rescheduled'])];
      await this.crm.updateContact({ businessId: payload.businessId, contactId, tags });

      const currentScore = contact.contact?.leadScore ?? 50;
      const newScore = Math.max(0, currentScore - 5);
      await this.prisma.client.contact.updateMany({
        where: { id: contactId, businessId: payload.businessId },
        data: { leadScore: newScore },
      });
      this.logger.log(`[CrossModule] Contact ${contactId} reliability score decreased: ${currentScore} → ${newScore}`);
    } catch (e) {
      this.logger.warn(`[CrossModule] Failed to update rescheduled contact: ${(e as Error).message}`);
    }

    await this.activity.log({
      businessId: payload.businessId,
      module: 'agent',
      action: 'booking_rescheduled_tracked',
      entityType: 'booking',
      entityId: payload.booking.id,
      title: 'Booking reschedule tracked — reliability updated',
      detail: `Rescheduled from ${new Date(payload.previousStartTime).toLocaleString()} to ${new Date(payload.booking.startTime).toLocaleString()}. Contact reliability score decreased.`,
      icon: 'CalendarX',
      tone: 'info',
      contactId,
      data: { bookingId: payload.booking.id },
    });

    await this.recordWorkflowRun(payload.businessId, 'booking_rescheduled_tracking');
  }

  @OnEvent('product.created')
  async handleProductCreated(payload: ProductCreatedPayload) {
    try {
      await this._handleProductCreated(payload);
    } catch (e) {
      this.logger.error(`[CrossModule] product.created handler failed: ${(e as Error).message}`, (e as Error).stack);
    }
  }

  private async _handleProductCreated(payload: ProductCreatedPayload) {
    const { enabled } = await this.isWorkflowEnabled(payload.businessId, 'new_product_marketing');
    if (!enabled) return;

    this.logger.log(`[CrossModule] product.created → generating marketing suggestions for ${payload.product.name}`);

    const suggestions = [];
    if (payload.product.price > 0) {
      suggestions.push(`Create a campaign to announce "${payload.product.name}" to your contact list`);
    }
    if (payload.product.description) {
      suggestions.push(`Use the product description to create social media posts`);
    }
    suggestions.push(`Add "${payload.product.name}" to your storefront or booking page`);

    await this.createNotification({
      businessId: payload.businessId,
      type: 'agent.product_marketing_suggestions',
      title: `Marketing Ideas for "${payload.product.name}"`,
      body: suggestions.join('. ') + '.',
      data: { productId: payload.product.id, suggestions },
    }).catch((e) => this.logger.error('Failed to create notification', e));

    await this.activity.log({
      businessId: payload.businessId,
      module: 'agent',
      action: 'product_marketing_suggested',
      entityType: 'product',
      entityId: payload.product.id,
      title: `Marketing suggestions for new product "${payload.product.name}"`,
      detail: `${suggestions.length} suggestions generated`,
      icon: 'Megaphone',
      tone: 'info',
      data: { productId: payload.product.id, suggestions },
    });

    await this.recordWorkflowRun(payload.businessId, 'new_product_marketing');
  }

  @OnEvent('product.updated')
  async handleProductUpdated(payload: ProductUpdatedPayload) {
    try {
      const { enabled } = await this.isWorkflowEnabled(payload.businessId, 'product_update_tracking');
      if (!enabled) return;

      await this.activity.log({
        businessId: payload.businessId,
        module: 'agent',
        action: 'product_updated_noted',
        entityType: 'product',
        entityId: payload.product.id,
        title: `Product "${payload.product.name}" updated`,
        detail: 'Cross-module agent noted product change',
        icon: 'Package',
        tone: 'info',
      });

      await this.createNotification({
        businessId: payload.businessId,
        type: 'agent.product_updated',
        title: `Product "${payload.product.name}" Updated`,
        body: 'Check if your storefront or active campaigns need to be updated to reflect these changes.',
        data: { productId: payload.product.id },
      }).catch((e) => this.logger.error('Failed to create notification', e));

      await this.recordWorkflowRun(payload.businessId, 'product_update_tracking');
    } catch (e) {
      this.logger.error(`[CrossModule] product.updated handler failed: ${(e as Error).message}`, (e as Error).stack);
    }
  }

  @OnEvent('campaign.sent')
  async handleCampaignSent(payload: CampaignSentPayload) {
    try {
      await this._handleCampaignSent(payload);
    } catch (e) {
      this.logger.error(`[CrossModule] campaign.sent handler failed: ${(e as Error).message}`, (e as Error).stack);
    }
  }

  private async _handleCampaignSent(payload: CampaignSentPayload) {
    const { enabled } = await this.isWorkflowEnabled(payload.businessId, 'campaign_engagement_scoring');
    if (!enabled) return;

    this.logger.log(`[CrossModule] campaign.sent → updating engagement scores for ${payload.recipientCount} recipients`);

    try {
      const campaign = payload.campaign;
      const campaignId = campaign.id;

      if (campaignId) {
        const recipients = await this.prisma.client.emailCampaignContact.findMany({
          where: { campaignId, businessId: payload.businessId, status: 'SENT' },
          select: { contactId: true },
        });

        const contactIds = recipients.map((r) => r.contactId);
        if (contactIds.length > 0) {
          await this.prisma.client.contact.updateMany({
            where: { id: { in: contactIds } },
            data: { leadScore: { increment: 1 } },
          });
        }
      }
    } catch (e) {
      this.logger.warn(`[CrossModule] Campaign engagement scoring failed: ${(e as Error).message}`);
    }

    await this.createNotification({
      businessId: payload.businessId,
      type: 'agent.campaign_engagement_updated',
      title: 'Engagement Scores Updated',
      body: `Contact engagement scores updated for ${payload.recipientCount} campaign recipients.`,
      data: { recipientCount: payload.recipientCount },
    }).catch((e) => this.logger.error('Failed to create notification', e));

    await this.activity.log({
      businessId: payload.businessId,
      module: 'agent',
      action: 'campaign_engagement_scored',
      entityType: 'campaign',
      entityId: payload.campaign.id,
      title: 'Campaign engagement scores updated',
      detail: `${payload.recipientCount} contact scores incremented`,
      icon: 'TrendingUp',
      tone: 'success',
      data: { recipientCount: payload.recipientCount },
    });

    await this.recordWorkflowRun(payload.businessId, 'campaign_engagement_scoring');
  }
}
