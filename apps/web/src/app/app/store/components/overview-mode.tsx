"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Package, ShoppingBag, Truck, Star, FileText, Phone,
  TrendingUp, AlertTriangle, CheckCircle2, ArrowRight,
  Image as ImageIcon, Shield, Search, ShoppingCart,
  Zap, ArrowUpRight, Clock, BarChart3, Users, RefreshCw, Loader2,
} from "lucide-react";
import { formatPrice } from "@/lib/format";
import { apiGet } from "@/lib/api";
import type { StoreAnalytics, Product, Service, StorefrontConfig, StorefrontPolicies } from "@/lib/client";

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
};

function ScoreRing({ score, label, color }: { score: number; label: string; color: string }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative w-[72px] h-[72px]">
        <svg width="72" height="72" className="-rotate-90">
          <circle cx="36" cy="36" r={r} fill="none" stroke="hsl(var(--kf-muted)/0.2)" strokeWidth="5" />
          <motion.circle
            cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="5"
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

function KpiChip({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: React.ElementType; color: string }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl px-3 py-3 relative overflow-hidden" style={{ background: `${color}0a`, border: `1px solid ${color}18` }}>
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color }} />
        <span className="text-[10px] font-medium" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{label}</span>
      </div>
      <span className="text-lg font-bold tabular-nums leading-none" style={{ color: "hsl(var(--kf-foreground))" }}>{value}</span>
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

type RecommendedAction = {
  title: string;
  description: string;
  icon: React.ElementType;
  color: string;
  mode: string;
  priority: "high" | "medium" | "low";
};

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

