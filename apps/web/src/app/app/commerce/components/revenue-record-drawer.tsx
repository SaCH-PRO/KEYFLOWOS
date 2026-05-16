"use client";

import { RecordDetailDrawer, type RecordDetailEntity } from "@/components/ui/record-detail-drawer";
import type { Invoice, Quote } from "@/lib/client";

interface RevenueRecordDrawerProps {
  record: { entity: RecordDetailEntity; id: string } | null;
  invoices: Invoice[];
  quotes: Quote[];
  currency: string;
  onClose: () => void;
  onOpenFullEditor: (entity: RecordDetailEntity) => void;
}

export function RevenueRecordDrawer({
  record,
  invoices,
  quotes,
  currency,
  onClose,
  onOpenFullEditor,
}: RevenueRecordDrawerProps) {
  if (!record) {
    return (
      <RecordDetailDrawer
        open={false}
        onClose={onClose}
        entity="invoice"
        title=""
      />
    );
  }
  const { entity, id } = record;
  if (entity === "invoice") {
    const inv = invoices.find((i) => i.id === id);
    if (!inv) {
      return (
        <RecordDetailDrawer
          open
          onClose={onClose}
          entity="invoice"
          title="Invoice not found"
          error="This invoice is no longer available in the current workspace."
        />
      );
    }
    const contactName = inv.contact
      ? [inv.contact.firstName, inv.contact.lastName].filter(Boolean).join(" ") || inv.contact.email || "Customer"
      : "Customer";
    const status = inv.status?.toUpperCase() ?? "DRAFT";
    const tone =
      status === "PAID"
        ? "success"
        : status === "OVERDUE"
        ? "error"
        : status === "SENT"
        ? "info"
        : "default";
    return (
      <RecordDetailDrawer
        open
        onClose={onClose}
        entity="invoice"
        title={inv.invoiceNumber || `Invoice ${inv.id.slice(0, 8)}`}
        subtitle={contactName}
        status={{ label: status, tone }}
        meta={[
          { label: "Total", value: `${inv.currency || currency} ${Number(inv.total ?? 0).toFixed(2)}` },
          { label: "Status", value: status },
          { label: "Issued", value: inv.issueDate ? new Date(inv.issueDate).toLocaleDateString() : "—" },
          { label: "Due", value: inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "—" },
        ]}
        actions={
          <button
            onClick={() => onOpenFullEditor("invoice")}
            className="text-xs font-medium px-3 py-1.5 rounded-lg"
            style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-accent1-foreground))" }}
          >
            Open in Invoices
          </button>
        }
      />
    );
  }
  if (entity === "quote") {
    const q = quotes.find((x) => x.id === id);
    if (!q) {
      return (
        <RecordDetailDrawer
          open
          onClose={onClose}
          entity="quote"
          title="Quote not found"
          error="This quote is no longer available in the current workspace."
        />
      );
    }
    const contactName = q.contact
      ? [q.contact.firstName, q.contact.lastName].filter(Boolean).join(" ") || q.contact.email || "Customer"
      : "Customer";
    const tone =
      q.status === "ACCEPTED" ? "success" : q.status === "REJECTED" ? "error" : q.status === "SENT" ? "info" : "default";
    return (
      <RecordDetailDrawer
        open
        onClose={onClose}
        entity="quote"
        title={q.quoteNumber || `Quote ${q.id.slice(0, 8)}`}
        subtitle={contactName}
        status={{ label: q.status, tone }}
        meta={[
          { label: "Total", value: `${q.currency || currency} ${Number(q.total ?? 0).toFixed(2)}` },
          { label: "Status", value: q.status },
          { label: "Issued", value: q.issueDate ? new Date(q.issueDate).toLocaleDateString() : "—" },
          { label: "Expires", value: q.expiryDate ? new Date(q.expiryDate).toLocaleDateString() : "—" },
        ]}
        actions={
          <button
            onClick={() => onOpenFullEditor("quote")}
            className="text-xs font-medium px-3 py-1.5 rounded-lg"
            style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-accent1-foreground))" }}
          >
            Open in Quotes
          </button>
        }
      />
    );
  }
  return (
    <RecordDetailDrawer
      open
      onClose={onClose}
      entity={entity}
      title={entity === "payment" ? "Payment" : "Recurring schedule"}
      subtitle={`Record ${id.slice(0, 8)}`}
      emptyMessage="Detail view will load with the matching record."
      actions={
        <button
          onClick={() => onOpenFullEditor(entity)}
          className="text-xs font-medium px-3 py-1.5 rounded-lg"
          style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-accent1-foreground))" }}
        >
          {entity === "payment" ? "Open in Payments" : "Open in Recurring"}
        </button>
      }
    />
  );
}
