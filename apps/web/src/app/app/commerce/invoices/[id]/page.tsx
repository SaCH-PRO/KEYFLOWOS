"use client";

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { createPortal, flushSync } from "react-dom";
import Link from "next/link";
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
  Loader2,
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
  Download,
  RotateCcw,
} from "lucide-react";
import {
  getInvoice,
  getInvoiceTimeline,
  listInvoicePayments,
  updateInvoiceStatus,
  markInvoicePaid,
  resendInvoiceReceipt,
  createInvoicePaymentLink,
  recordInvoicePayment,
  confirmPendingInvoicePayment,
  sendInvoiceEmail,
  refundPayment,
  Invoice,
  PaymentRecord,
  InvoiceTimelineEntry,
} from "@/lib/client";
import {
  isManualPayment,
  isOutOfBandRefundable,
  isGatewayRefundable,
  GATEWAY_REFUND_HREF,
  manualRefundableAmount,
  manualRefundQuestion,
  moneyOf,
  outOfBandRefundQuestion,
  MANUAL_REFUND_CHECKING,
} from "@/lib/manual-refund";
import { apiDelete, providerUnavailableOf } from "@/lib/api";
import { canMarkInvoicePaid, canShareInvoicePayLink } from "@/lib/commerce-status";
import { invoiceBalanceOfStoredRows } from "@keyflow/shared";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { useCompose } from "@/components/email/compose-context";
import { formatAmount, getDaysUntilDue } from "../../utils/commerce-utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { attemptIdempotencyKey, newPaymentAttempt, type PaymentAttempt } from "../../../finance/components/payment-record-modal";
// SWP-INV-DETAIL (BUG-051): what a print of this page shows (the invoice sheet alone).
import "./print.css";

const STATUS_ORDER = ["DRAFT", "SENT", "PAID", "OVERDUE", "VOID"];
const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  DRAFT: { label: "Draft", color: "text-slate-700", bg: "bg-slate-100" },
  SENT: { label: "Sent", color: "text-amber-700", bg: "bg-amber-50" },
  PAID: { label: "Paid", color: "text-emerald-700", bg: "bg-emerald-50" },
  PARTIALLY_PAID: { label: "Part-paid", color: "text-sky-700", bg: "bg-sky-50" },
  OVERDUE: { label: "Overdue", color: "text-red-700", bg: "bg-red-50" },
  VOID: { label: "Void", color: "text-gray-500", bg: "bg-gray-100" },
};

/**
 * V1-41 (D-27): Payment.provider of a payment an evidence scan or a Drive
 * intake recorded PENDING (the server's EXTRACTED_PAYMENT_PROVIDER). Such a
 * row is not money until a member with revenue write access confirms it
 * (V1-41b: POST .../payments/:paymentId/confirm). A customer's pay-link intent
 * is PENDING too, but is not an extracted row and is not confirmed here.
 */
const EXTRACTED_PAYMENT_PROVIDER = "extracted";
const isPendingExtractedPayment = (p: PaymentRecord) => p.status === "PENDING" && p.provider === EXTRACTED_PAYMENT_PROVIDER;

/**
 * V1-41b (V1-41 review CR-V41-4): a confirmed extracted row (CONFIRMED) keeps
 * its amount beside the SUCCESSFUL payment the member recorded from it; that
 * payment is the money, so the row is never listed as a second one. The
 * payments route no longer serves it; the invoice read still carries it.
 */
const isListedPayment = (p: PaymentRecord) => p.status !== "CONFIRMED";

/** SWP-INV-DETAIL (BUG-051): set on <body> while the invoice sheet is printed; print.css prints the sheet alone. */
const PRINTING_INVOICE_CLASS = "kf-printing-invoice";

