"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { apiGet } from "@/lib/api";
import { formatPrice } from "@/lib/format";
import {
  Loader2,
  Globe,
  ArrowLeft,
  Clock,
  Plus,
  Minus,
  CheckCircle2,
  Star,
  Shield,
  Zap,
  ShoppingBag,
  MessageCircle,
  Truck,
} from "lucide-react";
import { trackStoreEvent, type StorefrontConfig } from "@/lib/client";
import { getThemeStyles, type ThemeKey } from "@/lib/storefront-themes";

import type {
  Business,
  CatalogItem,
  CartItem,
  CommerceProduct,
  Service,
} from "../../components/types";
import { loadCart, saveCart, typeBadge } from "../../components/utils";
import { CartDrawer } from "../../components/cart-drawer";
import { Breadcrumbs } from "../../components/category-nav";
import { ProductSchema, BreadcrumbListSchema } from "../../components/structured-data";

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const productId = params.productId as string;

  const [business, setBusiness] = useState<Business | null>(null);
  const [item, setItem] = useState<CatalogItem | null>(null);
  const [relatedItems, setRelatedItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [storefrontConfig, setStorefrontConfig] = useState<StorefrontConfig | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [imageZoomed, setImageZoomed] = useState(false);

  const appearance = storefrontConfig?.appearance;
  const primaryColor = appearance?.primaryColor || business?.primaryColor || "#F97316";
  const secondaryColor = appearance?.secondaryColor || business?.secondaryColor || "#14B8A6";
  const accentColor = appearance?.accentColor || "#a78bfa";
  const themeKey = (appearance?.theme ?? "default") as ThemeKey;
  const ts = getThemeStyles(themeKey, primaryColor, secondaryColor, accentColor);


  const addToCart = useCallback(
    (ci: CatalogItem, qty = 1) => {
      setCart((prev) => {
        const existing = prev.find((c) => c.id === ci.id && c.itemType === ci.itemType);
        let next: CartItem[];
        if (existing) {
          if (ci.itemType === "service") return prev;
          next = prev.map((c) =>
            c.id === ci.id && c.itemType === ci.itemType ? { ...c, quantity: c.quantity + qty } : c
          );
        } else {
          next = [...prev, { ...ci, quantity: qty }];
        }
        saveCart(slug, next);
        return next;
      });
      if (business?.id) trackStoreEvent(business.id, "add_to_cart", ci.id);
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

  const isInCart = cart.some((c) => c.id === productId);
  const cartTotal = cart.reduce((sum, c) => sum + c.price * c.quantity, 0);
  const cartCount = cart.reduce((sum, c) => sum + c.quantity, 0);
  const cartCurrency = cart[0]?.currency || business?.currency || "TTD";

  useEffect(() => {
    const load = async () => {
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
      setBusiness(res.data);

      const sfRes = await apiGet<{ storefront?: StorefrontConfig; storefrontConfig?: StorefrontConfig }>(`/site/storefront/public/${encodeURIComponent(slug)}`);
      if (sfRes.data?.storefront) setStorefrontConfig(sfRes.data.storefront);
      else if (sfRes.data?.storefrontConfig) setStorefrontConfig(sfRes.data.storefrontConfig);

      const [servicesRes, productsRes] = await Promise.all([
        apiGet<Service[]>(`/bookings/public/businesses/${res.data.id}/services`),
        apiGet<CommerceProduct[]>(`/commerce/public/businesses/${res.data.id}/products`).catch(() => ({
          data: null,
          error: "Failed",
        })),
      ]);

      const services = servicesRes.data ?? [];
      const products = productsRes.data ?? [];

      const allItems: CatalogItem[] = [];
      for (const s of services) {
        allItems.push({
          id: s.id,
          name: s.name,
          description: s.description,
          price: s.price,
          currency: s.currency ?? res.data.currency ?? "TTD",
          duration: s.durationMins ?? s.duration,
          imageUrl: null,
          itemType: "service",
          requiresBooking: true,
          sourceServiceId: s.id,
        });
      }
      for (const p of products) {
        if (!p.isActive) continue;
        allItems.push({
          id: p.id,
          name: p.name,
          description: p.description,
          price: p.price,
          currency: p.currency,
          duration: p.duration,
          imageUrl: p.imageUrl,
          itemType: p.category === "PACKAGE" ? "package" : p.category === "SERVICE" ? "service" : "product",
          requiresBooking: false,
        });
      }

      const found = allItems.find((i) => i.id === productId);
      if (!found) {
        setError("Product not found");
        setLoading(false);
        return;
      }
      setItem(found);
      setRelatedItems(allItems.filter((i) => i.itemType === found.itemType && i.id !== found.id).slice(0, 6));

      if (res.data?.id) trackStoreEvent(res.data.id, "item_view", productId);
      setLoading(false);
    };
    load();
  }, [slug, productId]);

  useEffect(() => {
    if (slug) setCart(loadCart(slug));
  }, [slug]);

  useEffect(() => {
    if (item && business) {
      document.title = `${item.name} - ${business.name} | KeyFlowOS`;
    }
  }, [item, business]);

  const pageUrl = typeof window !== "undefined" ? window.location.href : "";
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  if (loading) {
    return (
      <main className="min-h-screen text-gray-900 flex items-center justify-center" style={{ backgroundColor: ts.pageBg, backgroundImage: ts.pageGradient }}>
        <div className="flex flex-col items-center gap-4 animate-pulse">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${primaryColor}20, ${primaryColor}08)` }}>
            <Loader2 className="w-7 h-7 animate-spin" style={{ color: primaryColor }} />
          </div>
          <div className="space-y-2 text-center">
            <div className="h-3 w-32 bg-gray-100 rounded-full mx-auto" />
            <div className="h-2 w-24 bg-gray-50 rounded-full mx-auto" />
          </div>
        </div>
      </main>
    );
  }

  if (error || !item || !business) {
    return (
      <main className="min-h-screen text-gray-900 flex items-center justify-center px-4" style={{ backgroundColor: ts.pageBg, backgroundImage: ts.pageGradient }}>
        <div className="max-w-md w-full rounded-3xl border border-red-500/30 bg-red-500/5 backdrop-blur-xl p-10 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto">
            <Globe className="w-8 h-8 text-red-400" />
          </div>
          <h1 className="text-xl font-semibold text-red-400">Not Found</h1>
          <p className="text-sm text-gray-500">{error || "Product could not be found."}</p>
          <button
            onClick={() => router.push(`/book/${slug}`)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all min-h-[44px]"
            style={{ backgroundColor: `${primaryColor}15`, color: primaryColor }}
          >
            <ArrowLeft className="w-4 h-4" /> Back to Store
          </button>
        </div>
      </main>
    );
  }

  const itemColor = item.itemType === "service" ? primaryColor : item.itemType === "product" ? secondaryColor : accentColor;
  const badge = typeBadge(item.itemType, primaryColor, secondaryColor, accentColor);
  const cleanPhone = business.whatsapp?.replace(/[^0-9+]/g, "").replace(/^\+/, "") || "";
  const waPhone = cleanPhone.startsWith("1") || cleanPhone.length > 10 ? cleanPhone : `1868${cleanPhone}`;
  const waLink = business.whatsapp
    ? `https://wa.me/${waPhone}?text=${encodeURIComponent(`Hi, I'm interested in ${item.name}`)}`
    : null;

  const deliveryInfo = item.itemType === "service"
    ? "This is a service that will be delivered in person or online."
    : item.itemType === "package"
    ? "This package includes multiple items or sessions."
    : "Physical product — delivery details will be confirmed at checkout.";

  return (
    <main className="min-h-screen text-gray-900 relative" style={{ backgroundColor: ts.pageBg, backgroundImage: ts.pageGradient }}>
      {item && business && (
        <>
          <ProductSchema item={item} businessName={business.name} url={pageUrl} />
          <BreadcrumbListSchema
            items={[
              { name: business.name, url: `${baseUrl}/book/${slug}` },
              { name: item.name, url: pageUrl },
            ]}
          />
        </>
      )}

      <div className="max-w-4xl mx-auto px-4 sm:px-8 py-6 space-y-6 pb-32">
        <div className="flex items-center justify-between">
          <button
            onClick={() => router.push(`/book/${slug}`)}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors min-h-[44px] px-2 -ml-2"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Catalog
          </button>
          <Breadcrumbs
            slug={slug}
            businessName={business.name}
            category={item.itemType}
            productName={item.name}
            primaryColor={primaryColor}
            onNavigate={(path) => router.push(path)}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="relative rounded-2xl overflow-hidden group">
            {item.imageUrl ? (
              <div
                className={`relative cursor-zoom-in transition-all duration-300 ${imageZoomed ? "scale-150" : ""}`}
                onClick={() => setImageZoomed((z) => !z)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- user-supplied URL with unknown host (cannot pre-configure remotePatterns) */}
                <img
                  src={item.imageUrl}
                  alt={item.name}
                  loading="lazy"
                  className="w-full h-auto min-h-[280px] max-h-[500px] object-cover rounded-2xl"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-2xl" />
              </div>
            ) : (
              <div
                className="w-full h-72 md:h-96 flex items-center justify-center text-7xl font-bold rounded-2xl"
                style={{ background: `linear-gradient(135deg, ${itemColor}25, ${itemColor}10)`, color: `${itemColor}50` }}
              >
                {item.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          <div className="space-y-5">
            <div>
              <span
                className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold mb-3"
                style={{ backgroundColor: `${badge.color}15`, color: badge.color }}
              >
                {badge.label}
              </span>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900 leading-tight mt-2">{item.name}</h1>
            </div>

            <div className="flex items-center gap-4">
              <span className="text-3xl font-bold" style={{ color: itemColor }}>
                {formatPrice(item.price, item.currency)}
              </span>
              {item.duration && (
                <span className="flex items-center gap-1.5 text-sm text-gray-500 bg-gray-50 px-3 py-1.5 rounded-lg">
                  <Clock className="w-4 h-4" /> {item.duration} min
                </span>
              )}
            </div>

            {item.description && (
              <p className="text-sm text-gray-500 leading-relaxed whitespace-pre-line">{item.description}</p>
            )}

            <div className="flex items-center gap-2 text-xs text-gray-400">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              In Stock
            </div>

            <div className="flex flex-wrap gap-3 py-1">
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <Star className="w-3.5 h-3.5" style={{ color: primaryColor }} />
                Quality Guaranteed
              </div>
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <Shield className="w-3.5 h-3.5" style={{ color: primaryColor }} />
                Secure Checkout
              </div>
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <Zap className="w-3.5 h-3.5" style={{ color: primaryColor }} />
                Instant Confirmation
              </div>
            </div>

            {item.itemType !== "service" && (
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400">Qty:</span>
                <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-gray-50">
                  <button
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="w-10 h-10 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-l-xl hover:bg-gray-100 transition-colors active:scale-90"
                  >
                    <Minus className="w-4 h-4 text-gray-500" />
                  </button>
                  <span className="w-10 text-center text-sm font-semibold tabular-nums text-gray-900">{quantity}</span>
                  <button
                    onClick={() => setQuantity((q) => q + 1)}
                    className="w-10 h-10 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-r-xl hover:bg-gray-100 transition-colors active:scale-90"
                  >
                    <Plus className="w-4 h-4 text-gray-500" />
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-3 pt-2">
              {isInCart ? (
                <button
                  onClick={() => removeFromCart(item.id, item.itemType)}
                  className="flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl text-sm font-semibold min-h-[44px] transition-all text-emerald-400 bg-emerald-400/10 border border-emerald-500/20 hover:bg-red-400/10 hover:text-red-400 hover:border-red-500/20"
                >
                  <CheckCircle2 className="w-5 h-5" />
                  In Cart — Remove
                </button>
              ) : (
                <button
                  onClick={() => addToCart(item, quantity)}
                  className="flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl text-sm font-semibold min-h-[44px] transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg"
                  style={{ backgroundColor: `${primaryColor}25`, color: primaryColor, border: `1px solid ${primaryColor}35` }}
                >
                  <ShoppingBag className="w-5 h-5" />
                  Add to Cart{quantity > 1 ? ` (${quantity})` : ""}
                </button>
              )}

              {waLink && (
                <a
                  href={waLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-sm font-medium bg-emerald-600/15 text-emerald-400 hover:bg-emerald-600/25 transition-all min-h-[44px] border border-emerald-500/20"
                >
                  <MessageCircle className="w-4 h-4" />
                  Ask about this on WhatsApp
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white/[0.02] p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Truck className="w-4 h-4" style={{ color: primaryColor }} />
            <h3 className="text-sm font-semibold text-gray-600">Fulfillment Info</h3>
          </div>
          <p className="text-sm text-gray-900/45 leading-relaxed">{deliveryInfo}</p>
        </div>

        {relatedItems.length > 0 && (
          <div className="space-y-5 pt-4">
            <h3 className="text-lg font-semibold text-gray-600">Related Items</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {relatedItems.map((ri) => {
                const riColor = ri.itemType === "service" ? primaryColor : ri.itemType === "product" ? secondaryColor : accentColor;
                return (
                  <button
                    key={ri.id}
                    onClick={() => router.push(`/book/${slug}/product/${ri.id}`)}
                    className="rounded-2xl border border-gray-200 bg-gray-50 hover:bg-gray-100 hover:border-gray-300 transition-all overflow-hidden text-left group"
                  >
                    {ri.imageUrl ? (
                      <div className="w-full h-28 overflow-hidden">
                        <Image src={ri.imageUrl} alt={ri.name} loading="lazy" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"  fill sizes="(max-width: 768px) 100vw, 50vw" unoptimized />
                      </div>
                    ) : (
                      <div
                        className="w-full h-28 flex items-center justify-center text-2xl font-bold"
                        style={{ background: `linear-gradient(135deg, ${riColor}15, ${riColor}08)`, color: `${riColor}40` }}
                      >
                        {ri.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="p-3 space-y-1">
                      <p className="text-xs font-medium text-gray-900 truncate">{ri.name}</p>
                      <p className="text-xs font-bold" style={{ color: riColor }}>
                        {formatPrice(ri.price, ri.currency)}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="border-t border-gray-200 pt-8 pb-6 space-y-3">
          <div className="flex items-center justify-center gap-6 flex-wrap">
            <div className="flex items-center gap-1.5 text-[10px] text-gray-300">
              <Shield className="w-3 h-3" /> SSL Encrypted
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-gray-300">
              <Zap className="w-3 h-3" /> Instant Booking
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-gray-300">
              <Star className="w-3 h-3" /> Trusted Platform
            </div>
          </div>
          <p className="text-center text-[10px] text-gray-900/15">
            &copy; {new Date().getFullYear()} {business.name}. All rights reserved.
          </p>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 md:hidden z-30 p-4 backdrop-blur-xl border-t border-gray-200" style={{ backgroundColor: `${ts.pageBg}ee` }}>
        {isInCart ? (
          <button
            onClick={() => removeFromCart(item.id, item.itemType)}
            className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl text-sm font-semibold min-h-[44px] transition-all text-emerald-400 bg-emerald-400/10 border border-emerald-500/20"
          >
            <CheckCircle2 className="w-5 h-5" />
            In Cart — Tap to Remove
          </button>
        ) : (
          <button
            onClick={() => addToCart(item, quantity)}
            className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl text-sm font-semibold min-h-[44px] transition-all shadow-lg active:scale-[0.98]"
            style={{ backgroundColor: primaryColor, color: "white" }}
          >
            <ShoppingBag className="w-5 h-5" />
            Add to Cart — {formatPrice(item.price * quantity, item.currency)}
          </button>
        )}
      </div>

      <CartDrawer
        cart={cart}
        cartOpen={cartOpen}
        cartCount={cartCount}
        cartTotal={cartTotal}
        cartCurrency={cartCurrency}
        primaryColor={primaryColor}
        secondaryColor={secondaryColor}
        accentColor={accentColor}
        promoCode={null}
        slug={slug}
        onClose={() => setCartOpen(false)}
        onOpen={() => setCartOpen(true)}
        onUpdateQuantity={updateQuantity}
        onRemoveFromCart={removeFromCart}
        onCheckout={() => router.push(`/book/${slug}`)}
        onApplyPromo={async () => ({ success: false, error: "Visit the storefront to apply promo codes" })}
        onRemovePromo={() => {}}
      />
    </main>
  );
}
