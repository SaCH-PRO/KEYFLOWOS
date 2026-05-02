"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ShieldAlert,
  Zap,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Pin,
  PinOff,
  Eye,
  EyeOff,
  Clock,
  Loader2,
  Bot,
  Send,
  ExternalLink,
} from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { executeAction } from "@/lib/client";
import type { EnrichedPriority, PriorityAction } from "./use-control-tower-data";

const TYPE_CONFIG = {
  risk: { icon: ShieldAlert, color: "hsl(var(--kf-error))", bg: "hsl(var(--kf-error) / 0.08)" },
  action: { icon: AlertTriangle, color: "hsl(var(--kf-warning))", bg: "hsl(var(--kf-warning) / 0.08)" },
  approval: { icon: Zap, color: "hsl(var(--kf-info))", bg: "hsl(var(--kf-info) / 0.08)" },
  opportunity: { icon: TrendingUp, color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.08)" },
};

const SEVERITY_DOT: Record<string, string> = {
  critical: "hsl(var(--kf-error))",
  warning: "hsl(var(--kf-warning))",
  info: "hsl(var(--kf-info))",
  opportunity: "hsl(var(--kf-success))",
};

const CONSEQUENCE_MAP: Record<string, (p: EnrichedPriority) => string> = {
  risk: (p) => {
    const amt = p.graphContext?.overdueAmount;
    if (p.module === "revenue" && amt) return `$${amt.toFixed(0)} TTD at risk. Delayed collection increases bad debt risk and weakens cash flow.`;
    if (p.module === "revenue") return "Delayed collection increases bad debt risk and weakens cash flow position.";
    if (p.module === "crm") {
      const count = p.graphContext?.staleLeadCount;
      return count
        ? `${count} leads inactive 30+ days. Response time directly impacts conversion rates.`
        : "Unattended leads decay rapidly — response time directly impacts conversion rates.";
    }
    if (p.module === "projects") {
      const tasks = p.graphContext?.overdueTaskCount;
      return tasks
        ? `${tasks} overdue tasks cascading into client dissatisfaction and potential contract penalties.`
        : "Delivery delays cascade into client dissatisfaction and potential contract penalties.";
    }
    if (p.module === "expenses") {
      const util = p.graphContext?.budgetUtilization;
      return util
        ? `Budget at ${(util * 100).toFixed(0)}% — overspending erodes margins and creates cash flow pressure.`
        : "Budget overruns erode margins and create cash flow pressure.";
    }
    return "Unresolved risks compound over time and affect overall business health.";
  },
  action: (p) => {
    if (p.description.includes("TTD")) return `${p.description} — acting now prevents further financial exposure.`;
    return "Taking action now prevents this from escalating to a higher severity level.";
  },
  approval: () => "AI actions are waiting for your decision. Delayed approvals block automation workflows.",
  opportunity: (p) => {
    if (p.module === "revenue") return "Revenue opportunities have a limited window — early action maximizes conversion.";
    if (p.module === "bookings") {
      const util = p.graphContext?.utilizationRate;
      return util !== undefined
        ? `Only ${(util * 100).toFixed(0)}% capacity used. Promotions or outreach could fill ${((1 - util) * 100).toFixed(0)}% of available slots.`
        : "Opportunities lose value over time. Acting early gives you the best chance of capturing this.";
    }
    return "Opportunities lose value over time. Acting early gives you the best chance of capturing this.";
  },
};

const ACTION_ICONS: Record<string, typeof Send> = {
  send_reminder: Send,
  send_followup: Send,
  view_detail: ExternalLink,
  delegate_ai: Bot,
  approve: Zap,
};

function getPinKey(businessId: string) { return `kf-tower-pinned-${businessId}`; }
function getDismissKey(businessId: string) { return `kf-tower-dismissed-${businessId}`; }
function getSnoozedKey(businessId: string) { return `kf-tower-snoozed-${businessId}`; }

function getPinnedIds(businessId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try { return new Set(JSON.parse(localStorage.getItem(getPinKey(businessId)) ?? "[]")); } catch { return new Set(); }
}
function savePinnedIds(businessId: string, ids: Set<string>) { try { localStorage.setItem(getPinKey(businessId), JSON.stringify([...ids])); } catch {} }

function getDismissedIds(businessId: string): Map<string, string> {
  if (typeof window === "undefined") return new Map();
  try { return new Map(Object.entries(JSON.parse(localStorage.getItem(getDismissKey(businessId)) ?? "{}"))); } catch { return new Map(); }
}
function saveDismissedIds(businessId: string, ids: Map<string, string>) { try { localStorage.setItem(getDismissKey(businessId), JSON.stringify(Object.fromEntries(ids))); } catch {} }

