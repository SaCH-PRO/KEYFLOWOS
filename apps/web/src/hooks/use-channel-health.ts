"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  listChannelConnections,
  listChannelDestinations,
  getChannelHealthSummary,
  runChannelHealthCheck,
  fetchSocialConnections,
  fetchOAuthAvailability,
} from "@/lib/client";
import type {
  ChannelConnection,
  ChannelDestination,
  HealthSummary,
  SocialConnection,
} from "@/lib/client";

export type HealthState = "Connected" | "NeedsRefresh" | "Expired" | "MissingPermission" | "DestinationMissing" | "Disabled" | "Error";

export type EnrichedConnection = ChannelConnection & {
  healthState: HealthState;
  healthMessage: string | null;
  lastCheckedAt: string | null;
  enrichedDestinations: ChannelDestination[];
};

export type ChannelHealthData = {
  connections: EnrichedConnection[];
  destinations: ChannelDestination[];
  socialConnections: SocialConnection[];
  summary: HealthSummary | null;
  oauthAvailability: Record<string, boolean>;
  loading: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
  runHealthCheckForConnection: (connectionId: string) => Promise<void>;
  getHealthColor: (state: string) => string;
  getHealthLabel: (state: string) => string;
};

const HEALTH_COLORS: Record<string, string> = {
  Connected: "text-emerald-400",
  NeedsRefresh: "text-amber-400",
  Expired: "text-red-400",
  MissingPermission: "text-red-400",
  DestinationMissing: "text-amber-400",
  Disabled: "text-muted-foreground",
  Error: "text-red-400",
};

const HEALTH_BG_COLORS: Record<string, string> = {
  Connected: "bg-emerald-400",
  NeedsRefresh: "bg-amber-400",
  Expired: "bg-red-400",
  MissingPermission: "bg-red-400",
  DestinationMissing: "bg-amber-400",
  Disabled: "bg-muted-foreground",
  Error: "bg-red-400",
};

const HEALTH_LABELS: Record<string, string> = {
  Connected: "Connected",
  NeedsRefresh: "Needs Refresh",
  Expired: "Expired",
  MissingPermission: "Missing Permission",
  DestinationMissing: "No Destinations",
  Disabled: "Disabled",
  Error: "Error",
};

export function useChannelHealth(businessId: string | null): ChannelHealthData {
  const [connections, setConnections] = useState<ChannelConnection[]>([]);
  const [destinations, setDestinations] = useState<ChannelDestination[]>([]);
  const [socialConnections, setSocialConnections] = useState<SocialConnection[]>([]);
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [oauthAvailability, setOauthAvailability] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    try {
      const [connRes, destRes, summRes, socialRes, oauthRes] = await Promise.all([
        listChannelConnections(businessId).catch(() => ({ data: null, error: "failed" })),
        listChannelDestinations(businessId).catch(() => ({ data: null, error: "failed" })),
        getChannelHealthSummary(businessId).catch(() => ({ data: null, error: "failed" })),
        fetchSocialConnections(businessId).catch(() => ({ data: null, error: "failed" })),
        fetchOAuthAvailability(businessId).catch(() => ({ data: null, error: "failed" })),
      ]);
      if (connRes.data) setConnections(Array.isArray(connRes.data) ? connRes.data : []);
      if (destRes.data) setDestinations(Array.isArray(destRes.data) ? destRes.data : []);
      if (summRes.data) setSummary(summRes.data);
      if (socialRes.data) setSocialConnections(Array.isArray(socialRes.data) ? socialRes.data : []);
      if (oauthRes.data && typeof oauthRes.data === "object") setOauthAvailability(oauthRes.data as Record<string, boolean>);
    } catch {
      // silently handle
    }
    setLoading(false);
  }, [businessId]);

  const runHealthCheckForConnection = useCallback(async (connectionId: string) => {
    if (!businessId) return;
    await runChannelHealthCheck(connectionId, businessId);
    await loadData();
  }, [businessId, loadData]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadData();
      if (cancelled || !businessId) return;
      const connRes = await listChannelConnections(businessId).catch(() => ({ data: null, error: "failed" }));
      const connList = Array.isArray(connRes.data) ? connRes.data : [];
      if (connList.length > 0 && !cancelled) {
        await Promise.allSettled(connList.map((c) => runChannelHealthCheck(c.id, businessId).catch(() => {})));
        if (!cancelled) await loadData();
      }
    })();
    return () => { cancelled = true; };
  }, [loadData, businessId]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const enrichedConnections = useMemo<EnrichedConnection[]>(() => {
    return connections.map((conn) => {
      const connDests = destinations.filter((d) => d.connectionId === conn.id);
      const summaryConn = summary?.connections.find((c) => c.id === conn.id);
      return {
        ...conn,
        healthState: (summaryConn?.healthState || conn.healthState || "Connected") as HealthState,
        healthMessage: summaryConn?.healthMessage || conn.healthMessage || null,
        lastCheckedAt: summaryConn?.lastCheckedAt || conn.lastCheckedAt || null,
        enrichedDestinations: connDests,
      };
    });
  }, [connections, destinations, summary]);

  const getHealthColor = useCallback((state: string) => HEALTH_COLORS[state] || "text-muted-foreground", []);
  const getHealthLabel = useCallback((state: string) => HEALTH_LABELS[state] || state, []);

  return {
    connections: enrichedConnections,
    destinations,
    socialConnections,
    summary,
    oauthAvailability,
    loading,
    refreshing,
    refresh,
    runHealthCheckForConnection,
    getHealthColor,
    getHealthLabel,
  };
}

export { HEALTH_COLORS, HEALTH_BG_COLORS, HEALTH_LABELS };
