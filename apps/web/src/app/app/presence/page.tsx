"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@keyflow/ui";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Eye,
  Loader2,
  MessageCircle,
  RefreshCw,
  Share2,
  ShoppingCart,
  Sparkles,
  Store,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchPresenceCommandOverview,
  syncPresenceActionCards,
  type PresenceCommandOverview,
  type PresenceActionCard,
  type PresenceHealthScore,
} from "@/lib/client";

const PERIOD_OPTIONS = [7, 30, 90] as const;
type PeriodDays = (typeof PERIOD_OPTIONS)[number];

export default function PresenceOverviewPage() {
  const [businessId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : getStoredBusinessId(),
  );
  const [data, setData] = useState<PresenceCommandOverview | null>(null);
  const [loading, setLoading] = useState(() => !!businessId);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<PeriodDays>(30);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    fetchPresenceCommandOverview(businessId, days).then((res) => {
      if (cancelled) return;
      if (res.error) setError(res.error);
      else {
        setData(res.data);
        setError(null);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [businessId, days]);

  const refetching = !!data && data.period.days !== days;

  const handleSync = async () => {
    if (!businessId) return;
    setSyncing(true);
    const res = await syncPresenceActionCards(businessId);
    setSyncing(false);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success(`Sent ${res.data?.synced ?? 0} action${(res.data?.synced ?? 0) === 1 ? "" : "s"} to your Revenue Action Queue`);
    }
  };

  if (!businessId) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Pick a workspace to view your presence.</div>
    );
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading presence overview…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          {error ?? "Failed to load presence overview."}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <Store className="w-5 h-5 text-[hsl(var(--kf-accent1))]" />
          Presence
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">Storefront performance, health, and growth actions.</p>
      </div>
      <SiteStatusBanner data={data} />
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Visitor analytics · last {days} days
        </div>
        <PeriodSelector value={days} onChange={setDays} loading={loading || refetching} />
      </div>
      <KpiGrid data={data} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1">
          <HealthScoreCard health={data.health} />
        </div>
        <div className="lg:col-span-2">
          <ActionCardsPanel
            cards={data.actionCards}
            onSync={handleSync}
            syncing={syncing}
          />
        </div>
      </div>
      <TopItemsRow data={data} />
    </div>
  );
}

function PeriodSelector({
  value,
  onChange,
  loading,
}: {
  value: PeriodDays;
  onChange: (d: PeriodDays) => void;
  loading: boolean;
}) {
  return (
    <div className="inline-flex rounded-md border border-border/40 bg-slate-900/40 p-0.5">
      {PERIOD_OPTIONS.map((d) => (
        <button
          key={d}
          type="button"
          disabled={loading}
          onClick={() => onChange(d)}
          className={cn(
            "px-2.5 py-1 text-xs rounded-sm transition-colors",
            value === d
              ? "bg-orange-500/20 text-orange-200"
              : "text-muted-foreground hover:text-foreground",
            loading && "opacity-60 cursor-not-allowed",
          )}
        >
          {d}d
        </button>
      ))}
    </div>
  );
}

