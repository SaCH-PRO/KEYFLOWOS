"use client";

import Link from "next/link";
import { AlertCircle, Clock, Check, X, CheckCircle2, Sparkles, Loader2, HeartPulse, MessageCircle, TrendingUp, TrendingDown, Package, Send, Award, Clock3, ShieldAlert, FileWarning, Bell } from "lucide-react";
import type { PriorityItem, AutopilotTask, MomentumRecommendation, NudgeItem, FinancialAlert } from "./types";
import { formatTTD } from "./types";

export function PriorityRow({ priority, onDismiss }: { priority: PriorityItem; onDismiss?: () => void }) {
  const urgencyColors: Record<string, { border: string; text: string }> = {
    critical: { border: "hsl(var(--kf-error) / 0.4)", text: "hsl(var(--kf-error))" },
    high: { border: "hsl(var(--kf-accent1) / 0.4)", text: "hsl(var(--kf-accent1))" },
    medium: { border: "hsl(var(--kf-warning) / 0.4)", text: "hsl(var(--kf-warning))" },
    low: { border: "hsl(var(--kf-info) / 0.4)", text: "hsl(var(--kf-info))" },
  };
  const colors = urgencyColors[priority.urgency] || urgencyColors.low;

  return (
    <div className="flex items-center gap-3 p-3 kf-radius-md border transition-all hover:bg-muted/10 group" style={{ borderColor: colors.border }}>
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
      <Link href={priority.actionHref} className="text-xs font-medium px-3 py-1.5 kf-radius-sm transition-all hover:scale-105 flex-shrink-0 text-white" style={{ backgroundColor: colors.text }}>
        {priority.actionLabel}
      </Link>
      {onDismiss && (
        <button onClick={onDismiss} className="p-1.5 kf-radius-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100" title="Dismiss">
          <X className="w-3 h-3" />
        </button>
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
  return (
    <div className="flex items-center gap-3 p-3 kf-radius-md border border-border group transition-all hover:bg-muted/10">
      <div
        className={task.priority === "HIGH"
          ? "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
          : "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 bg-muted text-muted-foreground"
        }
        style={task.priority === "HIGH" ? { backgroundColor: "hsl(var(--kf-accent1) / 0.2)", color: "hsl(var(--kf-accent1))" } : undefined}
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
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {task.requiresApproval && task.status === "AWAITING_APPROVAL" ? (
          <>
            <button onClick={onDeny} disabled={completing} className="p-1.5 kf-radius-sm transition-colors disabled:opacity-50 hover:bg-muted/30" style={{ color: "hsl(var(--kf-error))" }} title="Deny">
              <X className="w-4 h-4" />
            </button>
            <button onClick={onApprove} disabled={completing} className="p-1.5 kf-radius-sm transition-colors disabled:opacity-50 hover:bg-muted/30" style={{ color: "hsl(var(--kf-success))" }} title="Approve">
              <Check className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            <button onClick={onDismiss} disabled={completing} className="p-1.5 kf-radius-sm transition-colors disabled:opacity-50 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground" title="Dismiss">
              <X className="w-3.5 h-3.5" />
            </button>
            <button onClick={onComplete} disabled={completing} className="p-1.5 kf-radius-sm transition-colors disabled:opacity-50 opacity-0 group-hover:opacity-100" style={{ color: "hsl(var(--kf-success))" }} title="Mark as done">
              {completing ? <Clock className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            </button>
          </>
        )}
      </div>
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
      <div className="flex items-center gap-1 flex-shrink-0">
        <button onClick={onAction} disabled={loading} className="text-[10px] font-medium px-3 py-1.5 kf-radius-sm transition-all hover:scale-105 text-white" style={{ backgroundColor: "hsl(var(--kf-accent2))" }}>
          {loading ? <Loader2 className="w-3 h-3 animate-spin inline" /> : "Act"}
        </button>
        <button onClick={onSnooze} disabled={loading} className="text-[10px] font-medium px-2 py-1.5 kf-radius-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all" title="Snooze 7 days">
          <Clock3 className="w-3 h-3" />
        </button>
        <button onClick={onDismiss} disabled={loading} className="text-[10px] font-medium px-2 py-1.5 kf-radius-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all" title="Dismiss">
          <X className="w-3 h-3" />
        </button>
      </div>
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
      <Link href={nudge.ctaHref} className="text-xs font-medium px-3 py-1.5 kf-radius-sm text-white transition-all hover:scale-105 flex-shrink-0" style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}>
        {nudge.ctaLabel}
      </Link>
      {nudge.snoozable && (
        <button onClick={onSnooze} disabled={dismissing} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 kf-radius-sm hover:bg-muted/30 transition-all flex-shrink-0">
          {dismissing ? "..." : "Later"}
        </button>
      )}
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
        <button onClick={onDismiss} className="p-1.5 kf-radius-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors flex-shrink-0" title="Dismiss">
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
