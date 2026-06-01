"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Zap,
  Brain,
  Bot,
  Send,
  Loader2,
  Wallet,
  ShieldCheck,
  Receipt,
  CheckSquare,
  Calendar,
  Users,
  ShieldAlert,
  TrendingUp,
  ArrowRight,
  Sparkles,
  Clock,
} from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import { openKey } from "@/components/key";
import { CommandQueue } from "@/components/command/command-queue";
import { CommandSummaryStrip } from "@/components/command/command-summary-strip";
import { fetchCommandCenter, type CommandCenterDto } from "@/lib/api/os";
import {
  fetchCommandItems,
  fetchCommandSummary,
  generateCommandItems,
  dismissCommandItem,
  approveCommandItem,
  executeCommandItem,
  autoScanCommandItems,
  type CommandItem,
  type CommandSummary,
} from "@/lib/api/command";

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
      await generateCommandItems(businessId);
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
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
      {/* Top greeting + quick stats */}
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">
          {greeting}{d?.business.name ? `, ${d.business.name}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">
          {loading ? "Loading your business overview..." : d?.key.briefing}
        </p>
      </div>

      {/* Unified status strip */}
      {!loading && d && (
        <div className="flex flex-wrap items-center gap-2">
          <HealthPill label="Money" score={d.health.money.score} trend={d.health.money.trend} />
          <HealthPill label="Time" score={d.health.time.score} trend={d.health.time.trend} />
          <HealthPill label="People" score={d.health.people.score} trend={d.health.people.trend} />
          <HealthPill label="Sales" score={d.health.sales.score} trend={d.health.sales.trend} />
          <HealthPill label="Ops" score={d.health.operations.score} trend={d.health.operations.trend} />
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Scan
          </button>
        </div>
      )}

      {/* KEY input */}
      <form onSubmit={handleKeySubmit} className="flex gap-2">
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
        <div className="flex items-center gap-3 overflow-x-auto pb-1">
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
        </div>
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
          onDismiss={handleDismiss}
          onApprove={handleApprove}
          onExecute={handleExecute}
        />
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
    </div>
  );
}
