export type TemplateId = "classic" | "modern" | "minimal";

export interface InvoiceTemplateData {
  type: "invoice" | "quote";
  number: string;
  status: string;
  issueDate: string | null;
  dueDate: string | null;
  expiryDate?: string | null;
  contact: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  items: Array<{
    id?: string;
    description?: string | null;
    quantity?: number;
    unitPrice?: number;
    total?: number;
  }>;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  discountType?: string | null;
  discountValue?: number | null;
  discountAmount: number;
  total: number;
  currency: string;
  notes?: string | null;
  business: {
    name: string;
    logoUrl: string | null;
    address?: string | null;
    city?: string | null;
    country?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    tagline?: string | null;
    primaryColor: string;
    secondaryColor: string;
  };
}

export const TEMPLATE_META: Record<TemplateId, { name: string; description: string }> = {
  classic: {
    name: "Classic",
    description: "Clean, traditional layout with structured header and clear line items",
  },
  modern: {
    name: "Modern",
    description: "Bold brand header with accent color blocks and contemporary typography",
  },
  minimal: {
    name: "Minimal",
    description: "Elegant, understated design with fine accent lines and ample whitespace",
  },
};
