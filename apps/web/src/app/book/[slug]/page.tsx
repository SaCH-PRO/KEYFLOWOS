"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { apiGet, apiPost, API_BASE } from "@/lib/api";
import { formatPrice } from "@/lib/format";
import {
  Calendar,
  Clock,
  User,
  CheckCircle2,
  Loader2,
  Phone,
  Mail,
  MapPin,
  Globe,
  ShoppingBag,
  Briefcase,
  Package,
  Sparkles,
  Search,
  ShoppingCart,
  Plus,
  Minus,
  X,
  Trash2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";

type DayHours = { open: string; close: string; closed: boolean };
type BusinessHours = Record<string, DayHours>;

type Business = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  logoUrl?: string | null;
  tagline?: string | null;
  description?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  businessHours?: BusinessHours | null;
  storeEnabled?: boolean;
};

type Service = {
  id: string;
  name: string;
  duration: number;
  durationMins?: number;
  price: number;
  currency?: string;
  description?: string | null;
};

type Staff = {
  id: string;
  name: string;
};

type CommerceProduct = {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  currency: string;
  category: string;
  duration?: number | null;
  imageUrl?: string | null;
  isActive: boolean;
};

type CatalogItem = {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  currency: string;
  duration?: number | null;
  imageUrl?: string | null;
  itemType: "service" | "product" | "package";
  requiresBooking: boolean;
  sourceServiceId?: string;
};

type CartItem = CatalogItem & { quantity: number };

type ServiceBookingData = {
  serviceId: string;
  serviceName: string;
  staffId: string;
  date: string;
  time: string;
};

type FilterTab = "all" | "service" | "product" | "package";
type SortOption = "default" | "price_asc" | "price_desc" | "duration";

const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function getAvailableSlots(date: string, businessHours?: BusinessHours | null): string[] {
  if (!date) return [];
  const d = new Date(date + "T00:00:00");
  const dayKey = dayKeys[d.getDay()];
  const dayH = businessHours?.[dayKey];
  if (dayH?.closed) return [];
  const open = dayH?.open || "09:00";
  const close = dayH?.close || "17:00";
  const [oh, om] = open.split(":").map(Number);
  const [ch, cm] = close.split(":").map(Number);
  const slots: string[] = [];
  let t = oh * 60 + om;
  const end = ch * 60 + cm;
  while (t < end) {
    const h = Math.floor(t / 60).toString().padStart(2, "0");
    const m = (t % 60).toString().padStart(2, "0");
    slots.push(`${h}:${m}`);
    t += 30;
  }
  return slots;
}

function isDayClosed(date: string, businessHours?: BusinessHours | null): boolean {
  if (!date || !businessHours) return false;
  const d = new Date(date + "T00:00:00");
  return businessHours[dayKeys[d.getDay()]]?.closed === true;
}

