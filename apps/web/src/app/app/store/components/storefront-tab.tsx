"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  X,
  Search,
  Globe,
  Rocket,
  Link2,
  Palette,
  Type,
  LayoutGrid,
  ShoppingBag,
  Star,
  HelpCircle,
  Settings,
} from "lucide-react";
import { AccordionGroup, AccordionSection } from "./accordion-section";
import { StoreSettings } from "./store-settings";
import { AppearanceCustomizer } from "./appearance-customizer";
import { StorefrontPreview } from "./storefront-preview";
import { SocialProofPanel } from "./social-proof-panel";
import { MerchandisingPanel } from "./merchandising-panel";
import { ReadinessChecklist } from "./readiness-checklist";
import { SectionLayoutManager } from "./section-layout-manager";
import { FaqManager } from "./faq-manager";
import { PolicyEditor } from "./policy-editor";
import { FontBrandingPanel } from "./font-branding-panel";
import { StoreSettingsPanel } from "./store-settings-panel";
import type { Service, Product, StorefrontConfig } from "@/lib/client";
import Image from "next/image";

type Props = {
  businessId: string;
  storeEnabled: boolean;
  slug: string;
  currentSlug: string | null;
  publicUrl: string;
  onSlugChange: (slug: string) => void;
  onSaveSlug: () => Promise<void>;
  slugSaving: boolean;
  storefrontConfig: StorefrontConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
  onConfigChange: (section: string, updates: Record<string, any>) => void;
  onSaveConfig: () => Promise<void>;
  configSaving: boolean;
  businessData: {
    name?: string;
    slug?: string | null;
    logoUrl?: string | null;
    tagline?: string | null;
    primaryColor?: string | null;
    secondaryColor?: string | null;
  } | null;
  services: Service[];
  commerceProducts: Product[];
  hasHeroImage: boolean;
  hoursConfigured: boolean;
  hasTestimonials: boolean;
  onTabChange: (tab: string) => void;
};

type SeoProps = {
  storefrontConfig: StorefrontConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
  onConfigChange: (section: string, updates: Record<string, any>) => void;
  onSaveConfig: () => Promise<void>;
  configSaving: boolean;
  publicUrl: string;
  businessName?: string;
};

