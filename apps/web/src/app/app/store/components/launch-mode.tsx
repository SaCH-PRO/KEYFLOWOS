"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Rocket, Link2, Eye, Monitor, Smartphone, ExternalLink, Globe, Send, Megaphone, UserPlus } from "lucide-react";
import { WorkspaceMetricStrip, type MetricStripItem } from "@/components/ui/workspace-metric-strip";
import { SectionCard } from "@/components/ui/section-card";
import { AccordionGroup, AccordionSection } from "./accordion-section";
import { LaunchAdvisor } from "./launch-advisor";
import { StoreSettings } from "./store-settings";
import type { Service, Product, StorefrontConfig, StorefrontPolicies, StoreReadinessResult, ReadinessItem as ApiReadinessItem } from "@/lib/client";

type HeroSection = { imageUrl?: string; coverImageUrl?: string; headline?: string; subheadline?: string; ctaLabel?: string };
type SeoSection = { metaTitle?: string; metaDescription?: string };
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
  readiness?: StoreReadinessResult | null;
  onCopilotAction?: (prompt: string) => void;
};

function StorefrontPreview({ slug, previewMode }: { slug: string | null; previewMode: "desktop" | "mobile" }) {
  if (!slug) {
    return (
      <div className="flex items-center justify-center py-8 rounded-xl" style={{ background: "hsl(var(--kf-muted)/0.06)", border: "1px solid hsl(var(--kf-border)/0.25)" }}>
        <p className="text-xs" style={{ color: "hsl(var(--kf-muted-foreground))" }}>Set a store URL to preview your storefront</p>
      </div>
    );
  }

  const url = `/book/${slug}`;

  return (
    <div className="space-y-2">
      <div
        className="mx-auto overflow-hidden rounded-xl transition-all duration-300"
        style={{
          width: previewMode === "mobile" ? "375px" : "100%",
          maxWidth: "100%",
          border: "1px solid hsl(var(--kf-border)/0.3)",
          background: "hsl(var(--kf-background))",
        }}
      >
        <div className="flex items-center gap-1.5 px-3 py-2" style={{ background: "hsl(var(--kf-muted)/0.08)", borderBottom: "1px solid hsl(var(--kf-border)/0.2)" }}>
          <div className="flex gap-1">
            <div className="w-2 h-2 rounded-full" style={{ background: "hsl(0 72% 51%)" }} />
            <div className="w-2 h-2 rounded-full" style={{ background: "hsl(45 93% 55%)" }} />
            <div className="w-2 h-2 rounded-full" style={{ background: "hsl(142 70% 45%)" }} />
          </div>
          <div className="flex-1 text-center">
            <span className="text-[9px]" style={{ color: "hsl(var(--kf-muted-foreground)/0.6)" }}>{url}</span>
          </div>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-0.5 rounded transition-colors hover:bg-[hsl(var(--kf-muted)/0.15)]"
          >
            <ExternalLink className="w-3 h-3" style={{ color: "hsl(var(--kf-muted-foreground)/0.5)" }} />
          </a>
        </div>
        <iframe
          src={url}
          className="w-full border-0"
          style={{ height: previewMode === "mobile" ? "500px" : "360px", pointerEvents: "none" }}
          title="Storefront preview"
        />
      </div>
    </div>
  );
}

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
  readiness,
  onCopilotAction,
}: Props) {
  const pc = businessData?.primaryColor || "#F97316";
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");

  const hero = storefrontConfig?.hero as HeroSection | undefined;
  const seo = storefrontConfig?.seo as SeoSection | undefined;
  const socialProof = storefrontConfig?.socialProof as SocialProofSection | undefined;
  const policies = storefrontConfig?.policies as Partial<StorefrontPolicies> | undefined;
  const faqEntries = storefrontConfig?.faqEntries ?? [];

  const hasHeroHeadline = !!(hero?.headline && hero.headline.trim().length > 0);
  const hasHeroCta = !!(hero?.ctaLabel && hero.ctaLabel.trim().length > 0);
  const hasMetaTitle = !!(seo?.metaTitle && seo.metaTitle.trim().length > 0);
  const hasMetaDescription = !!(seo?.metaDescription && seo.metaDescription.trim().length > 0);
  const hasPolicies = policies ? Object.values(policies).some((p: any) => p?.enabled) : false;
  const hasFaq = Array.isArray(faqEntries) && faqEntries.length > 0;
  const hasLogo = !!businessData?.logoUrl;
  const hasSlug = !!businessData?.slug;
  const itemCount = services.length + commerceProducts.length;
  const completedChecks = [storeEnabled, hasSlug, itemCount > 0, hasHeroImage, hasHeroHeadline, hasLogo, hoursConfigured, hasTestimonials, hasMetaTitle, activeDeliveryMethodsCount > 0].filter(Boolean).length;
  const totalChecks = 10;
  const readinessPercent = readiness?.scores?.launch ?? Math.round((completedChecks / totalChecks) * 100);
  const blockerCount = readiness?.items.filter((i) => !i.resolved && i.severity === "blocker").length ?? 0;

  const metrics: MetricStripItem[] = [
    {
      label: "Readiness",
      value: `${readinessPercent}%`,
      icon: Rocket,
      iconColor: readinessPercent >= 80 ? "hsl(var(--kf-success))" : readinessPercent >= 50 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-error))",
      threshold: { status: readinessPercent >= 80 ? "good" : readinessPercent >= 50 ? "warn" : "critical" },
    },
    {
      label: "Status",
      value: storeEnabled ? "Live" : "Draft",
      icon: Globe,
      iconColor: storeEnabled ? "hsl(var(--kf-success))" : "hsl(var(--kf-warning))",
      threshold: { status: storeEnabled ? "good" : "warn" },
    },
    {
      label: "Catalog Items",
      value: itemCount,
      icon: Eye,
      iconColor: pc,
      threshold: { status: itemCount > 0 ? "good" : "critical" },
    },
    {
      label: "Checks Passed",
      value: `${completedChecks}/${totalChecks}`,
      icon: Monitor,
      iconColor: "#14B8A6",
    },
  ];

  const urlBadge = currentSlug ? (
    <span className="px-1.5 py-0.5 rounded-md text-[9px] font-semibold" style={{ background: "hsl(var(--kf-success)/0.15)", color: "hsl(var(--kf-success))" }}>Active</span>
  ) : undefined;

  return (
    <div className="space-y-4">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <WorkspaceMetricStrip items={metrics} columns={4} compact />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <AccordionGroup title="Launch Advisor" brandColor={pc}>
          <AccordionSection
            title="Readiness Score"
            subtitle="AI-powered launch checklist with severity levels"
            icon={Rocket}
            accentColor="hsl(var(--kf-success))"
            defaultOpen
          >
            <LaunchAdvisor
              hasLogo={hasLogo}
              hasHeroImage={hasHeroImage}
              hasHeroHeadline={hasHeroHeadline}
              hasHeroCta={hasHeroCta}
              hoursConfigured={hoursConfigured}
              hasTestimonials={hasTestimonials}
              hasSlug={hasSlug}
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
      </motion.div>

      {onCopilotAction && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
          <SectionCard title="Launch Actions" subtitle="Marketing & CRM connections" icon={Megaphone}>
            <div className="flex items-center gap-2">
              {[
                { label: "Send Launch Offer", icon: Send, prompt: "Draft a store launch announcement with a special opening offer. Create an email subject line and a WhatsApp message version for my contacts." },
                { label: "Promote to Segment", icon: UserPlus, prompt: "Identify my best customer segments from CRM contacts and create a targeted promotion for each to drive store launch traffic." },
                { label: "Generate Campaign", icon: Megaphone, prompt: "Create a complete launch campaign with social media posts, WhatsApp broadcast messages, and email copy to announce my store going live." },
              ].map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.label}
                    onClick={() => onCopilotAction(action.prompt)}
                    className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[10px] font-medium transition-all hover:scale-[1.02] flex-1 justify-center min-h-[40px]"
                    style={{ background: "hsl(var(--kf-muted)/0.08)", border: "1px solid hsl(var(--kf-border)/0.3)", color: "hsl(var(--kf-foreground))" }}
                  >
                    <Icon className="w-3 h-3" style={{ color: "hsl(var(--kf-accent1))" }} />
                    {action.label}
                  </button>
                );
              })}
            </div>
          </SectionCard>
        </motion.div>
      )}

      {(currentSlug || businessData?.slug) && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <SectionCard
            title="Storefront Preview"
            subtitle="See how your store looks to customers"
            icon={Eye}
            headerRight={
              <div className="flex items-center gap-0.5 p-0.5 rounded-lg" style={{ background: "hsl(var(--kf-muted)/0.1)" }}>
                <button
                  onClick={() => setPreviewMode("desktop")}
                  aria-pressed={previewMode === "desktop"}
                  className="p-1.5 rounded-md transition-all"
                  style={{
                    background: previewMode === "desktop" ? "hsl(var(--kf-card))" : "transparent",
                    color: previewMode === "desktop" ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted-foreground))",
                    boxShadow: previewMode === "desktop" ? "0 1px 4px hsl(var(--kf-background)/0.3)" : "none",
                  }}
                >
                  <Monitor className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setPreviewMode("mobile")}
                  aria-pressed={previewMode === "mobile"}
                  className="p-1.5 rounded-md transition-all"
                  style={{
                    background: previewMode === "mobile" ? "hsl(var(--kf-card))" : "transparent",
                    color: previewMode === "mobile" ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted-foreground))",
                    boxShadow: previewMode === "mobile" ? "0 1px 4px hsl(var(--kf-background)/0.3)" : "none",
                  }}
                >
                  <Smartphone className="w-3.5 h-3.5" />
                </button>
              </div>
            }
          >
            <StorefrontPreview slug={currentSlug ?? businessData?.slug ?? null} previewMode={previewMode} />
          </SectionCard>
        </motion.div>
      )}
    </div>
  );
}
