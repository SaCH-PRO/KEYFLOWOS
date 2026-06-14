"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  Zap,
  Brain,
  Bot,
  Send,
  Loader2,
  Wallet,
  Receipt,
  CheckSquare,
  Calendar,
  Users,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  ArrowRight,
  Sparkles,
  Clock,
  Activity,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import { openKey } from "@/components/key";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { CommandQueue } from "@/components/command/command-queue";
import { CommandSummaryStrip } from "@/components/command/command-summary-strip";
import { fetchCommandCenter, type CommandCenterDto } from "@/lib/api/os";
import { BusinessPulseCard } from "@/components/business-pulse-card";
import { MetricCard } from "@/components/ui/metric-card";
import {
  fetchCommandItems,
  fetchCommandSummary,
  generateCommandItems,
  dismissCommandItem,
  approveCommandItem,
  executeCommandItem,
  completeCommandItem,
  reopenCommandItem,
  autoScanCommandItems,
  bulkCompleteCommands,
  bulkDismissCommands,
  bulkDeleteCommands,
  type CommandItem,
  type CommandSummary,
} from "@/lib/api/command";
import { runScan } from "@/lib/api/intelligence";

const MOTION_CONFIG = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.25, ease: "easeOut" as const },
};

function HealthPill({ label, score, trend }: { label: string; score: number; trend: "up" | "down" | "flat" }) {
  const color =
    score >= 80
      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
      : score >= 60
        ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
        : "bg-red-500/10 text-red-600 border-red-500/20";
  const trendIcon = trend === "up" ? "↑" : trend === "down" ? "↓" : "→";
  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${color}`}>
      <span>{label}</span>
      <span className="opacity-70">{Math.round(score)}</span>
      <span className="opacity-70">{trendIcon}</span>
    </div>
  );
}

function SectionTitle({ icon: Icon, title, action }: { icon: React.ElementType; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {action}
    </div>
  );
}

function CommandCenterSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-6 w-48 bg-muted rounded-lg" />
          <div className="h-4 w-32 bg-muted rounded-md" />
        </div>
        <div className="h-14 w-14 bg-muted rounded-full" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 bg-muted rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 h-48 bg-muted rounded-xl" />
        <div className="h-48 bg-muted rounded-xl" />
      </div>
      <div className="h-64 bg-muted rounded-xl" />
    </div>
  );
}

export default function CommandCenterPage() {
  const router = useRouter();
  const businessId = getStoredBusinessId() ?? "";

  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<CommandCenterDto | null>(null);
  const [commands, setCommands] = useState<CommandItem[]>([]);
  const [commandTotal, setCommandTotal] = useState(0);
  const [summary, setSummary] = useState<CommandSummary | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [autoScanning, setAutoScanning] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    try {
      const [dashRes, cmdRes, sumRes] = await Promise.all([
        fetchCommandCenter(businessId),
        fetchCommandItems(businessId, { limit: 50 }),
        fetchCommandSummary(businessId),
      ]);
      if (dashRes.data) setDashboard(dashRes.data);
      if (cmdRes.data) {
        setCommands(cmdRes.data.items);
        setCommandTotal(cmdRes.data.total);
      }
      if (sumRes.data) setSummary(sumRes.data);
    } catch {
      // silently fail; UI stays in current or empty state
    }
  }, [businessId]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!businessId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      await load();
      if (!cancelled) setLoading(false);

      // Background auto-scan: do not block UI or show loading state.
      try {
        setAutoScanning(true);
        const scanRes = await autoScanCommandItems(businessId);
        if (!cancelled && scanRes.data?.scanned && (scanRes.data.result?.created ?? 0) > 0) {
          const fresh = await fetchCommandItems(businessId, { limit: 50 });
          if (!cancelled && fresh.data) {
            setCommands(fresh.data.items);
            setCommandTotal(fresh.data.total);
          }
        }
      } catch {
        // ignore background scan failures
      } finally {
        if (!cancelled) setAutoScanning(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [businessId, load]);

  const handleGenerate = async () => {
    if (!businessId) return;
    setGenerating(true);
    try {
      await Promise.all([generateCommandItems(businessId), runScan(businessId)]);
      await load();
      setSelectedIds(new Set());
    } finally {
      setGenerating(false);
    }
  };

  const handleRefresh = async () => {
    setLoading(true);
    await load();
    setLoading(false);
  };

  const updateCommands = (updater: (prev: CommandItem[]) => CommandItem[]) => {
    setCommands((prev) => updater(prev));
  };

  const handleDismiss = async (id: string) => {
    if (!businessId) return;
    const res = await dismissCommandItem(businessId, id);
    if (res.data) {
      updateCommands((prev) => prev.filter((c) => c.id !== id));
      setCommandTotal((prev) => Math.max(0, prev - 1));
    }
  };

  const handleApprove = async (id: string) => {
    if (!businessId) return;
    const res = await approveCommandItem(businessId, id);
    if (res.data) {
      updateCommands((prev) => prev.map((c) => (c.id === id ? { ...c, status: "EXECUTED" } : c)));
    }
  };

  const handleExecute = async (id: string) => {
    if (!businessId) return;
    const res = await executeCommandItem(businessId, id);
    if (res.data) {
      updateCommands((prev) => prev.map((c) => (c.id === id ? { ...c, status: "EXECUTED" } : c)));
    }
  };

  const handleComplete = async (id: string) => {
    if (!businessId) return;
    const res = await completeCommandItem(businessId, id);
    if (res.data) {
      updateCommands((prev) => prev.map((c) => (c.id === id ? { ...c, status: "COMPLETED" } : c)));
    }
  };

  const handleReopen = async (id: string) => {
    if (!businessId) return;
    const res = await reopenCommandItem(businessId, id);
    if (res.data) {
      updateCommands((prev) => prev.map((c) => (c.id === id ? { ...c, status: "OPEN" } : c)));
    }
  };

  const handleSelect = (id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkAction = async (action: "complete" | "dismiss" | "delete") => {
    if (!businessId || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    let res;
    if (action === "complete") res = await bulkCompleteCommands(businessId, ids);
    else if (action === "dismiss") res = await bulkDismissCommands(businessId, ids);
    else res = await bulkDeleteCommands(businessId, ids);

    if (res.data) {
      await load();
      clearSelection();
    }
  };

  const handleKeySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim()) return;
    openKey({ mode: "chat", prompt: keyInput.trim() });
    setKeyInput("");
  };

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  const todayFormatted = useMemo(() => {
    return new Date().toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  }, []);

  const d = dashboard;
  const currency = d?.business.currency ?? "TTD";

  return (
    <UnifiedPageShell
      title="Command Center"
      subtitle="Your AI-powered business cockpit"
      icon={Zap}
      maxWidth="6xl"
      headerActions={
        <button
          onClick={handleRefresh}
          disabled={loading || autoScanning}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:bg-muted/50 disabled:opacity-50"
          style={{ borderColor: "hsl(var(--kf-border))" }}
        >
          {loading || autoScanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </button>
      }
    >
      {loading || !d ? (
        <CommandCenterSkeleton />
      ) : (
        <div className="space-y-6">
          {/* Hero: greeting + pulse */}
          <motion.div {...MOTION_CONFIG} className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 kf-card-accent p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider opacity-70">{todayFormatted}</p>
                <h2 className="text-xl font-bold mt-0.5">
                  {greeting}, {d.business.name}
                </h2>
                <p className="text-sm mt-1 opacity-80 max-w-md">
                  Here is what needs your attention today. KEY has scanned your business and surfaced the highest-impact
                  actions.
                </p>
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  <HealthPill label="Money" score={d.health.money.score} trend={d.health.money.trend} />
                  <HealthPill label="Time" score={d.health.time.score} trend={d.health.time.trend} />
                  <HealthPill label="People" score={d.health.people.score} trend={d.health.people.trend} />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold"
                  style={{
                    background: `conic-gradient(hsl(var(--kf-accent1)) ${d.health.overallScore}%, hsl(var(--kf-border)) 0)`,
                  }}
                >
                  <div className="w-12 h-12 rounded-full bg-background flex items-center justify-center text-sm font-bold">
                    {Math.round(d.health.overallScore)}
                  </div>
                </div>
                <div>
                  <p className="text-xs opacity-70 uppercase tracking-wider">Health Score</p>
                  <p className="text-lg font-bold">
                    {d.health.overallScore >= 80 ? "Excellent" : d.health.overallScore >= 60 ? "Good" : "Needs Attention"}
                  </p>
                </div>
              </div>
            </div>

            <div className="kf-card p-5 flex flex-col justify-center">
              <SectionTitle icon={Brain} title="KEY Briefing" />
              {d.key.briefing ? (
                <p className="text-sm leading-relaxed opacity-90">{d.key.briefing}</p>
              ) : (
                <p className="text-sm opacity-60 italic">No active briefing. Run a scan to generate insights.</p>
              )}
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="mt-4 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {generating ? "Scanning…" : "Scan for Actions"}
              </button>
            </div>
          </motion.div>

          {/* Today snapshot */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.05 }}
          >
            <SectionTitle icon={Activity} title="Today's Snapshot" />
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <MetricCard
                label="Cash Balance"
                value={`${currency} ${d.flows.financial.cashBalance.toLocaleString()}`}
                icon={Wallet}
                iconColor="hsl(var(--kf-success))"
                onClick={() => router.push("/app/financial-flow")}
              />
              <MetricCard
                label="Overdue Invoices"
                value={`${currency} ${d.flows.financial.overdueInvoices.toLocaleString()}`}
                icon={Receipt}
                iconColor="hsl(var(--kf-destructive))"
                onClick={() => router.push("/app/financial-flow")}
              />
              <MetricCard
                label="Due Tasks"
                value={d.today.dueTasks}
                icon={CheckSquare}
                iconColor="hsl(var(--kf-warning))"
                onClick={() => router.push("/app/temporal-flow")}
              />
              <MetricCard
                label="Today's Bookings"
                value={d.today.meetingsOrBookings}
                icon={Calendar}
                iconColor="hsl(var(--kf-accent2))"
                onClick={() => router.push("/app/temporal-flow")}
              />
              <MetricCard
                label="Stale Leads"
                value={d.flows.people.staleLeads}
                icon={Users}
                iconColor="hsl(var(--kf-violet-accent))"
                onClick={() => router.push("/app/people-flow")}
              />
              <MetricCard
                label="Pending Approvals"
                value={d.today.pendingApprovals}
                icon={ShieldAlert}
                iconColor="hsl(var(--kf-destructive))"
                onClick={() => router.push("/app/governance-flow")}
              />
            </div>
          </motion.div>

          {/* Pulse + Governance */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.1 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-4"
          >
            <BusinessPulseCard
              overallScore={d.health.overallScore}
              dimensions={[
                { label: "Money", score: d.health.money.score, trend: d.health.money.trend, color: "hsl(var(--kf-success))" },
                { label: "Time", score: d.health.time.score, trend: d.health.time.trend, color: "hsl(var(--kf-accent2))" },
                { label: "People", score: d.health.people.score, trend: d.health.people.trend, color: "hsl(var(--kf-warning))" },
                { label: "Sales", score: d.health.sales.score, trend: d.health.sales.trend, color: "hsl(var(--kf-accent1))" },
                { label: "Ops", score: d.health.operations.score, trend: d.health.operations.trend, color: "hsl(var(--kf-violet-accent))" },
                { label: "Governance", score: d.health.governance.score, trend: d.health.governance.trend, color: "hsl(var(--kf-destructive))" },
              ]}
              className="lg:col-span-2"
            />
            <div className="kf-card p-5">
              <SectionTitle icon={ShieldCheck} title="Governance" />
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-muted/30 text-center">
                  <p className="text-2xl font-bold" style={{ color: "hsl(var(--kf-accent1))" }}>
                    {d.key.canAutoExecuteCount}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider opacity-70 mt-1">Auto-Ready</p>
                </div>
                <div className="p-3 rounded-xl bg-muted/30 text-center">
                  <p className="text-2xl font-bold text-amber-500">{d.key.needsApprovalCount}</p>
                  <p className="text-[10px] uppercase tracking-wider opacity-70 mt-1">Need Approval</p>
                </div>
                <div className="p-3 rounded-xl bg-muted/30 text-center">
                  <p className="text-2xl font-bold text-emerald-500">{d.today.dueTasks}</p>
                  <p className="text-[10px] uppercase tracking-wider opacity-70 mt-1">Due Today</p>
                </div>
                <div className="p-3 rounded-xl bg-muted/30 text-center">
                  <p className="text-2xl font-bold text-red-500">{d.today.urgentRisks}</p>
                  <p className="text-[10px] uppercase tracking-wider opacity-70 mt-1">Urgent Risks</p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Command Queue */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.15 }}
            className="space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                <h2 className="text-sm font-semibold">Command Queue</h2>
                <span className="text-xs text-muted-foreground">{commandTotal} items</span>
              </div>
              <button
                onClick={() => router.push("/app/key")}
                className="inline-flex items-center gap-1 text-xs font-medium transition-colors hover:opacity-80"
                style={{ color: "hsl(var(--kf-accent1))" }}
              >
                <Brain className="w-3 h-3" />
                Open KEY
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            {summary && <CommandSummaryStrip summary={summary} />}

            <div className="kf-card p-4 md:p-5">
              <CommandQueue
                items={commands}
                total={commandTotal}
                loading={loading}
                onRefresh={handleRefresh}
                selectedIds={selectedIds}
                onSelect={handleSelect}
                onDismiss={handleDismiss}
                onApprove={handleApprove}
                onExecute={handleExecute}
                onComplete={handleComplete}
                onReopen={handleReopen}
              />
            </div>

            {selectedIds.size > 0 && (
              <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg bg-background/95 backdrop-blur-sm"
                style={{ borderColor: "hsl(var(--kf-border))" }}>
                <span className="text-xs font-medium whitespace-nowrap">{selectedIds.size} selected</span>
                <button
                  onClick={() => handleBulkAction("complete")}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-colors"
                >
                  Complete
                </button>
                <button
                  onClick={() => handleBulkAction("dismiss")}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 transition-colors"
                >
                  Dismiss
                </button>
                <button
                  onClick={() => handleBulkAction("delete")}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-red-500/10 text-red-600 hover:bg-red-500/20 transition-colors"
                >
                  Delete
                </button>
                <button
                  onClick={clearSelection}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                >
                  Clear
                </button>
              </div>
            )}
          </motion.div>

          {/* Flow shortcuts */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.2 }}
            className="pt-4 border-t"
            style={{ borderColor: "hsl(var(--kf-border))" }}
          >
            <SectionTitle icon={TrendingUp} title="Flows" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Financial", icon: Wallet, href: "/app/financial-flow", color: "text-emerald-500" },
                { label: "Temporal", icon: Clock, href: "/app/temporal-flow", color: "text-blue-500" },
                { label: "People", icon: Users, href: "/app/people-flow", color: "text-purple-500" },
                { label: "Sales", icon: TrendingUp, href: "/app/sales-flow", color: "text-pink-500" },
              ].map((flow) => (
                <button
                  key={flow.label}
                  onClick={() => router.push(flow.href)}
                  className="flex items-center gap-3 p-3 rounded-xl border hover:bg-muted/50 transition-colors text-left group"
                  style={{ borderColor: "hsl(var(--kf-border))" }}
                >
                  <flow.icon className={`w-5 h-5 ${flow.color}`} />
                  <span className="text-sm font-medium">{flow.label}</span>
                  <ArrowRight className="w-3.5 h-3.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "hsl(var(--kf-accent1))" }} />
                </button>
              ))}
            </div>
          </motion.div>

          {/* KEY input */}
          <motion.form
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.25 }}
            onSubmit={handleKeySubmit}
            className="sticky bottom-0 z-20 bg-background/95 backdrop-blur-sm py-3 -mx-4 px-4 md:static md:bg-transparent md:py-0 md:mx-0 md:px-0 md:backdrop-blur-none"
          >
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="Ask KEY anything about your business..."
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                  style={{ borderColor: "hsl(var(--kf-border))" }}
                />
                <Bot className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
              </div>
              <button
                type="submit"
                disabled={!keyInput.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </motion.form>

          {commands.length === 0 && !loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-8 kf-card"
            >
              <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">No commands in your queue</p>
              <p className="text-xs text-muted-foreground mt-1">Run a scan or ask KEY to surface actions.</p>
            </motion.div>
          )}
        </div>
      )}
    </UnifiedPageShell>
  );
}