export function OverviewMode({
  businessId,
  storeEnabled,
  publicUrl,
  businessData,
  commerceProducts,
  services,
  storefrontConfig,
  analytics,
  businessHours,
  onModeChange,
  activeDeliveryMethodsCount,
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
  const hasSlug = !!businessData?.slug;
  const hoursConfigured = Object.values(businessHours).some((h) => h?.enabled);
  const hasMetaSeo = !!(seo?.metaTitle && seo?.metaDescription);
  const hasContact = !!(businessData?.phone || businessData?.email || contact?.whatsapp);
  const liveProducts = commerceProducts.filter((p) => services.some((s) => s.name === p.name)).length;
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

  const healthFactors = [
    hasHeroImage ? 20 : 0,
    hasLogo ? 15 : 0,
    hoursConfigured ? 10 : 0,
    hasTestimonials ? 10 : 0,
    (liveProducts > 0 || liveServices > 0) ? 20 : 0,
    hasSlug ? 10 : 0,
    hasMetaSeo ? 10 : 0,
    hasContact ? 5 : 0,
  ];
  const healthScore = Math.min(healthFactors.reduce((a, b) => a + b, 0), 100);

  const readinessFactors = [
    storeEnabled ? 25 : 0,
    hasSlug ? 15 : 0,
    (liveProducts > 0 || liveServices > 0) ? 25 : 0,
    hasHeroImage ? 15 : 0,
    hoursConfigured ? 10 : 0,
    hasContact ? 10 : 0,
  ];
  const readinessScore = Math.min(readinessFactors.reduce((a, b) => a + b, 0), 100);

  const quickCards: QuickCard[] = [
    {
      title: "Hero Quality",
      icon: ImageIcon,
      status: hasHeroImage ? "good" : hasLogo ? "warn" : "missing",
      detail: hasHeroImage ? "Hero image set" : hasLogo ? "Logo set, no hero image" : "No hero or logo configured",
      action: "Add Hero Image",
      mode: "design",
    },
    {
      title: "Trust Coverage",
      icon: Shield,
      status: trustAssetsCount >= 2 ? "good" : trustAssetsCount === 1 ? "warn" : "missing",
      detail: `${trustAssetsCount}/3 trust assets — logo, hero, testimonials`,
      action: "Add Testimonials",
      mode: "merchandising",
    },
    {
      title: "Catalog Readiness",
      icon: Package,
      status: totalCatalog >= 5 ? "good" : totalCatalog > 0 ? "warn" : "missing",
      detail: `${totalCatalog} product${totalCatalog !== 1 ? "s" : ""} in catalog, ${liveServices} service${liveServices !== 1 ? "s" : ""} live`,
      action: "Grow Catalog",
      mode: "catalog",
    },
    {
      title: "SEO Readiness",
      icon: Search,
      status: hasMetaSeo ? "good" : seo?.metaTitle ? "warn" : "missing",
      detail: hasMetaSeo ? "Meta title & description set" : seo?.metaTitle ? "Meta title set, add description" : "No SEO metadata configured",
      action: "Set SEO Meta",
      mode: "merchandising",
    },
    {
      title: "Contact Setup",
      icon: Phone,
      status: hasContact ? "good" : "missing",
      detail: hasContact ? "Contact info configured" : "No phone, email, or WhatsApp set",
      action: "Configure Contact",
      mode: "operations",
    },
    {
      title: "Order Readiness",
      icon: ShoppingCart,
      status: storeEnabled && hasSlug ? "good" : hasSlug ? "warn" : "missing",
      detail: storeEnabled ? "Store live, accepting orders" : hasSlug ? "Store URL set but store is offline" : "Store not live — set URL and enable",
      action: "Go Live",
      mode: "launch",
    },
  ];

  const recommendedActions: RecommendedAction[] = [];
  if (!hasHeroImage) recommendedActions.push({ title: "Add Hero Image", description: "A strong visual doubles engagement", icon: ImageIcon, color: pc, mode: "design", priority: "high" });
  if (!hasTestimonials) recommendedActions.push({ title: "Add Trust Section", description: "Testimonials increase conversion by 12%", icon: Star, color: sc, mode: "merchandising", priority: "high" });
  if (totalCatalog < 3) recommendedActions.push({ title: "Grow Your Catalog", description: "Add high-margin offers to the store", icon: ShoppingBag, color: pc, mode: "catalog", priority: "high" });
  if (!hoursConfigured) recommendedActions.push({ title: "Complete Delivery Setup", description: "Let customers know how to receive orders", icon: Truck, color: sc, mode: "operations", priority: "medium" });
  if (!hasMetaSeo) recommendedActions.push({ title: "Set SEO Metadata", description: "Meta title and description help customers find you", icon: Search, color: sc, mode: "merchandising", priority: "medium" });
  if (policyCompleteness < 100) recommendedActions.push({ title: "Add Store Policies", description: "Return, privacy & terms policies build first-time buyer trust", icon: FileText, color: pc, mode: "merchandising", priority: "medium" });
  if (!storeEnabled) recommendedActions.push({ title: "Launch Your Store", description: "Go live and start taking orders", icon: Zap, color: sc, mode: "launch", priority: "high" });

  const topActions = recommendedActions.slice(0, 4);

  const recentOrders = analytics?.bookings?.inPeriod ?? 0;
  const revenue = analytics?.revenue?.inPeriod ?? null;
  const pageViews = analytics?.storefrontEvents?.page_view ?? null;

  return (
    <div className="space-y-5">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl p-5"
        style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.4)" }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-bold" style={{ color: "hsl(var(--kf-foreground))" }}>Storefront Health</h2>
            <p className="text-[11px] mt-0.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>Overall readiness and quality scores</p>
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-lg" style={{ background: `${pc}12`, color: pc }}>
            Live Score
          </span>
        </div>
        <div className="flex items-center justify-around gap-4">
          <ScoreRing score={healthScore} label="Health Score" color={pc} />
          <div className="h-12 w-px" style={{ background: "hsl(var(--kf-border)/0.3)" }} />
          <ScoreRing score={readinessScore} label="Launch Ready" color={sc} />
          <div className="h-12 w-px" style={{ background: "hsl(var(--kf-border)/0.3)" }} />
          <ScoreRing score={Math.min(trustAssetsCount * 33, 100)} label="Trust Score" color="#a78bfa" />
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="grid grid-cols-3 gap-2"
      >
        <KpiChip label="Live Products" value={liveProducts} icon={Package} color={pc} />
        <KpiChip label="Live Services" value={liveServices} icon={ShoppingBag} color={sc} />
        <KpiChip label="Trust Assets" value={trustAssetsCount} icon={Shield} color="#a78bfa" />
        <KpiChip label="Delivery Methods" value={deliveryMethodsCount} icon={Truck} color={sc} />
        <KpiChip label="Orders (30d)" value={recentOrders} icon={ShoppingCart} color={pc} />
        {revenue != null ? (
          <KpiChip label="Revenue (30d)" value={formatPrice(revenue)} icon={TrendingUp} color={sc} />
        ) : pageViews != null ? (
          <KpiChip label="Store Views" value={pageViews} icon={BarChart3} color={sc} />
        ) : (
          <KpiChip label="Policy Score" value={`${policyCompleteness}%`} icon={FileText} color={sc} />
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="rounded-2xl p-4"
        style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.4)" }}
      >
        <h3 className="text-xs font-bold mb-3 uppercase tracking-wider" style={{ color: "hsl(var(--kf-muted-foreground))" }}>Storefront Status</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {quickCards.map((card) => (
            <StatusCard key={card.title} card={card} onAction={onModeChange} />
          ))}
        </div>
      </motion.div>

      {topActions.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="rounded-2xl p-4"
          style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.4)" }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4" style={{ color: pc }} />
            <h3 className="text-xs font-bold" style={{ color: "hsl(var(--kf-foreground))" }}>Recommended Actions</h3>
          </div>
          <div className="space-y-2">
            {topActions.map((action, i) => {
              const Icon = action.icon;
              return (
                <motion.button
                  key={action.title}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + i * 0.05 }}
                  onClick={() => onModeChange(action.mode)}
                  className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left group transition-all hover:scale-[1.005] min-h-[44px]"
                  style={{ background: `${action.color}08`, border: `1px solid ${action.color}18` }}
                >
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${action.color}15` }}>
                    <Icon className="w-3.5 h-3.5" style={{ color: action.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold leading-tight" style={{ color: "hsl(var(--kf-foreground))" }}>{action.title}</p>
                    <p className="text-[10px] mt-0.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{action.description}</p>
                  </div>
                  <ArrowUpRight className="w-3.5 h-3.5 flex-shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                </motion.button>
              );
            })}
          </div>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-2xl p-4"
        style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.4)" }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
            <h3 className="text-xs font-bold" style={{ color: "hsl(var(--kf-foreground))" }}>Recent Orders</h3>
          </div>
          <div className="flex items-center gap-3">
            {recentOrders > 0 && (
              <span className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                {recentOrders} in 30d{revenue != null ? ` · ${formatPrice(revenue)}` : ""}
              </span>
            )}
            <button
              onClick={() => onModeChange("operations")}
              className="text-[10px] font-medium flex items-center gap-1 transition-opacity hover:opacity-70"
              style={{ color: pc }}
            >
              View All <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>
        <RecentOrdersList businessId={businessId} onViewAll={() => onModeChange("operations")} />
      </motion.div>

      {pageViews != null && pageViews > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
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
