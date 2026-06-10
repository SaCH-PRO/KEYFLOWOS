"use client";

import { useEffect, useState, useCallback } from "react";
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
} from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import { openKey } from "@/components/key";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { CommandQueue } from "@/components/command/command-queue";
import { CommandSummaryStrip } from "@/components/command/command-summary-strip";
import { fetchCommandCenter, type CommandCenterDto } from "@/lib/api/os";
import { BusinessPulseCard } from "@/components/business-pulse-card";
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

function HealthPill({ label, score, trend }: { label: string; score: number; trend: "up" | "down" | "flat" }) {
  const color = score >= 80 ? "bg-emerald-500/10 text-emerald-600" : score >= 60 ? "bg-amber-500/10 text-amber-600" : "bg-red-500/10 text-red-600";
  const trendIcon = trend === "up" ? "↑" : trend === "down" ? "↓" : "→";
  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${color}`}>
      <span>{label}</span>
      <span className="opacity-70">{score}</span>
      <span className="opacity-70">{trendIcon}</span>
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

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
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
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (!businessId) return;
      const [dashRes, cmdRes, sumRes] = await Promise.all([
        fetchCommandCenter(businessId),
        fetchCommandItems(businessId, { limit: 50 }),
        fetchCommandSummary(businessId),
      ]);
      if (cancelled) return;
      if (dashRes.data) setDashboard(dashRes.data);
      if (cmdRes.data) {
        setCommands(cmdRes.data.items);
        setCommandTotal(cmdRes.data.total);
      }
      if (sumRes.data) setSummary(sumRes.data);
      setLoading(false);

      // Auto-scan if stale (runs after initial render to not block UI)
      try {
        const scanRes = await autoScanCommandItems(businessId);
        if (scanRes.data?.scanned && (scanRes.data.result?.created ?? 0) > 0) {
          // Refresh if new items were created
          const fresh = await fetchCommandItems(businessId, { limit: 50 });
          if (!cancelled && fresh.data) {
            setCommands(fresh.data.items);
            setCommandTotal(fresh.data.total);
          }
        }
      } catch {
        // silently fail auto-scan
      }
    }
    init();
    return () => { cancelled = true; };
  }, [businessId]);

  const handleGenerate = async () => {
    if (!businessId) return;
    setGenerating(true);
    try {
      await Promise.all([
        generateCommandItems(businessId),
        runScan(businessId),
      ]);
      await load();
    } finally {
      setGenerating(false);
    }
  };

  const handleDismiss = async (id: string) => {
    if (!businessId) return;
    const res = await dismissCommandItem(businessId, id);
    if (res.data) {
      setCommands((prev) => prev.filter((c) => c.id !== id));
      setCommandTotal((prev) => Math.max(0, prev - 1));
    }
  };

  const handleApprove = async (id: string) => {
    if (!businessId) return;
    const res = await approveCommandItem(businessId, id);
    if (res.data) {
      setCommands((prev) => prev.map((c) => (c.id === id ? { ...c, status: "EXECUTED" } : c)));
    }
  };

  const handleExecute = async (id: string) => {
    if (!businessId) return;
    const res = await executeCommandItem(businessId, id);
    if (res.data) {
      setCommands((prev) => prev.map((c) => (c.id === id ? { ...c, status: "EXECUTED" } : c)));
    }
  };

  const handleComplete = async (id: string) => {
    if (!businessId) return;
    const res = await completeCommandItem(businessId, id);
    if (res.data) {
      setCommands((prev) => prev.map((c) => (c.id === id ? { ...c, status: "COMPLETED" } : c)));
    }
  };

  const handleReopen = async (id: string) => {
    if (!businessId) return;
    const res = await reopenCommandItem(businessId, id);
    if (res.data) {
      setCommands((prev) => prev.map((c) => (c.id === id ? { ...c, status: "OPEN" } : c)));
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

  const handleBulkComplete = async () => {
    if (!businessId || selectedIds.size === 0) return;
    const res = await bulkCompleteCommands(businessId, Array.from(selectedIds));
    if (res.data) {
      await load();
      clearSelection();
    }
  };

  const handleBulkDismiss = async () => {
    if (!businessId || selectedIds.size === 0) return;
    const res = await bulkDismissCommands(businessId, Array.from(selectedIds));
    if (res.data) {
      await load();
      clearSelection();
    }
  };

  const handleBulkDelete = async () => {
    if (!businessId || selectedIds.size === 0) return;
    const res = await bulkDeleteCommands(businessId, Array.from(selectedIds));
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

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  })();

  const d = dashboard;
  const currency = d?.business.currency ?? "TTD";

  return (
    <UnifiedPageShell
      title="Command Center"
      subtitle="Your business cockpit. Health, actions, and quick navigation."
      icon={Zap}
      maxWidth="5xl"
    >
      {/* Business Pulse + Health Pills */}
      {!loading && d && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 lg:grid-cols-3 gap-3"
        >
          <BusinessPulseCard
            overallScore={d.health.overallScore}
            dimensions={[
              { label: "Money", score: d.health.money.score, trend: d.health.money.trend, color: "hsl(var(--kf-success))" },
              { label: "Time", score: d.health.time.score, trend: d.health.time.trend, color: "hsl(var(--kf-accent2))" },
              { label: "People", score: d.health.people.score, trend: d.health.people.trend, color: "hsl(var(--kf-warning))" },
              { label: "Sales", score: d.health.sales.score, trend: d.health.sales.trend, color: "hsl(var(--kf-accent1))" },
              { label: "Ops", score: d.health.operations.score, trend: d.health.operations.trend, color: "hsl(var(--kf-violet-accent))" },
            ]}
            className="lg:col-span-2"
          />
          <motion.div
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="kf-card kf-radius-lg p-4 flex flex-col justify-center gap-2"
          >
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
              <h3 className="text-sm font-semibold">Quick Actions</h3>
            </div>
            <div className="flex flex-col md:flex-row md:flex-wrap gap-2">
              <HealthPill label="Money" score={d.health.money.score} trend={d.health.money.trend} />
              <HealthPill label="Time" score={d.health.time.score} trend={d.health.time.trend} />
              <HealthPill label="People" score={d.health.people.score} trend={d.health.people.trend} />
              <HealthPill label="Sales" score={d.health.sales.score} trend={d.health.sales.trend} />
              <HealthPill label="Ops" score={d.health.operations.score} trend={d.health.operations.trend} />
            </div>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="mt-1 inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Scan for Actions
            </button>
          </motion.div>
        </motion.div>
      )}

      {/* KEY input */}
      <form onSubmit={handleKeySubmit} className="flex gap-2 sticky bottom-0 z-20 bg-background/95 backdrop-blur-sm py-2 -mx-4 px-4 md:static md:bg-transparent md:py-0 md:mx-0 md:px-0 md:backdrop-blur-none">
        <div className="flex-1 relative">
          <input
            type="text"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="Ask KEY anything..."
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
      </form>

      {/* Today snapshot — single row */}
      {!loading && d && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="flex items-center gap-3 overflow-x-auto pb-1"
        >
          <button onClick={() => router.push("/app/financial-flow")} className="flex items-center gap-2 px-3 py-2 rounded-xl border hover:bg-muted/50 transition-colors text-left whitespace-nowrap" style={{ borderColor: "hsl(var(--kf-border))" }}>
            <Wallet className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-xs font-medium">{currency} {d.flows.financial.cashBalance.toLocaleString()}</span>
          </button>
          <button onClick={() => router.push("/app/financial-flow")} className="flex items-center gap-2 px-3 py-2 rounded-xl border hover:bg-muted/50 transition-colors text-left whitespace-nowrap" style={{ borderColor: "hsl(var(--kf-border))" }}>
            <Receipt className="w-3.5 h-3.5 text-red-500" />
            <span className="text-xs font-medium">{currency} {d.flows.financial.overdueInvoices.toLocaleString()} overdue</span>
          </button>
          <button onClick={() => router.push("/app/temporal-flow")} className="flex items-center gap-2 px-3 py-2 rounded-xl border hover:bg-muted/50 transition-colors text-left whitespace-nowrap" style={{ borderColor: "hsl(var(--kf-border))" }}>
            <CheckSquare className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-xs font-medium">{d.today.dueTasks} tasks</span>
          </button>
          <button onClick={() => router.push("/app/temporal-flow")} className="flex items-center gap-2 px-3 py-2 rounded-xl border hover:bg-muted/50 transition-colors text-left whitespace-nowrap" style={{ borderColor: "hsl(var(--kf-border))" }}>
            <Calendar className="w-3.5 h-3.5 text-blue-500" />
            <span className="text-xs font-medium">{d.today.meetingsOrBookings} today</span>
          </button>
          <button onClick={() => router.push("/app/people-flow")} className="flex items-center gap-2 px-3 py-2 rounded-xl border hover:bg-muted/50 transition-colors text-left whitespace-nowrap" style={{ borderColor: "hsl(var(--kf-border))" }}>
            <Users className="w-3.5 h-3.5 text-purple-500" />
            <span className="text-xs font-medium">{d.flows.people.staleLeads} stale leads</span>
          </button>
          {d.today.pendingApprovals > 0 && (
            <button onClick={() => router.push("/app/governance-flow")} className="flex items-center gap-2 px-3 py-2 rounded-xl border hover:bg-muted/50 transition-colors text-left whitespace-nowrap" style={{ borderColor: "hsl(var(--kf-border))" }}>
              <ShieldAlert className="w-3.5 h-3.5 text-red-500" />
              <span className="text-xs font-medium">{d.today.pendingApprovals} approvals</span>
            </button>
          )}
        </motion.div>
      )}

      {/* KEY Briefing + Alerts */}
      {!loading && d && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="grid grid-cols-1 md:grid-cols-2 gap-3"
        >
          {d.key.briefing && (
            <div className="kf-card kf-radius-lg p-4 border-l-4" style={{ borderLeftColor: "hsl(var(--kf-accent1))" }}>
              <div className="flex items-center gap-2 mb-1">
                <Brain className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                <h3 className="text-sm font-semibold">KEY Briefing</h3>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{d.key.briefing}</p>
            </div>
          )}
          <div className="kf-card kf-radius-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
              <h3 className="text-sm font-semibold">Governance</h3>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="text-center">
                <p className="text-base md:text-lg font-bold" style={{ color: "hsl(var(--kf-accent1))" }}>{d.key.canAutoExecuteCount}</p>
                <p className="text-[10px] text-muted-foreground">Auto-Ready</p>
              </div>
              <div className="w-px h-8 bg-border/60" />
              <div className="text-center">
                <p className="text-base md:text-lg font-bold text-amber-500">{d.key.needsApprovalCount}</p>
                <p className="text-[10px] text-muted-foreground">Needs Approval</p>
              </div>
              <div className="w-px h-8 bg-border/60" />
              <div className="text-center">
                <p className="text-base md:text-lg font-bold text-emerald-500">{d.today.dueTasks}</p>
                <p className="text-[10px] text-muted-foreground">Due Today</p>
              </div>
              <div className="w-px h-8 bg-border/60" />
              <div className="text-center">
                <p className="text-base md:text-lg font-bold text-red-500">{d.today.urgentRisks}</p>
                <p className="text-[10px] text-muted-foreground">Urgent Risks</p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Command Queue — the main stage */}
      <div className="space-y-3">
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

        {summary && <CommandSummaryStrip summary={summary} className="mb-2" />}

        <CommandQueue
          items={commands}
          total={commandTotal}
          loading={loading}
          onRefresh={load}
          selectedIds={selectedIds}
          onSelect={handleSelect}
          onDismiss={handleDismiss}
          onApprove={handleApprove}
          onExecute={handleExecute}
          onComplete={handleComplete}
          onReopen={handleReopen}
        />

        {selectedIds.size > 0 && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg bg-background/95 backdrop-blur-sm"
            style={{ borderColor: "hsl(var(--kf-border))" }}>
            <span className="text-xs font-medium whitespace-nowrap">{selectedIds.size} selected</span>
            <button
              onClick={handleBulkComplete}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-colors"
            >
              Complete {selectedIds.size}
            </button>
            <button
              onClick={handleBulkDismiss}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 transition-colors"
            >
              Dismiss {selectedIds.size}
            </button>
            <button
              onClick={handleBulkDelete}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-red-500/10 text-red-600 hover:bg-red-500/20 transition-colors"
            >
              Delete {selectedIds.size}
            </button>
            <button
              onClick={clearSelection}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Flow quick links — minimal horizontal strip */}
      {!loading && d && (
        <div className="pt-4 border-t" style={{ borderColor: "hsl(var(--kf-border))" }}>
          <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">Flows</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <button onClick={() => router.push("/app/financial-flow")} className="flex items-center gap-2 p-2.5 rounded-xl border hover:bg-muted/50 transition-colors text-left" style={{ borderColor: "hsl(var(--kf-border))" }}>
              <Wallet className="w-4 h-4 text-emerald-500" />
              <span className="text-xs font-medium">Financial</span>
            </button>
            <button onClick={() => router.push("/app/temporal-flow")} className="flex items-center gap-2 p-2.5 rounded-xl border hover:bg-muted/50 transition-colors text-left" style={{ borderColor: "hsl(var(--kf-border))" }}>
              <Clock className="w-4 h-4 text-blue-500" />
              <span className="text-xs font-medium">Temporal</span>
            </button>
            <button onClick={() => router.push("/app/people-flow")} className="flex items-center gap-2 p-2.5 rounded-xl border hover:bg-muted/50 transition-colors text-left" style={{ borderColor: "hsl(var(--kf-border))" }}>
              <Users className="w-4 h-4 text-purple-500" />
              <span className="text-xs font-medium">People</span>
            </button>
            <button onClick={() => router.push("/app/sales-flow")} className="flex items-center gap-2 p-2.5 rounded-xl border hover:bg-muted/50 transition-colors text-left" style={{ borderColor: "hsl(var(--kf-border))" }}>
              <TrendingUp className="w-4 h-4 text-pink-500" />
              <span className="text-xs font-medium">Sales</span>
            </button>
          </div>
        </div>
      )}
    </UnifiedPageShell>
  );
}
