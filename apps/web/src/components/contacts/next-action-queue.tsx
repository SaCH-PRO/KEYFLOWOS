"use client";

import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap, MessageSquare, FileText, Phone, Mail, DollarSign,
  CheckCircle2, ChevronRight, Sparkles, Timer, ArrowRight,
  AlertCircle,
} from "lucide-react";

export interface NextAction {
  id: string;
  type: "follow_up" | "send_quote" | "call" | "email" | "payment_reminder" | "task";
  contactId: string;
  contactName: string;
  description: string;
  aiDraft?: string;
  estimatedTime: number;
  priority: "urgent" | "high" | "medium" | "low";
  dueDate?: string;
  value?: number;
}

interface NextActionQueueProps {
  actions: NextAction[];
  onComplete: (actionId: string) => Promise<void>;
  onViewContact: (contactId: string) => void;
  onDoAction: (action: NextAction) => void;
}

const ACTION_ICONS: Record<NextAction["type"], typeof MessageSquare> = {
  follow_up: MessageSquare,
  send_quote: FileText,
  call: Phone,
  email: Mail,
  payment_reminder: DollarSign,
  task: CheckCircle2,
};

const ACTION_LABELS: Record<NextAction["type"], string> = {
  follow_up: "Follow Up",
  send_quote: "Send Quote",
  call: "Call",
  email: "Email",
  payment_reminder: "Payment",
  task: "Task",
};

const PRIORITY_STYLES: Record<NextAction["priority"], { bg: string; text: string; border: string; dot: string }> = {
  urgent: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/20", dot: "bg-red-500" },
  high: { bg: "bg-[hsl(var(--kf-accent1))]/10", text: "text-[hsl(var(--kf-accent1))]", border: "border-[hsl(var(--kf-accent1))]/20", dot: "bg-[hsl(var(--kf-accent1))]" },
  medium: { bg: "bg-[hsl(var(--kf-accent2))]/10", text: "text-[hsl(var(--kf-accent2))]", border: "border-[hsl(var(--kf-accent2))]/20", dot: "bg-[hsl(var(--kf-accent2))]" },
  low: { bg: "bg-muted/50", text: "text-muted-foreground", border: "border-border/50", dot: "bg-muted-foreground" },
};

