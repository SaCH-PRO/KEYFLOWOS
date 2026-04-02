"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Store } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { useSwipeTabs } from "@/hooks/use-swipe-tabs";
import { useKeyboardShortcuts, type ShortcutGroup } from "@/hooks/use-keyboard-shortcuts";
import { WorkspaceError } from "@/components/ui/workspace-error";
import { FeatureGuide } from "@/components/ui/feature-guide";
import { ModuleWalkthrough } from "@/components/ui/module-walkthrough";
import { InfoBadge } from "@/components/ui/info-badge";
import { STORE_WALKTHROUGH } from "@/lib/walkthrough-definitions";
import { SetupModeBanner } from "@/components/ui/setup-mode-banner";
import { useStoreAiHub } from "./hooks/use-store-ai-hub";
import { useStoreData } from "./hooks/use-store-data";
import { StoreSkeleton } from "./components/store-skeleton";
import { StoreHeaderActions } from "./components/store-header-actions";
import { StorefrontTab } from "./components/storefront-tab";
import { ProductsHoursTab } from "./components/products-hours-tab";
import { PerformanceTab } from "./components/performance-tab";
import { VIEW_TABS, type TabKey } from "./components/store-types";

type HeroSection = { imageUrl?: string; coverImageUrl?: string };
type SocialProofSection = { testimonials?: unknown[] };
type BusinessHourEntry = { enabled?: boolean };

