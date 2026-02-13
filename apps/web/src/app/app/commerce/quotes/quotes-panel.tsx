"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button, Input } from "@keyflow/ui";
import {
  Search,
  Filter,
  FileText,
  Eye,
  Pencil,
  Send,
  CheckCircle,
  X,
  Trash2,
  Mail,
  ToggleLeft,
  ToggleRight,
  Plus,
  Minus,
} from "lucide-react";
import {
  createProduct,
  createQuote,
  updateQuote,
  updateQuoteStatus,
  deleteQuote,
  convertQuoteToInvoice,
  getGmailAuthUrl,
  sendQuoteEmail,
  disconnectGmail,
  Product,
  Quote,
  Contact,
  Invoice,
} from "@/lib/client";
import {
  QUOTE_STATUS_FILTERS,
  InvoiceLineItem,
  CATEGORIES,
  getStatusBadge,
  generateItemId,
} from "../components/commerce-types";

interface QuotesPanelProps {
  quotes: Quote[];
  contacts: Contact[];
  products: Product[];
  businessId: string | null;
  loading: boolean;
  gmailStatus: { connected: boolean; email: string | null } | null;
  showQuoteBuilder: boolean;
  setShowQuoteBuilder: (show: boolean) => void;
  editingQuoteId: string | null;
  setEditingQuoteId: (id: string | null) => void;
  quoteForm: any;
  setQuoteForm: (fn: any) => void;
  resetQuoteForm: () => void;
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  setQuotes: React.Dispatch<React.SetStateAction<Quote[]>>;
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
  setTab: (tab: "products" | "quotes" | "invoices") => void;
}

