"use client";

import { useState, useEffect, useRef } from "react";
import { apiGet } from "@/lib/api";
import { fetchCommandItems } from "@/lib/api/command";
import { getStoredBusinessId } from "@/lib/workspace";

export type KeyPresenceState = "idle" | "active" | "processing" | "suggestion";

export function useKeyStatus() {
  const [state, setState] = useState<KeyPresenceState>("idle");
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Listen for explicit state changes from other components
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ state: KeyPresenceState }>).detail;
      if (detail?.state) setState(detail.state);
    };
    window.addEventListener("kf:key-state", handler);
    return () => window.removeEventListener("kf:key-state", handler);
  }, []);

  // Poll for real API state — visibility-aware with idle backoff so an open
  // tab never hammers the API (was a fixed 5s interval on two endpoints).
  useEffect(() => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;

    let delay = 5000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      if (document.hidden) {
        // Tab hidden: do no work, just check again later.
        timer = setTimeout(poll, delay);
        return;
      }
      try {
        const [cmdRes, flowRes] = await Promise.all([
          fetchCommandItems(businessId, { status: "OPEN", limit: 1 }),
          apiGet<Array<{ status: string }>>(`/ai/businesses/${businessId}/flow/sessions`),
        ]);

        const pendingCount = cmdRes.data?.total ?? 0;
        const sessions = Array.isArray(flowRes.data) ? flowRes.data : [];
        const runningFlows = sessions.filter((s) => s.status === "RUNNING").length;

        let next: KeyPresenceState = "idle";
        setState((prev) => {
          if (prev === "active") { next = prev; return prev; }
          if (runningFlows > 0) next = "processing";
          else if (pendingCount > 0) next = "suggestion";
          return next;
        });

        // Back off while quiet (5s → up to 30s), snap back fast when busy.
        delay = next === "idle" ? Math.min(Math.round(delay * 1.5), 30000) : 5000;
      } catch {
        // silently fail — also back off so an error loop can't hammer either
        delay = Math.min(Math.round(delay * 1.5), 30000);
      }
      if (!cancelled) timer = setTimeout(poll, delay);
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Listen for typing activity
  useEffect(() => {
    const handler = () => {
      setState("active");
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => {
        setState((prev) => (prev === "active" ? "idle" : prev));
      }, 1500);
    };
    window.addEventListener("kf:key-typing", handler);
    return () => {
      window.removeEventListener("kf:key-typing", handler);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, []);

  return { state, setState };
}
