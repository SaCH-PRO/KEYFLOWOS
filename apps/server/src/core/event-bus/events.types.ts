import { Booking, Contact, Invoice, InvoiceItem } from '@keyflow/db';

// Payload for when a new contact is created
export class ContactCreatedPayload {
  contact!: Contact;
  businessId!: string;
}

// Payload for when a new booking is created
export class BookingCreatedPayload {
  booking!: Booking;
  contact?: Contact;
  businessId!: string;
}

// Payload for when an invoice is paid
export class InvoicePaidPayload {
  invoice!: Invoice & { items?: InvoiceItem[]; contact?: Contact };
  businessId!: string;
}

// Master event map for reference and typing
export interface KeyFlowEventMap {
  'contact.created': ContactCreatedPayload;
  'booking.created': BookingCreatedPayload;
  'invoice.paid': InvoicePaidPayload;
}
