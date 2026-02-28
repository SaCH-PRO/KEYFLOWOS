"use client";

import { useState } from "react";
import {
  DollarSign,
  TrendingUp,
  Clock,
  Calendar,
  Info,
  Receipt,
  CalendarCheck,
  History,
} from "lucide-react";
import type { ContactDetailData, ContactEvent, DetailQuickAction } from "./contact-detail";

interface ContactDetailStatsProps {
  contact: ContactDetailData;
  events: ContactEvent[];
  onSetActiveTab: (tab: string) => void;
  onQuickAction?: (contactId: string, action: DetailQuickAction) => void;
}

const SCORE_FACTORS = [
  { label: "Has email", points: 10 },
  { label: "Has phone", points: 5 },
  { label: "Recent activity", points: 20 },
  { label: "Invoices paid", points: 25 },
  { label: "Bookings made", points: 15 },
  { label: "Engagement frequency", points: 25 },
];

const EVENT_LABELS: Record<string, string> = {
  "contact.created": "Contact created",
  "contact.updated": "Contact updated",
  "invoice.created": "Invoice created",
  "invoice.paid": "Invoice paid",
  "booking.created": "Booking made",
  "booking.completed": "Booking completed",
  "quote.created": "Quote sent",
  "quote.accepted": "Quote accepted",
  "note.created": "Note added",
  "task.created": "Task created",
  "task.completed": "Task completed",
  "email.sent": "Email sent",
  "whatsapp.sent": "WhatsApp sent",
  "message.copied": "Message copied",
  "form.submitted": "Form submitted",
  "followup.scheduled": "Follow-up set",
};

