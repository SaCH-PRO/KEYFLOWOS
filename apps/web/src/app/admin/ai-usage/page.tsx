"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Brain,
  Coins,
  DollarSign,
  Hash,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  TrendingUp,
  Zap,
} from "lucide-react";
import { apiGet } from "@/lib/api";
import { cn } from "@/lib/utils";
import { DataTable } from "@/components/ui/data-table";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

interface PlatformSummary {
  periodStart: string;
  periodEnd: string;
  totals: {
    calls: number;
    creditsUsed: number;
    estimatedCost: number;
    totalTokens: number;
  };
  topBusinesses: Array<{
    businessId: string;
    credits: number;
    calls: number;
    cost: number;
  }>;
  byFeature: Array<{
    feature: string;
    credits: number;
    calls: number;
    cost: number;
  }>;
  byProvider: Array<{
    provider: string;
    credits: number;
    calls: number;
    tokens: number;
    cost: number;
  }>;
  alerts: {
    total: number;
    unnotified: number;
  };
}

interface AlertItem {
  id: string;
  businessId: string;
  type: string;
  threshold: number | null;
  triggeredAt: string;
  notified: boolean;
  metadata: Record<string, unknown>;
}

const PROVIDER_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

const RECHARTS_TOOLTIP_STYLE = {
  contentStyle: {
    background: "rgba(2,6,23,0.95)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "12px",
    color: "#e2e8f0",
    fontSize: 12,
  },
};

function MetricCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-slate-950/70 p-4 shadow-soft-elevated">
      <div className="flex items-center gap-2">
        <div className={cn("h-8 w-8 rounded-xl flex items-center justify-center", accent)}>
          <Icon className="w-4 h-4 text-white" />
        </div>
        <div className="text-xs text-muted-foreground uppercase tracking-[0.12em]">{label}</div>
      </div>
      <div className="text-xl font-semibold mt-2">{value}</div>
    </div>
  );
}

export default function AdminAiUsagePage() {
  const [summary, setSummary] = useState<PlatformSummary | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [summaryRes, alertsRes] = await Promise.all([
      apiGet<PlatformSummary>("/api/admin/ai-usage/platform-summary"),
      apiGet<{ alerts: AlertItem[]; total: number }>("/api/admin/ai-usage/platform-alerts?limit=50"),
    ]);

    if (summaryRes.error || !summaryRes.data) {
      setError(summaryRes.error ?? "Failed to load platform summary");
    } else {
      setSummary(summaryRes.data);
    }

    if (alertsRes.data) {
      setAlerts(alertsRes.data.alerts);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const formatNumber = (n: number) =>
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Usage</h1>
          <p className="text-sm text-muted-foreground">
            Platform-wide AI consumption, costs, and credit alerts.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-border/70 bg-slate-950/70 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <Loader2 className={cn("w-4 h-4", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      {summary && (
        <>
          {/* Metric cards */}
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Total Calls"
              value={formatNumber(summary.totals.calls)}
              icon={Hash}
              accent="bg-blue-500/20"
            />
            <MetricCard
              label="Credits Used"
              value={formatNumber(summary.totals.creditsUsed)}
              icon={Coins}
              accent="bg-emerald-500/20"
            />
            <MetricCard
              label="Est. API Cost"
              value={formatCurrency(summary.totals.estimatedCost)}
              icon={DollarSign}
              accent="bg-amber-500/20"
            />
            <MetricCard
              label="Total Tokens"
              value={formatNumber(summary.totals.totalTokens)}
              icon={Zap}
              accent="bg-violet-500/20"
            />
          </div>

          {/* Alerts banner */}
          {summary.alerts.unnotified > 0 && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
              <div className="text-sm text-amber-200">
                <span className="font-semibold">{summary.alerts.unnotified}</span> unnotified AI usage
                alert{summary.alerts.unnotified === 1 ? "" : "s"} across businesses.
              </div>
            </div>
          )}

          {summary.alerts.unnotified === 0 && summary.alerts.total > 0 && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <div className="text-sm text-emerald-200">
                All {summary.alerts.total} alert{summary.alerts.total === 1 ? "" : "s"} have been dispatched.
              </div>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Feature breakdown chart */}
            <div className="rounded-2xl border border-border/70 bg-slate-950/70 p-5">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-muted-foreground" />
                Top Features by Credits
              </h3>
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={summary.byFeature.slice(0, 10)} layout="vertical">
                    <XAxis type="number" hide />
                    <YAxis
                      dataKey="feature"
                      type="category"
                      width={120}
                      tick={{ fontSize: 11, fill: "#94a3b8" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip {...RECHARTS_TOOLTIP_STYLE} />
                    <Bar dataKey="credits" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Provider breakdown chart */}
            <div className="rounded-2xl border border-border/70 bg-slate-950/70 p-5">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Brain className="w-4 h-4 text-muted-foreground" />
                Provider Distribution
              </h3>
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={summary.byProvider}
                      dataKey="credits"
                      nameKey="provider"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={({ provider, percent }) =>
                        `${provider} ${(percent * 100).toFixed(0)}%`
                      }
                      labelLine={false}
                    >
                      {summary.byProvider.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={PROVIDER_COLORS[index % PROVIDER_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip {...RECHARTS_TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Top businesses table */}
          <div className="rounded-2xl border border-border/70 bg-slate-950/70 p-5">
            <h3 className="text-sm font-semibold mb-4">Top Businesses by AI Usage</h3>
            <DataTable
              data={summary.topBusinesses.map((b) => ({
                ...b,
                id: b.businessId,
              }))}
              columns={[
                { key: "businessId", header: "Business ID", width: "30%" },
                { key: "credits", header: "Credits", width: "20%" },
                { key: "calls", header: "Calls", width: "20%" },
                { key: "cost", header: "Est. Cost", width: "20%", render: (row: any) => formatCurrency(row.cost) },
              ]}
              keyField="id"
              searchable
              pageSize={10}
            />
          </div>
        </>
      )}

      {/* Alerts table */}
      <div className="rounded-2xl border border-border/70 bg-slate-950/70 p-5">
        <h3 className="text-sm font-semibold mb-4">Recent Alerts</h3>
        {alerts.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">No recent alerts.</div>
        ) : (
          <DataTable
            data={alerts.map((a) => ({
              ...a,
              id: a.id,
              threshold: a.threshold ?? "—",
              triggeredAt: new Date(a.triggeredAt).toLocaleString(),
              status: a.notified ? "Notified" : "Pending",
            }))}
            columns={[
              { key: "businessId", header: "Business", width: "20%" },
              { key: "type", header: "Type", width: "15%" },
              { key: "threshold", header: "Threshold", width: "10%" },
              { key: "triggeredAt", header: "Triggered", width: "20%" },
              {
                key: "status",
                header: "Status",
                width: "15%",
                render: (row: any) => (
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                      row.status === "Pending"
                        ? "bg-amber-500/10 text-amber-300 border border-amber-500/30"
                        : "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30",
                    )}
                  >
                    {row.status}
                  </span>
                ),
              },
            ]}
            keyField="id"
            searchable
            pageSize={10}
          />
        )}
      </div>
    </div>
  );
}
