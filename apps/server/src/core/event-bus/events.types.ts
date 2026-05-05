import { Booking, Contact, Invoice, InvoiceItem, Product, Quote, QuoteItem, Service, SocialPost } from '@keyflow/db';
import type { ConnectorType } from '../connectors/connector.interface';

export class ContactCreatedPayload {
  contact!: Contact;
  businessId!: string;
}

export class ContactUpdatedPayload {
  contact!: Contact;
  businessId!: string;
  fromStatus?: string | null;
  toStatus?: string | null;
}

export class ContactMergedPayload {
  contact!: Contact;
  businessId!: string;
  duplicateId!: string;
}

export class ContactDeletedPayload {
  contact!: Contact;
  businessId!: string;
}

export class ContactImportedPayload {
  businessId!: string;
  source!: string;
  count!: number;
}

export class SequenceStepDuePayload {
  businessId!: string;
  contactId!: string;
  contactName!: string;
  sequenceId!: string;
  sequenceName!: string;
  stepIndex!: number;
  stepType!: string;
  enrollmentId!: string;
}

export class SequenceStepFailedPayload {
  businessId!: string;
  contactId!: string;
  contactName!: string;
  sequenceId!: string;
  sequenceName!: string;
  stepIndex!: number;
  stepType!: string;
  enrollmentId!: string;
  error!: string;
  retryCount!: number;
}

export class BookingCreatedPayload {
  booking!: Booking;
  contact?: Contact;
  businessId!: string;
}

export class BookingConfirmedPayload {
  booking!: Booking;
  contact?: Contact;
  businessId!: string;
}

export class BookingCompletedPayload {
  booking!: Booking;
  contact?: Partial<Contact>;
  businessId!: string;
}

export class BookingCancelledPayload {
  booking!: Booking;
  contact?: Partial<Contact>;
  businessId!: string;
}

export class BookingRescheduledPayload {
  booking!: Booking;
  contact?: Partial<Contact>;
  businessId!: string;
  previousStartTime!: Date;
  previousEndTime!: Date;
}

export class InvoicePaidPayload {
  invoice!: Invoice & { items?: InvoiceItem[]; contact?: Contact; bookingId?: string | null };
  businessId!: string;
}

export class InvoiceStatusPayload {
  invoice!: Invoice & { items?: InvoiceItem[]; contact?: Contact; bookingId?: string | null };
  businessId!: string;
  status!: string;
}

export class PostPublishedPayload {
  post!: SocialPost;
  businessId!: string;
}

export class ProductCreatedPayload {
  product!: Product;
  businessId!: string;
}

export class ProductUpdatedPayload {
  product!: Product;
  businessId!: string;
}

export class ProductDeactivatedPayload {
  product!: Product;
  businessId!: string;
}

// ---- Canonical Catalog events (S1: shared catalog) ----
// Owned by CatalogService. Legacy `product.*` events above are still
// emitted alongside these for backwards compatibility with existing
// listeners; new listeners should subscribe to `catalog.*` instead.

export class CatalogProductCreatedPayload {
  product!: Product;
  businessId!: string;
}

export class CatalogProductUpdatedPayload {
  product!: Product;
  businessId!: string;
}

export class CatalogProductDeletedPayload {
  product!: Product;
  businessId!: string;
}

export class CatalogServiceCreatedPayload {
  service!: Service;
  businessId!: string;
}

export class CatalogServiceUpdatedPayload {
  service!: Service;
  businessId!: string;
}

export class CatalogServiceDeletedPayload {
  service!: Service | { id: string };
  businessId!: string;
}

export class QuoteCreatedPayload {
  quote!: Quote & { items?: QuoteItem[]; contact?: Contact | null };
  businessId!: string;
}

export class QuoteSentPayload {
  quote!: Quote & { contact?: Contact | null };
  businessId!: string;
}

export class QuoteViewedPayload {
  quote!: Quote & { contact?: Contact | null };
  businessId!: string;
  viewedAt!: Date;
  source!: 'public' | 'internal';
}

export class QuoteAcceptedPayload {
  quote!: Quote & { contact?: Contact | null };
  businessId!: string;
  acceptedAt!: Date;
  source!: 'public' | 'internal';
}

export class QuoteRejectedPayload {
  quote!: Quote & { contact?: Contact | null };
  businessId!: string;
  rejectedAt!: Date;
  source!: 'public' | 'internal';
  reason?: string | null;
}

export class QuoteStalePayload {
  quote!: Quote & { contact?: Contact | null };
  businessId!: string;
  sentAt!: Date;
  daysSinceSent!: number;
}

