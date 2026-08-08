"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useKeyChat } from "./key-chat-store";
import type { KeyChatMode } from "./types";

interface Suggestion {
  id: string;
  label: string;
  prompt: string;
}

const SUGGESTIONS: Record<KeyChatMode, Suggestion[]> = {
  general: [
    { id: "focus", label: "What should I focus on?", prompt: "What should I focus on today?" },
    { id: "snapshot", label: "Business snapshot", prompt: "Give me a quick business snapshot." },
    { id: "document", label: "Digitize a document", prompt: "I want to upload a document and digitize it into KEYFLOWOS." },
  ],
  genome_onboarding: [
    { id: "integrity", label: "Check genome integrity", prompt: "Check my genome integrity score." },
    { id: "dna", label: "Review DNA profile", prompt: "Review my business DNA profile." },
    { id: "roadmap", label: "Show roadmap", prompt: "Show my business roadmap." },
  ],
  executive: [
    { id: "decisions", label: "Decisions needing me", prompt: "What decisions need my attention?" },
    { id: "strategy", label: "Strategic priorities", prompt: "Review strategic priorities." },
    { id: "kpi", label: "Key performance", prompt: "Show key performance indicators." },
  ],
  finance: [
    { id: "cashflow", label: "Cash flow analysis", prompt: "Analyze cash flow." },
    { id: "forecast", label: "Financial forecast", prompt: "Financial forecast." },
    { id: "expenses", label: "Review expenses", prompt: "Review expenses." },
  ],
  sales: [
    { id: "pipeline", label: "Pipeline status", prompt: "Sales pipeline status." },
    { id: "leads", label: "Lead generation", prompt: "Lead generation status." },
    { id: "deals", label: "Active deals", prompt: "Active deals overview." },
  ],
  operations: [
    { id: "tasks", label: "Task queue", prompt: "Task queue status." },
    { id: "process", label: "Process optimization", prompt: "Process optimization." },
    { id: "schedule", label: "Ops schedule", prompt: "Operations schedule." },
  ],
};

interface KeyChatSuggestionsProps {
  onSelect: (prompt: string) => void;
  className?: string;
}

export function KeyChatSuggestions({ onSelect, className }: KeyChatSuggestionsProps) {
  const { chatMode, status } = useKeyChat();
  const isLoading = status === "streaming" || status === "loading";

  const suggestions = useMemo(() => {
    return SUGGESTIONS[chatMode ?? "general"] ?? SUGGESTIONS.general;
  }, [chatMode]);

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {suggestions.map((suggestion, index) => (
        <motion.button
          key={suggestion.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05, duration: 0.2 }}
          disabled={isLoading}
          onClick={() => onSelect(suggestion.prompt)}
          className={cn(
            "rounded-full border border-border/40 bg-card/60 px-3 py-1.5 text-[11px] font-medium text-foreground",
            "transition-colors hover:bg-card hover:border-border/60 hover:shadow-sm",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {suggestion.label}
        </motion.button>
      ))}
    </div>
  );
}
