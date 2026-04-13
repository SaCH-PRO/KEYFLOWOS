"use client";

import { Palette, Type, LayoutGrid } from "lucide-react";
import { AccordionGroup, AccordionSection } from "./accordion-section";
import { AppearanceCustomizer } from "./appearance-customizer";
import { StorefrontPreview } from "./storefront-preview";
import { FontBrandingPanel } from "./font-branding-panel";
import { SectionLayoutManager } from "./section-layout-manager";
import type { Service, Product, StorefrontConfig } from "@/lib/client";

type Props = {
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
  storefrontConfig: StorefrontConfig;
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
    </div>
  );
}
