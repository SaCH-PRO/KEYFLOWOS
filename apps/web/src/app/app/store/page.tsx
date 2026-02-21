"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Store,
  LayoutGrid,
  Settings2,
  ShoppingBag,
  AlertTriangle,
  TrendingUp,
  BarChart3,
  Palette,
  Clock,
  Star,
  Plus,
  Trash2,
  Save,
  Loader2,
  MessageSquareQuote,
} from "lucide-react";
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
import { StoreHeader } from "./components/store-header";
import { StoreSettings } from "./components/store-settings";
import { HoursEditor, DEFAULT_HOURS, type BusinessHoursMap } from "./components/hours-editor";
import { CatalogManager } from "./components/catalog-manager";
import { StorefrontPreview } from "./components/storefront-preview";
import { AppearanceCustomizer } from "./components/appearance-customizer";
import { MerchandisingPanel } from "./components/merchandising-panel";
import { StoreAnalyticsDashboard } from "./components/store-analytics";
import { FeatureGuide } from "@/components/ui/feature-guide";
import { ContactPickerDrawer } from "@/components/contacts";
import { Send } from "lucide-react";

type Banner = { text: string; type: "success" | "error" | "info" | "warning" };
type DriftedItem = {
  serviceId: string;
  serviceName: string;
  priceDiff: boolean;
  durationDiff: boolean;
  commercePrice: number;
  commerceDuration: number | null;
};

type TabKey = "overview" | "customize" | "products" | "hours" | "settings";

const VIEW_TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: "overview", label: "Overview", icon: BarChart3 },
  { key: "customize", label: "Customize", icon: Palette },
  { key: "products", label: "Products", icon: ShoppingBag },
  { key: "hours", label: "Hours", icon: Clock },
  { key: "settings", label: "Settings", icon: Settings2 },
];

type Testimonial = { id: string; name: string; text: string; rating: number; date: string };

