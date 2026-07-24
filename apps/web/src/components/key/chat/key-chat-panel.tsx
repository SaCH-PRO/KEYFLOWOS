"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { X, PanelLeft, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useKeyChat } from "./key-chat-store";
import { useKeyChatActions } from "./use-key-chat-actions";
import { KeyChatMessages } from "./key-chat-messages";
import { KeyChatInput } from "./key-chat-input";
import { KeyChatHistory } from "./key-chat-history";
import { KeyChatVoiceBar } from "./key-chat-voice-bar";
import { KeyChatModeTabs } from "./key-chat-mode-tabs";
import { KeyGenomeChip } from "./key-genome-chip";
import { openGenomeConversation } from "./open-genome-conversation";
import type { KeyChatMode } from "./types";

interface KeyChatPanelProps {
  className?: string;
}

export function KeyChatPanel({ className }: KeyChatPanelProps) {
  const router = useRouter();
  const chat = useKeyChat();
  const { open, setOpen, showHistory, setShowHistory, chatMode, setChatMode, messages, setCurrentModule, setPageContext, setActiveSessionId, appendMessage } = chat;
  const { sendMessage, stop, confirmAction } = useKeyChatActions();

  // Card advances outside /app/onboarding drive the flow conversationally.
  const handleCardAdvance = (step: string) => {
    void sendMessage(
      `The user finished the "${step}" onboarding step. Present the next step's card.`,
      { silent: true },
    );
  };

  const openFullPage = () => {
    setOpen(false);
    router.push("/app/key/chat");
  };

  const handleModeChange = (newMode: KeyChatMode) => {
    if (newMode === "genome_onboarding") {
      void openGenomeConversation(
        { messages, setCurrentModule, setPageContext, setActiveSessionId, appendMessage, setOpen },
        sendMessage,
        { surface: "drawer" },
      );
    } else {
      setChatMode(newMode);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, setOpen]);

  // Swipe-down-to-close on mobile (only when panel is full-screen).
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const touch = e.changedTouches[0];
    const dy = touch.clientY - touchStartRef.current.y;
    const dx = touch.clientX - touchStartRef.current.x;
    touchStartRef.current = null;
    if (dy > 80 && Math.abs(dy) > Math.abs(dx) * 1.5) {
      setOpen(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[var(--kf-z-key-panel)] bg-black/30 backdrop-blur-sm"
          />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className={cn(
              "fixed inset-y-0 right-0 z-[var(--kf-z-key-panel)] flex w-full flex-col bg-background shadow-2xl",
              "sm:w-[520px] md:w-[600px] lg:w-[720px]",
              className
            )}
          >
            <div className="flex h-full flex-col">
              <header
                className="flex items-center justify-between border-b border-border/50 px-4 py-3 touch-pan-y"
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowHistory((s) => !s)}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
                      showHistory
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                    aria-label="Toggle history"
                  >
                    <PanelLeft className="h-4 w-4" />
                  </button>
                  <div>
                    <h2 className="text-sm font-semibold">KEY</h2>
                    <p className="text-[10px] text-muted-foreground">Your AI business assistant</p>
                  </div>
                  <KeyGenomeChip surface="drawer" />
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={openFullPage}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label="Open in full page"
                    title="Open in full page"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label="Close chat"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </header>

              <div className="border-b border-border/50 bg-background/95 px-3 py-2">
                <KeyChatModeTabs mode={chatMode ?? "general"} onChange={handleModeChange} />
              </div>

              <div className="flex min-h-0 flex-1">
                {showHistory && (
                  <div className="hidden w-56 shrink-0 sm:block">
                    <KeyChatHistory />
                  </div>
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <KeyChatMessages onConfirmAction={confirmAction} onCardAdvance={handleCardAdvance} />
                  <KeyChatVoiceBar />
                  <KeyChatInput onSend={sendMessage} onStop={stop} showModeBadge={false} />
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
