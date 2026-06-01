"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Workflow,
  Zap,
  Mail,
  MessageSquare,
  CalendarDays,
  FileText,
  Users,
  Banknote,
  ArrowRight,
  Plus,
  Sparkles,
} from "lucide-react";

interface WorkflowNode {
  id: string;
  type: "trigger" | "action" | "condition" | "delay";
  label: string;
  module: string;
  icon: string;
  status: "active" | "paused" | "draft";
}

interface WorkflowEdge {
  from: string;
  to: string;
  label?: string;
}

const MODULE_ICONS: Record<string, React.ElementType> = {
  email: Mail,
  sms: MessageSquare,
  calendar: CalendarDays,
  document: FileText,
  crm: Users,
  finance: Banknote,
  webhook: Zap,
};

const NODE_COLORS = {
  trigger: { bg: "bg-[hsl(var(--kf-accent1))]/10", border: "border-[hsl(var(--kf-accent1))]/30", icon: "text-[hsl(var(--kf-accent1))]" },
  action: { bg: "bg-[hsl(var(--kf-accent2))]/10", border: "border-[hsl(var(--kf-accent2))]/30", icon: "text-[hsl(var(--kf-accent2))]" },
  condition: { bg: "bg-amber-500/10", border: "border-amber-500/30", icon: "text-amber-500" },
  delay: { bg: "bg-muted/20", border: "border-border/40", icon: "text-muted-foreground" },
};

export function VisualWorkflowCanvas() {
  const nodes: WorkflowNode[] = useMemo(() => [
    { id: "1", type: "trigger", label: "New Lead", module: "crm", icon: "users", status: "active" },
    { id: "2", type: "condition", label: "High Value?", module: "crm", icon: "users", status: "active" },
    { id: "3", type: "action", label: "Send Welcome", module: "email", icon: "email", status: "active" },
    { id: "4", type: "delay", label: "Wait 2 days", module: "calendar", icon: "calendar", status: "active" },
    { id: "5", type: "action", label: "Follow-up SMS", module: "sms", icon: "sms", status: "active" },
    { id: "6", type: "condition", label: "Responded?", module: "crm", icon: "users", status: "paused" },
    { id: "7", type: "action", label: "Create Task", module: "crm", icon: "users", status: "draft" },
  ], []);

  const edges: WorkflowEdge[] = useMemo(() => [
    { from: "1", to: "2" },
    { from: "2", to: "3", label: "Yes" },
    { from: "2", to: "4", label: "No" },
    { from: "3", to: "4" },
    { from: "4", to: "5" },
    { from: "5", to: "6" },
    { from: "6", to: "7", label: "No" },
  ], []);

  return (
    <div className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Workflow className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
          Visual Workflow Builder
        </h3>
        <span className="text-[10px] text-muted-foreground">Preview — Coming Soon</span>
      </div>

      <div className="relative overflow-x-auto pb-4">
        <div className="flex items-center gap-3 min-w-max px-2">
          {nodes.map((node, i) => {
            const colors = NODE_COLORS[node.type];
            const Icon = MODULE_ICONS[node.icon] || Zap;
            const statusDot = {
              active: "bg-emerald-500",
              paused: "bg-amber-500",
              draft: "bg-muted-foreground",
            }[node.status];

            return (
              <div key={node.id} className="flex items-center gap-3">
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.1, duration: 0.3 }}
                  className={`relative rounded-xl border ${colors.border} ${colors.bg} p-3 min-w-[140px] hover:shadow-md transition-all cursor-pointer`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className={`w-6 h-6 rounded-md bg-background/60 flex items-center justify-center`}>
                      <Icon className={`w-3 h-3 ${colors.icon}`} />
                    </div>
                    <div className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
                  </div>
                  <div className="text-xs font-medium text-foreground">{node.label}</div>
                  <div className="text-[10px] text-muted-foreground capitalize">{node.module}</div>
                </motion.div>

                {i < nodes.length - 1 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.1 + 0.15 }}
                    className="flex items-center"
                  >
                    <ArrowRight className="w-4 h-4 text-muted-foreground/40" />
                  </motion.div>
                )}
              </div>
            );
          })}

          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: nodes.length * 0.1 }}
            className="rounded-xl border border-dashed border-border/40 bg-card/20 p-3 min-w-[100px] flex flex-col items-center justify-center gap-1 hover:bg-card/40 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">Add Step</span>
          </motion.button>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/20">
        <Sparkles className="w-3 h-3 text-[hsl(var(--kf-accent1))]" />
        <span className="text-[11px] text-muted-foreground">
          AI Suggestion: Add a "Payment Reminder" step after "Follow-up SMS" to reduce overdue invoices by 34%.
        </span>
      </div>
    </div>
  );
}
