"use client";

import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Pencil,
  Sparkles,
  ToggleRight,
  Zap,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { LeadForm } from "@/lib/client";

interface FormOptimizationQueueProps {
  forms: LeadForm[];
  onAiOptimize: () => void;
  onEdit: (form: LeadForm) => void;
  onToggle: (form: LeadForm) => void;
}

interface QueueSection {
  key: string;
  label: string;
  color: string;
  colorBg: string;
  items: { form: LeadForm; description: string }[];
  actionLabel: string;
  actionIcon: React.ElementType;
  onAction: (form: LeadForm) => void;
}

export const FormOptimizationQueue = React.memo(function FormOptimizationQueue({
  forms,
  onAiOptimize,
  onEdit,
  onToggle,
}: FormOptimizationQueueProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const queues = useMemo<QueueSection[]>(() => {
    const inactiveForms = forms.filter((f) => !f.isActive);

    const missingFields = forms.filter(
      (f) => f.isActive && f.fields.length < 3
    );

    const noSubmissions = forms.filter(
      (f) => f.isActive && (f._count?.submissions ?? 0) === 0
    );

    const sections: QueueSection[] = [];

    if (inactiveForms.length > 0) {
      sections.push({
        key: "inactive",
        label: "Inactive Forms",
        color: "#94a3b8",
        colorBg: "#94a3b820",
        items: inactiveForms.map((f) => ({
          form: f,
          description: "Form is currently disabled",
        })),
        actionLabel: "Activate",
        actionIcon: ToggleRight,
        onAction: (f) => onToggle(f),
      });
    }

    if (missingFields.length > 0) {
      sections.push({
        key: "fields",
        label: "Missing Fields",
        color: "#f59e0b",
        colorBg: "#f59e0b20",
        items: missingFields.map((f) => ({
          form: f,
          description: `Only ${f.fields.length} field${f.fields.length === 1 ? "" : "s"} — add more to capture better leads`,
        })),
        actionLabel: "Edit",
        actionIcon: Pencil,
        onAction: (f) => onEdit(f),
      });
    }

    if (noSubmissions.length > 0) {
      sections.push({
        key: "submissions",
        label: "No Submissions",
        color: "#ef4444",
        colorBg: "#ef444420",
        items: noSubmissions.map((f) => ({
          form: f,
          description: "No submissions received yet",
        })),
        actionLabel: "Optimize",
        actionIcon: Sparkles,
        onAction: () => onAiOptimize(),
      });
    }

    return sections;
  }, [forms, onAiOptimize, onEdit, onToggle]);

  if (queues.length === 0) return null;

  const toggleSection = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="kf-card border border-border/40 rounded-xl overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2 border-b border-border/20">
        <Zap className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
        <span className="text-sm font-semibold">Form Optimization</span>
        <span
          className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{
            background: "hsl(var(--kf-accent2) / 0.15)",
            color: "hsl(var(--kf-accent2))",
          }}
        >
          {queues.reduce((sum, q) => sum + q.items.length, 0)}
        </span>
      </div>

      <div className="divide-y divide-border/20">
        {queues.map((queue) => {
          const isOpen = expanded[queue.key] !== false;
          return (
            <div key={queue.key}>
              <button
                onClick={() => toggleSection(queue.key)}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-medium hover:bg-muted/30 transition-colors"
              >
                {isOpen ? (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                )}
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: queue.color }}
                />
                <span>{queue.label}</span>
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-auto"
                  style={{ background: queue.colorBg, color: queue.color }}
                >
                  {queue.items.length}
                </span>
              </button>

              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-3 space-y-1.5">
                      {queue.items.map(({ form, description }) => (
                        <div
                          key={form.id}
                          className="flex items-center gap-3 bg-muted/20 rounded-lg px-3 py-2"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">
                              {form.name}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {description}
                            </p>
                          </div>
                          <button
                            onClick={() => queue.onAction(form)}
                            className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg transition-colors shrink-0"
                            style={{
                              background: queue.colorBg,
                              color: queue.color,
                            }}
                          >
                            <queue.actionIcon className="w-3 h-3" />
                            {queue.actionLabel}
                          </button>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
});