function LeadScoreGauge({ score }: { score: number }) {
  const clampedScore = Math.max(0, Math.min(100, score));
  const color =
    clampedScore >= 70 ? "hsl(142 76% 36%)" :
    clampedScore >= 40 ? "hsl(var(--kf-accent1))" :
    "hsl(0 72% 51%)";
  const label = clampedScore >= 70 ? "Hot" : clampedScore >= 40 ? "Warm" : "Cold";

  return (
    <div className="flex items-center gap-2">
      <span className="text-lg font-semibold">{score}</span>
      <div className="flex-1 flex flex-col gap-0.5">
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${clampedScore}%`, backgroundColor: color }}
          />
        </div>
        <span className="text-[9px] font-medium" style={{ color }}>{label}</span>
      </div>
    </div>
  );
}

function LeadScoreTooltip() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
        title="How is lead score calculated?"
      >
        <Info className="w-3 h-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 left-0 top-full mt-1 w-52 p-3 rounded-xl bg-slate-900/95 backdrop-blur-xl border border-border/60 shadow-2xl">
            <p className="text-xs font-medium mb-2">Score Factors</p>
            <div className="space-y-1">
              {SCORE_FACTORS.map((f) => (
                <div key={f.label} className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground">{f.label}</span>
                  <span className="font-medium">+{f.points}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 pt-2 border-t border-border/50 text-[10px] text-muted-foreground">
              Score updates automatically as you interact with this contact.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function relativeTime(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr);
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return d.toLocaleDateString("en-TT", { month: "short", day: "numeric" });
}

export function ContactDetailStats({ contact, events, onSetActiveTab, onQuickAction }: ContactDetailStatsProps) {
  const hasAnyMetric = contact.meta?.leadScore != null ||
    (contact.meta?.outstandingBalance ?? 0) > 0 ||
    contact.meta?.lastInteractionAt ||
    contact.meta?.nextDueTaskAt;

  const recentEvents = events.slice(0, 3);

  return (
    <>
      {hasAnyMetric ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <div className="kf-stat-card p-3">
            <div className="flex items-center gap-1 text-muted-foreground text-xs mb-1">
              <TrendingUp className="w-3 h-3" />
              <span>Lead Score</span>
              <LeadScoreTooltip />
            </div>
            {contact.meta?.leadScore != null ? (
              <LeadScoreGauge score={contact.meta.leadScore} />
            ) : (
              <p className="text-xs text-muted-foreground mt-1">Interacting builds score</p>
            )}
          </div>
          <div className="kf-stat-card p-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <DollarSign className="w-3 h-3" />
              Outstanding
            </div>
            <div className="text-lg font-semibold" style={{ color: (contact.meta?.outstandingBalance ?? 0) > 0 ? "hsl(var(--kf-accent1))" : undefined }}>
              {contact.meta?.outstandingBalance != null && contact.meta.outstandingBalance > 0
                ? `TTD ${contact.meta.outstandingBalance.toLocaleString()}`
                : <span className="text-sm font-normal text-muted-foreground">All clear</span>}
            </div>
          </div>
          <div className="kf-stat-card p-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Clock className="w-3 h-3" />
              Last Activity
            </div>
            <div className="text-xs font-medium">
              {contact.meta?.lastInteractionAt
                ? relativeTime(contact.meta.lastInteractionAt)
                : <span className="text-muted-foreground">Send a message to start</span>}
            </div>
          </div>
          <div className="kf-stat-card p-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Calendar className="w-3 h-3" />
              Next Task
            </div>
            <div className="text-xs font-medium">
              {contact.meta?.nextDueTaskAt
                ? relativeTime(contact.meta.nextDueTaskAt)
                : <span className="text-muted-foreground">No tasks yet</span>}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 border border-border/50 text-sm">
          <div className="hidden sm:flex items-center gap-2 flex-1">
            <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-muted-foreground text-xs">Score: —</span>
          </div>
          <div className="hidden sm:flex items-center gap-2 flex-1">
            <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-muted-foreground text-xs">Balance: $0</span>
          </div>
          <div className="flex items-center gap-2 flex-1">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-muted-foreground text-xs">No activity yet — send a message to get started</span>
          </div>
        </div>
      )}

      <div className="p-3 rounded-xl bg-muted/30 border border-border/50">
        <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">Financial Summary</p>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-lg font-semibold" style={{ color: "hsl(var(--kf-accent2))" }}>
              {(contact.meta?.totalRevenue ?? 0) > 0
                ? `TTD ${(contact.meta?.totalRevenue ?? 0).toLocaleString()}`
                : <span className="text-base">TTD 0</span>}
            </p>
            <p className="text-[10px] text-muted-foreground">Total Revenue</p>
          </div>
          <div>
            <p className="text-lg font-semibold">{contact.meta?.invoiceCount ?? 0}</p>
            <p className="text-[10px] text-muted-foreground">
              {(contact.meta?.invoiceCount ?? 0) === 0 && onQuickAction ? (
                <button
                  onClick={() => onQuickAction(contact.id, "create-invoice")}
                  className="text-[hsl(var(--kf-accent2))] cursor-pointer hover:underline"
                >
                  Create first?
                </button>
              ) : "Invoices"}
            </p>
          </div>
          <div>
            <p className="text-lg font-semibold">{contact.meta?.bookingCount ?? 0}</p>
            <p className="text-[10px] text-muted-foreground">
              {(contact.meta?.bookingCount ?? 0) === 0 && onQuickAction ? (
                <button
                  onClick={() => onQuickAction(contact.id, "book-appointment")}
                  className="text-blue-400 cursor-pointer hover:underline"
                >
                  Book one?
                </button>
              ) : "Bookings"}
            </p>
          </div>
        </div>
      </div>

      {recentEvents.length > 0 && (
        <div className="p-3 rounded-xl bg-muted/30 border border-border/50">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <History className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Recent Activity</p>
            </div>
            <button
              onClick={() => onSetActiveTab("timeline")}
              className="text-[10px] text-[hsl(var(--kf-accent2))] hover:underline"
            >
              View all
            </button>
          </div>
          <div className="space-y-1.5">
            {recentEvents.map((event) => (
              <div key={event.id} className="flex items-center justify-between text-xs">
                <span className="font-medium truncate mr-2">{EVENT_LABELS[event.type] || event.type}</span>
                <span className="text-muted-foreground text-[10px] whitespace-nowrap flex-shrink-0">
                  {relativeTime(event.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
