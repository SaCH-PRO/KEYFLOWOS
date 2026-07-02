"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { getApiBase } from "@/lib/api-base";
import {
  Bot,
  X,
  Send,
  Paperclip,
  Maximize2,
  Minimize2,
  Sparkles,
  Loader2,
  TrendingUp,
  Users,
  FileText,
  DollarSign,
  Zap,
  CircleDot,
  UserCircle,
  Volume2,
  VolumeX,
  ArrowUpRight,
} from "lucide-react";
import { KeyVoiceButton } from "./KeyVoiceButton";
import { useTts } from "@/components/tts";

const API_BASE = getApiBase();

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type KeyStatus = "idle" | "thinking" | "executing" | "streaming" | "error";

export type MessageSender = "user" | "key" | "system";

export interface KeyMessage {
  id: string;
  sender: MessageSender;
  content: string;
  timestamp: string;
  status?: KeyStatus;
  metadata?: {
    personality?: string;
    model?: string;
    toolsUsed?: string[];
    executionResult?: Record<string, unknown>;
  };
  quickActions?: string[];
}

export interface KeyCommandCenterProps {
  businessId?: string;
  userName?: string;
  initialOpen?: boolean;
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function statusLabel(status: KeyStatus): string {
  switch (status) {
    case "thinking":
      return "KEY is thinking...";
    case "executing":
      return "KEY is executing...";
    case "streaming":
      return "KEY is responding...";
    case "error":
      return "Something went wrong";
    default:
      return "";
  }
}

function statusColor(status: KeyStatus): string {
  switch (status) {
    case "thinking":
      return "text-amber-400";
    case "executing":
      return "text-cyan-400";
    case "streaming":
      return "text-emerald-400";
    case "error":
      return "text-red-400";
    default:
      return "text-muted-foreground";
  }
}

const QUICK_ACTIONS = [
  { label: "What's my revenue?", icon: DollarSign },
  { label: "Follow up with leads", icon: Users },
  { label: "Draft an invoice", icon: FileText },
  { label: "Optimize workflows", icon: Zap },
  { label: "Growth opportunities", icon: TrendingUp },
  { label: "Summarize today", icon: Sparkles },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function KeyCommandCenter({
  businessId,
  userName = "there",
  initialOpen = false,
  className = "",
}: KeyCommandCenterProps) {
  const [isOpen, setIsOpen] = useState(initialOpen);
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<KeyMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const { engine, state: ttsState } = useTts();
  const [keyStatus, setKeyStatus] = useState<KeyStatus>("idle");
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /* Auto-scroll to bottom */
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, keyStatus, scrollToBottom]);

  /* Focus input when opened */
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  /* ---------------------------------------------------------------- */
  /*  Fetch message history                                             */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    if (!businessId || !isOpen) return;

    let cancelled = false;
    setIsLoadingHistory(true);

