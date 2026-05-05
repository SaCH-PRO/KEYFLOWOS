"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Drawer } from "@keyflow/ui";
import {
  fetchPresenceOverview,
  fetchPresenceSourcesReport,
  fetchPresencePagesReport,
  fetchPresenceFunnelReport,
  type PresenceOverviewResponse,
  type PresenceSourcesResponse,
  type PresencePagesResponse,
  type PresenceFunnelResponse,
} from "@/lib/client";

type Props = {
  businessId?: string;
  className?: string;
};

type RangeDays = 7 | 30;

type DrillTab = "sources" | "pages" | "funnel";

const METRIC_LABELS: Record<string, string> = {
  visit: "Visits",
  view: "Views",
  product_view: "Product views",
  service_view: "Service views",
  booking_start: "Booking started",
  booking_complete: "Booking completed",
  checkout_start: "Checkout started",
  checkout_complete: "Checkout completed",
  form_submit: "Form submitted",
  whatsapp_click: "WhatsApp clicks",
  share_click: "Share clicks",
};

const SOURCE_DIM_LABELS: Record<string, string> = {
  source: "Source",
  medium: "Medium",
  campaign: "Campaign",
  referrer: "Referrer",
};

const PAGE_DIM_LABELS: Record<string, string> = {
  page: "Pages",
  product: "Products",
  service: "Services",
};

function metricLabel(metric: string): string {
  return METRIC_LABELS[metric] ?? metric;
}

function sumCount(
  totals: PresenceOverviewResponse["totals"] | undefined,
  raw: PresenceOverviewResponse["rawTotals"] | undefined,
  metric: string,
): number {
  const aggCount = totals?.[metric]?.count ?? 0;
  const rawCount = raw?.[metric] ?? 0;
  return Math.max(aggCount, rawCount);
}

function visitorCount(overview: PresenceOverviewResponse | null): number {
  if (!overview) return 0;
  const visit = overview.totals?.visit;
  if (visit?.uniques) return visit.uniques;
  // Fall back to raw counts if nightly aggregator hasn't run yet.
  return overview.rawTotals?.visit ?? visit?.count ?? 0;
}

function conversionCount(overview: PresenceOverviewResponse | null): number {
  if (!overview) return 0;
  return (
    sumCount(overview.totals, overview.rawTotals, "booking_complete") +
    sumCount(overview.totals, overview.rawTotals, "checkout_complete") +
    sumCount(overview.totals, overview.rawTotals, "form_submit")
  );
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) return "—";
  const pct = (numerator / denominator) * 100;
  if (pct >= 10) return `${pct.toFixed(0)}%`;
  return `${pct.toFixed(1)}%`;
}

function isOverviewEmpty(overview: PresenceOverviewResponse | null): boolean {
  if (!overview) return true;
  const totals = overview.totals ?? {};
  const raw = overview.rawTotals ?? {};
  const totalEvents =
    Object.values(totals).reduce((a, b) => a + (b?.count ?? 0), 0) +
    Object.values(raw).reduce((a, b) => a + (b ?? 0), 0);
  return totalEvents === 0;
}

