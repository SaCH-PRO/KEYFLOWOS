import { useMemo } from "react";
import { AlertTriangle, FileText, CreditCard, Clock } from "lucide-react";
import { formatCurrencyCompact } from "@/lib/currency";
import { OWED_STATUSES, invoiceRemainingOwed, safeInvoiceAmount } from "@/lib/commerce-status";
import type { Invoice, Quote } from "@/lib/client";
import type { RecordDetailEntity } from "@/components/ui/record-detail-drawer";

export interface ActionQueueItem {
  id: string;
  icon: React.ElementType;
  label: string;
  detail?: string;
  urgency: "high" | "medium" | "low";
  cta: string;
  onCta: () => void;
}

export function useActionQueue(
  invoices: Invoice[],
  quotes: Quote[],
  businessCurrency: string,
  handleTabChange: (key: string) => void,
  openRecordDrawer: (entity: RecordDetailEntity, id: string) => void,
): ActionQueueItem[] {
  return useMemo(() => {
    const items: ActionQueueItem[] = [];
    const now = new Date();
    const overdueInvoices = invoices.filter(
      (inv) =>
        inv.status === "OVERDUE" || (OWED_STATUSES.has(inv.status) && inv.dueDate && new Date(inv.dueDate) < now),
    );
    if (overdueInvoices.length > 0) {
      items.push({
        id: "overdue",
        icon: AlertTriangle,
        label: `${overdueInvoices.length} overdue invoice${overdueInvoices.length !== 1 ? "s" : ""}`,
        detail: formatCurrencyCompact(
          overdueInvoices.reduce((s, inv) => s + invoiceRemainingOwed(inv), 0),
          businessCurrency,
        ),
        urgency: "high",
        cta: overdueInvoices.length === 1 ? "Details" : "View overdue",
        onCta:
          overdueInvoices.length === 1
            ? () => openRecordDrawer("invoice", overdueInvoices[0]!.id)
            : () => handleTabChange("invoices"),
      });
    }
    const drafts = invoices.filter((inv) => inv.status === "DRAFT");
    if (drafts.length > 0) {
      items.push({
        id: "drafts",
        icon: FileText,
        label: `${drafts.length} draft invoice${drafts.length !== 1 ? "s" : ""} unsent`,
        detail: formatCurrencyCompact(
          drafts.reduce((s, inv) => s + safeInvoiceAmount(inv.total), 0),
          businessCurrency,
        ),
        urgency: "medium",
        cta: drafts.length === 1 ? "Details" : "Send",
        onCta:
          drafts.length === 1
            ? () => openRecordDrawer("invoice", drafts[0]!.id)
            : () => handleTabChange("invoices"),
      });
    }
    const pendingQuotes = quotes.filter((q) => q.status === "SENT");
    if (pendingQuotes.length > 0) {
      items.push({
        id: "pending-quotes",
        icon: CreditCard,
        label: `${pendingQuotes.length} quote${pendingQuotes.length !== 1 ? "s" : ""} awaiting response`,
        detail: formatCurrencyCompact(
          pendingQuotes.reduce((s, q) => s + safeInvoiceAmount(q.total), 0),
          businessCurrency,
        ),
        urgency: "medium",
        cta: pendingQuotes.length === 1 ? "Details" : "Follow up",
        onCta:
          pendingQuotes.length === 1
            ? () => openRecordDrawer("quote", pendingQuotes[0]!.id)
            : () => handleTabChange("quotes"),
      });
    }
    const awaitingPayment = invoices.filter((inv) => OWED_STATUSES.has(inv.status));
    if (awaitingPayment.length > 0) {
      items.push({
        id: "pending",
        icon: Clock,
        label: `${formatCurrencyCompact(
          awaitingPayment.reduce((s, inv) => s + invoiceRemainingOwed(inv), 0),
          businessCurrency,
        )} awaiting payment`,
        detail: `${awaitingPayment.length} invoice${awaitingPayment.length !== 1 ? "s" : ""}`,
        urgency: "low",
        cta: "Open payments",
        onCta: () => handleTabChange("payments"),
      });
    }
    return items;
  }, [invoices, quotes, businessCurrency, handleTabChange, openRecordDrawer]);
}
