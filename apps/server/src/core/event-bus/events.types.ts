import { Booking, Contact, Invoice, InvoiceItem, Product, Quote, QuoteItem, SocialPost } from '@keyflow/db';

// Payload for when a new contact is created
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

// Payload for when a new booking is created
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

// Payload for when an invoice is paid
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

export class QuoteCreatedPayload {
  quote!: Quote & { items?: QuoteItem[]; contact?: Contact | null };
  businessId!: string;
}

export class QuoteSentPayload {
  quote!: Quote & { contact?: Contact | null };
  businessId!: string;
}

export class QuoteConvertedPayload {
  quote!: Quote;
  invoice!: Invoice & { items?: InvoiceItem[]; contact?: Contact | null };
  businessId!: string;
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
  'quote.created': QuoteCreatedPayload;
  'quote.sent': QuoteSentPayload;
  'quote.converted': QuoteConvertedPayload;
}
