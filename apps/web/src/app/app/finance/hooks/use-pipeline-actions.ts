"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  updateQuoteStatus,
  deleteQuote,
  convertQuoteToInvoice,
  createQuote,
  updateInvoiceStatus,
  markInvoicePaid,
  recordInvoicePayment,
  sendInvoiceReminder,
  resendInvoiceReceipt,
  deleteInvoice,
  createInvoice,
  bulkUpdateInvoices,
  bulkUpdateQuotes,
  type Invoice,
  type Quote,
} from "@/lib/client";
import { exportToCsv } from "../../commerce/components/bulk-action-bar";
import type { FinancialRecord } from "@/lib/finance/types";

export interface PaymentForm {
  amount: string;
  method: string;
  reference: string;
  notes: string;
}

export interface ConvertForm {
  taxRate: string;
  dueDate: string;
  notes: string;
}

export function usePipelineActions({
  businessId,
  invoices,
  quotes,
  setInvoices,
  setQuotes,
}: {
  businessId: string | null;
  invoices: Invoice[];
  quotes: Quote[];
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
  setQuotes: React.Dispatch<React.SetStateAction<Quote[]>>;
}) {
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [paymentModalFor, setPaymentModalFor] = useState<Invoice | null>(null);
  const [convertModalFor, setConvertModalFor] = useState<Quote | null>(null);
  const [emailModalFor, setEmailModalFor] = useState<{ record: FinancialRecord; mode: "send" | "reminder" } | null>(null);

  const setLoading = (id: string, loading: boolean) => {
    setActionLoading((prev) => ({ ...prev, [id]: loading }));
  };

  /* ─── Quote Actions ─── */
  const sendQuote = useCallback(
    async (quoteId: string) => {
      if (!businessId) return;
      setLoading(`send-quote-${quoteId}`, true);
      try {
        const { data, error } = await updateQuoteStatus(quoteId, "SENT");
        if (data) {
          setQuotes((prev) => prev.map((q) => (q.id === quoteId ? data : q)));
          toast.success("Quote sent");
        } else toast.error(error ?? "Failed to send quote");
      } finally {
        setLoading(`send-quote-${quoteId}`, false);
      }
    },
    [businessId, setQuotes],
  );

  const acceptQuote = useCallback(
    async (quoteId: string) => {
      setLoading(`accept-quote-${quoteId}`, true);
      try {
        const { data, error } = await updateQuoteStatus(quoteId, "ACCEPTED");
        if (data) {
          setQuotes((prev) => prev.map((q) => (q.id === quoteId ? data : q)));
          toast.success("Quote accepted");
        } else toast.error(error ?? "Failed to accept quote");
      } finally {
        setLoading(`accept-quote-${quoteId}`, false);
      }
    },
    [setQuotes],
  );

  const rejectQuote = useCallback(
    async (quoteId: string) => {
      setLoading(`reject-quote-${quoteId}`, true);
      try {
        const { data, error } = await updateQuoteStatus(quoteId, "REJECTED");
        if (data) {
          setQuotes((prev) => prev.map((q) => (q.id === quoteId ? data : q)));
          toast.success("Quote rejected");
        } else toast.error(error ?? "Failed to reject quote");
      } finally {
        setLoading(`reject-quote-${quoteId}`, false);
      }
    },
    [setQuotes],
  );

  const handleDeleteQuote = useCallback(
    async (quoteId: string) => {
      if (!businessId) return;
      setLoading(`delete-quote-${quoteId}`, true);
      try {
        const { error } = await deleteQuote(businessId, quoteId);
        if (!error) {
          setQuotes((prev) => prev.filter((q) => q.id !== quoteId));
          toast.success("Quote deleted");
        } else toast.error(error ?? "Failed to delete quote");
      } finally {
        setLoading(`delete-quote-${quoteId}`, false);
      }
    },
    [businessId, setQuotes],
  );

  const handleConvertQuote = useCallback(
    async (quote: Quote, form: ConvertForm) => {
      if (!businessId) return;
      setLoading(`convert-${quote.id}`, true);
      try {
        const { data, error } = await convertQuoteToInvoice({
          businessId,
          quoteId: quote.id,
          taxRate: parseFloat(form.taxRate) || 0,
          dueDate: form.dueDate,
          notes: form.notes,
        });
        if (data) {
          setQuotes((prev) => prev.map((q) => (q.id === quote.id ? { ...q, status: "ACCEPTED", invoiceId: data.id } : q)));
          setInvoices((prev) => [data, ...prev]);
          setConvertModalFor(null);
          toast.success("Quote converted to invoice");
        } else toast.error(error ?? "Failed to convert quote");
      } finally {
        setLoading(`convert-${quote.id}`, false);
      }
    },
    [businessId, setQuotes, setInvoices],
  );

  /* ─── Invoice Actions ─── */
  const sendInvoice = useCallback(
    async (invoiceId: string) => {
      setLoading(`send-inv-${invoiceId}`, true);
      try {
        const { data, error } = await updateInvoiceStatus(invoiceId, "SENT");
        if (data) {
          setInvoices((prev) => prev.map((inv) => (inv.id === invoiceId ? data : inv)));
          toast.success("Invoice sent");
        } else toast.error(error ?? "Failed to send invoice");
      } finally {
        setLoading(`send-inv-${invoiceId}`, false);
      }
    },
    [setInvoices],
  );

  const voidInvoice = useCallback(
    async (invoiceId: string) => {
      setLoading(`void-${invoiceId}`, true);
      try {
        const { data, error } = await updateInvoiceStatus(invoiceId, "VOID");
        if (data) {
          setInvoices((prev) => prev.map((inv) => (inv.id === invoiceId ? data : inv)));
          toast.success("Invoice voided");
        } else toast.error(error ?? "Failed to void invoice");
      } finally {
        setLoading(`void-${invoiceId}`, false);
      }
    },
    [setInvoices],
  );

  const handleMarkPaid = useCallback(
    async (invoiceId: string) => {
      setLoading(`paid-${invoiceId}`, true);
      try {
        const { data, error } = await markInvoicePaid(invoiceId);
        if (data) {
          setInvoices((prev) => prev.map((inv) => (inv.id === invoiceId ? data : inv)));
          toast.success("Invoice marked as paid");
        } else toast.error(error ?? "Failed to mark paid");
      } finally {
        setLoading(`paid-${invoiceId}`, false);
      }
    },
    [setInvoices],
  );

  const handleRecordPayment = useCallback(
    async (invoice: Invoice, form: PaymentForm) => {
      if (!businessId) return;
      setLoading(`payment-${invoice.id}`, true);
      try {
        const { data, error } = await recordInvoicePayment(businessId, invoice.id, {
          amount: parseFloat(form.amount),
          method: form.method,
          reference: form.reference || undefined,
          notes: form.notes || undefined,
        });
        if (data) {
          setInvoices((prev) =>
            prev.map((inv) =>
              inv.id === invoice.id
                ? { ...inv, status: data.invoice.status, paidAt: data.invoice.paidAt, payments: [...(inv.payments ?? []), data.payment] }
                : inv,
            ),
          );
          setPaymentModalFor(null);
          toast.success("Payment recorded");
        } else toast.error(error ?? "Failed to record payment");
      } finally {
        setLoading(`payment-${invoice.id}`, false);
      }
    },
    [businessId, setInvoices],
  );

  const handleDeleteInvoice = useCallback(
    async (invoiceId: string) => {
      if (!businessId) return;
      setLoading(`delete-inv-${invoiceId}`, true);
      try {
        const { error } = await deleteInvoice(businessId, invoiceId);
        if (!error) {
          setInvoices((prev) => prev.filter((inv) => inv.id !== invoiceId));
          toast.success("Invoice deleted");
        } else toast.error(error ?? "Failed to delete invoice");
      } finally {
        setLoading(`delete-inv-${invoiceId}`, false);
      }
    },
    [businessId, setInvoices],
  );

  const handleSendReminder = useCallback(
    async (invoice: Invoice, email: string, message: string) => {
      if (!businessId) return;
      setLoading(`remind-${invoice.id}`, true);
      try {
        const { error } = await sendInvoiceReminder(businessId, invoice.id, { recipientEmail: email, message });
        if (!error) {
          toast.success("Reminder sent");
          setEmailModalFor(null);
        } else toast.error(error ?? "Failed to send reminder");
      } finally {
        setLoading(`remind-${invoice.id}`, false);
      }
    },
    [businessId],
  );

  const handleResendReceipt = useCallback(
    async (invoiceId: string) => {
      if (!businessId) return;
      setLoading(`receipt-${invoiceId}`, true);
      try {
        const { error } = await resendInvoiceReceipt(businessId, invoiceId);
        if (!error) toast.success("Receipt resent");
        else toast.error(error ?? "Failed to resend receipt");
      } finally {
        setLoading(`receipt-${invoiceId}`, false);
      }
    },
    [businessId],
  );

  /* ─── Duplicate ─── */
  const handleDuplicateQuote = useCallback(
    async (quote: Quote) => {
      if (!businessId) return;
      setLoading(`dup-quote-${quote.id}`, true);
      try {
        const { data, error } = await createQuote({
          businessId,
          contactId: quote.contactId,
          items: quote.items.map((i) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, productId: i.productId ?? undefined })),
          currency: quote.currency,
          expiryDate: quote.expiryDate ?? undefined,
          taxRate: quote.taxRate ?? undefined,
          discountType: quote.discountType ?? undefined,
          discountValue: quote.discountValue ?? undefined,
          notes: quote.notes ? `${quote.notes} (Copy)` : "Copy",
        });
        if (data) {
          setQuotes((prev) => [data, ...prev]);
          toast.success("Quote duplicated");
        } else toast.error(error ?? "Failed to duplicate quote");
      } finally {
        setLoading(`dup-quote-${quote.id}`, false);
      }
    },
    [businessId, setQuotes],
  );

  const handleDuplicateInvoice = useCallback(
    async (invoice: Invoice) => {
      if (!businessId) return;
      setLoading(`dup-inv-${invoice.id}`, true);
      try {
        const { data, error } = await createInvoice({
          businessId,
          contactId: invoice.contactId ?? undefined,
          items: (invoice.items ?? []).map((i) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice })),
          currency: invoice.currency,
          dueDate: invoice.dueDate ?? undefined,
          taxRate: invoice.taxRate ?? undefined,
          discountType: invoice.discountType ?? undefined,
          discountValue: invoice.discountValue ?? undefined,
          notes: invoice.notes ? `${invoice.notes} (Copy)` : "Copy",
        });
        if (data) {
          setInvoices((prev) => [data, ...prev]);
          toast.success("Invoice duplicated");
        } else toast.error(error ?? "Failed to duplicate invoice");
      } finally {
        setLoading(`dup-inv-${invoice.id}`, false);
      }
    },
    [businessId, setInvoices],
  );

  /* ─── Bulk Actions ─── */
  const handleBulkStatusChange = useCallback(
    async (selectedIds: Set<string>, status: string) => {
      if (!businessId || selectedIds.size === 0) return;
      const quoteIds = quotes.filter((q) => selectedIds.has(q.id)).map((q) => q.id);
      const invoiceIds = invoices.filter((inv) => selectedIds.has(inv.id)).map((inv) => inv.id);

      if (quoteIds.length > 0) {
        const action = status === "SENT" ? "send" : status === "REJECTED" ? "reject" : "delete";
        const { data, error } = await bulkUpdateQuotes(businessId, quoteIds, action as "send" | "reject" | "delete");
        if (data) {
          toast.success(`${data.updated} quote(s) updated`);
          if (action === "delete") setQuotes((prev) => prev.filter((q) => !quoteIds.includes(q.id)));
          else setQuotes((prev) => prev.map((q) => (quoteIds.includes(q.id) ? { ...q, status: status as Quote["status"] } : q)));
        } else toast.error(error ?? "Bulk update failed");
      }

      if (invoiceIds.length > 0) {
        const action = status === "SENT" ? "send" : status === "VOID" ? "void" : "delete";
        const { data, error } = await bulkUpdateInvoices(businessId, invoiceIds, action as "send" | "void" | "delete");
        if (data) {
          toast.success(`${data.updated} invoice(s) updated`);
          if (action === "delete") setInvoices((prev) => prev.filter((inv) => !invoiceIds.includes(inv.id)));
          else setInvoices((prev) => prev.map((inv) => (invoiceIds.includes(inv.id) ? { ...inv, status } : inv)));
        } else toast.error(error ?? "Bulk update failed");
      }
    },
    [businessId, invoices, quotes, setInvoices, setQuotes],
  );

  const handleBulkDelete = useCallback(
    async (selectedIds: Set<string>) => {
      await handleBulkStatusChange(selectedIds, "DELETE");
    },
    [handleBulkStatusChange],
  );

  const handleExportCsv = useCallback(
    (selectedIds: Set<string>, allRecords: FinancialRecord[]) => {
      const toExport = selectedIds.size > 0 ? allRecords.filter((r) => selectedIds.has(r.id)) : allRecords;
      exportToCsv(
        toExport as unknown as Record<string, unknown>[],
        [
          { key: "type", header: "Type" },
          { key: "number", header: "Number" },
          { key: "status", header: "Status" },
          { key: "contact", header: "Client", format: (v: unknown) => {
            const c = v as { firstName?: string; lastName?: string } | null;
            return c ? `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() : "";
          }},
          { key: "total", header: "Total" },
          { key: "currency", header: "Currency" },
          { key: "issueDate", header: "Issue Date", format: (v: unknown) => v ? new Date(v as string).toLocaleDateString() : "" },
        ],
        `pipeline-export-${new Date().toISOString().slice(0, 10)}`,
      );
      toast.success(`${toExport.length} records exported`);
    },
    [],
  );

  return {
    actionLoading,
    // Quote
    sendQuote,
    acceptQuote,
    rejectQuote,
    handleDeleteQuote,
    handleConvertQuote,
    // Invoice
    sendInvoice,
    voidInvoice,
    handleMarkPaid,
    handleRecordPayment,
    handleDeleteInvoice,
    handleSendReminder,
    handleResendReceipt,
    // Duplicate
    handleDuplicateQuote,
    handleDuplicateInvoice,
    // Bulk
    handleBulkStatusChange,
    handleBulkDelete,
    handleExportCsv,
    // Modals
    paymentModalFor,
    setPaymentModalFor,
    convertModalFor,
    setConvertModalFor,
    emailModalFor,
    setEmailModalFor,
  };
}
