"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Store,
  BarChart3,
  Palette,
  ShoppingBag,
  Clock,
  Settings2,
  AlertCircle,
} from "lucide-react";
// Note: AlertCircle still used for unpublished banner
import {
  Service,
  StaffMember,
  fetchServices,
  fetchStaff,
  getBusinessById,
  updateBusiness,
  createService,
  deleteService,
  updateService,
  fetchProducts,
  Product,
  StorefrontConfig,
  fetchStorefrontConfig,
  updateStorefrontConfig,
} from "@/lib/client";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { onProductsChanged, hasProductChangedSinceLastFetch, markProductsFetched } from "@/lib/product-sync";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { useSwipeTabs } from "@/hooks/use-swipe-tabs";
import { useKeyboardShortcuts, type ShortcutGroup } from "@/hooks/use-keyboard-shortcuts";
import { useSearchParams } from "next/navigation";
import { useModuleEmit } from "@/hooks/use-module-events";
import { AiCommandHub, AiHubTrigger } from "@/components/ai/ai-command-hub";
import { WorkspaceError } from "@/components/ui/workspace-error";
import { useStoreAiHub } from "./hooks/use-store-ai-hub";
import { renderStoreToolResult } from "./components/store-tool-results";
import { FeatureGuide } from "@/components/ui/feature-guide";
import { StoreSkeleton } from "./components/store-skeleton";
import { StoreHeaderActions } from "./components/store-header-actions";
import { StoreSettings } from "./components/store-settings";
import { HoursEditor, DEFAULT_HOURS, type BusinessHoursMap } from "./components/hours-editor";
import { CatalogManager } from "./components/catalog-manager";
import { StorefrontPreview } from "./components/storefront-preview";
import { AppearanceCustomizer } from "./components/appearance-customizer";
import { MerchandisingPanel } from "./components/merchandising-panel";
import { StoreAnalyticsDashboard } from "./components/store-analytics";
import { StoreCommandHero } from "./components/store-command-hero";
import { ConversionInsightsPanel } from "./components/conversion-insights";
import { SocialProofPanel } from "./components/social-proof-panel";
import type { DriftedItem } from "./components/store-types";
import { fetchStoreAnalytics, StoreAnalytics } from "@/lib/client";

type StoreTab = "overview" | "customize" | "products" | "hours" | "settings";

const TABS: { key: StoreTab; label: string; icon: React.ElementType }[] = [
  { key: "overview", label: "Overview", icon: BarChart3 },
  { key: "products", label: "Products", icon: ShoppingBag },
  { key: "hours", label: "Hours", icon: Clock },
  { key: "settings", label: "Settings", icon: Settings2 },
  { key: "customize", label: "Customize", icon: Palette },
];

const TAB_KEYS = TABS.map((t) => t.key);

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 60 : -60, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -60 : 60, opacity: 0 }),
};

