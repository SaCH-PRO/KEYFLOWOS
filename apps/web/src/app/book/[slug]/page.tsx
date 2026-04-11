"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { apiGet, apiPost, API_BASE } from "@/lib/api";
import { formatPrice } from "@/lib/format";
import { Loader2, CheckCircle2, Globe, Star, MessageCircle, Shield, Award, Flame, Sparkles, CalendarPlus, Clock, MapPin, X } from "lucide-react";
import { ItemDetailModal } from "./components/item-detail-modal";
import { trackStoreEvent, StorefrontConfig, type StorefrontSectionKey } from "@/lib/client";
import { getThemeStyles, type ThemeKey } from "@/lib/storefront-themes";
import { FONT_PAIRINGS } from "../../app/store/components/store-types";

import type {
  Business,
  Service,
  Staff,
  CommerceProduct,
  CatalogItem,
  CartItem,
  ServiceBookingData,
  PromoCode,
  PaymentMethod,
  DeliveryAddress,
  ShippingZone,
  StoreOrderResponse,
} from "./components/types";
import { loadCart, saveCart, loadPromoCode, savePromoCode } from "./components/utils";
import { BusinessHero } from "./components/business-hero";
import { CatalogGrid } from "./components/catalog-grid";
import { CartDrawer } from "./components/cart-drawer";
import { CheckoutFlow } from "./components/checkout-flow";
import { TrustBar, SecurityFooter } from "./components/trust-bar";
import { OrderConfirmation } from "./components/order-confirmation";
import { FaqSection } from "./components/faq-section";
import { PoliciesFooterLinks } from "./components/policies-section";
import { ContactSection } from "./components/contact-section";
import { TestimonialsSection } from "./components/testimonials-section";
import { FeaturedSection } from "./components/featured-section";
import { CategoryNav } from "./components/category-nav";
import { OrganizationSchema, BreadcrumbListSchema } from "./components/structured-data";
import { useWishlist } from "./components/use-wishlist";
import { WishlistDrawer } from "./components/wishlist-drawer";
import { ShareStoreButton } from "./components/share-buttons";
import { Heart } from "lucide-react";

const DEFAULT_SECTIONS: StorefrontSectionKey[] = [
  "hero", "trust", "featured", "categories", "catalog", "testimonials", "faq", "contact", "policies",
];

