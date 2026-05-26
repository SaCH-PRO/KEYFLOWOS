/**
 * Unified financial types.
 * All money-moving records in the system flow through these types.
 */

export type FinancialRecordType = "quote" | "invoice" | "payment" | "recurring";

export type PipelineStage =
  | "draft"
  | "sent"
  | "viewed"
  | "action_needed"
  | "accepted"
  | "paid"
  | "lost";

export interface FinancialContact {
  id?: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface FinancialLineItem {
  id: string;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
  productId?: string | null;
}

export interface FinancialRecord {
  id: string;
  type: FinancialRecordType;
  number: string;
  status: string;
  contact: FinancialContact | null;
  total: number;
  currency: string;
  items: FinancialLineItem[];
  issueDate: string;
  dueDate?: string | null;
  paidAt?: string | null;
  taxRate?: number | null;
  discountType?: "PERCENT" | "FIXED" | null;
  discountValue?: number | null;
  notes?: string | null;
  /** For quotes: the invoice ID if converted */
  convertedToInvoiceId?: string | null;
  /** For invoices: payment records */
  payments?: Array<{ amount: number; createdAt: string }>;
  /** Raw source object for type-specific operations */
  _source: unknown;
}

export interface CashPosition {
  /** Cash on hand (collected - expenses) */
  cashOnHand: number;
  /** Outstanding invoices total */
  outstanding: number;
  /** Overdue amount */
  overdue: number;
  /** Projected revenue (quotes accepted but not yet invoiced) */
  pipeline: number;
  /** Monthly burn rate */
  burnRate: number;
  /** Months of runway */
  runwayMonths: number;
  currency: string;
}

export interface PipelineMetrics {
  totalRecords: number;
  totalValue: number;
  draftCount: number;
  draftValue: number;
  sentCount: number;
  sentValue: number;
  actionCount: number;
  actionValue: number;
  wonCount: number;
  wonValue: number;
  lostCount: number;
  lostValue: number;
}
