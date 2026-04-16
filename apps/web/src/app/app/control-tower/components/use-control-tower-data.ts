"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchControlTower,
  fetchBusinessGraph,
  type ControlTowerData,
  type ControlTowerPriority,
  type GraphResponse,
} from "@/lib/client";

export type ControlTowerState = {
  loading: boolean;
  error: string | null;
  businessId: string;
  data: ControlTowerData | null;
  graph: GraphResponse | null;
  priorities: ControlTowerPriority[];
  refresh: () => void;
  refreshSilent: () => void;
};

const REFRESH_EVENTS = [
  "kf:action.executed",
  "kf:action.blocked",
  "kf:approval.resolved",
];

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

  return {
    loading,
    error,
    businessId,
    data,
    graph,
    priorities: data?.priorities ?? [],
    refresh: () => load(false),
    refreshSilent,
  };
}
