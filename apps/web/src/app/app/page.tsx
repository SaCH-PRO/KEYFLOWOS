"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  fetchCockpitSummary,
  fetchGamificationStats,
  CockpitSummary,
  GamificationStats,
  PriorityItem,
  RevenueInsights,
  updateStreak,
  fetchTodaysTasks,
  updateAutopilotTaskStatus,
  approveAutopilotTask,
  denyAutopilotTask,
  fetchCriticalAlerts,
  sendAiChat,
  fetchAiBriefing,
  fetchCashFlowForecast,
  AiChatResponse,
  AiBriefing,
  CashFlowForecast,
  runSimulation,
  SimulationResult,
} from "@/lib/client";
import { refreshWorkspace, getStoredBusinessId, getUserDisplayName } from "@/lib/workspace";
import { DashboardSkeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  AlertCircle,
  Info,
  DollarSign,
  Calendar,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Play,
  X,
  Check,
  Zap,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  FileWarning,
  Bell,
  Package,
  UserPlus,
  Send,
  MessageCircle,
  Users,
  Target,
  Repeat,
  BarChart3,
  Percent,
  Award,
  FileText,
  CalendarCheck,
  PenTool,
  ArrowUpRight,
  ArrowDownRight,
  Mic,
  MicOff,
  Brain,
  Sun,
  RefreshCw,
  FlaskConical,
  Loader2,
  Terminal,
  Command,
  CornerDownLeft,
} from "lucide-react";

interface AutopilotTask {
  id: string;
  title: string;
  description?: string;
  category: string;
  priority: string;
  status: string;
  autoExecutable: boolean;
  requiresApproval: boolean;
}

