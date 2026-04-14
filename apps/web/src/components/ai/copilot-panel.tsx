"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  Brain, X, Send, Loader2, Sparkles, ArrowRight,
  Activity, Shield, CheckCircle2,
  ChevronRight, Settings,
} from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  sendFlowChat,
  fetchAiPendingApprovals,
  fetchAiExecutionStats,
  resolveAiApproval,
  type AiApprovalItem,
  type AiExecutionStats,
} from "@/lib/client";
import { VerificationCardCompact } from "./verification-card";

type Tab = "chat" | "queue" | "activity";

interface CopilotMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface CopilotPanelProps {
  open: boolean;
  onClose: () => void;
}

const QUICK_PROMPTS = [
  { label: "Business overview", prompt: "Give me a quick business overview" },
  { label: "Today's priorities", prompt: "What should I focus on today?" },
  { label: "Revenue summary", prompt: "How is my revenue performing?" },
  { label: "Pending tasks", prompt: "Show me what needs my attention" },
];

export function CopilotPanel({ open, onClose }: CopilotPanelProps) {
  const [tab, setTab] = useState<Tab>("chat");
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<AiApprovalItem[]>([]);
  const [stats, setStats] = useState<AiExecutionStats | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 300);
      loadSidebarData();
    }
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadSidebarData = useCallback(async () => {
    const biz = getStoredBusinessId();
    if (!biz) return;
    try {
      const [approvalRes, statsRes] = await Promise.all([
        fetchAiPendingApprovals(biz),
        fetchAiExecutionStats(biz, 7),
      ]);
      if (approvalRes.data) setPendingApprovals(approvalRes.data.filter(a => a.status === "pending"));
      if (statsRes.data) setStats(statsRes.data);
    } catch {
      /* silently fail on sidebar data load */
    }
  }, []);

  const handleSend = useCallback(async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || sending) return;
    const biz = getStoredBusinessId();
    if (!biz) return;

    setInput("");
    const userMsg: CopilotMessage = { role: "user", content: msg, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setSending(true);

    const history = messages.map(m => ({ role: m.role, content: m.content }));
    try {
      const res = await sendFlowChat(biz, msg, history);
      if (res.data) {
        setMessages(prev => [...prev, { role: "assistant", content: res.data!.reply, timestamp: Date.now() }]);
      } else {
        setMessages(prev => [...prev, { role: "assistant", content: "Sorry, I encountered an error. Please try again.", timestamp: Date.now() }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Sorry, I encountered an error. Please try again.", timestamp: Date.now() }]);
    } finally {
      setSending(false);
    }
  }, [input, sending, messages]);

  const handleApprove = useCallback(async (id: string) => {
    const biz = getStoredBusinessId();
    if (!biz) return;
    setResolvingId(id);
    try {
      const res = await resolveAiApproval(biz, id, "approved");
      if (res.data) {
        setPendingApprovals(prev => prev.filter(a => a.id !== id));
        toast.success("Action approved");
      } else {
        toast.error(res.error || "Failed to approve");
      }
    } catch {
      toast.error("Failed to approve action");
    } finally {
      setResolvingId(null);
    }
  }, []);

  const handleReject = useCallback(async (id: string) => {
    const biz = getStoredBusinessId();
    if (!biz) return;
    setResolvingId(id);
    try {
      const res = await resolveAiApproval(biz, id, "rejected");
      if (res.data) {
        setPendingApprovals(prev => prev.filter(a => a.id !== id));
        toast.success("Action rejected");
      } else {
        toast.error(res.error || "Failed to reject");
      }
    } catch {
      toast.error("Failed to reject action");
    } finally {
      setResolvingId(null);
    }
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] bg-black/20 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="AI Copilot"
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed top-0 right-0 bottom-0 z-[91] w-[420px] max-w-[90vw] flex flex-col border-l border-border/40"
            style={{ background: "hsl(var(--kf-sidebar-bg))" }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
                >
                  <Brain className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground/90">AI Copilot</h2>
                  <p className="text-[10px] text-muted-foreground/50">Your business assistant</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Link
                  href="/app/settings/ai-control"
                  className="p-2 rounded-lg text-muted-foreground/50 hover:text-foreground/70 hover:bg-muted/30 transition-colors"
                  title="AI Control Center"
                  aria-label="AI Control Center"
                  onClick={onClose}
                >
                  <Settings className="w-4 h-4" />
                </Link>
                <button
                  onClick={onClose}
                  className="p-2 rounded-lg text-muted-foreground/50 hover:text-foreground/70 hover:bg-muted/30 transition-colors"
                  aria-label="Close copilot"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex items-center border-b border-border/20" role="tablist" aria-label="Copilot sections">
              {([
                { id: "chat" as Tab, label: "Chat", icon: Sparkles },
                { id: "queue" as Tab, label: `Queue${pendingApprovals.length > 0 ? ` (${pendingApprovals.length})` : ""}`, icon: Shield },
                { id: "activity" as Tab, label: "Activity", icon: Activity },
              ]).map(t => (
                <button
                  key={t.id}
                  id={`copilot-tab-${t.id}`}
                  role="tab"
                  aria-selected={tab === t.id}
                  aria-controls={`copilot-panel-${t.id}`}
                  onClick={() => setTab(t.id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-all border-b-2 ${
                    tab === t.id
                      ? "border-[hsl(var(--kf-accent1))] text-foreground/90"
                      : "border-transparent text-muted-foreground/50 hover:text-foreground/70"
                  }`}
                >
                  <t.icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto">
              {tab === "chat" && (
                <div id="copilot-panel-chat" role="tabpanel" aria-labelledby="copilot-tab-chat" className="flex flex-col h-full">
                  <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                    {messages.length === 0 && (
                      <div className="flex flex-col items-center py-8 gap-4">
                        <div
                          className="w-14 h-14 rounded-2xl flex items-center justify-center"
                          style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.15), hsl(var(--kf-accent2) / 0.15))" }}
                        >
                          <Sparkles className="w-6 h-6 text-[hsl(var(--kf-accent1))]" />
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-medium text-foreground/80">How can I help?</p>
                          <p className="text-xs text-muted-foreground/50 mt-1">Ask me anything about your business</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2 w-full max-w-[320px]">
                          {QUICK_PROMPTS.map(qp => (
                            <button
                              key={qp.label}
                              onClick={() => handleSend(qp.prompt)}
                              className="flex items-center gap-2 p-2.5 rounded-xl text-xs text-left text-muted-foreground/70 bg-muted/20 border border-border/30 hover:bg-muted/30 hover:text-foreground/80 transition-all"
                            >
                              <ArrowRight className="w-3 h-3 shrink-0 text-[hsl(var(--kf-accent1))]" />
                              <span>{qp.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {messages.map((msg, i) => (
                      <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                            msg.role === "user"
                              ? "bg-[hsl(var(--kf-accent1))] text-white rounded-br-md"
                              : "bg-muted/30 text-foreground/85 border border-border/20 rounded-bl-md"
                          }`}
                        >
                          {msg.content}
                        </div>
                      </div>
                    ))}

                    {sending && (
                      <div className="flex justify-start">
                        <div className="bg-muted/30 border border-border/20 rounded-2xl rounded-bl-md px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-[hsl(var(--kf-accent1))]" />
                            <span className="text-xs text-muted-foreground/60">Thinking...</span>
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                </div>
              )}

              {tab === "queue" && (
                <div id="copilot-panel-queue" role="tabpanel" aria-labelledby="copilot-tab-queue" className="px-4 py-3 space-y-2">
                  {pendingApprovals.length === 0 ? (
                    <div className="flex flex-col items-center py-8 gap-2">
                      <CheckCircle2 className="w-6 h-6 text-emerald-400/60" />
                      <span className="text-xs text-muted-foreground/50">All clear</span>
                      <p className="text-[10px] text-muted-foreground/40 text-center">No pending approvals</p>
                    </div>
                  ) : (
                    pendingApprovals.map(item => (
                      <VerificationCardCompact
                        key={item.id}
                        item={item}
                        onApprove={handleApprove}
                        onReject={handleReject}
                        loading={resolvingId === item.id}
                      />
                    ))
                  )}
                </div>
              )}

              {tab === "activity" && (
                <div id="copilot-panel-activity" role="tabpanel" aria-labelledby="copilot-tab-activity" className="px-4 py-3 space-y-3">
                  {stats ? (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-3 rounded-xl border border-border/30 bg-card/50">
                          <div className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1">Actions (7d)</div>
                          <div className="text-lg font-bold text-foreground/90">{stats.totalActions}</div>
                        </div>
                        <div className="p-3 rounded-xl border border-border/30 bg-card/50">
                          <div className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1">Success</div>
                          <div className={`text-lg font-bold ${stats.successRate >= 90 ? "text-emerald-400" : stats.successRate >= 70 ? "text-amber-400" : "text-red-400"}`}>
                            {stats.successRate}%
                          </div>
                        </div>
                      </div>
                      {stats.byModule.length > 0 && (
                        <div className="space-y-1.5">
                          <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">By Module</span>
                          {stats.byModule.sort((a, b) => b.count - a.count).map(m => (
                            <div key={m.module} className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-muted/10">
                              <span className="text-xs text-foreground/70">{m.module}</span>
                              <span className="text-xs font-medium text-foreground/90">{m.count}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <Link
                        href="/app/settings/ai-control"
                        onClick={onClose}
                        className="flex items-center justify-center gap-2 p-2.5 rounded-xl text-xs font-medium text-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))/0.08] hover:bg-[hsl(var(--kf-accent1))/0.15] border border-[hsl(var(--kf-accent1))/0.15] transition-all"
                      >
                        View Full History <ChevronRight className="w-3.5 h-3.5" />
                      </Link>
                    </>
                  ) : (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-5 h-5 text-[hsl(var(--kf-accent1))] animate-spin" />
                    </div>
                  )}
                </div>
              )}
            </div>

            {tab === "chat" && (
              <div className="px-4 py-3 border-t border-border/30">
                <div className="flex items-center gap-2 bg-muted/20 border border-border/30 rounded-xl px-3 py-1">
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                    placeholder="Ask anything..."
                    className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none py-2"
                    disabled={sending}
                  />
                  <button
                    onClick={() => handleSend()}
                    disabled={!input.trim() || sending}
                    className="p-2 rounded-lg text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))/0.1] transition-colors disabled:opacity-30"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center justify-center gap-1.5 mt-2">
                  <kbd className="text-[9px] px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground/40 border border-border/20">⌘J</kbd>
                  <span className="text-[9px] text-muted-foreground/30">to toggle</span>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
