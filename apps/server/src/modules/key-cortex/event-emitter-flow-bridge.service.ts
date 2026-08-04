import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { KeyCortexEventBusService } from './key-cortex-event-bus.service';

interface NormalizedEvent {
  source: string;
  type: string;
  businessId?: string;
  userId?: string;
  entityType?: string;
  entityId?: string;
  importance?: 'low' | 'normal' | 'high' | 'critical';
  payload: Record<string, unknown>;
}

/**
 * Bridges domain events emitted via NestJS EventEmitter2 into the KEY Cortex
 * event bus so they can be routed into FlowSignal role queues.
 *
 * This avoids circular dependencies: domain modules only need EventEmitter2
 * (already globally available), and KeyCortex subscribes + forwards.
 */
@Injectable()
export class EventEmitterFlowBridgeService implements OnModuleInit {
  private readonly logger = new Logger(EventEmitterFlowBridgeService.name);

  /**
   * Regex patterns for EventEmitter2 event names we want to forward into the
   * KEY Cortex event bus. Keep tightly scoped to real business signals.
   */
  private readonly patterns = [
    /^booking\./,
    /^reservation\./,
    /^contact\./,
    /^lead\./,
    /^lead_form\./,
    /^form\.lead/,
    /^deal\./,
    /^crm\.deal\./,
    /^demo\./,
    /^opportunity\./,
    /^crm\.opportunity\./,
    /^expense\./,
    /^receipt\./,
    /^bill\./,
    // Money actually arriving. Emitted with a businessId by all five payment
    // connectors (Stripe, PayPal, QuickBooks, Xero, WiPay) and, before this,
    // matched by nothing here — so `payment.received` never became a
    // BusinessEvent and the cortex could not see revenue land.
    //
    // KeyCortexSalienceService counts it as an OPPORTUNITY_SIGNAL, which is the
    // only input to the dopamine arm. `invoice.paid`, `booking.created`,
    // `booking.completed` and `contact.created` already pass via their own
    // prefixes; this was the one gap, and it was the most direct evidence a
    // business is doing well.
    /^payment\./,
    /^deposit\./,
    /^transaction\./,
    /^bank\./,
    /^reconciliation\./,
    /^refund\./,
    /^supportTicket\./,
    /^ticket\./,
    /^support\./,
    /^helpdesk\./,
    /^project\./,
    /^project_task\./,
    /^task\./,
    /^milestone\./,
    /^campaign\./,
    /^email_campaign\./,
    /^content\./,
    /^social\./,
    /^mention\./,
    /^invoice\./,
    /^quote\./,
    /^product\./,
    /^catalog\./,
    /^message\./,
    /^inbox\./,
    /^delivery\./,
    /^call_log\./,
    /^autopilot\.task\./,
    /^ingestion\./,
    /^document\./,
    /^file\./,
    /^media\./,
    /^audio\./,
    /^video\./,
    /^meeting\./,
    /^calendar\./,
    /^training\./,
    /^course\./,
    /^board\./,
    /^resolution\./,
    /^reminder\./,
    /^deadline\./,
    /^appointment\./,
    /^vendor\./,
    /^user\./,
    /^employee\./,
    /^hr\./,
    /^onboarding\./,
    /^candidate\./,
    /^application\./,
    /^outreach\./,
    /^sequence\./,
    /^it\./,
    /^legal\./,
    /^contract\./,
    /^design\./,
    /^doc\./,
    /^bug\./,
    /^qa\./,
    /^inventory\./,
    /^stock\./,
    /^procurement\./,
    /^purchase_order\./,
    /^order\./,
    /^visitor\./,
    /^guest\./,
    /^check_in\./,
    /^restaurant\./,
    /^shift\./,
    /^field_service\./,
    /^dispatch\./,
    /^technician\./,
    /^coding\./,
    /^claim\./,
    /^budget\./,
    /^recurring_invoice\./,
    /^revenue_action\./,
    /^business_event\.created/,
  ];

  constructor(
    private readonly events: EventEmitter2,
    private readonly eventBus: KeyCortexEventBusService,
  ) {}

  onModuleInit(): void {
    this.events.onAny((event: string | string[], value: unknown) => {
      const rawName = Array.isArray(event) ? event.join('.') : event;
      const name = typeof rawName === 'string' ? rawName : String(rawName);
      if (!this.shouldForward(name)) return;

      const type = this.normalizeEventName(name);
      this.handle(name, type, value).catch((err: unknown) => {
        this.logger.warn(`[bridge] ${name}: ${err instanceof Error ? err.message : String(err)}`);
      });
    });
  }

