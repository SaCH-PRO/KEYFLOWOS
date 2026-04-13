"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Loader2,
  CornerDownLeft,
  Zap,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { sendFlowChat, confirmFlowAction } from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import type { FlowChatResponse, FlowPendingConfirmation, FlowToolResult } from "@/lib/client";

export interface FlowMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolResults?: FlowToolResult[];
  pendingConfirmations?: FlowPendingConfirmation[];
  requiresConfirmation?: boolean;
  timestamp: Date;
  status?: "sending" | "done" | "error";
}

interface FlowChatPanelProps {
  open: boolean;
  onClose: () => void;
}

const FLOW_WELCOME: FlowMessage = {
  id: "welcome",
  role: "assistant",
  content: "Hey! I'm Flow, your AI assistant. I can take real actions for you — create contacts, send invoices, book appointments, draft campaigns, and more. Just tell me what you need.",
  timestamp: new Date(),
  status: "done",
};

const SUGGESTED_PROMPTS = [
  "Create a contact for John Smith, email john@example.com",
  "Show me my outstanding invoices",
  "What bookings do I have coming up?",
  "Create an invoice for $500 for my last client",
  "Draft a social media post for my business",
];

function formatToolName(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/crm |commerce |bookings |marketing |social |automations /, "")
    .replace(/^./, (c) => c.toUpperCase());
}

