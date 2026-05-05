"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Trophy, Users, Settings2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, ContentContainer, Badge, Input } from "@keyflow/ui";
import {
  LifecycleReport,
  LifecycleBucket,
  fetchAttributionSettings,
  fetchLifecycleReport,
  updateAttributionSettings,
} from "@/lib/client";
import { ensureWorkspace, getStoredBusinessId } from "@/lib/workspace";

const RANGES: { id: string; label: string; days: number | null }[] = [
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
  { id: "180d", label: "Last 180 days", days: 180 },
  { id: "all", label: "All time", days: null },
];

function formatCurrency(value: number, currency: string | null) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency ?? "TTD",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `$${value.toFixed(0)}`;
  }
}

function BucketCard({ title, buckets, currency }: { title: string; buckets: LifecycleBucket[]; currency: string | null }) {
  const sorted = useMemo(() => [...buckets].sort((a, b) => b.totalValue - a.totalValue), [buckets]);
  return (
    <Card padding="lg">
      <h3 className="font-semibold text-sm mb-3">{title}</h3>
      {sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">No data yet.</p>
      ) : (
        <div className="space-y-3">
          {sorted.map((b) => (
            <div key={b.key} className="border border-border/40 rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium text-sm capitalize truncate">{b.key.replace(/_/g, " ")}</div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {b.totalDeals} deal(s) · {formatCurrency(b.totalValue, currency)}
                </div>
              </div>
              {b.best && (
                <div className="text-[11px] text-[hsl(var(--kf-success))] inline-flex items-center gap-1">
                  <Trophy className="w-3 h-3" /> Best: <span className="font-medium">{b.best.sequenceName}</span>
                  <span className="text-muted-foreground">
                    ({b.best.deals} deal(s) · {formatCurrency(b.best.value, currency)})
                  </span>
                </div>
              )}
              {b.breakdown.length > 1 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {b.breakdown.slice(0, 6).map((row) => (
                    <span
                      key={row.sequenceId}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted/40 text-[10px]"
                      title={`${row.deals} deal(s) · ${formatCurrency(row.value, currency)}`}
                    >
                      <Link href={`/app/crm/sequences/${row.sequenceId}/analytics`} className="hover:text-foreground">
                        {row.sequenceName}
                      </Link>
                      <span className="text-muted-foreground">{row.deals}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function LifecycleReportPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [rangeId, setRangeId] = useState("90d");
  const [report, setReport] = useState<LifecycleReport | null>(null);
  const [windowDays, setWindowDays] = useState<number>(14);
  const [windowDraft, setWindowDraft] = useState<string>("14");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const computeRange = useCallback((id: string) => {
    const r = RANGES.find((x) => x.id === id) ?? RANGES[1];
    if (!r.days) return undefined;
    const to = new Date();
    const from = new Date(to.getTime() - r.days * 86400_000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);

  const load = useCallback(async (bid: string, rid: string) => {
    setLoading(true);
    const [{ data: lr }, { data: settings }] = await Promise.all([
      fetchLifecycleReport(bid, computeRange(rid)),
      fetchAttributionSettings(bid),
    ]);
    setReport(lr ?? null);
    if (settings?.attributionWindowDays) {
      setWindowDays(settings.attributionWindowDays);
      setWindowDraft(String(settings.attributionWindowDays));
    }
    setLoading(false);
  }, [computeRange]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const id = (await ensureWorkspace()) ?? getStoredBusinessId();
      if (cancelled || !id) return;
      setBusinessId(id);
      await load(id, rangeId);
    })();
    return () => { cancelled = true; };
    // Only run on mount; range changes drive a manual reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRangeChange = (id: string) => {
    setRangeId(id);
    if (businessId) void load(businessId, id);
  };

  const handleSaveWindow = async () => {
    if (!businessId) return;
    const n = Number(windowDraft);
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      toast.error("Window must be between 1 and 365 days");
      return;
    }
    setSaving(true);
    const { data, error } = await updateAttributionSettings(businessId, { attributionWindowDays: n });
    setSaving(false);
    if (error) {
      toast.error(error);
      return;
    }
    if (data) {
      setWindowDays(data.attributionWindowDays);
      toast.success("Attribution window saved");
    }
  };

  return (
    <ContentContainer>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <Link href="/app/crm/sequences" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-3 h-3" /> Back to sequences
          </Link>
          <h1 className="text-xl font-semibold mt-2">Lifecycle report</h1>
          <p className="text-xs text-muted-foreground">
            Cross-sequence outcomes by relationship type, source, and best channel.
          </p>
        </div>
        <div className="inline-flex rounded-md border border-border/60 overflow-hidden text-xs">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => handleRangeChange(r.id)}
              className={`px-2 py-1 ${rangeId === r.id ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/40"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Attribution config */}
      <Card padding="md" className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-[11px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Settings2 className="w-3 h-3" /> Attribution window
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Deals won within this many days after enrollment are credited (currently <Badge>{windowDays}d</Badge>).
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={365}
              className="w-20"
              value={windowDraft}
              onChange={(e) => setWindowDraft(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">days</span>
            <Button onClick={handleSaveWindow} disabled={saving} size="sm">
              <Save className="w-3.5 h-3.5 mr-1" /> Save
            </Button>
          </div>
        </div>
      </Card>

      {loading || !report ? (
        <div className="text-sm text-muted-foreground py-12 text-center">Loading lifecycle report…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
            <Card padding="md">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Attributed deals</div>
              <div className="text-2xl font-semibold flex items-center gap-2">
                <Trophy className="w-4 h-4 text-[hsl(var(--kf-success))]" />
                {report.totals.deals}
              </div>
            </Card>
            <Card padding="md">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Attributed value</div>
              <div className="text-2xl font-semibold">{formatCurrency(report.totals.value, report.totals.currency)}</div>
            </Card>
            <Card padding="md">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Segments analyzed</div>
              <div className="text-2xl font-semibold flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                {report.byRelationshipType.length + report.bySource.length + report.byBestChannel.length}
              </div>
            </Card>
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <BucketCard title="By relationship type" buckets={report.byRelationshipType} currency={report.totals.currency} />
            <BucketCard title="By source" buckets={report.bySource} currency={report.totals.currency} />
            <BucketCard title="By best channel" buckets={report.byBestChannel} currency={report.totals.currency} />
          </div>
        </>
      )}
    </ContentContainer>
  );
}
