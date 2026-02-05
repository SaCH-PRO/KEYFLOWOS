"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap,
  MessageSquare,
  FileText,
  Phone,
  Mail,
  DollarSign,
  Clock,
  CheckCircle2,
  ChevronRight,
  Sparkles,
  Timer,
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

const PRIORITY_COLORS: Record<NextAction["priority"], string> = {
  urgent: "hsl(0 84% 60%)",
  high: "hsl(var(--kf-accent1))",
  medium: "hsl(var(--kf-accent2))",
  low: "hsl(var(--kf-muted-foreground))",
};

export function NextActionQueue({ actions, onComplete, onViewContact, onDoAction }: NextActionQueueProps) {
  const [completing, setCompleting] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  const totalTime = actions.reduce((sum, a) => sum + a.estimatedTime, 0);
  const urgentCount = actions.filter((a) => a.priority === "urgent").length;

  const handleComplete = async (actionId: string) => {
    setCompleting(actionId);
    await onComplete(actionId);
    setCompleting(null);
  };

  if (actions.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="kf-card p-5"
      >
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-full bg-[hsl(var(--kf-accent2))]/10">
            <Sparkles className="w-6 h-6 text-[hsl(var(--kf-accent2))]" />
          </div>
          <div>
            <h3 className="font-semibold">All caught up!</h3>
            <p className="text-sm text-muted-foreground">No urgent actions needed right now</p>
          </div>
        </div>
      </motion.div>
    );
  }

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
          <div className="p-2 rounded-lg bg-[hsl(var(--kf-accent1))]/10">
            <Zap className="w-5 h-5 text-[hsl(var(--kf-accent1))]" />
          </div>
          <div className="text-left">
            <div className="font-semibold flex items-center gap-2">
              Your Next Actions
              {urgentCount > 0 && (
                <span className="px-2 py-0.5 text-xs rounded-full bg-red-500/20 text-red-400">
                  {urgentCount} urgent
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Timer className="w-3 h-3" />
              {totalTime} min total • {actions.length} actions
            </div>
          </div>
        </div>
        <ChevronRight
          className={`w-5 h-5 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
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
            <div className="p-4 space-y-2">
              {actions.slice(0, 5).map((action, index) => {
                const Icon = ACTION_ICONS[action.type];
                const priorityColor = PRIORITY_COLORS[action.priority];

                return (
                  <motion.div
                    key={action.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 border border-border/50 group hover:bg-muted/50 transition-colors"
                  >
                    <div
                      className="p-2 rounded-lg flex-shrink-0"
                      style={{ background: `${priorityColor}20` }}
                    >
                      <Icon className="w-4 h-4" style={{ color: priorityColor }} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onViewContact(action.contactId)}
                          className="font-medium text-sm hover:text-[hsl(var(--kf-accent1))] transition-colors truncate"
                        >
                          {action.contactName}
                        </button>
                        <span className="text-xs text-muted-foreground">({action.estimatedTime}s)</span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{action.description}</p>
                      {action.aiDraft && (
                        <div className="mt-1 flex items-center gap-1 text-xs text-[hsl(var(--kf-accent2))]">
                          <Sparkles className="w-3 h-3" />
                          AI draft ready
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {action.value && (
                        <span className="text-xs font-medium text-[hsl(var(--kf-accent1))]">
                          TTD {action.value.toLocaleString()}
                        </span>
                      )}
                      <button
                        onClick={() => onDoAction(action)}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity"
                      >
                        DO
                      </button>
                      <button
                        onClick={() => handleComplete(action.id)}
                        disabled={completing === action.id}
                        className="p-1.5 rounded-lg hover:bg-[hsl(var(--kf-accent2))]/20 transition-colors"
                      >
                        <CheckCircle2
                          className={`w-4 h-4 ${completing === action.id ? "text-[hsl(var(--kf-accent2))] animate-pulse" : "text-muted-foreground"}`}
                        />
                      </button>
                    </div>
                  </motion.div>
                );
              })}

              {actions.length > 5 && (
                <button className="w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                  View {actions.length - 5} more actions
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
