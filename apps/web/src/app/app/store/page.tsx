"use client";

import { useEffect, useState, useCallback } from "react";
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
  fetchProducts,
  Product,
} from "@/lib/client";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";

export default function StorePage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [commerceProducts, setCommerceProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);

  const [businessData, setBusinessData] = useState<{
    name?: string; slug?: string | null; logoUrl?: string | null;
    tagline?: string | null; description?: string | null; address?: string | null;
    phone?: string | null; email?: string | null; website?: string | null;
    primaryColor?: string | null; secondaryColor?: string | null;
  } | null>(null);
  const [storeSlug, setStoreSlug] = useState("");
  const [slugSaving, setSlugSaving] = useState(false);
  const [storePreview, setStorePreview] = useState(true);
  const [processingItems, setProcessingItems] = useState<Set<string>>(new Set());
  const [linkCopied, setLinkCopied] = useState(false);

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
      setServices(servicesRes.data ?? []);
      setStaff(staffRes.data ?? []);
      setCommerceProducts((productsRes as any)?.data ?? []);
      if (bizRes.data) {
        setBusinessData(bizRes.data);
        setStoreSlug(bizRes.data.slug ?? "");
      }
    } catch (e) {
      console.error("Failed to load store data:", e);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { void loadData(); }, [loadData]);

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

  async function handleQuickAddProduct(product: Product) {
    if (!businessId) return;
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
            onClick={copyPublicLink}
            disabled={!getPublicBookingUrl()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40"
          >
            {linkCopied ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            {linkCopied ? "Copied!" : "Copy Link"}
          </button>
          <a
            href={getPublicBookingUrl() || "#"}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-background border border-border/60 hover:border-primary/40 transition-colors ${!getPublicBookingUrl() ? "opacity-40 pointer-events-none" : ""}`}
          >
            <ExternalLink className="w-4 h-4" /> Open Store
          </a>
        </div>
      </div>

      {/* Banner */}
      {banner && (
        <div className={`rounded-xl border px-4 py-3 text-sm flex items-center gap-2 ${banner.type === "success" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" : banner.type === "error" ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-primary/10 border-primary/30 text-primary"}`}>
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
              </div>
              <button
                onClick={handleSaveSlug}
                disabled={slugSaving || !storeSlug.trim()}
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
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${storePreview ? "bg-primary/20 text-primary border border-primary/30" : "text-muted-foreground border border-transparent hover:border-border/60"}`}
              >
                Preview
              </button>
              <button
                onClick={() => setStorePreview(false)}
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

                  {/* Commerce Carousels - only show items selected for store */}
                  {(() => {
                    const storeNames = new Set(services.map((s) => s.name));
                    const serviceItems = commerceProducts.filter((p) => p.category === "SERVICE" && storeNames.has(p.name));
                    const productItems = commerceProducts.filter((p) => p.category === "PRODUCT" && storeNames.has(p.name));
                    const packageItems = commerceProducts.filter((p) => p.category === "PACKAGE" && storeNames.has(p.name));
                    const hasAny = serviceItems.length > 0 || productItems.length > 0 || packageItems.length > 0;
                    if (!hasAny) return null;
                    return (
                      <div className="space-y-6">
                        {serviceItems.length > 0 && (
                          <div className="space-y-2">
                            <h3 className="text-xs uppercase tracking-wider text-white/40 flex items-center gap-2 px-1">
                              <Briefcase className="w-3.5 h-3.5 text-primary" /> Services
                            </h3>
                            <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
                              {serviceItems.map((p) => (
                                <div key={p.id} className="flex-shrink-0 w-[220px] rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
                                  <div className="flex justify-between items-start">
                                    <h4 className="text-sm font-semibold text-white">{p.name}</h4>
                                    <span className="text-sm font-bold text-primary">${p.price}</span>
                                  </div>
                                  {p.description && <p className="text-xs text-white/40 line-clamp-2">{p.description}</p>}
                                  {p.duration && <span className="text-xs text-white/30 flex items-center gap-1"><Clock className="w-3 h-3" />{p.duration} min</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {productItems.length > 0 && (
                          <div className="space-y-2">
                            <h3 className="text-xs uppercase tracking-wider text-white/40 flex items-center gap-2 px-1">
                              <ShoppingBag className="w-3.5 h-3.5 text-secondary" /> Products
                            </h3>
                            <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
                              {productItems.map((p) => (
                                <div key={p.id} className="flex-shrink-0 w-[220px] rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
                                  <div className="flex justify-between items-start">
                                    <h4 className="text-sm font-semibold text-white">{p.name}</h4>
                                    <span className="text-sm font-bold text-secondary">${p.price}</span>
                                  </div>
                                  {p.description && <p className="text-xs text-white/40 line-clamp-2">{p.description}</p>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {packageItems.length > 0 && (
                          <div className="space-y-2">
                            <h3 className="text-xs uppercase tracking-wider text-white/40 flex items-center gap-2 px-1">
                              <Package className="w-3.5 h-3.5 text-secondary" /> Packages
                            </h3>
                            <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
                              {packageItems.map((p) => (
                                <div key={p.id} className="flex-shrink-0 w-[220px] rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
                                  <div className="flex justify-between items-start">
                                    <h4 className="text-sm font-semibold text-white">{p.name}</h4>
                                    <span className="text-sm font-bold" style={{ color: "#F97316" }}>${p.price}</span>
                                  </div>
                                  {p.description && <p className="text-xs text-white/40 line-clamp-2">{p.description}</p>}
                                  {p.duration && <span className="text-xs text-white/30 flex items-center gap-1"><Clock className="w-3 h-3" />{p.duration} min</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Booking Services Preview */}
                  {services.length === 0 && storeItemCount === 0 ? (
                    <div className="text-center py-6 space-y-2">
                      <Store className="w-8 h-8 text-white/20 mx-auto" />
                      <p className="text-sm text-white/40">Your store is empty. Switch to Edit mode to add items from Commerce.</p>
                    </div>
                  ) : services.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-xs uppercase tracking-wider text-white/40 flex items-center gap-2 px-1">
                        <Sparkles className="w-3.5 h-3.5 text-primary" /> Book an Appointment
                      </h3>
                      <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
                        {services.map((service, i) => (
                          <div
                            key={service.id}
                            className={`flex-shrink-0 w-[220px] rounded-2xl border p-4 space-y-2 transition-colors cursor-pointer ${i === 0 ? "border-primary/40 bg-primary/5" : "border-white/10 bg-white/[0.03] hover:border-white/20"}`}
                          >
                            <div className="flex justify-between items-start">
                              <h4 className="text-sm font-semibold text-white">{service.name}</h4>
                              <span className="text-sm font-bold text-primary">TTD {service.price.toLocaleString()}</span>
                            </div>
                            {service.description && <p className="text-xs text-white/40 line-clamp-2">{service.description}</p>}
                            <span className="text-xs text-white/30 flex items-center gap-1"><Clock className="w-3 h-3" />{service.durationMins ?? service.duration ?? 30} min</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Staff Preview */}
                  {staff.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-xs uppercase tracking-wider text-white/40 flex items-center gap-2 px-1">
                        <User className="w-3.5 h-3.5" /> Staff
                      </h3>
                      <div className="flex gap-2 flex-wrap">
                        {staff.map((s) => (
                          <div key={s.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                            <div className="h-7 w-7 rounded-full bg-secondary/10 border border-secondary/20 flex items-center justify-center text-xs font-bold text-secondary">
                              {s.name.charAt(0).toUpperCase()}
                            </div>
                            <span className="text-sm text-white">{s.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Form Placeholder */}
                  <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white/25">Select date...</div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white/25">Select time...</div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white/25">First Name</div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white/25">Last Name</div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white/25">Email</div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white/25">Phone</div>
                    </div>
                  </div>

                  <button
                    className="w-full py-3 rounded-xl text-white font-semibold text-sm opacity-60 cursor-default"
                    style={{ backgroundColor: businessData?.primaryColor || "#F97316" }}
                  >
                    Book Appointment
                  </button>

                  <div className="text-center text-xs text-white/20">
                    Powered by <span className="font-semibold" style={{ color: businessData?.primaryColor || "#F97316" }}>KeyFlowOS</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* ─── EDIT MODE ─── */
            <div className="space-y-4">
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
                      return (
                        <div
                          key={p.id}
                          onClick={() => !isProcessing && handleToggleStoreItem(p)}
                          className={`w-full flex items-center gap-3 rounded-xl px-4 py-3.5 text-left text-sm border cursor-pointer transition-all ${isProcessing ? "opacity-60 pointer-events-none" : ""} ${isOnStore ? "border-primary/30 hover:border-primary/50" : "border-border/40 hover:border-border/60"}`}
                          style={{ backgroundColor: isOnStore ? "rgba(249,115,22,0.08)" : "rgba(255,255,255,0.02)" }}
                        >
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
                          <span className="text-xs font-semibold flex-shrink-0" style={{ color: "#F97316" }}>{p.currency} {p.price}</span>
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