export class QuoteConvertedPayload {
  quote!: Quote;
  invoice!: Invoice & { items?: InvoiceItem[]; contact?: Contact | null };
  businessId!: string;
}

export class InvoiceCreatedPayload {
  invoice!: Invoice & { items?: InvoiceItem[]; contact?: Contact | null };
  businessId!: string;
  source!: 'manual' | 'quote' | 'recurring' | 'booking' | 'campaign';
  quoteId?: string | null;
}

export class CampaignCreatedPayload {
  campaign!: Record<string, any>;
  businessId!: string;
}

export class CampaignSentPayload {
  campaign!: Record<string, any>;
  businessId!: string;
  recipientCount!: number;
}

export class CampaignBriefingGeneratedPayload {
  briefingId!: string;
  campaignId!: string;
  businessId!: string;
  performanceVsAvg!: string;
}

export class LeadFormCreatedPayload {
  form!: Record<string, any>;
  businessId!: string;
}

export class LeadFormSubmittedPayload {
  submission!: Record<string, any>;
  form!: Record<string, any>;
  businessId!: string;
  contactId!: string | null;
}

export class ExpenseCreatedPayload {
  expense!: { id: string; businessId: string; amount: number; description: string; categoryId?: string | null };
  businessId!: string;
}

export class StoreOrderCreatedPayload {
  order!: any;
  businessId!: string;
}

export class StoreOrderPaidPayload {
  order!: any;
  businessId!: string;
}

export class StoreOrderShippedPayload {
  order!: any;
  businessId!: string;
}

export class StoreOrderDeliveredPayload {
  order!: any;
  businessId!: string;
}

export class StoreOrderCancelledPayload {
  order!: any;
  businessId!: string;
}

export class StoreOrderRefundedPayload {
  order!: any;
  businessId!: string;
  refundAmount?: number;
}

export class InventoryLowPayload {
  businessId!: string;
  productId!: string;
  productName!: string;
  productSku?: string | null;
  warehouseId!: string;
  warehouseName!: string;
  quantity!: number;
  reorderAt!: number;
}

export class InventoryOutPayload {
  businessId!: string;
  productId!: string;
  productName!: string;
  productSku?: string | null;
  warehouseId!: string;
  warehouseName!: string;
}

export class PurchaseOrderReceivedPayload {
  businessId!: string;
  purchaseOrderId!: string;
  poNumber!: string;
  supplierName?: string | null;
  items!: any[];
  total!: number;
  currency!: string;
}

export class PreorderDelayedPayload {
  businessId!: string;
  preOrderId!: string;
  productId!: string;
  productName!: string;
  customerName?: string | null;
  customerEmail?: string | null;
  originalExpectedDate?: Date | null;
  newExpectedDate?: Date | null;
  reason?: string | null;
}

export class ContentPublishedPayload {
  deliveryId!: string;
  contentId!: string;
  businessId!: string;
  destinationId!: string;
}

export class ContentFailedPayload {
  deliveryId!: string;
  contentId!: string;
  businessId!: string;
  errorCode?: string;
}

export class DeliveryCompletedPayload {
  deliveryId!: string;
  contentId!: string;
  businessId!: string;
}

export class DeliveryFailedPayload {
  deliveryId!: string;
  contentId!: string;
  businessId!: string;
}

export class GraphCacheInvalidatedPayload {
  businessId!: string;
  reason!: string;
  sourceEvent?: string;
}

export class ActionExecutedPayload {
  businessId!: string;
  toolName!: string;
  module!: string | null;
  riskTier!: number;
  success!: boolean;
  changedEntities?: string[];
}

export class ActionBlockedPayload {
  businessId!: string;
  toolName!: string;
  reason!: string;
  riskTier!: number;
}

// ---- R3: Revenue Action Queue canonical events ----
export class RevenueActionCreatedPayload {
  businessId!: string;
  actionId!: string;
  type!: string;
  priority!: number;
  relatedType?: string | null;
  relatedId?: string | null;
  amountAtRisk?: number | null;
}

export class RevenueActionCompletedPayload {
  businessId!: string;
  actionId!: string;
  type!: string;
  resolution!: 'completed' | 'dismissed' | 'snoozed';
  relatedType?: string | null;
  relatedId?: string | null;
  resolvedBy?: string | null;
}

export interface ConnectorEventEnvelope {
  connectorType: ConnectorType;
  externalId: string | null;
  businessId: string;
  timestamp: Date;
}

export class ConnectorSyncedPayload implements ConnectorEventEnvelope {
  connectorType!: ConnectorType;
  externalId!: null;
  businessId!: string;
  timestamp!: Date;
  itemsSynced!: number;
  duration!: number;
}

