"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Package,
  ShoppingBag,
  Truck,
  Star,
  FileText,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Image as ImageIcon,
  Shield,
  ShoppingCart,
  Zap,
  Clock,
  BarChart3,
  Users,
  RefreshCw,
  Loader2,
  Sparkles,
  Eye,
  Target,
  DollarSign,
  Percent,
  Send,
  UserPlus,
  Megaphone,
} from "lucide-react";
import { formatPrice } from "@/lib/format";
import { apiGet } from "@/lib/api";
import { createCampaign } from "@/lib/client";
import { WorkspaceMetricStrip, type MetricStripItem } from "@/components/ui/workspace-metric-strip";
import { SectionCard } from "@/components/ui/section-card";
import { AiRecommendationCard } from "@/components/ui/ai-recommendation-card";
import type { StoreAnalytics, Product, Service, StorefrontConfig, StorefrontPolicies, StoreGraph, StoreReadinessResult } from "@/lib/client";
import Image from "next/image";

type SocialProofSection = { testimonials?: unknown[] };
type HeroSection = { imageUrl?: string; coverImageUrl?: string; headline?: string };
type AppearanceSection = { primaryColor?: string; secondaryColor?: string };
type SeoSection = { metaTitle?: string; metaDescription?: string };
type ContactSection = { email?: string; phone?: string; whatsapp?: string };

type Props = {
  businessId: string;
  storeEnabled: boolean;
  publicUrl: string;
  businessData: {
    name?: string;
    slug?: string | null;
    logoUrl?: string | null;
    primaryColor?: string | null;
    secondaryColor?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
  commerceProducts: Product[];
  services: Service[];
  storefrontConfig: StorefrontConfig;
  analytics: StoreAnalytics | null;
  businessHours: Record<string, { enabled?: boolean }>;
  onModeChange: (mode: string) => void;
  activeDeliveryMethodsCount: number;
  storeGraph: StoreGraph | null;
  readiness: StoreReadinessResult | null;
  onCopilotAction?: (prompt: string) => void;
};

function ScoreRing({ score, label, color, size = 72 }: { score: number; label: string; color: string; size?: number }) {
  const r = size * 0.39;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--kf-muted)/0.2)" strokeWidth="5" />
          <motion.circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={circ}
            initial={{ strokeDashoffset: circ }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-base font-bold leading-none">{score}</span>
        </div>
      </div>
      <span className="text-[10px] font-medium text-center leading-tight" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{label}</span>
    </div>
  );
}

type QuickCard = {
  title: string;
  icon: React.ElementType;
  status: "good" | "warn" | "missing";
  detail: string;
  action?: string;
  mode?: string;
};

function StatusCard({ card, onAction }: { card: QuickCard; onAction?: (mode: string) => void }) {
  const statusColor = card.status === "good" ? "hsl(var(--kf-success))" : card.status === "warn" ? "hsl(var(--kf-warning))" : "hsl(var(--kf-error))";
  const statusBg = card.status === "good" ? "hsl(var(--kf-success)/0.08)" : card.status === "warn" ? "hsl(var(--kf-warning)/0.08)" : "hsl(var(--kf-error)/0.08)";
  const Icon = card.icon;
  return (
    <button
      className="w-full text-left rounded-xl p-3 transition-all group hover:scale-[1.01]"
      style={{ background: statusBg, border: `1px solid ${statusColor}20` }}
      onClick={() => card.mode && onAction?.(card.mode)}
    >
      <div className="flex items-start gap-2.5">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: `${statusColor}15` }}>
          <Icon className="w-3.5 h-3.5" style={{ color: statusColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs font-semibold truncate" style={{ color: "hsl(var(--kf-foreground))" }}>{card.title}</span>
            {card.status !== "good" && card.mode && (
              <ArrowRight className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
            )}
          </div>
          <span className="text-[10px] leading-tight block mt-0.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{card.detail}</span>
          {card.action && card.status !== "good" && (
            <span className="text-[10px] font-medium mt-1 block opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: statusColor }}>{card.action}</span>
          )}
        </div>
        <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ background: statusColor, boxShadow: card.status === "good" ? `0 0 6px ${statusColor}60` : "none" }} />
      </div>
    </button>
  );
}

