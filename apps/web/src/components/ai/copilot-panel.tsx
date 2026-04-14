"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  Brain, X, Send, Loader2, Sparkles, ArrowRight,
  Activity, Shield, CheckCircle2,
  ChevronRight, Settings, TrendingUp, Calendar, AlertCircle,
  AlertTriangle, Zap, Info,
} from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  sendFlowChat,
  fetchAiPendingApprovals,
  fetchAiExecutionStats,
  resolveAiApproval,
  fetchProAutoInsights,
  fetchProfileStatus,
  sendProfileChat,
  type AiApprovalItem,
  type AiExecutionStats,
  type ProAutoInsight,
  type ProfileStatus,
} from "@/lib/client";
import { VerificationCardCompact } from "./verification-card";

type Tab = "chat" | "queue" | "activity";

interface CopilotMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export type CopilotModule =
  | "cockpit"
  | "crm"
  | "revenue"
  | "calendar"
  | "content"
  | "projects"
  | "expenses"
  | "flows"
  | "settings"
  | "store"
  | "profile"
  | null;

interface CopilotPanelProps {
  open: boolean;
  onClose: () => void;
  currentModule?: CopilotModule;
}

interface QuickPrompt {
  label: string;
  prompt: string;
}

const GLOBAL_PROMPTS: QuickPrompt[] = [
  { label: "Business overview", prompt: "Give me a quick business overview" },
  { label: "Today's priorities", prompt: "What should I focus on today?" },
  { label: "Revenue summary", prompt: "How is my revenue performing?" },
  { label: "Pending tasks", prompt: "Show me what needs my attention" },
];

const MODULE_PROMPTS: Record<string, QuickPrompt[]> = {
  crm: [
    { label: "Follow up stale leads", prompt: "Which leads need follow-up and what should I say?" },
    { label: "Client health check", prompt: "How are my top clients doing? Any at risk?" },
    { label: "Segment contacts", prompt: "Help me segment my contacts for targeted outreach" },
    { label: "Draft outreach", prompt: "Draft a follow-up message for my most promising lead" },
  ],
  revenue: [
    { label: "Overdue invoices", prompt: "Show me all overdue invoices and suggest collection actions" },
    { label: "Revenue forecast", prompt: "What's my revenue forecast for the next 30 days?" },
    { label: "Payment reminders", prompt: "Draft payment reminders for overdue clients" },
    { label: "Pricing advice", prompt: "Should I adjust my pricing? Analyze my current rates" },
  ],
  calendar: [
    { label: "Schedule health", prompt: "How is my calendar utilization this month?" },
    { label: "Booking gaps", prompt: "Where are the gaps in my schedule I should fill?" },
    { label: "Client reminders", prompt: "Send reminders for upcoming appointments" },
    { label: "Optimize hours", prompt: "Suggest better availability hours based on booking patterns" },
  ],
  content: [
    { label: "Content ideas", prompt: "Suggest social media content ideas for this week" },
    { label: "Draft a post", prompt: "Help me write a social media post about my latest service" },
    { label: "Campaign strategy", prompt: "What email campaign should I run next?" },
    { label: "Content calendar", prompt: "Plan my content for the next 2 weeks" },
  ],
  projects: [
    { label: "Project status", prompt: "Give me a status update on all active projects" },
    { label: "Overdue tasks", prompt: "What project tasks are overdue and need attention?" },
    { label: "Risk assessment", prompt: "Which projects are at risk of missing deadlines?" },
    { label: "Bottleneck analysis", prompt: "Where are the bottlenecks in my project delivery?" },
  ],
  expenses: [
    { label: "Spending analysis", prompt: "Analyze my spending patterns this month" },
    { label: "Cost savings", prompt: "Where can I cut costs without impacting quality?" },
    { label: "Budget status", prompt: "How am I tracking against my budget?" },
    { label: "Profit margins", prompt: "What are my profit margins by client and service?" },
  ],
  flows: [
    { label: "Automation health", prompt: "How are my automations performing?" },
    { label: "New flow ideas", prompt: "Suggest automations I should set up for my business" },
    { label: "Flow coverage", prompt: "What business processes am I not automating yet?" },
    { label: "Fix failing flows", prompt: "Are any of my automations failing? Help me fix them" },
  ],
  cockpit: GLOBAL_PROMPTS,
};

