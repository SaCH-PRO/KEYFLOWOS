"use client";

import { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { 
  fetchCockpitSummary, 
  fetchGamificationStats, 
  CockpitSummary, 
  GamificationStats,
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

        if (cockpitResult.data) setCockpit(cockpitResult.data);
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

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  const completedToday = gamification?.dailyTasksCompleted ?? 0;
  const tasksRemaining = tasks.length;

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
            TTD {todayRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
        transition={{ delay: 0.15 }}
        className="kf-card p-4"
      >
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          <TrendingUp className="w-4 h-4" />
          <span className="text-xs uppercase tracking-wider">This Month</span>
        </div>
        <div className="text-2xl font-bold">
          TTD {monthlyRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
            <h2 className="text-lg font-semibold">Today's Tasks</h2>
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

      {cockpit?.quickActions && cockpit.quickActions.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {cockpit.quickActions.slice(0, 4).map(action => (
              <Link
                key={action.id}
                href={action.href}
                className="kf-card p-4 flex items-center gap-3 hover:scale-[1.02] transition-all group"
              >
                <div className="h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "hsl(var(--kf-accent1) / 0.1)" }}>
                  <Play className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
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