function SeoSettingsInline({ storefrontConfig, onConfigChange, onSaveConfig, configSaving, publicUrl, businessName }: SeoProps) {
  const seo = (storefrontConfig.seo ?? {}) as { metaTitle?: string; metaDescription?: string; ogImage?: string };
  const metaTitle = seo.metaTitle ?? "";
  const metaDescription = seo.metaDescription ?? "";
  const ogImage = seo.ogImage ?? "";
  const [previewMode, setPreviewMode] = useState<"google" | "social">("google");

  const previewTitle = metaTitle || businessName || "Your Store";
  const previewDesc = metaDescription || "Browse our products and services. Book online today.";
  const previewUrl = publicUrl || "https://yoursite.com/book/your-store";

  return (
    <div className="space-y-4 pt-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            Meta Title
          </label>
          <input
            type="text"
            value={metaTitle}
            onChange={(e) => onConfigChange("seo", { metaTitle: e.target.value })}
            placeholder={businessName || "Your Store Name"}
            maxLength={60}
            className="w-full rounded-xl px-3.5 py-2.5 text-sm min-h-[44px]"
            style={{
              background: "hsl(var(--kf-muted) / 0.15)",
              border: "1px solid hsl(var(--kf-border) / 0.3)",
              color: "hsl(var(--kf-foreground))",
            }}
          />
          <p className="text-[10px] mt-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            {metaTitle.length}/60
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            OG Image URL
          </label>
          <input
            type="url"
            value={ogImage}
            onChange={(e) => onConfigChange("seo", { ogImage: e.target.value })}
            placeholder="https://example.com/og-image.jpg"
            className="w-full rounded-xl px-3.5 py-2.5 text-sm min-h-[44px]"
            style={{
              background: "hsl(var(--kf-muted) / 0.15)",
              border: "1px solid hsl(var(--kf-border) / 0.3)",
              color: "hsl(var(--kf-foreground))",
            }}
          />
          <p className="text-[10px] mt-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            1200×630px recommended
          </p>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
          Meta Description
        </label>
        <textarea
          value={metaDescription}
          onChange={(e) => onConfigChange("seo", { metaDescription: e.target.value })}
          placeholder="Browse our products and services. Book online today."
          maxLength={160}
          rows={2}
          className="w-full rounded-xl px-3.5 py-2.5 text-sm resize-none"
          style={{
            background: "hsl(var(--kf-muted) / 0.15)",
            border: "1px solid hsl(var(--kf-border) / 0.3)",
            color: "hsl(var(--kf-foreground))",
          }}
        />
        <p className="text-[10px] mt-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
          {metaDescription.length}/160
        </p>
      </div>

      <div>
        <div className="flex items-center gap-1 mb-2 p-0.5 rounded-lg w-fit" style={{ background: "hsl(var(--kf-muted) / 0.1)" }}>
          {(["google", "social"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setPreviewMode(mode)}
              aria-pressed={previewMode === mode}
              className="text-[10px] font-medium px-3 py-1.5 rounded-md transition-all min-h-[32px]"
              style={{
                background: previewMode === mode ? "hsl(var(--kf-card))" : "transparent",
                color: previewMode === mode ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted-foreground))",
                boxShadow: previewMode === mode ? "0 1px 4px hsl(var(--kf-background) / 0.3)" : "none",
              }}
            >
              {mode === "google" ? "Google" : "Social"}
            </button>
          ))}
        </div>

        {previewMode === "google" ? (
          <div className="rounded-xl p-3 space-y-0.5" style={{ background: "hsl(var(--kf-muted) / 0.08)", border: "1px solid hsl(var(--kf-border) / 0.3)" }}>
            <div className="flex items-center gap-1.5">
              <Globe className="w-3 h-3" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
              <span className="text-[10px] truncate" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{previewUrl}</span>
            </div>
            <p className="text-sm font-medium truncate" style={{ color: "hsl(var(--kf-accent2))" }}>{previewTitle}</p>
            <p className="text-xs line-clamp-2" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{previewDesc}</p>
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(var(--kf-border) / 0.3)" }}>
            <div className="w-full h-[80px] flex items-center justify-center" style={{ background: "hsl(var(--kf-muted) / 0.1)" }}>
              {ogImage ? (
                <Image src={ogImage} alt="Social preview" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}  fill sizes="(max-width: 768px) 100vw, 50vw" unoptimized />
              ) : (
                <span className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>No OG image</span>
              )}
            </div>
            <div className="p-2.5 space-y-0.5" style={{ background: "hsl(var(--kf-muted) / 0.08)" }}>
              <p className="text-[9px] uppercase tracking-wide" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{previewUrl.replace(/^https?:\/\//, "").split("/")[0]}</p>
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

export function StorefrontTab({
  businessId,
  storeEnabled,
  slug,
  currentSlug,
  publicUrl,
  onSlugChange,
  onSaveSlug,
  slugSaving,
  storefrontConfig,
  onConfigChange,
  onSaveConfig,
  configSaving,
  businessData,
  services,
  commerceProducts,
  hasHeroImage,
  hoursConfigured,
  hasTestimonials,
  onTabChange,
}: Props) {
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const appearance = storefrontConfig.appearance as { primaryColor?: string; secondaryColor?: string; accentColor?: string } | undefined;
  const pc = appearance?.primaryColor || businessData?.primaryColor || "#F97316";
  const sc = appearance?.secondaryColor || businessData?.secondaryColor || "#14B8A6";
  const ac = appearance?.accentColor || "#a78bfa";

  const urlBadge = currentSlug ? (
    <span className="px-1.5 py-0.5 rounded-md text-[9px] font-semibold" style={{ background: "hsl(var(--kf-success) / 0.15)", color: "hsl(var(--kf-success))" }}>Active</span>
  ) : undefined;

  const merchandisingBadge = (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md" style={{ background: "hsl(var(--kf-muted) / 0.2)", color: "hsl(var(--kf-muted-foreground))" }}>
      {commerceProducts.length} items
    </span>
  );

  const socialBadge = hasTestimonials ? (
    <span className="px-1.5 py-0.5 rounded-md text-[9px] font-semibold" style={{ background: "hsl(var(--kf-success) / 0.15)", color: "hsl(var(--kf-success))" }}>Added</span>
  ) : undefined;

  return (
    <div className="space-y-5">
      {!storeEnabled && !bannerDismissed && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="flex items-center gap-3 rounded-xl px-4 py-3 text-xs"
          style={{
            background: "linear-gradient(135deg, hsl(var(--kf-warning) / 0.08), hsl(var(--kf-warning) / 0.04))",
            border: "1px solid hsl(var(--kf-warning) / 0.2)",
            color: "hsl(var(--kf-warning))",
          }}
        >
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "hsl(var(--kf-warning) / 0.15)" }}>
            <AlertCircle className="w-3.5 h-3.5" />
          </div>
          <span className="flex-1 font-medium">Your store is unpublished. Toggle it live from the header to make it visible to customers.</span>
          <button
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss"
            className="p-1 rounded-lg transition-colors flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </motion.div>
      )}

      <AccordionGroup title="Launch" brandColor={pc}>
        <AccordionSection
          title="Launch Checklist"
          subtitle="Track what's needed to go live"
          icon={Rocket}
          accentColor="hsl(var(--kf-success))"
          defaultOpen
        >
          <ReadinessChecklist
            hasLogo={!!businessData?.logoUrl}
            hasHeroImage={hasHeroImage}
            hoursConfigured={hoursConfigured}
            hasTestimonials={hasTestimonials}
            hasSlug={!!businessData?.slug}
            servicesCount={services.length}
            productsCount={commerceProducts.length}
            storeEnabled={storeEnabled}
            onTabChange={onTabChange}
            slug={businessData?.slug ?? currentSlug ?? undefined}
          />
        </AccordionSection>
        <AccordionSection
          title="Store URL & QR Code"
          subtitle="Set your link and generate a scannable QR"
          icon={Link2}
          accentColor={pc}
          badge={urlBadge}
        >
          <StoreSettings
            businessId={businessId}
            slug={slug}
            currentSlug={currentSlug}
            publicUrl={publicUrl}
            onSlugChange={onSlugChange}
            onSaveSlug={onSaveSlug}
            slugSaving={slugSaving}
          />
        </AccordionSection>
      </AccordionGroup>

      <AccordionGroup title="Design" brandColor={sc}>
        <AccordionSection
          title="Appearance"
          subtitle="Theme, colors, hero image & branding"
          icon={Palette}
          accentColor={sc}
        >
          <div className="space-y-4">
            <AppearanceCustomizer
              config={storefrontConfig}
              onConfigChange={onConfigChange}
              onSave={onSaveConfig}
              saving={configSaving}
              businessData={businessData}
            />
            <StorefrontPreview
              businessData={businessData}
              services={services}
              commerceProducts={commerceProducts}
              config={storefrontConfig}
              slug={slug}
            />
          </div>
        </AccordionSection>
        <AccordionSection
          title="Typography"
          subtitle="Fonts & type pairing"
          icon={Type}
          accentColor={sc}
        >
          <FontBrandingPanel
            config={storefrontConfig}
            onConfigChange={onConfigChange}
            onSave={onSaveConfig}
            saving={configSaving}
            businessData={businessData}
          />
        </AccordionSection>
        <AccordionSection
          title="Section Layout"
          subtitle="Reorder & toggle sections"
          icon={LayoutGrid}
          accentColor={sc}
        >
          <SectionLayoutManager
            config={storefrontConfig}
            onConfigChange={onConfigChange}
            onSave={onSaveConfig}
            saving={configSaving}
          />
        </AccordionSection>
      </AccordionGroup>

      <AccordionGroup title="Content" brandColor={pc}>
        <AccordionSection
          title="Merchandising"
          subtitle="Featured products & display"
          icon={ShoppingBag}
          accentColor={pc}
          badge={merchandisingBadge}
        >
          <MerchandisingPanel
            config={storefrontConfig}
            products={commerceProducts}
            services={services}
            onConfigChange={onConfigChange}
            onSave={onSaveConfig}
            saving={configSaving}
          />
        </AccordionSection>
        <AccordionSection
          title="Social Proof"
          subtitle="Testimonials & reviews"
          icon={Star}
          accentColor={pc}
          badge={socialBadge}
        >
          <SocialProofPanel
            storefrontConfig={storefrontConfig}
            configSaving={configSaving}
            onConfigChange={onConfigChange}
            onSaveConfig={onSaveConfig}
          />
        </AccordionSection>
        <AccordionSection
          title="FAQ & Policies"
          subtitle="Questions, refund policy & terms"
          icon={HelpCircle}
          accentColor={pc}
        >
          <div className="space-y-4">
            <FaqManager
              config={storefrontConfig}
              onConfigChange={onConfigChange}
              onSave={onSaveConfig}
              saving={configSaving}
            />
            <div className="pt-2" style={{ borderTop: "1px solid hsl(var(--kf-border) / 0.2)" }}>
              <PolicyEditor
                config={storefrontConfig}
                onConfigChange={onConfigChange}
                onSave={onSaveConfig}
                saving={configSaving}
              />
            </div>
          </div>
        </AccordionSection>
      </AccordionGroup>

      <AccordionGroup title="Settings" brandColor={ac}>
        <AccordionSection
          title="SEO"
          subtitle="Search engine & social previews"
          icon={Search}
          accentColor={ac}
        >
          <SeoSettingsInline
            storefrontConfig={storefrontConfig}
            onConfigChange={onConfigChange}
            onSaveConfig={onSaveConfig}
            configSaving={configSaving}
            publicUrl={publicUrl}
            businessName={businessData?.name}
          />
        </AccordionSection>
        <AccordionSection
          title="Store Settings"
          subtitle="Currency, delivery & contact"
          icon={Settings}
          accentColor={ac}
        >
          <StoreSettingsPanel
            config={storefrontConfig}
            onConfigChange={onConfigChange}
            onSave={onSaveConfig}
            saving={configSaving}
          />
        </AccordionSection>
      </AccordionGroup>
    </div>
  );
}
