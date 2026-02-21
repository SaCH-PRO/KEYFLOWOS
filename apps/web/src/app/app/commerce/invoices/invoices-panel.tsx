"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
  Copy,
  Plus,
  Minus,
  DollarSign,
  User,
  Calendar,
  CreditCard,
  MessageCircle,
  Mail,
  Clock,
  AlertTriangle,
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
import {
  INVOICE_STATUS_FILTERS,
  InvoiceLineItem,
  CATEGORIES,
  PAYMENT_TERMS,
  getStatusBadge,
  generateItemId,
  getDueDateFromTerms,
} from "../components/commerce-types";

interface InvoicesPanelProps {
  invoices: Invoice[];
  contacts: Contact[];
  products: Product[];
  businessId: string | null;
  loading: boolean;
  showInvoiceBuilder: boolean;
  setShowInvoiceBuilder: (show: boolean) => void;
  editingInvoiceId: string | null;
  setEditingInvoiceId: (id: string | null) => void;
  invoiceForm: any;
  setInvoiceForm: (fn: any) => void;
  resetInvoiceForm: () => void;
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
  gmailStatus: { connected: boolean; email: string | null } | null;
}

export default function InvoicesPanel({
  invoices,
  contacts,
  products,
  businessId,
  loading,
  showInvoiceBuilder,
  setShowInvoiceBuilder,
  editingInvoiceId,
  setEditingInvoiceId,
  invoiceForm,
  setInvoiceForm,
  resetInvoiceForm,
  setProducts,
  setInvoices,
  gmailStatus,
}: InvoicesPanelProps) {
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
      }
    }
  }

  async function handleSendInvoice(invoiceId: string) {
    const { data, error } = await updateInvoiceStatus(invoiceId, "SENT");
    if (!error && data) {
      setInvoices((prev) => prev.map((i) => (i.id === invoiceId ? { ...i, status: "SENT" } : i)));
      toast.success("Invoice sent");
    } else {
      toast.error(error ?? "Failed to send invoice");
    }
  }

  async function handleMarkPaid(invoiceId: string, inv: Invoice) {
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
    } else {
      toast.error(error ?? "Failed to mark paid");
    }
  }

  async function handleDeleteInvoice(invoiceId: string) {
    if (!businessId) return;
    setConfirmState({
      open: true,
      action: async () => {
        try {
          const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL || "https://keyflowos.replit.app"}/commerce/businesses/${businessId}/invoices/${invoiceId}`, {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${localStorage.getItem("kf_token") || ""}`,
            },
          });
          if (res.ok) {
            setInvoices((prev) => prev.filter((i) => i.id !== invoiceId));
            if (selectedInvoice?.id === invoiceId) {
              setSelectedInvoice(null);
            }
            toast.success("Invoice deleted");
          } else {
            const err = await res.json();
            toast.error(err.message || "Failed to delete invoice");
          }
        } catch (e) {
          toast.error("Failed to delete invoice");
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
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Contact (optional)</label>
                  <select
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    value={invoiceForm.contactId}
                    onChange={(e) => setInvoiceForm((f: any) => ({ ...f, contactId: e.target.value }))}
                  >
                    <option value="">Select contact...</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.firstName} {c.lastName} {c.email ? `(${c.email})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
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

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-3 rounded-xl bg-muted/20 border border-border/40">
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Tax Rate (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    value={invoiceForm.taxRate}
                    onChange={(e) => setInvoiceForm((f: any) => ({ ...f, taxRate: e.target.value }))}
                    placeholder="12.5"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Discount Type</label>
                  <select
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    value={invoiceForm.discountType}
                    onChange={(e) => setInvoiceForm((f: any) => ({ ...f, discountType: e.target.value as "PERCENT" | "FIXED" }))}
                  >
                    <option value="PERCENT">Percentage (%)</option>
                    <option value="FIXED">Fixed Amount (TTD)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">
                    Discount {invoiceForm.discountType === "PERCENT" ? "(%)" : "(TTD)"}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    value={invoiceForm.discountValue}
                    onChange={(e) => setInvoiceForm((f: any) => ({ ...f, discountValue: e.target.value }))}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Notes (optional)</label>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    value={invoiceForm.notes}
                    onChange={(e) => setInvoiceForm((f: any) => ({ ...f, notes: e.target.value }))}
                    placeholder="Payment terms, thank you message..."
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Line Items</label>
                  <Button variant="outline" onClick={addInvoiceItem} className="text-xs gap-1 px-2 py-1">
                    <Plus className="w-3 h-3" /> Add Item
                  </Button>
                </div>

                {invoiceForm.items.map((item: InvoiceLineItem) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3 rounded-xl bg-muted/30 border border-border/40 space-y-2"
                  >
                    <div className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-12 md:col-span-3">
                        <label className="text-xs text-muted-foreground mb-1 block">Product/Service</label>
                        <select
                          className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                          value={item.productId}
                          onChange={(e) => selectProductForItem(item.id, e.target.value)}
                        >
                          <option value="">Select item...</option>
                          <option value="__NEW__">
                            {item.isNewItem && item.newItemName ? `+ ${item.newItemName}` : "+ New item"}
                          </option>
                          {products.filter(p => p.isActive !== false).map((p) => (
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
                              onChange={(e) => updateInvoiceItem(item.id, "newItemName", e.target.value)}
                            />
                          </div>
                          <div className="col-span-6 md:col-span-2">
                            <label className="text-xs text-muted-foreground mb-1 block">Type</label>
                            <select
                              className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                              value={item.newItemCategory || "SERVICE"}
                              onChange={(e) => updateInvoiceItem(item.id, "newItemCategory", e.target.value)}
                            >
                              {CATEGORIES.map((cat) => (
                                <option key={cat.value} value={cat.value}>{cat.label}</option>
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
                          onChange={(e) => updateInvoiceItem(item.id, "description", e.target.value)}
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
                          onChange={(e) => updateInvoiceItem(item.id, "quantity", e.target.value)}
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
                          onChange={(e) => updateInvoiceItem(item.id, "unitPrice", e.target.value)}
                        />
                      </div>
                      <div className="col-span-2 md:col-span-1 flex justify-center">
                        {invoiceForm.items.length > 1 && (
                          <button
                            onClick={() => removeInvoiceItem(item.id)}
                            className="p-2 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
                            title="Remove item"
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                    {item.isNewItem && (
                      <div className="flex items-center gap-2 pt-1 pl-1">
                        <input
                          type="checkbox"
                          id={`addToCatalog_${item.id}`}
                          checked={item.addToCatalog || false}
                          onChange={(e) => updateInvoiceItem(item.id, "addToCatalog", e.target.checked)}
                          className="w-4 h-4 rounded border-border text-primary focus:ring-primary/50"
                        />
                        <label htmlFor={`addToCatalog_${item.id}`} className="text-xs text-muted-foreground cursor-pointer">
                          Add this item to my product catalog
                        </label>
                      </div>
                    )}
                  </motion.div>
                ))}

                <div className="pt-4 border-t border-border/40 space-y-2">
                  {(() => {
                    const subtotal = invoiceForm.items.reduce((sum: number, item: InvoiceLineItem) => {
                      const qty = parseInt(item.quantity) || 0;
                      const price = parseFloat(item.unitPrice) || 0;
                      return sum + (qty * price);
                    }, 0);
                    const taxRate = parseFloat(invoiceForm.taxRate) || 0;
                    const taxAmount = (subtotal * taxRate) / 100;
                    const discountValue = parseFloat(invoiceForm.discountValue) || 0;
                    const discountAmount = invoiceForm.discountType === "PERCENT"
                      ? (subtotal * discountValue) / 100
                      : discountValue;
                    const total = subtotal + taxAmount - discountAmount;

                    return (
                      <div className="flex justify-end">
                        <div className="text-sm space-y-1 min-w-[200px]">
                          <div className="flex justify-between text-muted-foreground">
                            <span>Subtotal:</span>
                            <span>TTD {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                          </div>
                          {taxRate > 0 && (
                            <div className="flex justify-between text-muted-foreground">
                              <span>Tax ({taxRate}%):</span>
                              <span>TTD {taxAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                            </div>
                          )}
                          {discountAmount > 0 && (
                            <div className="flex justify-between text-emerald-400">
                              <span>Discount {invoiceForm.discountType === "PERCENT" ? `(${discountValue}%)` : ""}:</span>
                              <span>-TTD {discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                            </div>
                          )}
                          <div className="flex justify-between font-bold text-primary border-t border-border/40 pt-1">
                            <span>Total:</span>
                            <span>TTD {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

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

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search invoices..."
            value={invoiceSearch}
            onChange={(e) => setInvoiceSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-card border border-border/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
          />
        </div>
        <div className="flex items-center gap-1">
          <Filter className="w-4 h-4 text-muted-foreground" />
          {INVOICE_STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setInvoiceStatusFilter(f.value)}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                invoiceStatusFilter === f.value
                  ? "bg-primary/20 text-primary border border-primary/30"
                  : "text-muted-foreground hover:bg-muted border border-transparent"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="text-sm text-muted-foreground">
          {filteredInvoices.length} invoice{filteredInvoices.length !== 1 ? "s" : ""}
        </span>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-border/60 bg-card p-8">
          <div className="space-y-3 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-muted/50 rounded-xl" />
            ))}
          </div>
        </div>
      ) : invoices.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl border border-border/60 bg-card p-12 text-center"
        >
          <FileText className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No invoices yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Create your first invoice to start billing
          </p>
          <Button onClick={() => setShowInvoiceBuilder(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Create Invoice
          </Button>
        </motion.div>
      ) : filteredInvoices.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl border border-border/60 bg-card p-8 text-center"
        >
          <Search className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <h3 className="text-base font-medium mb-1">No matching invoices</h3>
          <p className="text-sm text-muted-foreground">
            Try a different search term or filter
          </p>
        </motion.div>
      ) : (
        <>
          <div className="hidden md:block rounded-2xl border border-border/60 overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/30 border-b border-border/60">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Invoice</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Contact</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Due</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</th>
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
                            <Button variant="outline" className="px-2.5 py-1 text-xs gap-1" onClick={() => handleSendInvoice(inv.id)}>
                              <Send className="w-3 h-3" /> Send
                            </Button>
                          )}
                          {(inv.status === "DRAFT" || inv.status === "SENT") && (
                            <Button variant="outline" className="px-2.5 py-1 text-xs gap-1" onClick={() => handleMarkPaid(inv.id, inv)}>
                              <CheckCircle className="w-3 h-3" /> Paid
                            </Button>
                          )}
                          <button onClick={() => handleDeleteInvoice(inv.id)} className="p-1.5 rounded-lg hover:bg-red-500/20 transition-colors" title="Delete invoice">
                            <Trash2 className="w-4 h-4 text-red-400 hover:text-red-300" />
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
                <div key={inv.id} className="rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm p-4 space-y-3">
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
                      <button onClick={() => handleSendInvoice(inv.id)} className="px-2 py-1 rounded-lg bg-primary/20 text-primary text-xs font-medium">Send</button>
                    )}
                    {(inv.status === "DRAFT" || inv.status === "SENT") && (
                      <button onClick={() => handleMarkPaid(inv.id, inv)} className="px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-medium">Paid</button>
                    )}
                    <button onClick={() => handleDeleteInvoice(inv.id)} className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400 ml-auto" title="Delete">
                      <Trash2 className="w-4 h-4" />
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
                      <Button className="gap-2 flex-1" onClick={() => { handleSendInvoice(selectedInvoice.id); setSelectedInvoice(null); }}>
                        <Send className="w-4 h-4" /> Send Invoice
                      </Button>
                    )}
                    {(selectedInvoice.status === "DRAFT" || selectedInvoice.status === "SENT") && (
                      <Button className="gap-2 flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => { handleMarkPaid(selectedInvoice.id, selectedInvoice); setSelectedInvoice(null); }}>
                        <CheckCircle className="w-4 h-4" /> Mark Paid
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
