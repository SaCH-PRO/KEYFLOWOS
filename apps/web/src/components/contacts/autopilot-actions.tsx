"use client";

import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, CheckCircle2, Clock, Eye, Pause, Play,
  Settings, MessageSquare, Gift, DollarSign, Bell,
  Sparkles, ArrowRight, X,
} from "lucide-react";

export interface AutopilotAction {
  id: string;
  type: "follow_up" | "birthday" | "payment_reminder" | "check_in" | "offer";
  status: "completed" | "pending" | "needs_approval";
  contactName: string;
  contactId: string;
  description: string;
  scheduledAt?: string;
  completedAt?: string;
}

interface AutopilotActionsProps {
  actions: AutopilotAction[];
  isPaused?: boolean;
  onTogglePause?: () => void;
  onApprove?: (actionId: string) => Promise<void>;
  onDeny?: (actionId: string) => Promise<void>;
  onViewContact?: (contactId: string) => void;
  onOpenSettings?: () => void;
}

const ACTION_ICONS: Record<AutopilotAction["type"], typeof MessageSquare> = {
  follow_up: MessageSquare,
  birthday: Gift,
  payment_reminder: DollarSign,
  check_in: Bell,
  offer: Gift,
};

const ACTION_LABELS: Record<AutopilotAction["type"], string> = {
  follow_up: "Follow Up",
  birthday: "Birthday",
  payment_reminder: "Payment",
  check_in: "Check In",
  offer: "Offer",
};

const stagger = {
  container: { hidden: {}, visible: { transition: { staggerChildren: 0.04 } } },
  item: { hidden: { opacity: 0, x: -8 }, visible: { opacity: 1, x: 0, transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] } } },
};

const ApprovalCard = React.memo(function ApprovalCard({
  action, approving, onApprove, onDeny, onViewContact,
}: {
  action: AutopilotAction;
  approving: string | null;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  onViewContact: (id: string) => void;
}) {
  const Icon = ACTION_ICONS[action.type];
  const isApproving = approving === action.id;

  return (
    <motion.div
      variants={stagger.item}
      layout
      className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] hover:bg-amber-500/[0.06] transition-all p-3"
    >
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-amber-500/10 shrink-0">
          <Icon className="w-4 h-4 text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <button
              onClick={() => onViewContact(action.contactId)}
              className="text-sm font-semibold hover:text-[hsl(var(--kf-accent1))] transition-colors truncate"
            >
              {action.contactName}
            </button>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400">
              {ACTION_LABELS[action.type]}
            </span>
          </div>
          <p className="text-xs text-muted-foreground/70 leading-relaxed">{action.description}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => onApprove(action.id)}
            disabled={isApproving}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gradient-to-r from-[hsl(var(--kf-accent2))] to-[hsl(var(--kf-accent2))]/80 text-white hover:opacity-90 transition-opacity disabled:opacity-50 shadow-sm"
          >
            {isApproving ? (
              <span className="animate-pulse">...</span>
            ) : (
              <>
                <CheckCircle2 className="w-3 h-3" />
                Approve
              </>
            )}
          </button>
          <button
            onClick={() => onDeny(action.id)}
            className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors"
            aria-label="Skip action"
          >
            <X className="w-4 h-4 text-muted-foreground/50 hover:text-muted-foreground" />
          </button>
        </div>
      </div>
    </motion.div>
  );
});

