"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  CheckCircle2,
  Clock,
  AlertCircle,
  Eye,
  Pause,
  Play,
  Settings,
  ChevronDown,
  MessageSquare,
  Gift,
  DollarSign,
  Bell,
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

export function AutopilotActions({
  actions,
  isPaused = false,
  onTogglePause,
  onApprove,
  onDeny,
  onViewContact,
  onOpenSettings,
}: AutopilotActionsProps) {
  const [expanded, setExpanded] = useState(true);
  const [approving, setApproving] = useState<string | null>(null);

  const completedToday = actions.filter((a) => a.status === "completed");
  const pending = actions.filter((a) => a.status === "pending");
  const needsApproval = actions.filter((a) => a.status === "needs_approval");

  const handleApprove = async (actionId: string) => {
    if (!onApprove) return;
    setApproving(actionId);
    await onApprove(actionId);
    setApproving(null);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="kf-card overflow-hidden"
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center justify-between hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${isPaused ? "bg-muted" : "bg-[hsl(var(--kf-accent2))]/10"}`}>
            <Bot className={`w-5 h-5 ${isPaused ? "text-muted-foreground" : "text-[hsl(var(--kf-accent2))]"}`} />
          </div>
          <div className="text-left">
            <div className="font-semibold flex items-center gap-2">
              Autopilot Actions
              {isPaused && (
                <span className="px-2 py-0.5 text-xs rounded-full bg-muted text-muted-foreground">
                  PAUSED
                </span>
              )}
              {needsApproval.length > 0 && !isPaused && (
                <span className="px-2 py-0.5 text-xs rounded-full bg-amber-500/20 text-amber-400">
                  {needsApproval.length} needs approval
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {completedToday.length} completed today • {pending.length} scheduled
            </div>
          </div>
        </div>
        <ChevronDown
          className={`w-5 h-5 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-border"
          >
            <div className="p-4 space-y-3">
              {completedToday.length > 0 && (
                <div className="space-y-2">
                  {completedToday.slice(0, 3).map((action) => {
                    const Icon = ACTION_ICONS[action.type];
                    return (
                      <div
                        key={action.id}
                        className="flex items-center gap-3 p-2 rounded-lg bg-[hsl(var(--kf-accent2))]/5"
                      >
                        <CheckCircle2 className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
                        <Icon className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm flex-1">
                          {action.description} to{" "}
                          <button
                            onClick={() => onViewContact?.(action.contactId)}
                            className="font-medium hover:text-[hsl(var(--kf-accent1))]"
                          >
                            {action.contactName}
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {needsApproval.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-amber-400 flex items-center gap-1">
                    <Eye className="w-3 h-3" />
                    NEEDS APPROVAL
                  </div>
                  {needsApproval.map((action) => {
                    const Icon = ACTION_ICONS[action.type];
                    return (
                      <div
                        key={action.id}
                        className="flex items-center gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30"
                      >
                        <Icon className="w-4 h-4 text-amber-400" />
                        <div className="flex-1">
                          <p className="text-sm">{action.description}</p>
                          <button
                            onClick={() => onViewContact?.(action.contactId)}
                            className="text-xs text-muted-foreground hover:text-[hsl(var(--kf-accent1))]"
                          >
                            {action.contactName}
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleApprove(action.id)}
                            disabled={approving === action.id}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[hsl(var(--kf-accent2))] text-white hover:opacity-90 disabled:opacity-50"
                          >
                            {approving === action.id ? "..." : "Approve"}
                          </button>
                          <button
                            onClick={() => onDeny?.(action.id)}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-muted text-muted-foreground hover:bg-muted/80"
                          >
                            Skip
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {pending.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    SCHEDULED
                  </div>
                  {pending.slice(0, 3).map((action) => {
                    const Icon = ACTION_ICONS[action.type];
                    return (
                      <div
                        key={action.id}
                        className="flex items-center gap-3 p-2 rounded-lg bg-muted/30"
                      >
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <Icon className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground flex-1">
                          {action.description} to {action.contactName}
                        </span>
                        {action.scheduledAt && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(action.scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={onTogglePause}
                  className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    isPaused
                      ? "bg-[hsl(var(--kf-accent2))] text-white hover:opacity-90"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {isPaused ? (
                    <>
                      <Play className="w-3 h-3" />
                      Resume Autopilot
                    </>
                  ) : (
                    <>
                      <Pause className="w-3 h-3" />
                      Pause Autopilot
                    </>
                  )}
                </button>
                <button
                  onClick={onOpenSettings}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
                >
                  <Settings className="w-3 h-3" />
                  Settings
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