export default function QuotesPanel({
  quotes,
  contacts,
  products,
  businessId,
  loading,
  gmailStatus,
  showQuoteBuilder,
  setShowQuoteBuilder,
  editingQuoteId,
  setEditingQuoteId,
  quoteForm,
  setQuoteForm,
  resetQuoteForm,
  setProducts,
  setQuotes,
  setInvoices,
  setTab,
}: QuotesPanelProps) {
  const [quoteSearch, setQuoteSearch] = useState("");
  const [quoteStatusFilter, setQuoteStatusFilter] = useState<string>("ALL");
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [showAcceptPrompt, setShowAcceptPrompt] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailForm, setEmailForm] = useState({ email: "", message: "" });
  const [sendingEmail, setSendingEmail] = useState(false);
  const [loadingGmail, setLoadingGmail] = useState(false);
  const [convertForm, setConvertForm] = useState({
    taxRate: "12.5",
    discountType: "PERCENT" as "PERCENT" | "FIXED",
    discountValue: "",
    notes: "",
    dueDate: "",
  });
  const [autoConvertToInvoice, setAutoConvertToInvoice] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("kf_auto_convert_quote") === "true";
    }
    return false;
  });

  function addQuoteItem() {
    setQuoteForm((f: any) => ({
      ...f,
      items: [...f.items, { id: generateItemId(), productId: "", description: "", quantity: "1", unitPrice: "" }],
    }));
  }

  function removeQuoteItem(itemId: string) {
    setQuoteForm((f: any) => ({
      ...f,
      items: f.items.filter((item: InvoiceLineItem) => item.id !== itemId),
    }));
  }

  function updateQuoteItem(itemId: string, field: keyof InvoiceLineItem, value: string | boolean) {
    setQuoteForm((f: any) => ({
      ...f,
      items: f.items.map((item: InvoiceLineItem) =>
        item.id === itemId ? { ...item, [field]: value } : item
      ),
    }));
  }

  function selectProductForQuoteItem(itemId: string, productId: string) {
    if (productId === "__NEW__") {
      setQuoteForm((f: any) => ({
        ...f,
        items: f.items.map((item: InvoiceLineItem) =>
          item.id === itemId
            ? {
                ...item,
                productId: "__NEW__",
                isNewItem: true,
                newItemName: "",
                newItemCategory: "SERVICE",
                description: "",
                unitPrice: "",
                addToCatalog: false,
              }
            : item
        ),
      }));
      return;
    }
    const product = products.find((p) => p.id === productId);
    if (product) {
      setQuoteForm((f: any) => ({
        ...f,
        items: f.items.map((item: InvoiceLineItem) =>
          item.id === itemId
            ? {
                ...item,
                productId,
                description: product.name,
                unitPrice: String(product.price),
                isNewItem: false,
                addToCatalog: false,
              }
            : item
        ),
      }));
    } else {
      setQuoteForm((f: any) => ({
        ...f,
        items: f.items.map((item: InvoiceLineItem) =>
          item.id === itemId
            ? {
                ...item,
                productId: "",
                isNewItem: false,
                addToCatalog: false,
              }
            : item
        ),
      }));
    }
  }

  const filteredQuotes = useMemo(() => {
    return quotes
      .filter((q) => quoteStatusFilter === "ALL" || q.status === quoteStatusFilter)
      .filter(
        (q) =>
          !quoteSearch ||
          q.quoteNumber.toLowerCase().includes(quoteSearch.toLowerCase()) ||
          q.contact?.firstName?.toLowerCase().includes(quoteSearch.toLowerCase()) ||
          q.contact?.lastName?.toLowerCase().includes(quoteSearch.toLowerCase())
      );
  }, [quotes, quoteStatusFilter, quoteSearch]);

  async function handleSaveQuote() {
    if (!businessId || !quoteForm.contactId) return;

    for (const item of quoteForm.items) {
      if (item.isNewItem && item.addToCatalog && item.newItemName) {
        const newProduct = await createProduct({
          businessId,
          name: item.newItemName,
          description: item.description,
          category: item.newItemCategory || "SERVICE",
          price: parseFloat(item.unitPrice) || 0,
        });
        if (newProduct.data) {
          setProducts((prev) => [...prev, newProduct.data!]);
        }
      }
    }

    const items = quoteForm.items
      .filter((item: InvoiceLineItem) => item.description && parseFloat(item.unitPrice) > 0)
      .map((item: InvoiceLineItem) => ({
        description: item.isNewItem && item.newItemName ? item.newItemName : item.description,
        quantity: parseInt(item.quantity) || 1,
        unitPrice: parseFloat(item.unitPrice),
        productId: item.productId && item.productId !== "__NEW__" ? item.productId : undefined,
      }));
    if (items.length === 0) return;

    if (editingQuoteId) {
      const res = await updateQuote({
        businessId,
        quoteId: editingQuoteId,
        contactId: quoteForm.contactId,
        items,
        expiryDate: quoteForm.expiryDate || undefined,
        taxRate: parseFloat(quoteForm.taxRate) || 0,
        discountType: quoteForm.discountType,
        discountValue: parseFloat(quoteForm.discountValue) || 0,
        notes: quoteForm.notes || undefined,
      });
      if (res.data) {
        setQuotes((q) => q.map((quote) => (quote.id === editingQuoteId ? res.data! : quote)));
      }
    } else {
      const res = await createQuote({
        businessId,
        contactId: quoteForm.contactId,
        items,
        expiryDate: quoteForm.expiryDate || undefined,
        taxRate: parseFloat(quoteForm.taxRate) || 0,
        discountType: quoteForm.discountType,
        discountValue: parseFloat(quoteForm.discountValue) || 0,
        notes: quoteForm.notes || undefined,
      });
      if (res.data) {
        setQuotes((q) => [res.data!, ...q]);
      }
    }
    setShowQuoteBuilder(false);
    resetQuoteForm();
  }

  function openEditQuote(quote: Quote) {
    setEditingQuoteId(quote.id);
    setQuoteForm({
      contactId: quote.contactId,
      expiryDate: quote.expiryDate ? quote.expiryDate.split("T")[0] : "",
      items: (quote.items ?? []).map((item: any) => ({
        id: item.id,
        productId: item.productId ?? "",
        description: item.description,
        quantity: String(item.quantity),
        unitPrice: String(item.unitPrice),
      })),
      taxRate: String(quote.taxRate ?? 0),
      discountType: (quote.discountType as "PERCENT" | "FIXED") || "PERCENT",
      discountValue: quote.discountValue ? String(quote.discountValue) : "",
      notes: quote.notes || "",
    });
    setShowQuoteBuilder(true);
  }

  async function handleAcceptQuote(quote: Quote) {
    try {
      const res = await updateQuoteStatus(quote.id, "ACCEPTED");
      if (res.data) {
        setQuotes((q) => q.map((qItem) => (qItem.id === quote.id ? res.data! : qItem)));
        setSelectedQuote(res.data);
        if (autoConvertToInvoice) {
          setConvertForm({
            taxRate: String(res.data.taxRate ?? 12.5),
            discountType: (res.data.discountType as "PERCENT" | "FIXED") ?? "PERCENT",
            discountValue: res.data.discountValue ? String(res.data.discountValue) : "",
            notes: res.data.notes ?? "",
            dueDate: "",
          });
          setShowConvertModal(true);
        } else {
          setShowAcceptPrompt(true);
        }
      } else if (res.error) {
        alert("Failed to accept quote: " + res.error);
      }
    } catch (err) {
      alert("Failed to accept quote");
    }
  }

  async function handleRejectQuote(quote: Quote) {
    const res = await updateQuoteStatus(quote.id, "REJECTED");
    if (res.data) {
      setQuotes((q) => q.map((qItem) => (qItem.id === quote.id ? res.data! : qItem)));
    }
  }

  async function handleMarkSent(quote: Quote) {
    const res = await updateQuoteStatus(quote.id, "SENT");
    if (res.data) {
      setQuotes((q) => q.map((qItem) => (qItem.id === quote.id ? res.data! : qItem)));
    }
  }

  async function handleDeleteQuote(quote: Quote) {
    if (!businessId) return;
    if (confirm("Are you sure you want to delete this quote?")) {
      await deleteQuote(businessId, quote.id);
      setQuotes((q) => q.filter((qItem) => qItem.id !== quote.id));
    }
  }

  async function handleConvert() {
    if (!businessId || !selectedQuote) return;
    const res = await convertQuoteToInvoice({
      businessId,
      quoteId: selectedQuote.id,
      taxRate: parseFloat(convertForm.taxRate) || 0,
      discountType: convertForm.discountValue ? convertForm.discountType : undefined,
      discountValue: parseFloat(convertForm.discountValue) || undefined,
      notes: convertForm.notes || undefined,
      dueDate: convertForm.dueDate || undefined,
    });
    if (res.data) {
      setInvoices((inv) => [res.data!, ...inv]);
      setQuotes((q) =>
        q.map((qItem) => (qItem.id === selectedQuote.id ? { ...qItem, invoiceId: res.data!.id } : qItem))
      );
      setShowConvertModal(false);
      setSelectedQuote(null);
      setConvertForm({ taxRate: "12.5", discountType: "PERCENT", discountValue: "", notes: "", dueDate: "" });
      setTab("invoices");
    }
  }

  async function handleSendEmail() {
    if (!selectedQuote) return;
    const targetEmail = emailForm.email || selectedQuote.contact?.email;
    if (!targetEmail) {
      alert("Please enter an email address");
      return;
    }
    setSendingEmail(true);
    try {
      const res = await sendQuoteEmail({
        businessId: businessId ?? undefined,
        quoteId: selectedQuote.id,
        recipientEmail: targetEmail,
        message: emailForm.message || undefined,
      });
      if (res.data?.success) {
        setQuotes((q) =>
          q.map((qItem) => (qItem.id === selectedQuote.id ? { ...qItem, status: "SENT" } : qItem))
        );
        setShowEmailModal(false);
        setEmailForm({ email: "", message: "" });
        alert(`Quote sent to ${targetEmail}!`);
      } else {
        alert(res.error || "Failed to send email");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to send email");
    } finally {
      setSendingEmail(false);
    }
  }

  const quoteTotals = useMemo(() => {
    const subtotal = quoteForm.items.reduce(
      (sum: number, item: InvoiceLineItem) =>
        sum + (parseFloat(item.quantity) || 0) * (parseFloat(item.unitPrice) || 0),
      0
    );
    const taxAmount = (subtotal * (parseFloat(quoteForm.taxRate) || 0)) / 100;
    const discountAmount =
      quoteForm.discountType === "PERCENT"
        ? (subtotal * (parseFloat(quoteForm.discountValue) || 0)) / 100
        : parseFloat(quoteForm.discountValue) || 0;
    const total = subtotal + taxAmount - discountAmount;
    return { subtotal, taxAmount, discountAmount, total };
  }, [quoteForm.items, quoteForm.taxRate, quoteForm.discountType, quoteForm.discountValue]);

  return (
    <motion.div
      key="quotes"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-4"
    >
      {showQuoteBuilder && (
        <div className="rounded-2xl border border-primary/30 bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" /> {editingQuoteId ? "Edit Quote" : "Create Quote"}
            </h3>
            <button
              onClick={() => {
                setShowQuoteBuilder(false);
                resetQuoteForm();
              }}
              className="p-1 rounded hover:bg-muted"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Contact *</label>
              <select
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={quoteForm.contactId}
                onChange={(e) => setQuoteForm((f: any) => ({ ...f, contactId: e.target.value }))}
              >
                <option value="">Select contact...</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName} {c.email ? `(${c.email})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <Input
              label="Expiry Date"
              type="date"
              value={quoteForm.expiryDate}
              onChange={(e) => setQuoteForm((f: any) => ({ ...f, expiryDate: e.target.value }))}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Line Items</label>
              <Button variant="outline" onClick={addQuoteItem} className="text-xs gap-1 px-2 py-1">
                <Plus className="w-3 h-3" /> Add Item
              </Button>
            </div>

            {quoteForm.items.map((item: InvoiceLineItem) => (
              <div key={item.id} className="p-3 rounded-xl bg-muted/30 border border-border/40 space-y-2">
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-12 md:col-span-3">
                    <label className="text-xs text-muted-foreground mb-1 block">Product/Service</label>
                    <select
                      className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      value={item.productId}
                      onChange={(e) => selectProductForQuoteItem(item.id, e.target.value)}
                    >
                      <option value="">Select item...</option>
                      <option value="__NEW__">
                        {item.isNewItem && item.newItemName ? `+ ${item.newItemName}` : "+ New item"}
                      </option>
                      {products
                        .filter((p) => p.isActive !== false)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} - {p.currency} {Number(p.price).toLocaleString()}
                          </option>
                        ))}
                    </select>
                  </div>
                  {item.isNewItem && (
                    <>
                      <div className="col-span-12 md:col-span-3">
                        <label className="text-xs text-muted-foreground mb-1 block">Item Name</label>
                        <input
                          className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                          placeholder="Enter name for new item"
                          value={item.newItemName || ""}
                          onChange={(e) => updateQuoteItem(item.id, "newItemName", e.target.value)}
                        />
                      </div>
                      <div className="col-span-6 md:col-span-2">
                        <label className="text-xs text-muted-foreground mb-1 block">Type</label>
                        <select
                          className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                          value={item.newItemCategory || "SERVICE"}
                          onChange={(e) => updateQuoteItem(item.id, "newItemCategory", e.target.value)}
                        >
                          {CATEGORIES.map((cat) => (
                            <option key={cat.value} value={cat.value}>
                              {cat.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}
                  <div className={`col-span-12 ${item.isNewItem ? "md:col-span-4" : "md:col-span-4"}`}>
                    <label className="text-xs text-muted-foreground mb-1 block">Description</label>
                    <input
                      className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      placeholder={item.isNewItem ? "New item name/description" : "Item description"}
                      value={item.description}
                      onChange={(e) => updateQuoteItem(item.id, "description", e.target.value)}
                    />
                  </div>
                  <div className="col-span-4 md:col-span-2">
                    <label className="text-xs text-muted-foreground mb-1 block">Qty</label>
                    <input
                      className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      placeholder="1"
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => updateQuoteItem(item.id, "quantity", e.target.value)}
                    />
                  </div>
                  <div className="col-span-6 md:col-span-2">
                    <label className="text-xs text-muted-foreground mb-1 block">Price (TTD)</label>
                    <input
                      className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      placeholder="0.00"
                      type="number"
                      step="0.01"
                      value={item.unitPrice}
                      onChange={(e) => updateQuoteItem(item.id, "unitPrice", e.target.value)}
                    />
                  </div>
                  <div className="col-span-2 md:col-span-1 flex justify-center">
                    {quoteForm.items.length > 1 && (
                      <button
                        onClick={() => removeQuoteItem(item.id)}
                        className="p-2 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
                        title="Remove item"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
                {item.isNewItem && (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={item.addToCatalog ?? false}
                      onChange={(e) => updateQuoteItem(item.id, "addToCatalog", e.target.checked)}
                      className="rounded border-border"
                    />
                    Add this item to my product catalog for future use
                  </label>
                )}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-border/40">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Tax Rate (%)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={quoteForm.taxRate}
                onChange={(e) => setQuoteForm((f: any) => ({ ...f, taxRate: e.target.value }))}
                placeholder="12.5"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Discount Type</label>
              <select
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={quoteForm.discountType}
                onChange={(e) =>
                  setQuoteForm((f: any) => ({ ...f, discountType: e.target.value as "PERCENT" | "FIXED" }))
                }
              >
                <option value="PERCENT">Percentage (%)</option>
                <option value="FIXED">Fixed Amount (TTD)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">
                Discount {quoteForm.discountType === "PERCENT" ? "(%)" : "(TTD)"}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={quoteForm.discountValue}
                onChange={(e) => setQuoteForm((f: any) => ({ ...f, discountValue: e.target.value }))}
                placeholder="0"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Notes (optional)</label>
            <textarea
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[60px]"
              value={quoteForm.notes}
              onChange={(e) => setQuoteForm((f: any) => ({ ...f, notes: e.target.value }))}
              placeholder="Payment terms, conditions, or additional notes..."
            />
          </div>

          <div className="p-3 rounded-xl bg-muted/30 border border-border/40 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal:</span>
              <span className="font-medium">${quoteTotals.subtotal.toFixed(2)} TTD</span>
            </div>
            {parseFloat(quoteForm.taxRate) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax ({quoteForm.taxRate}%):</span>
                <span className="font-medium">+${quoteTotals.taxAmount.toFixed(2)} TTD</span>
              </div>
            )}
            {parseFloat(quoteForm.discountValue) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Discount {quoteForm.discountType === "PERCENT" ? `(${quoteForm.discountValue}%)` : ""}:
                </span>
                <span className="font-medium text-emerald-500">-${quoteTotals.discountAmount.toFixed(2)} TTD</span>
              </div>
            )}
            <div className="flex justify-between text-base pt-1 border-t border-border/40">
              <span className="font-semibold">Total:</span>
              <span className="font-bold text-primary">${quoteTotals.total.toFixed(2)} TTD</span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowQuoteBuilder(false);
                resetQuoteForm();
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveQuote} className="gap-2">
              {editingQuoteId ? "Update Quote" : "Create Quote"}
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search quotes..."
            value={quoteSearch}
            onChange={(e) => setQuoteSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-card border border-border/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
          />
        </div>
        <div className="flex items-center gap-1">
          <Filter className="w-4 h-4 text-muted-foreground" />
          {QUOTE_STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setQuoteStatusFilter(f.value)}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                quoteStatusFilter === f.value
                  ? "bg-primary/20 text-primary border border-primary/30"
                  : "text-muted-foreground hover:bg-muted border border-transparent"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => {
            const newVal = !autoConvertToInvoice;
            setAutoConvertToInvoice(newVal);
            localStorage.setItem("kf_auto_convert_quote", String(newVal));
          }}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors border ${
            autoConvertToInvoice
              ? "bg-green-500/20 text-green-400 border-green-500/30"
              : "bg-muted/50 text-muted-foreground border-border/60 hover:bg-muted"
          }`}
          title="When enabled, accepting a quote will automatically open the invoice conversion dialog"
        >
          {autoConvertToInvoice ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
          <span className="hidden sm:inline">Auto-convert</span>
        </button>
      </div>

      {quotes.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>No quotes yet. Create your first quote above.</p>
        </div>
      ) : filteredQuotes.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Search className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>No quotes match your search or filter.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-2xl border border-border/60 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Quote #</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Contact</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Total</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredQuotes.map((quote) => (
                  <tr key={quote.id} className="border-t border-border/40 hover:bg-muted/20">
                    <td className="px-4 py-3 font-mono text-xs">{quote.quoteNumber}</td>
                    <td className="px-4 py-3">
                      {quote.contact?.firstName} {quote.contact?.lastName}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusBadge(quote.status)}`}
                      >
                        {quote.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">
                      ${quote.total.toFixed(2)} {quote.currency}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(quote.issueDate).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setSelectedQuote(quote)}
                          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                          title="View Details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openEditQuote(quote)}
                          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                          title="Edit Quote"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        {(quote.status === "DRAFT" || quote.status === "SENT") && (
                          <button
                            onClick={() => {
                              setSelectedQuote(quote);
                              setShowEmailModal(true);
                            }}
                            className="p-1.5 rounded-lg hover:bg-blue-500/20 text-blue-400"
                            title="Send to Email"
                          >
                            <Mail className="w-4 h-4" />
                          </button>
                        )}
                        {quote.status === "DRAFT" && (
                          <button
                            onClick={() => handleMarkSent(quote)}
                            className="p-1.5 rounded-lg hover:bg-primary/20 text-primary"
                            title="Mark as Sent"
                          >
                            <Send className="w-4 h-4" />
                          </button>
                        )}
                        {quote.status === "SENT" && (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAcceptQuote(quote);
                              }}
                              className="p-1.5 rounded-lg hover:bg-green-500/20 text-green-400"
                              title="Mark Accepted"
                            >
                              <CheckCircle className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleRejectQuote(quote)}
                              className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400"
                              title="Mark Rejected"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        {quote.status === "ACCEPTED" && !quote.invoiceId && (
                          <button
                            onClick={() => {
                              setSelectedQuote(quote);
                              setShowConvertModal(true);
                            }}
                            className="px-2 py-1 rounded-lg bg-primary/20 text-primary text-xs font-medium hover:bg-primary/30"
                            title="Convert to Invoice"
                          >
                            Convert
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteQuote(quote)}
                          className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400"
                          title="Delete Quote"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card layout */}
          <div className="md:hidden space-y-3">
            {filteredQuotes.map((quote) => (
              <div
                key={quote.id}
                className="rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-muted-foreground">{quote.quoteNumber}</span>
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusBadge(quote.status)}`}
                  >
                    {quote.status}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">
                    {quote.contact?.firstName} {quote.contact?.lastName}
                  </span>
                  <span className="font-semibold">
                    ${quote.total.toFixed(2)} {quote.currency}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(quote.issueDate).toLocaleDateString()}
                </div>
                <div className="flex items-center gap-1 pt-2 border-t border-border/40 flex-wrap">
                  <button
                    onClick={() => setSelectedQuote(quote)}
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                    title="View"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => openEditQuote(quote)}
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                    title="Edit"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  {(quote.status === "DRAFT" || quote.status === "SENT") && (
                    <button
                      onClick={() => {
                        setSelectedQuote(quote);
                        setShowEmailModal(true);
                      }}
                      className="p-1.5 rounded-lg hover:bg-blue-500/20 text-blue-400"
                      title="Send to Email"
                    >
                      <Mail className="w-4 h-4" />
                    </button>
                  )}
                  {quote.status === "DRAFT" && (
                    <button
                      onClick={() => handleMarkSent(quote)}
                      className="p-1.5 rounded-lg hover:bg-primary/20 text-primary"
                      title="Mark as Sent"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  )}
                  {quote.status === "SENT" && (
                    <>
                      <button
                        onClick={() => handleAcceptQuote(quote)}
                        className="p-1.5 rounded-lg hover:bg-green-500/20 text-green-400"
                        title="Accept"
                      >
                        <CheckCircle className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleRejectQuote(quote)}
                        className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400"
                        title="Reject"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  )}
                  {quote.status === "ACCEPTED" && !quote.invoiceId && (
                    <button
                      onClick={() => {
                        setSelectedQuote(quote);
                        setShowConvertModal(true);
                      }}
                      className="px-2 py-1 rounded-lg bg-primary/20 text-primary text-xs font-medium hover:bg-primary/30"
                    >
                      Convert
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteQuote(quote)}
                    className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400 ml-auto"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <AnimatePresence>
        {showConvertModal && selectedQuote && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card rounded-2xl border border-border shadow-2xl p-6 max-w-md w-full space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Convert Quote to Invoice</h3>
                <button
                  onClick={() => {
                    setShowConvertModal(false);
                    setSelectedQuote(null);
                  }}
                  className="p-1 rounded hover:bg-muted"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-sm text-muted-foreground">
                Converting <span className="font-mono">{selectedQuote.quoteNumber}</span> for $
                {selectedQuote.total.toFixed(2)} {selectedQuote.currency}
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Tax Rate (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                    value={convertForm.taxRate}
                    onChange={(e) => setConvertForm((f) => ({ ...f, taxRate: e.target.value }))}
                  />
                </div>
                <Input
                  label="Due Date"
                  type="date"
                  value={convertForm.dueDate}
                  onChange={(e) => setConvertForm((f) => ({ ...f, dueDate: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Discount Type</label>
                  <select
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                    value={convertForm.discountType}
                    onChange={(e) =>
                      setConvertForm((f) => ({ ...f, discountType: e.target.value as "PERCENT" | "FIXED" }))
                    }
                  >
                    <option value="PERCENT">Percentage (%)</option>
                    <option value="FIXED">Fixed (TTD)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Discount Value</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                    value={convertForm.discountValue}
                    onChange={(e) => setConvertForm((f) => ({ ...f, discountValue: e.target.value }))}
                    placeholder="0"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Notes</label>
                <textarea
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm resize-none"
                  rows={2}
                  value={convertForm.notes}
                  onChange={(e) => setConvertForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Payment terms or notes..."
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowConvertModal(false);
                    setSelectedQuote(null);
                  }}
                >
                  Cancel
                </Button>
                <Button onClick={handleConvert}>Create Invoice</Button>
              </div>
            </motion.div>
          </div>
        )}

        {showAcceptPrompt && selectedQuote && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card rounded-2xl border border-border shadow-2xl p-6 max-w-md w-full space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Quote Accepted!</h3>
                <button
                  onClick={() => {
                    setShowAcceptPrompt(false);
                    setSelectedQuote(null);
                  }}
                  className="p-1 rounded hover:bg-muted"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="text-center py-4">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
                  <CheckCircle className="w-8 h-8 text-green-500" />
                </div>
                <p className="text-muted-foreground mb-4">
                  Quote <span className="font-mono text-foreground">{selectedQuote.quoteNumber}</span> has been marked
                  as accepted.
                </p>
                <p className="text-sm text-muted-foreground">
                  Would you like to convert this quote to an invoice now?
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  onClick={() => {
                    setConvertForm({
                      taxRate: String(selectedQuote.taxRate ?? 12.5),
                      discountType: (selectedQuote.discountType as "PERCENT" | "FIXED") ?? "PERCENT",
                      discountValue: selectedQuote.discountValue ? String(selectedQuote.discountValue) : "",
                      notes: selectedQuote.notes ?? "",
                      dueDate: "",
                    });
                    setShowAcceptPrompt(false);
                    setShowConvertModal(true);
                  }}
                  className="w-full"
                >
                  Convert to Invoice
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowAcceptPrompt(false);
                    setSelectedQuote(null);
                  }}
                  className="w-full"
                >
                  Maybe Later
                </Button>
              </div>
            </motion.div>
          </div>
        )}

        {selectedQuote && !showConvertModal && !showEmailModal && !showAcceptPrompt && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card rounded-2xl border border-border shadow-2xl p-6 max-w-lg w-full space-y-4 max-h-[80vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Quote Details</h3>
                <button onClick={() => setSelectedQuote(null)} className="p-1 rounded hover:bg-muted">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Quote Number:</span>
                  <span className="ml-2 font-mono">{selectedQuote.quoteNumber}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>
                  <span
                    className={`ml-2 px-2 py-0.5 rounded-full text-xs border ${getStatusBadge(selectedQuote.status)}`}
                  >
                    {selectedQuote.status}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Contact:</span>
                  <span className="ml-2">
                    {selectedQuote.contact?.firstName} {selectedQuote.contact?.lastName}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Date:</span>
                  <span className="ml-2">{new Date(selectedQuote.issueDate).toLocaleDateString()}</span>
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2">Items</h4>
                <div className="rounded-lg border border-border/40 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Item</th>
                        <th className="text-center px-3 py-2 font-medium text-muted-foreground">Qty</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Price</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedQuote.items ?? []).map((item: any) => (
                        <tr key={item.id} className="border-t border-border/40">
                          <td className="px-3 py-2">{item.description}</td>
                          <td className="px-3 py-2 text-center">{item.quantity}</td>
                          <td className="px-3 py-2 text-right">${item.unitPrice.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right font-medium">${item.total.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-border/40">
                <span className="text-muted-foreground">Total</span>
                <span className="text-xl font-bold">
                  ${selectedQuote.total.toFixed(2)} {selectedQuote.currency}
                </span>
              </div>
            </motion.div>
          </div>
        )}

        {showEmailModal && selectedQuote && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card rounded-2xl border border-border shadow-2xl p-6 max-w-md w-full space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Mail className="w-5 h-5 text-primary" /> Send Quote to Client
                </h3>
                <button
                  onClick={() => {
                    setShowEmailModal(false);
                    setEmailForm({ email: "", message: "" });
                  }}
                  className="p-1 rounded hover:bg-muted"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {!gmailStatus?.connected ? (
                <div className="space-y-4">
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
                    <p className="text-sm text-amber-200">
                      Connect your Gmail account to send quotes directly from your email address.
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      setLoadingGmail(true);
                      try {
                        const res = await getGmailAuthUrl(businessId ?? undefined);
                        if (res.data?.url) {
                          window.location.href = res.data.url;
                        }
                      } catch {
                        alert("Failed to get Gmail authorization URL");
                      } finally {
                        setLoadingGmail(false);
                      }
                    }}
                    disabled={loadingGmail}
                    className="w-full rounded-xl bg-primary text-primary-foreground py-3 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {loadingGmail ? (
                      "Connecting..."
                    ) : (
                      <>
                        <Mail className="w-4 h-4" />
                        Connect Gmail Account
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setShowEmailModal(false);
                      setEmailForm({ email: "", message: "" });
                    }}
                    className="w-full rounded-xl border border-border py-2.5 text-sm hover:bg-muted"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      <span className="text-sm text-green-200">Sending from: {gmailStatus.email}</span>
                    </div>
                    <button
                      onClick={async () => {
                        if (confirm("Disconnect Gmail?")) {
                          await disconnectGmail(businessId ?? undefined);
                        }
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Disconnect
                    </button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1.5 block">Recipient Email</label>
                      <input
                        type="email"
                        className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                        placeholder={selectedQuote.contact?.email || "client@example.com"}
                        value={emailForm.email || selectedQuote.contact?.email || ""}
                        onChange={(e) => setEmailForm((f) => ({ ...f, email: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1.5 block">Message (optional)</label>
                      <textarea
                        className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[80px]"
                        placeholder="Please find attached your quotation..."
                        value={emailForm.message}
                        onChange={(e) => setEmailForm((f) => ({ ...f, message: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3 text-sm space-y-1">
                    <div>
                      <span className="text-muted-foreground">Quote:</span> {selectedQuote.quoteNumber}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Amount:</span> ${selectedQuote.total.toFixed(2)}{" "}
                      {selectedQuote.currency}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Expires:</span>{" "}
                      {selectedQuote.expiryDate
                        ? new Date(selectedQuote.expiryDate).toLocaleDateString()
                        : "N/A"}
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => {
                        setShowEmailModal(false);
                        setEmailForm({ email: "", message: "" });
                      }}
                      className="flex-1 rounded-xl border border-border py-2.5 text-sm hover:bg-muted"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSendEmail}
                      disabled={sendingEmail}
                      className="flex-1 rounded-xl bg-primary text-primary-foreground py-2.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {sendingEmail ? (
                        "Sending..."
                      ) : (
                        <>
                          <Send className="w-4 h-4" /> Send Quote
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
