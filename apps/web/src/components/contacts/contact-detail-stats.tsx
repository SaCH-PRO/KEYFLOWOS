"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Minus,
  Clock,
  Calendar,
  Info,
  History,
  BarChart3,
  ChevronRight,
  HeartPulse,
  Sparkles,
  ListTodo,
  Zap,
} from "lucide-react";
import { fetchContactMomentum, fetchContactMomentumHistory, type MomentumScore, type MomentumHistory } from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import type { ContactDetailData, ContactEvent, DetailQuickAction } from "./contact-detail";
import { ContactCommandItems } from "./contact-command-items";

interface ContactDetailStatsProps {
  contact: ContactDetailData;
  events: ContactEvent[];
  onSetActiveTab: (tab: string) => void;
  onQuickAction?: (contactId: string, action: DetailQuickAction) => void;
  onAddTask?: (title: string, options?: { dueDate?: string; priority?: string; remindAt?: string }) => Promise<void>;
}

export function MomentumPrimaryCTA({
  contactId,
  contactName,
  onAddTask,
}: {
  contactId: string;
  contactName: string;
  onAddTask?: (title: string, options?: { dueDate?: string; priority?: string; remindAt?: string }) => Promise<void>;
}) {
  const [topRec, setTopRec] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (!bid) return;
    let cancelled = false;
    fetchContactMomentum(contactId, bid).then((res) => {
      if (cancelled) return;
      const recs = (res.data as { recommendations?: string[] } | null)?.recommendations;
      if (recs && recs.length > 0) {
        setTopRec(recs[0]);
        return;
      }
      const score = res.data?.score;
      const trend = res.data?.trend;
      if (score != null && score < 40) {
        setTopRec(trend === "down" ? "Re-engage to revive momentum" : "Reach out to build momentum");
      }
    });
    return () => { cancelled = true; };
  }, [contactId]);

  if (!topRec) return null;

  const handleCreateTask = async () => {
    if (!onAddTask) return;
    setBusy(true);
    try {
      const due = new Date();
      due.setDate(due.getDate() + 1);
      await onAddTask(`${topRec} — ${contactName}`, { dueDate: due.toISOString(), priority: "HIGH" });
      toast.success("Task created from momentum recommendation");
    } catch {
      toast.error("Could not create task");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="rounded-xl p-3 flex items-start gap-2.5 border"
      style={{
        background: "hsl(var(--kf-accent1) / 0.06)",
        borderColor: "hsl(var(--kf-accent1) / 0.25)",
      }}
    >
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
        style={{ background: "hsl(var(--kf-accent1) / 0.15)" }}
      >
        <Sparkles className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Momentum recommends</span>
        </div>
        <p className="text-sm font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>{topRec}</p>
        {onAddTask && (
          <button
            onClick={handleCreateTask}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-60"
            style={{
              background: "hsl(var(--kf-accent1) / 0.15)",
              color: "hsl(var(--kf-accent1))",
              borderWidth: 1,
              borderColor: "hsl(var(--kf-accent1) / 0.30)",
            }}
          >
            <ListTodo className="w-3 h-3" />
            {busy ? "Creating…" : "Create task"}
            <ChevronRight className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
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

function CollapsibleCard({
  icon: Icon,
  title,
  children,
  defaultOpen = false,
  hasData = false,
  badge,
  preview,
}: {
  icon: typeof TrendingUp;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  hasData?: boolean;
  badge?: React.ReactNode;
  preview?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl bg-muted/30 border border-border/50 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-3 hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex-shrink-0">{title}</span>
          {hasData && <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--kf-accent2))] flex-shrink-0" />}
          {badge}
          {!open && preview && (
            <span className="text-[10px] text-muted-foreground/60 truncate ml-1">
              {preview}
            </span>
          )}
        </div>
        <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform duration-200 flex-shrink-0 ${open ? "rotate-90" : ""}`} />
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

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
        <span className="text-[10px] font-medium" style={{ color }}>{label}</span>
      </div>
    </div>
  );
}

function LeadScoreTooltip() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-block">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
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

function MomentumSparkline({ data }: { data: { score: number; calculatedAt: string }[] }) {
  if (data.length < 2) return null;

  const width = 200;
  const height = 40;
  const padding = 2;
  const scores = data.map(d => d.score);
  const min = Math.max(0, Math.min(...scores) - 5);
  const max = Math.min(100, Math.max(...scores) + 5);
  const range = max - min || 1;

  const points = data.map((d, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2);
    const y = height - padding - ((d.score - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  }).join(" ");

  const last = scores[scores.length - 1];
  const first = scores[0];
  const strokeColor = last >= first ? "rgb(74 222 128)" : "rgb(248 113 113)";
  const fillColor = last >= first ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)";

  const areaPoints = `${padding},${height - padding} ${points} ${width - padding},${height - padding}`;

  return (
    <div className="kf-stat-card p-3 mt-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">30-Day Trend</span>
        <span className="text-[10px] text-muted-foreground">{data.length} data points</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height: 40 }}>
        <polygon points={areaPoints} fill={fillColor} />
        <polyline points={points} fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {data.length > 0 && (() => {
          const lastIdx = data.length - 1;
          const lx = padding + (lastIdx / (data.length - 1)) * (width - padding * 2);
          const ly = height - padding - ((scores[lastIdx] - min) / range) * (height - padding * 2);
          return <circle cx={lx} cy={ly} r="2.5" fill={strokeColor} />;
        })()}
      </svg>
      <div className="flex justify-between mt-1">
        <span className="text-[9px] text-muted-foreground">{data.length > 0 ? new Date(data[0].calculatedAt).toLocaleDateString("en-TT", { month: "short", day: "numeric" }) : ""}</span>
        <span className="text-[9px] text-muted-foreground">{data.length > 0 ? new Date(data[data.length - 1].calculatedAt).toLocaleDateString("en-TT", { month: "short", day: "numeric" }) : ""}</span>
      </div>
    </div>
  );
}

function MomentumBadge({ contactId }: { contactId: string }) {
  const [momentum, setMomentum] = useState<MomentumScore | null>(null);
  const [history, setHistory] = useState<MomentumHistory>([]);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (!bid) return;
    Promise.all([
      fetchContactMomentum(contactId, bid),
      fetchContactMomentumHistory(contactId, 30, bid),
    ]).then(([scoreRes, historyRes]) => {
      if (scoreRes.data) setMomentum(scoreRes.data);
      if (historyRes.data) setHistory(historyRes.data);
    });
  }, [contactId]);

  if (!momentum) return null;

  const score = Math.max(0, Math.min(100, momentum.score));
  const color =
    score >= 70 ? "hsl(142 76% 36%)" :
    score >= 40 ? "hsl(var(--kf-accent1))" :
    "hsl(0 72% 51%)";
  const label = score >= 70 ? "Strong" : score >= 40 ? "Moderate" : "At Risk";

  const TrendIcon = momentum.trend === "rising" ? TrendingUp :
    momentum.trend === "falling" ? TrendingDown : Minus;
  const trendColor = momentum.trend === "rising" ? "text-green-400" :
    momentum.trend === "falling" ? "text-red-400" : "text-muted-foreground";

  return (
    <CollapsibleCard icon={HeartPulse} title="Momentum" hasData={true}
      badge={<span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted font-medium" style={{ color }}>{label}</span>}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="kf-stat-card p-3">
          <div className="flex items-center gap-1 text-muted-foreground text-xs mb-1">
            <HeartPulse className="w-3 h-3" />
            <span>Score</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold">{score}</span>
            <div className="flex-1 flex flex-col gap-0.5">
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${score}%`, backgroundColor: color }} />
              </div>
              <span className="text-[10px] font-medium" style={{ color }}>{label}</span>
            </div>
          </div>
        </div>
        <div className="kf-stat-card p-3">
          <div className="flex items-center gap-1 text-muted-foreground text-xs mb-1">
            <TrendIcon className={`w-3 h-3 ${trendColor}`} />
            <span>Trend</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium capitalize ${trendColor}`}>{momentum.trend}</span>
            {momentum.previousScore != null && (
              <span className="text-[10px] text-muted-foreground">
                (prev: {momentum.previousScore})
              </span>
            )}
          </div>
        </div>
      </div>
      {history.length >= 2 && (
        <MomentumSparkline data={history.map(h => ({ score: h.score, calculatedAt: h.calculatedAt ?? new Date().toISOString() }))} />
      )}
      <div className="grid grid-cols-5 gap-1.5 mt-3">
        {[
          { label: "Recency", value: momentum.recencyScore },
          { label: "Frequency", value: momentum.frequencyScore },
          { label: "Monetary", value: momentum.monetaryScore },
          { label: "Engage", value: momentum.engagementScore },
          { label: "Tenure", value: momentum.tenureScore },
        ].map(f => (
          <div key={f.label} className="text-center p-1.5 rounded-lg bg-muted/30">
            <div className="text-xs font-semibold">{Math.round(f.value)}</div>
            <div className="text-[9px] text-muted-foreground">{f.label}</div>
          </div>
        ))}
      </div>
    </CollapsibleCard>
  );
}

export function ContactDetailStats({ contact, events, onSetActiveTab, onQuickAction }: ContactDetailStatsProps) {
  const router = useRouter();
  const goInvoices = (status?: string) => {
    const qs = new URLSearchParams({ tab: "invoices", contactId: contact.id });
    if (status) qs.set("status", status);
    router.push(`/app/commerce?${qs.toString()}`);
  };
  const goBookings = () => {
    router.push(`/app/bookings?contactId=${encodeURIComponent(contact.id)}`);
  };
  const hasAnyMetric = contact.meta?.leadScore != null ||
    (contact.meta?.outstandingBalance ?? 0) > 0 ||
    contact.meta?.lastInteractionAt ||
    contact.meta?.nextDueTaskAt;

  const hasFinancial = (contact.meta?.totalRevenue ?? 0) > 0 ||
    (contact.meta?.invoiceCount ?? 0) > 0 ||
    (contact.meta?.bookingCount ?? 0) > 0;

  const recentEvents = events.slice(0, 3);

  const scoreBadge = contact.meta?.leadScore != null ? (
    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted font-medium">
      {contact.meta.leadScore >= 70 ? "Hot" : contact.meta.leadScore >= 40 ? "Warm" : "Cold"}
    </span>
  ) : null;

  return (
    <>
      <CollapsibleCard icon={TrendingUp} title="Metrics" hasData={!!hasAnyMetric} badge={scoreBadge}
        preview={hasAnyMetric ? [
          contact.meta?.leadScore != null ? `Score ${contact.meta.leadScore}` : null,
          (contact.meta?.outstandingBalance ?? 0) > 0 ? `TTD ${contact.meta?.outstandingBalance?.toLocaleString()} due` : null,
          contact.meta?.lastInteractionAt ? relativeTime(contact.meta.lastInteractionAt) : null,
        ].filter(Boolean).join(" · ") : undefined}
      >
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
              {contact.meta?.outstandingBalance != null && contact.meta.outstandingBalance > 0 ? (
                <button
                  onClick={() => goInvoices("UNPAID")}
                  className="text-lg font-semibold hover:underline cursor-pointer"
                  style={{ color: "hsl(var(--kf-accent1))" }}
                  title="View unpaid invoices"
                >
                  TTD {contact.meta.outstandingBalance.toLocaleString()}
                </button>
              ) : (
                <div className="text-sm font-normal text-muted-foreground">All clear</div>
              )}
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
          <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/20 text-sm">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-muted-foreground text-xs">No activity yet — send a message to get started</span>
          </div>
        )}
      </CollapsibleCard>

      <MomentumBadge contactId={contact.id} />

      <CollapsibleCard icon={BarChart3} title="Financial Summary" hasData={hasFinancial}
        preview={hasFinancial ? [
          (contact.meta?.totalRevenue ?? 0) > 0 ? `TTD ${(contact.meta?.totalRevenue ?? 0).toLocaleString()}` : null,
          `${contact.meta?.invoiceCount ?? 0} invoices`,
          `${contact.meta?.bookingCount ?? 0} bookings`,
        ].filter(Boolean).join(" · ") : undefined}
      >
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            {(contact.meta?.totalRevenue ?? 0) > 0 ? (
              <button
                onClick={() => goInvoices("PAID")}
                className="text-lg font-semibold hover:underline cursor-pointer"
                style={{ color: "hsl(var(--kf-accent2))" }}
                title="View paid invoices for this contact"
              >
                TTD {(contact.meta?.totalRevenue ?? 0).toLocaleString()}
              </button>
            ) : (
              <p className="text-base font-semibold" style={{ color: "hsl(var(--kf-accent2))" }}>TTD 0</p>
            )}
            <p className="text-[10px] text-muted-foreground">
              {(contact.meta?.totalRevenue ?? 0) > 0
                ? <button onClick={() => goInvoices("PAID")} className="hover:text-foreground cursor-pointer">Total Revenue ›</button>
                : "Total Revenue"}
            </p>
          </div>
          <div>
            {(contact.meta?.invoiceCount ?? 0) > 0 ? (
              <button
                onClick={() => goInvoices()}
                className="text-lg font-semibold hover:underline cursor-pointer"
                title="View invoices for this contact"
              >
                {contact.meta?.invoiceCount}
              </button>
            ) : (
              <p className="text-lg font-semibold">0</p>
            )}
            <p className="text-[10px] text-muted-foreground">
              {(contact.meta?.invoiceCount ?? 0) === 0 && onQuickAction ? (
                <button
                  onClick={() => onQuickAction(contact.id, "create-invoice")}
                  className="text-[hsl(var(--kf-accent2))] cursor-pointer hover:underline"
                >
                  Create first?
                </button>
              ) : (
                <button onClick={() => goInvoices()} className="hover:text-foreground cursor-pointer">Invoices ›</button>
              )}
            </p>
          </div>
          <div>
            {(contact.meta?.bookingCount ?? 0) > 0 ? (
              <button
                onClick={goBookings}
                className="text-lg font-semibold hover:underline cursor-pointer"
                title="View bookings for this contact"
              >
                {contact.meta?.bookingCount}
              </button>
            ) : (
              <p className="text-lg font-semibold">0</p>
            )}
            <p className="text-[10px] text-muted-foreground">
              {(contact.meta?.bookingCount ?? 0) === 0 && onQuickAction ? (
                <button
                  onClick={() => onQuickAction(contact.id, "book-appointment")}
                  className="text-blue-400 cursor-pointer hover:underline"
                >
                  Book one?
                </button>
              ) : (
                <button onClick={goBookings} className="hover:text-foreground cursor-pointer">Bookings ›</button>
              )}
            </p>
          </div>
        </div>
      </CollapsibleCard>

      <CollapsibleCard icon={Zap} title="Command Queue" hasData={true}>
        <ContactCommandItems contactId={contact.id} />
      </CollapsibleCard>

      {recentEvents.length > 0 && (
        <CollapsibleCard icon={History} title="Recent Activity" hasData={recentEvents.length > 0}
          preview={recentEvents.length > 0 ? `${recentEvents.length} recent · ${EVENT_LABELS[recentEvents[0].type] || recentEvents[0].type}` : undefined}
        >
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
          <button
            onClick={() => onSetActiveTab("timeline")}
            className="mt-2 text-[10px] text-[hsl(var(--kf-accent2))] hover:underline"
          >
            View all
          </button>
        </CollapsibleCard>
      )}
    </>
  );
}
