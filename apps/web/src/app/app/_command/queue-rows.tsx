"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, Clock, Check, X, CheckCircle2, Sparkles, Loader2, HeartPulse, MessageCircle, TrendingUp, TrendingDown, Package, Send, Award, Clock3, ShieldAlert, FileWarning, Bell, MoreHorizontal, ShieldCheck } from "lucide-react";
import type { PriorityItem, AutopilotTask, MomentumRecommendation, NudgeItem, FinancialAlert } from "./types";
import { formatTTD } from "./types";

function OverflowMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((p) => !p); }}
        className="w-7 h-7 min-w-[44px] min-h-[44px] flex items-center justify-center kf-radius-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
        title="More actions"
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full mt-1 z-50 py-1 kf-radius-md shadow-lg min-w-[120px]"
            style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border) / 0.4)" }}
            onClick={() => setOpen(false)}
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}

function OverflowAction({ label, onClick, color, disabled }: { label: string; onClick: () => void; color?: string; disabled?: boolean }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={disabled}
      className="w-full text-left px-3 py-2 min-h-[44px] text-xs font-medium hover:bg-muted/20 transition-colors disabled:opacity-40 flex items-center"
      style={color ? { color } : undefined}
    >
      {label}
    </button>
  );
}

export function PriorityRow({ priority, onDismiss }: { priority: PriorityItem; onDismiss?: () => void }) {
  const urgencyColors: Record<string, { border: string; text: string }> = {
    critical: { border: "hsl(var(--kf-error) / 0.4)", text: "hsl(var(--kf-error))" },
    high: { border: "hsl(var(--kf-accent1) / 0.4)", text: "hsl(var(--kf-accent1))" },
    medium: { border: "hsl(var(--kf-warning) / 0.4)", text: "hsl(var(--kf-warning))" },
    low: { border: "hsl(var(--kf-info) / 0.4)", text: "hsl(var(--kf-info))" },
  };
  const colors = urgencyColors[priority.urgency] || urgencyColors.low;

  return (
    <div className="flex items-center gap-3 p-3 kf-radius-md border transition-all hover:bg-muted/10" style={{ borderColor: colors.border }}>
      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: colors.text }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{priority.title}</p>
        <p className="kf-text-caption text-muted-foreground truncate">
          {priority.contactName && <span>{priority.contactName} · </span>}
          {priority.description}
        </p>
      </div>
      {priority.amount != null && (
        <span className="text-xs font-semibold flex-shrink-0" style={{ color: colors.text }}>{formatTTD(priority.amount)}</span>
      )}
      <Link
        href={priority.actionHref}
        className="text-xs font-medium min-h-[44px] min-w-[44px] px-3 kf-radius-sm transition-all hover:scale-105 flex-shrink-0 flex items-center justify-center"
        style={{ backgroundColor: colors.text, color: "hsl(var(--kf-foreground))" }}
      >
        {priority.actionLabel}
      </Link>
      {onDismiss && (
        <OverflowMenu>
          <OverflowAction label="Dismiss" onClick={onDismiss} />
        </OverflowMenu>
      )}
    </div>
  );
}

