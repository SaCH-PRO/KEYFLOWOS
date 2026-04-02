"use client";

import { useRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, X, Loader2, CornerDownLeft } from "lucide-react";
import type { ChatMessage } from "./types";

interface AiChatDrawerProps {
  open: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  sending: boolean;
  quickPrompts?: string[];
  onQuickPrompt?: (text: string) => void;
  moduleLabel?: string;
}

export function AiChatDrawer({ open, onClose, messages, sending, quickPrompts, onQuickPrompt, moduleLabel }: AiChatDrawerProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const visible = open && messages.length > 0;

  const handleSendInput = () => {
    if (!inputValue.trim() || !onQuickPrompt) return;
    onQuickPrompt(inputValue.trim());
    setInputValue("");
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex justify-end"
        >
          <div className="absolute inset-0 bg-black/40" onClick={onClose} />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="relative w-full max-w-md bg-card border-l border-border shadow-xl flex flex-col"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <div
                  className="h-5 w-5 rounded flex items-center justify-center"
                  style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
                >
                  <Brain className="w-3 h-3" style={{ color: "hsl(var(--kf-accent1))" }} />
                </div>
                <span className="text-xs font-medium text-muted-foreground">KeyFlow AI</span>
                {moduleLabel && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] font-medium">
                    {moduleLabel}
                  </span>
                )}
                {sending && (
                  <span className="text-[10px] text-muted-foreground/60 animate-pulse">Thinking...</span>
                )}
              </div>
              <button
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground p-1.5 kf-radius-sm hover:bg-muted/30 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {messages.map((msg, i) => (
                <ChatBubble key={i} message={msg} />
              ))}
              {sending && <TypingIndicator />}
              <div ref={messagesEndRef} />
            </div>

            {quickPrompts && quickPrompts.length > 0 && (
              <div className="px-4 py-2 border-t border-border/30 flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-muted-foreground/60 font-medium">Suggested</span>
                {quickPrompts.slice(0, 3).map((q) => (
                  <button
                    key={q}
                    onClick={() => onQuickPrompt?.(q)}
                    disabled={sending}
                    className="text-[11px] px-2.5 py-1 rounded-lg border border-border/50 text-muted-foreground hover:text-foreground hover:border-[hsl(var(--kf-accent1))]/30 transition-all disabled:opacity-40"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {onQuickPrompt && (
              <div className="px-4 py-3 border-t border-border">
                <div className="flex items-center gap-2">
                  <input
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendInput()}
                    placeholder="Ask a follow-up..."
                    className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/50"
                    disabled={sending}
                  />
                  <button
                    onClick={handleSendInput}
                    disabled={sending || !inputValue.trim()}
                    className="p-1.5 rounded-md transition-all disabled:opacity-30"
                    style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-foreground))" }}
                  >
                    {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CornerDownLeft className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={isUser
          ? "max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-relaxed bg-muted border border-border"
          : "max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-relaxed"
        }
        style={!isUser
          ? { background: "hsl(var(--kf-accent1) / 0.06)", border: "1px solid hsl(var(--kf-accent1) / 0.1)" }
          : undefined
        }
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div
        className="rounded-lg px-3.5 py-2.5 flex items-center gap-1.5"
        style={{ background: "hsl(var(--kf-accent1) / 0.06)", border: "1px solid hsl(var(--kf-accent1) / 0.1)" }}
      >
        {[0, 0.2, 0.4].map((delay) => (
          <span
            key={delay}
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ backgroundColor: "hsl(var(--kf-accent2))", animationDelay: `${delay}s` }}
          />
        ))}
      </div>
    </div>
  );
}
