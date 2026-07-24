"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { ArrowDown, Sparkles } from "lucide-react";
import { useKeyChat } from "./key-chat-store";
import { useKeyChatActions } from "./use-key-chat-actions";
import { KeyMessageRenderer } from "./key-message-renderer";
import { KeyMessageBubble } from "./key-message-bubble";
import { KeyChatEmptyState } from "./key-chat-empty-state";
import { useKeyChatTts } from "./use-key-chat-tts";
import { Surface } from "@/components/ui-v2/surface";
import { Button } from "@/components/ui-v2/button";
import type { OnboardingStep, KeyChatMessage, KeyChatMode } from "./types";

interface KeyChatMessagesProps {
  onConfirmAction: (toolCallId: string, confirmed: boolean, toolName: string, args: Record<string, unknown>) => void;
  onCardAdvance?: (step: OnboardingStep) => void;
}

const GROUP_MS = 120_000;

function isGrouped(prev: KeyChatMessage | undefined, current: KeyChatMessage) {
  if (!prev) return false;
  return prev.role === current.role && current.timestamp - prev.timestamp < GROUP_MS;
}

export function KeyChatMessages({ onConfirmAction, onCardAdvance }: KeyChatMessagesProps) {
  const { messages, status, error, setError } = useKeyChat();
  const { sendMessage } = useKeyChatActions();
  useKeyChatTts();
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isStreaming = status === "streaming";
  const isLoading = status === "loading";

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    endRef.current?.scrollIntoView({ behavior });
  };

  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom("auto");
    }
  }, [messages, isAtBottom]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleScroll = () => {
      const threshold = 40;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      setIsAtBottom(distance < threshold);
    };

    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  const grouped = useMemo(() => {
    return messages.map((message, index) => ({
      message,
      grouped: isGrouped(messages[index - 1], message),
      isLast: index === messages.length - 1,
    }));
  }, [messages]);

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={containerRef} className="absolute inset-0 overflow-y-auto px-3 py-4 md:px-5">
        {messages.length === 0 && !isLoading ? (
          <div className="flex h-full flex-col items-center justify-center">
            <KeyChatEmptyState
              onModeChange={(mode: KeyChatMode) => {
                if (mode === "genome_onboarding") {
                  // Handled by the shell; prevent double-trigger here.
                  return;
                }
              }}
              onSuggestion={(prompt) => void sendMessage(prompt)}
            />
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {error && (
              <Surface
                variant="accent"
                className="flex items-start gap-2 border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                <span className="flex-1">{error}</span>
                <button
                  type="button"
                  onClick={() => setError(undefined)}
                  aria-label="Dismiss error"
                  className="shrink-0 font-medium opacity-70 hover:opacity-100"
                >
                  ×
                </button>
              </Surface>
            )}

            {isLoading && messages.length === 0 && (
              <div className="flex flex-col gap-5">
                <div className="flex w-full justify-start gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-muted">
                    <Sparkles className="h-3.5 w-3.5 text-violet" />
                  </div>
                  <Surface variant="elevated" className="h-16 w-2/3 max-w-md animate-pulse" />
                </div>
                <div className="flex w-full justify-start gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-muted">
                    <Sparkles className="h-3.5 w-3.5 text-violet" />
                  </div>
                  <Surface variant="elevated" className="h-12 w-1/2 max-w-sm animate-pulse" />
                </div>
              </div>
            )}

            {grouped.map(({ message, grouped, isLast }) => (
              <KeyMessageBubble
                key={message.id}
                message={message}
                isGrouped={grouped}
                isStreaming={isStreaming && isLast && message.role === "assistant"}
              >
                <KeyMessageRenderer
                  message={message}
                  isStreaming={isStreaming && isLast && message.role === "assistant"}
                  onConfirm={onConfirmAction}
                  onCardAdvance={onCardAdvance}
                />
              </KeyMessageBubble>
            ))}
            <div ref={endRef} className="h-4 shrink-0" />
          </div>
        )}
      </div>

      {!isAtBottom && (
        <Button
          variant="soft"
          onClick={() => scrollToBottom("smooth")}
          leftIcon={<ArrowDown className="h-3 w-3" />}
          className="absolute bottom-4 left-1/2 z-10 h-8 -translate-x-1/2 gap-1.5 rounded-full px-3 py-1.5 text-xs shadow-md"
        >
          New messages
        </Button>
      )}
    </div>
  );
}