export default function StorePage() {
  const searchParams = useSearchParams();
  const emitEvent = useModuleEmit();
  const storeAi = useStoreAiHub();

  const [businessId, setBusinessId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<StoreTab>("overview");
  const [loading, setLoading] = useState(true);

  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [commerceProducts, setCommerceProducts] = useState<Product[]>([]);
  const [businessData, setBusinessData] = useState<{
    name?: string;
    slug?: string | null;
    logoUrl?: string | null;
    tagline?: string | null;
    description?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    primaryColor?: string | null;
    secondaryColor?: string | null;
    storeEnabled?: boolean;
  } | null>(null);

  const [storeSlug, setStoreSlug] = useState("");
  const [slugSaving, setSlugSaving] = useState(false);
  const [processingItems, setProcessingItems] = useState<Set<string>>(new Set());
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [storeEnabled, setStoreEnabled] = useState(true);
  const [businessHours, setBusinessHours] = useState<BusinessHoursMap>(DEFAULT_HOURS);
  const [hoursSaving, setHoursSaving] = useState(false);
  const [driftedItems, setDriftedItems] = useState<DriftedItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [overviewAnalytics, setOverviewAnalytics] = useState<StoreAnalytics | null>(null);

  const [storefrontConfig, setStorefrontConfig] = useState<StorefrontConfig>({
    hero: {},
    appearance: {},
    merchandising: {},
    promotions: {},
    socialProof: {},
    seo: {},
  });
  const [configSaving, setConfigSaving] = useState(false);

  const directionRef = useRef<number>(0);
  const initialTabSet = useRef(false);

  useEffect(() => {
    if (initialTabSet.current) return;
    const tabParam = searchParams.get("tab");
    if (tabParam && TAB_KEYS.includes(tabParam as StoreTab)) {
      setActiveTab(tabParam as StoreTab);
      initialTabSet.current = true;
    }
  }, [searchParams]);

  useEffect(() => {
    const initWorkspace = async () => {
      const fresh = await refreshWorkspace();
      if (fresh) {
        setBusinessId(fresh);
        return;
      }
      const stored = getStoredBusinessId();
      if (stored) setBusinessId(stored);
    };
    void initWorkspace();
  }, []);

  const loadData = useCallback(async (showLoader = false) => {
    if (!businessId) return;
    if (showLoader) setLoading(true);
    try {
      const [servicesRes, staffRes, bizRes, productsRes] = await Promise.all([
        fetchServices(businessId),
        fetchStaff(businessId),
        getBusinessById(businessId).catch(() => ({ data: null, error: null })),
        fetchProducts(businessId).catch(() => ({ data: null, error: null })),
      ]);
      const loadedServices = servicesRes.data ?? [];
      const loadedProducts = (productsRes as any)?.data ?? [];
      setServices(loadedServices);
      setStaff(staffRes.data ?? []);
      setCommerceProducts(loadedProducts);
      if (loadedProducts.length > 0 || !(productsRes as any)?.error) {
        markProductsFetched();
      }
      if (bizRes.data) {
        setBusinessData(bizRes.data);
        setStoreSlug(bizRes.data.slug ?? "");
        setStoreEnabled((bizRes.data as any).storeEnabled ?? true);
        if ((bizRes.data as any).businessHours) {
          setBusinessHours({ ...DEFAULT_HOURS, ...(bizRes.data as any).businessHours });
        }
      }
      const drifts: DriftedItem[] = [];
      for (const svc of loadedServices) {
        const product = loadedProducts.find((p: Product) => p.name === svc.name);
        if (!product) continue;
        const priceDiff = Math.abs(svc.price - product.price) > 0.01;
        const svcDuration = (svc as any).durationMins ?? (svc as any).duration ?? null;
        const durationDiff = product.duration != null && svcDuration != null && svcDuration !== product.duration;
        if (priceDiff || durationDiff) {
          drifts.push({
            serviceId: svc.id,
            serviceName: svc.name,
            priceDiff,
            durationDiff,
            commercePrice: product.price,
            commerceDuration: product.duration ?? null,
          });
        }
      }
      setDriftedItems(drifts);

      const [configRes, analyticsRes] = await Promise.all([
        fetchStorefrontConfig(businessId).catch(() => ({ data: null, error: null })),
        fetchStoreAnalytics(businessId, 30).catch(() => ({ data: null, error: null })),
      ]);
      if (configRes.data) setStorefrontConfig(configRes.data);
      if (analyticsRes.data) setOverviewAnalytics(analyticsRes.data);
    } catch (e) {
      console.error("Failed to load store data:", e);
      toast.error("Failed to load store data");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void loadData(true);
  }, [loadData]);

  useEffect(() => {
    if (businessId && hasProductChangedSinceLastFetch()) {
      void loadData();
    }
  }, [businessId, loadData]);

  useEffect(() => {
    const unsub = onProductsChanged(() => {
      void loadData();
    });
    const handleFocus = () => {
      if (hasProductChangedSinceLastFetch()) void loadData();
    };
    window.addEventListener("focus", handleFocus);
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && hasProductChangedSinceLastFetch()) void loadData();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      unsub();
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [loadData]);

  const handleTabChange = useCallback((key: string) => {
    const newIndex = TAB_KEYS.indexOf(key as StoreTab);
    const oldIndex = TAB_KEYS.indexOf(activeTab);
    directionRef.current = newIndex > oldIndex ? 1 : -1;
    setActiveTab(key as StoreTab);
    emitEvent("module:tab_changed", "store", { tab: key });
    const url = new URL(window.location.href);
    if (key === "overview") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", key);
    }
    window.history.replaceState({}, "", url.toString());
  }, [activeTab, emitEvent]);

  const { swipeHandlers } = useSwipeTabs({
    tabs: TAB_KEYS,
    activeTab,
    onTabChange: handleTabChange,
  });

  useEffect(() => {
    if (businessId) {
      storeAi.updateStoreContext({
        businessId,
        activeView: activeTab,
        itemCount: activeTab === "products" ? commerceProducts.length : services.length,
        products: commerceProducts,
        services,
        testimonials: (storefrontConfig.socialProof as any)?.testimonials ?? [],
        storeEnabled,
        hasHeroImage: !!(storefrontConfig.hero as any)?.imageUrl,
        hasLogo: !!businessData?.logoUrl,
        hoursConfigured: Object.values(businessHours).some((h: any) => h?.enabled),
        storeName: businessData?.name,
      });
    }
  }, [businessId, activeTab, commerceProducts.length, services.length, storeEnabled, businessData, storefrontConfig, businessHours]);

  function getPublicBookingUrl() {
    const domain = typeof window !== "undefined" ? window.location.origin : "";
    const identifier = storeSlug || businessId;
    return identifier ? `${domain}/book/${identifier}` : "";
  }

  async function handleSaveSlug() {
    if (!businessId || !storeSlug.trim()) return;
    setSlugSaving(true);
    const slug = storeSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
    setStoreSlug(slug);
    const res = await updateBusiness({ businessId, slug });
    if (res.error) {
      toast.error(`Failed to save URL: ${res.error}`);
    } else {
      toast.success("Public booking URL saved!");
      setBusinessData((prev) => (prev ? { ...prev, slug } : prev));
    }
    setSlugSaving(false);
  }

  async function toggleStoreEnabled() {
    if (!businessId) return;
    const newValue = !storeEnabled;
    const res = await updateBusiness({ businessId, storeEnabled: newValue } as any);
    if (res.error) {
      toast.error(`Failed to update store status: ${res.error}`);
    } else {
      setStoreEnabled(newValue);
      setBusinessData((prev) => (prev ? { ...prev, storeEnabled: newValue } : prev));
      emitEvent("store:status_changed", "store", { enabled: newValue });
      if (newValue) {
        toast.success("Store is now published!");
      } else {
        toast.info("Store is now unpublished.");
      }
    }
  }

  async function handleSaveHours() {
    if (!businessId) return;
    setHoursSaving(true);
    const res = await updateBusiness({ businessId, businessHours } as any);
    if (res.error) {
      toast.error(`Failed to save hours: ${res.error}`);
    } else {
      toast.success("Business hours saved!");
      emitEvent("store:hours_updated", "store", {});
    }
    setHoursSaving(false);
  }

  async function syncDriftedItems() {
    if (!businessId || driftedItems.length === 0) return;
    setSyncing(true);
    let synced = 0;
    for (const drift of driftedItems) {
      const data: { price?: number; duration?: number } = {};
      if (drift.priceDiff) data.price = drift.commercePrice;
      if (drift.durationDiff && drift.commerceDuration != null) data.duration = drift.commerceDuration;
      const res = await updateService(drift.serviceId, data, businessId);
      if (!res.error) synced++;
    }
    toast.success(`Synced ${synced} item${synced !== 1 ? "s" : ""} with Commerce prices.`);
    setSyncing(false);
    await loadData();
  }

  async function handleQuickAddProduct(product: Product) {
    if (!businessId) return;
    const existingService = services.find((s) => s.name === product.name);
    if (existingService) {
      toast.warning(`A service named '${product.name}' already exists in your store.`);
      return;
    }
    setProcessingItems((prev) => new Set(prev).add(product.id));
    try {
      const res = await createService({
        businessId,
        name: product.name,
        durationMins: product.duration ?? 30,
        price: product.price,
        description: product.description ?? undefined,
      });
      if (res.error) {
        toast.error(`Failed to add: ${res.error}`);
      } else {
        toast.success(`"${product.name}" added to store!`);
        emitEvent("store:item_added", "store", { productName: product.name });
        await loadData();
      }
    } finally {
      setProcessingItems((prev) => {
        const n = new Set(prev);
        n.delete(product.id);
        return n;
      });
    }
  }

  async function handleDeleteServiceFromStore(serviceId: string, productName?: string) {
    if (!businessId) return;
    const matchedProduct = commerceProducts.find(
      (p) => p.name === (productName ?? services.find((s) => s.id === serviceId)?.name)
    );
    const productId = matchedProduct?.id;
    if (productId && confirmRemove !== productId) {
      setConfirmRemove(productId);
      return;
    }
    setConfirmRemove(null);
    if (matchedProduct) setProcessingItems((prev) => new Set(prev).add(matchedProduct.id));
    try {
      const res = await deleteService(serviceId, businessId);
      if (res.error) {
        toast.error(`Failed to remove: ${res.error}`);
      } else {
        toast.info("Removed from store.");
        await loadData();
      }
    } finally {
      if (matchedProduct)
        setProcessingItems((prev) => {
          const n = new Set(prev);
          n.delete(matchedProduct.id);
          return n;
        });
    }
  }

  async function handleToggleStoreItem(product: Product) {
    const matchedService = services.find((s) => s.name === product.name);
    if (matchedService) {
      await handleDeleteServiceFromStore(matchedService.id, product.name);
    } else {
      await handleQuickAddProduct(product);
    }
  }

  async function handleSelectAll() {
    const notAdded = commerceProducts.filter((p) => !services.some((s) => s.name === p.name));
    for (const p of notAdded) {
      await handleQuickAddProduct(p);
    }
  }

  async function handleDeselectAll() {
    const toRemove = services.filter((s) => commerceProducts.some((p) => p.name === s.name));
    for (const s of toRemove) {
      setConfirmRemove(null);
      await handleDeleteServiceFromStore(s.id);
    }
  }

  function handleConfigChange(section: string, updates: Record<string, any>) {
    setStorefrontConfig((prev) => ({
      ...prev,
      [section]: { ...(prev as any)[section], ...updates },
    }));
  }

  async function handleSaveConfig() {
    if (!businessId) return;
    setConfigSaving(true);
    const res = await updateStorefrontConfig(businessId, storefrontConfig);
    if (res.error) {
      toast.error("Failed to save storefront config");
    } else {
      toast.success("Storefront saved!");
      emitEvent("store:config_updated", "store", {});
    }
    setConfigSaving(false);
  }

  const handleAiAssistantAction = useCallback((actionKey: string) => {
    if (actionKey.startsWith("switch_tab:")) {
      const t = actionKey.split(":")[1];
      handleTabChange(t);
    } else if (actionKey.startsWith("tool:")) {
      const toolId = actionKey.split(":")[1];
      if (!storeAi.panelOpen) storeAi.setOpen(true);
      storeAi.executeTool(toolId);
    }
  }, [handleTabChange, storeAi]);

  const storeShortcuts = useMemo<ShortcutGroup[]>(() => [
    {
      groupName: "Store Navigation",
      shortcuts: [
        { key: "1", description: "Overview tab", action: () => handleTabChange("overview") },
        { key: "2", description: "Products tab", action: () => handleTabChange("products") },
        { key: "3", description: "Hours tab", action: () => handleTabChange("hours") },
        { key: "4", description: "Settings tab", action: () => handleTabChange("settings") },
        { key: "5", description: "Customize tab", action: () => handleTabChange("customize") },
        { key: "r", description: "Refresh data", action: () => { void loadData(); } },
        { key: "a", shift: true, description: "Toggle AI Hub", action: () => storeAi.togglePanel() },
        { key: "Escape", description: "Close panels", action: () => {
          if (storeAi.hubMode === "tool-result") storeAi.clearToolResult();
          else if (storeAi.panelOpen) storeAi.setOpen(false);
        } },
      ],
    },
  ], [handleTabChange, loadData, storeAi.togglePanel, storeAi.panelOpen, storeAi.setOpen, storeAi.hubMode, storeAi.clearToolResult]);

  useKeyboardShortcuts(storeShortcuts, !loading);

  const storeServiceNames = new Set(services.map((s) => s.name));
  const storeItemCount = services.filter((s) => commerceProducts.some((p) => p.name === s.name)).length;

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={Store}
          title="Store"
          subtitle="Your public storefront"
        />
        <StoreSkeleton />
      </div>
    );
  }

  if (!businessId) {
    return <WorkspaceError />;
  }

  return (
    <div className="space-y-6" aria-label="Store">
      <PageHeader
        icon={Store}
        title="Store"
        subtitle={`${services.length} services · ${commerceProducts.length} products · ${storeEnabled ? "Live" : "Draft"}`}
        titleExtra={
          <FeatureGuide
            featureKey="store"
            title="Getting Started with Your Store"
            description="Set up your online storefront to accept bookings and sell products."
            steps={[
              { title: "Add Products & Services", description: "List your offerings with pricing, descriptions, and images." },
              { title: "Set Business Hours", description: "Configure your availability so customers know when to book." },
              { title: "Customize Appearance", description: "Brand your storefront with colors, logo, and layout preferences." },
              { title: "Go Live", description: "Enable your store and share the public link with customers." },
              { title: "Track Performance", description: "Monitor readiness score, conversion insights, and SEO health." },
              { title: "AI Optimization", description: "Use AI tools for store optimization and SEO recommendations." },
            ]}
          />
        }
        rightSlot={
          <div className="flex items-center gap-2">
            <StoreHeaderActions
              storeEnabled={storeEnabled}
              publicUrl={getPublicBookingUrl()}
              onToggleEnabled={toggleStoreEnabled}
            />
            <button
              onClick={() => handleTabChange("customize")}
              className="inline-flex items-center justify-center w-9 h-9 rounded-xl transition-colors"
              style={{
                background: activeTab === "customize" ? "hsl(var(--kf-accent1)/0.15)" : "hsl(var(--kf-muted)/0.3)",
                border: activeTab === "customize" ? "1px solid hsl(var(--kf-accent1)/0.3)" : "1px solid hsl(var(--kf-border)/0.5)",
              }}
              aria-label="Customize store"
            >
              <Palette className="w-4 h-4" style={{ color: activeTab === "customize" ? "hsl(var(--kf-accent1))" : undefined }} />
            </button>
          </div>
        }
      />

      {!storeEnabled && (
        <div
          className="kf-card p-3 text-sm flex items-center gap-2"
          style={{ borderColor: "hsl(40 90% 50% / 0.4)", background: "hsl(40 90% 50% / 0.1)", color: "hsl(40 90% 90%)" }}
        >
          <AlertCircle className="w-4 h-4" />
          Your store is currently unpublished. Customers cannot see your booking page.
        </div>
      )}

      <AnimatePresence>
        {storeAi.panelOpen && (
          <AiCommandHub
            ai={storeAi}
            moduleName="Store"
            onAction={handleAiAssistantAction}
            toolResultRenderer={renderStoreToolResult}
          />
        )}
      </AnimatePresence>
      <AiHubTrigger ai={storeAi} moduleName="Store" />

      <TabNav
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        layoutId="store-tab-pill"
      />

      <div {...swipeHandlers} className="touch-pan-y">
        <AnimatePresence mode="wait" custom={directionRef.current}>
          <motion.div
            key={activeTab}
            custom={directionRef.current}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: "spring", bounce: 0.15, duration: 0.35 }}
          >
            {activeTab === "overview" && (
              <div className="space-y-6">
                <StoreCommandHero
                  storeEnabled={storeEnabled}
                  publicUrl={getPublicBookingUrl()}
                  servicesCount={services.length}
                  productsCount={commerceProducts.length}
                  driftedCount={driftedItems.length}
                  hasLogo={!!businessData?.logoUrl}
                  hasHeroImage={!!(storefrontConfig.hero as any)?.imageUrl || !!(storefrontConfig.hero as any)?.coverImageUrl}
                  hoursConfigured={Object.values(businessHours).some((h: any) => h?.enabled)}
                  hasTestimonials={!!((storefrontConfig.socialProof as any)?.testimonials?.length)}
                  hasSlug={!!businessData?.slug}
                  analytics={overviewAnalytics}
                  businessName={businessData?.name}
                  onTabChange={handleTabChange}
                />
                <ConversionInsightsPanel businessId={businessId} onTabChange={handleTabChange} />
                <StoreAnalyticsDashboard businessId={businessId} />
              </div>
            )}

            {activeTab === "customize" && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <AppearanceCustomizer
                  config={storefrontConfig}
                  onConfigChange={handleConfigChange}
                  onSave={handleSaveConfig}
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
            )}

            {activeTab === "products" && (
              <div className="space-y-6">
                <CatalogManager
                  products={commerceProducts}
                  storeServiceNames={storeServiceNames}
                  storeItemCount={storeItemCount}
                  processingItems={processingItems}
                  confirmRemove={confirmRemove}
                  onToggleItem={handleToggleStoreItem}
                  onSelectAll={handleSelectAll}
                  onDeselectAll={handleDeselectAll}
                  onConfirmRemoveChange={setConfirmRemove}
                  onDeleteFromStore={handleDeleteServiceFromStore}
                  services={services.map((s) => ({ id: s.id, name: s.name }))}
                />
                <MerchandisingPanel
                  config={storefrontConfig}
                  products={commerceProducts}
                  services={services}
                  onConfigChange={handleConfigChange}
                  onSave={handleSaveConfig}
                  saving={configSaving}
                />
              </div>
            )}

            {activeTab === "hours" && (
              <HoursEditor
                hours={businessHours}
                onChange={setBusinessHours}
                onSave={handleSaveHours}
                saving={hoursSaving}
              />
            )}

            {activeTab === "settings" && (
              <div className="space-y-6">
                <StoreSettings
                  businessId={businessId}
                  slug={storeSlug}
                  currentSlug={businessData?.slug ?? null}
                  publicUrl={getPublicBookingUrl()}
                  onSlugChange={setStoreSlug}
                  onSaveSlug={handleSaveSlug}
                  slugSaving={slugSaving}
                />
                <SocialProofPanel
                  storefrontConfig={storefrontConfig}
                  configSaving={configSaving}
                  onConfigChange={handleConfigChange}
                  onSaveConfig={handleSaveConfig}
                />
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

    </div>
  );
}
