"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Send,
  DollarSign,
  Bell,
  MoreHorizontal,
  CheckCircle,
  Ban,
  Trash2,
  Printer,
  Eye,
  Loader2,
  Mail,
  Link as LinkIcon,
  Receipt,
  FileText,
  Activity,
  CreditCard,
  StickyNote,
  Clock,
  Calendar,
  User,
  ChevronRight,
  Pencil,
  CheckCircle2,
  X,
} from "lucide-react";
import {
  getInvoice,
  getInvoiceTimeline,
  listInvoicePayments,
  updateInvoiceStatus,
  markInvoicePaid,
  resendInvoiceReceipt,
  sendInvoiceReminder,
  sendInvoiceEmail,
  createInvoicePaymentLink,
  recordInvoicePayment,
  Invoice,
  PaymentRecord,
  InvoiceTimelineEntry,
} from "@/lib/client";
import { apiDelete } from "@/lib/api";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { formatAmount, getDaysUntilDue } from "../../utils/commerce-utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const STATUS_ORDER = ["DRAFT", "SENT", "PAID", "OVERDUE", "VOID"];
const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  DRAFT: { label: "Draft", color: "text-slate-700", bg: "bg-slate-100" },
  SENT: { label: "Sent", color: "text-amber-700", bg: "bg-amber-50" },
  PAID: { label: "Paid", color: "text-emerald-700", bg: "bg-emerald-50" },
  PARTIALLY_PAID: { label: "Part-paid", color: "text-sky-700", bg: "bg-sky-50" },
  OVERDUE: { label: "Overdue", color: "text-red-700", bg: "bg-red-50" },
  VOID: { label: "Void", color: "text-gray-500", bg: "bg-gray-100" },
};