  private shouldForward(eventName: string): boolean {
    return this.patterns.some((pattern) => pattern.test(eventName));
  }

  private normalizeEventName(name: string): string {
    const modulePrefixes = [
      'crm.',
      'commerce.',
      'key_inbox.',
      'temporal_flow.',
      'projects.',
      'tasks.',
      'autopilot.',
      'email_marketing.',
      'communications.',
      'helpdesk.',
      'bookings.',
      'expenses.',
      'business_events.',
    ];
    for (const prefix of modulePrefixes) {
      if (name.startsWith(prefix)) {
        return name.slice(prefix.length);
      }
    }
    return name;
  }

  private async handle(eventName: string, type: string, payload: unknown): Promise<void> {
    const normalized = this.normalize(eventName, type, payload);
    if (!normalized.businessId) {
      return;
    }

    await this.eventBus.publish({
      source: normalized.source,
      type: normalized.type,
      businessId: normalized.businessId,
      userId: normalized.userId,
      payload: normalized.payload,
      metadata: {
        entityType: normalized.entityType,
        entityId: normalized.entityId,
        importance: normalized.importance,
      },
    });
  }

  private normalize(eventName: string, type: string, rawPayload: unknown): NormalizedEvent {
    const payload = (rawPayload ?? {}) as Record<string, unknown>;

    // Business audit events carry their real event type in `eventType`.
    if (eventName === 'business_event.created') {
      return this.normalizeBusinessEvent(payload);
    }

    const businessId = this.extractBusinessId(payload);
    const { entityType, entityId } = this.extractEntity(payload, type);

    return {
      source: this.inferSource(type),
      type,
      businessId,
      userId: typeof payload.userId === 'string' ? payload.userId : undefined,
      entityType,
      entityId,
      importance: this.inferImportance(type, payload),
      payload,
    };
  }

  private normalizeBusinessEvent(payload: Record<string, unknown>): NormalizedEvent {
    const eventType = typeof payload.eventType === 'string' ? payload.eventType : 'unknown';
    return {
      source: typeof payload.source === 'string' ? payload.source : 'business_event',
      type: eventType,
      businessId: typeof payload.businessId === 'string' ? payload.businessId : undefined,
      userId: typeof payload.actorId === 'string' ? payload.actorId : undefined,
      entityType:
        typeof payload.subjectType === 'string'
          ? payload.subjectType.charAt(0).toUpperCase() + payload.subjectType.slice(1)
          : undefined,
      entityId: typeof payload.subjectId === 'string' ? payload.subjectId : undefined,
      importance: this.inferImportance(eventType, payload),
      payload,
    };
  }

  private extractBusinessId(payload: Record<string, unknown>): string | undefined {
    if (typeof payload.businessId === 'string') return payload.businessId;
    const business = payload.business as Record<string, unknown> | undefined;
    if (business && typeof business.id === 'string') return business.id;
    const invoice = payload.invoice as Record<string, unknown> | undefined;
    if (invoice && typeof invoice.businessId === 'string') return invoice.businessId;
    const contact = payload.contact as Record<string, unknown> | undefined;
    if (contact && typeof contact.businessId === 'string') return contact.businessId;
    const booking = payload.booking as Record<string, unknown> | undefined;
    if (booking && typeof booking.businessId === 'string') return booking.businessId;
    const project = payload.project as Record<string, unknown> | undefined;
    if (project && typeof project.businessId === 'string') return project.businessId;
    return undefined;
  }