export default function InvoiceDetailPage() {
  const router = useRouter();
  const { open: openComposer } = useCompose();
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
  // V1-41b: the pending extracted payment being confirmed, and whether the
  // server refused this member the confirmation (403: no revenue write access).
  const [confirmingPaymentId, setConfirmingPaymentId] = useState<string | null>(null);
  const [confirmForbidden, setConfirmForbidden] = useState(false);
  const confirmingPaymentRef = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [confirmMessage, setConfirmMessage] = useState("");
  const [showSendReview, setShowSendReview] = useState(false);
  // W9-WEB-COMMERCE-NAV (R0-07): why the last "Email invoice" did not go out,
  // when the server said email is not set up or not available.
  const [emailError, setEmailError] = useState<string | null>(null);
  // SWP-INV-REFUND-UI (BUG-049, D-169): the payment being refunded and the whole amount the confirm names; whether
  // the refund is in flight; the last refusal, in the server's words; and whether the server refused this member
  // refunds (403: no revenue write access).
  // amount null: the dialog is open and the invoice's latest figures are being read (its confirm waits for them).
  const [refundTarget, setRefundTarget] = useState<{ payment: PaymentRecord; amount: number | null } | null>(null);
  // Review MINOR-5: each Refund press takes a lookup number; only the latest press's read opens its amount.
  const refundLookupRef = useRef(0);
  const [refunding, setRefunding] = useState(false);
  const refundingRef = useRef(false);
  const [refundError, setRefundError] = useState<string | null>(null);
  const [refundForbidden, setRefundForbidden] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    const init = async () => {
      const fresh = await refreshWorkspace();
      const id = fresh ?? getStoredBusinessId();
      if (!mountedRef.current) return;
      if (id) setBusinessId(id);
      else { setError("Select a workspace to view this invoice"); setLoading(false); }
    };
    void init();
  }, []);

  // R0-QI-01: the invoice is read through the tenant-bound detail route, so
  // the load waits for the workspace id instead of falling back to the public
  // bare-id route (which hid DRAFT and VOID behind its shareable gate).
  useEffect(() => {
    if (!invoiceId || !businessId) return;
    const load = async () => {
      setLoading(true);
      try {
        const { data, error } = await getInvoice(businessId, invoiceId);
        if (!mountedRef.current) return;
        if (error || !data) { setError(error ?? "Not found"); setLoading(false); return; }
        setInvoice(data);
        const tl = await getInvoiceTimeline(businessId, invoiceId);
        if (tl.data && mountedRef.current) setTimeline(tl.data.entries);
      } catch { setError("Failed to load"); }
      finally { if (mountedRef.current) setLoading(false); }
    };
    void load();
  }, [invoiceId, businessId]);

  useEffect(() => { if (searchParams.get("action") === "record-payment" && invoice) setShowPaymentForm(true); }, [searchParams, invoice]);

  // SWP-INV-DETAIL (BUG-084): the Payments tab lists the server's rows. It reads them when it is first opened, and
  // again once something here changed them without answering them (Mark paid); a payment recorded here is listed
  // from the answer at once. It read the list only while its own was empty, so a payment recorded before the tab was
  // opened was the only row it ever listed, and Mark paid's payment was never listed.
  // Review MINOR-2: each read takes a generation, and only the latest read's answer is listed, so a read that was in
  // flight when money was recorded never replaces the list read after it.
  const loadedInvoiceId = invoice?.id;
  const [paymentsLoaded, setPaymentsLoaded] = useState(false);
  const paymentsReadRef = useRef(0);
  const loadPayments = useCallback(async () => {
    if (!businessId || !loadedInvoiceId) return;
    const read = ++paymentsReadRef.current;
    setPaymentsLoading(true);
    try {
      const { data } = await listInvoicePayments(businessId, loadedInvoiceId);
      if (data && mountedRef.current && read === paymentsReadRef.current) setPayments(data.payments);
    } finally {
      if (mountedRef.current && read === paymentsReadRef.current) { setPaymentsLoading(false); setPaymentsLoaded(true); }
    }
  }, [businessId, loadedInvoiceId]);

  useEffect(() => { if (activeTab === "payments" && !paymentsLoaded && !paymentsLoading) void loadPayments(); }, [activeTab, paymentsLoaded, paymentsLoading, loadPayments]);

  // SWP-INV-DETAIL (BUG-088, web side): the Activity tab is the server's timeline (its 'Invoice sent' entry comes
  // from the sentAt the server stamps on DRAFT -> SENT). It is read again after each action here that adds an entry,
  // so the entry shows without a reload.
  const refreshTimeline = useCallback(async () => {
    if (!businessId || !loadedInvoiceId) return;
    const tl = await getInvoiceTimeline(businessId, loadedInvoiceId);
    if (tl.data && mountedRef.current) setTimeline(tl.data.entries);
  }, [businessId, loadedInvoiceId]);

  // R0-21 (M29): the server's status-aware figures (tenant detail route, and
  // after a record the payments route's response). A response that carries no
  // figures is read through the shared balance contract over its rows
  // (V1-29b-REFUND-READERS, review V36-CR-1: invoiceBalanceOfStoredRows, the
  // mirror of the server's balanceOfStoredRows): paid is the net received, so
  // a refund (a separate negative REFUNDED row, D-14) is owed again. The
  // SUCCESSFUL rows alone read 60 + 40 paid with the 40 refunded as Paid 100,
  // Remaining 0.
  const serverFigures = typeof invoice?.paidAmount === "number" && typeof invoice?.remaining === "number"
    ? { paidAmount: invoice.paidAmount, remaining: invoice.remaining }
    : null;
  const rowFigures = (() => {
    if (serverFigures || !invoice) return null;
    const balance = invoiceBalanceOfStoredRows(Number(invoice.total), invoice.payments ?? [], invoice.currency);
    return { paidAmount: balance.net, remaining: balance.remaining };
  })();
  const paidAmount = serverFigures?.paidAmount ?? rowFigures?.paidAmount ?? 0;
  const remaining = serverFigures?.remaining ?? rowFigures?.remaining ?? 0;
  // SWP-INV-DETAIL review MINOR-3: a VOID or FULLY_CREDITED invoice owes nothing, whatever remaining is stored on it:
  // Amount due, the print sheet and the PDF say 0 (a VOID one keeps its Void status beside it). A PARTIALLY_CREDITED
  // invoice shows the server's figure: netting its credit notes is the server's (follow-up), never the web's.
  const amountDue = invoice?.status === "VOID" || invoice?.status === "FULLY_CREDITED" ? 0 : remaining;
  const dueInfo = invoice ? getDaysUntilDue(invoice.dueDate) : null;

  // R0-21 (M26, CF-08): one payment attempt per open of the payment form. Its
  // key is made on the first submit and reused by every retry; closing drops
  // it. A submit with a reference is keyed by the server's reference slot
  // instead (attemptIdempotencyKey, review R021-ST-1).
  const paymentAttemptRef = useRef<PaymentAttempt | null>(null);
  const recordingPaymentRef = useRef(false);
  useEffect(() => { if (!showPaymentForm) paymentAttemptRef.current = null; }, [showPaymentForm]);

  // SWP-INV-DETAIL (BUG-051): Print printed the app screen (navigation, tabs, buttons). While the browser prints
  // (this page's Print, or the browser's own, which fires beforeprint), the invoice sheet is placed beside the app
  // under <body>, and print.css prints it alone; it is removed once printing is over (afterprint). flushSync puts
  // it in place before the browser lays the page out for printing.
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); };
  }, []);
  const printSheetShown = printing && !!invoice;
  useLayoutEffect(() => {
    if (!printSheetShown) return;
    document.body.classList.add(PRINTING_INVOICE_CLASS);
    return () => document.body.classList.remove(PRINTING_INVOICE_CLASS);
  }, [printSheetShown]);
  const handlePrint = () => {
    flushSync(() => setPrinting(true));
    window.print();
  };

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
      if (!error && data) { setInvoice(prev => prev ? { ...prev, status: "SENT" } : prev); toast.success("Invoice sent"); await refreshTimeline(); }
      else toast.error(error ?? "Failed");
    });
  };

  // W9-WEB-COMMERCE-NAV (R0-07): the send-email door. The server emails the
  // customer the invoice with its token pay link and moves a DRAFT to SENT
  // (POST .../invoices/:id/send-email). With no Gmail connection it answers
  // 503 {code: 'provider_not_configured'} before any outbound call (and
  // provider_unavailable when Gmail is down): the page says so where the owner
  // is looking, with the server's message, and the status stays as it was.
  // "Send" is unchanged: it marks the invoice sent without emailing anyone.
  const handleEmailInvoice = () => withLoading("email", async () => {
    if (!businessId || !invoice) return;
    setEmailError(null);
    const res = await sendInvoiceEmail(businessId, invoice.id, {});
    if (!mountedRef.current) return;
    if (!res.error && res.data) {
      if (invoice.status === "DRAFT") setInvoice(prev => prev ? { ...prev, status: "SENT" } : prev);
      toast.success("Invoice emailed");
      await refreshTimeline();
      return;
    }
    const unavailable = providerUnavailableOf(res);
    if (unavailable) {
      const what = unavailable.code === "provider_not_configured" ? "Email is not configured" : "Email is unavailable right now";
      setEmailError(`${what}: ${res.error ?? "no email provider answered"}. The invoice was not emailed.`);
    } else toast.error(res.error ?? "Could not email this invoice");
  });

  // SWP-INV-DETAIL (BUG-084, BUG-085): Mark paid records the balance as a payment on the server (R0-PL-04), and its
  // answer carries no figures: the invoice (with the server's Paid and Remaining), its activity and its payments are
  // read again, so the page says nothing is due and lists the payment.
  const handleMarkPaid = () => withLoading("paid", async () => {
    if (!invoice || !businessId) return;
    // Review S-2: the write names the page's business, not whatever storage holds.
    const { data, error } = await markInvoicePaid(invoice.id, businessId);
    if (!error && data) {
      setInvoice(prev => prev ? { ...prev, status: data.status ?? "PAID", paidAt: data.paidAt ?? new Date().toISOString() } : prev);
      toast.success("Marked as paid");
      // Review MINOR-2: read again whatever is in flight (a newer read wins).
      void loadPayments();
      const fresh = await getInvoice(businessId, invoice.id);
      if (fresh.data && mountedRef.current) setInvoice(fresh.data);
      await refreshTimeline();
    }
    else toast.error(error ?? "Failed");
  });

  const handleVoid = () => {
    if (!invoice) return;
    setConfirmTitle("Void invoice?"); setConfirmMessage("This will cancel the invoice. It cannot be undone.");
    setConfirmAction(() => async () => {
      await withLoading("void", async () => {
        const { data, error } = await updateInvoiceStatus(invoice.id, "VOID");
        if (!error && data) { setInvoice(prev => prev ? { ...prev, status: "VOID" } : prev); toast.success("Voided"); await refreshTimeline(); }
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
    if (!businessId || !invoice || recordingPayment || recordingPaymentRef.current) return;
    const amount = parseFloat(paymentForm.amount);
    if (isNaN(amount) || amount <= 0) { toast.error("Enter a valid amount"); return; }
    if (amount > remaining + 0.005) {
      if (!window.confirm(`Over-payment of ${formatAmount(amount - remaining, invoice.currency)}: this invoice has ${formatAmount(remaining, invoice.currency)} remaining. Record it anyway? It will need a refund.`)) return;
    }
    if (!paymentAttemptRef.current) paymentAttemptRef.current = newPaymentAttempt();
    recordingPaymentRef.current = true;
    setRecordingPayment(true);
    try {
      const { data, error } = await recordInvoicePayment(businessId, invoice.id, { amount, method: paymentForm.method, reference: paymentForm.reference || undefined, notes: paymentForm.notes || undefined, idempotencyKey: attemptIdempotencyKey(paymentAttemptRef.current, paymentForm.reference) });
      if (!error && data) {
        setInvoice(prev => prev ? { ...data.invoice, payments: data.invoice.payments, paidAmount: data.paidAmount, remaining: data.remaining } : prev);
        // A keyed retry answers the payment already recorded: list it once.
        setPayments(prev => [data.payment, ...prev.filter(p => p.id !== data.payment.id)]);
        toast.success(data.invoice.status === "PAID" ? "Fully paid!" : `Payment recorded`);
        setShowPaymentForm(false); setPaymentForm({ amount: "", method: "Cash", reference: "", notes: "" });
        // Review MINOR-2: once the tab has read (or is reading) the list, it is read again, so a read in flight
        // from before this payment never replaces the list with one that lacks it.
        if (paymentsLoaded || paymentsLoading) void loadPayments();
        void refreshTimeline();
      } else toast.error(error ?? "Failed");
    } finally { recordingPaymentRef.current = false; setRecordingPayment(false); }
  };

  // V1-41b-PENDING-PAYMENT-CONFIRM-ROUTE (D-27): confirm a payment an evidence
  // scan or a Drive intake recorded PENDING. The amount sent is the one shown
  // on the row, so a pending amount that changed meanwhile is refused (409)
  // rather than recorded. The server's figures come from the answer; the list
  // is read again so the confirmed money is listed once. A 403 (no revenue
  // write access) withdraws the action; any other refusal re-reads the list
  // (another member may have confirmed it first).
  const handleConfirmPending = async (p: PaymentRecord) => {
    if (!businessId || !invoice || confirmingPaymentRef.current) return;
    confirmingPaymentRef.current = true;
    setConfirmingPaymentId(p.id);
    try {
      const { data, error, status } = await confirmPendingInvoicePayment(businessId, invoice.id, p.id, { amount: Number(p.amount) });
      if (!error && data) {
        setInvoice(prev => prev ? { ...data.invoice, payments: data.invoice.payments, paidAmount: data.paidAmount, remaining: data.remaining } : prev);
        toast.success(`Payment of ${formatAmount(data.payment.amount, data.payment.currency)} confirmed`);
        await loadPayments();
        void refreshTimeline();
      } else if (status === 403) {
        setConfirmForbidden(true);
        toast.error("Confirming a payment needs revenue write access", { description: error ?? undefined });
      } else {
        toast.error(error ?? "Could not confirm this payment");
        await loadPayments();
      }
    } finally {
      confirmingPaymentRef.current = false;
      if (mountedRef.current) setConfirmingPaymentId(null);
    }
  };

  // SWP-INV-REFUND-UI (BUG-049; refund ruling D-169: whole-payment refunds only). A payment recorded by hand is
  // refunded through POST .../payments/:paymentId/refund (revenue write; no provider is called: the member gives the
  // money back). Refund asks first, naming the whole amount the server will refund (what is left of the payment,
  // never more than the invoice received net: manualRefundableAmount, the server's reading); nothing is sent until it
  // is confirmed, and a second press while it is in flight sends nothing. Only the server's answer is reported: its
  // refund row's amount on success, after which the invoice, its payments and its activity are read again; a refusal
  // in the server's words (a 403 also withdraws Refund; any other re-reads, as the payment may have changed).
  // Review MINOR-3 (repair round 1): the amount is never the last-loaded one. The dialog opens at once and the invoice
  // and its payments are read again; the confirm waits for that read and names the amount from it (a payment refunded
  // meanwhile, in part or whole, by another member). Only the latest press's read counts; Cancel drops a read in flight.
  const openRefund = async (p: PaymentRecord) => {
    if (!businessId || !invoice || refundingRef.current) return;
    const lookup = ++refundLookupRef.current;
    setRefundError(null);
    setRefundTarget({ payment: p, amount: null });
    const [fresh, list] = await Promise.all([getInvoice(businessId, invoice.id), listInvoicePayments(businessId, invoice.id)]);
    if (!mountedRef.current || lookup !== refundLookupRef.current) return;
    if (fresh.data) setInvoice(fresh.data);
    if (!list.data) {
      setRefundTarget(null);
      setRefundError(list.error ?? "The invoice's payments could not be read.");
      return;
    }
    setPayments(list.data.payments);
    const current = list.data.payments.find((row) => row.id === p.id);
    const amount = current && (isManualPayment(current) || isOutOfBandRefundable(current)) ? manualRefundableAmount(current, list.data.payments, list.data.paidAmount) : 0;
    if (!current || !(amount > 0)) {
      setRefundTarget(null);
      setRefundError("Nothing is left to refund on this payment.");
      return;
    }
    setRefundTarget({ payment: current, amount });
  };

  const reloadAfterRefund = async () => {
    if (!businessId || !invoice) return;
    const fresh = await getInvoice(businessId, invoice.id);
    if (fresh.data && mountedRef.current) setInvoice(fresh.data);
    await loadPayments();
    void refreshTimeline();
  };

  const handleRefund = async () => {
    const target = refundTarget;
    if (!businessId || !invoice || !target || target.amount === null || refundingRef.current) return;
    refundingRef.current = true;
    setRefunding(true);
    setRefundError(null);
    try {
      const { data, error, status } = await refundPayment(businessId, target.payment.id);
      if (!mountedRef.current) return;
      setRefundTarget(null);
      if (!error && data) {
        toast.success(`Refunded ${formatAmount(Math.abs(Number(data.amount)), data.currency || invoice.currency)}`, {
          description: "Recorded in KeyFlow. Give the money back to the customer yourself: nothing was sent to them.",
        });
        await reloadAfterRefund();
        return;
      }
      const message = error ?? "The refund was not recorded.";
      setRefundError(message);
      toast.error("Not refunded", { description: message });
      if (status === 403) setRefundForbidden(true);
      else await reloadAfterRefund();
    } finally {
      refundingRef.current = false;
      if (mountedRef.current) setRefunding(false);
    }
  };

  const handleSendReminder = () => {
    if (!invoice) return;
    openComposer({
      to: invoice.contact?.email ?? "",
      subject: `Friendly reminder: invoice ${invoice.invoiceNumber ?? ""}`,
      body: "",
      context: {
        type: "follow_up",
        recordNumber: invoice.invoiceNumber ?? invoice.id,
        contactName: invoice.contact?.firstName ? `${invoice.contact.firstName} ${invoice.contact.lastName ?? ""}`.trim() : undefined,
      },
      onSent: () => {
        toast.success("Reminder sent");
      },
    });
  };

  // V1-46b-TOKEN-PAY-COMPLETE (CR-01; D-07: token links only): the token link
  // or an error. The fallback was the retired bare-id /pay/:id page, so a
  // paid or void invoice copied a dead link.
  const copyPaymentLink = async () => {
    if (!businessId || !invoice || !canShareInvoicePayLink(invoice.status)) return;
    const { data, error: linkError } = await createInvoicePaymentLink(businessId, invoice.id);
    if (!data?.token) {
      toast.error(linkError ?? "Could not create a payment link for this invoice");
      return;
    }
    await navigator.clipboard.writeText(`${window.location.origin}/public/invoice/${data.token}`);
    toast.success("Copied");
  };

  // SWP-INV-DETAIL (BUG-051): Download PDF builds a one-invoice A4 PDF (jspdf, jspdf-autotable) from the same
  // projection the page and its print sheet show, and downloads it as <invoice number>.pdf.
  const handleDownloadPdf = () => withLoading("pdf", async () => {
    if (!invoice) return;
    try {
      const doc = invoiceDocumentOf(invoice, paidAmount, amountDue);
      const blob = await invoicePdfBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${doc.number.replace(/[^A-Za-z0-9._-]+/g, "_")}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL?.(url), 30_000);
    } catch {
      toast.error("Could not make the PDF of this invoice");
    }
  });

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
  // The server emails any invoice but a VOID one; a PAID one has its receipt door.
  const canEmail = invoice.status !== "VOID" && invoice.status !== "PAID";
  const canRemind = invoice.status === "SENT" || invoice.status === "OVERDUE" || invoice.status === "PARTIALLY_PAID";
  const canRecordPayment = invoice.status === "SENT" || invoice.status === "OVERDUE" || invoice.status === "PARTIALLY_PAID";
  // SWP-INV-DETAIL (BUG-086): Mark paid records the balance as a payment, so it is offered where a payment can be
  // recorded. It was offered on a DRAFT only, which the server refuses (409), and never on an invoice that can be paid.
  const canMarkPaid = canMarkInvoicePaid(invoice.status);
  const canSharePayLink = canShareInvoicePayLink(invoice.status);
  const canVoid = invoice.status !== "VOID" && invoice.status !== "PAID";
  const canDelete = invoice.status === "DRAFT" || invoice.status === "VOID";
  const meta = STATUS_META[invoice.status] ?? STATUS_META.DRAFT;
  const currentStep = STATUS_ORDER.indexOf(invoice.status);
  // V1-41b (CR-V41-4): a CONFIRMED extracted row is not a payment of its own.
  const listedPayments = payments.filter(isListedPayment);
  const listedInvoicePaymentCount = (invoice.payments ?? []).filter(isListedPayment).length;
  // V1-41b: a pending extracted payment is confirmed only while the invoice
  // takes payments (the confirmation records one), and not after the server
  // refused this member (403).
  const canConfirmPending = canRecordPayment && !confirmForbidden;

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
              <DropdownItem icon={LinkIcon} label="Copy payment link" show={canSharePayLink} onClick={copyPaymentLink} />
              <DropdownItem icon={Printer} label="Print" show onClick={handlePrint} />
              <DropdownItem icon={Download} label="Download PDF" show onClick={handleDownloadPdf} loading={actionLoading.pdf} />
              {invoice.status === "PAID" && <DropdownItem icon={Receipt} label="Resend receipt" show onClick={() => resendInvoiceReceipt(businessId!, invoice.id, {}).then(r => r.data?.success ? toast.success("Resent") : toast.error(r.error ?? "Failed"))} />}
              {canMarkPaid && <DropdownItem icon={CheckCircle} label="Mark paid" show onClick={handleMarkPaid} loading={actionLoading.paid} />}
              {canVoid && <DropdownItem icon={Ban} label="Void" show onClick={handleVoid} loading={actionLoading.void} />}
              {canDelete && <><div className="border-t border-border my-1" /><DropdownItem icon={Trash2} label="Delete" show destructive onClick={handleDelete} /></>}
            </div>
          </div>
        </div>
      </div>

      {emailError && (
        <div role="alert" className="mb-6 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{emailError}</span>
          <button onClick={() => setEmailError(null)} className="shrink-0 text-xs font-medium underline">Dismiss</button>
        </div>
      )}

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
            {/* SWP-INV-DETAIL (BUG-085): what is still owed (the Payment Summary's Remaining), not the total. */}
            <InfoCard icon={DollarSign} label="Amount due" value={formatAmount(amountDue, invoice.currency)} />
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
                  {tab === "payments" && listedInvoicePaymentCount > 0 && <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full">{listedInvoicePaymentCount}</span>}
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
                    {refundError && (
                      <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        <span>Not refunded: {refundError}</span>
                        <button onClick={() => setRefundError(null)} className="shrink-0 text-xs font-medium underline">Dismiss</button>
                      </div>
                    )}
                    {paymentsLoading ? <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div> :
                      listedPayments.length === 0 ? (
                        <div className="text-center py-6">
                          <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
                          {canRecordPayment && <button onClick={() => setShowPaymentForm(true)} className="mt-2 text-xs text-[hsl(var(--kf-accent1))] hover:underline">Record a payment</button>}
                        </div>
                      ) : listedPayments.map(p => {
                        const pendingExtracted = isPendingExtractedPayment(p);
                        // SWP-INV-REFUND-UI: a payment recorded by hand is refunded here (Refund); a WiPay payment,
                        // whose gateway has no refund API, has its refund made outside KeyFlow recorded here (Record
                        // refund, the same bookkeeping door, repair round 1b); a Stripe or PayPal payment is refunded
                        // through its gateway in Money in (a link); any other payment is offered neither (fail closed).
                        // Each whole, while something of it is left.
                        const manual = isManualPayment(p);
                        const outOfBand = !manual && isOutOfBandRefundable(p);
                        const viaGateway = !manual && isGatewayRefundable(p);
                        const known = manual || outOfBand || viaGateway;
                        const refundable = manual || outOfBand ? manualRefundableAmount(p, payments, paidAmount) : 0;
                        const refunded = known && manualRefundableAmount(p, payments, Infinity) <= 0;
                        return (
                        <div key={p.id} data-testid="invoice-payment-row" data-payment-id={p.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/30 border border-border/60">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${p.status === "SUCCESSFUL" ? "bg-emerald-50" : "bg-amber-50"}`}>
                              <DollarSign className={`w-4 h-4 ${p.status === "SUCCESSFUL" ? "text-emerald-600" : "text-amber-600"}`} />
                            </div>
                            <div>
                              <p className="text-sm font-medium">{formatAmount(p.amount, p.currency)}</p>
                              <p className="text-[11px] text-muted-foreground">{pendingExtracted ? "Read from evidence" : p.provider} · {new Date(p.createdAt).toLocaleDateString()}</p>
                              {pendingExtracted && <p className="text-[11px] text-amber-700">Awaiting confirmation: not counted as paid until a member confirms it.</p>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {pendingExtracted && canConfirmPending && (
                              <button
                                onClick={() => void handleConfirmPending(p)}
                                disabled={confirmingPaymentId !== null}
                                className="inline-flex items-center gap-1 px-2.5 h-7 text-[11px] font-semibold rounded-lg bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                              >
                                {confirmingPaymentId === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                                Confirm
                              </button>
                            )}
                            {refunded && <span className="text-[11px] font-medium text-muted-foreground">Refunded</span>}
                            {refundable > 0 && !refundForbidden && (
                              <button
                                onClick={() => void openRefund(p)}
                                disabled={refunding}
                                className="inline-flex items-center gap-1 px-2.5 h-7 text-[11px] font-semibold rounded-lg border border-border text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                              >
                                <RotateCcw className="w-3 h-3" />
                                {outOfBand ? "Record refund" : "Refund"}
                              </button>
                            )}
                            {viaGateway && !refunded && (
                              <Link href={GATEWAY_REFUND_HREF} className="inline-flex items-center gap-1 px-2.5 h-7 text-[11px] font-semibold rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors">
                                Refund in Money in
                              </Link>
                            )}
                            <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${p.status === "SUCCESSFUL" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{p.status}</span>
                          </div>
                        </div>
                        );
                      })}
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
                  {/* FCP-COR-1 (journey C4): the customer opens their page. */}
                  {invoice.contactId ? (
                    <Link href={`/app/crm/contacts/${encodeURIComponent(invoice.contactId)}`} className="block text-sm font-semibold truncate text-[hsl(var(--kf-accent1))] hover:underline">{`${invoice.contact.firstName ?? ""} ${invoice.contact.lastName ?? ""}`.trim() || "Unnamed"}</Link>
                  ) : (
                    <p className="text-sm font-semibold truncate">{`${invoice.contact.firstName ?? ""} ${invoice.contact.lastName ?? ""}`.trim() || "Unnamed"}</p>
                  )}
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
            {canEmail && <ActionButton icon={Send} label="Email invoice" onClick={handleEmailInvoice} loading={actionLoading.email} />}
            {canRemind && <ActionButton icon={Bell} label="Send reminder" onClick={handleSendReminder} />}
            {canRecordPayment && <ActionButton icon={DollarSign} label="Record payment" onClick={() => setShowPaymentForm(true)} />}
            {canSharePayLink && <ActionButton icon={LinkIcon} label="Copy payment link" onClick={copyPaymentLink} />}
            <ActionButton icon={Printer} label="Print" onClick={handlePrint} />
            <ActionButton icon={Download} label="Download PDF" onClick={handleDownloadPdf} loading={actionLoading.pdf} />
            {canMarkPaid && <ActionButton icon={CheckCircle} label="Mark paid" onClick={handleMarkPaid} loading={actionLoading.paid} />}
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

      {printSheetShown && createPortal(<InvoicePrintSheet doc={invoiceDocumentOf(invoice, paidAmount, amountDue)} />, document.body)}

      {/* SWP-INV-REFUND-UI (D-169): the whole payment, no amount field. */}
      <ConfirmDialog
        open={refundTarget !== null}
        title={refundTarget && isOutOfBandRefundable(refundTarget.payment) ? "Record a refund made outside KeyFlow?" : "Refund this payment?"}
        message={refundTarget?.amount != null && isOutOfBandRefundable(refundTarget.payment) ? outOfBandRefundQuestion({
          refund: formatAmount(refundTarget.amount, invoice.currency),
          paid: formatAmount(moneyOf(refundTarget.payment.amount), invoice.currency),
          whole: moneyOf(refundTarget.amount) === moneyOf(refundTarget.payment.amount),
          on: new Date(refundTarget.payment.createdAt).toLocaleDateString(),
        }) : refundTarget?.amount != null ? manualRefundQuestion({
          refund: formatAmount(refundTarget.amount, invoice.currency),
          paid: formatAmount(moneyOf(refundTarget.payment.amount), invoice.currency),
          whole: moneyOf(refundTarget.amount) === moneyOf(refundTarget.payment.amount),
          method: refundTarget.payment.method ?? refundTarget.payment.provider,
          on: new Date(refundTarget.payment.createdAt).toLocaleDateString(),
        }) : MANUAL_REFUND_CHECKING}
        confirmLabel={`${refundTarget && isOutOfBandRefundable(refundTarget.payment) ? "Record refund" : "Refund"}${refundTarget?.amount != null ? ` ${formatAmount(refundTarget.amount, invoice.currency)}` : ""}`}
        variant="danger"
        busy={refunding || refundTarget?.amount == null}
        onCancel={() => { if (!refundingRef.current) { refundLookupRef.current++; setRefundTarget(null); } }}
        onConfirm={() => void handleRefund()}
      />

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

/**
 * SWP-INV-DETAIL (BUG-051): the invoice as this page shows it (its number, status, dates, customer, lines, totals,
 * what was paid and what is still due: the server's figures), one projection for the print sheet and the PDF.
 * VAT-BASICS adds the business's VAT number to it.
 */
interface InvoiceDocument {
  number: string;
  status: string;
  issueDate: string;
  dueDate: string;
  billTo: { name: string; email: string | null } | null;
  lines: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  paid: number;
  balanceDue: number;
  currency: string;
  notes: string | null;
}

function invoiceDocumentOf(invoice: Invoice, paidAmount: number, remaining: number): InvoiceDocument {
  const lines = (invoice.items ?? []).map((item) => ({
    description: item.description || "Unnamed item",
    quantity: Number(item.quantity),
    unitPrice: Number(item.unitPrice),
    total: Number(item.total ?? Number(item.quantity) * Number(item.unitPrice)),
  }));
  const name = invoice.contact ? `${invoice.contact.firstName ?? ""} ${invoice.contact.lastName ?? ""}`.trim() || invoice.contact.email || "" : "";
  return {
    number: invoice.invoiceNumber ?? invoice.id.slice(0, 8),
    status: STATUS_META[invoice.status]?.label ?? invoice.status,
    issueDate: invoice.issueDate ? new Date(invoice.issueDate).toLocaleDateString() : "—",
    dueDate: invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : "—",
    billTo: invoice.contact ? { name: name || "Unnamed", email: invoice.contact.email ?? null } : null,
    lines,
    subtotal: Number(invoice.subtotal ?? lines.reduce((sum, l) => sum + l.total, 0)),
    taxRate: Number(invoice.taxRate ?? 0),
    taxAmount: Number(invoice.taxAmount ?? 0),
    discountAmount: Number(invoice.discountAmount ?? 0),
    total: Number(invoice.total),
    paid: paidAmount,
    balanceDue: remaining,
    currency: invoice.currency,
    notes: invoice.notes ?? null,
  };
}

/** The totals of an invoice document, in the order the sheet and the PDF list them. */
function invoiceDocumentTotals(doc: InvoiceDocument): Array<{ label: string; value: string; strong?: boolean }> {
  const rows: Array<{ label: string; value: string; strong?: boolean }> = [{ label: "Subtotal", value: formatAmount(doc.subtotal, doc.currency) }];
  if (doc.taxRate > 0) rows.push({ label: `Tax (${doc.taxRate}%)`, value: formatAmount(doc.taxAmount, doc.currency) });
  if (doc.discountAmount > 0) rows.push({ label: "Discount", value: `-${formatAmount(doc.discountAmount, doc.currency)}` });
  rows.push({ label: "Total", value: formatAmount(doc.total, doc.currency), strong: true });
  rows.push({ label: "Paid", value: formatAmount(doc.paid, doc.currency) });
  rows.push({ label: "Balance due", value: formatAmount(doc.balanceDue, doc.currency), strong: true });
  return rows;
}

/** The printed invoice: placed under <body> while the browser prints (print.css shows it alone). */
function InvoicePrintSheet({ doc }: { doc: InvoiceDocument }) {
  return (
    <div className="kf-invoice-print" data-invoice-print="">
      <div className="kf-invoice-print__head">
        <div>
          <p className="kf-invoice-print__title">Invoice</p>
          <p className="kf-invoice-print__number">{doc.number}</p>
        </div>
        <dl className="kf-invoice-print__meta">
          <div><dt>Status</dt><dd>{doc.status}</dd></div>
          <div><dt>Issue date</dt><dd>{doc.issueDate}</dd></div>
          <div><dt>Due date</dt><dd>{doc.dueDate}</dd></div>
        </dl>
      </div>
      <div className="kf-invoice-print__billto">
        <p className="kf-invoice-print__label">Bill to</p>
        {doc.billTo ? (
          <>
            <p className="kf-invoice-print__strong">{doc.billTo.name}</p>
            {doc.billTo.email && <p>{doc.billTo.email}</p>}
          </>
        ) : <p>No contact assigned</p>}
      </div>
      <table className="kf-invoice-print__lines">
        <thead>
          <tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr>
        </thead>
        <tbody>
          {doc.lines.map((line, idx) => (
            <tr key={idx}>
              <td>{line.description}</td>
              <td>{line.quantity}</td>
              <td>{formatAmount(line.unitPrice, doc.currency)}</td>
              <td>{formatAmount(line.total, doc.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="kf-invoice-print__totals">
        <tbody>
          {invoiceDocumentTotals(doc).map((row) => (
            <tr key={row.label} className={row.strong ? "kf-invoice-print__strong" : undefined}><th>{row.label}</th><td>{row.value}</td></tr>
          ))}
        </tbody>
      </table>
      {doc.notes && (
        <div className="kf-invoice-print__notes">
          <p className="kf-invoice-print__label">Notes</p>
          <p>{doc.notes}</p>
        </div>
      )}
    </div>
  );
}

/** The characters WinAnsiEncoding holds beyond Latin-1 (jspdf writes them as single bytes). */
const WIN_ANSI_EXTRAS = "\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178";

/**
 * Review MINOR-4: every string written to the PDF. jspdf's standard fonts are WinAnsi; a string holding any other
 * character is written as 2-byte text, which they show as gibberish (fr-FR's U+202F thousands separator made every
 * amount unreadable). Spaces of any width are written as a space, and any other character outside WinAnsi as "?".
 */
function pdfText(s: string): string {
  return Array.from(s.replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000\t]/g, " "), (c) => {
    const code = c.codePointAt(0) ?? 0;
    if (c === "\n" || (code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff) || WIN_ANSI_EXTRAS.includes(c)) return c;
    return "?";
  }).join("");
}

/** The invoice document as a one-invoice A4 PDF (jspdf and jspdf-autotable, loaded when asked for). */
async function invoicePdfBlob(doc: InvoiceDocument): Promise<Blob> {
  const [{ default: JsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const pdf = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  // Review MINOR-4: every string goes through pdfText.
  const text = pdfText;
  const margin = 18;
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const right = pageW - margin;
  let y = 48;
  /** A new page when the next block of this height would run past the bottom margin. */
  const room = (height: number) => { if (y + height > pageH - margin) { pdf.addPage(); y = margin + 6; } };

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(22);
  pdf.text(text("Invoice"), margin, 26);
  pdf.setFontSize(12);
  pdf.text(text(doc.number), margin, 33);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  const meta: Array<[string, string]> = [["Status", doc.status], ["Issue date", doc.issueDate], ["Due date", doc.dueDate]];
  meta.forEach(([label, value], i) => {
    pdf.setTextColor(110);
    pdf.text(text(label), right - 60, 22 + i * 6);
    pdf.setTextColor(20);
    pdf.text(text(value), right, 22 + i * 6, { align: "right" });
  });

  pdf.setTextColor(110);
  pdf.text(text("Bill to"), margin, y);
  pdf.setTextColor(20);
  if (doc.billTo) {
    pdf.setFont("helvetica", "bold");
    pdf.text(text(doc.billTo.name), margin, y + 6);
    pdf.setFont("helvetica", "normal");
    if (doc.billTo.email) pdf.text(text(doc.billTo.email), margin, y + 11);
  } else {
    pdf.text(text("No contact assigned"), margin, y + 6);
  }
  y += 20;

  autoTable(pdf, {
    startY: y,
    head: [["Description", "Qty", "Unit price", "Amount"].map(text)],
    body: doc.lines.map((line) => [line.description, String(line.quantity), formatAmount(line.unitPrice, doc.currency), formatAmount(line.total, doc.currency)].map(text)),
    margin: { left: margin, right: margin },
    styles: { fontSize: 10, cellPadding: 2.5, textColor: 20 },
    headStyles: { fillColor: [241, 245, 249], textColor: 60, fontStyle: "bold" },
    columnStyles: { 1: { halign: "right", cellWidth: 18 }, 2: { halign: "right", cellWidth: 36 }, 3: { halign: "right", cellWidth: 36 } },
    theme: "plain",
  });
  y = ((pdf as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y) + 8;

  const totals = invoiceDocumentTotals(doc);
  room(totals.length * 6);
  for (const row of totals) {
    pdf.setFont("helvetica", row.strong ? "bold" : "normal");
    pdf.text(text(row.label), right - 70, y);
    pdf.text(text(row.value), right, y, { align: "right" });
    y += 6;
  }

  if (doc.notes) {
    const noteLines = pdf.splitTextToSize(text(doc.notes), right - margin) as string[];
    y += 6;
    room(6 + noteLines.length * 5);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(110);
    pdf.text(text("Notes"), margin, y);
    pdf.setTextColor(20);
    pdf.text(noteLines, margin, y + 6);
  }

  return pdf.output("blob");
}
