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
  fetchAllProducts,
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
import { refreshWorkspace, getStoredBusinessId, BUSINESS_CHANGED_EVENT } from "@/lib/workspace";
import { apiGet } from "@/lib/api";
import { onProductsChanged, hasProductChangedSinceLastFetch, markProductsFetched } from "@/lib/product-sync";
import { toast } from "sonner";
import { useModuleEmit } from "@/hooks/use-module-events";
import { useMemberModuleLevels } from "@/hooks/use-app-layout";
import type { DriftedItem } from "../components/store-types";
import type { StockByProduct } from "../components/launch-mode";
import type { BusinessHoursMap } from "../components/hours-editor";
import { DEFAULT_HOURS } from "../components/hours-editor";

/** The storefront before any read: what a business with nothing saved shows. */
function emptyStorefront(): StorefrontConfig {
  return { hero: {}, appearance: {}, merchandising: {}, promotions: {}, socialProof: {}, seo: {} };
}

/**
 * Round 4 (SEC-CAT-R3-1): which of the selected business's own reads have landed. A write is made only from what
 * that business answered: its details and hours (business), its storefront (storefront), its store listing (graph).
 */
type Landed = { businessId: string; business: boolean; storefront: boolean; graph: boolean; graphRefused: boolean };

const ARRAY_CONFIG_KEYS = new Set(["sections", "faqEntries"]);

/** A storefront config with one change applied: "__root" merges at the top, array sections replace, others merge. */
function withConfigChange(prev: StorefrontConfig, section: string, updates: Record<string, unknown>): StorefrontConfig {
  if (section === "__root") return { ...prev, ...updates };
  if (ARRAY_CONFIG_KEYS.has(section)) return { ...prev, [section]: updates };
  const prevSection = (prev as unknown as Record<string, Record<string, unknown> | undefined>)[section] ?? {};
  return { ...prev, [section]: { ...prevSection, ...updates } };
}

