"use client";

import { useEffect, useState, useCallback } from "react";
import { Banknote, Wallet, Receipt, FileText, Landmark, ShieldCheck, Zap, ArrowRight, TrendingUp, PiggyBank, Plus, Trash2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { getStoredBusinessId } from "@/lib/workspace";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { MetricCard } from "@/components/ui/metric-card";
import { apiGet } from "@/lib/api";
import { fetchReserveBuckets, createReserveBucket, deleteReserveBucket, type ReserveBucket } from "@/lib/api/finance";

interface FinancialOverview {
  cashBalance: number;
  outstandingInvoices: number;
  overdueInvoices: number;
  billsDue: number;
  taxReserved: number;
  netProfitThisMonth: number;
  currency: string;
}

interface SafeToSpend {
  safeToSpend: number;
  cashBalance: number;
  taxReserved: number;
  billsDueNext30Days: number;
  operatingBuffer: number;
  currency: string;
}

export default function FinancialFlowPage() {
  const router = useRouter();
  const businessId = getStoredBusinessId() ?? "";
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<FinancialOverview | null>(null);
  const [safe, setSafe] = useState<SafeToSpend | null>(null);
  const [forecast, setForecast] = useState<{ days: number; expected: number; conservative: number; optimistic: number; dangerDate: string | null; recommendations: string[] } | null>(null);
  const [buckets, setBuckets] = useState<ReserveBucket[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPurpose, setNewPurpose] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [newCurrent, setNewCurrent] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [ovRes, safeRes, fcRes, bucketRes] = await Promise.all([
        apiGet<FinancialOverview>(`/finance/businesses/${businessId}/overview`),
        apiGet<SafeToSpend>(`/finance/businesses/${businessId}/safe-to-spend`),
        apiGet<NonNullable<typeof forecast>>(`/finance/businesses/${businessId}/cashflow-forecast?days=90`),
        fetchReserveBuckets(businessId),
      ]);
      if (ovRes.data) setOverview(ovRes.data);
      if (safeRes.data) setSafe(safeRes.data);
      if (fcRes.data) setForecast(fcRes.data);
      if (bucketRes.data) setBuckets(bucketRes.data);
    } catch {
      // fail silently
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async () => {
    if (!businessId || !newName.trim()) return;
    setSaving(true);
    try {
      const res = await createReserveBucket(businessId, {
        name: newName.trim(),
        purpose: newPurpose.trim() || "General reserve",
        targetAmount: newTarget ? Number(newTarget) : undefined,
        currentAmount: newCurrent ? Number(newCurrent) : 0,
      });
      if (res.data) {
        setBuckets((prev) => [...prev, res.data!]);
        setNewName("");
        setNewPurpose("");
        setNewTarget("");
        setNewCurrent("");
        setShowAdd(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    await deleteReserveBucket(businessId, id);
    setBuckets((prev) => prev.filter((b) => b.id !== id));
  };

  const currency = overview?.currency ?? "TTD";

  const sections = [
    { label: "Money In", href: "/app/commerce", icon: Receipt, desc: "Invoices, quotes, payments" },
    { label: "Money Out", href: "/app/expenses", icon: Wallet, desc: "Expenses, bills, vendors" },
    { label: "Accounts", href: "/app/finance/accounts", icon: Landmark, desc: "Bank, cash, reconciliation" },
    { label: "Reports", href: "/app/finance", icon: FileText, desc: "P&L, balance sheet, tax" },
    { label: "Safe to Spend", href: "#", icon: ShieldCheck, desc: "Know what cash is truly available" },
    { label: "Money Moves", href: "#", icon: Zap, desc: "Actions to improve cashflow" },
  ];

  return (
    <UnifiedPageShell
      title="Financial Flow"
      subtitle="Cash, reserves, and forecasting."
      icon={Banknote}
      maxWidth="5xl"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="kf-card-metric animate-pulse h-20" />)
        ) : (
          <>
            <MetricCard label="Cash Balance" value={`${currency} ${(overview?.cashBalance ?? 0).toLocaleString()}`} icon={Wallet} />
            <MetricCard label="Safe to Spend" value={`${currency} ${(safe?.safeToSpend ?? 0).toLocaleString()}`} icon={ShieldCheck} iconColor="#10b981" />
            <MetricCard label="Overdue" value={`${currency} ${(overview?.overdueInvoices ?? 0).toLocaleString()}`} icon={Receipt} iconColor="#ef4444" />
            <MetricCard label="Net Profit (MTD)" value={`${currency} ${(overview?.netProfitThisMonth ?? 0).toLocaleString()}`} icon={TrendingUp} />
          </>
        )}
      </div>

      {/* Cashflow Forecast */}
      {forecast && (
        <div className="kf-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">90-Day Cash Forecast</p>
            {forecast.dangerDate && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 font-medium">
                Danger: {new Date(forecast.dangerDate).toLocaleDateString()}
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <p className="text-lg font-semibold">{currency} {(forecast.expected ?? 0).toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">Expected</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold">{currency} {(forecast.conservative ?? 0).toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">Conservative</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold">{currency} {(forecast.optimistic ?? 0).toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">Optimistic</p>
            </div>
          </div>
          {forecast.recommendations && forecast.recommendations.length > 0 && (
            <div className="space-y-1">
              {forecast.recommendations.map((rec, i) => (
                <p key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <TrendingUp className="w-3 h-3 mt-0.5 shrink-0 text-primary" />
                  {rec}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Cash Reserve Buckets */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Cash Reserve Buckets</p>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="inline-flex items-center gap-1 text-xs font-medium transition-colors hover:opacity-80"
            style={{ color: "hsl(var(--kf-accent1))" }}
          >
            <Plus className="w-3 h-3" />
            {showAdd ? "Cancel" : "Add bucket"}
          </button>
        </div>

        {showAdd && (
          <div className="kf-card p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Bucket name (e.g. Tax Reserve)"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <input
                type="text"
                value={newPurpose}
                onChange={(e) => setNewPurpose(e.target.value)}
                placeholder="Purpose"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <input
                type="number"
                value={newTarget}
                onChange={(e) => setNewTarget(e.target.value)}
                placeholder="Target amount"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
              <input
                type="number"
                value={newCurrent}
                onChange={(e) => setNewCurrent(e.target.value)}
                placeholder="Current amount"
                className="px-3 py-2 rounded-lg border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/20"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              />
            </div>
            <button
              onClick={handleAdd}
              disabled={!newName.trim() || saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Create bucket
            </button>
          </div>
        )}

        {buckets.length === 0 && !showAdd ? (
          <p className="text-xs text-muted-foreground py-2">No reserve buckets yet. Add one to track tax, payroll, or other cash allocations.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {buckets.map((bucket) => (
              <div key={bucket.id} className="kf-card p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <PiggyBank className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="text-sm font-medium">{bucket.name}</span>
                  </div>
                  <button
                    onClick={() => handleDelete(bucket.id)}
                    className="text-muted-foreground hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground">{bucket.purpose}</p>
                <div className="flex items-end justify-between">
                  <span className="text-sm font-semibold">{bucket.currency} {bucket.currentAmount.toLocaleString()}</span>
                  {bucket.targetAmount && (
                    <span className="text-[10px] text-muted-foreground">
                      of {bucket.currency} {bucket.targetAmount.toLocaleString()} target
                    </span>
                  )}
                </div>
                {bucket.targetAmount && bucket.targetAmount > 0 && (
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${Math.min(100, (bucket.currentAmount / bucket.targetAmount) * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sections.map((s) => (
          <button
            key={s.label}
            onClick={() => router.push(s.href)}
            className="kf-card kf-radius-lg p-4 text-left hover:shadow-md transition-all group"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 kf-radius-lg flex items-center justify-center" style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}>
                  <s.icon className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">{s.label}</h3>
                  <p className="kf-text-micro text-muted-foreground">{s.desc}</p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </div>
          </button>
        ))}
      </div>
    </UnifiedPageShell>
  );
}
