"use client";

import { Sparkles } from "lucide-react";
import { useKeyChat } from "./key-chat-store";
import { DEFAULT_GREETING, QUICK_ACTIONS } from "./constants";

export function KeyChatGreeting() {
  const { setInput, setOpen } = useKeyChat();

  const handleQuickAction = (prompt: string) => {
    setInput(prompt);
    setOpen(true);
  };

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-teal-500 shadow-lg shadow-orange-500/20">
        <Sparkles className="h-7 w-7 text-white" />
      </div>
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">{DEFAULT_GREETING}</h3>
        <p className="text-sm text-muted-foreground">
          Ask me anything about your business, upload a document, or tell me what you&apos;d like to do.
        </p>
      </div>
      <div className="flex w-full flex-wrap justify-center gap-2">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => handleQuickAction(action.prompt)}
            className="rounded-full border border-border/50 bg-card/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-orange-500/30 hover:bg-orange-500/5"
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
