import { Injectable, Logger, Optional } from '@nestjs/common';
import { BookingStatus } from '@prisma/client';
import { CrmService } from '../crm/crm.service';
import { CommerceService } from '../commerce/commerce.service';
import { BookingsService } from '../bookings/bookings.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CommandService } from '../command/command.service';
import { BlueprintService } from '../blueprint/blueprint.service';
import { AutopilotService } from '../autopilot/autopilot.service';
import { KeyInboxReplySenderService } from '../key-inbox/key-inbox-reply-sender.service';
import { CommunicationsService } from '../communications/communications.service';
import { TimelineService } from '../timeline/timeline.service';

export type CompensationHandler = (input: {
  businessId: string;
  output?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
}) => Promise<void>;

@Injectable()
export class KeyCortexCompensationService {
  private readonly logger = new Logger(KeyCortexCompensationService.name);
  private readonly handlers = new Map<string, CompensationHandler>();

  constructor(
    private readonly crm: CrmService,
    private readonly commerce: CommerceService,
    private readonly bookings: BookingsService,
    private readonly prisma: PrismaService,
    @Optional()
    private readonly commandService?: CommandService,
    @Optional()
    private readonly blueprintService?: BlueprintService,
    @Optional()
    private readonly autopilotService?: AutopilotService,
    @Optional()
    private readonly replySender?: KeyInboxReplySenderService,
    @Optional()
    private readonly communicationsService?: CommunicationsService,
    @Optional()
    private readonly timeline?: TimelineService,
  ) {
    this.registerDefaults();
  }

  register(actionRef: string, handler: CompensationHandler) {
    this.handlers.set(actionRef, handler);
  }

  async compensate(actionRef: string, input: { businessId: string; output?: Record<string, unknown>; parameters?: Record<string, unknown> }) {
    const handler = this.handlers.get(actionRef);
    if (!handler) {
      this.logger.warn(`No compensator registered for ${actionRef}`);
      return { compensated: false, reason: 'No compensator registered' };
    }
    await handler(input);
    return { compensated: true, actionRef };
  }

  /**
   * Returns the compensating action ref for a canonical tool name and result.
   * This lets the executor/tool-loop pick the right rollback without
   * string-heuristics.
   */
  getCompensatingAction(toolName: string, _result?: Record<string, unknown>): string | undefined {
    const map: Record<string, string> = {
      'create_contact': 'crm.delete_contact',
      'create_lead': 'crm.delete_lead',
      'create_task': 'autopilot.delete_task',
      'create_event': 'calendar.delete_event',
      'send_message': 'communications.recall_message',
      'create_invoice': 'commerce.void_invoice',
      'create_booking': 'bookings.cancel_booking',
      'create_command_item': 'command.delete_command_item',
      'key_inbox.send_reply': 'key_inbox.mark_draft',
      'key_genome.dna_update': 'key_genome.revert_blueprint_field',
    };
    return map[toolName];
  }

