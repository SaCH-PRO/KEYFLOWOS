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
} from "@/lib/client";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { StoreHeader } from "./components/store-header";
import { StoreSettings } from "./components/store-settings";
import { HoursEditor, DEFAULT_HOURS, type BusinessHoursMap } from "./components/hours-editor";
import { CatalogManager } from "./components/catalog-manager";
import { StorefrontPreview } from "./components/storefront-preview";

type Banner = { text: string; type: "success" | "error" | "info" | "warning" };
type DriftedItem = {
  serviceId: string;
  serviceName: string;
  priceDiff: boolean;
  durationDiff: boolean;
  commercePrice: number;
  commerceDuration: number | null;
};

const VIEW_TABS = [
  { key: "preview" as const, label: "Preview", icon: LayoutGrid },
  { key: "edit" as const, label: "Edit Store", icon: Settings2 },
];

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
  const [activeView, setActiveView] = useState<"preview" | "edit">("preview");
  const [processingItems, setProcessingItems] = useState<Set<string>>(new Set());
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [storeEnabled, setStoreEnabled] = useState(true);
  const [businessHours, setBusinessHours] = useState<BusinessHoursMap>(DEFAULT_HOURS);
  const [hoursSaving, setHoursSaving] = useState(false);
  const [driftedItems, setDriftedItems] = useState<DriftedItem[]>([]);
  const [syncing, setSyncing] = useState(false);

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

  return (
    <div className="space-y-6">
      <StoreHeader
        storeEnabled={storeEnabled}
        publicUrl={getPublicBookingUrl()}
        onToggleEnabled={toggleStoreEnabled}
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

          <StoreSettings
            businessId={businessId!}
            slug={storeSlug}
            currentSlug={businessData?.slug ?? null}
            publicUrl={getPublicBookingUrl()}
            onSlugChange={setStoreSlug}
            onSaveSlug={handleSaveSlug}
            slugSaving={slugSaving}
          />

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
            {activeView === "preview" ? (
              <motion.div
                key="preview"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <StorefrontPreview
                  businessData={businessData}
                  services={services}
                  commerceProducts={commerceProducts}
                />
              </motion.div>
            ) : (
              <motion.div
                key="edit"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                <HoursEditor
                  hours={businessHours}
                  onChange={setBusinessHours}
                  onSave={handleSaveHours}
                  saving={hoursSaving}
                />
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
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
