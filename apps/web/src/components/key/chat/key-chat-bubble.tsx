"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { useKeyChat } from "./key-chat-store";
import { useKeyStatus } from "./use-key-status";

export type KeyPresenceState = "idle" | "active" | "processing" | "suggestion";

const SUGGESTIONS = [
  "What should I focus on?",
  "Why is cash slow?",
  "Fill my calendar",
];

export function KeyChatBubble() {
  const pathname = usePathname();
  const { toggle, setInput, setOpen } = useKeyChat();
  const { state: apiState } = useKeyStatus();
  const [isExpanded, setIsExpanded] = useState(false);
  const [tooltip, setTooltip] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    if (apiState !== "suggestion" || isExpanded) return;
    const showTimer = setTimeout(() => setShowSuggestions(true), 0);
    const hideTimer = setTimeout(() => setShowSuggestions(false), 8000);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, [apiState, isExpanded]);

  const handleClick = useCallback(() => {
    setIsExpanded(true);
    setShowSuggestions(false);
    toggle();
  }, [toggle]);

  const handleSuggestion = useCallback((prompt: string) => {
    setInput(prompt);
    setOpen(true);
    setIsExpanded(true);
    setShowSuggestions(false);
  }, [setInput, setOpen]);

  if (pathname?.startsWith("/app/onboarding")) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed z-[var(--kf-z-key-presence)] flex flex-col items-end gap-3",
        "bottom-[88px] right-4 md:bottom-6 md:right-6"
      )}
    >
      <AnimatePresence>
        {showSuggestions && !isExpanded && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="flex flex-col items-end gap-2"
          >
            <div className="rounded-lg border border-border bg-card/95 px-3 py-1.5 text-xs text-muted-foreground shadow-lg backdrop-blur-xl">
              KEY has a suggestion
            </div>
            {SUGGESTIONS.map((suggestion, i) => (
              <motion.button
                key={suggestion}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
                onClick={() => handleSuggestion(suggestion)}
                className="max-w-[240px] rounded-xl border border-orange-500/20 bg-gradient-to-r from-orange-500/10 to-teal-500/10 px-3 py-2 text-left text-xs text-foreground shadow-md transition-colors hover:border-orange-500/40"
              >
                {suggestion}
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        onClick={handleClick}
        onMouseEnter={() => setTooltip(apiState === "suggestion" ? "KEY has a suggestion" : "Talk to KEY")}
        onMouseLeave={() => setTooltip(null)}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.95 }}
        className="group relative"
        aria-label="Talk to KEY"
      >
        <div
          className={cn(
            "flex h-[52px] w-[52px] items-center justify-center rounded-full transition-all duration-300",
            apiState === "active" && "bg-gradient-to-br from-orange-500 to-orange-600 shadow-lg shadow-orange-500/30",
            apiState === "processing" && "bg-gradient-to-br from-teal-500 to-teal-600 shadow-lg shadow-teal-500/30",
            apiState === "suggestion" && "bg-gradient-to-br from-violet-500 to-violet-600 shadow-lg shadow-violet-500/30",
            apiState === "idle" && "bg-gradient-to-br from-slate-600 to-slate-700 shadow-lg"
          )}
        >
          <Bot className="h-6 w-6 text-white" />
        </div>

        <AnimatePresence>
          {tooltip && !isExpanded && (
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              className="absolute right-full top-1/2 mr-3 -translate-y-1/2 whitespace-nowrap rounded-lg border border-border bg-card/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur-xl"
            >
              {tooltip}
            </motion.div>
          )}
        </AnimatePresence>

        {apiState === "suggestion" && !isExpanded && (
          <span className="absolute inset-0 rounded-full animate-ping bg-orange-500/20" />
        )}
      </motion.button>
    </div>
  );
}
