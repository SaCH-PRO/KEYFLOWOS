"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  getCalendarStatus,
  getGmailStatus,
  fetchSocialConnections,
  SocialConnection,
} from "@/lib/client";

interface ConnectionsState {
  calendarConnected: boolean;
  calendarEmail: string | null;
  gmailConnected: boolean;
  gmailEmail: string | null;
  socialConnections: SocialConnection[];
  loading: boolean;
}

const cache: { data: ConnectionsState | null; ts: number } = { data: null, ts: 0 };
const CACHE_TTL = 30_000;

export function useConnections() {
  const [state, setState] = useState<ConnectionsState>({
    calendarConnected: false,
    calendarEmail: null,
    gmailConnected: false,
    gmailEmail: null,
    socialConnections: [],
    loading: true,
  });
  const mounted = useRef(true);

  const load = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && cache.data && now - cache.ts < CACHE_TTL) {
      setState({ ...cache.data, loading: false });
      return;
    }

    setState((s) => ({ ...s, loading: true }));
    const businessId = getStoredBusinessId() || undefined;

    try {
      const [calRes, gmailRes, socialRes] = await Promise.allSettled([
        getCalendarStatus(businessId),
        getGmailStatus(businessId),
        businessId ? fetchSocialConnections(businessId) : Promise.resolve([]),
      ]);

      const cal = calRes.status === "fulfilled" ? calRes.value : null;
      const gmail = gmailRes.status === "fulfilled" ? gmailRes.value : null;
      const socialRaw = socialRes.status === "fulfilled" ? socialRes.value : [];
      const socialWrapped = socialRaw as SocialConnection[] | { data?: SocialConnection[] } | null | undefined;
      const social: SocialConnection[] = Array.isArray(socialWrapped)
        ? socialWrapped
        : Array.isArray(socialWrapped?.data)
          ? socialWrapped.data
          : [];

      const calData = (cal && typeof cal === "object" && "data" in cal ? cal.data : cal) as
        | { connected?: boolean; email?: string | null }
        | null
        | undefined;
      const gmailData = (gmail && typeof gmail === "object" && "data" in gmail ? gmail.data : gmail) as
        | { connected?: boolean; email?: string | null }
        | null
        | undefined;

      const data: ConnectionsState = {
        calendarConnected: !!calData?.connected,
        calendarEmail: calData?.email ?? null,
        gmailConnected: !!gmailData?.connected,
        gmailEmail: gmailData?.email ?? null,
        socialConnections: social,
        loading: false,
      };

      cache.data = data;
      cache.ts = Date.now();
      if (mounted.current) setState(data);
    } catch {
      if (mounted.current) setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => { mounted.current = false; };
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  const connectedSocialCount = state.socialConnections.filter(
    (c) => c.status === "CONNECTED"
  ).length;

  return {
    ...state,
    connectedSocialCount,
    refresh,
  };
}
