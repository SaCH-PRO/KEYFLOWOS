"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertCircle, X, Search, Globe, Copy, ExternalLink, Check,
  Rocket, Link2, Palette, Type, LayoutGrid, ShoppingBag, Star,
  HelpCircle, FileText, Settings, Share2, ChevronRight,
  Sparkles, Eye, Zap,
} from "lucide-react";
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

type SectionId = "checklist" | "url" | "appearance" | "fonts" | "layout" | "merchandising" | "social" | "faq" | "policies" | "seo" | "settings" | "share";

const SECTION_CARDS: {
  id: SectionId;
  icon: React.ElementType;
  title: string;
  description: string;
  color: string;
  group: string;
}[] = [
  { id: "checklist", icon: Rocket, title: "Launch Checklist", description: "Track what's needed to go live", color: "--kf-success", group: "setup" },
  { id: "url", icon: Link2, title: "Store URL", description: "Set your public storefront link", color: "--kf-accent1", group: "setup" },
  { id: "appearance", icon: Palette, title: "Appearance", description: "Colors, hero image & branding", color: "--kf-accent2", group: "design" },
  { id: "fonts", icon: Type, title: "Typography", description: "Fonts & brand assets", color: "--kf-accent2", group: "design" },
  { id: "layout", icon: LayoutGrid, title: "Section Layout", description: "Reorder & toggle sections", color: "--kf-accent2", group: "design" },
  { id: "merchandising", icon: ShoppingBag, title: "Merchandising", description: "Featured products & display", color: "--kf-accent1", group: "content" },
  { id: "social", icon: Star, title: "Social Proof", description: "Testimonials & reviews", color: "--kf-accent1", group: "content" },
  { id: "faq", icon: HelpCircle, title: "FAQ", description: "Frequently asked questions", color: "--kf-accent1", group: "content" },
  { id: "policies", icon: FileText, title: "Policies", description: "Refund, privacy & terms", color: "--kf-accent1", group: "content" },
  { id: "seo", icon: Search, title: "SEO", description: "Search engine & social previews", color: "--kf-info", group: "settings" },
  { id: "settings", icon: Settings, title: "Store Settings", description: "Currency, contact & preferences", color: "--kf-muted-foreground", group: "settings" },
];

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
            className="w-full rounded-xl px-3.5 py-2.5 text-sm min-h-[44px]"
            style={{
              background: "hsl(var(--kf-muted) / 0.15)",
              border: "1px solid hsl(var(--kf-border) / 0.3)",
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
            className="w-full rounded-xl px-3.5 py-2.5 text-sm resize-none"
            style={{
              background: "hsl(var(--kf-muted) / 0.15)",
              border: "1px solid hsl(var(--kf-border) / 0.3)",
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
            className="w-full rounded-xl px-3.5 py-2.5 text-sm min-h-[44px]"
            style={{
              background: "hsl(var(--kf-muted) / 0.15)",
              border: "1px solid hsl(var(--kf-border) / 0.3)",
              color: "hsl(var(--kf-foreground))",
            }}
          />
          <p className="text-[10px] mt-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            Recommended: 1200×630px. Shown when your store is shared on social media.
          </p>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-1 mb-3 p-1 rounded-lg w-fit" style={{ background: "hsl(var(--kf-muted) / 0.1)" }}>
          <button
            onClick={() => setPreviewMode("google")}
            className="text-xs font-medium px-3 py-1.5 rounded-md transition-all"
            style={{
              background: previewMode === "google" ? "hsl(var(--kf-card))" : "transparent",
              color: previewMode === "google" ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted-foreground))",
              boxShadow: previewMode === "google" ? "0 1px 4px hsl(var(--kf-background) / 0.3)" : "none",
            }}
          >
            Google Preview
          </button>
          <button
            onClick={() => setPreviewMode("social")}
            className="text-xs font-medium px-3 py-1.5 rounded-md transition-all"
            style={{
              background: previewMode === "social" ? "hsl(var(--kf-card))" : "transparent",
              color: previewMode === "social" ? "hsl(var(--kf-accent2))" : "hsl(var(--kf-muted-foreground))",
              boxShadow: previewMode === "social" ? "0 1px 4px hsl(var(--kf-background) / 0.3)" : "none",
            }}
          >
            Social Preview
          </button>
        </div>

        {previewMode === "google" ? (
          <div
            className="rounded-xl p-4 space-y-1"
            style={{
              background: "hsl(var(--kf-muted) / 0.08)",
              border: "1px solid hsl(var(--kf-border) / 0.3)",
            }}
          >
            <div className="flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
              <span className="text-xs truncate" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                {previewUrl}
              </span>
            </div>
            <p className="text-sm font-medium truncate" style={{ color: "hsl(var(--kf-accent2))" }}>
              {previewTitle}
            </p>
            <p className="text-xs line-clamp-2" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
              {previewDesc}
            </p>
          </div>
        ) : (
          <div
            className="rounded-xl overflow-hidden"
            style={{ border: "1px solid hsl(var(--kf-border) / 0.3)" }}
          >
            <div
              className="w-full h-[120px] flex items-center justify-center"
              style={{ background: "hsl(var(--kf-muted) / 0.1)" }}
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
            <div className="p-3 space-y-1" style={{ background: "hsl(var(--kf-muted) / 0.08)" }}>
              <p className="text-[10px] uppercase tracking-wide" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                {previewUrl.replace(/^https?:\/\//, "").split("/")[0]}
              </p>
              <p className="text-sm font-semibold line-clamp-1" style={{ color: "hsl(var(--kf-foreground))" }}>{previewTitle}</p>
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

function SectionCard({ card, isOpen, badge, onToggle }: {
  card: typeof SECTION_CARDS[0];
  isOpen: boolean;
  badge?: React.ReactNode;
  onToggle: () => void;
}) {
  const Icon = card.icon;
  return (
    <button
      onClick={onToggle}
      className="w-full text-left rounded-xl p-4 transition-all group min-h-[44px]"
      style={{
        background: isOpen
          ? `hsl(var(${card.color}) / 0.08)`
          : "hsl(var(--kf-card) / 0.6)",
        border: isOpen
          ? `1px solid hsl(var(${card.color}) / 0.2)`
          : "1px solid hsl(var(--kf-border) / 0.12)",
      }}
      aria-expanded={isOpen}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all"
          style={{
            background: `hsl(var(${card.color}) / ${isOpen ? "0.2" : "0.1"})`,
          }}
        >
          <Icon className="w-4 h-4" style={{ color: `hsl(var(${card.color}))` }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium" style={{ color: "hsl(var(--kf-foreground))" }}>
              {card.title}
            </span>
            {badge}
          </div>
          <span className="text-[11px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            {card.description}
          </span>
        </div>
        <ChevronRight
          className="w-4 h-4 transition-transform flex-shrink-0"
          style={{
            color: "hsl(var(--kf-muted-foreground))",
            transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
          }}
        />
      </div>
    </button>
  );
}

function SectionGroup({ title, icon: Icon, children, color }: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  color: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5 px-1">
        <div
          className="w-6 h-6 rounded-lg flex items-center justify-center"
          style={{ background: `hsl(var(${color}) / 0.1)` }}
        >
          <Icon className="w-3 h-3" style={{ color: `hsl(var(${color}))` }} />
        </div>
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: `hsl(var(${color}) / 0.7)` }}
        >
          {title}
        </span>
        <div className="flex-1 h-px" style={{ background: `hsl(var(${color}) / 0.1)` }} />
      </div>
      {children}
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
  const [openSection, setOpenSection] = useState<SectionId | null>("checklist");
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyUrl = useCallback(() => {
    navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [publicUrl]);

  const toggleSection = useCallback((id: SectionId) => {
    setOpenSection(prev => prev === id ? null : id);
  }, []);

  const renderContent = (id: SectionId) => {
    switch (id) {
      case "checklist":
        return (
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
        );
      case "url":
        return (
          <StoreSettings
            businessId={businessId}
            slug={slug}
            currentSlug={currentSlug}
            publicUrl={publicUrl}
            onSlugChange={onSlugChange}
            onSaveSlug={onSaveSlug}
            slugSaving={slugSaving}
          />
        );
      case "appearance":
        return (
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
        );
      case "fonts":
        return (
          <FontBrandingPanel
            config={storefrontConfig}
            onConfigChange={onConfigChange}
            onSave={onSaveConfig}
            saving={configSaving}
            businessData={businessData}
          />
        );
      case "layout":
        return (
          <SectionLayoutManager
            config={storefrontConfig}
            onConfigChange={onConfigChange}
            onSave={onSaveConfig}
            saving={configSaving}
          />
        );
      case "merchandising":
        return (
          <MerchandisingPanel
            config={storefrontConfig}
            products={commerceProducts}
            services={services}
            onConfigChange={onConfigChange}
            onSave={onSaveConfig}
            saving={configSaving}
          />
        );
      case "social":
        return (
          <SocialProofPanel
            storefrontConfig={storefrontConfig}
            configSaving={configSaving}
            onConfigChange={onConfigChange}
            onSaveConfig={onSaveConfig}
          />
        );
      case "faq":
        return (
          <FaqManager
            config={storefrontConfig}
            onConfigChange={onConfigChange}
            onSave={onSaveConfig}
            saving={configSaving}
          />
        );
      case "policies":
        return (
          <PolicyEditor
            config={storefrontConfig}
            onConfigChange={onConfigChange}
            onSave={onSaveConfig}
            saving={configSaving}
          />
        );
      case "seo":
        return (
          <SeoSettingsInline
            storefrontConfig={storefrontConfig}
            onConfigChange={onConfigChange}
            onSaveConfig={onSaveConfig}
            configSaving={configSaving}
            publicUrl={publicUrl}
            businessName={businessData?.name}
          />
        );
      case "settings":
        return (
          <StoreSettingsPanel
            config={storefrontConfig}
            onConfigChange={onConfigChange}
            onSave={onSaveConfig}
            saving={configSaving}
          />
        );
      case "share":
        return (
          <div className="flex items-center gap-2 pt-1">
            <div
              className="flex-1 rounded-xl px-3.5 py-2.5 text-xs truncate font-mono"
              style={{
                background: "hsl(var(--kf-muted) / 0.15)",
                border: "1px solid hsl(var(--kf-border) / 0.3)",
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
        );
      default:
        return null;
    }
  };

  const getBadge = (id: SectionId) => {
    switch (id) {
      case "url":
        return currentSlug ? (
          <span className="px-1.5 py-0.5 rounded-md text-[9px] font-semibold" style={{ background: "hsl(var(--kf-success) / 0.15)", color: "hsl(var(--kf-success))" }}>Active</span>
        ) : null;
      case "merchandising":
        return (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md" style={{ background: "hsl(var(--kf-muted) / 0.2)", color: "hsl(var(--kf-muted-foreground))" }}>
            {commerceProducts.length} items
          </span>
        );
      case "social":
        return hasTestimonials ? (
          <span className="px-1.5 py-0.5 rounded-md text-[9px] font-semibold" style={{ background: "hsl(var(--kf-success) / 0.15)", color: "hsl(var(--kf-success))" }}>Added</span>
        ) : null;
      default:
        return null;
    }
  };

  const setupCards = SECTION_CARDS.filter(c => c.group === "setup");
  const designCards = SECTION_CARDS.filter(c => c.group === "design");
  const contentCards = SECTION_CARDS.filter(c => c.group === "content");
  const settingsCards = SECTION_CARDS.filter(c => c.group === "settings");

  const shareCard = storeEnabled && currentSlug ? {
    id: "share" as SectionId,
    icon: Share2,
    title: "Share Your Store",
    description: publicUrl,
    color: "--kf-success",
    group: "settings",
  } : null;

  return (
    <div className="space-y-6">
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
            <AlertCircle className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-warning))" }} />
          </div>
          <span className="flex-1 font-medium">Your store is unpublished. Toggle it live from the header to make it visible to customers.</span>
          <button
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss unpublished warning"
            className="p-1 rounded-lg transition-colors flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
            style={{ color: "hsl(var(--kf-warning))" }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </motion.div>
      )}

      <SectionGroup title="Setup" icon={Zap} color="--kf-success">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {setupCards.map(card => (
            <div key={card.id}>
              <SectionCard card={card} isOpen={openSection === card.id} badge={getBadge(card.id)} onToggle={() => toggleSection(card.id)} />
              <AnimatePresence>
                {openSection === card.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div
                      className="p-4 mt-1 rounded-xl"
                      style={{
                        background: "hsl(var(--kf-card) / 0.8)",
                        border: "1px solid hsl(var(--kf-border) / 0.15)",
                      }}
                    >
                      {renderContent(card.id)}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </SectionGroup>

      <SectionGroup title="Design" icon={Palette} color="--kf-accent2">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {designCards.map(card => (
            <div key={card.id}>
              <SectionCard card={card} isOpen={openSection === card.id} badge={getBadge(card.id)} onToggle={() => toggleSection(card.id)} />
              <AnimatePresence>
                {openSection === card.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div
                      className="p-4 mt-1 rounded-xl"
                      style={{
                        background: "hsl(var(--kf-card) / 0.8)",
                        border: "1px solid hsl(var(--kf-border) / 0.15)",
                      }}
                    >
                      {renderContent(card.id)}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </SectionGroup>

      <SectionGroup title="Content" icon={Sparkles} color="--kf-accent1">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {contentCards.map(card => (
            <div key={card.id}>
              <SectionCard card={card} isOpen={openSection === card.id} badge={getBadge(card.id)} onToggle={() => toggleSection(card.id)} />
              <AnimatePresence>
                {openSection === card.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div
                      className="p-4 mt-1 rounded-xl"
                      style={{
                        background: "hsl(var(--kf-card) / 0.8)",
                        border: "1px solid hsl(var(--kf-border) / 0.15)",
                      }}
                    >
                      {renderContent(card.id)}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </SectionGroup>

      <SectionGroup title="Settings" icon={Settings} color="--kf-muted-foreground">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[...settingsCards, ...(shareCard ? [shareCard] : [])].map(card => (
            <div key={card.id}>
              <SectionCard card={card} isOpen={openSection === card.id} badge={getBadge(card.id)} onToggle={() => toggleSection(card.id)} />
              <AnimatePresence>
                {openSection === card.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div
                      className="p-4 mt-1 rounded-xl"
                      style={{
                        background: "hsl(var(--kf-card) / 0.8)",
                        border: "1px solid hsl(var(--kf-border) / 0.15)",
                      }}
                    >
                      {renderContent(card.id)}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </SectionGroup>
    </div>
  );
}
