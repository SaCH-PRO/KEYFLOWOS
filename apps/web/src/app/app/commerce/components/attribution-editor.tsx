"use client";

import { useEffect, useRef, useState } from "react";
import { Target, Save } from "lucide-react";
import { apiGet, apiPatch } from "@/lib/api";

type RevenueType = "INVOICE" | "ORDER" | "BOOKING";

interface Attribution {
  id: string;
  source: string;
  sourceDetail: string | null;
  campaignId: string | null;
  staffId: string | null;
  referralCode: string | null;
  attributionPercent: number;
}

interface Props {
  businessId: string;
  revenueType: RevenueType;
  revenueId: string;
  accentColor?: string;
}

const SOURCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "storefront", label: "Storefront" },
  { value: "quote", label: "Quote" },
  { value: "recurring", label: "Recurring" },
  { value: "manual", label: "Manual" },
  { value: "campaign", label: "Campaign" },
  { value: "referral", label: "Referral" },
  { value: "staff", label: "Staff" },
  { value: "community", label: "Community" },
  { value: "other", label: "Other" },
];

/**
 * Inline editor for the RevenueAttribution row attached to an invoice / order
 * / quote. Lets the operator override source, attribute to a campaign or
 * staff member, and dial down the credited percentage when revenue is
 * shared across efforts.
 */
export function AttributionEditor({ businessId, revenueType, revenueId, accentColor = "#6366f1" }: Props) {
  const [row, setRow] = useState<Attribution | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!businessId || !revenueId) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await apiGet<Attribution | null>(
          `/commerce/businesses/${businessId}/revenue-attributions/${revenueType}/${revenueId}`,
        );
        if (!cancelled) setRow(res.data ?? null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId, revenueType, revenueId]);

  const update = (patch: Partial<Attribution>) => {
    setRow((prev) => (prev ? { ...prev, ...patch } : ({ ...patch } as Attribution)));
  };

  const handleSave = async () => {
    if (!row) return;
    setSaving(true);
    const res = await apiPatch<Attribution>(
      `/commerce/businesses/${businessId}/revenue-attributions/${revenueType}/${revenueId}`,
      {
        source: row.source,
        sourceDetail: row.sourceDetail,
        campaignId: row.campaignId || null,
        staffId: row.staffId || null,
        referralCode: row.referralCode || null,
        attributionPercent: Number(row.attributionPercent ?? 100),
      },
    );
    if (res.data) {
      setRow(res.data);
      setShowSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setShowSaved(false), 3000);
    }
    setSaving(false);
  };

  return (
    <div className="rounded-2xl bg-white/[0.03] border border-border/40 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/30">
        <Target className="w-4 h-4" style={{ color: accentColor, opacity: 0.85 }} />
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Revenue attribution
        </h4>
        {showSaved && (
          <span className="text-[10px] ml-auto text-emerald-400">Saved</span>
        )}
      </div>
      {loading ? (
        <div className="px-4 py-3 text-xs text-muted-foreground">Loading…</div>
      ) : (
        <div className="px-4 py-3 grid grid-cols-2 gap-2">
          <label className="col-span-1 flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Source</span>
            <select
              value={row?.source ?? "manual"}
              onChange={(e) => update({ source: e.target.value })}
              className="px-2 py-1.5 rounded-lg bg-white/[0.04] border border-border/40 text-sm focus:outline-none"
            >
              {SOURCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-1 flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">% credit</span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={row?.attributionPercent ?? 100}
              onChange={(e) => update({ attributionPercent: Number(e.target.value) })}
              className="px-2 py-1.5 rounded-lg bg-white/[0.04] border border-border/40 text-sm focus:outline-none"
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Detail</span>
            <input
              type="text"
              placeholder="e.g. instagram-ad-april"
              value={row?.sourceDetail ?? ""}
              onChange={(e) => update({ sourceDetail: e.target.value })}
              className="px-2 py-1.5 rounded-lg bg-white/[0.04] border border-border/40 text-sm focus:outline-none"
            />
          </label>
          <label className="col-span-1 flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Campaign ID</span>
            <input
              type="text"
              value={row?.campaignId ?? ""}
              onChange={(e) => update({ campaignId: e.target.value })}
              className="px-2 py-1.5 rounded-lg bg-white/[0.04] border border-border/40 text-sm focus:outline-none"
            />
          </label>
          <label className="col-span-1 flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Staff ID</span>
            <input
              type="text"
              value={row?.staffId ?? ""}
              onChange={(e) => update({ staffId: e.target.value })}
              className="px-2 py-1.5 rounded-lg bg-white/[0.04] border border-border/40 text-sm focus:outline-none"
            />
          </label>
          <button
            onClick={handleSave}
            disabled={saving}
            className="col-span-2 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90 inline-flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ backgroundColor: accentColor }}
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? "Saving…" : "Save attribution"}
          </button>
        </div>
      )}
    </div>
  );
}