export default function PublicBookingPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const [promoCode, setPromoCode] = useState<PromoCode | null>(null);

  const [success, setSuccess] = useState(false);
  const [paymentFailed, setPaymentFailed] = useState(false);
  const [paymentPending, setPaymentPending] = useState(false);
  const [bookingResults, setBookingResults] = useState<{ bookingId: string; invoiceId?: string }[]>([]);
  const [confirmedDetails, setConfirmedDetails] = useState<{
    serviceNames: string[];
    dates: string[];
    times: string[];
    businessName: string;
  } | null>(null);
  const [confirmedOrderItems, setConfirmedOrderItems] = useState<CartItem[]>([]);
  const [confirmedOrderTotal, setConfirmedOrderTotal] = useState(0);
  const [confirmedPaymentMethod, setConfirmedPaymentMethod] = useState<PaymentMethod | undefined>();
  const [confirmedOrderNumber, setConfirmedOrderNumber] = useState<string | null>(null);
  const [confirmedOrderId, setConfirmedOrderId] = useState<string | null>(null);
  const [confirmedEstimatedDelivery, setConfirmedEstimatedDelivery] = useState<string | null>(null);
  const [confirmedCustomerEmail, setConfirmedCustomerEmail] = useState<string | null>(null);
  const [completedBookingResults, setCompletedBookingResults] = useState<{ bookingId: string; invoiceId?: string }[]>([]);
  const [failedOrderPayload, setFailedOrderPayload] = useState<{
    items: { productId: string; quantity: number }[];
    customer: { name: string; email?: string; phone?: string };
    promoCode?: string;
    shipping?: { zoneId?: string; address?: DeliveryAddress };
    paymentMethod: string;
    returnUrl?: string;
  } | null>(null);

  const [shippingZones, setShippingZones] = useState<ShippingZone[]>([]);
  const [selectedItem, setSelectedItem] = useState<CatalogItem | null>(null);
  const [storefrontConfig, setStorefrontConfig] = useState<StorefrontConfig | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(
    searchParams.get("category")
  );
  const [wishlistOpen, setWishlistOpen] = useState(false);
  const [reviewAggregates, setReviewAggregates] = useState<Record<string, { averageRating: number; reviewCount: number }>>({});
  const [completedOrdersCount, setCompletedOrdersCount] = useState<number>(0);

  const wishlist = useWishlist(slug);

  const appearance = storefrontConfig?.appearance;
  const primaryColor = appearance?.primaryColor || business?.primaryColor || "#F97316";
  const secondaryColor = appearance?.secondaryColor || business?.secondaryColor || "#14B8A6";
  const accentColor = appearance?.accentColor || "#a78bfa";
  const themeKey = (appearance?.theme ?? "default") as ThemeKey;
  const ts = getThemeStyles(themeKey, primaryColor, secondaryColor, accentColor);
  const densityPadding = appearance?.density === "compact" ? "px-4 py-4" : "px-4 sm:px-8 py-8";
  const fontPairingId = appearance?.fontPairing ?? "inter-inter";
  const fontPairing = FONT_PAIRINGS.find((p) => p.id === fontPairingId);
  const headingFontStyle = fontPairing ? `'${fontPairing.heading}', sans-serif` : undefined;
  const bodyFontStyle = fontPairing ? `'${fontPairing.body}', sans-serif` : undefined;
  const fontFamilyClass = "";

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
          if (item.itemType === "service") return prev;
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
      if (itemType === "service") return;
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

  const handleCategoryChange = useCallback((category: string | null) => {
    setActiveCategory(category);
    const url = category ? `/book/${slug}?category=${category}` : `/book/${slug}`;
    window.history.replaceState(null, "", url);
  }, [slug]);

  const cartTotal = cart.reduce((sum, c) => sum + c.price * c.quantity, 0);
  const cartCount = cart.reduce((sum, c) => sum + c.quantity, 0);
  const cartCurrency = cart[0]?.currency || business?.currency || "TTD";
  const serviceItemsInCart = cart.filter((c) => c.requiresBooking);

  const handleApplyPromo = useCallback(
    async (code: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const productItems = cart.filter((c) => !c.requiresBooking);
        const items = productItems.map((c) => ({ productId: c.id, quantity: c.quantity }));

        const res = await apiPost<{
          valid: boolean;
          promo?: { code: string; type: string; value: number; discount: number; freeShipping: boolean };
          subtotal?: number;
          discountAmount?: number;
          total?: number;
          message?: string;
        }>({
          path: `/site/storefront/public/${encodeURIComponent(slug)}/validate-promo`,
          body: { code, items },
        });

        if (res.error || !res.data?.valid) {
          return { success: false, error: res.data?.message || res.error || "Invalid promo code" };
        }

        const promo = res.data.promo;
        const newPromo: PromoCode = {
          code,
          discountType: promo?.type === "FIXED" ? "fixed" : "percentage",
          discountValue: promo?.value || 0,
          description: promo?.freeShipping ? "Free shipping included" : undefined,
        };
        setPromoCode(newPromo);
        savePromoCode(slug, newPromo);
        return { success: true };
      } catch {
        return { success: false, error: "Could not validate promo code. Please try again." };
      }
    },
    [slug, cart]
  );

  const handleRemovePromo = useCallback(() => {
    setPromoCode(null);
    savePromoCode(slug, null);
  }, [slug]);

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
      if (sfRes.data?.shippingZones) setShippingZones(sfRes.data.shippingZones);
      if (typeof sfRes.data?.completedOrdersCount === 'number') setCompletedOrdersCount(sfRes.data.completedOrdersCount);

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

      apiGet<Record<string, { averageRating: number; reviewCount: number }>>(
        `/site/storefront/public/${encodeURIComponent(slug)}/review-aggregates`
      ).then((aggRes) => {
        if (aggRes.data) setReviewAggregates(aggRes.data);
      }).catch(() => {});
    };
    loadBusiness();
  }, [slug]);

  useEffect(() => {
    if (slug) {
      setCart(loadCart(slug));
      setPromoCode(loadPromoCode(slug));
    }
  }, [slug]);

  useEffect(() => {
    if (!fontPairing || fontPairing.id === "inter-inter") return;
    const families = [fontPairing.heading, fontPairing.body]
      .filter((f, i, arr) => arr.indexOf(f) === i)
      .map((f) => `family=${f.replace(/ /g, "+")}:wght@400;700`)
      .join("&");
    const href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }, [fontPairing]);

  useEffect(() => {
    if (!slug || !business) return;
    const restorePendingCheckout = async () => {
      const pendingKey = `kf_pending_checkout_${slug}`;
      const raw = localStorage.getItem(pendingKey);
      if (!raw) return;
      const pending = JSON.parse(raw);
      localStorage.removeItem(pendingKey);

      type PaymentOutcome = "success" | "failed" | "pending";
      let outcome: PaymentOutcome = "pending";

      if (pending.orderId && pending.customerEmail) {
        try {
          const { data: orderStatus } = await apiGet<{
            paymentStatus: string;
            status: string;
          }>(`/site/storefront/public/order/${pending.orderId}?email=${encodeURIComponent(pending.customerEmail)}`);
          if (orderStatus) {
            const ps = orderStatus.paymentStatus?.toUpperCase();
            if (ps === "PAID" || ps === "COMPLETED" || ps === "CAPTURED") {
              outcome = "success";
            } else if (ps === "FAILED" || ps === "CANCELLED" || ps === "CANCELED" || ps === "VOIDED") {
              outcome = "failed";
            }
          }
        } catch {
          outcome = "pending";
        }
      } else {
        outcome = "success";
      }

      setConfirmedOrderItems(pending.items ?? []);
      setConfirmedOrderTotal(pending.orderTotal ?? 0);
      setConfirmedPaymentMethod(pending.paymentMethod ?? undefined);
      setConfirmedOrderNumber(pending.orderNumber ?? null);
      setConfirmedOrderId(pending.orderId ?? null);
      setConfirmedCustomerEmail(pending.customerEmail ?? null);
      setCompletedBookingResults(pending.bookingResults ?? []);
      setConfirmedDetails(pending.confirmedDetails ?? null);

      const allResults = [...(pending.bookingResults ?? [])];
      if (pending.orderNumber) {
        allResults.push({ bookingId: pending.orderNumber });
      }
      setBookingResults(allResults);

      if (pending.shippingZoneId) {
        const zone = shippingZones.find((z: ShippingZone) => z.id === pending.shippingZoneId);
        setConfirmedEstimatedDelivery(
          zone?.estimatedDays
            ? `${zone.estimatedDays} business days${zone.carrier ? ` via ${zone.carrier}` : ""}`
            : null
        );
      }

      if (outcome === "success") {
        setPaymentFailed(false);
        setPaymentPending(false);
        updateCart([]);
        handleRemovePromo();
      } else if (outcome === "failed") {
        setFailedOrderPayload(pending.orderPayload ?? null);
        setPaymentFailed(true);
        setPaymentPending(false);
      } else {
        setFailedOrderPayload(pending.orderPayload ?? null);
        setPaymentFailed(false);
        setPaymentPending(true);
      }
      setSuccess(true);
    };
    restorePendingCheckout().catch(() => {});
  }, [slug, business]);

  useEffect(() => {
    if (!business) return;
    const seo = storefrontConfig?.seo;
    document.title = seo?.metaTitle || `Book with ${business.name} | KeyFlowOS`;
  }, [business, storefrontConfig]);

  useEffect(() => {
    if (!business) return;
    const seo = storefrontConfig?.seo;
    const pageTitle = seo?.metaTitle || `${business.name} | Book Online`;
    const description = seo?.metaDescription || business.tagline || `Book an appointment with ${business.name} online.`;
    const ogImage = seo?.ogImage || seo?.socialImage || business.logoUrl;
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
    const pOrder = storefrontConfig?.catalog?.productOrder;
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

  const filteredCatalogItems = useMemo(() => {
    if (!activeCategory) return catalogItems;
    return catalogItems.filter((i) => i.itemType === activeCategory);
  }, [catalogItems, activeCategory]);

  const featuredItems = useMemo(() => {
    const ids = storefrontConfig?.merchandising?.featuredItemIds;
    if (!ids || ids.length === 0) return [];
    const idSet = new Set(ids);
    return catalogItems.filter((i) => idSet.has(i.id));
  }, [catalogItems, storefrontConfig]);

  const sectionOrder = useMemo<StorefrontSectionKey[]>(() => {
    const configured = storefrontConfig?.sections;
    if (configured && configured.length > 0) {
      return configured.filter((s) => s.visible).map((s) => s.key);
    }
    return DEFAULT_SECTIONS;
  }, [storefrontConfig]);

  const isSectionVisible = useCallback((key: StorefrontSectionKey) => {
    return sectionOrder.includes(key);
  }, [sectionOrder]);

  const pageUrl = typeof window !== "undefined" ? window.location.href : "";
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  const submitStoreOrder = async (payload: {
    items: { productId: string; quantity: number }[];
    customer: { name: string; email?: string; phone?: string };
    promoCode?: string;
    shipping?: { zoneId?: string; address?: DeliveryAddress };
    paymentMethod: string;
    returnUrl?: string;
  }): Promise<StoreOrderResponse | null> => {
    const { data: orderRes, error: orderErr } = await apiPost<StoreOrderResponse>({
      path: `/site/storefront/public/${encodeURIComponent(slug)}/checkout`,
      body: payload,
    });
    if (orderErr) throw new Error(orderErr);
    return orderRes ?? null;
  };

  const handleStoreOrderResult = (
    storeOrder: StoreOrderResponse | null,
    bookingRefs: { bookingId: string; invoiceId?: string }[],
    paymentMethodUI: PaymentMethod,
    shippingZoneId: string | null,
    orderPayload: typeof failedOrderPayload,
    serviceDetails: { serviceNames: string[]; dates: string[]; times: string[]; businessName: string } | null,
  ) => {
    const allResults = [...bookingRefs];
    if (storeOrder?.order) {
      allResults.push({ bookingId: storeOrder.order.orderNumber });
    }

    if (storeOrder?.payment?.redirectUrl) {
      setCompletedBookingResults(bookingRefs);
      setFailedOrderPayload(orderPayload);
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(`kf_pending_checkout_${slug}`, JSON.stringify({
            bookingResults: bookingRefs,
            orderPayload,
            orderNumber: storeOrder?.order?.orderNumber ?? null,
            orderId: storeOrder?.order?.id ?? null,
            orderTotal: storeOrder?.order?.total ?? cartTotal,
            paymentMethod: paymentMethodUI,
            shippingZoneId,
            items: [...cart],
            customerEmail: orderPayload?.customer?.email ?? null,
            confirmedDetails: serviceDetails,
          }));
        } catch {}
      }
      window.location.href = storeOrder.payment.redirectUrl;
      return true;
    }

    if (storeOrder?.payment?.status === "PAYPAL_AWAITING_APPROVAL" || storeOrder?.payment?.status === "PAYPAL_CREATED") {
      setConfirmedOrderItems([...cart]);
      setConfirmedOrderTotal(storeOrder.order?.total ?? cartTotal);
      setConfirmedPaymentMethod(paymentMethodUI);
      setConfirmedOrderNumber(storeOrder.order?.orderNumber ?? null);
      setConfirmedOrderId(storeOrder.order?.id ?? null);
      setConfirmedCustomerEmail(orderPayload?.customer?.email ?? null);
      setCompletedBookingResults(bookingRefs);
      setFailedOrderPayload(orderPayload);
      setBookingResults(allResults);
      setPaymentFailed(true);
      setSuccess(true);
      return true;
    }

    if (storeOrder?.payment?.status === "FAILED") {
      setConfirmedOrderItems([...cart]);
      setConfirmedOrderTotal(storeOrder.order.total);
      setConfirmedPaymentMethod(paymentMethodUI);
      setConfirmedOrderNumber(storeOrder.order.orderNumber);
      setConfirmedOrderId(storeOrder.order.id);
      setConfirmedCustomerEmail(orderPayload?.customer?.email ?? null);
      setCompletedBookingResults(bookingRefs);
      setFailedOrderPayload(orderPayload);
      setBookingResults(allResults);
      setPaymentFailed(true);
      setSuccess(true);
      return true;
    }

    const selectedZone = shippingZones.find((z) => z.id === shippingZoneId);
    setConfirmedOrderItems([...cart]);
    setConfirmedOrderTotal(storeOrder?.order?.total ?? cartTotal);
    setConfirmedPaymentMethod(paymentMethodUI);
    setConfirmedOrderNumber(storeOrder?.order?.orderNumber ?? null);
    setConfirmedOrderId(storeOrder?.order?.id ?? null);
    setConfirmedCustomerEmail(orderPayload?.customer?.email ?? null);
    setConfirmedEstimatedDelivery(
      selectedZone?.estimatedDays
        ? `${selectedZone.estimatedDays} business days${selectedZone.carrier ? ` via ${selectedZone.carrier}` : ""}`
        : null
    );
    setBookingResults(allResults);
    setSuccess(true);
    setPaymentFailed(false);
    setPaymentPending(false);
    setCompletedBookingResults([]);
    setFailedOrderPayload(null);
    updateCart([]);
    handleRemovePromo();
    if (business?.id) trackStoreEvent(business.id, 'checkout_complete');
    return false;
  };

  const handleCheckoutSubmit = async (data: {
    serviceBookings: Record<string, ServiceBookingData>;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    paymentMethod: PaymentMethod;
    deliveryAddress: DeliveryAddress | null;
    shippingZoneId: string | null;
    termsAccepted: boolean;
  }) => {
    if (!business) return;

    const bookingRefs = completedBookingResults.length > 0
      ? [...completedBookingResults]
      : [];

    if (bookingRefs.length === 0) {
      for (const si of serviceItemsInCart) {
        const bd = data.serviceBookings[`${si.id}_${si.itemType}`];
        if (!bd) continue;

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
            },
          });

          if (err) throw new Error(err);
          if (resData) bookingRefs.push({ bookingId: resData.bookingId, invoiceId: resData.invoiceId });
        }
      }
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
    const computedServiceDetails = svcNames.length > 0 ? {
      serviceNames: svcNames,
      dates: svcDates,
      times: svcTimes,
      businessName: business?.name || "",
    } : null;
    setConfirmedDetails(computedServiceDetails);

    const nonBookingItems = cart.filter((c) => !c.requiresBooking);
    let storeOrder: StoreOrderResponse | null = null;

    if (nonBookingItems.length > 0) {
      const paymentMethodMap: Record<PaymentMethod, string> = {
        wipay: "WIPAY",
        paypal: "PAYPAL",
        cash: "CASH",
      };

      const orderPayload = {
        items: nonBookingItems.map((c) => ({ productId: c.id, quantity: c.quantity })),
        customer: {
          name: `${data.firstName} ${data.lastName}`.trim(),
          email: data.email || undefined,
          phone: data.phone || undefined,
        },
        promoCode: promoCode?.code || undefined,
        shipping: data.deliveryAddress
          ? {
              zoneId: data.shippingZoneId || undefined,
              address: data.deliveryAddress,
            }
          : undefined,
        paymentMethod: paymentMethodMap[data.paymentMethod],
        returnUrl: typeof window !== "undefined" ? window.location.href : undefined,
      };

      storeOrder = await submitStoreOrder(orderPayload);
      const handled = handleStoreOrderResult(storeOrder, bookingRefs, data.paymentMethod, data.shippingZoneId, orderPayload, computedServiceDetails);
      if (handled) return;
    } else {
      setConfirmedOrderItems([...cart]);
      setConfirmedOrderTotal(cartTotal);
      setConfirmedPaymentMethod(data.paymentMethod);
      setConfirmedOrderNumber(null);
      setConfirmedOrderId(null);
      setConfirmedEstimatedDelivery(null);
      setConfirmedCustomerEmail(data.email || null);
      setBookingResults(bookingRefs);
      setSuccess(true);
      setPaymentFailed(false);
      setPaymentPending(false);
      updateCart([]);
      handleRemovePromo();
      if (business?.id) trackStoreEvent(business.id, 'checkout_complete');
    }
  };

  const handleRetryPayment = useCallback(async () => {
    if (!failedOrderPayload) {
      setSuccess(false);
      setPaymentFailed(false);
      setPaymentPending(false);
      return;
    }

    try {
      const storeOrder = await submitStoreOrder(failedOrderPayload);
      handleStoreOrderResult(
        storeOrder,
        completedBookingResults,
        confirmedPaymentMethod || "cash",
        failedOrderPayload.shipping?.zoneId || null,
        failedOrderPayload,
        confirmedDetails,
      );
    } catch {
      setPaymentFailed(true);
    }
  }, [failedOrderPayload, completedBookingResults, confirmedPaymentMethod, confirmedDetails]);

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
    const hasStoreOrder = confirmedOrderNumber !== null;
    const isOrder = hasStoreOrder || (bookingResults.length > 0 && bookingResults.every((br) => br.bookingId.startsWith("ORD-")));
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
        {!paymentFailed && (
          <div className="absolute inset-0 pointer-events-none">
            {Array.from({ length: 40 }).map((_, i) => {
              const colors = [primaryColor, secondaryColor, accentColor, "#f59e0b", "#10b981", "#ec4899"];
              const color = colors[i % colors.length];
              const left = ((i * 37 + 13) % 100);
              const delay = ((i * 7) % 20) / 10;
              const duration = 2.5 + ((i * 11) % 20) / 10;
              const size = 4 + ((i * 13) % 8);
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
        )}

        <div
          className="absolute inset-0 pointer-events-none opacity-15"
          style={{
            background: `radial-gradient(circle at 50% 40%, ${primaryColor}30 0%, transparent 50%)`,
          }}
        />

        <OrderConfirmation
          isOrder={isOrder}
          businessName={business?.name || ""}
          businessAddress={business?.address}
          businessWhatsapp={business?.whatsapp}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
          accentColor={accentColor}
          confirmedDetails={confirmedDetails}
          bookingResults={bookingResults}
          calendarUrl={calendarUrl}
          apiBase={API_BASE}
          orderItems={confirmedOrderItems}
          orderTotal={confirmedOrderTotal}
          orderCurrency={cartCurrency}
          paymentMethod={confirmedPaymentMethod}
          orderNumber={confirmedOrderNumber}
          orderId={confirmedOrderId}
          estimatedDelivery={confirmedEstimatedDelivery}
          paymentFailed={paymentFailed}
          paymentPending={paymentPending}
          customerEmail={confirmedCustomerEmail}
          onContinueShopping={() => {
            setSuccess(false);
            setCheckoutMode(false);
            setBookingResults([]);
            setConfirmedDetails(null);
            setConfirmedOrderItems([]);
            setPaymentFailed(false);
            setPaymentPending(false);
            setConfirmedOrderNumber(null);
            setConfirmedOrderId(null);
            setConfirmedEstimatedDelivery(null);
            setConfirmedCustomerEmail(null);
          }}
          onRetryPayment={handleRetryPayment}
          formatDate={formatDate}
          formatTime={formatTime}
        />

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
          promoCode={promoCode}
          shippingZones={shippingZones}
          taxRate={(storefrontConfig?.storeSettings as Record<string, unknown>)?.taxRate as number | undefined}
          onBack={() => setCheckoutMode(false)}
          onUpdateQuantity={updateQuantity}
          onSubmit={handleCheckoutSubmit}
        />
      </main>
    );
  }

  const renderSection = (key: StorefrontSectionKey) => {
    switch (key) {
      case "hero":
        return null;
      case "trust":
        return (
          <div key="trust" className="flex items-center justify-between">
            <TrustBar
              primaryColor={primaryColor}
              secondaryColor={secondaryColor}
              businessName={business?.name}
              completedOrdersCount={completedOrdersCount}
              businessHoursToday={(() => {
                if (!business?.businessHours) return null;
                const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
                const today = days[new Date().getDay()];
                const h = business.businessHours[today];
                if (!h || h.closed) return "Closed";
                return `${h.open} – ${h.close}`;
              })()}
            />
            <div className="flex items-center gap-2 flex-shrink-0">
              <ShareStoreButton
                url={pageUrl}
                storeName={business?.name || ""}
                primaryColor={primaryColor}
              />
              <button
                onClick={() => setWishlistOpen(true)}
                className="relative w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:scale-105"
                style={{
                  backgroundColor: wishlist.count > 0 ? `${primaryColor}15` : "rgba(255,255,255,0.05)",
                  border: wishlist.count > 0 ? `1px solid ${primaryColor}25` : "1px solid rgba(255,255,255,0.06)",
                }}
                title="Wishlist"
              >
                <Heart
                  className="w-5 h-5"
                  style={{ color: wishlist.count > 0 ? primaryColor : "rgba(255,255,255,0.4)" }}
                  fill={wishlist.count > 0 ? primaryColor : "none"}
                />
                {wishlist.count > 0 && (
                  <span
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
                    style={{ backgroundColor: primaryColor }}
                  >
                    {wishlist.count}
                  </span>
                )}
              </button>
            </div>
          </div>
        );
      case "featured":
        return featuredItems.length > 0 ? (
          <FeaturedSection
            key="featured"
            items={featuredItems}
            primaryColor={primaryColor}
            secondaryColor={secondaryColor}
            accentColor={accentColor}
            isInCart={isInCart}
            addToCart={addToCart}
            onItemClick={handleItemClick}
            badges={storefrontConfig?.merchandising?.badges}
          />
        ) : null;
      case "categories":
        return (
          <CategoryNav
            key="categories"
            catalogItems={catalogItems}
            activeCategory={activeCategory}
            onCategoryChange={handleCategoryChange}
            primaryColor={primaryColor}
            slug={slug}
          />
        );
      case "catalog":
        return (
          <CatalogGrid
            key="catalog"
            catalogItems={filteredCatalogItems}
            primaryColor={primaryColor}
            secondaryColor={secondaryColor}
            accentColor={accentColor}
            isInCart={isInCart}
            addToCart={addToCart}
            removeFromCart={removeFromCart}
            onUpdateQuantity={updateQuantity}
            cartItems={cart}
            badges={storefrontConfig?.merchandising?.badges}
            featuredItemIds={storefrontConfig?.merchandising?.featuredItemIds}
            onItemClick={handleItemClick}
            config={storefrontConfig}
            reviewAggregates={reviewAggregates}
            isWishlisted={wishlist.isWishlisted}
            onToggleWishlist={(item) =>
              wishlist.toggle({
                id: item.id,
                name: item.name,
                price: item.price,
                currency: item.currency,
                imageUrl: item.imageUrl,
                itemType: item.itemType,
              })
            }
          />
        );
      case "testimonials":
        return storefrontConfig?.socialProof?.testimonials?.length ? (
          <TestimonialsSection
            key="testimonials"
            testimonials={storefrontConfig.socialProof.testimonials}
            primaryColor={primaryColor}
            secondaryColor={secondaryColor}
          />
        ) : null;
      case "faq":
        return storefrontConfig?.faq?.entries?.length ? (
          <FaqSection
            key="faq"
            entries={storefrontConfig.faq.entries}
            heading={storefrontConfig.faq.heading}
            primaryColor={primaryColor}
            accentColor={accentColor}
          />
        ) : null;
      case "contact":
        return business ? (
          <ContactSection
            key="contact"
            business={business}
            heading={storefrontConfig?.contact?.heading}
            customMessage={storefrontConfig?.contact?.customMessage}
            showWhatsApp={storefrontConfig?.contact?.showWhatsApp}
            showEmail={storefrontConfig?.contact?.showEmail}
            showPhone={storefrontConfig?.contact?.showPhone}
            showAddress={storefrontConfig?.contact?.showAddress}
            primaryColor={primaryColor}
            secondaryColor={secondaryColor}
          />
        ) : null;
      case "policies":
        return storefrontConfig?.policies?.pages?.length ? (
          <PoliciesFooterLinks
            key="policies"
            policies={storefrontConfig.policies.pages}
            primaryColor={primaryColor}
          />
        ) : null;
      default:
        return null;
    }
  };

  return (
    <main className="min-h-screen text-white relative" style={{ backgroundColor: ts.pageBg, backgroundImage: ts.pageGradient, fontFamily: bodyFontStyle }}>
      {business && (
        <>
          <OrganizationSchema business={business} url={pageUrl} />
          <BreadcrumbListSchema items={[{ name: business.name, url: pageUrl }]} />
        </>
      )}

      {isSectionVisible("hero") && (
        <BusinessHero
          business={business!}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
          accentColor={accentColor}
          config={storefrontConfig}
          catalogCount={catalogItems.length}
        />
      )}

      <div className={`max-w-4xl mx-auto ${densityPadding} pb-32 ${appearance?.density === "compact" ? "space-y-5" : "space-y-8"}`}>
        {storefrontConfig?.promotions?.bannerEnabled && storefrontConfig.promotions.bannerText && !bannerDismissed && (!storefrontConfig.promotions.bannerExpiry || new Date(storefrontConfig.promotions.bannerExpiry) > new Date()) && (
          <div
            className="rounded-2xl px-5 py-3.5 text-center text-sm font-medium flex items-center justify-center gap-2 backdrop-blur-sm relative"
            style={{
              backgroundColor: `${storefrontConfig.promotions.bannerColor || '#f59e0b'}12`,
              color: storefrontConfig.promotions.bannerColor || '#f59e0b',
              border: `1px solid ${storefrontConfig.promotions.bannerColor || '#f59e0b'}25`,
            }}
          >
            <Flame className="w-4 h-4 animate-pulse" />
            {storefrontConfig.promotions.bannerText}
            <button
              onClick={() => setBannerDismissed(true)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-white/[0.08] transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Dismiss banner"
            >
              <X className="w-3.5 h-3.5 opacity-50 hover:opacity-80" />
            </button>
          </div>
        )}

        {sectionOrder.map((key) => renderSection(key))}

        {storefrontConfig?.socialProof?.guaranteeText && (
          <div className="rounded-2xl p-4 flex items-center gap-3 text-sm backdrop-blur-sm" style={{ border: `1px solid ${accentColor}18`, background: `${accentColor}06` }}>
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${accentColor}15` }}>
              <Shield className="w-4 h-4" style={{ color: accentColor }} />
            </div>
            <span className="text-white/55">{storefrontConfig.socialProof.guaranteeText}</span>
          </div>
        )}

        <SecurityFooter
          primaryColor={primaryColor}
          businessName={business?.name || ""}
        />
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
          slug={slug}
          isWishlisted={wishlist.isWishlisted(selectedItem.id)}
          onToggleWishlist={() =>
            wishlist.toggle({
              id: selectedItem.id,
              name: selectedItem.name,
              price: selectedItem.price,
              currency: selectedItem.currency,
              imageUrl: selectedItem.imageUrl,
              itemType: selectedItem.itemType,
            })
          }
        />
      )}

      <WishlistDrawer
        open={wishlistOpen}
        onClose={() => setWishlistOpen(false)}
        items={wishlist.items}
        onRemove={wishlist.remove}
        onAddToCart={addToCart}
        primaryColor={primaryColor}
      />

      <CartDrawer
        cart={cart}
        cartOpen={cartOpen}
        cartCount={cartCount}
        cartTotal={cartTotal}
        cartCurrency={cartCurrency}
        primaryColor={primaryColor}
        secondaryColor={secondaryColor}
        accentColor={accentColor}
        promoCode={promoCode}
        slug={slug}
        taxRate={(storefrontConfig?.storeSettings as Record<string, unknown>)?.taxRate as number | undefined}
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
        onApplyPromo={handleApplyPromo}
        onRemovePromo={handleRemovePromo}
      />
    </main>
  );
}
