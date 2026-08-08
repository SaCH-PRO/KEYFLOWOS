"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Store } from "lucide-react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { useReturnNavigation } from "@/lib/use-return-navigation";
import { ResumePrompt } from "@/components/ui/resume-task-system";
import { useNavigationContext } from "@/lib/navigation-context";
import { useKeyboardShortcuts, type ShortcutGroup } from "@/hooks/use-keyboard-shortcuts";
import { WorkspaceError } from "@/components/ui/workspace-error";
import { NotesTrigger } from "@/components/keyflow/notes-trigger";
import { PageNotesMount } from "@/components/keyflow/page-notes-mount";
import { Surface } from "@/components/ui-v2/surface";
import { Badge } from "@/components/ui-v2/badge";
import { Button } from "@/components/ui-v2/button";
import { EmptyState } from "@/components/ui-v2/empty-state";
import { useStoreAiHub } from "./hooks/use-store-ai-hub";
import { useStoreData } from "./hooks/use-store-data";
import { StoreSkeleton } from "./components/store-skeleton";
import { StoreHeaderActions } from "./components/store-header-actions";
import { StoreTabs } from "./components/store-tabs";
import { VIEW_TABS, type TabKey } from "./components/store-types";
import { OverviewMode } from "./components/overview-mode";
import { DesignMode } from "./components/design-mode";
import { MerchandisingMode } from "./components/merchandising-mode";
import { CatalogMode } from "./components/catalog-mode";
import { OperationsMode } from "./components/operations-mode";
import { LaunchMode } from "./components/launch-mode";

type HeroSection = { imageUrl?: string; coverImageUrl?: string; headline?: string; subheadline?: string; ctaText?: string };
type SocialProofSection = { testimonials?: unknown[] };
type BusinessHourEntry = { enabled?: boolean };
type AppearanceSection = { primaryColor?: string; secondaryColor?: string; accentColor?: string };
type SeoSection = { metaTitle?: string; metaDescription?: string };

const TAB_KEYS = VIEW_TABS.map((t) => t.key);

