"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  ShoppingBag,
  Star,
  HelpCircle,
  Search,
  Wand2,
  DollarSign,
  Target,
  BarChart3,
  Layers,
  Zap,
  AlertTriangle,
  CheckCircle2,
  Package,
} from "lucide-react";
import { AccordionGroup, AccordionSection } from "./accordion-section";
import { MerchandisingPanel } from "./merchandising-panel";
import { SocialProofPanel } from "./social-proof-panel";
import { FaqManager } from "./faq-manager";
import { PolicyEditor } from "./policy-editor";
import { AiContentPanel } from "./ai-content-panel";
import { SectionCard } from "@/components/ui/section-card";
import { WorkspaceMetricStrip, type MetricStripItem } from "@/components/ui/workspace-metric-strip";
import { formatPrice } from "@/lib/format";
import type { Service, Product, StorefrontConfig, FaqEntry } from "@/lib/client";
import Image from "next/image";

type SeoProps = {
  storefrontConfig: StorefrontConfig;
  onConfigChange: (section: string, updates: Record<string, any>) => void;
  onSaveConfig: () => Promise<void>;
  configSaving: boolean;
  publicUrl: string;
  businessName?: string;
};

function SeoSettingsInline({ storefrontConfig, onConfigChange, onSaveConfig, configSaving, publicUrl, businessName }: SeoProps) {
  const seo = (storefrontConfig.seo ?? {}) as { metaTitle?: string; metaDescription?: string; ogImage?: string };
  const [previewMode, setPreviewMode] = useState<"google" | "social">("google");

  const previewTitle = seo.metaTitle || businessName || "Your Store";
  const previewDesc = seo.metaDescription || "Browse our products and services. Book online today.";
  const previewUrl = publicUrl || "https://yoursite.com/book/your-store";

  return (
    <div className="space-y-4 pt-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>Meta Title</label>
          <input
            type="text"
            value={seo.metaTitle ?? ""}
            onChange={(e) => onConfigChange("seo", { metaTitle: e.target.value })}
            placeholder={businessName || "Your Store Name"}
            maxLength={60}
            className="w-full rounded-xl px-3.5 py-2.5 text-sm min-h-[44px]"
            style={{ background: "hsl(var(--kf-muted)/0.15)", border: "1px solid hsl(var(--kf-border)/0.3)", color: "hsl(var(--kf-foreground))" }}
          />
          <p className="text-[10px] mt-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{(seo.metaTitle ?? "").length}/60</p>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>OG Image URL</label>
          <input
            type="url"
            value={seo.ogImage ?? ""}
            onChange={(e) => onConfigChange("seo", { ogImage: e.target.value })}
            placeholder="https://example.com/og-image.jpg"
            className="w-full rounded-xl px-3.5 py-2.5 text-sm min-h-[44px]"
            style={{ background: "hsl(var(--kf-muted)/0.15)", border: "1px solid hsl(var(--kf-border)/0.3)", color: "hsl(var(--kf-foreground))" }}
          />
          <p className="text-[10px] mt-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>1200×630px recommended</p>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>Meta Description</label>
        <textarea
          value={seo.metaDescription ?? ""}
          onChange={(e) => onConfigChange("seo", { metaDescription: e.target.value })}
          placeholder="Browse our products and services. Book online today."
          maxLength={160}
          rows={2}
          className="w-full rounded-xl px-3.5 py-2.5 text-sm resize-none"
          style={{ background: "hsl(var(--kf-muted)/0.15)", border: "1px solid hsl(var(--kf-border)/0.3)", color: "hsl(var(--kf-foreground))" }}
        />
        <p className="text-[10px] mt-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{(seo.metaDescription ?? "").length}/160</p>
      </div>
      <div>
        <div className="flex items-center gap-1 mb-2 p-0.5 rounded-lg w-fit" style={{ background: "hsl(var(--kf-muted)/0.1)" }}>
          {(["google", "social"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setPreviewMode(mode)}
              aria-pressed={previewMode === mode}
              className="text-[10px] font-medium px-3 py-1.5 rounded-md transition-all min-h-[32px]"
              style={{
                background: previewMode === mode ? "hsl(var(--kf-card))" : "transparent",
                color: previewMode === mode ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted-foreground))",
                boxShadow: previewMode === mode ? "0 1px 4px hsl(var(--kf-background)/0.3)" : "none",
              }}
            >
              {mode === "google" ? "Google" : "Social"}
            </button>
          ))}
        </div>
        {previewMode === "google" ? (
          <div className="rounded-xl p-3 space-y-0.5" style={{ background: "hsl(var(--kf-muted)/0.08)", border: "1px solid hsl(var(--kf-border)/0.3)" }}>
            <p className="text-sm font-medium truncate" style={{ color: "hsl(var(--kf-accent2))" }}>{previewTitle}</p>
            <p className="text-[10px] truncate" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{previewUrl}</p>
            <p className="text-xs line-clamp-2" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{previewDesc}</p>
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(var(--kf-border)/0.3)" }}>
            <div className="w-full h-[80px] flex items-center justify-center" style={{ background: "hsl(var(--kf-muted)/0.1)" }}>
              {seo.ogImage ? (
                <Image src={seo.ogImage} alt="Social preview" className="w-full h-full object-cover"  fill sizes="(max-width: 768px) 100vw, 50vw" unoptimized />
              ) : (
                <span className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>No OG image</span>
              )}
            </div>
            <div className="p-2.5" style={{ background: "hsl(var(--kf-muted)/0.08)" }}>
              <p className="text-xs font-semibold line-clamp-1" style={{ color: "hsl(var(--kf-foreground))" }}>{previewTitle}</p>
              <p className="text-[10px] line-clamp-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{previewDesc}</p>
            </div>
          </div>
        )}
      </div>
      <div className="flex justify-end">
        <button onClick={onSaveConfig} disabled={configSaving} className="kf-btn-primary min-h-[44px] px-4 text-sm">
          {configSaving ? "Saving..." : "Save SEO"}
        </button>
      </div>
    </div>
  );
}

