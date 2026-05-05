import { TrendingUp, ShoppingCart, CalendarCheck, Sparkles } from "lucide-react";

interface CaseStudyMetrics {
  windowDays: number;
  recentOrders: number;
  priorOrders?: number;
  recentRevenue: number;
  priorRevenue?: number;
  currency: string;
  recentBookings: number;
  priorBookings?: number;
  orderGrowthPct: number | null;
  revenueGrowthPct: number | null;
  bookingGrowthPct: number | null;
  topService: string | null;
  topProduct: string | null;
}

export interface PublicCaseStudy {
  id: string;
  headline: string;
  location: string;
  industry: string | null;
  metrics: CaseStudyMetrics;
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

export default function CaseStudiesSection({
  studies,
  primaryColor,
}: {
  studies: PublicCaseStudy[];
  primaryColor?: string;
}) {
  if (!studies || studies.length === 0) return null;
  const accent = primaryColor || "#F97316";

  return (
    <section
      id="case-studies"
      className="px-6 py-12 sm:py-16 bg-slate-50 border-t border-slate-200"
    >
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider px-3 py-1 rounded-full mb-3"
            style={{ background: `${accent}15`, color: accent }}
          >
            <Sparkles className="w-3.5 h-3.5" /> Real Results
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">
            Recent growth on this storefront
          </h2>
          <p className="mt-2 text-sm text-slate-600 max-w-2xl mx-auto">
            Numbers below are pulled directly from real platform activity in the last 60 days
            and published with the owner&rsquo;s explicit consent.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {studies.map((s) => {
            const m = s.metrics;
            return (
              <article
                key={s.id}
                className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm"
              >
                <h3 className="text-base font-semibold text-slate-900 leading-snug">
                  {s.headline}
                </h3>
                {(s.location || s.industry) && (
                  <p className="text-xs text-slate-500 mt-1">
                    {[s.industry, s.location].filter(Boolean).join(" · ")}
                  </p>
                )}

                <dl className="grid grid-cols-3 gap-3 mt-4">
                  <Stat
                    icon={ShoppingCart}
                    label={`Orders (${m.windowDays}d)`}
                    value={String(m.recentOrders)}
                    delta={m.orderGrowthPct}
                    windowDays={m.windowDays}
                    accent={accent}
                  />
                  <Stat
                    icon={TrendingUp}
                    label="Revenue"
                    value={formatCurrency(m.recentRevenue, m.currency)}
                    delta={m.revenueGrowthPct}
                    windowDays={m.windowDays}
                    accent={accent}
                  />
                  <Stat
                    icon={CalendarCheck}
                    label="Bookings"
                    value={String(m.recentBookings)}
                    delta={m.bookingGrowthPct}
                    windowDays={m.windowDays}
                    accent={accent}
                  />
                </dl>

                {(m.topProduct || m.topService) && (
                  <p className="text-xs text-slate-600 mt-4">
                    Top {m.topProduct ? "product" : "service"}:{" "}
                    <span className="font-medium text-slate-900">
                      {m.topProduct || m.topService}
                    </span>
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  delta,
  windowDays,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  delta?: number | null;
  windowDays: number;
  accent: string;
}) {
  const showDelta = typeof delta === "number" && !Number.isNaN(delta);
  const positive = showDelta && (delta as number) > 0;
  const negative = showDelta && (delta as number) < 0;
  return (
    <div>
      <dt className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500 font-medium">
        <Icon className="w-3 h-3" style={{ color: accent }} />
        {label}
      </dt>
      <dd className="text-base font-semibold text-slate-900 mt-0.5 truncate">{value}</dd>
      {showDelta && (
        <div
          className={`text-[11px] font-medium mt-0.5 ${
            positive ? "text-emerald-600" : negative ? "text-rose-600" : "text-slate-500"
          }`}
        >
          {positive ? "+" : ""}
          {delta}% vs prior {windowDays}d
        </div>
      )}
    </div>
  );
}