export function PresenceAnalyticsWidget({ businessId, className }: Props) {
  const [days, setDays] = useState<RangeDays>(7);
  const [overview, setOverview] = useState<PresenceOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [topSources, setTopSources] = useState<
    PresenceSourcesResponse["sources"]["source"]
  >([]);
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillTab, setDrillTab] = useState<DrillTab>("sources");
  const [sourcesReport, setSourcesReport] = useState<PresenceSourcesResponse | null>(null);
  const [pagesReport, setPagesReport] = useState<PresencePagesResponse | null>(null);
  const [funnelReport, setFunnelReport] = useState<PresenceFunnelResponse | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const [ov, src] = await Promise.all([
          fetchPresenceOverview(businessId, days, { signal }),
          fetchPresenceSourcesReport(businessId, days, { signal }),
        ]);
        if (signal?.aborted) return;
        if (ov.error) setError(ov.error);
        setOverview(ov.data ?? null);
        setTopSources((src.data?.sources?.source ?? []).slice(0, 3));
      } catch (err) {
        if (!signal?.aborted) {
          setError((err as Error).message ?? "Failed to load presence analytics");
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [businessId, days],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const loadDrill = useCallback(
    async (tab: DrillTab) => {
      setDrillLoading(true);
      setDrillError(null);
      try {
        if (tab === "sources") {
          const res = await fetchPresenceSourcesReport(businessId, days);
          if (res.error) setDrillError(res.error);
          setSourcesReport(res.data ?? null);
        } else if (tab === "pages") {
          const res = await fetchPresencePagesReport(businessId, days);
          if (res.error) setDrillError(res.error);
          setPagesReport(res.data ?? null);
        } else {
          const res = await fetchPresenceFunnelReport(businessId, days);
          if (res.error) setDrillError(res.error);
          setFunnelReport(res.data ?? null);
        }
      } catch (err) {
        setDrillError((err as Error).message ?? "Failed to load report");
      } finally {
        setDrillLoading(false);
      }
    },
    [businessId, days],
  );

  useEffect(() => {
    if (!drillOpen) return;
    void loadDrill(drillTab);
  }, [drillOpen, drillTab, loadDrill]);

  const visitors = visitorCount(overview);
  const conversions = conversionCount(overview);
  const empty = !loading && isOverviewEmpty(overview);

  const headerActions = useMemo(
    () => (
      <div className="flex items-center gap-2">
        <div
          role="tablist"
          aria-label="Time range"
          className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5"
        >
          {([7, 30] as RangeDays[]).map((d) => (
            <button
              key={d}
              role="tab"
              aria-selected={days === d}
              onClick={() => setDays(d)}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                days === d
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setDrillTab("sources");
            setDrillOpen(true);
          }}
          disabled={empty}
        >
          View reports
        </Button>
      </div>
    ),
    [days, empty],
  );

  return (
    <Card
      className={`space-y-3 rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow ${className ?? ""}`}
      padding="lg"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Presence analytics</p>
          <p className="text-[11px] text-slate-500">
            How visitors find and convert on your public site · last {days} days
          </p>
        </div>
        {headerActions}
      </div>

      {error && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-xs text-slate-500">Loading presence numbers…</p>
      ) : empty ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
          <p className="font-semibold text-slate-900">No presence data yet</p>
          <p className="mt-1">
            Once visitors land on your published site we&apos;ll roll up
            sources, pages, and funnel here. Fresh installs can take up to ~24h
            for the first nightly aggregation to fully populate.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <StatTile
              label="Visitors"
              value={visitors.toLocaleString()}
              hint={`${sumCount(overview?.totals, overview?.rawTotals, "visit").toLocaleString()} visits`}
              tone="info"
            />
            <StatTile
              label="Conversions"
              value={conversions.toLocaleString()}
              hint="bookings + checkouts + forms"
              tone="success"
            />
            <StatTile
              label="Conversion rate"
              value={formatPercent(conversions, visitors)}
              hint={`per visitor · last ${days}d`}
              tone="default"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Top sources
              </p>
              <button
                type="button"
                className="text-[11px] font-medium text-slate-600 hover:text-slate-900"
                onClick={() => {
                  setDrillTab("sources");
                  setDrillOpen(true);
                }}
              >
                See all →
              </button>
            </div>
            {topSources.length === 0 ? (
              <p className="text-xs text-slate-500">
                No tagged sources yet — direct traffic only.
              </p>
            ) : (
              <ul className="space-y-1">
                {topSources.map((s) => (
                  <li
                    key={s.key}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                  >
                    <span className="truncate font-medium text-slate-800">
                      {s.key || "(direct)"}
                    </span>
                    <Badge tone="info">
                      {s.uniques.toLocaleString()} visitor
                      {s.uniques === 1 ? "" : "s"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <Drawer
        open={drillOpen}
        onClose={() => setDrillOpen(false)}
        title="Presence reports"
      >
        <div className="space-y-3 p-2">
          <div
            role="tablist"
            aria-label="Report"
            className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5"
          >
            {(["sources", "pages", "funnel"] as DrillTab[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={drillTab === t}
                onClick={() => setDrillTab(t)}
                className={`flex-1 rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors ${
                  drillTab === t
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <p className="text-[11px] text-slate-500">
            Last {days} days · numbers refresh nightly. New visits show up
            within minutes; full aggregation across dimensions can take ~24h.
          </p>

          {drillError && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
              {drillError}
            </div>
          )}

          {drillLoading ? (
            <p className="text-xs text-slate-500">Loading report…</p>
          ) : drillTab === "sources" ? (
            <SourcesReportView data={sourcesReport} />
          ) : drillTab === "pages" ? (
            <PagesReportView data={pagesReport} />
          ) : (
            <FunnelReportView data={funnelReport} />
          )}
        </div>
      </Drawer>
    </Card>
  );
}

function StatTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "info" | "success" | "default";
}) {
  const accent =
    tone === "info"
      ? "text-sky-600"
      : tone === "success"
      ? "text-emerald-600"
      : "text-slate-700";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`text-2xl font-semibold ${accent}`}>{value}</div>
      <div className="text-[11px] text-slate-500">{hint}</div>
    </div>
  );
}

function SourcesReportView({ data }: { data: PresenceSourcesResponse | null }) {
  const dims = data?.sources ?? {};
  const dimKeys = Object.keys(dims);
  if (dimKeys.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        No source data yet. Tag campaigns with utm_source / utm_medium to see
        them here.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {dimKeys.map((dim) => (
        <div key={dim}>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {SOURCE_DIM_LABELS[dim] ?? dim}
          </p>
          <ul className="space-y-1">
            {(dims[dim] ?? []).slice(0, 10).map((row) => (
              <li
                key={`${dim}:${row.key}`}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
              >
                <span className="truncate font-medium text-slate-800">
                  {row.key || "(direct)"}
                </span>
                <span className="text-slate-600">
                  {row.uniques.toLocaleString()} visitors ·{" "}
                  {row.count.toLocaleString()} visits
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function PagesReportView({ data }: { data: PresencePagesResponse | null }) {
  const groups = data?.pages ?? {};
  const dimKeys = Object.keys(groups);
  if (dimKeys.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        No page data yet. Pages, products, and services will appear once
        visitors browse them.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {dimKeys.map((dim) => (
        <div key={dim}>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {PAGE_DIM_LABELS[dim] ?? dim}
          </p>
          <ul className="space-y-1">
            {(groups[dim] ?? []).slice(0, 10).map((row) => (
              <li
                key={`${dim}:${row.key}`}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-slate-800">
                    {row.key}
                  </span>
                  <span className="flex-shrink-0 text-slate-600">
                    {row.uniques.toLocaleString()} visitors ·{" "}
                    {row.count.toLocaleString()} events
                  </span>
                </div>
                {Object.keys(row.metrics).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {Object.entries(row.metrics)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 4)
                      .map(([m, c]) => (
                        <span
                          key={m}
                          className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-600"
                        >
                          {metricLabel(m)} · {c.toLocaleString()}
                        </span>
                      ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function FunnelReportView({ data }: { data: PresenceFunnelResponse | null }) {
  const stages = data?.stages ?? [];
  if (stages.length === 0) {
    return <p className="text-xs text-slate-500">No funnel data yet.</p>;
  }
  const peak = Math.max(...stages.map((s) => s.count), 1);
  return (
    <ul className="space-y-1.5">
      {stages.map((stage, i) => {
        const widthPct = Math.max(2, Math.round((stage.count / peak) * 100));
        return (
          <li
            key={stage.metric}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-800">
                {metricLabel(stage.metric)}
              </span>
              <span className="text-slate-600">
                {stage.count.toLocaleString()}
                {i > 0 && (
                  <span className="ml-2 text-slate-500">
                    {stage.conversionFromPrev}% of prev
                  </span>
                )}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full bg-emerald-500"
                style={{ width: `${widthPct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default PresenceAnalyticsWidget;
