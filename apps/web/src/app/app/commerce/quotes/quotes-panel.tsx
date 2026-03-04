"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { Button, Input } from "@keyflow/ui";
import {
  Search,
  FileText,
  Pencil,
  Send,
  CheckCircle,
  X,
  Trash2,
  Mail,
  ToggleLeft,
  ToggleRight,
  Plus,
  Copy,
  MessageCircle,
  AlertTriangle,
  Loader2,
  ArrowUpDown,
  CalendarClock,
  Clock,
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
import { ContactSelect } from "@/components/contacts";

import { formatAmount, formatRelativeDate, getStatusAccentColor, getContactInitials, getItemsSummary } from "../utils/commerce-utils";
import { useCommerceSearch } from "../hooks/use-commerce-search";
import type { ReactNode } from "react";
import {
  QUOTE_STATUS_FILTERS,
  BILLING_SORT_OPTIONS,
  BillingSortKey,
  InvoiceLineItem,
  QuoteFormState,
  getStatusBadge,
  generateItemId,
} from "../components/commerce-types";
import LineItemsEditor from "../components/line-items-editor";
import { BillingCard } from "../components/billing-card";
import { BillingDetailModal } from "../components/billing-detail-modal";
import { useQuoteForm } from "../hooks/use-quote-form";
import { useModuleEmit } from "@/hooks/use-module-events";

interface QuotesPanelProps {
  quotes: Quote[];
  contacts: Contact[];
  products: Product[];
  businessId: string | null;
  loading: boolean;
  gmailStatus: { connected: boolean; email: string | null } | null;
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  setQuotes: React.Dispatch<React.SetStateAction<Quote[]>>;
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
  triggerNew?: number;
  onSwitchToInvoices?: () => void;
  currency?: string;
  prefillContactId?: string;
  prefillItems?: import("../components/commerce-types").InvoiceLineItem[];
  prefillToken?: number;
  onPrefillApplied?: () => void;
  renderTimelineBadge?: (quote: Quote) => ReactNode;
}

export default function QuotesPanel({
  quotes,
  contacts,
  products,
  businessId,
  loading,
  gmailStatus,
  setProducts,
  setQuotes,
  setInvoices,
  triggerNew,
  onSwitchToInvoices,
  currency = "TTD",
  prefillContactId,
  prefillItems,
  prefillToken,
  onPrefillApplied,
  renderTimelineBadge,
}: QuotesPanelProps) {
  const {
    showQuoteBuilder,
    setShowQuoteBuilder,
    editingQuoteId,
    setEditingQuoteId,
    quoteForm,
    setQuoteForm,
    resetQuoteForm,
    handleNewQuote,
    prefillQuote,
  } = useQuoteForm();
  const emitEvent = useModuleEmit();

  const triggerRef = useRef(triggerNew);
  useEffect(() => {
    if (triggerNew !== undefined && triggerNew !== triggerRef.current) {
      triggerRef.current = triggerNew;
      handleNewQuote();
    }
  }, [triggerNew, handleNewQuote]);

  const prefillAppliedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!prefillContactId) return;
    const token = prefillToken ?? 0;
    if (prefillAppliedRef.current === token) return;
    prefillAppliedRef.current = token;
    prefillQuote({ contactId: prefillContactId, items: prefillItems });
    onPrefillApplied?.();
  }, [prefillContactId, prefillItems, prefillToken, prefillQuote, onPrefillApplied]);
  const [quoteSearch, setQuoteSearch] = useState("");
  const [quoteStatusFilter, setQuoteStatusFilter] = useState<string>("ALL");
  const [sortKey, setSortKey] = useState<BillingSortKey>("date-desc");
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [extendDate, setExtendDate] = useState("");
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
  const [confirmState, setConfirmState] = useState<{open: boolean; action: () => void}>({open: false, action: () => {}});
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});
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

  function isQuoteExpired(quote: Quote): boolean {
    if (!quote.expiryDate) return false;
    if (quote.status !== "DRAFT" && quote.status !== "SENT") return false;
    const expiry = new Date(quote.expiryDate);
    expiry.setHours(23, 59, 59, 999);
    return expiry < new Date();
  }

  function getDaysRemaining(quote: Quote): { days: number; label: string; color: string } | null {
    if (!quote.expiryDate) return null;
    if (quote.status !== "DRAFT" && quote.status !== "SENT") return null;
    const expiry = new Date(quote.expiryDate);
    expiry.setHours(23, 59, 59, 999);
    const now = new Date();
    const diff = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return null;
    if (diff === 0) return { days: 0, label: "Expires today", color: "text-amber-400" };
    if (diff <= 7) return { days: diff, label: `${diff}d left`, color: "text-amber-400" };
    return { days: diff, label: `${diff}d left`, color: "text-muted-foreground/60" };
  }

  async function handleExtendExpiry(quote: Quote, newDate: string) {
    if (!businessId || !newDate) return;
    const res = await updateQuote({
      businessId,
      quoteId: quote.id,
      contactId: quote.contactId,
      items: (quote.items ?? []).map((item: any) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        productId: item.productId || undefined,
      })),
      expiryDate: newDate,
      taxRate: quote.taxRate ?? 0,
      discountType: quote.discountType as "PERCENT" | "FIXED" | undefined,
      discountValue: quote.discountValue ?? undefined,
      notes: quote.notes || undefined,
    });
    if (res.data) {
      setQuotes((q) => q.map((qItem) => (qItem.id === quote.id ? res.data! : qItem)));
      setSelectedQuote(res.data);
      setExtendDate("");
      toast.success("Quote expiry extended");
    } else {
      toast.error("Failed to extend expiry");
    }
  }

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: quotes.length };
    for (const q of quotes) {
      counts[q.status] = (counts[q.status] || 0) + 1;
    }
    return counts;
  }, [quotes]);

  const sorted = useMemo(() => {
    const list = [...quotes];
    switch (sortKey) {
      case "date-asc":
        return list.sort((a, b) => new Date(a.issueDate ?? 0).getTime() - new Date(b.issueDate ?? 0).getTime());
      case "amount-desc":
        return list.sort((a, b) => Number(b.total) - Number(a.total));
      case "amount-asc":
        return list.sort((a, b) => Number(a.total) - Number(b.total));
      case "name-asc":
        return list.sort((a, b) => {
          const nameA = `${a.contact?.firstName ?? ""} ${a.contact?.lastName ?? ""}`.trim().toLowerCase();
          const nameB = `${b.contact?.firstName ?? ""} ${b.contact?.lastName ?? ""}`.trim().toLowerCase();
          return nameA.localeCompare(nameB);
        });
      default:
        return list.sort((a, b) => new Date(b.issueDate ?? 0).getTime() - new Date(a.issueDate ?? 0).getTime());
    }
  }, [quotes, sortKey]);

  const statusFiltered = useMemo(() => {
    if (quoteStatusFilter === "ALL") return sorted;
    return sorted.filter((q) => q.status === quoteStatusFilter);
  }, [sorted, quoteStatusFilter]);

  const { filtered: filteredQuotes } = useCommerceSearch(
    statusFiltered,
    (q) => `${q.quoteNumber} ${q.contact?.firstName ?? ""} ${q.contact?.lastName ?? ""} ${q.contact?.email ?? ""} ${(q.items ?? []).map((i: any) => `${i.description ?? ""}`).join(" ")} ${q.notes ?? ""} ${Number(q.total).toFixed(2)}`,
    quoteSearch,
  );

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
        toast.success("Quote updated");
      } else if (res.error) {
        toast.error("Failed to update quote");
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
        toast.success("Quote created");
        emitEvent("billing:quote_created", "commerce", { quoteId: res.data.id });
      } else if (res.error) {
        toast.error("Failed to create quote");
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
    if (actionLoading[quote.id]) return;
    setActionLoading((prev) => ({ ...prev, [quote.id]: "accept" }));
    try {
      const res = await updateQuoteStatus(quote.id, "ACCEPTED");
      if (res.data) {
        setQuotes((q) => q.map((qItem) => (qItem.id === quote.id ? res.data! : qItem)));
        setSelectedQuote(res.data);
        emitEvent("billing:quote_accepted", "commerce", { quoteId: quote.id });
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
        toast.error("Failed to accept quote: " + res.error);
      }
    } catch (err) {
      toast.error("Failed to accept quote");
    } finally {
      setActionLoading((prev) => { const next = { ...prev }; delete next[quote.id]; return next; });
    }
  }

  async function handleRejectQuote(quote: Quote) {
    if (actionLoading[quote.id]) return;
    setActionLoading((prev) => ({ ...prev, [quote.id]: "reject" }));
    try {
      const res = await updateQuoteStatus(quote.id, "REJECTED");
      if (res.data) {
        setQuotes((q) => q.map((qItem) => (qItem.id === quote.id ? res.data! : qItem)));
      }
    } finally {
      setActionLoading((prev) => { const next = { ...prev }; delete next[quote.id]; return next; });
    }
  }

  async function handleMarkSent(quote: Quote) {
    if (actionLoading[quote.id]) return;
    setActionLoading((prev) => ({ ...prev, [quote.id]: "send" }));
    try {
      const res = await updateQuoteStatus(quote.id, "SENT");
      if (res.data) {
        setQuotes((q) => q.map((qItem) => (qItem.id === quote.id ? res.data! : qItem)));
      }
    } finally {
      setActionLoading((prev) => { const next = { ...prev }; delete next[quote.id]; return next; });
    }
  }

  async function handleDeleteQuote(quote: Quote) {
    if (!businessId || actionLoading[quote.id]) return;
    setConfirmState({
      open: true,
      action: async () => {
        setActionLoading((prev) => ({ ...prev, [quote.id]: "delete" }));
        try {
          await deleteQuote(businessId!, quote.id);
          setQuotes((q) => q.filter((qItem) => qItem.id !== quote.id));
          toast.success("Quote deleted");
        } finally {
          setActionLoading((prev) => { const next = { ...prev }; delete next[quote.id]; return next; });
        }
      },
    });
  }

  function duplicateQuote(quote: Quote) {
    setEditingQuoteId(null);
    setQuoteForm({
      contactId: quote.contactId || "",
      expiryDate: "",
      items: (quote.items ?? []).map((item: any) => ({
        id: generateItemId(),
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

  function shareQuoteViaWhatsApp(quote: Quote) {
    const contactName = quote.contact
      ? `${quote.contact.firstName ?? ""} ${quote.contact.lastName ?? ""}`.trim()
      : "there";
    const msg = `Hi ${contactName}, here is your quote ${quote.quoteNumber} for ${formatAmount(quote.total, quote.currency)}. Please review and let us know if you'd like to proceed!`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
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
      onSwitchToInvoices?.();
      toast.success("Quote converted to invoice");
      emitEvent("billing:quote_converted", "commerce", { quoteId: selectedQuote.id, invoiceId: res.data.id });
    } else if (res.error) {
      toast.error("Failed to convert quote");
    }
  }

  async function handleSendEmail() {
    if (!selectedQuote) return;
    const targetEmail = emailForm.email || selectedQuote.contact?.email;
    if (!targetEmail) {
      toast.error("Please enter an email address");
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
        toast.success(`Quote sent to ${targetEmail}`);
      } else {
        toast.error(res.error || "Failed to send email");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send email");
    } finally {
      setSendingEmail(false);
    }
  }

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
            <ContactSelect
              value={quoteForm.contactId}
              onChange={(id) => setQuoteForm((f: any) => ({ ...f, contactId: id }))}
              contacts={contacts}
              label="Contact"
              required
            />
            <Input
              label="Expiry Date"
              type="date"
              value={quoteForm.expiryDate}
              onChange={(e) => setQuoteForm((f: any) => ({ ...f, expiryDate: e.target.value }))}
            />
          </div>

          <LineItemsEditor
            items={quoteForm.items}
            products={products.filter((p) => p.isActive !== false)}
            onAddItem={addQuoteItem}
            onRemoveItem={removeQuoteItem}
            onUpdateItem={updateQuoteItem}
            onSelectProduct={selectProductForQuoteItem}
            taxRate={quoteForm.taxRate}
            discountType={quoteForm.discountType}
            discountValue={quoteForm.discountValue}
            onTaxRateChange={(v) => setQuoteForm((f: any) => ({ ...f, taxRate: v }))}
            onDiscountTypeChange={(v) => setQuoteForm((f: any) => ({ ...f, discountType: v }))}
            onDiscountValueChange={(v) => setQuoteForm((f: any) => ({ ...f, discountValue: v }))}
            notes={quoteForm.notes}
            onNotesChange={(v) => setQuoteForm((f: any) => ({ ...f, notes: v }))}
            currency={currency}
          />

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

      <div className="rounded-2xl border border-border/50 bg-card p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
            <input
              type="text"
              placeholder="Search quotes..."
              value={quoteSearch}
              onChange={(e) => setQuoteSearch(e.target.value)}
              className="w-full pl-9 pr-8 py-1.5 text-sm bg-white/[0.03] border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/40 focus:border-[hsl(var(--kf-accent1))]/40 placeholder:text-muted-foreground/40 transition-all"
              aria-label="Search quotes"
            />
            {quoteSearch && (
              <button
                onClick={() => setQuoteSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-md hover:bg-muted/50 transition-colors"
                aria-label="Clear search"
              >
                <X className="w-3 h-3 text-muted-foreground/40" />
              </button>
            )}
          </div>

          <div className="relative shrink-0">
            <ArrowUpDown className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as BillingSortKey)}
              className="appearance-none pl-7 pr-2 py-1.5 text-[11px] bg-white/[0.03] border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/40 text-muted-foreground cursor-pointer"
              aria-label="Sort quotes"
            >
              {BILLING_SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => { resetQuoteForm(); setShowQuoteBuilder(true); }}
            className="inline-flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium rounded-lg bg-gradient-to-r from-[hsl(var(--kf-accent1))]/15 to-[hsl(var(--kf-accent1))]/5 text-[hsl(var(--kf-accent1))] hover:from-[hsl(var(--kf-accent1))]/25 hover:to-[hsl(var(--kf-accent1))]/10 transition-all shrink-0"
            aria-label="New Quote"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New Quote</span>
          </button>

          <button
            onClick={() => {
              const newVal = !autoConvertToInvoice;
              setAutoConvertToInvoice(newVal);
              localStorage.setItem("kf_auto_convert_quote", String(newVal));
            }}
            className={`inline-flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium rounded-lg border transition-all shrink-0 ${
              autoConvertToInvoice
                ? "bg-green-500/20 text-green-400 border-green-500/30"
                : "bg-white/[0.02] text-muted-foreground/60 border-border/40 hover:bg-white/[0.05]"
            }`}
            title="When enabled, accepting a quote will automatically open the invoice conversion dialog"
            aria-label="Toggle auto-convert"
          >
            {autoConvertToInvoice ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">Auto-convert</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none" role="group" aria-label="Filter by status">
          {QUOTE_STATUS_FILTERS.map((f) => {
            const count = statusCounts[f.value] ?? 0;
            return (
              <button
                key={f.value}
                onClick={() => setQuoteStatusFilter(f.value)}
                className={`px-2.5 py-1 text-[11px] rounded-md transition-all inline-flex items-center gap-1.5 font-medium whitespace-nowrap shrink-0 ${
                  quoteStatusFilter === f.value
                    ? "bg-white/[0.08] border border-border/60"
                    : "bg-white/[0.02] border border-transparent text-muted-foreground/60 hover:bg-white/[0.05]"
                }`}
                aria-pressed={quoteStatusFilter === f.value}
              >
                {f.label}
                <span className={`text-[10px] font-mono px-1 py-0.5 rounded ${
                  quoteStatusFilter === f.value ? "bg-white/10" : "bg-white/[0.04] text-muted-foreground/50"
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
          <span className="ml-auto text-[10px] text-muted-foreground/50 whitespace-nowrap shrink-0 pl-2">
            {filteredQuotes.length} of {quotes.length}
          </span>
        </div>
      </div>

      {quotes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-xl bg-white/[0.03] border border-border/50 flex items-center justify-center mb-4">
            <FileText className="w-7 h-7 text-muted-foreground/50" />
          </div>
          <h3 className="text-lg font-semibold mb-1">No quotes yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm mb-4">
            Create your first quote to start sending proposals to clients.
          </p>
          <Button onClick={() => { resetQuoteForm(); setShowQuoteBuilder(true); }} className="gap-2">
            <Plus className="w-4 h-4" />
            Create Your First Quote
          </Button>
        </div>
      ) : filteredQuotes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-xl bg-white/[0.03] border border-border/50 flex items-center justify-center mb-4">
            <Search className="w-7 h-7 text-muted-foreground/50" />
          </div>
          <h3 className="text-lg font-semibold mb-1">No matching quotes</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            No quotes match your filters. Try adjusting your search or status filter.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredQuotes.map((quote) => {
            const expired = isQuoteExpired(quote);
            const daysRemaining = getDaysRemaining(quote);

            const cardBadges = (
              <>
                {expired && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border bg-amber-500/20 text-amber-300 border-amber-500/40">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Expired
                  </span>
                )}
                {!expired && daysRemaining && (
                  <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${daysRemaining.color}`}>
                    <Clock className="w-3.5 h-3.5" />
                    {daysRemaining.label}
                  </span>
                )}
                {renderTimelineBadge?.(quote)}
              </>
            );

            const desktopActions = (
              <>
                <button
                  onClick={() => openEditQuote(quote)}
                  className="p-1 rounded-lg hover:bg-muted text-muted-foreground/70 hover:text-foreground"
                  title="Edit Quote"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => duplicateQuote(quote)}
                  className="p-1 rounded-lg hover:bg-muted text-muted-foreground/70 hover:text-foreground"
                  title="Duplicate Quote"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => shareQuoteViaWhatsApp(quote)}
                  className="p-1 rounded-lg hover:bg-green-500/20 text-green-400"
                  title="Share via WhatsApp"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                </button>
                {(quote.status === "DRAFT" || quote.status === "SENT") && (
                  <button
                    onClick={() => {
                      setSelectedQuote(quote);
                      setShowEmailModal(true);
                    }}
                    className="p-1 rounded-lg hover:bg-blue-500/20 text-blue-400"
                    title="Send to Email"
                  >
                    <Mail className="w-3.5 h-3.5" />
                  </button>
                )}
                {quote.status === "DRAFT" && (
                  <button
                    onClick={() => handleMarkSent(quote)}
                    className="p-1 rounded-lg hover:bg-primary/20 text-primary disabled:opacity-50"
                    title="Mark as Sent"
                    disabled={!!actionLoading[quote.id]}
                  >
                    {actionLoading[quote.id] === "send" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  </button>
                )}
                {quote.status === "SENT" && (
                  <>
                    <button
                      onClick={() => handleAcceptQuote(quote)}
                      className={`p-1 rounded-lg ${expired ? "opacity-50 cursor-not-allowed" : "hover:bg-green-500/20"} text-green-400 disabled:opacity-50`}
                      title={expired ? "Cannot accept — quote has expired" : "Mark Accepted"}
                      disabled={expired || !!actionLoading[quote.id]}
                    >
                      {actionLoading[quote.id] === "accept" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => handleRejectQuote(quote)}
                      className="p-1 rounded-lg hover:bg-red-500/20 text-red-400 disabled:opacity-50"
                      title="Mark Rejected"
                      disabled={!!actionLoading[quote.id]}
                    >
                      {actionLoading[quote.id] === "reject" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                    </button>
                  </>
                )}
                {quote.status === "ACCEPTED" && !quote.invoiceId && (
                  <button
                    onClick={() => {
                      setSelectedQuote(quote);
                      setShowConvertModal(true);
                    }}
                    className="px-1.5 py-0.5 rounded-lg bg-primary/20 text-primary text-[10px] font-medium hover:bg-primary/30"
                    title="Convert to Invoice"
                  >
                    Convert
                  </button>
                )}
                <button
                  onClick={() => handleDeleteQuote(quote)}
                  className="p-1 rounded-lg hover:bg-red-500/20 text-red-400 disabled:opacity-50"
                  title="Delete Quote"
                  disabled={!!actionLoading[quote.id]}
                >
                  {actionLoading[quote.id] === "delete" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </>
            );

            const mobileActions = (
              <>
                <button onClick={() => openEditQuote(quote)} className="p-1 rounded-lg hover:bg-muted" title="Edit">
                  <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
                <button onClick={() => duplicateQuote(quote)} className="p-1 rounded-lg hover:bg-muted" title="Duplicate">
                  <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
                <button onClick={() => shareQuoteViaWhatsApp(quote)} className="p-1 rounded-lg hover:bg-green-500/20" title="WhatsApp">
                  <MessageCircle className="w-3.5 h-3.5 text-green-400" />
                </button>
                {(quote.status === "DRAFT" || quote.status === "SENT") && (
                  <button onClick={() => { setSelectedQuote(quote); setShowEmailModal(true); }} className="p-1 rounded-lg hover:bg-blue-500/20" title="Email">
                    <Mail className="w-3.5 h-3.5 text-blue-400" />
                  </button>
                )}
                {quote.status === "DRAFT" && (
                  <button
                    onClick={() => handleMarkSent(quote)}
                    className="p-1 rounded-lg hover:bg-primary/20 text-primary disabled:opacity-50"
                    title="Mark as Sent"
                    disabled={!!actionLoading[quote.id]}
                  >
                    {actionLoading[quote.id] === "send" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  </button>
                )}
                {quote.status === "SENT" && (
                  <button
                    onClick={() => handleAcceptQuote(quote)}
                    className={`p-1 rounded-lg ${expired ? "opacity-50 cursor-not-allowed" : "hover:bg-green-500/20"} text-green-400 disabled:opacity-50`}
                    title={expired ? "Cannot accept — expired" : "Accept"}
                    disabled={expired || !!actionLoading[quote.id]}
                  >
                    {actionLoading[quote.id] === "accept" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                  </button>
                )}
                {quote.status === "ACCEPTED" && !quote.invoiceId && (
                  <button
                    onClick={() => { setSelectedQuote(quote); setShowConvertModal(true); }}
                    className="px-1.5 py-0.5 rounded-lg bg-primary/20 text-primary text-[10px] font-medium hover:bg-primary/30"
                  >
                    Convert
                  </button>
                )}
                <button
                  onClick={() => handleDeleteQuote(quote)}
                  className="p-1 rounded-lg hover:bg-red-500/20 text-red-400 disabled:opacity-50"
                  title="Delete"
                  disabled={!!actionLoading[quote.id]}
                >
                  {actionLoading[quote.id] === "delete" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </>
            );

            return (
              <BillingCard
                key={quote.id}
                type="quote"
                number={quote.quoteNumber}
                status={quote.status}
                contact={quote.contact ?? null}
                total={Number(quote.total)}
                currency={quote.currency}
                items={(quote.items ?? []) as Array<{ description?: string | null }>}
                date={quote.issueDate}
                badges={cardBadges}
                desktopActions={desktopActions}
                mobileActions={mobileActions}
                onClick={() => setSelectedQuote(quote)}
              />
            );
          })}
        </div>
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
                Converting <span className="font-mono">{selectedQuote.quoteNumber}</span> for{" "}
                {formatAmount(selectedQuote.total, selectedQuote.currency)}
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
                    <option value="FIXED">Fixed ({currency})</option>
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
          <BillingDetailModal
            type="quote"
            number={selectedQuote.quoteNumber}
            status={selectedQuote.status}
            contact={selectedQuote.contact ?? null}
            total={Number(selectedQuote.total)}
            currency={selectedQuote.currency}
            items={(selectedQuote.items ?? []) as Array<{ id?: string; description?: string | null; quantity?: number; unitPrice?: number; total?: number }>}
            dateLabel1="Issue Date"
            dateValue1={selectedQuote.issueDate}
            dateLabel2="Expiry Date"
            dateValue2={selectedQuote.expiryDate ?? null}
            dateExtra={
              <>
                {isQuoteExpired(selectedQuote) && (
                  <p className="text-[10px] text-amber-400 mt-1 font-medium">Expired</p>
                )}
                {!isQuoteExpired(selectedQuote) && getDaysRemaining(selectedQuote) && (
                  <p className={`text-[10px] mt-1 font-medium ${getDaysRemaining(selectedQuote)!.color}`}>{getDaysRemaining(selectedQuote)!.label}</p>
                )}
              </>
            }
            taxRate={selectedQuote.taxRate ?? 0}
            discountType={selectedQuote.discountType}
            discountValue={selectedQuote.discountValue ?? undefined}
            notes={selectedQuote.notes}
            alerts={
              isQuoteExpired(selectedQuote) && (selectedQuote.status === "DRAFT" || selectedQuote.status === "SENT") ? (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2">
                  <p className="text-sm text-amber-200">This quote has expired. Extend the expiry to re-activate it.</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={extendDate}
                      onChange={(e) => setExtendDate(e.target.value)}
                      className="flex-1 rounded-lg border border-amber-500/30 bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/40"
                      min={new Date().toISOString().split("T")[0]}
                    />
                    <Button
                      onClick={() => handleExtendExpiry(selectedQuote, extendDate)}
                      disabled={!extendDate}
                      className="gap-1.5 text-sm"
                    >
                      <CalendarClock className="w-3.5 h-3.5" /> Extend
                    </Button>
                  </div>
                </div>
              ) : undefined
            }
            actions={
              <>
                <div className="flex items-center gap-1">
                  <button onClick={() => duplicateQuote(selectedQuote)} className="p-2 rounded-lg hover:bg-white/[0.06] transition-colors" title="Duplicate">
                    <Copy className="w-4 h-4 text-slate-400" />
                  </button>
                  <button onClick={() => shareQuoteViaWhatsApp(selectedQuote)} className="p-2 rounded-lg hover:bg-emerald-500/10 transition-colors" title="WhatsApp">
                    <MessageCircle className="w-4 h-4 text-emerald-400" />
                  </button>
                  <button onClick={() => setShowEmailModal(true)} className="p-2 rounded-lg hover:bg-blue-500/10 transition-colors" title="Email">
                    <Mail className="w-4 h-4 text-blue-400" />
                  </button>
                </div>
                <div className="flex gap-2">
                  {selectedQuote.status === "DRAFT" && (
                    <Button size="sm" className="gap-1.5 flex-1" onClick={() => { handleMarkSent(selectedQuote); setSelectedQuote(null); }} disabled={!!actionLoading[selectedQuote.id]}>
                      {actionLoading[selectedQuote.id] === "send" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send Quote
                    </Button>
                  )}
                  {selectedQuote.status === "SENT" && !isQuoteExpired(selectedQuote) && (
                    <Button size="sm" className="gap-1.5 flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => handleAcceptQuote(selectedQuote)} disabled={!!actionLoading[selectedQuote.id]}>
                      {actionLoading[selectedQuote.id] === "accept" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />} Accept Quote
                    </Button>
                  )}
                  {selectedQuote.status === "ACCEPTED" && !selectedQuote.invoiceId && (
                    <Button size="sm" className="gap-1.5 flex-1" onClick={() => {
                      setConvertForm({
                        taxRate: String(selectedQuote.taxRate ?? 12.5),
                        discountType: (selectedQuote.discountType as "PERCENT" | "FIXED") ?? "PERCENT",
                        discountValue: selectedQuote.discountValue ? String(selectedQuote.discountValue) : "",
                        notes: selectedQuote.notes ?? "",
                        dueDate: "",
                      });
                      setShowConvertModal(true);
                    }}>
                      Convert to Invoice
                    </Button>
                  )}
                </div>
              </>
            }
            onClose={() => setSelectedQuote(null)}
          />
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
                        toast.error("Failed to get Gmail authorization URL");
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
                      onClick={() => {
                        setConfirmState({
                          open: true,
                          action: async () => {
                            await disconnectGmail(businessId ?? undefined);
                            toast.success("Gmail disconnected");
                          },
                        });
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
                      <span className="text-muted-foreground">Amount:</span> {formatAmount(selectedQuote.total, selectedQuote.currency)}
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
      <ConfirmDialog
        open={confirmState.open}
        title="Delete?"
        message="This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => { confirmState.action(); setConfirmState({open: false, action: () => {}}); }}
        onCancel={() => setConfirmState({open: false, action: () => {}})}
      />
    </motion.div>
  );
}
