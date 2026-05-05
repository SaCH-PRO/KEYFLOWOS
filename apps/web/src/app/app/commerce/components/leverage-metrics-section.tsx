"use client";

import { useEffect, useState } from "react";
import { Clock, TrendingUp } from "lucide-react";
import { apiGet } from "@/lib/api";
import { formatAmount } from "../utils/commerce-utils";

interface MarginSnapshot {
  id: string;
  productId: string;
  grossMargin: number;
  marginBand: string;
  grossProfit: number | null;
  quantity: number | null;
  currency: string;
  createdAt: string;
}

interface InvoiceMetrics {
  type: "invoice";
  sentAt: string | null;
  paidAt: string | null;
  timeToPayMs: number | null;
  currency: string;
  marginSnapshots: MarginSnapshot[];
  totalGrossProfit: number;
  avgMargin: number | null;
  notFound?: boolean;
}

interface QuoteMetrics {
  type: "quote";
  sentAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  timeToCloseMs: number | null;
  currency: string;
  notFound?: boolean;
}

type Metrics = InvoiceMetrics | QuoteMetrics;

function formatDuration(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  if (hours < 48) return `${hours}h`;
  const days = Math.round((hours / 24) * 10) / 10;
  return `${days}d`;
}

function bandColor(band: string): string {
  switch (band) {
    case "EXCELLENT":
    case "GOOD":
      return "rgb(34,197,94)";
    case "FAIR":
      return "rgb(234,179,8)";
    case "POOR":
    case "LOSS":
      return "rgb(248,113,113)";
    default:
      return "rgb(148,163,184)";
  }
}

export function LeverageMetricsSection({
  businessId,
  type,
  itemId,
  accentColor,
}: {
  businessId: string;
  type: "invoice" | "quote";
  itemId: string;
  accentColor: string;
}) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await apiGet<Metrics>(
        `/commerce/businesses/${businessId}/leverage/metrics/${type}/${itemId}`,
      );
      if (cancelled) return;
      if (res.data) setMetrics(res.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId, type, itemId]);

  if (!metrics || metrics.notFound) return null;

  const duration =
    metrics.type === "invoice"
      ? formatDuration(metrics.timeToPayMs)
      : formatDuration(metrics.timeToCloseMs);
  const durationLabel = metrics.type === "invoice" ? "Time to pay" : "Time to close";

  const hasMargin =
    metrics.type === "invoice" && metrics.marginSnapshots.length > 0;

  if (!duration && !hasMargin) return null;

  return (
    <div
      className="rounded-2xl border p-3 space-y-2"
      style={{
        background: `${accentColor}08`,
        borderColor: `${accentColor}33`,
      }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        {duration && (
          <span
            className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full font-semibold"
            style={{
              background: `${accentColor}18`,
              color: accentColor,
              border: `1px solid ${accentColor}33`,
            }}
            data-testid="leverage-duration-chip"
          >
            <Clock className="w-3 h-3" />
            {durationLabel}: {duration}
          </span>
        )}
        {hasMargin && metrics.type === "invoice" && (
          <span
            className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full font-semibold"
            style={{
              background: `${bandColor(metrics.marginSnapshots[0].marginBand)}18`,
              color: bandColor(metrics.marginSnapshots[0].marginBand),
              border: `1px solid ${bandColor(metrics.marginSnapshots[0].marginBand)}33`,
            }}
            title={`${metrics.marginSnapshots.length} margin snapshot(s) captured on payment`}
            data-testid="leverage-margin-chip"
          >
            <TrendingUp className="w-3 h-3" />
            Margin {metrics.avgMargin != null
              ? `${Math.round(metrics.avgMargin * 100)}%`
              : metrics.marginSnapshots[0].marginBand}
            {metrics.totalGrossProfit > 0 && (
              <span className="font-normal opacity-80">
                · {formatAmount(metrics.totalGrossProfit, metrics.currency)} GP
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
