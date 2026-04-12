"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Store, Package, Clock, ShoppingBag, TrendingUp,
  Zap, ExternalLink, ArrowUpRight,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useSwipeTabs } from "@/hooks/use-swipe-tabs";
import { useKeyboardShortcuts, type ShortcutGroup } from "@/hooks/use-keyboard-shortcuts";
import { WorkspaceError } from "@/components/ui/workspace-error";
import { ModuleWalkthrough, WalkthroughTrigger } from "@/components/ui/module-walkthrough";
import { InfoBadge } from "@/components/ui/info-badge";
import { STORE_WALKTHROUGH } from "@/lib/walkthrough-definitions";
import { useStoreAiHub } from "./hooks/use-store-ai-hub";
import { useStoreData } from "./hooks/use-store-data";
import { StoreSkeleton } from "./components/store-skeleton";
import { StoreHeaderActions } from "./components/store-header-actions";
import { StorefrontTab } from "./components/storefront-tab";
import { ProductsHoursTab } from "./components/products-hours-tab";
import { FulfillmentTab } from "./components/fulfillment-tab";
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

const STAT_CARDS = [
  { key: "products", label: "Products", icon: Package, color: "--kf-accent1" },
  { key: "services", label: "Services", icon: ShoppingBag, color: "--kf-accent2" },
  { key: "catalog", label: "In Store", icon: TrendingUp, color: "--kf-success" },
];

