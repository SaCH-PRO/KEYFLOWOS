"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SkeletonList } from "@/components/ui/skeleton";
import { motion, AnimatePresence } from "framer-motion";
import { Button, Input } from "@keyflow/ui";
import {
  Search,
  FileText,
  Eye,
  Pencil,
  Send,
  CheckCircle,
  X,
  Trash2,
  Plus,
  MessageCircle,
  Mail,
  Clock,
  AlertTriangle,
  Loader2,
  Ban,
  Bell,
  ArrowUpDown,
  Link,
  Files,
  DollarSign,
  CreditCard,
} from "lucide-react";
import {
  createProduct,
  createInvoice,
  updateInvoice,
  markInvoicePaid,
  updateInvoiceStatus,
  sendQuoteEmail,
  recordInvoicePayment,
  listInvoicePayments,
  Product,
  Invoice,
  Contact,
  PaymentRecord,
} from "@/lib/client";
import { apiDelete } from "@/lib/api";
import { useModuleEmit } from "@/hooks/use-module-events";
import { ContactSelect } from "@/components/contacts";
import {
  INVOICE_STATUS_FILTERS,
  InvoiceLineItem,
  InvoiceFormState,
  PAYMENT_TERMS,
  BILLING_SORT_OPTIONS,
  BillingSortKey,
  getStatusBadge,
  generateItemId,
  getDueDateFromTerms,
} from "../components/commerce-types";
import LineItemsEditor from "../components/line-items-editor";
import { BillingDetailModal } from "../components/billing-detail-modal";
import { BillingFormModal } from "../components/billing-form-modal";
import { RecordRowCard, OverflowMenu, OverflowMenuItem } from "../components/standardized-cards";
import { getInvoiceSmartCTA } from "../utils/smart-cta";
import { useInvoiceForm } from "../hooks/use-invoice-form";
import { useBusinessPreview } from "../hooks/use-business-preview";

import { formatAmount, formatRelativeDate, getStatusAccentColor, getContactInitials, getItemsSummary, getDaysUntilDue } from "../utils/commerce-utils";
import { useCommerceSearch } from "../hooks/use-commerce-search";
import type { ReactNode } from "react";

interface InvoicesPanelProps {
  invoices: Invoice[];
  contacts: Contact[];
  products: Product[];
  businessId: string | null;
  loading: boolean;
  triggerNew?: number;
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
  gmailStatus: { connected: boolean; email: string | null } | null;
  currency?: string;
  prefillContactId?: string;
  prefillItems?: import("../components/commerce-types").InvoiceLineItem[];
  prefillToken?: number;
  onPrefillApplied?: () => void;
  renderTimelineBadge?: (invoice: Invoice) => ReactNode;
  onViewContact?: (contactId: string) => void;
  onViewClientIntel?: (contactId: string) => void;
  onSelectProduct?: (productId: string) => void;
  onAiDraftReminder?: (invoiceId: string) => void;
  initialStatusFilter?: string;
}

