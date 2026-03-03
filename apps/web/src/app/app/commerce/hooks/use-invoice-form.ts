"use client";

import { useCallback, useState } from "react";
import { InvoiceFormState, generateItemId } from "../components/commerce-types";

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

  return {
    showInvoiceBuilder,
    setShowInvoiceBuilder,
    editingInvoiceId,
    setEditingInvoiceId,
    invoiceForm,
    setInvoiceForm,
    resetInvoiceForm,
    handleNewInvoice,
  };
}
