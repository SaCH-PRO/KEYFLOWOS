"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchControlTower,
  fetchBusinessGraph,
  type ControlTowerData,
  type ControlTowerPriority,
  type GraphResponse,
  type BusinessGraphSnapshot,
} from "@/lib/client";

export type EnrichedPriority = ControlTowerPriority & {
  graphContext?: {
    overdueAmount?: number;
    staleLeadCount?: number;
    overdueTaskCount?: number;
    utilizationRate?: number;
    topClients?: Array<{ id: string; name: string; revenue: number }>;
  };
  suggestedAction?: {
    toolName: string;
    label: string;
    args: Record<string, unknown>;
    tier: number;
  };
};

export type ControlTowerState = {
  loading: boolean;
  error: string | null;
  businessId: string;
  data: ControlTowerData | null;
  graph: GraphResponse | null;
  snapshot: BusinessGraphSnapshot | null;
  priorities: EnrichedPriority[];
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

function enrichPriorities(
  priorities: ControlTowerPriority[],
  snapshot: BusinessGraphSnapshot | null,
): EnrichedPriority[] {
  return priorities.map((p) => {
    const enriched: EnrichedPriority = { ...p };

    if (snapshot) {
      if (p.module === "revenue") {
        enriched.graphContext = {
          overdueAmount: snapshot.revenue?.overdueAmount,
          topClients: snapshot.contacts?.topClients,
        };
        if (p.type === "action" && p.title.toLowerCase().includes("overdue")) {
          enriched.suggestedAction = {
            toolName: "draft_payment_reminder",
            label: "Send Reminders",
            args: {},
            tier: 2,
          };
        }
      } else if (p.module === "crm") {
        enriched.graphContext = {
          staleLeadCount: snapshot.contacts?.staleLeadCount,
          topClients: snapshot.contacts?.topClients,
        };
        if (p.type === "opportunity" && p.title.toLowerCase().includes("stale")) {
          enriched.suggestedAction = {
            toolName: "draft_followup_message",
            label: "Draft Follow-ups",
            args: {},
            tier: 1,
          };
        }
      } else if (p.module === "projects") {
        enriched.graphContext = {
          overdueTaskCount: snapshot.projects?.overdueTaskCount,
        };
      } else if (p.module === "bookings") {
        enriched.graphContext = {
          utilizationRate: snapshot.bookings?.utilizationRate,
        };
      }
    }

    if (p.type === "approval") {
      enriched.suggestedAction = {
        toolName: "_approve",
        label: "Review & Approve",
        args: {},
        tier: 0,
      };
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
      const [ctRes, graphRes] = await Promise.all([
        fetchControlTower(businessId),
        fetchBusinessGraph(businessId),
      ]);
      if (ctRes.data) {
        setData(ctRes.data);
      } else if (!silent) {
        setError("Failed to load Control Tower data");
      }
      if (graphRes.data) {
        setGraph(graphRes.data);
      }
    } catch {
      if (!silent) {
        setError("Failed to load Control Tower data");
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
  const rawPriorities = data?.priorities ?? [];
  const enrichedPriorities = enrichPriorities(rawPriorities, snapshot);

  return {
    loading,
    error,
    businessId,
    data,
    graph,
    snapshot,
    priorities: enrichedPriorities,
    refresh: () => load(false),
    refreshSilent,
  };
}
