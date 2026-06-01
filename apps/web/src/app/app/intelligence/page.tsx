"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Activity,
  Zap,
  Users,
  Banknote,
  CalendarDays,
  Workflow,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  Target,
  Lightbulb,
  BarChart3,
  PieChart,
  Clock,
  Shield,
  Globe,
  MessageSquare,
  ShoppingCart,
  RefreshCw,
  ChevronRight,
  Bot,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { formatCurrency } from "@/lib/currency";

/* ─────────── Types ─────────── */

interface ModulePulse {
  module: string;
  label: string;
  icon: string;
  health: number;
  trend: "up" | "down" | "flat";
  alerts: number;
  insights: number;
  lastActivity: string;
  kpi?: { label: string; value: string; change?: string };
}

interface CrossModuleInsight {
  id: string;
  type: "opportunity" | "risk" | "pattern" | "suggestion";
  title: string;
  description: string;
  modules: string[];
  impact: "high" | "medium" | "low";
  actionable: boolean;
  actionRoute?: string;
  actionLabel?: string;
}

interface SystemSnapshot {
  momentumScore: number;
  healthScore: number;
  automationCoverage: number;
  dataQuality: number;
  activeModules: number;
  totalModules: number;
}

/* ─────────── Mock data helpers ─────────── */

const MODULE_CONFIG: Record<string, { label: string; icon: any; route: string }> = {
  finance: { label: "Financial Flow", icon: Banknote, route: "/app/money" },
  network: { label: "Network", icon: Users, route: "/app/network/contacts" },
  calendar: { label: "Calendar", icon: CalendarDays, route: "/app/calendar" },
  automations: { label: "Automations", icon: Workflow, route: "/app/automations" },
  projects: { label: "Projects", icon: Target, route: "/app/projects" },
  commerce: { label: "Commerce", icon: ShoppingCart, route: "/app/commerce" },
  communications: { label: "Communications", icon: MessageSquare, route: "/app/inbox" },
  documents: { label: "Documents", icon: FileText, route: "/app/documents" },
};

/* ─────────── Components ─────────── */

function PulseOrb({ health, size = 40 }: { health: number; size?: number }) {
  const color = health >= 80 ? "#10b981" : health >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <div
        className="absolute inset-0 rounded-full animate-ping opacity-20"
        style={{ backgroundColor: color }}
      />
      <div
        className="absolute inset-1 rounded-full"
        style={{ backgroundColor: color, opacity: 0.3 }}
      />
      <div
        className="absolute inset-2 rounded-full flex items-center justify-center text-[10px] font-bold"
        style={{ backgroundColor: color, color: "#fff" }}
      >
        {health}
      </div>
    </div>
  );
}

function TrendIndicator({ trend }: { trend: "up" | "down" | "flat" }) {
  if (trend === "up") return <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />;
  if (trend === "down") return <TrendingDown className="w-3.5 h-3.5 text-rose-500" />;
  return <Activity className="w-3.5 h-3.5 text-muted-foreground" />;
}