export function useStoreData() {
  const emitEvent = useModuleEmit();

  const [businessId, setBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [commerceProducts, setCommerceProducts] = useState<Product[]>([]);
  // COR-CAT-8: the business's own stock rows summed per product (null until read, or when the read fails).
  const [stockRead, setStockRead] = useState<StockByProduct | null>(null);
  const [loadGeneration, setLoadGeneration] = useState(0);
  // SEC-CAT-7 (D-100): the inventory read answers whole Product rows, prices included, so it is made only for a
  // member whose revenue level is known and not "none" (the level the app reads everywhere: my-access).
  const levels = useMemberModuleLevels();
  const canReadStock = levels !== null && levels.revenue !== undefined && levels.revenue !== "none";
  const stockByProduct = canReadStock ? stockRead : null;
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

  const [storefrontConfig, setStorefrontConfig] = useState<StorefrontConfig>(emptyStorefront);
  const [configSaving, setConfigSaving] = useState(false);
  const [landed, setLanded] = useState<Landed | null>(null);

  // Round 7 (SEC-R6-m1): the business whose store links were last backfilled. A business selected runs its own
  // backfill (a switch to another business makes this differ), whatever a load for another business did.
  const backfillRan = useRef<string | null>(null);

  /**
   * CATALOG-1 round 3 (SEC-CAT-7, D-100): Your page follows the business selection (kf:business-changed, and the
   * storage event for another tab), as useMemberModuleLevels does. It kept the business it mounted with, so after a
   * switch the stock read went out for the old business under the new business's level. On a switch everything of
   * the previous business is dropped and the new one loads; an answer for the previous business is not applied.
   *
   * Round 4 (SEC-CAT-R3-1, COR-R3-1): "everything" is every field set from a business read or a write's answer, so
   * nothing of A's is shown for B or written to B when one of B's reads answers nothing.
   *
   * Round 5 (SEC-CAT-R4-2): every way the page comes to show a business goes through switchTo, including the
   * workspace answering, at mount, a business other than the stored one.
   *
   * Round 6 (SEC-R5-M1): switchTo is the only writer of currentBusiness. An effect copying the committed businessId
   * into it could run after a later switch (one landing between A's commit and A's effects) and move it back to A,
   * so A's answers were applied on B's page.
   * Round 6 (COR-CAT-R4-1): every reset is followed by a load for the business now current (switchCount is in the
   * load effect's deps), so a switch A -> B -> A in one batch, which nets businessId back to A, still reloads A.
   */
  const currentBusiness = useRef<string | null>(null);
  // COR-R5-3: the bulk run (Add all or Remove all) in progress for the current business, if any.
  const bulkRun = useRef<object | null>(null);
  // Round 7 (MIN-4): whether one is going on, for the bulk buttons; it is the page's, so it outlives a remount.
  const [bulkRunning, setBulkRunning] = useState(false);
  const [switchCount, setSwitchCount] = useState(0);
  const switchTo = useCallback((next: string) => {
    if (next === currentBusiness.current) return;
    currentBusiness.current = next;
    bulkRun.current = null;
    setBulkRunning(false);
    setStockRead(null);
    setServices([]);
    setStaff([]);
    setCommerceProducts([]);
    setBusinessData(null);
    setStoreGraph(null);
    setDriftedItems([]);
    setReadiness(null);
    setOverviewAnalytics(null);
    setStoreSlug("");
    setStoreEnabled(true);
    setBusinessHours(DEFAULT_HOURS);
    setStorefrontConfig(emptyStorefront());
    setActiveDeliveryMethodsCount(0);
    setLoadError(null);
    setProcessingItems(new Set());
    setConfirmRemove(null);
    setSlugSaving(false);
    setHoursSaving(false);
    setConfigSaving(false);
    setSyncing(false);
    setLanded(null);
    setLoading(true);
    setBusinessId(next);
    setSwitchCount((c) => c + 1);
  }, []);

  useEffect(() => {
    const initWorkspace = async () => {
      const stored = getStoredBusinessId();
      if (stored) {
        switchTo(stored);
      }
      try {
        const fresh = await refreshWorkspace();
        if (fresh) {
          switchTo(fresh);
          return;
        }
      } catch {}
      if (!stored) {
        try {
          await new Promise((r) => setTimeout(r, 1000));
          const retry = await refreshWorkspace();
          if (retry) {
            switchTo(retry);
            return;
          }
        } catch {}
        const fallback = getStoredBusinessId();
        if (fallback) {
          switchTo(fallback);
        } else {
          setLoading(false);
          setLoadError("Could not find your workspace. Please refresh the page.");
        }
      }
    };
    void initWorkspace();
  }, [switchTo]);

  useEffect(() => {
    const follow = () => {
      const next = getStoredBusinessId();
      if (next) switchTo(next);
    };
    window.addEventListener(BUSINESS_CHANGED_EVENT, follow);
    window.addEventListener("storage", follow);
    return () => {
      window.removeEventListener(BUSINESS_CHANGED_EVENT, follow);
      window.removeEventListener("storage", follow);
    };
  }, [switchTo]);

  const loadData = useCallback(async (showLoader = false) => {
    if (!businessId) return;
    // An answer for a business no longer selected (a reload in flight across a switch) is dropped.
    const stale = () => currentBusiness.current !== null && currentBusiness.current !== businessId;
    // Round 7 (SEC-R6-m1): a load starting for a business no longer selected sends nothing (the backfill is a POST)
    // and leaves the selected business's backfill to its own load.
    if (stale()) return;
    if (showLoader) setLoading(true);
    setLoadError(null);
    try {
      if (backfillRan.current !== businessId) {
        backfillRan.current = businessId;
        backfillStoreLinks(businessId);
      }
      const [servicesRes, staffRes, bizRes, productsRes, graphRes] = await Promise.all([
        fetchServices(businessId),
        fetchStaff(businessId),
        getBusinessById(businessId).catch(() => ({ data: null, error: null })),
        // COR-CAT-5: every product, not the first page of 50.
        fetchAllProducts(businessId).catch(() => ({ data: null, error: null })),
        fetchStoreGraph(businessId).catch(() => ({ data: null, error: null })),
      ]);
      if (stale()) return;
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
        // COR-R3-1: Business.businessHours is nullable; a business with none shows DEFAULT_HOURS, never hours read before.
        setBusinessHours({ ...DEFAULT_HOURS, ...(biz.businessHours ?? {}) });
      }

      const graph = graphRes.data;
      // COR-R4-2: a 403 on GET store/graph is a refusal (the revenue read guard, or BusinessGuard for a member just
      // removed), not a failed load.
      const graphRefused = !graph && (graphRes as { status?: number }).status === 403;
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
      if (stale()) return;
      setLoadGeneration((g) => g + 1);
      if (configRes.data) setStorefrontConfig(configRes.data);
      if (analyticsRes.data) setOverviewAnalytics(analyticsRes.data);
      if (deliveryRes.data) {
        const count = Object.values(deliveryRes.data).filter((m) => m?.enabled).length;
        setActiveDeliveryMethodsCount(count);
      }
      if (readinessRes.data) setReadiness(readinessRes.data);
      // A read that landed once for this business stays landed; a later reload that fails keeps this business's data.
      setLanded((prev) => {
        const kept = prev?.businessId === businessId ? prev : null;
        return {
          businessId,
          business: !!kept?.business || !!bizRes.data,
          storefront: !!kept?.storefront || !!configRes.data,
          graph: !!kept?.graph || !!graph,
          graphRefused: !kept?.graph && !graph && graphRefused,
        };
      });
    } catch (e) {
      // COR-R3-2: a failure of a load for a business no longer selected says nothing on this one's page.
      if (stale()) return;
      console.error("Failed to load store data:", e);
      setLoadError("Failed to load store data. Please refresh the page.");
      toast.error("Failed to load store data");
    } finally {
      if (!stale()) setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void loadData(true);
  }, [loadData, switchCount]);

  // The stock, read again with every load, and only when the member may read prices (SEC-CAT-7).
  useEffect(() => {
    if (!businessId || !canReadStock) return;
    // The level read is the selected business's: read the stock only for that same business.
    if (getStoredBusinessId() !== businessId) return;
    let live = true;
    void apiGet<Array<{ productId?: string; quantity?: number; reserved?: number }>>(`/marketplace/businesses/${businessId}/inventory`)
      .catch(() => ({ data: null }))
      .then((res) => {
        if (!live || currentBusiness.current !== businessId) return;
        if (!Array.isArray(res.data)) { setStockRead(null); return; }
        const stock: StockByProduct = new Map();
        for (const r of res.data) {
          if (!r?.productId) continue;
          const prev = stock.get(r.productId) ?? { quantity: 0, reserved: 0 };
          stock.set(r.productId, { quantity: prev.quantity + (Number(r.quantity) || 0), reserved: prev.reserved + (Number(r.reserved) || 0) });
        }
        setStockRead(stock);
      });
    return () => { live = false; };
  }, [businessId, canReadStock, loadGeneration]);

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

  /**
   * Round 4 (SEC-CAT-R3-1, SEC-CAT-R3-2): a save, a reorder or a store toggle is made only once the selected business's
   * own read of what it writes has landed, and stays off if that read failed; an answer that arrives after the
   * business changed is not applied (the write was for the other business).
   */
  const landedHere = landed !== null && landed.businessId === businessId ? landed : null;
  const canSaveBusiness = !!landedHere?.business;
  const canSaveStorefront = !!landedHere?.storefront;
  const canChangeListing = !!landedHere?.graph;
  // COR-R4-2: the listing read was refused (403, no revenue read): changing the listing stays off, and it is not a
  // failed load that a refresh would fix.
  const listingRefused = !!landedHere && !landedHere.graph && landedHere.graphRefused;
  const isCurrent = (askedFor: string) => currentBusiness.current === askedFor;

  function refuse(ready: boolean, what: string, refused = false): boolean {
    if (ready) return false;
    if (!landedHere) toast.info("This store is still loading. Try again in a moment.");
    else if (refused) toast.error(`You do not have permission to see this business's ${what}, so it cannot be changed here.`);
    else toast.error(`This business's ${what} did not load, so nothing was saved. Refresh the page to try again.`);
    return true;
  }
  const refuseListing = () => refuse(canChangeListing, "store listing", listingRefused);

  // CUSTOMER-PAGE-HONESTY (journey F1): the link the owner shares is /book/<saved slug>. Never the business id (a
  // business is created with no slug) and never the slug input's unsaved text; with no saved slug there is no link
  // ("": every caller then disables or hides its share actions).
  function getPublicBookingUrl() {
    const domain = typeof window !== "undefined" ? window.location.origin : "";
    const savedSlug = businessData?.slug?.trim();
    return savedSlug ? `${domain}/book/${encodeURIComponent(savedSlug)}` : "";
  }

  async function handleSaveSlug() {
    if (!businessId || !storeSlug.trim()) return;
    if (!isCurrent(businessId) || refuse(canSaveBusiness, "details")) return;
    const askedFor = businessId;
    setSlugSaving(true);
    const slug = storeSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
    setStoreSlug(slug);
    const res = await updateBusiness({ businessId: askedFor, slug });
    if (!isCurrent(askedFor)) return;
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
    if (!isCurrent(businessId) || refuse(canSaveBusiness, "details")) return;
    const askedFor = businessId;
    const newValue = !storeEnabled;
    const res = await updateBusiness({ businessId: askedFor, storeEnabled: newValue } as Parameters<typeof updateBusiness>[0]);
    if (!isCurrent(askedFor)) return;
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
    if (!isCurrent(businessId) || refuse(canSaveBusiness, "details")) return;
    const askedFor = businessId;
    setHoursSaving(true);
    const res = await updateBusiness({ businessId: askedFor, businessHours } as Parameters<typeof updateBusiness>[0]);
    if (!isCurrent(askedFor)) return;
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
    if (!isCurrent(businessId) || refuseListing()) return;
    const askedFor = businessId;
    setSyncing(true);
    let synced = 0;
    for (const drift of driftedItems) {
      if (!isCurrent(askedFor)) return;
      const data: { price?: number; duration?: number } = {};
      if (drift.priceDiff) data.price = drift.commercePrice;
      if (drift.durationDiff && drift.commerceDuration != null) data.duration = drift.commerceDuration;
      const res = await updateService(drift.serviceId, data, askedFor);
      if (!res.error) synced++;
    }
    if (!isCurrent(askedFor)) return;
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
    if (!isCurrent(businessId) || refuseListing()) return;
    const askedFor = businessId;
    if (graphProductToServiceMap.has(product.id)) {
      toast.warning(`"${product.name}" is already in your store.`);
      return;
    }
    setProcessingItems((prev) => new Set(prev).add(product.id));
    try {
      const res = await createService({
        businessId: askedFor,
        name: product.name,
        durationMins: product.duration ?? 30,
        price: product.price,
        description: product.description ?? undefined,
        sourceProductId: product.id,
      });
      if (!isCurrent(askedFor)) return;
      if (res.error) {
        toast.error(`Failed to add: ${res.error}`);
      } else {
        toast.success(`"${product.name}" added to store!`);
        emitEvent("store:item_added", "store", { productId: product.id, productName: product.name });
        await loadData();
      }
    } finally {
      if (isCurrent(askedFor))
        setProcessingItems((prev) => {
          const n = new Set(prev);
          n.delete(product.id);
          return n;
        });
    }
  }

  /**
   * One store item removed for the business it was asked for, with no confirmation (the caller has it). "stale": the
   * business changed before the answer, so nothing of it is applied or said.
   */
  async function removeOne(serviceId: string, askedFor: string): Promise<"removed" | "failed" | "stale"> {
    const productId = storeGraph?.mappings.find((m) => m.serviceId === serviceId)?.productId;
    if (productId) setProcessingItems((prev) => new Set(prev).add(productId));
    try {
      const res = await deleteService(serviceId, askedFor);
      if (!isCurrent(askedFor)) return "stale";
      if (res.error) {
        toast.error(`Failed to remove: ${res.error}`);
        return "failed";
      }
      return "removed";
    } finally {
      if (productId && isCurrent(askedFor))
        setProcessingItems((prev) => {
          const n = new Set(prev);
          n.delete(productId);
          return n;
        });
    }
  }

  async function handleDeleteServiceFromStore(serviceId: string, _productName?: string) {
    if (!businessId) return;
    if (!isCurrent(businessId) || refuseListing()) return;
    const askedFor = businessId;
    const mapping = storeGraph?.mappings.find((m) => m.serviceId === serviceId);
    const productId = mapping?.productId;
    if (productId && confirmRemove !== productId) {
      setConfirmRemove(productId);
      return;
    }
    setConfirmRemove(null);
    if ((await removeOne(serviceId, askedFor)) !== "removed") return;
    toast.info("Removed from store.");
    await loadData();
  }

  async function handleToggleStoreItem(product: Product) {
    const mapping = storeGraph?.mappings.find((m) => m.productId === product.id);
    if (mapping?.isLive && mapping.serviceId) {
      await handleDeleteServiceFromStore(mapping.serviceId, product.name);
    } else {
      await handleQuickAddProduct(product);
    }
  }

  /**
   * COR-R5-3: a bulk run asked for while one is going on for this business is ignored.
   * Round 7 (SEC-R6-m2): the run is told whether it is still the current run. A switch ends it (switchTo clears the
   * guard), and it stays ended when its business is selected again (A -> B -> A): isCurrent(A) is true again then,
   * and a fresh run may have started, so a run that went on with the list it read before the switch would add or
   * remove the same items twice.
   */
  async function asBulkRun(run: (live: () => boolean) => Promise<void>) {
    if (bulkRun.current) return;
    const token = {};
    bulkRun.current = token;
    setBulkRunning(true);
    try {
      await run(() => bulkRun.current === token);
    } finally {
      if (bulkRun.current === token) {
        bulkRun.current = null;
        setBulkRunning(false);
      }
    }
  }

  async function handleSelectAll() {
    if (!businessId) return;
    if (!isCurrent(businessId) || refuseListing()) return;
    const askedFor = businessId;
    const notAdded = commerceProducts.filter((p) => !graphProductToServiceMap.has(p.id));
    await asBulkRun(async (live) => {
      for (const p of notAdded) {
        // An "Add all" running when the business changes stops there, and does not resume when it comes back.
        if (!live() || !isCurrent(askedFor)) return;
        await handleQuickAddProduct(p);
      }
    });
  }

  /**
   * "Remove all", once confirmed (catalog-manager asks once for all): every live item of this business is removed.
   * Round 5 (COR-R4-1): it called the single-item remove, whose confirmation state is the one read at render, so each
   * item was only armed and nothing was removed. A run stops when the business changes.
   */
  async function handleDeselectAll() {
    if (!businessId) return;
    if (!isCurrent(businessId) || refuseListing()) return;
    if (!storeGraph) return;
    const askedFor = businessId;
    const liveEntries = storeGraph.mappings.filter((m) => m.isLive && m.serviceId);
    await asBulkRun(async (live) => {
      setConfirmRemove(null);
      let removed = 0;
      for (const entry of liveEntries) {
        if (!live() || !isCurrent(askedFor)) return;
        const outcome = await removeOne(entry.serviceId!, askedFor);
        if (outcome === "stale") return;
        if (outcome === "removed") removed++;
      }
      if (!isCurrent(askedFor) || removed === 0) return;
      toast.info(removed === 1 ? "Removed from store." : `Removed ${removed} items from store.`);
      await loadData();
    });
  }

  function handleConfigChange(section: string, updates: Record<string, unknown>) {
    setStorefrontConfig((prev) => withConfigChange(prev, section, updates));
  }

  /**
   * P237: a change saved at once (Operations' store status). The save sends the config with the change in it:
   * handleSaveConfig called in the same tick sends this render's storefrontConfig, from before the change.
   */
  function handleConfigChangeAndSave(section: string, updates: Record<string, unknown>) {
    handleConfigChange(section, updates);
    return saveConfig(withConfigChange(storefrontConfig, section, updates));
  }

  function handleReorderProducts(orderedIds: string[]) {
    if (!businessId) return;
    // The order is saved with the storefront it belongs to: only this business's, once it has been read.
    if (!isCurrent(businessId) || refuse(canSaveStorefront, "storefront settings")) return;
    const askedFor = businessId;
    handleConfigChange("catalog", { productOrder: orderedIds });
    updateStorefrontConfig(askedFor, {
      ...storefrontConfig,
      catalog: { ...storefrontConfig.catalog, productOrder: orderedIds },
    }).then((res) => {
      if (isCurrent(askedFor) && !res.error) toast.success("Display order saved");
    });
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

  function handleSaveConfig() {
    return saveConfig(storefrontConfig);
  }

  async function saveConfig(config: StorefrontConfig) {
    if (!businessId) return;
    if (!isCurrent(businessId) || refuse(canSaveStorefront, "storefront settings")) return;
    const askedFor = businessId;
    setConfigSaving(true);
    const res = await updateStorefrontConfig(askedFor, config);
    if (!isCurrent(askedFor)) return;
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
    stockByProduct,
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
    handleConfigChangeAndSave,
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
    canSaveBusiness,
    canSaveStorefront,
    canChangeListing,
    listingRefused,
    bulkRunning,
  };
}