const TAB_KEYS = VIEW_TABS.map((t) => t.key);
const SLIDE = {
  enter: (d: number) => ({ x: d > 0 ? 60 : -60, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (d: number) => ({ x: d > 0 ? -60 : 60, opacity: 0 }),
};
const GUIDE_STEPS = [
  { title: "Configure Storefront", description: "Set your URL, customize appearance, and add social proof." },
  { title: "Add Products & Hours", description: "List your offerings and set your business hours." },
  { title: "Track Performance", description: "Monitor readiness, conversions, and analytics." },
];

export default function StorePage() {
  const searchParams = useSearchParams();
  const s = useStoreData();
  const ai = useStoreAiHub();
  const [activeTab, setActiveTab] = useState<TabKey>("storefront");
  const dirRef = useRef(0);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    const p = searchParams.get("tab");
    if (p && TAB_KEYS.includes(p as TabKey)) { setActiveTab(p as TabKey); initRef.current = true; }
  }, [searchParams]);

  useEffect(() => {
    if (!s.businessId) return;
    ai.updateStoreContext({
      businessId: s.businessId, activeView: activeTab,
      itemCount: activeTab === "products" ? s.commerceProducts.length : s.services.length,
      products: s.commerceProducts, services: s.services,
      testimonials: (s.storefrontConfig.socialProof as SocialProofSection | undefined)?.testimonials ?? [],
      storeEnabled: s.storeEnabled, hasHeroImage: !!(s.storefrontConfig.hero as HeroSection | undefined)?.imageUrl,
      hasLogo: !!s.businessData?.logoUrl,
      hoursConfigured: Object.values(s.businessHours).some((h) => (h as BusinessHourEntry)?.enabled),
      storeName: s.businessData?.name,
    });
  }, [s.businessId, activeTab, s.commerceProducts.length, s.services.length, s.storeEnabled, s.businessData, s.storefrontConfig, s.businessHours]);

  const handleTabChange = useCallback((key: string) => {
    if (!TAB_KEYS.includes(key as TabKey)) return;
    dirRef.current = TAB_KEYS.indexOf(key as TabKey) > TAB_KEYS.indexOf(activeTab) ? 1 : -1;
    setActiveTab(key as TabKey);
    s.emitEvent("module:tab_changed", "store", { tab: key });
    const url = new URL(window.location.href);
    key === "storefront" ? url.searchParams.delete("tab") : url.searchParams.set("tab", key);
    window.history.replaceState({}, "", url.toString());
  }, [activeTab, s.emitEvent]);

  const { swipeHandlers } = useSwipeTabs({ tabs: TAB_KEYS, activeTab, onTabChange: handleTabChange });

  const shortcuts = useMemo<ShortcutGroup[]>(() => [{ groupName: "Store",
    shortcuts: [
      { key: "1", description: "Storefront", action: () => handleTabChange("storefront") },
      { key: "2", description: "Products & Hours", action: () => handleTabChange("products") },
      { key: "3", description: "Performance", action: () => handleTabChange("performance") },
      { key: "r", description: "Refresh", action: () => { void s.loadData(); } },
    ],
  }], [handleTabChange, s.loadData]);
  useKeyboardShortcuts(shortcuts, !s.loading);

  if (s.loading) return <div className="space-y-6"><PageHeader icon={Store} title="Store Setup" subtitle="Configure your public storefront" /><StoreSkeleton /></div>;
  if (!s.businessId) return <WorkspaceError />;

  const cfg = s.storefrontConfig;
  return (
    <div className="space-y-6" aria-label="Store Setup">
      <SetupModeBanner label="You're in Setup Mode — configure your storefront, products, and hours" settingsHref="/app/settings/business" />
      <PageHeader icon={Store} title="Store Setup"
        subtitle={<span className="inline-flex items-center gap-1.5">{s.services.length} services · {s.commerceProducts.length} products · {s.storeEnabled ? "Live" : "Draft"} <InfoBadge title="Store Status" body={s.storeEnabled ? "Your store is live and visible to the public. Customers can browse and book." : "Your store is in draft mode. Publish it from the toggle above to make it visible."} iconSize={12} /></span>}
        titleExtra={<FeatureGuide featureKey="store" title="Getting Started with Your Store" description="Set up your online storefront to accept bookings and sell products." steps={GUIDE_STEPS} />}
        rightSlot={<StoreHeaderActions storeEnabled={s.storeEnabled} publicUrl={s.getPublicBookingUrl()} onToggleEnabled={s.toggleStoreEnabled} />}
      />
      <div data-walkthrough="store-setup">
        <TabNav tabs={VIEW_TABS} activeTab={activeTab} onTabChange={handleTabChange} layoutId="store-tab-pill" />
      </div>
      <div {...swipeHandlers} className="touch-pan-y">
        <AnimatePresence mode="wait" custom={dirRef.current}>
          <motion.div key={activeTab} custom={dirRef.current} variants={SLIDE} initial="enter" animate="center" exit="exit" transition={{ type: "spring", bounce: 0.15, duration: 0.35 }}>
            {activeTab === "storefront" && <div data-walkthrough="store-customize"><StorefrontTab businessId={s.businessId} storeEnabled={s.storeEnabled} slug={s.storeSlug} currentSlug={s.businessData?.slug ?? null} publicUrl={s.getPublicBookingUrl()} onSlugChange={s.setStoreSlug} onSaveSlug={s.handleSaveSlug} slugSaving={s.slugSaving} storefrontConfig={cfg} onConfigChange={s.handleConfigChange} onSaveConfig={s.handleSaveConfig} configSaving={s.configSaving} businessData={s.businessData} services={s.services} commerceProducts={s.commerceProducts} hasHeroImage={!!(cfg.hero as HeroSection | undefined)?.imageUrl || !!(cfg.hero as HeroSection | undefined)?.coverImageUrl} hoursConfigured={Object.values(s.businessHours).some((h) => (h as BusinessHourEntry)?.enabled)} hasTestimonials={!!((cfg.socialProof as SocialProofSection | undefined)?.testimonials?.length)} onTabChange={handleTabChange} /></div>}
            {activeTab === "products" && <ProductsHoursTab commerceProducts={s.commerceProducts} storeServiceNames={s.storeServiceNames} storeItemCount={s.storeItemCount} processingItems={s.processingItems} confirmRemove={s.confirmRemove} onToggleItem={s.handleToggleStoreItem} onSelectAll={s.handleSelectAll} onDeselectAll={s.handleDeselectAll} onConfirmRemoveChange={s.setConfirmRemove} onDeleteFromStore={s.handleDeleteServiceFromStore} services={s.services} businessHours={s.businessHours} onHoursChange={s.setBusinessHours} onSaveHours={s.handleSaveHours} hoursSaving={s.hoursSaving} />}
            {activeTab === "performance" && <div data-walkthrough="store-analytics"><PerformanceTab businessId={s.businessId} storeEnabled={s.storeEnabled} publicUrl={s.getPublicBookingUrl()} servicesCount={s.services.length} productsCount={s.commerceProducts.length} driftedCount={s.driftedItems.length} analytics={s.overviewAnalytics} businessName={s.businessData?.name} onTabChange={handleTabChange} /></div>}
          </motion.div>
        </AnimatePresence>
      </div>

      <ModuleWalkthrough moduleKey="store" steps={STORE_WALKTHROUGH} />
    </div>
  );
}
