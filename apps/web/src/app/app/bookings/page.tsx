"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar,
  User,
  Plus,
  Link2,
  Unlink,
  AlertCircle,
  X,
  Lightbulb,
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
import type { Tab, StatusFilter } from "./components/bookings-types";
import { contactName } from "./components/bookings-types";
import { PageHeader } from "@/components/ui/page-header";
import { ContactPickerDrawer } from "@/components/contacts";
import { Send } from "lucide-react";
import BookingsDashboard from "./components/bookings-dashboard";
import WeekCalendar from "./components/week-calendar";
import BookingList from "./components/booking-list";
import BookingForm from "./components/booking-form";
import BookingDetailDrawer from "./components/booking-detail-drawer";
import StaffPanel from "./components/staff-panel";

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
  const [staffForm, setStaffForm] = useState({ name: "", email: "" });
  const [formError, setFormError] = useState<string | null>(null);

  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarEmail, setCalendarEmail] = useState<string | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [banner, setBanner] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);

  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [showGuide, setShowGuide] = useState(false);

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
      const [bookingsRes, servicesRes, staffRes, calendarRes, contactsRes, statsRes] = await Promise.all([
        fetchBookings(businessId),
        fetchServices(businessId),
        fetchStaff(businessId),
        getCalendarStatus(businessId).catch(() => ({ data: null, error: null })),
        fetchContacts(businessId, { take: 200 }),
        fetchBookingStats(businessId).catch(() => ({ data: null, error: null })),
      ]);
      setBookings(bookingsRes.data ?? []);
      setServices(servicesRes.data ?? []);
      setStaff(staffRes.data ?? []);
      setContacts(contactsRes.data ?? []);
      setStats(statsRes.data ?? null);
      setCalendarConnected((calendarRes.data as any)?.connected ?? false);
      setCalendarEmail((calendarRes.data as any)?.email ?? null);
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

  async function handleCreateBooking(data: { date: string; time: string; serviceId: string; staffId: string; contactId: string }) {
    if (!businessId) return;
    setFormError(null);
    if (!data.date || !data.time) { setFormError("Date and time are required"); return; }
    if (!data.serviceId) { setFormError("Please select a service"); return; }
    if (!data.staffId) { setFormError("Please select a staff member"); return; }
    const selectedService = services.find((s) => s.id === data.serviceId);
    const startTime = new Date(`${data.date}T${data.time}`).toISOString();
    const endTime = selectedService
      ? new Date(new Date(`${data.date}T${data.time}`).getTime() + (selectedService.durationMins ?? 60) * 60 * 1000).toISOString()
      : startTime;
    const { data: result, error } = await createBooking({
      businessId,
      serviceId: data.serviceId,
      staffId: data.staffId,
      contactId: data.contactId || undefined,
      startTime,
      endTime,
    });
    if (error) { setFormError(error); return; }
    if (result) {
      await loadData();
      setShowCreateBooking(false);
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

  const tabs: { key: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: "schedule", label: "Schedule", icon: <Calendar className="w-4 h-4" /> },
    { key: "staff", label: "Staff", icon: <User className="w-4 h-4" />, count: staff.length },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Calendar}
        title="Bookings"
        subtitle="Schedule, manage services & staff"
        titleExtra={
          <div className="relative">
            <button
              onClick={() => setShowGuide(!showGuide)}
              className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 ${
                showGuide
                  ? "bg-amber-400 text-white shadow-md shadow-amber-400/40 scale-110"
                  : "bg-amber-400/15 text-amber-400 hover:bg-amber-400/25 hover:shadow-sm hover:shadow-amber-400/20 hover:scale-105"
              }`}
              aria-label="Getting started guide"
              title="Getting started guide"
            >
              <Lightbulb className="w-3.5 h-3.5" />
            </button>
            <AnimatePresence>
              {showGuide && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowGuide(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="fixed left-2 right-2 top-20 sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-2 z-50 kf-card border border-border shadow-2xl rounded-2xl sm:w-[90vw] sm:max-w-[700px] max-h-[80vh] overflow-y-auto p-5"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div className="p-1.5 rounded-lg bg-amber-400/10">
                        <Lightbulb className="w-4 h-4 text-amber-400" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold">Getting Started</h4>
                        <p className="text-[11px] text-muted-foreground">Your quick-start guide</p>
                      </div>
                      <button onClick={() => setShowGuide(false)} className="ml-auto p-1 rounded hover:bg-muted/50">
                        <X className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {[
                        { step: "1", title: "Add Services", desc: "Define your bookable services with duration, pricing, and descriptions." },
                        { step: "2", title: "Add Staff", desc: "Add team members who can be assigned to bookings." },
                        { step: "3", title: "Share Booking Link", desc: "Your public storefront lets customers browse services and book online." },
                        { step: "4", title: "Manage Schedule", desc: "View bookings on the calendar, confirm or cancel appointments." },
                        { step: "5", title: "Connect Google Calendar", desc: "Sync bookings to your Google Calendar for real-time availability." },
                        { step: "6", title: "Track Stats", desc: "Monitor booking volume, revenue, and completion rates from the dashboard." },
                      ].map((item) => (
                        <div key={item.step} className="flex gap-2.5 p-2 rounded-xl hover:bg-muted/30 transition-colors">
                          <div className="w-5 h-5 rounded-full bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] flex items-center justify-center flex-shrink-0 text-[10px] font-bold mt-0.5">
                            {item.step}
                          </div>
                          <div>
                            <p className="text-xs font-medium">{item.title}</p>
                            <p className="text-[10px] text-muted-foreground leading-relaxed">{item.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        }
        actionLabel="New Booking"
        onAction={() => setShowCreateBooking(true)}
        rightSlot={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowContactPicker(true)}
              className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-xl bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Send className="w-4 h-4" />
              Broadcast
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
          </div>
        }
      />


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

      <BookingsDashboard stats={stats} bookings={bookings} />

      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative px-5 py-2.5 text-sm font-medium rounded-xl transition-all flex items-center gap-2 whitespace-nowrap ${
              tab === t.key
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            {tab === t.key && (
              <motion.div
                layoutId="bookings-tab-pill"
                className="absolute inset-0 bg-gradient-to-r from-[hsl(var(--kf-accent1)/0.15)] to-[hsl(var(--kf-accent2)/0.15)] border border-[hsl(var(--kf-accent1)/0.3)] rounded-xl shadow-lg shadow-[hsl(var(--kf-accent1)/0.1)]"
                transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              {t.icon}
              {t.label}
              {t.count !== undefined && <span className="text-xs opacity-60">({t.count})</span>}
            </span>
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
          <WeekCalendar
            bookings={bookings}
            weekOffset={weekOffset}
            setWeekOffset={setWeekOffset}
            onSelectBooking={setSelectedBooking}
          />

          <BookingList
            filteredBookings={filteredBookings}
            loading={loading}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            showFilters={showFilters}
            setShowFilters={setShowFilters}
            onSelectBooking={setSelectedBooking}
            selectedBooking={selectedBooking}
            onCreateNew={() => setShowCreateBooking(true)}
            onRefresh={() => void loadData()}
          />

          <AnimatePresence>
            {showCreateBooking && (
              <BookingForm
                services={services}
                staff={staff}
                contacts={contacts}
                onSubmit={handleCreateBooking}
                onCancel={() => setShowCreateBooking(false)}
                formError={formError}
              />
            )}
          </AnimatePresence>
        </motion.div>
      )}

      {tab === "staff" && (
        <StaffPanel
          staff={staff}
          staffForm={staffForm}
          setStaffForm={setStaffForm}
          onCreateStaff={handleCreateStaff}
          onDeleteStaff={handleDeleteStaff}
          loading={loading}
          formError={formError}
        />
      )}

      <AnimatePresence>
        {selectedBooking && (
          <BookingDetailDrawer
            selectedBooking={selectedBooking}
            onClose={() => setSelectedBooking(null)}
            onStatusChange={handleStatusChange}
            onSyncCalendar={handleSyncBooking}
            calendarConnected={calendarConnected}
          />
        )}
      </AnimatePresence>
      <ContactPickerDrawer isOpen={showContactPicker} onClose={() => setShowContactPicker(false)} />
    </div>
  );
}
