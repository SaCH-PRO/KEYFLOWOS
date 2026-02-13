import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ActivityService } from './activity.service';
import { CrmService } from '../crm/crm.service';
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
  ) {}

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
        const actionData = playbook.actionData as any;
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
          tone: 'info',
          data: { trigger: triggerEvent, playbookId: playbook.id },
          contactId: context.contactId,
        });

        this.logger.log(`Playbook "${playbook.name}" executed for trigger "${triggerEvent}"`);
      } catch (e) {
        this.logger.error(`Playbook "${playbook.name}" failed: ${(e as Error).message}`);
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
        this.logger.log(`[ACTION] Email action queued: "${action.subject || 'Notification'}" for contact ${context.contactId}`);
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
