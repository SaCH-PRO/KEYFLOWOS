"use client";

import { AlertCircle } from "lucide-react";
import { StoreSettings } from "./store-settings";
import { AppearanceCustomizer } from "./appearance-customizer";
import { StorefrontPreview } from "./storefront-preview";
import { SocialProofPanel } from "./social-proof-panel";
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
};

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
}: Props) {
  return (
    <div className="space-y-6">
      {!storeEnabled && (
        <div
          className="kf-card p-3 text-sm flex items-center gap-2"
          style={{ borderColor: "hsl(40 90% 50% / 0.4)", background: "hsl(40 90% 50% / 0.1)", color: "hsl(40 90% 90%)" }}
        >
          <AlertCircle className="w-4 h-4" />
          Your store is currently unpublished. Customers cannot see your booking page.
        </div>
      )}

      <StoreSettings
        businessId={businessId}
        slug={slug}
        currentSlug={currentSlug}
        publicUrl={publicUrl}
        onSlugChange={onSlugChange}
        onSaveSlug={onSaveSlug}
        slugSaving={slugSaving}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
        />
      </div>

      <SocialProofPanel
        storefrontConfig={storefrontConfig}
        configSaving={configSaving}
        onConfigChange={onConfigChange}
        onSaveConfig={onSaveConfig}
      />
    </div>
  );
}
