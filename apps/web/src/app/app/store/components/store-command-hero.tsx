"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Globe,
  Copy,
  ExternalLink,
  CheckCircle2,
  MessageCircle,
  Eye,
  ShoppingCart,
  CreditCard,
  CheckCircle,
  ArrowRight,
  Sparkles,
  TrendingUp,
  ShoppingBag,
  Link2,
} from "lucide-react";
import { StoreAnalytics } from "@/lib/client";

interface StoreCommandHeroProps {
  storeEnabled: boolean;
  publicUrl: string;
  servicesCount: number;
  productsCount: number;
  driftedCount: number;
  hasLogo: boolean;
  hasHeroImage: boolean;
  hoursConfigured: boolean;
  hasTestimonials: boolean;
  hasSlug: boolean;
  analytics: StoreAnalytics | null;
  businessName?: string;
  onTabChange: (tab: string) => void;
}

function ReadinessScore({
  hasLogo,
  hasHeroImage,
  hoursConfigured,
  hasTestimonials,
  hasSlug,
  servicesCount,
  productsCount,
}: {
  hasLogo: boolean;
  hasHeroImage: boolean;
  hoursConfigured: boolean;
  hasTestimonials: boolean;
  hasSlug: boolean;
  servicesCount: number;
  productsCount: number;
}) {
  const checks = [
    { label: "Custom URL", done: hasSlug, tab: "settings" },
    { label: "Logo uploaded", done: hasLogo, tab: "customize" },
    { label: "Cover image", done: hasHeroImage, tab: "customize" },
    { label: "Business hours", done: hoursConfigured, tab: "hours" },
    { label: "Products listed", done: servicesCount > 0 || productsCount > 0, tab: "products" },
    { label: "Testimonials", done: hasTestimonials, tab: "settings" },
  ];

  const completed = checks.filter((c) => c.done).length;
  const total = checks.length;
  const pct = Math.round((completed / total) * 100);

  const color =
    pct >= 80
      ? "hsl(142 70% 50%)"
      : pct >= 50
      ? "hsl(var(--kf-accent1))"
      : "hsl(40 90% 55%)";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4" style={{ color }} />
          <span className="text-sm font-semibold">Storefront Readiness</span>
        </div>
        <span className="text-sm font-bold" style={{ color }}>
          {pct}%
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: "hsl(var(--kf-muted)/0.3)" }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {checks.map((check) => (
          <div
            key={check.label}
            className="flex items-center gap-1.5 text-[11px]"
          >
            {check.done ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
            ) : (
              <div className="w-3 h-3 rounded-full border border-muted-foreground/30 flex-shrink-0" />
            )}
            <span className={check.done ? "text-muted-foreground" : "text-muted-foreground/60"}>
              {check.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StoreCommandHero({
  storeEnabled,
  publicUrl,
  servicesCount,
  productsCount,
  driftedCount,
  hasLogo,
  hasHeroImage,
  hoursConfigured,
  hasTestimonials,
  hasSlug,
  analytics,
  businessName,
  onTabChange,
}: StoreCommandHeroProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleWhatsApp() {
    if (!publicUrl) return;
    const text = encodeURIComponent(
      `Check out ${businessName ? businessName + "'s" : "our"} store! Browse & book: ${publicUrl}`
    );
    window.open(`https://wa.me/?text=${text}`, "_blank");
  }

  const funnelData = useMemo(() => {
    if (!analytics) return null;
    const events = analytics.storefrontEvents || {};
    const views = events.page_view ?? 0;
    const carts = events.add_to_cart ?? 0;
    const starts = events.checkout_start ?? 0;
    const completed = events.checkout_complete ?? 0;
    return { views, carts, starts, completed };
  }, [analytics]);

  const funnelSteps = useMemo(() => {
    if (!funnelData) return [];
    const maxVal = Math.max(funnelData.views, 1);
    return [
      { label: "Views", value: funnelData.views, icon: Eye, color: "hsl(220 70% 55%)", pct: 100 },
      { label: "Add to Cart", value: funnelData.carts, icon: ShoppingCart, color: "hsl(280 70% 55%)", pct: Math.round((funnelData.carts / maxVal) * 100) },
      { label: "Checkout", value: funnelData.starts, icon: CreditCard, color: "hsl(var(--kf-accent1))", pct: Math.round((funnelData.starts / maxVal) * 100) },
      { label: "Completed", value: funnelData.completed, icon: CheckCircle, color: "hsl(142 70% 50%)", pct: Math.round((funnelData.completed / maxVal) * 100) },
    ];
  }, [funnelData]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="lg:col-span-2 rounded-2xl overflow-hidden relative"
          style={{
            background: "linear-gradient(135deg, hsl(var(--kf-accent1)/0.1), hsl(var(--kf-accent2)/0.06))",
            border: "1px solid hsl(var(--kf-accent1)/0.15)",
          }}
        >
          <div className="absolute inset-0 opacity-[0.03]" style={{ background: "radial-gradient(ellipse at 20% 0%, hsl(var(--kf-accent1)), transparent 60%)" }} />
          <div className="relative p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Globe className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
                  <h2 className="text-base font-bold">Your Store Link</h2>
                </div>
                <p className="text-xs text-muted-foreground">
                  Share this URL anywhere to get bookings and sales
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{
                    background: storeEnabled ? "hsl(142 70% 50%)" : "hsl(40 90% 55%)",
                    boxShadow: storeEnabled ? "0 0 8px hsl(142 70% 50%/0.5)" : "none",
                  }}
                />
                <span
                  className="text-[11px] font-semibold"
                  style={{ color: storeEnabled ? "hsl(142 70% 55%)" : "hsl(40 90% 60%)" }}
                >
                  {storeEnabled ? "Live" : "Draft"}
                </span>
              </div>
            </div>

            <div
              className="flex items-center gap-2 rounded-xl p-3"
              style={{
                background: "hsl(var(--kf-background)/0.5)",
                border: "1px solid hsl(var(--kf-border)/0.5)",
              }}
            >
              <Link2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <span className="text-sm font-mono text-foreground/80 truncate flex-1">
                {publicUrl || "Set up your custom URL in Settings"}
              </span>
              {publicUrl && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={handleCopy}
                    className="p-1.5 rounded-lg transition-colors hover:bg-muted/50"
                    aria-label="Copy link"
                  >
                    {copied ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Copy className="w-4 h-4 text-muted-foreground" />
                    )}
                  </button>
                  <a
                    href={publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg transition-colors hover:bg-muted/50"
                    aria-label="Open store"
                  >
                    <ExternalLink className="w-4 h-4 text-muted-foreground" />
                  </a>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleCopy}
                disabled={!publicUrl}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all hover:scale-[1.02] disabled:opacity-40 text-white"
                style={{ background: "hsl(var(--kf-accent1))" }}
              >
                {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "Copied!" : "Copy Link"}
              </button>
              <button
                onClick={handleWhatsApp}
                disabled={!publicUrl}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors hover:bg-muted/30 disabled:opacity-40"
                style={{ borderColor: "hsl(var(--kf-border))" }}
              >
                <MessageCircle className="w-3.5 h-3.5 text-emerald-400" />
                WhatsApp
              </button>
              <a
                href={publicUrl || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors hover:bg-muted/30"
                style={{
                  borderColor: "hsl(var(--kf-border))",
                  opacity: publicUrl ? 1 : 0.4,
                  pointerEvents: publicUrl ? "auto" : "none",
                }}
              >
                <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                Preview Store
              </a>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-2xl p-5"
          style={{
            background: "linear-gradient(135deg, hsl(var(--kf-accent2)/0.08), hsl(var(--kf-accent1)/0.04))",
            border: "1px solid hsl(var(--kf-accent2)/0.15)",
          }}
        >
          <ReadinessScore
            hasLogo={hasLogo}
            hasHeroImage={hasHeroImage}
            hoursConfigured={hoursConfigured}
            hasTestimonials={hasTestimonials}
            hasSlug={hasSlug}
            servicesCount={servicesCount}
            productsCount={productsCount}
          />
        </motion.div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "Store Items",
            value: servicesCount,
            icon: ShoppingBag,
            color: "hsl(var(--kf-accent1))",
            bg: "hsl(var(--kf-accent1)/0.08)",
            border: "hsl(var(--kf-accent1)/0.2)",
          },
          {
            label: "Products",
            value: productsCount,
            icon: ShoppingCart,
            color: "hsl(var(--kf-accent2))",
            bg: "hsl(var(--kf-accent2)/0.08)",
            border: "hsl(var(--kf-accent2)/0.2)",
          },
          {
            label: "Total Bookings",
            value: analytics?.bookings?.total ?? 0,
            icon: CheckCircle,
            color: "hsl(142 70% 50%)",
            bg: "hsl(142 70% 50%/0.08)",
            border: "hsl(142 70% 50%/0.2)",
          },
          {
            label: "Page Views",
            value: analytics?.storefrontEvents?.page_view ?? 0,
            icon: Eye,
            color: "hsl(220 70% 55%)",
            bg: "hsl(220 70% 55%/0.08)",
            border: "hsl(220 70% 55%/0.2)",
          },
        ].map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + idx * 0.05 }}
              className="rounded-xl p-4 relative overflow-hidden"
              style={{ background: kpi.bg, border: `1px solid ${kpi.border}` }}
            >
              <div className="absolute inset-0 opacity-[0.04]" style={{ background: `radial-gradient(ellipse at 30% 0%, ${kpi.color}, transparent 60%)` }} />
              <div className="relative">
                <Icon className="w-4 h-4 mb-2" style={{ color: kpi.color }} />
                <p className="text-xl font-bold" style={{ color: kpi.color }}>
                  {typeof kpi.value === "number" ? kpi.value.toLocaleString() : kpi.value}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{kpi.label}</p>
              </div>
            </motion.div>
          );
        })}
      </div>

      {funnelSteps.length > 0 && funnelData && funnelData.views > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="rounded-2xl overflow-hidden"
          style={{
            background: "linear-gradient(135deg, hsl(var(--kf-accent1)/0.06), hsl(var(--kf-accent2)/0.03))",
            border: "1px solid hsl(var(--kf-accent1)/0.12)",
          }}
        >
          <div
            className="px-5 py-3 border-b flex items-center gap-2"
            style={{ borderColor: "hsl(var(--kf-accent1)/0.1)", background: "linear-gradient(135deg, hsl(var(--kf-accent1)/0.04), transparent)" }}
          >
            <TrendingUp className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            <h3 className="text-sm font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>
              Conversion Funnel
            </h3>
          </div>
          <div className="p-5">
            <div className="flex items-end gap-2">
              {funnelSteps.map((step, i) => {
                const Icon = step.icon;
                const barHeight = Math.max(step.pct, 8);
                return (
                  <div key={step.label} className="flex-1 flex flex-col items-center gap-2">
                    <span className="text-sm font-bold" style={{ color: step.color }}>
                      {step.value.toLocaleString()}
                    </span>
                    <motion.div
                      className="w-full rounded-t-lg"
                      style={{ background: step.color, minHeight: "8px" }}
                      initial={{ height: 0 }}
                      animate={{ height: `${barHeight}px` }}
                      transition={{ duration: 0.6, delay: 0.4 + i * 0.1, ease: "easeOut" }}
                    />
                    <div className="flex flex-col items-center gap-0.5">
                      <Icon className="w-3.5 h-3.5" style={{ color: step.color }} />
                      <span className="text-[10px] text-muted-foreground text-center">{step.label}</span>
                    </div>
                    {i < funnelSteps.length - 1 && (
                      <ArrowRight className="w-3 h-3 text-muted-foreground/30 absolute" style={{ display: "none" }} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </motion.div>
      )}

      {driftedCount > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="rounded-xl p-3 flex items-center gap-2 text-sm cursor-pointer hover:bg-[hsl(30_90%_50%/0.12)] transition-colors"
          style={{ background: "hsl(30 90% 50%/0.08)", border: "1px solid hsl(30 90% 50%/0.2)" }}
          onClick={() => onTabChange("products")}
        >
          <span className="w-2 h-2 rounded-full animate-pulse flex-shrink-0" style={{ background: "hsl(30 90% 55%)" }} />
          <span style={{ color: "hsl(30 90% 80%)" }}>
            {driftedCount} item{driftedCount !== 1 ? "s have" : " has"} outdated pricing vs Commerce
          </span>
          <ArrowRight className="w-3.5 h-3.5 ml-auto" style={{ color: "hsl(30 90% 60%)" }} />
        </motion.div>
      )}
    </div>
  );
}
