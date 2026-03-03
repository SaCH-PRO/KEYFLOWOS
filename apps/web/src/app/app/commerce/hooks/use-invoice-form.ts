"use client";

import { useCallback, useState } from "react";
import { InvoiceFormState, InvoiceLineItem, generateItemId } from "../components/commerce-types";

export interface InvoicePrefill {
  contactId?: string;
  items?: InvoiceLineItem[];
  notes?: string;
  dueDate?: string;
}

export function useInvoiceForm() {
  const [showInvoiceBuilder, setShowInvoiceBuilder] = useState(false);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [invoiceForm, setInvoiceForm] = useState<InvoiceFormState>({
    contactId: "",
    dueDate: "",
    items: [{ id: generateItemId(), productId: "", description: "", quantity: "1", unitPrice: "" }],
    taxRate: "12.5",
    discountType: "PERCENT",
    discountValue: "",
    notes: "",
  });

  const resetInvoiceForm = useCallback(() => {
    setEditingInvoiceId(null);
    setInvoiceForm({
      contactId: "",
      dueDate: "",
      items: [{ id: generateItemId(), productId: "", description: "", quantity: "1", unitPrice: "" }],
      taxRate: "12.5",
      discountType: "PERCENT",
      discountValue: "",
      notes: "",
    });
  }, []);

  const handleNewInvoice = useCallback(() => {
    setShowInvoiceBuilder((prev) => !prev);
  }, []);

  const prefillInvoice = useCallback((data: InvoicePrefill) => {
    setEditingInvoiceId(null);
    setInvoiceForm({
      contactId: data.contactId ?? "",
      dueDate: data.dueDate ?? "",
      items: data.items?.length
        ? data.items
        : [{ id: generateItemId(), productId: "", description: "", quantity: "1", unitPrice: "" }],
      taxRate: "12.5",
      discountType: "PERCENT",
      discountValue: "",
      notes: data.notes ?? "",
    });
    setShowInvoiceBuilder(true);
  }, []);

  return {
    showInvoiceBuilder,
    setShowInvoiceBuilder,
    editingInvoiceId,
    setEditingInvoiceId,
    invoiceForm,
    setInvoiceForm,
    resetInvoiceForm,
    handleNewInvoice,
    prefillInvoice,
  };
}
