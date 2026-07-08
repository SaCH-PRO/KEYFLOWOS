"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useKeyChat } from "./key-chat-store";
import { useKeyChatActions } from "./use-key-chat-actions";
import { KeyChatMessages } from "./key-chat-messages";
import { KeyChatInput } from "./key-chat-input";
import { KeyChatHistory } from "./key-chat-history";
import { KeyChatVoiceBar } from "./key-chat-voice-bar";

interface KeyChatPanelProps {
  className?: string;
}

export function KeyChatPanel({ className }: KeyChatPanelProps) {
  const { open, setOpen, showHistory, setShowHistory } = useKeyChat();
  const { sendMessage, stop, confirmAction } = useKeyChatActions();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, setOpen]);

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
              <header className="flex items-center justify-between border-b border-border/50 px-4 py-3">
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
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Close chat"
                >
                  <X className="h-4 w-4" />
                </button>
              </header>

              <div className="flex min-h-0 flex-1">
                {showHistory && (
                  <div className="hidden w-56 shrink-0 sm:block">
                    <KeyChatHistory />
                  </div>
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <KeyChatMessages onConfirmAction={confirmAction} />
                  <KeyChatVoiceBar />
                  <KeyChatInput onSend={sendMessage} onStop={stop} />
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
