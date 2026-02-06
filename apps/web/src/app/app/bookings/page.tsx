"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { z } from "zod";
import { Button, Input } from "@keyflow/ui";
import {
  Calendar,
  Clock,
  User,
  Briefcase,
  Plus,
  Trash2,
  Link2,
  Unlink,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Copy,
  CalendarDays,
  Users,
  DollarSign,
  AlertCircle,
  X,
  Search,
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
  Booking,
  Service,
  StaffMember,
  Contact,
  BookingStats,
  createBooking,
  fetchBookings,
  fetchServices,
  fetchStaff,
  fetchContacts,
  createStaff,
  deleteStaff,
  getCalendarAuthUrl,
  getCalendarStatus,
  disconnectCalendar,
  syncBookingToCalendar,
  updateBookingStatus,
  fetchBookingStats,
  getBusinessById,
  updateBusiness,
  createService,
  deleteService,
  fetchProducts,
  Product,
} from "@/lib/client";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { useSearchParams } from "next/navigation";

type Tab = "schedule" | "staff" | "store";
type StatusFilter = "ALL" | "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED";

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  CONFIRMED: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  CANCELLED: "bg-red-500/20 text-red-300 border-red-500/30",
  COMPLETED: "bg-secondary/20 text-secondary border-secondary/30",
};

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("en-TT", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-TT", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatFullDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-TT", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function contactName(booking: Booking): string {
  const c = booking.contact;
  if (!c) return "Walk-in";
  const parts = [c.firstName, c.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "Unknown";
}

function getWeekDays(baseDate: Date): Date[] {
  const start = new Date(baseDate);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function BookingsPage() {
  const searchParams = useSearchParams();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("schedule");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [stats, setStats] = useState<BookingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreateBooking, setShowCreateBooking] = useState(false);
  const [bookingDate, setBookingDate] = useState("");
  const [bookingTime, setBookingTime] = useState("");
  const [bookingServiceId, setBookingServiceId] = useState("");
  const [bookingStaffId, setBookingStaffId] = useState("");
  const [bookingContactId, setBookingContactId] = useState("");
  const [contactSearch, setContactSearch] = useState("");

  const [staffForm, setStaffForm] = useState({ name: "", email: "" });
  const [formError, setFormError] = useState<string | null>(null);

  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarEmail, setCalendarEmail] = useState<string | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [banner, setBanner] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);

  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [weekOffset, setWeekOffset] = useState(0);
  const [linkCopied, setLinkCopied] = useState(false);

  const [businessData, setBusinessData] = useState<{ name?: string; slug?: string | null; logoUrl?: string | null; tagline?: string | null; description?: string | null; address?: string | null; phone?: string | null; email?: string | null; website?: string | null; primaryColor?: string | null; secondaryColor?: string | null } | null>(null);
  const [storeSlug, setStoreSlug] = useState("");
  const [slugSaving, setSlugSaving] = useState(false);
  const [storePreview, setStorePreview] = useState(true);
  const [commerceProducts, setCommerceProducts] = useState<Product[]>([]);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [processingItems, setProcessingItems] = useState<Set<string>>(new Set());

  const baseDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + weekOffset * 7);
    return d;
  }, [weekOffset]);

  const weekDays = useMemo(() => getWeekDays(baseDate), [baseDate]);
  const today = useMemo(() => new Date(), []);

  useEffect(() => {
    const calendarParam = searchParams?.get("calendar");
    if (calendarParam === "success") {
      setBanner({ text: "Google Calendar connected successfully!", type: "success" });
      window.history.replaceState({}, "", "/app/bookings");
    } else if (calendarParam === "error") {
      setBanner({ text: "Failed to connect Google Calendar. Please try again.", type: "error" });
      window.history.replaceState({}, "", "/app/bookings");
    }
  }, [searchParams]);

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
      const [bookingsRes, servicesRes, staffRes, calendarRes, contactsRes, statsRes, bizRes, productsRes] = await Promise.all([
        fetchBookings(businessId),
        fetchServices(businessId),
        fetchStaff(businessId),
        getCalendarStatus(businessId).catch(() => ({ data: null, error: null })),
        fetchContacts(businessId, { take: 200 }),
        fetchBookingStats(businessId).catch(() => ({ data: null, error: null })),
        getBusinessById(businessId).catch(() => ({ data: null, error: null })),
        fetchProducts(businessId).catch(() => ({ data: null, error: null })),
      ]);
      setBookings(bookingsRes.data ?? []);
      setServices(servicesRes.data ?? []);
      setStaff(staffRes.data ?? []);
      setContacts(contactsRes.data ?? []);
      setStats(statsRes.data ?? null);
      setCalendarConnected((calendarRes.data as any)?.connected ?? false);
      setCalendarEmail((calendarRes.data as any)?.email ?? null);
      setCommerceProducts((productsRes as any)?.data ?? []);
      if (bizRes.data) {
        setBusinessData(bizRes.data);
        setStoreSlug(bizRes.data.slug ?? "");
      }
      if (bookingsRes.error || servicesRes.error || staffRes.error) {
        setError("Some data could not be loaded");
      }
    } catch (e) {
      console.error("Failed to load bookings data:", e);
      setError("Failed to load data. Please try refreshing.");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { void loadData(); }, [loadData]);

  const selectedService = useMemo(() => services.find((s) => s.id === bookingServiceId), [services, bookingServiceId]);

  const computedEndTime = useMemo(() => {
    if (!bookingDate || !bookingTime || !selectedService) return "";
    const start = new Date(`${bookingDate}T${bookingTime}`);
    const end = new Date(start.getTime() + (selectedService.durationMins ?? 60) * 60 * 1000);
    return end.toISOString();
  }, [bookingDate, bookingTime, selectedService]);

  const filteredBookings = useMemo(() => {
    let filtered = bookings;
    if (statusFilter !== "ALL") {
      filtered = filtered.filter((b) => b.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((b) => {
        const name = contactName(b).toLowerCase();
        const serviceName = b.service?.name?.toLowerCase() ?? "";
        const staffName = b.staff?.name?.toLowerCase() ?? "";
        return name.includes(q) || serviceName.includes(q) || staffName.includes(q);
      });
    }
    return filtered;
  }, [bookings, statusFilter, searchQuery]);

  const bookingsByDay = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const day of weekDays) {
      const key = day.toISOString().split("T")[0];
      map.set(key, []);
    }
    for (const b of bookings) {
      const key = new Date(b.startTime).toISOString().split("T")[0];
      if (map.has(key)) {
        map.get(key)!.push(b);
      }
    }
    return map;
  }, [bookings, weekDays]);

  const filteredContacts = useMemo(() => {
    if (!contactSearch.trim()) return contacts.slice(0, 10);
    const q = contactSearch.toLowerCase();
    return contacts.filter((c) => {
      const name = `${c.firstName ?? ""} ${c.lastName ?? ""}`.toLowerCase();
      return name.includes(q) || (c.email?.toLowerCase().includes(q) ?? false);
    }).slice(0, 10);
  }, [contacts, contactSearch]);

  async function handleConnectCalendar() {
    if (!businessId) return;
    setCalendarLoading(true);
    const res = await getCalendarAuthUrl(businessId);
    if (res.data?.url) window.location.href = res.data.url;
    else setBanner({ text: "Failed to start calendar connection.", type: "error" });
    setCalendarLoading(false);
  }

  async function handleDisconnectCalendar() {
    if (!businessId) return;
    setCalendarLoading(true);
    await disconnectCalendar(businessId);
    setCalendarConnected(false);
    setCalendarEmail(null);
    setBanner({ text: "Google Calendar disconnected.", type: "info" });
    setCalendarLoading(false);
  }

  async function handleCreateBooking() {
    if (!businessId) return;
    setFormError(null);
    if (!bookingDate || !bookingTime) { setFormError("Date and time are required"); return; }
    if (!bookingServiceId) { setFormError("Please select a service"); return; }
    if (!bookingStaffId) { setFormError("Please select a staff member"); return; }
    const startTime = new Date(`${bookingDate}T${bookingTime}`).toISOString();
    const { data, error } = await createBooking({
      businessId,
      serviceId: bookingServiceId,
      staffId: bookingStaffId,
      contactId: bookingContactId || undefined,
      startTime,
      endTime: computedEndTime,
    });
    if (error) { setFormError(error); return; }
    if (data) {
      await loadData();
      setShowCreateBooking(false);
      setBookingDate(""); setBookingTime(""); setBookingServiceId(""); setBookingStaffId(""); setBookingContactId("");
      setBanner({ text: "Booking created successfully!", type: "success" });
    }
  }

  async function handleStatusChange(bookingId: string, newStatus: string) {
    if (!businessId) return;
    const res = await updateBookingStatus(bookingId, newStatus, businessId);
    if (res.data) {
      await loadData();
      if (selectedBooking?.id === bookingId) {
        setSelectedBooking(res.data);
      }
      setBanner({ text: `Booking ${newStatus.toLowerCase()}.`, type: "success" });
    }
  }

  async function handleSyncBooking(bookingId: string) {
    if (!businessId) return;
    const res = await syncBookingToCalendar(bookingId, businessId);
    if (res.data?.success) setBanner({ text: "Booking synced to Google Calendar!", type: "success" });
    else setBanner({ text: "Failed to sync booking.", type: "error" });
  }

  async function handleCreateStaff() {
    setFormError(null);
    if (!staffForm.name.trim()) { setFormError("Name is required"); return; }
    const { data, error } = await createStaff({ name: staffForm.name, email: staffForm.email || undefined });
    if (error) setFormError(error);
    if (data) {
      setStaff((prev) => [...prev, data]);
      setStaffForm({ name: "", email: "" });
      setBanner({ text: "Staff member added!", type: "success" });
    }
  }

  async function handleDeleteStaff(staffId: string) {
    const { error } = await deleteStaff(staffId);
    if (!error) setStaff((prev) => prev.filter((s) => s.id !== staffId));
  }

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-primary/20 to-secondary/20 border border-primary/30 flex items-center justify-center text-primary">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Bookings</h1>
            <p className="text-sm text-muted-foreground">Schedule, manage services & staff</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={copyPublicLink}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-border/60 bg-background hover:bg-muted/50 transition-colors"
          >
            {linkCopied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {linkCopied ? "Copied!" : "Public Booking Link"}
          </button>

          {calendarConnected ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs text-emerald-400">{calendarEmail}</span>
              </div>
              <button
                onClick={handleDisconnectCalendar}
                disabled={calendarLoading}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs border border-border/60 hover:border-red-500/40 hover:text-red-400 transition-colors"
              >
                <Unlink className="w-3 h-3" /> Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={handleConnectCalendar}
              disabled={calendarLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-gradient-to-r from-primary/20 to-secondary/20 border border-primary/30 text-primary hover:from-primary/30 hover:to-secondary/30 transition-all"
            >
              <Link2 className="w-3.5 h-3.5" /> Connect Google Calendar
            </button>
          )}
        </div>
      </div>

      {/* Banner */}
      {banner && (
        <div className={`rounded-xl border px-4 py-2.5 text-sm flex items-center justify-between ${
          banner.type === "success" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" :
          banner.type === "error" ? "border-red-500/30 bg-red-500/10 text-red-300" :
          "border-primary/30 bg-primary/10 text-primary"
        }`}>
          <span>{banner.text}</span>
          <button onClick={() => setBanner(null)} className="opacity-60 hover:opacity-100 ml-2"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Today", value: stats.todayCount, icon: CalendarDays, color: "from-primary/20 to-orange-600/10" },
            { label: "This Week", value: stats.weekCount, icon: Calendar, color: "from-secondary/20 to-teal-600/10" },
            { label: "Pending", value: stats.pendingCount, icon: AlertCircle, color: "from-amber-500/20 to-yellow-600/10" },
            { label: "Total", value: stats.totalBookings, icon: Users, color: "from-secondary/20 to-teal-600/10" },
          ].map((stat) => (
            <div key={stat.label} className={`rounded-2xl border border-border/60 bg-gradient-to-br ${stat.color} p-4`}>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-medium">{stat.label}</span>
                <stat.icon className="w-4 h-4 text-muted-foreground/60" />
              </div>
              <div className="text-2xl font-bold mt-1">{stat.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        {([
          { key: "schedule" as Tab, label: "Schedule", icon: Calendar },
          { key: "staff" as Tab, label: "Staff", icon: User },
          { key: "store" as Tab, label: "Store", icon: Store },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-5 py-2.5 text-sm font-medium rounded-xl transition-all flex items-center gap-2 ${
              tab === t.key
                ? "bg-gradient-to-r from-primary/20 to-secondary/20 text-primary border border-primary/30 shadow-lg shadow-primary/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent"
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            {t.key === "staff" && <span className="text-xs opacity-60">({staff.length})</span>}
            {t.key === "store" && <span className="text-xs opacity-60">({services.length})</span>}
          </button>
        ))}
      </div>

      {formError && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-200 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {formError}
        </div>
      )}

      {/* ─── SCHEDULE TAB ─── */}
      {tab === "schedule" && (
        <div className="space-y-4">
          {/* Week Calendar */}
          <div className="rounded-2xl border border-border/60 bg-slate-950/60 backdrop-blur p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-primary" /> Week View
              </h3>
              <div className="flex items-center gap-2">
                <button onClick={() => setWeekOffset((w) => w - 1)} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button onClick={() => setWeekOffset(0)} className="px-3 py-1 rounded-lg text-xs font-medium hover:bg-muted/50 transition-colors">
                  Today
                </button>
                <button onClick={() => setWeekOffset((w) => w + 1)} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {weekDays.map((day) => {
                const key = day.toISOString().split("T")[0];
                const dayBookings = bookingsByDay.get(key) ?? [];
                const isToday = isSameDay(day, today);
                return (
                  <div
                    key={key}
                    className={`rounded-xl border p-2 min-h-[100px] transition-colors ${
                      isToday
                        ? "border-primary/40 bg-primary/5"
                        : "border-border/40 hover:border-border/60"
                    }`}
                  >
                    <div className={`text-xs font-medium mb-1 ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                      {day.toLocaleDateString("en-TT", { weekday: "short" })}
                      <span className={`ml-1 ${isToday ? "bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full" : ""}`}>
                        {day.getDate()}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {dayBookings.slice(0, 3).map((b) => (
                        <button
                          key={b.id}
                          onClick={() => setSelectedBooking(b)}
                          className={`w-full text-left rounded-lg px-1.5 py-1 text-[10px] leading-tight truncate border transition-colors hover:opacity-80 ${STATUS_COLORS[b.status] ?? "bg-slate-500/20 text-slate-300 border-slate-500/30"}`}
                        >
                          <div className="font-medium truncate">{formatTime(b.startTime)}</div>
                          <div className="truncate opacity-80">{b.service?.name ?? "Service"}</div>
                        </button>
                      ))}
                      {dayBookings.length > 3 && (
                        <div className="text-[10px] text-muted-foreground text-center">+{dayBookings.length - 3} more</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search bookings..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-3 py-2 rounded-xl border border-border/60 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 w-56"
                />
              </div>
              <div className="flex gap-1">
                {(["ALL", "PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"] as StatusFilter[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      statusFilter === s
                        ? "bg-primary/20 text-primary border border-primary/30"
                        : "text-muted-foreground hover:text-foreground border border-transparent"
                    }`}
                  >
                    {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>
            <Button onClick={() => setShowCreateBooking(true)} className="kf-btn-primary gap-2">
              <Plus className="w-4 h-4" /> New Booking
            </Button>
          </div>

          {/* Create Booking Modal */}
          {showCreateBooking && (
            <div className="rounded-2xl border border-primary/30 bg-slate-950/80 backdrop-blur p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Plus className="w-4 h-4 text-primary" /> Create New Booking
                </h3>
                <button onClick={() => setShowCreateBooking(false)} className="p-1 rounded-lg hover:bg-muted/50">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Date</label>
                  <input
                    type="date"
                    value={bookingDate}
                    onChange={(e) => setBookingDate(e.target.value)}
                    className="w-full rounded-xl border border-border/60 bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Time</label>
                  <input
                    type="time"
                    value={bookingTime}
                    onChange={(e) => setBookingTime(e.target.value)}
                    className="w-full rounded-xl border border-border/60 bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Service</label>
                  <select
                    value={bookingServiceId}
                    onChange={(e) => setBookingServiceId(e.target.value)}
                    className="w-full rounded-xl border border-border/60 bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    <option value="">Select service...</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.durationMins} min - {s.currency} {s.price})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Staff</label>
                  <select
                    value={bookingStaffId}
                    onChange={(e) => setBookingStaffId(e.target.value)}
                    className="w-full rounded-xl border border-border/60 bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    <option value="">Select staff...</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Contact (optional)</label>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search contacts..."
                      value={contactSearch}
                      onChange={(e) => { setContactSearch(e.target.value); setBookingContactId(""); }}
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-border/60 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                  {contactSearch.trim() && (
                    <div className="mt-1 rounded-xl border border-border/60 bg-slate-950/90 max-h-40 overflow-y-auto">
                      {filteredContacts.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => { setBookingContactId(c.id); setContactSearch(`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim()); }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors flex items-center gap-2 ${
                            bookingContactId === c.id ? "bg-primary/10 text-primary" : ""
                          }`}
                        >
                          <User className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{c.firstName} {c.lastName}</span>
                          {c.email && <span className="text-xs text-muted-foreground ml-auto">{c.email}</span>}
                        </button>
                      ))}
                      {filteredContacts.length === 0 && (
                        <div className="px-3 py-2 text-sm text-muted-foreground">No contacts found</div>
                      )}
                    </div>
                  )}
                  {bookingContactId && !contactSearch.trim() && (
                    <div className="mt-1 text-xs text-emerald-400">Contact selected</div>
                  )}
                </div>
              </div>
              {selectedService && computedEndTime && (
                <div className="flex items-center gap-3 text-xs text-muted-foreground bg-slate-900/50 rounded-xl p-3">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Duration: {selectedService.durationMins} min</span>
                  <span>|</span>
                  <span>Ends at: {formatTime(computedEndTime)}</span>
                  <span>|</span>
                  <DollarSign className="w-3.5 h-3.5" />
                  <span>{selectedService.currency} {selectedService.price}</span>
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setShowCreateBooking(false)}>Cancel</Button>
                <Button onClick={handleCreateBooking} className="kf-btn-primary">Create Booking</Button>
              </div>
            </div>
          )}

          {/* Bookings List */}
          <div className="space-y-2">
            {loading && bookings.length === 0 ? (
              <div className="rounded-2xl border border-border/60 bg-slate-950/50 p-6 text-center text-muted-foreground">
                Loading bookings...
              </div>
            ) : filteredBookings.length === 0 ? (
              <div className="rounded-2xl border border-border/60 bg-slate-950/50 p-6 text-center space-y-2">
                <Calendar className="w-8 h-8 text-muted-foreground/40 mx-auto" />
                <p className="text-sm text-muted-foreground">
                  {searchQuery || statusFilter !== "ALL" ? "No bookings match your filters." : "No bookings yet. Create your first booking to get started."}
                </p>
              </div>
            ) : (
              filteredBookings.map((b) => (
                <button
                  key={b.id}
                  onClick={() => setSelectedBooking(b)}
                  className={`w-full text-left rounded-2xl border bg-slate-950/60 p-4 transition-all hover:border-primary/40 hover:bg-slate-900/60 ${
                    selectedBooking?.id === b.id ? "border-primary/50 ring-1 ring-primary/20" : "border-border/60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary flex-shrink-0">
                        <Calendar className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{contactName(b)}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${STATUS_COLORS[b.status] ?? "bg-slate-500/20 text-slate-300"}`}>
                            {b.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                          <span className="flex items-center gap-1">
                            <CalendarDays className="w-3 h-3" /> {formatDate(b.startTime)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {formatTime(b.startTime)} – {formatTime(b.endTime)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {b.service && (
                        <div className="text-right hidden sm:block">
                          <div className="text-xs font-medium">{b.service.name}</div>
                          <div className="text-[10px] text-muted-foreground">{b.service.duration} min</div>
                        </div>
                      )}
                      {b.staff && (
                        <div className="h-7 w-7 rounded-full bg-secondary/10 border border-secondary/20 flex items-center justify-center text-xs font-bold text-secondary">
                          {b.staff.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* ─── STAFF TAB ─── */}
      {tab === "staff" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border/60 bg-slate-950/60 backdrop-blur p-5 space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Plus className="w-4 h-4 text-primary" /> Add Staff Member
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label="Full Name"
                placeholder="Jane Doe"
                value={staffForm.name}
                onChange={(e) => setStaffForm((f) => ({ ...f, name: e.target.value }))}
              />
              <Input
                label="Email (optional)"
                placeholder="jane@example.com"
                value={staffForm.email}
                onChange={(e) => setStaffForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <Button onClick={handleCreateStaff} className="kf-btn-primary gap-2">
              <Plus className="w-4 h-4" /> Add Staff
            </Button>
          </div>

          {staff.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-slate-950/50 p-6 text-center space-y-2">
              <User className="w-8 h-8 text-muted-foreground/40 mx-auto" />
              <p className="text-sm text-muted-foreground">
                {loading ? "Loading staff..." : "No staff members yet. Add team members to assign them to bookings."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {staff.map((s) => (
                <div key={s.id} className="rounded-2xl border border-border/60 bg-slate-950/60 p-4 group hover:border-secondary/30 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-gradient-to-br from-secondary/20 to-teal-600/10 border border-secondary/20 flex items-center justify-center text-lg font-bold text-secondary">
                        {s.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold">{s.name}</h4>
                        {s.email && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Mail className="w-3 h-3" /> {s.email}
                          </p>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteStaff(s.id)}
                      className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-400 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── STORE TAB ─── */}
      {tab === "store" && (
        <div className="space-y-6">
          {/* Public Link Section */}
          <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/5 to-secondary/5 backdrop-blur p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Globe className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Public Booking Link</h3>
                  <p className="text-xs text-muted-foreground">Share this link so customers can browse and book your services</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={copyPublicLink}
                  disabled={!getPublicBookingUrl()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40"
                >
                  {linkCopied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {linkCopied ? "Copied!" : "Copy Link"}
                </button>
                <a
                  href={getPublicBookingUrl() || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-background border border-border/60 hover:border-primary/40 transition-colors ${!getPublicBookingUrl() ? "opacity-40 pointer-events-none" : ""}`}
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Open Store
                </a>
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
              {storePreview ? "Customer View Preview" : "Edit Services"}
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

                  {/* Commerce Carousels */}
                  {(() => {
                    const serviceItems = commerceProducts.filter((p) => p.category === "SERVICE");
                    const productItems = commerceProducts.filter((p) => p.category === "PRODUCT");
                    const packageItems = commerceProducts.filter((p) => p.category === "PACKAGE");
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
                                    <span className="text-sm font-bold text-secondary">${p.price}</span>
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

                  {/* Booking Services */}
                  {services.length === 0 && commerceProducts.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center space-y-3">
                      <Sparkles className="w-8 h-8 text-white/20 mx-auto" />
                      <p className="text-sm text-white/40">No services listed yet. Switch to Edit mode to add your first service.</p>
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
                      {services.filter((s) => commerceProducts.some((p) => p.name === s.name)).length > 0 && (
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
                        {services.filter((s) => commerceProducts.some((p) => p.name === s.name)).length} of {commerceProducts.length} item{commerceProducts.length !== 1 ? "s" : ""} displayed on store
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

      {/* ─── BOOKING DETAIL PANEL ─── */}
      {selectedBooking && (
        <div className="fixed inset-0 z-50 flex items-start justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSelectedBooking(null)} />
          <div className="relative w-full max-w-md h-full bg-slate-950 border-l border-border/60 overflow-y-auto p-6 space-y-5 animate-in slide-in-from-right">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Booking Details</h3>
              <button onClick={() => setSelectedBooking(null)} className="p-1.5 rounded-lg hover:bg-muted/50">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium border ${STATUS_COLORS[selectedBooking.status] ?? "bg-slate-500/20 text-slate-300"}`}>
              {selectedBooking.status}
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-border/60 bg-slate-900/50 p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <CalendarDays className="w-4 h-4 text-primary" />
                  <span className="font-medium">{formatFullDate(selectedBooking.startTime)}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="w-4 h-4 text-primary" />
                  <span>{formatTime(selectedBooking.startTime)} – {formatTime(selectedBooking.endTime)}</span>
                </div>
              </div>

              {selectedBooking.contact && (
                <div className="rounded-xl border border-border/60 bg-slate-900/50 p-4 space-y-2">
                  <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Client</div>
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-sm font-bold text-primary">
                      {(selectedBooking.contact.firstName?.charAt(0) ?? "?").toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium">{contactName(selectedBooking)}</div>
                      {selectedBooking.contact.email && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <Mail className="w-3 h-3" /> {selectedBooking.contact.email}
                        </div>
                      )}
                      {selectedBooking.contact.phone && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <Phone className="w-3 h-3" /> {selectedBooking.contact.phone}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {selectedBooking.service && (
                <div className="rounded-xl border border-border/60 bg-slate-900/50 p-4 space-y-2">
                  <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Service</div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Briefcase className="w-4 h-4 text-secondary" />
                      <span className="text-sm font-medium">{selectedBooking.service.name}</span>
                    </div>
                    <span className="text-sm text-muted-foreground">{selectedBooking.service.duration} min</span>
                  </div>
                  <div className="text-sm font-semibold text-primary">
                    TTD {selectedBooking.service.price.toLocaleString()}
                  </div>
                </div>
              )}

              {selectedBooking.staff && (
                <div className="rounded-xl border border-border/60 bg-slate-900/50 p-4 space-y-2">
                  <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Staff</div>
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-full bg-secondary/10 border border-secondary/20 flex items-center justify-center text-xs font-bold text-secondary">
                      {selectedBooking.staff.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-sm font-medium">{selectedBooking.staff.name}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2 pt-2 border-t border-border/40">
              <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">Actions</div>
              <div className="grid grid-cols-2 gap-2">
                {selectedBooking.status === "PENDING" && (
                  <>
                    <button
                      onClick={() => handleStatusChange(selectedBooking.id, "CONFIRMED")}
                      className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 transition-colors"
                    >
                      <CheckCircle2 className="w-4 h-4" /> Confirm
                    </button>
                    <button
                      onClick={() => handleStatusChange(selectedBooking.id, "CANCELLED")}
                      className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20 transition-colors"
                    >
                      <XCircle className="w-4 h-4" /> Cancel
                    </button>
                  </>
                )}
                {selectedBooking.status === "CONFIRMED" && (
                  <>
                    <button
                      onClick={() => handleStatusChange(selectedBooking.id, "COMPLETED")}
                      className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium bg-secondary/10 border border-secondary/30 text-secondary hover:bg-secondary/20 transition-colors"
                    >
                      <CheckCircle2 className="w-4 h-4" /> Complete
                    </button>
                    <button
                      onClick={() => handleStatusChange(selectedBooking.id, "CANCELLED")}
                      className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20 transition-colors"
                    >
                      <XCircle className="w-4 h-4" /> Cancel
                    </button>
                  </>
                )}
                {(selectedBooking.status === "CANCELLED" || selectedBooking.status === "COMPLETED") && (
                  <div className="col-span-2 text-center text-xs text-muted-foreground py-2">
                    This booking is {selectedBooking.status.toLowerCase()}
                  </div>
                )}
              </div>
              {calendarConnected && selectedBooking.status !== "CANCELLED" && (
                <button
                  onClick={() => handleSyncBooking(selectedBooking.id)}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium bg-slate-900/50 border border-border/60 hover:border-primary/30 transition-colors"
                >
                  <Link2 className="w-4 h-4" /> Sync to Google Calendar
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
