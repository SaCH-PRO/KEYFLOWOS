"use client";

import { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
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
} from "@/lib/client";
import { refreshWorkspace, getStoredBusinessId, getUserDisplayName } from "@/lib/workspace";
import { 
  CheckCircle2, 
  Clock,
  AlertTriangle,
  AlertCircle,
  Info,
  DollarSign,
  Calendar,
  ChevronRight,
  Sparkles,
  Play,
  X,
  Check,
  Zap,
  TrendingUp,
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

function formatTTD(value: number): string {
  return `TTD ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
            <span
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
              style={{ backgroundColor: styles.borderColor, color: "#fff" }}
            >
              {urgencyLabels[priority.urgency]}
            </span>
            {priority.contactName && (
              <span className="text-xs text-muted-foreground truncate">
                {priority.contactName}
              </span>
            )}
          </div>
          <h4 className="font-medium text-sm">{priority.title}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">{priority.description}</p>
          {priority.amount != null && (
            <p className="text-sm font-semibold mt-1" style={{ color: styles.textColor }}>
              {formatTTD(priority.amount)}
            </p>
          )}
          {priority.daysSince != null && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {priority.daysSince} day{priority.daysSince !== 1 ? 's' : ''} ago
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 flex-shrink-0">
          <Link
            href={priority.actionHref}
            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-all hover:scale-105"
            style={{ backgroundColor: styles.borderColor, color: "#fff" }}
          >
            {priority.actionLabel}
          </Link>
          {priority.whatsappLink && (
            <a
              href={priority.whatsappLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-all hover:scale-105 flex items-center gap-1"
            >
              <MessageCircle className="w-3 h-3" />
              WhatsApp
            </a>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function RevenueInsightsCard({ insights }: { insights: RevenueInsights }) {
  const growthPositive = insights.revenueGrowth >= 0;
  const stats = [
    { label: "Avg Client Spend", value: formatTTD(insights.avgClientSpend), icon: <DollarSign className="w-4 h-4" /> },
    { label: "Avg Invoice", value: formatTTD(insights.avgInvoiceValue), icon: <FileText className="w-4 h-4" /> },
    { label: "Lead Conversion", value: `${(insights.leadConversionRate * 100).toFixed(1)}%`, icon: <Target className="w-4 h-4" /> },
    { label: "Client Retention", value: `${(insights.clientRetentionRate * 100).toFixed(1)}%`, icon: <Repeat className="w-4 h-4" /> },
    { label: "Revenue Growth", value: `${growthPositive ? '+' : ''}${(insights.revenueGrowth * 100).toFixed(1)}%`, icon: growthPositive ? <ArrowUpRight className="w-4 h-4 text-green-500" /> : <ArrowDownRight className="w-4 h-4 text-red-500" /> },
    { label: "Total Clients", value: String(insights.totalClients), icon: <Users className="w-4 h-4" /> },
    { label: "Repeat Clients", value: String(insights.repeatClients), icon: <Award className="w-4 h-4" /> },
    { label: "Collection Rate", value: `${(insights.collectionRate * 100).toFixed(1)}%`, icon: <Percent className="w-4 h-4" /> },
  ];

  const targetProgress = insights.monthlyTarget > 0 ? Math.min(insights.monthlyProgress / insights.monthlyTarget, 1) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="kf-card p-5"
    >
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 className="w-5 h-5" style={{ color: "hsl(var(--kf-accent2))" }} />
        <h2 className="text-lg font-semibold">Revenue Insights</h2>
      </div>

      {insights.topService && (
        <div className="mb-4 p-3 rounded-lg" style={{ backgroundColor: "hsl(var(--kf-accent2) / 0.1)", borderLeft: "3px solid hsl(var(--kf-accent2))" }}>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Top Service</p>
          <p className="font-semibold">{insights.topService.name}</p>
          <p className="text-sm text-muted-foreground">
            {formatTTD(insights.topService.revenue)} · {insights.topService.count} booking{insights.topService.count !== 1 ? 's' : ''}
          </p>
        </div>
      )}

      {insights.monthlyTarget > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Monthly Target</span>
            <span>{formatTTD(insights.monthlyProgress)} / {formatTTD(insights.monthlyTarget)}</span>
          </div>
          <div className="kf-momentum-bar">
            <div className="kf-momentum-fill" style={{ width: `${targetProgress * 100}%` }} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className="p-3 rounded-lg bg-muted/30">
            <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
              {stat.icon}
              <span className="text-[10px] uppercase tracking-wider">{stat.label}</span>
            </div>
            <div className="text-sm font-bold">{stat.value}</div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

export default function AppHome() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [cockpit, setCockpit] = useState<CockpitSummary | null>(null);
  const [gamification, setGamification] = useState<GamificationStats | null>(null);
  const [tasks, setTasks] = useState<AutopilotTask[]>([]);
  const [alerts, setAlerts] = useState<CriticalAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completingTask, setCompletingTask] = useState<string | null>(null);

  useEffect(() => {
    const initWorkspace = async () => {
      const fresh = await refreshWorkspace();
      if (fresh) {
        setBusinessId(fresh);
        return;
      }
      const stored = getStoredBusinessId();
      if (stored) {
        setBusinessId(stored);
      }
    };
    void initWorkspace();
  }, []);

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
    } catch (err) {
      console.error("Failed to complete task:", err);
    }
    setCompletingTask(null);
  };

  const handleApproveTask = async (taskId: string) => {
    if (!businessId) return;
    setCompletingTask(taskId);
    try {
      await approveAutopilotTask(taskId, "user", businessId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
      window.dispatchEvent(new CustomEvent("kf:taskCompleted"));
    } catch (err) {
      console.error("Failed to approve task:", err);
    }
    setCompletingTask(null);
  };

  const handleDenyTask = async (taskId: string) => {
    if (!businessId) return;
    setCompletingTask(taskId);
    try {
      await denyAutopilotTask(taskId, businessId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } catch (err) {
      console.error("Failed to deny task:", err);
    }
    setCompletingTask(null);
  };

  const todayRevenue = cockpit?.stats?.todayRevenue ?? 0;
  const monthlyRevenue = cockpit?.stats?.monthlyRevenue ?? 0;
  const pendingInvoices = cockpit?.stats?.pendingInvoices ?? 0;
  const todayBookings = cockpit?.stats?.todayBookings ?? 0;
  const completedBookingsToday = cockpit?.stats?.completedBookingsToday ?? 0;
  const draftPosts = cockpit?.stats?.draftPosts ?? 0;
  const scheduledPosts = cockpit?.stats?.scheduledPosts ?? 0;

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

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500"
        >
          {error}
        </motion.div>
      )}

      {alerts.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-2"
        >
          {alerts.map((alert, idx) => (
            <Link
              key={idx}
              href={alert.action || "#"}
              className={`flex items-center gap-3 p-4 rounded-xl border transition-all hover:scale-[1.01] ${(severityStyles[alert.severity] || severityStyles.INFO).className}`}
              style={(severityStyles[alert.severity] || severityStyles.INFO).style}
            >
              <div className="flex-shrink-0">
                {alertTypeIcons[alert.type] || severityIcons[alert.severity]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{alert.message}</p>
              </div>
              {alert.action && (
                <ChevronRight className="w-5 h-5 flex-shrink-0 opacity-60" />
              )}
            </Link>
          ))}
        </motion.div>
      )}

      <motion.div 
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center py-4"
      >
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          {greeting}{getUserDisplayName() ? `, ${getUserDisplayName()}` : ""}
        </h1>
        <p className="text-muted-foreground mt-1">
          {tasksRemaining > 0 
            ? `You have ${tasksRemaining} task${tasksRemaining > 1 ? 's' : ''} for today`
            : "All caught up for today!"}
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-2 gap-4"
      >
        <div className="kf-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <DollarSign className="w-4 h-4" />
            <span className="text-xs uppercase tracking-wider">Today</span>
          </div>
          <div className="text-2xl font-bold">
            {formatTTD(todayRevenue)}
          </div>
          {pendingInvoices > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              {pendingInvoices} pending invoice{pendingInvoices > 1 ? 's' : ''}
            </p>
          )}
        </div>

        <div className="kf-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Calendar className="w-4 h-4" />
            <span className="text-xs uppercase tracking-wider">Bookings</span>
          </div>
          <div className="text-2xl font-bold">{todayBookings}</div>
          <p className="text-xs text-muted-foreground mt-1">
            scheduled today
          </p>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className="grid grid-cols-3 gap-3"
      >
        <div className="kf-card p-3">
          <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
            <CalendarCheck className="w-3.5 h-3.5" />
            <span className="text-[10px] uppercase tracking-wider">Completed</span>
          </div>
          <div className="text-lg font-bold">{completedBookingsToday}</div>
          <p className="text-[10px] text-muted-foreground">bookings today</p>
        </div>
        <div className="kf-card p-3">
          <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
            <PenTool className="w-3.5 h-3.5" />
            <span className="text-[10px] uppercase tracking-wider">Drafts</span>
          </div>
          <div className="text-lg font-bold">{draftPosts}</div>
          <p className="text-[10px] text-muted-foreground">draft posts</p>
        </div>
        <div className="kf-card p-3">
          <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
            <Send className="w-3.5 h-3.5" />
            <span className="text-[10px] uppercase tracking-wider">Scheduled</span>
          </div>
          <div className="text-lg font-bold">{scheduledPosts}</div>
          <p className="text-[10px] text-muted-foreground">scheduled posts</p>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="kf-card p-4"
      >
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          <TrendingUp className="w-4 h-4" />
          <span className="text-xs uppercase tracking-wider">This Month</span>
        </div>
        <div className="text-2xl font-bold">
          {formatTTD(monthlyRevenue)}
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Momentum</span>
            <span>{Math.round((cockpit?.momentum ?? 0) * 100)}%</span>
          </div>
          <div className="kf-momentum-bar">
            <div 
              className="kf-momentum-fill" 
              style={{ width: `${(cockpit?.momentum ?? 0) * 100}%` }} 
            />
          </div>
        </div>
      </motion.div>

      {priorities.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.17 }}
        >
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
            <h2 className="text-lg font-semibold">Today&apos;s Priorities</h2>
            <span className="ml-auto text-xs text-muted-foreground">{priorities.length} item{priorities.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="space-y-3">
            {priorities.map((priority, idx) => (
              <PriorityCard key={priority.id} priority={priority} index={idx} />
            ))}
          </div>
        </motion.div>
      )}

      {revenueInsights && (
        <RevenueInsightsCard insights={revenueInsights} />
      )}

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
            <h2 className="text-lg font-semibold">Today&apos;s Tasks</h2>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span>{completedToday} done</span>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="kf-card p-4 animate-pulse">
                <div className="h-5 bg-muted rounded w-3/4 mb-2" />
                <div className="h-4 bg-muted rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="kf-card p-8 text-center">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-500" />
            <h3 className="text-lg font-semibold mb-1">All Done!</h3>
            <p className="text-sm text-muted-foreground">
              You've completed all your tasks for today. Great work!
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map((task, idx) => (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 * idx }}
                className="kf-card p-4 group"
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 pt-0.5">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        task.priority === 'HIGH' ? '' : 'bg-muted text-muted-foreground'
                      }`}
                      style={task.priority === 'HIGH' ? { backgroundColor: "hsl(var(--kf-accent1) / 0.2)", color: "hsl(var(--kf-accent1))" } : undefined}
                    >
                      {idx + 1}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium">{task.title}</h3>
                    {task.description && (
                      <p className="text-sm text-muted-foreground mt-0.5">{task.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        {task.category}
                      </span>
                      {task.autoExecutable && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 flex items-center gap-1">
                          <Sparkles className="w-3 h-3" />
                          Auto
                        </span>
                      )}
                      {task.requiresApproval && (
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: "hsl(var(--kf-accent1) / 0.1)", color: "hsl(var(--kf-accent1))" }}>
                          Needs Approval
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0 flex items-center gap-2">
                    {task.requiresApproval && task.status === 'AWAITING_APPROVAL' ? (
                      <>
                        <button
                          onClick={() => handleDenyTask(task.id)}
                          disabled={completingTask === task.id}
                          className="p-2 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                          title="Deny"
                        >
                          <X className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => handleApproveTask(task.id)}
                          disabled={completingTask === task.id}
                          className="p-2 rounded-lg text-green-500 hover:bg-green-500/10 transition-colors disabled:opacity-50"
                          title="Approve"
                        >
                          <Check className="w-5 h-5" />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleCompleteTask(task.id)}
                        disabled={completingTask === task.id}
                        className="p-2 rounded-lg text-green-500 hover:bg-green-500/10 transition-colors disabled:opacity-50 opacity-0 group-hover:opacity-100"
                        title="Mark as done"
                      >
                        {completingTask === task.id ? (
                          <Clock className="w-5 h-5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-5 h-5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25 }}
      >
        <h2 className="text-lg font-semibold mb-4">Quick Links</h2>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          {[
            { label: "Contacts", href: "/app/crm/pipeline", icon: "👥", color: "hsl(var(--kf-accent1))" },
            { label: "Bookings", href: "/app/bookings", icon: "📅", color: "hsl(var(--kf-accent2))" },
            { label: "Commerce", href: "/app/commerce", icon: "💰", color: "hsl(150 60% 40%)" },
            { label: "Social", href: "/app/social", icon: "📱", color: "hsl(200 70% 50%)" },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="kf-card p-4 text-center hover:scale-[1.03] transition-all group"
              style={{ borderColor: `${link.color.replace(")", " / 0.2)")}` }}
            >
              <div className="text-2xl mb-2">{link.icon}</div>
              <div className="text-sm font-medium group-hover:text-[hsl(var(--kf-accent1))] transition-colors">{link.label}</div>
            </Link>
          ))}
        </div>
      </motion.div>

      {cockpit?.quickActions && cockpit.quickActions.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-5 h-5" style={{ color: "hsl(var(--kf-accent2))" }} />
            <h2 className="text-lg font-semibold">Quick Actions</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {cockpit.quickActions.slice(0, 6).map(action => (
              <Link
                key={action.id}
                href={action.href}
                className="kf-card p-4 flex items-center gap-3 hover:scale-[1.02] transition-all group"
                style={{ borderColor: "hsl(var(--kf-accent2) / 0.2)" }}
              >
                <div
                  className="h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: "hsl(var(--kf-accent2) / 0.15)" }}
                >
                  <span style={{ color: "hsl(var(--kf-accent2))" }}>
                    {quickActionIconMap[action.icon] || <Play className="w-5 h-5" />}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{action.label}</div>
                  <div className="text-xs text-muted-foreground truncate">{action.description}</div>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
              </Link>
            ))}
          </div>
        </motion.div>
      )}

      {gamification && gamification.streakDays > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35 }}
          className="kf-card p-4"
          style={{ backgroundImage: "linear-gradient(to right, hsl(var(--kf-accent1) / 0.1), hsl(var(--kf-accent1) / 0.05))", borderColor: "hsl(var(--kf-accent1) / 0.2)" }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: "hsl(var(--kf-accent1) / 0.2)" }}>
                <span className="text-2xl">🔥</span>
              </div>
              <div>
                <div className="font-semibold text-lg">{gamification.streakDays} Day Streak!</div>
                <p className="text-sm text-muted-foreground">Keep it going to unlock bonus rewards</p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-muted-foreground">Level {gamification.level}</div>
              <div className="text-xs text-muted-foreground">
                {gamification.currentXp} / {gamification.currentXp + gamification.xpToNextLevel} XP
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
