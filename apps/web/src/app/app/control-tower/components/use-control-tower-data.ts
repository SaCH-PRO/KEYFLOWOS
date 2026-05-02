"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchControlTower,
  fetchBusinessGraph,
  fetchActionQueue,
  type ControlTowerData,
  type ControlTowerPriority,
  type GraphResponse,
  type BusinessGraphSnapshot,
  type ActionQueueItem,
} from "@/lib/client";

export type PriorityAction = {
  key: string;
  toolName: string;
  label: string;
  args: Record<string, unknown>;
  tier: number;
  variant: "primary" | "secondary" | "ai";
};

export type EnrichedPriority = ControlTowerPriority & {
  graphContext?: {
    overdueAmount?: number;
    staleLeadCount?: number;
    overdueTaskCount?: number;
    utilizationRate?: number;
    topClients?: Array<{ id: string; name: string; revenue: number }>;
    outstandingCount?: number;
    budgetUtilization?: number;
  };
  actions: PriorityAction[];
  affectedEntities?: string[];
};

export type ControlTowerState = {
  loading: boolean;
  error: string | null;
  businessId: string;
  data: ControlTowerData | null;
  graph: GraphResponse | null;
  snapshot: BusinessGraphSnapshot | null;
  priorities: EnrichedPriority[];
  actionQueue: ActionQueueItem[];
  refresh: () => void;
  refreshSilent: () => void;
};

const REFRESH_EVENTS = [
  "kf:action.executed",
  "kf:action.blocked",
  "kf:approval.resolved",
  "kf:invoice.paid",
  "kf:invoice.created",
  "kf:booking.created",
  "kf:booking.updated",
  "kf:contact.created",
  "kf:contact.updated",
  "kf:project.updated",
  "kf:expense.created",
  "kf:flow.triggered",
];

function deriveGraphPriorities(snap: BusinessGraphSnapshot): ControlTowerPriority[] {
  const derived: ControlTowerPriority[] = [];
  let idx = 0;

  if (snap.revenue?.overdueCount > 0) {
    derived.push({
      id: `graph-rev-overdue-${idx++}`,
      type: "risk",
      severity: snap.revenue.overdueAmount > 5000 ? "critical" : "warning",
      title: `${snap.revenue.overdueCount} overdue invoice${snap.revenue.overdueCount > 1 ? "s" : ""} — $${snap.revenue.overdueAmount.toFixed(0)} TTD`,
      description: `Outstanding amount: $${snap.revenue.outstandingAmount.toFixed(0)} TTD across ${snap.revenue.outstandingCount} invoices`,
      module: "revenue",
      urgency: Math.min(100, 60 + snap.revenue.overdueCount * 10),
      actionLabel: "View Invoices",
      actionRoute: "/app/commerce",
    });
  }

  if (snap.contacts?.staleLeadCount > 0) {
    derived.push({
      id: `graph-crm-stale-${idx++}`,
      type: "opportunity",
      severity: snap.contacts.staleLeadCount > 10 ? "warning" : "info",
      title: `${snap.contacts.staleLeadCount} stale lead${snap.contacts.staleLeadCount > 1 ? "s" : ""} need follow-up`,
      description: `${snap.contacts.total} total contacts. ${snap.contacts.recentCount} added recently.`,
      module: "crm",
      urgency: Math.min(80, 40 + snap.contacts.staleLeadCount * 3),
      actionLabel: "View Contacts",
      actionRoute: "/app/crm/pipeline",
    });
  }

  if (snap.projects?.overdueTaskCount > 0) {
    derived.push({
      id: `graph-proj-overdue-${idx++}`,
      type: "action",
      severity: snap.projects.overdueTaskCount > 5 ? "critical" : "warning",
      title: `${snap.projects.overdueTaskCount} overdue project task${snap.projects.overdueTaskCount > 1 ? "s" : ""}`,
      description: `${snap.projects.activeCount} active projects, ${(snap.projects.completionRate * 100).toFixed(0)}% completion rate`,
      module: "projects",
      urgency: Math.min(90, 50 + snap.projects.overdueTaskCount * 5),
      actionLabel: "View Projects",
      actionRoute: "/app/projects",
    });
  }

  if (snap.bookings?.utilizationRate < 0.5 && snap.bookings?.upcomingCount < 3) {
    derived.push({
      id: `graph-book-util-${idx++}`,
      type: "opportunity",
      severity: "opportunity",
      title: `Low booking utilization — ${(snap.bookings.utilizationRate * 100).toFixed(0)}%`,
      description: `Only ${snap.bookings.upcomingCount} upcoming bookings. Consider promotions or outreach.`,
      module: "bookings",
      urgency: 35,
      actionLabel: "View Bookings",
      actionRoute: "/app/bookings",
    });
  }

  if (snap.expenses?.budgetUtilization > 0.9) {
    derived.push({
      id: `graph-exp-budget-${idx++}`,
      type: "risk",
      severity: snap.expenses.budgetUtilization > 1 ? "critical" : "warning",
      title: `Budget ${snap.expenses.budgetUtilization > 1 ? "exceeded" : "nearing limit"} — ${(snap.expenses.budgetUtilization * 100).toFixed(0)}%`,
      description: `$${snap.expenses.totalThisMonth.toFixed(0)} TTD spent this month`,
      module: "expenses",
      urgency: snap.expenses.budgetUtilization > 1 ? 85 : 60,
      actionLabel: "View Expenses",
      actionRoute: "/app/expenses",
    });
  }

  return derived;
}

