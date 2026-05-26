"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BillingFormModal } from "../../commerce/components/billing-form-modal";
import { useQuoteForm } from "../../commerce/hooks/use-quote-form";
import { useInvoiceForm } from "../../commerce/hooks/use-invoice-form";
import { useLineItemHandlers } from "../../commerce/hooks/use-line-item-handlers";
import {
  createQuote,
  updateQuote,
  createInvoice,
  updateInvoice,
  createProduct,
  type Contact,
  type Product,
  type Quote,
  type Invoice,
} from "@/lib/client";

interface RevenueComposerProps {
  businessId: string | null;
  contacts: Contact[];
  products: Product[];
  currency?: string;
  setQuotes: React.Dispatch<React.SetStateAction<Quote[]>>;
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  triggerNewQuote?: number;
  triggerNewInvoice?: number;
}

export function RevenueComposer({
  businessId,
  contacts,
  products,
  currency = "TTD",
  setQuotes,
  setInvoices,
  setProducts,
  triggerNewQuote = 0,
  triggerNewInvoice = 0,
}: RevenueComposerProps) {
  /* ─── Quote form ─── */
  const {
    showQuoteBuilder,
    setShowQuoteBuilder,
    editingQuoteId,
    setEditingQuoteId,
    quoteForm,
    setQuoteForm,
    resetQuoteForm,
    handleNewQuote,
  } = useQuoteForm();

  const quoteItems = quoteForm.items;
  const setQuoteItems = useCallback(
    (updater: (prev: typeof quoteItems) => typeof quoteItems) => {
      setQuoteForm((f) => ({ ...f, items: updater(f.items) }));
    },
    [setQuoteForm],
  );

  const {
    addItem: addQuoteItem,
    removeItem: removeQuoteItem,
    updateItem: updateQuoteItem,
    selectProduct: selectProductForQuoteItem,
  } = useLineItemHandlers(setQuoteItems, products);

  /* ─── Invoice form ─── */
  const {
    showInvoiceBuilder,
    setShowInvoiceBuilder,
    editingInvoiceId,
    setEditingInvoiceId,
    invoiceForm,
    setInvoiceForm,
    resetInvoiceForm,
    handleNewInvoice,
  } = useInvoiceForm();

  const invoiceItems = invoiceForm.items;
  const setInvoiceItems = useCallback(
    (updater: (prev: typeof invoiceItems) => typeof invoiceItems) => {
      setInvoiceForm((f) => ({ ...f, items: updater(f.items) }));
    },
    [setInvoiceForm],
  );

  const {
    addItem: addInvoiceItem,
    removeItem: removeInvoiceItem,
    updateItem: updateInvoiceItem,
    selectProduct: selectProductForInvoiceItem,
  } = useLineItemHandlers(setInvoiceItems, products);

  /* ─── Trigger new from props ─── */
  const quoteTriggerRef = useRef(triggerNewQuote);
  useEffect(() => {
    if (triggerNewQuote !== quoteTriggerRef.current) {
      quoteTriggerRef.current = triggerNewQuote;
      handleNewQuote();
    }
  }, [triggerNewQuote, handleNewQuote]);

  const invoiceTriggerRef = useRef(triggerNewInvoice);
  useEffect(() => {
    if (triggerNewInvoice !== invoiceTriggerRef.current) {
      invoiceTriggerRef.current = triggerNewInvoice;
      // handleNewInvoice toggles, so ensure it opens
      setShowInvoiceBuilder(true);
      resetInvoiceForm();
    }
  }, [triggerNewInvoice, setShowInvoiceBuilder, resetInvoiceForm]);

  /* ─── Save handlers ─── */
  const [savingQuote, setSavingQuote] = useState(false);
  const [savingInvoice, setSavingInvoice] = useState(false);

  const handleSaveQuote = useCallback(async () => {
    if (!businessId || !quoteForm.contactId) return;
    setSavingQuote(true);
    try {
      // Create new products if needed
      for (const item of quoteForm.items) {
        if (item.isNewItem && item.addToCatalog && item.newItemName) {
          const newProduct = await createProduct({
            businessId,
            name: item.newItemName,
            description: item.description,
            category: item.newItemCategory || "SERVICE",
            price: parseFloat(item.unitPrice) || 0,
          });
          if (newProduct.data) setProducts((prev) => [...prev, newProduct.data!]);
        }
      }

      const items = quoteForm.items
        .filter((item) => item.description && parseFloat(item.unitPrice) > 0)
        .map((item) => ({
          description: item.isNewItem && item.newItemName ? item.newItemName : item.description,
          quantity: parseInt(item.quantity) || 1,
          unitPrice: parseFloat(item.unitPrice),
          productId: item.productId && item.productId !== "__NEW__" ? item.productId : undefined,
        }));
      if (items.length === 0) {
        toast.error("Add at least one line item");
        return;
      }

      if (editingQuoteId) {
        const res = await updateQuote({
          businessId,
          quoteId: editingQuoteId,
          contactId: quoteForm.contactId,
          items,
          expiryDate: quoteForm.expiryDate || null,
          taxRate: parseFloat(quoteForm.taxRate) || 0,
          discountType: quoteForm.discountType,
          discountValue: parseFloat(quoteForm.discountValue) || 0,
          notes: quoteForm.notes || undefined,
        });
        if (res.data) {
          setQuotes((q) => q.map((quote) => (quote.id === editingQuoteId ? res.data! : quote)));
          toast.success("Quote updated");
          setShowQuoteBuilder(false);
          resetQuoteForm();
        } else {
          toast.error(res.error ?? "Failed to update quote");
        }
      } else {
        const res = await createQuote({
          businessId,
          contactId: quoteForm.contactId,
          items,
          currency,
          expiryDate: quoteForm.expiryDate || undefined,
          taxRate: parseFloat(quoteForm.taxRate) || 0,
          discountType: quoteForm.discountType,
          discountValue: parseFloat(quoteForm.discountValue) || 0,
          notes: quoteForm.notes || undefined,
        });
        if (res.data) {
          setQuotes((q) => [res.data!, ...q]);
          toast.success("Quote created");
          setShowQuoteBuilder(false);
          resetQuoteForm();
        } else {
          toast.error(res.error ?? "Failed to create quote");
        }
      }
    } finally {
      setSavingQuote(false);
    }
  }, [businessId, quoteForm, editingQuoteId, currency, setQuotes, setProducts, setShowQuoteBuilder, resetQuoteForm]);

  const handleSaveInvoice = useCallback(async () => {
    if (!businessId || !invoiceForm.contactId) return;
    setSavingInvoice(true);
    try {
      for (const item of invoiceForm.items) {
        if (item.isNewItem && item.addToCatalog && item.newItemName) {
          const newProduct = await createProduct({
            businessId,
            name: item.newItemName,
            description: item.description,
            category: item.newItemCategory || "SERVICE",
            price: parseFloat(item.unitPrice) || 0,
          });
          if (newProduct.data) setProducts((prev) => [...prev, newProduct.data!]);
        }
      }

      const items = invoiceForm.items
        .filter((item) => item.description && parseFloat(item.unitPrice) > 0)
        .map((item) => ({
          description: item.isNewItem && item.newItemName ? item.newItemName : item.description,
          quantity: parseInt(item.quantity) || 1,
          unitPrice: parseFloat(item.unitPrice),
          productId: item.productId && item.productId !== "__NEW__" ? item.productId : undefined,
        }));
      if (items.length === 0) {
        toast.error("Add at least one line item");
        return;
      }

      if (editingInvoiceId) {
        const res = await updateInvoice({
          businessId,
          invoiceId: editingInvoiceId,
          contactId: invoiceForm.contactId,
          items,
          currency,
          dueDate: invoiceForm.dueDate || null,
          taxRate: parseFloat(invoiceForm.taxRate) || 0,
          discountType: invoiceForm.discountType,
          discountValue: parseFloat(invoiceForm.discountValue) || 0,
          notes: invoiceForm.notes || null,
        });
        if (res.data) {
          setInvoices((prev) => prev.map((inv) => (inv.id === editingInvoiceId ? res.data! : inv)));
          toast.success("Invoice updated");
          setShowInvoiceBuilder(false);
          resetInvoiceForm();
        } else {
          toast.error(res.error ?? "Failed to update invoice");
        }
      } else {
        const res = await createInvoice({
          businessId,
          contactId: invoiceForm.contactId,
          items,
          currency,
          dueDate: invoiceForm.dueDate || undefined,
          taxRate: parseFloat(invoiceForm.taxRate) || 0,
          discountType: invoiceForm.discountType,
          discountValue: parseFloat(invoiceForm.discountValue) || 0,
          notes: invoiceForm.notes || undefined,
        });
        if (res.data) {
          setInvoices((prev) => [res.data!, ...prev]);
          toast.success("Invoice created");
          setShowInvoiceBuilder(false);
          resetInvoiceForm();
        } else {
          toast.error(res.error ?? "Failed to create invoice");
        }
      }
    } finally {
      setSavingInvoice(false);
    }
  }, [businessId, invoiceForm, editingInvoiceId, currency, setInvoices, setProducts, setShowInvoiceBuilder, resetInvoiceForm]);

  return (
    <>
      <BillingFormModal
        open={showQuoteBuilder}
        onClose={() => { setShowQuoteBuilder(false); resetQuoteForm(); }}
        onSubmit={handleSaveQuote}
        docType="quote"
        isEditing={!!editingQuoteId}
        saving={savingQuote}
        contacts={contacts}
        products={products}
        currency={currency}
        contactId={quoteForm.contactId}
        onContactChange={(id) => setQuoteForm((f) => ({ ...f, contactId: id }))}
        dateValue={quoteForm.expiryDate}
        onDateChange={(v) => setQuoteForm((f) => ({ ...f, expiryDate: v }))}
        items={quoteForm.items}
        onAddItem={addQuoteItem}
        onRemoveItem={removeQuoteItem}
        onUpdateItem={updateQuoteItem}
        onSelectProduct={selectProductForQuoteItem}
        taxRate={quoteForm.taxRate}
        onTaxRateChange={(v) => setQuoteForm((f) => ({ ...f, taxRate: v }))}
        discountType={quoteForm.discountType}
        onDiscountTypeChange={(v) => setQuoteForm((f) => ({ ...f, discountType: v }))}
        discountValue={quoteForm.discountValue}
        onDiscountValueChange={(v) => setQuoteForm((f) => ({ ...f, discountValue: v }))}
        notes={quoteForm.notes}
        onNotesChange={(v) => setQuoteForm((f) => ({ ...f, notes: v }))}
      />

      <BillingFormModal
        open={showInvoiceBuilder}
        onClose={() => { setShowInvoiceBuilder(false); resetInvoiceForm(); }}
        onSubmit={handleSaveInvoice}
        docType="invoice"
        isEditing={!!editingInvoiceId}
        saving={savingInvoice}
        contacts={contacts}
        products={products}
        currency={currency}
        contactId={invoiceForm.contactId}
        onContactChange={(id) => setInvoiceForm((f) => ({ ...f, contactId: id }))}
        dateValue={invoiceForm.dueDate}
        onDateChange={(v) => setInvoiceForm((f) => ({ ...f, dueDate: v }))}
        items={invoiceForm.items}
        onAddItem={addInvoiceItem}
        onRemoveItem={removeInvoiceItem}
        onUpdateItem={updateInvoiceItem}
        onSelectProduct={selectProductForInvoiceItem}
        taxRate={invoiceForm.taxRate}
        onTaxRateChange={(v) => setInvoiceForm((f) => ({ ...f, taxRate: v }))}
        discountType={invoiceForm.discountType}
        onDiscountTypeChange={(v) => setInvoiceForm((f) => ({ ...f, discountType: v }))}
        discountValue={invoiceForm.discountValue}
        onDiscountValueChange={(v) => setInvoiceForm((f) => ({ ...f, discountValue: v }))}
        notes={invoiceForm.notes}
        onNotesChange={(v) => setInvoiceForm((f) => ({ ...f, notes: v }))}
      />
    </>
  );
}
