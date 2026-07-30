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

  // Poll for real API state
  useEffect(() => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;

    const poll = async () => {
      try {
        const [cmdRes, flowRes] = await Promise.all([
          fetchCommandItems(businessId, { status: "OPEN", limit: 1 }),
          apiGet<Array<{ status: string }>>(`/ai/businesses/${businessId}/flow/sessions`),
        ]);

        const pendingCount = cmdRes.data?.total ?? 0;
        const sessions = Array.isArray(flowRes.data) ? flowRes.data : [];
        const runningFlows = sessions.filter((s) => s.status === "RUNNING").length;

        setState((prev) => {
          if (prev === "active") return prev;
          if (runningFlows > 0) return "processing";
          if (pendingCount > 0) return "suggestion";
          return "idle";
        });
      } catch {
        // silently fail
      }
    };

    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
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
