"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Briefcase,
  Clock,
  Users,
  Plus,
  Trash2,
  Mail,
  Link2,
  CalendarDays,
  ExternalLink,
  Timer,
  ChevronDown,
  ChevronUp,
  Save,
  Bell,
  Pencil,
} from "lucide-react";
import NextLink from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { SetupModeBanner } from "@/components/ui/setup-mode-banner";
import type { Service, StaffMember, Booking } from "./bookings-types";
import { formatAmount } from "../../commerce/utils/commerce-utils";
import { fetchStaffAvailability, setStaffAvailability, updateService } from "@/lib/client";
import { toast } from "sonner";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface CatalogCapacityTabProps {
  services: Service[];
  staff: StaffMember[];
  bookings: Booking[];
  staffForm: { name: string; email: string };
  setStaffForm: (fn: (f: { name: string; email: string }) => { name: string; email: string }) => void;
  onCreateStaff: () => void;
  onDeleteStaff: (staffId: string) => void;
  calendarConnected: boolean;
  calendarEmail: string | null;
  calendarLoading: boolean;
  onConnectCalendar: () => void;
  onDisconnectCalendar: () => void;
  loading: boolean;
  businessId?: string | null;
}

const stagger = {
  container: { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } },
  item: {
    hidden: { opacity: 0, y: 8 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
  },
};

