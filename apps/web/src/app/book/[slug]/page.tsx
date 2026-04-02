"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { apiGet, apiPost, API_BASE } from "@/lib/api";
import { formatPrice } from "@/lib/format";
import { Loader2, CheckCircle2, Globe, Star, MessageCircle, Shield, Award, Flame, Sparkles, CalendarPlus, Clock, MapPin } from "lucide-react";
import { ItemDetailModal } from "./components/item-detail-modal";
import { trackStoreEvent, StorefrontConfig } from "@/lib/client";
import { getThemeStyles, type ThemeKey } from "@/lib/storefront-themes";

import type {
  Business,
  Service,
  Staff,
  CommerceProduct,
  CatalogItem,
  CartItem,
  ServiceBookingData,
} from "./components/types";
import { loadCart, saveCart } from "./components/utils";
import { BusinessHero } from "./components/business-hero";
import { CatalogGrid } from "./components/catalog-grid";
import { CartDrawer } from "./components/cart-drawer";
import { CheckoutFlow } from "./components/checkout-flow";

export default function PublicBookingPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [business, setBusiness] = useState<Business | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutMode, setCheckoutMode] = useState(false);

  const [success, setSuccess] = useState(false);
  const [bookingResults, setBookingResults] = useState<{ bookingId: string; invoiceId?: string }[]>([]);
  const [confirmedDetails, setConfirmedDetails] = useState<{
    serviceNames: string[];
    dates: string[];
    times: string[];
    businessName: string;
  } | null>(null);

  const [selectedItem, setSelectedItem] = useState<CatalogItem | null>(null);
  const [storefrontConfig, setStorefrontConfig] = useState<StorefrontConfig | null>(null);

  const primaryColor = (storefrontConfig?.appearance as any)?.primaryColor || business?.primaryColor || "#F97316";
  const secondaryColor = (storefrontConfig?.appearance as any)?.secondaryColor || business?.secondaryColor || "#14B8A6";
  const accentColor = (storefrontConfig?.appearance as any)?.accentColor || "#a78bfa";
  const themeKey = ((storefrontConfig?.appearance as any)?.theme ?? "default") as ThemeKey;
  const ts = getThemeStyles(themeKey, primaryColor, secondaryColor, accentColor);

  const updateCart = useCallback(
    (newCart: CartItem[]) => {
      setCart(newCart);
      saveCart(slug, newCart);
    },
    [slug]
  );

  const addToCart = useCallback(
    (item: CatalogItem) => {
      setCart((prev) => {
        const existing = prev.find((c) => c.id === item.id && c.itemType === item.itemType);
        let next: CartItem[];
        if (existing) {
          next = prev.map((c) =>
            c.id === item.id && c.itemType === item.itemType ? { ...c, quantity: c.quantity + 1 } : c
          );
        } else {
          next = [...prev, { ...item, quantity: 1 }];
        }
        saveCart(slug, next);
        return next;
      });
      if (business?.id) trackStoreEvent(business.id, 'add_to_cart', item.id);
    },
    [slug, business]
  );

  const removeFromCart = useCallback(
    (itemId: string, itemType: string) => {
      setCart((prev) => {
        const next = prev.filter((c) => !(c.id === itemId && c.itemType === itemType));
        saveCart(slug, next);
        return next;
      });
    },
    [slug]
  );

  const updateQuantity = useCallback(
    (itemId: string, itemType: string, delta: number) => {
      setCart((prev) => {
        const next = prev
          .map((c) => {
            if (c.id === itemId && c.itemType === itemType) {
              const newQty = c.quantity + delta;
              return newQty > 0 ? { ...c, quantity: newQty } : null;
            }
            return c;
          })
          .filter(Boolean) as CartItem[];
        saveCart(slug, next);
        return next;
      });
    },
    [slug]
  );

  const isInCart = useCallback(
    (itemId: string, itemType: string) => {
      return cart.some((c) => c.id === itemId && c.itemType === itemType);
    },
    [cart]
  );

  const handleItemClick = useCallback((item: CatalogItem) => {
    setSelectedItem(item);
    if (business?.id) trackStoreEvent(business.id, 'item_view', item.id);
  }, [business]);

  const cartTotal = cart.reduce((sum, c) => sum + c.price * c.quantity, 0);
  const cartCount = cart.reduce((sum, c) => sum + c.quantity, 0);
  const cartCurrency = cart[0]?.currency || business?.currency || "TTD";
  const serviceItemsInCart = cart.filter((c) => c.requiresBooking);

  useEffect(() => {
    const loadBusiness = async () => {
      setLoading(true);
      let res = await apiGet<Business>(`/identity/businesses/slug/${encodeURIComponent(slug)}`);
      if (res.error || !res.data) {
        res = await apiGet<Business>(`/identity/businesses/public/${encodeURIComponent(slug)}`);
      }
      if (res.error || !res.data) {
        setError("Business not found");
        setLoading(false);
        return;
      }
      if (res.data.storeEnabled === false) {
        setError("This store is currently unavailable. Please check back later.");
        setLoading(false);
        return;
      }
      setBusiness(res.data);

      const sfRes = await apiGet<any>(`/site/storefront/public/${encodeURIComponent(slug)}`);
      if (sfRes.data?.storefront) setStorefrontConfig(sfRes.data.storefront);
      else if (sfRes.data?.storefrontConfig) setStorefrontConfig(sfRes.data.storefrontConfig);

      if (res.data?.id) trackStoreEvent(res.data.id, 'page_view');

      const [servicesRes, staffRes, productsRes] = await Promise.all([
        apiGet<Service[]>(`/bookings/public/businesses/${res.data.id}/services`),
        apiGet<Staff[]>(`/bookings/public/businesses/${res.data.id}/staff`),
        apiGet<CommerceProduct[]>(`/commerce/public/businesses/${res.data.id}/products`).catch(() => ({
          data: null,
          error: "Failed to load products",
        })),
      ]);
      setServices(servicesRes.data ?? []);
      setStaff(staffRes.data ?? []);
      setProducts(productsRes.data ?? []);
      setLoading(false);
    };
    loadBusiness();
  }, [slug]);

  useEffect(() => {
    if (slug) setCart(loadCart(slug));
  }, [slug]);

  useEffect(() => {
    if (!business) return;
    const seo = storefrontConfig?.seo as { metaTitle?: string; metaDescription?: string; ogImage?: string } | undefined;
    document.title = seo?.metaTitle || `Book with ${business.name} | KeyFlowOS`;
  }, [business, storefrontConfig]);

  useEffect(() => {
    if (!business) return;
    const seo = storefrontConfig?.seo as { metaTitle?: string; metaDescription?: string; ogImage?: string } | undefined;
    const pageTitle = seo?.metaTitle || `${business.name} | Book Online`;
    const description = seo?.metaDescription || business.tagline || `Book an appointment with ${business.name} online.`;
    const ogImage = seo?.ogImage || business.logoUrl;
    const pageUrl = typeof window !== "undefined" ? window.location.href : "";
    const ogTags: Record<string, string> = {
      description,
      "og:title": pageTitle,
      "og:description": description,
      "og:type": "website",
      "og:url": pageUrl,
      "og:site_name": "KeyFlowOS",
      "twitter:card": seo?.ogImage ? "summary_large_image" : "summary",
      "twitter:title": pageTitle,
      "twitter:description": description,
    };
    if (ogImage) {
      ogTags["og:image"] = ogImage;
      ogTags["twitter:image"] = ogImage;
    }
    for (const [key, value] of Object.entries(ogTags)) {
      const isOg = key.startsWith("og:") || key.startsWith("twitter:");
      const attr = isOg ? "property" : "name";
      let meta = document.querySelector(`meta[${attr}="${key}"]`);
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute(attr, key);
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", value);
    }
  }, [business, storefrontConfig]);

  const catalogItems: CatalogItem[] = (() => {
    const items: CatalogItem[] = [];
    for (const s of services) {
      items.push({
        id: s.id,
        name: s.name,
        description: s.description,
        price: s.price,
        currency: s.currency ?? business?.currency ?? "TTD",
        duration: s.durationMins ?? s.duration,
        imageUrl: null,
        itemType: "service",
        requiresBooking: true,
        sourceServiceId: s.id,
      });
    }
    const storeServiceNames = new Set(services.map((s) => s.name));
    for (const p of products) {
      if (!p.isActive) continue;
      if (p.category === "PRODUCT") {
        items.push({
          id: p.id,
          name: p.name,
          description: p.description,
          price: p.price,
          currency: p.currency,
          duration: null,
          imageUrl: p.imageUrl,
          itemType: "product",
          requiresBooking: false,
        });
      } else if (p.category === "PACKAGE") {
        items.push({
          id: p.id,
          name: p.name,
          description: p.description,
          price: p.price,
          currency: p.currency,
          duration: p.duration,
          imageUrl: p.imageUrl,
          itemType: "package",
          requiresBooking: false,
        });
      } else if (p.category === "SERVICE" && !storeServiceNames.has(p.name)) {
        items.push({
          id: p.id,
          name: p.name,
          description: p.description,
          price: p.price,
          currency: p.currency,
          duration: p.duration,
          imageUrl: p.imageUrl,
          itemType: "service",
          requiresBooking: false,
        });
      }
    }
    const pOrder = (storefrontConfig?.catalog as any)?.productOrder as string[] | undefined;
    if (pOrder?.length) {
      const orderMap = new Map(pOrder.map((id, idx) => [id, idx]));
      items.sort((a, b) => {
        const ai = orderMap.get(a.id) ?? Infinity;
        const bi = orderMap.get(b.id) ?? Infinity;
        return ai - bi;
      });
    }
    return items;
  })();

  const handleCheckoutSubmit = async (data: {
    serviceBookings: Record<string, ServiceBookingData>;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  }) => {
    if (!business) return;
    const results: { bookingId: string; invoiceId?: string }[] = [];
    const nonBookingItems = cart.filter((c) => !c.requiresBooking);
    const notesExtra =
      nonBookingItems.length > 0
        ? `\nAdditional items: ${nonBookingItems.map((c) => `${c.name} x${c.quantity}`).join(", ")}`
        : "";

    for (const si of serviceItemsInCart) {
      const bd = data.serviceBookings[`${si.id}_${si.itemType}`];
      if (!bd) continue;

      const svc = services.find((s) => s.id === (si.sourceServiceId || si.id));
      const dur = svc?.durationMins ?? svc?.duration ?? 60;
      const startTime = new Date(`${bd.date}T${bd.time}`).toISOString();

      for (let q = 0; q < si.quantity; q++) {
        const { data: resData, error: err } = await apiPost<{
          bookingId: string;
          invoiceId?: string;
          success: boolean;
        }>({
          path: `/bookings/public/businesses/${business.id}`,
          body: {
            serviceId: si.sourceServiceId || si.id,
            staffId: bd.staffId || undefined,
            startTime,
            firstName: data.firstName || undefined,
            lastName: data.lastName || undefined,
            email: data.email || undefined,
            phone: data.phone || undefined,
            notes: notesExtra.trim() || undefined,
          },
        });

        if (err) throw new Error(err);
        if (resData) results.push({ bookingId: resData.bookingId, invoiceId: resData.invoiceId });
      }
    }

    if (serviceItemsInCart.length === 0 && nonBookingItems.length > 0) {
      results.push({ bookingId: "order-" + Date.now().toString(36) });
    }

    const svcNames: string[] = [];
    const svcDates: string[] = [];
    const svcTimes: string[] = [];
    for (const si of serviceItemsInCart) {
      const bd = data.serviceBookings[`${si.id}_${si.itemType}`];
      if (bd) {
        svcNames.push(si.name);
        svcDates.push(bd.date);
        svcTimes.push(bd.time);
      }
    }
    setConfirmedDetails({
      serviceNames: svcNames,
      dates: svcDates,
      times: svcTimes,
      businessName: business?.name || "",
    });
    setBookingResults(results);
    setSuccess(true);
    updateCart([]);
    if (business?.id) trackStoreEvent(business.id, 'checkout_complete');
  };

  if (loading) {
    return (
      <main className="min-h-screen text-white flex items-center justify-center" style={{ backgroundColor: ts.pageBg, backgroundImage: ts.pageGradient }}>
        <div className="flex flex-col items-center gap-4 animate-pulse">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${primaryColor}20, ${primaryColor}08)` }}
          >
            <Loader2 className="w-7 h-7 animate-spin" style={{ color: primaryColor }} />
          </div>
          <div className="space-y-2 text-center">
            <div className="h-3 w-32 bg-white/[0.06] rounded-full mx-auto" />
            <div className="h-2 w-24 bg-white/[0.04] rounded-full mx-auto" />
          </div>
        </div>
      </main>
    );
  }

  if (error && !business) {
    return (
      <main className="min-h-screen text-white flex items-center justify-center px-4" style={{ backgroundColor: ts.pageBg, backgroundImage: ts.pageGradient }}>
        <div className="max-w-md w-full rounded-3xl border border-red-500/30 bg-red-500/5 backdrop-blur-xl p-10 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto">
            <Globe className="w-8 h-8 text-red-400" />
          </div>
          <h1 className="text-xl font-semibold text-red-400">Page Not Found</h1>
          <p className="text-sm text-white/50">
            The booking page for &ldquo;{slug}&rdquo; could not be found.
          </p>
        </div>
      </main>
    );
  }

  if (success) {
    const isOrder = bookingResults.length > 0 && bookingResults[0].bookingId.startsWith("order-");
    const firstDate = confirmedDetails?.dates[0];
    const firstTime = confirmedDetails?.times[0];
    const calendarUrl = firstDate && firstTime && confirmedDetails
      ? (() => {
          const start = new Date(`${firstDate}T${firstTime}`);
          const end = new Date(start.getTime() + 60 * 60 * 1000);
          const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
          const title = encodeURIComponent(`${confirmedDetails.serviceNames[0] || "Appointment"} - ${confirmedDetails.businessName}`);
          const location = encodeURIComponent(business?.address || "");
          return `https://calendar.google.com/calendar/event?action=TEMPLATE&text=${title}&dates=${fmt(start)}/${fmt(end)}&location=${location}`;
        })()
      : null;

    const formatDate = (d: string) => {
      try { return new Date(d + "T00:00:00").toLocaleDateString("en-TT", { weekday: "short", month: "short", day: "numeric" }); }
      catch { return d; }
    };
    const formatTime = (t: string) => {
      try {
        const [h, m] = t.split(":").map(Number);
        const ampm = h >= 12 ? "PM" : "AM";
        return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
      } catch { return t; }
    };

    return (
      <main className="min-h-screen text-white flex items-center justify-center px-4 relative overflow-hidden" style={{ backgroundColor: ts.pageBg, backgroundImage: ts.pageGradient }}>
        <div className="absolute inset-0 pointer-events-none">
          {Array.from({ length: 40 }).map((_, i) => {
            const colors = [primaryColor, secondaryColor, accentColor, "#f59e0b", "#10b981", "#ec4899"];
            const color = colors[i % colors.length];
            const left = Math.random() * 100;
            const delay = Math.random() * 2;
            const duration = 2.5 + Math.random() * 2;
            const size = 4 + Math.random() * 8;
            const shape = i % 3 === 0 ? "rounded-full" : i % 3 === 1 ? "rounded-sm" : "";
            return (
              <div
                key={i}
                className={`absolute ${shape}`}
                style={{
                  left: `${left}%`,
                  top: "-10px",
                  width: `${size}px`,
                  height: `${size}px`,
                  backgroundColor: color,
                  opacity: 0.8,
                  animation: `confettiFall ${duration}s ease-in ${delay}s both`,
                }}
              />
            );
          })}
        </div>

        <div
          className="absolute inset-0 pointer-events-none opacity-15"
          style={{
            background: `radial-gradient(circle at 50% 40%, ${primaryColor}30 0%, transparent 50%)`,
          }}
        />

        <div
          className="relative max-w-md w-full rounded-3xl border border-emerald-500/20 backdrop-blur-xl p-10 text-center space-y-6"
          style={{
            background: "linear-gradient(135deg, rgba(16,185,129,0.06) 0%, rgba(16,185,129,0.02) 100%)",
            animation: "successPop 600ms cubic-bezier(0.16,1,0.3,1)",
          }}
        >
          <div
            className="w-20 h-20 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto relative"
            style={{ animation: "checkBounce 800ms cubic-bezier(0.16,1,0.3,1) 200ms both" }}
          >
            <div
              className="absolute inset-0 rounded-2xl opacity-30 blur-xl"
              style={{ backgroundColor: "#10b981" }}
            />
            <CheckCircle2 className="w-10 h-10 text-emerald-400 relative" />
          </div>

          <div style={{ animation: "fadeUp 500ms ease-out 300ms both" }}>
            <h1 className="text-2xl font-bold text-emerald-400 mb-2">
              {isOrder ? "Order Placed!" : "Booking Confirmed!"}
            </h1>
            <p className="text-sm text-white/50 leading-relaxed">
              Your {isOrder ? "order" : "appointment"} with{" "}
              <span className="font-semibold text-white/80">{business?.name}</span> has been confirmed.
            </p>
          </div>

          {confirmedDetails && confirmedDetails.serviceNames.length > 0 && !isOrder && (
            <div className="space-y-2" style={{ animation: "fadeUp 500ms ease-out 400ms both" }}>
              {confirmedDetails.serviceNames.map((name, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-left space-y-1.5"
                >
                  <p className="text-sm font-medium text-white/80">{name}</p>
                  <div className="flex items-center gap-4 text-[12px] text-white/45">
                    {confirmedDetails.dates[idx] && (
                      <span className="flex items-center gap-1">
                        <CalendarPlus className="w-3 h-3" />
                        {formatDate(confirmedDetails.dates[idx])}
                      </span>
                    )}
                    {confirmedDetails.times[idx] && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatTime(confirmedDetails.times[idx])}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-3" style={{ animation: "fadeUp 500ms ease-out 450ms both" }}>
            {bookingResults.map((br, idx) =>
              !br.bookingId.startsWith("order-") ? (
                <div
                  key={idx}
                  className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 inline-flex items-center gap-2 mx-auto"
                >
                  <span className="text-[11px] text-white/40">Reference:</span>
                  <code
                    className="font-mono text-sm font-bold tracking-wider"
                    style={{ color: primaryColor }}
                  >
                    {br.bookingId.slice(-8).toUpperCase()}
                  </code>
                </div>
              ) : null
            )}
          </div>

          <div className="flex flex-col gap-3 pt-2" style={{ animation: "fadeUp 500ms ease-out 600ms both" }}>
            {calendarUrl && (
              <a
                href={calendarUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3.5 rounded-2xl font-semibold text-sm text-white transition-all duration-300 hover:scale-[1.015] active:scale-[0.98] inline-flex items-center justify-center gap-2"
                style={{ backgroundColor: primaryColor, boxShadow: `0 8px 32px ${primaryColor}30` }}
              >
                <CalendarPlus className="w-4 h-4" />
                Add to Calendar
              </a>
            )}
            {bookingResults.some((br) => br.invoiceId) && (
              <button
                onClick={() => {
                  const inv = bookingResults.find((br) => br.invoiceId);
                  if (inv?.invoiceId) window.open(`${API_BASE}/commerce/invoices/${inv.invoiceId}/receipt`, "_blank");
                }}
                aria-label="View invoice"
                className="w-full py-3.5 rounded-2xl font-semibold text-sm transition-all duration-300 hover:scale-[1.015] active:scale-[0.98]"
                style={{
                  backgroundColor: calendarUrl ? "transparent" : primaryColor,
                  color: calendarUrl ? "white" : "white",
                  border: calendarUrl ? "1px solid rgba(255,255,255,0.1)" : "none",
                  boxShadow: calendarUrl ? "none" : `0 8px 32px ${primaryColor}30`,
                }}
              >
                View Invoice
              </button>
            )}
            <button
              onClick={() => {
                setSuccess(false);
                setCheckoutMode(false);
                setBookingResults([]);
                setConfirmedDetails(null);
              }}
              className="w-full py-3 rounded-2xl border border-white/[0.06] text-sm font-medium text-white/50 hover:text-white/80 hover:bg-white/[0.03] transition-all duration-200"
            >
              Continue Shopping
            </button>
          </div>

          {business?.address && (
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-white/25" style={{ animation: "fadeUp 500ms ease-out 700ms both" }}>
              <MapPin className="w-3 h-3" />
              <span>{business.address}</span>
            </div>
          )}

          <div className="flex items-center justify-center gap-1.5 text-[10px] text-white/20">
            <Star className="w-3 h-3" />
            <span>Thank you for your business</span>
          </div>
        </div>

        <style jsx>{`
          @keyframes confettiFall {
            0% { transform: translateY(0) rotate(0deg) scale(1); opacity: 0.9; }
            100% { transform: translateY(100vh) rotate(720deg) scale(0.3); opacity: 0; }
          }
          @keyframes successPop {
            0% { transform: scale(0.8); opacity: 0; }
            100% { transform: scale(1); opacity: 1; }
          }
          @keyframes checkBounce {
            0% { transform: scale(0) rotate(-45deg); }
            60% { transform: scale(1.2) rotate(5deg); }
            100% { transform: scale(1) rotate(0deg); }
          }
          @keyframes fadeUp {
            0% { transform: translateY(12px); opacity: 0; }
            100% { transform: translateY(0); opacity: 1; }
          }
        `}</style>
      </main>
    );
  }

  if (checkoutMode) {
    return (
      <main className="min-h-screen text-white" style={{ backgroundColor: ts.pageBg, backgroundImage: ts.pageGradient }}>
        <CheckoutFlow
          business={business!}
          cart={cart}
          staff={staff}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
          accentColor={accentColor}
          cartTotal={cartTotal}
          cartCurrency={cartCurrency}
          onBack={() => setCheckoutMode(false)}
          onUpdateQuantity={updateQuantity}
          onSubmit={handleCheckoutSubmit}
        />
      </main>
    );
  }

  return (
    <main className="min-h-screen text-white relative" style={{ backgroundColor: ts.pageBg, backgroundImage: ts.pageGradient }}>
      <BusinessHero
        business={business!}
        primaryColor={primaryColor}
        secondaryColor={secondaryColor}
        accentColor={accentColor}
        config={storefrontConfig}
        catalogCount={catalogItems.length}
      />

      <div className="max-w-4xl mx-auto px-4 pb-32 space-y-8">
        {storefrontConfig?.promotions?.bannerEnabled && storefrontConfig.promotions.bannerText && (
          <div
            className="rounded-2xl px-5 py-3.5 text-center text-sm font-medium flex items-center justify-center gap-2 backdrop-blur-sm"
            style={{
              backgroundColor: `${storefrontConfig.promotions.bannerColor || '#f59e0b'}12`,
              color: storefrontConfig.promotions.bannerColor || '#f59e0b',
              border: `1px solid ${storefrontConfig.promotions.bannerColor || '#f59e0b'}25`,
            }}
          >
            <Flame className="w-4 h-4 animate-pulse" />
            {storefrontConfig.promotions.bannerText}
          </div>
        )}

        <CatalogGrid
          catalogItems={catalogItems}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
          accentColor={accentColor}
          isInCart={isInCart}
          addToCart={addToCart}
          removeFromCart={removeFromCart}
          badges={storefrontConfig?.merchandising?.badges}
          featuredItemIds={storefrontConfig?.merchandising?.featuredItemIds}
          onItemClick={handleItemClick}
          config={storefrontConfig}
        />

        {storefrontConfig?.socialProof?.testimonials && storefrontConfig.socialProof.testimonials.length > 0 && (
          <div className="space-y-5 pt-4">
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: `${primaryColor}15` }}
              >
                <MessageCircle className="w-4 h-4" style={{ color: primaryColor }} />
              </div>
              <h3 className="text-lg font-semibold text-white/80">What Our Clients Say</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {storefrontConfig.socialProof.testimonials.map((t, idx) => (
                <div
                  key={t.id}
                  className="group rounded-2xl p-5 space-y-3 transition-all duration-300"
                  style={{ animationDelay: `${idx * 100}ms`, border: `1px solid ${primaryColor}12`, background: `${primaryColor}04` }}
                >
                  <div className="flex gap-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className="w-4 h-4 transition-transform group-hover:scale-110"
                        fill={i < t.rating ? secondaryColor : 'transparent'}
                        color={i < t.rating ? secondaryColor : '#ffffff20'}
                      />
                    ))}
                  </div>
                  <p className="text-sm text-white/55 italic leading-relaxed">&ldquo;{t.text}&rdquo;</p>
                  <p className="text-xs text-white/35 font-medium">&mdash; {t.name}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {storefrontConfig?.socialProof?.guaranteeText && (
          <div className="rounded-2xl p-4 flex items-center gap-3 text-sm backdrop-blur-sm" style={{ border: `1px solid ${accentColor}18`, background: `${accentColor}06` }}>
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${accentColor}15` }}>
              <Shield className="w-4 h-4" style={{ color: accentColor }} />
            </div>
            <span className="text-white/55">{storefrontConfig.socialProof.guaranteeText}</span>
          </div>
        )}
      </div>

      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
        <div
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[11px] text-white/25 backdrop-blur-xl border border-white/[0.06] shadow-lg pointer-events-auto hover:text-white/40 transition-colors"
          style={{ backgroundColor: `${ts.pageBg}cc` }}
        >
          <Sparkles className="w-3 h-3" style={{ color: `${primaryColor}60` }} />
          Powered by <span style={{ color: primaryColor }} className="font-semibold">KeyFlowOS</span>
        </div>
      </div>

      {selectedItem && (
        <ItemDetailModal
          item={selectedItem}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
          accentColor={accentColor}
          isInCart={isInCart(selectedItem.id, selectedItem.itemType)}
          addToCart={addToCart}
          removeFromCart={removeFromCart}
          relatedItems={catalogItems.filter(i => i.itemType === selectedItem.itemType && i.id !== selectedItem.id).slice(0, 4)}
          businessPhone={business?.phone}
          onClose={() => setSelectedItem(null)}
          onSelectItem={(item) => setSelectedItem(item)}
          badges={storefrontConfig?.merchandising?.badges}
        />
      )}

      <CartDrawer
        cart={cart}
        cartOpen={cartOpen}
        cartCount={cartCount}
        cartTotal={cartTotal}
        cartCurrency={cartCurrency}
        primaryColor={primaryColor}
        secondaryColor={secondaryColor}
        accentColor={accentColor}
        onClose={() => setCartOpen(false)}
        onOpen={() => setCartOpen(true)}
        onUpdateQuantity={updateQuantity}
        onRemoveFromCart={removeFromCart}
        onCheckout={() => {
          setCartOpen(false);
          setCheckoutMode(true);
          setError(null);
          if (business?.id) trackStoreEvent(business.id, 'checkout_start');
        }}
      />
    </main>
  );
}