export default function StorePage() {
  const searchParams = useSearchParams();
  const s = useStoreData();
  const ai = useStoreAiHub();
  const [activeTab, setActiveTab] = useState<TabKey>("setup");
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
      itemCount: s.commerceProducts.length,
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
    key === "setup" ? url.searchParams.delete("tab") : url.searchParams.set("tab", key);
    window.history.replaceState({}, "", url.toString());
  }, [activeTab, s.emitEvent]);

  const { swipeHandlers } = useSwipeTabs({ tabs: TAB_KEYS, activeTab, onTabChange: handleTabChange });

  const shortcuts = useMemo<ShortcutGroup[]>(() => [{ groupName: "Store",
    shortcuts: [
      { key: "1", description: "My Store", action: () => handleTabChange("setup") },
      { key: "2", description: "Orders", action: () => handleTabChange("orders") },
      { key: "r", description: "Refresh", action: () => { void s.loadData(); } },
    ],
  }], [handleTabChange, s.loadData]);
  useKeyboardShortcuts(shortcuts, !s.loading);

  if (s.loading) return <StoreSkeleton />;
  if (s.loadError) return <WorkspaceError title="Failed to load store" description={s.loadError} />;
  if (!s.businessId) return <WorkspaceError />;

  const cfg = s.storefrontConfig;
  const statValues = {
    products: s.commerceProducts.length,
    services: s.services.length,
    catalog: s.storeItemCount ?? s.commerceProducts.length + s.services.length,
  };

  return (
    <div className="space-y-0" aria-label="Store">
      <div
        className="relative rounded-2xl overflow-hidden mb-6"
        style={{
          background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.12) 0%, hsl(var(--kf-accent2) / 0.08) 50%, hsl(var(--kf-card) / 0.6) 100%)",
          border: "1px solid hsl(var(--kf-border) / 0.15)",
        }}
      >
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full opacity-[0.06]" style={{ background: "radial-gradient(circle, hsl(var(--kf-accent1)), transparent 70%)" }} />
          <div className="absolute -bottom-16 -left-16 w-64 h-64 rounded-full opacity-[0.04]" style={{ background: "radial-gradient(circle, hsl(var(--kf-accent2)), transparent 70%)" }} />
        </div>

        <div className="relative px-6 pt-6 pb-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div
                className="h-12 w-12 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{
                  background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                  boxShadow: "0 4px 16px hsl(var(--kf-accent1) / 0.3)",
                }}
              >
                <Store className="w-6 h-6" style={{ color: "white" }} />
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-xl font-bold" style={{ color: "hsl(var(--kf-foreground))" }}>
                    {s.businessData?.name || "My Store"}
                  </h1>
                  <div
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
                    style={{
                      background: s.storeEnabled
                        ? "hsl(var(--kf-success) / 0.15)"
                        : "hsl(var(--kf-warning) / 0.15)",
                      color: s.storeEnabled
                        ? "hsl(var(--kf-success))"
                        : "hsl(var(--kf-warning))",
                      border: `1px solid ${s.storeEnabled ? "hsl(var(--kf-success) / 0.3)" : "hsl(var(--kf-warning) / 0.3)"}`,
                    }}
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full"
                      style={{
                        background: s.storeEnabled ? "hsl(var(--kf-success))" : "hsl(var(--kf-warning))",
                        boxShadow: s.storeEnabled ? "0 0 6px hsl(var(--kf-success) / 0.5)" : "none",
                      }}
                    />
                    {s.storeEnabled ? "Live" : "Draft"}
                  </div>
                  <WalkthroughTrigger moduleKey="store" />
                </div>
                <p className="text-sm mt-0.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                  Your online storefront and order management
                </p>
              </div>
            </div>
            <StoreHeaderActions storeEnabled={s.storeEnabled} publicUrl={s.getPublicBookingUrl()} onToggleEnabled={s.toggleStoreEnabled} />
          </div>

          <div className="grid grid-cols-3 gap-3 mt-5">
            {STAT_CARDS.map(({ key, label, icon: Icon, color }) => (
              <div
                key={key}
                className="rounded-xl px-4 py-3 flex items-center gap-3 transition-all hover:scale-[1.02]"
                style={{
                  background: `hsl(var(${color}) / 0.06)`,
                  border: `1px solid hsl(var(${color}) / 0.12)`,
                }}
              >
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `hsl(var(${color}) / 0.12)` }}
                >
                  <Icon className="w-4 h-4" style={{ color: `hsl(var(${color}))` }} />
                </div>
                <div>
                  <div className="text-lg font-bold" style={{ color: "hsl(var(--kf-foreground))" }}>
                    {statValues[key as keyof typeof statValues]}
                  </div>
                  <div className="text-[11px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                    {label}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {s.storeEnabled && s.getPublicBookingUrl() && (
            <a
              href={s.getPublicBookingUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium transition-all hover:scale-[1.02] min-h-[44px]"
              style={{
                background: "hsl(var(--kf-accent1) / 0.1)",
                color: "hsl(var(--kf-accent1))",
                border: "1px solid hsl(var(--kf-accent1) / 0.2)",
              }}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View Live Store
              <ArrowUpRight className="w-3 h-3 opacity-60" />
            </a>
          )}
        </div>
      </div>

      <div className="mb-6" data-walkthrough="store-setup">
        <div className="flex gap-1 p-1 rounded-xl" role="tablist" style={{ background: "hsl(var(--kf-muted) / 0.08)", border: "1px solid hsl(var(--kf-border) / 0.1)" }}>
          {VIEW_TABS.map(({ key, label, icon: Icon }) => {
            const isActive = activeTab === key;
            return (
              <button
                key={key}
                onClick={() => handleTabChange(key)}
                className="relative flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all min-h-[44px]"
                style={{
                  color: isActive ? "hsl(var(--kf-foreground))" : "hsl(var(--kf-muted-foreground))",
                }}
                aria-selected={isActive}
                role="tab"
              >
                {isActive && (
                  <motion.div
                    layoutId="store-active-tab"
                    className="absolute inset-0 rounded-lg"
                    style={{
                      background: "hsl(var(--kf-card))",
                      border: "1px solid hsl(var(--kf-border) / 0.2)",
                      boxShadow: "0 2px 8px hsl(var(--kf-background) / 0.4)",
                    }}
                    transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                  />
                )}
                <Icon className="w-4 h-4 relative z-10" />
                <span className="relative z-10">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div {...swipeHandlers} className="touch-pan-y">
        <AnimatePresence mode="wait" custom={dirRef.current}>
          <motion.div key={activeTab} custom={dirRef.current} variants={SLIDE} initial="enter" animate="center" exit="exit" transition={{ type: "spring", bounce: 0.15, duration: 0.35 }}>
            {activeTab === "setup" && (
              <div data-walkthrough="store-customize" className="space-y-6">
                <StorefrontTab businessId={s.businessId} storeEnabled={s.storeEnabled} slug={s.storeSlug} currentSlug={s.businessData?.slug ?? null} publicUrl={s.getPublicBookingUrl()} onSlugChange={s.setStoreSlug} onSaveSlug={s.handleSaveSlug} slugSaving={s.slugSaving} storefrontConfig={cfg} onConfigChange={s.handleConfigChange} onSaveConfig={s.handleSaveConfig} configSaving={s.configSaving} businessData={s.businessData} services={s.services} commerceProducts={s.commerceProducts} hasHeroImage={!!(cfg.hero as HeroSection | undefined)?.imageUrl || !!(cfg.hero as HeroSection | undefined)?.coverImageUrl} hoursConfigured={Object.values(s.businessHours).some((h) => (h as BusinessHourEntry)?.enabled)} hasTestimonials={!!((cfg.socialProof as SocialProofSection | undefined)?.testimonials?.length)} onTabChange={handleTabChange} />
                <ProductsHoursTab commerceProducts={s.commerceProducts} storeServiceNames={s.storeServiceNames} storeItemCount={s.storeItemCount} processingItems={s.processingItems} confirmRemove={s.confirmRemove} onToggleItem={s.handleToggleStoreItem} onSelectAll={s.handleSelectAll} onDeselectAll={s.handleDeselectAll} onConfirmRemoveChange={s.setConfirmRemove} onDeleteFromStore={s.handleDeleteServiceFromStore} services={s.services} businessHours={s.businessHours} onHoursChange={s.setBusinessHours} onSaveHours={s.handleSaveHours} hoursSaving={s.hoursSaving} onReorderProducts={s.handleReorderProducts} />
              </div>
            )}
            {activeTab === "orders" && <FulfillmentTab businessId={s.businessId} />}
          </motion.div>
        </AnimatePresence>
      </div>

      <ModuleWalkthrough moduleKey="store" steps={STORE_WALKTHROUGH} />
    </div>
  );
}
