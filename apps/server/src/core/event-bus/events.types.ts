import { Booking, Contact, Invoice, InvoiceItem, SocialPost } from '@keyflow/db';

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

// Master event map for reference and typing
export interface KeyFlowEventMap {
  'contact.created': ContactCreatedPayload;
  'contact.updated': ContactUpdatedPayload;
  'contact.merged': ContactMergedPayload;
  'contact.deleted': ContactDeletedPayload;
  'contact.imported': ContactImportedPayload;
  'sequence.step_due': SequenceStepDuePayload;
  'booking.created': BookingCreatedPayload;
  'booking.confirmed': BookingConfirmedPayload;
  'booking.completed': BookingCompletedPayload;
  'invoice.paid': InvoicePaidPayload;
  'invoice.sent': InvoiceStatusPayload;
  'invoice.overdue': InvoiceStatusPayload;
  'post.published': PostPublishedPayload;
}
