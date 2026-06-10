"use client";

import { useEffect, useRef } from "react";
import { getApiBase } from "@/lib/api-base";

const API_BASE = getApiBase();

export type RealtimeEvent = {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
};

export function useRealtime(businessId: string | null, onEvent: (event: RealtimeEvent) => void) {
  const evtSourceRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    if (!businessId) return;

    const connect = () => {
      if (evtSourceRef.current) {
        evtSourceRef.current.close();
      }

      const url = `${API_BASE}/realtime/businesses/${businessId}/events`;
      const evtSource = new EventSource(url, { withCredentials: true });

      evtSource.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data) as RealtimeEvent;
          onEventRef.current(data);
        } catch {
          // ignore malformed
        }
      };

      evtSource.onerror = () => {
        evtSource.close();
        reconnectTimerRef.current = setTimeout(connect, 3000);
      };

      evtSourceRef.current = evtSource;
    };

    connect();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      evtSourceRef.current?.close();
      evtSourceRef.current = null;
    };
  }, [businessId]);
}