function loadCart(slug: string): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`kf_cart_${slug}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item: any) => item && typeof item.id === "string" && typeof item.name === "string");
  } catch {
    return [];
  }
}

function saveCart(slug: string, cart: CartItem[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`kf_cart_${slug}`, JSON.stringify(cart));
  } catch {}
}

function typeBadge(itemType: CatalogItem["itemType"], primaryColor: string, secondaryColor: string) {
  const cfg = {
    service: { label: "🛠 Service", color: primaryColor },
    product: { label: "📦 Product", color: secondaryColor },
    package: { label: "🎁 Package", color: "#a78bfa" },
  }[itemType];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ backgroundColor: `${cfg.color}20`, color: cfg.color }}
    >
      {cfg.label}
    </span>
  );
}

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
  const [checkoutStep, setCheckoutStep] = useState(0);

  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [sortOption, setSortOption] = useState<SortOption>("default");
  const [sortOpen, setSortOpen] = useState(false);

  const [serviceBookings, setServiceBookings] = useState<Record<string, ServiceBookingData>>({});
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [bookingResults, setBookingResults] = useState<{ bookingId: string; invoiceId?: string }[]>([]);

  const primaryColor = business?.primaryColor || "#F97316";
  const secondaryColor = business?.secondaryColor || "#14B8A6";

  const updateCart = useCallback((newCart: CartItem[]) => {
    setCart(newCart);
    saveCart(slug, newCart);
  }, [slug]);

  const addToCart = useCallback((item: CatalogItem) => {
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
  }, [slug]);

  const removeFromCart = useCallback((itemId: string, itemType: string) => {
    setCart((prev) => {
      const next = prev.filter((c) => !(c.id === itemId && c.itemType === itemType));
      saveCart(slug, next);
      return next;
    });
  }, [slug]);

  const updateQuantity = useCallback((itemId: string, itemType: string, delta: number) => {
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
  }, [slug]);

  const isInCart = useCallback((itemId: string, itemType: string) => {
    return cart.some((c) => c.id === itemId && c.itemType === itemType);
  }, [cart]);

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
    if (business) document.title = `Book with ${business.name} | KeyFlowOS`;
  }, [business]);

  useEffect(() => {
    if (!business) return;
    const description = business.tagline || `Book an appointment with ${business.name} online.`;
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "description");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", description);
  }, [business]);

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
    return items;
  })();

  const hasServices = catalogItems.some((i) => i.itemType === "service");
  const hasProducts = catalogItems.some((i) => i.itemType === "product");
  const hasPackages = catalogItems.some((i) => i.itemType === "package");

  const filteredItems = (() => {
    let items = activeTab === "all" ? catalogItems : catalogItems.filter((i) => i.itemType === activeTab);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(
        (i) => i.name.toLowerCase().includes(q) || (i.description && i.description.toLowerCase().includes(q))
      );
    }
    if (sortOption === "price_asc") items = [...items].sort((a, b) => a.price - b.price);
    else if (sortOption === "price_desc") items = [...items].sort((a, b) => b.price - a.price);
    else if (sortOption === "duration")
      items = [...items].sort((a, b) => (a.duration ?? 9999) - (b.duration ?? 9999));
    return items;
  })();

  const checkoutSteps = (() => {
    const steps = [{ key: "review", label: "Review Cart" }];
    if (serviceItemsInCart.length > 0) steps.push({ key: "booking", label: "Schedule" });
    steps.push({ key: "details", label: "Your Details" });
    steps.push({ key: "confirm", label: "Confirm" });
    return steps;
  })();

  useEffect(() => {
    if (checkoutStep >= checkoutSteps.length) {
      setCheckoutStep(Math.max(0, checkoutSteps.length - 1));
    }
  }, [checkoutSteps.length, checkoutStep]);

  const canProceedStep = (() => {
    const stepKey = checkoutSteps[checkoutStep]?.key;
    if (stepKey === "review") return cart.length > 0;
    if (stepKey === "booking") {
      return serviceItemsInCart.every((si) => {
        const bd = serviceBookings[`${si.id}_${si.itemType}`];
        return bd && bd.date && bd.time;
      });
    }
    if (stepKey === "details") return firstName.trim() !== "" && emailInput.trim() !== "";
    return true;
  })();

  const handleSubmitBooking = async () => {
    if (!business) return;
    setSubmitting(true);
    setError(null);

    const results: { bookingId: string; invoiceId?: string }[] = [];
    const nonBookingItems = cart.filter((c) => !c.requiresBooking);
    const notesExtra = nonBookingItems.length > 0
      ? `\nAdditional items: ${nonBookingItems.map((c) => `${c.name} x${c.quantity}`).join(", ")}`
      : "";

    for (const si of serviceItemsInCart) {
      const bd = serviceBookings[`${si.id}_${si.itemType}`];
      if (!bd) continue;

      const svc = services.find((s) => s.id === (si.sourceServiceId || si.id));
      const dur = svc?.durationMins ?? svc?.duration ?? 60;
      const startTime = new Date(`${bd.date}T${bd.time}`).toISOString();
      const endTime = new Date(new Date(startTime).getTime() + dur * 60000).toISOString();

      for (let q = 0; q < si.quantity; q++) {
        const { data, error: err } = await apiPost<{
          bookingId: string;
          invoiceId?: string;
          success: boolean;
        }>({
          path: `/bookings/public/businesses/${business.id}`,
          body: {
            serviceId: si.sourceServiceId || si.id,
            staffId: bd.staffId || undefined,
            startTime,
            endTime,
            firstName: firstName || undefined,
            lastName: lastName || undefined,
            email: emailInput || undefined,
            phone: phoneInput || undefined,
            notes: notesExtra.trim() || undefined,
          },
        });

        if (err) {
          setError(err);
          setSubmitting(false);
          return;
        }
        if (data) {
          results.push({ bookingId: data.bookingId, invoiceId: data.invoiceId });
        }
      }
    }

    if (serviceItemsInCart.length === 0 && nonBookingItems.length > 0) {
      results.push({ bookingId: "order-" + Date.now().toString(36) });
    }

    setSubmitting(false);
    setBookingResults(results);
    setSuccess(true);
    updateCart([]);
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: primaryColor }} />
          <p className="text-sm text-white/40">Loading...</p>
        </div>
      </main>
    );
  }

  if (error && !business) {
    return (
      <main className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center px-4">
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
    return (
      <main className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center px-4">
        <div className="max-w-md w-full rounded-3xl border border-emerald-500/30 bg-emerald-500/5 backdrop-blur-xl p-10 text-center space-y-5">
          <div className="w-20 h-20 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-10 h-10 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-semibold text-emerald-400">
            {bookingResults.length > 0 && bookingResults[0].bookingId.startsWith("order-")
              ? "Order Placed!"
              : "Booking Confirmed!"}
          </h1>
          <p className="text-sm text-white/60">
            Your {serviceItemsInCart.length > 0 ? "appointment" : "order"} with{" "}
            <span className="font-medium text-white">{business?.name}</span> has been confirmed.
          </p>
          {bookingResults.map((br, idx) =>
            !br.bookingId.startsWith("order-") ? (
              <div key={idx} className="text-xs text-white/40">
                Booking Reference:{" "}
                <code className="font-mono text-emerald-400">
                  {br.bookingId.slice(-8).toUpperCase()}
                </code>
              </div>
            ) : null
          )}
          {bookingResults.some((br) => br.invoiceId) && (
            <button
              onClick={() => {
                const inv = bookingResults.find((br) => br.invoiceId);
                if (inv?.invoiceId)
                  window.open(`${API_BASE}/commerce/invoices/${inv.invoiceId}/receipt`, "_blank");
              }}
              aria-label="View invoice"
              className="px-6 py-3 rounded-xl font-medium text-sm text-white transition-all hover:scale-[1.02]"
              style={{ backgroundColor: primaryColor }}
            >
              View Invoice
            </button>
          )}
        </div>
      </main>
    );
  }

  if (checkoutMode) {
    const currentStepKey = checkoutSteps[checkoutStep]?.key;
    return (
      <main className="min-h-screen bg-[#0a0a0f] text-white">
        <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
          <button
            onClick={() => {
              if (checkoutStep === 0) {
                setCheckoutMode(false);
              } else {
                setCheckoutStep((s) => s - 1);
              }
            }}
            className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {checkoutStep === 0 ? "Back to Shop" : "Previous Step"}
          </button>

          <div className="flex items-center gap-2 mb-6">
            {checkoutSteps.map((step, idx) => (
              <div key={step.key} className="flex items-center gap-2">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    idx < checkoutStep
                      ? "text-white"
                      : idx === checkoutStep
                      ? "text-white ring-2"
                      : "bg-white/5 text-white/30"
                  }`}
                  style={
                    idx < checkoutStep
                      ? { backgroundColor: primaryColor }
                      : idx === checkoutStep
                      ? { backgroundColor: `${primaryColor}30`, ringColor: primaryColor }
                      : {}
                  }
                >
                  {idx < checkoutStep ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
                </div>
                <span
                  className={`text-xs hidden sm:inline ${
                    idx === checkoutStep ? "text-white font-medium" : "text-white/30"
                  }`}
                >
                  {step.label}
                </span>
                {idx < checkoutSteps.length - 1 && (
                  <div
                    className="w-8 h-px"
                    style={{ backgroundColor: idx < checkoutStep ? primaryColor : "rgba(255,255,255,0.1)" }}
                  />
                )}
              </div>
            ))}
          </div>

          {currentStepKey === "review" && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Review Your Cart</h2>
              {cart.map((item) => (
                <div
                  key={`${item.id}_${item.itemType}`}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 flex items-center gap-4"
                >
                  {item.imageUrl && (
                    <img
                      src={item.imageUrl}
                      alt={item.name}
                      className="w-16 h-16 rounded-xl object-cover flex-shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {typeBadge(item.itemType, primaryColor, secondaryColor)}
                      {item.requiresBooking && (
                        <span className="text-[10px] text-amber-400 flex items-center gap-0.5">
                          <AlertTriangle className="w-3 h-3" /> Needs booking
                        </span>
                      )}
                    </div>
                    <h4 className="font-medium text-sm truncate">{item.name}</h4>
                    <p className="text-xs text-white/40">
                      {formatPrice(item.price, item.currency)}
                      {item.duration ? ` · ${item.duration} min` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateQuantity(item.id, item.itemType, -1)}
                      className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="text-sm font-medium w-6 text-center">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.id, item.itemType, 1)}
                      className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="text-sm font-semibold whitespace-nowrap" style={{ color: primaryColor }}>
                    {formatPrice(item.price * item.quantity, item.currency)}
                  </div>
                </div>
              ))}
              <div
                className="rounded-2xl border p-4 flex justify-between items-center"
                style={{ borderColor: `${primaryColor}30`, backgroundColor: `${primaryColor}08` }}
              >
                <span className="font-medium">Subtotal</span>
                <span className="text-lg font-bold" style={{ color: primaryColor }}>
                  {formatPrice(cartTotal, cartCurrency)}
                </span>
              </div>
            </div>
          )}

          {currentStepKey === "booking" && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold">Schedule Your Services</h2>
              {serviceItemsInCart.map((si) => {
                const key = `${si.id}_${si.itemType}`;
                const bd = serviceBookings[key] || {
                  serviceId: si.sourceServiceId || si.id,
                  serviceName: si.name,
                  staffId: "",
                  date: "",
                  time: "",
                };
                const slots = getAvailableSlots(bd.date, business?.businessHours);
                const closed = isDayClosed(bd.date, business?.businessHours);

                const updateBd = (patch: Partial<ServiceBookingData>) => {
                  setServiceBookings((prev) => ({
                    ...prev,
                    [key]: { ...bd, ...patch },
                  }));
                };

                return (
                  <div
                    key={key}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4"
                  >
                    <div className="flex items-center gap-2">
                      {typeBadge("service", primaryColor, secondaryColor)}
                      <h3 className="font-medium">{si.name}</h3>
                      {si.quantity > 1 && (
                        <span className="text-xs text-white/40">x{si.quantity}</span>
                      )}
                    </div>

                    {staff.length > 0 && (
                      <div className="space-y-2">
                        <label className="text-xs uppercase tracking-wider text-white/40 flex items-center gap-2">
                          <User className="w-3 h-3" /> Staff (Optional)
                        </label>
                        <div className="flex gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => updateBd({ staffId: "" })}
                            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-all ${
                              !bd.staffId
                                ? "border-white/20 bg-white/10"
                                : "border-white/10 hover:border-white/20 bg-white/[0.02]"
                            }`}
                          >
                            <User className="w-3.5 h-3.5 text-white/40" /> Any
                          </button>
                          {staff.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => updateBd({ staffId: s.id })}
                              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-all ${
                                bd.staffId === s.id
                                  ? "border-white/20 bg-white/10"
                                  : "border-white/10 hover:border-white/20 bg-white/[0.02]"
                              }`}
                            >
                              <div
                                className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                                style={{ backgroundColor: `${secondaryColor}20`, color: secondaryColor }}
                              >
                                {s.name.charAt(0).toUpperCase()}
                              </div>
                              {s.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-wider text-white/40 flex items-center gap-2">
                        <Calendar className="w-3 h-3" /> Date
                      </label>
                      <input
                        type="date"
                        value={bd.date}
                        onChange={(e) => updateBd({ date: e.target.value, time: "" })}
                        min={new Date().toISOString().split("T")[0]}
                        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 transition-all"
                      />
                    </div>

                    {bd.date && closed && (
                      <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300">
                        Closed on{" "}
                        {new Date(bd.date + "T00:00:00").toLocaleDateString("en-US", {
                          weekday: "long",
                        })}
                        s. Please pick another date.
                      </div>
                    )}

                    {bd.date && !closed && slots.length > 0 && (
                      <div className="space-y-2">
                        <label className="text-xs uppercase tracking-wider text-white/40 flex items-center gap-2">
                          <Clock className="w-3 h-3" /> Time
                        </label>
                        <div
                          className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-[180px] overflow-y-auto"
                          style={{ scrollbarWidth: "thin" }}
                        >
                          {slots.map((slot) => (
                            <button
                              key={slot}
                              type="button"
                              onClick={() => updateBd({ time: slot })}
                              className={`px-2 py-2 rounded-lg text-xs font-medium border transition-all ${
                                bd.time === slot
                                  ? "text-white border-transparent"
                                  : "border-white/10 bg-white/[0.03] text-white/60 hover:border-white/20 hover:text-white"
                              }`}
                              style={
                                bd.time === slot
                                  ? { backgroundColor: primaryColor, borderColor: primaryColor }
                                  : {}
                              }
                            >
                              {slot}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {bd.date && !closed && slots.length === 0 && (
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/40">
                        No time slots available for this date.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {currentStepKey === "details" && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Your Details</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First Name *"
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-2 transition-all"
                />
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last Name"
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-2 transition-all"
                />
                <input
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="Email *"
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-2 transition-all"
                />
                <input
                  type="tel"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="Phone (optional)"
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-2 transition-all"
                />
              </div>
            </div>
          )}

          {currentStepKey === "confirm" && (
            <div className="space-y-5">
              <h2 className="text-xl font-semibold">Confirm Your Order</h2>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
                <div className="text-xs uppercase tracking-wider text-white/40">Items</div>
                {cart.map((item) => (
                  <div
                    key={`${item.id}_${item.itemType}`}
                    className="flex justify-between text-sm"
                  >
                    <span className="text-white/60">
                      {item.name} x{item.quantity}
                    </span>
                    <span className="text-white font-medium">
                      {formatPrice(item.price * item.quantity, item.currency)}
                    </span>
                  </div>
                ))}
                <div className="border-t border-white/10 pt-3 flex justify-between text-base font-semibold">
                  <span style={{ color: primaryColor }}>Total</span>
                  <span style={{ color: primaryColor }}>{formatPrice(cartTotal, cartCurrency)}</span>
                </div>
              </div>

              {serviceItemsInCart.length > 0 && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
                  <div className="text-xs uppercase tracking-wider text-white/40">Appointments</div>
                  {serviceItemsInCart.map((si) => {
                    const bd = serviceBookings[`${si.id}_${si.itemType}`];
                    if (!bd) return null;
                    const staffMember = staff.find((s) => s.id === bd.staffId);
                    return (
                      <div key={`${si.id}_${si.itemType}`} className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-white/60">{si.name}</span>
                          <span className="text-white">
                            {bd.date &&
                              new Date(`${bd.date}T${bd.time || "00:00"}`).toLocaleDateString("en-US", {
                                weekday: "short",
                                month: "short",
                                day: "numeric",
                              })}{" "}
                            at {bd.time}
                          </span>
                        </div>
                        {staffMember && (
                          <div className="text-xs text-white/40">
                            Staff: {staffMember.name}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-2">
                <div className="text-xs uppercase tracking-wider text-white/40">Contact</div>
                <div className="text-sm text-white">
                  {firstName} {lastName}
                </div>
                <div className="text-sm text-white/60">{emailInput}</div>
                {phoneInput && <div className="text-sm text-white/60">{phoneInput}</div>}
              </div>

              {error && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-4">
            {checkoutStep > 0 && (
              <button
                onClick={() => setCheckoutStep((s) => s - 1)}
                className="flex-1 py-3 rounded-xl border border-white/10 text-sm font-medium hover:bg-white/5 transition-all"
              >
                Back
              </button>
            )}
            {checkoutStep < checkoutSteps.length - 1 ? (
              <button
                onClick={() => setCheckoutStep((s) => s + 1)}
                disabled={!canProceedStep}
                className="flex-1 py-3 rounded-xl text-white text-sm font-semibold transition-all hover:scale-[1.01] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
                style={{ backgroundColor: primaryColor }}
              >
                Continue
              </button>
            ) : (
              <button
                onClick={handleSubmitBooking}
                disabled={submitting || !canProceedStep}
                className="flex-1 py-3.5 rounded-xl text-white font-semibold text-sm transition-all hover:scale-[1.01] hover:shadow-lg disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
                style={{ backgroundColor: primaryColor, boxShadow: `0 8px 32px ${primaryColor}30` }}
              >
                {submitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Processing...
                  </span>
                ) : serviceItemsInCart.length > 0 ? (
                  "Confirm Booking"
                ) : (
                  "Place Order"
                )}
              </button>
            )}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0a0a0f] text-white">
      <div className="relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            background: `radial-gradient(ellipse at 50% 0%, ${primaryColor}, transparent 70%), radial-gradient(ellipse at 80% 100%, ${secondaryColor}, transparent 60%)`,
          }}
        />
        <div className="relative max-w-4xl mx-auto px-4 pt-12 pb-8">
          <div className="text-center space-y-4">
            {business?.logoUrl && (
              <div className="relative inline-block">
                <img
                  src={business.logoUrl}
                  alt={business.name}
                  className="h-20 w-20 rounded-2xl object-cover border-2 border-white/10 shadow-2xl"
                />
                <div
                  className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-[#0a0a0f]"
                  style={{ backgroundColor: "#22c55e" }}
                />
              </div>
            )}
            <div>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{business?.name}</h1>
              {business?.tagline ? (
                <p className="text-base text-white/50 mt-2 max-w-md mx-auto">{business.tagline}</p>
              ) : (
                <p className="text-base text-white/50 mt-2">Book your appointment online</p>
              )}
            </div>
            {(business?.address || business?.phone || business?.email) && (
              <div className="flex items-center justify-center gap-5 text-xs text-white/40 flex-wrap">
                {business?.address && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" /> {business.address}
                  </span>
                )}
                {business?.phone && (
                  <span className="flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5" /> {business.phone}
                  </span>
                )}
                {business?.email && (
                  <span className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5" /> {business.email}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 pb-24 space-y-6">
        {catalogItems.length > 0 && (
          <>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search services, products..."
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-2 transition-all"
                  style={{ "--tw-ring-color": primaryColor } as React.CSSProperties}
                />
              </div>
              <div className="relative">
                <button
                  onClick={() => setSortOpen(!sortOpen)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm text-white/60 hover:border-white/20 transition-all"
                >
                  Sort
                  {sortOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
                {sortOpen && (
                  <div className="absolute right-0 top-full mt-1 w-48 rounded-xl border border-white/10 bg-[#16161f] backdrop-blur-xl shadow-2xl z-30 overflow-hidden">
                    {([
                      ["default", "Default"],
                      ["price_asc", "Price: Low → High"],
                      ["price_desc", "Price: High → Low"],
                      ["duration", "Duration"],
                    ] as [SortOption, string][]).map(([val, label]) => (
                      <button
                        key={val}
                        onClick={() => {
                          setSortOption(val);
                          setSortOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                          sortOption === val
                            ? "text-white bg-white/5"
                            : "text-white/50 hover:text-white hover:bg-white/5"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
              {(
                [
                  ["all", "All"],
                  ...(hasServices ? [["service", "Services"]] : []),
                  ...(hasProducts ? [["product", "Products"]] : []),
                  ...(hasPackages ? [["package", "Packages"]] : []),
                ] as [FilterTab, string][]
              ).map(([tab, label]) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                    activeTab === tab ? "text-white" : "text-white/40 bg-white/[0.03] hover:text-white/60"
                  }`}
                  style={activeTab === tab ? { backgroundColor: `${primaryColor}25`, color: primaryColor } : {}}
                >
                  {label}
                </button>
              ))}
            </div>

            {filteredItems.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {filteredItems.map((item) => {
                  const inCart = isInCart(item.id, item.itemType);
                  return (
                    <div
                      key={`${item.id}_${item.itemType}`}
                      className={`rounded-2xl border backdrop-blur transition-all group ${
                        inCart
                          ? "border-white/20 bg-white/[0.06]"
                          : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"
                      }`}
                    >
                      {item.imageUrl && (
                        <div className="w-full h-40 rounded-t-2xl overflow-hidden">
                          <img
                            src={item.imageUrl}
                            alt={item.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}
                      <div className="p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          {typeBadge(item.itemType, primaryColor, secondaryColor)}
                        </div>
                        <div className="flex items-start justify-between">
                          <h4 className="font-semibold text-white text-sm leading-tight pr-2">
                            {item.name}
                          </h4>
                          <div className="text-sm font-bold whitespace-nowrap" style={{ color: primaryColor }}>
                            {formatPrice(item.price, item.currency)}
                          </div>
                        </div>
                        {item.description && (
                          <p className="text-xs text-white/50 line-clamp-2 leading-relaxed">
                            {item.description}
                          </p>
                        )}
                        <div className="flex items-center justify-between pt-1">
                          {item.duration ? (
                            <span className="flex items-center gap-1 text-xs text-white/40">
                              <Clock className="w-3 h-3" /> {item.duration} min
                            </span>
                          ) : (
                            <span />
                          )}
                          {inCart ? (
                            <button
                              onClick={() => removeFromCart(item.id, item.itemType)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all text-emerald-400 bg-emerald-400/10 hover:bg-red-400/10 hover:text-red-400"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" /> In Cart
                            </button>
                          ) : (
                            <button
                              onClick={() => addToCart(item)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:scale-105"
                              style={{ backgroundColor: `${primaryColor}20`, color: primaryColor }}
                            >
                              <Plus className="w-3.5 h-3.5" /> Add
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-10 text-center space-y-3">
                <Search className="w-8 h-8 text-white/20 mx-auto" />
                <p className="text-sm text-white/40">No items match your search.</p>
              </div>
            )}
          </>
        )}

        {catalogItems.length === 0 && (
          <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-12 text-center space-y-4">
            <Sparkles className="w-10 h-10 text-white/20 mx-auto" />
            <h2 className="text-lg font-semibold text-white/60">Coming Soon</h2>
            <p className="text-sm text-white/30 max-w-sm mx-auto">
              This business is setting up their online store. Check back soon!
            </p>
          </div>
        )}

        <div className="text-center text-xs text-white/20 pt-4">
          Powered by <span style={{ color: primaryColor }} className="font-semibold">KeyFlowOS</span>
        </div>
      </div>

      {cartCount > 0 && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center transition-all hover:scale-110 z-40"
          style={{ backgroundColor: primaryColor, boxShadow: `0 8px 32px ${primaryColor}40` }}
        >
          <ShoppingCart className="w-6 h-6 text-white" />
          <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-white text-xs font-bold flex items-center justify-center"
            style={{ color: primaryColor }}
          >
            {cartCount}
          </span>
        </button>
      )}

      {cartOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setCartOpen(false)} />
          <div className="relative w-full sm:w-[400px] max-h-[85vh] sm:max-h-full bg-[#12121a] border-t sm:border-t-0 sm:border-l border-white/10 rounded-t-3xl sm:rounded-t-none flex flex-col animate-in slide-in-from-bottom sm:slide-in-from-right duration-300">
            <div className="flex items-center justify-between p-5 border-b border-white/10">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <ShoppingCart className="w-5 h-5" style={{ color: primaryColor }} />
                Cart ({cartCount})
              </h3>
              <button
                onClick={() => setCartOpen(false)}
                className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ scrollbarWidth: "thin" }}>
              {cart.map((item) => (
                <div
                  key={`${item.id}_${item.itemType}`}
                  className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {typeBadge(item.itemType, primaryColor, secondaryColor)}
                        {item.requiresBooking && (
                          <AlertTriangle className="w-3 h-3 text-amber-400" />
                        )}
                      </div>
                      <h4 className="text-sm font-medium truncate">{item.name}</h4>
                      <p className="text-xs text-white/40">{formatPrice(item.price, item.currency)}</p>
                    </div>
                    <button
                      onClick={() => removeFromCart(item.id, item.itemType)}
                      className="p-1 hover:bg-white/10 rounded-lg transition-colors text-white/30 hover:text-red-400"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateQuantity(item.id, item.itemType, -1)}
                        className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="text-sm font-medium w-6 text-center">{item.quantity}</span>
                      <button
                        onClick={() => updateQuantity(item.id, item.itemType, 1)}
                        className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                    <span className="text-sm font-semibold" style={{ color: primaryColor }}>
                      {formatPrice(item.price * item.quantity, item.currency)}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-white/10 p-5 space-y-4">
              <div className="flex justify-between items-center">
                <span className="font-medium text-white/60">Subtotal</span>
                <span className="text-lg font-bold" style={{ color: primaryColor }}>
                  {formatPrice(cartTotal, cartCurrency)}
                </span>
              </div>
              <button
                onClick={() => {
                  setCartOpen(false);
                  setCheckoutMode(true);
                  setCheckoutStep(0);
                  setError(null);
                }}
                className="w-full py-3 rounded-xl text-white font-semibold text-sm transition-all hover:scale-[1.01]"
                style={{ backgroundColor: primaryColor, boxShadow: `0 4px 20px ${primaryColor}30` }}
              >
                Proceed to Checkout
                <ArrowRight className="w-4 h-4 inline ml-2" />
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
