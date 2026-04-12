"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
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
  AlertTriangle,
  CheckCircle2,
  Copy,
  Zap,
} from "lucide-react";
import NextLink from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import type { Service, StaffMember, Booking } from "./bookings-types";
import { formatAmount } from "../../commerce/utils/commerce-utils";
import { fetchStaffAvailability, setStaffAvailability, updateService, getBusinessById, updateBusiness } from "@/lib/client";
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
  businessHoursSet?: boolean;
  onBusinessHoursSaved?: () => void;
}


const HOUR_PRESETS = [
  { label: "Mon–Fri 9–5", make: (): HoursMap => {
    const h: HoursMap = {};
    for (let i = 0; i < 7; i++) h[i] = { open: "09:00", close: "17:00", enabled: i >= 1 && i <= 5 };
    return h;
  }},
  { label: "Mon–Sat 8–6", make: (): HoursMap => {
    const h: HoursMap = {};
    for (let i = 0; i < 7; i++) h[i] = { open: "08:00", close: "18:00", enabled: i >= 1 && i <= 6 };
    return h;
  }},
  { label: "Every Day 9–5", make: (): HoursMap => {
    const h: HoursMap = {};
    for (let i = 0; i < 7; i++) h[i] = { open: "09:00", close: "17:00", enabled: true };
    return h;
  }},
];

type HoursMap = Record<number, { open: string; close: string; enabled: boolean }>;