export const AutopilotActions = React.memo(function AutopilotActions({
  actions, isPaused = false, onTogglePause, onApprove, onDeny, onViewContact, onOpenSettings,
}: AutopilotActionsProps) {
  const [approving, setApproving] = useState<string | null>(null);

  const { completedToday, pending, needsApproval } = useMemo(() => ({
    completedToday: actions.filter((a) => a.status === "completed"),
    pending: actions.filter((a) => a.status === "pending"),
    needsApproval: actions.filter((a) => a.status === "needs_approval"),
  }), [actions]);

  const handleApprove = async (actionId: string) => {
    if (!onApprove) return;
    setApproving(actionId);
    await onApprove(actionId);
    setApproving(null);
  };

  const handleDeny = (actionId: string) => {
    onDeny?.(actionId);
  };

  const handleViewContact = (contactId: string) => {
    onViewContact?.(contactId);
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
            <div className={`p-2 rounded-xl ${
              isPaused
                ? "bg-muted"
                : "bg-gradient-to-br from-[hsl(var(--kf-accent2))]/15 to-[hsl(var(--kf-accent2))]/5"
            }`}>
              <Bot className={`w-4 h-4 ${isPaused ? "text-muted-foreground" : "text-[hsl(var(--kf-accent2))]"}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Autopilot</h3>
                {isPaused && (
                  <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-md bg-muted text-muted-foreground border border-border/50">
                    PAUSED
                  </span>
                )}
                {needsApproval.length > 0 && !isPaused && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-md bg-amber-500/15 text-amber-400 border border-amber-500/20">
                    <Eye className="w-3 h-3" />
                    {needsApproval.length}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                {completedToday.length} done today • {pending.length} scheduled
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={onTogglePause}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold rounded-lg transition-all ${
                isPaused
                  ? "bg-[hsl(var(--kf-accent2))]/15 text-[hsl(var(--kf-accent2))] hover:bg-[hsl(var(--kf-accent2))]/25"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
              }`}
            >
              {isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
              {isPaused ? "Resume" : "Pause"}
            </button>
            <button
              onClick={onOpenSettings}
              className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-muted-foreground hover:bg-white/[0.03] transition-all"
              aria-label="Autopilot settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {needsApproval.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 mb-2">
              <div className="w-1 h-4 rounded-full bg-gradient-to-b from-amber-400 to-amber-500/50" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400/80">Needs Approval</span>
            </div>
            <motion.div
              variants={stagger.container}
              initial="hidden"
              animate="visible"
              className="space-y-2"
            >
              {needsApproval.map((action) => (
                <ApprovalCard
                  key={action.id}
                  action={action}
                  approving={approving}
                  onApprove={handleApprove}
                  onDeny={handleDeny}
                  onViewContact={handleViewContact}
                />
              ))}
            </motion.div>
          </div>
        )}

        {completedToday.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 mb-2">
              <div className="w-1 h-4 rounded-full bg-gradient-to-b from-[hsl(var(--kf-accent2))] to-[hsl(var(--kf-accent2))]/30" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Completed Today</span>
            </div>
            <div className="space-y-1">
              {completedToday.slice(0, 4).map((action) => {
                const Icon = ACTION_ICONS[action.type];
                return (
                  <div
                    key={action.id}
                    className="flex items-center gap-2.5 py-2 px-2.5 rounded-lg hover:bg-white/[0.02] transition-colors group"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))]/60 shrink-0" />
                    <Icon className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                    <span className="text-xs text-muted-foreground/70 flex-1 truncate">{action.description}</span>
                    <button
                      onClick={() => handleViewContact(action.contactId)}
                      className="text-[10px] text-muted-foreground/50 hover:text-[hsl(var(--kf-accent1))] transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                    >
                      {action.contactName}
                    </button>
                    {action.completedAt && (
                      <span className="text-[10px] text-muted-foreground/40 shrink-0">
                        {new Date(action.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </div>
                );
              })}
              {completedToday.length > 4 && (
                <p className="text-[10px] text-muted-foreground/50 text-center py-1">
                  +{completedToday.length - 4} more completed
                </p>
              )}
            </div>
          </div>
        )}

        {pending.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <div className="w-1 h-4 rounded-full bg-gradient-to-b from-blue-400 to-blue-500/30" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Scheduled</span>
            </div>
            <div className="space-y-1">
              {pending.slice(0, 4).map((action) => {
                const Icon = ACTION_ICONS[action.type];
                return (
                  <div
                    key={action.id}
                    className="flex items-center gap-2.5 py-2 px-2.5 rounded-lg hover:bg-white/[0.02] transition-colors"
                  >
                    <Clock className="w-3.5 h-3.5 text-blue-400/50 shrink-0" />
                    <Icon className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                    <span className="text-xs text-muted-foreground/70 flex-1 truncate">{action.description}</span>
                    <button
                      onClick={() => handleViewContact(action.contactId)}
                      className="text-[10px] text-muted-foreground/50 hover:text-[hsl(var(--kf-accent1))] transition-colors shrink-0"
                    >
                      {action.contactName}
                    </button>
                    {action.scheduledAt && (
                      <span className="text-[10px] text-muted-foreground/40 shrink-0">
                        {new Date(action.scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </div>
                );
              })}
              {pending.length > 4 && (
                <p className="text-[10px] text-muted-foreground/50 text-center py-1">
                  +{pending.length - 4} more scheduled
                </p>
              )}
            </div>
          </div>
        )}

        {actions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-10 h-10 rounded-xl bg-white/[0.03] flex items-center justify-center mb-3">
              <Sparkles className="w-5 h-5 text-muted-foreground/50" />
            </div>
            <p className="text-sm font-medium text-foreground/80">Autopilot Ready</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Actions will appear as your pipeline grows</p>
          </div>
        )}
      </div>
    </motion.div>
  );
});