function formatTTD(value: number): string {
  return `TTD ${value.toLocaleString("en-TT", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatDueDate(dateStr: string): { label: string; isOverdue: boolean; isDueSoon: boolean } {
  const now = new Date();
  const due = new Date(dateStr);
  const diffMs = due.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / 86_400_000);

  if (diffDays < 0) return { label: `${Math.abs(diffDays)}d overdue`, isOverdue: true, isDueSoon: false };
  if (diffDays === 0) return { label: "Due today", isOverdue: false, isDueSoon: true };
  if (diffDays === 1) return { label: "Due tomorrow", isOverdue: false, isDueSoon: true };
  if (diffDays <= 3) return { label: `Due in ${diffDays}d`, isOverdue: false, isDueSoon: true };
  return { label: `Due in ${diffDays}d`, isOverdue: false, isDueSoon: false };
}

const stagger = {
  container: { hidden: {}, visible: { transition: { staggerChildren: 0.04 } } },
  item: { hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0, transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] } } },
};

const ActionCard = React.memo(function ActionCard({
  action, completing, onComplete, onViewContact, onDoAction,
}: {
  action: NextAction;
  completing: string | null;
  onComplete: (id: string) => void;
  onViewContact: (id: string) => void;
  onDoAction: (a: NextAction) => void;
}) {
  const Icon = ACTION_ICONS[action.type];
  const style = PRIORITY_STYLES[action.priority];
  const dueInfo = action.dueDate ? formatDueDate(action.dueDate) : null;
  const isCompleting = completing === action.id;

  return (
    <motion.div
      variants={stagger.item}
      layout
      className={`group relative rounded-xl border ${style.border} bg-white/[0.02] hover:bg-white/[0.04] transition-all duration-200`}
    >
      <div className="absolute left-0 top-3 bottom-3 w-1 rounded-full" style={{ background: `var(--tw-gradient-stops)` }}>
        <div className={`w-full h-full rounded-full ${style.dot}`} />
      </div>

      <div className="flex items-start gap-3 p-3 pl-4">
        <div className={`p-2 rounded-lg ${style.bg} shrink-0 mt-0.5`}>
          <Icon className={`w-4 h-4 ${style.text}`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <button
              onClick={() => onViewContact(action.contactId)}
              className="text-sm font-semibold hover:text-[hsl(var(--kf-accent1))] transition-colors truncate"
            >
              {action.contactName}
            </button>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${style.bg} ${style.text}`}>
              {ACTION_LABELS[action.type]}
            </span>
            {action.aiDraft && (
              <span className="flex items-center gap-0.5 text-[10px] font-medium text-[hsl(var(--kf-accent2))]">
                <Sparkles className="w-3 h-3" />
                AI
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground/70 truncate leading-relaxed">{action.description}</p>
          <div className="flex items-center gap-3 mt-1.5">
            {dueInfo && (
              <span className={`text-[10px] font-medium ${
                dueInfo.isOverdue ? "text-red-400" : dueInfo.isDueSoon ? "text-amber-400" : "text-muted-foreground/60"
              }`}>
                {dueInfo.label}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
              <Timer className="w-3 h-3" />
              {action.estimatedTime}m
            </span>
            {action.value != null && action.value > 0 && (
              <span className="text-[10px] font-semibold text-[hsl(var(--kf-accent1))]">
                {formatTTD(action.value)}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 pt-1">
          <button
            onClick={() => onDoAction(action)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gradient-to-r from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent1))]/80 text-white hover:opacity-90 transition-opacity shadow-sm"
          >
            <ArrowRight className="w-3 h-3" />
            Do
          </button>
          <button
            onClick={() => onComplete(action.id)}
            disabled={isCompleting}
            className={`p-1.5 rounded-lg transition-all ${
              isCompleting
                ? "bg-[hsl(var(--kf-accent2))]/20"
                : "hover:bg-[hsl(var(--kf-accent2))]/10"
            }`}
            aria-label="Mark complete"
          >
            <CheckCircle2 className={`w-4 h-4 transition-colors ${
              isCompleting ? "text-[hsl(var(--kf-accent2))] animate-pulse" : "text-muted-foreground/50 group-hover:text-muted-foreground"
            }`} />
          </button>
        </div>
      </div>
    </motion.div>
  );
});

export const NextActionQueue = React.memo(function NextActionQueue({
  actions, onComplete, onViewContact, onDoAction,
}: NextActionQueueProps) {
  const [completing, setCompleting] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const totalTime = useMemo(() => actions.reduce((sum, a) => sum + a.estimatedTime, 0), [actions]);
  const urgentCount = useMemo(() => actions.filter((a) => a.priority === "urgent").length, [actions]);
  const overdueCount = useMemo(() =>
    actions.filter((a) => a.dueDate && new Date(a.dueDate) < new Date()).length,
  [actions]);

  const visibleActions = showAll ? actions : actions.slice(0, 6);

  const handleComplete = async (actionId: string) => {
    setCompleting(actionId);
    await onComplete(actionId);
    setCompleting(null);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="rounded-2xl border border-border/50 bg-card overflow-hidden"
    >
      <div className="p-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))]/15 to-[hsl(var(--kf-accent1))]/5">
              <Zap className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Next Actions</h3>
                {urgentCount > 0 && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-md bg-red-500/15 text-red-400 border border-red-500/20">
                    <AlertCircle className="w-3 h-3" />
                    {urgentCount}
                  </span>
                )}
                {overdueCount > 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-md bg-amber-500/15 text-amber-400 border border-amber-500/20">
                    {overdueCount} overdue
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground/60 flex items-center gap-1.5 mt-0.5">
                <Timer className="w-3 h-3" />
                {totalTime}m total • {actions.length} actions
              </p>
            </div>
          </div>
        </div>

        {actions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-10 h-10 rounded-xl bg-white/[0.03] flex items-center justify-center mb-3">
              <Sparkles className="w-5 h-5 text-[hsl(var(--kf-accent2))]/60" />
            </div>
            <p className="text-sm font-medium text-foreground/80">All caught up!</p>
            <p className="text-xs text-muted-foreground/60 mt-1">No pending actions right now</p>
          </div>
        ) : (
          <motion.div
            variants={stagger.container}
            initial="hidden"
            animate="visible"
            className="space-y-2"
          >
            <AnimatePresence mode="popLayout">
              {visibleActions.map((action) => (
                <ActionCard
                  key={action.id}
                  action={action}
                  completing={completing}
                  onComplete={handleComplete}
                  onViewContact={onViewContact}
                  onDoAction={onDoAction}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}

        {actions.length > 6 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="w-full mt-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 rounded-lg hover:bg-white/[0.03] transition-all"
          >
            {showAll ? "Show less" : `View ${actions.length - 6} more`}
            <ChevronRight className={`w-3 h-3 transition-transform ${showAll ? "rotate-90" : ""}`} />
          </button>
        )}
      </div>
    </motion.div>
  );
});