export default function InvoicesPanel({
  invoices,
  contacts,
  products,
  businessId,
  loading,
  triggerNew,
  setProducts,
  setInvoices,
  gmailStatus,
  currency = "TTD",
  prefillContactId,
  prefillItems,
  prefillToken,
  onPrefillApplied,
  renderTimelineBadge,
  onViewContact,
  onViewClientIntel,
  onSelectProduct,
  onAiDraftReminder,
  initialStatusFilter,
}: InvoicesPanelProps) {
  const {
    showInvoiceBuilder,
    setShowInvoiceBuilder,
    editingInvoiceId,
    setEditingInvoiceId,
    invoiceForm,
    setInvoiceForm,
    resetInvoiceForm,
    prefillInvoice,
  } = useInvoiceForm();
  const emitEvent = useModuleEmit();
  const { businessData, saveBranding, savingBranding } = useBusinessPreview();

  const prevTriggerNew = useRef(triggerNew);
  useEffect(() => {
    if (triggerNew !== undefined && triggerNew !== prevTriggerNew.current) {
      prevTriggerNew.current = triggerNew;
      resetInvoiceForm();
      setShowInvoiceBuilder(true);
    }
  }, [triggerNew, resetInvoiceForm, setShowInvoiceBuilder]);

  const prefillAppliedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!prefillContactId) return;
    const token = prefillToken ?? 0;
    if (prefillAppliedRef.current === token) return;
    prefillAppliedRef.current = token;
    prefillInvoice({ contactId: prefillContactId, items: prefillItems });
    onPrefillApplied?.();
  }, [prefillContactId, prefillItems, prefillToken, prefillInvoice, onPrefillApplied]);
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<string>(initialStatusFilter ?? "ALL");

  useEffect(() => {
    if (initialStatusFilter) {
      setInvoiceStatusFilter(initialStatusFilter);
    }
  }, [initialStatusFilter]);
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [sortKey, setSortKey] = useState<BillingSortKey>("date-desc");
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailForm, setEmailForm] = useState({ email: "", message: "" });
  const [sendingEmail, setSendingEmail] = useState(false);
  const [confirmState, setConfirmState] = useState<{open: boolean; action: () => void}>({open: false, action: () => {}});
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});
  const [paymentModal, setPaymentModal] = useState<{ invoice: Invoice } | null>(null);
  const [paymentForm, setPaymentForm] = useState({ amount: "", method: "Cash", reference: "", notes: "" });
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [paymentHistory, setPaymentHistory] = useState<Record<string, PaymentRecord[]>>({});

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: invoices.length, DRAFT: 0, SENT: 0, PAID: 0, PARTIALLY_PAID: 0, OVERDUE: 0, VOID: 0 };
    for (const inv of invoices) {
      if (inv.status && counts[inv.status] !== undefined) counts[inv.status]++;
    }
    return counts;
  }, [invoices]);

  const sorted = useMemo(() => {
    const list = [...invoices];
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
  }, [invoices, sortKey]);

  const statusFiltered = useMemo(() => {
    if (invoiceStatusFilter === "ALL") return sorted;
    return sorted.filter((inv) => inv.status === invoiceStatusFilter);
  }, [sorted, invoiceStatusFilter]);

  const { filtered: filteredInvoices } = useCommerceSearch(
    statusFiltered,
    (inv) => `${inv.invoiceNumber ?? ""} ${inv.contact?.firstName ?? ""} ${inv.contact?.lastName ?? ""} ${inv.contact?.email ?? ""} ${(inv.items ?? []).map((i: any) => `${i.description ?? ""}`).join(" ")} ${inv.notes ?? ""} ${Number(inv.total).toFixed(2)}`,
    invoiceSearch,
  );

  function addInvoiceItem() {
    setInvoiceForm((f: any) => ({
      ...f,
      items: [...f.items, { id: generateItemId(), productId: "", description: "", quantity: "1", unitPrice: "" }],
    }));
  }

  function removeInvoiceItem(itemId: string) {
    setInvoiceForm((f: any) => ({
      ...f,
      items: f.items.filter((item: InvoiceLineItem) => item.id !== itemId),
    }));
  }

  function updateInvoiceItem(itemId: string, field: keyof InvoiceLineItem, value: string | boolean) {
    setInvoiceForm((f: any) => ({
      ...f,
      items: f.items.map((item: InvoiceLineItem) =>
        item.id === itemId ? { ...item, [field]: value } : item
      ),
    }));
  }

  function selectProductForItem(itemId: string, productId: string) {
    if (productId === "__NEW__") {
      setInvoiceForm((f: any) => ({
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
      setInvoiceForm((f: any) => ({
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
      setInvoiceForm((f: any) => ({
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

  async function copyPaymentLink(invoiceId: string) {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    const link = `${baseUrl}/pay/${invoiceId}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedLink(invoiceId);
      setTimeout(() => setCopiedLink(null), 2000);
    } catch {
      setInvoiceError("Failed to copy link");
    }
  }

  function shareViaWhatsApp(inv: Invoice) {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    const link = `${baseUrl}/pay/${inv.id}`;
    const contactName = inv.contact
      ? `${inv.contact.firstName ?? ""} ${inv.contact.lastName ?? ""}`.trim()
      : "there";
    const msg = `Hi ${contactName}, here is your invoice ${inv.invoiceNumber ?? ""} for ${formatAmount(inv.total, inv.currency)}. You can view and pay it here: ${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  }

  function duplicateInvoice(inv: Invoice) {
    setEditingInvoiceId(null);
    setInvoiceForm({
      contactId: inv.contactId || "",
      dueDate: "",
      items: (inv.items ?? []).map((item: any) => ({
        id: generateItemId(),
        productId: item.productId ?? "",
        description: item.description,
        quantity: String(item.quantity),
        unitPrice: String(item.unitPrice),
      })),
      taxRate: String(inv.taxRate || 0),
      discountType: (inv.discountType as "PERCENT" | "FIXED") || "PERCENT",
      discountValue: inv.discountValue ? String(inv.discountValue) : "",
      notes: inv.notes || "",
    });
    setShowInvoiceBuilder(true);
  }

  function applyPaymentTerms(termKey: string) {
    const dueDate = getDueDateFromTerms(termKey);
    setInvoiceForm((f: any) => ({ ...f, dueDate }));
  }

  async function handleCreateOrUpdateInvoice() {
    setFormError(null);
    if (!businessId) return;
    const validItems = invoiceForm.items.filter(
      (item: InvoiceLineItem) => {
        const hasName = item.isNewItem ? (item.newItemName?.trim() || item.description.trim()) : item.description.trim();
        return hasName && item.unitPrice;
      }
    );
    if (validItems.length === 0) {
      setFormError("At least one item with name/description and price is required");
      return;
    }

    const itemsToAddToCatalog = validItems.filter(
      (item: InvoiceLineItem) => item.isNewItem && item.addToCatalog
    );

    for (const item of itemsToAddToCatalog) {
      const itemName = item.newItemName || item.description;
      const { data: newProduct, error: productError } = await createProduct({
        businessId,
        name: itemName,
        price: parseFloat(item.unitPrice),
        category: item.newItemCategory || "SERVICE",
        description: item.description || "",
        isActive: true,
      });
      if (productError) {
        setFormError(`Failed to add "${itemName}" to catalog: ${productError}`);
        return;
      }
      if (newProduct) {
        setProducts((prev) => [newProduct, ...prev]);
      }
    }

    const invoicePayload = {
      businessId,
      contactId: invoiceForm.contactId || undefined,
      items: validItems.map((item: InvoiceLineItem) => ({
        description: item.isNewItem ? (item.newItemName || item.description) : item.description,
        quantity: parseInt(item.quantity) || 1,
        unitPrice: parseFloat(item.unitPrice),
      })),
      dueDate: invoiceForm.dueDate || undefined,
      taxRate: invoiceForm.taxRate ? parseFloat(invoiceForm.taxRate) : undefined,
      discountType: invoiceForm.discountValue ? invoiceForm.discountType : undefined,
      discountValue: invoiceForm.discountValue ? parseFloat(invoiceForm.discountValue) : undefined,
      notes: invoiceForm.notes || undefined,
    };

    if (editingInvoiceId) {
      const { data, error } = await updateInvoice({
        ...invoicePayload,
        invoiceId: editingInvoiceId,
      });
      if (error) { setFormError(error); toast.error("Failed to update invoice"); }
      if (data) {
        setInvoices((prev) => prev.map((inv) => inv.id === editingInvoiceId ? data : inv));
        resetInvoiceForm();
        setShowInvoiceBuilder(false);
        toast.success("Invoice updated");
      }
    } else {
      const { data, error } = await createInvoice(invoicePayload);
      if (error) { setFormError(error); toast.error("Failed to create invoice"); }
      if (data) {
        setInvoices((prev) => [data, ...prev]);
        resetInvoiceForm();
        setShowInvoiceBuilder(false);
        toast.success("Invoice created");
        emitEvent("commerce:invoice_created", "commerce", { invoiceId: data.id });
      }
    }
  }

  async function handleSendInvoice(invoiceId: string) {
    if (actionLoading[invoiceId]) return;
    setActionLoading((prev) => ({ ...prev, [invoiceId]: "send" }));
    try {
      const { data, error } = await updateInvoiceStatus(invoiceId, "SENT");
      if (!error && data) {
        setInvoices((prev) => prev.map((i) => (i.id === invoiceId ? { ...i, status: "SENT" } : i)));
        toast.success("Invoice sent");
        emitEvent("commerce:invoice_created", "commerce", { invoiceId, action: "sent" });
      } else {
        toast.error(error ?? "Failed to send invoice");
      }
    } finally {
      setActionLoading((prev) => { const next = { ...prev }; delete next[invoiceId]; return next; });
    }
  }

  async function handleMarkPaid(invoiceId: string, inv: Invoice) {
    if (actionLoading[invoiceId]) return;
    setActionLoading((prev) => ({ ...prev, [invoiceId]: "paid" }));
    try {
      const { data, error } = await markInvoicePaid(invoiceId);
      if (!error && data) {
        setInvoices((prev) => prev.map((i) => (i.id === invoiceId ? { ...i, status: data.status ?? "PAID" } : i)));
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("kf:invoicePaid", {
              detail: { invoiceNumber: data.invoiceNumber ?? inv.invoiceNumber, total: data.total, currency: data.currency, invoiceId },
            })
          );
        }
        toast.success("Invoice marked as paid");
        emitEvent("commerce:invoice_paid", "commerce", { invoiceId, total: data.total });
      } else {
        toast.error(error ?? "Failed to mark paid");
      }
    } finally {
      setActionLoading((prev) => { const next = { ...prev }; delete next[invoiceId]; return next; });
    }
  }

  function openPaymentModal(inv: Invoice) {
    const paidAmount = (inv.payments ?? [])
      .filter((p) => p.status === "SUCCESSFUL")
      .reduce((sum, p) => sum + p.amount, 0);
    const remaining = Math.max(0, Number(inv.total) - paidAmount);
    setPaymentForm({ amount: remaining.toFixed(2), method: "Cash", reference: "", notes: "" });
    setPaymentModal({ invoice: inv });
    if (businessId && !paymentHistory[inv.id]) {
      listInvoicePayments(businessId, inv.id).then((res) => {
        if (res.data) {
          setPaymentHistory((prev) => ({ ...prev, [inv.id]: res.data!.payments }));
        }
      });
    }
  }

  async function handleRecordPayment() {
    if (!businessId || !paymentModal || recordingPayment) return;
    const amount = parseFloat(paymentForm.amount);
    if (isNaN(amount) || amount <= 0) {
      toast.error("Enter a valid payment amount");
      return;
    }
    setRecordingPayment(true);
    try {
      const { data, error } = await recordInvoicePayment(businessId, paymentModal.invoice.id, {
        amount,
        method: paymentForm.method,
        reference: paymentForm.reference || undefined,
        notes: paymentForm.notes || undefined,
      });
      if (!error && data) {
        setInvoices((prev) => prev.map((i) => (i.id === paymentModal.invoice.id ? { ...data.invoice, payments: data.invoice.payments } : i)));
        setPaymentHistory((prev) => ({ ...prev, [paymentModal.invoice.id]: [data.payment, ...(prev[paymentModal.invoice.id] ?? [])] }));
        toast.success(data.invoice.status === "PAID" ? "Invoice fully paid!" : `Payment of ${formatAmount(amount, paymentModal.invoice.currency)} recorded`);
        setPaymentModal(null);
        if (data.invoice.status === "PAID") {
          emitEvent("commerce:invoice_paid", "commerce", { invoiceId: paymentModal.invoice.id, total: data.invoice.total });
        }
      } else {
        toast.error(error ?? "Failed to record payment");
      }
    } finally {
      setRecordingPayment(false);
    }
  }

  async function handleDeleteInvoice(invoiceId: string) {
    if (!businessId || actionLoading[invoiceId]) return;
    setConfirmState({
      open: true,
      action: async () => {
        setActionLoading((prev) => ({ ...prev, [invoiceId]: "delete" }));
        try {
          const { error } = await apiDelete(`/commerce/businesses/${businessId}/invoices/${invoiceId}`);
          if (!error) {
            setInvoices((prev) => prev.filter((i) => i.id !== invoiceId));
            if (selectedInvoice?.id === invoiceId) {
              setSelectedInvoice(null);
            }
            toast.success("Invoice deleted");
          } else {
            toast.error(error || "Failed to delete invoice");
          }
        } catch (e) {
          toast.error("Failed to delete invoice");
        } finally {
          setActionLoading((prev) => { const next = { ...prev }; delete next[invoiceId]; return next; });
        }
      },
    });
  }

  async function handleVoidInvoice(invoiceId: string) {
    if (actionLoading[invoiceId]) return;
    setActionLoading((prev) => ({ ...prev, [invoiceId]: "void" }));
    try {
      const { data, error } = await updateInvoiceStatus(invoiceId, "VOID");
      if (!error && data) {
        setInvoices((prev) => prev.map((i) => (i.id === invoiceId ? { ...i, status: "VOID" } : i)));
        if (selectedInvoice?.id === invoiceId) {
          setSelectedInvoice((prev) => prev ? { ...prev, status: "VOID" } : null);
        }
        toast.success("Invoice voided");
      } else {
        toast.error(error ?? "Failed to void invoice");
      }
    } finally {
      setActionLoading((prev) => { const next = { ...prev }; delete next[invoiceId]; return next; });
    }
  }

  function openReminderEmail(inv: Invoice) {
    setSelectedInvoice(inv);
    const contactName = inv.contact
      ? `${inv.contact.firstName ?? ""} ${inv.contact.lastName ?? ""}`.trim()
      : "there";
    setEmailForm({
      email: inv.contact?.email ?? "",
      message: `Hi ${contactName}, this is a friendly reminder that invoice ${inv.invoiceNumber ?? ""} for ${formatAmount(inv.total, inv.currency)} is ${inv.status === "OVERDUE" ? "overdue" : "awaiting payment"}. Please let us know if you have any questions.`,
    });
    setShowEmailModal(true);
  }

  async function handleSendInvoiceEmail() {
    if (!selectedInvoice || !businessId) return;
    const targetEmail = emailForm.email || selectedInvoice.contact?.email;
    if (!targetEmail) {
      setInvoiceError("Please enter an email address");
      return;
    }
    setSendingEmail(true);
    try {
      const res = await sendQuoteEmail({
        businessId,
        quoteId: selectedInvoice.id,
        recipientEmail: targetEmail,
        message: emailForm.message || `Please find attached your invoice ${selectedInvoice.invoiceNumber ?? ""} for ${formatAmount(selectedInvoice.total, selectedInvoice.currency)}.`,
      });
      if (res.data?.success) {
        setInvoices((prev) =>
          prev.map((i) => (i.id === selectedInvoice.id && i.status === "DRAFT" ? { ...i, status: "SENT" } : i))
        );
        setShowEmailModal(false);
        setEmailForm({ email: "", message: "" });
        setInvoiceError(null);
        toast.success("Invoice sent via email");
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
      key="invoices"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-4"
    >
      <BillingFormModal
        open={showInvoiceBuilder}
        onClose={() => { setShowInvoiceBuilder(false); resetInvoiceForm(); setFormError(null); }}
        onSubmit={handleCreateOrUpdateInvoice}
        docType="invoice"
        isEditing={!!editingInvoiceId}
        formError={formError}
        contacts={contacts}
        products={products}
        currency={currency}
        contactId={invoiceForm.contactId}
        onContactChange={(id) => setInvoiceForm((f: any) => ({ ...f, contactId: id }))}
        dateValue={invoiceForm.dueDate}
        onDateChange={(v) => setInvoiceForm((f: any) => ({ ...f, dueDate: v }))}
        items={invoiceForm.items}
        onAddItem={addInvoiceItem}
        onRemoveItem={removeInvoiceItem}
        onUpdateItem={updateInvoiceItem}
        onSelectProduct={selectProductForItem}
        taxRate={invoiceForm.taxRate}
        onTaxRateChange={(v) => setInvoiceForm((f: any) => ({ ...f, taxRate: v }))}
        discountType={invoiceForm.discountType}
        onDiscountTypeChange={(v) => setInvoiceForm((f: any) => ({ ...f, discountType: v }))}
        discountValue={invoiceForm.discountValue}
        onDiscountValueChange={(v) => setInvoiceForm((f: any) => ({ ...f, discountValue: v }))}
        notes={invoiceForm.notes}
        onNotesChange={(v) => setInvoiceForm((f: any) => ({ ...f, notes: v }))}
        onPaymentTermsChange={applyPaymentTerms}
      />

      {invoiceError && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 flex items-center justify-between"
        >
          <span>{invoiceError}</span>
          <button onClick={() => setInvoiceError(null)} className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-amber-500/20 rounded-lg transition-colors">
            <X className="w-4 h-4" />
          </button>
        </motion.div>
      )}

      <div className="rounded-2xl border border-border/50 bg-card p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
            <input
              type="text"
              placeholder="Search invoices..."
              value={invoiceSearch}
              onChange={(e) => setInvoiceSearch(e.target.value)}
              className="w-full pl-9 pr-8 py-1.5 text-sm bg-white/[0.03] border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/40 focus:border-[hsl(var(--kf-accent1))]/40 placeholder:text-muted-foreground/40 transition-all"
              aria-label="Search invoices"
            />
            {invoiceSearch && (
              <button
                onClick={() => setInvoiceSearch("")}
                className="absolute right-0 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md hover:bg-muted/50 transition-colors"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5 text-muted-foreground/40" />
              </button>
            )}
          </div>
          <div className="relative shrink-0">
            <ArrowUpDown className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as BillingSortKey)}
              className="appearance-none pl-7 pr-2 min-h-[44px] text-[11px] bg-white/[0.03] border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/40 text-muted-foreground cursor-pointer"
              aria-label="Sort invoices"
            >
              {BILLING_SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => setShowInvoiceBuilder(true)}
            className="inline-flex items-center gap-1.5 px-3 min-h-[44px] text-[11px] font-medium rounded-lg bg-gradient-to-r from-[hsl(var(--kf-accent1))]/15 to-[hsl(var(--kf-accent1))]/5 text-[hsl(var(--kf-accent1))] hover:from-[hsl(var(--kf-accent1))]/25 hover:to-[hsl(var(--kf-accent1))]/10 transition-all shrink-0"
            aria-label="New Invoice"
          >
            <FileText className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New Invoice</span>
          </button>
        </div>

        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none" role="group" aria-label="Filter by status">
          {INVOICE_STATUS_FILTERS.slice(0, 4).map((f) => {
            const count = statusCounts[f.value] ?? 0;
            const isActive = invoiceStatusFilter === f.value;
            return (
              <button
                key={f.value}
                onClick={() => setInvoiceStatusFilter(f.value)}
                className={`px-2.5 min-h-[44px] text-[11px] rounded-md transition-all inline-flex items-center gap-1.5 font-medium whitespace-nowrap shrink-0 ${
                  isActive
                    ? "bg-white/[0.08] border border-border/60 text-foreground"
                    : "bg-white/[0.02] border border-transparent text-muted-foreground/60 hover:bg-white/[0.05]"
                }`}
                aria-pressed={isActive}
              >
                {f.label}
                <span className={`text-[10px] font-mono px-1 py-0.5 rounded ${
                  isActive ? "bg-white/10" : "bg-white/[0.04] text-muted-foreground/50"
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
          {INVOICE_STATUS_FILTERS.length > 4 && (
            <select
              value={INVOICE_STATUS_FILTERS.slice(4).some((f) => f.value === invoiceStatusFilter) ? invoiceStatusFilter : ""}
              onChange={(e) => { if (e.target.value) setInvoiceStatusFilter(e.target.value); }}
              className={`appearance-none px-2 min-h-[44px] text-[11px] rounded-md font-medium shrink-0 cursor-pointer transition-all focus:outline-none ${
                INVOICE_STATUS_FILTERS.slice(4).some((f) => f.value === invoiceStatusFilter)
                  ? "bg-white/[0.08] border border-border/60 text-foreground"
                  : "bg-white/[0.02] border border-transparent text-muted-foreground/60 hover:bg-white/[0.05]"
              }`}
              aria-label="More status filters"
            >
              <option value="" disabled>More...</option>
              {INVOICE_STATUS_FILTERS.slice(4).map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label} ({statusCounts[f.value] ?? 0})
                </option>
              ))}
            </select>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground/50 whitespace-nowrap shrink-0 pl-2" aria-live="polite" role="status">
            {filteredInvoices.length} of {invoices.length}
          </span>
        </div>
      </div>

      {loading ? (
        <SkeletonList rows={5} cols={4} />
      ) : invoices.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-xl bg-white/[0.03] border border-border/50 flex items-center justify-center mb-4">
            <FileText className="w-7 h-7 text-muted-foreground/50" />
          </div>
          <h3 className="text-lg font-semibold mb-1">No invoices yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm mb-4">
            Create your first invoice to start billing clients and tracking payments.
          </p>
          <Button onClick={() => setShowInvoiceBuilder(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Create Your First Invoice
          </Button>
        </div>
      ) : filteredInvoices.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-xl bg-white/[0.03] border border-border/50 flex items-center justify-center mb-4">
            <Search className="w-7 h-7 text-muted-foreground/50" />
          </div>
          <h3 className="text-lg font-semibold mb-1">No matching invoices</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            No invoices match your filters. Try adjusting your search or status filter.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredInvoices.map((inv) => {
            const dueInfo = getDaysUntilDue(inv.dueDate);
            const smartCTA = getInvoiceSmartCTA(inv.status);
            const SmartIcon = smartCTA.icon;

            const handleSmartAction = () => {
              switch (smartCTA.actionKey) {
                case "finish":
                  setEditingInvoiceId(inv.id);
                  setInvoiceForm({
                    contactId: inv.contactId || "",
                    dueDate: inv.dueDate ? inv.dueDate.split("T")[0] : "",
                    items: (inv.items ?? []).map((item: any) => ({
                      id: item.id,
                      productId: item.productId ?? "",
                      description: item.description,
                      quantity: String(item.quantity),
                      unitPrice: String(item.unitPrice),
                    })),
                    taxRate: String(inv.taxRate || 0),
                    discountType: (inv.discountType as "PERCENT" | "FIXED") || "PERCENT",
                    discountValue: inv.discountValue ? String(inv.discountValue) : "",
                    notes: inv.notes || "",
                  });
                  setShowInvoiceBuilder(true);
                  break;
                case "remind":
                  openReminderEmail(inv);
                  break;
                case "collect":
                  openPaymentModal(inv);
                  break;
                case "view_receipt":
                case "view":
                  setSelectedInvoice(inv);
                  break;
                case "record_payment":
                  openPaymentModal(inv);
                  break;
              }
            };

            const cardBadges = (
              <>
                {dueInfo && inv.status !== "PAID" && (
                  <span className={`text-[10px] font-medium ${dueInfo.color}`}>{dueInfo.label}</span>
                )}
                {renderTimelineBadge?.(inv)}
              </>
            );

            const paidAmount = (inv.payments ?? []).filter((p) => p.status === "SUCCESSFUL").reduce((sum, p) => sum + p.amount, 0);
            const paymentPercent = Number(inv.total) > 0 ? Math.round((paidAmount / Number(inv.total)) * 100) : 0;

            return (
              <div key={inv.id}>
                <RecordRowCard
                  type="invoice"
                  number={inv.invoiceNumber ?? inv.id.slice(0, 8)}
                  status={inv.status}
                  contact={inv.contact ?? null}
                  total={Number(inv.total)}
                  currency={inv.currency}
                  items={inv.items ?? []}
                  date={inv.issueDate ?? ""}
                  badges={cardBadges}
                  selected={selectedInvoice?.id === inv.id}
                  onClick={() => setSelectedInvoice(inv)}
                  smartCTA={
                    <button
                      onClick={handleSmartAction}
                      disabled={!!actionLoading[inv.id]}
                      className={`inline-flex items-center gap-1 px-2.5 min-w-[44px] min-h-[44px] justify-center rounded-lg text-[11px] font-medium transition-all disabled:opacity-50 ${smartCTA.bgColor} ${smartCTA.color} ${smartCTA.hoverBgColor}`}
                    >
                      {actionLoading[inv.id] ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <SmartIcon className="w-3 h-3" />
                      )}
                      <span className="hidden sm:inline">{smartCTA.label}</span>
                    </button>
                  }
                  overflowMenu={
                    <OverflowMenu>
                      <OverflowMenuItem icon={Eye} label="View details" onClick={() => setSelectedInvoice(inv)} />
                      <OverflowMenuItem
                        icon={Pencil}
                        label="Edit"
                        onClick={() => {
                          setEditingInvoiceId(inv.id);
                          setInvoiceForm({
                            contactId: inv.contactId || "",
                            dueDate: inv.dueDate ? inv.dueDate.split("T")[0] : "",
                            items: (inv.items ?? []).map((item: any) => ({
                              id: item.id,
                              productId: item.productId ?? "",
                              description: item.description,
                              quantity: String(item.quantity),
                              unitPrice: String(item.unitPrice),
                            })),
                            taxRate: String(inv.taxRate || 0),
                            discountType: (inv.discountType as "PERCENT" | "FIXED") || "PERCENT",
                            discountValue: inv.discountValue ? String(inv.discountValue) : "",
                            notes: inv.notes || "",
                          });
                          setShowInvoiceBuilder(true);
                        }}
                      />
                      <OverflowMenuItem icon={Files} label="Duplicate" onClick={() => duplicateInvoice(inv)} />
                      <OverflowMenuItem icon={MessageCircle} label="Share via WhatsApp" onClick={() => shareViaWhatsApp(inv)} />
                      {gmailStatus?.connected && (
                        <OverflowMenuItem icon={Mail} label="Send via email" onClick={() => { setSelectedInvoice(inv); setShowEmailModal(true); }} />
                      )}
                      {(inv.status === "SENT" || inv.status === "OVERDUE") && gmailStatus?.connected && (
                        <OverflowMenuItem icon={Bell} label="Send reminder" onClick={() => openReminderEmail(inv)} />
                      )}
                      {inv.status === "DRAFT" && (
                        <OverflowMenuItem icon={Send} label="Mark as sent" onClick={() => handleSendInvoice(inv.id)} disabled={!!actionLoading[inv.id]} />
                      )}
                      {(inv.status === "SENT" || inv.status === "OVERDUE" || inv.status === "PARTIALLY_PAID") && (
                        <OverflowMenuItem icon={DollarSign} label="Record payment" onClick={() => openPaymentModal(inv)} />
                      )}
                      {(inv.status === "DRAFT" || inv.status === "SENT") && (
                        <OverflowMenuItem icon={CheckCircle} label="Mark paid" onClick={() => handleMarkPaid(inv.id, inv)} disabled={!!actionLoading[inv.id]} />
                      )}
                      {(inv.status === "DRAFT" || inv.status === "SENT" || inv.status === "OVERDUE" || inv.status === "PARTIALLY_PAID") && (
                        <OverflowMenuItem icon={Ban} label="Void invoice" onClick={() => handleVoidInvoice(inv.id)} disabled={!!actionLoading[inv.id]} />
                      )}
                      <OverflowMenuItem icon={Trash2} label="Delete" onClick={() => handleDeleteInvoice(inv.id)} destructive disabled={!!actionLoading[inv.id]} />
                    </OverflowMenu>
                  }
                />
                {(inv.status === "PARTIALLY_PAID" || (paidAmount > 0 && inv.status !== "PAID")) && (
                  <div className="mt-1.5 mx-4">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[9px] text-muted-foreground/50">Paid: {formatAmount(paidAmount, inv.currency)}</span>
                      <span className="text-[9px] text-muted-foreground/50">{paymentPercent}%</span>
                    </div>
                    <div className="h-1 w-full rounded-full bg-border/30 overflow-hidden">
                      <div className="h-full rounded-full bg-amber-400 transition-all duration-300" style={{ width: `${paymentPercent}%` }} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {selectedInvoice && !showEmailModal && (
          <BillingDetailModal
            type="invoice"
            number={selectedInvoice.invoiceNumber ?? selectedInvoice.id.slice(0, 8)}
            status={selectedInvoice.status}
            contact={selectedInvoice.contact ?? null}
            contactId={selectedInvoice.contactId ?? null}
            total={Number(selectedInvoice.total)}
            currency={selectedInvoice.currency}
            items={selectedInvoice.items ?? []}
            dateLabel1="Issue Date"
            dateValue1={selectedInvoice.issueDate ?? null}
            dateLabel2="Due Date"
            dateValue2={selectedInvoice.dueDate ?? null}
            taxRate={Number(selectedInvoice.taxRate || 0)}
            discountType={selectedInvoice.discountType}
            discountValue={selectedInvoice.discountValue ? Number(selectedInvoice.discountValue) : undefined}
            notes={selectedInvoice.notes}
            allInvoices={invoices.map((inv) => ({ id: inv.id, contactId: inv.contactId, status: inv.status, total: Number(inv.total), invoiceNumber: inv.invoiceNumber, dueDate: inv.dueDate }))}
            onClose={() => setSelectedInvoice(null)}
            businessData={businessData}
            onSaveBranding={saveBranding}
            savingBranding={savingBranding}
            onViewContact={onViewContact}
            onViewClientIntel={onViewClientIntel}
            onSelectProduct={onSelectProduct}
            onAiDraftReminder={onAiDraftReminder}
            actions={
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-0.5">
                    <button onClick={() => copyPaymentLink(selectedInvoice.id)} className="p-2 rounded-lg hover:bg-white/[0.06] transition-colors" title={copiedLink === selectedInvoice.id ? "Copied!" : "Copy payment link"}>
                      <Link className={`w-4 h-4 ${copiedLink === selectedInvoice.id ? "text-emerald-400" : "text-slate-400"}`} />
                    </button>
                    <button onClick={() => duplicateInvoice(selectedInvoice)} className="p-2 rounded-lg hover:bg-white/[0.06] transition-colors" title="Duplicate invoice">
                      <Files className="w-4 h-4 text-slate-400" />
                    </button>
                    <div className="w-px h-4 bg-border/30 mx-0.5" />
                    <button onClick={() => shareViaWhatsApp(selectedInvoice)} className="p-2 rounded-lg hover:bg-emerald-500/10 transition-colors" title="Share via WhatsApp">
                      <MessageCircle className="w-4 h-4 text-emerald-400" />
                    </button>
                    {gmailStatus?.connected && (
                      <button onClick={() => setShowEmailModal(true)} className="p-2 rounded-lg hover:bg-blue-500/10 transition-colors" title="Send via email">
                        <Mail className="w-4 h-4 text-blue-400" />
                      </button>
                    )}
                    {(selectedInvoice.status === "SENT" || selectedInvoice.status === "OVERDUE") && gmailStatus?.connected && (
                      <button onClick={() => openReminderEmail(selectedInvoice)} className="p-2 rounded-lg hover:bg-amber-500/10 transition-colors" title="Send payment reminder">
                        <Bell className="w-4 h-4 text-amber-400" />
                      </button>
                    )}
                  </div>
                  {(selectedInvoice.status === "DRAFT" || selectedInvoice.status === "SENT" || selectedInvoice.status === "OVERDUE" || selectedInvoice.status === "PARTIALLY_PAID") && (
                    <button onClick={() => handleVoidInvoice(selectedInvoice.id)} disabled={!!actionLoading[selectedInvoice.id]} className="p-2 rounded-lg hover:bg-red-500/10 transition-colors" title="Void invoice">
                      {actionLoading[selectedInvoice.id] === "void" ? <Loader2 className="w-4 h-4 animate-spin text-slate-500" /> : <Ban className="w-4 h-4 text-slate-500" />}
                    </button>
                  )}
                </div>
                {selectedInvoice.status === "DRAFT" && (
                  <div className="flex gap-2">
                    <Button size="sm" className="gap-1.5 flex-1" onClick={() => { handleSendInvoice(selectedInvoice.id); setSelectedInvoice(null); }} disabled={!!actionLoading[selectedInvoice.id]}>
                      {actionLoading[selectedInvoice.id] === "send" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send Invoice
                    </Button>
                    <Button size="sm" className="gap-1.5 flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => { handleMarkPaid(selectedInvoice.id, selectedInvoice); setSelectedInvoice(null); }} disabled={!!actionLoading[selectedInvoice.id]}>
                      {actionLoading[selectedInvoice.id] === "paid" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />} Mark Paid
                    </Button>
                  </div>
                )}
                {(selectedInvoice.status === "SENT" || selectedInvoice.status === "OVERDUE" || selectedInvoice.status === "PARTIALLY_PAID") && (
                  <div className="flex gap-2">
                    <Button size="sm" className="gap-1.5 flex-1 bg-amber-600 hover:bg-amber-700" onClick={() => { openPaymentModal(selectedInvoice); setSelectedInvoice(null); }}>
                      <DollarSign className="w-3.5 h-3.5" /> Record Payment
                    </Button>
                    <Button size="sm" className="gap-1.5 flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => { handleMarkPaid(selectedInvoice.id, selectedInvoice); setSelectedInvoice(null); }} disabled={!!actionLoading[selectedInvoice.id]}>
                      {actionLoading[selectedInvoice.id] === "paid" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />} Mark Paid
                    </Button>
                  </div>
                )}
              </>
            }
          />
        )}

        {showEmailModal && selectedInvoice && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={(e) => e.target === e.currentTarget && setShowEmailModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md bg-card rounded-2xl border border-border shadow-2xl p-6 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Mail className="w-5 h-5 text-blue-400" /> Send Invoice via Email
                </h3>
                <button onClick={() => setShowEmailModal(false)} className="p-1.5 rounded-lg hover:bg-muted">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-sm text-muted-foreground">
                Sending invoice <span className="font-mono text-foreground">{selectedInvoice.invoiceNumber}</span> for{" "}
                {formatAmount(selectedInvoice.total, selectedInvoice.currency)}
              </p>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Recipient Email</label>
                <input
                  type="email"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder={selectedInvoice.contact?.email || "Enter email address"}
                  value={emailForm.email}
                  onChange={(e) => setEmailForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Message (optional)</label>
                <textarea
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[80px] resize-none"
                  placeholder="Add a personal message..."
                  value={emailForm.message}
                  onChange={(e) => setEmailForm((f) => ({ ...f, message: e.target.value }))}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowEmailModal(false)}>Cancel</Button>
                <Button onClick={handleSendInvoiceEmail} disabled={sendingEmail} className="gap-2">
                  <Send className="w-4 h-4" /> {sendingEmail ? "Sending..." : "Send Email"}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {paymentModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => e.target === e.currentTarget && setPaymentModal(null)}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="w-full max-w-md bg-card rounded-2xl border border-border shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-amber-400" /> Record Payment
              </h3>
              <button onClick={() => setPaymentModal(null)} className="p-1.5 rounded-lg hover:bg-muted">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-xl border border-border/40 bg-white/[0.02] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Invoice</span>
                <span className="text-sm font-mono font-medium">{paymentModal.invoice.invoiceNumber ?? paymentModal.invoice.id.slice(0, 8)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Total</span>
                <span className="text-sm font-semibold">{formatAmount(paymentModal.invoice.total, paymentModal.invoice.currency)}</span>
              </div>
              {(() => {
                const paid = (paymentModal.invoice.payments ?? []).filter((p) => p.status === "SUCCESSFUL").reduce((s, p) => s + p.amount, 0);
                const rem = Math.max(0, Number(paymentModal.invoice.total) - paid);
                const pct = Number(paymentModal.invoice.total) > 0 ? Math.round((paid / Number(paymentModal.invoice.total)) * 100) : 0;
                return (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Already Paid</span>
                      <span className="text-sm font-medium text-emerald-400">{formatAmount(paid, paymentModal.invoice.currency)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Remaining</span>
                      <span className="text-sm font-bold text-amber-400">{formatAmount(rem, paymentModal.invoice.currency)}</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-border/30 overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-400 transition-all duration-300" style={{ width: `${pct}%` }} />
                    </div>
                  </>
                );
              })()}
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Amount</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="Payment amount"
                value={paymentForm.amount}
                onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Payment Method</label>
              <select
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={paymentForm.method}
                onChange={(e) => setPaymentForm((f) => ({ ...f, method: e.target.value }))}
              >
                <option value="Cash">Cash</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="WiPay">WiPay</option>
                <option value="PayPal">PayPal</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Reference Number (optional)</label>
              <input
                type="text"
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="Transaction reference"
                value={paymentForm.reference}
                onChange={(e) => setPaymentForm((f) => ({ ...f, reference: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Notes (optional)</label>
              <input
                type="text"
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="Payment notes"
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>

            {paymentHistory[paymentModal.invoice.id]?.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-2">Payment History</p>
                <div className="space-y-1.5 max-h-[120px] overflow-y-auto">
                  {paymentHistory[paymentModal.invoice.id].map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-white/[0.02] border border-border/20">
                      <div className="flex items-center gap-2 min-w-0">
                        <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span className="text-[11px] truncate">{p.provider}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] font-medium">{formatAmount(p.amount, p.currency)}</span>
                        <span className="text-[10px] text-muted-foreground/40">{new Date(p.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setPaymentModal(null)}>Cancel</Button>
              <Button onClick={handleRecordPayment} disabled={recordingPayment} className="gap-2 bg-amber-600 hover:bg-amber-700">
                {recordingPayment ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
                {recordingPayment ? "Recording..." : "Record Payment"}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}

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
