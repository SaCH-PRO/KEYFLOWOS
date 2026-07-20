"use client";

import { useCallback, useRef } from "react";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  sendFlowChat,
  confirmFlowAction,
  fetchFlowSessions,
  deleteFlowSession,
  type FlowChatResponse,
  type FlowPendingConfirmation,
} from "@/lib/client";
import {
  sendGenomeMessage,
  getGenomeMessages,
  type GenomeChatMessage,
  type ProposedGenomeUpdate,
} from "@/lib/api/business-genome";
import { useKeyChat } from "./key-chat-store";
import { useKeyStream, type FlowStreamChunk, getAttachmentType } from "./use-key-stream";
import type { KeyChatAttachment, KeyChatMessage, KeyChatPlanStep, KeyChatSession } from "./types";
import { nanoid } from "./utils";

export function useKeyChatActions() {
  const chat = useKeyChat();
  const { start: startStream, stop: stopStream } = useKeyStream();
  const processingRef = useRef(false);

  const chatMode = chat.chatMode ?? "general";

  const buildHistory = useCallback((): KeyChatMessage[] => {
    return chat.messages.filter((m) => m.role !== "system");
  }, [chat.messages]);

  const appendAssistantFromResponse = useCallback(
    (res: FlowChatResponse, id?: string) => {
      const messageId = id ?? nanoid();
      const assistantMsg: KeyChatMessage = {
        id: messageId,
        role: "assistant",
        content: res.reply || "",
        timestamp: Date.now(),
        pendingConfirmations: res.pendingConfirmations,
        requiresConfirmation: res.requiresConfirmation,
        toolResults: res.toolResults,
        card: res.card,
        usage: res.usage,
      };

      if (res.pendingConfirmations && res.pendingConfirmations.length > 0) {
        assistantMsg.plan = res.pendingConfirmations.map((pc) => ({
          toolCallId: pc.toolCallId,
          name: pc.name,
          description: pc.description,
          arguments: pc.arguments,
          riskLevel: pc.riskLevel,
          status: "pending",
        }));
      }

      chat.appendMessage(assistantMsg);
      return messageId;
    },
    [chat]
  );

  const processStreamChunk = useCallback(
    (chunk: FlowStreamChunk) => {
      if (chunk.type === "error") {
        chat.setStatus("error");
        chat.setError(chunk.error || "Stream error");
        return;
      }

      if (chunk.type === "content_delta" && chunk.content) {
        chat.updateLastAssistantMessage({ content: chunk.content });
      }

      if (chunk.type === "confirmation_required" && chunk.pendingConfirmations) {
        chat.updateLastAssistantMessage({
          pendingConfirmations: chunk.pendingConfirmations,
          requiresConfirmation: true,
          plan: chunk.pendingConfirmations.map((pc) => ({
            toolCallId: pc.toolCallId,
            name: pc.name,
            description: pc.description,
            arguments: pc.arguments,
            riskLevel: pc.riskLevel,
            status: "pending",
          })),
        });
      }

      if (chunk.type === "tool_calls" && chunk.toolCalls) {
        chat.updateLastAssistantMessage({
          plan: chunk.toolCalls.map((tc) => ({
            toolCallId: tc.id,
            name: tc.name,
            description: tc.description ?? tc.name.replace(/_/g, " "),
            arguments: tc.arguments,
            riskLevel: tc.riskLevel ?? "low",
            status: "executing" as const,
          })),
        });
      }

      if (chunk.type === "tool_results" && chunk.toolResults) {
        const lastAssistant = [...chat.messages].reverse().find((m) => m.role === "assistant");
        const updatedPlan = lastAssistant?.plan?.map((step) => {
          const result = chunk.toolResults!.find((r) => r.toolCallId === step.toolCallId);
          if (!result) return step;
          return {
            ...step,
            status: result.success ? "completed" : "failed",
            result: result.result,
            error: result.error,
          } as KeyChatPlanStep;
        });
        chat.updateLastAssistantMessage({
          toolResults: chunk.toolResults as KeyChatMessage["toolResults"],
          requiresConfirmation: false,
          plan: updatedPlan,
        });
      }

      if (chunk.type === "usage" && chunk.usage) {
        chat.updateLastAssistantMessage({ usage: chunk.usage });
      }

      if (chunk.type === "card" && chunk.card) {
        chat.updateLastAssistantMessage({ card: chunk.card });
      }
    },
    [chat]
  );

  const sendMessage = useCallback(
    async (text?: string, opts?: { pendingConfirmation?: { toolCallId: string; confirmed: boolean; toolName?: string; toolArgs?: Record<string, unknown> }; silent?: boolean }) => {
      const businessId = getStoredBusinessId();
      if (!businessId) {
        chat.setError("No business selected");
        return;
      }

      const messageText = (text ?? chat.input).trim();
      const attachments: KeyChatAttachment[] = chat.attachments;

      if (!messageText && attachments.length === 0 && !opts?.pendingConfirmation) return;

      // Atomic check-and-set for processing state to prevent race conditions
      if (processingRef.current) return;
      processingRef.current = true;

      chat.setError(undefined);

      // For a confirmation turn (or a silent system-driven advance), do not
      // add a new user message to the visible transcript.
      if (!opts?.pendingConfirmation && !opts?.silent) {
        const userMsg: KeyChatMessage = {
          id: nanoid(),
          role: "user",
          content: messageText,
          timestamp: Date.now(),
          attachments: attachments.length > 0 ? attachments : undefined,
        };
        chat.appendMessage(userMsg);
        chat.setInput("");
        chat.clearAttachments();
      }

      chat.setStatus("streaming");
      window.dispatchEvent(new CustomEvent("kf:key-state", { detail: { state: "processing" } }));

      const assistantId = nanoid();
      chat.appendMessage({
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      });

      // Genome onboarding mode uses a different endpoint
      if (chatMode === "genome_onboarding") {
        try {
          const res = await sendGenomeMessage(businessId, messageText);
          if (res.data) {
            const genomeMsg = res.data.message;
            const proposed = res.data.proposedUpdates;

            // Build content with proposed updates as formatted cards
            let content = genomeMsg.content;
            if (proposed) {
              content += `\n\n**Proposed Update: ${proposed.section}**\n${proposed.summary}`;
            }

            chat.updateMessage(assistantId, {
              content,
              timestamp: new Date(genomeMsg.createdAt).getTime(),
              // Store proposed updates in card for renderer to display
              card: proposed
                ? {
                    type: "ownership-legal",
                    title: `Proposed: ${proposed.section}`,
                    step: proposed.section,
                    data: { ...proposed.data, _proposedSummary: proposed.summary },
                  }
                : undefined,
            });
          } else {
            chat.updateMessage(assistantId, {
              content: res.error || "Sorry, I encountered an error. Please try again.",
            });
            chat.setStatus("error");
            chat.setError(res.error ?? undefined);
          }
        } catch (err) {
          chat.updateMessage(assistantId, {
            content: "Sorry, I encountered an error. Please try again.",
          });
          chat.setStatus("error");
          chat.setError((err as Error).message);
        } finally {
          chat.setStatus("idle");
          processingRef.current = false;
          window.dispatchEvent(new CustomEvent("kf:key-state", { detail: { state: "idle" } }));
          void loadSessions();
        }
        return;
      }

      const history = buildHistory().slice(0, -1); // exclude the empty assistant placeholder

      const fallbackToRest = async () => {
        try {
          const res = await sendFlowChat(
            businessId,
            messageText,
            history,
            opts?.pendingConfirmation,
            chat.pageContext as Record<string, unknown>,
            chat.activeSessionId,
            attachments.map((a) => ({
              type: getAttachmentType(a.contentType),
              url: a.url,
              name: a.name,
              mimeType: a.contentType,
              objectPath: a.objectPath,
            }))
          );
          if (res.data) {
            if (res.data.sessionId) chat.setActiveSessionId(res.data.sessionId);
            chat.updateMessage(assistantId, { content: res.data.reply });
            appendAssistantFromResponse(res.data, assistantId);
          } else {
            chat.updateMessage(assistantId, {
              content: res.error || "Sorry, I encountered an error. Please try again.",
            });
            chat.setStatus("error");
            chat.setError(res.error ?? undefined);
          }
        } catch (err) {
          chat.updateMessage(assistantId, {
            content: "Sorry, I encountered an error. Please try again.",
          });
        }
      };

      await startStream(
        {
          businessId,
          message: messageText,
          history,
          sessionId: chat.activeSessionId,
          pageContext: chat.pageContext,
          attachments,
        },
        {
          onChunk: (chunk) => {
            processStreamChunk(chunk);
          },
          onDone: (sessionId) => {
            if (sessionId) chat.setActiveSessionId(sessionId);
            chat.setStatus("idle");
            processingRef.current = false;
            window.dispatchEvent(new CustomEvent("kf:key-state", { detail: { state: "idle" } }));
            void loadSessions();
          },
          onError: async (error) => {
            // Fall back to the non-streaming endpoint before giving up.
            await fallbackToRest();
            chat.setStatus("idle");
            processingRef.current = false;
            window.dispatchEvent(new CustomEvent("kf:key-state", { detail: { state: "idle" } }));
          },
        }
      );
    },
    [chat, buildHistory, appendAssistantFromResponse, processStreamChunk, startStream, chatMode]
  );

  const confirmAction = useCallback(
    async (toolCallId: string, confirmed: boolean, toolName: string, toolArgs: Record<string, unknown>) => {
      const businessId = getStoredBusinessId();
      if (!businessId) {
        chat.setError("No business selected");
        return;
      }
      if (processingRef.current) return;
      processingRef.current = true;

      chat.setError(undefined);
      chat.setStatus("streaming");
      window.dispatchEvent(new CustomEvent("kf:key-state", { detail: { state: "processing" } }));

      // Mark the step as resolving on the message that owns the plan.
      const planOwner = [...chat.messages].reverse().find((m) => m.role === "assistant" && m.plan?.length);
      if (planOwner) {
        chat.updateMessage(planOwner.id, {
          plan: planOwner.plan!.map((s) =>
            s.toolCallId === toolCallId ? { ...s, status: "executing" as const } : s,
          ),
        });
      }

      try {
        const res = await confirmFlowAction(businessId, toolCallId, toolName, toolArgs, confirmed);
        if (res.data) {
          if (res.data.sessionId) chat.setActiveSessionId(res.data.sessionId);

          // Sync the outcome back onto the plan step.
          const outcome = res.data.toolResults?.find((r) => r.toolCallId === toolCallId);
          const current = [...chat.messages].reverse().find((m) => m.role === "assistant" && m.plan?.length);
          if (current) {
            chat.updateMessage(current.id, {
              plan: current.plan!.map((s) =>
                s.toolCallId === toolCallId
                  ? {
                      ...s,
                      status: !confirmed ? ("rejected" as const) : outcome?.success === false ? ("failed" as const) : ("completed" as const),
                      result: outcome?.result,
                      error: outcome?.error,
                    }
                  : s,
              ),
              requiresConfirmation: false,
            });
          }

          appendAssistantFromResponse(res.data);
        } else {
          chat.setError(res.error ?? "Failed to confirm the action. Please try again.");
          chat.setStatus("error");
        }
      } catch (err) {
        chat.setError((err as Error).message || "Failed to confirm the action.");
        chat.setStatus("error");
      } finally {
        chat.setStatus("idle");
        processingRef.current = false;
        window.dispatchEvent(new CustomEvent("kf:key-state", { detail: { state: "idle" } }));
      }
    },
    [chat, appendAssistantFromResponse]
  );

  const stop = useCallback(() => {
    stopStream();
    chat.setStatus("idle");
    processingRef.current = false;
    window.dispatchEvent(new CustomEvent("kf:key-state", { detail: { state: "idle" } }));
  }, [stopStream, chat]);

  const loadSessions = useCallback(async () => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;

    // Genome mode doesn't use flow sessions
    if (chatMode === "genome_onboarding") {
      chat.setSessions([]);
      return;
    }

    const res = await fetchFlowSessions(businessId);
    if (!res.data || !Array.isArray(res.data)) return;

    const sessions: KeyChatSession[] = (res.data as Array<Record<string, unknown>>).map((s) => {
      const messages = ((s.messages as KeyChatMessage[]) ?? []);
      const firstUser = messages.find((m) => m.role === "user");
      const title = firstUser?.content?.slice(0, 60) || "New chat";
      return {
        id: String(s.id),
        title: title + (firstUser && firstUser.content.length > 60 ? "…" : ""),
        updatedAt: String(s.updatedAt),
        createdAt: String(s.createdAt),
      };
    });
    chat.setSessions(sessions);
  }, [chat, chatMode]);

  const selectSession = useCallback(
    async (sessionId: string) => {
      const businessId = getStoredBusinessId();
      if (!businessId) return;
      chat.setActiveSessionId(sessionId);
      chat.setMessages([]);
      chat.setStatus("loading");

      const res = await fetchFlowSessions(businessId);
      const session = ((res.data as Array<Record<string, unknown>>) ?? []).find((s) => s.id === sessionId);
      if (session && Array.isArray(session.messages as unknown[])) {
        const restored: KeyChatMessage[] = (session.messages as Array<Record<string, unknown>>).map((m, idx: number) => ({
          id: String(m.id ?? `${sessionId}-${idx}`),
          role: String(m.role) as "user" | "assistant" | "system",
          content: String(m.content || ""),
          timestamp: m.timestamp ? new Date(String(m.timestamp)).getTime() : Date.now(),
          attachments: m.attachments as KeyChatMessage["attachments"],
          pendingConfirmations: m.pendingConfirmations as KeyChatMessage["pendingConfirmations"],
          plan: m.plan as KeyChatMessage["plan"],
          toolResults: m.toolResults as KeyChatMessage["toolResults"],
          requiresConfirmation: Boolean(m.requiresConfirmation),
          usage: m.usage as KeyChatMessage["usage"],
        }));
        chat.setMessages(restored);
      }
      chat.setStatus("idle");
    },
    [chat]
  );

  const createNewSession = useCallback(() => {
    chat.resetForNewSession();
  }, [chat]);

  const deleteSession = useCallback(
    async (sessionId: string) => {
      const businessId = getStoredBusinessId();
      if (!businessId) return;
      await deleteFlowSession(businessId, sessionId);
      if (chat.activeSessionId === sessionId) {
        chat.resetForNewSession();
      }
      await loadSessions();
    },
    [chat, loadSessions]
  );

  return {
    sendMessage,
    confirmAction,
    stop,
    loadSessions,
    selectSession,
    createNewSession,
    deleteSession,
    isProcessing: () => processingRef.current,
  };
}
