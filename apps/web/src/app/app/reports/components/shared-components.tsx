"use client";

import { Card } from "@keyflow/ui";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { motion } from "framer-motion";

export function MetricCard({ label, value, subtext, icon: Icon, color = "text-white", trend }: {
  label: string; value: string; subtext?: string; icon: React.ElementType; color?: string; trend?: "up" | "down" | "neutral";
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Card className="p-4 space-y-2 bg-slate-950/60 backdrop-blur border-border/60">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">{label}</span>
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
        <div className={`text-2xl font-bold ${color}`}>{value}</div>
        {subtext && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {trend === "up" && <ArrowUpRight className="w-3 h-3 text-emerald-400" />}
            {trend === "down" && <ArrowDownRight className="w-3 h-3 text-red-400" />}
            {subtext}
          </div>
        )}
      </Card>
    </motion.div>
  );
}

export function DataTable({ headers, rows, emptyText = "No data", emptyState }: {
  headers: string[]; rows: Array<Array<string | React.ReactNode>>; emptyText?: string; emptyState?: React.ReactNode;
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
              <tr key={i} className="border-b border-border/20 hover:bg-white/[0.02]">
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

export function NarrativeSection({ content }: { content: string }) {
  const sections = content.split(/\n\n+/).filter(Boolean);
  return (
    <div className="space-y-4">
      {sections.map((section, i) => {
        const lines = section.split("\n").filter(Boolean);
        return (
          <div key={i} className="space-y-1">
            {lines.map((line, j) => {
              const boldMatch = line.match(/^\*\*(.*?)\*\*(.*)$/);
              if (boldMatch) {
                return (
                  <div key={j}>
                    <h4 className="text-sm font-semibold text-white mt-3 mb-1">{boldMatch[1]}</h4>
                    {boldMatch[2] && <p className="text-sm text-muted-foreground leading-relaxed">{boldMatch[2]}</p>}
                  </div>
                );
              }
              if (line.startsWith("- ") || line.startsWith("• ")) {
                return <p key={j} className="text-sm text-muted-foreground leading-relaxed pl-4">• {line.replace(/^[-•]\s*/, "")}</p>;
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
    PAID: "bg-emerald-500/20 text-emerald-300",
    SENT: "bg-blue-500/20 text-blue-300",
    DRAFT: "bg-slate-500/20 text-slate-300",
    OVERDUE: "bg-red-500/20 text-red-300",
    VOID: "bg-slate-600/20 text-slate-400",
    LEAD: "bg-amber-500/20 text-amber-300",
    CLIENT: "bg-emerald-500/20 text-emerald-300",
    PROSPECT: "bg-blue-500/20 text-blue-300",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] || "bg-slate-500/20 text-slate-300"}`}>
      {status}
    </span>
  );
}

export function ProgressBar({ value, max, color = "bg-emerald-400" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
      <motion.div
        className={`h-full rounded-full ${color}`}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      />
    </div>
  );
}
