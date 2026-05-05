"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  RefreshCw,
  CheckCircle2,
  Globe,
  EyeOff,
  TrendingUp,
  ShoppingCart,
  CalendarCheck,
  AlertTriangle,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { KfButton } from "@/components/ui/kf-button";
import { PageHeader } from "@/components/ui/page-header";
import { refreshWorkspace, getStoredBusinessId, getCachedBusiness } from "@/lib/workspace";
import { apiGet, apiPost } from "@/lib/api";

interface CaseStudy {
  id: string;
  businessId: string;
  headline: string;
  location: string;
  industry: string | null;
  metrics: {
    windowDays: number;
    recentOrders: number;
    priorOrders: number;
    recentRevenue: number;
    priorRevenue: number;
    currency: string;
    recentBookings: number;
    priorBookings: number;
    orderGrowthPct: number | null;
    revenueGrowthPct: number | null;
    bookingGrowthPct: number | null;
    topService: string | null;
    topProduct: string | null;
  };
  status: "draft" | "published";
  consent: boolean;
  consentedAt: string | null;
  consentedBy: string | null;
  generatedAt: string;
  publishedAt: string | null;
}

function formatCurrency(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(0)}`;
  }
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function CaseStudiesPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businessSlug, setBusinessSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [studies, setStudies] = useState<CaseStudy[]>([]);
  const [consentChecked, setConsentChecked] = useState<Record<string, boolean>>({});
  const [genError, setGenError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const fresh = await refreshWorkspace();
      const id = fresh ?? getStoredBusinessId();
      if (id) setBusinessId(id);
      const cached = getCachedBusiness();
      if (cached?.slug) setBusinessSlug(cached.slug);
    })();
  }, []);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const res = await apiGet<CaseStudy[]>(
      `/site/businesses/${encodeURIComponent(businessId)}/case-studies`,
    );
    if (res.data) {
      setStudies(res.data);
    } else if (res.error) {
      toast.error(res.error);
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async hydration
    void load();
  }, [businessId, load]);

  const handleGenerate = useCallback(async () => {
    if (!businessId) return;
    setGenerating(true);
    setGenError(null);
    const res = await apiPost<CaseStudy>({
      path: `/site/businesses/${encodeURIComponent(businessId)}/case-studies/generate`,
    });
    setGenerating(false);
    if (res.data) {
      toast.success("Draft generated from your real platform data");
      await load();
    } else {
      const msg = res.error ?? "Failed to generate case study";
      setGenError(msg);
      toast.error(msg);
    }
  }, [businessId, load]);

  const handlePublish = useCallback(
    async (study: CaseStudy) => {
      if (!businessId) return;
      if (!consentChecked[study.id]) {
        toast.error("Please confirm consent before publishing");
        return;
      }
      setPublishingId(study.id);
      const res = await apiPost<CaseStudy>({
        path: `/site/businesses/${encodeURIComponent(businessId)}/case-studies/${encodeURIComponent(study.id)}/publish`,
        body: { consent: true },
      });
      setPublishingId(null);
      if (res.data) {
        toast.success("Case study published to your storefront");
        await load();
      } else {
        toast.error(res.error ?? "Failed to publish");
      }
    },
    [businessId, consentChecked, load],
  );

  const handleUnpublish = useCallback(
    async (study: CaseStudy) => {
      if (!businessId) return;
      setPublishingId(study.id);
      const res = await apiPost<CaseStudy>({
        path: `/site/businesses/${encodeURIComponent(businessId)}/case-studies/${encodeURIComponent(study.id)}/unpublish`,
      });
      setPublishingId(null);
      if (res.data) {
        toast.success("Case study unpublished");
        setConsentChecked((prev) => ({ ...prev, [study.id]: false }));
        await load();
      } else {
        toast.error(res.error ?? "Failed to unpublish");
      }
    },
    [businessId, load],
  );

  const drafts = useMemo(() => studies.filter((s) => s.status === "draft"), [studies]);
  const published = useMemo(() => studies.filter((s) => s.status === "published"), [studies]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 p-4 sm:p-6 max-w-5xl mx-auto"
    >
      <PageHeader
        icon={Sparkles}
        title="Case Studies"
        subtitle="Generate growth proof from your real 60-day order, revenue and booking data, then publish with explicit consent."
        actionLabel={generating ? "Generating…" : "Generate from real data"}
        actionIcon={generating ? Loader2 : RefreshCw}
        onAction={handleGenerate}
      />

      {genError && (
        <div className="kf-card p-4 flex items-start gap-3 border border-amber-400/30 bg-amber-500/5">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="kf-text-body text-amber-100">{genError}</div>
        </div>
      )}

      {loading ? (
        <div className="kf-card p-8 text-center">
          <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
        </div>
      ) : studies.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No case studies yet"
          description="Click Generate above to build a draft from your last 60 days of completed orders and confirmed bookings. Synthetic content is never generated — drafts are only created when you have real platform activity."
        />
      ) : (
        <>
          <SectionCard
            icon={Globe}
            title={`Published (${published.length})`}
            subtitle="Visible on your public storefront"
          >
            {published.length === 0 ? (
              <p className="kf-text-body text-muted-foreground">
                Nothing published yet. Approve a draft below to make it visible to visitors.
              </p>
            ) : (
              <div className="space-y-3">
                {published.map((s) => (
                  <CaseStudyRow
                    key={s.id}
                    study={s}
                    busy={publishingId === s.id}
                    consentChecked={!!consentChecked[s.id]}
                    onConsentChange={(v) =>
                      setConsentChecked((prev) => ({ ...prev, [s.id]: v }))
                    }
                    onPublish={() => handlePublish(s)}
                    onUnpublish={() => handleUnpublish(s)}
                    storefrontSlug={businessSlug}
                  />
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            icon={Sparkles}
            title={`Drafts (${drafts.length})`}
            subtitle="Review the real numbers, then approve to publish"
          >
            {drafts.length === 0 ? (
              <p className="kf-text-body text-muted-foreground">
                No drafts pending approval. Generate a fresh draft from your latest 60-day window.
              </p>
            ) : (
              <div className="space-y-3">
                {drafts.map((s) => (
                  <CaseStudyRow
                    key={s.id}
                    study={s}
                    busy={publishingId === s.id}
                    consentChecked={!!consentChecked[s.id]}
                    onConsentChange={(v) =>
                      setConsentChecked((prev) => ({ ...prev, [s.id]: v }))
                    }
                    onPublish={() => handlePublish(s)}
                    onUnpublish={() => handleUnpublish(s)}
                    storefrontSlug={businessSlug}
                  />
                ))}
              </div>
            )}
          </SectionCard>
        </>
      )}
    </motion.div>
  );
}

function CaseStudyRow({
  study,
  busy,
  consentChecked,
  onConsentChange,
  onPublish,
  onUnpublish,
  storefrontSlug,
}: {
  study: CaseStudy;
  busy: boolean;
  consentChecked: boolean;
  onConsentChange: (v: boolean) => void;
  onPublish: () => void;
  onUnpublish: () => void;
  storefrontSlug: string | null;
}) {
  const m = study.metrics;
  const isPublished = study.status === "published";
  return (
    <div
      className="kf-card kf-radius-md p-4 space-y-3"
      style={{ background: "hsl(var(--kf-muted) / 0.3)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="kf-text-emphasis font-semibold leading-tight">{study.headline}</h4>
          <p className="kf-text-micro text-muted-foreground mt-1">
            Generated {formatDate(study.generatedAt)}
            {isPublished && study.publishedAt
              ? ` · Published ${formatDate(study.publishedAt)}`
              : ""}
          </p>
        </div>
        <span
          className={`shrink-0 inline-flex items-center gap-1 kf-text-micro px-2 py-1 kf-radius-sm ${
            isPublished
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-amber-500/15 text-amber-300"
          }`}
        >
          {isPublished ? <CheckCircle2 className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
          {isPublished ? "Published" : "Draft"}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Metric
          icon={ShoppingCart}
          label="Orders (60d)"
          value={String(m.recentOrders)}
          prior={`${m.priorOrders} prior 60d`}
          delta={m.orderGrowthPct}
        />
        <Metric
          icon={TrendingUp}
          label="Revenue (60d)"
          value={formatCurrency(m.recentRevenue, m.currency)}
          prior={`${formatCurrency(m.priorRevenue, m.currency)} prior 60d`}
          delta={m.revenueGrowthPct}
        />
        <Metric
          icon={CalendarCheck}
          label="Bookings (60d)"
          value={String(m.recentBookings)}
          prior={`${m.priorBookings} prior 60d`}
          delta={m.bookingGrowthPct}
        />
        <Metric
          icon={Sparkles}
          label="Top item"
          value={m.topProduct || m.topService || "—"}
        />
      </div>

      {!isPublished ? (
        <div className="space-y-3 pt-1">
          <label className="flex items-start gap-2 cursor-pointer kf-text-body">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => onConsentChange(e.target.checked)}
              className="mt-1 shrink-0"
              aria-label="Consent to publish case study"
            />
            <span className="text-muted-foreground">
              I confirm these are accurate and I consent to publishing this case study —
              including the headline numbers above — on my public storefront.
            </span>
          </label>
          <div className="flex gap-2">
            <KfButton
              variant="primary"
              size="sm"
              icon={Globe}
              loading={busy}
              disabled={!consentChecked || busy}
              onClick={onPublish}
            >
              Publish to storefront
            </KfButton>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <KfButton
            variant="secondary"
            size="sm"
            icon={EyeOff}
            loading={busy}
            disabled={busy}
            onClick={onUnpublish}
          >
            Unpublish
          </KfButton>
          {storefrontSlug && (
            <a
              href={`/site/${encodeURIComponent(storefrontSlug)}#case-studies`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 kf-text-micro text-[hsl(var(--kf-accent1))] hover:underline"
            >
              View on storefront <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  prior,
  delta,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  prior?: string;
  delta?: number | null;
}) {
  const showDelta = typeof delta === "number" && !Number.isNaN(delta);
  const deltaPositive = showDelta && (delta as number) > 0;
  const deltaNegative = showDelta && (delta as number) < 0;
  return (
    <div
      className="kf-radius-sm p-2 flex items-start gap-2"
      style={{ background: "hsl(var(--kf-background) / 0.5)", border: "1px solid hsl(var(--kf-border) / 0.4)" }}
    >
      <Icon className="w-3.5 h-3.5 mt-0.5 text-[hsl(var(--kf-accent1))] shrink-0" />
      <div className="min-w-0">
        <div className="kf-text-micro text-muted-foreground truncate">{label}</div>
        <div className="kf-text-body font-semibold truncate">{value}</div>
        {prior && (
          <div className="kf-text-micro text-muted-foreground truncate" title={prior}>
            {prior}
          </div>
        )}
        {showDelta && (
          <div
            className={`kf-text-micro ${
              deltaPositive ? "text-emerald-400" : deltaNegative ? "text-rose-400" : "text-muted-foreground"
            }`}
          >
            {deltaPositive ? "+" : ""}
            {delta}% vs prior 60d
          </div>
        )}
      </div>
    </div>
  );
}