export class ConnectorErrorPayload implements ConnectorEventEnvelope {
  connectorType!: ConnectorType;
  externalId!: null;
  businessId!: string;
  timestamp!: Date;
  error!: string;
  duration!: number;
}

export class ConnectorDisconnectedPayload implements ConnectorEventEnvelope {
  connectorType!: ConnectorType;
  externalId!: null;
  businessId!: string;
  timestamp!: Date;
}

export class ConnectorConnectedPayload implements ConnectorEventEnvelope {
  connectorType!: ConnectorType;
  externalId!: null;
  businessId!: string;
  timestamp!: Date;
  account?: string;
}

export class MessageReceivedPayload implements ConnectorEventEnvelope {
  connectorType!: ConnectorType;
  externalId!: string | null;
  businessId!: string;
  timestamp!: Date;
  channel!: string;
  from!: string;
  to?: string;
  subject?: string;
  body?: string;
  contactId?: string;
}

export class MessageSentPayload implements ConnectorEventEnvelope {
  connectorType!: ConnectorType;
  externalId!: string | null;
  businessId!: string;
  timestamp!: Date;
  channel!: string;
  to!: string;
  subject?: string;
  contactId?: string;
}

export class PaymentReceivedPayload implements ConnectorEventEnvelope {
  connectorType!: ConnectorType;
  externalId!: string | null;
  businessId!: string;
  timestamp!: Date;
  amount!: number;
  currency!: string;
  provider!: string;
  invoiceId?: string;
  contactId?: string;
}

export class PaymentFailedPayload implements ConnectorEventEnvelope {
  connectorType!: ConnectorType;
  externalId!: string | null;
  businessId!: string;
  timestamp!: Date;
  amount!: number;
  currency!: string;
  provider!: string;
  error!: string;
  invoiceId?: string;
}

export class CalendarEventCreatedPayload implements ConnectorEventEnvelope {
  connectorType!: ConnectorType;
  externalId!: string | null;
  businessId!: string;
  timestamp!: Date;
  title!: string;
  startTime!: Date;
  endTime!: Date;
  bookingId?: string;
}

export class CalendarEventUpdatedPayload implements ConnectorEventEnvelope {
  connectorType!: ConnectorType;
  externalId!: string | null;
  businessId!: string;
  timestamp!: Date;
  title!: string;
  startTime!: Date;
  endTime!: Date;
}

export class FileUploadedPayload implements ConnectorEventEnvelope {
  connectorType!: ConnectorType;
  externalId!: string | null;
  businessId!: string;
  timestamp!: Date;
  fileName!: string;
  mimeType!: string;
  size?: number;
  url?: string;
}

export class FileSyncedPayload implements ConnectorEventEnvelope {
  connectorType!: ConnectorType;
  externalId!: string | null;
  businessId!: string;
  timestamp!: Date;
  fileCount!: number;
}

export class SocialPostPublishedPayload implements ConnectorEventEnvelope {
  connectorType!: ConnectorType;
  externalId!: string | null;
  businessId!: string;
  timestamp!: Date;
  platform!: string;
  postId?: string;
  url?: string;
}

export class SocialEngagementReceivedPayload implements ConnectorEventEnvelope {
  connectorType!: ConnectorType;
  externalId!: string | null;
  businessId!: string;
  timestamp!: Date;
  platform!: string;
  type!: string;
  postId?: string;
  contactId?: string;
}

export class FormSubmittedPayload implements ConnectorEventEnvelope {
  connectorType!: ConnectorType;
  externalId!: string | null;
  businessId!: string;
  timestamp!: Date;
  formId!: string;
  formName?: string;
  contactId?: string;
  data!: Record<string, unknown>;
}

export class EntityResolvedPayload {
  businessId!: string;
  contactId!: string;
  source!: string;
  matchedOn!: string;
  isNew!: boolean;
  merged!: boolean;
}

export class SeoRankingDropPayload {
  businessId!: string;
  keywordId!: string;
  keyword!: string;
  previousPosition!: number;
  currentPosition!: number;
  pageUrl?: string;
}

export class SeoIssueDetectedPayload {
  businessId!: string;
  issueId!: string;
  issueType!: string;
  severity!: string;
  title!: string;
}

export class SeoContentBriefCreatedPayload {
  businessId!: string;
  briefId!: string;
  title!: string;
  targetKeyword!: string;
}

export class SeoPageIndexedPayload {
  businessId!: string;
  pageId!: string;
  url!: string;
  indexingStatus!: string;
}

export class SeoSyncCompletedPayload {
  businessId!: string;
  source!: string;
  pagesUpdated!: number;
  keywordsUpdated!: number;
}

