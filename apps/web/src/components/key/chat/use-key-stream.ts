"use client";

import { useCallback, useRef } from "react";
import { API_BASE, getAuthHeaders } from "@/lib/api";
import type { KeyChatAttachment, KeyChatMessage, KeyChatPageContext } from "./types";

export interface FlowStreamChunk {
  type:
    | "content_delta"
    | "tool_calls"
    | "tool_results"
    | "confirmation_required"
    | "usage"
    | "done"
    | "error"
    | "card";
  content?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    description?: string;
    arguments: Record<string, unknown>;
    riskLevel?: "low" | "medium" | "high";
  }>;
  toolResults?: Array<{
    toolCallId: string;
    success: boolean;
    result?: unknown;
    error?: string;
  }>;
  pendingConfirmations?: Array<{
    toolCallId: string;
    name: string;
    description: string;
    arguments: Record<string, unknown>;
    riskLevel: "low" | "medium" | "high";
  }>;
  card?: {
    type: "welcome" | "genesis-idea" | "genesis-questions" | "readiness-dashboard" | "template-picker" | "completion-gate";
    title?: string;
    step?: string;
    data?: Record<string, unknown>;
  };
  sessionId?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    creditsUsed: number;
  };
  error?: string;
}

export interface StreamCallbacks {
  onChunk: (chunk: FlowStreamChunk) => void;
  onDone: (sessionId?: string) => void;
  onError: (error: string) => void;
}

export interface StreamRequest {
  businessId: string;
  message: string;
  history?: KeyChatMessage[];
  sessionId?: string | null;
  pageContext?: KeyChatPageContext;
  attachments?: KeyChatAttachment[];
}

export function useKeyStream() {
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const start = useCallback(
    async (req: StreamRequest, callbacks: StreamCallbacks) => {
      stop();
      const controller = new AbortController();
      abortRef.current = controller;

      const body = {
        message: req.message,
        history: (req.history ?? []).map((m) => ({
          role: m.role,
          content: m.content,
          attachments: m.attachments,
        })),
        sessionId: req.sessionId,
        pageContext: req.pageContext,
        attachments: req.attachments?.map((a) => ({
          type: getAttachmentType(a.contentType),
          url: a.url,
          name: a.name,
          mimeType: a.contentType,
          objectPath: a.objectPath,
        })),
      };

      try {
        const response = await fetch(
          `${API_BASE}/ai/businesses/${encodeURIComponent(req.businessId)}/flow/chat/stream`,
          {
            method: "POST",
            headers: {
              ...getAuthHeaders(),
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          callbacks.onError(data.error || data.message || `Stream failed (${response.status})`);
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          callbacks.onError("No response stream available");
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          if (controller.signal.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === "[DONE]") {
              callbacks.onDone();
              return;
            }
            try {
              const chunk: FlowStreamChunk = JSON.parse(payload);
              if (chunk.type === "error" && chunk.error) {
                callbacks.onError(chunk.error);
                return;
              }
              callbacks.onChunk(chunk);
              if (chunk.type === "done") {
                callbacks.onDone(chunk.sessionId);
                return;
              }
            } catch {
              // Ignore malformed SSE chunks
            }
          }
        }

        callbacks.onDone();
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        callbacks.onError((err as Error).message || "Stream error");
      } finally {
        abortRef.current = null;
      }
    },
    [stop]
  );

  return { start, stop, isStreaming: () => abortRef.current !== null };
}

export function getAttachmentType(contentType: string): "image" | "document" | "audio" | "spreadsheet" {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.includes("pdf")) return "document";
  if (
    contentType.includes("spreadsheet") ||
    contentType.includes("excel") ||
    contentType.includes("csv")
  )
    return "spreadsheet";
  if (contentType.startsWith("audio/")) return "audio";
  return "document";
}
