export type Tab = "products" | "quotes" | "invoices" | "recurring";

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

export const CATEGORIES = [
  { value: "SERVICE", label: "Service" },
  { value: "PRODUCT", label: "Product" },
  { value: "PACKAGE", label: "Package" },
] as const;

export const INVOICE_STATUS_FILTERS = [
  { value: "ALL", label: "All Invoices" },
  { value: "DRAFT", label: "Draft" },
  { value: "SENT", label: "Sent" },
  { value: "PAID", label: "Paid" },
  { value: "OVERDUE", label: "Overdue" },
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

export function getStatusBadge(status: string) {
  const styles: Record<string, string> = {
    DRAFT: "bg-slate-500/20 text-slate-300 border-slate-500/40",
    SENT: "bg-blue-500/20 text-blue-300 border-blue-500/40",
    PAID: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    OVERDUE: "bg-red-500/20 text-red-300 border-red-500/40",
    VOID: "bg-slate-600/20 text-slate-400 border-slate-600/40",
    ACCEPTED: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    REJECTED: "bg-red-500/20 text-red-300 border-red-500/40",
  };
  return styles[status] ?? styles.DRAFT;
}
