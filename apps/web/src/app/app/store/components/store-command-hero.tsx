"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  ChevronDown,
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

function ReadinessChecklist({
  hasLogo,
  hasHeroImage,
  hoursConfigured,
  hasTestimonials,
  hasSlug,
  servicesCount,
  productsCount,
  onTabChange,
}: {
  hasLogo: boolean;
  hasHeroImage: boolean;
  hoursConfigured: boolean;
  hasTestimonials: boolean;
  hasSlug: boolean;
  servicesCount: number;
  productsCount: number;
  onTabChange: (tab: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const checks = [
    { label: "Custom URL", hint: "Set a memorable slug for your store", done: hasSlug, tab: "launch" },
    { label: "Logo uploaded", hint: "Add your brand logo in Appearance", done: hasLogo, tab: "design" },
    { label: "Cover image", hint: "Upload a hero image for your storefront", done: hasHeroImage, tab: "design" },
    { label: "Business hours", hint: "Set your operating hours", done: hoursConfigured, tab: "operations" },
    { label: "Products listed", hint: "Add services or products to your catalog", done: servicesCount > 0 || productsCount > 0, tab: "catalog" },
    { label: "Testimonials", hint: "Add social proof from your clients", done: hasTestimonials, tab: "merchandising" },
  ];

  const completed = checks.filter((c) => c.done).length;
  const total = checks.length;
  const pct = Math.round((completed / total) * 100);
  const allDone = completed === total;

  const color =
    pct >= 80
      ? "hsl(142 70% 50%)"
      : pct >= 50
      ? "hsl(var(--kf-accent1))"
      : "hsl(40 90% 55%)";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="rounded-2xl overflow-hidden"
      style={{
        background: "hsl(var(--kf-card))",
        border: "1px solid hsl(var(--kf-border)/0.5)",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full text-left px-4 py-3.5 flex items-center gap-3 transition-colors hover:bg-[hsl(var(--kf-muted)/0.08)]"
      >
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${color}12` }}
        >
          <Sparkles className="w-4 h-4" style={{ color }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-sm font-semibold">Storefront Readiness</span>
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: `${color}15`, color }}
            >
              {completed}/{total}
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(var(--kf-muted)/0.25)" }}>
            <motion.div
              className="h-full rounded-full"
              style={{ background: color }}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          </div>
        </div>

        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="flex-shrink-0"
        >
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div
              className="px-4 pb-3 space-y-0.5"
              style={{ borderTop: "1px solid hsl(var(--kf-border)/0.25)" }}
            >
              {checks.map((check, i) => (
                <motion.button
                  key={check.label}
                  type="button"
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  onClick={() => onTabChange(check.tab)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors hover:bg-[hsl(var(--kf-muted)/0.12)] group"
                >
                  {check.done ? (
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(142 70% 50%)" }} />
                  ) : (
                    <div
                      className="w-4 h-4 rounded-full flex-shrink-0"
                      style={{ border: "1.5px solid hsl(var(--kf-muted-foreground)/0.25)" }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <span
                      className="text-xs font-medium block leading-tight"
                      style={{
                        color: check.done ? "hsl(var(--kf-muted-foreground))" : "hsl(var(--kf-foreground))",
                        textDecoration: check.done ? "line-through" : "none",
                        textDecorationColor: "hsl(var(--kf-muted-foreground)/0.3)",
                      }}
                    >
                      {check.label}
                    </span>
                    {!check.done && (
                      <span className="text-[10px] leading-tight block mt-0.5" style={{ color: "hsl(var(--kf-muted-foreground)/0.5)" }}>
                        {check.hint}
                      </span>
                    )}
                  </div>
                  {!check.done && (
                    <ArrowRight className="w-3.5 h-3.5 flex-shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                  )}
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
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
  const [funnelOpen, setFunnelOpen] = useState(false);

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
    const brandColor = "hsl(var(--kf-accent1))";
    return [
      { label: "Views", value: funnelData.views, icon: Eye, color: brandColor, pct: 100 },
      { label: "Add to Cart", value: funnelData.carts, icon: ShoppingCart, color: brandColor, pct: Math.round((funnelData.carts / maxVal) * 100) },
      { label: "Checkout", value: funnelData.starts, icon: CreditCard, color: brandColor, pct: Math.round((funnelData.starts / maxVal) * 100) },
      { label: "Completed", value: funnelData.completed, icon: CheckCircle, color: "hsl(142 70% 50%)", pct: Math.round((funnelData.completed / maxVal) * 100) },
    ];
  }, [funnelData]);

  return (
    <div className="space-y-3">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl overflow-hidden"
        style={{
          background: "hsl(var(--kf-card))",
          border: "1px solid hsl(var(--kf-border)/0.5)",
        }}
      >
        <div className="p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: "hsl(var(--kf-accent1)/0.1)" }}
              >
                <Globe className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
              </div>
              <div>
                <h2 className="text-sm font-bold leading-tight">Your Store</h2>
                <p className="text-[10px] text-muted-foreground">Share to get bookings & sales</p>
              </div>
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
            className="flex items-center gap-2 rounded-xl px-3 py-2.5"
            style={{
              background: "hsl(var(--kf-background)/0.5)",
              border: "1px solid hsl(var(--kf-border)/0.4)",
            }}
          >
            <Link2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-xs font-mono text-foreground/80 truncate flex-1">
              {publicUrl || "Set up your custom URL in Settings"}
            </span>
            {publicUrl && (
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <button
                  onClick={handleCopy}
                  className="p-1.5 rounded-lg transition-colors hover:bg-[hsl(var(--kf-muted)/0.2)]"
                  aria-label="Copy link"
                >
                  {copied ? (
                    <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "hsl(142 70% 50%)" }} />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                  )}
                </button>
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg transition-colors hover:bg-[hsl(var(--kf-muted)/0.2)]"
                  aria-label="Open store"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                </a>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              disabled={!publicUrl}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all hover:scale-[1.02] disabled:opacity-40 text-white"
              style={{ background: "hsl(var(--kf-accent1))" }}
            >
              {copied ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? "Copied!" : "Copy Link"}
            </button>
            <button
              onClick={handleWhatsApp}
              disabled={!publicUrl}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors hover:bg-[hsl(var(--kf-muted)/0.15)] disabled:opacity-40"
              style={{ borderColor: "hsl(var(--kf-border)/0.6)" }}
            >
              <MessageCircle className="w-3 h-3" style={{ color: "hsl(142 70% 50%)" }} />
              WhatsApp
            </button>
            <a
              href={publicUrl || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors hover:bg-[hsl(var(--kf-muted)/0.15)]"
              style={{
                borderColor: "hsl(var(--kf-border)/0.6)",
                opacity: publicUrl ? 1 : 0.4,
                pointerEvents: publicUrl ? "auto" : "none",
              }}
            >
              <ExternalLink className="w-3 h-3 text-muted-foreground" />
              Preview
            </a>
          </div>
        </div>
      </motion.div>

      {driftedCount > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-xl px-4 py-2.5 flex items-center gap-2.5 cursor-pointer transition-colors hover:bg-[hsl(var(--kf-muted)/0.08)]"
          style={{
            background: "hsl(var(--kf-card))",
            border: "1px solid hsl(var(--kf-border)/0.5)",
          }}
          onClick={() => onTabChange("catalog")}
        >
          <span className="w-2 h-2 rounded-full animate-pulse flex-shrink-0" style={{ background: "hsl(var(--kf-accent1))" }} />
          <span className="text-xs text-muted-foreground flex-1">
            {driftedCount} item{driftedCount !== 1 ? "s have" : " has"} outdated pricing vs Commerce
          </span>
          <ArrowRight className="w-3 h-3 text-muted-foreground" />
        </motion.div>
      )}

      <ReadinessChecklist
        hasLogo={hasLogo}
        hasHeroImage={hasHeroImage}
        hoursConfigured={hoursConfigured}
        hasTestimonials={hasTestimonials}
        hasSlug={hasSlug}
        servicesCount={servicesCount}
        productsCount={productsCount}
        onTabChange={onTabChange}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {[
          { label: "Store Items", value: servicesCount, icon: ShoppingBag },
          { label: "Products", value: productsCount, icon: ShoppingCart },
          { label: "Total Bookings", value: analytics?.bookings?.total ?? 0, icon: CheckCircle },
          { label: "Page Views", value: analytics?.storefrontEvents?.page_view ?? 0, icon: Eye },
        ].map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + idx * 0.04 }}
              className="rounded-xl px-3.5 py-3"
              style={{
                background: "hsl(var(--kf-card))",
                border: "1px solid hsl(var(--kf-border)/0.5)",
              }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <div
                  className="w-6 h-6 rounded-lg flex items-center justify-center"
                  style={{ background: "hsl(var(--kf-accent1)/0.1)" }}
                >
                  <Icon className="w-3 h-3" style={{ color: "hsl(var(--kf-accent1))" }} />
                </div>
                <p className="text-[10px] text-muted-foreground">{kpi.label}</p>
              </div>
              <p className="text-lg font-bold text-foreground pl-0.5">
                {typeof kpi.value === "number" ? kpi.value.toLocaleString() : kpi.value}
              </p>
            </motion.div>
          );
        })}
      </div>

      {funnelSteps.length > 0 && funnelData && funnelData.views > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="rounded-2xl overflow-hidden"
          style={{
            background: "hsl(var(--kf-card))",
            border: "1px solid hsl(var(--kf-border)/0.5)",
          }}
        >
          <button
            onClick={() => setFunnelOpen((prev) => !prev)}
            className="w-full px-4 py-3.5 flex items-center justify-between transition-colors hover:bg-[hsl(var(--kf-muted)/0.08)]"
            aria-expanded={funnelOpen}
            aria-controls="conversion-funnel-panel"
          >
            <div className="flex items-center gap-2.5">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: "hsl(var(--kf-accent1)/0.1)" }}
              >
                <TrendingUp className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
              </div>
              <span className="text-sm font-semibold">Conversion Funnel</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="text-[11px] text-muted-foreground hidden sm:block">
                {funnelData.completed}/{funnelData.views} converted
              </span>
              <motion.div
                animate={{ rotate: funnelOpen ? 180 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              </motion.div>
            </div>
          </button>

          <AnimatePresence initial={false}>
            {funnelOpen && (
              <motion.div
                id="conversion-funnel-panel"
                role="region"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div
                  className="px-4 pb-4 pt-1"
                  style={{ borderTop: "1px solid hsl(var(--kf-border)/0.25)" }}
                >
                  <div className="space-y-2.5 mt-2.5">
                    {funnelSteps.map((step, i) => {
                      const Icon = step.icon;
                      const dropRate =
                        i > 0 && funnelSteps[i - 1].value > 0
                          ? Math.round(
                              ((funnelSteps[i - 1].value - step.value) /
                                funnelSteps[i - 1].value) *
                                100
                            )
                          : null;
                      return (
                        <div key={step.label}>
                          <div className="flex items-center gap-3">
                            <div
                              className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                              style={{ background: `${step.color}12` }}
                            >
                              <Icon className="w-3.5 h-3.5" style={{ color: step.color }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[11px] font-medium text-muted-foreground">
                                  {step.label}
                                </span>
                                <div className="flex items-center gap-2">
                                  {dropRate !== null && dropRate > 0 && (
                                    <span className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground)/0.4)" }}>
                                      −{dropRate}%
                                    </span>
                                  )}
                                  <span
                                    className="text-xs font-bold tabular-nums"
                                    style={{ color: step.color }}
                                  >
                                    {step.value.toLocaleString()}
                                  </span>
                                </div>
                              </div>
                              <div
                                className="h-1.5 rounded-full overflow-hidden"
                                style={{ background: "hsl(var(--kf-muted)/0.2)" }}
                              >
                                <motion.div
                                  className="h-full rounded-full"
                                  style={{ background: step.color }}
                                  initial={{ width: 0 }}
                                  animate={{ width: `${Math.max(step.pct, 2)}%` }}
                                  transition={{
                                    duration: 0.5,
                                    delay: 0.1 + i * 0.08,
                                    ease: "easeOut",
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                          {i < funnelSteps.length - 1 && (
                            <div className="ml-3.5 h-1.5 border-l border-dashed" style={{ borderColor: "hsl(var(--kf-border)/0.2)" }} />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {funnelData.views > 0 && (
                    <div
                      className="mt-3 pt-2.5 flex items-center justify-between text-xs"
                      style={{ borderTop: "1px solid hsl(var(--kf-border)/0.2)" }}
                    >
                      <span className="text-muted-foreground">Overall conversion</span>
                      <span
                        className="font-bold text-sm"
                        style={{ color: "hsl(142 70% 50%)" }}
                      >
                        {((funnelData.completed / funnelData.views) * 100).toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
