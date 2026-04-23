"use client";

import { useState } from "react";
import { Card } from "@keyflow/ui";
import { ArrowUpRight, ArrowDownRight, ChevronDown, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { MetricExplainer } from "@/components/ui/metric-explainer";

export function MetricCard({ label, value, subtext, icon: Icon, color = "text-foreground", trend, trendPct, prevValue, explanation, formula, goodValue }: {
  label: string; value: string; subtext?: string; icon: React.ElementType; color?: string; trend?: "up" | "down" | "neutral";
  trendPct?: number; prevValue?: string;
  explanation?: string; formula?: string; goodValue?: string;
}) {
  const card = (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Card className="p-4 space-y-2 backdrop-blur border-border/60" style={{ background: "hsl(var(--kf-card) / 0.6)" }}>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">{label}</span>
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-2xl font-bold ${color}`}>{value}</span>
          {trendPct != null && (
            <span className={`inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded-full ${
              trendPct > 0
                ? "bg-[hsl(var(--kf-success))]/15 text-[hsl(var(--kf-success))]"
                : trendPct < 0
                  ? "bg-[hsl(var(--kf-error))]/15 text-[hsl(var(--kf-error))]"
                  : "bg-muted text-muted-foreground"
            }`}>
              {trendPct > 0 && <ArrowUpRight className="w-3 h-3" />}
              {trendPct < 0 && <ArrowDownRight className="w-3 h-3" />}
              {trendPct > 0 ? "+" : ""}{trendPct.toFixed(1)}%
            </span>
          )}
        </div>
        {prevValue && (
          <p className="text-[11px] text-muted-foreground/70">Previous: {prevValue}</p>
        )}
        {subtext && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {trend === "up" && <ArrowUpRight className="w-3 h-3" style={{ color: "hsl(var(--kf-success))" }} />}
            {trend === "down" && <ArrowDownRight className="w-3 h-3" style={{ color: "hsl(var(--kf-error))" }} />}
            {subtext}
          </div>
        )}
      </Card>
    </motion.div>
  );

  if (explanation) {
    return <MetricExplainer label={label} explanation={explanation} formula={formula} goodValue={goodValue}>{card}</MetricExplainer>;
  }
  return card;
}

export function DataTable({ headers, rows, emptyText = "No data", emptyState, onRowClick }: {
  headers: string[]; rows: Array<Array<string | React.ReactNode>>; emptyText?: string; emptyState?: React.ReactNode;
  onRowClick?: (rowIndex: number) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/40">
            {headers.map((h, i) => (
              <th key={i} className="text-left py-2 px-3 text-xs text-muted-foreground uppercase tracking-wide font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length} className={emptyState ? "p-0" : "py-4 text-center text-muted-foreground"}>
                {emptyState || emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={i}
                className={`border-b border-border/20 hover:bg-[hsl(var(--kf-muted))]/10 ${onRowClick ? "cursor-pointer" : ""}`}
                onClick={onRowClick ? () => onRowClick(i) : undefined}
              >
                {row.map((cell, j) => (
                  <td key={j} className="py-2.5 px-3">{cell}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function NarrativeSection({ content, title, narrative }: { content?: string; title?: string; narrative?: string }) {
  const text = content || narrative || "";
  const sections = text.split(/\n\n+/).filter(Boolean);
  return (
    <div className="space-y-4">
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      {sections.map((section, i) => {
        const lines = section.split("\n").filter(Boolean);
        return (
          <div key={i} className="space-y-1">
            {lines.map((line, j) => {
              const boldMatch = line.match(/^\*\*(.*?)\*\*(.*)$/);
              if (boldMatch) {
                return (
                  <div key={j}>
                    <h4 className="text-sm font-semibold text-foreground mt-3 mb-1">{boldMatch[1]}</h4>
                    {boldMatch[2] && <p className="text-sm text-muted-foreground leading-relaxed">{boldMatch[2]}</p>}
                  </div>
                );
              }
              if (line.startsWith("- ") || line.startsWith("• ")) {
                return <p key={j} className="text-sm text-muted-foreground leading-relaxed pl-4">- {line.replace(/^[-•]\s*/, "")}</p>;
              }
              if (/^\d+\.\s/.test(line)) {
                return <p key={j} className="text-sm text-muted-foreground leading-relaxed pl-4">{line}</p>;
              }
              return <p key={j} className="text-sm text-muted-foreground leading-relaxed">{line}</p>;
            })}
          </div>
        );
      })}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PAID: "bg-[hsl(var(--kf-success))]/20 text-[hsl(var(--kf-success))]",
    SENT: "bg-[hsl(var(--kf-info))]/20 text-[hsl(var(--kf-info))]",
    DRAFT: "bg-muted/40 text-muted-foreground",
    OVERDUE: "bg-[hsl(var(--kf-error))]/20 text-[hsl(var(--kf-error))]",
    VOID: "bg-muted/30 text-muted-foreground",
    LEAD: "bg-[hsl(var(--kf-warning))]/20 text-[hsl(var(--kf-warning))]",
    CLIENT: "bg-[hsl(var(--kf-success))]/20 text-[hsl(var(--kf-success))]",
    PROSPECT: "bg-[hsl(var(--kf-info))]/20 text-[hsl(var(--kf-info))]",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] || "bg-muted/30 text-muted-foreground"}`}>
      {status}
    </span>
  );
}

export function ProgressBar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "hsl(var(--kf-muted) / 0.3)" }}>
      <motion.div
        className="h-full rounded-full"
        style={{ background: color || "hsl(var(--kf-success))" }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      />
    </div>
  );
}

export function CollapsibleSection({ title, icon: Icon, children, defaultOpen = false, persistKey }: {
  title: string; icon?: React.ElementType; children: React.ReactNode; defaultOpen?: boolean; persistKey?: string;
}) {
  const storageKey = persistKey ? `kf-section-${persistKey}` : null;
  const [open, setOpen] = useState(() => {
    if (storageKey && typeof window !== "undefined") {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) return stored === "1";
    }
    return defaultOpen;
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (storageKey && typeof window !== "undefined") {
      localStorage.setItem(storageKey, next ? "1" : "0");
    }
  };
  return (
    <Card className="backdrop-blur border-border/60 overflow-hidden" style={{ background: "hsl(var(--kf-card) / 0.6)" }}>
      <button
        onClick={toggle}
        className="w-full flex items-center gap-2 p-4 min-h-[44px] text-left hover:bg-[hsl(var(--kf-muted))]/10 transition-colors"
      >
        {Icon && <Icon className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />}
        <h3 className="text-sm font-semibold flex-1">{title}</h3>
        {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
