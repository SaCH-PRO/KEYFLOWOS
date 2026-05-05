"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Briefcase, Building2, KanbanSquare, LayoutList, LineChart as LineChartIcon, Loader2, Plus, Search, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import {
  fetchDeals,
  fetchDealStages,
  fetchDealForecast,
  fetchDealVelocity,
  fetchWonLostReasons,
  fetchDealsByAccountPivot,
  type Deal,
  type DealStage,
  type DealListFilters,
  type DealForecast,
  type DealVelocityReport,
  type WonLostReason,
} from "@/lib/client";
import { getStoredBusinessId, ensureWorkspace } from "@/lib/workspace";
import { DealsListView } from "./deals-list-view";
import { DealsBoardView } from "./deals-board-view";
import { DealsReportsView } from "./deals-reports-view";
import { AddDealModal } from "./add-deal-modal";
import { fmtMoney, persistView, readStoredView, type DealsView } from "./deals-shared";

const VIEW_TABS: Array<{ id: DealsView; label: string; icon: React.ElementType }> = [
  { id: "list", label: "List", icon: LayoutList },
  { id: "board", label: "Board", icon: KanbanSquare },
  { id: "account", label: "By account", icon: Building2 },
  { id: "reports", label: "Reports", icon: LineChartIcon },
];

const DATE_RANGES = [
  { id: "30", label: "Last 30 days", days: 30 },
  { id: "90", label: "Last 90 days", days: 90 },
  { id: "180", label: "Last 180 days", days: 180 },
  { id: "all", label: "All time", days: 0 },
];

type AccountBucket = { accountId: string | null; label: string; count: number; openValue: number; wonValue: number; currency: string };

