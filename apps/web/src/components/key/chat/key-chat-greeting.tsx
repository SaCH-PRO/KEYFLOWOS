"use client";

import { Bot, Sparkles, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { useKeyChat } from "./key-chat-store";
import { Button } from "@/components/ui-v2/button";
import { DEFAULT_GREETING, QUICK_ACTIONS } from "./constants";

export function KeyChatGreeting() {
  const { setInput, setOpen } = useKeyChat();

  const handleQuickAction = (prompt: string) => {
    setInput(prompt);
    setOpen(true);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="flex w-full max-w-lg flex-col items-center gap-6 text-center px-4"
    >
      <div className="relative">
        <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-primary/20 to-secondary/10 blur-2xl" />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-primary to-secondary shadow-lg">
          <Bot className="h-10 w-10 text-white" />
        </div>
        <span className="absolute -bottom-1 -right-1 flex h-4 w-4">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-75" />
          <span className="relative inline-flex h-4 w-4 rounded-full bg-mint border-2 border-background" />
        </span>
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-display font-bold bg-gradient-to-r from-foreground via-foreground to-muted-foreground bg-clip-text text-transparent">
          {DEFAULT_GREETING}
        </h1>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Ask me anything about your business, upload a document, or pick a starter below.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
        {QUICK_ACTIONS.map((action, index) => (
          <motion.button
            key={action.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + index * 0.05, duration: 0.25 }}
            onClick={() => handleQuickAction(action.prompt)}
            className="group flex items-center justify-between gap-3 rounded-xl border border-border/40 bg-card/40 p-3 text-left transition-all hover:bg-card hover:border-border/60 hover:shadow-sm"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <span className="text-xs font-medium text-foreground truncate">{action.label}</span>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
          </motion.button>
        ))}
      </div>

      <Button
        variant="primary"
        onClick={() => handleQuickAction(QUICK_ACTIONS[0]?.prompt ?? "")}
        className="rounded-full px-5 h-9 text-sm"
      >
        Start a conversation
      </Button>
    </motion.div>
  );
}