  private registerDefaults() {
    this.register('crm.create_contact', async (input) => {
      const contactId = (input.output?.id ?? input.parameters?.contactId) as string | undefined;
      if (!contactId || !input.businessId) return;
      this.logger.log(`[compensate] soft-delete contact ${contactId}`);
      await this.crm.softDeleteContact({ businessId: input.businessId, contactId });
    });

    this.register('crm.delete_contact', async (input) => {
      const contactId = (input.output?.id ?? input.parameters?.contactId ?? input.parameters?.id) as string | undefined;
      if (!contactId || !input.businessId) return;
      this.logger.log(`[compensate] soft-delete contact ${contactId}`);
      await this.crm.softDeleteContact({ businessId: input.businessId, contactId });
    });

    this.register('crm.create_lead', async (input) => {
      const contactId = (input.output?.id ?? input.parameters?.contactId) as string | undefined;
      if (!contactId || !input.businessId) return;
      this.logger.log(`[compensate] soft-delete lead/contact ${contactId}`);
      await this.crm.softDeleteContact({ businessId: input.businessId, contactId });
    });

    this.register('crm.delete_lead', async (input) => {
      const contactId = (input.output?.id ?? input.parameters?.contactId ?? input.parameters?.id) as string | undefined;
      if (!contactId || !input.businessId) return;
      this.logger.log(`[compensate] soft-delete lead/contact ${contactId}`);
      await this.crm.softDeleteContact({ businessId: input.businessId, contactId });
    });

    this.register('commerce.create_invoice', async (input) => {
      const invoiceId = (input.output?.id ?? input.parameters?.invoiceId) as string | undefined;
      if (!invoiceId) return;
      this.logger.log(`[compensate] void invoice ${invoiceId}`);
      await this.commerce.updateInvoiceStatus({ invoiceId, status: 'VOID' });
    });

    this.register('commerce.void_invoice', async (input) => {
      const invoiceId = (input.output?.id ?? input.parameters?.invoiceId) as string | undefined;
      if (!invoiceId) return;
      this.logger.log(`[compensate] void invoice ${invoiceId}`);
      await this.commerce.updateInvoiceStatus({ invoiceId, status: 'VOID' });
    });

    this.register('bookings.create_booking', async (input) => {
      const bookingId = (input.output?.id ?? input.parameters?.bookingId) as string | undefined;
      if (!bookingId || !input.businessId) return;
      this.logger.log(`[compensate] cancel booking ${bookingId}`);
      await this.bookings.updateBookingStatus(input.businessId, bookingId, BookingStatus.CANCELLED);
    });

    this.register('bookings.cancel_booking', async (input) => {
      const bookingId = (input.output?.id ?? input.parameters?.bookingId) as string | undefined;
      if (!bookingId || !input.businessId) return;
      this.logger.log(`[compensate] cancel booking ${bookingId}`);
      await this.bookings.updateBookingStatus(input.businessId, bookingId, BookingStatus.CANCELLED);
    });

    this.register('key_inbox.send_reply', async (input) => {
      const messageId = (input.output?.id ?? input.parameters?.messageId) as string | undefined;
      if (!messageId) return;

      // Prefer marking the sent reply as a draft if the reply sender supports it.
      if (this.replySender && typeof (this.replySender as any).markAsDraft === 'function') {
        this.logger.log(`[compensate] mark reply ${messageId} as draft`);
        await (this.replySender as any).markAsDraft(input.businessId, messageId);
        return;
      }

      // Fallback: soft-delete the message row. This is lossy but prevents a
      // sent message from remaining live when a saga rolls back.
      this.logger.log(`[compensate] remove sent reply ${messageId}`);
      await this.prisma.client.keyInboxMessage.deleteMany({ where: { id: messageId, businessId: input.businessId } });
    });

    this.register('key_inbox.mark_draft', async (input) => {
      const messageId = (input.output?.id ?? input.parameters?.messageId) as string | undefined;
      if (!messageId) return;
      this.logger.log(`[compensate] mark reply ${messageId} as draft`);
      await this.prisma.client.keyInboxMessage.updateMany({
        where: { id: messageId, businessId: input.businessId },
        data: { sendStatus: 'DRAFT' },
      });
    });

    this.register('command.create_command_item', async (input) => {
      const itemId = (input.output?.id ?? input.parameters?.commandItemId ?? input.parameters?.id) as string | undefined;
      if (!itemId || !input.businessId) return;
      if (!this.commandService) {
        this.logger.warn(`[compensate] CommandService unavailable; cannot delete command item ${itemId}`);
        return;
      }
      this.logger.log(`[compensate] delete command item ${itemId}`);
      await this.commandService.delete(input.businessId, itemId);
    });

    this.register('command.delete_command_item', async (input) => {
      const itemId = (input.output?.id ?? input.parameters?.commandItemId ?? input.parameters?.id) as string | undefined;
      if (!itemId || !input.businessId) return;
      if (!this.commandService) {
        this.logger.warn(`[compensate] CommandService unavailable; cannot delete command item ${itemId}`);
        return;
      }
      this.logger.log(`[compensate] delete command item ${itemId}`);
      await this.commandService.delete(input.businessId, itemId);
    });

    this.register('autopilot.create_task', async (input) => {
      const taskId = (input.output?.id ?? input.parameters?.taskId) as string | undefined;
      if (!taskId || !input.businessId) return;
      if (!this.autopilotService) {
        this.logger.warn(`[compensate] AutopilotService unavailable; cannot cancel task ${taskId}`);
        return;
      }
      // TODO: replace with a real deleteTask once AutopilotService exposes one.
      this.logger.log(`[compensate] cancel autopilot task ${taskId}`);
      await this.autopilotService.updateTaskStatus(taskId, input.businessId, 'CANCELLED', 'key-cortex');
    });

    this.register('autopilot.delete_task', async (input) => {
      const taskId = (input.output?.id ?? input.parameters?.taskId) as string | undefined;
      if (!taskId || !input.businessId) return;
      if (!this.autopilotService) {
        this.logger.warn(`[compensate] AutopilotService unavailable; cannot cancel task ${taskId}`);
        return;
      }
      // TODO: replace with a real deleteTask once AutopilotService exposes one.
      this.logger.log(`[compensate] cancel autopilot task ${taskId}`);
      await this.autopilotService.updateTaskStatus(taskId, input.businessId, 'CANCELLED', 'key-cortex');
    });

    this.register('calendar.create_event', async (input) => {
      const eventId = (input.output?.id ?? input.parameters?.eventId) as string | undefined;
      if (!eventId || !input.businessId) return;
      this.logger.log(`[compensate] cancel calendar event ${eventId}`);
      await this.prisma.client.calendarEvent.updateMany({
        where: { id: eventId, businessId: input.businessId },
        data: { status: 'CANCELLED' },
      });
    });

    this.register('calendar.delete_event', async (input) => {
      const eventId = (input.output?.id ?? input.parameters?.eventId) as string | undefined;
      if (!eventId || !input.businessId) return;
      this.logger.log(`[compensate] cancel calendar event ${eventId}`);
      await this.prisma.client.calendarEvent.updateMany({
        where: { id: eventId, businessId: input.businessId },
        data: { status: 'CANCELLED' },
      });
    });

    this.register('communications.send_message', async (input) => {
      await this.recallMessage(input);
    });

    this.register('communications.recall_message', async (input) => {
      await this.recallMessage(input);
    });

    this.register('key_genome.dna_update', async (input) => {
      await this.revertBlueprintField(input);
    });

    this.register('key_genome.revert_blueprint_field', async (input) => {
      await this.revertBlueprintField(input);
    });
  }

