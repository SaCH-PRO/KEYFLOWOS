export type Tab = "invoices" | "quotes" | "payments" | "recurring";

export type ProductForm = {
  name: string;
  description: string;
  price: string;
  category: "SERVICE" | "PRODUCT" | "PACKAGE";
  duration: string;
  imageUrl: string;
  sku: string;
  isActive: boolean;
};

export type InvoiceLineItem = {
  id: string;
  productId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  isNewItem?: boolean;
  newItemName?: string;
  newItemCategory?: "SERVICE" | "PRODUCT" | "PACKAGE";
  addToCatalog?: boolean;
};

export type QuoteFormState = {
  contactId: string;
  expiryDate: string;
  items: InvoiceLineItem[];
  taxRate: string;
  discountType: "PERCENT" | "FIXED";
  discountValue: string;
  notes: string;
};

export type InvoiceFormState = {
  contactId: string;
  dueDate: string;
  items: InvoiceLineItem[];
  taxRate: string;
  discountType: "PERCENT" | "FIXED";
  discountValue: string;
  notes: string;
};

export const CATEGORIES = [
  { value: "SERVICE", label: "Service" },
  { value: "PRODUCT", label: "Product" },
  { value: "PACKAGE", label: "Package" },
] as const;

export const PRODUCT_CATEGORY_CONFIG = {
  SERVICE: {
    label: "Service",
    badge: "bg-teal-500/15 text-teal-400 border-teal-500/30",
    accent: "from-teal-500/25 via-teal-600/10 to-card",
    color: "text-teal-400",
    bgGradient: "from-teal-500/30 via-teal-600/10 to-transparent",
  },
  PRODUCT: {
    label: "Product",
    badge: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    accent: "from-blue-500/25 via-blue-600/10 to-card",
    color: "text-blue-400",
    bgGradient: "from-blue-500/30 via-blue-600/10 to-transparent",
  },
  PACKAGE: {
    label: "Package",
    badge: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    accent: "from-purple-500/25 via-purple-600/10 to-card",
    color: "text-purple-400",
    bgGradient: "from-purple-500/30 via-purple-600/10 to-transparent",
  },
} as const;

export type ProductCategory = keyof typeof PRODUCT_CATEGORY_CONFIG;

export const INVOICE_STATUS_FILTERS = [
  { value: "ALL", label: "All Invoices" },
  { value: "DRAFT", label: "Draft" },
  { value: "SENT", label: "Sent" },
  { value: "PAID", label: "Paid" },
  { value: "PARTIALLY_PAID", label: "Partial" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "VOID", label: "Void" },
] as const;

export const QUOTE_STATUS_FILTERS = [
  { value: "ALL", label: "All Quotes" },
  { value: "DRAFT", label: "Draft" },
  { value: "SENT", label: "Sent" },
  { value: "ACCEPTED", label: "Accepted" },
  { value: "REJECTED", label: "Rejected" },
] as const;

export function generateItemId() {
  return `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export const PAYMENT_TERMS = [
  { value: "DUE_ON_RECEIPT", label: "Due on Receipt" },
  { value: "NET_7", label: "Net 7 (7 days)" },
  { value: "NET_15", label: "Net 15 (15 days)" },
  { value: "NET_30", label: "Net 30 (30 days)" },
  { value: "NET_60", label: "Net 60 (60 days)" },
  { value: "NET_90", label: "Net 90 (90 days)" },
] as const;

export function getDueDateFromTerms(termKey: string): string {
  const now = new Date();
  const daysMap: Record<string, number> = {
    DUE_ON_RECEIPT: 0,
    NET_7: 7,
    NET_15: 15,
    NET_30: 30,
    NET_60: 60,
    NET_90: 90,
  };
  const days = daysMap[termKey] ?? 30;
  now.setDate(now.getDate() + days);
  return now.toISOString().split("T")[0];
}

export const BILLING_SORT_OPTIONS = [
  { value: "date-desc", label: "Newest first" },
  { value: "date-asc", label: "Oldest first" },
  { value: "amount-desc", label: "Highest amount" },
  { value: "amount-asc", label: "Lowest amount" },
  { value: "name-asc", label: "Client A–Z" },
] as const;

export type BillingSortKey = (typeof BILLING_SORT_OPTIONS)[number]["value"];

export type BillingDocType = "quote" | "invoice";

export const BILLING_DOC_THEME = {
  quote: {
    label: "Quote",
    avatarBg: "rgba(139,92,246,0.12)",
    avatarText: "text-violet-300",
    accentColor: "rgb(139,92,246)",
    headerGradient: "from-violet-500/10 via-transparent to-transparent",
  },
  invoice: {
    label: "Invoice",
    avatarBg: "rgba(6,182,212,0.12)",
    avatarText: "text-cyan-300",
    accentColor: "rgb(6,182,212)",
    headerGradient: "from-cyan-500/10 via-transparent to-transparent",
  },
} as const;

export function getStatusBadge(status: string) {
  const styles: Record<string, string> = {
    DRAFT: "bg-slate-500/20 text-slate-300 border-slate-500/40",
    SENT: "bg-blue-500/20 text-blue-300 border-blue-500/40",
    PAID: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    PARTIALLY_PAID: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    OVERDUE: "bg-red-500/20 text-red-300 border-red-500/40",
    VOID: "bg-slate-600/20 text-slate-400 border-slate-600/40",
    ACCEPTED: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    REJECTED: "bg-red-500/20 text-red-300 border-red-500/40",
  };
  return styles[status] ?? styles.DRAFT;
}