export default function StorePage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [commerceProducts, setCommerceProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<Banner | null>(null);

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
  const [activeView, setActiveView] = useState<TabKey>("overview");
  const [processingItems, setProcessingItems] = useState<Set<string>>(new Set());
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [storeEnabled, setStoreEnabled] = useState(true);
  const [businessHours, setBusinessHours] = useState<BusinessHoursMap>(DEFAULT_HOURS);
  const [hoursSaving, setHoursSaving] = useState(false);
  const [driftedItems, setDriftedItems] = useState<DriftedItem[]>([]);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [storefrontConfig, setStorefrontConfig] = useState<StorefrontConfig>({
    hero: {},
    appearance: {},
    merchandising: {},
    promotions: {},
    socialProof: {},
    seo: {},
  });
  const [configSaving, setConfigSaving] = useState(false);

  const [showTestimonialForm, setShowTestimonialForm] = useState(false);
  const [newTestimonial, setNewTestimonial] = useState({ name: "", text: "", rating: 5 });

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

  const loadData = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
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

      const configRes = await fetchStorefrontConfig(businessId).catch(() => ({ data: null, error: null }));
      if (configRes.data) setStorefrontConfig(configRes.data);
    } catch (e) {
      console.error("Failed to load store data:", e);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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
      setBanner({ text: `Failed to save URL: ${res.error}`, type: "error" });
    } else {
      setBanner({ text: "Public booking URL saved!", type: "success" });
      setBusinessData((prev) => (prev ? { ...prev, slug } : prev));
    }
    setSlugSaving(false);
  }

  async function toggleStoreEnabled() {
    if (!businessId) return;
    const newValue = !storeEnabled;
    const res = await updateBusiness({ businessId, storeEnabled: newValue } as any);
    if (res.error) {
      setBanner({ text: `Failed to update store status: ${res.error}`, type: "error" });
    } else {
      setStoreEnabled(newValue);
      setBusinessData((prev) => (prev ? { ...prev, storeEnabled: newValue } : prev));
      setBanner({
        text: newValue ? "Store is now published!" : "Store is now unpublished.",
        type: newValue ? "success" : "info",
      });
    }
  }

  async function handleSaveHours() {
    if (!businessId) return;
    setHoursSaving(true);
    const res = await updateBusiness({ businessId, businessHours } as any);
    if (res.error) {
      setBanner({ text: `Failed to save hours: ${res.error}`, type: "error" });
    } else {
      setBanner({ text: "Business hours saved!", type: "success" });
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
    setBanner({ text: `Synced ${synced} item${synced !== 1 ? "s" : ""} with Commerce prices.`, type: "success" });
    setSyncing(false);
    await loadData();
  }

  async function handleQuickAddProduct(product: Product) {
    if (!businessId) return;
    const existingService = services.find((s) => s.name === product.name);
    if (existingService) {
      setBanner({ text: `A service named '${product.name}' already exists in your store.`, type: "warning" });
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
        setBanner({ text: `Failed to add: ${res.error}`, type: "error" });
      } else {
        setBanner({ text: `"${product.name}" added to store!`, type: "success" });
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
        setBanner({ text: `Failed to remove: ${res.error}`, type: "error" });
      } else {
        setBanner({ text: "Removed from store.", type: "info" });
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
      setBanner({ text: "Failed to save storefront config", type: "error" });
    } else {
      setBanner({ text: "Storefront saved!", type: "success" });
    }
    setConfigSaving(false);
  }

  function addTestimonial() {
    if (!newTestimonial.name.trim() || !newTestimonial.text.trim()) return;
    const testimonial: Testimonial = {
      id: `t_${Date.now()}`,
      name: newTestimonial.name.trim(),
      text: newTestimonial.text.trim(),
      rating: newTestimonial.rating,
      date: new Date().toISOString().split("T")[0],
    };
    const current = storefrontConfig.socialProof?.testimonials ?? [];
    handleConfigChange("socialProof", { testimonials: [...current, testimonial] });
    setNewTestimonial({ name: "", text: "", rating: 5 });
    setShowTestimonialForm(false);
  }

  function deleteTestimonial(id: string) {
    const current = storefrontConfig.socialProof?.testimonials ?? [];
    handleConfigChange("socialProof", { testimonials: current.filter((t) => t.id !== id) });
  }

  if (!businessId && !loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3">
          <AlertCircle className="w-12 h-12 mx-auto" style={{ color: "hsl(var(--kf-accent1) / 0.6)" }} />
          <p className="text-lg font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>
            We could not find your workspace. Please sign in again.
          </p>
          <p className="text-muted-foreground">Try logging in again to create your workspace.</p>
        </div>
      </div>
    );
  }

  const storeServiceNames = new Set(services.map((s) => s.name));
  const storeItemCount = services.filter((s) => commerceProducts.some((p) => p.name === s.name)).length;

  const kpiCards = [
    {
      label: "Store Items",
      value: services.length,
      icon: Store,
      color: "hsl(var(--kf-accent1))",
      bg: "hsl(var(--kf-accent1) / 0.08)",
      border: "hsl(var(--kf-accent1) / 0.2)",
    },
    {
      label: "Commerce Products",
      value: commerceProducts.length,
      icon: ShoppingBag,
      color: "hsl(var(--kf-accent2))",
      bg: "hsl(var(--kf-accent2) / 0.08)",
      border: "hsl(var(--kf-accent2) / 0.2)",
    },
    {
      label: "Store Status",
      value: storeEnabled ? "Published" : "Unpublished",
      icon: TrendingUp,
      color: storeEnabled ? "hsl(142 70% 55%)" : "hsl(40 90% 55%)",
      bg: storeEnabled ? "hsl(142 70% 45% / 0.08)" : "hsl(40 90% 50% / 0.08)",
      border: storeEnabled ? "hsl(142 70% 45% / 0.2)" : "hsl(40 90% 50% / 0.2)",
      dot: storeEnabled ? "hsl(142 70% 55%)" : "hsl(40 90% 55%)",
    },
    {
      label: "Price Drifts",
      value: driftedItems.length,
      icon: AlertTriangle,
      color: driftedItems.length > 0 ? "hsl(30 90% 60%)" : "hsl(var(--kf-muted-foreground))",
      bg: driftedItems.length > 0 ? "hsl(30 90% 50% / 0.08)" : "hsl(var(--kf-muted) / 0.3)",
      border: driftedItems.length > 0 ? "hsl(30 90% 50% / 0.2)" : "hsl(var(--kf-border))",
      warn: driftedItems.length > 0,
    },
  ];

  const testimonials = storefrontConfig.socialProof?.testimonials ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <StoreHeader
            storeEnabled={storeEnabled}
            publicUrl={getPublicBookingUrl()}
            onToggleEnabled={toggleStoreEnabled}
          />
        </div>
        <button
          onClick={() => setShowContactPicker(true)}
          className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-xl bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
        >
          <Send className="w-4 h-4" />
          Broadcast
        </button>
      </div>

      <FeatureGuide
        featureKey="store"
        title="Getting Started with Your Online Store"
        description="Set up your public storefront where customers can browse services, book appointments, and shop."
        steps={[
          { title: "Toggle Store Live", description: "Use the ON/Live switch at the top to make your store visible to customers." },
          { title: "Add Services & Products", description: "Go to the Catalog tab to add your bookable services and products with prices." },
          { title: "Customize Appearance", description: "Choose a theme, set your brand colors, hero image, and layout style in the Appearance tab." },
          { title: "Set Business Hours", description: "Configure your operating hours so customers know when you're available." },
          { title: "Share Your Link", description: "Copy your public store URL and share it on WhatsApp, social media, or your website." },
          { title: "Track Performance", description: "Monitor page views, popular items, and conversion rates in the Analytics tab." },
        ]}
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

      {driftedItems.length > 0 && (
        <div
          className="kf-card p-3 text-sm flex items-center gap-2"
          style={{ borderColor: "hsl(30 90% 50% / 0.4)", background: "hsl(30 90% 50% / 0.1)", color: "hsl(30 90% 90%)" }}
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>
            {driftedItems.length} store item{driftedItems.length !== 1 ? "s have" : " has"} outdated prices compared to Commerce.
          </span>
          <button
            onClick={syncDriftedItems}
            disabled={syncing}
            className="ml-auto kf-btn-secondary text-xs"
          >
            {syncing ? "Syncing..." : "Sync All"}
          </button>
        </div>
      )}

      <AnimatePresence>
        {banner && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className={`kf-card p-3 text-sm flex items-center gap-2 ${
              banner.type === "success"
                ? "!border-emerald-500/30 !bg-emerald-500/10 text-emerald-300"
                : banner.type === "error"
                ? "!border-red-500/30 !bg-red-500/10 text-red-300"
                : banner.type === "warning"
                ? "!border-yellow-500/30 !bg-yellow-500/10 text-yellow-300"
                : "text-[hsl(var(--kf-accent1))]"
            }`}
          >
            {banner.type === "success" ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <AlertCircle className="w-4 h-4" />
            )}
            {banner.text}
            <button onClick={() => setBanner(null)} className="ml-auto text-xs opacity-60 hover:opacity-100">
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-24 rounded-2xl animate-pulse"
                style={{ background: "hsl(var(--kf-muted) / 0.3)" }}
              />
            ))}
          </div>
          <div className="h-12 rounded-xl animate-pulse w-64" style={{ background: "hsl(var(--kf-muted) / 0.3)" }} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-32 rounded-2xl animate-pulse"
                style={{ background: "hsl(var(--kf-muted) / 0.3)" }}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {VIEW_TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveView(t.key)}
                  className={`relative px-5 py-2.5 text-sm font-medium rounded-xl transition-all flex items-center gap-2 whitespace-nowrap ${
                    activeView === t.key
                      ? ""
                      : "text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--kf-muted)/0.5)]"
                  }`}
                >
                  {activeView === t.key && (
                    <motion.div
                      layoutId="store-tab-pill"
                      className="absolute inset-0 rounded-xl"
                      style={{
                        background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.15), hsl(var(--kf-accent2) / 0.1))",
                        border: "1px solid hsl(var(--kf-accent1) / 0.25)",
                        boxShadow: "0 2px 12px hsl(var(--kf-accent1) / 0.1)",
                      }}
                      transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                    />
                  )}
                  <span
                    className="relative z-10 flex items-center gap-2"
                    style={activeView === t.key ? { color: "hsl(var(--kf-accent1))" } : {}}
                  >
                    <Icon className="w-4 h-4" />
                    {t.label}
                  </span>
                </button>
              );
            })}
          </div>

          <AnimatePresence mode="wait">
            {activeView === "overview" && (
              <motion.div
                key="overview"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {kpiCards.map((kpi, idx) => {
                    const Icon = kpi.icon;
                    return (
                      <motion.div
                        key={kpi.label}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className="rounded-2xl p-4 relative overflow-hidden"
                        style={{
                          background: kpi.bg,
                          border: `1px solid ${kpi.border}`,
                          backdropFilter: "blur(20px)",
                        }}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <Icon className="w-4 h-4" style={{ color: kpi.color }} />
                          {(kpi as any).dot && (
                            <span
                              className="w-2 h-2 rounded-full animate-pulse"
                              style={{ background: (kpi as any).dot }}
                            />
                          )}
                          {(kpi as any).warn && (
                            <span
                              className="w-2 h-2 rounded-full animate-pulse"
                              style={{ background: "hsl(30 90% 55%)" }}
                            />
                          )}
                        </div>
                        <p className="text-2xl font-bold" style={{ color: kpi.color }}>
                          {kpi.value}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{kpi.label}</p>
                      </motion.div>
                    );
                  })}
                </div>

                <StoreAnalyticsDashboard businessId={businessId!} />
              </motion.div>
            )}

            {activeView === "customize" && (
              <motion.div
                key="customize"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <AppearanceCustomizer
                    config={storefrontConfig}
                    onConfigChange={handleConfigChange}
                    onSave={handleSaveConfig}
                    saving={configSaving}
                  />
                  <StorefrontPreview
                    businessData={businessData}
                    services={services}
                    commerceProducts={commerceProducts}
                    config={storefrontConfig}
                  />
                </div>
              </motion.div>
            )}

            {activeView === "products" && (
              <motion.div
                key="products"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
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
              </motion.div>
            )}

            {activeView === "hours" && (
              <motion.div
                key="hours"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <HoursEditor
                  hours={businessHours}
                  onChange={setBusinessHours}
                  onSave={handleSaveHours}
                  saving={hoursSaving}
                />
              </motion.div>
            )}

            {activeView === "settings" && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                <StoreSettings
                  businessId={businessId!}
                  slug={storeSlug}
                  currentSlug={businessData?.slug ?? null}
                  publicUrl={getPublicBookingUrl()}
                  onSlugChange={setStoreSlug}
                  onSaveSlug={handleSaveSlug}
                  slugSaving={slugSaving}
                />

                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="rounded-2xl overflow-hidden"
                  style={{
                    background: "hsl(var(--kf-background) / 0.6)",
                    backdropFilter: "blur(20px)",
                    border: "1px solid hsl(var(--kf-accent2) / 0.15)",
                    boxShadow: "0 4px 24px hsl(var(--kf-accent2) / 0.05)",
                  }}
                >
                  <div
                    className="flex items-center justify-between px-5 py-4"
                    style={{
                      borderBottom: "1px solid hsl(var(--kf-accent2) / 0.1)",
                      background: "linear-gradient(135deg, hsl(var(--kf-accent2) / 0.06), transparent)",
                    }}
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className="h-10 w-10 rounded-xl flex items-center justify-center"
                        style={{ background: "hsl(var(--kf-accent2) / 0.15)" }}
                      >
                        <MessageSquareQuote className="w-5 h-5" style={{ color: "hsl(var(--kf-accent2))" }} />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold">Social Proof</h3>
                        <p className="text-[11px] text-muted-foreground mt-0.5">Testimonials and trust signals</p>
                      </div>
                    </div>
                    <button
                      onClick={handleSaveConfig}
                      disabled={configSaving}
                      className="kf-btn-primary text-xs inline-flex items-center gap-1.5"
                      style={{ opacity: configSaving ? 0.6 : 1 }}
                    >
                      {configSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      {configSaving ? "Saving..." : "Save"}
                    </button>
                  </div>

                  <div className="p-5 space-y-5">
                    <div
                      className="rounded-xl p-3 space-y-1"
                      style={{ background: "hsl(var(--kf-muted) / 0.2)", border: "1px solid hsl(var(--kf-border) / 0.3)" }}
                    >
                      <button
                        type="button"
                        onClick={() => handleConfigChange("socialProof", { showBookingCount: !(storefrontConfig.socialProof?.showBookingCount ?? false) })}
                        className="flex items-center justify-between w-full py-2 group"
                      >
                        <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">Show Booking Count</span>
                        <div
                          className="w-10 h-5 rounded-full transition-colors relative flex-shrink-0"
                          style={{ background: storefrontConfig.socialProof?.showBookingCount ? "hsl(var(--kf-accent2))" : "hsl(var(--kf-muted-foreground) / 0.3)" }}
                        >
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${storefrontConfig.socialProof?.showBookingCount ? "left-[22px]" : "left-0.5"}`} />
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleConfigChange("socialProof", { showRating: !(storefrontConfig.socialProof?.showRating ?? false) })}
                        className="flex items-center justify-between w-full py-2 group"
                      >
                        <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">Show Rating</span>
                        <div
                          className="w-10 h-5 rounded-full transition-colors relative flex-shrink-0"
                          style={{ background: storefrontConfig.socialProof?.showRating ? "hsl(var(--kf-accent2))" : "hsl(var(--kf-muted-foreground) / 0.3)" }}
                        >
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${storefrontConfig.socialProof?.showRating ? "left-[22px]" : "left-0.5"}`} />
                        </div>
                      </button>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Guarantee Text</label>
                      <input
                        type="text"
                        value={storefrontConfig.socialProof?.guaranteeText ?? ""}
                        onChange={(e) => handleConfigChange("socialProof", { guaranteeText: e.target.value })}
                        placeholder="e.g. 100% satisfaction guaranteed"
                        className="kf-input w-full text-sm"
                      />
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold">Testimonials</h4>
                        <button
                          onClick={() => setShowTestimonialForm(true)}
                          className="kf-btn-secondary text-xs inline-flex items-center gap-1.5"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add Testimonial
                        </button>
                      </div>

                      <AnimatePresence>
                        {showTestimonialForm && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden"
                          >
                            <div
                              className="rounded-xl p-4 space-y-3"
                              style={{ background: "hsl(var(--kf-accent2) / 0.06)", border: "1px solid hsl(var(--kf-accent2) / 0.15)" }}
                            >
                              <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1 block">Name</label>
                                <input
                                  type="text"
                                  value={newTestimonial.name}
                                  onChange={(e) => setNewTestimonial((p) => ({ ...p, name: e.target.value }))}
                                  placeholder="Customer name"
                                  className="kf-input w-full text-sm"
                                />
                              </div>
                              <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1 block">Rating</label>
                                <div className="flex gap-1">
                                  {[1, 2, 3, 4, 5].map((r) => (
                                    <button
                                      key={r}
                                      type="button"
                                      onClick={() => setNewTestimonial((p) => ({ ...p, rating: r }))}
                                      className="p-0.5"
                                    >
                                      <Star
                                        className="w-5 h-5 transition-colors"
                                        style={{
                                          color: r <= newTestimonial.rating ? "hsl(45 93% 55%)" : "hsl(var(--kf-muted-foreground) / 0.3)",
                                          fill: r <= newTestimonial.rating ? "hsl(45 93% 55%)" : "transparent",
                                        }}
                                      />
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1 block">Testimonial</label>
                                <textarea
                                  value={newTestimonial.text}
                                  onChange={(e) => setNewTestimonial((p) => ({ ...p, text: e.target.value }))}
                                  placeholder="What did the customer say?"
                                  className="kf-input w-full text-sm min-h-[60px] resize-none"
                                  rows={2}
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={addTestimonial}
                                  disabled={!newTestimonial.name.trim() || !newTestimonial.text.trim()}
                                  className="kf-btn-primary text-xs"
                                  style={{ opacity: !newTestimonial.name.trim() || !newTestimonial.text.trim() ? 0.5 : 1 }}
                                >
                                  Add
                                </button>
                                <button
                                  onClick={() => { setShowTestimonialForm(false); setNewTestimonial({ name: "", text: "", rating: 5 }); }}
                                  className="kf-btn-secondary text-xs"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {testimonials.length === 0 ? (
                        <div
                          className="text-center py-6 rounded-xl"
                          style={{ background: "hsl(var(--kf-muted) / 0.2)", border: "1px dashed hsl(var(--kf-border) / 0.5)" }}
                        >
                          <MessageSquareQuote className="w-8 h-8 mx-auto mb-2" style={{ color: "hsl(var(--kf-muted-foreground) / 0.3)" }} />
                          <p className="text-xs text-muted-foreground">No testimonials yet. Add one to build trust.</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {testimonials.map((t) => (
                            <motion.div
                              key={t.id}
                              layout
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              className="rounded-xl px-4 py-3"
                              style={{
                                background: "hsl(var(--kf-accent2) / 0.04)",
                                border: "1px solid hsl(var(--kf-accent2) / 0.12)",
                              }}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-sm font-medium truncate">{t.name}</span>
                                    <div className="flex gap-0.5">
                                      {[1, 2, 3, 4, 5].map((r) => (
                                        <Star
                                          key={r}
                                          className="w-3 h-3"
                                          style={{
                                            color: r <= t.rating ? "hsl(45 93% 55%)" : "hsl(var(--kf-muted-foreground) / 0.2)",
                                            fill: r <= t.rating ? "hsl(45 93% 55%)" : "transparent",
                                          }}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                  <p className="text-xs text-muted-foreground line-clamp-2">{t.text}</p>
                                </div>
                                <button
                                  onClick={() => deleteTestimonial(t.id)}
                                  className="p-1.5 rounded-lg hover:bg-red-500/20 transition-colors flex-shrink-0"
                                >
                                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                                </button>
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
      <ContactPickerDrawer isOpen={showContactPicker} onClose={() => setShowContactPicker(false)} />
    </div>
  );
}
