"use client";

import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";

export interface VoiceTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  ts: number;
}

interface VoiceTranscriptDrawerProps {
  turns: VoiceTurn[];
  thinking?: boolean;
  emptyText?: string;
  className?: string;
}

export function VoiceTranscriptDrawer({
  turns,
  thinking,
  emptyText = "Tap the mic and ask anything.",
  className,
}: VoiceTranscriptDrawerProps) {
  return (
    <div
      className={`flex-1 overflow-y-auto p-4 space-y-2 min-h-[200px] ${className ?? ""}`}
    >
      {turns.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-8">
          {emptyText}
        </div>
      ) : (
        turns.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={`max-w-[85%] p-2.5 rounded-2xl text-xs ${
              t.role === "user"
                ? "ml-auto rounded-br-sm"
                : "rounded-bl-sm"
            }`}
            style={
              t.role === "user"
                ? {
                    background:
                      "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                    color: "white",
                  }
                : { background: "hsl(var(--muted) / 0.5)" }
            }
          >
            <span className="text-[10px] opacity-60 block mb-0.5">
              {t.role === "user" ? "You" : "Jarvis"}
            </span>
            {t.text}
          </motion.div>
        ))
      )}
      {thinking && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="max-w-[85%] p-2.5 rounded-2xl rounded-bl-sm text-xs bg-muted/50"
        >
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <RefreshCw className="w-3 h-3 animate-spin" />
            <span>Thinking…</span>
          </div>
        </motion.div>
      )}
    </div>
  );
}
