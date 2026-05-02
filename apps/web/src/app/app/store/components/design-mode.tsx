"use client";

import { useState } from "react";
import { Palette, Type, LayoutGrid, Monitor, Smartphone, Columns, Wand2 } from "lucide-react";
import { AccordionGroup, AccordionSection } from "./accordion-section";
import { AppearanceCustomizer } from "./appearance-customizer";
import { StorefrontPreview } from "./storefront-preview";
import { FontBrandingPanel } from "./font-branding-panel";
import { SectionLayoutManager } from "./section-layout-manager";
import { AiHeroCopyPanel } from "./ai-hero-copy-panel";
import type { Service, Product, StorefrontConfig } from "@/lib/client";

type Props = {
  businessData: {
    name?: string;
    slug?: string | null;
    logoUrl?: string | null;
    tagline?: string | null;
    description?: string | null;
    primaryColor?: string | null;
    secondaryColor?: string | null;
  } | null;
  services: Service[];
  commerceProducts: Product[];
  storefrontConfig: StorefrontConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
  onConfigChange: (section: string, updates: Record<string, any>) => void;
  onSaveConfig: () => Promise<void>;
  configSaving: boolean;
  slug: string;
};

export function DesignMode({
  businessData,
  services,
  commerceProducts,
  storefrontConfig,
  onConfigChange,
  onSaveConfig,
  configSaving,
  slug,
}: Props) {
  const appearance = storefrontConfig.appearance as { primaryColor?: string; secondaryColor?: string } | undefined;
  const sc = appearance?.secondaryColor || businessData?.secondaryColor || "#14B8A6";
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile" | "both">("mobile");

  const previewOptions: { key: "mobile" | "desktop" | "both"; icon: React.ElementType; label: string }[] = [
    { key: "mobile", icon: Smartphone, label: "Mobile" },
    { key: "desktop", icon: Monitor, label: "Desktop" },
    { key: "both", icon: Columns, label: "Side by side" },
  ];

  function handleApplyHeroCopy(fields: { headline?: string; subheadline?: string; ctaText?: string; ribbonText?: string }) {
    const updates: Record<string, string> = {};
    if (fields.headline) updates.headline = fields.headline;
    if (fields.subheadline) updates.subheadline = fields.subheadline;
    if (fields.ctaText) updates.ctaLabel = fields.ctaText;
    if (fields.ribbonText) updates.ribbonText = fields.ribbonText;
    onConfigChange("hero", updates);
  }

  return (
    <div className="space-y-5">
      <AccordionGroup title="Design" brandColor={sc}>
        <AccordionSection
          title="Appearance"
          subtitle="Theme, colors, hero image & branding"
          icon={Palette}
          accentColor={sc}
          defaultOpen
        >
          <div className="space-y-4">
            <AppearanceCustomizer
              config={storefrontConfig}
              onConfigChange={onConfigChange}
              onSave={onSaveConfig}
              saving={configSaving}
              businessData={businessData}
            />

            <div className="flex items-center justify-between">
              <p className="text-[11px] text-muted-foreground font-medium">Preview</p>
              <div
                className="flex items-center gap-0.5 p-1 rounded-xl"
                style={{ background: "hsl(var(--kf-muted)/0.2)", border: "1px solid hsl(var(--kf-border)/0.4)" }}
              >
                {previewOptions.map(({ key, icon: Icon, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPreviewMode(key)}
                    className="p-1.5 rounded-lg transition-all"
                    style={{ background: previewMode === key ? "hsl(var(--kf-card))" : "transparent" }}
                    title={label}
                  >
                    <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>

            <StorefrontPreview
              businessData={businessData}
              services={services}
              commerceProducts={commerceProducts}
              config={storefrontConfig}
              slug={slug}
              previewMode={previewMode}
            />
          </div>
        </AccordionSection>
        <AccordionSection
          title="AI Hero Copy"
          subtitle="Generate headline, subheadline, ribbon & CTA with AI"
          icon={Wand2}
          accentColor="hsl(var(--kf-accent1))"
        >
          <AiHeroCopyPanel
            storeName={businessData?.name}
            businessDescription={businessData?.description ?? undefined}
            businessTagline={businessData?.tagline ?? undefined}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
            currentHeadline={(storefrontConfig.hero as any)?.headline}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
            currentSubheadline={(storefrontConfig.hero as any)?.subheadline}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
            currentCta={(storefrontConfig.hero as any)?.ctaLabel}
            productsCount={commerceProducts.length}
            servicesCount={services.length}
            onApply={handleApplyHeroCopy}
          />
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
    </div>
  );
}
