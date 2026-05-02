import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  BookingCancelledPayload,
  BookingCompletedPayload,
  BookingConfirmedPayload,
  BookingCreatedPayload,
  BookingRescheduledPayload,
  ContactCreatedPayload,
  ContactImportedPayload,
  EntityResolvedPayload,
  FormSubmittedPayload,
  InvoicePaidPayload,
  LeadFormSubmittedPayload,
  MessageReceivedPayload,
  PaymentReceivedPayload,
  QuoteConvertedPayload,
  QuoteCreatedPayload,
  QuoteSentPayload,
  SocialEngagementReceivedPayload,
  StoreOrderPaidPayload,
} from '../../core/event-bus/events.types';
import { CustomerJourneyService, type Channel, type JourneyStage } from './customer-journey.service';

interface RecordHint {
  channel: Channel;
  source: string;
  touchpointType: string;
  stageHint: JourneyStage;
  campaignId?: string;
  campaignName?: string;
  value?: number;
  currency?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class JourneyListenerService {
  private readonly logger = new Logger(JourneyListenerService.name);

  constructor(@Inject(CustomerJourneyService) private readonly journeys: CustomerJourneyService) {}

  private async record(businessId: string | undefined | null, contactId: string | undefined | null, hint: RecordHint) {
    if (!businessId || !contactId) return;
    try {
      await this.journeys.recordTouchpoint({ businessId, contactId, ...hint });
    } catch (err) {
      this.logger.warn(`Failed to record journey touchpoint: ${(err as Error).message}`);
    }
  }

  // -------- Contact lifecycle --------
  @OnEvent('contact.created')
  async onContactCreated(payload: ContactCreatedPayload) {
    const source = (payload.contact as { source?: string | null } | undefined)?.source ?? 'crm';
    await this.record(payload.businessId, payload.contact?.id, {
      channel: inferChannel(source),
      source,
      touchpointType: 'first_contact',
      stageHint: 'AWARENESS',
    });
  }

  @OnEvent('entity.resolved')
  async onEntityResolved(payload: EntityResolvedPayload) {
    if (!payload.isNew) return;
    await this.record(payload.businessId, payload.contactId, {
      channel: inferChannel(payload.source),
      source: payload.source ?? 'connector',
      touchpointType: 'first_contact',
      stageHint: 'AWARENESS',
      metadata: { matchedOn: payload.matchedOn },
    });
  }

  // -------- Forms --------
  @OnEvent('lead_form.submitted')
  async onLeadFormSubmitted(payload: LeadFormSubmittedPayload) {
    const formId = (payload.form as { id?: string } | undefined)?.id;
    const formName = (payload.form as { name?: string } | undefined)?.name;
    await this.record(payload.businessId, payload.contactId, {
      channel: 'form',
      source: 'lead_form',
      touchpointType: 'form_submit',
      stageHint: 'INTEREST',
      metadata: { formId, formName },
    });
  }

  @OnEvent('form.submitted')
  async onFormSubmitted(payload: FormSubmittedPayload) {
    if (!payload.contactId) return;
    await this.record(payload.businessId, payload.contactId, {
      channel: 'form',
      source: payload.connectorType ?? 'form',
      touchpointType: 'form_submit',
      stageHint: 'INTEREST',
      metadata: { formId: payload.formId, formName: payload.formName },
    });
  }

  // -------- Payments / commerce --------
  @OnEvent('payment.received')
  async onPaymentReceived(payload: PaymentReceivedPayload) {
    if (!payload.contactId) return;
    await this.record(payload.businessId, payload.contactId, {
      channel: 'direct',
      source: payload.provider ?? payload.connectorType ?? 'commerce',
      touchpointType: 'payment',
      stageHint: 'CONVERSION',
      value: payload.amount,
      currency: payload.currency ?? 'TTD',
      metadata: { invoiceId: payload.invoiceId },
    });
  }

  @OnEvent('invoice.paid')
  async onInvoicePaid(payload: InvoicePaidPayload) {
    const contactId = payload.invoice?.contact?.id ?? (payload.invoice as { contactId?: string } | undefined)?.contactId;
    const amount = Number(payload.invoice?.total ?? 0);
    await this.record(payload.businessId, contactId, {
      channel: 'direct',
      source: 'commerce',
      touchpointType: 'payment',
      stageHint: 'CONVERSION',
      value: Number.isFinite(amount) ? amount : undefined,
      currency: 'TTD',
      metadata: { invoiceId: payload.invoice?.id },
    });
  }

  @OnEvent('store_order.paid')
  async onStoreOrderPaid(payload: StoreOrderPaidPayload) {
    const order = payload.order as { id?: string; contactId?: string; total?: number; currency?: string } | undefined;
    if (!order?.contactId) return;
    await this.record(payload.businessId, order.contactId, {
      channel: 'direct',
      source: 'storefront',
      touchpointType: 'order_paid',
      stageHint: 'CONVERSION',
      value: order.total,
      currency: order.currency ?? 'TTD',
      metadata: { orderId: order.id },
    });
  }

  // -------- Bookings --------
  @OnEvent('booking.created')
  async onBookingCreated(payload: BookingCreatedPayload) {
    const contactId = payload.contact?.id ?? (payload.booking as { contactId?: string } | undefined)?.contactId;
    await this.record(payload.businessId, contactId, {
      channel: 'direct',
      source: 'bookings',
      touchpointType: 'booking_created',
      stageHint: 'CONSIDERATION',
      metadata: { bookingId: payload.booking?.id },
    });
  }

  @OnEvent('booking.confirmed')
  async onBookingConfirmed(payload: BookingConfirmedPayload) {
    const contactId = payload.contact?.id ?? (payload.booking as { contactId?: string } | undefined)?.contactId;
    await this.record(payload.businessId, contactId, {
      channel: 'direct',
      source: 'bookings',
      touchpointType: 'booking_confirmed',
      stageHint: 'CONSIDERATION',
      metadata: { bookingId: payload.booking?.id },
    });
  }

  @OnEvent('booking.completed')
  async onBookingCompleted(payload: BookingCompletedPayload) {
    const contactId = payload.contact?.id ?? (payload.booking as { contactId?: string } | undefined)?.contactId;
    await this.record(payload.businessId, contactId, {
      channel: 'direct',
      source: 'bookings',
      touchpointType: 'booking_completed',
      stageHint: 'RETENTION',
      metadata: { bookingId: payload.booking?.id },
    });
  }

  @OnEvent('booking.cancelled')
  async onBookingCancelled(payload: BookingCancelledPayload) {
    const contactId = payload.contact?.id ?? (payload.booking as { contactId?: string } | undefined)?.contactId;
    await this.record(payload.businessId, contactId, {
      channel: 'direct',
      source: 'bookings',
      touchpointType: 'booking_cancelled',
      stageHint: 'CONSIDERATION',
      metadata: { bookingId: payload.booking?.id },
    });
  }

  @OnEvent('booking.rescheduled')
  async onBookingRescheduled(payload: BookingRescheduledPayload) {
    const contactId = payload.contact?.id ?? (payload.booking as { contactId?: string } | undefined)?.contactId;
    await this.record(payload.businessId, contactId, {
      channel: 'direct',
      source: 'bookings',
      touchpointType: 'booking_rescheduled',
      stageHint: 'CONSIDERATION',
      metadata: { bookingId: payload.booking?.id },
    });
  }

  // -------- Quotes --------
  @OnEvent('quote.created')
  async onQuoteCreated(payload: QuoteCreatedPayload) {
    const contactId = payload.quote?.contact?.id ?? (payload.quote as { contactId?: string } | undefined)?.contactId;
    const amount = Number((payload.quote as { total?: number } | undefined)?.total ?? 0);
    await this.record(payload.businessId, contactId, {
      channel: 'direct',
      source: 'commerce',
      touchpointType: 'quote_created',
      stageHint: 'CONSIDERATION',
      value: Number.isFinite(amount) ? amount : undefined,
      metadata: { quoteId: payload.quote?.id },
    });
  }

  @OnEvent('quote.sent')
  async onQuoteSent(payload: QuoteSentPayload) {
    const contactId = payload.quote?.contact?.id ?? (payload.quote as { contactId?: string } | undefined)?.contactId;
    await this.record(payload.businessId, contactId, {
      channel: 'direct',
      source: 'commerce',
      touchpointType: 'quote_sent',
      stageHint: 'CONSIDERATION',
      metadata: { quoteId: payload.quote?.id },
    });
  }

  @OnEvent('quote.converted')
  async onQuoteConverted(payload: QuoteConvertedPayload) {
    const contactId =
      payload.invoice?.contact?.id ??
      (payload.invoice as { contactId?: string } | undefined)?.contactId ??
      (payload.quote as { contactId?: string } | undefined)?.contactId;
    const amount = Number(payload.invoice?.total ?? 0);
    await this.record(payload.businessId, contactId, {
      channel: 'direct',
      source: 'commerce',
      touchpointType: 'quote_converted',
      stageHint: 'CONVERSION',
      value: Number.isFinite(amount) ? amount : undefined,
      currency: 'TTD',
      metadata: { quoteId: payload.quote?.id, invoiceId: payload.invoice?.id },
    });
  }

  // -------- Messaging --------
  @OnEvent('message.received')
  async onMessageReceived(payload: MessageReceivedPayload) {
    if (!payload.contactId) return;
    const ch = (payload.channel ?? '').toLowerCase();
    const channel: Channel = ch.includes('whatsapp') ? 'whatsapp' : ch.includes('email') ? 'email' : 'direct';
    await this.record(payload.businessId, payload.contactId, {
      channel,
      source: payload.connectorType ?? channel,
      touchpointType: 'message_received',
      stageHint: 'INTEREST',
      metadata: { from: payload.from, subject: payload.subject },
    });
  }

  // -------- Social --------
  @OnEvent('social.engagement_received')
  async onSocialEngagement(payload: SocialEngagementReceivedPayload) {
    if (!payload.contactId) return; // social fan-out without identified contact
    await this.record(payload.businessId, payload.contactId, {
      channel: 'social',
      source: payload.platform?.toLowerCase() ?? payload.connectorType ?? 'social',
      touchpointType: `social_${payload.type ?? 'engagement'}`,
      stageHint: 'AWARENESS',
      metadata: { postId: payload.postId, platform: payload.platform },
    });
  }

  // -------- Connector imports (bulk no-op for journey but useful diagnostic) --------
  @OnEvent('contact.imported')
  async onContactImported(_payload: ContactImportedPayload) {
    // Bulk import doesn't carry contactId; backfill endpoint covers per-contact replay.
  }
}

function inferChannel(src: string | null | undefined): Channel {
  if (!src) return 'direct';
  const s = src.toLowerCase();
  if (s.includes('mail') || s.includes('email') || s.includes('klaviyo') || s.includes('mailchimp')) return 'email';
  if (
    s.includes('insta') ||
    s.includes('facebook') ||
    s.includes('linkedin') ||
    s.includes('tiktok') ||
    s.includes('twitter') ||
    s.includes('meta')
  )
    return 'social';
  if (s.includes('whatsapp')) return 'whatsapp';
  if (s.includes('form') || s.includes('typeform') || s.includes('jotform') || s.includes('webhook')) return 'form';
  if (s.includes('referral')) return 'referral';
  if (s.includes('organic') || s.includes('google') || s.includes('seo')) return 'organic';
  if (s.includes('paid') || s.includes('ad')) return 'paid';
  return 'direct';
}