  private extractEntity(
    payload: Record<string, unknown>,
    eventName: string,
  ): { entityType?: string; entityId?: string } {
    const noun = eventName.split('.')[0];
    const entityMap: Record<string, string> = {
      booking: 'Booking',
      reservation: 'Reservation',
      contact: 'Contact',
      lead: 'Lead',
      expense: 'Expense',
      receipt: 'Receipt',
      supportTicket: 'SupportTicket',
      ticket: 'Ticket',
      project: 'Project',
      project_task: 'Task',
      task: 'Task',
      campaign: 'Campaign',
      email_campaign: 'Campaign',
      invoice: 'Invoice',
      quote: 'Quote',
      product: 'Product',
      catalog: 'Product',
      message: 'Message',
      delivery: 'Delivery',
      call_log: 'CallLog',
      autopilot: 'Task',
      ingestion: 'Ingestion',
      document: 'Document',
      file: 'Document',
      media: 'Media',
      audio: 'Audio',
      video: 'Video',
      meeting: 'Meeting',
      calendar: 'CalendarEvent',
      training: 'Training',
      course: 'Course',
      board: 'Board',
      resolution: 'Resolution',
      reminder: 'Reminder',
      deadline: 'Deadline',
      appointment: 'Appointment',
      vendor: 'Vendor',
      user: 'User',
      employee: 'Employee',
      hr: 'Hr',
      onboarding: 'Onboarding',
      candidate: 'Candidate',
      application: 'Application',
      outreach: 'Outreach',
      sequence: 'Sequence',
      it: 'It',
      legal: 'Legal',
      contract: 'Contract',
      design: 'Design',
      doc: 'Doc',
      bug: 'Bug',
      qa: 'Qa',
      inventory: 'Inventory',
      stock: 'Stock',
      procurement: 'Procurement',
      purchase_order: 'PurchaseOrder',
      order: 'Order',
      visitor: 'Visitor',
      guest: 'Guest',
      check_in: 'CheckIn',
      restaurant: 'Restaurant',
      shift: 'Shift',
      field_service: 'FieldService',
      dispatch: 'Dispatch',
      technician: 'Technician',
      coding: 'Coding',
      claim: 'Claim',
      budget: 'Budget',
      recurring_invoice: 'RecurringInvoice',
      revenue_action: 'RevenueAction',
    };

    const entityType = entityMap[noun];
    const entityId =
      typeof payload.id === 'string'
        ? payload.id
        : typeof (payload[`${noun}Id`] as string) === 'string'
          ? (payload[`${noun}Id`] as string)
          : typeof (payload[noun] as Record<string, unknown>)?.id === 'string'
            ? ((payload[noun] as Record<string, unknown>).id as string)
            : undefined;

    return { entityType, entityId };
  }

  private inferSource(eventName: string): string {
    const prefix = eventName.split('.')[0];
    const sourceMap: Record<string, string> = {
      booking: 'bookings',
      reservation: 'bookings',
      contact: 'crm',
      lead: 'crm',
      expense: 'expenses',
      receipt: 'expenses',
      supportTicket: 'helpdesk',
      ticket: 'helpdesk',
      project: 'projects',
      project_task: 'projects',
      task: 'task_assignments',
      campaign: 'email_marketing',
      email_campaign: 'email_marketing',
      invoice: 'commerce',
      quote: 'commerce',
      product: 'catalog',
      catalog: 'catalog',
      message: 'communications',
      delivery: 'communications',
      call_log: 'call_tasks',
      autopilot: 'autopilot',
      ingestion: 'ingestion',
      document: 'documents',
      file: 'documents',
      media: 'media',
      audio: 'media',
      video: 'media',
      meeting: 'meetings',
      calendar: 'calendar',
      training: 'training',
      course: 'training',
      board: 'board',
      resolution: 'board',
      reminder: 'reminders',
      deadline: 'deadlines',
      appointment: 'appointments',
      vendor: 'vendors',
      user: 'users',
      employee: 'hr',
      hr: 'hr',
      onboarding: 'hr',
      candidate: 'recruiting',
      application: 'recruiting',
      outreach: 'outreach',
      sequence: 'sequences',
      it: 'it',
      legal: 'legal',
      contract: 'contracts',
      design: 'design',
      doc: 'docs',
      bug: 'qa',
      qa: 'qa',
      inventory: 'inventory',
      stock: 'inventory',
      procurement: 'procurement',
      purchase_order: 'procurement',
      visitor: 'front_desk',
      guest: 'front_desk',
      check_in: 'front_desk',
      restaurant: 'restaurant',
      shift: 'restaurant',
      field_service: 'field_service',
      dispatch: 'field_service',
      technician: 'field_service',
      coding: 'medical',
      claim: 'medical',
      budget: 'budget',
      recurring_invoice: 'commerce',
      revenue_action: 'finance',
      business_event: 'business_event',
    };
    return sourceMap[prefix] ?? prefix;
  }

  private inferImportance(
    eventName: string,
    payload: Record<string, unknown>,
  ): 'low' | 'normal' | 'high' | 'critical' {
    const lower = eventName.toLowerCase();
    if (lower.includes('failed') || lower.includes('no_show') || lower.includes('overdue')) {
      return 'high';
    }
    if (lower.includes('critical') || payload.importance === 'critical') {
      return 'critical';
    }
    if (lower.includes('created') || lower.includes('received')) {
      return 'normal';
    }
    return 'low';
  }
}