const ORDER_STATUS_COLORS: Record<string, string> = {
  PENDING: "hsl(40 90% 50%)",
  CONFIRMED: "hsl(200 80% 50%)",
  PROCESSING: "hsl(270 70% 60%)",
  SHIPPED: "hsl(var(--kf-accent1))",
  DELIVERED: "hsl(var(--kf-success))",
  CANCELLED: "hsl(var(--kf-danger))",
  REFUNDED: "hsl(var(--kf-warning))",
};

type CompactOrder = {
  id: string;
  orderNumber: string;
  status: string;
  customerName: string;
  total: number;
  currency: string;
  createdAt?: string;
};

type CompactOrderApiResponse = {
  data: CompactOrder[];
  total?: number;
};

function RecentOrdersList({ businessId, onViewAll }: { businessId: string; onViewAll: () => void }) {
  const [orders, setOrders] = useState<CompactOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await apiGet<CompactOrderApiResponse>(
      `/marketplace/businesses/${businessId}/orders?pageSize=5`,
    );
    const raw = data?.data ?? (Array.isArray(data) ? (data as CompactOrder[]) : []);
    setOrders(raw);
    setLoading(false);
    setLoaded(true);
  }, [businessId]);

  if (!loaded) {
    return (
      <button
        onClick={load}
        className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-medium transition-colors hover:bg-[hsl(var(--kf-muted)/0.1)] min-h-[44px]"
        style={{ background: "hsl(var(--kf-muted)/0.06)", border: "1px solid hsl(var(--kf-border)/0.25)", color: "hsl(var(--kf-muted-foreground))" }}
      >
        <RefreshCw className="w-3.5 h-3.5" />
        Load Recent Orders
      </button>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <p className="text-xs text-center py-4" style={{ color: "hsl(var(--kf-muted-foreground))" }}>No orders yet</p>
    );
  }

  return (
    <div className="space-y-1.5">
      {orders.map((order) => {
        const statusColor = ORDER_STATUS_COLORS[order.status] ?? "hsl(var(--kf-muted-foreground))";
        return (
          <div key={order.id} className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ background: "hsl(var(--kf-muted)/0.06)" }}>
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: statusColor }} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: "hsl(var(--kf-foreground))" }}>#{order.orderNumber} · {order.customerName}</p>
              <p className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{order.status.charAt(0) + order.status.slice(1).toLowerCase()}</p>
            </div>
            <span className="text-xs font-bold flex-shrink-0" style={{ color: "hsl(var(--kf-foreground))" }}>{formatPrice(order.total)}</span>
          </div>
        );
      })}
      <button
        onClick={onViewAll}
        className="w-full text-center text-[10px] font-medium py-2 transition-opacity hover:opacity-70 min-h-[36px]"
        style={{ color: "hsl(var(--kf-accent1))" }}
      >
        View all in Operations →
      </button>
    </div>
  );
}

function TopProductsGrid({ products, liveProductIds }: { products: Product[]; liveProductIds: Set<string> }) {
  const liveProducts = products.filter((p) => liveProductIds.has(p.id));
  const sorted = [...liveProducts].sort((a, b) => (b.price ?? 0) - (a.price ?? 0)).slice(0, 4);
  if (sorted.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-2">
      {sorted.map((p) => (
        <div
          key={p.id}
          className="rounded-xl p-3 flex flex-col gap-1.5"
          style={{ background: "hsl(var(--kf-muted)/0.06)", border: "1px solid hsl(var(--kf-border)/0.25)" }}
        >
          {p.imageUrl ? (
            <div className="w-full h-16 rounded-lg overflow-hidden">
              <Image src={p.imageUrl} alt={p.name} className="w-full h-full object-cover"  fill sizes="(max-width: 768px) 100vw, 50vw" unoptimized />
            </div>
          ) : (
            <div className="w-full h-16 rounded-lg flex items-center justify-center" style={{ background: "hsl(var(--kf-muted)/0.15)" }}>
              <Package className="w-5 h-5" style={{ color: "hsl(var(--kf-muted-foreground)/0.3)" }} />
            </div>
          )}
          <p className="text-xs font-medium truncate" style={{ color: "hsl(var(--kf-foreground))" }}>{p.name}</p>
          <p className="text-[10px] font-bold" style={{ color: "hsl(var(--kf-accent1))" }}>{formatPrice(p.price)}</p>
        </div>
      ))}
    </div>
  );
}

