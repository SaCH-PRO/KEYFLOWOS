"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Rocket, Link2, Eye, Monitor, Smartphone, ExternalLink, Globe, Send, Megaphone, UserPlus, Loader2, CheckCircle2 } from "lucide-react";
import { WorkspaceMetricStrip, type MetricStripItem } from "@/components/ui/workspace-metric-strip";
import { SectionCard } from "@/components/ui/section-card";
import { AccordionGroup, AccordionSection } from "./accordion-section";
import { LaunchAdvisor } from "./launch-advisor";
import { StoreSettings } from "./store-settings";
import { createCampaign } from "@/lib/client";
import type { Service, Product, StorefrontConfig, StoreReadinessResult } from "@/lib/client";

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

function LaunchActions({
  businessId,
  storeName,
  onCopilotAction,
}: {
  businessId: string;
  storeName?: string;
  onCopilotAction?: (prompt: string) => void;
}) {
  const [actionState, setActionState] = useState<Record<string, "idle" | "loading" | "done">>({});

  const handleCreateCampaignDraft = useCallback(async (type: "launch" | "promo" | "segment") => {
    setActionState(prev => ({ ...prev, [type]: "loading" }));
    try {
      const templates: Record<string, { name: string; subject: string; body: string }> = {
        launch: {
          name: `Store Launch - ${storeName || 'My Store'}`,
          subject: `${storeName || 'We'} just launched! Come check us out`,
          body: `<p>We're excited to announce that <strong>${storeName || 'our store'}</strong> is now live!</p><p>Browse our catalog and place your first order today.</p>`,
        },
        promo: {
          name: `Promotion - ${storeName || 'My Store'}`,
          subject: `Special offer from ${storeName || 'us'} - Limited time!`,
          body: `<p>Don't miss our special promotion at <strong>${storeName || 'our store'}</strong>!</p><p>Visit now for exclusive deals.</p>`,
        },
        segment: {
          name: `VIP Offer - ${storeName || 'My Store'}`,
          subject: `Exclusive offer for our valued customers`,
          body: `<p>As a valued customer of <strong>${storeName || 'our store'}</strong>, we have an exclusive offer just for you.</p>`,
        },
      };

      const tpl = templates[type];
      const result = await createCampaign(businessId, {
        name: tpl.name,
        subject: tpl.subject,
        body: tpl.body,
        status: 'DRAFT',
      });

      if (result.data && !result.error) {
        setActionState(prev => ({ ...prev, [type]: "done" }));
        setTimeout(() => setActionState(prev => ({ ...prev, [type]: "idle" })), 3000);

        onCopilotAction?.(
          type === "segment"
            ? `I just created a VIP campaign draft "${tpl.name}". Help me identify my best customer segments from CRM contacts and suggest targeted offers for each segment.`
            : `I just created a campaign draft "${tpl.name}". Help me refine the copy and suggest the best send time for maximum engagement.`,
        );
      } else {
        setActionState(prev => ({ ...prev, [type]: "idle" }));
      }
    } catch {
      setActionState(prev => ({ ...prev, [type]: "idle" }));
    }
  }, [businessId, storeName, onCopilotAction]);

  const actions = [
    {
      key: "launch",
      label: "Draft Launch Campaign",
      icon: Send,
      description: "Creates an email campaign draft announcing your store",
    },
    {
      key: "promo",
      label: "Draft Promotion",
      icon: Megaphone,
      description: "Creates a promotional campaign draft with offer copy",
    },
    {
      key: "segment",
      label: "Target VIP Segment",
      icon: UserPlus,
      description: "Creates a VIP offer draft and opens AI for segmentation",
    },
  ];

  return (
    <SectionCard title="Launch Actions" subtitle="Create campaigns & target audiences" icon={Megaphone}>
      <div className="space-y-2">
        {actions.map((action) => {
          const Icon = action.icon;
          const state = actionState[action.key] || "idle";
          return (
            <button
              key={action.key}
              onClick={() => handleCreateCampaignDraft(action.key as "launch" | "promo" | "segment")}
              disabled={state === "loading"}
              className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all hover:scale-[1.005] min-h-[44px]"
              style={{ background: "hsl(var(--kf-muted)/0.06)", border: "1px solid hsl(var(--kf-border)/0.25)" }}
            >
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "hsl(var(--kf-accent1)/0.1)" }}>
                {state === "loading" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "hsl(var(--kf-accent1))" }} />
                ) : state === "done" ? (
                  <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-success))" }} />
                ) : (
                  <Icon className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold" style={{ color: "hsl(var(--kf-foreground))" }}>
                  {state === "done" ? "Campaign draft created!" : action.label}
                </p>
                <p className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{action.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </SectionCard>
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

  const itemCount = services.length + commerceProducts.length;
  const readinessPercent = readiness?.scores?.overall ?? 0;
  const totalItems = readiness?.items?.length ?? 0;
  const resolvedItems = readiness?.items?.filter((i) => i.resolved).length ?? 0;
  const blockerCount = readiness?.items?.filter((i) => !i.resolved && i.severity === "blocker").length ?? 0;

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
      value: totalItems > 0 ? `${resolvedItems}/${totalItems}` : "—",
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
              readinessItems={readiness?.items}
              readinessScores={readiness?.scores}
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

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
        <LaunchActions
          businessId={businessId}
          storeName={businessData?.name}
          onCopilotAction={onCopilotAction}
        />
      </motion.div>

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
