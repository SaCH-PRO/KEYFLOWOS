import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ActivityService } from './activity.service';
import { CrmService } from '../crm/crm.service';
import { TransactionalEmailService } from '../notifications/transactional-email.service';
import {
  BookingCreatedPayload,
  BookingConfirmedPayload,
  ContactCreatedPayload,
  ContactUpdatedPayload,
  InvoicePaidPayload,
  InvoiceStatusPayload,
  PostPublishedPayload,
} from '../../core/event-bus/events.types';

@Injectable()
export class AutomationExecutorService {
  private readonly logger = new Logger(AutomationExecutorService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(TransactionalEmailService) private readonly transactionalEmail: TransactionalEmailService,
  ) {}

  private async loadContactData(businessId: string, contactId: string): Promise<Record<string, any> | null> {
    try {
      const result = await this.crm.contactDetail({ businessId, contactId });
      return result.contact ?? null;
    } catch {
      return null;
    }
  }

  private async evaluateCondition(condition: string | null | undefined, businessId: string, context: Record<string, any>): Promise<boolean> {
    if (!condition) return true;

    switch (condition) {
      case 'contact.has_email': {
        if (!context.contactId) return false;
        const contact = await this.loadContactData(businessId, context.contactId);
        return !!contact?.email;
      }
      case 'contact.has_phone': {
        if (!context.contactId) return false;
        const contact = await this.loadContactData(businessId, context.contactId);
        return !!contact?.phone;
      }
      case 'contact.is_active': {
        if (!context.contactId) return false;
        const contact = await this.loadContactData(businessId, context.contactId);
        return contact?.status === 'ACTIVE';
      }
      case 'contact.is_new': {
        if (!context.contactId) return false;
        const contact = await this.loadContactData(businessId, context.contactId);
        if (!contact?.createdAt) return false;
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        return new Date(contact.createdAt).getTime() > sevenDaysAgo;
      }
      case 'invoice.above_threshold':
        return typeof context.total === 'number' && context.total > (context.threshold ?? 500);
      case 'booking.is_first': {
        if (!context.contactId) return false;
        const bookingCount = await this.prisma.client.booking.count({
          where: { contactId: context.contactId, businessId },
        });
        return bookingCount <= 1;
      }
      case 'time.business_hours': {
        const hour = new Date().getHours();
        return hour >= 8 && hour < 18;
      }
      default:
        this.logger.warn(`Unknown condition "${condition}", treating as unmet`);
        return false;
    }
  }

  private async executePlaybooks(businessId: string, triggerEvent: string, context: Record<string, any>) {
    const playbooks = await this.prisma.client.automation.findMany({
      where: {
        businessId,
        trigger: triggerEvent,
        enabled: true,
        deletedAt: null,
      },
    });

    if (playbooks.length === 0) return;

    for (const playbook of playbooks) {
      try {
        if (!(await this.evaluateCondition(playbook.condition, businessId, context))) {
          await this.activity.log({
            businessId,
            module: 'automation',
            action: 'skipped',
            entityType: 'playbook',
            entityId: playbook.id,
            title: `Playbook "${playbook.name}" skipped`,
            detail: `Condition "${playbook.condition}" not met for trigger ${triggerEvent}`,
            icon: 'Zap',
            tone: 'info',
            data: { trigger: triggerEvent, playbookId: playbook.id, condition: playbook.condition, outcome: 'skipped' },
            contactId: context.contactId,
          });
          this.logger.log(`Playbook "${playbook.name}" skipped: condition "${playbook.condition}" not met`);
          continue;
        }

        const actionData = playbook.actionData;
        if (!actionData) continue;

        const actions = Array.isArray(actionData) ? actionData : [actionData];

        for (const action of actions) {
          await this.executeAction(businessId, playbook.name, action, context);
        }

        await this.prisma.client.automation.update({
          where: { id: playbook.id },
          data: { lastRunAt: new Date(), runCount: { increment: 1 } },
        });

        await this.activity.log({
          businessId,
          module: 'automation',
          action: 'executed',
          entityType: 'playbook',
          entityId: playbook.id,
          title: `Playbook "${playbook.name}" executed`,
          detail: `Triggered by ${triggerEvent}`,
          icon: 'Zap',
          tone: 'success',
          data: { trigger: triggerEvent, playbookId: playbook.id, outcome: 'success' },
          contactId: context.contactId,
        });

        this.logger.log(`Playbook "${playbook.name}" executed for trigger "${triggerEvent}"`);
      } catch (e) {
        const errorMessage = (e as Error).message;
        this.logger.error(`Playbook "${playbook.name}" failed: ${errorMessage}`);

        await this.activity.log({
          businessId,
          module: 'automation',
          action: 'failed',
          entityType: 'playbook',
          entityId: playbook.id,
          title: `Playbook "${playbook.name}" failed`,
          detail: `Error: ${errorMessage}`,
          icon: 'Zap',
          tone: 'error',
          data: { trigger: triggerEvent, playbookId: playbook.id, outcome: 'failed', error: errorMessage },
          contactId: context.contactId,
        });
      }
    }
  }

