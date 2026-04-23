"use client";

import { useCallback, useState } from "react";
import { InvoiceLineItem, QuoteFormState, generateItemId } from "../components/commerce-types";

export interface QuotePrefill {
  contactId?: string;
  items?: InvoiceLineItem[];
  notes?: string;
  expiryDate?: string;
}

export function useQuoteForm() {
  const [showQuoteBuilder, setShowQuoteBuilder] = useState(false);
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [quoteForm, setQuoteForm] = useState<QuoteFormState>({
    contactId: "",
    expiryDate: "",
    items: [{ id: generateItemId(), productId: "", description: "", quantity: "1", unitPrice: "" }],
    taxRate: "12.5",
    discountType: "PERCENT",
    discountValue: "",
    notes: "",
  });

  const resetQuoteForm = useCallback(() => {
    setQuoteForm({
      contactId: "",
      expiryDate: "",
      items: [{ id: generateItemId(), productId: "", description: "", quantity: "1", unitPrice: "" }],
      taxRate: "12.5",
      discountType: "PERCENT",
      discountValue: "",
      notes: "",
    });
    setEditingQuoteId(null);
  }, []);

  const handleNewQuote = useCallback(() => {
    setEditingQuoteId(null);
    resetQuoteForm();
    setShowQuoteBuilder(true);
  }, [resetQuoteForm]);

  const prefillQuote = useCallback((data: QuotePrefill) => {
    setEditingQuoteId(null);
    setQuoteForm({
      contactId: data.contactId ?? "",
      expiryDate: data.expiryDate ?? "",
      items: data.items?.length
        ? data.items
        : [{ id: generateItemId(), productId: "", description: "", quantity: "1", unitPrice: "" }],
      taxRate: "12.5",
      discountType: "PERCENT",
      discountValue: "",
      notes: data.notes ?? "",
    });
    setShowQuoteBuilder(true);
  }, []);

  return {
    showQuoteBuilder,
    setShowQuoteBuilder,
    editingQuoteId,
    setEditingQuoteId,
    quoteForm,
    setQuoteForm,
    resetQuoteForm,
    handleNewQuote,
    prefillQuote,
  };
}
