"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  fetchMomentumRecommendations,
  actionMomentumRecommendation,
  snoozeMomentumRecommendation,
  dismissMomentumRecommendation,
  generateMomentumDraft,
  MomentumRecommendation,
  fetchCampaignBriefings,
  CampaignBriefing,
  fetchConciergeNudges,
  snoozeConciergeNudge,
  NudgeItem,
  fetchFinancialPulse,
  FinancialPulse,
  FinancialAlert,
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
  HeartPulse,
  Clock3,
  Mail,
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
  const router = useRouter();
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
  const [momentumRecs, setMomentumRecs] = useState<MomentumRecommendation[]>([]);
  const [momentumLoading, setMomentumLoading] = useState(false);
  const [momentumActionId, setMomentumActionId] = useState<string | null>(null);

  const [campaignBriefings, setCampaignBriefings] = useState<CampaignBriefing[]>([]);
  const [campaignBriefingsLoading, setCampaignBriefingsLoading] = useState(false);

  const [nudges, setNudges] = useState<NudgeItem[]>([]);
  const [dismissingNudge, setDismissingNudge] = useState<string | null>(null);

  const [financialPulse, setFinancialPulse] = useState<FinancialPulse | null>(null);
  const [financialPulseLoading, setFinancialPulseLoading] = useState(false);

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
        const [cockpitResult, gamificationResult, tasksResult, alertsResult, momentumResult, briefingsResult, financialResult] = await Promise.all([
          fetchCockpitSummary(businessId),
          fetchGamificationStats(businessId),
          fetchTodaysTasks(businessId),
          fetchCriticalAlerts(businessId),
          fetchMomentumRecommendations(businessId, 5),
          fetchCampaignBriefings(businessId),
          fetchFinancialPulse(businessId),
        ]);
        if (cockpitResult.data) setCockpit(cockpitResult.data as CockpitSummary);
        if (gamificationResult.data) setGamification(gamificationResult.data);
        if (tasksResult.data) setTasks(tasksResult.data as AutopilotTask[]);
        if (alertsResult.data) setAlerts(alertsResult.data as CriticalAlert[]);
        if (momentumResult.data) setMomentumRecs(momentumResult.data);
        if (briefingsResult.data) setCampaignBriefings(briefingsResult.data);
        if (financialResult.data) setFinancialPulse(financialResult.data);
        void updateStreak(businessId);
        fetchConciergeNudges(businessId).then(res => {
          if (res.data) setNudges(res.data);
        }).catch(() => {});
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

  const handleMomentumAction = async (rec: MomentumRecommendation) => {
    if (!businessId) return;
    setMomentumActionId(rec.id);
    try {
      const contactId = rec.contact?.id || rec.contactId;
      const contactName = rec.contact
        ? `${rec.contact.firstName ?? ""} ${rec.contact.lastName ?? ""}`.trim() || "Contact"
        : "Contact";

      const [actionResult, draftResult] = await Promise.all([
        actionMomentumRecommendation(rec.id, businessId),
        generateMomentumDraft(rec.id, {
          contactId,
          contactName,
          type: rec.type,
          description: rec.description,
          momentumScore: rec.momentumScore ?? undefined,
        }, businessId),
      ]);

      if (actionResult.error) {
        console.error("Failed to action momentum rec:", actionResult.error);
      } else {
        setMomentumRecs(prev => prev.filter(r => r.id !== rec.id));
        const draft = draftResult.data;
        if (contactId) {
          const draftParam = draft?.message ? `&momentumDraft=${encodeURIComponent(draft.message)}` : "";
          router.push(`/app/crm?contact=${contactId}${draftParam}`);
        }
      }
    } catch (err) { console.error("Failed to action momentum rec:", err); }
    setMomentumActionId(null);
  };

  const handleMomentumSnooze = async (id: string) => {
    if (!businessId) return;
    setMomentumActionId(id);
    try {
      const result = await snoozeMomentumRecommendation(id, 7, businessId);
      if (!result.error) {
        setMomentumRecs(prev => prev.filter(r => r.id !== id));
      }
    } catch (err) { console.error("Failed to snooze momentum rec:", err); }
    setMomentumActionId(null);
  };

  const handleMomentumDismiss = async (id: string) => {
    if (!businessId) return;
    setMomentumActionId(id);
    try {
      const result = await dismissMomentumRecommendation(id, businessId);
      if (!result.error) {
        setMomentumRecs(prev => prev.filter(r => r.id !== id));
      }
    } catch (err) { console.error("Failed to dismiss momentum rec:", err); }
    setMomentumActionId(null);
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

      {nudges.length > 0 && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
          {nudges.map((nudge) => (
            <div
              key={nudge.id}
              className="flex items-start gap-3 p-4 rounded-xl border transition-all"
              style={{ backgroundColor: "hsl(var(--kf-accent2) / 0.05)", borderColor: "hsl(var(--kf-accent2) / 0.2)" }}
            >
              <div className="flex-shrink-0 mt-0.5">
                <Sparkles className="w-5 h-5" style={{ color: "hsl(var(--kf-accent2))" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{nudge.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{nudge.body}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Link
                  href={nudge.ctaHref}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg text-white transition-all hover:scale-105"
                  style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
                >
                  {nudge.ctaLabel}
                </Link>
                {nudge.snoozable && (
                  <button
                    onClick={async () => {
                      if (!businessId) return;
                      setDismissingNudge(nudge.id);
                      await snoozeConciergeNudge(businessId, nudge.id, 3);
                      setNudges(prev => prev.filter(n => n.id !== nudge.id));
                      setDismissingNudge(null);
                    }}
                    disabled={dismissingNudge === nudge.id}
                    className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-lg hover:bg-muted/30 transition-all"
                  >
                    {dismissingNudge === nudge.id ? "..." : "Later"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </motion.div>
      )}

      <div>
        <div className="mb-5">
          <h1 className="text-xl font-semibold tracking-tight">
            {greeting}{getUserDisplayName() ? `, ${getUserDisplayName()}` : ""}
          </h1>
          <p className="text-muted-foreground text-[13px] mt-1 flex items-center gap-2">
            {tasksRemaining > 0
              ? <><span>{tasksRemaining} task{tasksRemaining > 1 ? "s" : ""} today</span><span className="text-border">·</span></>
              : <><span>All caught up!</span><span className="text-border">·</span></>}
            <span style={{ color: "hsl(var(--kf-accent1))" }}>{formatTTD(todayRevenue)}</span>
            <span className="text-border">·</span>
            <span>{todayBookings} booking{todayBookings !== 1 ? "s" : ""}</span>
          </p>
        </div>

        <div className="relative group mb-5">
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-card group-focus-within:border-[hsl(var(--kf-accent1)/0.3)] transition-all">
            <Terminal className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <input
              ref={inputRef}
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              onFocus={() => setChatOpen(true)}
              placeholder="Ask AI anything or run a command..."
              aria-label="AI command input"
              className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/50"
              disabled={sending || !businessId}
            />
            <div className="flex items-center gap-1">
              {voiceSupported && (
                <button
                  onClick={startVoice}
                  className={`p-1.5 rounded-md transition-all ${voiceListening ? "bg-red-500/20 text-red-400 animate-pulse" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                  title={voiceListening ? "Listening..." : "Voice input"}
                >
                  {voiceListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                </button>
              )}
              <button
                onClick={handleSend}
                disabled={sending || !aiInput.trim() || !businessId}
                aria-label="Send message"
                className="p-1.5 rounded-md transition-all disabled:opacity-30"
                style={{ background: "hsl(var(--kf-accent1))" }}
              >
                {sending ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin" /> : <CornerDownLeft className="w-3.5 h-3.5 text-white" />}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            {["Daily briefing", "Cash flow", "Focus areas"].map(q => (
              <button key={q} onClick={() => { setAiInput(q); inputRef.current?.focus(); }} className="text-[11px] px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/30 transition-all">
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {chatOpen && messages.length > 1 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="kf-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-border">
                <div className="flex items-center gap-2">
                  <div className="h-5 w-5 rounded flex items-center justify-center" style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}>
                    <Brain className="w-3 h-3" style={{ color: "hsl(var(--kf-accent1))" }} />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">KeyFlow AI</span>
                  {sending && <span className="text-[10px] text-muted-foreground/60 animate-pulse">Thinking...</span>}
                </div>
                <button onClick={() => setChatOpen(false)} className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto p-3 space-y-2.5">
                {messages.slice(1).map((msg, i) => (
                  <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-relaxed ${
                      msg.role === "user"
                        ? "bg-muted border border-border"
                        : ""
                    }`} style={msg.role === "assistant" ? { background: "hsl(var(--kf-accent1) / 0.06)", border: "1px solid hsl(var(--kf-accent1) / 0.1)" } : undefined}>
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </motion.div>
                ))}
                {sending && (
                  <div className="flex justify-start">
                    <div className="rounded-lg px-3.5 py-2.5 flex items-center gap-1.5" style={{ background: "hsl(var(--kf-accent1) / 0.06)", border: "1px solid hsl(var(--kf-accent1) / 0.1)" }}>
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="kf-stat-card">
          <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
            <DollarSign className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
            <span className="text-[11px] font-medium">Today</span>
          </div>
          <div className="text-lg font-semibold">{formatTTD(todayRevenue)}</div>
          {pendingInvoices > 0 && <p className="text-[11px] text-muted-foreground mt-1">{pendingInvoices} pending</p>}
        </div>

        <div className="kf-stat-card">
          <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
            <TrendingUp className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent2))" }} />
            <span className="text-[11px] font-medium">This Month</span>
          </div>
          <div className="text-lg font-semibold">{formatTTD(monthlyRevenue)}</div>
          <div className="mt-2">
            <div className="kf-momentum-bar">
              <div className="kf-momentum-fill" style={{ width: `${(cockpit?.momentum ?? 0) * 100}%` }} />
            </div>
          </div>
        </div>

        <div className="kf-stat-card">
          <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
            <Calendar className="w-3.5 h-3.5 text-blue-500" />
            <span className="text-[11px] font-medium">Bookings</span>
          </div>
          <div className="text-lg font-semibold">{todayBookings}</div>
          <p className="text-[11px] text-muted-foreground mt-1">{completedBookingsToday} completed</p>
        </div>

        <div className="kf-stat-card">
          <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
            <span className="text-[11px] font-medium">Tasks Done</span>
          </div>
          <div className="text-lg font-semibold">{completedToday}</div>
          <p className="text-[11px] text-muted-foreground mt-1">{tasksRemaining} remaining</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-5">
          {priorities.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2.5">
                <AlertTriangle className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
                <h2 className="text-[13px] font-semibold">Priorities</h2>
                <span className="ml-auto text-[11px] text-muted-foreground">{priorities.length} items</span>
              </div>
              <div className="space-y-2">
                {priorities.slice(0, 4).map((priority, idx) => (
                  <PriorityCard key={priority.id} priority={priority} index={idx} />
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <Zap className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
                <h2 className="text-[13px] font-semibold">Today&apos;s Tasks</h2>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <CheckCircle2 className="w-3 h-3 text-green-500" />
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
          </div>

          {momentumRecs.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }}>
              <div className="flex items-center gap-2 mb-3">
                <HeartPulse className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
                <h2 className="text-sm font-semibold uppercase tracking-wider">Client Momentum</h2>
                <span className="ml-auto text-[10px] text-muted-foreground">{momentumRecs.length} action{momentumRecs.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="space-y-2">
                {momentumRecs.slice(0, 5).map((rec, idx) => {
                  const contactName = rec.contact
                    ? `${rec.contact.firstName ?? ""} ${rec.contact.lastName ?? ""}`.trim() || "Unnamed"
                    : "Contact";
                  const priorityColors: Record<string, { border: string; bg: string; text: string }> = {
                    urgent: { border: "rgb(239 68 68 / 0.5)", bg: "rgb(239 68 68 / 0.05)", text: "rgb(239 68 68)" },
                    high: { border: "hsl(var(--kf-accent1) / 0.5)", bg: "hsl(var(--kf-accent1) / 0.05)", text: "hsl(var(--kf-accent1))" },
                    medium: { border: "rgb(234 179 8 / 0.5)", bg: "rgb(234 179 8 / 0.05)", text: "rgb(234 179 8)" },
                    low: { border: "rgb(59 130 246 / 0.5)", bg: "rgb(59 130 246 / 0.05)", text: "rgb(59 130 246)" },
                  };
                  const pColors = priorityColors[rec.priority] || priorityColors.medium;
                  const typeIcons: Record<string, React.ReactNode> = {
                    churn_risk: <TrendingDown className="w-3.5 h-3.5" />,
                    check_in: <MessageCircle className="w-3.5 h-3.5" />,
                    upsell: <TrendingUp className="w-3.5 h-3.5" />,
                    package_offer: <Package className="w-3.5 h-3.5" />,
                    re_engage: <Send className="w-3.5 h-3.5" />,
                    birthday: <Award className="w-3.5 h-3.5" />,
                  };

                  return (
                    <motion.div
                      key={rec.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.05 * idx }}
                      className="kf-card p-3.5 group"
                      style={{ borderColor: pColors.border, backgroundColor: pColors.bg }}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: pColors.border, color: "#fff" }}>
                          {typeIcons[rec.type] || <HeartPulse className="w-3.5 h-3.5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ backgroundColor: pColors.border, color: "#fff" }}>
                              {rec.priority}
                            </span>
                            <span className="text-xs text-muted-foreground truncate">{contactName}</span>
                            {rec.momentumScore != null && (
                              <span className="text-[10px] text-muted-foreground ml-auto">Score: {rec.momentumScore}</span>
                            )}
                          </div>
                          <h4 className="font-medium text-sm">{rec.title}</h4>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{rec.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 mt-2.5 ml-11">
                        <button
                          onClick={() => handleMomentumAction(rec)}
                          disabled={momentumActionId === rec.id}
                          className="text-[10px] font-medium px-3 py-1.5 rounded-lg transition-all hover:scale-105 text-white"
                          style={{ backgroundColor: pColors.border }}
                        >
                          {momentumActionId === rec.id ? <Loader2 className="w-3 h-3 animate-spin inline" /> : "Do it"}
                        </button>
                        <button
                          onClick={() => handleMomentumSnooze(rec.id)}
                          disabled={momentumActionId === rec.id}
                          className="text-[10px] font-medium px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/10 transition-all flex items-center gap-1"
                        >
                          <Clock3 className="w-3 h-3" />Snooze
                        </button>
                        <button
                          onClick={() => handleMomentumDismiss(rec.id)}
                          disabled={momentumActionId === rec.id}
                          className="text-[10px] font-medium px-2 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-all"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          )}

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
          {financialPulse && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="bg-white/[0.03] backdrop-blur border border-white/10 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
                <HeartPulse className="w-4 h-4 text-emerald-400" />
                <h2 className="text-xs font-semibold uppercase tracking-wider">Financial Pulse</h2>
              </div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-white/5 rounded-lg p-2.5">
                    <p className="text-[9px] text-muted-foreground uppercase">Cash Position</p>
                    <p className={`text-sm font-bold ${financialPulse.cashPosition >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {formatTTD(financialPulse.cashPosition)}
                    </p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-2.5">
                    <p className="text-[9px] text-muted-foreground uppercase">This Week</p>
                    <div className="flex items-center gap-1">
                      <p className="text-sm font-bold">{formatTTD(financialPulse.weeklyRevenue)}</p>
                      {financialPulse.weeklyRevenueChange !== 0 && (
                        <span className={`text-[9px] font-medium flex items-center ${financialPulse.weeklyRevenueChange > 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {financialPulse.weeklyRevenueChange > 0 ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                          {Math.abs(financialPulse.weeklyRevenueChange)}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  <div className="bg-white/5 rounded-lg p-2 text-center">
                    <p className="text-[8px] text-muted-foreground uppercase">Revenue</p>
                    <p className="text-[11px] font-semibold text-emerald-400">{formatCurrency(financialPulse.monthlyRevenue)}</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-2 text-center">
                    <p className="text-[8px] text-muted-foreground uppercase">Expenses</p>
                    <p className="text-[11px] font-semibold text-red-400">{formatCurrency(financialPulse.monthlyExpenses)}</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-2 text-center">
                    <p className="text-[8px] text-muted-foreground uppercase">Net</p>
                    <p className={`text-[11px] font-semibold ${financialPulse.netIncome >= 0 ? "text-emerald-400" : "text-red-400"}`}>{formatCurrency(financialPulse.netIncome)}</p>
                  </div>
                </div>

                {financialPulse.cashFlowForecast.length > 0 && (
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase mb-1.5">Cash Flow Forecast</p>
                    <div className="flex items-end gap-1 h-12">
                      {financialPulse.cashFlowForecast.map((f, i) => {
                        const maxVal = Math.max(...financialPulse.cashFlowForecast.map(fc => Math.abs(fc.projected)), 1);
                        const height = Math.max(8, (Math.abs(f.projected) / maxVal) * 100);
                        const isPositive = f.projected >= 0;
                        return (
                          <div key={f.period} className="flex-1 flex flex-col items-center gap-0.5">
                            <div
                              className="w-full rounded-t-sm transition-all"
                              style={{
                                height: `${height}%`,
                                backgroundColor: isPositive ? "rgb(52 211 153 / 0.4)" : "rgb(248 113 113 / 0.4)",
                                border: `1px solid ${isPositive ? "rgb(52 211 153 / 0.6)" : "rgb(248 113 113 / 0.6)"}`,
                              }}
                            />
                            <span className="text-[8px] text-muted-foreground">{f.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {financialPulse.overdueCount > 0 && (
                  <div className="p-2 rounded-lg bg-red-500/5 border border-red-500/10">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />
                      <p className="text-[10px] text-red-300">
                        {financialPulse.overdueCount} overdue invoice{financialPulse.overdueCount > 1 ? "s" : ""} — {formatTTD(financialPulse.overdueReceivables)}
                      </p>
                    </div>
                  </div>
                )}

                {financialPulse.alerts.filter(a => a.severity !== 'INFO').slice(0, 2).map(alert => (
                  <Link
                    key={alert.id}
                    href={alert.action || "/app/commerce"}
                    className="block p-2 rounded-lg transition-colors hover:bg-white/5"
                    style={{
                      backgroundColor: alert.severity === 'CRITICAL' ? "rgb(239 68 68 / 0.05)" : "hsl(var(--kf-accent1) / 0.05)",
                      border: `1px solid ${alert.severity === 'CRITICAL' ? "rgb(239 68 68 / 0.15)" : "hsl(var(--kf-accent1) / 0.15)"}`,
                    }}
                  >
                    <div className="flex items-start gap-1.5">
                      <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: alert.severity === 'CRITICAL' ? "rgb(239 68 68)" : "hsl(var(--kf-accent1))" }} />
                      <p className="text-[10px] leading-relaxed">{alert.message}</p>
                    </div>
                  </Link>
                ))}

                {financialPulse.alerts.filter(a => a.type === 'milestone').map(alert => (
                  <div key={alert.id} className="p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
                    <div className="flex items-start gap-1.5">
                      <Award className="w-3 h-3 text-emerald-400 mt-0.5 flex-shrink-0" />
                      <p className="text-[10px] text-emerald-300 leading-relaxed">{alert.message}</p>
                    </div>
                  </div>
                ))}

                {financialPulse.topUnpaidInvoices.length > 0 && (
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase mb-1.5">Collection Priority</p>
                    <div className="space-y-1">
                      {financialPulse.topUnpaidInvoices.slice(0, 3).map(inv => (
                        <Link
                          key={inv.id}
                          href={`/app/commerce`}
                          className="flex items-center justify-between p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                              inv.priority === 'high' ? 'bg-red-400' : inv.priority === 'medium' ? 'bg-yellow-400' : 'bg-blue-400'
                            }`} />
                            <span className="text-[10px] truncate">{inv.contactName}</span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {inv.daysOverdue > 0 && <span className="text-[9px] text-red-400">{inv.daysOverdue}d</span>}
                            <span className="text-[10px] font-medium">{formatTTD(inv.total)}</span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}

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

          {campaignBriefings.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.17 }} className="bg-white/[0.03] backdrop-blur border border-white/10 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                  <h2 className="text-xs font-semibold uppercase tracking-wider">Campaign Intelligence</h2>
                </div>
                <Link href="/app/marketing?tab=insights" className="text-[10px] text-muted-foreground hover:text-white transition-colors">
                  View All →
                </Link>
              </div>
              <div className="p-4 space-y-3" style={{ maxHeight: 320, overflowY: "auto" }}>
                {campaignBriefings.slice(0, 3).map((cb) => (
                  <div key={cb.id} className="bg-white/5 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold truncate max-w-[70%]">{cb.campaign?.name ?? "Campaign"}</p>
                      <span className="text-[9px] text-muted-foreground">{new Date(cb.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <div className="bg-white/5 rounded p-1.5 text-center">
                        <p className="text-[9px] text-muted-foreground uppercase">Open</p>
                        <p className="text-xs font-semibold">{(cb.openRate ?? 0).toFixed(1)}%</p>
                        {cb.historicalAvgOpenRate != null && cb.openRate != null && (
                          <p className={`text-[9px] ${cb.openRate >= cb.historicalAvgOpenRate ? "text-green-400" : "text-red-400"}`}>
                            {cb.openRate >= cb.historicalAvgOpenRate ? "+" : ""}{(cb.openRate - cb.historicalAvgOpenRate).toFixed(1)}%
                          </p>
                        )}
                      </div>
                      <div className="bg-white/5 rounded p-1.5 text-center">
                        <p className="text-[9px] text-muted-foreground uppercase">Click</p>
                        <p className="text-xs font-semibold">{(cb.clickRate ?? 0).toFixed(1)}%</p>
                        {cb.historicalAvgClickRate != null && cb.clickRate != null && (
                          <p className={`text-[9px] ${cb.clickRate >= cb.historicalAvgClickRate ? "text-green-400" : "text-red-400"}`}>
                            {cb.clickRate >= cb.historicalAvgClickRate ? "+" : ""}{(cb.clickRate - cb.historicalAvgClickRate).toFixed(1)}%
                          </p>
                        )}
                      </div>
                      <div className="bg-white/5 rounded p-1.5 text-center">
                        <p className="text-[9px] text-muted-foreground uppercase">Delivery</p>
                        <p className="text-xs font-semibold">{(cb.deliveryRate ?? 0).toFixed(1)}%</p>
                      </div>
                    </div>
                    {cb.aiBriefing && (
                      <div className="p-2 rounded" style={{ backgroundColor: "hsl(var(--kf-accent1) / 0.08)", border: "1px solid hsl(var(--kf-accent1) / 0.15)" }}>
                        <div className="flex items-start gap-1.5">
                          <Sparkles className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--kf-accent1))" }} />
                          <p className="text-[10px] leading-relaxed text-gray-300 line-clamp-2">{cb.aiBriefing}</p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          )}

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
