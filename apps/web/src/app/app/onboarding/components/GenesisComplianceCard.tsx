"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Shield, CheckCircle2, Circle, AlertCircle } from "lucide-react";
import type { ComplianceItem, ComplianceItemPriority, ComplianceItemStatus } from "@/lib/blueprint-types";

interface GenesisComplianceCardProps {
  complianceItems: ComplianceItem[];
  title?: string;
  readOnly?: boolean;
}

const STATUS_ORDER: Record<ComplianceItemStatus, number> = {
  NOT_STARTED: 0,
  IN_PROGRESS: 1,
  DONE: 2,
  NOT_APPLICABLE: 3,
};

const PRIORITY_COLOR: Record<ComplianceItemPriority, string> = {
  LOW: "hsl(var(--kf-muted-foreground))",
  MEDIUM: "hsl(var(--kf-info))",
  HIGH: "hsl(var(--kf-warning))",
  CRITICAL: "hsl(var(--kf-error))",
};

const PRIORITY_ORDER: Record<ComplianceItemPriority, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};


export function GenesisComplianceCard({
  complianceItems,
  title = "Compliance checklist",
  readOnly = true,
}: GenesisComplianceCardProps) {
  const [items, setItems] = useState<ComplianceItem[]>(() =>
    [...complianceItems].sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority || "MEDIUM"] ?? 0;
      const pb = PRIORITY_ORDER[b.priority || "MEDIUM"] ?? 0;
      if (pb !== pa) return pb - pa;
      const sa = STATUS_ORDER[a.status || "NOT_STARTED"];
      const sb = STATUS_ORDER[b.status || "NOT_STARTED"];
      return sa - sb;
    }),
  );

  const [notes, setNotes] = useState<Record<string, string>>(() => {
    return Object.fromEntries(items.map((item) => [item.id || "", item.notes || ""]));
  });

  const toggleStatus = (id: string) => {
    if (readOnly) return;
    setItems((prev) =>
      prev.map((item) =>
        (item.id || "") === id
          ? { ...item, status: item.status === "DONE" ? "NOT_STARTED" : "DONE" }
          : item,
      ),
    );
  };

  const doneCount = items.filter((i) => i.status === "DONE" || i.status === "NOT_APPLICABLE").length;
  const progress = items.length ? Math.round((doneCount / items.length) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="kf-card p-4 space-y-4"
      style={{ border: "1px solid hsl(var(--kf-border) / 0.3)" }}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Shield className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
          {title}
        </h3>
        <span className="text-xs font-medium text-muted-foreground">{progress}% complete</span>
      </div>

      <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: "hsl(var(--kf-accent2))" }}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>

      <ul className="space-y-2">
        {items.map((item, index) => {
          const id = item.id || `compliance-${index}`;
          const isDone = item.status === "DONE" || item.status === "NOT_APPLICABLE";
          const priority = item.priority || "MEDIUM";
          return (
            <motion.li
              key={id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className="kf-card-list-row"
            >
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => toggleStatus(id)}
                  disabled={readOnly}
                  className={`mt-0.5 flex-shrink-0 ${readOnly ? "cursor-default" : "cursor-pointer"}`}
                >
                  {isDone ? (
                    <CheckCircle2 className="w-5 h-5" style={{ color: "hsl(var(--kf-success))" }} />
                  ) : (
                    <Circle className="w-5 h-5 text-muted-foreground" />
                  )}
                </button>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className={`text-sm ${isDone ? "line-through text-muted-foreground" : ""}`}>
                      {item.label || "Compliance item"}
                    </span>
                    <span
                      className="flex-shrink-0 flex items-center gap-1 text-[10px] uppercase tracking-wide font-medium"
                      style={{ color: PRIORITY_COLOR[priority] }}
                    >
                      <AlertCircle className="w-3 h-3" />
                      {priority}
                    </span>
                  </div>
                  {item.authority && (
                    <p className="text-xs text-muted-foreground">{item.authority}</p>
                  )}
                  {!readOnly && (
                    <input
                      type="text"
                      value={notes[id] || ""}
                      onChange={(e) =>
                        setNotes((prev) => ({ ...prev, [id]: e.target.value }))
                      }
                      placeholder="Add a note..."
                      className="w-full kf-input text-xs py-1.5"
                    />
                  )}
                </div>
              </div>
            </motion.li>
          );
        })}
      </ul>
    </motion.div>
  );
}