function buildActionSet(p: ControlTowerPriority, _snap: BusinessGraphSnapshot | null): PriorityAction[] {
  const acts: PriorityAction[] = [];

  if (p.type === "approval") {
    acts.push({
      key: "approve",
      toolName: "_navigate",
      label: "Review & Approve",
      args: { route: "/app/control-tower#tower-approvals" },
      tier: 0,
      variant: "primary",
    });
    return acts;
  }

  if (p.module === "revenue") {
    acts.push({
      key: "send_reminder",
      toolName: "draft_payment_reminder",
      label: "Send Reminders",
      args: {},
      tier: 2,
      variant: "primary",
    });
  }

  if (p.module === "crm") {
    acts.push({
      key: "send_followup",
      toolName: "draft_followup_message",
      label: "Draft Follow-ups",
      args: {},
      tier: 1,
      variant: "primary",
    });
  }

  if (p.actionRoute) {
    acts.push({
      key: "view_detail",
      toolName: "_navigate",
      label: p.actionLabel ?? "View Detail",
      args: { route: p.actionRoute },
      tier: 0,
      variant: "secondary",
    });
  }

  acts.push({
    key: "delegate_ai",
    toolName: "create_task",
    label: "Delegate to AI",
    args: { title: `[AI] ${p.title}`, description: p.description, priority: "high", module: p.module },
    tier: 2,
    variant: "ai",
  });

  return acts;
}

function enrichPriorities(
  ctPriorities: ControlTowerPriority[],
  graphPriorities: ControlTowerPriority[],
  snapshot: BusinessGraphSnapshot | null,
  actionItems: ActionQueueItem[],
): EnrichedPriority[] {
  const seenKeys = new Set<string>();
  const merged: ControlTowerPriority[] = [];

  for (const p of graphPriorities) {
    const key = `${p.module}-${p.type}-${p.severity}`;
    seenKeys.add(key);
    merged.push(p);
  }

  for (const p of ctPriorities) {
    const key = `${p.module}-${p.type}-${p.severity}`;
    if (!seenKeys.has(key)) {
      merged.push(p);
    }
  }

  return merged.map((p) => {
    const enriched: EnrichedPriority = {
      ...p,
      actions: buildActionSet(p, snapshot),
    };

    if (snapshot) {
      if (p.module === "revenue") {
        enriched.graphContext = {
          overdueAmount: snapshot.revenue?.overdueAmount,
          outstandingCount: snapshot.revenue?.outstandingCount,
          topClients: snapshot.contacts?.topClients,
        };
      } else if (p.module === "crm") {
        enriched.graphContext = {
          staleLeadCount: snapshot.contacts?.staleLeadCount,
          topClients: snapshot.contacts?.topClients,
        };
      } else if (p.module === "projects") {
        enriched.graphContext = {
          overdueTaskCount: snapshot.projects?.overdueTaskCount,
        };
      } else if (p.module === "bookings") {
        enriched.graphContext = {
          utilizationRate: snapshot.bookings?.utilizationRate,
        };
      } else if (p.module === "expenses") {
        enriched.graphContext = {
          budgetUtilization: snapshot.expenses?.budgetUtilization,
        };
      }
    }

    const matchingActions = actionItems.filter(
      (ai) => ai.module === p.module && ai.affectedEntities?.length > 0,
    );
    if (matchingActions.length > 0) {
      enriched.affectedEntities = matchingActions.flatMap((ai) => ai.affectedEntities);
    }

    return enriched;
  });
}

export function useControlTowerData(): ControlTowerState {
  const businessId = getStoredBusinessId() ?? "";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ControlTowerData | null>(null);
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [actionItems, setActionItems] = useState<ActionQueueItem[]>([]);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!businessId) {
      setLoading(false);
      setError("No business selected");
      return;
    }
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const [ctRes, graphRes, queueRes] = await Promise.all([
        fetchControlTower(businessId),
        fetchBusinessGraph(businessId),
        fetchActionQueue(businessId, undefined, 50),
      ]);
      if (graphRes.data) {
        setGraph(graphRes.data);
      }
      if (ctRes.data) {
        setData(ctRes.data);
      } else if (!graphRes.data && !silent) {
        setError("Failed to load Command Flow data");
      }
      if (queueRes.data) {
        setActionItems(queueRes.data.items ?? []);
      }
    } catch {
      if (!silent) {
        setError("Failed to load Command Flow data");
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const refreshSilent = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      load(true);
    }, 500);
  }, [load]);

  useEffect(() => {
    const handler = () => refreshSilent();
    for (const evt of REFRESH_EVENTS) {
      window.addEventListener(evt, handler);
    }
    return () => {
      for (const evt of REFRESH_EVENTS) {
        window.removeEventListener(evt, handler);
      }
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [refreshSilent]);

  useEffect(() => {
    const interval = setInterval(() => {
      load(true);
    }, 120_000);
    return () => clearInterval(interval);
  }, [load]);

  const snapshot = graph?.snapshot ?? null;
  const graphPriorities = useMemo(
    () => (snapshot ? deriveGraphPriorities(snapshot) : []),
    [snapshot],
  );
  const ctPriorities = data?.priorities ?? [];

  const priorities = useMemo(
    () => enrichPriorities(ctPriorities, graphPriorities, snapshot, actionItems),
    [ctPriorities, graphPriorities, snapshot, actionItems],
  );

  return {
    loading,
    error,
    businessId,
    data,
    graph,
    snapshot,
    priorities,
    actionQueue: actionItems,
    refresh: () => load(false),
    refreshSilent,
  };
}
