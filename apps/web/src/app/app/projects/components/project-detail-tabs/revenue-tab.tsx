"use client";

import { DollarSign, FileText, ExternalLink, CreditCard } from "lucide-react";

interface RevenueTabProps {
  invoiceId?: string;
}

export function RevenueTab({ invoiceId }: RevenueTabProps) {
  if (!invoiceId) {
    return (
      <div className="text-center py-8 rounded-xl border border-dashed border-border/40">
        <DollarSign className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm font-medium">No revenue linked</p>
        <p className="text-xs text-muted-foreground mt-1">Link an invoice or quote to track revenue associated with this project.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/40 bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--kf-success) / 0.1)" }}>
            <FileText className="w-5 h-5" style={{ color: "hsl(var(--kf-success))" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Invoice Linked</p>
            <p className="text-[10px] text-muted-foreground">ID: {invoiceId.slice(0, 8)}...</p>
          </div>
          <a
            href={`/app/commerce?tab=invoices&id=${invoiceId}`}
            className="text-xs px-3 py-1.5 rounded-lg font-medium inline-flex items-center gap-1 transition-colors"
            style={{ background: "hsl(var(--kf-success) / 0.1)", color: "hsl(var(--kf-success))" }}
          >
            <ExternalLink className="w-3 h-3" />
            View Invoice
          </a>
        </div>
      </div>

      <div className="rounded-xl border border-border/40 bg-card p-4 space-y-3">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Payment Tracking</h4>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CreditCard className="w-3.5 h-3.5" />
          <span>Payment status available from the Revenue workspace.</span>
        </div>
      </div>
    </div>
  );
}