const SEVERITY_CONFIG: Record<ProAutoInsight["severity"], { icon: typeof AlertCircle; color: string; bg: string; border: string }> = {
  critical: { icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20" },
  warning: { icon: AlertCircle, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
  opportunity: { icon: Zap, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  info: { icon: Info, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
};

export function CopilotPanel({ open, onClose, currentModule }: CopilotPanelProps) {
  const [tab, setTab] = useState<Tab>("chat");
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<AiApprovalItem[]>([]);
  const [stats, setStats] = useState<AiExecutionStats | null>(null);
  const [insights, setInsights] = useState<ProAutoInsight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [profileStatus, setProfileStatus] = useState<ProfileStatus | null>(null);
  const [profileMode, setProfileMode] = useState(false);
  const [profileSending, setProfileSending] = useState(false);
  const [profileMessages, setProfileMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const quickPrompts = useMemo(() => {
    const module = currentModule || "cockpit";
    return MODULE_PROMPTS[module] || GLOBAL_PROMPTS;
  }, [currentModule]);

  const moduleInsights = useMemo(() => {
    if (!currentModule || currentModule === "cockpit") return insights;
    return insights.filter(i => i.module === currentModule);
  }, [insights, currentModule]);

  const queueInsights = useMemo(() => {
    return insights.filter(i => i.severity === "critical" || i.severity === "warning");
  }, [insights]);

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
    }
  }, []);

  const loadInsights = useCallback(async () => {
    const biz = getStoredBusinessId();
    if (!biz) return;
    setInsightsLoading(true);
    try {
      const res = await fetchProAutoInsights(biz);
      if (res.data?.insights) setInsights(res.data.insights);
    } catch {
    } finally {
      setInsightsLoading(false);
    }
  }, []);

  const loadProfileStatus = useCallback(async () => {
    const biz = getStoredBusinessId();
    if (!biz) return;
    try {
      const res = await fetchProfileStatus(biz);
      if (res.data) setProfileStatus(res.data);
    } catch {}
  }, []);

  const handleProfileSend = useCallback(async (msg: string) => {
    const biz = getStoredBusinessId();
    if (!biz || !msg.trim()) return;
    setProfileMessages(prev => [...prev, { role: "user", content: msg }]);
    setProfileSending(true);
    try {
      const res = await sendProfileChat(biz, msg);
      if (res.data) {
        setProfileMessages(prev => [...prev, { role: "assistant", content: res.data!.reply }]);
        loadProfileStatus();
      }
    } catch {
      toast.error("Failed to process response");
    } finally {
      setProfileSending(false);
    }
  }, [loadProfileStatus]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 300);
      loadSidebarData();
      loadInsights();
      loadProfileStatus();
    }
  }, [open, loadSidebarData, loadInsights, loadProfileStatus]);

  useEffect(() => {
    const handler = () => { loadSidebarData(); };
    window.addEventListener("kf:ai-activity", handler);
    return () => window.removeEventListener("kf:ai-activity", handler);
  }, [loadSidebarData]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

  const displayInsights = currentModule && currentModule !== "cockpit" ? moduleInsights : insights.slice(0, 5);

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
                  <p className="text-[10px] text-muted-foreground/50">
                    {currentModule && currentModule !== "cockpit"
                      ? `Context: ${currentModule.charAt(0).toUpperCase() + currentModule.slice(1)}`
                      : "Your business assistant"}
                  </p>
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
                { id: "queue" as Tab, label: `Queue${(pendingApprovals.length + queueInsights.length) > 0 ? ` (${pendingApprovals.length + queueInsights.length})` : ""}`, icon: Shield },
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
              {tab === "chat" && profileMode && (
                <div id="copilot-panel-profile" role="tabpanel" className="flex flex-col h-full">
                  <div className="flex items-center gap-2 px-4 py-2 border-b border-border/20">
                    <button
                      onClick={() => setProfileMode(false)}
                      className="text-xs text-muted-foreground/60 hover:text-foreground/70 transition-colors"
                    >
                      &larr; Back
                    </button>
                    <Brain className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))]" />
                    <span className="text-xs font-semibold text-foreground/80">Business Profile Interview</span>
                    {profileStatus && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[hsl(var(--kf-accent2)_/_0.15)] text-[hsl(var(--kf-accent2))] font-medium ml-auto">
                        {profileStatus.completionPercent}%
                      </span>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                    {profileMessages.map((msg, i) => (
                      <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                            msg.role === "user"
                              ? "bg-[hsl(var(--kf-accent2))] text-white rounded-br-md"
                              : "bg-muted/30 text-foreground/85 border border-border/20 rounded-bl-md"
                          }`}
                        >
                          {msg.content}
                        </div>
                      </div>
                    ))}
                    {profileSending && (
                      <div className="flex justify-start">
                        <div className="bg-muted/30 border border-border/20 rounded-2xl rounded-bl-md px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-[hsl(var(--kf-accent2))]" />
                            <span className="text-xs text-muted-foreground/60">Learning...</span>
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                  <form
                    onSubmit={(e) => { e.preventDefault(); if (input.trim() && !profileSending) { handleProfileSend(input.trim()); setInput(""); } }}
                    className="p-3 border-t border-border/20"
                  >
                    <div className="flex items-center gap-2 bg-muted/20 border border-border/30 rounded-xl px-3 py-2">
                      <input
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        placeholder="Tell me about your business..."
                        className="flex-1 bg-transparent text-sm text-foreground/85 placeholder:text-muted-foreground/35 outline-none"
                        disabled={profileSending}
                      />
                      <button
                        type="submit"
                        disabled={!input.trim() || profileSending}
                        className="w-7 h-7 rounded-lg flex items-center justify-center bg-[hsl(var(--kf-accent2))] text-white disabled:opacity-30 transition-opacity"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {tab === "chat" && !profileMode && (
                <div id="copilot-panel-chat" role="tabpanel" aria-labelledby="copilot-tab-chat" className="flex flex-col h-full">
                  <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                    {messages.length === 0 && (
                      <div className="space-y-4">
                        <div className="p-3 rounded-xl border border-border/30 bg-card/40">
                          <div className="flex items-center gap-2 mb-3">
                            <div
                              className="w-8 h-8 rounded-lg flex items-center justify-center"
                              style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.15), hsl(var(--kf-accent2) / 0.15))" }}
                            >
                              <Sparkles className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-foreground/85">Today&apos;s Pulse</p>
                              <p className="text-[10px] text-muted-foreground/50">{new Date().toLocaleDateString("en-TT", { weekday: "long", month: "short", day: "numeric" })}</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-2 mb-3">
                            <div className="p-2 rounded-lg bg-muted/20 text-center">
                              <TrendingUp className="w-3.5 h-3.5 mx-auto mb-1 text-emerald-400" />
                              <p className="text-[10px] text-muted-foreground/60">Success</p>
                              <p className="text-xs font-medium text-foreground/80">{stats ? `${Math.round(stats.successRate)}%` : "—"}</p>
                            </div>
                            <div className="p-2 rounded-lg bg-muted/20 text-center">
                              <Calendar className="w-3.5 h-3.5 mx-auto mb-1 text-blue-400" />
                              <p className="text-[10px] text-muted-foreground/60">AI Actions</p>
                              <p className="text-xs font-medium text-foreground/80">{stats?.totalActions ?? 0}</p>
                            </div>
                            <div className="p-2 rounded-lg bg-muted/20 text-center">
                              <AlertCircle className="w-3.5 h-3.5 mx-auto mb-1 text-amber-400" />
                              <p className="text-[10px] text-muted-foreground/60">Pending</p>
                              <p className="text-xs font-medium text-foreground/80">{pendingApprovals.length}</p>
                            </div>
                          </div>
                          {pendingApprovals.length > 0 && (
                            <button
                              onClick={() => setTab("queue")}
                              className="w-full flex items-center justify-between p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400 hover:bg-amber-500/15 transition-all"
                            >
                              <span className="font-medium">{pendingApprovals.length} action{pendingApprovals.length !== 1 ? "s" : ""} waiting for your review</span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {displayInsights.length > 0 && (
                          <div>
                            <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider mb-2">
                              {currentModule && currentModule !== "cockpit" ? `${currentModule.charAt(0).toUpperCase() + currentModule.slice(1)} Insights` : "Pro Auto Insights"}
                            </p>
                            <div className="space-y-1.5">
                              {displayInsights.map(insight => {
                                const config = SEVERITY_CONFIG[insight.severity];
                                const SevIcon = config.icon;
                                return (
                                  <button
                                    key={insight.id}
                                    onClick={() => {
                                      if (insight.suggestedAction) {
                                        handleSend(insight.suggestedAction);
                                      }
                                    }}
                                    className={`w-full flex items-start gap-2 p-2.5 rounded-xl text-left text-xs border transition-all hover:bg-muted/20 ${config.border} ${config.bg}`}
                                  >
                                    <SevIcon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${config.color}`} />
                                    <div className="flex-1 min-w-0">
                                      <p className={`font-medium ${config.color} leading-snug`}>{insight.title}</p>
                                      {insight.metric && (
                                        <span className="text-[10px] text-muted-foreground/50">{insight.metric}</span>
                                      )}
                                    </div>
                                    <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground/30 mt-0.5" />
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {insightsLoading && displayInsights.length === 0 && (
                          <div className="flex items-center justify-center py-3 gap-2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-[hsl(var(--kf-accent1))]" />
                            <span className="text-[10px] text-muted-foreground/40">Scanning business health...</span>
                          </div>
                        )}

                        {profileStatus && profileStatus.completionPercent < 100 && (
                          <div className="p-3 rounded-xl border border-[hsl(var(--kf-accent2)_/_0.3)] bg-[hsl(var(--kf-accent2)_/_0.05)]">
                            <div className="flex items-center gap-2 mb-2">
                              <Brain className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
                              <span className="text-xs font-semibold text-foreground/80">Teach Me Your Business</span>
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[hsl(var(--kf-accent2)_/_0.15)] text-[hsl(var(--kf-accent2))] font-medium ml-auto">
                                {profileStatus.completionPercent}%
                              </span>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-muted/30 mb-2">
                              <div
                                className="h-full rounded-full bg-[hsl(var(--kf-accent2))] transition-all"
                                style={{ width: `${profileStatus.completionPercent}%` }}
                              />
                            </div>
                            <p className="text-[10px] text-muted-foreground/60 mb-2">
                              Help me understand your business better so I can give smarter suggestions and automate more for you.
                            </p>
                            {profileStatus.remainingTopics.length > 0 && (
                              <p className="text-[10px] text-muted-foreground/40 mb-2">
                                Next: {profileStatus.remainingTopics[0]}
                              </p>
                            )}
                            <button
                              onClick={() => {
                                setProfileMode(true);
                                if (profileMessages.length === 0) {
                                  handleProfileSend("Hi, I'd like to tell you about my business");
                                }
                              }}
                              className="w-full flex items-center justify-center gap-1.5 p-2 rounded-lg bg-[hsl(var(--kf-accent2)_/_0.15)] text-xs text-[hsl(var(--kf-accent2))] font-medium hover:bg-[hsl(var(--kf-accent2)_/_0.25)] transition-all"
                            >
                              <span>Start Conversation</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          </div>
                        )}

                        <div>
                          <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider mb-2">
                            {currentModule && currentModule !== "cockpit" ? `${currentModule.charAt(0).toUpperCase() + currentModule.slice(1)} Actions` : "Suggested Actions"}
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            {quickPrompts.map(qp => (
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
                <div id="copilot-panel-queue" role="tabpanel" aria-labelledby="copilot-tab-queue" className="px-4 py-3 space-y-3">
                  {pendingApprovals.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Pending Approvals</p>
                      {pendingApprovals.map(item => (
                        <VerificationCardCompact
                          key={item.id}
                          item={item}
                          onApprove={handleApprove}
                          onReject={handleReject}
                          loading={resolvingId === item.id}
                        />
                      ))}
                    </div>
                  )}

                  {queueInsights.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Monitoring Alerts</p>
                      {queueInsights.map(insight => {
                        const config = SEVERITY_CONFIG[insight.severity];
                        const SevIcon = config.icon;
                        const tierLabel = insight.riskTier <= 1 ? "Auto" : insight.riskTier === 2 ? "Confirm" : insight.riskTier === 3 ? "Approval" : "Admin";
                        const tierColor = insight.riskTier <= 1 ? "text-emerald-400 bg-emerald-500/10" : insight.riskTier === 2 ? "text-blue-400 bg-blue-500/10" : insight.riskTier === 3 ? "text-amber-400 bg-amber-500/10" : "text-red-400 bg-red-500/10";
                        return (
                          <div
                            key={insight.id}
                            className={`p-3 rounded-xl border ${config.border} ${config.bg} space-y-2`}
                          >
                            <div className="flex items-start gap-2">
                              <SevIcon className={`w-4 h-4 shrink-0 mt-0.5 ${config.color}`} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className={`text-xs font-semibold ${config.color} leading-snug`}>{insight.title}</p>
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${tierColor}`}>
                                    Tier {insight.riskTier} · {tierLabel}
                                  </span>
                                </div>
                                <p className="text-[11px] text-muted-foreground/60 mt-1 leading-relaxed">{insight.description}</p>
                              </div>
                            </div>
                            {insight.suggestedAction && (
                              <button
                                onClick={() => { setTab("chat"); handleSend(insight.suggestedAction!); }}
                                className="w-full flex items-center justify-between p-2 rounded-lg bg-muted/20 border border-border/20 text-xs text-foreground/70 hover:bg-muted/30 transition-all"
                              >
                                <span>{insight.suggestedAction}</span>
                                <ChevronRight className="w-3 h-3 text-muted-foreground/40" />
                              </button>
                            )}
                            {insight.escalated && (
                              <div className="flex items-center gap-1.5 text-[10px] text-emerald-400">
                                <Zap className="w-3 h-3" />
                                <span>Auto-handled by Pro Auto</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {pendingApprovals.length === 0 && queueInsights.length === 0 && (
                    <div className="flex flex-col items-center py-8 gap-2">
                      <CheckCircle2 className="w-6 h-6 text-emerald-400/60" />
                      <span className="text-xs text-muted-foreground/50">All clear</span>
                      <p className="text-[10px] text-muted-foreground/40 text-center">No pending approvals or alerts</p>
                    </div>
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

            {tab === "chat" && !profileMode && (
              <div className="px-4 py-3 border-t border-border/30">
                <div className="flex items-center gap-2 bg-muted/20 border border-border/30 rounded-xl px-3 py-1">
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                    placeholder={currentModule && currentModule !== "cockpit" ? `Ask about ${currentModule}...` : "Ask anything..."}
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
