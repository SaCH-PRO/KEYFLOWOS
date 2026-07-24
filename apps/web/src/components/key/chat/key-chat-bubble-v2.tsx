"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useKeyChat } from "./key-chat-store";
import { useKeyStatus } from "./use-key-status";

export type KeyPresenceState = "idle" | "active" | "processing" | "suggestion";

const SUGGESTIONS = [
  "What should I focus on?",
  "Why is cash slow?",
  "Fill my calendar",
];

export function KeyChatBubbleV2() {
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

  const bubbleGradient =
    apiState === "active"
      ? "from-primary to-orange-600"
      : apiState === "processing"
        ? "from-secondary to-teal-600"
        : apiState === "suggestion"
          ? "from-violet-500 to-violet-600"
          : "from-muted-foreground to-slate-600";

  return (
    <div
      className={cn(
        "fixed z-[var(--kf-z-key-presence)] flex flex-col items-end gap-3",
        "bottom-[88px] right-4 md:bottom-6 md:right-6",
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
            <div className="rounded-xl border border-border bg-card/95 px-3 py-1.5 text-xs text-muted-foreground shadow-lg backdrop-blur-xl">
              <span className="inline-flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-gold-foreground" />
                KEY has a suggestion
              </span>
            </div>
            {SUGGESTIONS.map((suggestion, i) => (
              <motion.button
                key={suggestion}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
                onClick={() => handleSuggestion(suggestion)}
                className="max-w-[240px] rounded-xl border border-primary/20 bg-gradient-to-r from-primary/10 to-secondary/10 px-3 py-2 text-left text-xs text-foreground shadow-md transition-colors hover:border-primary/40"
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
        className="group relative focus-ring rounded-full"
        aria-label="Talk to KEY"
      >
        <div
          className={cn(
            "flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br shadow-xl transition-all duration-300",
            bubbleGradient,
            apiState === "suggestion" && "shadow-violet/40",
            apiState === "active" && "shadow-primary/40",
            apiState === "processing" && "shadow-secondary/40",
          )}
        >
          <Bot className="h-6 w-6 text-white" />
        </div>

        {apiState === "suggestion" && !isExpanded && (
          <span className="absolute inset-0 rounded-full animate-ping bg-violet/30" />
        )}

        <AnimatePresence>
          {tooltip && !isExpanded && (
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              className="absolute right-full top-1/2 mr-3 -translate-y-1/2 whitespace-nowrap rounded-xl border border-border bg-card/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur-xl"
            >
              {tooltip}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  );
}
