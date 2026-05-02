"use client";

import type { ReactNode, ElementType } from "react";
import { MoreHorizontal } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { getStatusBadge } from "./commerce-types";
import { formatAmount, formatRelativeDate, getStatusAccentColor, getItemsSummary } from "../utils/commerce-utils";

interface OverflowMenuProps {
  children: ReactNode;
}

export function OverflowMenu({ children }: OverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className="p-1.5 rounded-lg hover:bg-white/[0.08] transition-colors"
        aria-label="More actions"
      >
        <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-xl border border-border/60 bg-popover shadow-xl py-1 animate-in fade-in-0 zoom-in-95"
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function OverflowMenuItem({
  icon: Icon,
  label,
  onClick,
  destructive,
  disabled,
  loading,
}: {
  icon: ElementType;
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
      disabled={disabled}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors disabled:opacity-50 ${
        destructive
          ? "text-red-400 hover:bg-red-500/10"
          : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
      }`}
    >
      <Icon className={`w-3.5 h-3.5 shrink-0 ${loading ? "animate-spin" : ""}`} />
      {label}
    </button>
  );
}

interface ActionCardProps {
  icon: ElementType;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  accentColor?: string;
  loading?: boolean;
}

export function ActionCard({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  accentColor = "hsl(var(--kf-accent1))",
  loading,
}: ActionCardProps) {
  return (
    <div className="rounded-xl border border-border/40 bg-white/[0.02] p-4 hover:bg-white/[0.04] transition-colors">
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: "hsl(var(--kf-accent1) / 0.08)" }}
        >
          <Icon className="w-4 h-4" style={{ color: accentColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
        <button
          onClick={onAction}
          disabled={loading}
          className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors shrink-0 disabled:opacity-50"
          style={{
            backgroundColor: "hsl(var(--kf-accent1) / 0.08)",
            color: accentColor,
          }}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

interface MetricCardProps {
  icon: ElementType;
  label: string;
  value: string;
  trend?: string;
  accentColor?: string;
}

export function MetricCard({
  icon: Icon,
  label,
  value,
  trend,
  accentColor = "hsl(var(--kf-accent1))",
}: MetricCardProps) {
  return (
    <div className="rounded-xl border border-border/40 bg-white/[0.02] p-3 hover:bg-white/[0.04] transition-colors">
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="w-3.5 h-3.5" style={{ color: accentColor }} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          {label}
        </span>
      </div>
      <p className="text-lg font-bold">{value}</p>
      {trend && (
        <p className="text-[10px] text-muted-foreground mt-0.5">{trend}</p>
      )}
    </div>
  );
}

interface RecordRowCardProps {
  type: "invoice" | "quote";
  number: string;
  status: string;
  contact: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
  total: number;
  currency: string;
  items: Array<{ description?: string | null }>;
  date: string;
  dueDate?: string | null;
  badges?: ReactNode;
  smartCTA: ReactNode;
  overflowMenu: ReactNode;
  onClick: () => void;
  selected?: boolean;
  linkedService?: string | null;
  onViewContact?: () => void;
}

export function RecordRowCard({
  type,
  number,
  status,
  contact,
  total,
  currency,
  items,
  date,
  dueDate,
  badges,
  smartCTA,
  overflowMenu,
  onClick,
  selected,
  linkedService,
  onViewContact,
}: RecordRowCardProps) {
  const contactName = contact
    ? `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || contact.email || "\u2014"
    : "\u2014";

  const urgency = (() => {
    if (status === "OVERDUE") return "overdue";
    if (status === "SENT" && dueDate) {
      const daysLeft = Math.ceil((new Date(dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (daysLeft < 0) return "overdue";
      if (daysLeft <= 3) return "due-soon";
    }
    return null;
  })();

  const dueLabel = (() => {
    if (!dueDate) return null;
    const daysLeft = Math.ceil((new Date(dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysLeft < 0) return `${Math.abs(daysLeft)}d overdue`;
    if (daysLeft === 0) return "Due today";
    if (daysLeft <= 7) return `Due in ${daysLeft}d`;
    return null;
  })();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`group relative rounded-xl border cursor-pointer transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring overflow-hidden ${
        selected
          ? "border-[hsl(var(--kf-accent1))]/40 bg-[hsl(var(--kf-accent1))]/[0.04]"
          : "border-border/30 hover:border-border/50 bg-white/[0.015] hover:bg-white/[0.04]"
      }`}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl"
        style={{ backgroundColor: getStatusAccentColor(status) }}
      />

      <div className="pl-4 pr-3 py-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[13px] font-semibold text-foreground leading-tight">
                {number}
              </span>
              {onViewContact && contact ? (
                <button
                  onClick={(e) => { e.stopPropagation(); onViewContact(); }}
                  className="text-[13px] text-foreground/70 truncate hover:text-[hsl(var(--kf-accent1))] hover:underline transition-colors"
                >
                  {contactName}
                </button>
              ) : (
                <span className="text-[13px] text-foreground/70 truncate">{contactName}</span>
              )}
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium border leading-none ${getStatusBadge(status)}`}
              >
                {status}
              </span>
              {urgency === "overdue" && (
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold leading-none" style={{ background: "hsl(var(--kf-error) / 0.12)", color: "hsl(var(--kf-error))" }}>
                  OVERDUE
                </span>
              )}
              {urgency === "due-soon" && (
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold leading-none" style={{ background: "hsl(var(--kf-warning) / 0.12)", color: "hsl(var(--kf-warning))" }}>
                  DUE SOON
                </span>
              )}
              {badges}
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted-foreground/50">
              <span className="truncate">{getItemsSummary(items)}</span>
              <span className="text-muted-foreground/25">&middot;</span>
              <span className="shrink-0">{date ? formatRelativeDate(date) : ""}</span>
              {dueLabel && (
                <>
                  <span className="text-muted-foreground/25">&middot;</span>
                  <span className={`shrink-0 font-medium ${urgency === "overdue" ? "text-red-400" : urgency === "due-soon" ? "text-amber-400" : "text-muted-foreground/50"}`}>
                    {dueLabel}
                  </span>
                </>
              )}
              {linkedService && (
                <>
                  <span className="text-muted-foreground/25">&middot;</span>
                  <span className="truncate" style={{ color: "hsl(var(--kf-accent2))" }}>{linkedService}</span>
                </>
              )}
            </div>
          </div>

          <span className="text-[15px] font-bold text-foreground whitespace-nowrap tracking-tight shrink-0">
            {formatAmount(total, currency)}
          </span>

          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            {smartCTA}
            {overflowMenu}
          </div>
        </div>
      </div>
    </div>
  );
}

interface InsightCardProps {
  icon: ElementType;
  title: string;
  description: string;
  accentColor?: string;
  action?: { label: string; onClick: () => void };
}

export function InsightCard({
  icon: Icon,
  title,
  description,
  accentColor = "hsl(var(--kf-accent1))",
  action,
}: InsightCardProps) {
  return (
    <div
      className="rounded-xl border border-border/40 bg-gradient-to-r from-white/[0.03] to-transparent p-4"
      style={{ borderLeftColor: accentColor, borderLeftWidth: 3 }}
    >
      <div className="flex items-start gap-3">
        <Icon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: accentColor }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
        {action && (
          <button
            onClick={action.onClick}
            className="px-2.5 py-1 text-[11px] font-medium rounded-lg transition-colors shrink-0"
            style={{
              backgroundColor: "hsl(var(--kf-accent1) / 0.08)",
              color: accentColor,
            }}
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
