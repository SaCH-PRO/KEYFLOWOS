"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar,
  Briefcase,
  BarChart3,
  X,
  Share2,
  Link2,
} from "lucide-react";
import {
  Booking,
  Service,
  StaffMember,
  Contact,
  BookingStats,
  ScheduleHealth,
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
  fetchScheduleHealth,
  getBusinessById,
} from "@/lib/client";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { useSearchParams, useRouter } from "next/navigation";
import type { Tab, StatusFilter } from "./components/bookings-types";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { useSwipeTabs } from "@/hooks/use-swipe-tabs";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useBookingsAiHub } from "./hooks/use-bookings-ai-hub";
import { BookingsSkeleton } from "./components/bookings-skeleton";
import { WorkspaceError } from "@/components/ui/workspace-error";
import { moduleEvents } from "@/lib/module-events";
import CalendarView from "./calendar/calendar-view";
import BookingDetailDrawer from "./components/booking-detail-drawer";
import BookingSideSheet from "./components/booking-side-sheet";
import TodayStrip from "./components/today-strip";
import ScheduleFilters from "./components/schedule-filters";
import CatalogCapacityTab from "./components/catalog-capacity-tab";
import PerformanceTab from "./components/performance-tab";
import { FeatureGuide } from "@/components/ui/feature-guide";
import { ShareLinkModal } from "@/components/ui/share-link-modal";
import { SetupModeBanner } from "@/components/ui/setup-mode-banner";
import { ModuleWalkthrough, WalkthroughTrigger } from "@/components/ui/module-walkthrough";
import { RichTooltip } from "@/components/ui/rich-tooltip";
import { BOOKINGS_WALKTHROUGH } from "@/lib/walkthrough-definitions";
import { usePlan } from "@/hooks/use-plan";
import { PlanLimitBanner } from "@/components/ui/upgrade-prompt";

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "schedule", label: "Schedule", icon: Calendar },
  { key: "catalog", label: "Setup: Catalog & Capacity", icon: Briefcase },
  { key: "performance", label: "Performance", icon: BarChart3 },
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
  const [tab, setTab] = useState<Tab>("schedule");
  const { checkLimit } = usePlan();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [stats, setStats] = useState<BookingStats | null>(null);
  const [scheduleHealth, setScheduleHealth] = useState<ScheduleHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreateBooking, setShowCreateBooking] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [prefillDate, setPrefillDate] = useState<string | undefined>(undefined);
  const [prefillTime, setPrefillTime] = useState<string | undefined>(undefined);
  const [bookingSaving, setBookingSaving] = useState(false);

  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarEmail, setCalendarEmail] = useState<string | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [banner, setBanner] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);

  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [businessSlug, setBusinessSlug] = useState<string | null>(null);

  const [staffFilter, setStaffFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");

  const [staffForm, setStaffForm] = useState({ name: "", email: "" });

  const directionRef = useRef<number>(0);
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
        { key: "1", action: () => handleTabChange("schedule"), description: "Schedule tab" },
        { key: "2", action: () => handleTabChange("catalog"), description: "Catalog tab" },
        { key: "3", action: () => handleTabChange("performance"), description: "Performance tab" },
        { key: "n", action: () => setShowCreateBooking(true), description: "New booking" },
        { key: "r", action: () => void loadData(), description: "Refresh data" },
        { key: "Escape", action: () => {
          if (showCreateBooking) setShowCreateBooking(false);
          else if (selectedBooking) setSelectedBooking(null);
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
    const actionParam = searchParams?.get("action");
    if (actionParam === "share" && businessSlug) {
      setShareModalOpen(true);
      window.history.replaceState({}, "", "/app/bookings");
    }
  }, [searchParams, businessSlug]);

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
      const [bookingsRes, servicesRes, staffRes, calendarRes, contactsRes, statsRes, healthRes] = await Promise.all([
        fetchBookings(businessId),
        fetchServices(businessId),
        fetchStaff(businessId),
        getCalendarStatus(businessId).catch(() => ({ data: null, error: null })),
        fetchContacts(businessId, { take: 200 }),
        fetchBookingStats(businessId).catch(() => ({ data: null, error: null })),
        fetchScheduleHealth(businessId).catch(() => ({ data: null, error: null })),
      ]);
      setBookings(bookingsRes.data ?? []);
      setServices(servicesRes.data ?? []);
      setStaff(staffRes.data ?? []);
      setContacts(contactsRes.data?.contacts ?? []);
      setStats(statsRes.data ?? null);
      setScheduleHealth(healthRes.data ?? null);
      setCalendarConnected(calendarRes.data?.connected ?? false);
      setCalendarEmail(calendarRes.data?.email ?? null);
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
      getBusinessById(businessId).then((res) => {
        if (res.data?.slug) setBusinessSlug(res.data.slug);
      }).catch(() => {});
    }
  }, [businessId, tab, ai]);

  const filteredBookings = useMemo(() => {
    let result = bookings;
    if (staffFilter) result = result.filter((b) => b.staff?.id === staffFilter);
    if (serviceFilter) result = result.filter((b) => b.serviceId === serviceFilter);
    if (statusFilter !== "ALL") result = result.filter((b) => b.status === statusFilter);
    return result;
  }, [bookings, staffFilter, serviceFilter, statusFilter]);

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
    if (!data.date || !data.time) { setFormError("Please pick a date and time"); return; }
    if (!data.serviceId) { setFormError("Please select a service"); return; }
    if (!data.staffId) { setFormError("Please select a staff member"); return; }
    setBookingSaving(true);
    try {
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
        setPrefillDate(undefined);
        setPrefillTime(undefined);
        setFormError(null);
        moduleEvents.emit("booking:created", "bookings", { booking: result });
        if (calendarConnected && result.id) {
          try {
            const syncRes = await syncBookingToCalendar(result.id, businessId);
            if (syncRes.data?.success) {
              setBanner({ text: "Booking created & synced to Google Calendar!", type: "success" });
            } else {
              setBanner({ text: "Booking created! (Calendar sync failed)", type: "info" });
            }
          } catch {
            setBanner({ text: "Booking created! (Calendar sync failed)", type: "info" });
          }
        } else {
          setBanner({ text: "Booking created successfully!", type: "success" });
        }
      }
    } finally {
      setBookingSaving(false);
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

  const handleCalendarCreate = useCallback((prefill: { date: string; time?: string }) => {
    setPrefillDate(prefill.date);
    setPrefillTime(prefill.time);
    setShowCreateBooking(true);
  }, []);

  const handleCreateInvoice = useCallback((booking: Booking) => {
    moduleEvents.emit("booking:create_invoice", "bookings", {
      contactId: booking.contact?.id,
      serviceId: booking.serviceId,
      serviceName: booking.service?.name,
      servicePrice: booking.service?.price,
    });
    router.push("/app/commerce?tab=invoices&action=new-invoice");
  }, [router]);

  const handleSmartAction = useCallback((booking: Booking, action: string) => {
    if (action === "INVOICE") {
      handleCreateInvoice(booking);
    } else if (action === "REBOOK") {
      setPrefillDate(undefined);
      setPrefillTime(undefined);
      setShowCreateBooking(true);
    } else {
      void handleStatusChange(booking.id, action);
    }
  }, [handleCreateInvoice]);

  async function handleCreateStaff() {
    if (!businessId || !staffForm.name.trim()) return;
    try {
      const { createStaff } = await import("@/lib/client");
      await createStaff({
        businessId,
        name: staffForm.name.trim(),
        email: staffForm.email.trim() || undefined,
      });
      setStaffForm({ name: "", email: "" });
      await loadData();
      setBanner({ text: "Staff member added.", type: "success" });
    } catch {
      setBanner({ text: "Failed to add staff member.", type: "error" });
    }
  }

  async function handleDeleteStaff(staffId: string) {
    if (!businessId) return;
    try {
      const { deleteStaff } = await import("@/lib/client");
      await deleteStaff(staffId, businessId);
      await loadData();
      setBanner({ text: "Staff member removed.", type: "info" });
    } catch {
      setBanner({ text: "Failed to remove staff member.", type: "error" });
    }
  }

  if (!businessId && !loading) {
    return <WorkspaceError />;
  }

  if (loading && bookings.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={Calendar}
          title="Bookings"
          subtitle="Schedule, catalog & performance"
        />
        <BookingsSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-5" {...swipeHandlers}>
      <PageHeader
        icon={Calendar}
        title="Bookings"
        subtitle="Schedule, catalog & performance"
        titleExtra={
          <div className="flex items-center gap-2">
            <FeatureGuide
              featureKey="bookings"
              title="Getting Started with Bookings"
              description="Set up your schedule, services, and staff to start accepting bookings."
              steps={[
                { title: "Add Services", description: "Define your bookable services with pricing and duration." },
                { title: "Add Staff", description: "Add team members who can be assigned to bookings." },
                { title: "Manage Schedule", description: "View bookings on the calendar, confirm or cancel appointments." },
                { title: "Connect Google Calendar", description: "Sync bookings to your Google Calendar from Catalog & Capacity." },
                { title: "Track Performance", description: "Monitor volume, revenue, and schedule health." },
              ]}
            />
            <WalkthroughTrigger moduleKey="bookings" />
          </div>
        }
        rightSlot={
          <div className="flex items-center gap-1">
            {businessSlug && services.length > 0 && (
              <button
                onClick={() => setShareModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-2.5 min-h-[44px] kf-radius-sm kf-text-micro font-medium transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: "hsl(var(--kf-accent2) / 0.1)",
                  border: "1px solid hsl(var(--kf-accent2) / 0.2)",
                  color: "hsl(var(--kf-accent2))",
                }}
                title="Share booking link"
                data-walkthrough="bookings-share"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Share</span>
              </button>
            )}
            <RichTooltip title="Calendar Sync" description={calendarConnected ? `Connected to ${calendarEmail ?? "Google Calendar"}. Bookings sync automatically.` : "Connect Google Calendar in Settings to sync your bookings."} side="bottom">
            <a
              href="/app/settings/connections"
              className="inline-flex items-center justify-center gap-1.5 min-w-[44px] min-h-[44px] rounded-lg text-[11px] transition-colors"
              style={{
                background: calendarConnected ? "hsl(var(--kf-success) / 0.08)" : "hsl(var(--muted) / 0.3)",
                color: calendarConnected ? "hsl(var(--kf-success))" : "hsl(var(--muted-foreground))",
                borderWidth: 1,
                borderColor: calendarConnected ? "hsl(var(--kf-success) / 0.2)" : "hsl(var(--border))",
              }}
              title={calendarConnected ? `Calendar connected: ${calendarEmail ?? ""}` : "Connect calendar in Settings"}
            >
              <Link2 className="w-4 h-4" />
              {calendarConnected && <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "hsl(var(--kf-success))" }} />}
            </a>
            </RichTooltip>
          </div>
        }
        actionLabel="New Booking"
        onAction={() => setShowCreateBooking(true)}
      />

      <AnimatePresence>
        {banner && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="kf-card rounded-xl px-4 py-2.5 text-sm flex items-center justify-between"
            style={{
              borderColor: banner.type === "success" ? "hsl(var(--kf-success) / 0.3)"
                : banner.type === "error" ? "hsl(var(--kf-error) / 0.3)"
                : "hsl(var(--kf-accent1) / 0.3)",
              color: banner.type === "success" ? "hsl(var(--kf-success))"
                : banner.type === "error" ? "hsl(var(--kf-error))"
                : undefined,
            }}
          >
            <span>{banner.text}</span>
            <button onClick={() => setBanner(null)} className="opacity-60 hover:opacity-100 ml-2"><X className="w-4 h-4" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {(() => {
        const bl = checkLimit("bookings");
        return <PlanLimitBanner resourceKey="bookings" label="bookings" currentUsage={bl.current} limit={bl.limit} isUnlimited={bl.isUnlimited} nearLimit={bl.nearLimit} atLimit={bl.atLimit} upgradeTo={bl.upgradeTo} />;
      })()}

      {tab === "catalog" && (
        <SetupModeBanner
          label="You're in Setup Mode — configuring services, staff, and availability"
          settingsHref="/app/settings/business"
        />
      )}

      <div data-walkthrough="bookings-calendar">
        <TabNav
          tabs={TABS}
          activeTab={tab}
          onTabChange={handleTabChange}
          layoutId="bookings-tab"
        />
      </div>

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
          {tab === "schedule" && (
            <div className="space-y-3">
              <TodayStrip
                bookings={bookings}
                stats={stats}
                scheduleHealth={scheduleHealth}
                staff={staff}
                onSelectBooking={setSelectedBooking}
                onConfirmBooking={(id) => void handleStatusChange(id, "CONFIRMED")}
                onViewStaffLoad={(staffId) => {
                  setStaffFilter(staffId);
                  setBanner({ text: `Showing bookings for ${staff.find((s) => s.id === staffId)?.name ?? "staff"}`, type: "info" });
                }}
              />
              <ScheduleFilters
                services={services}
                staff={staff}
                staffFilter={staffFilter}
                serviceFilter={serviceFilter}
                statusFilter={statusFilter}
                onStaffChange={setStaffFilter}
                onServiceChange={setServiceFilter}
                onStatusChange={setStatusFilter}
              />
              <CalendarView
                bookings={filteredBookings}
                onSelectBooking={setSelectedBooking}
                onCreateBooking={handleCalendarCreate}
                onSmartAction={handleSmartAction}
              />
            </div>
          )}
          {tab === "catalog" && (
            <div data-walkthrough="bookings-catalog">
            <CatalogCapacityTab
              services={services}
              staff={staff}
              bookings={bookings}
              staffForm={staffForm}
              setStaffForm={setStaffForm}
              onCreateStaff={handleCreateStaff}
              onDeleteStaff={handleDeleteStaff}
              calendarConnected={calendarConnected}
              calendarEmail={calendarEmail}
              calendarLoading={calendarLoading}
              onConnectCalendar={handleConnectCalendar}
              onDisconnectCalendar={handleDisconnectCalendar}
              loading={loading}
            />
            </div>
          )}
          {tab === "performance" && (
            <PerformanceTab
              bookings={bookings}
              services={services}
              stats={stats}
              scheduleHealth={scheduleHealth}
            />
          )}
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {showCreateBooking && (
          <BookingSideSheet
            open={showCreateBooking}
            services={services}
            staff={staff}
            contacts={contacts}
            onSubmit={handleCreateBooking}
            onClose={() => { setShowCreateBooking(false); setPrefillDate(undefined); setPrefillTime(undefined); setFormError(null); }}
            formError={formError}
            defaultDate={prefillDate}
            defaultTime={prefillTime}
            saving={bookingSaving}
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


      {businessSlug && (
        <ShareLinkModal
          open={shareModalOpen}
          onClose={() => setShareModalOpen(false)}
          url={typeof window !== "undefined" ? `${window.location.origin}/book/${businessSlug}` : `/book/${businessSlug}`}
          title="Share Booking Link"
          description="Clients can browse services and book directly from this link."
        />
      )}

      <ModuleWalkthrough moduleKey="bookings" steps={BOOKINGS_WALKTHROUGH} />
    </div>
  );
}
