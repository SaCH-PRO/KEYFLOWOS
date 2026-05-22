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
  CatalogItemOverride,
  fetchStoreGraph,
  fetchStoreReadiness,
  backfillStoreLinks,
  StoreGraph,
  StoreReadinessResult,
} from "@/lib/client";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { apiGet } from "@/lib/api";
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
  const [activeDeliveryMethodsCount, setActiveDeliveryMethodsCount] = useState(0);

  const [storeGraph, setStoreGraph] = useState<StoreGraph | null>(null);
  const [readiness, setReadiness] = useState<StoreReadinessResult | null>(null);

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
      const stored = getStoredBusinessId();
      if (stored) {
        setBusinessId(stored);
      }
      try {
        const fresh = await refreshWorkspace();
        if (fresh) {
          setBusinessId(fresh);
          return;
        }
      } catch {}
      if (!stored) {
        try {
          await new Promise((r) => setTimeout(r, 1000));
          const retry = await refreshWorkspace();
          if (retry) {
            setBusinessId(retry);
            return;
          }
        } catch {}
        const fallback = getStoredBusinessId();
        if (fallback) {
          setBusinessId(fallback);
        } else {
          setLoading(false);
          setLoadError("Could not find your workspace. Please refresh the page.");
        }
      }
    };
    void initWorkspace();
  }, []);

  const backfillRan = useRef(false);

  const loadData = useCallback(async (showLoader = false) => {
    if (!businessId) return;
    if (showLoader) setLoading(true);
    setLoadError(null);
    try {
      if (!backfillRan.current) {
        backfillRan.current = true;
        backfillStoreLinks(businessId);
      }
      const [servicesRes, staffRes, bizRes, productsRes, graphRes] = await Promise.all([
        fetchServices(businessId),
        fetchStaff(businessId),
        getBusinessById(businessId).catch(() => ({ data: null, error: null })),
        fetchProducts(businessId).catch(() => ({ data: null, error: null })),
        fetchStoreGraph(businessId).catch(() => ({ data: null, error: null })),
      ]);
      const loadedServices = servicesRes.data ?? [];
      const productsResExt = productsRes as { data?: Product[] | null; error?: string | null };
      const loadedProducts = productsResExt?.data ?? [];
      setServices(loadedServices);
      setStaff(staffRes.data ?? []);
      setCommerceProducts(loadedProducts);
      if (loadedProducts.length > 0 || !productsResExt?.error) {
        markProductsFetched();
      }
      if (bizRes.data) {
        const biz = bizRes.data as typeof bizRes.data & { storeEnabled?: boolean; businessHours?: Partial<BusinessHoursMap> };
        setBusinessData(bizRes.data);
        setStoreSlug(bizRes.data.slug ?? "");
        setStoreEnabled(biz.storeEnabled ?? true);
        if (biz.businessHours) {
          setBusinessHours({ ...DEFAULT_HOURS, ...biz.businessHours });
        }
      }

      const graph = graphRes.data;
      if (graph) {
        setStoreGraph(graph);

        const drifts: DriftedItem[] = graph.mappings
          .filter((m) => m.isLive && (m.priceDrift || m.durationDrift))
          .map((m) => ({
            serviceId: m.serviceId!,
            serviceName: m.serviceName ?? m.productName,
            priceDiff: m.priceDrift,
            durationDiff: m.durationDrift,
            commercePrice: m.commercePrice,
            commerceDuration: m.commerceDuration,
          }));
        setDriftedItems(drifts);
      }

      const [configRes, analyticsRes, deliveryRes, readinessRes] = await Promise.all([
        fetchStorefrontConfig(businessId).catch(() => ({ data: null, error: null })),
        fetchStoreAnalytics(businessId, 30).catch(() => ({ data: null, error: null })),
        apiGet<Record<string, { enabled?: boolean }>>(`/marketplace/businesses/${businessId}/delivery-config`).catch(() => ({ data: null })),
        fetchStoreReadiness(businessId).catch(() => ({ data: null, error: null })),
      ]);
      if (configRes.data) setStorefrontConfig(configRes.data);
      if (analyticsRes.data) setOverviewAnalytics(analyticsRes.data);
      if (deliveryRes.data) {
        const count = Object.values(deliveryRes.data).filter((m) => m?.enabled).length;
        setActiveDeliveryMethodsCount(count);
      }
      if (readinessRes.data) setReadiness(readinessRes.data);
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
    const res = await updateBusiness({ businessId, storeEnabled: newValue } as Parameters<typeof updateBusiness>[0]);
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
    const res = await updateBusiness({ businessId, businessHours } as Parameters<typeof updateBusiness>[0]);
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

  const graphProductToServiceMap = new Map<string, string>();
  if (storeGraph) {
    for (const m of storeGraph.mappings) {
      if (m.isLive && m.serviceId) {
        graphProductToServiceMap.set(m.productId, m.serviceId);
      }
    }
  }

  async function handleQuickAddProduct(product: Product) {
    if (!businessId) return;
    if (graphProductToServiceMap.has(product.id)) {
      toast.warning(`"${product.name}" is already in your store.`);
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
        sourceProductId: product.id,
      });
      if (res.error) {
        toast.error(`Failed to add: ${res.error}`);
      } else {
        toast.success(`"${product.name}" added to store!`);
        emitEvent("store:item_added", "store", { productId: product.id, productName: product.name });
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

  async function handleDeleteServiceFromStore(serviceId: string, _productName?: string) {
    if (!businessId) return;
    const mapping = storeGraph?.mappings.find((m) => m.serviceId === serviceId);
    const productId = mapping?.productId;
    if (productId && confirmRemove !== productId) {
      setConfirmRemove(productId);
      return;
    }
    setConfirmRemove(null);
    if (productId) setProcessingItems((prev) => new Set(prev).add(productId));
    try {
      const res = await deleteService(serviceId, businessId);
      if (res.error) {
        toast.error(`Failed to remove: ${res.error}`);
      } else {
        toast.info("Removed from store.");
        await loadData();
      }
    } finally {
      if (productId)
        setProcessingItems((prev) => {
          const n = new Set(prev);
          n.delete(productId);
          return n;
        });
    }
  }

  async function handleToggleStoreItem(product: Product) {
    const mapping = storeGraph?.mappings.find((m) => m.productId === product.id);
    if (mapping?.isLive && mapping.serviceId) {
      await handleDeleteServiceFromStore(mapping.serviceId, product.name);
    } else {
      await handleQuickAddProduct(product);
    }
  }

  async function handleSelectAll() {
    const notAdded = commerceProducts.filter((p) => !graphProductToServiceMap.has(p.id));
    for (const p of notAdded) {
      await handleQuickAddProduct(p);
    }
  }

  async function handleDeselectAll() {
    if (!storeGraph) return;
    const liveEntries = storeGraph.mappings.filter((m) => m.isLive && m.serviceId);
    for (const entry of liveEntries) {
      setConfirmRemove(null);
      await handleDeleteServiceFromStore(entry.serviceId!);
    }
  }

  const ARRAY_CONFIG_KEYS = new Set(['sections', 'faqEntries']);

  function handleConfigChange(section: string, updates: Record<string, unknown>) {
    setStorefrontConfig((prev) => {
      if (section === "__root") {
        return { ...prev, ...updates };
      }
      if (ARRAY_CONFIG_KEYS.has(section)) {
        return { ...prev, [section]: updates };
      }
      const prevSection = (prev as unknown as Record<string, Record<string, unknown> | undefined>)[section] ?? {};
      return {
        ...prev,
        [section]: { ...prevSection, ...updates },
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

  function handleItemOverrideChange(productId: string, override: Partial<CatalogItemOverride>) {
    const currentOverrides = storefrontConfig.catalog?.itemOverrides ?? {};
    const current = currentOverrides[productId] ?? {};
    const merged = { ...current, ...override };
    const newOverrides = { ...currentOverrides, [productId]: merged };
    handleConfigChange("catalog", { itemOverrides: newOverrides });
  }

  function handleCategoryEmphasisChange(category: string, emphasis: "high" | "medium" | "low" | "default") {
    const current = storefrontConfig.catalog?.categoryEmphasis ?? {};
    const updated = { ...current, [category]: emphasis };
    handleConfigChange("catalog", { categoryEmphasis: updated });
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

  const liveProductIds = new Set<string>();
  if (storeGraph) {
    for (const m of storeGraph.mappings) {
      if (m.isLive) liveProductIds.add(m.productId);
    }
  }

  const storeServiceNames = new Set<string>();
  if (storeGraph) {
    for (const m of storeGraph.mappings) {
      if (m.isLive) {
        storeServiceNames.add(m.productName.toLowerCase().trim());
      }
    }
  }

  const storeItemCount = storeGraph?.liveCount ?? 0;

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
    handleItemOverrideChange,
    handleCategoryEmphasisChange,
    storeServiceNames,
    storeItemCount,
    emitEvent,
    activeDeliveryMethodsCount,
    storeGraph,
    readiness,
    liveProductIds,
    graphProductToServiceMap,
  };
}