export default function InvoiceDetailPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const invoiceId = params.id as string;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"activity" | "payments" | "notes">("activity");
  const [timeline, setTimeline] = useState<InvoiceTimelineEntry[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: "", method: "Cash", reference: "", notes: "" });
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [confirmMessage, setConfirmMessage] = useState("");
  const [showSendReview, setShowSendReview] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    const init = async () => { const fresh = await refreshWorkspace(); const id = fresh ?? getStoredBusinessId(); if (id) setBusinessId(id); };
    void init();
  }, []);

  useEffect(() => {
    if (!invoiceId) return;
    const load = async () => {
      setLoading(true);
      try {
        const { data, error } = await getInvoice(invoiceId);
        if (!mountedRef.current) return;
        if (error || !data) { setError(error ?? "Not found"); setLoading(false); return; }
        setInvoice(data);
        if (businessId) {
          const tl = await getInvoiceTimeline(businessId, invoiceId);
          if (tl.data && mountedRef.current) setTimeline(tl.data.entries);
        }
      } catch { setError("Failed to load"); }
      finally { if (mountedRef.current) setLoading(false); }
    };
    void load();
  }, [invoiceId, businessId]);

  useEffect(() => { if (searchParams.get("action") === "record-payment" && invoice) setShowPaymentForm(true); }, [searchParams, invoice]);

  const loadPayments = useCallback(async () => {
    if (!businessId || !invoice) return;
    setPaymentsLoading(true);
    try { const { data } = await listInvoicePayments(businessId, invoice.id); if (data && mountedRef.current) setPayments(data.payments); }
    finally { if (mountedRef.current) setPaymentsLoading(false); }
  }, [businessId, invoice]);

  useEffect(() => { if (activeTab === "payments" && payments.length === 0) void loadPayments(); }, [activeTab, loadPayments, payments.length]);

  const paidAmount = (invoice?.payments ?? []).filter(p => p.status === "SUCCESSFUL").reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(0, Number(invoice?.total ?? 0) - paidAmount);
  const dueInfo = invoice ? getDaysUntilDue(invoice.dueDate) : null;

  const withLoading = async (key: string, fn: () => Promise<void>) => {
    setActionLoading(prev => ({ ...prev, [key]: true }));
    try { await fn(); } finally { setActionLoading(prev => { const n = { ...prev }; delete n[key]; return n; }); }
  };

  const handleSend = () => setShowSendReview(true);
  const confirmSend = async () => {
    if (!invoice) return;
    setShowSendReview(false);
    await withLoading("send", async () => {
      const { data, error } = await updateInvoiceStatus(invoice.id, "SENT");
      if (!error && data) { setInvoice(prev => prev ? { ...prev, status: "SENT" } : prev); toast.success("Invoice sent"); }
      else toast.error(error ?? "Failed");
    });
  };

  const handleMarkPaid = () => withLoading("paid", async () => {
    if (!invoice) return;
    const { data, error } = await markInvoicePaid(invoice.id);
    if (!error && data) { setInvoice(prev => prev ? { ...prev, status: data.status ?? "PAID", paidAt: new Date().toISOString() } : prev); toast.success("Marked as paid"); }
    else toast.error(error ?? "Failed");
  });

  const handleVoid = () => {
    if (!invoice) return;
    setConfirmTitle("Void invoice?"); setConfirmMessage("This will cancel the invoice. It cannot be undone.");
    setConfirmAction(() => async () => {
      await withLoading("void", async () => {
        const { data, error } = await updateInvoiceStatus(invoice.id, "VOID");
        if (!error && data) { setInvoice(prev => prev ? { ...prev, status: "VOID" } : prev); toast.success("Voided"); }
        else toast.error(error ?? "Failed");
      });
    });
    setConfirmOpen(true);
  };

  const handleDelete = () => {
    if (!invoice || !businessId) return;
    setConfirmTitle("Delete invoice?"); setConfirmMessage("This action is permanent and cannot be undone.");
    setConfirmAction(() => async () => {
      const { error } = await apiDelete(`/commerce/businesses/${businessId}/invoices/${invoice.id}`);
      if (!error) { toast.success("Deleted"); router.push("/app/commerce/invoices"); }
      else toast.error(error || "Failed");
    });
    setConfirmOpen(true);
  };

  const handleRecordPayment = async () => {
    if (!businessId || !invoice || recordingPayment) return;
    const amount = parseFloat(paymentForm.amount);
    if (isNaN(amount) || amount <= 0) { toast.error("Enter a valid amount"); return; }
    if (amount > remaining + 0.005) { if (!window.confirm(`Amount exceeds remaining balance. Continue?`)) return; }
    setRecordingPayment(true);
    try {
      const { data, error } = await recordInvoicePayment(businessId, invoice.id, { amount, method: paymentForm.method, reference: paymentForm.reference || undefined, notes: paymentForm.notes || undefined });
      if (!error && data) {
        setInvoice(prev => prev ? { ...data.invoice, payments: data.invoice.payments } : prev);
        setPayments(prev => [data.payment, ...prev]);
        toast.success(data.invoice.status === "PAID" ? "Fully paid!" : `Payment recorded`);
        setShowPaymentForm(false); setPaymentForm({ amount: "", method: "Cash", reference: "", notes: "" });
      } else toast.error(error ?? "Failed");
    } finally { setRecordingPayment(false); }
  };

  const handleSendReminder = async () => {
    if (!businessId || !invoice) return;
    const { error } = await sendInvoiceReminder(businessId, invoice.id, { recipientEmail: invoice.contact?.email ?? "", message: `Reminder: invoice ${invoice.invoiceNumber ?? ""} is ${invoice.status === "OVERDUE" ? "overdue" : "awaiting payment"}.`, channel: "email" });
    error ? toast.error(error) : toast.success("Reminder sent");
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  if (error || !invoice) return (
    <div className="max-w-4xl mx-auto py-20 text-center">
      <FileText className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
      <h2 className="text-lg font-semibold mb-2">Invoice not found</h2>
      <p className="text-sm text-muted-foreground mb-4">{error ?? "This invoice may have been deleted."}</p>
      <button onClick={() => router.push("/app/commerce/invoices")} className="px-4 py-2 text-sm font-medium rounded-lg bg-muted hover:bg-muted/80 transition-colors">Back to invoices</button>
    </div>
  );

  const canEdit = invoice.status === "DRAFT";
  const canSend = invoice.status === "DRAFT";
  const canRemind = invoice.status === "SENT" || invoice.status === "OVERDUE" || invoice.status === "PARTIALLY_PAID";
  const canRecordPayment = invoice.status === "SENT" || invoice.status === "OVERDUE" || invoice.status === "PARTIALLY_PAID";
  const canVoid = invoice.status !== "VOID" && invoice.status !== "PAID";
  const canDelete = invoice.status === "DRAFT" || invoice.status === "VOID";
  const meta = STATUS_META[invoice.status] ?? STATUS_META.DRAFT;
  const currentStep = STATUS_ORDER.indexOf(invoice.status);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="max-w-6xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/app/commerce/invoices")} className="p-2 rounded-lg hover:bg-muted transition-colors"><ArrowLeft className="w-4 h-4 text-muted-foreground" /></button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight">Invoice {invoice.invoiceNumber ?? invoice.id.slice(0, 8)}</h1>
              <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${meta.bg} ${meta.color}`}>{meta.label}</span>
              {dueInfo && invoice.status !== "PAID" && invoice.status !== "VOID" && <span className={`text-[11px] font-semibold ${dueInfo.color}`}>{dueInfo.label}</span>}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {invoice.contact ? `${invoice.contact.firstName ?? ""} ${invoice.contact.lastName ?? ""}`.trim() || invoice.contact.email : "No contact"} · {formatAmount(Number(invoice.total), invoice.currency)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canEdit && <button onClick={() => router.push(`/app/commerce/invoices/${invoice.id}/edit`)} className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium rounded-lg border border-border hover:bg-muted transition-colors"><Pencil className="w-3.5 h-3.5" />Edit</button>}
          {canSend && <button onClick={handleSend} disabled={actionLoading.send} className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-semibold rounded-lg bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity shadow-sm disabled:opacity-50">{actionLoading.send ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}Send</button>}
          {canRemind && <button onClick={handleSendReminder} className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium rounded-lg border border-border hover:bg-muted transition-colors"><Bell className="w-3.5 h-3.5" />Remind</button>}
          {canRecordPayment && <button onClick={() => setShowPaymentForm(true)} className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium rounded-lg border border-border hover:bg-muted transition-colors"><DollarSign className="w-3.5 h-3.5" />Record Payment</button>}
          <div className="relative group">
            <button className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-medium rounded-lg border border-border hover:bg-muted transition-colors"><MoreHorizontal className="w-3.5 h-3.5" /></button>
            <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-xl border border-border bg-popover shadow-lg py-1 hidden group-hover:block">
              <DropdownItem icon={LinkIcon} label="Copy payment link" show onClick={async () => { if (!businessId) return; const res = await createInvoicePaymentLink(businessId, invoice.id); const url = res.data?.token ? window.location.origin + "/public/invoice/" + res.data.token : window.location.origin + "/pay/" + invoice.id; navigator.clipboard.writeText(url); toast.success("Copied"); }} />
              <DropdownItem icon={Printer} label="Print / PDF" show onClick={() => window.print()} />
              {invoice.status === "PAID" && <DropdownItem icon={Receipt} label="Resend receipt" show onClick={() => resendInvoiceReceipt(businessId!, invoice.id, {}).then(r => r.data?.success ? toast.success("Resent") : toast.error(r.error ?? "Failed"))} />}
              {canEdit && <DropdownItem icon={CheckCircle} label="Mark paid" show onClick={handleMarkPaid} loading={actionLoading.paid} />}
              {canVoid && <DropdownItem icon={Ban} label="Void" show onClick={handleVoid} loading={actionLoading.void} />}
              {canDelete && <><div className="border-t border-border my-1" /><DropdownItem icon={Trash2} label="Delete" show destructive onClick={handleDelete} /></>}
            </div>
          </div>
        </div>
      </div>

      {/* Status Timeline */}
      <div className="rounded-xl border border-border bg-card shadow-sm p-5 mb-6">
        <div className="flex items-center gap-2">
          {STATUS_ORDER.map((step, idx) => {
            const isActive = step === invoice.status;
            const isPast = currentStep >= 0 && idx < currentStep;
            return (
              <div key={step} className="flex items-center gap-2">
                {idx > 0 && <ChevronRight className="w-4 h-4 text-muted-foreground/30" />}
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold ${isActive ? "bg-foreground text-background" : isPast ? "text-foreground" : "text-muted-foreground"}`}>
                  <div className={`w-2 h-2 rounded-full ${isActive ? "bg-[hsl(var(--kf-accent1))]" : isPast ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
                  {step === "DRAFT" ? "Created" : step === "SENT" ? "Sent" : step === "PAID" ? "Paid" : step === "OVERDUE" ? "Overdue" : "Void"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left */}
        <div className="lg:col-span-2 space-y-6">
          {/* Info Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <InfoCard icon={DollarSign} label="Amount due" value={formatAmount(Number(invoice.total), invoice.currency)} />
            <InfoCard icon={Calendar} label="Issue date" value={invoice.issueDate ? new Date(invoice.issueDate).toLocaleDateString() : "—"} />
            <InfoCard icon={Clock} label="Due date" value={invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : "—"} highlight={invoice.status === "OVERDUE" ? "text-red-600" : undefined} />
            <InfoCard icon={User} label="Client" value={invoice.contact ? `${invoice.contact.firstName ?? ""} ${invoice.contact.lastName ?? ""}`.trim() || invoice.contact.email || "—" : "—"} />
          </div>

          {/* Tabs */}
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="flex items-center border-b border-border">
              {(["activity", "payments", "notes"] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} className={`flex items-center gap-1.5 px-5 py-3 text-[13px] font-medium transition-colors border-b-2 ${activeTab === tab ? "border-[hsl(var(--kf-accent1))] text-[hsl(var(--kf-accent1))]" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                  {tab === "activity" && <Activity className="w-4 h-4" />}{tab === "payments" && <CreditCard className="w-4 h-4" />}{tab === "notes" && <StickyNote className="w-4 h-4" />}
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  {tab === "payments" && (invoice.payments?.length ?? 0) > 0 && <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full">{invoice.payments!.length}</span>}
                </button>
              ))}
            </div>
            <div className="p-5 min-h-[180px]">
              <AnimatePresence mode="wait">
                {activeTab === "activity" && (
                  <motion.div key="activity" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                    {timeline.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">No activity recorded yet.</p> :
                      timeline.map((entry, idx) => (
                        <div key={idx} className="flex items-start gap-3">
                          <div className="w-2 h-2 rounded-full bg-[hsl(var(--kf-accent1))] mt-2 shrink-0" />
                          <div><p className="text-sm">{entry.label}</p><p className="text-[11px] text-muted-foreground">{new Date(entry.at).toLocaleString()}</p></div>
                        </div>
                      ))}
                  </motion.div>
                )}
                {activeTab === "payments" && (
                  <motion.div key="payments" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
                    {paymentsLoading ? <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div> :
                      payments.length === 0 ? (
                        <div className="text-center py-6">
                          <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
                          {canRecordPayment && <button onClick={() => setShowPaymentForm(true)} className="mt-2 text-xs text-[hsl(var(--kf-accent1))] hover:underline">Record a payment</button>}
                        </div>
                      ) : payments.map(p => (
                        <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/60">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${p.status === "SUCCESSFUL" ? "bg-emerald-50" : "bg-amber-50"}`}>
                              <DollarSign className={`w-4 h-4 ${p.status === "SUCCESSFUL" ? "text-emerald-600" : "text-amber-600"}`} />
                            </div>
                            <div>
                              <p className="text-sm font-medium">{formatAmount(p.amount, p.currency)}</p>
                              <p className="text-[11px] text-muted-foreground">{p.provider} · {new Date(p.createdAt).toLocaleDateString()}</p>
                            </div>
                          </div>
                          <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${p.status === "SUCCESSFUL" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{p.status}</span>
                        </div>
                      ))}
                  </motion.div>
                )}
                {activeTab === "notes" && (
                  <motion.div key="notes" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    {invoice.notes ? <div className="p-4 rounded-lg bg-muted/30 border border-border/60"><p className="text-sm whitespace-pre-wrap">{invoice.notes}</p></div> : <p className="text-sm text-muted-foreground text-center py-6">No notes on this invoice.</p>}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Line Items */}
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border"><h3 className="text-sm font-semibold">Line Items</h3></div>
            <div className="divide-y divide-border/60">
              {(invoice.items ?? []).map((item, idx) => (
                <div key={item.id ?? idx} className="px-5 py-3 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{item.description || "Unnamed item"}</p>
                    <p className="text-[11px] text-muted-foreground">{item.quantity} x {formatAmount(item.unitPrice, invoice.currency)}</p>
                  </div>
                  <p className="text-sm font-semibold shrink-0">{formatAmount(item.total ?? item.quantity * item.unitPrice, invoice.currency)}</p>
                </div>
              ))}
            </div>
            <div className="border-t border-border px-5 py-4 space-y-2 bg-muted/20">
              <div className="flex justify-between text-sm text-muted-foreground"><span>Subtotal</span><span>{formatAmount(Number(invoice.subtotal ?? invoice.items?.reduce((s, i) => s + (i.total || i.quantity * i.unitPrice), 0) ?? 0), invoice.currency)}</span></div>
              {(invoice.taxRate || 0) > 0 && <div className="flex justify-between text-sm text-muted-foreground"><span>Tax ({invoice.taxRate}%)</span><span>{formatAmount(invoice.taxAmount ?? 0, invoice.currency)}</span></div>}
              {(invoice.discountAmount || 0) > 0 && <div className="flex justify-between text-sm text-emerald-600"><span>Discount</span><span>-{formatAmount(invoice.discountAmount ?? 0, invoice.currency)}</span></div>}
              <div className="flex justify-between items-center pt-2 border-t border-border">
                <span className="text-sm font-bold">Total</span>
                <span className="text-xl font-extrabold text-[hsl(var(--kf-accent1))]">{formatAmount(Number(invoice.total), invoice.currency)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="space-y-6">
          {/* Contact */}
          <div className="rounded-xl border border-border bg-card shadow-sm p-5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Bill to</h3>
            {invoice.contact ? (
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-[hsl(var(--kf-accent1))]/10 flex items-center justify-center shrink-0 text-sm font-bold text-[hsl(var(--kf-accent1))]">
                  {(invoice.contact.firstName?.[0] ?? "") + (invoice.contact.lastName?.[0] ?? "")}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{`${invoice.contact.firstName ?? ""} ${invoice.contact.lastName ?? ""}`.trim() || "Unnamed"}</p>
                  {invoice.contact.email && <p className="text-[11px] text-muted-foreground truncate">{invoice.contact.email}</p>}
                </div>
              </div>
            ) : <p className="text-sm text-muted-foreground">No contact assigned</p>}
          </div>

          {/* Payment Summary */}
          <div className="rounded-xl border border-border bg-card shadow-sm p-5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Payment Summary</h3>
            <div className="space-y-2">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Total</span><span className="font-semibold">{formatAmount(Number(invoice.total), invoice.currency)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Paid</span><span className="font-semibold text-emerald-600">{formatAmount(paidAmount, invoice.currency)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Remaining</span><span className="font-semibold">{formatAmount(remaining, invoice.currency)}</span></div>
              {Number(invoice.total) > 0 && (
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden mt-2">
                  <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, (paidAmount / Number(invoice.total)) * 100)}%` }} />
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="rounded-xl border border-border bg-card shadow-sm p-5 space-y-1">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Actions</h3>
            {canSend && <ActionButton icon={Send} label="Send invoice" onClick={handleSend} loading={actionLoading.send} primary />}
            {canRemind && <ActionButton icon={Bell} label="Send reminder" onClick={handleSendReminder} />}
            {canRecordPayment && <ActionButton icon={DollarSign} label="Record payment" onClick={() => setShowPaymentForm(true)} />}
            <ActionButton icon={LinkIcon} label="Copy payment link" onClick={async () => { if (!businessId) return; const { data } = await createInvoicePaymentLink(businessId, invoice.id); const url = data?.token ? window.location.origin + "/public/invoice/" + data.token : window.location.origin + "/pay/" + invoice.id; navigator.clipboard.writeText(url); toast.success("Copied"); }} />
            <ActionButton icon={Printer} label="Print / PDF" onClick={() => window.print()} />
            {canEdit && <ActionButton icon={CheckCircle} label="Mark paid" onClick={handleMarkPaid} loading={actionLoading.paid} />}
            {canVoid && <ActionButton icon={Ban} label="Void invoice" onClick={handleVoid} loading={actionLoading.void} />}
          </div>
        </div>
      </div>

      {/* Payment Modal */}
      {showPaymentForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="bg-card border border-border rounded-xl p-6 w-full max-w-md shadow-xl space-y-4">
            <h3 className="text-lg font-semibold">Record Payment</h3>
            <div className="space-y-3">
              <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Amount</label><input type="number" step="0.01" value={paymentForm.amount} onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))} placeholder={remaining.toFixed(2)} className="w-full h-10 px-3 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20" /></div>
              <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Method</label>
                <select value={paymentForm.method} onChange={e => setPaymentForm(f => ({ ...f, method: e.target.value }))} className="w-full h-10 px-3 text-sm bg-background border border-border rounded-lg focus:outline-none">
                  <option value="Cash">Cash</option><option value="Bank Transfer">Bank Transfer</option><option value="Check">Check</option><option value="Card">Card</option><option value="PayPal">PayPal</option><option value="Other">Other</option>
                </select>
              </div>
              <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Reference (optional)</label><input type="text" value={paymentForm.reference} onChange={e => setPaymentForm(f => ({ ...f, reference: e.target.value }))} className="w-full h-10 px-3 text-sm bg-background border border-border rounded-lg focus:outline-none" /></div>
              <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Notes (optional)</label><textarea value={paymentForm.notes} onChange={e => setPaymentForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none resize-none" /></div>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button onClick={handleRecordPayment} disabled={recordingPayment} className="flex-1 h-10 text-sm font-semibold rounded-lg bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50">{recordingPayment ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Record Payment"}</button>
              <button onClick={() => setShowPaymentForm(false)} className="flex-1 h-10 text-sm font-medium rounded-lg border border-border hover:bg-muted transition-colors">Cancel</button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Send Review Modal */}
      {showSendReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="bg-card border border-border rounded-xl p-6 w-full max-w-lg shadow-xl space-y-4">
            <h3 className="text-lg font-semibold">Send Invoice</h3>
            <div className="space-y-3 text-sm">
              <div className="p-3 rounded-lg bg-muted/40 border border-border/60"><p className="text-xs text-muted-foreground mb-1">To</p><p className="font-medium">{invoice.contact?.email ?? "No email"}</p></div>
              <div className="p-3 rounded-lg bg-muted/40 border border-border/60"><p className="text-xs text-muted-foreground mb-1">Invoice</p><p className="font-medium">{invoice.invoiceNumber ?? invoice.id.slice(0, 8)} · {formatAmount(Number(invoice.total), invoice.currency)}</p></div>
              <div className="p-3 rounded-lg bg-muted/40 border border-border/60"><p className="text-xs text-muted-foreground mb-1">Items</p><p className="font-medium">{(invoice.items ?? []).length} item(s)</p></div>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button onClick={confirmSend} disabled={actionLoading.send} className="flex-1 h-10 text-sm font-semibold rounded-lg bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50">{actionLoading.send ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Confirm & Send"}</button>
              <button onClick={() => setShowSendReview(false)} className="flex-1 h-10 text-sm font-medium rounded-lg border border-border hover:bg-muted transition-colors">Cancel</button>
            </div>
          </motion.div>
        </div>
      )}

      <ConfirmDialog open={confirmOpen} onCancel={() => setConfirmOpen(false)} title={confirmTitle} message={confirmMessage} confirmLabel="Confirm" variant={confirmTitle.includes("Delete") || confirmTitle.includes("Void") ? "danger" : "default"} onConfirm={() => { confirmAction?.(); setConfirmOpen(false); }} />
    </motion.div>
  );
}

function InfoCard({ icon: Icon, label, value, highlight }: { icon: React.ElementType; label: string; value: string; highlight?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-1.5 mb-1"><Icon className="w-3.5 h-3.5 text-muted-foreground/60" /><span className="text-[10px] font-semibold text-muted-foreground uppercase">{label}</span></div>
      <p className={`text-sm font-semibold truncate ${highlight ?? ""}`}>{value}</p>
    </div>
  );
}

function ActionButton({ icon: Icon, label, onClick, loading, primary }: { icon: React.ElementType; label: string; onClick: () => void; loading?: boolean; primary?: boolean }) {
  return (
    <button onClick={onClick} disabled={loading} className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${primary ? "bg-[hsl(var(--kf-accent1))]/5 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/10" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
      <Icon className={`w-3.5 h-3.5 shrink-0 ${loading ? "animate-spin" : ""}`} />{label}
    </button>
  );
}

function DropdownItem({ icon: Icon, label, onClick, show, loading, destructive }: { icon: React.ElementType; label: string; onClick: () => void; show: boolean; loading?: boolean; destructive?: boolean }) {
  if (!show) return null;
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors ${destructive ? "text-red-600 hover:bg-red-50" : "text-foreground/80 hover:bg-muted"}`}>
      <Icon className={`w-3.5 h-3.5 shrink-0 ${loading ? "animate-spin" : ""}`} />{label}
    </button>
  );
}