export default function DealsPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [view, setView] = useState<DealsView>("list");
  const [stages, setStages] = useState<DealStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [closedDeals, setClosedDeals] = useState<Deal[]>([]);
  const [accountBuckets, setAccountBuckets] = useState<AccountBucket[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [forecast, setForecast] = useState<DealForecast | null>(null);
  const [velocity, setVelocity] = useState<DealVelocityReport | null>(null);
  const [reasons, setReasons] = useState<WonLostReason[]>([]);
  const [addOpen, setAddOpen] = useState(false);

  const [filters, setFilters] = useState<DealListFilters>({ status: "OPEN", take: 200 });
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("");
  const [rangeId, setRangeId] = useState<string>("90");

  // Initialize from storage
  useEffect(() => {
    setView(readStoredView());
    (async () => {
      const id = getStoredBusinessId() || (await ensureWorkspace());
      setBusinessId(id);
    })();
  }, []);

  const setViewPersist = useCallback((v: DealsView) => {
    setView(v);
    persistView(v);
  }, []);

  const range = DATE_RANGES.find((r) => r.id === rangeId) ?? DATE_RANGES[1];
  const rangeFromIso = useMemo(() => {
    if (range.days === 0) return undefined;
    return new Date(Date.now() - range.days * 86_400_000).toISOString();
  }, [range]);

  const reload = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      // Build per-view request shape. Always need stages, forecast, velocity, reasons.
      const filtersForList: DealListFilters = {
        ...filters,
        search: search || undefined,
        stageIds: stageFilter ? [stageFilter] : undefined,
      };
      // Board view always wants OPEN deals (ignore status filter for movement)
      const filtersForBoard: DealListFilters = {
        ...filters,
        status: "OPEN",
        search: search || undefined,
        take: 500,
      };
      const requestList = view === "board" ? filtersForBoard : filtersForList;

      const closedRequest: DealListFilters = {
        status: "ALL",
        take: 500,
        expectedCloseFrom: undefined,
      };

      const [s, d, f, v, r, closed, pv] = await Promise.all([
        fetchDealStages(businessId),
        fetchDeals(requestList, businessId),
        fetchDealForecast({ windowDays: 30 }, businessId),
        fetchDealVelocity(businessId),
        fetchWonLostReasons({}, businessId),
        // For Reports view, we need closed deals broadly to compute reasons & source win-rate.
        view === "reports" ? fetchDeals(closedRequest, businessId) : Promise.resolve({ data: null }),
        // For Account pivot, fetch the per-account rollup.
        view === "account" ? fetchDealsByAccountPivot(businessId) : Promise.resolve({ data: { buckets: [] as AccountBucket[] } }),
      ]);
      if (s.data) setStages(s.data);
      if (d.data) {
        setDeals(d.data.deals);
        setTotal(d.data.total);
      }
      if (f.data) setForecast(f.data);
      if (v.data) setVelocity(v.data);
      if (r.data) setReasons(r.data);
      if (closed && "data" in closed && closed.data) {
        const all = closed.data.deals;
        const filteredClosed = all.filter((dl) => {
          if (dl.status !== "WON" && dl.status !== "LOST") return false;
          if (!rangeFromIso) return true;
          const ts = dl.wonAt ?? dl.lostAt ?? dl.updatedAt;
          if (!ts) return false;
          return new Date(ts) >= new Date(rangeFromIso);
        });
        setClosedDeals(filteredClosed);
      }
      if (pv.data) setAccountBuckets(pv.data.buckets);
    } finally {
      setLoading(false);
    }
  }, [businessId, filters, search, stageFilter, view, rangeFromIso]);

  useEffect(() => { reload(); }, [reload]);

  const totalValue = useMemo(
    () => deals.filter((d) => d.status === "OPEN").reduce((acc, d) => acc + (d.value ?? 0), 0),
    [deals],
  );
  const bottleneckCount = useMemo(() => deals.filter((d) => d.bottleneckFlag).length, [deals]);

  const slowestStage = velocity?.stages
    .filter((s) => s.category === "OPEN" && s.avgDaysInStage > 0)
    .slice()
    .sort((a, b) => b.avgDaysInStage - a.avgDaysInStage)[0];

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        icon={Briefcase}
        title="Deals"
        subtitle={`${total} total · ${fmtMoney(totalValue, forecast?.currency ?? "TTD")} open pipeline`}
        actionLabel="New deal"
        actionIcon={Plus}
        onAction={() => setAddOpen(true)}
      />

      {/* Intelligence rollup */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <div className="rounded-lg border border-border bg-card/40 p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><TrendingUp className="w-3.5 h-3.5" /> Weighted forecast</div>
          <div className="text-lg font-semibold tabular-nums mt-1">{fmtMoney(forecast?.totalWeightedValue, forecast?.currency)}</div>
          <div className="text-[10px] text-muted-foreground/80">of {fmtMoney(forecast?.totalOpenValue, forecast?.currency)} open</div>
        </div>
        <div className="rounded-lg border border-border bg-card/40 p-3">
          <div className="text-xs text-muted-foreground">Closing in {forecast?.windowDays ?? 30}d</div>
          <div className="text-lg font-semibold tabular-nums mt-1">{fmtMoney(forecast?.expectedCloseWeightedValue, forecast?.currency)}</div>
          <div className="text-[10px] text-muted-foreground/80">{fmtMoney(forecast?.expectedCloseValue, forecast?.currency)} unweighted</div>
        </div>
        <div className="rounded-lg border border-border bg-card/40 p-3">
          <div className="text-xs text-muted-foreground">Avg cycle (slowest)</div>
          <div className="text-lg font-semibold tabular-nums mt-1">{slowestStage ? `${slowestStage.avgDaysInStage}d` : "—"}</div>
          <div className="text-[10px] text-muted-foreground/80 truncate">{slowestStage?.stageName ?? "no data yet"}</div>
        </div>
        <div className="rounded-lg border border-border bg-card/40 p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><AlertTriangle className="w-3.5 h-3.5" /> Bottlenecks</div>
          <div className="text-lg font-semibold tabular-nums mt-1">{bottleneckCount}</div>
          <div className="text-[10px] text-muted-foreground/80">{velocity?.outliers.length ?? 0} stage outliers</div>
        </div>
      </div>

      {/* View switcher + global date range */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div role="tablist" aria-label="Deals view" className="inline-flex items-center gap-1 p-0.5 rounded-md border border-border bg-card/40">
          {VIEW_TABS.map((t) => {
            const Icon = t.icon;
            const active = view === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => setViewPersist(t.id)}
                className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded ${
                  active ? "bg-[hsl(var(--kf-accent1))] text-white shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1 ml-auto">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Range</label>
          <select
            value={rangeId}
            onChange={(e) => setRangeId(e.target.value)}
            className="text-xs bg-background border border-border rounded-md px-2 py-1.5"
          >
            {DATE_RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
      </div>

      {/* Filters bar — applies to list and board */}
      {(view === "list" || view === "board") && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title, company, notes…"
              className="w-full text-sm bg-background border border-border rounded-md pl-8 pr-2 py-1.5"
            />
          </div>
          {view === "list" && (
            <>
              <select
                value={filters.status ?? "OPEN"}
                onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as DealListFilters["status"] }))}
                className="text-sm bg-background border border-border rounded-md px-2 py-1.5"
              >
                <option value="ALL">All statuses</option>
                <option value="OPEN">Open</option>
                <option value="WON">Won</option>
                <option value="LOST">Lost</option>
              </select>
              <select
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value)}
                className="text-sm bg-background border border-border rounded-md px-2 py-1.5"
              >
                <option value="">All stages</option>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <input
                type="number"
                placeholder="Min value"
                value={filters.minValue ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, minValue: e.target.value ? Number(e.target.value) : undefined }))}
                className="w-28 text-sm bg-background border border-border rounded-md px-2 py-1.5"
              />
              <input
                type="number"
                placeholder="Max value"
                value={filters.maxValue ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, maxValue: e.target.value ? Number(e.target.value) : undefined }))}
                className="w-28 text-sm bg-background border border-border rounded-md px-2 py-1.5"
              />
            </>
          )}
        </div>
      )}

      {!businessId ? (
        <div className="text-center py-16 text-sm text-muted-foreground">Loading workspace…</div>
      ) : view === "list" ? (
        <DealsListView
          businessId={businessId}
          loading={loading}
          deals={deals}
          stages={stages}
          reasons={reasons}
          onChanged={reload}
        />
      ) : view === "board" ? (
        <DealsBoardView
          businessId={businessId}
          deals={deals}
          stages={stages}
          reasons={reasons}
          onChanged={reload}
        />
      ) : view === "account" ? (
        loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : accountBuckets.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-border rounded-lg">
            <p className="text-sm text-muted-foreground">No deals yet.</p>
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="p-2 text-left">Account</th>
                  <th className="p-2 text-right">Deals</th>
                  <th className="p-2 text-right">Open $</th>
                  <th className="p-2 text-right">Won $</th>
                </tr>
              </thead>
              <tbody>
                {accountBuckets.map((b, i) => (
                  <tr key={`${b.accountId ?? "u"}:${i}`} className="border-t border-border hover:bg-muted/10">
                    <td className="p-2">
                      {b.accountId
                        ? <Link href={`/app/crm/accounts/${b.accountId}`} className="text-[hsl(var(--kf-accent2))] hover:underline">{b.label}</Link>
                        : <span className="text-muted-foreground">{b.label}</span>}
                    </td>
                    <td className="p-2 text-right tabular-nums">{b.count}</td>
                    <td className="p-2 text-right tabular-nums">{fmtMoney(b.openValue, b.currency)}</td>
                    <td className="p-2 text-right tabular-nums">{fmtMoney(b.wonValue, b.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <DealsReportsView
          businessId={businessId}
          forecast={forecast}
          velocity={velocity}
          closedDeals={closedDeals}
          loading={loading}
        />
      )}

      <AddDealModal
        open={addOpen}
        businessId={businessId ?? ""}
        stageId={null}
        onCancel={() => setAddOpen(false)}
        onCreated={async () => {
          setAddOpen(false);
          await reload();
        }}
      />
    </div>
  );
}