// Master event map for reference and typing
export interface KeyFlowEventMap {
  'contact.created': ContactCreatedPayload;
  'contact.updated': ContactUpdatedPayload;
  'contact.merged': ContactMergedPayload;
  'contact.deleted': ContactDeletedPayload;
  'contact.imported': ContactImportedPayload;
  'sequence.step_due': SequenceStepDuePayload;
  'sequence.step_failed': SequenceStepFailedPayload;
  'booking.created': BookingCreatedPayload;
  'booking.confirmed': BookingConfirmedPayload;
  'booking.completed': BookingCompletedPayload;
  'booking.cancelled': BookingCancelledPayload;
  'booking.rescheduled': BookingRescheduledPayload;
  'invoice.paid': InvoicePaidPayload;
  'invoice.sent': InvoiceStatusPayload;
  'invoice.overdue': InvoiceStatusPayload;
  'post.published': PostPublishedPayload;
  'product.created': ProductCreatedPayload;
  'product.updated': ProductUpdatedPayload;
  'product.deactivated': ProductDeactivatedPayload;
  'catalog.product.created': CatalogProductCreatedPayload;
  'catalog.product.updated': CatalogProductUpdatedPayload;
  'catalog.product.deleted': CatalogProductDeletedPayload;
  'catalog.service.created': CatalogServiceCreatedPayload;
  'catalog.service.updated': CatalogServiceUpdatedPayload;
  'catalog.service.deleted': CatalogServiceDeletedPayload;
  'quote.created': QuoteCreatedPayload;
  'quote.sent': QuoteSentPayload;
  'quote.viewed': QuoteViewedPayload;
  'quote.accepted': QuoteAcceptedPayload;
  'quote.rejected': QuoteRejectedPayload;
  'quote.stale': QuoteStalePayload;
  'quote.converted': QuoteConvertedPayload;
  'invoice.created': InvoiceCreatedPayload;
  'campaign.created': CampaignCreatedPayload;
  'campaign.sent': CampaignSentPayload;
  'campaign.briefing_generated': CampaignBriefingGeneratedPayload;
  'lead_form.created': LeadFormCreatedPayload;
  'lead_form.submitted': LeadFormSubmittedPayload;
  'expense.created': ExpenseCreatedPayload;
  'store_order.created': StoreOrderCreatedPayload;
  'store_order.paid': StoreOrderPaidPayload;
  'store_order.shipped': StoreOrderShippedPayload;
  'store_order.delivered': StoreOrderDeliveredPayload;
  'store_order.cancelled': StoreOrderCancelledPayload;
  'store_order.refunded': StoreOrderRefundedPayload;
  'inventory.low': InventoryLowPayload;
  'inventory.out': InventoryOutPayload;
  'purchaseOrder.received': PurchaseOrderReceivedPayload;
  'preorder.delayed': PreorderDelayedPayload;
  'content.published': ContentPublishedPayload;
  'content.failed': ContentFailedPayload;
  'delivery.completed': DeliveryCompletedPayload;
  'delivery.failed': DeliveryFailedPayload;
  'graph.cache_invalidated': GraphCacheInvalidatedPayload;
  'action.executed': ActionExecutedPayload;
  'action.blocked': ActionBlockedPayload;

  'revenue_action.created': RevenueActionCreatedPayload;
  'revenue_action.completed': RevenueActionCompletedPayload;

  'connector.synced': ConnectorSyncedPayload;
  'connector.error': ConnectorErrorPayload;
  'connector.disconnected': ConnectorDisconnectedPayload;
  'connector.connected': ConnectorConnectedPayload;

  'message.received': MessageReceivedPayload;
  'message.sent': MessageSentPayload;
  'payment.received': PaymentReceivedPayload;
  'payment.failed': PaymentFailedPayload;
  'calendar_event.created': CalendarEventCreatedPayload;
  'calendar_event.updated': CalendarEventUpdatedPayload;
  'file.uploaded': FileUploadedPayload;
  'file.synced': FileSyncedPayload;
  'social_post.published': SocialPostPublishedPayload;
  'social.engagement_received': SocialEngagementReceivedPayload;
  'form.submitted': FormSubmittedPayload;
  'entity.resolved': EntityResolvedPayload;

  'seo.ranking_drop': SeoRankingDropPayload;
  'seo.issue_detected': SeoIssueDetectedPayload;
  'seo.content_brief_created': SeoContentBriefCreatedPayload;
  'seo.page_indexed': SeoPageIndexedPayload;
  'seo.sync_completed': SeoSyncCompletedPayload;
}