function RevenueTrendBar({ trend, pc }: { trend: { period: string; revenue: number; orders: number }[]; pc: string }) {
  if (trend.length === 0) return null;
  const maxRev = Math.max(...trend.map(t => t.revenue), 1);
  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-[10px] font-bold uppercase tracking-widest px-1" style={{ color: "hsl(var(--kf-muted-foreground)/0.6)" }}>Weekly Trend</p>
      <div className="flex items-end gap-1.5 h-16 px-1">
        {trend.map((t) => (
          <div key={t.period} className="flex-1 flex flex-col items-center gap-0.5">
            <div
              className="w-full rounded-t-md transition-all duration-500"
              style={{
                height: `${Math.max((t.revenue / maxRev) * 100, 4)}%`,
                background: pc,
                opacity: 0.7,
              }}
            />
            <span className="text-[7px]" style={{ color: "hsl(var(--kf-muted-foreground)/0.5)" }}>
              {t.period.slice(5)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RevenueCockpit({ readiness, pc, sc }: { readiness: StoreReadinessResult; pc: string; sc: string }) {
  const rev = readiness.revenue;
  if (rev.totalOrders30d === 0 && rev.totalRevenue30d === 0) return null;

  return (
    <SectionCard title="Revenue Cockpit" subtitle="30-day store performance" icon={DollarSign}>
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl p-3 text-center" style={{ background: "hsl(var(--kf-muted)/0.06)", border: "1px solid hsl(var(--kf-border)/0.25)" }}>
          <p className="text-lg font-bold" style={{ color: pc }}>{formatPrice(rev.totalRevenue30d)}</p>
          <p className="text-[10px] mt-0.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>Revenue</p>
        </div>
        <div className="rounded-xl p-3 text-center" style={{ background: "hsl(var(--kf-muted)/0.06)", border: "1px solid hsl(var(--kf-border)/0.25)" }}>
          <p className="text-lg font-bold" style={{ color: sc }}>{rev.totalOrders30d}</p>
          <p className="text-[10px] mt-0.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>Orders</p>
        </div>
        <div className="rounded-xl p-3 text-center" style={{ background: "hsl(var(--kf-muted)/0.06)", border: "1px solid hsl(var(--kf-border)/0.25)" }}>
          <p className="text-lg font-bold" style={{ color: "hsl(var(--kf-foreground))" }}>{formatPrice(rev.avgOrderValue)}</p>
          <p className="text-[10px] mt-0.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>Avg Order</p>
        </div>
      </div>

      {rev.conversionRate != null && (
        <div className="flex items-center gap-2 mt-3 rounded-xl px-3 py-2" style={{ background: "hsl(var(--kf-muted)/0.06)" }}>
          <Percent className="w-3.5 h-3.5" style={{ color: sc }} />
          <span className="text-xs" style={{ color: "hsl(var(--kf-foreground))" }}>
            <span className="font-bold">{rev.conversionRate.toFixed(1)}%</span> visitor-to-order conversion
          </span>
        </div>
      )}

      {rev.revenueTrend && rev.revenueTrend.length > 1 && (
        <RevenueTrendBar trend={rev.revenueTrend} pc={pc} />
      )}

      {rev.topProductRevenue.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-widest px-1" style={{ color: "hsl(var(--kf-muted-foreground)/0.6)" }}>Top Sellers</p>
          {rev.topProductRevenue.slice(0, 3).map((tp) => (
            <div key={tp.productId} className="flex items-center justify-between rounded-lg px-3 py-1.5" style={{ background: "hsl(var(--kf-muted)/0.04)" }}>
              <span className="text-xs truncate flex-1" style={{ color: "hsl(var(--kf-foreground))" }}>{tp.productName}</span>
              <span className="text-xs font-bold ml-2" style={{ color: pc }}>{formatPrice(tp.revenue)}</span>
              <span className="text-[10px] ml-2" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{tp.orders} sold</span>
            </div>
          ))}
        </div>
      )}

      {rev.bottomProductRevenue && rev.bottomProductRevenue.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-widest px-1" style={{ color: "hsl(var(--kf-muted-foreground)/0.6)" }}>Lowest Performers</p>
          {rev.bottomProductRevenue.map((bp) => (
            <div key={bp.productId} className="flex items-center justify-between rounded-lg px-3 py-1.5" style={{ background: "hsl(var(--kf-warning)/0.04)" }}>
              <span className="text-xs truncate flex-1" style={{ color: "hsl(var(--kf-foreground))" }}>{bp.productName}</span>
              <span className="text-xs font-bold ml-2" style={{ color: "hsl(var(--kf-warning))" }}>{formatPrice(bp.revenue)}</span>
              <span className="text-[10px] ml-2" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{bp.orders} sold</span>
            </div>
          ))}
        </div>
      )}

      {rev.revenueByChannel && rev.revenueByChannel.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-widest px-1" style={{ color: "hsl(var(--kf-muted-foreground)/0.6)" }}>Revenue by Channel</p>
          {rev.revenueByChannel.map((ch) => (
            <div key={ch.channel} className="flex items-center justify-between rounded-lg px-3 py-1.5" style={{ background: "hsl(var(--kf-muted)/0.04)" }}>
              <span className="text-xs capitalize flex-1" style={{ color: "hsl(var(--kf-foreground))" }}>{ch.channel}</span>
              <span className="text-xs font-bold ml-2" style={{ color: sc }}>{formatPrice(ch.revenue)}</span>
              <span className="text-[10px] ml-2" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{ch.orders} orders</span>
            </div>
          ))}
        </div>
      )}

      {rev.promotionROI && (
        <div className="mt-3 rounded-xl px-3 py-2 flex items-center gap-2" style={{ background: "hsl(var(--kf-accent1)/0.06)", border: "1px solid hsl(var(--kf-accent1)/0.15)" }}>
          <Megaphone className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(var(--kf-accent1))" }} />
          <span className="text-xs" style={{ color: "hsl(var(--kf-foreground))" }}>
            <span className="font-bold">{rev.promotionROI.campaignsSent}</span> campaign{rev.promotionROI.campaignsSent !== 1 ? 's' : ''} sent
            {rev.promotionROI.totalCampaignRevenue > 0 && (
              <> · <span className="font-bold" style={{ color: "hsl(var(--kf-success))" }}>{formatPrice(rev.promotionROI.totalCampaignRevenue)}</span> attributed revenue</>
            )}
          </span>
        </div>
      )}
    </SectionCard>
  );
}

function CrmActionBar({ businessId, businessName, onCopilotAction }: { businessId: string; businessName?: string; onCopilotAction?: (prompt: string) => void }) {
  const [actionState, setActionState] = useState<Record<string, "idle" | "loading" | "done">>({});

  const handleAction = useCallback(async (key: string, campaignName: string, subject: string, body: string, copilotPrompt: string) => {
    setActionState(prev => ({ ...prev, [key]: "loading" }));
    try {
      const result = await createCampaign(businessId, {
        name: campaignName,
        subject,
        body,
        status: 'DRAFT',
      });
      if (result.data && !result.error) {
        setActionState(prev => ({ ...prev, [key]: "done" }));
        setTimeout(() => setActionState(prev => ({ ...prev, [key]: "idle" })), 3000);
        onCopilotAction?.(copilotPrompt);
      } else {
        setActionState(prev => ({ ...prev, [key]: "idle" }));
      }
    } catch {
      setActionState(prev => ({ ...prev, [key]: "idle" }));
    }
  }, [businessId, onCopilotAction]);

  const name = businessName || 'My Store';
  const actions = [
    {
      key: "promote",
      label: "Draft Promotion",
      icon: Megaphone,
      campaignName: `Store Promotion - ${name}`,
      subject: `Special offer from ${name}!`,
      body: `<p>Check out our latest offers at <strong>${name}</strong>!</p>`,
      copilotPrompt: `I just created a promotion campaign draft for "${name}". Help me refine the copy with compelling offers and suggest the best time to send.`,
    },
    {
      key: "segment",
      label: "Target Top Customers",
      icon: UserPlus,
      campaignName: `VIP Campaign - ${name}`,
      subject: `An exclusive offer for you from ${name}`,
      body: `<p>As a valued customer, we have something special for you.</p>`,
      copilotPrompt: `I created a VIP campaign draft. Help me identify my best customer segments from CRM and suggest personalized offers for each.`,
    },
    {
      key: "launch",
      label: "Draft Store Announcement",
      icon: Send,
      campaignName: `Store Announcement - ${name}`,
      subject: `${name} is live! Come visit us`,
      body: `<p>We're excited to share that <strong>${name}</strong> is now open for business!</p>`,
      copilotPrompt: `I just created a store announcement campaign draft. Help me write compelling copy and plan a multi-channel launch (email + WhatsApp).`,
    },
  ];

  return (
    <SectionCard title="Quick Actions" subtitle="Create campaign drafts & target audiences" icon={Megaphone}>
      <div className="flex items-center gap-2">
        {actions.map((action) => {
          const Icon = action.icon;
          const state = actionState[action.key] || "idle";
          return (
            <button
              key={action.key}
              onClick={() => handleAction(action.key, action.campaignName, action.subject, action.body, action.copilotPrompt)}
              disabled={state === "loading"}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[10px] font-medium transition-all hover:scale-[1.02] flex-1 justify-center min-h-[40px]"
              style={{ background: "hsl(var(--kf-muted)/0.08)", border: "1px solid hsl(var(--kf-border)/0.3)", color: "hsl(var(--kf-foreground))" }}
            >
              {state === "loading" ? (
                <Loader2 className="w-3 h-3 animate-spin" style={{ color: "hsl(var(--kf-accent1))" }} />
              ) : state === "done" ? (
                <CheckCircle2 className="w-3 h-3" style={{ color: "hsl(var(--kf-success))" }} />
              ) : (
                <Icon className="w-3 h-3" style={{ color: "hsl(var(--kf-accent1))" }} />
              )}
              {state === "done" ? "Created!" : action.label}
            </button>
          );
        })}
      </div>
    </SectionCard>
  );
}

export function OverviewMode({
  businessId,
  storeEnabled,
  publicUrl: _publicUrl,
  businessData,
  commerceProducts,
  services,
  storefrontConfig,
  analytics,
  businessHours,
  onModeChange,
  activeDeliveryMethodsCount,
  storeGraph,
  readiness,
  onCopilotAction,
}: Props) {
  const pc = (storefrontConfig.appearance as AppearanceSection | undefined)?.primaryColor || businessData?.primaryColor || "#F97316";
  const sc = (storefrontConfig.appearance as AppearanceSection | undefined)?.secondaryColor || businessData?.secondaryColor || "#14B8A6";

  const hero = storefrontConfig.hero as HeroSection | undefined;
  const socialProof = storefrontConfig.socialProof as SocialProofSection | undefined;
  const seo = storefrontConfig.seo as SeoSection | undefined;
  const contact = storefrontConfig.contact as ContactSection | undefined;

  const hasHeroImage = !!(hero?.imageUrl || hero?.coverImageUrl);
  const hasTestimonials = !!(socialProof?.testimonials?.length);
  const hasLogo = !!businessData?.logoUrl;
  const _hasSlug = !!businessData?.slug;
  const _hoursConfigured = Object.values(businessHours).some((h) => h?.enabled);
  const _hasMetaSeo = !!(seo?.metaTitle && seo?.metaDescription);
  const _hasContact = !!(businessData?.phone || businessData?.email || contact?.whatsapp);

  const liveProductIds = new Set<string>();
  if (storeGraph) {
    for (const m of storeGraph.mappings) {
      if (m.isLive) liveProductIds.add(m.productId);
    }
  }
  const liveProducts = liveProductIds.size;
  const liveServices = services.length;
  const totalCatalog = commerceProducts.length;

  const deliveryMethodsCount = activeDeliveryMethodsCount;
  const trustAssetsCount = [hasLogo, hasHeroImage, hasTestimonials].filter(Boolean).length;
  const policies = storefrontConfig.policies as (Partial<StorefrontPolicies> & { pages?: unknown[] }) | undefined;
  const policyItems = [
    policies?.refund,
    policies?.privacy,
    policies?.terms,
  ].filter(Boolean).length;
  const policyCompleteness = Math.round((policyItems / 3) * 100);

  const scores = readiness?.scores;
  const healthScore = scores?.overall ?? 0;
  const conversionScore = scores?.conversion ?? 0;
  const launchScore = scores?.launch ?? 0;

  const quickCards: QuickCard[] = [];
  if (readiness) {
    const unresolvedItems = readiness.items.filter((i) => !i.resolved);
    for (const item of unresolvedItems.slice(0, 6)) {
      quickCards.push({
        title: item.title,
        icon: item.severity === "blocker" ? AlertTriangle : item.severity === "warning" ? Zap : CheckCircle2,
        status: item.severity === "blocker" ? "missing" : item.severity === "warning" ? "warn" : "good",
        detail: item.detail,
        action: item.actionLabel,
        mode: item.actionTab,
      });
    }
  }
  if (quickCards.length === 0) {
    quickCards.push(
      { title: "Hero Quality", icon: ImageIcon, status: hasHeroImage ? "good" : "missing", detail: hasHeroImage ? "Hero image set" : "No hero configured", action: "Add Hero Image", mode: "design" },
      { title: "Trust Coverage", icon: Shield, status: trustAssetsCount >= 2 ? "good" : trustAssetsCount === 1 ? "warn" : "missing", detail: `${trustAssetsCount}/3 trust assets`, action: "Add Testimonials", mode: "merchandising" },
      { title: "Catalog Readiness", icon: Package, status: totalCatalog >= 5 ? "good" : totalCatalog > 0 ? "warn" : "missing", detail: `${totalCatalog} products, ${liveServices} services live`, action: "Grow Catalog", mode: "catalog" },
    );
  }

  const recentOrders = analytics?.bookings?.inPeriod ?? readiness?.revenue.totalOrders30d ?? 0;
  const revenue = analytics?.revenue?.inPeriod ?? (readiness?.revenue.totalRevenue30d || null);
  const pageViews = analytics?.storefrontEvents?.page_view ?? null;

  const metricItems: MetricStripItem[] = [
    {
      label: "Live Products",
      value: liveProducts,
      icon: Package,
      iconColor: pc,
      threshold: { status: liveProducts > 0 ? "good" : "critical" },
    },
    {
      label: "Live Services",
      value: liveServices,
      icon: ShoppingBag,
      iconColor: sc,
      threshold: { status: liveServices > 0 ? "good" : "warn" },
    },
    {
      label: "Orders (30d)",
      value: recentOrders,
      icon: ShoppingCart,
      iconColor: pc,
    },
    revenue != null ? {
      label: "Revenue (30d)",
      value: formatPrice(revenue),
      icon: TrendingUp,
      iconColor: sc,
    } : {
      label: "Trust Score",
      value: `${Math.min(trustAssetsCount * 33, 100)}%`,
      icon: Shield,
      iconColor: "#a78bfa",
      threshold: { status: trustAssetsCount >= 2 ? "good" : trustAssetsCount >= 1 ? "warn" : "critical" },
    },
    pageViews != null ? {
      label: "Store Views",
      value: pageViews.toLocaleString(),
      icon: Eye,
      iconColor: sc,
    } : {
      label: "Delivery Methods",
      value: deliveryMethodsCount,
      icon: Truck,
      iconColor: sc,
      threshold: { status: deliveryMethodsCount > 0 ? "good" : "warn" },
    },
    {
      label: "Policy Score",
      value: `${policyCompleteness}%`,
      icon: FileText,
      iconColor: "#a78bfa",
      threshold: { status: policyCompleteness >= 66 ? "good" : policyCompleteness >= 33 ? "warn" : "critical" },
    },
  ];

  const aiRecommendations: { type: "action" | "insight" | "risk" | "opportunity"; priority: "high" | "medium" | "low"; title: string; description: string; explanation?: string; actionLabel: string; mode: string }[] = [];
  if (readiness) {
    const blockers = readiness.items.filter((i) => !i.resolved && i.severity === "blocker");
    const warnings = readiness.items.filter((i) => !i.resolved && i.severity === "warning");
    for (const b of blockers.slice(0, 2)) {
      aiRecommendations.push({ type: "risk", priority: "high", title: b.title, description: b.detail, actionLabel: b.actionLabel, mode: b.actionTab });
    }
    for (const w of warnings.slice(0, 2)) {
      aiRecommendations.push({ type: "action", priority: "medium", title: w.title, description: w.detail, actionLabel: w.actionLabel, mode: w.actionTab });
    }
  } else {
    if (!storeEnabled) aiRecommendations.push({ type: "risk", priority: "high", title: "Store is Offline", description: "Your storefront is in draft mode. Customers can't see or order from it.", actionLabel: "Go to Launch", mode: "launch" });
    if (!hasHeroImage) aiRecommendations.push({ type: "action", priority: "high", title: "Add a Hero Image", description: "Stores with hero banners see up to 40% higher engagement.", actionLabel: "Customize Design", mode: "design" });
    if (totalCatalog === 0) aiRecommendations.push({ type: "risk", priority: "high", title: "Empty Catalog", description: "Your store has no products. Add items so visitors have something to browse.", actionLabel: "Add Items", mode: "catalog" });
  }

  return (
    <div className="space-y-4">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <SectionCard title="Storefront Health" subtitle="Readiness scores from store intelligence" icon={Target}>
          <div className="flex items-center justify-around gap-4">
            <ScoreRing score={healthScore} label="Overall" color={pc} />
            <div className="h-12 w-px" style={{ background: "hsl(var(--kf-border)/0.3)" }} />
            <ScoreRing score={launchScore} label="Launch" color={sc} />
            <div className="h-12 w-px" style={{ background: "hsl(var(--kf-border)/0.3)" }} />
            <ScoreRing score={conversionScore} label="Conversion" color="#a78bfa" />
          </div>
          {readiness && (
            <div className="flex items-center justify-center gap-4 mt-3">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ background: "hsl(var(--kf-success))" }} />
                <span className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{readiness.items.filter((i) => i.resolved).length} passed</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ background: "hsl(var(--kf-error))" }} />
                <span className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{readiness.items.filter((i) => !i.resolved && i.severity === "blocker").length} blockers</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ background: "hsl(var(--kf-warning))" }} />
                <span className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{readiness.items.filter((i) => !i.resolved && i.severity === "warning").length} warnings</span>
              </div>
            </div>
          )}
        </SectionCard>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
      >
        <WorkspaceMetricStrip items={metricItems} columns={3} compact />
      </motion.div>

      {readiness && readiness.revenue.totalOrders30d > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
          <RevenueCockpit readiness={readiness} pc={pc} sc={sc} />
        </motion.div>
      )}

      {aiRecommendations.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-2"
        >
          <div className="flex items-center gap-2 px-1">
            <Sparkles className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "hsl(var(--kf-muted-foreground)/0.6)" }}>AI Advisor</span>
          </div>
          {aiRecommendations.slice(0, 3).map((rec) => (
            <AiRecommendationCard
              key={rec.title}
              type={rec.type}
              priority={rec.priority}
              title={rec.title}
              description={rec.description}
              explanation={rec.explanation}
              actionLabel={rec.actionLabel}
              onAction={() => onModeChange(rec.mode)}
            />
          ))}
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
        <CrmActionBar businessId={businessId} businessName={businessData?.name} onCopilotAction={onCopilotAction} />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
      >
        <SectionCard title="Storefront Status" subtitle="Health checks across all dimensions" icon={CheckCircle2}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {quickCards.map((card) => (
              <StatusCard key={card.title} card={card} onAction={onModeChange} />
            ))}
          </div>
        </SectionCard>
      </motion.div>

      {liveProducts > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <SectionCard
            title="Top Products"
            subtitle="Highest-value items in your store"
            icon={Star}
            action={{ label: "Manage Catalog", onClick: () => onModeChange("catalog") }}
          >
            <TopProductsGrid products={commerceProducts} liveProductIds={liveProductIds} />
          </SectionCard>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
      >
        <SectionCard
          title="Recent Orders"
          icon={Clock}
          headerRight={
            <div className="flex items-center gap-3">
              {recentOrders > 0 && (
                <span className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                  {recentOrders} in 30d{revenue != null ? ` · ${formatPrice(revenue)}` : ""}
                </span>
              )}
              <button
                onClick={() => onModeChange("operations")}
                className="text-[10px] font-medium flex items-center gap-1 transition-opacity hover:opacity-70"
                style={{ color: "hsl(var(--kf-accent1))" }}
              >
                View All <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          }
        >
          <RecentOrdersList businessId={businessId} onViewAll={() => onModeChange("operations")} />
        </SectionCard>
      </motion.div>

      {pageViews != null && pageViews > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="rounded-2xl px-4 py-3 flex items-center gap-3"
          style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.4)" }}
        >
          <BarChart3 className="w-4 h-4 flex-shrink-0" style={{ color: pc }} />
          <p className="text-xs flex-1" style={{ color: "hsl(var(--kf-foreground))" }}>
            <span className="font-bold">{pageViews.toLocaleString()}</span> store views in the last 30 days
          </p>
          <Users className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
        </motion.div>
      )}
    </div>
  );
}