const SLIDE = {
  enter: (d: number) => ({ x: d > 0 ? 40 : -40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (d: number) => ({ x: d > 0 ? -40 : 40, opacity: 0 }),
};

export default function StorePage() {
  const searchParams = useSearchParams();
  const s = useStoreData();
  const ai = useStoreAiHub();
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [dir, setDir] = useState(0);
  const initRef = useRef(false);
  const { setCurrentMeta } = useNavigationContext();
  useReturnNavigation({ restoreScrollOnMount: true });

  useEffect(() => {
    if (initRef.current) return;
    const p = searchParams.get("tab");
    if (p && TAB_KEYS.includes(p as TabKey)) {
      setActiveTab(p as TabKey);
      initRef.current = true;
    }
  }, [searchParams]);

  const productCount = s.commerceProducts.length;
  const serviceCount = s.services.length;
  const deliveryCount = s.activeDeliveryMethodsCount ?? 0;

  useEffect(() => {
    if (!s.businessId) return;
    const _hero = s.storefrontConfig.hero as HeroSection | undefined;
    const _seo = s.storefrontConfig.seo as SeoSection | undefined;
    const _policies = s.storefrontConfig.policies ?? {};
    const _faqEntries = s.storefrontConfig.faqEntries ?? [];
    ai.updateStoreContext({
      businessId: s.businessId,
      activeView: activeTab,
      itemCount: productCount,
      products: s.commerceProducts,
      services: s.services,
      testimonials: (s.storefrontConfig.socialProof as SocialProofSection | undefined)?.testimonials ?? [],
      storeEnabled: s.storeEnabled,
      hasHeroImage: !!(_hero?.imageUrl || _hero?.coverImageUrl),
      hasHeroHeadline: !!(_hero?.headline && _hero.headline.trim().length > 0),
      hasHeroCta: !!((_hero as { ctaLabel?: string } | undefined)?.ctaLabel && (_hero as { ctaLabel: string }).ctaLabel.trim().length > 0),
      hasLogo: !!s.businessData?.logoUrl,
      hoursConfigured: Object.values(s.businessHours).some((h) => (h as BusinessHourEntry)?.enabled),
      storeName: s.businessData?.name,
      businessDescription: s.businessData?.description ?? undefined,
      businessTagline: s.businessData?.tagline ?? undefined,
      hasMetaTitle: !!(_seo?.metaTitle && _seo.metaTitle.trim().length > 0),
      hasMetaDescription: !!(_seo?.metaDescription && _seo.metaDescription.trim().length > 0),
      hasPolicies: Object.values(_policies).some((p) => (p as { enabled?: boolean } | null | undefined)?.enabled),
      hasFaq: Array.isArray(_faqEntries) && _faqEntries.length > 0,
      activeDeliveryCount: deliveryCount,
      readinessScores: s.readiness?.scores,
      readinessItems: s.readiness?.items,
      revenueSnapshot: s.readiness?.revenue,
      graphStats: s.storeGraph ? { liveCount: s.storeGraph.liveCount, draftCount: s.storeGraph.draftCount, driftCount: s.storeGraph.driftCount, totalProducts: s.storeGraph.totalProducts } : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally narrowed deps to context-shaping fields; `ai.updateStoreContext`, `s.commerceProducts`, and `s.services` are summarized via `productCount`/`serviceCount` and an unstable `ai` bag identity would re-fire this on every render of the AI hub.
  }, [s.businessId, activeTab, productCount, serviceCount, s.storeEnabled, s.businessData, s.storefrontConfig, s.businessHours, deliveryCount, s.readiness, s.storeGraph]);

  const emitEvent = s.emitEvent;
  const handleTabChange = useCallback((key: string) => {
    if (!TAB_KEYS.includes(key as TabKey)) return;
    setDir(TAB_KEYS.indexOf(key as TabKey) > TAB_KEYS.indexOf(activeTab) ? 1 : -1);
    setActiveTab(key as TabKey);
    setCurrentMeta({ tab: key === "overview" ? null : key });
    emitEvent("module:tab_changed", "store", { tab: key });
    const url = new URL(window.location.href);
    if (key === "overview") { url.searchParams.delete("tab"); } else { url.searchParams.set("tab", key); }
    window.history.replaceState({}, "", url.toString());
  }, [activeTab, emitEvent, setCurrentMeta]);

  const _handleStoreAiAction = useCallback((actionKey: string) => {
    if (!actionKey.startsWith("switch_tab:")) return;
    const tab = actionKey.replace("switch_tab:", "");
    if (TAB_KEYS.includes(tab as TabKey)) {
      handleTabChange(tab);
    }
  }, [handleTabChange]);

  const loadData = s.loadData;
  const shortcuts = useMemo<ShortcutGroup[]>(() => [{
    groupName: "Store",
    shortcuts: [
      { key: "1", description: "Overview", action: () => handleTabChange("overview") },
      { key: "2", description: "Design", action: () => handleTabChange("design") },
      { key: "3", description: "Merchandising", action: () => handleTabChange("merchandising") },
      { key: "4", description: "Catalog", action: () => handleTabChange("catalog") },
      { key: "5", description: "Operations", action: () => handleTabChange("operations") },
      { key: "6", description: "Launch", action: () => handleTabChange("launch") },
      { key: "r", description: "Refresh", action: () => { void loadData(); } },
    ],
  }], [handleTabChange, loadData]);
  useKeyboardShortcuts(shortcuts, !s.loading);

  if (s.loading) return <StoreSkeleton />;
  if (s.loadError) return <WorkspaceError title="Failed to load store" description={s.loadError} />;
  if (!s.businessId) return <WorkspaceError />;

  const cfg = s.storefrontConfig;
  const appearance = cfg.appearance as AppearanceSection | undefined;
  const hero = cfg.hero as HeroSection | undefined;
  const pc = appearance?.primaryColor || s.businessData?.primaryColor || "#F97316";
  const sc = appearance?.secondaryColor || s.businessData?.secondaryColor || "#14B8A6";
  const coverImage = hero?.coverImageUrl || hero?.imageUrl;
  const logoUrl = s.businessData?.logoUrl;
  const storeName = s.businessData?.name || "My Store";

  const hasHeroImage = !!(hero?.imageUrl || hero?.coverImageUrl);
  const hoursConfigured = Object.values(s.businessHours).some((h) => (h as BusinessHourEntry)?.enabled);
  const hasTestimonials = !!((cfg.socialProof as SocialProofSection | undefined)?.testimonials?.length);

  return (
    <div className="space-y-4" aria-label="Presence Studio">
      <ResumePrompt module="store" />

      <div className="relative rounded-2xl overflow-hidden" style={{ border: `1px solid ${pc}20` }}>
        {coverImage ? (
          <div className="absolute inset-0">
            <Image src={coverImage} alt="" className="w-full h-full object-cover" fill sizes="(max-width: 768px) 100vw, 50vw" unoptimized />
            <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, hsl(var(--kf-background)/0.92) 0%, hsl(var(--kf-background)/0.82) 100%)` }} />
            <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${pc}10 0%, transparent 60%)` }} />
          </div>
        ) : (
          <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${pc}12 0%, ${sc}06 60%, hsl(var(--kf-card)) 100%)` }} />
        )}

        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full" style={{ background: `radial-gradient(circle, ${pc}10, transparent 60%)` }} />
          <div className="absolute -bottom-12 -left-12 w-48 h-48 rounded-full" style={{ background: `radial-gradient(circle, ${sc}08, transparent 60%)` }} />
        </div>

        <Surface variant="glass" className="relative m-4 p-4 border-transparent bg-card/70 backdrop-blur-2xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3.5 min-w-0">
              {logoUrl ? (
                <div className="h-12 w-12 rounded-2xl flex items-center justify-center flex-shrink-0 overflow-hidden border-2 border-primary/20 shadow-sm bg-card">
                  <Image src={logoUrl} alt="" className="w-full h-full object-cover" fill sizes="(max-width: 768px) 100vw, 50vw" unoptimized />
                </div>
              ) : (
                <div className="h-12 w-12 rounded-2xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-primary to-secondary shadow-md">
                  <Store className="w-5 h-5 text-white" />
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="font-display text-title font-bold tracking-tight truncate text-foreground">{storeName}</h1>
                  <Badge variant="status" color={s.storeEnabled ? "mint" : "orange"}>
                    <span className="flex items-center gap-1.5">
                      <span className={cn("w-1.5 h-1.5 rounded-full", s.storeEnabled ? "bg-mint" : "bg-primary")} />
                      {s.storeEnabled ? "Live" : "Draft"}
                    </span>
                  </Badge>
                  <NotesTrigger pageKey="store" variant="header" />
                </div>
                <p className="text-caption mt-0.5 truncate text-muted-foreground">
                  {s.storeEnabled && s.getPublicBookingUrl() ? s.getPublicBookingUrl().replace("https://", "") : "Presence Studio — your storefront workspace"}
                </p>
              </div>
            </div>
            <StoreHeaderActions storeEnabled={s.storeEnabled} publicUrl={s.getPublicBookingUrl()} onToggleEnabled={s.toggleStoreEnabled} />
          </div>
        </Surface>
      </div>

      <div data-walkthrough="store-setup">
        <StoreTabs activeView={activeTab} onViewChange={handleTabChange} />
      </div>

      {s.commerceProducts.length === 0 && s.services.length === 0 && (
        <EmptyState
          icon={Store}
          title="Your storefront is empty"
          description="Add products or services to start selling online. Your customers will see them on your public booking page."
          actionLabel="Add Product"
          onAction={() => handleTabChange("catalog")}
        >
          <div className="mt-4 flex flex-col items-center gap-3">
            <Button variant="soft" onClick={() => handleTabChange("design")}>
              Design Store
            </Button>
            <p className="text-caption text-muted-foreground max-w-xs">
              Start with your most popular service. You can always add more later.
            </p>
          </div>
        </EmptyState>
      )}

      <div className="touch-pan-y">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={activeTab}
            custom={dir}
            variants={SLIDE}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: "spring", bounce: 0.12, duration: 0.3 }}
          >
            {activeTab === "overview" && (
              <OverviewMode
                businessId={s.businessId}
                storeEnabled={s.storeEnabled}
                publicUrl={s.getPublicBookingUrl()}
                businessData={s.businessData}
                commerceProducts={s.commerceProducts}
                services={s.services}
                storefrontConfig={cfg}
                analytics={s.overviewAnalytics}
                businessHours={s.businessHours as Record<string, { enabled?: boolean }>}
                onModeChange={handleTabChange}
                activeDeliveryMethodsCount={s.activeDeliveryMethodsCount}
                storeGraph={s.storeGraph}
                readiness={s.readiness}
                onCopilotAction={(prompt) => {
                  window.dispatchEvent(new CustomEvent("kf:open-copilot", { detail: { prompt } }));
                }}
                hasHeroImage={!!((cfg.hero as { imageUrl?: string; coverImageUrl?: string } | undefined)?.imageUrl || (cfg.hero as { imageUrl?: string; coverImageUrl?: string } | undefined)?.coverImageUrl)}
                hasHeroHeadline={!!((cfg.hero as { headline?: string } | undefined)?.headline?.trim().length)}
              />
            )}
            {activeTab === "design" && (
              <DesignMode
                businessData={s.businessData}
                services={s.services}
                commerceProducts={s.commerceProducts}
                storefrontConfig={cfg}
                onConfigChange={s.handleConfigChange}
                onSaveConfig={s.handleSaveConfig}
                configSaving={s.configSaving}
                slug={s.storeSlug}
              />
            )}
            {activeTab === "merchandising" && (
              <MerchandisingMode
                businessData={s.businessData}
                services={s.services}
                commerceProducts={s.commerceProducts}
                liveProductIds={s.liveProductIds}
                storefrontConfig={cfg}
                onConfigChange={s.handleConfigChange}
                onSaveConfig={s.handleSaveConfig}
                configSaving={s.configSaving}
                publicUrl={s.getPublicBookingUrl()}
                hasTestimonials={hasTestimonials}
                activeDeliveryMethodsCount={s.activeDeliveryMethodsCount}
              />
            )}
            {activeTab === "catalog" && (
              <CatalogMode
                commerceProducts={s.commerceProducts}
                liveProductIds={s.liveProductIds}
                graphProductToServiceMap={s.graphProductToServiceMap}
                storeItemCount={s.storeItemCount}
                processingItems={s.processingItems}
                confirmRemove={s.confirmRemove}
                onToggleItem={s.handleToggleStoreItem}
                onSelectAll={s.handleSelectAll}
                onDeselectAll={s.handleDeselectAll}
                onConfirmRemoveChange={s.setConfirmRemove}
                onDeleteFromStore={s.handleDeleteServiceFromStore}
                services={s.services}
                businessHours={s.businessHours}
                onHoursChange={s.setBusinessHours}
                onSaveHours={s.handleSaveHours}
                hoursSaving={s.hoursSaving}
                onReorderProducts={s.handleReorderProducts}
                itemOverrides={s.storefrontConfig.catalog?.itemOverrides}
                onItemOverrideChange={s.handleItemOverrideChange}
                categoryEmphasis={s.storefrontConfig.catalog?.categoryEmphasis}
                onCategoryEmphasisChange={s.handleCategoryEmphasisChange}
              />
            )}
            {activeTab === "operations" && (
              <OperationsMode
                businessId={s.businessId}
                storeEnabled={s.storeEnabled}
                businessHours={s.businessHours}
                storefrontConfig={cfg}
                onConfigChange={s.handleConfigChange}
                onSaveConfig={s.handleSaveConfig}
                configSaving={s.configSaving}
                onHoursChange={s.setBusinessHours}
                onSaveHours={s.handleSaveHours}
                hoursSaving={s.hoursSaving}
                onToggleStoreEnabled={s.toggleStoreEnabled}
                commerceProducts={s.commerceProducts}
              />
            )}
            {activeTab === "launch" && (
              <LaunchMode
                businessId={s.businessId}
                storeEnabled={s.storeEnabled}
                slug={s.storeSlug}
                currentSlug={s.businessData?.slug ?? null}
                publicUrl={s.getPublicBookingUrl()}
                onSlugChange={s.setStoreSlug}
                onSaveSlug={s.handleSaveSlug}
                slugSaving={s.slugSaving}
                businessData={s.businessData}
                services={s.services}
                commerceProducts={s.commerceProducts}
                storefrontConfig={cfg}
                hasHeroImage={hasHeroImage}
                hoursConfigured={hoursConfigured}
                hasTestimonials={hasTestimonials}
                hasFaq={Array.isArray(cfg.faqEntries) && cfg.faqEntries.length > 0}
                hasPolicies={Object.values(cfg.policies ?? {}).some((p) => (p as { enabled?: boolean } | null | undefined)?.enabled)}
                hasBookingCta={!!((cfg.hero as { ctaLabel?: string } | undefined)?.ctaLabel?.trim().length)}
                activeDeliveryMethodsCount={s.activeDeliveryMethodsCount}
                onModeChange={handleTabChange}
                readiness={s.readiness}
                onCopilotAction={(prompt) => {
                  window.dispatchEvent(new CustomEvent("kf:open-copilot", { detail: { prompt } }));
                }}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <PageNotesMount pageKey="store" />

      {/* AI hub trigger removed — use global Command Palette (⌘K) or Copilot (⌘J) instead */}
    </div>
  );
}