function ToolResultBadge({ result }: { result: FlowToolResult }) {
  if (result.success) {
    return (
      <div className="flex items-center gap-1.5 mt-1.5 px-2 py-1 rounded-md text-[11px]"
        style={{ background: "hsl(var(--kf-success) / 0.08)", border: "1px solid hsl(var(--kf-success) / 0.2)" }}>
        <CheckCircle2 className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(var(--kf-success))" }} />
        <span style={{ color: "hsl(var(--kf-success))" }}>{formatToolName(result.name)} completed</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 mt-1.5 px-2 py-1 rounded-md text-[11px]"
      style={{ background: "hsl(var(--kf-error) / 0.08)", border: "1px solid hsl(var(--kf-error) / 0.2)" }}>
      <AlertTriangle className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(var(--kf-error))" }} />
      <span style={{ color: "hsl(var(--kf-error))" }}>{result.error || "Action failed"}</span>
    </div>
  );
}

function ConfirmationCard({
  confirmation,
  onConfirm,
  onCancel,
  disabled,
}: {
  confirmation: FlowPendingConfirmation;
  onConfirm: () => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const riskColors = {
    low: "hsl(var(--kf-success))",
    medium: "hsl(var(--kf-warning, 38 92% 50%))",
    high: "hsl(var(--kf-error))",
  };
  const color = riskColors[confirmation.riskLevel] || riskColors.medium;

  return (
    <div className="mt-2 rounded-lg p-3 border"
      style={{ background: "hsl(var(--kf-error) / 0.04)", borderColor: "hsl(var(--kf-error) / 0.2)" }}>
      <div className="flex items-start gap-2 mb-2">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color }} />
        <div>
          <p className="text-[11px] font-medium" style={{ color }}>Confirmation required</p>
          <p className="text-[12px] text-foreground mt-0.5">{confirmation.description}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={onConfirm}
          disabled={disabled}
          className="flex-1 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all disabled:opacity-40"
          style={{ background: "hsl(var(--kf-error))", color: "white" }}
        >
          Confirm
        </button>
        <button
          onClick={onCancel}
          disabled={disabled}
          className="flex-1 px-3 py-1.5 rounded-md text-[12px] font-medium border transition-all disabled:opacity-40 hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function FlowBubble({
  message,
  onConfirm,
  onCancel,
  disabled,
}: {
  message: FlowMessage;
  onConfirm?: (confirmation: FlowPendingConfirmation) => void;
  onCancel?: (confirmation: FlowPendingConfirmation) => void;
  disabled: boolean;
}) {
  const isUser = message.role === "user";

  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div className={`max-w-[90%] ${!isUser ? "w-full" : ""}`}>
        {!isUser && (
          <div className="flex items-center gap-1.5 mb-1">
            <div className="w-4 h-4 rounded flex items-center justify-center"
              style={{ background: "hsl(var(--kf-accent1) / 0.15)" }}>
              <Zap className="w-2.5 h-2.5" style={{ color: "hsl(var(--kf-accent1))" }} />
            </div>
            <span className="text-[10px] font-medium" style={{ color: "hsl(var(--kf-accent1))" }}>Flow</span>
          </div>
        )}
        <div
          className="rounded-xl px-3 py-2 text-[13px] leading-relaxed"
          style={isUser
            ? { background: "hsl(var(--kf-accent1) / 0.12)", border: "1px solid hsl(var(--kf-accent1) / 0.2)" }
            : { background: "hsl(var(--muted) / 0.5)", border: "1px solid hsl(var(--border) / 0.5)" }
          }
        >
          <p className="whitespace-pre-wrap">{message.content}</p>
          {message.toolResults && message.toolResults.length > 0 && (
            <div className="mt-1">
              {message.toolResults.map((r, i) => (
                <ToolResultBadge key={i} result={r} />
              ))}
            </div>
          )}
          {message.requiresConfirmation && message.pendingConfirmations && onConfirm && onCancel && (
            <div>
              {message.pendingConfirmations.map((c) => (
                <ConfirmationCard
                  key={c.toolCallId}
                  confirmation={c}
                  onConfirm={() => onConfirm(c)}
                  onCancel={() => onCancel(c)}
                  disabled={disabled}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1.5 mb-1">
        <div className="w-4 h-4 rounded flex items-center justify-center"
          style={{ background: "hsl(var(--kf-accent1) / 0.15)" }}>
          <Zap className="w-2.5 h-2.5" style={{ color: "hsl(var(--kf-accent1))" }} />
        </div>
      </div>
      <div
        className="ml-1 rounded-xl px-3.5 py-2.5 flex items-center gap-1.5"
        style={{ background: "hsl(var(--muted) / 0.5)", border: "1px solid hsl(var(--border) / 0.5)" }}
      >
        {[0, 0.2, 0.4].map((delay) => (
          <span
            key={delay}
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ backgroundColor: "hsl(var(--kf-accent1))", animationDelay: `${delay}s` }}
          />
        ))}
      </div>
    </div>
  );
}

export function FlowChatPanel({ open, onClose }: FlowChatPanelProps) {
  const [messages, setMessages] = useState<FlowMessage[]>([FLOW_WELCOME]);
  const [inputValue, setInputValue] = useState("");
  const [sending, setSending] = useState(false);
  const [showSuggested, setShowSuggested] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  const handleSend = useCallback(async (text?: string) => {
    const messageText = text ?? inputValue.trim();
    if (!messageText || sending) return;
    const businessId = getStoredBusinessId();
    if (!businessId) return;

    setShowSuggested(false);
    setInputValue("");

    const userMsg: FlowMessage = {
      id: `user_${Date.now()}`,
      role: "user",
      content: messageText,
      timestamp: new Date(),
      status: "done",
    };
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);

    const historyForApi = messages
      .filter((m) => m.id !== "welcome")
      .map((m) => ({ role: m.role, content: m.content }));
    historyForApi.push({ role: "user", content: messageText });

    try {
      const res = await sendFlowChat(businessId, messageText, historyForApi.slice(0, -1));
      if (res.error || !res.data) {
        setMessages((prev) => [...prev, {
          id: `err_${Date.now()}`,
          role: "assistant",
          content: "Something went wrong. Please try again in a moment.",
          timestamp: new Date(),
          status: "error",
        }]);
      } else {
        const data = res.data;
        setMessages((prev) => [...prev, {
          id: `flow_${Date.now()}`,
          role: "assistant",
          content: data.reply,
          toolResults: data.toolResults,
          pendingConfirmations: data.pendingConfirmations,
          requiresConfirmation: data.requiresConfirmation,
          timestamp: new Date(),
          status: "done",
        }]);
      }
    } catch {
      setMessages((prev) => [...prev, {
        id: `err_${Date.now()}`,
        role: "assistant",
        content: "Something went wrong. Please try again.",
        timestamp: new Date(),
        status: "error",
      }]);
    } finally {
      setSending(false);
    }
  }, [inputValue, sending, messages]);

  const handleConfirm = useCallback(async (confirmation: FlowPendingConfirmation) => {
    const businessId = getStoredBusinessId();
    if (!businessId || sending) return;

    setMessages((prev) =>
      prev.map((m) =>
        m.requiresConfirmation
          ? { ...m, requiresConfirmation: false, pendingConfirmations: [] }
          : m,
      ),
    );

    setSending(true);
    try {
      const res = await confirmFlowAction(
        businessId,
        confirmation.toolCallId,
        confirmation.name,
        confirmation.arguments,
        true,
      );
      if (res.data) {
        setMessages((prev) => [...prev, {
          id: `flow_${Date.now()}`,
          role: "assistant",
          content: res.data!.reply,
          toolResults: res.data!.toolResults,
          timestamp: new Date(),
          status: "done",
        }]);
      }
    } catch {
      setMessages((prev) => [...prev, {
        id: `err_${Date.now()}`,
        role: "assistant",
        content: "Action failed. Please try again.",
        timestamp: new Date(),
        status: "error",
      }]);
    } finally {
      setSending(false);
    }
  }, [sending]);

  const handleCancel = useCallback(async (confirmation: FlowPendingConfirmation) => {
    const businessId = getStoredBusinessId();
    if (!businessId || sending) return;

    setMessages((prev) =>
      prev.map((m) =>
        m.requiresConfirmation
          ? { ...m, requiresConfirmation: false, pendingConfirmations: [] }
          : m,
      ),
    );

    setSending(true);
    try {
      const res = await confirmFlowAction(
        businessId,
        confirmation.toolCallId,
        confirmation.name,
        confirmation.arguments,
        false,
      );
      if (res.data) {
        setMessages((prev) => [...prev, {
          id: `flow_${Date.now()}`,
          role: "assistant",
          content: res.data!.reply,
          timestamp: new Date(),
          status: "done",
        }]);
      }
    } catch {
      setMessages((prev) => [...prev, {
        id: `cancel_${Date.now()}`,
        role: "assistant",
        content: "Got it — cancelled. Let me know if there's anything else.",
        timestamp: new Date(),
        status: "done",
      }]);
    } finally {
      setSending(false);
    }
  }, [sending]);

  const handleReset = () => {
    setMessages([FLOW_WELCOME]);
    setShowSuggested(true);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex justify-end"
        >
          <div className="absolute inset-0 bg-black/30" onClick={onClose} />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className="relative w-full max-w-[420px] flex flex-col"
            style={{ background: "hsl(var(--background))", borderLeft: "1px solid hsl(var(--border))" }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}>
                  <Zap className="w-4 h-4 text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold">Flow</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                      style={{ background: "hsl(var(--kf-accent1) / 0.1)", color: "hsl(var(--kf-accent1))" }}>
                      AI Agent
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Takes real actions on your behalf</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleReset}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="New conversation"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
              {messages.map((msg) => (
                <FlowBubble
                  key={msg.id}
                  message={msg}
                  onConfirm={handleConfirm}
                  onCancel={handleCancel}
                  disabled={sending}
                />
              ))}
              {sending && <TypingIndicator />}
              <div ref={messagesEndRef} />
            </div>

            {showSuggested && messages.length === 1 && (
              <div className="px-4 py-2 border-t border-border/50 shrink-0">
                <p className="text-[10px] text-muted-foreground mb-2 font-medium flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  Try asking
                </p>
                <div className="flex flex-col gap-1.5">
                  {SUGGESTED_PROMPTS.slice(0, 3).map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => handleSend(prompt)}
                      disabled={sending}
                      className="text-left text-[12px] px-2.5 py-1.5 rounded-lg border border-border/50 text-muted-foreground hover:text-foreground hover:border-[hsl(var(--kf-accent1))]/40 transition-all disabled:opacity-40 flex items-center gap-1.5"
                    >
                      <ChevronRight className="w-3 h-3 flex-shrink-0" />
                      <span>{prompt}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="px-4 py-3 border-t border-border shrink-0">
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border bg-muted/30 focus-within:border-[hsl(var(--kf-accent1))]/40 transition-colors">
                <input
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Tell Flow what to do..."
                  className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/50 min-w-0"
                  disabled={sending}
                />
                <button
                  onClick={() => handleSend()}
                  disabled={sending || !inputValue.trim()}
                  className="p-1.5 rounded-lg transition-all disabled:opacity-30 flex-shrink-0"
                  style={{ background: "hsl(var(--kf-accent1))", color: "white" }}
                >
                  {sending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CornerDownLeft className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function FlowTriggerButton({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg transition-all"
      style={{
        background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
        boxShadow: "0 4px 20px hsl(var(--kf-accent1) / 0.4)",
      }}
      aria-label="Open Flow AI"
      title="Open Flow AI"
    >
      <Zap className="w-6 h-6 text-white" />
    </motion.button>
  );
}
