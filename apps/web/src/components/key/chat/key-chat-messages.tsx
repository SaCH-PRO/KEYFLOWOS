"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useKeyChat } from "./key-chat-store";
import { KeyMessageRenderer } from "./key-message-renderer";
import { KeyChatGreeting } from "./key-chat-greeting";
import { useKeyChatTts } from "./use-key-chat-tts";
import type { OnboardingStep } from "./types";

interface KeyChatMessagesProps {
  onConfirmAction: (toolCallId: string, confirmed: boolean, toolName: string, args: Record<string, unknown>) => void;
  onCardAdvance?: (step: OnboardingStep) => void;
}

export function KeyChatMessages({ onConfirmAction, onCardAdvance }: KeyChatMessagesProps) {
  const { messages, status } = useKeyChat();
  useKeyChatTts();
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isStreaming = status === "streaming";

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

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={containerRef}
        className="absolute inset-0 overflow-y-auto px-3 py-4 md:px-5"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center">
            <KeyChatGreeting />
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {messages.map((message, index) => (
              <div
                key={message.id}
                className={cn(
                  "flex w-full",
                  message.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                {message.role === "assistant" && (
                  <div className="mr-2 mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/70">
                    <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                )}
                <KeyMessageRenderer
                  message={message}
                  isStreaming={isStreaming && index === messages.length - 1 && message.role === "assistant"}
                  onConfirm={onConfirmAction}
                  onCardAdvance={onCardAdvance}
                />
              </div>
            ))}
            <div ref={endRef} className="h-4 shrink-0" />
          </div>
        )}
      </div>

      {!isAtBottom && (
        <button
          type="button"
          onClick={() => scrollToBottom("smooth")}
          className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border/50 bg-card/90 px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur-lg transition-opacity hover:opacity-80"
        >
          <ArrowDown className="h-3 w-3" />
          New messages
        </button>
      )}
    </div>
  );
}
