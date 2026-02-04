"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { Button, Input, Table } from "@keyflow/ui";
import { Calendar, Clock, User, Briefcase, Plus, Trash2, Link2, Unlink } from "lucide-react";
import {
  Booking,
  Service,
  StaffMember,
  createBooking,
  fetchBookings,
  fetchServices,
  fetchStaff,
  createService,
  createStaff,
  deleteService,
  deleteStaff,
  getCalendarAuthUrl,
  getCalendarStatus,
  disconnectCalendar,
  syncBookingToCalendar,
} from "@/lib/client";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { useSearchParams } from "next/navigation";

const bookingSchema = z.object({
  start: z.string().min(1, "Start time required"),
  end: z.string().min(1, "End time required"),
  serviceId: z.string().min(1, "Service required"),
  staffId: z.string().min(1, "Staff required"),
});

type Tab = "bookings" | "services" | "staff";

export default function BookingsPage() {
  const searchParams = useSearchParams();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("bookings");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [bookingForm, setBookingForm] = useState({ start: "", end: "", serviceId: "", staffId: "" });
  const [serviceForm, setServiceForm] = useState({ name: "", durationMins: "60", price: "" });
  const [staffForm, setStaffForm] = useState({ name: "", email: "" });
  const [formError, setFormError] = useState<string | null>(null);

  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarEmail, setCalendarEmail] = useState<string | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarBanner, setCalendarBanner] = useState<string | null>(null);

  useEffect(() => {
    const calendarParam = searchParams?.get("calendar");
    if (calendarParam === "success") {
      setCalendarBanner("Google Calendar connected successfully!");
      window.history.replaceState({}, "", "/app/bookings");
    } else if (calendarParam === "error") {
      setCalendarBanner("Failed to connect Google Calendar. Please try again.");
      window.history.replaceState({}, "", "/app/bookings");
    }
  }, [searchParams]);

  useEffect(() => {
    const initWorkspace = async () => {
      const fresh = await refreshWorkspace();
      if (fresh) {
        setBusinessId(fresh);
        return;
      }
      const stored = getStoredBusinessId();
      if (stored) {
        setBusinessId(stored);
      }
    };
    void initWorkspace();
  }, []);

  useEffect(() => {
    if (!businessId) return;
    const load = async () => {
      setLoading(true);
      const [bookingsRes, servicesRes, staffRes, calendarRes] = await Promise.all([
        fetchBookings(businessId),
        fetchServices(businessId),
        fetchStaff(businessId),
        getCalendarStatus(businessId),
      ]);
      setBookings(bookingsRes.data ?? []);
      setServices(servicesRes.data ?? []);
      setStaff(staffRes.data ?? []);
      setCalendarConnected(calendarRes.data?.connected ?? false);
      setCalendarEmail(calendarRes.data?.email ?? null);
      if (bookingsRes.error || servicesRes.error || staffRes.error) {
        setError("Some data could not be loaded");
      }
      setLoading(false);
    };
    void load();
  }, [businessId]);

  async function handleConnectCalendar() {
    if (!businessId) return;
    setCalendarLoading(true);
    const res = await getCalendarAuthUrl(businessId);
    if (res.data?.url) {
      window.location.href = res.data.url;
    } else {
      setCalendarBanner("Failed to start calendar connection.");
    }
    setCalendarLoading(false);
  }

  async function handleDisconnectCalendar() {
    if (!businessId) return;
    setCalendarLoading(true);
    await disconnectCalendar(businessId);
    setCalendarConnected(false);
    setCalendarEmail(null);
    setCalendarBanner("Google Calendar disconnected.");
    setCalendarLoading(false);
  }

  async function handleSyncBooking(bookingId: string) {
    if (!businessId) return;
    const res = await syncBookingToCalendar(bookingId, businessId);
    if (res.data?.success) {
      setCalendarBanner("Booking synced to Google Calendar!");
    } else {
      setCalendarBanner("Failed to sync booking to calendar.");
    }
  }

  async function handleCreateBooking() {
    setFormError(null);
    const parsed = bookingSchema.safeParse(bookingForm);
    if (!parsed.success) {
      setFormError(parsed.error.errors[0]?.message ?? "Invalid input");
      return;
    }
    const { data, error } = await createBooking({
      serviceId: parsed.data.serviceId,
      staffId: parsed.data.staffId,
      startTime: parsed.data.start,
      endTime: parsed.data.end,
    });
    if (error) setFormError(error);
    if (data) {
      setBookings((prev) => [data, ...prev]);
      setBookingForm({ start: "", end: "", serviceId: "", staffId: "" });
    }
  }

  async function handleCreateService() {
    setFormError(null);
    if (!serviceForm.name.trim() || !serviceForm.price) {
      setFormError("Name and price are required");
      return;
    }
    const { data, error } = await createService({
      name: serviceForm.name,
      durationMins: parseInt(serviceForm.durationMins) || 60,
      price: parseFloat(serviceForm.price),
    });
    if (error) setFormError(error);
    if (data) {
      setServices((prev) => [...prev, data]);
      setServiceForm({ name: "", durationMins: "60", price: "" });
    }
  }

  async function handleDeleteService(serviceId: string) {
    const { error } = await deleteService(serviceId);
    if (!error) {
      setServices((prev) => prev.filter((s) => s.id !== serviceId));
    }
  }

  async function handleCreateStaff() {
    setFormError(null);
    if (!staffForm.name.trim()) {
      setFormError("Name is required");
      return;
    }
    const { data, error } = await createStaff({
      name: staffForm.name,
      email: staffForm.email || undefined,
    });
    if (error) setFormError(error);
    if (data) {
      setStaff((prev) => [...prev, data]);
      setStaffForm({ name: "", email: "" });
    }
  }

  async function handleDeleteStaff(staffId: string) {
    const { error } = await deleteStaff(staffId);
    if (!error) {
      setStaff((prev) => prev.filter((s) => s.id !== staffId));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-3xl bg-primary/20 border border-primary/40 flex items-center justify-center text-primary">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Bookings</h1>
            <p className="text-sm text-muted-foreground">Schedule intelligence, services, and staff assignment.</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {calendarConnected ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-xs text-emerald-400">Calendar: {calendarEmail}</span>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleDisconnectCalendar}
                disabled={calendarLoading}
                className="text-xs"
              >
                <Unlink className="w-3 h-3 mr-1" /> Disconnect
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              onClick={handleConnectCalendar}
              disabled={calendarLoading}
              className="text-xs"
            >
              <Link2 className="w-3 h-3 mr-1" /> Connect Google Calendar
            </Button>
          )}
        </div>
      </div>

      {calendarBanner && (
        <div className="rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-primary flex items-center justify-between">
          {calendarBanner}
          <button onClick={() => setCalendarBanner(null)} className="text-primary/60 hover:text-primary">×</button>
        </div>
      )}

      <div className="flex gap-2 border-b border-border/60 pb-2">
        {(["bookings", "services", "staff"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              tab === t
                ? "bg-primary/20 text-primary border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "bookings" && <Calendar className="w-4 h-4 inline mr-2" />}
            {t === "services" && <Briefcase className="w-4 h-4 inline mr-2" />}
            {t === "staff" && <User className="w-4 h-4 inline mr-2" />}
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {formError && <div className="text-xs text-amber-400">{formError}</div>}
      {error && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          {error}
        </div>
      )}

      {tab === "bookings" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border/60 bg-slate-950/60 p-4 space-y-3">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Plus className="w-4 h-4" /> Create Booking
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Input
                label="Start (ISO)"
                placeholder="2025-12-01T15:00:00Z"
                value={bookingForm.start}
                onChange={(e) => setBookingForm((f) => ({ ...f, start: e.target.value }))}
              />
              <Input
                label="End (ISO)"
                placeholder="2025-12-01T16:00:00Z"
                value={bookingForm.end}
                onChange={(e) => setBookingForm((f) => ({ ...f, end: e.target.value }))}
              />
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Service</label>
                <select
                  className="w-full rounded-lg border border-border/60 bg-slate-900 px-3 py-2 text-sm"
                  value={bookingForm.serviceId}
                  onChange={(e) => setBookingForm((f) => ({ ...f, serviceId: e.target.value }))}
                >
                  <option value="">Select service...</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Staff</label>
                <select
                  className="w-full rounded-lg border border-border/60 bg-slate-900 px-3 py-2 text-sm"
                  value={bookingForm.staffId}
                  onChange={(e) => setBookingForm((f) => ({ ...f, staffId: e.target.value }))}
                >
                  <option value="">Select staff...</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <Button onClick={handleCreateBooking}>Create Booking</Button>
          </div>

          {bookings.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-slate-950/50 p-4 text-sm text-muted-foreground">
              {loading ? "Loading bookings..." : "No bookings yet. Create one to begin scheduling."}
            </div>
          ) : (
            <Table
              headers={["Start", "End", "Status"]}
              rows={bookings.map((b) => [
                new Date(b.startTime).toLocaleString(),
                new Date(b.endTime).toLocaleString(),
                <span key={b.id} className={`px-2 py-0.5 rounded-full text-xs ${
                  b.status === "CONFIRMED" ? "bg-emerald-500/20 text-emerald-300" :
                  b.status === "PENDING" ? "bg-amber-500/20 text-amber-300" :
                  "bg-slate-500/20 text-slate-300"
                }`}>{b.status}</span>,
              ])}
            />
          )}
        </div>
      )}

      {tab === "services" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border/60 bg-slate-950/60 p-4 space-y-3">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Service
            </h3>
            <div className="grid grid-cols-3 gap-3">
              <Input
                label="Service Name"
                placeholder="Consultation"
                value={serviceForm.name}
                onChange={(e) => setServiceForm((f) => ({ ...f, name: e.target.value }))}
              />
              <Input
                label="Duration (mins)"
                placeholder="60"
                value={serviceForm.durationMins}
                onChange={(e) => setServiceForm((f) => ({ ...f, durationMins: e.target.value }))}
              />
              <Input
                label="Price (TTD)"
                placeholder="500"
                value={serviceForm.price}
                onChange={(e) => setServiceForm((f) => ({ ...f, price: e.target.value }))}
              />
            </div>
            <Button onClick={handleCreateService}>Add Service</Button>
          </div>

          {services.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-slate-950/50 p-4 text-sm text-muted-foreground">
              {loading ? "Loading services..." : "No services yet. Add one to start offering bookings."}
            </div>
          ) : (
            <Table
              headers={["Service", "Duration", "Price", "Action"]}
              rows={services.map((s) => [
                s.name,
                <span key={`dur-${s.id}`} className="flex items-center gap-1"><Clock className="w-3 h-3" /> {s.durationMins} min</span>,
                `${s.currency} ${s.price.toLocaleString()}`,
                <Button
                  key={s.id}
                  variant="outline"
                  className="px-2 py-1 text-xs"
                  onClick={() => handleDeleteService(s.id)}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>,
              ])}
            />
          )}
        </div>
      )}

      {tab === "staff" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border/60 bg-slate-950/60 p-4 space-y-3">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Staff Member
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Name"
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
            <Button onClick={handleCreateStaff}>Add Staff</Button>
          </div>

          {staff.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-slate-950/50 p-4 text-sm text-muted-foreground">
              {loading ? "Loading staff..." : "No staff members yet. Add one to assign bookings."}
            </div>
          ) : (
            <Table
              headers={["Name", "Email", "Action"]}
              rows={staff.map((s) => [
                s.name,
                s.email ?? "—",
                <Button
                  key={s.id}
                  variant="outline"
                  className="px-2 py-1 text-xs"
                  onClick={() => handleDeleteStaff(s.id)}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>,
              ])}
            />
          )}
        </div>
      )}
    </div>
  );
}