function AvailabilityHours({ businessId, onSaved }: { businessId?: string | null; onSaved?: () => void }) {
  const [hours, setHours] = useState<HoursMap>(() => {
    const defaults: HoursMap = {};
    for (let i = 0; i < 7; i++) {
      defaults[i] = { open: "09:00", close: "17:00", enabled: i >= 1 && i <= 5 };
    }
    return defaults;
  });
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loadedForBiz, setLoadedForBiz] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId || loadedForBiz === businessId) return;
    getBusinessById(businessId).then((res) => {
      const bh = res.data?.businessHours;
      if (bh) {
        const parsed: HoursMap = {};
        for (let i = 0; i < 7; i++) {
          const key = DAY_LABELS[i].toLowerCase();
          const entry = bh[key];
          if (entry) {
            parsed[i] = { open: entry.open ?? "09:00", close: entry.close ?? "17:00", enabled: !entry.closed };
          } else {
            parsed[i] = { open: "09:00", close: "17:00", enabled: i >= 1 && i <= 5 };
          }
        }
        setHours(parsed);
      }
      setLoadedForBiz(businessId);
      setDirty(false);
    }).catch(() => setLoadedForBiz(businessId));
  }, [businessId, loadedForBiz]);

  const updateHours = useCallback((fn: (prev: HoursMap) => HoursMap) => {
    setHours(fn);
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!businessId) return;
    setSaving(true);
    const payload: Record<string, { open: string; close: string; closed: boolean }> = {};
    for (let i = 0; i < 7; i++) {
      const key = DAY_LABELS[i].toLowerCase();
      payload[key] = { open: hours[i].open, close: hours[i].close, closed: !hours[i].enabled };
    }
    try {
      await updateBusiness({ businessId, businessHours: payload });
      toast.success("Business hours saved");
      setDirty(false);
      onSaved?.();
    } catch {
      toast.error("Failed to save business hours");
    } finally {
      setSaving(false);
    }
  }, [businessId, hours, onSaved]);

  const activeDays = Object.values(hours).filter((h) => h.enabled).length;
  const totalHours = Object.values(hours)
    .filter((h) => h.enabled)
    .reduce((sum, h) => {
      const [oh, om] = h.open.split(":").map(Number);
      const [ch, cm] = h.close.split(":").map(Number);
      return sum + (ch + cm / 60) - (oh + om / 60);
    }, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          <h3 className="text-sm font-semibold">Business Hours</h3>
          <span className="text-[10px] text-muted-foreground">
            {activeDays} days · {Math.round(totalHours)}h/week
          </span>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-1 px-2.5 min-h-[36px] text-[10px] font-medium rounded-lg transition-colors disabled:opacity-40"
          style={{
            background: dirty ? "hsl(var(--kf-accent1) / 0.1)" : "hsl(var(--muted) / 0.1)",
            color: dirty ? "hsl(var(--kf-accent1))" : "hsl(var(--muted-foreground))",
            borderWidth: 1,
            borderColor: dirty ? "hsl(var(--kf-accent1) / 0.2)" : "hsl(var(--border) / 0.3)",
          }}
        >
          <Save className="w-2.5 h-2.5" />
          {saving ? "Saving..." : "Save Hours"}
        </button>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {HOUR_PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => updateHours(() => preset.make())}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors hover:bg-muted/20"
            style={{
              background: "hsl(var(--muted) / 0.1)",
              borderWidth: 1,
              borderColor: "hsl(var(--border) / 0.5)",
              color: "hsl(var(--muted-foreground))",
            }}
          >
            <Copy className="w-2.5 h-2.5" />
            {preset.label}
          </button>
        ))}
      </div>

      <div className="kf-card p-3 space-y-1">
        {DAY_LABELS.map((day, idx) => {
          const entry = hours[idx];
          return (
            <div key={day} className="flex items-center gap-2 py-1">
              <button
                onClick={() =>
                  updateHours((prev) => ({
                    ...prev,
                    [idx]: { ...prev[idx], enabled: !prev[idx].enabled },
                  }))
                }
                className="w-5 h-5 rounded border flex items-center justify-center shrink-0 min-w-[36px] min-h-[36px]"
                style={{
                  borderColor: entry.enabled ? "hsl(var(--kf-success) / 0.5)" : "hsl(var(--border))",
                  background: entry.enabled ? "hsl(var(--kf-success) / 0.1)" : "transparent",
                }}
              >
                {entry.enabled && (
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "hsl(var(--kf-success))" }} />
                )}
              </button>
              <span className={`text-xs font-medium w-20 ${!entry.enabled ? "text-muted-foreground/50" : ""}`}>{day}</span>
              {entry.enabled ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="time"
                    value={entry.open}
                    onChange={(e) =>
                      updateHours((prev) => ({
                        ...prev,
                        [idx]: { ...prev[idx], open: e.target.value },
                      }))
                    }
                    className="kf-input text-xs px-2 py-1 w-[90px] min-h-[36px]"
                  />
                  <span className="text-[10px] text-muted-foreground">to</span>
                  <input
                    type="time"
                    value={entry.close}
                    onChange={(e) =>
                      updateHours((prev) => ({
                        ...prev,
                        [idx]: { ...prev[idx], close: e.target.value },
                      }))
                    }
                    className="kf-input text-xs px-2 py-1 w-[90px] min-h-[36px]"
                  />
                </div>
              ) : (
                <span className="text-[10px] text-muted-foreground/50 italic">Closed</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
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

  const activeDays = Object.values(slots).filter((s) => s.enabled).length;

  const handleSave = useCallback(async () => {
    setSaving(true);
    const enabledSlots = Object.entries(slots)
      .filter(([, v]) => v.enabled)
      .map(([k, v]) => ({ dayOfWeek: Number(k), startTime: v.startTime, endTime: v.endTime }));
    await setStaffAvailability(businessId, staffId, enabledSlots);
    setSaving(false);
    toast.success(`${staffName}'s availability saved`);
  }, [businessId, staffId, staffName, slots]);

  return (
    <div className="mt-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[10px] font-medium min-h-[36px] px-2 rounded-lg hover:bg-muted/30 transition-colors w-full justify-between"
        style={{ color: "hsl(var(--kf-accent2))" }}
      >
        <span className="flex items-center gap-1.5">
          <Clock className="w-3 h-3" />
          Availability
          <span className="text-muted-foreground">({activeDays} days)</span>
        </span>
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
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
            <div className="pt-2 space-y-1">
              {DAY_SHORT.map((day, idx) => {
                const slot = slots[idx];
                return (
                  <div key={idx} className="flex items-center gap-2">
                    <button
                      onClick={() => setSlots((prev) => ({ ...prev, [idx]: { ...prev[idx], enabled: !prev[idx].enabled } }))}
                      className="w-4 h-4 rounded border flex items-center justify-center shrink-0 min-w-[36px] min-h-[36px]"
                      style={{
                        borderColor: slot.enabled ? "hsl(var(--kf-success) / 0.5)" : "hsl(var(--border))",
                        background: slot.enabled ? "hsl(var(--kf-success) / 0.1)" : "transparent",
                      }}
                    >
                      {slot.enabled && <div className="w-2 h-2 rounded-sm" style={{ background: "hsl(var(--kf-success))" }} />}
                    </button>
                    <span className="text-[10px] font-medium w-8">{day}</span>
                    {slot.enabled ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="time"
                          value={slot.startTime}
                          onChange={(e) => setSlots((prev) => ({ ...prev, [idx]: { ...prev[idx], startTime: e.target.value } }))}
                          className="kf-input text-[10px] px-1.5 py-0.5 w-[80px] min-h-[36px]"
                        />
                        <span className="text-[9px] text-muted-foreground">–</span>
                        <input
                          type="time"
                          value={slot.endTime}
                          onChange={(e) => setSlots((prev) => ({ ...prev, [idx]: { ...prev[idx], endTime: e.target.value } }))}
                          className="kf-input text-[10px] px-1.5 py-0.5 w-[80px] min-h-[36px]"
                        />
                      </div>
                    ) : (
                      <span className="text-[9px] text-muted-foreground/50 italic">Off</span>
                    )}
                  </div>
                );
              })}
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-1 px-2.5 min-h-[36px] text-[10px] font-medium rounded-lg transition-colors mt-1"
                style={{ background: "hsl(var(--kf-accent2) / 0.1)", color: "hsl(var(--kf-accent2))", borderWidth: 1, borderColor: "hsl(var(--kf-accent2) / 0.2)" }}
              >
                <Save className="w-2.5 h-2.5" />
                {saving ? "Saving..." : "Save"}
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
        className="flex items-center gap-1 text-[9px] text-muted-foreground/50 hover:text-muted-foreground transition-colors mt-1 min-h-[32px]"
      >
        <Pencil className="w-2.5 h-2.5" />
        Buffer & lead time
      </button>
    );
  }

  return (
    <div className="mt-1.5 pt-1.5 border-t border-border/20 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[9px] text-muted-foreground mb-0.5 block">Buffer (mins)</label>
          <input
            type="number"
            min={0}
            max={120}
            value={buffer}
            onChange={(e) => setBuffer(Number(e.target.value))}
            className="kf-input w-full text-xs px-2 py-1 min-h-[36px]"
            aria-label="Buffer minutes between appointments"
          />
        </div>
        <div>
          <label className="text-[9px] text-muted-foreground mb-0.5 block">Lead time (mins)</label>
          <input
            type="number"
            min={0}
            max={10080}
            value={lead}
            onChange={(e) => setLead(Number(e.target.value))}
            className="kf-input w-full text-xs px-2 py-1 min-h-[36px]"
            aria-label="Lead time in minutes for advance booking"
          />
        </div>
      </div>
      <div className="flex gap-1.5 justify-end">
        <button
          onClick={() => setEditing(false)}
          className="px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors min-h-[32px]"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md transition-colors min-h-[32px] disabled:opacity-50"
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

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    (async () => {
      const { fetchReminderSettings } = await import("@/lib/client");
      const res = await fetchReminderSettings(businessId);
      if (!cancelled && res.data) {
        setReminderMins(res.data.bookingReminderMins);
      }
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
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Bell className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        <h3 className="text-sm font-semibold">Booking Reminders</h3>
      </div>
      <div className="kf-card p-3 space-y-2">
        <p className="text-[10px] text-muted-foreground">
          Automated reminders sent before appointments via email.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium">Remind</span>
          <select
            value={reminderMins}
            onChange={(e) => handleChange(Number(e.target.value))}
            className="kf-input text-xs px-2 py-1 w-[130px] min-h-[36px]"
          >
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={60}>1 hour</option>
            <option value={120}>2 hours</option>
            <option value={1440}>1 day</option>
            <option value={2880}>2 days</option>
          </select>
          <span className="text-xs font-medium">before</span>
          <button
            onClick={handleSave}
            className="inline-flex items-center gap-1 px-2.5 min-h-[36px] text-[10px] font-medium rounded-lg transition-colors"
            style={{
              background: saved ? "hsl(var(--kf-success) / 0.1)" : "hsl(var(--kf-accent1) / 0.1)",
              color: saved ? "hsl(var(--kf-success))" : "hsl(var(--kf-accent1))",
              borderWidth: 1,
              borderColor: saved ? "hsl(var(--kf-success) / 0.3)" : "hsl(var(--kf-accent1) / 0.2)",
            }}
          >
            <Save className="w-2.5 h-2.5" />
            {saved ? "Saved" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DependencyWarning({ message, actionLabel, onAction }: { message: string; actionLabel: string; onAction: () => void }) {
  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[11px]"
      style={{
        background: "hsl(var(--kf-warning) / 0.06)",
        borderWidth: 1,
        borderColor: "hsl(var(--kf-warning) / 0.15)",
        color: "hsl(var(--kf-warning))",
      }}
    >
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      <span className="flex-1">{message}</span>
      <button
        onClick={onAction}
        className="px-2 py-0.5 rounded text-[10px] font-medium shrink-0 transition-colors"
        style={{
          background: "hsl(var(--kf-warning) / 0.12)",
          borderWidth: 1,
          borderColor: "hsl(var(--kf-warning) / 0.25)",
        }}
      >
        {actionLabel}
      </button>
    </div>
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
  businessHoursSet,
  onBusinessHoursSaved,
}: CatalogCapacityTabProps) {
  const [setupTab, setSetupTab] = useState<"services" | "staff" | "availability" | "hours">("services");

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

  const readinessItems = useMemo(() => {
    const items: { label: string; ok: boolean; tabKey: "services" | "staff" | "availability" | "hours" }[] = [
      { label: `${services.length} service${services.length !== 1 ? "s" : ""} configured`, ok: services.length > 0, tabKey: "services" },
      { label: `${staff.length} staff assigned`, ok: staff.length > 0, tabKey: "staff" },
      { label: "Business hours set", ok: !!businessHoursSet, tabKey: "hours" },
      { label: "Calendar connected", ok: calendarConnected, tabKey: "hours" },
    ];
    return items;
  }, [services, staff, calendarConnected, businessHoursSet]);

  const readyCount = readinessItems.filter((r) => r.ok).length;

  const SETUP_TABS = [
    { key: "services" as const, label: "Services", icon: Briefcase, count: services.length },
    { key: "staff" as const, label: "Staff", icon: Users, count: staff.length },
    { key: "availability" as const, label: "Availability", icon: Clock },
    { key: "hours" as const, label: "Hours", icon: CalendarDays },
  ];

  return (
    <div className="space-y-4">
      <div className="kf-card rounded-xl p-3">
        <div className="flex items-center justify-between mb-2.5">
          <div>
            <h3 className="text-sm font-semibold">Setup Readiness</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {readyCount === readinessItems.length ? "All set! Your booking system is ready." : `${readyCount}/${readinessItems.length} configured — complete the items below.`}
            </p>
          </div>
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-semibold"
            style={{
              background: readyCount === readinessItems.length ? "hsl(var(--kf-success) / 0.1)" : "hsl(var(--kf-warning) / 0.1)",
              color: readyCount === readinessItems.length ? "hsl(var(--kf-success))" : "hsl(var(--kf-warning))",
            }}
          >
            {readyCount === readinessItems.length ? (
              <CheckCircle2 className="w-3 h-3" />
            ) : null}
            {readyCount}/{readinessItems.length}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {readinessItems.map((item) => (
            <button
              key={item.label}
              onClick={() => setSetupTab(item.tabKey)}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors hover:ring-1"
              style={{
                background: item.ok ? "hsl(var(--kf-success) / 0.06)" : "hsl(var(--kf-error) / 0.06)",
                color: item.ok ? "hsl(var(--kf-success))" : "hsl(var(--kf-error))",
                borderWidth: 1,
                borderColor: item.ok ? "hsl(var(--kf-success) / 0.15)" : "hsl(var(--kf-error) / 0.15)",
              }}
            >
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: item.ok ? "hsl(var(--kf-success))" : "hsl(var(--kf-error))" }}
              />
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: "hsl(var(--muted) / 0.15)" }}>
          {SETUP_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setSetupTab(t.key)}
              className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all min-h-[36px]"
              style={{
                background: setupTab === t.key ? "hsl(var(--kf-accent1) / 0.1)" : "transparent",
                color: setupTab === t.key ? "hsl(var(--kf-accent1))" : "hsl(var(--muted-foreground))",
                borderWidth: setupTab === t.key ? 1 : 0,
                borderColor: setupTab === t.key ? "hsl(var(--kf-accent1) / 0.2)" : "transparent",
              }}
            >
              <t.icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.label}</span>
              {t.count !== undefined && (
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                  style={{
                    background: setupTab === t.key ? "hsl(var(--kf-accent1) / 0.15)" : "hsl(var(--muted) / 0.3)",
                    color: setupTab === t.key ? "hsl(var(--kf-accent1))" : "hsl(var(--muted-foreground))",
                  }}
                >
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {setupTab === "services" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Briefcase className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
              <h3 className="text-sm font-semibold">Services</h3>
              <span className="text-[10px] text-muted-foreground">({services.length})</span>
            </div>
            <NextLink
              href="/app/store?tab=products"
              className="inline-flex items-center gap-1 text-[10px] hover:underline min-h-[36px] justify-center"
              style={{ color: "hsl(var(--kf-accent2))" }}
            >
              <ExternalLink className="w-3 h-3" />
              Manage in Store
            </NextLink>
          </div>

          {services.length > 0 && staff.length === 0 && (
            <DependencyWarning
              message={`You have ${services.length} service${services.length !== 1 ? "s" : ""} but no staff to handle bookings.`}
              actionLabel="Add Staff"
              onAction={() => setSetupTab("staff")}
            />
          )}

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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {services.map((service) => {
                const monthCount = serviceStats.get(service.id) ?? 0;
                const svc = service as Service & { bufferMins?: number | null; leadTimeMins?: number | null };
                const isActive = monthCount > 0;
                return (
                  <div
                    key={service.id}
                    className="kf-card p-3 space-y-2 hover:ring-1 hover:ring-[hsl(var(--kf-accent1)/0.2)] transition-all"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <h4 className="text-xs font-semibold truncate">{service.name}</h4>
                          <div
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ background: isActive ? "hsl(var(--kf-success))" : "hsl(var(--muted-foreground) / 0.3)" }}
                            title={isActive ? "Active this month" : "No bookings this month"}
                          />
                        </div>
                      </div>
                      <span className="text-xs font-bold shrink-0" style={{ color: "hsl(var(--kf-accent1))" }}>
                        {formatAmount(service.price)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {service.durationMins ?? service.duration ?? 60}m
                      </span>
                      <span className="flex items-center gap-1">
                        <CalendarDays className="w-2.5 h-2.5" />
                        {monthCount} this month
                      </span>
                      {svc.bufferMins ? (
                        <span className="flex items-center gap-1" style={{ color: "hsl(var(--kf-accent2))" }}>
                          <Timer className="w-2.5 h-2.5" />
                          {svc.bufferMins}m buf
                        </span>
                      ) : null}
                      {svc.leadTimeMins ? (
                        <span className="flex items-center gap-1" style={{ color: "hsl(var(--kf-warning))" }}>
                          <Timer className="w-2.5 h-2.5" />
                          {svc.leadTimeMins}m lead
                        </span>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-2 pt-1 border-t border-border/20 text-[9px]">
                      {staff.length === 0 ? (
                        <span className="flex items-center gap-1" style={{ color: "hsl(var(--kf-error))" }}>
                          <AlertTriangle className="w-2.5 h-2.5" /> No staff
                        </span>
                      ) : (
                        <span className="flex items-center gap-1" style={{ color: "hsl(var(--kf-success))" }}>
                          <CheckCircle2 className="w-2.5 h-2.5" /> {staff.length} staff ready
                        </span>
                      )}
                      {!calendarConnected && (
                        <span className="flex items-center gap-1 text-muted-foreground/50">
                          <Link2 className="w-2.5 h-2.5" /> No calendar
                        </span>
                      )}
                    </div>

                    <ServiceTimingEditor
                      serviceId={service.id}
                      businessId={businessId ?? undefined}
                      initialBuffer={svc.bufferMins ?? null}
                      initialLead={svc.leadTimeMins ?? null}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {setupTab === "staff" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
            <h3 className="text-sm font-semibold">Staff</h3>
            <span className="text-[10px] text-muted-foreground">({staff.length})</span>
          </div>

          {services.length === 0 && (
            <DependencyWarning
              message="Add services first so staff can be assigned to handle bookings."
              actionLabel="Add Services"
              onAction={() => setSetupTab("services")}
            />
          )}

          <div className="kf-card p-3 space-y-2.5">
            <p className="text-[10px] text-muted-foreground">
              Team members who handle bookings. Each can have their own availability schedule.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <div>
                <label className="text-[9px] text-muted-foreground font-medium uppercase tracking-wider mb-1 block">
                  Name
                </label>
                <input
                  placeholder="Jane Doe"
                  value={staffForm.name}
                  onChange={(e) => setStaffForm((f) => ({ ...f, name: e.target.value }))}
                  className="kf-input w-full text-xs min-h-[36px]"
                />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground font-medium uppercase tracking-wider mb-1 block">
                  Email
                </label>
                <input
                  placeholder="jane@example.com"
                  value={staffForm.email}
                  onChange={(e) => setStaffForm((f) => ({ ...f, email: e.target.value }))}
                  className="kf-input w-full text-xs min-h-[36px]"
                />
              </div>
              <button
                onClick={onCreateStaff}
                className="kf-btn-primary inline-flex items-center gap-1.5 text-xs min-h-[36px]"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
          </div>

          {staff.length === 0 && !loading && (
            <EmptyState
              icon={Users}
              title="No staff members"
              description="Add your first team member above. They'll be available for booking assignments."
              tip="After adding staff, set their availability in the Availability tab."
            />
          )}

          {staff.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {staff.map((s) => {
                const bookingCount = staffBookingCounts.get(s.id) ?? 0;
                return (
                  <div
                    key={s.id}
                    className="kf-card p-3 group hover:ring-1 hover:ring-[hsl(var(--kf-accent2)/0.2)] transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
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
                              <p className="text-[9px] text-muted-foreground flex items-center gap-1 truncate">
                                <Mail className="w-2.5 h-2.5" /> {s.email}
                              </p>
                            )}
                            <span
                              className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                              style={{
                                background: bookingCount > 0 ? "hsl(var(--kf-accent1) / 0.1)" : "hsl(var(--muted) / 0.2)",
                                color: bookingCount > 0 ? "hsl(var(--kf-accent1))" : "hsl(var(--muted-foreground))",
                              }}
                            >
                              {bookingCount} booking{bookingCount !== 1 ? "s" : ""}
                            </span>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => onDeleteStaff(s.id)}
                        className="p-1 rounded-lg opacity-0 group-hover:opacity-100 transition-all shrink-0 min-w-[36px] min-h-[36px] flex items-center justify-center"
                        style={{ color: "hsl(var(--kf-error) / 0.7)" }}
                        title={`Remove ${s.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {businessId && (
                      <StaffAvailabilityEditor staffId={s.id} staffName={s.name} businessId={businessId} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {setupTab === "availability" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
            <h3 className="text-sm font-semibold">Staff Availability</h3>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Define when each staff member is available. This controls bookable time slots.
          </p>

          {staff.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No staff yet"
              description="Add staff members first to configure their availability."
              actionLabel="Go to Staff"
              onAction={() => setSetupTab("staff")}
              tip="Each staff member can have their own schedule."
            />
          ) : (
            <div className="space-y-2">
              {staff.map((s) => (
                <div key={s.id} className="kf-card p-3">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                      style={{
                        background: "hsl(var(--kf-accent2) / 0.1)",
                        color: "hsl(var(--kf-accent2))",
                      }}
                    >
                      {s.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-xs font-semibold">{s.name}</span>
                    <span className="text-[9px] text-muted-foreground ml-auto">
                      {staffBookingCounts.get(s.id) ?? 0} total bookings
                    </span>
                  </div>
                  {businessId && (
                    <StaffAvailabilityEditor staffId={s.id} staffName={s.name} businessId={businessId} />
                  )}
                </div>
              ))}
            </div>
          )}

          <ReminderConfig businessId={businessId} />
        </div>
      )}

      {setupTab === "hours" && (
        <div className="space-y-4">
          <AvailabilityHours businessId={businessId} onSaved={onBusinessHoursSaved} />

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Link2 className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Calendar Integration</h3>
            </div>

            <a href="/app/settings/connections" className="kf-card p-3 flex items-center justify-between group hover:border-[hsl(var(--kf-accent1))]/40 transition-colors block">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: "hsl(var(--kf-accent2) / 0.1)" }}
                >
                  <CalendarDays className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent2))" }} />
                </div>
                <div>
                  <p className="text-xs font-medium">Google Calendar</p>
                  <p className="text-[10px] text-muted-foreground">
                    {calendarConnected
                      ? `Connected as ${calendarEmail ?? "your account"}`
                      : "Sync bookings to Google Calendar"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {calendarConnected && (
                  <div
                    className="flex items-center gap-1 px-2 py-0.5 rounded-lg"
                    style={{
                      background: "hsl(var(--kf-success) / 0.1)",
                      borderWidth: 1,
                      borderColor: "hsl(var(--kf-success) / 0.3)",
                    }}
                  >
                    <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "hsl(var(--kf-success))" }} />
                    <span className="text-[10px] font-medium" style={{ color: "hsl(var(--kf-success))" }}>Connected</span>
                  </div>
                )}
                <span className="text-[10px] text-muted-foreground group-hover:text-[hsl(var(--kf-accent1))] transition-colors">
                  Settings →
                </span>
              </div>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
