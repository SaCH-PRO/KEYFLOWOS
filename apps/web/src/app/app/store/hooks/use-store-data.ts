"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
  fetchStoreAnalytics,
  StoreAnalytics,
} from "@/lib/client";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { onProductsChanged, hasProductChangedSinceLastFetch, markProductsFetched } from "@/lib/product-sync";
import { toast } from "sonner";
import { useModuleEmit } from "@/hooks/use-module-events";
import type { DriftedItem } from "../components/store-types";
import type { BusinessHoursMap } from "../components/hours-editor";
import { DEFAULT_HOURS } from "../components/hours-editor";

export function useStoreData() {
  const emitEvent = useModuleEmit();

  const [businessId, setBusinessId] = useState<string | null>(null);
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
  const [loadError, setLoadError] = useState<string | null>(null);

  const [storefrontConfig, setStorefrontConfig] = useState<StorefrontConfig>({
    hero: {},
    appearance: {},
    merchandising: {},
    promotions: {},
    socialProof: {},
    seo: {},
  });
  const [configSaving, setConfigSaving] = useState(false);

  useEffect(() => {
    const initWorkspace = async () => {
      try {
        const fresh = await refreshWorkspace();
        if (fresh) {
          setBusinessId(fresh);
          return;
        }
        const stored = getStoredBusinessId();
        if (stored) {
          setBusinessId(stored);
        } else {
          setLoading(false);
        }
      } catch {
        const stored = getStoredBusinessId();
        if (stored) {
          setBusinessId(stored);
        } else {
          setLoading(false);
        }
      }
    };
    void initWorkspace();
  }, []);

  const loadData = useCallback(async (showLoader = false) => {
    if (!businessId) return;
    if (showLoader) setLoading(true);
    setLoadError(null);
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
      setLoadError("Failed to load store data. Please refresh the page.");
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

  const ARRAY_CONFIG_KEYS = new Set(['sections', 'faqEntries']);

  function handleConfigChange(section: string, updates: Record<string, any>) {
    setStorefrontConfig((prev) => {
      if (ARRAY_CONFIG_KEYS.has(section)) {
        return { ...prev, [section]: updates };
      }
      return {
        ...prev,
        [section]: { ...(prev as any)[section], ...updates },
      };
    });
  }

  function handleReorderProducts(orderedIds: string[]) {
    handleConfigChange("catalog", { productOrder: orderedIds });
    if (businessId) {
      updateStorefrontConfig(businessId, {
        ...storefrontConfig,
        catalog: { ...storefrontConfig.catalog, productOrder: orderedIds },
      }).then((res) => {
        if (!res.error) toast.success("Display order saved");
      });
    }
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

  const storeServiceNames = new Set(services.map((s) => s.name));
  const storeItemCount = services.filter((s) => commerceProducts.some((p) => p.name === s.name)).length;

  return {
    businessId,
    loading,
    loadError,
    services,
    staff,
    commerceProducts,
    businessData,
    storeSlug,
    setStoreSlug,
    slugSaving,
    processingItems,
    confirmRemove,
    setConfirmRemove,
    storeEnabled,
    businessHours,
    setBusinessHours,
    hoursSaving,
    driftedItems,
    syncing,
    overviewAnalytics,
    storefrontConfig,
    configSaving,
    loadData,
    getPublicBookingUrl,
    handleSaveSlug,
    toggleStoreEnabled,
    handleSaveHours,
    syncDriftedItems,
    handleToggleStoreItem,
    handleSelectAll,
    handleDeselectAll,
    handleConfigChange,
    handleSaveConfig,
    handleDeleteServiceFromStore,
    handleReorderProducts,
    storeServiceNames,
    storeItemCount,
    emitEvent,
  };
}
