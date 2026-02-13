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
        <div className="flex items-center justify-center py-20">
          <div className="text-center space-y-3">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading store...</p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <StoreSettings
            businessId={businessId!}
            slug={storeSlug}
            currentSlug={businessData?.slug ?? null}
            publicUrl={getPublicBookingUrl()}
            onSlugChange={setStoreSlug}
            onSaveSlug={handleSaveSlug}
            slugSaving={slugSaving}
          />

          <div className="kf-card p-1 inline-flex gap-1">
            <button
              onClick={() => setActiveView("preview")}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeView === "preview"
                  ? "text-[hsl(var(--kf-accent1))]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              style={activeView === "preview" ? { background: "hsl(var(--kf-accent1) / 0.1)" } : {}}
            >
              <LayoutGrid className="w-4 h-4" />
              Preview
            </button>
            <button
              onClick={() => setActiveView("edit")}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeView === "edit"
                  ? "text-[hsl(var(--kf-accent1))]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              style={activeView === "edit" ? { background: "hsl(var(--kf-accent1) / 0.1)" } : {}}
            >
              <Settings2 className="w-4 h-4" />
              Edit Store
            </button>
          </div>

          {activeView === "preview" ? (
            <StorefrontPreview
              businessData={businessData}
              services={services}
              commerceProducts={commerceProducts}
            />
          ) : (
            <div className="space-y-6">
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}
