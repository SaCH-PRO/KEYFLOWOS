"use client";

import { Rocket, Link2 } from "lucide-react";
import { AccordionGroup, AccordionSection } from "./accordion-section";
import { ReadinessChecklist } from "./readiness-checklist";
import { StoreSettings } from "./store-settings";
import type { Service, Product } from "@/lib/client";

type HeroSection = { imageUrl?: string; coverImageUrl?: string };
type SocialProofSection = { testimonials?: unknown[] };

type Props = {
  businessId: string;
  storeEnabled: boolean;
  slug: string;
  currentSlug: string | null;
  publicUrl: string;
  onSlugChange: (slug: string) => void;
  onSaveSlug: () => Promise<void>;
  slugSaving: boolean;
  businessData: {
    name?: string;
    slug?: string | null;
    logoUrl?: string | null;
    primaryColor?: string | null;
    secondaryColor?: string | null;
  } | null;
  services: Service[];
  commerceProducts: Product[];
  hasHeroImage: boolean;
  hoursConfigured: boolean;
  hasTestimonials: boolean;
  onModeChange: (mode: string) => void;
};

export function LaunchMode({
  businessId,
  storeEnabled,
  slug,
  currentSlug,
  publicUrl,
  onSlugChange,
  onSaveSlug,
  slugSaving,
  businessData,
  services,
  commerceProducts,
  hasHeroImage,
  hoursConfigured,
  hasTestimonials,
  onModeChange,
}: Props) {
  const pc = businessData?.primaryColor || "#F97316";

  const urlBadge = currentSlug ? (
    <span className="px-1.5 py-0.5 rounded-md text-[9px] font-semibold" style={{ background: "hsl(var(--kf-success)/0.15)", color: "hsl(var(--kf-success))" }}>Active</span>
  ) : undefined;

  return (
    <div className="space-y-5">
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
            onTabChange={onModeChange}
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
    </div>
  );
}
