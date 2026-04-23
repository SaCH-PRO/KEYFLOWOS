import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BusinessGraphService } from './business-graph.service';
import { GraphCacheInvalidatedPayload } from '../../core/event-bus/events.types';

const INVALIDATING_DOMAINS = new Set([
  'contact', 'invoice', 'booking', 'product', 'expense', 'store_order', 'action',
]);

@Injectable()
export class AiListener {
  private readonly logger = new Logger(AiListener.name);
  private readonly events: Array<{ event: string; payload: unknown }> = [];

  constructor(
    @Inject(BusinessGraphService) private readonly graphService: BusinessGraphService,
    @Inject(EventEmitter2) private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent('contact.created')
  onContactCreated(p: unknown) { this.processEvent('contact.created', p); }

  @OnEvent('contact.updated')
  onContactUpdated(p: unknown) { this.processEvent('contact.updated', p); }

  @OnEvent('contact.deleted')
  onContactDeleted(p: unknown) { this.processEvent('contact.deleted', p); }

  @OnEvent('contact.merged')
  onContactMerged(p: unknown) { this.processEvent('contact.merged', p); }

  @OnEvent('contact.imported')
  onContactImported(p: unknown) { this.processEvent('contact.imported', p); }

  @OnEvent('invoice.paid')
  onInvoicePaid(p: unknown) { this.processEvent('invoice.paid', p); }

  @OnEvent('invoice.sent')
  onInvoiceSent(p: unknown) { this.processEvent('invoice.sent', p); }

  @OnEvent('invoice.overdue')
  onInvoiceOverdue(p: unknown) { this.processEvent('invoice.overdue', p); }

  @OnEvent('booking.created')
  onBookingCreated(p: unknown) { this.processEvent('booking.created', p); }

  @OnEvent('booking.confirmed')
  onBookingConfirmed(p: unknown) { this.processEvent('booking.confirmed', p); }

  @OnEvent('booking.completed')
  onBookingCompleted(p: unknown) { this.processEvent('booking.completed', p); }

  @OnEvent('booking.cancelled')
  onBookingCancelled(p: unknown) { this.processEvent('booking.cancelled', p); }

  @OnEvent('booking.rescheduled')
  onBookingRescheduled(p: unknown) { this.processEvent('booking.rescheduled', p); }

  @OnEvent('product.created')
  onProductCreated(p: unknown) { this.processEvent('product.created', p); }

  @OnEvent('product.updated')
  onProductUpdated(p: unknown) { this.processEvent('product.updated', p); }

  @OnEvent('product.deactivated')
  onProductDeactivated(p: unknown) { this.processEvent('product.deactivated', p); }

  @OnEvent('expense.created')
  onExpenseCreated(p: unknown) { this.processEvent('expense.created', p); }

  @OnEvent('store_order.created')
  onStoreOrderCreated(p: unknown) { this.processEvent('store_order.created', p); }

  @OnEvent('store_order.paid')
  onStoreOrderPaid(p: unknown) { this.processEvent('store_order.paid', p); }

  @OnEvent('store_order.shipped')
  onStoreOrderShipped(p: unknown) { this.processEvent('store_order.shipped', p); }

  @OnEvent('store_order.delivered')
  onStoreOrderDelivered(p: unknown) { this.processEvent('store_order.delivered', p); }

  @OnEvent('store_order.cancelled')
  onStoreOrderCancelled(p: unknown) { this.processEvent('store_order.cancelled', p); }

  @OnEvent('store_order.refunded')
  onStoreOrderRefunded(p: unknown) { this.processEvent('store_order.refunded', p); }

  @OnEvent('action.executed')
  onActionExecuted(p: unknown) { this.processEvent('action.executed', p); }

  @OnEvent('action.blocked')
  onActionBlocked(p: unknown) { this.processEvent('action.blocked', p); }

  @OnEvent('campaign.created')
  onCampaignCreated(p: unknown) { this.processEvent('campaign.created', p); }

  @OnEvent('campaign.sent')
  onCampaignSent(p: unknown) { this.processEvent('campaign.sent', p); }

  @OnEvent('campaign.briefing_generated')
  onCampaignBriefing(p: unknown) { this.processEvent('campaign.briefing_generated', p); }

  @OnEvent('post.published')
  onPostPublished(p: unknown) { this.processEvent('post.published', p); }

  @OnEvent('lead_form.created')
  onLeadFormCreated(p: unknown) { this.processEvent('lead_form.created', p); }

  @OnEvent('lead_form.submitted')
  onLeadFormSubmitted(p: unknown) { this.processEvent('lead_form.submitted', p); }

  @OnEvent('sequence.step_due')
  onSequenceStepDue(p: unknown) { this.processEvent('sequence.step_due', p); }

  @OnEvent('sequence.step_failed')
  onSequenceStepFailed(p: unknown) { this.processEvent('sequence.step_failed', p); }

  @OnEvent('quote.created')
  onQuoteCreated(p: unknown) { this.processEvent('quote.created', p); }

  @OnEvent('quote.sent')
  onQuoteSent(p: unknown) { this.processEvent('quote.sent', p); }

  @OnEvent('quote.converted')
  onQuoteConverted(p: unknown) { this.processEvent('quote.converted', p); }

  @OnEvent('content.published')
  onContentPublished(p: unknown) { this.processEvent('content.published', p); }

  @OnEvent('content.failed')
  onContentFailed(p: unknown) { this.processEvent('content.failed', p); }

  @OnEvent('delivery.completed')
  onDeliveryCompleted(p: unknown) { this.processEvent('delivery.completed', p); }

  @OnEvent('delivery.failed')
  onDeliveryFailed(p: unknown) { this.processEvent('delivery.failed', p); }

  @OnEvent('inventory.low')
  onInventoryLow(p: unknown) { this.processEvent('inventory.low', p); }

  @OnEvent('inventory.out')
  onInventoryOut(p: unknown) { this.processEvent('inventory.out', p); }

  @OnEvent('preorder.delayed')
  onPreorderDelayed(p: unknown) { this.processEvent('preorder.delayed', p); }

  @OnEvent('purchaseOrder.received')
  onPurchaseOrderReceived(p: unknown) { this.processEvent('purchaseOrder.received', p); }

  private processEvent(eventName: string, payload: unknown) {
    this.events.push({ event: eventName, payload });
    this.logger.debug(`AI observed event: ${eventName}`);

    const businessId = (payload as any)?.businessId;
    if (!businessId) return;

    const domain = eventName.split('.')[0];
    if (INVALIDATING_DOMAINS.has(domain)) {
      this.graphService.invalidateCache(businessId);
      const cachePayload: GraphCacheInvalidatedPayload = {
        businessId,
        reason: 'data_change',
        sourceEvent: eventName,
      };
      this.eventEmitter.emit('graph.cache_invalidated', cachePayload);
      this.logger.debug(`Graph cache invalidated for ${businessId} due to ${eventName}`);
    }
  }

  getEvents() {
    return this.events;
  }
}
