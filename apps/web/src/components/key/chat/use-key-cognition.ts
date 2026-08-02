"use client";

import { useCallback, useRef, useState } from "react";
import { API_BASE, getAuthHeaders } from "@/lib/api";
import type { KeyCognitionPhase } from "./types";

/**
 * Live view of KEY's consciousness pipeline.
 *
 * The server runs ten cognitive steps per query and emits each one the moment
 * it completes. This hook consumes that stream so the UI can show the thinking
 * as it happens rather than only the answer at the end.
 *
 * Every phase here describes work that ALREADY ran — `ms` is measured on the
 * server, not estimated on the client. Nothing is animated to look busy.
 */

/**
 * One completed cognitive step. Defined in types.ts so message objects and the
 * stream share a single shape — two definitions would drift.
 */
export type CognitionPhase = KeyCognitionPhase;

export interface CognitionAnswer {
  text: string;
  reasoningMode: string;
  confidence: number;
  permitted: boolean;
  actions: unknown[];
}

export interface CognitionCallbacks {
  onPhase?: (phase: CognitionPhase) => void;
  onAnswer?: (answer: CognitionAnswer) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
}

type StreamEvent =
  | { type: "phase"; data: CognitionPhase }
  | { type: "answer"; data: CognitionAnswer }
  | { type: "error"; data: { message: string } };

export function useKeyCognition() {
  const abortRef = useRef<AbortController | null>(null);
  const [phases, setPhases] = useState<CognitionPhase[]>([]);
  const [answer, setAnswer] = useState<CognitionAnswer | null>(null);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setThinking(false);
  }, []);

  const think = useCallback(
    async (
      req: { businessId: string; text: string; sessionId?: string | null; userId?: string },
      callbacks: CognitionCallbacks = {}
    ) => {
      stop();
      const controller = new AbortController();
      abortRef.current = controller;

      setPhases([]);
      setAnswer(null);
      setError(null);
      setThinking(true);

      // The route is a GET (Nest's @Sse registers RequestMethod.GET), so the
      // parameters travel in the query string. We use fetch rather than
      // EventSource because EventSource cannot attach an Authorization header,
      // and every cortex route is behind AuthGuard + BusinessGuard.
      const params = new URLSearchParams({
        businessId: req.businessId,
        text: req.text,
      });
      if (req.sessionId) params.set("sessionId", req.sessionId);
      if (req.userId) params.set("userId", req.userId);

      try {
        const response = await fetch(
          `${API_BASE}/api/v1/cortex/conscious/stream?${params.toString()}`,
          {
            method: "GET",
            headers: { ...getAuthHeaders(), Accept: "text/event-stream" },
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          const message =
            data.message || data.error || `Cognition stream failed (${response.status})`;
          setError(message);
          callbacks.onError?.(message);
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          const message = "No cognition stream available";
          setError(message);
          callbacks.onError?.(message);
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          if (controller.signal.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          // SSE frames are newline-delimited; the trailing partial line is kept
          // in the buffer until the rest of it arrives.
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;

            let event: StreamEvent;
            try {
              event = JSON.parse(payload) as StreamEvent;
            } catch {
              continue; // ignore malformed frames rather than killing the stream
            }

            if (event.type === "phase") {
              setPhases((prev) => [...prev, event.data]);
              callbacks.onPhase?.(event.data);
            } else if (event.type === "answer") {
              setAnswer(event.data);
              callbacks.onAnswer?.(event.data);
            } else if (event.type === "error") {
              setError(event.data.message);
              callbacks.onError?.(event.data.message);
            }
          }
        }

        callbacks.onDone?.();
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        const message = (err as Error).message || "Cognition stream error";
        setError(message);
        callbacks.onError?.(message);
      } finally {
        abortRef.current = null;
        setThinking(false);
      }
    },
    [stop]
  );

  return { think, stop, phases, answer, thinking, error };
}
