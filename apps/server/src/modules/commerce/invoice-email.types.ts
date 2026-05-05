/**
 * Shared, narrow shapes for the invoice email pipeline. We intentionally
 * model only the fields the email pipeline reads — the full Prisma row is
 * far wider and not needed here.
 */

export interface InvoiceEmailContactSlim {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

export interface InvoiceEmailItemSlim {
  description: string;
  quantity: number;
  unitPrice: number | string;
}

export interface InvoiceEmailPaymentSlim {
  status: string;
  amount: number;
}

export interface InvoiceEmailBusinessSlim {
  name?: string | null;
  logoUrl?: string | null;
  email?: string | null;
  phone?: string | null;
  primaryColor?: string | null;
}

export interface InvoiceForEmail {
  id: string;
  businessId: string;
  contactId?: string | null;
  invoiceNumber: string;
  status: string;
  total: number | string;
  subtotal?: number | string | null;
  taxRate?: number | string | null;
  taxAmount?: number | string | null;
  discountType?: string | null;
  discountValue?: number | string | null;
  discountAmount?: number | string | null;
  currency: string;
  notes?: string | null;
  issueDate?: Date | string | null;
  dueDate?: Date | string | null;
  createdAt?: Date | string | null;
  contact?: InvoiceEmailContactSlim | null;
  business?: InvoiceEmailBusinessSlim | null;
  items?: InvoiceEmailItemSlim[];
  payments?: InvoiceEmailPaymentSlim[];
}

export function sumSuccessfulPayments(payments: InvoiceEmailPaymentSlim[] | null | undefined): number {
  if (!payments) return 0;
  return payments
    .filter((p) => p.status === 'SUCCESSFUL')
    .reduce((sum, p) => sum + Number(p.amount), 0);
}
