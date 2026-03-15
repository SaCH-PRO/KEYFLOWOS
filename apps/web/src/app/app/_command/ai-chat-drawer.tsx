"use client";

import { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, X, Loader2 } from "lucide-react";
import type { ChatMessage } from "./types";

interface AiChatDrawerProps {
  open: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  sending: boolean;
}

export function AiChatDrawer({ open, onClose, messages, sending }: AiChatDrawerProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const visible = open && messages.length > 1;

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
              {messages.slice(1).map((msg, i) => (
                <ChatBubble key={i} message={msg} />
              ))}
              {sending && <TypingIndicator />}
              <div ref={messagesEndRef} />
            </div>
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