function AvailabilityHours() {
  const [hours, setHours] = useState<Record<number, { open: string; close: string; enabled: boolean }>>(() => {
    const defaults: Record<number, { open: string; close: string; enabled: boolean }> = {};
    for (let i = 0; i < 7; i++) {
      defaults[i] = { open: "09:00", close: "17:00", enabled: i >= 1 && i <= 5 };
    }
    return defaults;
  });

  return (
    <motion.div variants={stagger.item} className="space-y-3">
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        <h3 className="text-sm font-semibold">Business Hours</h3>
      </div>

      <div className="kf-card p-4 space-y-2">
        <p className="text-[11px] text-muted-foreground mb-3">
          Set your default booking availability for each day of the week.
        </p>
        {DAY_LABELS.map((day, idx) => {
          const entry = hours[idx];
          return (
            <div key={day} className="flex items-center gap-3">
              <button
                onClick={() =>
                  setHours((prev) => ({
                    ...prev,
                    [idx]: { ...prev[idx], enabled: !prev[idx].enabled },
                  }))
                }
                className="w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors min-w-[44px] min-h-[44px] p-0 flex items-center justify-center"
                style={{
                  borderColor: entry.enabled ? "hsl(var(--kf-success) / 0.5)" : "hsl(var(--border))",
                  background: entry.enabled ? "hsl(var(--kf-success) / 0.1)" : "transparent",
                }}
              >
                {entry.enabled && (
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "hsl(var(--kf-success))" }} />
                )}
              </button>
              <span className="text-xs font-medium w-24">{day}</span>
              {entry.enabled ? (
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={entry.open}
                    onChange={(e) =>
                      setHours((prev) => ({
                        ...prev,
                        [idx]: { ...prev[idx], open: e.target.value },
                      }))
                    }
                    className="kf-input text-xs px-2 py-1 w-[100px] min-h-[44px]"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <input
                    type="time"
                    value={entry.close}
                    onChange={(e) =>
                      setHours((prev) => ({
                        ...prev,
                        [idx]: { ...prev[idx], close: e.target.value },
                      }))
                    }
                    className="kf-input text-xs px-2 py-1 w-[100px] min-h-[44px]"
                  />
                </div>
              ) : (
                <span className="text-xs text-muted-foreground italic">Closed</span>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

function StaffAvailabilityEditor({ staffId, staffName, businessId }: { staffId: string; staffName: string; businessId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [slots, setSlots] = useState<Record<number, { enabled: boolean; startTime: string; endTime: string }>>(() => {
    const defaults: Record<number, { enabled: boolean; startTime: string; endTime: string }> = {};
    for (let i = 0; i < 7; i++) {
      defaults[i] = { enabled: i >= 1 && i <= 5, startTime: "09:00", endTime: "17:00" };
    }
    return defaults;
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (expanded && !loaded) {
      fetchStaffAvailability(businessId, staffId).then((res) => {
        if (res.data && Array.isArray(res.data) && res.data.length > 0) {
          const newSlots: Record<number, { enabled: boolean; startTime: string; endTime: string }> = {};
          for (let i = 0; i < 7; i++) {
            newSlots[i] = { enabled: false, startTime: "09:00", endTime: "17:00" };
          }
          for (const s of res.data) {
            newSlots[s.dayOfWeek] = { enabled: true, startTime: s.startTime, endTime: s.endTime };
          }
          setSlots(newSlots);
        }
        setLoaded(true);
      });
    }
  }, [expanded, loaded, businessId, staffId]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    const enabledSlots = Object.entries(slots)
      .filter(([, v]) => v.enabled)
      .map(([k, v]) => ({ dayOfWeek: Number(k), startTime: v.startTime, endTime: v.endTime }));
    await setStaffAvailability(businessId, staffId, enabledSlots);
    setSaving(false);
  }, [businessId, staffId, slots]);

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[11px] font-medium min-h-[44px] px-2 rounded-lg hover:bg-muted/30 transition-colors w-full justify-between"
        style={{ color: "hsl(var(--kf-accent2))" }}
      >
        <span className="flex items-center gap-1.5">
          <Clock className="w-3 h-3" />
          {staffName}&apos;s Availability
        </span>
        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pt-2 space-y-1.5">
              {DAY_SHORT.map((day, idx) => {
                const slot = slots[idx];
                return (
                  <div key={idx} className="flex items-center gap-2">
                    <button
                      onClick={() => setSlots((prev) => ({ ...prev, [idx]: { ...prev[idx], enabled: !prev[idx].enabled } }))}
                      className="w-4 h-4 rounded border flex items-center justify-center shrink-0 min-w-[44px] min-h-[44px] p-0 flex items-center justify-center"
                      style={{
                        borderColor: slot.enabled ? "hsl(var(--kf-success) / 0.5)" : "hsl(var(--border))",
                        background: slot.enabled ? "hsl(var(--kf-success) / 0.1)" : "transparent",
                      }}
                    >
                      {slot.enabled && <div className="w-2 h-2 rounded-sm" style={{ background: "hsl(var(--kf-success))" }} />}
                    </button>
                    <span className="text-[11px] font-medium w-8">{day}</span>
                    {slot.enabled ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="time"
                          value={slot.startTime}
                          onChange={(e) => setSlots((prev) => ({ ...prev, [idx]: { ...prev[idx], startTime: e.target.value } }))}
                          className="kf-input text-[11px] px-1.5 py-0.5 w-[85px] min-h-[44px]"
                        />
                        <span className="text-[10px] text-muted-foreground">–</span>
                        <input
                          type="time"
                          value={slot.endTime}
                          onChange={(e) => setSlots((prev) => ({ ...prev, [idx]: { ...prev[idx], endTime: e.target.value } }))}
                          className="kf-input text-[11px] px-1.5 py-0.5 w-[85px] min-h-[44px]"
                        />
                      </div>
                    ) : (
                      <span className="text-[10px] text-muted-foreground italic">Off</span>
                    )}
                  </div>
                );
              })}
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 min-h-[44px] text-[11px] font-medium rounded-lg transition-colors mt-1"
                style={{ background: "hsl(var(--kf-accent2) / 0.1)", color: "hsl(var(--kf-accent2))", borderWidth: 1, borderColor: "hsl(var(--kf-accent2) / 0.2)" }}
              >
                <Save className="w-3 h-3" />
                {saving ? "Saving..." : "Save Availability"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ServiceTimingEditor({ serviceId, businessId, initialBuffer, initialLead }: {
  serviceId: string;
  businessId?: string;
  initialBuffer: number | null;
  initialLead: number | null;
}) {
  const [editing, setEditing] = useState(false);
  const [buffer, setBuffer] = useState(initialBuffer ?? 0);
  const [lead, setLead] = useState(initialLead ?? 0);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!businessId) return;
    setSaving(true);
    try {
      await updateService(serviceId, {
        bufferMins: buffer || null,
        leadTimeMins: lead || null,
      }, businessId);
      toast.success("Timing settings updated");
      setEditing(false);
    } catch {
      toast.error("Failed to update timing");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors mt-1 min-h-[44px]"
      >
        <Pencil className="w-2.5 h-2.5" />
        Edit buffer & lead time
      </button>
    );
  }

  return (
    <div className="mt-2 pt-2 border-t border-border/30 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-muted-foreground mb-0.5 block">Buffer (mins)</label>
          <input
            type="number"
            min={0}
            max={120}
            value={buffer}
            onChange={(e) => setBuffer(Number(e.target.value))}
            className="kf-input w-full text-xs px-2 py-1.5 min-h-[44px]"
            aria-label="Buffer minutes between appointments"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground mb-0.5 block">Lead time (mins)</label>
          <input
            type="number"
            min={0}
            max={10080}
            value={lead}
            onChange={(e) => setLead(Number(e.target.value))}
            className="kf-input w-full text-xs px-2 py-1.5 min-h-[44px]"
            aria-label="Lead time in minutes for advance booking"
          />
        </div>
      </div>
      <div className="flex gap-1.5 justify-end">
        <button
          onClick={() => setEditing(false)}
          className="px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors min-h-[44px]"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors min-h-[44px] disabled:opacity-50"
          style={{
            background: "hsl(var(--kf-accent1) / 0.1)",
            color: "hsl(var(--kf-accent1))",
          }}
        >
          <Save className="w-2.5 h-2.5" />
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

function ReminderConfig({ businessId }: { businessId?: string | null }) {
  const [reminderMins, setReminderMins] = useState(60);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    (async () => {
      const { fetchReminderSettings } = await import("@/lib/client");
      const res = await fetchReminderSettings(businessId);
      if (!cancelled && res.data) {
        setReminderMins(res.data.bookingReminderMins);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  const handleChange = (value: number) => {
    setReminderMins(value);
    setSaved(false);
  };

  const handleSave = async () => {
    if (!businessId) return;
    const { updateReminderSettings } = await import("@/lib/client");
    const res = await updateReminderSettings(reminderMins, businessId);
    if (res.data) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  return (
    <motion.div variants={stagger.item} className="space-y-3">
      <div className="flex items-center gap-2">
        <Bell className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        <h3 className="text-sm font-semibold">Booking Reminders</h3>
      </div>
      <div className="kf-card p-4 space-y-3">
        <p className="text-[11px] text-muted-foreground">
          Send automated reminders to clients before their appointments.
        </p>
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium">Remind</span>
          <select
            value={reminderMins}
            onChange={(e) => handleChange(Number(e.target.value))}
            className="kf-input text-xs px-2 py-1.5 w-[140px] min-h-[44px]"
          >
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={60}>1 hour</option>
            <option value={120}>2 hours</option>
            <option value={1440}>1 day</option>
            <option value={2880}>2 days</option>
          </select>
          <span className="text-xs font-medium">before appointment</span>
          <button
            onClick={handleSave}
            className="inline-flex items-center gap-1 px-3 min-h-[44px] text-xs font-medium rounded-lg transition-colors"
            style={{
              background: saved ? "hsl(var(--kf-success) / 0.1)" : "hsl(var(--kf-accent1) / 0.1)",
              color: saved ? "hsl(var(--kf-success))" : "hsl(var(--kf-accent1))",
              borderWidth: 1,
              borderColor: saved ? "hsl(var(--kf-success) / 0.3)" : "hsl(var(--kf-accent1) / 0.2)",
            }}
          >
            <Save className="w-3 h-3" />
            {saved ? "Saved" : "Save"}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground/60">
          Reminders will be sent via email when Customer Notifications are configured in Settings.
        </p>
      </div>
    </motion.div>
  );
}

export default function CatalogCapacityTab({
  services,
  staff,
  bookings,
  staffForm,
  setStaffForm,
  onCreateStaff,
  onDeleteStaff,
  calendarConnected,
  calendarEmail,
  calendarLoading,
  onConnectCalendar,
  onDisconnectCalendar,
  loading,
  businessId,
}: CatalogCapacityTabProps) {
  const serviceStats = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const map = new Map<string, number>();
    bookings.forEach((b) => {
      if (b.serviceId && new Date(b.startTime) >= monthStart) {
        map.set(b.serviceId, (map.get(b.serviceId) ?? 0) + 1);
      }
    });
    return map;
  }, [bookings]);

  const staffBookingCounts = useMemo(() => {
    const map = new Map<string, number>();
    bookings.forEach((b) => {
      if (b.staff?.id) {
        map.set(b.staff.id, (map.get(b.staff.id) ?? 0) + 1);
      }
    });
    return map;
  }, [bookings]);

  return (
    <motion.div
      variants={stagger.container}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <SetupModeBanner label="Catalog & Capacity — manage services, staff, and availability" settingsHref="/app/settings/business" />
      <motion.div variants={stagger.item} className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Briefcase className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            <h3 className="text-sm font-semibold">Services</h3>
            <span className="text-xs text-muted-foreground">({services.length})</span>
          </div>
          <NextLink
            href="/app/store?tab=products"
            className="inline-flex items-center gap-1 text-[11px] hover:underline min-w-[44px] min-h-[44px] justify-center"
            style={{ color: "hsl(var(--kf-accent2))" }}
          >
            <ExternalLink className="w-3 h-3" />
            Manage in Store
          </NextLink>
        </div>

        {services.length === 0 ? (
          <EmptyState
            icon={Briefcase}
            title="No services yet"
            description={loading ? "Loading services..." : "Add services from your Store to start accepting bookings."}
            actionLabel={loading ? undefined : "Go to Store"}
            actionIcon={Briefcase}
            onAction={loading ? undefined : () => { window.location.href = "/app/store?tab=products"; }}
            tip={loading ? undefined : "Services define what your clients can book — set pricing, duration, and availability."}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {services.map((service) => {
              const monthCount = serviceStats.get(service.id) ?? 0;
              const assignedStaff = staff.length;
              const svc = service as Service & { bufferMins?: number | null; leadTimeMins?: number | null };
              return (
                <motion.div
                  key={service.id}
                  variants={stagger.item}
                  className="kf-card p-4 space-y-3 hover:ring-1 hover:ring-[hsl(var(--kf-accent1)/0.2)] transition-all"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold truncate">{service.name}</h4>
                        <div
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium shrink-0"
                          style={{
                            background: monthCount > 0 ? "hsl(var(--kf-success) / 0.1)" : "hsl(var(--muted) / 0.3)",
                            color: monthCount > 0 ? "hsl(var(--kf-success))" : "hsl(var(--muted-foreground))",
                          }}
                        >
                          <div
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ background: monthCount > 0 ? "hsl(var(--kf-success))" : "hsl(var(--muted-foreground) / 0.4)" }}
                          />
                          {monthCount > 0 ? "Active" : "Inactive"}
                        </div>
                      </div>
                      {service.description && (
                        <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                          {service.description}
                        </p>
                      )}
                    </div>
                    <div
                      className="text-sm font-bold shrink-0"
                      style={{ color: "hsl(var(--kf-accent1))" }}
                    >
                      {formatAmount(service.price)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {service.durationMins ?? service.duration ?? 60}m
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {assignedStaff} staff
                    </span>
                    <span className="flex items-center gap-1">
                      <CalendarDays className="w-3 h-3" />
                      {monthCount} this month
                    </span>
                    {svc.bufferMins ? (
                      <span className="flex items-center gap-1" style={{ color: "hsl(var(--kf-accent2))" }}>
                        <Timer className="w-3 h-3" />
                        {svc.bufferMins}m buffer
                      </span>
                    ) : null}
                    {svc.leadTimeMins ? (
                      <span className="flex items-center gap-1" style={{ color: "hsl(var(--kf-warning))" }}>
                        <Timer className="w-3 h-3" />
                        {svc.leadTimeMins}m lead
                      </span>
                    ) : null}
                  </div>
                  <ServiceTimingEditor
                    serviceId={service.id}
                    businessId={businessId ?? undefined}
                    initialBuffer={svc.bufferMins ?? null}
                    initialLead={svc.leadTimeMins ?? null}
                  />
                </motion.div>
              );
            })}
          </div>
        )}
      </motion.div>

      <motion.div variants={stagger.item} className="space-y-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
          <h3 className="text-sm font-semibold">Staff</h3>
          <span className="text-xs text-muted-foreground">({staff.length})</span>
        </div>

        <div className="kf-card p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
            <div>
              <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-1 block">
                Name
              </label>
              <input
                placeholder="Jane Doe"
                value={staffForm.name}
                onChange={(e) => setStaffForm((f) => ({ ...f, name: e.target.value }))}
                className="kf-input w-full text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-1 block">
                Email
              </label>
              <input
                placeholder="jane@example.com"
                value={staffForm.email}
                onChange={(e) => setStaffForm((f) => ({ ...f, email: e.target.value }))}
                className="kf-input w-full text-xs"
              />
            </div>
            <button
              onClick={onCreateStaff}
              className="kf-btn-primary inline-flex items-center gap-1.5 text-xs min-h-[44px]"
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>
        </div>

        {staff.length === 0 && !loading && (
          <EmptyState
            icon={Users}
            title="No staff members"
            description="Add your first team member using the form above to manage bookings and schedules."
            actionLabel="Scroll to Add Staff"
            onAction={() => {
              const el = document.querySelector<HTMLInputElement>('input[placeholder="Jane Doe"]');
              if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.focus(); }
            }}
            tip="Staff members can be assigned to services for appointment scheduling."
          />
        )}

        {staff.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {staff.map((s) => (
              <div
                key={s.id}
                className="kf-card p-3 group hover:ring-1 hover:ring-[hsl(var(--kf-accent2)/0.2)] transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                      style={{
                        background: "hsl(var(--kf-accent2) / 0.1)",
                        color: "hsl(var(--kf-accent2))",
                        borderWidth: 1,
                        borderColor: "hsl(var(--kf-accent2) / 0.2)",
                      }}
                    >
                      {s.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">{s.name}</p>
                      <div className="flex items-center gap-2">
                        {s.email && (
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1 truncate">
                            <Mail className="w-2.5 h-2.5" /> {s.email}
                          </p>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          {staffBookingCounts.get(s.id) ?? 0} bookings
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => onDeleteStaff(s.id)}
                    className="p-1 rounded-lg opacity-0 group-hover:opacity-100 transition-all shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
                    style={{ color: "hsl(var(--kf-error) / 0.7)" }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {businessId && (
                  <StaffAvailabilityEditor staffId={s.id} staffName={s.name} businessId={businessId} />
                )}
              </div>
            ))}
          </div>
        )}
      </motion.div>

      <AvailabilityHours />

      <ReminderConfig businessId={businessId} />

      <motion.div variants={stagger.item} className="space-y-3">
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Integrations</h3>
        </div>

        <a href="/app/settings/connections" className="kf-card p-4 flex items-center justify-between group hover:border-[hsl(var(--kf-accent1))]/40 transition-colors block">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "hsl(var(--kf-accent2) / 0.1)" }}
            >
              <CalendarDays className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
            </div>
            <div>
              <p className="text-sm font-medium">Google Calendar</p>
              <p className="text-[11px] text-muted-foreground">
                {calendarConnected
                  ? `Connected as ${calendarEmail ?? "your account"}`
                  : "Sync bookings to your Google Calendar"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {calendarConnected && (
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
                style={{
                  background: "hsl(var(--kf-success) / 0.1)",
                  borderWidth: 1,
                  borderColor: "hsl(var(--kf-success) / 0.3)",
                }}
              >
                <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "hsl(var(--kf-success))" }} />
                <span className="text-[11px] font-medium" style={{ color: "hsl(var(--kf-success))" }}>Connected</span>
              </div>
            )}
            <span className="text-xs text-muted-foreground group-hover:text-[hsl(var(--kf-accent1))] transition-colors">
              Manage in Settings →
            </span>
          </div>
        </a>
      </motion.div>
    </motion.div>
  );
}
