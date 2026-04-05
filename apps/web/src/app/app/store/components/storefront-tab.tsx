"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle, X, Search, Globe, Copy, ExternalLink, Check,
  Rocket, Link2, Palette, Type, LayoutGrid, ShoppingBag, Star,
  HelpCircle, FileText, Settings, Share2,
} from "lucide-react";
import { AccordionSection, AccordionGroup } from "./accordion-section";
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
      <div className="space-y-3">
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
            className="w-full rounded-lg px-3 py-2.5 text-sm min-h-[44px]"
            style={{
              background: "hsl(var(--kf-muted) / 0.3)",
              border: "1px solid hsl(var(--kf-border))",
              color: "hsl(var(--kf-foreground))",
            }}
          />
          <p className="text-[10px] mt-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            {metaTitle.length}/60 characters
          </p>
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
            rows={3}
            className="w-full rounded-lg px-3 py-2.5 text-sm resize-none"
            style={{
              background: "hsl(var(--kf-muted) / 0.3)",
              border: "1px solid hsl(var(--kf-border))",
              color: "hsl(var(--kf-foreground))",
            }}
          />
          <p className="text-[10px] mt-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            {metaDescription.length}/160 characters
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            Social Sharing Image (OG Image URL)
          </label>
          <input
            type="url"
            value={ogImage}
            onChange={(e) => onConfigChange("seo", { ogImage: e.target.value })}
            placeholder="https://example.com/og-image.jpg"
            className="w-full rounded-lg px-3 py-2.5 text-sm min-h-[44px]"
            style={{
              background: "hsl(var(--kf-muted) / 0.3)",
              border: "1px solid hsl(var(--kf-border))",
              color: "hsl(var(--kf-foreground))",
            }}
          />
          <p className="text-[10px] mt-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            Recommended: 1200×630px. Shown when your store is shared on social media.
          </p>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => setPreviewMode("google")}
            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors min-h-[44px]"
            style={{
              background: previewMode === "google" ? "hsl(var(--kf-accent1) / 0.15)" : "transparent",
              color: previewMode === "google" ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted-foreground))",
            }}
          >
            Google Preview
          </button>
          <button
            onClick={() => setPreviewMode("social")}
            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors min-h-[44px]"
            style={{
              background: previewMode === "social" ? "hsl(var(--kf-accent2) / 0.15)" : "transparent",
              color: previewMode === "social" ? "hsl(var(--kf-accent2))" : "hsl(var(--kf-muted-foreground))",
            }}
          >
            Social Preview
          </button>
        </div>

        {previewMode === "google" ? (
          <div
            className="rounded-xl p-4 space-y-1"
            style={{
              background: "hsl(var(--kf-muted) / 0.15)",
              border: "1px solid hsl(var(--kf-border) / 0.5)",
            }}
          >
            <div className="flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
              <span className="text-xs truncate" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                {previewUrl}
              </span>
            </div>
            <p className="text-sm font-medium truncate" style={{ color: "hsl(210 100% 56%)" }}>
              {previewTitle}
            </p>
            <p className="text-xs line-clamp-2" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
              {previewDesc}
            </p>
          </div>
        ) : (
          <div
            className="rounded-xl overflow-hidden"
            style={{ border: "1px solid hsl(var(--kf-border) / 0.5)" }}
          >
            <div
              className="w-full h-[120px] flex items-center justify-center"
              style={{ background: "hsl(var(--kf-muted) / 0.2)" }}
            >
              {ogImage ? (
                <img
                  src={ogImage}
                  alt="Social preview"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <span className="text-xs" style={{ color: "hsl(var(--kf-muted-foreground))" }}>No OG image set</span>
              )}
            </div>
            <div className="p-3 space-y-1" style={{ background: "hsl(var(--kf-muted) / 0.15)" }}>
              <p className="text-[10px] uppercase tracking-wide" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                {previewUrl.replace(/^https?:\/\//, "").split("/")[0]}
              </p>
              <p className="text-sm font-semibold line-clamp-1">{previewTitle}</p>
              <p className="text-xs line-clamp-2" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                {previewDesc}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          onClick={onSaveConfig}
          disabled={configSaving}
          className="kf-btn-primary min-h-[44px] px-4 text-sm"
        >
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
  const [copied, setCopied] = useState(false);

  const handleCopyUrl = useCallback(() => {
    navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [publicUrl]);

  return (
    <div className="space-y-5">
      {!storeEnabled && !bannerDismissed && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          className="flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs"
          style={{
            background: "hsl(var(--kf-warning) / 0.08)",
            border: "1px solid hsl(var(--kf-warning) / 0.25)",
            color: "hsl(var(--kf-warning))",
          }}
        >
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(var(--kf-warning))" }} />
          <span className="flex-1">Your store is unpublished. Toggle it live from the header to make it visible.</span>
          <button
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss unpublished warning"
            className="p-0.5 rounded-md hover:bg-[hsl(40_90%_50%/0.15)] transition-colors flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X className="w-3 h-3" />
          </button>
        </motion.div>
      )}

      <AccordionGroup title="Setup">
        <AccordionSection
          icon={Rocket}
          title="Launch Checklist"
          subtitle="Track what's needed to go live"
          defaultOpen={true}
          accentColor="hsl(var(--kf-success))"
        >
          <ReadinessChecklist
            hasLogo={!!businessData?.logoUrl}
            hasHeroImage={hasHeroImage}
            hoursConfigured={hoursConfigured}
            hasTestimonials={hasTestimonials}
            hasSlug={!!businessData?.slug}
            servicesCount={services.length}
            productsCount={commerceProducts.length}
            onTabChange={onTabChange}
            slug={businessData?.slug || currentSlug}
          />
        </AccordionSection>

        <AccordionSection
          icon={Link2}
          title="Store URL"
          subtitle={currentSlug ? `/${currentSlug}` : "Set your public URL"}
          badge={currentSlug ? (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold" style={{ background: "hsl(var(--kf-success) / 0.15)", color: "hsl(var(--kf-success))" }}>Active</span>
          ) : undefined}
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

      <AccordionGroup title="Design">
        <AccordionSection
          icon={Palette}
          title="Appearance"
          subtitle="Colors, hero image, and branding"
          accentColor="hsl(var(--kf-accent2))"
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
          icon={Type}
          title="Fonts & Branding"
          subtitle="Typography and brand assets"
          accentColor="hsl(var(--kf-accent2))"
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
          icon={LayoutGrid}
          title="Section Layout"
          subtitle="Reorder and toggle storefront sections"
          accentColor="hsl(var(--kf-accent2))"
        >
          <SectionLayoutManager
            config={storefrontConfig}
            onConfigChange={onConfigChange}
            onSave={onSaveConfig}
            saving={configSaving}
          />
        </AccordionSection>
      </AccordionGroup>

      <AccordionGroup title="Content">
        <AccordionSection
          icon={ShoppingBag}
          title="Merchandising"
          subtitle="Featured products and display settings"
          accentColor="hsl(var(--kf-accent1))"
          badge={
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--kf-muted) / 0.3)", color: "hsl(var(--kf-muted-foreground))" }}>
              {commerceProducts.length} items
            </span>
          }
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
          icon={Star}
          title="Social Proof"
          subtitle="Testimonials and customer reviews"
          accentColor="hsl(var(--kf-accent1))"
          badge={hasTestimonials ? (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold" style={{ background: "hsl(var(--kf-success) / 0.15)", color: "hsl(var(--kf-success))" }}>Added</span>
          ) : undefined}
        >
          <SocialProofPanel
            storefrontConfig={storefrontConfig}
            configSaving={configSaving}
            onConfigChange={onConfigChange}
            onSaveConfig={onSaveConfig}
          />
        </AccordionSection>

        <AccordionSection
          icon={HelpCircle}
          title="FAQ"
          subtitle="Frequently asked questions"
          accentColor="hsl(var(--kf-accent1))"
        >
          <FaqManager
            config={storefrontConfig}
            onConfigChange={onConfigChange}
            onSave={onSaveConfig}
            saving={configSaving}
          />
        </AccordionSection>

        <AccordionSection
          icon={FileText}
          title="Policies"
          subtitle="Refund, privacy, delivery, and terms"
          accentColor="hsl(var(--kf-accent1))"
        >
          <PolicyEditor
            config={storefrontConfig}
            onConfigChange={onConfigChange}
            onSave={onSaveConfig}
            saving={configSaving}
          />
        </AccordionSection>
      </AccordionGroup>

      <AccordionGroup title="Settings">
        <AccordionSection
          icon={Search}
          title="SEO"
          subtitle="Search engine optimization and social previews"
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
          icon={Settings}
          title="Store Settings"
          subtitle="Currency, contact info, and preferences"
        >
          <StoreSettingsPanel
            config={storefrontConfig}
            onConfigChange={onConfigChange}
            onSave={onSaveConfig}
            saving={configSaving}
          />
        </AccordionSection>

        {storeEnabled && currentSlug && (
          <AccordionSection
            icon={Share2}
            title="Share Your Store"
            subtitle={publicUrl}
            accentColor="hsl(var(--kf-success))"
          >
            <div className="flex items-center gap-2 pt-1">
              <div
                className="flex-1 rounded-lg px-3 py-2.5 text-xs truncate"
                style={{
                  background: "hsl(var(--kf-muted) / 0.3)",
                  border: "1px solid hsl(var(--kf-border))",
                  color: "hsl(var(--kf-muted-foreground))",
                }}
              >
                {publicUrl}
              </div>
              <button
                onClick={handleCopyUrl}
                className="kf-btn-secondary min-h-[44px] px-4 text-sm flex items-center gap-1.5"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="text-[10px] mt-2" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
              Share this link with customers. View full sharing options including QR code in the header.
            </p>
          </AccordionSection>
        )}
      </AccordionGroup>
    </div>
  );
}
