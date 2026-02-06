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
  Edit3,
  Save,
  Globe,
  Sparkles,
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
  updateService,
  createService,
  deleteService,
} from "@/lib/client";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { useSearchParams } from "next/navigation";

type Tab = "schedule" | "staff" | "store";
type StatusFilter = "ALL" | "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED";

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  CONFIRMED: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  CANCELLED: "bg-red-500/20 text-red-300 border-red-500/30",
  COMPLETED: "bg-blue-500/20 text-blue-300 border-blue-500/30",
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
  const [editingService, setEditingService] = useState<string | null>(null);
  const [editServiceData, setEditServiceData] = useState<{ name: string; duration: number; price: number; description: string }>({ name: "", duration: 30, price: 0, description: "" });
  const [showAddService, setShowAddService] = useState(false);
  const [newServiceData, setNewServiceData] = useState({ name: "", duration: 30, price: 0, description: "" });
  const [storePreview, setStorePreview] = useState(true);

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
      const [bookingsRes, servicesRes, staffRes, calendarRes, contactsRes, statsRes, bizRes] = await Promise.all([
        fetchBookings(businessId),
        fetchServices(businessId),
        fetchStaff(businessId),
        getCalendarStatus(businessId).catch(() => ({ data: null, error: null })),
        fetchContacts(businessId, { take: 200 }),
        fetchBookingStats(businessId).catch(() => ({ data: null, error: null })),
        getBusinessById(businessId).catch(() => ({ data: null, error: null })),
      ]);
      setBookings(bookingsRes.data ?? []);
      setServices(servicesRes.data ?? []);
      setStaff(staffRes.data ?? []);
      setContacts(contactsRes.data ?? []);
      setStats(statsRes.data ?? null);
      setCalendarConnected((calendarRes.data as any)?.connected ?? false);
      setCalendarEmail((calendarRes.data as any)?.email ?? null);
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
    return storeSlug ? `${domain}/book/${storeSlug}` : "";
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

  async function handleSaveServiceEdit() {
    if (!businessId || !editingService) return;
    const res = await updateService(editingService, {
      name: editServiceData.name,
      duration: editServiceData.duration,
      price: editServiceData.price,
      description: editServiceData.description || undefined,
    }, businessId);
    if (res.error) {
      setBanner({ text: `Failed to update service: ${res.error}`, type: "error" });
    } else {
      setBanner({ text: "Service updated!", type: "success" });
      await loadData();
    }
    setEditingService(null);
  }

  async function handleAddNewService() {
    if (!businessId || !newServiceData.name.trim()) return;
    const res = await createService({
      businessId,
      name: newServiceData.name,
      durationMins: newServiceData.duration,
      price: newServiceData.price,
    });
    if (res.error) {
      setBanner({ text: `Failed to add service: ${res.error}`, type: "error" });
    } else {
      setBanner({ text: "Service added!", type: "success" });
      setNewServiceData({ name: "", duration: 30, price: 0, description: "" });
      setShowAddService(false);
      await loadData();
    }
  }

  async function handleDeleteServiceFromStore(serviceId: string) {
    if (!businessId) return;
    const res = await deleteService(serviceId, businessId);
    if (res.error) {
      setBanner({ text: `Failed to delete service: ${res.error}`, type: "error" });
    } else {
      setBanner({ text: "Service removed from store.", type: "info" });
      await loadData();
    }
  }

  function startEditService(service: Service) {
    setEditingService(service.id);
    setEditServiceData({
      name: service.name,
      duration: service.durationMins ?? service.duration ?? 30,
      price: service.price,
      description: service.description ?? "",
    });
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-border/60 bg-slate-950/60 hover:bg-slate-900/80 transition-colors"
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
            { label: "Total", value: stats.totalBookings, icon: Users, color: "from-blue-500/20 to-indigo-600/10" },
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
                  className="pl-9 pr-3 py-2 rounded-xl border border-border/60 bg-slate-950/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 w-56"
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
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Globe className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Public Booking Link</h3>
                <p className="text-xs text-muted-foreground">Customers visit this link to browse your services and book online</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center rounded-xl border border-border/60 bg-slate-950/80 overflow-hidden">
                <span className="px-3 py-2.5 text-xs text-muted-foreground bg-slate-900/50 border-r border-border/60 whitespace-nowrap">
                  {typeof window !== "undefined" ? window.location.origin : ""}/book/
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
            {storeSlug ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={copyPublicLink}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-900/60 border border-border/60 hover:border-primary/40 transition-colors"
                >
                  {linkCopied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {linkCopied ? "Copied!" : "Copy Link"}
                </button>
                <a
                  href={getPublicBookingUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-900/60 border border-border/60 hover:border-primary/40 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Open Store
                </a>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Enter a custom URL above and click Save to generate your public booking link.</p>
            )}
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
              <div className="bg-gradient-to-br from-slate-950 via-black to-slate-950 p-8">
                <div className="mx-auto max-w-2xl space-y-6">
                  <div className="text-center space-y-2">
                    {businessData?.logoUrl && (
                      <img src={businessData.logoUrl} alt="Logo" className="h-14 w-14 rounded-2xl mx-auto object-cover border border-border/40" />
                    )}
                    <h2 className="text-2xl font-semibold text-white">{businessData?.name ?? "Your Business"}</h2>
                    {businessData?.tagline && <p className="text-sm text-slate-400">{businessData.tagline}</p>}
                    {!businessData?.tagline && <p className="text-sm text-slate-400">Book your appointment online</p>}
                    {(businessData?.address || businessData?.phone || businessData?.email) && (
                      <div className="flex items-center justify-center gap-4 text-xs text-slate-500 flex-wrap mt-1">
                        {businessData?.address && (
                          <span className="flex items-center gap-1"><Globe className="w-3 h-3" /> {businessData.address}</span>
                        )}
                        {businessData?.phone && (
                          <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {businessData.phone}</span>
                        )}
                        {businessData?.email && (
                          <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> {businessData.email}</span>
                        )}
                      </div>
                    )}
                  </div>

                  {services.length === 0 ? (
                    <div className="rounded-2xl border border-border/40 bg-slate-900/50 p-8 text-center space-y-3">
                      <Sparkles className="w-8 h-8 text-muted-foreground/40 mx-auto" />
                      <p className="text-sm text-slate-400">No services listed yet. Switch to Edit mode to add your first service.</p>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-border/40 bg-slate-900/60 p-4 space-y-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500 flex items-center gap-2 px-1">
                        <Briefcase className="w-3 h-3" /> Select a Service
                      </div>
                      <div className="space-y-2">
                        {services.map((service, i) => (
                          <div
                            key={service.id}
                            className={`rounded-xl border p-4 transition-colors cursor-pointer ${i === 0 ? "border-primary/40 bg-primary/5" : "border-border/40 hover:border-primary/30"}`}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="font-medium text-white">{service.name}</div>
                                {service.description && <div className="text-xs text-slate-400 mt-0.5">{service.description}</div>}
                              </div>
                              <div className="text-right">
                                <div className="text-sm font-semibold text-primary">TTD {service.price.toLocaleString()}</div>
                                <div className="text-xs text-slate-500 flex items-center gap-1 justify-end">
                                  <Clock className="w-3 h-3" /> {service.durationMins ?? service.duration ?? 30} min
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {staff.length > 0 && (
                    <div className="rounded-2xl border border-border/40 bg-slate-900/60 p-4 space-y-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500 flex items-center gap-2 px-1">
                        <User className="w-3 h-3" /> Select Staff (Optional)
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        {staff.map((s) => (
                          <div key={s.id} className="flex items-center gap-2 rounded-xl border border-border/40 bg-slate-900/50 px-3 py-2">
                            <div className="h-7 w-7 rounded-full bg-secondary/10 border border-secondary/20 flex items-center justify-center text-xs font-bold text-secondary">
                              {s.name.charAt(0).toUpperCase()}
                            </div>
                            <span className="text-sm text-white">{s.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="rounded-2xl border border-border/40 bg-slate-900/60 p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-slate-500 mb-1.5 block">Date</label>
                        <div className="rounded-xl border border-border/40 bg-slate-950/80 px-3 py-2.5 text-sm text-slate-400">Select date...</div>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500 mb-1.5 block">Time</label>
                        <div className="rounded-xl border border-border/40 bg-slate-950/80 px-3 py-2.5 text-sm text-slate-400">Select time...</div>
                      </div>
                    </div>
                    <div className="border-t border-border/30 pt-3 space-y-3">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Your Details</div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl border border-border/40 bg-slate-950/80 px-3 py-2.5 text-sm text-slate-400">First Name</div>
                        <div className="rounded-xl border border-border/40 bg-slate-950/80 px-3 py-2.5 text-sm text-slate-400">Last Name</div>
                        <div className="rounded-xl border border-border/40 bg-slate-950/80 px-3 py-2.5 text-sm text-slate-400">Email</div>
                        <div className="rounded-xl border border-border/40 bg-slate-950/80 px-3 py-2.5 text-sm text-slate-400">Phone</div>
                      </div>
                    </div>
                  </div>

                  <button className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm opacity-80 cursor-default">
                    Book Appointment
                  </button>

                  <div className="text-center text-xs text-slate-600">
                    Powered by <span className="text-primary font-semibold">KeyFlowOS</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* ─── EDIT MODE ─── */
            <div className="space-y-4">
              {/* Service List - Editable */}
              {services.length === 0 ? (
                <div className="rounded-2xl border border-border/60 bg-slate-950/50 p-8 text-center space-y-3">
                  <Briefcase className="w-8 h-8 text-muted-foreground/40 mx-auto" />
                  <p className="text-sm text-muted-foreground">No services yet. Add services that customers can book.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {services.map((service) => (
                    <div key={service.id} className="rounded-2xl border border-border/60 bg-slate-950/60 p-4 group hover:border-primary/30 transition-colors">
                      {editingService === service.id ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs text-muted-foreground mb-1 block">Service Name</label>
                              <input
                                type="text"
                                value={editServiceData.name}
                                onChange={(e) => setEditServiceData((d) => ({ ...d, name: e.target.value }))}
                                className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground mb-1 block">Description</label>
                              <input
                                type="text"
                                value={editServiceData.description}
                                onChange={(e) => setEditServiceData((d) => ({ ...d, description: e.target.value }))}
                                placeholder="Brief description..."
                                className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground mb-1 block">Duration (minutes)</label>
                              <input
                                type="number"
                                value={editServiceData.duration}
                                onChange={(e) => setEditServiceData((d) => ({ ...d, duration: parseInt(e.target.value) || 0 }))}
                                className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground mb-1 block">Price (TTD)</label>
                              <input
                                type="number"
                                step="0.01"
                                value={editServiceData.price}
                                onChange={(e) => setEditServiceData((d) => ({ ...d, price: parseFloat(e.target.value) || 0 }))}
                                className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                              />
                            </div>
                          </div>
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => setEditingService(null)}
                              className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground border border-border/60 transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleSaveServiceEdit}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors flex items-center gap-1"
                            >
                              <Save className="w-3 h-3" /> Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary/10 to-secondary/10 border border-primary/20 flex items-center justify-center">
                              <Briefcase className="w-4 h-4 text-primary" />
                            </div>
                            <div>
                              <div className="text-sm font-semibold">{service.name}</div>
                              {service.description && <div className="text-xs text-muted-foreground mt-0.5">{service.description}</div>}
                              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {service.durationMins ?? service.duration ?? 30} min</span>
                                <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> TTD {service.price.toLocaleString()}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => startEditService(service)}
                              className="p-2 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-primary/10 text-primary transition-all"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteServiceFromStore(service.id)}
                              className="p-2 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-red-400 transition-all"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Add New Service */}
              {showAddService ? (
                <div className="rounded-2xl border border-primary/30 bg-slate-950/80 backdrop-blur p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <Plus className="w-4 h-4 text-primary" /> Add New Service
                    </h3>
                    <button onClick={() => setShowAddService(false)} className="p-1 rounded-lg hover:bg-muted/50">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Service Name</label>
                      <input
                        type="text"
                        value={newServiceData.name}
                        onChange={(e) => setNewServiceData((d) => ({ ...d, name: e.target.value }))}
                        placeholder="e.g. Haircut, Consultation"
                        className="w-full rounded-xl border border-border/60 bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Description</label>
                      <input
                        type="text"
                        value={newServiceData.description}
                        onChange={(e) => setNewServiceData((d) => ({ ...d, description: e.target.value }))}
                        placeholder="Brief description..."
                        className="w-full rounded-xl border border-border/60 bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Duration (minutes)</label>
                      <input
                        type="number"
                        value={newServiceData.duration}
                        onChange={(e) => setNewServiceData((d) => ({ ...d, duration: parseInt(e.target.value) || 0 }))}
                        className="w-full rounded-xl border border-border/60 bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Price (TTD)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={newServiceData.price}
                        onChange={(e) => setNewServiceData((d) => ({ ...d, price: parseFloat(e.target.value) || 0 }))}
                        className="w-full rounded-xl border border-border/60 bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowAddService(false)} className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground border border-border/60">Cancel</button>
                    <Button onClick={handleAddNewService} className="kf-btn-primary gap-2 text-xs">
                      <Plus className="w-3.5 h-3.5" /> Add Service
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddService(true)}
                  className="w-full rounded-2xl border border-dashed border-border/60 hover:border-primary/40 bg-slate-950/30 p-4 text-sm text-muted-foreground hover:text-primary transition-all flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Add a Service
                </button>
              )}
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
                      className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium bg-blue-500/10 border border-blue-500/30 text-blue-300 hover:bg-blue-500/20 transition-colors"
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
