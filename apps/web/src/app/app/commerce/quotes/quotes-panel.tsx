"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SkeletonList } from "@/components/ui/skeleton";
import { InfoBadge } from "@/components/ui/info-badge";
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
  Files,
  MessageCircle,
  AlertTriangle,
  Loader2,
  ArrowUpDown,
  CalendarClock,
  Clock,
  Sparkles,
} from "lucide-react";
import nextDynamic from "next/dynamic";

const QuoteFollowUpPanel = nextDynamic(
  () => import("../components/quote-follow-up-panel").then((m) => m.QuoteFollowUpPanel),
  { ssr: false, loading: () => null },
);
import {
  createProduct,
  createQuote,
  updateQuote,
  updateQuoteStatus,
  deleteQuote,
  convertQuoteToInvoice,
  sendQuoteEmail,
  disconnectGmail,
  bulkUpdateQuotes,
  Product,
  Quote,
  Contact,
  Invoice,
} from "@/lib/client";

import { formatAmount } from "../utils/commerce-utils";
import { useCommerceSearch } from "../hooks/use-commerce-search";
import type { ReactNode } from "react";
import { DateRangeFilter, filterByDateRange, DEFAULT_DATE_RANGE } from "../components/date-range-filter";
import type { DateRange } from "../components/date-range-filter";
import { BulkActionBar, exportToCsv } from "../components/bulk-action-bar";
import {
  QUOTE_STATUS_FILTERS,
  BILLING_SORT_OPTIONS,
  BillingSortKey,
  InvoiceLineItem,
  generateItemId,
} from "../components/commerce-types";
import { BillingDetailModal } from "../components/billing-detail-modal";
import { BillingFormModal } from "../components/billing-form-modal";
import { InvoiceDriveUploader, buildTemplateData } from "../components/invoice-drive-uploader";
import { RecordRowCard, OverflowMenu, OverflowMenuItem } from "../components/standardized-cards";
import { getQuoteSmartCTA } from "../utils/smart-cta";
import { useQuoteForm } from "../hooks/use-quote-form";
import { useBusinessPreview } from "../hooks/use-business-preview";
import { useBulkSelection } from "../hooks/use-bulk-selection";
import { useLineItemHandlers } from "../hooks/use-line-item-handlers";
import { useModuleEmit } from "@/hooks/use-module-events";
import { registerInterruptedTask, markTaskCompleted } from "@/lib/resume-task-registry";
import { useNavigationContext } from "@/lib/navigation-context";
import { ArrowRightLeft, Eye } from "lucide-react";

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
  onViewContact?: (contactId: string) => void;
  onViewClientIntel?: (contactId: string) => void;
  onSelectProduct?: (productId: string) => void;
  initialStatusFilter?: string;
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
  onViewContact,
  onViewClientIntel,
  onSelectProduct,
  initialStatusFilter,
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
  const { businessData, saveBranding, savingBranding } = useBusinessPreview();
  const { getOriginContext } = useNavigationContext();
  const quoteTaskIdRef = useRef<string | null>(null);
  const quoteSessionIdRef = useRef<string | null>(null);

  const originContext = getOriginContext();
  const crossModuleOriginLabel = originContext && originContext.workspace && originContext.workspace !== "Revenue"
    ? originContext.workspace
    : null;
  const crossModuleOriginRoute = crossModuleOriginLabel
    ? originContext?.route ?? null
    : null;

  useEffect(() => {
    if (showQuoteBuilder) {
      if (!quoteSessionIdRef.current) {
        quoteSessionIdRef.current = editingQuoteId
          ? `commerce-quote-${editingQuoteId}`
          : `commerce-quote-new-${Date.now()}`;
      }
      const sessionId = quoteSessionIdRef.current;
      const label = editingQuoteId ? "Edit quote" : "New quote";
      const contact = contacts.find((c) => c.id === quoteForm.contactId);
      const contactName = contact ? (`${contact.firstName ?? ""} ${contact.lastName ?? ""}`).trim() || null : null;
      const taskId = registerInterruptedTask({
        id: sessionId,
        module: "commerce",
        label: contactName ? `${label} · ${contactName}` : label,
        description: contactName
          ? `Resume quote for ${contactName}`
          : "Resume building this quote",
        route: "/app/commerce?tab=quotes",
        draftId: editingQuoteId ?? null,
        originRoute: "/app/commerce",
        originLabel: "Revenue",
        taskIntent: editingQuoteId ? "edit-quote" : "create-quote",
        formData: {
          contactId: quoteForm.contactId || null,
          expiryDate: quoteForm.expiryDate || null,
          itemCount: quoteForm.items.length,
          notes: quoteForm.notes || null,
        },
      });
      quoteTaskIdRef.current = taskId;
    } else {
      quoteSessionIdRef.current = null;
      quoteTaskIdRef.current = null;
    }
  }, [showQuoteBuilder, editingQuoteId, quoteForm, contacts]);

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
  const [quoteStatusFilter, setQuoteStatusFilter] = useState<string>(initialStatusFilter ?? "ALL");

  useEffect(() => {
    if (initialStatusFilter) {
      setQuoteStatusFilter(initialStatusFilter);
    }
  }, [initialStatusFilter]);
  const [sortKey, setSortKey] = useState<BillingSortKey>("date-desc");
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [followUpFor, setFollowUpFor] = useState<Quote | null>(null);
  const [extendDate, setExtendDate] = useState("");
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [showAcceptPrompt, setShowAcceptPrompt] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailForm, setEmailForm] = useState({ email: "", message: "" });
  const [sendingEmail, setSendingEmail] = useState(false);
  const [convertForm, setConvertForm] = useState({
    taxRate: "12.5",
    discountType: "PERCENT" as "PERCENT" | "FIXED",
    discountValue: "",
    notes: "",
    dueDate: "",
  });
  const [confirmState, setConfirmState] = useState<{open: boolean; action: () => void}>({open: false, action: () => {}});
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});
  const [dateRange, setDateRange] = useState<DateRange>(DEFAULT_DATE_RANGE);
  const { selectedIds, toggleSelected, selectAll, clearSelection } = useBulkSelection();

  const handleBulkStatusChange = useCallback(async (status: string) => {
    if (!businessId || selectedIds.size === 0) return;
    const action = status === "SENT" ? "send" : status === "REJECTED" ? "reject" : "delete";
    const { data, error } = await bulkUpdateQuotes(businessId, Array.from(selectedIds), action as "send" | "reject" | "delete");
    if (data) {
      toast.success(`${data.updated} quote(s) updated`);
      clearSelection();
      if (data.updated > 0) {
        const eligibleStatuses: Record<string, string[]> = {
          send: ["DRAFT"],
          reject: ["SENT"],
          delete: ["DRAFT", "SENT", "REJECTED", "EXPIRED"],
        };
        const eligible = new Set(
          quotes
            .filter((q) => selectedIds.has(q.id) && (eligibleStatuses[action] ?? []).includes(q.status))
            .map((q) => q.id)
        );
        if (action === "delete") {
          setQuotes((prev) => prev.filter((q) => !eligible.has(q.id)));
        } else {
          setQuotes((prev) => prev.map((q) => eligible.has(q.id) ? { ...q, status: status as Quote["status"] } : q));
        }
      }
    } else {
      toast.error(error ?? "Bulk action failed");
    }
  }, [businessId, selectedIds, quotes, setQuotes]);

  const handleBulkDelete = useCallback(async () => {
    setConfirmState({
      open: true,
      action: () => handleBulkStatusChange("DELETE"),
    });
  }, [handleBulkStatusChange]);

  const handleExportCsv = useCallback(() => {
    const toExport = selectedIds.size > 0
      ? quotes.filter((q) => selectedIds.has(q.id))
      : quotes;
    exportToCsv(

      toExport as unknown as Record<string, unknown>[],
      [
        { key: "quoteNumber", header: "Quote #" },
        { key: "status", header: "Status" },
        { key: "contact", header: "Client", format: (v: unknown) => { const c = v as { firstName?: string; lastName?: string } | null; return c ? `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() : ""; } },
        { key: "total", header: "Total" },
        { key: "currency", header: "Currency" },
        { key: "issueDate", header: "Issue Date", format: (v: unknown) => v ? new Date(v as string).toLocaleDateString() : "" },
        { key: "expiryDate", header: "Expiry Date", format: (v: unknown) => v ? new Date(v as string).toLocaleDateString() : "" },
      ],
      `quotes-${new Date().toISOString().split("T")[0]}`,
    );
    toast.success(`Exported ${toExport.length} quote(s)`);
  }, [quotes, selectedIds]);

  const [autoConvertToInvoice, setAutoConvertToInvoice] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined") {
      setAutoConvertToInvoice(localStorage.getItem("kf_auto_convert_quote") === "true");
    }
  }, []);

  const { addItem: addQuoteItem, removeItem: removeQuoteItem, updateItem: updateQuoteItem, selectProduct: selectProductForQuoteItem } = useLineItemHandlers(
    (updater) => setQuoteForm((f) => ({ ...f, items: updater(f.items) })),
    products,
  );

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
      items: (quote.items ?? []).map((item) => ({
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
      // VIEWED + EXPIRED are derived facets driven by the server-decorated
      // lifecycleStep / isExpired flags so the filter chips stay in sync
      // with the canonical state machine.
      if (q.lifecycleStep === "VIEWED") {
        counts.VIEWED = (counts.VIEWED || 0) + 1;
      }
      if (q.isExpired) {
        counts.EXPIRED = (counts.EXPIRED || 0) + 1;
      }
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

  const dateFiltered = useMemo(() => {
    return filterByDateRange(sorted, (q) => q.issueDate, dateRange);
  }, [sorted, dateRange]);

  const statusFiltered = useMemo(() => {
    if (quoteStatusFilter === "ALL") return dateFiltered;
    if (quoteStatusFilter === "VIEWED") {
      return dateFiltered.filter((q) => q.lifecycleStep === "VIEWED");
    }
    if (quoteStatusFilter === "EXPIRED") {
      return dateFiltered.filter((q) => q.isExpired);
    }
    return dateFiltered.filter((q) => q.status === quoteStatusFilter);
  }, [dateFiltered, quoteStatusFilter]);

  const { filtered: filteredQuotes } = useCommerceSearch(
    statusFiltered,
    (q) => `${q.quoteNumber} ${q.contact?.firstName ?? ""} ${q.contact?.lastName ?? ""} ${q.contact?.email ?? ""} ${(q.items ?? []).map((i) => `${i.description ?? ""}`).join(" ")} ${q.notes ?? ""} ${Number(q.total).toFixed(2)}`,
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
        if (quoteTaskIdRef.current) { markTaskCompleted(quoteTaskIdRef.current); quoteTaskIdRef.current = null; }
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
        if (quoteTaskIdRef.current) { markTaskCompleted(quoteTaskIdRef.current); quoteTaskIdRef.current = null; }
        setQuotes((q) => [res.data!, ...q]);
        toast.success("Quote created");
        emitEvent("commerce:quote_created", "commerce", { quoteId: res.data.id });

        // Queue Drive upload for the new quote
        const templateId = (businessData?.quoteTemplate as string) || "classic";
        setPendingDriveUpload({ quoteId: res.data.id, templateId });
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
      items: (quote.items ?? []).map((item) => ({
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
        emitEvent("commerce:quote_created", "commerce", { quoteId: quote.id, action: "accepted" });
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
    } catch (_err) {
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
      items: (quote.items ?? []).map((item) => ({
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
      emitEvent("commerce:quote_converted", "commerce", { quoteId: selectedQuote.id, invoiceId: res.data.id });
      emitEvent("commerce:invoice_created", "commerce", { invoiceId: res.data.id, fromQuote: selectedQuote.id });
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
      <BillingFormModal
        open={showQuoteBuilder}
        onClose={() => { setShowQuoteBuilder(false); resetQuoteForm(); }}
        onSubmit={handleSaveQuote}
        docType="quote"
        isEditing={!!editingQuoteId}
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
        originLabel={crossModuleOriginLabel}
        originRoute={crossModuleOriginRoute}
        businessId={businessId}
      />

      <div className="rounded-2xl border border-border/50 bg-card p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
            <input
              type="text"
              placeholder="Search quotes..."
              value={quoteSearch}
              onChange={(e) => setQuoteSearch(e.target.value)}
              className="w-full pl-9 pr-8 min-h-[44px] text-sm bg-white/[0.03] border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/40 focus:border-[hsl(var(--kf-accent1))]/40 placeholder:text-muted-foreground/40 transition-all"
              aria-label="Search quotes"
            />
            {quoteSearch && (
              <button
                onClick={() => setQuoteSearch("")}
                className="absolute right-0 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md hover:bg-muted/50 transition-colors"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5 text-muted-foreground/40" />
              </button>
            )}
          </div>

          <DateRangeFilter value={dateRange} onChange={setDateRange} />

          <div className="relative shrink-0">
            <ArrowUpDown className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as BillingSortKey)}
              className="appearance-none pl-7 pr-2 min-h-[44px] text-[11px] bg-white/[0.03] border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/40 text-muted-foreground cursor-pointer"
              aria-label="Sort quotes"
            >
              {BILLING_SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => { resetQuoteForm(); setShowQuoteBuilder(true); }}
            className="inline-flex items-center gap-1.5 px-3 min-h-[44px] text-[11px] font-medium rounded-lg bg-gradient-to-r from-[hsl(var(--kf-accent1))]/15 to-[hsl(var(--kf-accent1))]/5 text-[hsl(var(--kf-accent1))] hover:from-[hsl(var(--kf-accent1))]/25 hover:to-[hsl(var(--kf-accent1))]/10 transition-all shrink-0"
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
            className={`inline-flex items-center gap-1.5 px-3 min-h-[44px] text-[11px] font-medium rounded-lg border transition-all shrink-0 ${
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
          <InfoBadge title="Quote Status Filters" body="Draft: Work in progress. Sent: Delivered to client. Accepted: Client approved — ready to convert to invoice. Rejected: Client declined. Expired: Past validity date." side="bottom" iconSize={11} />
          {QUOTE_STATUS_FILTERS.slice(0, 4).map((f) => {
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
          {QUOTE_STATUS_FILTERS.length > 4 && (
            <select
              value={QUOTE_STATUS_FILTERS.slice(4).some((f) => f.value === quoteStatusFilter) ? quoteStatusFilter : ""}
              onChange={(e) => { if (e.target.value) setQuoteStatusFilter(e.target.value); }}
              className={`appearance-none px-2 py-1 text-[11px] rounded-md font-medium shrink-0 cursor-pointer transition-all focus:outline-none ${
                QUOTE_STATUS_FILTERS.slice(4).some((f) => f.value === quoteStatusFilter)
                  ? "bg-white/[0.08] border border-border/60 text-foreground"
                  : "bg-white/[0.02] border border-transparent text-muted-foreground/60 hover:bg-white/[0.05]"
              }`}
              aria-label="More status filters"
            >
              <option value="" disabled>More...</option>
              {QUOTE_STATUS_FILTERS.slice(4).map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label} ({statusCounts[f.value] ?? 0})
                </option>
              ))}
            </select>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground/50 whitespace-nowrap shrink-0 pl-2" aria-live="polite" role="status">
            {filteredQuotes.length} of {quotes.length}
          </span>
        </div>
      </div>

      {loading ? (
        <SkeletonList rows={4} cols={3} />
      ) : quotes.length === 0 ? (
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
          {filteredQuotes.length > 0 && (
            <div className="flex items-center gap-1 px-2 pb-1">
              <label className="min-w-[44px] min-h-[44px] flex items-center justify-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={filteredQuotes.length > 0 && filteredQuotes.every((q) => selectedIds.has(q.id))}
                  onChange={() => {
                    const allSelected = filteredQuotes.every((q) => selectedIds.has(q.id));
                    allSelected ? clearSelection() : selectAll(filteredQuotes.map((q) => q.id));
                  }}
                  className="w-4 h-4 rounded border-border/50 accent-[hsl(var(--kf-accent1))]"
                  aria-label="Select all visible quotes"
                />
              </label>
              <span className="text-[10px] text-muted-foreground/50">Select all</span>
            </div>
          )}
          {filteredQuotes.map((quote) => {
            const expired = isQuoteExpired(quote);
            const daysRemaining = getDaysRemaining(quote);
            const smartCTA = getQuoteSmartCTA(quote.status);
            const SmartIcon = smartCTA.icon;

            const handleSmartAction = () => {
              switch (smartCTA.actionKey) {
                case "send":
                  handleMarkSent(quote);
                  break;
                case "follow_up":
                  setSelectedQuote(quote);
                  setShowEmailModal(true);
                  break;
                case "convert":
                  setSelectedQuote(quote);
                  setConvertForm({
                    taxRate: String(quote.taxRate ?? 12.5),
                    discountType: (quote.discountType as "PERCENT" | "FIXED") ?? "PERCENT",
                    discountValue: quote.discountValue ? String(quote.discountValue) : "",
                    notes: quote.notes ?? "",
                    dueDate: "",
                  });
                  setShowConvertModal(true);
                  break;
                case "view":
                  setSelectedQuote(quote);
                  break;
              }
            };

            const cardBadges = (
              <>
                {quote.invoiceId && (
                  <>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border bg-emerald-500/20 text-emerald-300 border-emerald-500/40">
                      <ArrowRightLeft className="w-3 h-3" />
                      Converted
                    </span>
                    <a
                      href={`/app/payments?tab=transactions&q=${encodeURIComponent(quote.invoiceId)}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold border border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20"
                      title="View payments for this invoice"
                    >
                      View in Payments
                    </a>
                  </>
                )}
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
                {quote.lifecycleStep === "VIEWED" && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border bg-cyan-500/15 text-cyan-300 border-cyan-500/30">
                    <Eye className="w-3 h-3" />
                    Viewed
                  </span>
                )}
                {quote.isStale && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border bg-orange-500/15 text-orange-300 border-orange-500/30" title="Sent over 7 days ago with no response">
                    <Clock className="w-3 h-3" />
                    Stale
                  </span>
                )}
                {renderTimelineBadge?.(quote)}
              </>
            );

            return (
              <div key={quote.id} className="flex items-start gap-1">
                <label className="min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(quote.id)}
                    onChange={() => toggleSelected(quote.id)}
                    className="w-4 h-4 rounded border-border/50 accent-[hsl(var(--kf-accent1))]"
                    aria-label={`Select quote ${quote.quoteNumber}`}
                  />
                </label>
                <div className="flex-1 min-w-0">
              <RecordRowCard
                type="quote"
                number={quote.quoteNumber}
                status={quote.status}
                contact={quote.contact ?? null}
                total={Number(quote.total)}
                currency={quote.currency}
                items={(quote.items ?? []) as Array<{ description?: string | null }>}
                date={quote.issueDate}
                dueDate={quote.expiryDate}
                badges={cardBadges}
                selected={selectedQuote?.id === quote.id}
                onClick={() => setSelectedQuote(quote)}
                linkedService={(quote.items ?? []).find((item) => item.description)?.description?.slice(0, 30) || null}
                onViewContact={onViewContact && quote.contactId ? () => onViewContact(quote.contactId!) : undefined}
                smartCTA={
                  <button
                    onClick={handleSmartAction}
                    disabled={!!actionLoading[quote.id] || (smartCTA.actionKey === "convert" && !!quote.invoiceId)}
                    className={`inline-flex items-center gap-1 px-2.5 min-w-[44px] min-h-[44px] justify-center rounded-lg text-[11px] font-medium transition-all disabled:opacity-50 ${smartCTA.bgColor} ${smartCTA.color} ${smartCTA.hoverBgColor}`}
                  >
                    {actionLoading[quote.id] ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <SmartIcon className="w-3 h-3" />
                    )}
                    <span className="hidden sm:inline">{smartCTA.label}</span>
                  </button>
                }
                overflowMenu={
                  <OverflowMenu>
                    <OverflowMenuItem icon={Eye} label="View details" onClick={() => setSelectedQuote(quote)} />
                    <OverflowMenuItem icon={Pencil} label="Edit" onClick={() => openEditQuote(quote)} />
                    <OverflowMenuItem icon={Files} label="Duplicate" onClick={() => duplicateQuote(quote)} />
                    <OverflowMenuItem icon={Sparkles} label="AI Follow-up" onClick={() => setFollowUpFor(quote)} />
                    <OverflowMenuItem icon={MessageCircle} label="Share via WhatsApp" onClick={() => shareQuoteViaWhatsApp(quote)} />
                    {(quote.status === "DRAFT" || quote.status === "SENT") && (
                      <OverflowMenuItem icon={Mail} label="Send via email" onClick={() => { setSelectedQuote(quote); setShowEmailModal(true); }} />
                    )}
                    {quote.status === "DRAFT" && (
                      <OverflowMenuItem icon={Send} label="Mark as sent" onClick={() => handleMarkSent(quote)} disabled={!!actionLoading[quote.id]} />
                    )}
                    {quote.status === "SENT" && !expired && (
                      <OverflowMenuItem icon={CheckCircle} label="Accept quote" onClick={() => handleAcceptQuote(quote)} disabled={!!actionLoading[quote.id]} />
                    )}
                    {quote.status === "SENT" && (
                      <OverflowMenuItem icon={X} label="Reject quote" onClick={() => handleRejectQuote(quote)} disabled={!!actionLoading[quote.id]} />
                    )}
                    {quote.status === "ACCEPTED" && !quote.invoiceId && (
                      <OverflowMenuItem icon={ArrowRightLeft} label="Convert to invoice" onClick={() => {
                        setSelectedQuote(quote);
                        setConvertForm({
                          taxRate: String(quote.taxRate ?? 12.5),
                          discountType: (quote.discountType as "PERCENT" | "FIXED") ?? "PERCENT",
                          discountValue: quote.discountValue ? String(quote.discountValue) : "",
                          notes: quote.notes ?? "",
                          dueDate: "",
                        });
                        setShowConvertModal(true);
                      }} />
                    )}
                    <OverflowMenuItem icon={Trash2} label="Delete" onClick={() => handleDeleteQuote(quote)} destructive disabled={!!actionLoading[quote.id]} />
                  </OverflowMenu>
                }
              />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <BulkActionBar
        selectedCount={selectedIds.size}
        totalCount={filteredQuotes.length}
        onSelectAll={() => selectAll(filteredQuotes.map((q) => q.id))}
        onClearSelection={clearSelection}
        onExportCsv={handleExportCsv}
        onBulkDelete={handleBulkDelete}
        statusOptions={[
          { value: "SENT", label: "Send All" },
          { value: "REJECTED", label: "Reject All" },
        ]}
        onBulkStatusChange={handleBulkStatusChange}
        entityLabel="quotes"
      />

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
            lifecycleStep={selectedQuote.lifecycleStep}
            contact={selectedQuote.contact ?? null}
            contactId={selectedQuote.contactId}
            total={Number(selectedQuote.total)}
            currency={selectedQuote.currency}
            items={(selectedQuote.items ?? []) as Array<{ id?: string; description?: string | null; quantity?: number; unitPrice?: number; total?: number; productId?: string | null }>}
            dateLabel1="Issue Date"
            dateValue1={selectedQuote.issueDate}
            dateLabel2="Expiry Date"
            dateValue2={selectedQuote.expiryDate ?? null}
            allInvoices={[]}
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
            businessData={businessData}
            onSaveBranding={saveBranding}
            savingBranding={savingBranding}
            onViewContact={onViewContact}
            onViewClientIntel={onViewClientIntel}
            onSelectProduct={onSelectProduct}
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
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-0.5">
                    <button onClick={() => duplicateQuote(selectedQuote)} className="p-2 rounded-lg hover:bg-white/[0.06] transition-colors" title="Duplicate quote">
                      <Files className="w-4 h-4 text-slate-400" />
                    </button>
                    <div className="w-px h-4 bg-border/30 mx-0.5" />
                    <button onClick={() => shareQuoteViaWhatsApp(selectedQuote)} className="p-2 rounded-lg hover:bg-emerald-500/10 transition-colors" title="Share via WhatsApp">
                      <MessageCircle className="w-4 h-4 text-emerald-400" />
                    </button>
                    <button onClick={() => setShowEmailModal(true)} className="p-2 rounded-lg hover:bg-blue-500/10 transition-colors" title="Send via email">
                      <Mail className="w-4 h-4 text-blue-400" />
                    </button>
                  </div>
                </div>
                {selectedQuote.status === "DRAFT" && (
                  <Button size="sm" className="gap-1.5 w-full" onClick={() => { handleMarkSent(selectedQuote); setSelectedQuote(null); }} disabled={!!actionLoading[selectedQuote.id]}>
                    {actionLoading[selectedQuote.id] === "send" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send Quote
                  </Button>
                )}
                {selectedQuote.status === "SENT" && !isQuoteExpired(selectedQuote) && (
                  <Button size="sm" className="gap-1.5 w-full bg-emerald-600 hover:bg-emerald-700" onClick={() => handleAcceptQuote(selectedQuote)} disabled={!!actionLoading[selectedQuote.id]}>
                    {actionLoading[selectedQuote.id] === "accept" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />} Accept Quote
                  </Button>
                )}
                {selectedQuote.status === "ACCEPTED" && !selectedQuote.invoiceId && (
                  <Button size="sm" className="gap-1.5 w-full" onClick={() => {
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
                {selectedQuote.invoiceId && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                    <ArrowRightLeft className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="text-[11px] text-emerald-300 font-medium">Converted to invoice</span>
                  </div>
                )}
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
                    onClick={() => window.location.href = "/app/settings/connections"}
                    className="w-full rounded-xl bg-primary text-primary-foreground py-3 text-sm font-medium hover:bg-primary/90 flex items-center justify-center gap-2"
                  >
                    <Mail className="w-4 h-4" />
                    Connect Gmail
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

      {followUpFor && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
          onClick={() => setFollowUpFor(null)}
        >
          <div
            className="w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <QuoteFollowUpPanel
              businessId={businessId}
              quoteId={followUpFor.id}
              quoteNumber={followUpFor.quoteNumber ?? followUpFor.id.slice(0, 8)}
              quoteAmount={Number(followUpFor.total ?? 0)}
              currency={followUpFor.currency ?? currency}
              onClose={() => setFollowUpFor(null)}
            />
          </div>
        </div>
      )}
    </motion.div>
  );
}