export function TaskRow({ task, index, onComplete, onApprove, onDeny, onDismiss, completing }: {
  task: AutopilotTask;
  index: number;
  onComplete: () => void;
  onApprove: () => void;
  onDeny: () => void;
  onDismiss: () => void;
  completing: boolean;
}) {
  const isApproval = task.requiresApproval && task.status === "AWAITING_APPROVAL";

  return (
    <div className="flex items-center gap-3 p-3 kf-radius-md border border-border transition-all hover:bg-muted/10">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
        style={task.priority === "HIGH"
          ? { backgroundColor: "hsl(var(--kf-accent1) / 0.2)", color: "hsl(var(--kf-accent1))" }
          : { backgroundColor: "hsl(var(--kf-muted) / 0.3)" }
        }
      >
        {index + 1}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{task.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{task.category}</span>
          {task.autoExecutable && (
            <span className="text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: "hsl(var(--kf-info) / 0.1)", color: "hsl(var(--kf-info))" }}>
              <Sparkles className="w-2.5 h-2.5" />Auto
            </span>
          )}
        </div>
      </div>
      {isApproval ? (
        <button
          onClick={onApprove}
          disabled={completing}
          className="text-xs font-medium min-h-[44px] min-w-[44px] px-3 kf-radius-sm transition-all hover:scale-105 flex-shrink-0 flex items-center justify-center"
          style={{ backgroundColor: "hsl(var(--kf-success))", color: "hsl(var(--kf-foreground))" }}
        >
          {completing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Approve"}
        </button>
      ) : (
        <button
          onClick={onComplete}
          disabled={completing}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center kf-radius-sm transition-colors disabled:opacity-50"
          style={{ color: "hsl(var(--kf-success))" }}
          title="Mark as done"
        >
          {completing ? <Clock className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
        </button>
      )}
      <OverflowMenu>
        {isApproval && (
          <OverflowAction label="Deny" onClick={onDeny} color="hsl(var(--kf-error))" disabled={completing} />
        )}
        <OverflowAction label="Dismiss" onClick={onDismiss} disabled={completing} />
      </OverflowMenu>
    </div>
  );
}

export function MomentumRow({ rec, onAction, onSnooze, onDismiss, loading }: {
  rec: MomentumRecommendation;
  onAction: () => void;
  onSnooze: () => void;
  onDismiss: () => void;
  loading: boolean;
}) {
  const contactName = rec.contact
    ? `${rec.contact.firstName ?? ""} ${rec.contact.lastName ?? ""}`.trim() || "Unnamed"
    : "Contact";
  const typeIcons: Record<string, React.ReactNode> = {
    churn_risk: <TrendingDown className="w-3 h-3" />,
    check_in: <MessageCircle className="w-3 h-3" />,
    upsell: <TrendingUp className="w-3 h-3" />,
    package_offer: <Package className="w-3 h-3" />,
    re_engage: <Send className="w-3 h-3" />,
    birthday: <Award className="w-3 h-3" />,
  };

  return (
    <div className="flex items-center gap-3 p-3 kf-radius-md border border-border transition-all hover:bg-muted/10">
      <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "hsl(var(--kf-accent2) / 0.2)", color: "hsl(var(--kf-accent2))" }}>
        {typeIcons[rec.type] || <HeartPulse className="w-3 h-3" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{rec.title}</p>
        <p className="kf-text-caption text-muted-foreground truncate">
          {contactName}{rec.momentumScore != null && ` · Score: ${rec.momentumScore}`}
        </p>
      </div>
      <button
        onClick={onAction}
        disabled={loading}
        className="text-xs font-medium min-h-[44px] min-w-[44px] px-3 kf-radius-sm transition-all hover:scale-105 flex-shrink-0 flex items-center justify-center"
        style={{ backgroundColor: "hsl(var(--kf-accent2))", color: "hsl(var(--kf-foreground))" }}
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Act"}
      </button>
      <OverflowMenu>
        <OverflowAction label="Snooze 7 days" onClick={onSnooze} disabled={loading} />
        <OverflowAction label="Dismiss" onClick={onDismiss} disabled={loading} />
      </OverflowMenu>
    </div>
  );
}

export function NudgeRow({ nudge, onSnooze, dismissing }: {
  nudge: NudgeItem;
  onSnooze: () => void;
  dismissing: boolean;
}) {
  return (
    <div className="flex items-center gap-3 p-3 kf-radius-md border transition-all" style={{ borderColor: "hsl(var(--kf-accent2) / 0.2)", backgroundColor: "hsl(var(--kf-accent2) / 0.03)" }}>
      <Sparkles className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(var(--kf-accent2))" }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{nudge.title}</p>
        <p className="kf-text-caption text-muted-foreground truncate">{nudge.body}</p>
      </div>
      <Link
        href={nudge.ctaHref}
        className="text-xs font-medium min-h-[44px] min-w-[44px] px-3 kf-radius-sm transition-all hover:scale-105 flex-shrink-0 flex items-center justify-center"
        style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))", color: "hsl(var(--kf-foreground))" }}
      >
        {nudge.ctaLabel}
      </Link>
      {nudge.snoozable && (
        <OverflowMenu>
          <OverflowAction label={dismissing ? "..." : "Snooze"} onClick={onSnooze} disabled={dismissing} />
        </OverflowMenu>
      )}
    </div>
  );
}

