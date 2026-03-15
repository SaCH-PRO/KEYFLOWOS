"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Briefcase,
  Clock,
  Users,
  Plus,
  Trash2,
  Mail,
  Link2,
  Unlink,
  CalendarDays,
} from "lucide-react";
import type { Service, StaffMember, Booking } from "./bookings-types";
import { formatAmount } from "../../commerce/utils/commerce-utils";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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
        <h3 className="text-sm font-semibold">Availability & Hours</h3>
      </div>

      <div className="kf-card p-4 space-y-2">
        <p className="text-[11px] text-muted-foreground mb-3">
          Set your booking availability for each day of the week.
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
                className="w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors"
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
                    className="kf-input text-xs px-2 py-1 w-[100px]"
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
                    className="kf-input text-xs px-2 py-1 w-[100px]"
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
      <motion.div variants={stagger.item} className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Briefcase className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            <h3 className="text-sm font-semibold">Services</h3>
            <span className="text-xs text-muted-foreground">({services.length})</span>
          </div>
        </div>

        {services.length === 0 ? (
          <div className="kf-card p-8 text-center">
            <Briefcase className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium mb-1">No services yet</p>
            <p className="text-xs text-muted-foreground">
              {loading ? "Loading..." : "Add services from your Store to start booking."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {services.map((service) => {
              const monthCount = serviceStats.get(service.id) ?? 0;
              const assignedStaff = staff.length;
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
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
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
                  </div>
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
              className="kf-btn-primary inline-flex items-center gap-1.5 text-xs h-[34px]"
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>
        </div>

        {staff.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {staff.map((s) => (
              <div
                key={s.id}
                className="kf-card p-3 flex items-center justify-between group hover:ring-1 hover:ring-[hsl(var(--kf-accent2)/0.2)] transition-all"
              >
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
                  className="p-1 rounded-lg opacity-0 group-hover:opacity-100 transition-all shrink-0"
                  style={{ color: "hsl(var(--kf-error) / 0.7)" }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </motion.div>

      <AvailabilityHours />

      <motion.div variants={stagger.item} className="space-y-3">
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Integrations</h3>
        </div>

        <div className="kf-card p-4">
          <div className="flex items-center justify-between">
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
              {calendarConnected ? (
                <>
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
                  <button
                    onClick={onDisconnectCalendar}
                    disabled={calendarLoading}
                    className="kf-btn-secondary inline-flex items-center gap-1 text-xs"
                  >
                    <Unlink className="w-3 h-3" /> Disconnect
                  </button>
                </>
              ) : (
                <button
                  onClick={onConnectCalendar}
                  disabled={calendarLoading}
                  className="kf-btn-primary inline-flex items-center gap-1.5 text-xs"
                >
                  <Link2 className="w-3.5 h-3.5" /> Connect
                </button>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
