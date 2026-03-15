"use client";

import { motion } from "framer-motion";
import { AlertCircle, X } from "lucide-react";
import { useState } from "react";
import { StoreSettings } from "./store-settings";
import { AppearanceCustomizer } from "./appearance-customizer";
import { StorefrontPreview } from "./storefront-preview";
import { SocialProofPanel } from "./social-proof-panel";
import { ReadinessChecklist } from "./readiness-checklist";
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

  return (
    <div className="space-y-6">
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
            className="p-0.5 rounded-md hover:bg-[hsl(40_90%_50%/0.15)] transition-colors flex-shrink-0"
          >
            <X className="w-3 h-3" />
          </button>
        </motion.div>
      )}

      <ReadinessChecklist
        hasLogo={!!businessData?.logoUrl}
        hasHeroImage={hasHeroImage}
        hoursConfigured={hoursConfigured}
        hasTestimonials={hasTestimonials}
        hasSlug={!!businessData?.slug}
        servicesCount={services.length}
        productsCount={commerceProducts.length}
        onTabChange={onTabChange}
      />

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
