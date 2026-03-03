"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
  Copy,
  Plus,
  DollarSign,
  User,
  Calendar,
  CreditCard,
  MessageCircle,
  Mail,
  Clock,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import {
  createProduct,
  createInvoice,
  updateInvoice,
  markInvoicePaid,
  updateInvoiceStatus,
  sendQuoteEmail,
  Product,
  Invoice,
  Contact,
} from "@/lib/client";
import { apiDelete } from "@/lib/api";
import { useModuleEmit } from "@/hooks/use-module-events";
import { ContactSelect } from "@/components/contacts";
import {
  INVOICE_STATUS_FILTERS,
  InvoiceLineItem,
  InvoiceFormState,
  PAYMENT_TERMS,
  getStatusBadge,
  generateItemId,
  getDueDateFromTerms,
} from "../components/commerce-types";
import LineItemsEditor from "../components/line-items-editor";
import { useInvoiceForm } from "../hooks/use-invoice-form";

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
}: InvoicesPanelProps) {
  const {
    showInvoiceBuilder,
    setShowInvoiceBuilder,
    editingInvoiceId,
    setEditingInvoiceId,
    invoiceForm,
    setInvoiceForm,
    resetInvoiceForm,
  } = useInvoiceForm();
  const emitEvent = useModuleEmit();

  const prevTriggerNew = useRef(triggerNew);
  useEffect(() => {
    if (triggerNew !== undefined && triggerNew !== prevTriggerNew.current) {
      prevTriggerNew.current = triggerNew;
      resetInvoiceForm();
      setShowInvoiceBuilder(true);
    }
  }, [triggerNew, resetInvoiceForm, setShowInvoiceBuilder]);
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<string>("ALL");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailForm, setEmailForm] = useState({ email: "", message: "" });
  const [sendingEmail, setSendingEmail] = useState(false);
  const [confirmState, setConfirmState] = useState<{open: boolean; action: () => void}>({open: false, action: () => {}});
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: invoices.length, DRAFT: 0, SENT: 0, PAID: 0, OVERDUE: 0 };
    for (const inv of invoices) {
      if (inv.status && counts[inv.status] !== undefined) counts[inv.status]++;
    }
    return counts;
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    let result = invoices;
    if (invoiceStatusFilter !== "ALL") {
      result = result.filter((inv) => inv.status === invoiceStatusFilter);
    }
    if (invoiceSearch.trim()) {
      const q = invoiceSearch.toLowerCase();
      result = result.filter(
        (inv) =>
          (inv.invoiceNumber ?? "").toLowerCase().includes(q) ||
          (inv.contact?.firstName ?? "").toLowerCase().includes(q) ||
          (inv.contact?.lastName ?? "").toLowerCase().includes(q) ||
          (inv.contact?.email ?? "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [invoices, invoiceStatusFilter, invoiceSearch]);

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
    const msg = `Hi ${contactName}, here is your invoice ${inv.invoiceNumber ?? ""} for ${inv.currency} ${Number(inv.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}. You can view and pay it here: ${link}`;
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
        emitEvent("billing:invoice_created", "commerce", { invoiceId: data.id });
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
        emitEvent("billing:invoice_sent", "commerce", { invoiceId });
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
        emitEvent("billing:invoice_paid", "commerce", { invoiceId, total: data.total });
      } else {
        toast.error(error ?? "Failed to mark paid");
      }
    } finally {
      setActionLoading((prev) => { const next = { ...prev }; delete next[invoiceId]; return next; });
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
        message: emailForm.message || `Please find attached your invoice ${selectedInvoice.invoiceNumber ?? ""} for ${selectedInvoice.currency} ${Number(selectedInvoice.total).toLocaleString()}.`,
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

  function getDaysUntilDue(dueDate: string | null | undefined): { days: number; label: string; color: string } | null {
    if (!dueDate) return null;
    const due = new Date(dueDate);
    const now = new Date();
    const diff = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return { days: Math.abs(diff), label: `${Math.abs(diff)}d overdue`, color: "text-red-400" };
    if (diff === 0) return { days: 0, label: "Due today", color: "text-amber-400" };
    if (diff <= 7) return { days: diff, label: `Due in ${diff}d`, color: "text-amber-400" };
    return { days: diff, label: `Due in ${diff}d`, color: "text-muted-foreground" };
  }

  return (
    <motion.div
      key="invoices"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-4"
    >
      <AnimatePresence>
        {showInvoiceBuilder && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-2xl border border-primary/30 bg-card/80 backdrop-blur-sm p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold flex items-center gap-2">
                  <FileText className="w-5 h-5 text-primary" /> {editingInvoiceId ? "Edit Invoice" : "Create Invoice"}
                </h3>
                <button onClick={() => { setShowInvoiceBuilder(false); resetInvoiceForm(); setFormError(null); }} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {formError && <div className="text-xs text-amber-400 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2">{formError}</div>}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <ContactSelect
                  value={invoiceForm.contactId}
                  onChange={(id) => setInvoiceForm((f: any) => ({ ...f, contactId: id }))}
                  contacts={contacts}
                  label="Contact (optional)"
                />
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Payment Terms</label>
                  <select
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    defaultValue=""
                    onChange={(e) => applyPaymentTerms(e.target.value)}
                  >
                    <option value="" disabled>Select terms...</option>
                    {PAYMENT_TERMS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <Input
                  label="Due Date"
                  type="date"
                  value={invoiceForm.dueDate}
                  onChange={(e) => setInvoiceForm((f: any) => ({ ...f, dueDate: e.target.value }))}
                />
              </div>

              <LineItemsEditor
                items={invoiceForm.items}
                products={products.filter((p) => p.isActive !== false)}
                onAddItem={addInvoiceItem}
                onRemoveItem={removeInvoiceItem}
                onUpdateItem={updateInvoiceItem}
                onSelectProduct={selectProductForItem}
                taxRate={invoiceForm.taxRate}
                discountType={invoiceForm.discountType}
                discountValue={invoiceForm.discountValue}
                onTaxRateChange={(v) => setInvoiceForm((f: any) => ({ ...f, taxRate: v }))}
                onDiscountTypeChange={(v) => setInvoiceForm((f: any) => ({ ...f, discountType: v }))}
                onDiscountValueChange={(v) => setInvoiceForm((f: any) => ({ ...f, discountValue: v }))}
                notes={invoiceForm.notes}
                onNotesChange={(v) => setInvoiceForm((f: any) => ({ ...f, notes: v }))}
                currency={currency}
              />

              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => { setShowInvoiceBuilder(false); resetInvoiceForm(); setFormError(null); }}>
                  Cancel
                </Button>
                <Button onClick={handleCreateOrUpdateInvoice}>{editingInvoiceId ? "Update Invoice" : "Create Invoice"}</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {invoiceError && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 flex items-center justify-between"
        >
          <span>{invoiceError}</span>
          <button onClick={() => setInvoiceError(null)} className="p-1 hover:bg-amber-500/20 rounded-lg transition-colors">
            <X className="w-3.5 h-3.5" />
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
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-md hover:bg-muted/50 transition-colors"
                aria-label="Clear search"
              >
                <X className="w-3 h-3 text-muted-foreground/40" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowInvoiceBuilder(true)}
            className="inline-flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium rounded-lg bg-gradient-to-r from-[hsl(var(--kf-accent1))]/15 to-[hsl(var(--kf-accent1))]/5 text-[hsl(var(--kf-accent1))] hover:from-[hsl(var(--kf-accent1))]/25 hover:to-[hsl(var(--kf-accent1))]/10 transition-all shrink-0"
            aria-label="New Invoice"
          >
            <FileText className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New Invoice</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none" role="group" aria-label="Filter by status">
          {INVOICE_STATUS_FILTERS.map((f) => {
            const count = statusCounts[f.value] ?? 0;
            return (
              <button
                key={f.value}
                onClick={() => setInvoiceStatusFilter(f.value)}
                className={`px-2.5 py-1 text-[11px] rounded-md transition-all inline-flex items-center gap-1.5 font-medium whitespace-nowrap shrink-0 ${
                  invoiceStatusFilter === f.value
                    ? "bg-white/[0.08] border border-border/60 text-foreground"
                    : "bg-white/[0.02] border border-transparent text-muted-foreground/60 hover:bg-white/[0.05]"
                }`}
                aria-pressed={invoiceStatusFilter === f.value}
              >
                {f.label}
                <span className={`text-[10px] font-mono px-1 py-0.5 rounded ${
                  invoiceStatusFilter === f.value ? "bg-white/10" : "bg-white/[0.04] text-muted-foreground/50"
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
          <span className="ml-auto text-[10px] text-muted-foreground/50 whitespace-nowrap shrink-0 pl-2">
            {filteredInvoices.length} of {invoices.length}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-muted/30 rounded-xl border border-border/50" />
          ))}
        </div>
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
        <>
          <div className="hidden md:block rounded-xl border border-border/50 overflow-hidden">
            <table className="w-full">
              <thead className="bg-white/[0.02] border-b border-border/40">
                <tr>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Invoice</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Contact</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Amount</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Due</th>
                  <th className="px-4 py-3 text-left text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-right text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filteredInvoices.map((inv) => {
                  const dueInfo = getDaysUntilDue(inv.dueDate);
                  return (
                    <tr key={inv.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setSelectedInvoice(inv)}
                          className="font-mono text-sm text-primary hover:underline"
                        >
                          {inv.invoiceNumber ?? inv.id.slice(0, 8)}
                        </button>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {inv.issueDate ? new Date(inv.issueDate).toLocaleDateString() : ""}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm">
                          {inv.contact
                            ? `${inv.contact.firstName ?? ""} ${inv.contact.lastName ?? ""}`.trim() || inv.contact.email || "—"
                            : "—"}
                        </div>
                        {inv.contact?.email && (
                          <div className="text-xs text-muted-foreground truncate max-w-[160px]">{inv.contact.email}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-semibold">{inv.currency} {Number(inv.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </td>
                      <td className="px-4 py-3">
                        {dueInfo && inv.status !== "PAID" ? (
                          <span className={`text-xs font-medium ${dueInfo.color}`}>{dueInfo.label}</span>
                        ) : inv.dueDate ? (
                          <span className="text-xs text-muted-foreground">{new Date(inv.dueDate).toLocaleDateString()}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${getStatusBadge(inv.status)}`}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => setSelectedInvoice(inv)} className="p-1.5 rounded-lg hover:bg-muted transition-colors" title="View details">
                            <Eye className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                          </button>
                          <button
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
                            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                            title="Edit invoice"
                          >
                            <Pencil className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                          </button>
                          <button onClick={() => duplicateInvoice(inv)} className="p-1.5 rounded-lg hover:bg-muted transition-colors" title="Duplicate invoice">
                            <Copy className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                          </button>
                          <button onClick={() => shareViaWhatsApp(inv)} className="p-1.5 rounded-lg hover:bg-green-500/20 transition-colors" title="Share via WhatsApp">
                            <MessageCircle className="w-4 h-4 text-green-400" />
                          </button>
                          {gmailStatus?.connected && (
                            <button
                              onClick={() => { setSelectedInvoice(inv); setShowEmailModal(true); }}
                              className="p-1.5 rounded-lg hover:bg-blue-500/20 transition-colors"
                              title="Send via email"
                            >
                              <Mail className="w-4 h-4 text-blue-400" />
                            </button>
                          )}
                          {inv.status === "DRAFT" && (
                            <Button variant="outline" className="px-2.5 py-1 text-xs gap-1" onClick={() => handleSendInvoice(inv.id)} disabled={!!actionLoading[inv.id]}>
                              {actionLoading[inv.id] === "send" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Send
                            </Button>
                          )}
                          {(inv.status === "DRAFT" || inv.status === "SENT") && (
                            <Button variant="outline" className="px-2.5 py-1 text-xs gap-1" onClick={() => handleMarkPaid(inv.id, inv)} disabled={!!actionLoading[inv.id]}>
                              {actionLoading[inv.id] === "paid" ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />} Paid
                            </Button>
                          )}
                          <button onClick={() => handleDeleteInvoice(inv.id)} className="p-1.5 rounded-lg hover:bg-red-500/20 transition-colors disabled:opacity-50" title="Delete invoice" disabled={!!actionLoading[inv.id]}>
                            {actionLoading[inv.id] === "delete" ? <Loader2 className="w-4 h-4 text-red-400 animate-spin" /> : <Trash2 className="w-4 h-4 text-red-400 hover:text-red-300" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {filteredInvoices.map((inv) => {
              const dueInfo = getDaysUntilDue(inv.dueDate);
              return (
                <div key={inv.id} className="rounded-xl border border-border/50 bg-card p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <button onClick={() => setSelectedInvoice(inv)} className="font-mono text-xs text-primary hover:underline">
                      {inv.invoiceNumber ?? inv.id.slice(0, 8)}
                    </button>
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusBadge(inv.status)}`}>
                      {inv.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">
                      {inv.contact ? `${inv.contact.firstName ?? ""} ${inv.contact.lastName ?? ""}`.trim() || "—" : "—"}
                    </span>
                    <span className="font-semibold">{inv.currency} {Number(inv.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{inv.issueDate ? new Date(inv.issueDate).toLocaleDateString() : ""}</span>
                    {dueInfo && inv.status !== "PAID" && <span className={dueInfo.color}>{dueInfo.label}</span>}
                  </div>
                  <div className="flex items-center gap-1 pt-2 border-t border-border/40 flex-wrap">
                    <button onClick={() => setSelectedInvoice(inv)} className="p-1.5 rounded-lg hover:bg-muted" title="View"><Eye className="w-4 h-4 text-muted-foreground" /></button>
                    <button onClick={() => duplicateInvoice(inv)} className="p-1.5 rounded-lg hover:bg-muted" title="Duplicate"><Copy className="w-4 h-4 text-muted-foreground" /></button>
                    <button onClick={() => shareViaWhatsApp(inv)} className="p-1.5 rounded-lg hover:bg-green-500/20" title="WhatsApp"><MessageCircle className="w-4 h-4 text-green-400" /></button>
                    {inv.status === "DRAFT" && (
                      <button onClick={() => handleSendInvoice(inv.id)} className="px-2 py-1 rounded-lg bg-primary/20 text-primary text-xs font-medium disabled:opacity-50 flex items-center gap-1" disabled={!!actionLoading[inv.id]}>
                        {actionLoading[inv.id] === "send" ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Send
                      </button>
                    )}
                    {(inv.status === "DRAFT" || inv.status === "SENT") && (
                      <button onClick={() => handleMarkPaid(inv.id, inv)} className="px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-medium disabled:opacity-50 flex items-center gap-1" disabled={!!actionLoading[inv.id]}>
                        {actionLoading[inv.id] === "paid" ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Paid
                      </button>
                    )}
                    <button onClick={() => handleDeleteInvoice(inv.id)} className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400 ml-auto disabled:opacity-50" title="Delete" disabled={!!actionLoading[inv.id]}>
                      {actionLoading[inv.id] === "delete" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <AnimatePresence>
        {selectedInvoice && !showEmailModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={(e) => e.target === e.currentTarget && setSelectedInvoice(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-lg bg-card rounded-2xl border border-border shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="p-5 border-b border-border flex items-center justify-between">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <FileText className="w-5 h-5 text-primary" />
                  Invoice {selectedInvoice.invoiceNumber ?? selectedInvoice.id.slice(0, 8)}
                </h2>
                <button onClick={() => setSelectedInvoice(null)} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5 space-y-5">
                <div className="flex items-center justify-between">
                  <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-medium ${getStatusBadge(selectedInvoice.status)}`}>
                    {selectedInvoice.status}
                  </span>
                  <span className="text-2xl font-bold text-primary">
                    {selectedInvoice.currency} {Number(selectedInvoice.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>

                {selectedInvoice.contact && (
                  <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/30 border border-border/40">
                    <User className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="font-medium">
                        {`${selectedInvoice.contact.firstName ?? ""} ${selectedInvoice.contact.lastName ?? ""}`.trim() || "Unknown"}
                      </p>
                      {selectedInvoice.contact.email && (
                        <p className="text-sm text-muted-foreground">{selectedInvoice.contact.email}</p>
                      )}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="p-3 rounded-xl bg-muted/20 border border-border/40">
                    <p className="text-xs text-muted-foreground mb-1">Issue Date</p>
                    <p className="font-medium flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      {selectedInvoice.issueDate ? new Date(selectedInvoice.issueDate).toLocaleDateString() : "—"}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-muted/20 border border-border/40">
                    <p className="text-xs text-muted-foreground mb-1">Due Date</p>
                    <p className="font-medium flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      {selectedInvoice.dueDate ? new Date(selectedInvoice.dueDate).toLocaleDateString() : "—"}
                    </p>
                  </div>
                </div>

                {selectedInvoice.items && selectedInvoice.items.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground">Line Items</h4>
                    <div className="rounded-xl border border-border/60 overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/30 border-b border-border/40">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Description</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Qty</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Price</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                          {selectedInvoice.items.map((item: any, idx: number) => (
                            <tr key={item.id ?? idx}>
                              <td className="px-3 py-2">{item.description}</td>
                              <td className="px-3 py-2 text-right">{item.quantity}</td>
                              <td className="px-3 py-2 text-right">{Number(item.unitPrice).toLocaleString()}</td>
                              <td className="px-3 py-2 text-right font-medium">{Number(item.total).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {selectedInvoice.notes && (
                  <div className="p-3 rounded-xl bg-muted/20 border border-border/40">
                    <p className="text-xs text-muted-foreground mb-1">Notes</p>
                    <p className="text-sm">{selectedInvoice.notes}</p>
                  </div>
                )}

                <div className="pt-4 border-t border-border/40 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" className="gap-2 flex-1" onClick={() => copyPaymentLink(selectedInvoice.id)}>
                      <Copy className={`w-4 h-4 ${copiedLink === selectedInvoice.id ? "text-emerald-400" : ""}`} />
                      {copiedLink === selectedInvoice.id ? "Copied!" : "Copy Link"}
                    </Button>
                    <Button variant="outline" className="gap-2 flex-1" onClick={() => duplicateInvoice(selectedInvoice)}>
                      <Copy className="w-4 h-4" /> Duplicate
                    </Button>
                    <Button variant="outline" className="gap-2 flex-1" onClick={() => shareViaWhatsApp(selectedInvoice)}>
                      <MessageCircle className="w-4 h-4 text-green-400" /> WhatsApp
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {gmailStatus?.connected && (
                      <Button variant="outline" className="gap-2 flex-1" onClick={() => setShowEmailModal(true)}>
                        <Mail className="w-4 h-4 text-blue-400" /> Email
                      </Button>
                    )}
                    {selectedInvoice.status === "DRAFT" && (
                      <Button className="gap-2 flex-1" onClick={() => { handleSendInvoice(selectedInvoice.id); setSelectedInvoice(null); }} disabled={!!actionLoading[selectedInvoice.id]}>
                        {actionLoading[selectedInvoice.id] === "send" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send Invoice
                      </Button>
                    )}
                    {(selectedInvoice.status === "DRAFT" || selectedInvoice.status === "SENT") && (
                      <Button className="gap-2 flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => { handleMarkPaid(selectedInvoice.id, selectedInvoice); setSelectedInvoice(null); }} disabled={!!actionLoading[selectedInvoice.id]}>
                        {actionLoading[selectedInvoice.id] === "paid" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} Mark Paid
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
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
                {selectedInvoice.currency} {Number(selectedInvoice.total).toLocaleString()}
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
