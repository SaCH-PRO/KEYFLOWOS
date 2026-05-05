"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Sparkles,
  Phone,
  Mail,
  MessageCircle,
  Clock,
  TrendingUp,
  AlertTriangle,
  Loader2,
  RotateCw,
  ChevronRight,
} from "lucide-react";
import type { ContactInsightSnapshot, ContactRevenueSummary } from "@/lib/client";
import { buildWhatsAppLink } from "@/lib/whatsapp";

interface ContactInsightCardProps {
  snapshot: ContactInsightSnapshot | null;
  loading?: boolean;
  contact?: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    whatsappNumber?: string | null;
  } | null;
  onRefresh?: () => Promise<void> | void;
  onAddTask?: (
    title: string,
    options?: { dueDate?: string; priority?: string; remindAt?: string },
  ) => Promise<void> | void;
  revenueSummary?: ContactRevenueSummary | null;
}

function formatCurrency(value: number, currency: string): string {
  if (!Number.isFinite(value)) return `${currency} 0`;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${Math.round(value).toLocaleString()}`;
  }
}

function ChannelIcon({ channel, className }: { channel: string | null; className?: string }) {
  const cls = className ?? "w-3.5 h-3.5";
  switch (channel) {
    case "whatsapp":
      return <MessageCircle className={cls} />;
    case "email":
      return <Mail className={cls} />;
    case "call":
    case "sms":
      return <Phone className={cls} />;
    default:
      return <Sparkles className={cls} />;
  }
}

function ChurnMeter({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const tone =
    clamped >= 70
      ? { color: "hsl(var(--kf-error))", label: "High risk" }
      : clamped >= 40
        ? { color: "hsl(var(--kf-warning))", label: "Watch" }
        : { color: "hsl(var(--kf-success))", label: "Healthy" };
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-white/[0.06]">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${clamped}%`, background: tone.color }}
        />
      </div>
      <span className="text-[10px] font-semibold tabular-nums" style={{ color: tone.color }}>
        {clamped}
      </span>
      <span className="text-[10px] text-muted-foreground/70">{tone.label}</span>
    </div>
  );
}

export function ContactInsightCardSkeleton() {
  return (
    <div
      className="rounded-xl p-3 sm:p-4 space-y-3"
      style={{
        background: "hsl(var(--kf-accent2) / 0.04)",
        border: "1px solid hsl(var(--kf-accent2) / 0.15)",
      }}
    >
      <div className="flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "hsl(var(--kf-accent2))" }} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Building insight
        </span>
      </div>
      <div className="h-3 rounded bg-white/[0.05] animate-pulse" />
      <div className="h-3 w-4/5 rounded bg-white/[0.05] animate-pulse" />
      <div className="grid grid-cols-3 gap-2">
        <div className="h-10 rounded-lg bg-white/[0.03] animate-pulse" />
        <div className="h-10 rounded-lg bg-white/[0.03] animate-pulse" />
        <div className="h-10 rounded-lg bg-white/[0.03] animate-pulse" />
      </div>
    </div>
  );
}