type Props = {
  businessData: {
    name?: string;
    tagline?: string | null;
    description?: string | null;
    primaryColor?: string | null;
    secondaryColor?: string | null;
  } | null;
  services: Service[];
  commerceProducts: Product[];
  liveProductIds: Set<string>;
  storefrontConfig: StorefrontConfig;
  onConfigChange: (section: string, updates: Record<string, any>) => void;
  onSaveConfig: () => Promise<void>;
  configSaving: boolean;
  publicUrl: string;
  hasTestimonials: boolean;
  activeDeliveryMethodsCount?: number;
};

function PricingSignals({ products, liveProductIds }: { products: Product[]; liveProductIds: Set<string> }) {
  const liveProducts = products.filter((p) => liveProductIds.has(p.id));
  if (liveProducts.length === 0) return null;

  const prices = liveProducts.map((p) => p.price).filter((p) => p > 0);
  if (prices.length === 0) return null;

  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceSpread = maxPrice - minPrice;
  const hasFreeItems = liveProducts.some((p) => p.price === 0);
  const withImages = liveProducts.filter((p) => p.imageUrl).length;
  const withDescriptions = liveProducts.filter((p) => p.description && p.description.length > 20).length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl p-3" style={{ background: "hsl(var(--kf-muted)/0.06)", border: "1px solid hsl(var(--kf-border)/0.25)" }}>
          <p className="text-[10px] font-medium" style={{ color: "hsl(var(--kf-muted-foreground))" }}>Avg Price</p>
          <p className="text-sm font-bold mt-0.5">{formatPrice(avgPrice)}</p>
        </div>
        <div className="rounded-xl p-3" style={{ background: "hsl(var(--kf-muted)/0.06)", border: "1px solid hsl(var(--kf-border)/0.25)" }}>
          <p className="text-[10px] font-medium" style={{ color: "hsl(var(--kf-muted-foreground))" }}>Price Range</p>
          <p className="text-sm font-bold mt-0.5">{formatPrice(minPrice)} – {formatPrice(maxPrice)}</p>
        </div>
        <div className="rounded-xl p-3" style={{ background: "hsl(var(--kf-muted)/0.06)", border: "1px solid hsl(var(--kf-border)/0.25)" }}>
          <p className="text-[10px] font-medium" style={{ color: "hsl(var(--kf-muted-foreground))" }}>Spread</p>
          <p className="text-sm font-bold mt-0.5">{formatPrice(priceSpread)}</p>
        </div>
      </div>

      <div className="space-y-1.5">
        {hasFreeItems && (
          <div className="flex items-center gap-2 text-[11px] px-2 py-1.5 rounded-lg" style={{ background: "hsl(var(--kf-warning)/0.08)", color: "hsl(var(--kf-warning))" }}>
            <DollarSign className="w-3 h-3 flex-shrink-0" />
            Some items have $0 pricing — consider adding prices for better revenue.
          </div>
        )}
        {withImages < liveProducts.length && (
          <div className="flex items-center gap-2 text-[11px] px-2 py-1.5 rounded-lg" style={{ background: "hsl(var(--kf-accent1)/0.08)", color: "hsl(var(--kf-accent1))" }}>
            <Target className="w-3 h-3 flex-shrink-0" />
            {liveProducts.length - withImages} of {liveProducts.length} items missing images — products with images convert 2× better.
          </div>
        )}
        {withDescriptions < liveProducts.length && (
          <div className="flex items-center gap-2 text-[11px] px-2 py-1.5 rounded-lg" style={{ background: "hsl(var(--kf-muted)/0.08)", color: "hsl(var(--kf-muted-foreground))" }}>
            <BarChart3 className="w-3 h-3 flex-shrink-0" />
            {liveProducts.length - withDescriptions} items need longer descriptions to improve discoverability.
          </div>
        )}
      </div>
    </div>
  );
}