export function RetentionAlertRow({ rec, onAction, onDismiss, loading }: { rec: MomentumRecommendation; onAction: () => void; onDismiss: () => void; loading?: boolean }) {
  const contactLabel = rec.contact
    ? `${rec.contact.firstName ?? ""} ${rec.contact.lastName ?? ""}`.trim() || "Contact"
    : "Contact";
  const isChurn = rec.type?.toLowerCase().includes("churn");

  const confPct = (() => {
    const raw = rec.momentumScore ?? 50;
    return Math.max(10, Math.min(95, Math.round(raw)));
  })();
  const confColor = confPct >= 60 ? "--kf-success" : confPct >= 35 ? "--kf-warning" : "--kf-error";
  const borderColor = isChurn ? "--kf-error" : "--kf-warning";

  return (
    <div
      className="flex items-center gap-3 p-3 kf-radius-md border transition-all hover:bg-muted/10"
      style={{ borderColor: `hsl(var(${borderColor}) / 0.3)` }}
    >
      <HeartPulse className="w-3.5 h-3.5 shrink-0" style={{ color: `hsl(var(${borderColor}))` }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{contactLabel}</p>
        <p className="text-[10px] text-muted-foreground truncate">{rec.title}</p>
      </div>
      <span
        className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0"
        style={{ background: `hsl(var(${confColor}) / 0.1)`, color: `hsl(var(${confColor}))` }}
      >
        <ShieldCheck className="w-2.5 h-2.5" />
        {confPct}%
      </span>
      <button
        onClick={onAction}
        disabled={loading}
        className="px-2.5 py-1 rounded-lg text-[11px] font-medium shrink-0 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
        style={{
          background: `hsl(var(${color}) / 0.1)`,
          color: `hsl(var(${color}))`,
          borderWidth: 1,
          borderColor: `hsl(var(${color}) / 0.25)`,
        }}
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Re-engage"}
      </button>
      <OverflowMenu>
        <OverflowAction label="Dismiss" onClick={onDismiss} />
      </OverflowMenu>
    </div>
  );
}

export function AlertRow({ alert, onDismiss }: { alert: FinancialAlert; onDismiss?: () => void }) {
  const alertIcons: Record<string, React.ReactNode> = {
    COMPLIANCE: <ShieldAlert className="w-3.5 h-3.5" />,
    PAYMENT: <FileWarning className="w-3.5 h-3.5" />,
    APPROVAL: <Bell className="w-3.5 h-3.5" />,
  };
  const isError = alert.severity === "CRITICAL";

  return (
    <div className="flex items-center gap-3 p-3 kf-radius-md border transition-all hover:bg-muted/10" style={{ borderColor: isError ? "hsl(var(--kf-error) / 0.3)" : "hsl(var(--kf-accent1) / 0.3)" }}>
      <div style={{ color: isError ? "hsl(var(--kf-error))" : "hsl(var(--kf-accent1))" }}>
        {alertIcons[alert.type] || <AlertCircle className="w-3.5 h-3.5" />}
      </div>
      <Link href={alert.action || "/app/commerce"} className="text-sm flex-1 min-w-0 truncate hover:underline">
        {alert.message}
      </Link>
      {onDismiss && (
        <OverflowMenu>
          <OverflowAction label="Dismiss" onClick={onDismiss} />
        </OverflowMenu>
      )}
    </div>
  );
}