  private async recallMessage(input: {
    businessId: string;
    output?: Record<string, unknown>;
    parameters?: Record<string, unknown>;
  }) {
    const messageId = (input.output?.id ?? input.parameters?.messageId) as string | undefined;
    if (!messageId || !input.businessId) return;

    this.logger.log(`[compensate] recall message ${messageId}`);

    // Mark any local Message row as recalled if it exists.
    const message = await this.prisma.client.message.findUnique({
      where: { id: messageId },
    }).catch(() => null);

    if (message) {
      await this.prisma.client.message.updateMany({
        where: { id: message.id },
        data: { status: 'recalled' },
      });
    }

    // Record an audit timeline event so the recall is observable even when no
    // local row exists (e.g. provider-native outbound sends).
    if (this.timeline) {
      const contactId = (input.parameters?.contactId ?? message?.recipientId ?? 'unknown') as string;
      await this.timeline.recordContactEvent(input.businessId, contactId, 'message.recalled', {
        messageId,
        source: 'key-cortex-compensation',
        hasLocalRow: !!message,
      }).catch(() => undefined);
    }
  }

  private async revertBlueprintField(input: {
    businessId: string;
    output?: Record<string, unknown>;
    parameters?: Record<string, unknown>;
  }) {
    if (!this.blueprintService) {
      this.logger.warn(`[compensate] BlueprintService unavailable; cannot revert blueprint field`);
      return;
    }

    const params = input.parameters ?? {};
    const previous = params.previousValue;
    const section = params.section as string | undefined;
    const field = params.field as string | undefined;

    if (!section || !field) {
      this.logger.warn(`[compensate] cannot revert blueprint field: missing section or field in compensation payload`);
      return;
    }

    this.logger.log(`[compensate] revert blueprint ${section}.${field}`);
    const patch: Record<string, Record<string, unknown>> = {};
    patch[section] = { [field]: previous ?? null };
    await this.blueprintService.updateBlueprint(input.businessId, patch);
  }
}