interface CriticalAlert {
  type: string;
  severity: string;
  message: string;
  action?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const severityStyles: Record<string, { className: string; style: React.CSSProperties }> = {
  CRITICAL: { className: "bg-red-500/10 border-red-500/30 text-red-500", style: {} },
  WARNING: { className: "", style: { backgroundColor: "hsl(var(--kf-accent1) / 0.1)", borderColor: "hsl(var(--kf-accent1) / 0.3)", color: "hsl(var(--kf-accent1))" } },
  INFO: { className: "bg-blue-500/10 border-blue-500/30 text-blue-500", style: {} },
};

const severityIcons: Record<string, React.ReactNode> = {
  CRITICAL: <AlertCircle className="w-5 h-5" />,
  WARNING: <AlertTriangle className="w-5 h-5" />,
  INFO: <Info className="w-5 h-5" />,
};

const alertTypeIcons: Record<string, React.ReactNode> = {
  COMPLIANCE: <ShieldAlert className="w-5 h-5" />,
  PAYMENT: <FileWarning className="w-5 h-5" />,
  APPROVAL: <Bell className="w-5 h-5" />,
};

const urgencyBorderStyles: Record<string, { borderColor: string; bgColor: string; textColor: string }> = {
  critical: { borderColor: "rgb(239 68 68 / 0.5)", bgColor: "rgb(239 68 68 / 0.05)", textColor: "rgb(239 68 68)" },
  high: { borderColor: "hsl(var(--kf-accent1) / 0.5)", bgColor: "hsl(var(--kf-accent1) / 0.05)", textColor: "hsl(var(--kf-accent1))" },
  medium: { borderColor: "rgb(234 179 8 / 0.5)", bgColor: "rgb(234 179 8 / 0.05)", textColor: "rgb(234 179 8)" },
  low: { borderColor: "rgb(59 130 246 / 0.5)", bgColor: "rgb(59 130 246 / 0.05)", textColor: "rgb(59 130 246)" },
};

const urgencyLabels: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const quickActionIconMap: Record<string, React.ReactNode> = {
  Package: <Package className="w-5 h-5" />,
  UserPlus: <UserPlus className="w-5 h-5" />,
  Send: <Send className="w-5 h-5" />,
  AlertTriangle: <AlertTriangle className="w-5 h-5" />,
  TrendingUp: <TrendingUp className="w-5 h-5" />,
  Calendar: <Calendar className="w-5 h-5" />,
  Zap: <Zap className="w-5 h-5" />,
};

const WELCOME_MESSAGE: ChatMessage = {
  role: "assistant",
  content: "Ready to assist. Ask me anything about your business — strategy, finances, operations, or run a command.",
};

function formatTTD(value: number): string {
  return `TTD ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-TT", { style: "currency", currency: "TTD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
}

function PriorityCard({ priority, index }: { priority: PriorityItem; index: number }) {
  const styles = urgencyBorderStyles[priority.urgency] || urgencyBorderStyles.low;
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.05 * index }}
      className="kf-card p-4"
      style={{ borderColor: styles.borderColor, backgroundColor: styles.bgColor }}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ backgroundColor: styles.borderColor, color: "#fff" }}>
              {urgencyLabels[priority.urgency]}
            </span>
            {priority.contactName && <span className="text-xs text-muted-foreground truncate">{priority.contactName}</span>}
          </div>
          <h4 className="font-medium text-sm">{priority.title}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">{priority.description}</p>
          {priority.amount != null && (
            <p className="text-sm font-semibold mt-1" style={{ color: styles.textColor }}>{formatTTD(priority.amount)}</p>
          )}
        </div>
        <div className="flex flex-col gap-2 flex-shrink-0">
          <Link href={priority.actionHref} className="text-xs font-medium px-3 py-1.5 rounded-lg transition-all hover:scale-105" style={{ backgroundColor: styles.borderColor, color: "#fff" }}>
            {priority.actionLabel}
          </Link>
          {priority.whatsappLink && (
            <a href={priority.whatsappLink} target="_blank" rel="noopener noreferrer" className="text-xs font-medium px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-all hover:scale-105 flex items-center gap-1">
              <MessageCircle className="w-3 h-3" />WhatsApp
            </a>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default function CommandPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [cockpit, setCockpit] = useState<CockpitSummary | null>(null);
  const [gamification, setGamification] = useState<GamificationStats | null>(null);
  const [tasks, setTasks] = useState<AutopilotTask[]>([]);
  const [alerts, setAlerts] = useState<CriticalAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completingTask, setCompletingTask] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [aiInput, setAiInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [briefing, setBriefing] = useState<AiBriefing | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [forecast, setForecast] = useState<CashFlowForecast | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [simScenario, setSimScenario] = useState("");
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [simLoading, setSimLoading] = useState(false);

  const [insightsExpanded, setInsightsExpanded] = useState(false);

  useEffect(() => {
    const initWorkspace = async () => {
      const fresh = await refreshWorkspace();
      if (fresh) { setBusinessId(fresh); return; }
      const stored = getStoredBusinessId();
      if (stored) setBusinessId(stored);
    };
    void initWorkspace();
  }, []);

  useEffect(() => {
    setVoiceSupported(typeof window !== "undefined" && ("webkitSpeechRecognition" in window || "SpeechRecognition" in window));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!businessId) return;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [cockpitResult, gamificationResult, tasksResult, alertsResult] = await Promise.all([
          fetchCockpitSummary(businessId),
          fetchGamificationStats(businessId),
          fetchTodaysTasks(businessId),
          fetchCriticalAlerts(businessId),
        ]);
        if (cockpitResult.data) setCockpit(cockpitResult.data as CockpitSummary);
        if (gamificationResult.data) setGamification(gamificationResult.data);
        if (tasksResult.data) setTasks(tasksResult.data as AutopilotTask[]);
        if (alertsResult.data) setAlerts(alertsResult.data as CriticalAlert[]);
        void updateStreak(businessId);
      } catch (err) {
        console.error("Dashboard load error:", err);
        setError("Failed to load dashboard. Please refresh the page.");
      }
      setLoading(false);
    };
    void load();
    if (typeof window !== "undefined") {
      const handler = () => void load();
      window.addEventListener("kf:invoicePaid", handler);
      window.addEventListener("kf:bookingCreated", handler);
      window.addEventListener("kf:taskCompleted", handler);
      return () => {
        window.removeEventListener("kf:invoicePaid", handler);
        window.removeEventListener("kf:bookingCreated", handler);
        window.removeEventListener("kf:taskCompleted", handler);
      };
    }
  }, [businessId]);

  const handleCompleteTask = async (taskId: string) => {
    if (!businessId) return;
    setCompletingTask(taskId);
    try {
      await updateAutopilotTaskStatus(taskId, "COMPLETED", businessId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
      window.dispatchEvent(new CustomEvent("kf:taskCompleted"));
    } catch (err) { console.error("Failed to complete task:", err); }
    setCompletingTask(null);
  };

  const handleApproveTask = async (taskId: string) => {
    if (!businessId) return;
    setCompletingTask(taskId);
    try {
      await approveAutopilotTask(taskId, "user", businessId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
      window.dispatchEvent(new CustomEvent("kf:taskCompleted"));
    } catch (err) { console.error("Failed to approve task:", err); }
    setCompletingTask(null);
  };

  const handleDenyTask = async (taskId: string) => {
    if (!businessId) return;
    setCompletingTask(taskId);
    try {
      await denyAutopilotTask(taskId, businessId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } catch (err) { console.error("Failed to deny task:", err); }
    setCompletingTask(null);
  };

  const handleSend = useCallback(async () => {
    if (!businessId || !aiInput.trim() || sending) return;
    const userMsg: ChatMessage = { role: "user", content: aiInput.trim() };
    const history = [...messages.slice(1), userMsg].map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, userMsg]);
    setAiInput("");
    setSending(true);
    setChatOpen(true);
    try {
      const res = await sendAiChat(businessId, userMsg.content, history);
      const reply = res.data?.reply || "Sorry, I couldn't process that. Please try again.";
      setMessages(prev => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Something went wrong. Please try again." }]);
    }
    setSending(false);
  }, [businessId, aiInput, sending, messages]);

  const startVoice = useCallback(() => {
    if (!voiceSupported) return;
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setAiInput(transcript);
      setVoiceListening(false);
      inputRef.current?.focus();
    };
    recognition.onerror = () => setVoiceListening(false);
    recognition.onend = () => setVoiceListening(false);
    setVoiceListening(true);
    recognition.start();
  }, [voiceSupported]);

  const handleGenerateBriefing = useCallback(async () => {
    if (!businessId || briefingLoading) return;
    setBriefingLoading(true);
    try {
      const res = await fetchAiBriefing(businessId);
      if (res.data) setBriefing(res.data);
    } catch {}
    setBriefingLoading(false);
  }, [businessId, briefingLoading]);

  const handleRefreshForecast = useCallback(async () => {
    if (!businessId || forecastLoading) return;
    setForecastLoading(true);
    try {
      const res = await fetchCashFlowForecast(businessId);
      if (res.data) setForecast(res.data);
    } catch {}
    setForecastLoading(false);
  }, [businessId, forecastLoading]);

  const handleSimulate = useCallback(async () => {
    if (!businessId || !simScenario.trim() || simLoading) return;
    setSimLoading(true);
    try {
      const res = await runSimulation(businessId, simScenario.trim());
      if (res.data) setSimResult(res.data);
    } catch {}
    setSimLoading(false);
  }, [businessId, simScenario, simLoading]);

  const todayRevenue = cockpit?.stats?.todayRevenue ?? 0;
  const monthlyRevenue = cockpit?.stats?.monthlyRevenue ?? 0;
  const pendingInvoices = cockpit?.stats?.pendingInvoices ?? 0;
  const todayBookings = cockpit?.stats?.todayBookings ?? 0;
  const completedBookingsToday = cockpit?.stats?.completedBookingsToday ?? 0;

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  const completedToday = gamification?.dailyTasksCompleted ?? 0;
  const tasksRemaining = tasks.length;
  const priorities = cockpit?.priorities ?? [];
  const revenueInsights = cockpit?.revenueInsights;

  if (loading) return <DashboardSkeleton />;

  return (
    <div className="space-y-6 max-w-5xl mx-auto" aria-label="Command Center">
      {error && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500">
          {error}
        </motion.div>
      )}

      {alerts.length > 0 && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
          {alerts.map((alert, idx) => (
            <Link key={idx} href={alert.action || "#"} className={`flex items-center gap-3 p-4 rounded-xl border transition-all hover:scale-[1.01] ${(severityStyles[alert.severity] || severityStyles.INFO).className}`} style={(severityStyles[alert.severity] || severityStyles.INFO).style}>
              <div className="flex-shrink-0">{alertTypeIcons[alert.type] || severityIcons[alert.severity]}</div>
              <div className="flex-1 min-w-0"><p className="text-sm font-medium">{alert.message}</p></div>
              {alert.action && <ChevronRight className="w-5 h-5 flex-shrink-0 opacity-60" />}
            </Link>
          ))}
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="relative">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}>
              <Zap className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              {greeting}{getUserDisplayName() ? `, ${getUserDisplayName()}` : ""}
            </h1>
          </div>
          <p className="text-muted-foreground text-sm">
            {tasksRemaining > 0
              ? `${tasksRemaining} task${tasksRemaining > 1 ? "s" : ""} today`
              : "All caught up!"}
            {" "}
            <span className="text-muted-foreground/60">|</span>
            {" "}
            <span style={{ color: "hsl(var(--kf-accent1))" }}>{formatTTD(todayRevenue)}</span> today
            {" "}
            <span className="text-muted-foreground/60">|</span>
            {" "}
            <span style={{ color: "hsl(var(--kf-accent2))" }}>{todayBookings}</span> bookings
          </p>
        </div>

        <div className="relative group">
          <div className="absolute inset-0 rounded-2xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-300" style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.15), hsl(var(--kf-accent2) / 0.15))", filter: "blur(20px)" }} />
          <div className="relative flex items-center gap-2 p-2 rounded-2xl bg-white/[0.04] backdrop-blur-xl border border-white/10 group-focus-within:border-white/20 transition-all">
            <div className="flex items-center gap-2 pl-3">
              <Terminal className="w-5 h-5 text-muted-foreground" />
            </div>
            <input
              ref={inputRef}
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              onFocus={() => setChatOpen(true)}
              placeholder="Ask AI anything, run a command, or use voice..."
              aria-label="AI command input"
              className="flex-1 bg-transparent text-sm py-3 focus:outline-none placeholder:text-muted-foreground/60"
              disabled={sending || !businessId}
            />
            <div className="flex items-center gap-1.5 pr-1">
              {voiceSupported && (
                <button
                  onClick={startVoice}
                  className={`p-2.5 rounded-xl transition-all ${voiceListening ? "bg-red-500/20 text-red-400 animate-pulse" : "text-muted-foreground hover:text-white hover:bg-white/10"}`}
                  title={voiceListening ? "Listening..." : "Voice input"}
                >
                  {voiceListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
              )}
              <button
                onClick={handleSend}
                disabled={sending || !aiInput.trim() || !businessId}
                aria-label="Send message"
                className="p-2.5 rounded-xl transition-all disabled:opacity-30 hover:scale-105"
                style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
              >
                {sending ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <CornerDownLeft className="w-4 h-4 text-white" />}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-2 px-3">
            <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">Quick:</span>
            {["Daily briefing", "Cash flow forecast", "What should I focus on?"].map(q => (
              <button key={q} onClick={() => { setAiInput(q); inputRef.current?.focus(); }} className="text-[11px] px-2.5 py-1 rounded-lg bg-white/[0.03] border border-white/[0.06] text-muted-foreground hover:text-foreground hover:border-white/15 transition-all">
                {q}
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {chatOpen && messages.length > 1 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-md flex items-center justify-center" style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}>
                    <Brain className="w-3 h-3 text-white" />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">KeyFlow AI</span>
                  {sending && <span className="text-[10px] text-muted-foreground/60 animate-pulse">Thinking...</span>}
                </div>
                <button onClick={() => setChatOpen(false)} className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-white/5 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto p-4 space-y-3">
                {messages.slice(1).map((msg, i) => (
                  <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-white/[0.08] border border-white/10"
                        : ""
                    }`} style={msg.role === "assistant" ? { background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.08), hsl(var(--kf-accent2) / 0.08))", border: "1px solid hsl(var(--kf-accent1) / 0.15)" } : undefined}>
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </motion.div>
                ))}
                {sending && (
                  <div className="flex justify-start">
                    <div className="rounded-xl px-4 py-3 flex items-center gap-1.5" style={{ background: "hsl(var(--kf-accent1) / 0.08)", border: "1px solid hsl(var(--kf-accent1) / 0.15)" }}>
                      <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: "hsl(var(--kf-accent2))" }} />
                      <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: "hsl(var(--kf-accent2))", animationDelay: "0.2s" }} />
                      <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: "hsl(var(--kf-accent2))", animationDelay: "0.4s" }} />
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="kf-card p-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-16 h-16 rounded-bl-[40px] opacity-10" style={{ background: "hsl(var(--kf-accent1))" }} />
          <div className="flex items-center gap-2 text-muted-foreground mb-1.5">
            <DollarSign className="w-4 h-4" />
            <span className="text-[10px] uppercase tracking-wider font-medium">Today</span>
          </div>
          <div className="text-xl font-bold">{formatTTD(todayRevenue)}</div>
          {pendingInvoices > 0 && <p className="text-[11px] text-muted-foreground mt-1">{pendingInvoices} pending</p>}
        </div>

        <div className="kf-card p-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-16 h-16 rounded-bl-[40px] opacity-10" style={{ background: "hsl(var(--kf-accent2))" }} />
          <div className="flex items-center gap-2 text-muted-foreground mb-1.5">
            <TrendingUp className="w-4 h-4" />
            <span className="text-[10px] uppercase tracking-wider font-medium">This Month</span>
          </div>
          <div className="text-xl font-bold">{formatTTD(monthlyRevenue)}</div>
          <div className="mt-1.5">
            <div className="kf-momentum-bar h-1.5">
              <div className="kf-momentum-fill" style={{ width: `${(cockpit?.momentum ?? 0) * 100}%` }} />
            </div>
          </div>
        </div>

        <div className="kf-card p-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-16 h-16 rounded-bl-[40px] opacity-10 bg-blue-500" />
          <div className="flex items-center gap-2 text-muted-foreground mb-1.5">
            <Calendar className="w-4 h-4" />
            <span className="text-[10px] uppercase tracking-wider font-medium">Bookings</span>
          </div>
          <div className="text-xl font-bold">{todayBookings}</div>
          <p className="text-[11px] text-muted-foreground mt-1">{completedBookingsToday} completed</p>
        </div>

        <div className="kf-card p-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-16 h-16 rounded-bl-[40px] opacity-10 bg-green-500" />
          <div className="flex items-center gap-2 text-muted-foreground mb-1.5">
            <CheckCircle2 className="w-4 h-4" />
            <span className="text-[10px] uppercase tracking-wider font-medium">Tasks Done</span>
          </div>
          <div className="text-xl font-bold">{completedToday}</div>
          <p className="text-[11px] text-muted-foreground mt-1">{tasksRemaining} remaining</p>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {priorities.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                <h2 className="text-sm font-semibold uppercase tracking-wider">Priorities</h2>
                <span className="ml-auto text-[10px] text-muted-foreground">{priorities.length} items</span>
              </div>
              <div className="space-y-2">
                {priorities.slice(0, 4).map((priority, idx) => (
                  <PriorityCard key={priority.id} priority={priority} index={idx} />
                ))}
              </div>
            </motion.div>
          )}

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                <h2 className="text-sm font-semibold uppercase tracking-wider">Today&apos;s Tasks</h2>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                <span>{completedToday} done</span>
              </div>
            </div>

            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="kf-card p-4 animate-pulse">
                    <div className="h-4 bg-muted rounded w-3/4 mb-2" />
                    <div className="h-3 bg-muted rounded w-1/2" />
                  </div>
                ))}
              </div>
            ) : tasks.length === 0 ? (
              <div className="kf-card p-6 text-center">
                <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-green-500" />
                <h3 className="text-sm font-semibold mb-0.5">All Done!</h3>
                <p className="text-xs text-muted-foreground">No tasks remaining for today.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map((task, idx) => (
                  <motion.div key={task.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * idx }} className="kf-card p-3.5 group">
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 pt-0.5">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${task.priority === 'HIGH' ? '' : 'bg-muted text-muted-foreground'}`}
                          style={task.priority === 'HIGH' ? { backgroundColor: "hsl(var(--kf-accent1) / 0.2)", color: "hsl(var(--kf-accent1))" } : undefined}>
                          {idx + 1}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-sm">{task.title}</h3>
                        {task.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{task.description}</p>}
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{task.category}</span>
                          {task.autoExecutable && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 flex items-center gap-1">
                              <Sparkles className="w-2.5 h-2.5" />Auto
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex-shrink-0 flex items-center gap-1.5">
                        {task.requiresApproval && task.status === 'AWAITING_APPROVAL' ? (
                          <>
                            <button onClick={() => handleDenyTask(task.id)} disabled={completingTask === task.id} className="p-1.5 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50" title="Deny">
                              <X className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleApproveTask(task.id)} disabled={completingTask === task.id} className="p-1.5 rounded-lg text-green-500 hover:bg-green-500/10 transition-colors disabled:opacity-50" title="Approve">
                              <Check className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <button onClick={() => handleCompleteTask(task.id)} disabled={completingTask === task.id} className="p-1.5 rounded-lg text-green-500 hover:bg-green-500/10 transition-colors disabled:opacity-50 opacity-0 group-hover:opacity-100" title="Mark as done">
                            {completingTask === task.id ? <Clock className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>

          {revenueInsights && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
              <button onClick={() => setInsightsExpanded(!insightsExpanded)} className="flex items-center gap-2 mb-3 w-full text-left">
                <BarChart3 className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
                <h2 className="text-sm font-semibold uppercase tracking-wider">Revenue Insights</h2>
                <span className="ml-auto">{insightsExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}</span>
              </button>
              <AnimatePresence>
                {insightsExpanded && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <div className="kf-card p-4">
                      {revenueInsights.topService && (
                        <div className="mb-3 p-3 rounded-lg" style={{ backgroundColor: "hsl(var(--kf-accent2) / 0.1)", borderLeft: "3px solid hsl(var(--kf-accent2))" }}>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Top Service</p>
                          <p className="font-semibold text-sm">{revenueInsights.topService.name}</p>
                          <p className="text-xs text-muted-foreground">{formatTTD(revenueInsights.topService.revenue)} - {revenueInsights.topService.count} bookings</p>
                        </div>
                      )}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[
                          { label: "Avg Client Spend", value: formatTTD(revenueInsights.avgClientSpend), icon: <DollarSign className="w-3 h-3" /> },
                          { label: "Lead Conversion", value: `${(revenueInsights.leadConversionRate * 100).toFixed(1)}%`, icon: <Target className="w-3 h-3" /> },
                          { label: "Client Retention", value: `${(revenueInsights.clientRetentionRate * 100).toFixed(1)}%`, icon: <Repeat className="w-3 h-3" /> },
                          { label: "Collection Rate", value: `${(revenueInsights.collectionRate * 100).toFixed(1)}%`, icon: <Percent className="w-3 h-3" /> },
                        ].map(stat => (
                          <div key={stat.label} className="p-2.5 rounded-lg bg-muted/30">
                            <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
                              {stat.icon}
                              <span className="text-[9px] uppercase tracking-wider">{stat.label}</span>
                            </div>
                            <div className="text-sm font-bold">{stat.value}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </div>

        <div className="space-y-4">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-white/[0.03] backdrop-blur border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sun className="w-4 h-4 text-amber-400" />
                <h2 className="text-xs font-semibold uppercase tracking-wider">Daily Briefing</h2>
              </div>
              <button onClick={handleGenerateBriefing} disabled={briefingLoading || !businessId} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors disabled:opacity-40 bg-white/5 border border-white/10 hover:bg-white/10">
                <RefreshCw className={`w-3 h-3 ${briefingLoading ? "animate-spin" : ""}`} />
                {briefing ? "Refresh" : "Generate"}
              </button>
            </div>
            <div className="p-4" style={{ maxHeight: 300, overflowY: "auto" }}>
              {briefingLoading && !briefing ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => <div key={i} className="h-3 rounded bg-white/5 animate-pulse" style={{ width: `${50 + i * 15}%` }} />)}
                </div>
              ) : briefing ? (
                <div className="space-y-3">
                  <p className="text-xs text-gray-300 leading-relaxed">{briefing.summary}</p>
                  {briefing.highlights.length > 0 && (
                    <div className="space-y-1">
                      {briefing.highlights.map((h, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-xs">
                          <CheckCircle2 className="w-3 h-3 text-green-400 mt-0.5 flex-shrink-0" />
                          <span className="text-gray-300">{h}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-1.5">
                    <div className="bg-white/5 rounded-lg p-2 text-center">
                      <p className="text-[9px] text-muted-foreground uppercase">Revenue</p>
                      <p className="text-xs font-semibold text-green-400">{formatCurrency(briefing.cashFlow.revenue)}</p>
                    </div>
                    <div className="bg-white/5 rounded-lg p-2 text-center">
                      <p className="text-[9px] text-muted-foreground uppercase">Expenses</p>
                      <p className="text-xs font-semibold text-red-400">{formatCurrency(briefing.cashFlow.expenses)}</p>
                    </div>
                    <div className="bg-white/5 rounded-lg p-2 text-center">
                      <p className="text-[9px] text-muted-foreground uppercase">Net</p>
                      <p className={`text-xs font-semibold ${briefing.cashFlow.net >= 0 ? "text-green-400" : "text-red-400"}`}>{formatCurrency(briefing.cashFlow.net)}</p>
                    </div>
                  </div>
                  {briefing.suggestion && (
                    <div className="p-2.5 rounded-lg" style={{ backgroundColor: "hsl(var(--kf-accent1) / 0.08)", border: "1px solid hsl(var(--kf-accent1) / 0.15)" }}>
                      <div className="flex items-start gap-1.5">
                        <Sparkles className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--kf-accent1))" }} />
                        <p className="text-[11px] leading-relaxed text-gray-300">{briefing.suggestion}</p>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-6">
                  <Sun className="w-8 h-8 text-amber-400/20 mx-auto mb-2" />
                  <p className="text-[11px] text-muted-foreground">Generate your daily business summary</p>
                </div>
              )}
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-white/[0.03] backdrop-blur border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
                <h2 className="text-xs font-semibold uppercase tracking-wider">Cash Flow</h2>
              </div>
              <button onClick={handleRefreshForecast} disabled={forecastLoading || !businessId} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors disabled:opacity-40 bg-white/5 border border-white/10 hover:bg-white/10">
                <RefreshCw className={`w-3 h-3 ${forecastLoading ? "animate-spin" : ""}`} />
                {forecast ? "Refresh" : "Load"}
              </button>
            </div>
            <div className="p-4" style={{ maxHeight: 280, overflowY: "auto" }}>
              {forecastLoading && !forecast ? (
                <div className="space-y-2">{[1, 2].map(i => <div key={i} className="h-10 rounded-lg bg-white/5 animate-pulse" />)}</div>
              ) : forecast ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-white/5 rounded-lg p-2.5">
                      <p className="text-[9px] text-muted-foreground uppercase mb-0.5">Balance</p>
                      <p className={`text-sm font-bold ${forecast.currentBalance >= 0 ? "text-green-400" : "text-red-400"}`}>{formatCurrency(forecast.currentBalance)}</p>
                    </div>
                    <div className="bg-white/5 rounded-lg p-2.5">
                      <p className="text-[9px] text-muted-foreground uppercase mb-0.5">30-Day</p>
                      <p className={`text-sm font-bold ${forecast.projectedBalance >= 0 ? "text-green-400" : "text-red-400"}`}>{formatCurrency(forecast.projectedBalance)}</p>
                    </div>
                  </div>
                  {forecast.daysUntilNegative !== null && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2.5 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                      <p className="text-[11px] text-red-300">Balance may go negative in {forecast.daysUntilNegative} days</p>
                    </div>
                  )}
                  <div className="flex items-center gap-2 bg-white/5 rounded-lg p-2.5">
                    {forecast.trend === "up" || forecast.trend === "improving" ? <TrendingUp className="w-4 h-4 text-green-400" /> : <TrendingDown className="w-4 h-4 text-red-400" />}
                    <div>
                      <p className="text-[9px] text-muted-foreground">Trend</p>
                      <p className="text-xs font-medium capitalize">{forecast.trend}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-6">
                  <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-20" style={{ color: "hsl(var(--kf-accent2))" }} />
                  <p className="text-[11px] text-muted-foreground">Load your cash flow projections</p>
                </div>
              )}
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="bg-white/[0.03] backdrop-blur border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-purple-400" />
              <h2 className="text-xs font-semibold uppercase tracking-wider">What-If Simulator</h2>
            </div>
            <div className="p-4">
              <div className="flex gap-2 mb-3">
                <input
                  value={simScenario}
                  onChange={(e) => setSimScenario(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSimulate()}
                  placeholder="e.g., Raise prices 20%"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-white/20 placeholder:text-muted-foreground/50"
                  disabled={simLoading || !businessId}
                />
                <button onClick={handleSimulate} disabled={simLoading || !simScenario.trim() || !businessId} className="p-2 rounded-lg transition-colors disabled:opacity-40" style={{ background: "hsl(var(--kf-accent1) / 0.15)" }}>
                  {simLoading ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: "hsl(var(--kf-accent1))" }} /> : <Play className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />}
                </button>
              </div>
              {simResult && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <p className="text-[11px] text-gray-300 leading-relaxed whitespace-pre-wrap">{simResult.simulation}</p>
                </motion.div>
              )}
            </div>
          </motion.div>

          {cockpit?.quickActions && cockpit.quickActions.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
              <div className="flex items-center gap-2 mb-3">
                <Zap className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
                <h2 className="text-xs font-semibold uppercase tracking-wider">Quick Actions</h2>
              </div>
              <div className="grid gap-2">
                {cockpit.quickActions.slice(0, 4).map(action => (
                  <Link key={action.id} href={action.href} className="kf-card p-3 flex items-center gap-3 hover:scale-[1.02] transition-all group">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-muted/50 group-hover:bg-muted transition-colors">
                      {quickActionIconMap[action.icon] || <Zap className="w-4 h-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{action.label}</div>
                      {action.description && <div className="text-[10px] text-muted-foreground truncate">{action.description}</div>}
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                ))}
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
