"use client";

import { Rocket, Link2 } from "lucide-react";
import { AccordionGroup, AccordionSection } from "./accordion-section";
import { LaunchAdvisor } from "./launch-advisor";
import { StoreSettings } from "./store-settings";
import type { Service, Product, StorefrontConfig } from "@/lib/client";

type HeroSection = { imageUrl?: string; coverImageUrl?: string; headline?: string; subheadline?: string; ctaLabel?: string };
type SeoSection = { metaTitle?: string; metaDescription?: string };

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
    tagline?: string | null;
    primaryColor?: string | null;
    secondaryColor?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
  services: Service[];
  commerceProducts: Product[];
  storefrontConfig?: StorefrontConfig;
  hasHeroImage: boolean;
  hoursConfigured: boolean;
  hasTestimonials: boolean;
  activeDeliveryMethodsCount?: number;
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
  storefrontConfig,
  hasHeroImage,
  hoursConfigured,
  hasTestimonials,
  activeDeliveryMethodsCount = 0,
  onModeChange,
}: Props) {
  const pc = businessData?.primaryColor || "#F97316";

  const hero = storefrontConfig?.hero as HeroSection | undefined;
  const seo = storefrontConfig?.seo as SeoSection | undefined;
  const policies = storefrontConfig?.policies ?? {};
  const faqEntries = storefrontConfig?.faqEntries ?? [];

  const hasHeroHeadline = !!(hero?.headline && hero.headline.trim().length > 0);
  const hasHeroCta = !!(hero?.ctaLabel && hero.ctaLabel.trim().length > 0);
  const hasMetaTitle = !!(seo?.metaTitle && seo.metaTitle.trim().length > 0);
  const hasMetaDescription = !!(seo?.metaDescription && seo.metaDescription.trim().length > 0);
  const hasPolicies = Object.values(policies).some((p: any) => p?.enabled);
  const hasFaq = Array.isArray(faqEntries) && faqEntries.length > 0;

  const urlBadge = currentSlug ? (
    <span className="px-1.5 py-0.5 rounded-md text-[9px] font-semibold" style={{ background: "hsl(var(--kf-success)/0.15)", color: "hsl(var(--kf-success))" }}>Active</span>
  ) : undefined;

  return (
    <div className="space-y-5">
      <AccordionGroup title="Launch Advisor" brandColor={pc}>
        <AccordionSection
          title="Readiness Score"
          subtitle="AI-powered launch checklist with severity levels"
          icon={Rocket}
          accentColor="hsl(var(--kf-success))"
          defaultOpen
        >
          <LaunchAdvisor
            hasLogo={!!businessData?.logoUrl}
            hasHeroImage={hasHeroImage}
            hasHeroHeadline={hasHeroHeadline}
            hasHeroCta={hasHeroCta}
            hoursConfigured={hoursConfigured}
            hasTestimonials={hasTestimonials}
            hasSlug={!!businessData?.slug}
            servicesCount={services.length}
            productsCount={commerceProducts.length}
            storeEnabled={storeEnabled}
            hasMetaTitle={hasMetaTitle}
            hasMetaDescription={hasMetaDescription}
            hasPhone={!!(businessData?.phone)}
            hasEmail={!!(businessData?.email)}
            hasPolicies={hasPolicies}
            hasFaq={hasFaq}
            activeDeliveryCount={activeDeliveryMethodsCount}
            onTabChange={onModeChange}
            slug={businessData?.slug ?? currentSlug ?? undefined}
            storeName={businessData?.name}
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
