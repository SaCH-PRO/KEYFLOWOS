/**
 * Form-state shapes used by commerce panels (invoice, quote builders).
 * These mirror the request bodies sent to the backend.
 */

export type DiscountType = "percentage" | "fixed";

export interface CommerceLineItem {
  id?: string;
  productId?: string | null;
  description?: string;
  quantity: number;
  unitPrice: number;
  taxRate?: number;
  total?: number;
}

export interface InvoiceFormState {
  contactId?: string | null;
  invoiceNumber?: string;
  issueDate?: string;
  dueDate?: string;
  taxRate: number;
  discountType?: DiscountType;
  discountValue: number;
  notes?: string;
  currency?: string;
  items: CommerceLineItem[];
  [key: string]: unknown;
}

export interface QuoteFormState {
  contactId?: string | null;
  quoteNumber?: string;
  issueDate?: string;
  expiryDate?: string;
  taxRate: number;
  discountType?: DiscountType;
  discountValue: number;
  notes?: string;
  currency?: string;
  items: CommerceLineItem[];
  [key: string]: unknown;
}