  private async executeAction(businessId: string, playbookName: string, action: any, context: Record<string, any>) {
    const actionType = action.type || action.actionType || action.kind;
    
    switch (actionType) {
      case 'create_task':
      case 'CREATE_TASK': {
        if (context.contactId) {
          await this.crm.addTask({
            businessId,
            contactId: context.contactId,
            title: action.title || `Task from "${playbookName}"`,
            priority: action.priority || 'NORMAL',
            dueDate: action.dueInDays
              ? new Date(Date.now() + action.dueInDays * 86400000).toISOString()
              : undefined,
            source: 'automation',
          });
        }
        break;
      }
      case 'add_tag':
      case 'TAG_CONTACT': {
        if (context.contactId) {
          try {
            const contact = await this.crm.contactDetail({ businessId, contactId: context.contactId });
            const existing = contact.contact?.tags ?? [];
            const tags = [...new Set([...existing, action.tag || action.value || 'automated'])];
            await this.crm.updateContact({ businessId, contactId: context.contactId, tags });
          } catch (e) {
            this.logger.warn(`Failed to tag contact: ${(e as Error).message}`);
          }
        }
        break;
      }
      case 'update_status':
      case 'UPDATE_STATUS': {
        if (context.contactId) {
          try {
            await this.crm.updateContact({
              businessId,
              contactId: context.contactId,
              status: action.status || action.value || 'ACTIVE',
            });
          } catch (e) {
            this.logger.warn(`Failed to update status: ${(e as Error).message}`);
          }
        }
        break;
      }
      case 'send_email':
      case 'SEND_EMAIL': {
        if (context.contactId) {
          try {
            const validTypes = ['booking_confirmed', 'booking_reminder', 'booking_rescheduled', 'booking_cancelled', 'invoice_sent', 'payment_receipt'] as const;
            const notifType = action.notificationType as typeof validTypes[number] | undefined;
            if (!notifType || !validTypes.includes(notifType)) {
              this.logger.warn(`Playbook "${playbookName}" has invalid notificationType "${action.notificationType}", skipping`);
              break;
            }
            const contact = await this.crm.contactDetail({ businessId, contactId: context.contactId });
            const c = contact.contact;
            if (c?.email) {
              const recipientName = [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Customer';
              await this.transactionalEmail.send({
                businessId,
                type: notifType,
                recipientEmail: c.email,
                recipientName,
                contactId: context.contactId,
                templateData: {
                  ...context,
                  ...(action.templateData ?? {}),
                },
              });
              this.logger.log(`Email sent to ${c.email} for playbook "${playbookName}"`);
            }
          } catch (e) {
            this.logger.warn(`Failed to send email for playbook "${playbookName}": ${(e as Error).message}`);
          }
        }
        break;
      }
      case 'send_whatsapp':
      case 'SEND_WHATSAPP': {
        this.logger.log(`[ACTION] WhatsApp action queued for contact ${context.contactId}`);
        break;
      }
      case 'LOG_EVENT': {
        if (context.contactId) {
          await this.crm.logContactEvent({
            businessId,
            contactId: context.contactId,
            type: action.eventType || 'automation.action',
            data: { trigger: context.trigger, playbookName },
            source: 'automation',
            actorType: 'SYSTEM',
          });
        }
        break;
      }
      default:
        this.logger.warn(`Unknown action type: ${actionType}`);
    }
  }

  @OnEvent('contact.created')
  async onContactCreated(payload: ContactCreatedPayload) {
    await this.activity.log({
      businessId: payload.businessId,
      module: 'crm',
      action: 'created',
      entityType: 'contact',
      entityId: payload.contact.id,
      title: 'New contact added',
      detail: [payload.contact.firstName, payload.contact.lastName].filter(Boolean).join(' ') || payload.contact.email || 'Unknown',
      icon: 'UserPlus',
      tone: 'info',
      contactId: payload.contact.id,
    });
    await this.executePlaybooks(payload.businessId, 'contact.created', {
      contactId: payload.contact.id,
      trigger: 'contact.created',
    });
  }

  @OnEvent('contact.updated')
  async onContactUpdated(payload: ContactUpdatedPayload) {
    await this.activity.log({
      businessId: payload.businessId,
      module: 'crm',
      action: 'updated',
      entityType: 'contact',
      entityId: payload.contact.id,
      title: 'Contact updated',
      detail: payload.toStatus ? `Status changed to ${payload.toStatus}` : undefined,
      icon: 'UserCog',
      contactId: payload.contact.id,
    });
    await this.executePlaybooks(payload.businessId, 'contact.updated', {
      contactId: payload.contact.id,
      fromStatus: payload.fromStatus,
      toStatus: payload.toStatus,
      trigger: 'contact.updated',
    });
  }

  @OnEvent('booking.created')
  async onBookingCreated(payload: BookingCreatedPayload) {
    const contactName = payload.contact
      ? [payload.contact.firstName, payload.contact.lastName].filter(Boolean).join(' ') || 'Customer'
      : 'Customer';
    await this.activity.log({
      businessId: payload.businessId,
      module: 'bookings',
      action: 'created',
      entityType: 'booking',
      entityId: payload.booking.id,
      title: `New booking from ${contactName}`,
      detail: new Date(payload.booking.startTime).toLocaleString(),
      icon: 'Calendar',
      tone: 'info',
      contactId: payload.contact?.id,
    });
    await this.executePlaybooks(payload.businessId, 'booking.created', {
      contactId: payload.contact?.id,
      bookingId: payload.booking.id,
      trigger: 'booking.created',
    });
  }

  @OnEvent('booking.confirmed')
  async onBookingConfirmed(payload: BookingConfirmedPayload) {
    await this.activity.log({
      businessId: payload.businessId,
      module: 'bookings',
      action: 'confirmed',
      entityType: 'booking',
      entityId: payload.booking.id,
      title: 'Booking confirmed',
      icon: 'CheckCircle',
      tone: 'success',
      contactId: payload.contact?.id,
    });
    await this.executePlaybooks(payload.businessId, 'booking.confirmed', {
      contactId: payload.contact?.id,
      bookingId: payload.booking.id,
      trigger: 'booking.confirmed',
    });
  }

  @OnEvent('invoice.paid')
  async onInvoicePaid(payload: InvoicePaidPayload) {
    const inv = payload.invoice;
    await this.activity.log({
      businessId: payload.businessId,
      module: 'commerce',
      action: 'paid',
      entityType: 'invoice',
      entityId: inv.id,
      title: `Invoice paid`,
      detail: `${inv.currency} ${inv.total.toFixed(2)}`,
      icon: 'DollarSign',
      tone: 'success',
      contactId: inv.contact?.id,
      data: { total: inv.total, currency: inv.currency },
    });
    await this.executePlaybooks(payload.businessId, 'invoice.paid', {
      contactId: inv.contact?.id,
      invoiceId: inv.id,
      total: inv.total,
      trigger: 'invoice.paid',
    });

    try {
      const lineItems = await this.prisma.client.invoiceItem.findMany({
        where: { invoiceId: inv.id },
        select: { productId: true },
      });
      const productIds = lineItems.map((li: any) => li.productId).filter(Boolean);
      if (productIds.length > 0) {
        const templates = await this.prisma.client.projectTemplate.findMany({
          where: { businessId: payload.businessId, productId: { in: productIds } },
        });
        for (const tmpl of templates) {
          const taskTitles = Array.isArray(tmpl.taskTitles) ? tmpl.taskTitles as string[] : [];
          await this.prisma.client.project.create({
            data: {
              businessId: payload.businessId,
              name: tmpl.name,
              status: 'ACTIVE',
              priority: 'NORMAL',
              contactId: inv.contact?.id,
              invoiceId: inv.id,
              tasks: {
                create: taskTitles.map((title: string, i: number) => ({
                  businessId: payload.businessId,
                  title,
                  sortOrder: i + 1,
                })),
              },
            },
          });
          this.logger.log(`Auto-created project "${tmpl.name}" from template for invoice ${inv.id}`);
        }
      }
    } catch (err) {
      this.logger.warn(`Auto-project creation from template failed: ${err}`);
    }
  }

  @OnEvent('invoice.sent')
  async onInvoiceSent(payload: InvoiceStatusPayload) {
    await this.activity.log({
      businessId: payload.businessId,
      module: 'commerce',
      action: 'sent',
      entityType: 'invoice',
      entityId: payload.invoice.id,
      title: 'Invoice sent',
      detail: `${payload.invoice.currency} ${payload.invoice.total.toFixed(2)}`,
      icon: 'Send',
      tone: 'info',
      contactId: payload.invoice.contact?.id,
    });
    await this.executePlaybooks(payload.businessId, 'invoice.sent', {
      contactId: payload.invoice.contact?.id,
      invoiceId: payload.invoice.id,
      trigger: 'invoice.sent',
    });
  }

  @OnEvent('invoice.overdue')
  async onInvoiceOverdue(payload: InvoiceStatusPayload) {
    await this.activity.log({
      businessId: payload.businessId,
      module: 'commerce',
      action: 'overdue',
      entityType: 'invoice',
      entityId: payload.invoice.id,
      title: 'Invoice overdue',
      detail: `${payload.invoice.currency} ${payload.invoice.total.toFixed(2)}`,
      icon: 'AlertTriangle',
      tone: 'warning',
      contactId: payload.invoice.contact?.id,
    });
    await this.executePlaybooks(payload.businessId, 'invoice.overdue', {
      contactId: payload.invoice.contact?.id,
      invoiceId: payload.invoice.id,
      trigger: 'invoice.overdue',
    });
  }

  @OnEvent('post.published')
  async onPostPublished(payload: PostPublishedPayload) {
    await this.activity.log({
      businessId: payload.businessId,
      module: 'social',
      action: 'published',
      entityType: 'post',
      entityId: payload.post.id,
      title: 'Social post published',
      detail: payload.post.content?.substring(0, 100),
      icon: 'Share2',
      tone: 'success',
    });
  }
}
