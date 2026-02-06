"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { apiGet, apiPost, API_BASE } from "@/lib/api";
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
  ChevronLeft,
  ChevronRight,
  ShoppingBag,
  Briefcase,
  Package,
  Sparkles,
  ArrowRight,
} from "lucide-react";

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
  isActive: boolean;
};

function Carousel({ title, icon, items, accentColor, onSelect, selectedId }: {
  title: string;
  icon: React.ReactNode;
  items: { id: string; name: string; description?: string | null; price: number; currency: string; duration?: number | null }[];
  accentColor: string;
  onSelect?: (id: string) => void;
  selectedId?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  };

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (el) el.addEventListener("scroll", checkScroll);
    return () => el?.removeEventListener("scroll", checkScroll);
  }, [items]);

  const scroll = (dir: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "left" ? -280 : 280, behavior: "smooth" });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white/90 uppercase tracking-wider">
          {icon}
          {title}
        </h3>
        <div className="flex gap-1">
          <button
            onClick={() => scroll("left")}
            disabled={!canScrollLeft}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-20 disabled:cursor-default"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => scroll("right")}
            disabled={!canScrollRight}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-20 disabled:cursor-default"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto scrollbar-hide pb-2 snap-x snap-mandatory"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {items.map((item) => {
          const isSelected = selectedId === item.id;
          return (
            <div
              key={item.id}
              onClick={() => onSelect?.(item.id)}
              className={`flex-shrink-0 w-[250px] snap-start rounded-2xl border p-4 backdrop-blur transition-all cursor-pointer group ${
                isSelected
                  ? "ring-1"
                  : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"
              }`}
              style={isSelected ? { borderColor: `${accentColor}60`, backgroundColor: `${accentColor}10`, boxShadow: `0 4px 20px ${accentColor}10`, ringColor: `${accentColor}30` } : {}}
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <h4 className="font-semibold text-white text-sm leading-tight pr-2">{item.name}</h4>
                  <div
                    className="text-sm font-bold whitespace-nowrap"
                    style={{ color: accentColor }}
                  >
                    ${item.price}
                  </div>
                </div>
                {item.description && (
                  <p className="text-xs text-white/50 line-clamp-2 leading-relaxed">{item.description}</p>
                )}
                <div className="flex items-center justify-between">
                  {item.duration ? (
                    <span className="flex items-center gap-1 text-xs text-white/40">
                      <Clock className="w-3 h-3" /> {item.duration} min
                    </span>
                  ) : <span />}
                  {onSelect && (
                    <span
                      className="text-[11px] font-medium flex items-center gap-1 transition-colors"
                      style={{ color: isSelected ? accentColor : "rgba(255,255,255,0.3)" }}
                    >
                      {isSelected ? (
                        <><CheckCircle2 className="w-3.5 h-3.5" /> Selected</>
                      ) : (
                        <>Select <ArrowRight className="w-3 h-3" /></>
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
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

  const [selectedService, setSelectedService] = useState<string>("");
  const [selectedStaff, setSelectedStaff] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [bookingResult, setBookingResult] = useState<{ bookingId: string; invoiceId?: string } | null>(null);

  const primaryColor = business?.primaryColor || "#F97316";
  const secondaryColor = business?.secondaryColor || "#14B8A6";

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
      setBusiness(res.data);

      const [servicesRes, staffRes, productsRes] = await Promise.all([
        apiGet<Service[]>(`/bookings/public/businesses/${res.data.id}/services`),
        apiGet<Staff[]>(`/bookings/public/businesses/${res.data.id}/staff`),
        apiGet<CommerceProduct[]>(`/commerce/public/businesses/${res.data.id}/products`).catch(() => ({ data: null, error: "Failed to load products" })),
      ]);
      setServices(servicesRes.data ?? []);
      setStaff(staffRes.data ?? []);
      setProducts(productsRes.data ?? []);
      if (servicesRes.data?.length) setSelectedService(servicesRes.data[0].id);
      setLoading(false);
    };
    loadBusiness();
  }, [slug]);

  const storeServiceNames = new Set(services.map((s) => s.name));
  const serviceProducts = products.filter((p) => p.category === "SERVICE" && storeServiceNames.has(p.name));
  const physicalProducts = products.filter((p) => p.category === "PRODUCT" && storeServiceNames.has(p.name));
  const packages = products.filter((p) => p.category === "PACKAGE" && storeServiceNames.has(p.name));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business || !selectedService || !selectedDate || !selectedTime) return;

    setSubmitting(true);
    const startTime = new Date(`${selectedDate}T${selectedTime}`).toISOString();
    const service = services.find((s) => s.id === selectedService);
    const dur = service?.durationMins ?? service?.duration ?? 60;
    const endTime = new Date(new Date(startTime).getTime() + dur * 60000).toISOString();

    const { data, error: err } = await apiPost<{ bookingId: string; invoiceId?: string; success: boolean }>({
      path: `/bookings/public/businesses/${business.id}`,
      body: {
        serviceId: selectedService,
        staffId: selectedStaff || undefined,
        startTime,
        endTime,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        email: emailInput || undefined,
        phone: phoneInput || undefined,
      },
    });

    setSubmitting(false);
    if (err) {
      setError(err);
    } else if (data) {
      setSuccess(true);
      setBookingResult({ bookingId: data.bookingId, invoiceId: data.invoiceId });
    }
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
          <p className="text-sm text-white/50">The booking page for &ldquo;{slug}&rdquo; could not be found.</p>
        </div>
      </main>
    );
  }

  if (success && bookingResult) {
    return (
      <main className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center px-4">
        <div className="max-w-md w-full rounded-3xl border border-emerald-500/30 bg-emerald-500/5 backdrop-blur-xl p-10 text-center space-y-5">
          <div className="w-20 h-20 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-10 h-10 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-semibold text-emerald-400">Booking Confirmed!</h1>
          <p className="text-sm text-white/60">
            Your appointment with <span className="font-medium text-white">{business?.name}</span> has been scheduled.
          </p>
          <div className="text-xs text-white/40">
            Booking Reference: <code className="font-mono text-emerald-400">{bookingResult.bookingId.slice(-8).toUpperCase()}</code>
          </div>
          {bookingResult.invoiceId && (
            <button
              onClick={() => window.open(`${API_BASE}/commerce/invoices/${bookingResult.invoiceId}/receipt`, "_blank")}
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

  const selectedServiceData = services.find((s) => s.id === selectedService);
  const serviceDuration = selectedServiceData?.durationMins ?? selectedServiceData?.duration ?? 0;
  const hasProducts = physicalProducts.length > 0;
  const hasServices = serviceProducts.length > 0;
  const hasPackages = packages.length > 0;
  const hasAnyCatalog = hasProducts || hasServices || hasPackages;

  return (
    <main className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Hero Section */}
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
                  <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> {business.address}</span>
                )}
                {business?.phone && (
                  <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> {business.phone}</span>
                )}
                {business?.email && (
                  <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> {business.email}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 pb-16 space-y-10">
        {/* Catalog Carousels */}
        {hasAnyCatalog && (
          <div className="space-y-8">
            {hasServices && (
              <Carousel
                title="Services"
                icon={<Briefcase className="w-4 h-4" style={{ color: primaryColor }} />}
                items={serviceProducts.map((p) => ({ ...p, duration: p.duration ?? undefined }))}
                accentColor={primaryColor}
              />
            )}
            {hasProducts && (
              <Carousel
                title="Products"
                icon={<ShoppingBag className="w-4 h-4" style={{ color: secondaryColor }} />}
                items={physicalProducts.map((p) => ({ ...p, duration: null }))}
                accentColor={secondaryColor}
              />
            )}
            {hasPackages && (
              <Carousel
                title="Packages"
                icon={<Package className="w-4 h-4" style={{ color: "#a78bfa" }} />}
                items={packages.map((p) => ({ ...p, duration: p.duration ?? undefined }))}
                accentColor="#a78bfa"
              />
            )}
          </div>
        )}

        {/* Booking Section */}
        {services.length > 0 && (
          <div className="space-y-6">
            <div className="flex items-center gap-2 px-1">
              <Sparkles className="w-4 h-4" style={{ color: primaryColor }} />
              <h2 className="text-lg font-semibold">Book an Appointment</h2>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.02] backdrop-blur-xl overflow-hidden">
              <form onSubmit={handleSubmit} className="p-6 space-y-8">
                {/* Service Selection */}
                <div className="space-y-3">
                  <label className="text-xs uppercase tracking-wider text-white/40 flex items-center gap-2 px-1">
                    <Briefcase className="w-3 h-3" /> Select a Service
                  </label>
                  <Carousel
                    title=""
                    icon={null}
                    items={services.map((s) => ({
                      id: s.id,
                      name: s.name,
                      description: s.description,
                      price: s.price,
                      currency: s.currency ?? "TTD",
                      duration: s.durationMins ?? s.duration,
                    }))}
                    accentColor={primaryColor}
                    onSelect={setSelectedService}
                    selectedId={selectedService}
                  />
                </div>

                {/* Staff Selection */}
                {staff.length > 0 && (
                  <div className="space-y-3">
                    <label className="text-xs uppercase tracking-wider text-white/40 flex items-center gap-2 px-1">
                      <User className="w-3 h-3" /> Select Staff (Optional)
                    </label>
                    <div className="flex gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setSelectedStaff("")}
                        className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-all ${
                          !selectedStaff
                            ? "border-white/20 bg-white/10"
                            : "border-white/10 hover:border-white/20 bg-white/[0.02]"
                        }`}
                      >
                        <User className="w-4 h-4 text-white/40" />
                        <span>Any available</span>
                      </button>
                      {staff.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSelectedStaff(s.id)}
                          className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-all ${
                            selectedStaff === s.id
                              ? "border-white/20 bg-white/10"
                              : "border-white/10 hover:border-white/20 bg-white/[0.02]"
                          }`}
                        >
                          <div
                            className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold"
                            style={{ backgroundColor: `${secondaryColor}20`, color: secondaryColor }}
                          >
                            {s.name.charAt(0).toUpperCase()}
                          </div>
                          <span>{s.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Date & Time */}
                <div className="space-y-3">
                  <label className="text-xs uppercase tracking-wider text-white/40 flex items-center gap-2 px-1">
                    <Calendar className="w-3 h-3" /> Date & Time
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <input
                        type="date"
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        required
                        min={new Date().toISOString().split("T")[0]}
                        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 transition-all"
                        style={{ focusRingColor: primaryColor }}
                      />
                    </div>
                    <div>
                      <input
                        type="time"
                        value={selectedTime}
                        onChange={(e) => setSelectedTime(e.target.value)}
                        required
                        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 transition-all"
                        style={{ focusRingColor: primaryColor }}
                      />
                    </div>
                  </div>
                </div>

                {/* Customer Info */}
                <div className="space-y-3">
                  <label className="text-xs uppercase tracking-wider text-white/40 px-1">Your Details</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      required
                      placeholder="First Name"
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
                      required
                      placeholder="Email"
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

                {/* Summary */}
                {selectedServiceData && (
                  <div
                    className="rounded-2xl p-5 space-y-3 border"
                    style={{ backgroundColor: `${primaryColor}08`, borderColor: `${primaryColor}20` }}
                  >
                    <div className="text-xs uppercase tracking-wider text-white/40">Booking Summary</div>
                    <div className="flex justify-between text-sm">
                      <span className="text-white/60">Service</span>
                      <span className="text-white font-medium">{selectedServiceData.name}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-white/60">Duration</span>
                      <span className="text-white">{serviceDuration} min</span>
                    </div>
                    {selectedDate && selectedTime && (
                      <div className="flex justify-between text-sm">
                        <span className="text-white/60">When</span>
                        <span className="text-white">
                          {new Date(`${selectedDate}T${selectedTime}`).toLocaleDateString("en-US", {
                            weekday: "short", month: "short", day: "numeric",
                          })}{" "}
                          at {selectedTime}
                        </span>
                      </div>
                    )}
                    <div className="border-t border-white/10 pt-3 flex justify-between text-base font-semibold">
                      <span style={{ color: primaryColor }}>Total</span>
                      <span style={{ color: primaryColor }}>
                        {selectedServiceData.currency ?? "TTD"} {selectedServiceData.price.toLocaleString()}
                      </span>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || !selectedService || !selectedDate || !selectedTime}
                  className="w-full py-3.5 rounded-xl text-white font-semibold text-sm transition-all hover:scale-[1.01] hover:shadow-lg disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
                  style={{ backgroundColor: primaryColor, boxShadow: `0 8px 32px ${primaryColor}30` }}
                >
                  {submitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> Booking...
                    </span>
                  ) : (
                    "Book Appointment"
                  )}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Empty state */}
        {services.length === 0 && !hasAnyCatalog && (
          <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-12 text-center space-y-4">
            <Sparkles className="w-10 h-10 text-white/20 mx-auto" />
            <h2 className="text-lg font-semibold text-white/60">Coming Soon</h2>
            <p className="text-sm text-white/30 max-w-sm mx-auto">
              This business is setting up their online store. Check back soon!
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-xs text-white/20 pt-4">
          Powered by <span style={{ color: primaryColor }} className="font-semibold">KeyFlowOS</span>
        </div>
      </div>
    </main>
  );
}