function SiteStatusBanner({ data }: { data: PresenceCommandOverview }) {
  const { site } = data;
  const url = site.slug ? `/site/${site.slug}` : null;
  return (
    <div className="rounded-xl border border-border/40 bg-slate-900/40 p-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "w-2.5 h-2.5 rounded-full",
            site.published ? "bg-emerald-400" : "bg-amber-400",
          )}
        />
        <div>
          <div className="text-xs font-medium">
            {site.published ? "Live storefront" : "Draft only — not yet published"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {url ? (
              <a href={url} target="_blank" rel="noreferrer" className="hover:text-orange-400">
                {url}
              </a>
            ) : (
              "Set a slug in Pages to claim your URL."
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {url && site.published && (
          <a href={url} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">
              <Eye className="w-3.5 h-3.5 mr-1" /> View live
            </Button>
          </a>
        )}
        <Link href="/app/presence/pages">
          <Button size="sm">
            <Sparkles className="w-3.5 h-3.5 mr-1" />
            {site.published ? "Edit pages" : "Open editor"}
          </Button>
        </Link>
      </div>
    </div>
  );
}

function KpiGrid({ data }: { data: PresenceCommandOverview }) {
  const k = data.kpis;
  const items = [
    { label: "Visits", value: k.visits.toLocaleString(), Icon: Eye, sub: `last ${data.period.days}d` },
    { label: "Leads", value: k.leadsCaptured.toLocaleString(), Icon: Users, sub: "from storefront" },
    { label: "Bookings", value: k.bookingsCreated.toLocaleString(), Icon: Activity, sub: "created" },
    { label: "Orders", value: k.ordersCreated.toLocaleString(), Icon: ShoppingCart, sub: `${k.abandoned} abandoned` },
    {
      label: "Revenue",
      value: k.revenue ? `${k.currency} ${Math.round(k.revenue).toLocaleString()}` : `${k.currency} 0`,
      Icon: TrendingUp,
      sub: "paid",
    },
    {
      label: "Conversion",
      value: `${(k.conversionRate * 100).toFixed(1)}%`,
      Icon: Activity,
      sub: "visit→action",
    },
    { label: "Shares", value: k.shareClicks.toLocaleString(), Icon: Share2, sub: "share clicks" },
    { label: "WhatsApp", value: k.whatsappClicks.toLocaleString(), Icon: MessageCircle, sub: "chat clicks" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
      {items.map((it) => (
        <div key={it.label} className="rounded-lg border border-border/40 bg-slate-900/40 p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <it.Icon className="w-3 h-3" /> {it.label}
          </div>
          <div className="mt-1 text-lg font-semibold tabular-nums">{it.value}</div>
          <div className="text-[10px] text-muted-foreground">{it.sub}</div>
        </div>
      ))}
    </div>
  );
}

function HealthScoreCard({ health }: { health: PresenceHealthScore }) {
  const ringColor =
    health.band === "great"
      ? "stroke-emerald-400"
      : health.band === "good"
        ? "stroke-emerald-300"
        : health.band === "needs-work"
          ? "stroke-amber-400"
          : "stroke-rose-400";
  const bandLabel = {
    great: "Great",
    good: "Good",
    "needs-work": "Needs work",
    critical: "Critical",
  }[health.band];

  const C = 2 * Math.PI * 42;
  const offset = C - (C * health.score) / 100;

  return (
    <div className="rounded-xl border border-border/40 bg-slate-900/40 p-4 h-full">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Presence Health</div>
          <div className="text-sm font-semibold">{bandLabel}</div>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-3">
        <svg width="100" height="100" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" strokeWidth="8" className="stroke-slate-700/60 fill-none" />
          <circle
            cx="50"
            cy="50"
            r="42"
            strokeWidth="8"
            className={cn("fill-none transition-all", ringColor)}
            strokeDasharray={C}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform="rotate(-90 50 50)"
          />
          <text
            x="50"
            y="55"
            textAnchor="middle"
            className="fill-foreground"
            style={{ fontSize: 22, fontWeight: 700 }}
          >
            {health.score}
          </text>
        </svg>
        <div className="text-xs text-muted-foreground">
          {health.passed} of {health.total} checks passing
        </div>
      </div>
      <ul className="space-y-1.5 text-xs max-h-72 overflow-y-auto pr-1">
        {health.checks.map((c) => (
          <li key={c.key} className="flex items-start gap-2">
            {c.passed ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-rose-400 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <div className={cn(c.passed ? "text-foreground" : "text-foreground")}>{c.label}</div>
              {!c.passed && c.hint && (
                <div className="text-[11px] text-muted-foreground">{c.hint}</div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ActionCardsPanel({
  cards,
  onSync,
  syncing,
}: {
  cards: PresenceActionCard[];
  onSync: () => void;
  syncing: boolean;
}) {
  const sorted = useMemo(() => {
    const order = { critical: 0, warning: 1, info: 2 } as const;
    return [...cards].sort((a, b) => order[a.severity] - order[b.severity]);
  }, [cards]);

  return (
    <div className="rounded-xl border border-border/40 bg-slate-900/40 p-4 h-full">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Recommended actions</div>
          <div className="text-sm font-semibold">Grow your presence</div>
        </div>
        <Button size="sm" variant="outline" onClick={onSync} disabled={syncing}>
          {syncing ? (
            <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5 mr-1" />
          )}
          Send to Action Queue
        </Button>
      </div>
      {sorted.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center">
          No recommendations right now. Your presence is in great shape.
        </div>
      ) : (
        <div className="space-y-2 max-h-[26rem] overflow-y-auto pr-1">
          {sorted.map((card, i) => (
            <ActionCardRow key={`${card.key}-${i}`} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}

function ActionCardRow({ card }: { card: PresenceActionCard }) {
  const sevStyles =
    card.severity === "critical"
      ? "border-rose-500/40 bg-rose-500/5"
      : card.severity === "warning"
        ? "border-amber-500/40 bg-amber-500/5"
        : "border-border/40 bg-slate-950/40";
  const Icon = card.severity === "critical" ? AlertTriangle : card.severity === "warning" ? AlertTriangle : Sparkles;
  const iconColor =
    card.severity === "critical" ? "text-rose-400" : card.severity === "warning" ? "text-amber-400" : "text-orange-400";
  return (
    <div className={cn("rounded-lg border p-3 flex items-start gap-3", sevStyles)}>
      <Icon className={cn("w-4 h-4 mt-0.5 flex-shrink-0", iconColor)} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{card.title}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{card.description}</div>
      </div>
      <Link href={card.ctaHref} className="flex-shrink-0">
        <Button size="sm" variant="outline">
          {card.ctaLabel}
          <ArrowRight className="w-3 h-3 ml-1" />
        </Button>
      </Link>
    </div>
  );
}

function TopItemsRow({ data }: { data: PresenceCommandOverview }) {
  if (!data.topProduct && !data.topService) return null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {data.topProduct && (
        <div className="rounded-lg border border-border/40 bg-slate-900/40 p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Top product</div>
          <div className="text-sm font-semibold">{data.topProduct.name}</div>
          <div className="text-xs text-muted-foreground">
            {data.topProduct.views} views · {data.topProduct.orders} orders
          </div>
        </div>
      )}
      {data.topService && (
        <div className="rounded-lg border border-border/40 bg-slate-900/40 p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Top service</div>
          <div className="text-sm font-semibold">{data.topService.name}</div>
          <div className="text-xs text-muted-foreground">
            {data.topService.views} views · {data.topService.bookings} bookings
          </div>
        </div>
      )}
    </div>
  );
}
