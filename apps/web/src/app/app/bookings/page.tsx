"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  ChevronDown,
  CalendarDays,
  Users,
  DollarSign,
  AlertCircle,
  X,
  Search,
  Phone,
  Mail,
  RefreshCw,
  Filter,
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
} from "@/lib/client";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { useSearchParams } from "next/navigation";

type Tab = "schedule" | "staff";
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
  const [showFilters, setShowFilters] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [businessData, setBusinessData] = useState<{ name?: string; slug?: string | null } | null>(null);

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

  if (!businessId && !loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3">
          <p className="text-lg font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>
            We could not find your workspace. Please sign in again.
          </p>
          <p className="text-muted-foreground">Try logging in again to create your workspace.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row md:items-center md:justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Bookings</h1>
          <p className="text-muted-foreground mt-1">Schedule, manage services & staff</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {calendarConnected ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs text-emerald-400">{calendarEmail}</span>
              </div>
              <button
                onClick={handleDisconnectCalendar}
                disabled={calendarLoading}
                className="kf-btn-secondary inline-flex items-center gap-1 text-xs"
              >
                <Unlink className="w-3 h-3" /> Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={handleConnectCalendar}
              disabled={calendarLoading}
              className="kf-btn-secondary inline-flex items-center gap-1.5 text-xs"
            >
              <Link2 className="w-3.5 h-3.5" /> Connect Google Calendar
            </button>
          )}
          <button
            onClick={() => setShowCreateBooking(true)}
            className="kf-btn-primary inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            New Booking
          </button>
        </div>
      </motion.div>

      <AnimatePresence>
        {banner && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`kf-card rounded-xl px-4 py-2.5 text-sm flex items-center justify-between ${
              banner.type === "success" ? "border-emerald-500/30 text-emerald-300" :
              banner.type === "error" ? "border-red-500/30 text-red-300" :
              "text-foreground"
            }`}
            style={{ borderColor: banner.type === "success" ? undefined : banner.type === "error" ? undefined : "hsl(var(--kf-accent1) / 0.3)" }}
          >
            <span>{banner.text}</span>
            <button onClick={() => setBanner(null)} className="opacity-60 hover:opacity-100 ml-2"><X className="w-4 h-4" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {stats && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-3"
        >
          {[
            { label: "Today", value: stats.todayCount, icon: CalendarDays, color: "from-[hsl(var(--kf-accent1)/0.15)] to-[hsl(var(--kf-accent1)/0.05)]" },
            { label: "This Week", value: stats.weekCount, icon: Calendar, color: "from-[hsl(var(--kf-accent2)/0.15)] to-[hsl(var(--kf-accent2)/0.05)]" },
            { label: "Pending", value: stats.pendingCount, icon: AlertCircle, color: "from-amber-500/15 to-amber-600/5" },
            { label: "Total", value: stats.totalBookings, icon: Users, color: "from-[hsl(var(--kf-accent2)/0.15)] to-[hsl(var(--kf-accent2)/0.05)]" },
          ].map((stat) => (
            <div key={stat.label} className={`kf-card rounded-2xl bg-gradient-to-br ${stat.color} p-4`}>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-medium">{stat.label}</span>
                <stat.icon className="w-4 h-4 text-muted-foreground/60" />
              </div>
              <div className="text-2xl font-bold mt-1">{stat.value}</div>
            </div>
          ))}
        </motion.div>
      )}

      <div className="flex gap-2">
        {([
          { key: "schedule" as Tab, label: "Schedule", icon: Calendar },
          { key: "staff" as Tab, label: "Staff", icon: User },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm rounded-lg transition-all flex items-center gap-2 ${
              tab === t.key ? "kf-btn-primary" : "kf-btn-secondary"
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            {t.key === "staff" && <span className="text-xs opacity-60">({staff.length})</span>}
          </button>
        ))}
      </div>

      <AnimatePresence>
        {formError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="kf-card rounded-xl border-amber-500/40 px-4 py-2 text-sm text-amber-200 flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {formError}
          </motion.div>
        )}
      </AnimatePresence>

      {tab === "schedule" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-4"
        >
          <div className="kf-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <CalendarDays className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} /> Week View
              </h3>
              <div className="flex items-center gap-2">
                <button onClick={() => setWeekOffset((w) => w - 1)} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button onClick={() => setWeekOffset(0)} className="kf-btn-secondary px-3 py-1 text-xs">
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
                    className={`rounded-xl border p-2.5 min-h-[100px] transition-colors ${
                      isToday
                        ? "border-[hsl(var(--kf-accent1)/0.4)] bg-[hsl(var(--kf-accent1)/0.08)]"
                        : "border-border/60 bg-muted/10 hover:border-border/80"
                    }`}
                  >
                    <div className={`text-sm font-semibold mb-1.5 ${isToday ? "" : "text-foreground/80"}`} style={isToday ? { color: "hsl(var(--kf-accent1))" } : undefined}>
                      {day.toLocaleDateString("en-TT", { weekday: "short" })}
                      <span className={`ml-1.5 ${isToday ? "px-1.5 py-0.5 rounded-full text-white" : "text-foreground/60"}`} style={isToday ? { background: "hsl(var(--kf-accent1))" } : undefined}>
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

          <div className="kf-card p-4 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search bookings..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="kf-input w-full pl-10"
                />
              </div>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`kf-btn-secondary inline-flex items-center gap-2 ${showFilters ? "ring-2 ring-[hsl(var(--kf-accent1))]" : ""}`}
              >
                <Filter className="w-4 h-4" />
                Filters
                <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? "rotate-180" : ""}`} />
              </button>
              <button
                onClick={() => void loadData()}
                disabled={loading}
                className="kf-btn-secondary inline-flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>

            <AnimatePresence>
              {showFilters && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex flex-wrap gap-2"
                >
                  {(["ALL", "PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"] as StatusFilter[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(s)}
                      className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                        statusFilter === s ? "kf-btn-primary" : "kf-btn-secondary"
                      }`}
                    >
                      {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
                    </button>
                  ))}
                  {statusFilter !== "ALL" && (
                    <button
                      onClick={() => {
                        setStatusFilter("ALL");
                        setSearchQuery("");
                      }}
                      className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      <X className="w-3 h-3" />
                      Clear
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <AnimatePresence>
            {showCreateBooking && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <div className="kf-card-accent p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <Plus className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} /> Create New Booking
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
                        className="kf-input w-full"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Time</label>
                      <input
                        type="time"
                        value={bookingTime}
                        onChange={(e) => setBookingTime(e.target.value)}
                        className="kf-input w-full"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Service</label>
                      <select
                        value={bookingServiceId}
                        onChange={(e) => setBookingServiceId(e.target.value)}
                        className="kf-input w-full"
                      >
                        <option value="">Select service...</option>
                        {services.map((s) => (
                          <option key={s.id} value={s.id}>{s.name} — {s.durationMins}min • {s.currency} {s.price}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Staff</label>
                      <select
                        value={bookingStaffId}
                        onChange={(e) => setBookingStaffId(e.target.value)}
                        className="kf-input w-full"
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
                        <input
                          type="text"
                          placeholder="Search contacts..."
                          value={contactSearch}
                          onChange={(e) => {
                            setContactSearch(e.target.value);
                            if (!e.target.value.trim()) setBookingContactId("");
                          }}
                          className="kf-input w-full"
                        />
                        {contactSearch.trim() && (
                          <div className="absolute top-full left-0 right-0 mt-1 kf-card rounded-xl border border-border/60 max-h-48 overflow-y-auto z-10">
                            {filteredContacts.length > 0 ? (
                              filteredContacts.map((c) => (
                                <button
                                  key={c.id}
                                  onClick={() => {
                                    setBookingContactId(c.id);
                                    setContactSearch(`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim());
                                  }}
                                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors ${bookingContactId === c.id ? "bg-[hsl(var(--kf-accent1)/0.1)]" : ""}`}
                                >
                                  <div className="font-medium">{c.firstName} {c.lastName}</div>
                                  {c.email && <div className="text-xs text-muted-foreground">{c.email}</div>}
                                </button>
                              ))
                            ) : (
                              <div className="px-3 py-2 text-sm text-muted-foreground">No contacts found</div>
                            )}
                          </div>
                        )}
                        {bookingContactId && !contactSearch.trim() && (
                          <div className="mt-1 text-xs text-emerald-400">Contact selected</div>
                        )}
                      </div>
                    </div>
                  </div>
                  {selectedService && computedEndTime && (
                    <div className="flex items-center gap-3 text-xs text-muted-foreground kf-card rounded-xl p-3">
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
                    <button onClick={() => setShowCreateBooking(false)} className="kf-btn-secondary">Cancel</button>
                    <button onClick={handleCreateBooking} className="kf-btn-primary">Create Booking</button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="space-y-3">
            {loading && bookings.length === 0 ? (
              <div className="kf-card p-8 text-center">
                <RefreshCw className="w-8 h-8 animate-spin mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">Loading bookings...</p>
              </div>
            ) : filteredBookings.length === 0 ? (
              <div className="kf-card p-8 text-center">
                <Calendar className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-lg font-medium mb-1">No bookings yet</p>
                <p className="text-muted-foreground mb-4">
                  {searchQuery || statusFilter !== "ALL" ? "No bookings match your filters." : "Create your first booking to get started."}
                </p>
                {!searchQuery && statusFilter === "ALL" && (
                  <button
                    onClick={() => setShowCreateBooking(true)}
                    className="kf-btn-primary inline-flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    New Booking
                  </button>
                )}
              </div>
            ) : (
              filteredBookings.map((b, index) => (
                <motion.button
                  key={b.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                  onClick={() => setSelectedBooking(b)}
                  className={`w-full text-left kf-card rounded-2xl p-4 transition-all hover:ring-1 hover:ring-[hsl(var(--kf-accent1)/0.3)] ${
                    selectedBooking?.id === b.id ? "ring-1 ring-[hsl(var(--kf-accent1)/0.4)]" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "hsl(var(--kf-accent1) / 0.1)", borderColor: "hsl(var(--kf-accent1) / 0.2)", borderWidth: 1 }}>
                        <Calendar className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
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
                        <div className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "hsl(var(--kf-accent2) / 0.1)", borderColor: "hsl(var(--kf-accent2) / 0.2)", borderWidth: 1, color: "hsl(var(--kf-accent2))" }}>
                          {b.staff.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.button>
              ))
            )}
          </div>
        </motion.div>
      )}

      {tab === "staff" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-4"
        >
          <div className="kf-card-accent p-5 space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Plus className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} /> Add Staff Member
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Full Name</label>
                <input
                  placeholder="Jane Doe"
                  value={staffForm.name}
                  onChange={(e) => setStaffForm((f) => ({ ...f, name: e.target.value }))}
                  className="kf-input w-full"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Email (optional)</label>
                <input
                  placeholder="jane@example.com"
                  value={staffForm.email}
                  onChange={(e) => setStaffForm((f) => ({ ...f, email: e.target.value }))}
                  className="kf-input w-full"
                />
              </div>
            </div>
            <button onClick={handleCreateStaff} className="kf-btn-primary inline-flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Staff
            </button>
          </div>

          {staff.length === 0 ? (
            <div className="kf-card p-8 text-center">
              <User className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-lg font-medium mb-1">No staff members</p>
              <p className="text-muted-foreground">
                {loading ? "Loading staff..." : "Add team members to assign them to bookings."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {staff.map((s, index) => (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="kf-card p-4 group hover:ring-1 hover:ring-[hsl(var(--kf-accent2)/0.3)] transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full flex items-center justify-center text-lg font-bold" style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent2) / 0.15), hsl(var(--kf-accent2) / 0.05))", borderColor: "hsl(var(--kf-accent2) / 0.2)", borderWidth: 1, color: "hsl(var(--kf-accent2))" }}>
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
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>
      )}

      <AnimatePresence>
        {selectedBooking && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-start justify-end"
          >
            <div className="absolute inset-0 bg-black/50" onClick={() => setSelectedBooking(null)} />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25 }}
              className="relative w-full max-w-md h-full bg-background border-l border-border/60 overflow-y-auto p-6 space-y-5"
            >
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
                <div className="kf-card p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <CalendarDays className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                    <span className="font-medium">{formatFullDate(selectedBooking.startTime)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                    <span>{formatTime(selectedBooking.startTime)} – {formatTime(selectedBooking.endTime)}</span>
                  </div>
                </div>

                {selectedBooking.contact && (
                  <div className="kf-card p-4 space-y-2">
                    <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Client</div>
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: "hsl(var(--kf-accent1) / 0.1)", borderColor: "hsl(var(--kf-accent1) / 0.2)", borderWidth: 1, color: "hsl(var(--kf-accent1))" }}>
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
                  <div className="kf-card p-4 space-y-2">
                    <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Service</div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Briefcase className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
                        <span className="text-sm font-medium">{selectedBooking.service.name}</span>
                      </div>
                      <span className="text-sm text-muted-foreground">{selectedBooking.service.duration} min</span>
                    </div>
                    <div className="text-sm font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>
                      TTD {selectedBooking.service.price.toLocaleString()}
                    </div>
                  </div>
                )}

                {selectedBooking.staff && (
                  <div className="kf-card p-4 space-y-2">
                    <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Staff</div>
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "hsl(var(--kf-accent2) / 0.1)", borderColor: "hsl(var(--kf-accent2) / 0.2)", borderWidth: 1, color: "hsl(var(--kf-accent2))" }}>
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
                        className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium border transition-colors" style={{ background: "hsl(var(--kf-accent2) / 0.1)", borderColor: "hsl(var(--kf-accent2) / 0.3)", color: "hsl(var(--kf-accent2))" }}
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
                    className="w-full kf-btn-secondary flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm"
                  >
                    <Link2 className="w-4 h-4" /> Sync to Google Calendar
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
