"use client";

import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { User, Copy, Check, RotateCcw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { KeyMessageVoice } from "./use-key-voice-queue";
import type { KeyChatMessage } from "./types";

interface KeyMessageBubbleProps {
  message: KeyChatMessage;
  isStreaming?: boolean;
  isGrouped?: boolean;
  onCopy?: (text: string) => void;
  onRegenerate?: () => void;
  children?: React.ReactNode;
}

function formatTime(timestamp: number) {
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function KeyMessageBubble({
  message,
  isStreaming,
  isGrouped,
  onCopy,
  onRegenerate,
  children,
}: KeyMessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  const handleCopy = useCallback(() => {
    if (!message.content) return;
    void navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    onCopy?.(message.content);
  }, [message.content, onCopy]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex w-full max-w-3xl", isUser ? "justify-end" : "justify-start")}
    >
      <div className={cn("flex gap-2.5 max-w-[90%] sm:max-w-[85%]", isUser ? "flex-row-reverse" : "flex-row")}>
        {/* Avatar */}
        {!isGrouped && (
          <div
            className={cn(
              "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-1",
              isUser ? "bg-primary/10" : "bg-gradient-to-br from-violet/20 to-primary/20",
            )}
          >
            {isUser ? (
              <User className="w-3.5 h-3.5 text-primary" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-violet" />
            )}
          </div>
        )}

        <div className={cn("flex flex-col min-w-0", isUser ? "items-end" : "items-start")}>
          {/* Bubble */}
          <div
            className={cn(
              "relative px-3.5 py-2.5 text-sm leading-relaxed rounded-2xl border",
              isUser
                ? "rounded-tr-sm bg-primary text-primary-foreground border-primary"
                : "rounded-tl-sm bg-card border-border shadow-sm",
            )}
          >
            {children ?? message.content}
            {isStreaming && (
              <span className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-current opacity-60 animate-pulse" />
            )}
          </div>

          {/* Meta row */}
          <div className="flex items-center gap-2 mt-1 px-1">
            <span className="text-[10px] text-muted-foreground">{formatTime(message.timestamp)}</span>
            {isAssistant && !isStreaming && (
              <>
                <KeyMessageVoice messageId={message.id} text={message.content} />
                <button
                  onClick={handleCopy}
                  className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
                  aria-label="Copy message"
                >
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied ? "Copied" : "Copy"}
                </button>
                {onRegenerate && (
                  <button
                    onClick={onRegenerate}
                    className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
                    aria-label="Regenerate response"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Regenerate
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
