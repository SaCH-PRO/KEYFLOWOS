"use client";

import { useState } from "react";
import {
  Store, Package, DollarSign, TrendingUp, ShieldCheck, Search, Sparkles, Loader2,
} from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { apiGet } from "@/lib/api";
import type { ControlTowerModules } from "@/lib/client";

interface StorefrontIntelProps {
  businessId: string;
  storefront: ControlTowerModules["storefront"];
  monthlyRevenue: number;
}

interface IntelSignal {
  label: string;
  status: "good" | "warn" | "critical";
  detail: string;
}

function computeSignals(storefront: ControlTowerModules["storefront"], monthlyRevenue: number): IntelSignal[] {
  const signals: IntelSignal[] = [];

  const productCount = storefront.activeProductCount;
  signals.push({
    label: "Launch Readiness",
    status: productCount >= 3 ? "good" : productCount >= 1 ? "warn" : "critical",
    detail: productCount >= 3
      ? `${productCount} products listed — storefront is live-ready`
      : productCount >= 1
        ? `Only ${productCount} product${productCount > 1 ? "s" : ""} — consider adding more variety`
        : "No active products — storefront is not ready for visitors",
  });

  const hasRevenue = monthlyRevenue > 0;
  signals.push({
    label: "Conversion Signal",
    status: hasRevenue && productCount > 0 ? "good" : productCount > 0 ? "warn" : "critical",
    detail: hasRevenue && productCount > 0
      ? "Revenue flowing — products are converting"
      : productCount > 0
        ? "Products listed but no revenue recorded this month"
        : "No products and no revenue — set up your catalog first",
  });

  const avgPrice = storefront.averagePrice;
  signals.push({
    label: "Pricing Health",
    status: avgPrice > 0 ? "good" : "warn",
    detail: avgPrice > 0
      ? `Average price: $${avgPrice.toFixed(0)} TTD`
      : "No pricing data available",
  });

  signals.push({
    label: "Trust & Credibility",
    status: productCount >= 5 ? "good" : productCount >= 2 ? "warn" : "critical",
    detail: productCount >= 5
      ? "Good catalog depth builds buyer confidence"
      : productCount >= 2
        ? "Thin catalog — add descriptions, images, and more products to build trust"
        : "Very thin catalog — visitors may not trust a near-empty store",
  });

  signals.push({
    label: "SEO Readiness",
    status: productCount >= 3 ? "good" : "warn",
    detail: productCount >= 3
      ? `${productCount} product pages available for indexing`
      : "Few product pages — limited search engine visibility",
  });

  return signals;
}

const STATUS_COLORS: Record<string, { dot: string; bg: string }> = {
  good: { dot: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.08)" },
  warn: { dot: "hsl(var(--kf-warning))", bg: "hsl(var(--kf-warning) / 0.08)" },
  critical: { dot: "hsl(var(--kf-error))", bg: "hsl(var(--kf-error) / 0.08)" },
};

export function StorefrontIntel({ businessId, storefront, monthlyRevenue }: StorefrontIntelProps) {
  const signals = computeSignals(storefront, monthlyRevenue);
  const [recommendations, setRecommendations] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchRecommendations = async () => {
    if (recommendations || loading) return;
    setLoading(true);
    try {
      const res = await apiGet<{ recommendations: string[] }>(
        `/ai/businesses/${encodeURIComponent(businessId)}/ai/strategic/opportunities`,
      );
      const recs = (res.data as Record<string, unknown>)?.recommendations;
      setRecommendations(Array.isArray(recs) ? recs.slice(0, 5) : ["Review your catalog and pricing to optimize conversion."]);
    } catch {
      setRecommendations(["Unable to load AI recommendations right now."]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SectionCard title="Storefront Intelligence" subtitle="Store health & conversion signals" icon={Store}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {signals.map((s) => {
          const colors = STATUS_COLORS[s.status] ?? STATUS_COLORS.warn;
          return (
            <div
              key={s.label}
              className="flex items-start gap-2.5 rounded-xl px-3 py-2.5"
              style={{ background: colors.bg, border: `1px solid ${colors.dot}15` }}
            >
              <div className="w-2 h-2 rounded-full mt-1 flex-shrink-0" style={{ background: colors.dot }} />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold" style={{ color: "hsl(var(--kf-foreground))" }}>
                  {s.label}
                </p>
                <p className="text-[10px] leading-relaxed" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                  {s.detail}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 mt-3 pt-3" style={{ borderTop: "1px solid hsl(var(--kf-border) / 0.5)" }}>
        <div className="flex items-center gap-4 text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
          <span className="flex items-center gap-1"><Package className="w-3 h-3" /> {storefront.activeProductCount} products</span>
          <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> Avg ${storefront.averagePrice.toFixed(0)} TTD</span>
        </div>
        <div className="flex-1" />
        <button
          onClick={fetchRecommendations}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-all hover:opacity-80 min-h-[28px]"
          style={{ background: "hsl(var(--kf-accent1) / 0.1)", color: "hsl(var(--kf-accent1))" }}
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          AI Recommendations
        </button>
      </div>

      {recommendations && (
        <div className="mt-2 space-y-1.5">
          {recommendations.map((r, i) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded-lg px-3 py-2"
              style={{ background: "hsl(var(--kf-accent1) / 0.05)", border: "1px solid hsl(var(--kf-accent1) / 0.1)" }}
            >
              <TrendingUp className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--kf-accent1))" }} />
              <p className="text-[10px]" style={{ color: "hsl(var(--kf-foreground))" }}>{r}</p>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