    fetch(`${API_BASE}/api/v1/cortex/messages?businessId=${businessId}`, {
      credentials: "include",
    })
      .then((res) => res.json())
      .then((data: { messages?: KeyMessage[] }) => {
        if (cancelled) return;
        if (data.messages?.length) {
          setMessages(data.messages);
        } else {
          // Welcome message
          setMessages([
            {
              id: generateId(),
              sender: "key",
              content: `Hey ${userName}! I'm KEY, your AI co-founder. Ask me anything about your business -- revenue, leads, tasks, or just tell me what you need done.`,
              timestamp: new Date().toISOString(),
              metadata: { personality: "default", model: "gpt-4o" },
              quickActions: QUICK_ACTIONS.map((a) => a.label),
            },
          ]);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setMessages([
          {
            id: generateId(),
            sender: "key",
            content: `Hey ${userName}! I'm KEY, your AI co-founder. Ask me anything about your business.`,
            timestamp: new Date().toISOString(),
            metadata: { personality: "default", model: "gpt-4o" },
            quickActions: QUICK_ACTIONS.map((a) => a.label),
          },
        ]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [businessId, isOpen, userName]);

  /* ---------------------------------------------------------------- */
  /*  SSE streaming for real-time responses                             */
  /* ---------------------------------------------------------------- */
  const connectSSE = useCallback(() => {
    if (!businessId) return;
    if (sseRef.current) sseRef.current.close();

    const url = `${API_BASE}/api/v1/cortex/stream?businessId=${businessId}`;
    const evtSource = new EventSource(url, { withCredentials: true });

    evtSource.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data) as {
          type: string;
          content?: string;
          messageId?: string;
          metadata?: KeyMessage["metadata"];
          status?: KeyStatus;
        };

        if (data.type === "chunk" && data.content) {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.sender === "key" && last.id === data.messageId) {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...last,
                content: last.content + data.content,
              };
              return updated;
            }
            return prev;
          });
        } else if (data.type === "status" && data.status) {
          setKeyStatus(data.status);
        } else if (data.type === "complete") {
          setKeyStatus("idle");
          sseRef.current?.close();
          sseRef.current = null;
        }
      } catch {
        // Ignore malformed SSE data
      }
    };

    evtSource.onerror = () => {
      evtSource.close();
    };

    sseRef.current = evtSource;
  }, [businessId]);

  useEffect(() => {
    return () => {
      sseRef.current?.close();
      abortControllerRef.current?.abort();
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Send message                                                      */
  /* ---------------------------------------------------------------- */
  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || !businessId) return;

      const userMsg: KeyMessage = {
        id: generateId(),
        sender: "user",
        content: text.trim(),
        timestamp: new Date().toISOString(),
      };

      const keyMsgId = generateId();
      const keyMsg: KeyMessage = {
        id: keyMsgId,
        sender: "key",
        content: "",
        timestamp: new Date().toISOString(),
        status: "thinking",
      };

      setMessages((prev) => [...prev, userMsg, keyMsg]);
      setInputValue("");
      setKeyStatus("thinking");
      setShowQuickActions(false);
      setUnreadCount((c) => c + 1);

      // Start SSE for streaming
      connectSSE();

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const res = await fetch(`${API_BASE}/api/v1/cortex/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            businessId,
            message: text.trim(),
            messageId: keyMsgId,
            stream: true,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = (await res.json()) as {
          response?: string;
          metadata?: KeyMessage["metadata"];
          quickActions?: string[];
          status?: KeyStatus;
        };

        setMessages((prev) => {
          const updated = [...prev];
          const idx = updated.findIndex((m) => m.id === keyMsgId);
          if (idx !== -1) {
            updated[idx] = {
              ...updated[idx],
              content: data.response || updated[idx].content || "I'm on it.",
              metadata: data.metadata,
              quickActions: data.quickActions,
              status: undefined,
            };
          }
          return updated;
        });

        setKeyStatus(data.status || "idle");
      } catch (err) {
        if ((err as Error).name === "AbortError") return;

        setMessages((prev) => {
          const updated = [...prev];
          const idx = updated.findIndex((m) => m.id === keyMsgId);
          if (idx !== -1) {
            updated[idx] = {
              ...updated[idx],
              content: "Sorry, I ran into an issue. Let me try again.",
              status: undefined,
            };
          }
          return updated;
        });
        setKeyStatus("error");
      }
    },
    [businessId, connectSSE]
  );

  /* ---------------------------------------------------------------- */
  /*  Handle submit                                                     */
  /* ---------------------------------------------------------------- */
  const handleSubmit = useCallback(() => {
    if (!inputValue.trim() || keyStatus !== "idle") return;
    void sendMessage(inputValue);
  }, [inputValue, keyStatus, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  /* ---------------------------------------------------------------- */
  /*  Quick action click                                                */
  /* ---------------------------------------------------------------- */
  const handleQuickAction = useCallback(
    (action: string) => {
      void sendMessage(action);
    },
    [sendMessage]
  );

  /* ---------------------------------------------------------------- */
  /*  Voice transcript callback                                         */
  /* ---------------------------------------------------------------- */
  const handleVoiceTranscript = useCallback(
    (transcript: string) => {
      setInputValue((prev) => (prev ? prev + " " + transcript : transcript));
      inputRef.current?.focus();
    },
    []
  );

  /* ---------------------------------------------------------------- */
  /*  Toggle mute                                                       */
  /* ---------------------------------------------------------------- */
  const toggleMute = useCallback(() => {
    engine.toggleMuted();
  }, [engine]);

  /* ---------------------------------------------------------------- */
  /*  Mark read on open                                                 */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    if (isOpen) setUnreadCount(0);
  }, [isOpen]);

  /* ---------------------------------------------------------------- */
  /*  Click outside to close (compact mode only)                        */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    if (!isOpen || isExpanded) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen, isExpanded]);

  /* ============ Collapsed FAB ============ */
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-full bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(173_58%_39%)] text-white font-medium shadow-lg hover:shadow-xl hover:scale-105 transition-all ${className}`}
      >
        <Bot className="w-5 h-5" />
        <span className="hidden sm:inline">Ask KEY</span>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-[10px] font-bold flex items-center justify-center">
            {unreadCount}
          </span>
        )}
      </button>
    );
  }

  /* ============ Panel / Dashboard ============ */
  return (
    <div
      ref={containerRef}
      className={`fixed z-50 flex flex-col overflow-hidden border border-white/[0.08] bg-[hsl(20_14%_6%)] shadow-2xl rounded-2xl transition-all duration-300 ${
        isExpanded
          ? "inset-4 sm:inset-6 lg:inset-8 rounded-3xl"
          : "bottom-6 right-6 w-[420px] max-w-[calc(100vw-2rem)] h-[640px] max-h-[calc(100vh-4rem)]"
      } ${className}`}
    >
      {/* ---- Header ---- */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-[hsl(24_95%_53%)] to-[hsl(173_58%_39%)]">
            <Bot className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[hsl(30_20%_98%)]">KEY</h3>
              <CircleDot className={`w-3 h-3 ${statusColor(keyStatus)}`} />
            </div>
            <p className="text-[10px] text-[hsl(30_10%_50%)] truncate">
              {statusLabel(keyStatus) || "Your AI co-founder"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={toggleMute}
            className="p-1.5 rounded-lg hover:bg-white/[0.05] text-[hsl(30_10%_50%)] transition-colors"
            title={ttsState.muted ? "Unmute voice" : "Mute voice"}
          >
            {ttsState.muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setIsExpanded((e) => !e)}
            className="p-1.5 rounded-lg hover:bg-white/[0.05] text-[hsl(30_10%_50%)] transition-colors"
            title={isExpanded ? "Minimize" : "Expand"}
          >
            {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button
            onClick={() => {
              setIsOpen(false);
              setIsExpanded(false);
            }}
            className="p-1.5 rounded-lg hover:bg-white/[0.05] text-[hsl(30_10%_50%)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ---- Messages ---- */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
        {isLoadingHistory ? (
          <div className="flex items-center justify-center py-12 gap-2 text-[hsl(30_10%_50%)]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading conversation...</span>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={`flex gap-2.5 ${msg.sender === "user" ? "flex-row-reverse" : ""}`}
              >
                {/* Avatar */}
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    msg.sender === "user"
                      ? "bg-white/[0.08]"
                      : "bg-gradient-to-br from-[hsl(24_95%_53%)] to-[hsl(173_58%_39%)]"
                  }`}
                >
                  {msg.sender === "user" ? (
                    <UserCircle className="w-4 h-4 text-[hsl(30_20%_98%)]" />
                  ) : (
                    <Bot className="w-4 h-4 text-white" />
                  )}
                </div>

                {/* Bubble */}
                <div className={`flex-1 min-w-0 ${msg.sender === "user" ? "text-right" : ""}`}>
                  <div
                    className={`inline-block text-left px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed max-w-[85%] ${
                      msg.sender === "user"
                        ? "bg-[hsl(24_95%_53%)] text-white rounded-tr-sm"
                        : "bg-white/[0.04] border border-white/[0.06] text-[hsl(30_20%_98%)] rounded-tl-sm"
                    }`}
                  >
                    {msg.content || (msg.status ? "..." : "")}

                    {/* Metadata badges */}
                    {msg.metadata && (
                      <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-white/[0.04]">
                        {msg.metadata.personality && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-[hsl(30_10%_50%)]">
                            {msg.metadata.personality}
                          </span>
                        )}
                        {msg.metadata.model && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-[hsl(30_10%_50%)]">
                            {msg.metadata.model}
                          </span>
                        )}
                        {msg.metadata.toolsUsed && msg.metadata.toolsUsed.length > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">
                            {msg.metadata.toolsUsed.length} tool{msg.metadata.toolsUsed.length > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Timestamp */}
                  <p className="text-[10px] text-[hsl(30_10%_40%)] mt-1 px-1">
                    {format(new Date(msg.timestamp), "h:mm a")}
                  </p>

                  {/* Quick actions for KEY messages */}
                  {msg.sender === "key" && msg.quickActions && msg.quickActions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {msg.quickActions.slice(0, 4).map((action) => (
                        <button
                          key={action}
                          onClick={() => handleQuickAction(action)}
                          className="text-[11px] px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-[hsl(30_10%_55%)] hover:bg-white/[0.08] hover:text-[hsl(30_20%_98%)] transition-colors flex items-center gap-1"
                        >
                          <ArrowUpRight className="w-3 h-3" />
                          {action}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}

        {/* Typing indicator */}
        {keyStatus !== "idle" && keyStatus !== "error" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 px-1"
          >
            <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-gradient-to-br from-[hsl(24_95%_53%)] to-[hsl(173_58%_39%)]">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div className="flex items-center gap-1 px-3 py-2 rounded-2xl bg-white/[0.04] border border-white/[0.06]">
              <span className="w-1.5 h-1.5 rounded-full bg-[hsl(24_95%_53%)] animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-[hsl(24_95%_53%)] animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-[hsl(24_95%_53%)] animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ---- Quick Actions (when no messages yet) ---- */}
      {showQuickActions && messages.length <= 1 && (
        <div className="shrink-0 px-4 pb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-[hsl(30_10%_50%)]">
              Quick Actions
            </span>
            <button
              onClick={() => setShowQuickActions(false)}
              className="text-[10px] text-[hsl(30_10%_40%)] hover:text-[hsl(30_20%_98%)]"
            >
              Hide
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {QUICK_ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.label}
                  onClick={() => handleQuickAction(action.label)}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.1] transition-all text-left group"
                >
                  <Icon className="w-3.5 h-3.5 text-[hsl(24_95%_53%)] group-hover:scale-110 transition-transform" />
                  <span className="text-[11px] text-[hsl(30_10%_55%)] group-hover:text-[hsl(30_20%_98%)] truncate">
                    {action.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ---- Input Bar ---- */}
      <div className="shrink-0 px-3 py-3 border-t border-white/[0.06] bg-white/[0.02]">
        <div className="flex items-end gap-2">
          <button
            className="p-2 rounded-xl hover:bg-white/[0.05] text-[hsl(30_10%_50%)] transition-colors flex-shrink-0"
            title="Attach file"
            onClick={() => {
              /* placeholder -- triggers file picker */
            }}
          >
            <Paperclip className="w-4 h-4" />
          </button>

          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask KEY anything..."
              rows={1}
              className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none resize-none bg-white/[0.04] border border-white/[0.08] text-[hsl(30_20%_98%)] placeholder:text-[hsl(30_10%_30%)] focus:border-[hsl(24_95%_53%/0.5)] focus:ring-1 focus:ring-[hsl(24_95%_53%/0.25)] max-h-32"
            />
          </div>

          <KeyVoiceButton
            businessId={businessId}
            onTranscript={handleVoiceTranscript}
            size="sm"
          />

          <button
            onClick={handleSubmit}
            disabled={!inputValue.trim() || keyStatus !== "idle"}
            className="p-2.5 rounded-xl bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(24_95%_45%)] text-white hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex-shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