function getSnoozedIds(businessId: string): Map<string, number> {
  if (typeof window === "undefined") return new Map();
  try { return new Map(Object.entries(JSON.parse(localStorage.getItem(getSnoozedKey(businessId)) ?? "{}")).map(([k, v]) => [k, Number(v)])); } catch { return new Map(); }
}
function saveSnoozedIds(businessId: string, ids: Map<string, number>) { try { localStorage.setItem(getSnoozedKey(businessId), JSON.stringify(Object.fromEntries(ids))); } catch {} }

const DISMISS_REASONS = [
  "Already handled",
  "Not relevant",
  "Will address later",
  "Not my responsibility",
];

export function PriorityQueue({
  priorities,
  businessId,
  onActionExecuted,
}: {
  priorities: EnrichedPriority[];
  businessId: string;
  onActionExecuted?: () => void;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Map<string, string>>(new Map());
  const [snoozedIds, setSnoozedIds] = useState<Map<string, number>>(new Map());
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [executingAction, setExecutingAction] = useState<string | null>(null);
  const [dismissPrompt, setDismissPrompt] = useState<string | null>(null);

  useEffect(() => {
    setPinnedIds(getPinnedIds(businessId));
    setDismissedIds(getDismissedIds(businessId));
    const snoozed = getSnoozedIds(businessId);
    const now = Date.now();
    let changed = false;
    for (const [id, until] of snoozed) {
      if (until < now) { snoozed.delete(id); changed = true; }
    }
    if (changed) saveSnoozedIds(businessId, snoozed);
    setSnoozedIds(snoozed);
  }, [businessId]);

  const togglePin = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      savePinnedIds(businessId, next);
      return next;
    });
  }, [businessId]);

  const handleDismiss = useCallback(async (priorityId: string, reason: string) => {
    let apiLogged = false;
    try {
      const res = await executeAction(businessId, "create_task", {
        title: `Dismissed priority: ${priorities.find((p) => p.id === priorityId)?.title ?? priorityId}`,
        description: `Dismiss reason: ${reason}`,
        priority: "low",
        module: priorities.find((p) => p.id === priorityId)?.module ?? "general",
      });
      apiLogged = !!res.data?.success;
    } catch {}

    setDismissedIds((prev) => {
      const next = new Map(prev);
      next.set(priorityId, reason);
      saveDismissedIds(businessId, next);
      return next;
    });
    setDismissPrompt(null);
    setExpandedItem(null);
    toast.success(`Dismissed: ${reason}${apiLogged ? "" : " (logged locally)"}`);
    window.dispatchEvent(new CustomEvent("kf:action.executed"));
    onActionExecuted?.();
  }, [businessId, priorities, onActionExecuted]);

  const handleSnooze = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const until = Date.now() + 2 * 60 * 60 * 1000;
    setSnoozedIds((prev) => {
      const next = new Map(prev);
      next.set(id, until);
      saveSnoozedIds(businessId, next);
      return next;
    });
    toast.success("Snoozed for 2 hours");
  }, [businessId]);

  const handleExecuteAction = useCallback(async (
    p: EnrichedPriority,
    action: PriorityAction,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();

    if (action.toolName === "_navigate") {
      const route = action.args.route as string;
      if (route.includes("#")) {
        const [path, hash] = route.split("#");
        if (path) router.push(path);
        setTimeout(() => {
          const el = document.getElementById(hash);
          if (el) el.scrollIntoView({ behavior: "smooth" });
        }, 200);
      } else {
        router.push(route);
      }
      return;
    }

    const actionKey = `${p.id}-${action.key}`;
    setExecutingAction(actionKey);
    try {
      const res = await executeAction(businessId, action.toolName, action.args);
      if (res.data?.success) {
        toast.success(`${action.label} completed`);
        window.dispatchEvent(new CustomEvent("kf:action.executed"));
        onActionExecuted?.();
      } else if (res.data?.blocked) {
        toast.info(res.data.requiresApproval
          ? "Queued for approval"
          : "Action blocked by governance");
        window.dispatchEvent(new CustomEvent("kf:action.blocked"));
      } else {
        toast.error("Action failed");
      }
    } catch {
      toast.error("Failed to execute action");
    } finally {
      setExecutingAction(null);
    }
  }, [businessId, router, onActionExecuted]);

  const toggleExpand = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedItem((prev) => (prev === id ? null : id));
    setDismissPrompt(null);
  }, []);

  const activePriorities = priorities.filter(
    (p) => !dismissedIds.has(p.id) && !snoozedIds.has(p.id),
  );

  const sorted = [...activePriorities].sort((a, b) => {
    const aPinned = pinnedIds.has(a.id) ? 1 : 0;
    const bPinned = pinnedIds.has(b.id) ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    return b.urgency - a.urgency;
  });

  const visible = expanded ? sorted : sorted.slice(0, 5);
  const hasMore = sorted.length > 5;
  const pinnedCount = sorted.filter((p) => pinnedIds.has(p.id)).length;
  const criticalCount = sorted.filter((p) => p.severity === "critical").length;

  if (activePriorities.length === 0) {
    return (
      <SectionCard title="Daily Priorities" subtitle="Ranked by urgency and impact" icon={Zap}>
        <div className="text-center py-6">
          <p className="text-sm font-medium" style={{ color: "hsl(var(--kf-success))" }}>All clear</p>
          <p className="text-xs mt-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            No urgent priorities right now
          </p>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Daily Priorities"
      subtitle={
        [
          `${activePriorities.length} items`,
          criticalCount > 0 ? `${criticalCount} critical` : null,
          pinnedCount > 0 ? `${pinnedCount} pinned` : null,
        ].filter(Boolean).join(" · ")
      }
      icon={Zap}
    >
      <div className="space-y-1.5">
        <AnimatePresence initial={false}>
          {visible.map((p, i) => {
            const cfg = TYPE_CONFIG[p.type] ?? TYPE_CONFIG.action;
            const Icon = cfg.icon;
            const dotColor = SEVERITY_DOT[p.severity] ?? "hsl(var(--kf-muted-foreground))";
            const isPinned = pinnedIds.has(p.id);
            const isExpanded = expandedItem === p.id;
            const consequenceFn = CONSEQUENCE_MAP[p.type] ?? CONSEQUENCE_MAP.action;
            const consequence = consequenceFn(p);
            const primaryAction = p.actions.find((a) => a.variant === "primary") ?? p.actions[0];
            const showDismissPrompt = dismissPrompt === p.id;

            return (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                transition={{ delay: i * 0.03 }}
                layout
              >
                <div
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all group cursor-pointer hover:scale-[1.005]"
                  style={{
                    background: cfg.bg,
                    border: isPinned ? `1px solid ${cfg.color}40` : `1px solid ${cfg.color}15`,
                    boxShadow: isPinned ? `0 0 0 1px ${cfg.color}20` : undefined,
                    borderRadius: isExpanded ? "12px 12px 0 0" : undefined,
                  }}
                  onClick={(e) => toggleExpand(p.id, e)}
                  role="button"
                  aria-expanded={isExpanded}
                >
                  <button
                    onClick={(e) => togglePin(p.id, e)}
                    className="w-5 h-5 flex items-center justify-center flex-shrink-0 rounded transition-colors min-w-[20px] min-h-[20px]"
                    style={{ background: "transparent" }}
                    aria-label={isPinned ? "Unpin priority" : "Pin priority"}
                    title={isPinned ? "Unpin" : "Pin to top"}
                  >
                    {isPinned ? (
                      <PinOff className="w-3 h-3" style={{ color: "hsl(var(--kf-accent1))" }} />
                    ) : (
                      <Pin className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                    )}
                  </button>
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: `${cfg.color}15` }}
                  >
                    <Icon className="w-3.5 h-3.5" style={{ color: cfg.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate" style={{ color: "hsl(var(--kf-foreground))" }}>
                      {p.title}
                    </p>
                    <p className="text-[10px] truncate" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                      {p.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {primaryAction && (
                      <button
                        onClick={(e) => handleExecuteAction(p, primaryAction, e)}
                        disabled={executingAction === `${p.id}-${primaryAction.key}`}
                        className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-semibold transition-all hover:opacity-80 min-h-[24px]"
                        style={{ background: `${cfg.color}15`, color: cfg.color }}
                        title={primaryAction.label}
                      >
                        {executingAction === `${p.id}-${primaryAction.key}` ? (
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        ) : (
                          (() => {
                            const ActionIcon = ACTION_ICONS[primaryAction.key] ?? ArrowRight;
                            return <ActionIcon className="w-2.5 h-2.5" />;
                          })()
                        )}
                        {primaryAction.label}
                      </button>
                    )}
                    <span
                      className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md"
                      style={{ background: `${dotColor}15`, color: dotColor }}
                    >
                      {p.module}
                    </span>
                    <div className="w-2 h-2 rounded-full" style={{ background: dotColor }} />
                    {isExpanded ? (
                      <ChevronUp className="w-3 h-3" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                    ) : (
                      <ChevronDown className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                    )}
                  </div>
                </div>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div
                        className="px-4 py-3 space-y-2.5 rounded-b-xl"
                        style={{
                          background: `${cfg.color}04`,
                          borderLeft: `1px solid ${cfg.color}15`,
                          borderRight: `1px solid ${cfg.color}15`,
                          borderBottom: `1px solid ${cfg.color}15`,
                        }}
                      >
                        <div className="flex items-start gap-2">
                          <Eye className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--kf-muted-foreground) / 0.5)" }} />
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "hsl(var(--kf-muted-foreground) / 0.6)" }}>
                              Consequence if not addressed
                            </p>
                            <p className="text-[11px] leading-relaxed" style={{ color: "hsl(var(--kf-foreground) / 0.8)" }}>
                              {consequence}
                            </p>
                          </div>
                        </div>

                        {p.graphContext?.topClients && p.graphContext.topClients.length > 0 && (
                          <div className="flex items-start gap-2">
                            <TrendingUp className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--kf-muted-foreground) / 0.5)" }} />
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "hsl(var(--kf-muted-foreground) / 0.6)" }}>
                                Related entities
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {p.graphContext.topClients.slice(0, 3).map((c) => (
                                  <span
                                    key={c.id}
                                    className="text-[9px] px-1.5 py-0.5 rounded-md"
                                    style={{ background: "hsl(var(--kf-muted) / 0.1)", color: "hsl(var(--kf-foreground) / 0.7)" }}
                                  >
                                    {c.name} (${c.revenue.toFixed(0)})
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        {p.affectedEntities && p.affectedEntities.length > 0 && (
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--kf-muted-foreground) / 0.5)" }} />
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "hsl(var(--kf-muted-foreground) / 0.6)" }}>
                                Affected entities
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {p.affectedEntities.slice(0, 5).map((entity, idx) => (
                                  <span
                                    key={idx}
                                    className="text-[9px] px-1.5 py-0.5 rounded-md"
                                    style={{ background: "hsl(var(--kf-muted) / 0.1)", color: "hsl(var(--kf-foreground) / 0.7)" }}
                                  >
                                    {entity}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="flex items-center gap-2 pt-1 flex-wrap">
                          {p.actions.map((action) => {
                            const ActionBtnIcon = ACTION_ICONS[action.key] ?? ArrowRight;
                            const isExec = executingAction === `${p.id}-${action.key}`;
                            const btnBg = action.variant === "primary"
                              ? `${cfg.color}15`
                              : action.variant === "ai"
                                ? "hsl(var(--kf-accent2) / 0.12)"
                                : "hsl(var(--kf-muted) / 0.1)";
                            const btnColor = action.variant === "primary"
                              ? cfg.color
                              : action.variant === "ai"
                                ? "hsl(var(--kf-accent2))"
                                : "hsl(var(--kf-foreground) / 0.8)";
                            return (
                              <button
                                key={action.key}
                                onClick={(e) => handleExecuteAction(p, action, e)}
                                disabled={isExec}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-all hover:opacity-80 min-h-[28px]"
                                style={{ background: btnBg, color: btnColor }}
                              >
                                {isExec ? <Loader2 className="w-3 h-3 animate-spin" /> : <ActionBtnIcon className="w-3 h-3" />}
                                {action.label}
                              </button>
                            );
                          })}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleSnooze(p.id, e); }}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-all hover:opacity-80 min-h-[28px]"
                            style={{ background: "hsl(var(--kf-muted) / 0.1)", color: "hsl(var(--kf-muted-foreground))" }}
                          >
                            <Clock className="w-3 h-3" />
                            Snooze
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setDismissPrompt(showDismissPrompt ? null : p.id); }}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-all hover:opacity-80 min-h-[28px]"
                            style={{ background: "hsl(var(--kf-muted) / 0.1)", color: "hsl(var(--kf-muted-foreground) / 0.7)" }}
                          >
                            <EyeOff className="w-3 h-3" />
                            Dismiss
                          </button>
                        </div>

                        <AnimatePresence>
                          {showDismissPrompt && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div
                                className="rounded-lg p-2.5 space-y-1.5"
                                style={{ background: "hsl(var(--kf-muted) / 0.06)", border: "1px solid hsl(var(--kf-border) / 0.2)" }}
                              >
                                <p className="text-[10px] font-semibold" style={{ color: "hsl(var(--kf-muted-foreground) / 0.6)" }}>
                                  Why are you dismissing this?
                                </p>
                                <div className="flex flex-wrap gap-1">
                                  {DISMISS_REASONS.map((reason) => (
                                    <button
                                      key={reason}
                                      onClick={(e) => { e.stopPropagation(); handleDismiss(p.id, reason); }}
                                      className="px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all hover:opacity-80 min-h-[24px]"
                                      style={{ background: "hsl(var(--kf-muted) / 0.12)", color: "hsl(var(--kf-foreground) / 0.7)" }}
                                    >
                                      {reason}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      {hasMore && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-center gap-1.5 mt-2 py-2 text-[10px] font-medium transition-colors hover:opacity-70 min-h-[36px]"
          style={{ color: "hsl(var(--kf-accent1))" }}
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? "Show less" : `Show ${sorted.length - 5} more`}
        </button>
      )}
    </SectionCard>
  );
}
