"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@keyflow/ui";
import {
  Activity,
  Eye,
  Loader2,
  MessageCircle,
  MousePointerClick,
  RefreshCw,
  ShoppingBag,
  ShoppingCart,
  TrendingUp,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchPresenceTodayStats,
  detectAbandonedCarts,
  type PresenceTodayStats,
} from "@/lib/client";

export default function PresenceDashboardPage() {
  const [businessId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : getStoredBusinessId(),
  );
  const [data, setData] = useState<PresenceTodayStats | null>(null);
  const [loading, setLoading] = useState(() => !!businessId);
  const [error, setError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = async () => {
    if (!businessId) return;
    setLoading(true);
    const res = await fetchPresenceTodayStats(businessId);
    if (res.error) {
      setError(res.error);
    } else {
      setData(res.data ?? null);
      setError(null);
      setLastUpdated(new Date());
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    const run = async () => {
      const res = await fetchPresenceTodayStats(businessId);
      if (cancelled) return;
      if (res.error) {
        setError(res.error);
      } else {
        setData(res.data ?? null);
        setError(null);
        setLastUpdated(new Date());
      }
      setLoading(false);
    };
    // Defer to next tick to satisfy the no-setState-in-effect rule
    const timer = setTimeout(run, 0);
    const interval = setInterval(run, 10_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [businessId]);

  const handleDetectAbandoned = async () => {
    if (!businessId) return;
    setDetecting(true);
    const res = await detectAbandonedCarts(businessId);
    setDetecting(false);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success(`Created ${res.data?.created ?? 0} recovery commands · skipped ${res.data?.skipped ?? 0}`);
    }
  };

  if (!businessId) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Pick a workspace to view your live dashboard.</div>
    );
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading live dashboard…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          {error ?? "Failed to load dashboard."}
        </div>
      </div>
    );
  }

  const k = data.events;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Live Dashboard</div>
          <div className="text-xs text-muted-foreground">
            Today&apos;s data · updated {lastUpdated ? lastUpdated.toLocaleTimeString() : "—"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleDetectAbandoned} disabled={detecting}>
            {detecting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
            Detect abandoned carts
          </Button>
          <Button size="sm" variant="outline" onClick={load}>
            <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        <KpiCard label="Visitors" value={data.visitors.toLocaleString()} Icon={Users} sub="unique today" />
        <KpiCard label="Views" value={k.views.toLocaleString()} Icon={Eye} sub="page views" />
        <KpiCard label="Cart adds" value={k.cartAdds.toLocaleString()} Icon={ShoppingCart} sub="adds" />
        <KpiCard label="Checkouts" value={k.checkouts.toLocaleString()} Icon={MousePointerClick} sub="started" />
        <KpiCard label="Orders" value={k.orders.toLocaleString()} Icon={ShoppingBag} sub="created" />
        <KpiCard label="Bookings" value={k.bookings.toLocaleString()} Icon={Activity} sub="created" />
        <KpiCard label="Revenue" value={`TTD ${Math.round(k.revenue).toLocaleString()}`} Icon={TrendingUp} sub="paid" />
        <KpiCard label="WhatsApp" value={k.whatsappClicks.toLocaleString()} Icon={MessageCircle} sub="clicks" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 space-y-4">
          <FunnelCard funnel={data.funnel} />
          <SourcesCard sources={data.topSources} totalViews={k.views} />
        </div>
        <div className="lg:col-span-2">
          <RecentEventsCard events={data.recentEvents} orders={data.recentOrders} bookings={data.recentBookings} />
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  Icon,
  sub,
}: {
  label: string;
  value: string;
  Icon: React.ComponentType<{ className?: string }>;
  sub: string;
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-slate-900/40 p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function FunnelCard({ funnel }: { funnel: PresenceTodayStats["funnel"] }) {
  const steps = [
    { label: "Views", value: funnel.views },
    { label: "Cart adds", value: funnel.cartAdds },
    { label: "Checkouts", value: funnel.checkouts },
    { label: "Orders", value: funnel.orders },
    { label: "Bookings", value: funnel.bookings },
  ];

  const max = Math.max(...steps.map((s) => s.value), 1);

  return (
    <div className="rounded-xl border border-border/40 bg-slate-900/40 p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Conversion funnel</div>
      <div className="space-y-2">
        {steps.map((step, i) => {
          const prev = steps[i - 1]?.value ?? step.value;
          const rate = prev > 0 ? Math.round((step.value / prev) * 100) : 0;
          const pct = Math.round((step.value / max) * 100);
          return (
            <div key={step.label}>
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="text-muted-foreground">{step.label}</span>
                <span className="font-medium tabular-nums">
                  {step.value.toLocaleString()}
                  {i > 0 && <span className="text-muted-foreground ml-1">({rate}%)</span>}
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className={cn("h-full rounded-full", i === 0 ? "bg-sky-500" : i === 1 ? "bg-indigo-500" : i === 2 ? "bg-violet-500" : i === 3 ? "bg-emerald-500" : "bg-teal-500")}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SourcesCard({ sources, totalViews }: { sources: { source: string; count: number }[]; totalViews: number }) {
  return (
    <div className="rounded-xl border border-border/40 bg-slate-900/40 p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Top traffic sources</div>
      {sources.length === 0 ? (
        <div className="text-xs text-muted-foreground">No source data yet today.</div>
      ) : (
        <div className="space-y-2">
          {sources.map((s) => {
            const pct = totalViews > 0 ? Math.round((s.count / totalViews) * 100) : 0;
            return (
              <div key={s.source}>
                <div className="flex items-center justify-between text-xs mb-0.5">
                  <span className="text-muted-foreground truncate">{s.source}</span>
                  <span className="font-medium tabular-nums">{s.count} <span className="text-muted-foreground">({pct}%)</span></span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div className="h-full rounded-full bg-orange-500" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RecentEventsCard({
  events,
  orders,
  bookings,
}: {
  events: PresenceTodayStats["recentEvents"];
  orders: PresenceTodayStats["recentOrders"];
  bookings: PresenceTodayStats["recentBookings"];
}) {
  const merged = useMemo(() => {
    const items: Array<
      | { kind: "event"; data: PresenceTodayStats["recentEvents"][number] }
      | { kind: "order"; data: PresenceTodayStats["recentOrders"][number] }
      | { kind: "booking"; data: PresenceTodayStats["recentBookings"][number] }
    > = [];
    for (const e of events) items.push({ kind: "event", data: e });
    for (const o of orders) items.push({ kind: "order", data: o });
    for (const b of bookings) items.push({ kind: "booking", data: b });
    items.sort((a, b) => {
      const aTs = a.kind === "event" ? a.data.ts : a.kind === "order" ? a.data.createdAt : a.data.startTime;
      const bTs = b.kind === "event" ? b.data.ts : b.kind === "order" ? b.data.createdAt : b.data.startTime;
      return new Date(bTs).getTime() - new Date(aTs).getTime();
    });
    return items.slice(0, 20);
  }, [events, orders, bookings]);

  return (
    <div className="rounded-xl border border-border/40 bg-slate-900/40 p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Recent activity</div>
      <div className="space-y-1 max-h-[28rem] overflow-y-auto pr-1">
        {merged.length === 0 && <div className="text-xs text-muted-foreground">No activity yet today.</div>}
        {merged.map((item, i) => {
          if (item.kind === "event") {
            const e = item.data;
            return (
              <div key={`ev-${i}`} className="flex items-center justify-between text-xs px-2 py-1.5 rounded-md bg-slate-950/40 border border-border/20">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="inline-flex items-center justify-center rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-muted-foreground">{e.type}</span>
                  <span className="text-muted-foreground truncate">{e.visitorId.slice(0, 12)}…</span>
                </div>
                <span className="text-muted-foreground tabular-nums shrink-0">{new Date(e.ts).toLocaleTimeString()}</span>
              </div>
            );
          }
          if (item.kind === "order") {
            const o = item.data;
            return (
              <div key={`ord-${i}`} className="flex items-center justify-between text-xs px-2 py-1.5 rounded-md bg-emerald-950/20 border border-emerald-500/20">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="inline-flex items-center justify-center rounded-full bg-emerald-900/40 px-1.5 py-0.5 text-[10px] text-emerald-300">order</span>
                  <span className="truncate">{o.customerName || "Guest"} · TTD {Number(o.total).toLocaleString()}</span>
                </div>
                <span className="text-muted-foreground tabular-nums shrink-0">{new Date(o.createdAt).toLocaleTimeString()}</span>
              </div>
            );
          }
          const b = item.data;
          return (
            <div key={`bk-${i}`} className="flex items-center justify-between text-xs px-2 py-1.5 rounded-md bg-sky-950/20 border border-sky-500/20">
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-flex items-center justify-center rounded-full bg-sky-900/40 px-1.5 py-0.5 text-[10px] text-sky-300">booking</span>
                <span className="truncate">{b.contactName}</span>
              </div>
              <span className="text-muted-foreground tabular-nums shrink-0">{new Date(b.startTime).toLocaleTimeString()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
