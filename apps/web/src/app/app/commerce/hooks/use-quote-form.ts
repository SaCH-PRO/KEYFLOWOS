"use client";

import { useCallback, useState } from "react";
import { InvoiceLineItem, QuoteFormState, generateItemId } from "../components/commerce-types";

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

  return {
    showQuoteBuilder,
    setShowQuoteBuilder,
    editingQuoteId,
    setEditingQuoteId,
    quoteForm,
    setQuoteForm,
    resetQuoteForm,
    handleNewQuote,
  };
}
