"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  CalendarDays,
  Clock,
  User,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Check,
  StickyNote,
  MapPin,
} from "lucide-react";
import type { Service, StaffMember, Contact } from "./bookings-types";
import { formatTime } from "./bookings-types";
import { ContactSelect } from "@/components/contacts";

interface BookingFormProps {
  services: Service[];
  staff: StaffMember[];
  contacts: Contact[];
  onSubmit: (data: {
    date: string;
    time: string;
    serviceId: string;
    staffId: string;
    contactId: string;
    notes?: string;
    location?: string;
    locationPlaceId?: string;
    locationLatLng?: { lat: number; lng: number };
  }) => void;
  onCancel: () => void;
  formError: string | null;
  defaultDate?: string;
  defaultTime?: string;
  defaultContactId?: string;
  saving?: boolean;
}

const TIME_SLOTS = (() => {
  const slots: { value: string; label: string; period: string }[] = [];
  for (let h = 7; h <= 20; h++) {
    for (const m of [0, 30]) {
      if (h === 20 && m === 30) continue;
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const ampm = h >= 12 ? "PM" : "AM";
      const label = `${hour12}:${String(m).padStart(2, "0")}`;
      slots.push({ value, label, period: ampm });
    }
  }
  return slots;
})();

function getWeekDays(baseDate: Date): Date[] {
  const start = new Date(baseDate);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function toDateStr(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function BookingForm({
  services,
  staff,
  contacts,
  onSubmit,
  onCancel,
  formError,
  defaultDate,
  defaultTime,
  defaultContactId,
  saving = false,
}: BookingFormProps) {
  const [bookingDate, setBookingDate] = useState(defaultDate ?? "");
  const [bookingTime, setBookingTime] = useState(defaultTime ?? "");
  const [bookingServiceId, setBookingServiceId] = useState("");
  const [bookingStaffId, setBookingStaffId] = useState("");
  const [bookingContactId, setBookingContactId] = useState(defaultContactId ?? "");
  const [bookingLocation, setBookingLocation] = useState("");
  const [bookingLocationPlaceId, setBookingLocationPlaceId] = useState<string | undefined>(undefined);
  const [bookingLocationLatLng, setBookingLocationLatLng] = useState<{ lat: number; lng: number } | undefined>(undefined);
  const [bookingNotes, setBookingNotes] = useState("");
  const [weekBase, setWeekBase] = useState(() => {
    if (defaultDate) return new Date(defaultDate + "T12:00:00");
    return new Date();
  });

  const timeGridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets/mirrors prop or modal-open state into local form state
    setBookingDate(defaultDate ?? "");
    if (defaultDate) setWeekBase(new Date(defaultDate + "T12:00:00"));
  }, [defaultDate]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets/mirrors prop or modal-open state into local form state
    setBookingTime(defaultTime ?? "");
  }, [defaultTime]);

  useEffect(() => {
    if (services.length === 1 && !bookingServiceId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets/mirrors prop or modal-open state into local form state
      setBookingServiceId(services[0].id);
    }
  }, [services, bookingServiceId]);

  useEffect(() => {
    if (staff.length === 1 && !bookingStaffId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets/mirrors prop or modal-open state into local form state
      setBookingStaffId(staff[0].id);
    }
  }, [staff, bookingStaffId]);

  const selectedService = useMemo(
    () => services.find((s) => s.id === bookingServiceId),
    [services, bookingServiceId]
  );

  const computedEndTime = useMemo(() => {
    if (!bookingDate || !bookingTime || !selectedService) return "";
    const start = new Date(`${bookingDate}T${bookingTime}`);
    const end = new Date(start.getTime() + (selectedService.durationMins ?? 60) * 60 * 1000);
    return end.toISOString();
  }, [bookingDate, bookingTime, selectedService]);

  const weekDays = useMemo(() => getWeekDays(weekBase), [weekBase]);
  const today = useMemo(() => new Date(), []);

  const navigateWeek = useCallback((dir: number) => {
    setWeekBase((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + dir * 7);
      return next;
    });
  }, []);

  const handleDateSelect = useCallback((d: Date) => {
    setBookingDate(toDateStr(d));
  }, []);

  const handleTimeSelect = useCallback((time: string) => {
    setBookingTime(time);
  }, []);

  useEffect(() => {
    if (bookingTime && timeGridRef.current) {
      const el = timeGridRef.current.querySelector(`[data-time="${bookingTime}"]`);
      el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
  }, [bookingTime]);

  const isComplete = bookingDate && bookingTime && bookingServiceId && bookingStaffId;

  function handleSubmit() {
    const trimmedLoc = bookingLocation.trim();
    const trimmedNotes = bookingNotes.trim();
    onSubmit({
      date: bookingDate,
      time: bookingTime,
      serviceId: bookingServiceId,
      staffId: bookingStaffId,
      contactId: bookingContactId,
      notes: trimmedNotes || undefined,
      location: trimmedLoc || undefined,
      locationPlaceId: trimmedLoc ? bookingLocationPlaceId : undefined,
      locationLatLng: trimmedLoc ? bookingLocationLatLng : undefined,
    });
  }

  const selectedStaff = useMemo(
    () => staff.find((s) => s.id === bookingStaffId),
    [staff, bookingStaffId]
  );


  return (
    <div>
      <div className="rounded-xl bg-card/80 overflow-hidden">

        {formError && (
          <div className="mx-4 mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
            {formError}
          </div>
        )}

        <div className="p-4 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Date</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => navigateWeek(-1)} className="p-1 rounded-md hover:bg-muted/50 transition-colors" aria-label="Previous week">
                  <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
                <button
                  onClick={() => { setWeekBase(new Date()); setBookingDate(toDateStr(new Date())); }}
                  className="px-2 py-0.5 text-[10px] rounded-md hover:bg-muted/50 transition-colors text-muted-foreground"
                >
                  Today
                </button>
                <button onClick={() => navigateWeek(1)} className="p-1 rounded-md hover:bg-muted/50 transition-colors" aria-label="Next week">
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            </div>
            <div role="radiogroup" aria-label="Select date" className="grid grid-cols-7 gap-1">
              {weekDays.map((day) => {
                const dateStr = toDateStr(day);
                const isSelected = bookingDate === dateStr;
                const isToday = isSameDay(day, today);
                const isPast = day < today && !isToday;
                return (
                  <button
                    key={dateStr}
                    role="radio"
                    aria-checked={isSelected}
                    aria-label={day.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                    onClick={() => !isPast && handleDateSelect(day)}
                    disabled={isPast}
                    className={`flex flex-col items-center py-2 px-1 rounded-lg transition-all text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--kf-accent1)/0.6)] ${
                      isSelected
                        ? "ring-1 ring-[hsl(var(--kf-accent1)/0.5)] text-foreground"
                        : isToday
                        ? "border border-[hsl(var(--kf-accent1)/0.3)] text-foreground"
                        : isPast
                        ? "opacity-30 cursor-not-allowed"
                        : "border border-transparent hover:bg-muted/40 text-muted-foreground hover:text-foreground"
                    }`}
                    style={isSelected ? { background: "hsl(var(--kf-accent1)/0.12)" } : undefined}
                  >
                    <span className="text-[10px] font-medium uppercase">
                      {day.toLocaleDateString("en-US", { weekday: "short" })}
                    </span>
                    <span className={`text-lg font-bold leading-tight ${isSelected ? "" : ""}`}
                      style={isSelected ? { color: "hsl(var(--kf-accent1))" } : undefined}
                    >
                      {day.getDate()}
                    </span>
                    <span className="text-[9px] text-muted-foreground">
                      {day.toLocaleDateString("en-US", { month: "short" })}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Time</span>
            </div>
            <div ref={timeGridRef} role="radiogroup" aria-label="Select time" className="flex gap-1 overflow-x-auto pb-1 scrollbar-thin">
              {TIME_SLOTS.map((slot) => {
                const isSelected = bookingTime === slot.value;
                return (
                  <button
                    key={slot.value}
                    role="radio"
                    aria-checked={isSelected}
                    aria-label={`${slot.label} ${slot.period}`}
                    data-time={slot.value}
                    onClick={() => handleTimeSelect(slot.value)}
                    className={`flex-shrink-0 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all whitespace-nowrap border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--kf-accent1)/0.6)] ${
                      isSelected
                        ? "text-foreground border-[hsl(var(--kf-accent1)/0.5)] ring-1 ring-[hsl(var(--kf-accent1)/0.3)]"
                        : "text-muted-foreground border-border/40 hover:border-border/70 hover:text-foreground hover:bg-muted/30"
                    }`}
                    style={isSelected ? { background: "hsl(var(--kf-accent1)/0.12)" } : undefined}
                  >
                    {slot.label} <span className="opacity-60">{slot.period}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Briefcase className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Service</span>
              </div>
              {services.length <= 5 ? (
                <div role="radiogroup" aria-label="Select service" className="space-y-1">
                  {services.map((s) => {
                    const isSelected = bookingServiceId === s.id;
                    return (
                      <button
                        key={s.id}
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => setBookingServiceId(s.id)}
                        className={`w-full text-left flex items-center justify-between px-3 py-2 rounded-lg border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--kf-accent1)/0.6)] ${
                          isSelected
                            ? "border-[hsl(var(--kf-accent1)/0.5)] ring-1 ring-[hsl(var(--kf-accent1)/0.3)]"
                            : "border-border/40 hover:border-border/70 hover:bg-muted/30"
                        }`}
                        style={isSelected ? { background: "hsl(var(--kf-accent1)/0.08)" } : undefined}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {isSelected && <Check className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(var(--kf-accent1))" }} />}
                          <span className={`text-xs font-medium truncate ${isSelected ? "" : "text-muted-foreground"}`}>{s.name}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-shrink-0 ml-2">
                          <span>{s.durationMins ?? 60}m</span>
                          <span className="opacity-40">·</span>
                          <span>{s.currency ?? "TTD"} {s.price}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <select
                  value={bookingServiceId}
                  onChange={(e) => setBookingServiceId(e.target.value)}
                  className="kf-input w-full text-xs"
                >
                  <option value="">Select service...</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} — {s.durationMins ?? 60}m · {s.currency ?? "TTD"} {s.price}</option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <User className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Staff</span>
              </div>
              {staff.length <= 5 ? (
                <div role="radiogroup" aria-label="Select staff member" className="space-y-1">
                  {staff.map((s) => {
                    const isSelected = bookingStaffId === s.id;
                    return (
                      <button
                        key={s.id}
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => setBookingStaffId(s.id)}
                        className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--kf-accent1)/0.6)] ${
                          isSelected
                            ? "border-[hsl(var(--kf-accent1)/0.5)] ring-1 ring-[hsl(var(--kf-accent1)/0.3)]"
                            : "border-border/40 hover:border-border/70 hover:bg-muted/30"
                        }`}
                        style={isSelected ? { background: "hsl(var(--kf-accent1)/0.08)" } : undefined}
                      >
                        {isSelected && <Check className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(var(--kf-accent1))" }} />}
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                          style={{ background: "hsl(var(--kf-accent1)/0.12)", color: "hsl(var(--kf-accent1))" }}
                        >
                          {s.name.charAt(0).toUpperCase()}
                        </div>
                        <span className={`text-xs font-medium truncate ${isSelected ? "" : "text-muted-foreground"}`}>{s.name}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <select
                  value={bookingStaffId}
                  onChange={(e) => setBookingStaffId(e.target.value)}
                  className="kf-input w-full text-xs"
                >
                  <option value="">Select staff...</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div>
            <ContactSelect
              value={bookingContactId}
              onChange={(id) => setBookingContactId(id)}
              contacts={contacts}
              label="Client"
              placeholder="Search or add a client..."
            />
          </div>

          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Location</span>
              <span className="text-[10px] text-muted-foreground/50">(optional)</span>
            </div>
            <input
              type="text"
              value={bookingLocation}
              onChange={(e) => {
                setBookingLocation(e.target.value);
                setBookingLocationPlaceId(undefined);
                setBookingLocationLatLng(undefined);
              }}
              placeholder="Where will this booking happen?"
              className="kf-input w-full text-xs"
            />
          </div>

          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <StickyNote className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Notes</span>
              <span className="text-[10px] text-muted-foreground/50">(optional)</span>
            </div>
            <textarea
              value={bookingNotes}
              onChange={(e) => setBookingNotes(e.target.value)}
              placeholder="Add any notes for this booking..."
              rows={2}
              className="kf-input w-full text-xs resize-none"
            />
          </div>
        </div>

        <div className="px-4 py-3 border-t border-border/40 flex items-center justify-between gap-3" style={{ background: "hsl(var(--kf-accent1)/0.03)" }}>
          <div className="flex-1 min-w-0">
            {selectedService && computedEndTime ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Briefcase className="w-3 h-3" />
                  {selectedService.name}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {selectedService.durationMins ?? 60}m
                </span>
                <span>
                  {bookingTime && (
                    <>
                      {formatTime(new Date(`${bookingDate}T${bookingTime}`).toISOString())} — {formatTime(computedEndTime)}
                    </>
                  )}
                </span>
                {selectedStaff && (
                  <span className="flex items-center gap-1">
                    <User className="w-3 h-3" />
                    {selectedStaff.name}
                  </span>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground/60">
                {!bookingDate ? "Pick a date" : !bookingTime ? "Pick a time" : !bookingServiceId ? "Select a service" : "Select a staff member"}
              </p>
            )}
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg border border-border/50 hover:bg-muted/50 transition-colors text-muted-foreground">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!isComplete || saving}
              className="px-4 py-1.5 text-xs font-semibold rounded-lg text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: isComplete && !saving ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-accent1)/0.4)" }}
            >
              {saving ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Booking...
                </span>
              ) : (
                "Book Now"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