function InsightCard({ insight, index }: { insight: CrossModuleInsight; index: number }) {
  const router = useRouter();
  const typeConfig = {
    opportunity: { bg: "bg-emerald-500/5", border: "border-emerald-500/20", icon: Sparkles, iconColor: "text-emerald-500" },
    risk: { bg: "bg-rose-500/5", border: "border-rose-500/20", icon: AlertTriangle, iconColor: "text-rose-500" },
    pattern: { bg: "bg-amber-500/5", border: "border-amber-500/20", icon: Lightbulb, iconColor: "text-amber-500" },
    suggestion: { bg: "bg-[hsl(var(--kf-accent2))]/5", border: "border-[hsl(var(--kf-accent2))]/20", icon: Brain, iconColor: "text-[hsl(var(--kf-accent2))]" },
  };
  const config = typeConfig[insight.type];
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.35 }}
      className={`rounded-xl border ${config.border} ${config.bg} p-4 hover:shadow-md transition-all cursor-pointer group`}
      onClick={() => insight.actionRoute && router.push(insight.actionRoute)}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 ${config.iconColor}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-foreground">{insight.title}</h3>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
              insight.impact === "high" ? "bg-rose-500/10 text-rose-500" :
              insight.impact === "medium" ? "bg-amber-500/10 text-amber-500" :
              "bg-emerald-500/10 text-emerald-500"
            }`}>
              {insight.impact}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed mb-2">{insight.description}</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {insight.modules.map((m) => (
              <span key={m} className="text-[10px] px-1.5 py-0.5 rounded-md bg-background/60 border border-border/30 text-muted-foreground">
                {m}
              </span>
            ))}
          </div>
          {insight.actionable && insight.actionLabel && (
            <div className="flex items-center gap-1 mt-2 text-xs font-medium text-[hsl(var(--kf-accent1))] group-hover:underline">
              {insight.actionLabel}
              <ArrowRight className="w-3 h-3" />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function ModuleCard({ module, index }: { module: ModulePulse; index: number }) {
  const router = useRouter();
  const config = MODULE_CONFIG[module.module];
  if (!config) return null;
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      className="rounded-xl border border-border/40 bg-card/60 backdrop-blur-sm p-3.5 hover:border-[hsl(var(--kf-accent1))]/30 hover:bg-card/80 transition-all cursor-pointer group"
      onClick={() => router.push(config.route)}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-muted/40 flex items-center justify-center group-hover:bg-[hsl(var(--kf-accent1))]/10 transition-colors">
            <Icon className="w-4 h-4 text-muted-foreground group-hover:text-[hsl(var(--kf-accent1))] transition-colors" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-foreground">{config.label}</h4>
            <p className="text-[10px] text-muted-foreground">{module.lastActivity}</p>
          </div>
        </div>
        <PulseOrb health={module.health} size={32} />
      </div>

      {module.kpi && (
        <div className="mb-2">
          <div className="text-lg font-bold tabular-nums">{module.kpi.value}</div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground">{module.kpi.label}</span>
            {module.kpi.change && (
              <span className={`text-[10px] font-medium ${module.kpi.change.startsWith("+") ? "text-emerald-500" : "text-rose-500"}`}>
                {module.kpi.change}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border/20">
        {module.alerts > 0 && (
          <div className="flex items-center gap-1 text-[10px] text-rose-500">
            <AlertTriangle className="w-3 h-3" />
            {module.alerts}
          </div>
        )}
        {module.insights > 0 && (
          <div className="flex items-center gap-1 text-[10px] text-[hsl(var(--kf-accent2))]">
            <Sparkles className="w-3 h-3" />
            {module.insights}
          </div>
        )}
        <div className="ml-auto">
          <TrendIndicator trend={module.trend} />
        </div>
      </div>
    </motion.div>
  );
}

function ScoreRing({ score, label, size = 60, color }: { score: number; label: string; size?: number; color?: string }) {
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const defaultColor = score >= 80 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444";
  const c = color || defaultColor;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="hsl(var(--kf-border))" strokeWidth={strokeWidth} />
          <circle
            cx={size / 2} cy={size / 2} r={radius} fill="none"
            stroke={c} strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold">{score}</span>
        </div>
      </div>
      <span className="text-[10px] text-muted-foreground font-medium">{label}</span>
    </div>
  );
}

/* ─────────── Main Page ─────────── */

export default function IntelligencePage() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<SystemSnapshot>({
    momentumScore: 72,
    healthScore: 85,
    automationCoverage: 45,
    dataQuality: 92,
    activeModules: 12,
    totalModules: 18,
  });

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
    const timer = setTimeout(() => setLoading(false), 800);
    return () => clearTimeout(timer);
  }, []);

  const modules: ModulePulse[] = useMemo(() => [
    { module: "finance", label: "Financial Flow", icon: "banknote", health: 88, trend: "up", alerts: 0, insights: 3, lastActivity: "2 min ago", kpi: { label: "Cash", value: "$24,500", change: "+12%" } },
    { module: "network", label: "Network", icon: "users", health: 76, trend: "up", alerts: 2, insights: 5, lastActivity: "5 min ago", kpi: { label: "Contacts", value: "1,247", change: "+8" } },
    { module: "calendar", label: "Calendar", icon: "calendar", health: 92, trend: "flat", alerts: 0, insights: 1, lastActivity: "1 min ago", kpi: { label: "Today", value: "6 events" } },
    { module: "automations", label: "Automations", icon: "workflow", health: 65, trend: "up", alerts: 1, insights: 4, lastActivity: "12 min ago", kpi: { label: "Active", value: "8 flows" } },
    { module: "projects", label: "Projects", icon: "target", health: 81, trend: "down", alerts: 0, insights: 2, lastActivity: "1 hr ago", kpi: { label: "Active", value: "4 projects" } },
    { module: "commerce", label: "Commerce", icon: "shopping-cart", health: 73, trend: "up", alerts: 1, insights: 3, lastActivity: "8 min ago", kpi: { label: "Revenue", value: "$3,200", change: "+5%" } },
    { module: "communications", label: "Communications", icon: "message-square", health: 89, trend: "flat", alerts: 0, insights: 2, lastActivity: "3 min ago", kpi: { label: "Unread", value: "12" } },
    { module: "documents", label: "Documents", icon: "file-text", health: 94, trend: "up", alerts: 0, insights: 1, lastActivity: "30 min ago", kpi: { label: "Generated", value: "47" } },
  ], []);

  const insights: CrossModuleInsight[] = useMemo(() => [
    { id: "1", type: "opportunity", title: "Revenue Leak Detected", description: "3 invoices are 15+ days overdue totaling $4,200. Automating follow-ups could recover 80% within 48 hours.", modules: ["finance", "automations", "network"], impact: "high", actionable: true, actionRoute: "/app/money", actionLabel: "Review Invoices" },
    { id: "2", type: "pattern", title: "Booking Gap Pattern", description: "Tuesdays show 40% lower booking volume. A targeted email campaign could fill 3-4 slots weekly.", modules: ["calendar", "communications", "commerce"], impact: "medium", actionable: true, actionRoute: "/app/calendar", actionLabel: "View Calendar" },
    { id: "3", type: "risk", title: "Contact Stagnation", description: "47 high-value contacts have had no interaction in 60+ days. 12 are at risk of churning.", modules: ["network", "automations"], impact: "high", actionable: true, actionRoute: "/app/network/contacts", actionLabel: "View Contacts" },
    { id: "4", type: "suggestion", title: "Automation Opportunity", description: "You manually process 12 similar tasks daily. A 3-step flow could save 2.5 hours per week.", modules: ["automations", "projects"], impact: "medium", actionable: true, actionRoute: "/app/automations", actionLabel: "Build Flow" },
    { id: "5", type: "pattern", title: "Peak Revenue Window", description: "Historical data shows Friday 2-4pm has 3x conversion rate. Consider running promotions then.", modules: ["commerce", "finance"], impact: "medium", actionable: false },
    { id: "6", type: "opportunity", title: "Cross-sell Ready", description: "8 clients who purchased Service A haven't been offered Service B. Expected uplift: $1,600.", modules: ["network", "commerce"], impact: "high", actionable: true, actionRoute: "/app/network/contacts", actionLabel: "View Opportunities" },
  ], []);

  const filteredInsights = insights;
  const [activeFilter, setActiveFilter] = useState<"all" | "opportunity" | "risk" | "pattern" | "suggestion">("all");

  const displayedInsights = useMemo(() => {
    if (activeFilter === "all") return insights;
    return insights.filter((i) => i.type === activeFilter);
  }, [activeFilter, insights]);

  if (loading) {
    return (
      <WorkspaceShell icon={Brain} title="Intelligence" subtitle="AI-powered cross-module insights and system awareness">
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border/40 bg-card/40 p-4 h-28 animate-pulse" />
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border/40 bg-card/40 p-4 h-36 animate-pulse" />
            ))}
          </div>
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell icon={Brain} title="Intelligence" subtitle="AI-powered cross-module insights and system awareness">
      <div className="space-y-6">
        {/* ─── System Health Row ─── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm p-5"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
              <h2 className="text-sm font-semibold text-foreground">System Intelligence</h2>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </div>
          </div>
          <div className="flex items-center justify-around flex-wrap gap-4">
            <ScoreRing score={snapshot.momentumScore} label="Momentum" color="hsl(var(--kf-accent1))" />
            <ScoreRing score={snapshot.healthScore} label="Health" />
            <ScoreRing score={snapshot.automationCoverage} label="Automation" color="hsl(var(--kf-accent2))" />
            <ScoreRing score={snapshot.dataQuality} label="Data Quality" />
            <div className="flex flex-col items-center gap-1">
              <div className="text-2xl font-bold">{snapshot.activeModules}/{snapshot.totalModules}</div>
              <span className="text-[10px] text-muted-foreground font-medium">Active Modules</span>
            </div>
          </div>
        </motion.div>

        {/* ─── Module Pulse Grid ─── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Activity className="w-4 h-4 text-muted-foreground" />
              Module Pulse
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {modules.map((m, i) => (
              <ModuleCard key={m.module} module={m} index={i} />
            ))}
          </div>
        </div>

        {/* ─── Cross-Module Insights ─── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
              Cross-Module Insights
            </h2>
            <div className="flex items-center gap-1">
              {(["all", "opportunity", "risk", "pattern", "suggestion"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setActiveFilter(f)}
                  className={`text-[10px] px-2 py-1 rounded-md font-medium transition-all ${
                    activeFilter === f
                      ? "bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                  }`}
                >
                  {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <AnimatePresence mode="popLayout">
              {displayedInsights.map((insight, i) => (
                <InsightCard key={insight.id} insight={insight} index={i} />
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* ─── Quick Actions ─── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm p-5"
        >
          <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            Recommended Actions
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {[
              { label: "Run Revenue Recovery", icon: Banknote, route: "/app/money", desc: "Auto-follow up on overdue invoices" },
              { label: "Re-engage Contacts", icon: Users, route: "/app/network/contacts", desc: "Launch sequence to idle contacts" },
              { label: "Build Flow", icon: Workflow, route: "/app/automations", desc: "Automate your top manual task" },
              { label: "Optimize Calendar", icon: CalendarDays, route: "/app/calendar", desc: "Fill gaps with AI suggestions" },
            ].map((action) => (
              <button
                key={action.label}
                onClick={() => router.push(action.route)}
                className="flex items-center gap-3 p-3 rounded-xl border border-border/30 bg-card/30 hover:bg-card/60 hover:border-[hsl(var(--kf-accent1))]/20 transition-all text-left group"
              >
                <div className="w-9 h-9 rounded-lg bg-[hsl(var(--kf-accent1))]/10 flex items-center justify-center shrink-0 group-hover:bg-[hsl(var(--kf-accent1))]/15 transition-colors">
                  <action.icon className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-foreground">{action.label}</div>
                  <div className="text-[10px] text-muted-foreground">{action.desc}</div>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}
          </div>
        </motion.div>
      </div>
    </WorkspaceShell>
  );
}
