"use client";

import { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  ShieldAlert,
  Bot,
  User,
  Loader2,
  RotateCcw,
  UserPlus,
} from "lucide-react";
import type { CommandItem } from "@/lib/api/command";

interface CommandCardProps {
  item: CommandItem;
  onDismiss?: (id: string) => void | Promise<void>;
  onApprove?: (id: string) => void | Promise<void>;
  onExecute?: (id: string) => void | Promise<void>;
  onComplete?: (id: string) => void | Promise<void>;
  onAssign?: (id: string) => void | Promise<void>;
  onReopen?: (id: string) => void | Promise<void>;
}

const CATEGORY_COLORS: Record<string, string> = {
  MONEY: "hsl(var(--kf-success))",
  TIME: "hsl(var(--kf-accent2))",
  PEOPLE: "hsl(var(--kf-warning))",
  WORK: "hsl(var(--kf-violet-accent))",
  SALES: "hsl(var(--kf-accent1))",
  MARKETING: "hsl(var(--kf-accent1))",
  GOVERNANCE: "hsl(var(--kf-destructive))",
  STRATEGY: "hsl(var(--kf-accent2))",
  SYSTEM: "hsl(var(--kf-muted-foreground))",
};

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  WAITING_APPROVAL: "Needs Approval",
  EXECUTED: "Executed",
  DISMISSED: "Dismissed",
  SNOOZED: "Snoozed",
  FAILED: "Failed",
  COMPLETED: "Completed",
};

export function CommandCard({ item, onDismiss, onApprove, onExecute, onComplete, onAssign, onReopen }: CommandCardProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const color = CATEGORY_COLORS[item.category] ?? "hsl(var(--kf-accent1))";

  const handleAction = async (action: string, handler?: (id: string) => void | Promise<void>) => {
    if (!handler) return;
    setLoading(action);
    try {
      await handler(item.id);
    } finally {
      setLoading(null);
    }
  };

  const isDone = item.status === "COMPLETED" || item.status === "EXECUTED" || item.status === "DISMISSED" || item.status === "SNOOZED";

  return (
    <div
      className="kf-card kf-radius-lg p-4 transition-all hover:shadow-md"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider"
              style={{ background: `${color}15`, color }}
            >
              {item.category}
            </span>
            <span className="kf-text-micro" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
              {STATUS_LABELS[item.status] ?? item.status}
            </span>
            {item.riskTier >= 3 && (
              <span className="flex items-center gap-1 kf-text-micro text-red-500">
                <ShieldAlert className="w-3 h-3" />
                High Risk
              </span>
            )}
          </div>
          <h4 className="font-semibold mt-1 truncate">{item.title}</h4>
          {item.description && (
            <p className="kf-text-caption mt-0.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
              {item.description}
            </p>
          )}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {item.expectedValue != null && (
              <span className="kf-text-micro font-medium" style={{ color: "hsl(var(--kf-success))" }}>
                {item.currency} {item.expectedValue}
              </span>
            )}
            {item.dueAt && (
              <span className="flex items-center gap-1 kf-text-micro" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                <Clock className="w-3 h-3" />
                Due {new Date(item.dueAt).toLocaleDateString()}
              </span>
            )}
            {item.executableByKey && (
              <span className="flex items-center gap-1 kf-text-micro" style={{ color: "hsl(var(--kf-accent1))" }}>
                <Bot className="w-3 h-3" />
                KEY can handle
              </span>
            )}
            {item.ownerType === "USER" && item.ownerId && (
              <span className="flex items-center gap-1 kf-text-micro" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                <User className="w-3 h-3" />
                Assigned
              </span>
            )}
          </div>
        </div>

        {!isDone ? (
          <div className="flex items-center gap-1 flex-shrink-0">
            {onComplete && (
              <button
                onClick={() => handleAction("complete", onComplete)}
                disabled={!!loading}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
              >
                {loading === "complete" ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Done
              </button>
            )}
            {item.requiresApproval && onApprove && (
              <button
                onClick={() => handleAction("approve", onApprove)}
                disabled={!!loading}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
              >
                {loading === "approve" ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Approve
              </button>
            )}
            {item.executableByKey && onExecute && (
              <button
                onClick={() => handleAction("execute", onExecute)}
                disabled={!!loading}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50"
                style={{ background: "hsl(var(--kf-accent1) / 0.1)", color: "hsl(var(--kf-accent1))" }}
              >
                {loading === "execute" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                Execute
              </button>
            )}
            {onAssign && (
              <button
                onClick={() => handleAction("assign", onAssign)}
                disabled={!!loading}
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
                title="Assign"
              >
                {loading === "assign" ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
              </button>
            )}
            <button
              onClick={() => handleAction("dismiss", onDismiss)}
              disabled={!!loading}
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              {loading === "dismiss" ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1 flex-shrink-0">
            {onReopen && (
              <button
                onClick={() => handleAction("reopen", onReopen)}
                disabled={!!loading}
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
                title="Reopen"
              >
                {loading === "reopen" ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
