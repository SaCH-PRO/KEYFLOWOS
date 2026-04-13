"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Store } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useReturnNavigation } from "@/lib/use-return-navigation";
import { ResumePrompt } from "@/components/ui/resume-task-system";
import { useNavigationContext } from "@/lib/navigation-context";
import { useKeyboardShortcuts, type ShortcutGroup } from "@/hooks/use-keyboard-shortcuts";
import { WorkspaceError } from "@/components/ui/workspace-error";
import { PageGuide, PageGuideTrigger } from "@/components/ui/page-guide";
import { STORE_WALKTHROUGH } from "@/lib/walkthrough-definitions";
import { useStoreAiHub } from "./hooks/use-store-ai-hub";
import { useStoreData } from "./hooks/use-store-data";
import { StoreSkeleton } from "./components/store-skeleton";
import { StoreHeaderActions } from "./components/store-header-actions";
import { VIEW_TABS, type TabKey } from "./components/store-types";
import { OverviewMode } from "./components/overview-mode";
import { DesignMode } from "./components/design-mode";
import { MerchandisingMode } from "./components/merchandising-mode";
import { CatalogMode } from "./components/catalog-mode";
import { OperationsMode } from "./components/operations-mode";
import { LaunchMode } from "./components/launch-mode";

type HeroSection = { imageUrl?: string; coverImageUrl?: string; headline?: string; subheadline?: string };
type SocialProofSection = { testimonials?: unknown[] };
type BusinessHourEntry = { enabled?: boolean };
type AppearanceSection = { primaryColor?: string; secondaryColor?: string; accentColor?: string };

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
  const dirRef = useRef(0);
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

  useEffect(() => {
    if (!s.businessId) return;
    ai.updateStoreContext({
      businessId: s.businessId,
      activeView: activeTab,
      itemCount: s.commerceProducts.length,
      products: s.commerceProducts,
      services: s.services,
      testimonials: (s.storefrontConfig.socialProof as SocialProofSection | undefined)?.testimonials ?? [],
      storeEnabled: s.storeEnabled,
      hasHeroImage: !!(s.storefrontConfig.hero as HeroSection | undefined)?.imageUrl,
      hasLogo: !!s.businessData?.logoUrl,
      hoursConfigured: Object.values(s.businessHours).some((h) => (h as BusinessHourEntry)?.enabled),
      storeName: s.businessData?.name,
    });
  }, [s.businessId, activeTab, s.commerceProducts.length, s.services.length, s.storeEnabled, s.businessData, s.storefrontConfig, s.businessHours]);

  const handleTabChange = useCallback((key: string) => {
    if (!TAB_KEYS.includes(key as TabKey)) return;
    dirRef.current = TAB_KEYS.indexOf(key as TabKey) > TAB_KEYS.indexOf(activeTab) ? 1 : -1;
    setActiveTab(key as TabKey);
    setCurrentMeta({ tab: key === "overview" ? null : key });
    s.emitEvent("module:tab_changed", "store", { tab: key });
    const url = new URL(window.location.href);
    key === "overview" ? url.searchParams.delete("tab") : url.searchParams.set("tab", key);
    window.history.replaceState({}, "", url.toString());
  }, [activeTab, s.emitEvent, setCurrentMeta]);

  const shortcuts = useMemo<ShortcutGroup[]>(() => [{
    groupName: "Store",
    shortcuts: [
      { key: "1", description: "Overview", action: () => handleTabChange("overview") },
      { key: "2", description: "Design", action: () => handleTabChange("design") },
      { key: "3", description: "Merchandising", action: () => handleTabChange("merchandising") },
      { key: "4", description: "Catalog", action: () => handleTabChange("catalog") },
      { key: "5", description: "Operations", action: () => handleTabChange("operations") },
      { key: "6", description: "Launch", action: () => handleTabChange("launch") },
      { key: "r", description: "Refresh", action: () => { void s.loadData(); } },
    ],
  }], [handleTabChange, s.loadData]);
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
            <img src={coverImage} alt="" className="w-full h-full object-cover" />
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

        <div className="relative px-5 pt-5 pb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3.5 min-w-0">
              {logoUrl ? (
                <div className="h-12 w-12 rounded-2xl flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ border: `2px solid ${pc}30`, boxShadow: `0 4px 16px ${pc}15`, background: "hsl(var(--kf-card))" }}>
                  <img src={logoUrl} alt="" className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="h-12 w-12 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: `linear-gradient(135deg, ${pc}, ${sc})`, boxShadow: `0 4px 16px ${pc}25` }}>
                  <Store className="w-5 h-5 text-white" />
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold tracking-tight truncate" style={{ color: "hsl(var(--kf-foreground))" }}>{storeName}</h1>
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0" style={{
                    background: s.storeEnabled ? "hsl(var(--kf-success)/0.12)" : "hsl(var(--kf-warning)/0.12)",
                    color: s.storeEnabled ? "hsl(var(--kf-success))" : "hsl(var(--kf-warning))",
                  }}>
                    <div className="w-1.5 h-1.5 rounded-full" style={{
                      background: s.storeEnabled ? "hsl(var(--kf-success))" : "hsl(var(--kf-warning))",
                      boxShadow: s.storeEnabled ? "0 0 6px hsl(var(--kf-success)/0.4)" : "none",
                    }} />
                    {s.storeEnabled ? "Live" : "Draft"}
                  </div>
                  <PageGuideTrigger moduleKey="store" />
                </div>
                <p className="text-xs mt-0.5 truncate" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                  {s.storeEnabled && s.getPublicBookingUrl() ? s.getPublicBookingUrl().replace("https://", "") : "Presence Studio — your storefront workspace"}
                </p>
              </div>
            </div>
            <StoreHeaderActions storeEnabled={s.storeEnabled} publicUrl={s.getPublicBookingUrl()} onToggleEnabled={s.toggleStoreEnabled} />
          </div>
        </div>
      </div>

      <div data-walkthrough="store-setup">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.35)" }}>
          <div className="flex items-center overflow-x-auto scrollbar-none p-1 gap-0.5">
            {VIEW_TABS.map(({ key, label, icon: Icon }) => {
              const isActive = activeTab === key;
              return (
                <button
                  key={key}
                  onClick={() => handleTabChange(key)}
                  className="relative flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all whitespace-nowrap min-h-[40px] flex-shrink-0"
                  style={{ color: isActive ? "hsl(var(--kf-foreground))" : "hsl(var(--kf-muted-foreground))" }}
                  aria-selected={isActive}
                  role="tab"
                >
                  {isActive && (
                    <motion.div
                      layoutId="studio-active-mode"
                      className="absolute inset-0 rounded-xl"
                      style={{ background: `${pc}12`, border: `1px solid ${pc}25`, boxShadow: `0 2px 8px ${pc}10` }}
                      transition={{ type: "spring", bounce: 0.12, duration: 0.38 }}
                    />
                  )}
                  <Icon className="w-3.5 h-3.5 relative z-10 flex-shrink-0" style={isActive ? { color: pc } : undefined} />
                  <span className="relative z-10">{label}</span>
                  {isActive && (
                    <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full relative z-10" style={{ background: pc }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="touch-pan-y">
        <AnimatePresence mode="wait" custom={dirRef.current}>
          <motion.div
            key={activeTab}
            custom={dirRef.current}
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
                storefrontConfig={cfg}
                onConfigChange={s.handleConfigChange}
                onSaveConfig={s.handleSaveConfig}
                configSaving={s.configSaving}
                publicUrl={s.getPublicBookingUrl()}
                hasTestimonials={hasTestimonials}
              />
            )}
            {activeTab === "catalog" && (
              <CatalogMode
                commerceProducts={s.commerceProducts}
                storeServiceNames={s.storeServiceNames}
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
                hasHeroImage={hasHeroImage}
                hoursConfigured={hoursConfigured}
                hasTestimonials={hasTestimonials}
                onModeChange={handleTabChange}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <PageGuide moduleKey="store" walkthroughSteps={STORE_WALKTHROUGH} />
    </div>
  );
}
