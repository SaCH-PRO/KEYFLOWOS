import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BusinessGraphService } from './business-graph.service';

const GRAPH_INVALIDATING_EVENTS = [
  'contact.created',
  'contact.updated',
  'contact.deleted',
  'contact.merged',
  'contact.imported',
  'invoice.paid',
  'invoice.sent',
  'invoice.overdue',
  'booking.created',
  'booking.confirmed',
  'booking.completed',
  'booking.cancelled',
  'product.created',
  'product.updated',
  'product.deactivated',
  'expense.created',
  'store_order.created',
  'store_order.paid',
  'action.executed',
] as const;

@Injectable()
export class AiListener {
  private readonly logger = new Logger(AiListener.name);
  private readonly events: Array<{ event: string; payload: unknown }> = [];

  constructor(
    @Inject(BusinessGraphService) private readonly graphService: BusinessGraphService,
  ) {}

  @OnEvent('contact.*')
  handleContactEvent(payload: unknown) { this.processEvent('contact', payload); }

  @OnEvent('invoice.*')
  handleInvoiceEvent(payload: unknown) { this.processEvent('invoice', payload); }

  @OnEvent('booking.*')
  handleBookingEvent(payload: unknown) { this.processEvent('booking', payload); }

  @OnEvent('product.*')
  handleProductEvent(payload: unknown) { this.processEvent('product', payload); }

  @OnEvent('expense.*')
  handleExpenseEvent(payload: unknown) { this.processEvent('expense', payload); }

  @OnEvent('store_order.*')
  handleStoreOrderEvent(payload: unknown) { this.processEvent('store_order', payload); }

  @OnEvent('action.*')
  handleActionEvent(payload: unknown) { this.processEvent('action', payload); }

  @OnEvent('campaign.*')
  handleCampaignEvent(payload: unknown) { this.processEvent('campaign', payload); }

  @OnEvent('post.*')
  handlePostEvent(payload: unknown) { this.processEvent('post', payload); }

  @OnEvent('lead_form.*')
  handleLeadFormEvent(payload: unknown) { this.processEvent('lead_form', payload); }

  @OnEvent('sequence.*')
  handleSequenceEvent(payload: unknown) { this.processEvent('sequence', payload); }

  @OnEvent('content.*')
  handleContentEvent(payload: unknown) { this.processEvent('content', payload); }

  @OnEvent('delivery.*')
  handleDeliveryEvent(payload: unknown) { this.processEvent('delivery', payload); }

  @OnEvent('inventory.*')
  handleInventoryEvent(payload: unknown) { this.processEvent('inventory', payload); }

  @OnEvent('quote.*')
  handleQuoteEvent(payload: unknown) { this.processEvent('quote', payload); }

  @OnEvent('preorder.*')
  handlePreorderEvent(payload: unknown) { this.processEvent('preorder', payload); }

  @OnEvent('graph.*')
  handleGraphEvent(payload: unknown) { this.processEvent('graph', payload); }

  private processEvent(domain: string, payload: unknown) {
    this.events.push({ event: domain, payload });
    this.logger.debug(`AI observed event in domain: ${domain}`);

    const businessId = (payload as any)?.businessId;
    if (!businessId) return;

    const invalidatingDomains = ['contact', 'invoice', 'booking', 'product', 'expense', 'store_order', 'action'];
    if (invalidatingDomains.includes(domain)) {
      this.graphService.invalidateCache(businessId);
      this.logger.debug(`Graph cache invalidated for ${businessId} due to ${domain} event`);
    }
  }

  getEvents() {
    return this.events;
  }
}
