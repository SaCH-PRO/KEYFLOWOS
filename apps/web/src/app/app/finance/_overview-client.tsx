"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, ArrowUpRight, BarChart3, Calculator, Clock, CreditCard,
  FileText, Receipt, RefreshCw, TrendingUp, Wallet,
} from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import { formatCurrency } from "@/lib/currency";
import {
  fetchFinanceOverview,
  type FinanceOverview, type FinanceOverviewActionItem,
} from "@/lib/client";
import { FinanceIntelPanel } from "./_intel-panel";

/**
 * FIN5 — Overview body (client). The parent page.tsx Server Component
 * renders the FIN8 insight strip ahead of this so the strip ships in
 * the initial HTML. Everything below (KPI grid, action queue, runway
 * card) needs `businessId` from localStorage so it stays client-side.
 */
export default function FinanceOverviewClient() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setBusinessId(getStoredBusinessId()); }, []);

  if (!businessId) {
    return (
      <div className="rounded-xl border border-border/40 bg-card/40 p-6 text-sm text-muted-foreground">
        Loading workspace…
      </div>
    );
  }
  return <OverviewBody businessId={businessId} />;
}

function OverviewBody({ businessId }: { businessId: string }) {
  const [data, setData] = useState<FinanceOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const o = await fetchFinanceOverview(businessId);
    if (o.error) setError(o.error);
    if (o.data) setData(o.data);
    setLoading(false);
  }, [businessId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  if (loading) return <SkeletonGrid />;
  if (error || !data) {
    return (
      <div className="rounded-xl border border-border/40 bg-card/40 p-6">
        <div className="flex items-start gap-2 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-500" />
          <div>
            <p className="font-medium">Couldn&apos;t load Finance overview</p>
            <p className="text-xs text-muted-foreground mt-1">{error ?? "Unknown error"}</p>
            <button
              onClick={load}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const currency = data.currency;
  const runwayLabel = data.cashRunwayMonths == null ? "—" : `${data.cashRunwayMonths.toFixed(1)}mo`;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        <Kpi label="Cash on hand" value={formatCurrency(data.cashBalance, currency)} sub={`${data.cashAccountCount} account${data.cashAccountCount === 1 ? "" : "s"}`} icon={Wallet} accent="emerald" />
        <Kpi label="Money in (MTD)" value={formatCurrency(data.revenueThisMonth, currency)} icon={TrendingUp} accent="green" />
        <Kpi label="Money out (MTD)" value={formatCurrency(data.expensesThisMonth, currency)} icon={Receipt} accent="rose" />
        <Kpi label="Net profit (MTD)" value={formatCurrency(data.netProfitThisMonth, currency)} icon={BarChart3} accent={data.netProfitThisMonth >= 0 ? "emerald" : "rose"} />
        <Kpi label="Owed to you" value={formatCurrency(data.outstandingInvoices, currency)} sub={`${data.outstandingInvoiceCount} invoice${data.outstandingInvoiceCount === 1 ? "" : "s"}`} icon={CreditCard} accent="amber" />
        <Kpi label="Bills due" value={formatCurrency(data.billsDue, currency)} sub={`${data.billsDueCount} recurring`} icon={FileText} accent="rose" />
        <Kpi label="Cash runway" value={runwayLabel} sub={data.cashRunwayMonths != null && data.cashRunwayMonths < 3 ? "Low" : "Healthy"} icon={Clock} accent={data.cashRunwayMonths != null && data.cashRunwayMonths < 3 ? "rose" : "emerald"} />
        <Kpi label="Tax reserved" value={formatCurrency(data.taxReserved, currency)} icon={Calculator} accent="indigo" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 space-y-3">
          <FinanceIntelPanel businessId={businessId} currency={currency} compact />
          <div className="rounded-xl border border-border/40 bg-card/40 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Action queue</h2>
              <Link href="/app/finance/actions" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                See all <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <ActionList items={data.actions.slice(0, 5)} currency={currency} />
          </div>
        </div>

        <div className="rounded-xl border border-border/40 bg-card/40 p-4 space-y-3">
          <div>
            <h2 className="text-sm font-semibold mb-3">Runway & risk</h2>
            <div className="space-y-2 text-sm">
              <Row label="Cash runway">{runwayLabel}</Row>
              <Row label="Overdue">{formatCurrency(data.overdueInvoices, currency)} <span className="text-muted-foreground">({data.overdueInvoiceCount})</span></Row>
              <Row label="Pending actions">{data.pendingActionCount}</Row>
            </div>
            <Link href="/app/finance/tax" className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
              Open Tax centre <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="pt-3 border-t border-border/30">
            <h2 className="text-sm font-semibold mb-2">Recurring revenue</h2>
            <p className="text-xs text-muted-foreground mb-2">
              {data.billsDueCount > 0
                ? `${data.billsDueCount} active recurring schedule${data.billsDueCount === 1 ? "" : "s"}`
                : "No recurring schedules yet"}
            </p>
            <Link href="/app/commerce?tab=recurring" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
              Manage recurring <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ActionList({ items, currency }: { items: FinanceOverviewActionItem[]; currency: string }) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">All clear — no pending actions.</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((a) => (
        <li key={a.id} className="flex items-start justify-between gap-3 rounded-lg border border-border/30 bg-background/40 p-2.5">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{a.title}</p>
            {a.detail && <p className="text-xs text-muted-foreground truncate">{a.detail}</p>}
          </div>
          {a.amountAtRisk != null && (
            <span className="text-xs font-semibold whitespace-nowrap">{formatCurrency(a.amountAtRisk, currency)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Kpi({ label, value, sub, icon: Icon, accent }: { label: string; value: string; sub?: string; icon: React.ElementType; accent: "emerald" | "green" | "rose" | "amber" | "indigo" }) {
  const accentBg: Record<string, string> = {
    emerald: "hsl(142 76% 45% / 0.1)",
    green: "hsl(142 76% 45% / 0.1)",
    rose: "hsl(0 75% 60% / 0.1)",
    amber: "hsl(38 92% 50% / 0.1)",
    indigo: "hsl(238 75% 65% / 0.1)",
  };
  const accentFg: Record<string, string> = {
    emerald: "hsl(142 76% 36%)",
    green: "hsl(142 76% 36%)",
    rose: "hsl(0 75% 50%)",
    amber: "hsl(38 92% 40%)",
    indigo: "hsl(238 75% 55%)",
  };
  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
        <span className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: accentBg[accent] }}>
          <Icon className="w-3 h-3" style={{ color: accentFg[accent] }} />
        </span>
        {label}
      </div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}

export function SkeletonGrid() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border/40 bg-card/40 p-3">
            <div className="h-3 w-12 mb-2 rounded bg-muted/40 animate-pulse" />
            <div className="h-5 w-20 rounded bg-muted/40 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
