"use client";

import type { ReactNode } from "react";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  Clock,
  User,
  Briefcase,
  CheckCircle2,
  Copy,
  AlertCircle,
  Phone,
  Mail,
  Store,
  ExternalLink,
  Globe,
  Sparkles,
  Link as LinkIcon,
  MapPin,
  ShoppingBag,
  Package,
  Loader2,
  XCircle,
  Search,
  ShoppingCart,
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
import { apiGet } from "@/lib/api";
import { formatPrice } from "@/lib/format";

export default function StorePage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [commerceProducts, setCommerceProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ text: string; type: "success" | "error" | "info" | "warning" } | null>(null);

  const [businessData, setBusinessData] = useState<{
    name?: string; slug?: string | null; logoUrl?: string | null;
    tagline?: string | null; description?: string | null; address?: string | null;
    phone?: string | null; email?: string | null; website?: string | null;
    primaryColor?: string | null; secondaryColor?: string | null;
    storeEnabled?: boolean;
  } | null>(null);
  const [storeSlug, setStoreSlug] = useState("");
  const [slugSaving, setSlugSaving] = useState(false);
  const [storePreview, setStorePreview] = useState(true);
  const [processingItems, setProcessingItems] = useState<Set<string>>(new Set());
  const [linkCopied, setLinkCopied] = useState(false);
  const [slugStatus, setSlugStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [storeEnabled, setStoreEnabled] = useState(true);
  type DayHours = { open: string; close: string; closed: boolean };
  const defaultHours: Record<string, DayHours> = {
    mon: { open: '09:00', close: '17:00', closed: false },
    tue: { open: '09:00', close: '17:00', closed: false },
    wed: { open: '09:00', close: '17:00', closed: false },
    thu: { open: '09:00', close: '17:00', closed: false },
    fri: { open: '09:00', close: '17:00', closed: false },
    sat: { open: '10:00', close: '14:00', closed: false },
    sun: { open: '10:00', close: '14:00', closed: true },
  };
  const [businessHours, setBusinessHours] = useState<Record<string, DayHours>>(defaultHours);
  const [hoursSaving, setHoursSaving] = useState(false);
  const [driftedItems, setDriftedItems] = useState<{ serviceId: string; serviceName: string; priceDiff: boolean; durationDiff: boolean; commercePrice: number; commerceDuration: number | null }[]>([]);
  const [syncing, setSyncing] = useState(false);
  const slugCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const initWorkspace = async () => {
      const fresh = await refreshWorkspace();
      if (fresh) { setBusinessId(fresh); return; }
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
          setBusinessHours({ ...defaultHours, ...(bizRes.data as any).businessHours });
        }
      }
      const drifts: typeof driftedItems = [];
      for (const svc of loadedServices) {
        const product = loadedProducts.find((p: Product) => p.name === svc.name);
        if (!product) continue;
        const priceDiff = Math.abs(svc.price - product.price) > 0.01;
        const svcDuration = (svc as any).durationMins ?? (svc as any).duration ?? null;
        const durationDiff = product.duration != null && svcDuration != null && svcDuration !== product.duration;
        if (priceDiff || durationDiff) {
          drifts.push({ serviceId: svc.id, serviceName: svc.name, priceDiff, durationDiff, commercePrice: product.price, commerceDuration: product.duration ?? null });
        }
      }
      setDriftedItems(drifts);
    } catch (e) {
      console.error("Failed to load store data:", e);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { void loadData(); }, [loadData]);

  useEffect(() => {
    if (!storeSlug.trim()) {
      setSlugStatus('idle');
      return;
    }
    setSlugStatus('checking');
    if (slugCheckTimer.current) clearTimeout(slugCheckTimer.current);
    slugCheckTimer.current = setTimeout(async () => {
      const slug = storeSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
      if (slug === businessData?.slug) {
        setSlugStatus('available');
        return;
      }
      const res = await apiGet<{ available: boolean }>(`/identity/businesses/slug-check/${encodeURIComponent(slug)}`);
      if (res.data && res.data.available) {
        setSlugStatus('available');
      } else {
        setSlugStatus('taken');
      }
    }, 500);
    return () => { if (slugCheckTimer.current) clearTimeout(slugCheckTimer.current); };
  }, [storeSlug, businessData?.slug]);

  function getPublicBookingUrl() {
    const domain = typeof window !== "undefined" ? window.location.origin : "";
    const identifier = storeSlug || businessId;
    return identifier ? `${domain}/book/${identifier}` : "";
  }

  function copyPublicLink() {
    navigator.clipboard.writeText(getPublicBookingUrl());
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
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
      setBusinessData((prev) => prev ? { ...prev, slug } : prev);
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
      setBusinessData((prev) => prev ? { ...prev, storeEnabled: newValue } : prev);
      setBanner({ text: newValue ? "Store is now published!" : "Store is now unpublished.", type: newValue ? "success" : "info" });
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
      setProcessingItems((prev) => { const n = new Set(prev); n.delete(product.id); return n; });
    }
  }

  async function handleDeleteServiceFromStore(serviceId: string, productName?: string) {
    if (!businessId) return;
    const matchedProduct = commerceProducts.find((p) => p.name === (productName ?? services.find((s) => s.id === serviceId)?.name));
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
      if (matchedProduct) setProcessingItems((prev) => { const n = new Set(prev); n.delete(matchedProduct.id); return n; });
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
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <AlertCircle className="w-12 h-12 text-primary/60 mx-auto" />
          <h2 className="text-lg font-semibold text-primary">We could not find your workspace. Please sign in again.</h2>
          <p className="text-sm text-muted-foreground">Try logging in again to create your workspace.</p>
        </div>
      </div>
    );
  }

  const storeItemCount = services.filter((s) => commerceProducts.some((p) => p.name === s.name)).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-primary/20 to-secondary/20 border border-primary/30 flex items-center justify-center text-primary">
            <Store className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Online Store</h1>
            <p className="text-sm text-muted-foreground">Manage your public storefront and booking page</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleStoreEnabled}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${storeEnabled ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20" : "bg-yellow-500/10 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/20"}`}
          >
            {storeEnabled ? 'Published' : 'Unpublished'}
          </button>
          <button
            onClick={copyPublicLink}
            disabled={!getPublicBookingUrl() || !storeEnabled}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40"
            aria-label="Copy public booking link"
          >
            {linkCopied ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            {linkCopied ? "Copied!" : "Copy Link"}
          </button>
          <a
            href={getPublicBookingUrl() || "#"}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-background border border-border/60 hover:border-primary/40 transition-colors ${!getPublicBookingUrl() || !storeEnabled ? "opacity-40 pointer-events-none" : ""}`}
            aria-label="Open store in new tab"
          >
            <ExternalLink className="w-4 h-4" /> Open Store
          </a>
        </div>
      </div>

      {/* Unpublished Banner */}
      {!storeEnabled && (
        <div role="status" className="rounded-xl border px-4 py-3 text-sm flex items-center gap-2 bg-yellow-500/10 border-yellow-500/30 text-yellow-300">
          <AlertCircle className="w-4 h-4" />
          Your store is currently unpublished. Customers cannot see your booking page.
        </div>
      )}

      {driftedItems.length > 0 && (
        <div role="status" className="rounded-xl border px-4 py-3 text-sm flex items-center gap-2 bg-amber-500/10 border-amber-500/30 text-amber-300">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{driftedItems.length} store item{driftedItems.length !== 1 ? "s have" : " has"} outdated prices or durations compared to Commerce.</span>
          <button
            onClick={syncDriftedItems}
            disabled={syncing}
            className="ml-auto px-3 py-1 rounded-lg text-xs font-medium bg-amber-500/20 border border-amber-500/30 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
          >
            {syncing ? "Syncing..." : "Sync All"}
          </button>
        </div>
      )}

      {/* Banner */}
      {banner && (
        <div role="status" className={`rounded-xl border px-4 py-3 text-sm flex items-center gap-2 ${banner.type === "success" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" : banner.type === "error" ? "bg-red-500/10 border-red-500/30 text-red-300" : banner.type === "warning" ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-300" : "bg-primary/10 border-primary/30 text-primary"}`}>
          {banner.type === "success" ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {banner.text}
          <button onClick={() => setBanner(null)} className="ml-auto text-xs opacity-60 hover:opacity-100">Dismiss</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center space-y-3">
            <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
            <p className="text-sm text-muted-foreground">Loading store...</p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Public Link Section */}
          <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/5 to-secondary/5 backdrop-blur p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Globe className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Public Booking Link</h3>
                <p className="text-xs text-muted-foreground">Share this link so customers can browse and book your services</p>
              </div>
            </div>
            {getPublicBookingUrl() && (
              <div className="flex items-center gap-2 rounded-xl border border-border/40 bg-slate-950/60 px-3 py-2">
                <LinkIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs text-slate-300 truncate">{getPublicBookingUrl()}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center rounded-xl border border-border/60 bg-slate-950/80 overflow-hidden">
                <span className="px-3 py-2.5 text-xs text-muted-foreground bg-slate-900/50 border-r border-border/60 whitespace-nowrap">
                  Customize URL (optional):&nbsp; /book/
                </span>
                <input
                  type="text"
                  value={storeSlug}
                  onChange={(e) => setStoreSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                  placeholder="your-business-name"
                  className="flex-1 px-3 py-2.5 bg-transparent text-sm focus:outline-none"
                />
                {slugStatus === 'checking' && (
                  <div className="px-2 flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  </div>
                )}
                {slugStatus === 'available' && (
                  <div className="px-2 flex items-center gap-1 text-xs text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Available
                  </div>
                )}
                {slugStatus === 'taken' && (
                  <div className="px-2 flex items-center gap-1 text-xs text-red-400">
                    <XCircle className="w-3.5 h-3.5" /> Already taken
                  </div>
                )}
              </div>
              <button
                onClick={handleSaveSlug}
                disabled={slugSaving || !storeSlug.trim() || slugStatus === 'taken'}
                className="px-4 py-2.5 rounded-xl text-xs font-medium bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
              >
                {slugSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>

          {/* Toggle: Preview / Edit */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Store className="w-4 h-4 text-primary" />
              {storePreview ? "Customer View Preview" : "Edit Store Items"}
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setStorePreview(true)}
                aria-pressed={storePreview}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${storePreview ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground border border-transparent hover:border-border/60"}`}
              >
                Preview
              </button>
              <button
                onClick={() => setStorePreview(false)}
                aria-pressed={!storePreview}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${!storePreview ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground border border-transparent hover:border-border/60"}`}
              >
                Edit
              </button>
            </div>
          </div>

          {/* ─── CUSTOMER PREVIEW ─── */}
          {storePreview ? (
            <div className="rounded-2xl border border-border/60 overflow-hidden">
              <div className="bg-[#0a0a0f] p-6">
                <div className="mx-auto max-w-3xl space-y-8">
                  {/* Hero */}
                  <div className="text-center space-y-3 relative">
                    <div
                      className="absolute inset-0 opacity-[0.07] rounded-2xl"
                      style={{ background: `radial-gradient(ellipse at 50% 0%, ${businessData?.primaryColor || "#F97316"}, transparent 70%)` }}
                    />
                    <div className="relative pt-4 pb-2">
                      {businessData?.logoUrl && (
                        <img src={businessData.logoUrl} alt="Logo" className="h-16 w-16 rounded-2xl mx-auto object-cover border-2 border-white/10 shadow-xl" />
                      )}
                      <h2 className="text-2xl font-bold text-white mt-3">{businessData?.name ?? "Your Business"}</h2>
                      {businessData?.tagline ? <p className="text-sm text-white/50">{businessData.tagline}</p> : <p className="text-sm text-white/50">Book your appointment online</p>}
                      {(businessData?.address || businessData?.phone || businessData?.email) && (
                        <div className="flex items-center justify-center gap-4 text-xs text-white/40 flex-wrap mt-2">
                          {businessData?.address && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {businessData.address}</span>}
                          {businessData?.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {businessData.phone}</span>}
                          {businessData?.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> {businessData.email}</span>}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Unified Catalog Preview */}
                  {(() => {
                    const pc = businessData?.primaryColor || "#F97316";
                    const sc = businessData?.secondaryColor || "#14B8A6";
                    const storeNames = new Set(services.map((s) => s.name));
                    type PreviewItem = { id: string; name: string; description?: string | null; price: number; currency: string; duration?: number | null; imageUrl?: string | null; itemType: 'service' | 'product' | 'package' };
                    const allItems: PreviewItem[] = [
                      ...services.map((s) => ({ id: s.id, name: s.name, description: s.description, price: s.price, currency: s.currency ?? 'TTD', duration: (s as any).durationMins ?? s.duration, imageUrl: null as string | null, itemType: 'service' as const })),
                      ...commerceProducts.filter((p) => p.category === "PRODUCT" && storeNames.has(p.name)).map((p) => ({ id: p.id, name: p.name, description: p.description, price: p.price, currency: p.currency ?? 'TTD', duration: null as number | null, imageUrl: (p as any).imageUrl ?? null, itemType: 'product' as const })),
                      ...commerceProducts.filter((p) => p.category === "PACKAGE" && storeNames.has(p.name)).map((p) => ({ id: p.id, name: p.name, description: p.description, price: p.price, currency: p.currency ?? 'TTD', duration: (p as any).duration ?? null, imageUrl: (p as any).imageUrl ?? null, itemType: 'package' as const })),
                    ];

                    if (allItems.length === 0) {
                      return (
                        <div className="text-center py-6 space-y-2">
                          <Store className="w-8 h-8 text-white/20 mx-auto" />
                          <p className="text-sm text-white/40">Your store is empty. Switch to Edit mode to add items from Commerce.</p>
                        </div>
                      );
                    }

                    const typeBadge = (t: string) => {
                      const map: Record<string, { icon: ReactNode; label: string; color: string }> = {
                        service: { icon: <Briefcase className="w-2.5 h-2.5" />, label: 'Service', color: pc },
                        product: { icon: <ShoppingBag className="w-2.5 h-2.5" />, label: 'Product', color: sc },
                        package: { icon: <Package className="w-2.5 h-2.5" />, label: 'Package', color: '#a78bfa' },
                      };
                      const b = map[t] || map.service;
                      return (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ backgroundColor: `${b.color}20`, color: b.color }}>
                          {b.icon} {b.label}
                        </span>
                      );
                    };

                    const hasServices = allItems.some((i) => i.itemType === 'service');
                    const hasProducts = allItems.some((i) => i.itemType === 'product');
                    const hasPackages = allItems.some((i) => i.itemType === 'package');
                    const tabs = [
                      { key: 'all', label: 'All' },
                      ...(hasServices ? [{ key: 'service', label: 'Services' }] : []),
                      ...(hasProducts ? [{ key: 'product', label: 'Products' }] : []),
                      ...(hasPackages ? [{ key: 'package', label: 'Packages' }] : []),
                    ];

                    return (
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          {tabs.map((tab) => (
                            <span key={tab.key} className={`px-3 py-1.5 rounded-full text-xs font-medium cursor-default transition-all ${tab.key === 'all' ? 'text-white' : 'text-white/40 bg-white/[0.03]'}`} style={tab.key === 'all' ? { backgroundColor: `${pc}20`, color: pc } : {}}>
                              {tab.label}
                            </span>
                          ))}
                          <div className="flex-1" />
                          <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
                            <div className="rounded-lg border border-white/10 bg-white/[0.03] pl-8 pr-3 py-1.5 text-xs text-white/25 w-36">Search...</div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          {allItems.map((item) => {
                            const accentColor = item.itemType === 'service' ? pc : item.itemType === 'product' ? sc : '#a78bfa';
                            return (
                              <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden hover:border-white/20 transition-all">
                                {item.imageUrl && <img src={item.imageUrl} alt={item.name} className="w-full h-24 object-cover" />}
                                <div className="p-3 space-y-2">
                                  <div className="flex items-start justify-between gap-1">
                                    <div className="space-y-1 min-w-0">
                                      {typeBadge(item.itemType)}
                                      <h4 className="text-xs font-semibold text-white leading-tight truncate">{item.name}</h4>
                                    </div>
                                    <span className="text-xs font-bold whitespace-nowrap" style={{ color: accentColor }}>{formatPrice(item.price, item.currency)}</span>
                                  </div>
                                  {item.description && <p className="text-[10px] text-white/40 line-clamp-2">{item.description}</p>}
                                  <div className="flex items-center justify-between">
                                    {item.duration ? <span className="text-[10px] text-white/30 flex items-center gap-1"><Clock className="w-2.5 h-2.5" />{item.duration} min</span> : <span />}
                                    <span className="text-[10px] font-medium flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 text-white/50">
                                      <ShoppingCart className="w-2.5 h-2.5" /> Add
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                          <div className="flex items-center gap-2">
                            <ShoppingCart className="w-4 h-4 text-white/40" />
                            <span className="text-xs text-white/40">Cart preview</span>
                          </div>
                          <span className="text-xs text-white/25">Items appear here on the live page</span>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="text-center text-xs text-white/20">
                    Powered by <span className="font-semibold" style={{ color: businessData?.primaryColor || "#F97316" }}>KeyFlowOS</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* ─── EDIT MODE ─── */
            <div className="space-y-4">
              {/* ─── Business Hours ─── */}
              <div className="rounded-2xl border border-secondary/20 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-secondary/15" style={{ backgroundColor: "rgba(20,184,166,0.05)" }}>
                  <div className="flex items-center gap-2.5">
                    <Clock className="w-5 h-5 text-secondary" />
                    <div>
                      <h3 className="text-sm font-bold text-foreground">Business Hours</h3>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Set when customers can book appointments</p>
                    </div>
                  </div>
                  <button onClick={handleSaveHours} disabled={hoursSaving} className="px-4 py-2 rounded-xl text-xs font-medium bg-secondary/10 border border-secondary/30 text-secondary hover:bg-secondary/20 transition-colors disabled:opacity-50">
                    {hoursSaving ? "Saving..." : "Save Hours"}
                  </button>
                </div>
                <div className="p-3 space-y-1">
                  {(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).map((day) => {
                    const label = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }[day];
                    const h = businessHours[day];
                    return (
                      <div key={day} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/[0.02] transition-colors">
                        <span className="text-sm font-medium w-24">{label}</span>
                        <button
                          type="button"
                          onClick={() => setBusinessHours((prev) => ({ ...prev, [day]: { ...prev[day], closed: !prev[day].closed } }))}
                          className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${h.closed ? 'bg-muted-foreground/30' : 'bg-secondary'}`}
                        >
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${h.closed ? 'left-0.5' : 'left-[22px]'}`} />
                        </button>
                        {h.closed ? (
                          <span className="text-xs text-muted-foreground">Closed</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <input type="time" value={h.open} onChange={(e) => setBusinessHours((prev) => ({ ...prev, [day]: { ...prev[day], open: e.target.value } }))} className="px-2 py-1 rounded-lg border border-border/40 bg-slate-950/60 text-xs focus:outline-none" />
                            <span className="text-xs text-muted-foreground">to</span>
                            <input type="time" value={h.close} onChange={(e) => setBusinessHours((prev) => ({ ...prev, [day]: { ...prev[day], close: e.target.value } }))} className="px-2 py-1 rounded-lg border border-border/40 bg-slate-950/60 text-xs focus:outline-none" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ─── Inline Store Items Manager ─── */}
              <div className="rounded-2xl border border-primary/20 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-primary/15" style={{ backgroundColor: "rgba(249,115,22,0.05)" }}>
                  <div className="flex items-center gap-2.5">
                    <Store className="w-5 h-5" style={{ color: "#F97316" }} />
                    <div>
                      <h3 className="text-sm font-bold text-foreground">Store Items</h3>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Toggle items from Commerce to display in your online store</p>
                    </div>
                  </div>
                  {commerceProducts.length > 0 && (
                    <div className="flex items-center gap-3">
                      {storeItemCount > 0 && (
                        <button
                          onClick={() => handleDeselectAll()}
                          className="text-xs font-medium text-red-400 hover:text-red-300 transition-colors"
                        >
                          Deselect All
                        </button>
                      )}
                      <button
                        onClick={() => handleSelectAll()}
                        disabled={commerceProducts.every((p) => services.some((s) => s.name === p.name))}
                        className="text-xs font-medium hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        style={{ color: "#F97316" }}
                      >
                        Select All
                      </button>
                    </div>
                  )}
                </div>

                {commerceProducts.length > 0 ? (
                  <div className="p-3 space-y-2">
                    {commerceProducts.map((p) => {
                      const isOnStore = services.some((s) => s.name === p.name);
                      const isProcessing = processingItems.has(p.id);
                      const isConfirming = confirmRemove === p.id;
                      return (
                        <div
                          key={p.id}
                          className={`relative w-full flex items-center gap-3 rounded-xl px-4 py-3.5 text-left text-sm border cursor-pointer transition-all ${isProcessing ? "opacity-60 pointer-events-none" : ""} ${isOnStore ? "border-primary/30 hover:border-primary/50" : "border-border/40 hover:border-border/60"}`}
                          style={{ backgroundColor: isOnStore ? "rgba(249,115,22,0.08)" : "rgba(255,255,255,0.02)" }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!isProcessing) handleToggleStoreItem(p); } }}
                          onClick={() => !isProcessing && !isConfirming && handleToggleStoreItem(p)}
                        >
                          {isConfirming && (
                            <div className="absolute inset-0 rounded-xl bg-background/95 backdrop-blur-sm flex items-center justify-center gap-3 z-10 border border-red-500/30">
                              <span className="text-sm font-medium text-red-400">Remove?</span>
                              <button
                                onClick={(e) => { e.stopPropagation(); setConfirmRemove(null); }}
                                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border/60 text-muted-foreground hover:bg-muted transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const matchedService = services.find((s) => s.name === p.name);
                                  if (matchedService) handleDeleteServiceFromStore(matchedService.id, p.name);
                                }}
                                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 transition-colors"
                              >
                                Confirm
                              </button>
                            </div>
                          )}
                          <div className={`h-5 w-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${isOnStore ? "border-primary" : "border-muted-foreground/30"}`} style={isOnStore ? { backgroundColor: "#F97316", borderColor: "#F97316" } : {}}>
                            {isProcessing ? (
                              <div className="w-3 h-3 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
                            ) : isOnStore ? (
                              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                            ) : null}
                          </div>
                          <div className="h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: isOnStore ? "rgba(249,115,22,0.15)" : "rgba(255,255,255,0.05)", border: isOnStore ? "1px solid rgba(249,115,22,0.3)" : "1px solid rgba(255,255,255,0.1)" }}>
                            <Briefcase className="w-4 h-4" style={{ color: isOnStore ? "#F97316" : "rgba(255,255,255,0.4)" }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`font-medium truncate ${isOnStore ? "text-foreground" : "text-muted-foreground"}`}>{p.name}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full uppercase flex-shrink-0" style={{ border: "1px solid rgba(249,115,22,0.2)", color: "rgba(249,115,22,0.7)" }}>{p.category}</span>
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className={`text-[11px] font-medium ${isOnStore ? "text-emerald-400" : "text-muted-foreground/60"}`}>
                                {isProcessing ? "Processing..." : isOnStore ? "✓ On store" : "Not on store"}
                              </span>
                              {p.description && <span className="text-[10px] text-muted-foreground/40 truncate max-w-[200px]">· {p.description}</span>}
                            </div>
                          </div>
                          <span className="text-xs font-semibold flex-shrink-0" style={{ color: "#F97316" }}>{formatPrice(p.price, p.currency)}</span>
                        </div>
                      );
                    })}

                    <div className="flex items-center justify-between pt-2 px-1">
                      <span className="text-xs text-muted-foreground">
                        {storeItemCount} of {commerceProducts.length} item{commerceProducts.length !== 1 ? "s" : ""} displayed on store
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="p-8 text-center space-y-3">
                    <Briefcase className="w-10 h-10 mx-auto" style={{ color: "rgba(249,115,22,0.3)" }} />
                    <p className="text-sm text-muted-foreground">No items in Commerce yet.</p>
                    <p className="text-xs text-muted-foreground">Add products in the <span className="font-medium" style={{ color: "#F97316" }}>Commerce</span> page first, then come back here to add them to your store.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
