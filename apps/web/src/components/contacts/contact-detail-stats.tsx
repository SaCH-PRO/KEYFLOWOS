"use client";

import {
  DollarSign,
  TrendingUp,
  Clock,
  Calendar,
  Receipt,
  FileSignature,
} from "lucide-react";
import type { ContactDetailData, DetailQuickAction } from "./contact-detail";

interface ContactDetailStatsProps {
  contact: ContactDetailData;
  onQuickAction?: (contactId: string, action: DetailQuickAction) => void;
}

function LeadScoreGauge({ score }: { score: number }) {
  const clampedScore = Math.max(0, Math.min(100, score));
  const color =
    clampedScore >= 70 ? "hsl(142 76% 36%)" :
    clampedScore >= 40 ? "hsl(var(--kf-accent1))" :
    "hsl(0 72% 51%)";

  return (
    <div className="flex items-center gap-2">
      <span className="text-lg font-semibold">{score}</span>
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${clampedScore}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export function ContactDetailStats({ contact, onQuickAction }: ContactDetailStatsProps) {
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
        <div className="kf-stat-card p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <TrendingUp className="w-3 h-3" />
            Lead Score
          </div>
          {contact.meta?.leadScore != null ? (
            <LeadScoreGauge score={contact.meta.leadScore} />
          ) : (
            <div className="text-lg font-semibold">-</div>
          )}
        </div>
        <div className="kf-stat-card p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <DollarSign className="w-3 h-3" />
            Outstanding
          </div>
          <div className="text-lg font-semibold" style={{ color: (contact.meta?.outstandingBalance ?? 0) > 0 ? "hsl(var(--kf-accent1))" : undefined }}>
            {contact.meta?.outstandingBalance != null ? `TTD ${contact.meta.outstandingBalance.toLocaleString()}` : "-"}
          </div>
        </div>
        <div className="kf-stat-card p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Clock className="w-3 h-3" />
            Last Activity
          </div>
          <div className="text-xs font-medium">
            {contact.meta?.lastInteractionAt
              ? new Date(contact.meta.lastInteractionAt).toLocaleString("en-TT", { dateStyle: "medium", timeStyle: "short" })
              : "No activity"}
          </div>
        </div>
        <div className="kf-stat-card p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Calendar className="w-3 h-3" />
            Next Task
          </div>
          <div className="text-xs font-medium">
            {contact.meta?.nextDueTaskAt
              ? new Date(contact.meta.nextDueTaskAt).toLocaleString("en-TT", { dateStyle: "medium", timeStyle: "short" })
              : "None"}
          </div>
        </div>
      </div>

      <div className="p-3 rounded-xl bg-muted/30 border border-border/50">
        <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">Financial Summary</p>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-lg font-semibold" style={{ color: "hsl(var(--kf-accent2))" }}>
              TTD {(contact.meta?.totalRevenue ?? 0).toLocaleString()}
            </p>
            <p className="text-[10px] text-muted-foreground">Total Revenue</p>
          </div>
          <div>
            <p className="text-lg font-semibold">{contact.meta?.invoiceCount ?? 0}</p>
            <p className="text-[10px] text-muted-foreground">Invoices</p>
          </div>
          <div>
            <p className="text-lg font-semibold">{contact.meta?.bookingCount ?? 0}</p>
            <p className="text-[10px] text-muted-foreground">Bookings</p>
          </div>
        </div>
      </div>

      {onQuickAction && (
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => onQuickAction(contact.id, "create-invoice")}
            className="flex items-center justify-center gap-1.5 p-2.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-medium transition-colors"
          >
            <Receipt className="w-3.5 h-3.5" />
            Invoice
          </button>
          <button
            onClick={() => onQuickAction(contact.id, "book-appointment")}
            className="flex items-center justify-center gap-1.5 p-2.5 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-xs font-medium transition-colors"
          >
            <Calendar className="w-3.5 h-3.5" />
            Book
          </button>
          <button
            onClick={() => onQuickAction(contact.id, "send-quote")}
            className="flex items-center justify-center gap-1.5 p-2.5 rounded-xl bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 text-xs font-medium transition-colors"
          >
            <FileSignature className="w-3.5 h-3.5" />
            Quote
          </button>
        </div>
      )}
    </>
  );
}
