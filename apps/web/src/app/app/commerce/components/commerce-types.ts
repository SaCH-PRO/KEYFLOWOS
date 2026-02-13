export type Tab = "products" | "quotes" | "invoices";

export type ProductForm = {
  name: string;
  description: string;
  price: string;
  category: "SERVICE" | "PRODUCT" | "PACKAGE";
  duration: string;
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
