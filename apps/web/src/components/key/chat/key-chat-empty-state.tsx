"use client";

import { useMemo } from "react";
import { Bot, Sparkles, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { useKeyChat } from "./key-chat-store";
import { KeyChatModeTabs } from "./key-chat-mode-tabs";
import { KeyActionGrid } from "./key-action-grid";
import { KeyChatSuggestions } from "./key-chat-suggestions";
import type { KeyChatMode } from "./types";

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

interface KeyChatEmptyStateProps {
  onModeChange?: (mode: KeyChatMode) => void;
  onSuggestion: (prompt: string) => void;
}

export function KeyChatEmptyState({ onModeChange, onSuggestion }: KeyChatEmptyStateProps) {
  const { chatMode, setChatMode } = useKeyChat();

  const greeting = useMemo(() => getGreeting(), []);

  const handleModeChange = (mode: KeyChatMode) => {
    setChatMode(mode);
    onModeChange?.(mode);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="flex w-full max-w-xl flex-col items-center gap-5 text-center px-4"
    >
      {/* Orb */}
      <div className="relative">
        <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-primary/25 via-violet/15 to-secondary/10 blur-2xl animate-pulse" />
        <motion.div
          animate={{ scale: [1, 1.02, 1] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-primary to-secondary shadow-lg"
        >
          <Bot className="h-10 w-10 text-white" />
        </motion.div>
        <span className="absolute -bottom-1 -right-1 flex h-4 w-4">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-75" />
          <span className="relative inline-flex h-4 w-4 rounded-full bg-mint border-2 border-background" />
        </span>
      </div>

      {/* Greeting */}
      <div className="space-y-1.5">
        <h1 className="text-2xl sm:text-3xl font-display font-bold bg-gradient-to-r from-foreground via-foreground to-muted-foreground bg-clip-text text-transparent">
          {greeting}, I&apos;m KEY.
        </h1>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Pick a mode, try a quick action, or just tell me what you need.
        </p>
      </div>

      {/* Mode tabs */}
      <KeyChatModeTabs mode={chatMode ?? "general"} onChange={handleModeChange} />

      {/* Suggestions */}
      <KeyChatSuggestions onSelect={onSuggestion} />

      {/* Action grid */}
      <div className="w-full">
        <KeyActionGrid />
      </div>

      {/* Hint */}
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        onClick={() => onSuggestion("What can you do?")}
        className="group flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <Sparkles className="h-3 w-3" />
        <span>Ask what KEY can do</span>
        <ArrowRight className="h-3 w-3 opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
      </motion.button>
    </motion.div>
  );
}
