"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar,
  Wrench,
  BarChart3,
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
  getCalendarAuthUrl,
  getCalendarStatus,
  disconnectCalendar,
  syncBookingToCalendar,
  updateBookingStatus,
  fetchBookingStats,
} from "@/lib/client";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { useSearchParams, useRouter } from "next/navigation";
import type { Tab, StatusFilter } from "./components/bookings-types";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { useSwipeTabs } from "@/hooks/use-swipe-tabs";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { AiCommandHub, AiHubTrigger } from "@/components/ai/ai-command-hub";
import { useBookingsAiHub } from "./hooks/use-bookings-ai-hub";
import { renderBookingsToolResult } from "./components/bookings-tool-results";
import { BookingsSkeleton } from "./components/bookings-skeleton";
import { moduleEvents } from "@/lib/module-events";
import CalendarView from "./calendar/calendar-view";
import ServicesTab from "./services/services-tab";
import BookingsInsightsTab from "./insights/bookings-insights-tab";
import BookingForm from "./components/booking-form";
import BookingDetailDrawer from "./components/booking-detail-drawer";
import BookingsAiSearchBar from "./components/bookings-ai-search-bar";

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "calendar", label: "Calendar", icon: Calendar },
  { key: "services", label: "Services", icon: Wrench },
  { key: "insights", label: "Insights", icon: BarChart3 },
];

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 60 : -60, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -60 : 60, opacity: 0 }),
};

export default function BookingsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("calendar");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [stats, setStats] = useState<BookingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreateBooking, setShowCreateBooking] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarEmail, setCalendarEmail] = useState<string | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [banner, setBanner] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);

  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  const directionRef = useRef<number>(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const tabKeys = useMemo(() => TABS.map((t) => t.key), []);

  const ai = useBookingsAiHub();

  const handleTabChange = useCallback((key: string) => {
    const newIndex = tabKeys.indexOf(key as Tab);
    const oldIndex = tabKeys.indexOf(tab);
    directionRef.current = newIndex > oldIndex ? 1 : -1;
    setTab(key as Tab);
    moduleEvents.emit("module:tab_changed", "bookings", { tab: key });
  }, [tab, tabKeys]);

  const { swipeHandlers } = useSwipeTabs({
    tabs: tabKeys,
    activeTab: tab,
    onTabChange: handleTabChange,
  });

  useKeyboardShortcuts([
    {
      groupName: "Bookings",
      shortcuts: [
        { key: "1", action: () => handleTabChange("calendar"), description: "Calendar tab" },
        { key: "2", action: () => handleTabChange("services"), description: "Services tab" },
        { key: "3", action: () => handleTabChange("insights"), description: "Insights tab" },
        { key: "n", action: () => setShowCreateBooking(true), description: "New booking" },
        { key: "r", action: () => void loadData(), description: "Refresh data" },
        { key: "f", action: () => searchInputRef.current?.focus(), description: "Focus search" },
        { key: "a", shift: true, action: () => ai.togglePanel(), description: "AI Hub" },
        { key: "Escape", action: () => {
          if (showCreateBooking) setShowCreateBooking(false);
          else if (selectedBooking) setSelectedBooking(null);
          else if (ai.panelOpen) ai.setOpen(false);
        }, description: "Close panel" },
      ],
    },
  ]);

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
      setContacts(contactsRes.data?.contacts ?? []);
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

  useEffect(() => {
    if (businessId) {
      ai.updateContext({ businessId, activeView: tab });
    }
  }, [businessId, tab, ai]);

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
      moduleEvents.emit("booking:created", "bookings", { booking: result });
    }
  }

  async function handleStatusChange(bookingId: string, newStatus: string) {
    if (!businessId) return;
    const res = await updateBookingStatus(bookingId, newStatus, businessId);
    if (res.data) {
      await loadData();
      if (selectedBooking?.id === bookingId) setSelectedBooking(res.data);
      setBanner({ text: `Booking ${newStatus.toLowerCase()}.`, type: "success" });
      if (newStatus === "CONFIRMED") {
        moduleEvents.emit("booking:confirmed", "bookings", { booking: res.data });
      } else if (newStatus === "CANCELLED") {
        moduleEvents.emit("booking:cancelled", "bookings", { booking: res.data });
      }
    }
  }

  async function handleSyncBooking(bookingId: string) {
    if (!businessId) return;
    const res = await syncBookingToCalendar(bookingId, businessId);
    if (res.data?.success) setBanner({ text: "Booking synced to Google Calendar!", type: "success" });
    else setBanner({ text: "Failed to sync booking.", type: "error" });
  }

  const handleViewContact = useCallback((contactId: string) => {
    moduleEvents.emit("booking:view_contact", "bookings", { contactId });
    router.push(`/app/crm?contact=${contactId}`);
  }, [router]);

  const handleCreateInvoice = useCallback((booking: Booking) => {
    moduleEvents.emit("booking:create_invoice", "bookings", {
      contactId: booking.contact?.id,
      serviceId: booking.serviceId,
      serviceName: booking.service?.name,
      servicePrice: booking.service?.price,
    });
    router.push("/app/commerce?tab=billing&action=new-invoice");
  }, [router]);

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

  if (loading && bookings.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={Calendar}
          title="Bookings"
          subtitle="Schedule, manage services & staff"
        />
        <BookingsSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6" {...swipeHandlers}>
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
            {calendarConnected ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs text-emerald-400 hidden sm:inline">{calendarEmail}</span>
                </div>
                <button
                  onClick={handleDisconnectCalendar}
                  disabled={calendarLoading}
                  className="kf-btn-secondary inline-flex items-center gap-1 text-xs"
                >
                  <Unlink className="w-3 h-3" /> <span className="hidden sm:inline">Disconnect</span>
                </button>
              </div>
            ) : (
              <button
                onClick={handleConnectCalendar}
                disabled={calendarLoading}
                className="kf-btn-secondary inline-flex items-center gap-1.5 text-xs"
              >
                <Link2 className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Connect Google Calendar</span>
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

      <BookingsAiSearchBar businessId={businessId} />

      <TabNav
        tabs={TABS}
        activeTab={tab}
        onTabChange={handleTabChange}
        layoutId="bookings-tab"
      />

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

      <AnimatePresence mode="wait" custom={directionRef.current}>
        <motion.div
          key={tab}
          custom={directionRef.current}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ type: "spring", bounce: 0.15, duration: 0.35 }}
        >
          {tab === "calendar" && (
            <CalendarView
              bookings={bookings}
              onSelectBooking={setSelectedBooking}
            />
          )}
          {tab === "services" && (
            <ServicesTab
              businessId={businessId}
              services={services}
              staff={staff}
              setServices={setServices}
              setStaff={setStaff}
              loading={loading}
            />
          )}
          {tab === "insights" && (
            <BookingsInsightsTab
              bookings={bookings}
              services={services}
              stats={stats}
            />
          )}
        </motion.div>
      </AnimatePresence>

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


      <AiCommandHub
        ai={ai}
        moduleName="Bookings"
        toolResultRenderer={renderBookingsToolResult}
        onAction={(actionKey) => {
          if (actionKey.startsWith("tool:")) {
            ai.executeTool(actionKey.replace("tool:", ""));
          } else if (actionKey.startsWith("filter_status:")) {
            handleTabChange("calendar");
          } else if (actionKey.startsWith("switch_tab:")) {
            handleTabChange(actionKey.replace("switch_tab:", ""));
          }
        }}
      />
      <AiHubTrigger ai={ai} moduleName="Bookings" />
    </div>
  );
}
