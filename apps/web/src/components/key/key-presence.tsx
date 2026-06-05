"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Bot } from "lucide-react";

export type KeyPresenceState = "idle" | "active" | "processing" | "suggestion";

interface KeyPresenceProps {
  className?: string;
}

export function KeyPresence({ className }: KeyPresenceProps) {
  const [state, setState] = useState<KeyPresenceState>("idle");
  const [isExpanded, setIsExpanded] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [tooltip, setTooltip] = useState<string | null>(null);

  // Listen for KEY state changes from other components
  useEffect(() => {
    const handleKeyState = (e: Event) => {
      const detail = (e as CustomEvent<{ state: KeyPresenceState }>).detail;
      if (detail?.state) setState(detail.state);
    };
    window.addEventListener("kf:key-state", handleKeyState);
    return () => window.removeEventListener("kf:key-state", handleKeyState);
  }, []);

  // Auto-show suggestions when KEY has something to say
  useEffect(() => {
    if (state === "suggestion" && !isExpanded) {
      queueMicrotask(() => setShowSuggestions(true));
      const timer = setTimeout(() => setShowSuggestions(false), 8000);
      return () => clearTimeout(timer);
    }
  }, [state, isExpanded]);

  const handleClick = useCallback(() => {
    setIsExpanded(true);
    setShowSuggestions(false);
    window.dispatchEvent(new CustomEvent("kf:open-key", { detail: { mode: "chat" } }));
  }, []);

  const handleClose = useCallback(() => {
    setIsExpanded(false);
  }, []);

  const suggestions = [
    "What should I focus on?",
    "Why is cash slow?",
    "Fill my calendar",
  ];

  return (
    <div
      className={cn(
        "fixed z-[var(--kf-z-key-presence)] flex flex-col items-end gap-3",
        "bottom-[88px] right-4 md:bottom-6 md:right-6",
        className
      )}
    >
      {/* Suggestion bubbles */}
      <AnimatePresence>
        {showSuggestions && !isExpanded && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="flex flex-col gap-2 items-end mb-2"
          >
            <div className="px-3 py-1.5 rounded-lg bg-card/95 backdrop-blur-xl border border-border shadow-lg text-xs text-muted-foreground">
              KEY has a suggestion
            </div>
            {suggestions.map((suggestion, i) => (
              <motion.button
                key={suggestion}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent("kf:open-key", {
                      detail: { mode: "chat", prompt: suggestion },
                    })
                  );
                  setIsExpanded(true);
                  setShowSuggestions(false);
                }}
                className="px-3 py-2 rounded-xl bg-gradient-to-r from-orange-500/10 to-teal-500/10 border border-orange-500/20 text-xs text-foreground hover:border-orange-500/40 transition-colors shadow-md text-left max-w-[240px]"
              >
                {suggestion}
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* KEY Orb */}
      <motion.button
        onClick={handleClick}
        onMouseEnter={() => {
          if (!isExpanded) {
            setTooltip(state === "suggestion" ? "KEY has a suggestion" : "Talk to KEY");
          }
        }}
        onMouseLeave={() => setTooltip(null)}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.95 }}
        className="relative group"
        aria-label="Talk to KEY"
      >
        <div
          className={cn(
            "w-[52px] h-[52px] rounded-full flex items-center justify-center transition-all duration-300",
            state === "active" && "bg-gradient-to-br from-orange-500 to-orange-600 shadow-lg shadow-orange-500/30",
            state === "processing" && "bg-gradient-to-br from-teal-500 to-teal-600 shadow-lg shadow-teal-500/30",
            state === "suggestion" && "bg-gradient-to-br from-violet-500 to-violet-600 shadow-lg shadow-violet-500/30",
            state === "idle" && "bg-gradient-to-br from-slate-600 to-slate-700 shadow-lg"
          )}
        >
          <Bot className="w-6 h-6 text-white" />
        </div>
        
        {/* Tooltip */}
        <AnimatePresence>
          {tooltip && !isExpanded && (
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              className="absolute right-full mr-3 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-card/95 backdrop-blur-xl border border-border shadow-lg text-xs whitespace-nowrap"
            >
              {tooltip}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Pulse ring for suggestion state */}
        {state === "suggestion" && !isExpanded && (
          <span className="absolute inset-0 rounded-full animate-ping bg-orange-500/20" />
        )}
      </motion.button>
    </div>
  );
}
