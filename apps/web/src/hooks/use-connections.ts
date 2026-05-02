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

      type StatusResult = { connected?: boolean; email?: string | null } | null | undefined;
      type CalGmailResp = { data?: StatusResult } | StatusResult;
      const extractStatus = (v: CalGmailResp): StatusResult => {
        if (v && typeof v === "object" && "data" in v && v.data !== undefined) return v.data;
        return v as StatusResult;
      };
      const cal = calRes.status === "fulfilled" ? extractStatus(calRes.value as CalGmailResp) : null;
      const gmail = gmailRes.status === "fulfilled" ? extractStatus(gmailRes.value as CalGmailResp) : null;
      const socialRaw: unknown = socialRes.status === "fulfilled" ? socialRes.value : [];
      const social: SocialConnection[] = Array.isArray(socialRaw)
        ? (socialRaw as SocialConnection[])
        : Array.isArray((socialRaw as { data?: unknown })?.data)
          ? ((socialRaw as { data: SocialConnection[] }).data)
          : [];

      const data: ConnectionsState = {
        calendarConnected: !!cal?.connected,
        calendarEmail: cal?.email ?? null,
        gmailConnected: !!gmail?.connected,
        gmailEmail: gmail?.email ?? null,
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
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
