"use client";

import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Send,
  ArrowRight,
  CheckCircle2,
  MessageSquare,
  Calendar,
  DollarSign,
  Bell,
} from "lucide-react";
import type { EnrichedPriority } from "../../control-tower/components/use-control-tower-data";

const ACTION_ICONS = [
  { icon: DollarSign, color: "#F97316" },
  { icon: MessageSquare, color: "#14B8A6" },
  { icon: Calendar, color: "#8B5CF6" },
  { icon: Bell, color: "#F59E0B" },
];

function getActionMeta(index: number) {
  return ACTION_ICONS[index % ACTION_ICONS.length];
}

function getPreparedLabel(priority: EnrichedPriority): string {
  if (priority.module === "revenue" && priority.title.toLowerCase().includes("overdue")) {
    return "Payment reminder drafted";
  }
  if (priority.module === "crm" && priority.title.toLowerCase().includes("stale")) {
    return "Follow-up message drafted";
  }
  if (priority.module === "bookings") {
    return "Booking confirmation prepared";
  }
  if (priority.type === "approval") {
    return "Action queued for review";
  }
  return "Action prepared by KEY";
}

interface CockpitKeyPanelProps {
  businessId: string;
  priorities: EnrichedPriority[];
  pendingApprovals: number;
  onActionExecuted?: () => void;
}

export function CockpitKeyPanel({
  priorities,
  pendingApprovals,
}: CockpitKeyPanelProps) {
  const router = useRouter();

  const preparedActions = priorities.slice(0, 4);

  return (
    <div className="space-y-4">
      {/* KEY Card */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="rounded-xl border border-[hsl(var(--kf-border))] bg-gradient-to-b from-[hsl(var(--kf-card))] to-[hsl(var(--kf-muted)/0.2)] overflow-hidden"
      >
        {/* Header */}
        <div className="p-4 border-b border-[hsl(var(--kf-border))] flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[hsl(var(--kf-accent1))]/10 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">KEY</h3>
            <p className="text-[10px] text-muted-foreground">
              Your calm command partner
            </p>
          </div>
        </div>

        <div className="p-4 space-y-5">
          {/* Context message */}
          <p className="text-sm text-muted-foreground leading-relaxed">
            I&apos;ve organized these actions to help you save time, collect
            more, and keep clients happy.
          </p>

          {/* KEY Prepared */}
          {preparedActions.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">KEY Prepared</span>
                <span className="text-[10px] text-muted-foreground">
                  {preparedActions.length} ready for review
                </span>
              </div>
              <div className="space-y-2">
                {preparedActions.map((action, i) => {
                  const meta = getActionMeta(i);
                  const preparedLabel = getPreparedLabel(action);
                  return (
                    <motion.div
                      key={action.id}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.4 + i * 0.08 }}
                      className="flex items-start gap-2.5 p-2.5 rounded-lg bg-[hsl(var(--kf-background))] border border-[hsl(var(--kf-border))] hover:border-[hsl(var(--kf-border)/1.5)] transition-colors group cursor-pointer"
                      onClick={() => {
                        const primaryAction = action.actions.find(
                          (a) => a.variant === "primary"
                        );
                        if (primaryAction?.toolName === "_navigate") {
                          router.push(primaryAction.args.route as string);
                        }
                      }}
                    >
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                        style={{ background: `${meta.color}15` }}
                      >
                        <meta.icon
                          className="w-3.5 h-3.5"
                          style={{ color: meta.color }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">
                          {action.title}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {preparedLabel}
                        </p>
                      </div>
                      <ArrowRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity shrink-0 mt-1.5" />
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Review & Approve */}
          <AnimatePresence>
            {pendingApprovals > 0 && (
              <motion.button
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                onClick={() => router.push("/app/keyflow-command")}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gradient-to-r from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] text-white text-sm font-medium hover:opacity-90 transition-opacity"
              >
                <CheckCircle2 className="w-4 h-4" />
                Review & Approve ({pendingApprovals})
              </motion.button>
            )}
          </AnimatePresence>

          {/* Ask KEY input */}
          <div className="relative">
            <input
              type="text"
              placeholder="Ask KEY anything..."
              className="w-full pl-3 pr-10 py-2.5 rounded-lg bg-[hsl(var(--kf-background))] border border-[hsl(var(--kf-border))] text-sm placeholder:text-muted-foreground focus:outline-none focus:border-[hsl(var(--kf-accent1))]/30 transition-colors"
              onFocus={() =>
                window.dispatchEvent(
                  new CustomEvent("kf:open-key", { detail: { mode: "chat" } })
                )
              }
              readOnly
            />
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-[hsl(var(--kf-accent1))] text-white hover:brightness-110 transition-all"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("kf:open-key", { detail: { mode: "chat" } })
                )
              }
            >
              <Send className="w-3 h-3" />
            </button>
          </div>

          {/* Suggestion chips */}
          <div className="flex flex-wrap gap-1.5">
            {[
              "What should I focus on?",
              "Why is cash slow?",
              "Fill my calendar",
            ].map((chip) => (
              <button
                key={chip}
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("kf:open-key", {
                      detail: { mode: "chat", message: chip },
                    })
                  )
                }
                className="px-2.5 py-1 rounded-full text-[10px] bg-[hsl(var(--kf-muted))] text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--kf-muted-foreground)/0.1)] transition-colors"
              >
                {chip}
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Activity Feed */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5, delay: 0.4 }}
        className="rounded-xl border border-[hsl(var(--kf-border))] p-4"
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold">Activity Feed</h3>
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[hsl(var(--kf-success))] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[hsl(var(--kf-success))]" />
          </span>
        </div>
        <div className="space-y-3">
          {preparedActions.length > 0 ? (
            preparedActions.slice(0, 4).map((action, i) => {
              const times = ["Just now", "3m ago", "12m ago", "18m ago"];
              return (
                <div key={action.id} className="flex items-start gap-2.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--kf-accent1))] mt-1.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs truncate">{action.title}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {times[i] ?? `${(i + 1) * 5}m ago`}
                    </p>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="py-4 text-center">
              <p className="text-xs text-muted-foreground">No recent activity</p>
            </div>
          )}
        </div>
        <button
          onClick={() => router.push("/app/inbox")}
          className="w-full mt-3 text-center text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          View all activity →
        </button>
      </motion.div>
    </div>
  );
}