export function ContactInsightCard({
  snapshot,
  loading,
  contact,
  onRefresh,
  onAddTask,
  revenueSummary,
}: ContactInsightCardProps) {
  const [acting, setActing] = useState(false);

  if (loading && !snapshot) {
    return <ContactInsightCardSkeleton />;
  }
  if (!snapshot) return null;

  const p = snapshot.payload;
  const action = p.suggestedAction;

  const handleAction = async () => {
    if (!contact) return;
    setActing(true);
    try {
      switch (action.kind) {
        case "send_whatsapp": {
          const phone = contact.whatsappNumber ?? contact.phone ?? "";
          if (phone) {
            const link = buildWhatsAppLink(phone, action.prefill?.message ?? "");
            window.open(link, "_blank", "noopener,noreferrer");
          } else {
            await onAddTask?.(action.prefill?.taskTitle ?? action.label, {
              priority: action.prefill?.priority ?? "NORMAL",
            });
          }
          break;
        }
        case "send_email": {
          if (contact.email) {
            const subject = encodeURIComponent(action.prefill?.subject ?? "");
            const body = encodeURIComponent(action.prefill?.message ?? "");
            window.location.href = `mailto:${contact.email}?subject=${subject}&body=${body}`;
          } else {
            await onAddTask?.(action.prefill?.taskTitle ?? action.label, {
              priority: action.prefill?.priority ?? "NORMAL",
            });
          }
          break;
        }
        case "schedule_call":
        case "book_appointment":
        case "create_invoice":
        case "create_task":
        case "enroll_in_sequence":
        case "review_dormant":
        default: {
          await onAddTask?.(action.prefill?.taskTitle ?? action.label, {
            priority: action.prefill?.priority ?? "NORMAL",
          });
          break;
        }
      }
    } finally {
      setActing(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl p-3 sm:p-4 space-y-3"
      style={{
        background: "hsl(var(--kf-accent2) / 0.04)",
        border: "1px solid hsl(var(--kf-accent2) / 0.15)",
      }}
      data-testid="contact-insight-card"
    >
      <div className="flex items-start gap-2.5">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
          style={{ background: "hsl(var(--kf-accent2) / 0.1)" }}
        >
          <Sparkles className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent2))" }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Relationship Insight
            </span>
            {snapshot.stale && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium bg-white/[0.04] text-muted-foreground/70">
                Refreshing…
              </span>
            )}
            {p.tags.map((t) => (
              <span
                key={t}
                className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                style={{
                  background: "hsl(var(--kf-accent2) / 0.1)",
                  color: "hsl(var(--kf-accent2))",
                }}
              >
                {t}
              </span>
            ))}
          </div>
          {p.relationshipSummary ? (
            <p className="text-[12px] leading-relaxed text-foreground/85">{p.relationshipSummary}</p>
          ) : (
            <p className="text-[11px] text-muted-foreground/70">No summary available yet.</p>
          )}
        </div>
        {onRefresh && (
          <button
            onClick={() => void onRefresh()}
            className="text-muted-foreground/50 hover:text-foreground transition-colors p-1 -m-1"
            title="Recompute insight"
            aria-label="Recompute insight"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {p.bestChannel && (
          <span
            className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full font-medium"
            style={{
              background: "hsl(var(--kf-card) / 0.6)",
              border: "1px solid hsl(var(--kf-accent2) / 0.18)",
              color: "hsl(var(--kf-accent2))",
            }}
          >
            <ChannelIcon channel={p.bestChannel} className="w-3 h-3" />
            Best on {p.bestChannel}
            {typeof p.bestChannelConfidence === "number" && (
              <span className="text-muted-foreground/70">
                · {Math.round(p.bestChannelConfidence * 100)}%
              </span>
            )}
          </span>
        )}
        {p.bestTimeWindow && (
          <span
            className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full font-medium text-muted-foreground"
            style={{
              background: "hsl(var(--kf-card) / 0.6)",
              border: "1px solid hsl(var(--border) / 0.4)",
            }}
          >
            <Clock className="w-3 h-3" />
            {p.bestTimeWindow.label}
          </span>
        )}
        {p.dominantTopics.slice(0, 4).map((topic) => (
          <span
            key={topic}
            className="inline-flex items-center text-[10px] px-2 py-1 rounded-full font-medium text-muted-foreground"
            style={{
              background: "hsl(var(--kf-card) / 0.5)",
              border: "1px solid hsl(var(--border) / 0.4)",
            }}
          >
            #{topic}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div
          className="rounded-lg p-2"
          style={{ background: "hsl(var(--kf-card) / 0.5)", border: "1px solid hsl(var(--border) / 0.3)" }}
        >
          <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-muted-foreground/60 mb-1">
            <TrendingUp className="w-3 h-3" />
            Lifetime
          </div>
          <div className="text-sm font-semibold tabular-nums">
            {formatCurrency(p.lifetimeValue, p.currency)}
          </div>
        </div>
        <div
          className="rounded-lg p-2"
          style={{ background: "hsl(var(--kf-card) / 0.5)", border: "1px solid hsl(var(--border) / 0.3)" }}
        >
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60 mb-1">
            Open Deals
          </div>
          <div className="text-sm font-semibold tabular-nums">
            {p.openDeals.count}
            <span className="text-[10px] text-muted-foreground/70 font-normal ml-1">
              · {formatCurrency(p.openDeals.value, p.currency)}
            </span>
          </div>
        </div>
        <div
          className="rounded-lg p-2"
          style={{ background: "hsl(var(--kf-card) / 0.5)", border: "1px solid hsl(var(--border) / 0.3)" }}
          title={p.churnRiskReason}
        >
          <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-muted-foreground/60 mb-1">
            <AlertTriangle className="w-3 h-3" />
            Churn Risk
          </div>
          <ChurnMeter score={p.churnRisk} />
        </div>
      </div>

      {revenueSummary && (revenueSummary.lifetimeRevenue > 0 || revenueSummary.outstandingBalance > 0 || revenueSummary.openInvoices > 0 || revenueSummary.recentRevenueActions.length > 0) && (
        <div
          className="rounded-lg p-2.5 space-y-2"
          style={{ background: "hsl(var(--kf-card) / 0.5)", border: "1px solid hsl(var(--kf-accent1) / 0.18)" }}
          data-testid="contact-insight-card-revenue"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--kf-accent1))" }}>
              Revenue snapshot
            </span>
            {typeof revenueSummary.paymentReliability === "number" && (
              <span className="text-[10px] text-muted-foreground/70">
                Pays on time {Math.round(revenueSummary.paymentReliability * 100)}%
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <div>
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60">Lifetime</div>
              <div className="font-semibold tabular-nums">
                {formatCurrency(revenueSummary.lifetimeRevenue, revenueSummary.currency)}
              </div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60">Outstanding</div>
              <div className="font-semibold tabular-nums" style={{ color: revenueSummary.outstandingBalance > 0 ? "hsl(var(--kf-warning))" : undefined }}>
                {formatCurrency(revenueSummary.outstandingBalance, revenueSummary.currency)}
              </div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60">Open</div>
              <div className="font-semibold tabular-nums">
                {revenueSummary.openInvoices} inv
                <span className="text-muted-foreground/70 ml-1">· {revenueSummary.openQuotes} qt</span>
              </div>
            </div>
          </div>
          {revenueSummary.lastPaymentAt && (
            <div className="text-[10px] text-muted-foreground/70">
              Last payment {new Date(revenueSummary.lastPaymentAt).toLocaleDateString()}
              {typeof revenueSummary.lastPaymentAmount === "number" && revenueSummary.lastPaymentAmount > 0 && (
                <span className="ml-1">
                  · {formatCurrency(revenueSummary.lastPaymentAmount, revenueSummary.currency)}
                </span>
              )}
            </div>
          )}
          {revenueSummary.recentRevenueActions.length > 0 && (
            <div className="space-y-1 pt-1 border-t border-border/30">
              {revenueSummary.recentRevenueActions.slice(0, 3).map((a) => (
                <div key={`${a.type}-${a.entityId ?? a.occurredAt}`} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-muted-foreground/80 truncate">{a.label}</span>
                  {typeof a.amount === "number" && a.amount !== 0 && (
                    <span className="tabular-nums text-foreground/80">
                      {formatCurrency(a.amount, a.currency ?? revenueSummary.currency)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-start gap-2.5 pt-1">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">
            Suggested next step
          </p>
          <p className="text-[12px] font-semibold mt-0.5">{action.label}</p>
          {action.description && (
            <p className="text-[11px] text-muted-foreground mt-0.5">{action.description}</p>
          )}
        </div>
        <button
          onClick={() => void handleAction()}
          disabled={acting || !contact}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50"
          style={{
            background: "hsl(var(--kf-accent2) / 0.15)",
            color: "hsl(var(--kf-accent2))",
            borderWidth: 1,
            borderColor: "hsl(var(--kf-accent2) / 0.25)",
          }}
          data-testid="contact-insight-card-action"
        >
          {acting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChannelIcon channel={action.channel ?? null} className="w-3 h-3" />}
          Do it
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>
    </motion.div>
  );
}