function InventoryHealthPanel({ products, liveProductIds }: { products: Product[]; liveProductIds: Set<string> }) {
  const liveProducts = products.filter((p) => liveProductIds.has(p.id));
  if (liveProducts.length === 0) return null;

  const withImages = liveProducts.filter((p) => p.imageUrl).length;
  const withDescriptions = liveProducts.filter((p) => p.description && p.description.length > 20).length;
  const withPrices = liveProducts.filter((p) => p.price > 0).length;
  const total = liveProducts.length;

  const completeness = Math.round(((withImages + withDescriptions + withPrices) / (total * 3)) * 100);

  const checks: { label: string; count: number; total: number; icon: React.ElementType; status: "good" | "warn" | "critical" }[] = [
    { label: "Have images", count: withImages, total, icon: CheckCircle2, status: withImages === total ? "good" : withImages >= total / 2 ? "warn" : "critical" },
    { label: "Have descriptions", count: withDescriptions, total, icon: CheckCircle2, status: withDescriptions === total ? "good" : withDescriptions >= total / 2 ? "warn" : "critical" },
    { label: "Have pricing", count: withPrices, total, icon: CheckCircle2, status: withPrices === total ? "good" : withPrices >= total / 2 ? "warn" : "critical" },
  ];

  const statusColor: Record<string, string> = {
    good: "hsl(var(--kf-success))",
    warn: "hsl(var(--kf-warning))",
    critical: "hsl(var(--kf-error))",
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium" style={{ color: "hsl(var(--kf-foreground))" }}>Catalog Completeness</span>
            <span className="text-xs font-bold" style={{ color: completeness >= 80 ? "hsl(var(--kf-success))" : completeness >= 50 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-error))" }}>{completeness}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "hsl(var(--kf-muted)/0.2)" }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${completeness}%`,
                background: completeness >= 80 ? "hsl(var(--kf-success))" : completeness >= 50 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-error))",
              }}
            />
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        {checks.map((check) => {
          const Icon = check.count === check.total ? CheckCircle2 : AlertTriangle;
          return (
            <div key={check.label} className="flex items-center gap-2 text-[11px]">
              <Icon className="w-3 h-3 flex-shrink-0" style={{ color: statusColor[check.status] }} />
              <span className="flex-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{check.label}</span>
              <span className="font-medium" style={{ color: statusColor[check.status] }}>{check.count}/{check.total}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CrossSellRecommendations({ products, liveProductIds }: { products: Product[]; liveProductIds: Set<string> }) {
  const liveProducts = products.filter((p) => liveProductIds.has(p.id));
  if (liveProducts.length < 2) return null;

  const categories = [...new Set(liveProducts.map((p) => p.category).filter(Boolean))];
  const pricedProducts = liveProducts.filter((p) => p.price > 0);
  const avgPrice = pricedProducts.length > 0 ? pricedProducts.reduce((a, b) => a + b.price, 0) / pricedProducts.length : 0;

  const recommendations: { type: string; title: string; description: string; icon: React.ElementType; color: string }[] = [];

  if (categories.length > 1) {
    recommendations.push({
      type: "cross-sell",
      title: "Cross-Category Bundles",
      description: `You have ${categories.length} categories (${categories.join(", ")}). Consider creating bundles that combine items across categories for a premium offering.`,
      icon: Layers,
      color: "#a78bfa",
    });
  }

  if (pricedProducts.length >= 3) {
    const premium = pricedProducts.filter((p) => p.price > avgPrice * 1.3);
    const budget = pricedProducts.filter((p) => p.price < avgPrice * 0.7);
    if (premium.length > 0 && budget.length > 0) {
      recommendations.push({
        type: "upsell",
        title: "Upsell Opportunity",
        description: `Feature "${premium[0].name}" (${formatPrice(premium[0].price)}) alongside "${budget[0].name}" (${formatPrice(budget[0].price)}) to encourage upgrades. Price anchoring can boost AOV by 15%.`,
        icon: Zap,
        color: "hsl(var(--kf-accent1))",
      });
    }
  }

  const serviceProducts = liveProducts.filter((p) => p.category === "SERVICE");
  const physicalProducts = liveProducts.filter((p) => p.category === "PRODUCT");
  if (serviceProducts.length > 0 && physicalProducts.length > 0) {
    recommendations.push({
      type: "add-on",
      title: "Service + Product Add-ons",
      description: `Recommend "${physicalProducts[0].name}" as an add-on when customers book "${serviceProducts[0].name}". Add-on items can increase order value by 20-35%.`,
      icon: Package,
      color: "#14B8A6",
    });
  }

  if (liveProducts.length >= 4 && recommendations.length === 0) {
    recommendations.push({
      type: "bundle",
      title: "Create a Value Bundle",
      description: `With ${liveProducts.length} items, consider creating a bundle pack at a slight discount. Bundles increase perceived value and average order size.`,
      icon: Layers,
      color: "#a78bfa",
    });
  }

  if (recommendations.length === 0) return null;

  return (
    <div className="space-y-2">
      {recommendations.map((rec) => {
        const Icon = rec.icon;
        return (
          <div
            key={rec.type}
            className="flex items-start gap-2.5 rounded-xl p-3"
            style={{ background: `${rec.color}08`, border: `1px solid ${rec.color}20` }}
          >
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: `${rec.color}15` }}>
              <Icon className="w-3.5 h-3.5" style={{ color: rec.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold" style={{ color: "hsl(var(--kf-foreground))" }}>{rec.title}</p>
              <p className="text-[10px] mt-0.5 leading-relaxed" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{rec.description}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MerchandisingMode({
  businessData,
  services,
  commerceProducts,
  liveProductIds,
  storefrontConfig,
  onConfigChange,
  onSaveConfig,
  configSaving,
  publicUrl,
  hasTestimonials,
  activeDeliveryMethodsCount = 0,
}: Props) {
  const appearance = storefrontConfig.appearance as { primaryColor?: string; secondaryColor?: string } | undefined;
  const pc = appearance?.primaryColor || businessData?.primaryColor || "#F97316";
  const ac = "#a78bfa";

  const testimonials = (storefrontConfig.socialProof as any)?.testimonials ?? [];
  const faqEntries = storefrontConfig.faqEntries ?? [];
  const seo = storefrontConfig.seo as { metaTitle?: string; metaDescription?: string } | undefined;
  const liveItems = commerceProducts.filter((p) => liveProductIds.has(p.id));

  const metrics: MetricStripItem[] = [
    {
      label: "Catalog Items",
      value: liveItems.length,
      icon: ShoppingBag,
      iconColor: pc,
      threshold: { status: liveItems.length >= 3 ? "good" : liveItems.length > 0 ? "warn" : "critical" },
    },
    {
      label: "Testimonials",
      value: testimonials.length,
      icon: Star,
      iconColor: "#eab308",
      threshold: { status: testimonials.length >= 3 ? "good" : testimonials.length > 0 ? "warn" : "critical" },
    },
    {
      label: "FAQ Entries",
      value: faqEntries.length,
      icon: HelpCircle,
      iconColor: "#14B8A6",
    },
    {
      label: "SEO Score",
      value: seo?.metaTitle && seo?.metaDescription ? "Complete" : seo?.metaTitle ? "Partial" : "Missing",
      icon: Search,
      iconColor: ac,
      threshold: { status: seo?.metaTitle && seo?.metaDescription ? "good" : seo?.metaTitle ? "warn" : "critical" },
    },
  ];

  function handleApplyFaq(faqs: { question: string; answer: string; category: string }[]) {
    const existing: FaqEntry[] = storefrontConfig.faqEntries ?? [];
    const newEntries: FaqEntry[] = faqs.map((f, i) => ({
      id: `faq_ai_${Date.now()}_${i}`,
      question: f.question,
      answer: f.answer,
      order: existing.length + i,
    }));
    const merged = [...existing, ...newEntries];
    onConfigChange("faqEntries", merged as any);
  }

  function handleApplySeo(data: { metaTitle: string; metaDescription: string }) {
    onConfigChange("seo", data);
  }

  const merchandisingBadge = (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md" style={{ background: "hsl(var(--kf-muted)/0.2)", color: "hsl(var(--kf-muted-foreground))" }}>
      {commerceProducts.length} items
    </span>
  );
  const socialBadge = hasTestimonials ? (
    <span className="px-1.5 py-0.5 rounded-md text-[9px] font-semibold" style={{ background: "hsl(var(--kf-success)/0.15)", color: "hsl(var(--kf-success))" }}>Added</span>
  ) : undefined;

  return (
    <div className="space-y-4">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <WorkspaceMetricStrip items={metrics} columns={4} compact />
      </motion.div>

      {liveItems.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <SectionCard title="Pricing Intelligence" subtitle="Price distribution and catalog quality signals" icon={DollarSign}>
            <PricingSignals products={commerceProducts} liveProductIds={liveProductIds} />
          </SectionCard>
        </motion.div>
      )}

      {liveItems.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
          <SectionCard title="Inventory Health" subtitle="Catalog completeness and quality indicators" icon={CheckCircle2}>
            <InventoryHealthPanel products={commerceProducts} liveProductIds={liveProductIds} />
          </SectionCard>
        </motion.div>
      )}

      {liveItems.length >= 2 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.11 }}>
          <SectionCard title="Cross-Sell & Upsell" subtitle="AI-powered revenue optimization recommendations" icon={Zap}>
            <CrossSellRecommendations products={commerceProducts} liveProductIds={liveProductIds} />
          </SectionCard>
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }}>
        <AccordionGroup title="Merchandising" brandColor={pc}>
          <AccordionSection title="Featured Items" subtitle="Featured products & display" icon={ShoppingBag} accentColor={pc} badge={merchandisingBadge} defaultOpen>
            <MerchandisingPanel
              config={storefrontConfig}
              products={commerceProducts}
              services={services}
              onConfigChange={onConfigChange}
              onSave={onSaveConfig}
              saving={configSaving}
            />
          </AccordionSection>
          <AccordionSection title="Social Proof" subtitle="Testimonials & reviews" icon={Star} accentColor={pc} badge={socialBadge}>
            <SocialProofPanel
              storefrontConfig={storefrontConfig}
              configSaving={configSaving}
              onConfigChange={onConfigChange}
              onSaveConfig={onSaveConfig}
            />
          </AccordionSection>
          <AccordionSection title="AI Content Intelligence" subtitle="Generate FAQ, SEO, trust copy & launch posts" icon={Wand2} accentColor="hsl(var(--kf-accent1))">
            <AiContentPanel
              storeName={businessData?.name}
              businessDescription={businessData?.description ?? undefined}
              businessTagline={businessData?.tagline ?? undefined}
              productsCount={commerceProducts.length}
              servicesCount={services.length}
              hasDelivery={activeDeliveryMethodsCount > 0}
              testimonialCount={testimonials.length}
              onApplyFaq={handleApplyFaq}
              onApplySeo={handleApplySeo}
            />
          </AccordionSection>
          <AccordionSection title="FAQ & Policies" subtitle="Questions, refund policy & terms" icon={HelpCircle} accentColor={pc}>
            <div className="space-y-4">
              <FaqManager config={storefrontConfig} onConfigChange={onConfigChange} onSave={onSaveConfig} saving={configSaving} />
              <div className="pt-2" style={{ borderTop: "1px solid hsl(var(--kf-border)/0.2)" }}>
                <PolicyEditor config={storefrontConfig} onConfigChange={onConfigChange} onSave={onSaveConfig} saving={configSaving} />
              </div>
            </div>
          </AccordionSection>
          <AccordionSection title="SEO" subtitle="Search engine & social previews" icon={Search} accentColor={ac}>
            <SeoSettingsInline
              storefrontConfig={storefrontConfig}
              onConfigChange={onConfigChange}
              onSaveConfig={onSaveConfig}
              configSaving={configSaving}
              publicUrl={publicUrl}
              businessName={businessData?.name}
            />
          </AccordionSection>
        </AccordionGroup>
      </motion.div>
    </div>
  );
}
