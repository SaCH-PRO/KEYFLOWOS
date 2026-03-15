"use client";

import { StoreCommandHero } from "./store-command-hero";
import { ConversionInsightsPanel } from "./conversion-insights";
import { StoreAnalyticsDashboard } from "./store-analytics";
import type { StoreAnalytics, StorefrontConfig } from "@/lib/client";
import type { BusinessHoursMap } from "./hours-editor";

type Props = {
  businessId: string;
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
};

export function PerformanceTab({
  businessId,
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
}: Props) {
  return (
    <div className="space-y-6">
      <StoreCommandHero
        storeEnabled={storeEnabled}
        publicUrl={publicUrl}
        servicesCount={servicesCount}
        productsCount={productsCount}
        driftedCount={driftedCount}
        hasLogo={hasLogo}
        hasHeroImage={hasHeroImage}
        hoursConfigured={hoursConfigured}
        hasTestimonials={hasTestimonials}
        hasSlug={hasSlug}
        analytics={analytics}
        businessName={businessName}
        onTabChange={onTabChange}
      />
      <ConversionInsightsPanel businessId={businessId} onTabChange={onTabChange} />
      <StoreAnalyticsDashboard businessId={businessId} />
    </div>
  );
}
